// kaminos-test: node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { evalWgslBatch, extractWgslBlock, extractWgslFunction, withKaminosGpu } from '../tools/shader-herder.mjs';

// Only the inputs are fixtures. The struct and four functions under test come
// from the renderer, so changing their math changes these GPU results.
const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const sampleStruct = extractWgslBlock(core, 'struct FlowReconstructionSample');
const mixFunction = extractWgslFunction(core, 'mixFlowReconstructionSample');
const normalFunction = extractWgslFunction(core, 'flowReconstructionNormal');
const reconstructionFunction = extractWgslFunction(core, 'sampleWorldFlowReconstruction');
const sidecarFunction = extractWgslFunction(core, 'sampleWorldFlowReconstructedSidecar');

function near(actual, expected, label) {
  assert.equal(actual.length, expected.length, label);
  actual.forEach((row, i) => row.forEach((value, j) => {
    assert.ok(Number.isFinite(value) && Math.abs(value - expected[i][j]) < 0.00001,
      `${label} row ${i} lane ${j}: expected ${expected[i][j]}, got ${value}`);
  }));
}

function replaceOnce(source, before, after) {
  assert.equal(source.split(before).length, 2, `mutation target: ${before}`);
  return source.replace(before, after);
}

// A fallback validates these exact evaluation bodies as compute entrypoints.
// It cannot run numerical assertions and the bridge reports that lower authority.
function compileCase(label, options) {
  const args = options.argTypes.map((type, i) => `arg${i}: ${type}`).join(', ');
  const values = options.argTypes.map(type => `${type}(0)`).join(', ');
  return { label, entryPoint: 'main', code: `${options.preamble}
    fn evaluate(${args}) -> ${options.returnType} { ${options.body} }
    @group(0) @binding(0) var<storage, read_write> result: array<${options.returnType}>;
    @compute @workgroup_size(1) fn main() { result[0] = evaluate(${values}); }` };
}

const samples = [
  [[-4, -2, 1, 2], [2, 4, 6, 8], [3, 6, 9, 12], [4, 8, 12, 16], [9, 8, 7, 6], [2], [3]],
  [[8, 6, 5, 4], [10, 12, 14, 16], [15, 18, 21, 24], [20, 24, 28, 32], [5, 4, 3, 2], [10], [15]],
  [[0, -8, -3, -2], [-6, -4, -2, 0], [-9, -6, -3, 0], [-12, -8, -4, 0], [1, 2, 3, 4], [-6], [-9]],
];
const fields = ['velocityDensity', 'material', 'fireLayer', 'microLayer', 'kernelTangentRadius', 'frontTopology', 'freshBurn'];
const wgslValue = value => value.length === 1 ? `${value[0]}.0` : `vec4<f32>(${value.map(v => `${v}.0`).join(', ')})`;
const fixtures = samples.map((sample, i) => `fn fixture${i}() -> FlowReconstructionSample {
  return FlowReconstructionSample(${sample.map(wgslValue).join(', ')});
}`).join('\n');
const fieldRead = fields.map((field, i) => `case ${i}u: { return ${i < 5 ? `r.${field}` : `vec4<f32>(r.${field}, 0.0, 0.0, 0.0)`}; }`).join('\n');
const mixCase = {
  preamble: `${sampleStruct}\n${mixFunction}\n${fixtures}`,
  argTypes: ['f32', 'u32', 'u32', 'u32'], returnType: 'vec4<f32>',
  body: `let forward = selectFixture(arg2);
    let r = mixFlowReconstructionSample(fixture0(), forward, selectFixture(arg3), arg0);
    switch arg1 { ${fieldRead} default: { return vec4<f32>(0.0); } }`,
  inputs: [0, 0.25, 1].flatMap(strength => fields.map((_, field) => [strength, field, 1, 2])),
};
mixCase.preamble += `
  fn selectFixture(which: u32) -> FlowReconstructionSample {
    if (which == 0u) { return fixture0(); }
    if (which == 2u) { return fixture2(); }
    return fixture1();
  }`;

function expectedMix(inputs) {
  return inputs.map(([strength, field, forward, backward]) => {
    if (field === 4) return [0, 0, 0, 0]; // Direction/radius is supplied by the sampler, never blended.
    const result = samples[0][field].map((center, lane) => {
      const filtered = center * 0.5 + (samples[forward][field][lane] + samples[backward][field][lane]) * 0.25;
      const value = center + strength * (filtered - center);
      return field === 0 ? value : Math.max(0, value);
    });
    return result.length === 1 ? [...result, 0, 0, 0] : result;
  });
}

