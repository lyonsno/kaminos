import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertTimeFreeWgslCallGraph } from './helpers/wgsl-time-free-callgraph.mjs';
import { balancedWgslBlock, wgslCallCount } from './helpers/wgsl-guard-ownership.mjs';

const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');

function assertExternalEmitterFlickerRetired(source) {
  const influence = balancedWgslBlock(source, 'fn externalEmitterInfluence(', {
    label: 'generic external-emitter influence',
  });
  assertTimeFreeWgslCallGraph(
    source,
    ['externalEmitterInfluence'],
    {
      label: 'generic external-emitter influence graph',
      forbiddenCallees: ['hash31'],
    },
  );
  assert.doesNotMatch(
    influence,
    /\b(?:flicker|jitter|pulse|oscillat|random)\w*\b/i,
    'generic external emitters must not retain hidden modulation vocabulary',
  );
  assert.match(
    influence,
    /let falloff = exp\([\s\S]*?;\s*let w = falloff;/,
    'generic external emitters must apply authored strength through spatial and lifetime falloff without hidden attenuation',
  );
  assert.equal(
    wgslCallCount(source, 'externalEmitterInfluence'),
    1,
    'the main fluid kernel must own exactly one generic external-emitter influence evaluation',
  );
  assert.match(
    source,
    /applyExternalEmitterInjection\(externalEmitterInfluence\(p\)\)/,
    'the main fluid kernel must not pass a clock into generic external-emitter influence',
  );
  assert.match(
    source,
    /const MAIN_FLUID_EXTERNAL_CARRIER_HIDDEN_FLICKER_STRATEGY_RETIRED = 'retired-hidden-external-emitter-flicker-v0';/,
    'the structural ledger must name hidden external-carrier flicker retirement',
  );
  assert.match(
    source,
    /const externalCarrierHiddenFlickerEvaluationsPerEmitterCell = 0;/,
    'the cost ledger must report zero hidden flicker evaluations per external-emitter cell',
  );
  for (const projection of [
    /state\.mainFluidExternalCarrierHiddenFlickerStrategy = mainFluidExternalCarrierHiddenFlickerStrategy;/,
    /state\.externalCarrierHiddenFlickerEvaluationsPerEmitterCell = externalCarrierHiddenFlickerEvaluationsPerEmitterCell;/,
    /mainFluidExternalCarrierHiddenFlickerStrategy: state\.mainFluidExternalCarrierHiddenFlickerStrategy/,
    /externalCarrierHiddenFlickerEvaluationsPerEmitterCell: state\.externalCarrierHiddenFlickerEvaluationsPerEmitterCell/,
  ]) {
    assert.match(source, projection, 'public runtime/debug receipts must preserve the hidden-flicker retirement ledger');
  }
}

const failFirst = [];
try {
  assertExternalEmitterFlickerRetired(core);
} catch (error) {
  failFirst.push(error.message);
}
assert.deepEqual(
  failFirst,
  [],
  `generic external-emitter hidden flicker remains active: ${failFirst.join(' | ')}`,
);

const falseClosureMutations = [
  [
    'restored direct time-hash flicker',
    source => source
      .replace('fn externalEmitterInfluence(p: vec3<f32>)', 'fn externalEmitterInfluence(p: vec3<f32>, time: f32)')
      .replace('    let w = falloff;', '    let flicker = 0.82 + 0.18 * hash31(vec3<f32>(f32(i), time, t));\n    let w = falloff * flicker;')
      .replace('externalEmitterInfluence(p))', 'externalEmitterInfluence(p, time))'),
    /helper externalEmitterInfluence must not accept temporal authority/,
  ],
  [
    'helper-hidden time modulation',
    source => source
      .replace(
        'fn externalEmitterInfluence(',
        'fn hiddenExternalCarrierGain(i: u32, t: f32) -> f32 { return 0.82 + 0.18 * fract(u.cameraPos_time.w + f32(i) + t); }\n\nfn externalEmitterInfluence(',
      )
      .replace('    let w = falloff;', '    let w = falloff * hiddenExternalCarrierGain(i, t);'),
    /helper hiddenExternalCarrierGain must not read temporal globals or tokens/,
  ],
  [
    'helper-hidden spatial hash attenuation',
    source => source
      .replace(
        'fn externalEmitterInfluence(',
        'fn hiddenExternalCarrierGain(i: u32, t: f32) -> f32 { return 0.82 + 0.18 * hash31(vec3<f32>(f32(i), t, 0.0)); }\n\nfn externalEmitterInfluence(',
      )
      .replace('    let w = falloff;', '    let w = falloff * hiddenExternalCarrierGain(i, t);'),
    /helper hiddenExternalCarrierGain must not call forbidden helper hash31/,
  ],
  [
    'constant authored-strength attenuation',
    source => source.replace('    let w = falloff;', '    let w = falloff * 0.82;'),
    /must apply authored strength through spatial and lifetime falloff without hidden attenuation/,
  ],
  [
    'restored hidden flicker cost',
    source => source.replace(
      'const externalCarrierHiddenFlickerEvaluationsPerEmitterCell = 0;',
      'const externalCarrierHiddenFlickerEvaluationsPerEmitterCell = 1;',
    ),
    /cost ledger must report zero hidden flicker evaluations per external-emitter cell/,
  ],
];

const acceptedFalseClosures = [];
for (const [name, mutate, expectedFailure] of falseClosureMutations) {
  const mutated = mutate(core);
  assert.notEqual(mutated, core, `${name} mutation must alter the reviewed source`);
  try {
    assertExternalEmitterFlickerRetired(mutated);
    acceptedFalseClosures.push(name);
  } catch (error) {
    assert.match(error.message, expectedFailure, `${name} must fail on its intended boundary`);
  }
}
assert.deepEqual(acceptedFalseClosures, [], 'the external-emitter boundary must reject every false-closure mutation');

console.log('volume external emitter carrier: hidden time/hash flicker retired and authored strength preserved');
