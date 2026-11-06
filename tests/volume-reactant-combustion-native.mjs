// kaminos-test: node
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  REACTANT_COMBUSTION_WGSL, REACTION_LAW_REACTANT,
  reactantBurnStep, reactantMaterialSurvival, reactantCombustionUniformValues,
  resolveReactantCombustionConfig,
} from '../volume-reactant-combustion.mjs';
import { evalWgslBatch, withKaminosGpu } from '../tools/shader-herder.mjs';

// The production shader and uniform packer are intact. Private uniforms are
// controlled inputs; these tests do not certify the material kernel's bindings,
// transport, soot/expansion writeback, or rendered appearance.
const preamble = `struct ReactantUniforms {
  reactant_combustion_a: vec4<f32>, reactant_combustion_b: vec4<f32>,
  reactant_combustion_c: vec4<f32>, reactant_combustion_d: vec4<f32>,
};
var<private> u: ReactantUniforms;
${REACTANT_COMBUSTION_WGSL}`;
const configure = `u = ReactantUniforms(
  vec4<f32>(arg4, arg5, arg6, arg7), vec4<f32>(arg8, arg9, arg10, arg11),
  vec4<f32>(arg12, arg13, arg14, arg15), vec4<f32>(arg16, arg17, arg18, arg19));`;
const burnBody = `${configure} return reactantBurn(arg0, arg1, arg2, arg3);`;
const rateBody = `${configure} return vec4<f32>(reactantExchangeWeightFor(arg3),
  reactantCoolingSurvival(arg3), reactantSootSurvival(arg3), select(0.0, 1.0, reactantLawOn()));`;

function scenario(fuel, oxidizer, heat, dt, controls = {}, grid = 32) {
  const config = resolveReactantCombustionConfig({
    reactionLaw: REACTION_LAW_REACTANT, emitterSourceLaw: 'inflow-boundary',
    reactantMixingTime: 4, reactantCoolingTime: 55, ...controls,
  }, { grid, dt });
  assert.equal(config.effective.admitted, true);
  const state = { fuel, oxidizer, heat, smoke: 0 };
  const referenceControls = { mixingTimeSteps: config.effective.mixingTimeSteps,
    coolingTimeSteps: config.effective.coolingTimeSteps, model: config.effective.model };
  const expected = reactantBurnStep(state, referenceControls, dt);
  return { config, state, dt, referenceControls,
    input: [fuel, oxidizer, heat, dt, ...reactantCombustionUniformValues(config)],
    burn: [expected.fuel, expected.oxidizer, expected.heat, expected.burned] };
}

const options = (rows, body = burnBody, source = preamble) => ({
  preamble: source, argTypes: Array(20).fill('f32'), returnType: 'vec4<f32>',
  body, inputs: rows.map(row => row.input),
});
function nearRows(actual, expected, label) {
  assert.equal(actual.length, expected.length, `${label}: row count`);
  actual.forEach((row, i) => {
    assert.equal(row.length, expected[i].length, `${label}: lane count`);
    row.forEach((value, j) => assert.ok(Number.isFinite(value)
      && Math.abs(value - expected[i][j]) <= 0.00001 * Math.max(1, Math.abs(expected[i][j])),
    `${label}: row ${i} lane ${j}: ${value} != ${expected[i][j]}`));
  });
}
function compileCase(label, config) {
  const args = config.argTypes.map((type, i) => `arg${i}: ${type}`).join(', ');
  const zeroes = config.argTypes.map(type => `${type}(0)`).join(', ');
  return { label, entryPoint: 'main', code: `${config.preamble}
    fn evaluate(${args}) -> ${config.returnType} { ${config.body} }
    @compute @workgroup_size(1) fn main() { _ = evaluate(${zeroes}); }` };
}
function mutate(source, before, after) {
  // Fault-construction precondition; numerical output is the behavior oracle.
  const at = source.indexOf(before);
  if (at < 0 || source.indexOf(before, at + before.length) >= 0)
    throw new Error(`Mutation target must occur exactly once: ${before}`);
  return source.slice(0, at) + after + source.slice(at + before.length);
}