test('production reconstruction mixes every semantic lane, preserves signed velocity and clamps material', async () => {
  const broken = { ...mixCase, preamble: replaceOnce(mixCase.preamble,
    '(forward.material + backward.material)', '(forward.velocityDensity + backward.velocityDensity)') };
  await withKaminosGpu(async ctx => {
    near(await evalWgslBatch(ctx, mixCase), expectedMix(mixCase.inputs), 'semantic mix');
    const symmetric = { ...mixCase, inputs: mixCase.inputs.map(([strength, field]) => [strength, field, 2, 1]) };
    near(await evalWgslBatch(ctx, symmetric), expectedMix(mixCase.inputs), 'exchanged neighbors');
    const constant = { ...mixCase, inputs: fields.map((_, field) => [1, field, 0, 0]) };
    near(await evalWgslBatch(ctx, constant), expectedMix(constant.inputs), 'constant field');
    const negative = { ...mixCase, inputs: fields.map((_, field) => [1, field, 2, 2]) };
    near(await evalWgslBatch(ctx, negative), expectedMix(negative.inputs), 'negative neighbors');
    const wrong = await evalWgslBatch(ctx, broken);
    assert.throws(() => near(wrong, expectedMix(mixCase.inputs), 'cross-wired material'), /cross-wired material/);
  }, { wgslSources: [compileCase('flow-mix', mixCase), compileCase('flow-mix-cross-wire-control', broken)] });
});

const normalCase = {
  preamble: `override GRID: u32 = 32u;
    var<private> slope: vec3<f32>;
    fn flowReconstructionStructure(p: vec3<f32>) -> f32 { return dot(slope, p); }
    ${normalFunction}`,
  argTypes: ['f32', 'f32', 'f32'], returnType: 'vec3<f32>',
  body: 'slope = vec3<f32>(arg0, arg1, arg2); return flowReconstructionNormal(vec3<f32>(0.0));',
  inputs: [[3, 4, 0], [-2, 0, 0], [0, 0, 0], [0, 0.000001, 0]],
};
const normals = [[0.6, 0.8, 0], [-1, 0, 0], [0, 1, 0], [0, 1, 0]];
test('production structural normal follows the gradient and stays finite for flat fields at different grids', async () => {
  const broken = { ...normalCase, preamble: replaceOnce(normalCase.preamble,
    'gradientWorld / max(gradientLength, 0.0001)', '-gradientWorld / max(gradientLength, 0.0001)') };
  await withKaminosGpu(async ctx => {
    for (const grid of [16, 128]) {
      near(await evalWgslBatch(ctx, { ...normalCase, preamble: normalCase.preamble.replace('32u', `${grid}u`) }), normals, `normal grid ${grid}`);
    }
    const wrong = await evalWgslBatch(ctx, broken);
    assert.throws(() => near(wrong, normals, 'reversed normal'), /reversed normal/);
  }, { wgslSources: [compileCase('flow-normal', normalCase), compileCase('flow-normal-reversed-control', broken)] });
});