const burnScenarios = [
  scenario(0, 1, 1, 1), scenario(0.5, 0, 1, 1),
  scenario(0.5, 0.6, 0.05, 1), scenario(0.5, 0.6, 0.2, 1),
  scenario(0.5, 0.6, 1, 0), scenario(0.05, 1, 1, 1),
  scenario(1, 0.12, 1, 1), scenario(0.5, 0.6, 1, 0.5),
  scenario(0.5, 0.6, 1, 4, { reactantMixingTime: 0.01 }),
  scenario(0.5, 0.6, 1, 2, { reactantMixingTime: 7,
    reactantModelOverrides: { oxidizerRequirement: 2, heatOfCombustion: 4 } }),
];
test('production reactant burn obeys ignition, limiting reactants, and coupled material/energy balance', async () => {
  const config = options(burnScenarios);
  await withKaminosGpu(async ctx => {
    const actual = await evalWgslBatch(ctx, config);
    nearRows(actual, burnScenarios.map(row => row.burn), 'local burn');
    actual.forEach(([fuel, oxidizer, heat, burned], i) => {
      const { state, config: { effective: { model } } } = burnScenarios[i];
      assert.ok(fuel >= -0.00001 && oxidizer >= -0.00001 && burned >= -0.00001);
      assert.ok(burned <= Math.min(state.fuel, state.oxidizer / model.oxidizerRequirement) + 0.00001);
      nearRows([[state.fuel - fuel, state.oxidizer - oxidizer, heat - state.heat]],
        [[burned, model.oxidizerRequirement * burned, model.heatOfCombustion * burned]], 'one burned amount');
    });
  }, { wgslSources: [compileCase('reactant-burn', config)] });
});

test('production ignited burn composes over quarter steps using its returned state', async () => {
  const rows = [0.5, 1, 2].flatMap(dt => [0.1, 4, 30].map(mixing =>
    scenario(0.4, 0.8, 1.2, dt, { reactantMixingTime: mixing })));
  const splitBody = `${configure}
    var state = vec3<f32>(arg0, arg1, arg2); var burned = 0.0;
    for (var step = 0u; step < 4u; step += 1u) {
      let next = reactantBurn(state.x, state.y, state.z, arg3 * 0.25);
      state = next.xyz; burned += next.w;
    }
    return vec4<f32>(state, burned);`;
  const whole = options(rows), split = options(rows, splitBody);
  await withKaminosGpu(async ctx => {
    const expected = rows.map(row => row.burn);
    nearRows(await evalWgslBatch(ctx, whole), expected, 'whole step');
    nearRows(await evalWgslBatch(ctx, split), expected, 'quarter steps');
  }, { wgslSources: [compileCase('reactant-whole-step', whole), compileCase('reactant-quarter-steps', split)] });
});

test('production exchange and survival helpers honor dt, stability cap, and packed parameters', async () => {
  const rows = [32, 64].flatMap(grid => [0, 0.25, 1, 5].map(dt =>
    scenario(0.4, 0.8, 1.2, dt, { reactantCoolingTime: 20,
      reactantModelOverrides: { sootRetirementSteps: 40 } }, grid)));
  const expected = rows.map(({ config, dt, referenceControls }) => {
    const survival = reactantMaterialSurvival(referenceControls, dt);
    return [Math.min(config.effective.exchangeWeightPerUnitDt * dt, 0.16), survival.heat, survival.smoke, 1];
  });
  const config = options(rows, rateBody);
  await withKaminosGpu(async ctx => nearRows(await evalWgslBatch(ctx, config), expected, 'transport rates'),
    { wgslSources: [compileCase('reactant-rates', config)] });
});

test('numerical oracles reject valid WGSL energy, oxidizer, and time-rate faults', async () => {
  const burnRows = [scenario(0.5, 0.6, 1, 0.5)];
  const rateRows = [scenario(0.5, 0.6, 1, 0.25)];
  const rateReference = reactantMaterialSurvival(rateRows[0].referenceControls, 0.25);
  const cases = [
    { label: 'reversed heat release', lane: 2, config: options(burnRows, burnBody,
      mutate(preamble, 'heat + q * burned', 'heat - q * burned')), expected: burnRows.map(row => row.burn) },
    { label: 'wrong oxidizer consumption', lane: 1, config: options(burnRows, burnBody,
      mutate(preamble, 'oxidizer - s * burned', 'oxidizer - burned')), expected: burnRows.map(row => row.burn) },
    { label: 'cooling ignores dt', lane: 1, config: options(rateRows, rateBody,
      mutate(preamble, 'return exp(-dt / max(u.reactant_combustion_a.z, 1e-3));',
        'return exp(-1.0 / max(u.reactant_combustion_a.z, 1e-3));')),
      expected: [[rateRows[0].config.effective.exchangeWeightPerUnitDt * 0.25, rateReference.heat, rateReference.smoke, 1]] },
  ];
  await withKaminosGpu(async ctx => {
    for (const { label, lane, config, expected } of cases) {
      const actual = await evalWgslBatch(ctx, config); // A compile error fails this test.
      assert.equal(actual.length, 1);
      assert.equal(actual[0].length, 4);
      assert.ok(actual[0].every(Number.isFinite), `${label}: finite GPU output required`);
      assert.throws(() => nearRows(actual, expected, label), error => error.code === 'ERR_ASSERTION'
        && error.message.startsWith(`${label}: row 0 lane ${lane}:`), label);
    }
  }, { wgslSources: cases.map(({ label, config }) => compileCase(label, config)) });
});