// Analytic input fields isolate the sampling law from texture interpolation.
// This does not certify renderer bindings, texture sampling or image quality.
const samplerCase = {
  preamble: `${sampleStruct}
    const GRID = 32u; const GRID_Y = 32u;
    struct Controls { reconstruction_kernel_controls: vec4<f32> }
    var<private> u: Controls;
    var<private> velocity: vec3<f32>;
    var<private> curl: vec3<f32>;
    var<private> activity: f32;
    var<private> rawCalls: f32;
    var<private> sidecarCalls: f32;
    var<private> normalCalls: f32;
    fn flowReconstructionNormal(p: vec3<f32>) -> vec3<f32> {
      normalCalls += 1.0;
      return vec3<f32>(0.0, 1.0, 0.0);
    }
    fn worldToCell(p: vec3<f32>) -> vec3<f32> { return p; }
    fn curlAtCell(c: vec3<i32>) -> vec3<f32> { return curl; }
    fn curlMagnitudeAtCell(c: vec3<i32>) -> f32 { return activity; }
    fn sampleWorldFlowReconstructionRaw(p: vec3<f32>) -> FlowReconstructionSample {
      rawCalls += 1.0;
      var r: FlowReconstructionSample;
      r.velocityDensity = vec4<f32>(velocity, 1.0);
      r.material = vec4<f32>(p.x * p.x + p.x, p.y * p.y + p.y, p.z * p.z + p.z, 1.0);
      return r;
    }
    fn sampleWorldBoundarySidecar(p: vec3<f32>) -> vec4<f32> {
      sidecarCalls += 1.0;
      return vec4<f32>(p.x * p.x + p.x, p.y * p.y + p.y, p.z * p.z + p.z, 2.0);
    }
    ${mixFunction}\n${reconstructionFunction}\n${sidecarFunction}`,
  argTypes: ['f32', 'f32', 'f32', 'u32', 'f32', 'u32'], returnType: 'vec4<f32>',
  body: `u.reconstruction_kernel_controls = vec4<f32>(arg0, arg1, arg2, 0.0);
    rawCalls = 0.0; sidecarCalls = 0.0; normalCalls = 0.0;
    velocity = select(vec3<f32>(2.0, 5.0, 0.0), vec3<f32>(0.0, 5.0, 0.0), arg3 > 0u);
    curl = select(vec3<f32>(0.0, 0.0, 3.0), vec3<f32>(0.0), arg3 == 2u);
    activity = arg4;
    let r = sampleWorldFlowReconstruction(vec3<f32>(0.0));
    switch arg5 {
      case 0u: { return r.kernelTangentRadius; }
      case 1u: { return r.material; }
      case 3u: {
        _ = sampleWorldFlowReconstructedSidecar(vec3<f32>(0.0), r);
        return vec4<f32>(rawCalls, sidecarCalls, normalCalls, 0.0);
      }
      default: { return sampleWorldFlowReconstructedSidecar(vec3<f32>(0.0), r); }
    }`,
  inputs: [],
};
const samplingScenarios = [
  { args: [0, 0.08, 0, 0, 0], kernel: [0, 0, 0, 0], axis: 0, radius: 0 },
  { args: [1, 0.08, 0, 0, 0], kernel: [1, 0, 0, 0.08], axis: 0, radius: 0.08 },
  { args: [1, 0.08, 0, 1, 0], kernel: [0, 0, 1, 0.08], axis: 2, radius: 0.08 },
  { args: [1, 0.08, 0, 2, 0], kernel: [0, 0, -1, 0.08], axis: 2, radius: 0.08 },
  { args: [0.5, 0.08, 2, 0, 0.30], kernel: [1, 0, 0, 0.16], axis: 0, radius: 0.16 },
  { args: [1, 0, 0, 0, 0], kernel: [1, 0, 0, 0.0025], axis: 0, radius: 0.0025 },
  { args: [1, 1, 0, 0, 0], kernel: [1, 0, 0, 0.12], axis: 0, radius: 0.12 },
];
samplerCase.inputs = samplingScenarios.flatMap(({ args }) => [0, 1, 2, 3].map(field => [...args, field]));
const samplingExpected = samplingScenarios.flatMap(({ args, kernel, axis, radius }) => {
  const material = [0, 0, 0, 1];
  material[axis] = args[0] * radius * radius * 0.5;
  const calls = args[0] === 0 ? [1, 1, 0, 0] : [3, 3, 1, 0];
  return [kernel, material, [...material.slice(0, 3), 2], calls];
});

test('production sampler projects flow onto the sheet, falls back to curl/geometry and filters at a world-space radius', async () => {
  const broken = { ...samplerCase, preamble: replaceOnce(samplerCase.preamble,
    'let radiusWorld = clamp(u.reconstruction_kernel_controls.y, 0.0025, 0.12)',
    'let radiusWorld = 2.0 * clamp(u.reconstruction_kernel_controls.y, 0.0025, 0.12)') };
  await withKaminosGpu(async ctx => {
    for (const grid of [16, 128]) {
      near(await evalWgslBatch(ctx, { ...samplerCase, preamble: samplerCase.preamble.replace('const GRID = 32u;', `const GRID = ${grid}u;`) }), samplingExpected, `world sampling grid ${grid}`);
    }
    const wrong = await evalWgslBatch(ctx, broken);
    assert.throws(() => near(wrong, samplingExpected, 'doubled world radius'), /doubled world radius/);
  }, { wgslSources: [compileCase('flow-sampler', samplerCase), compileCase('flow-sampler-radius-control', broken)] });
});
