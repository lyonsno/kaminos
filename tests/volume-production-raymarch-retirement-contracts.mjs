import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  leanStockRaymarchAdmission,
  stripRetiredRaymarchControls,
} from '../volume-core.js';

const read = relative => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');
const core = read('volume-core.js');
const activeCore = core.replace(
  /const RETIRED_RAYMARCH_CONTROL_KEYS[\s\S]*?^}\n/m,
  '/* explicit retired-control compatibility boundary */\n',
);
const cockpit = read('index.html');
const kilnAdapter = read('kiln-volume-fire-adapter.mjs');
const schemaV1 = JSON.parse(read('volume-settings-preset-schema-v1.json'));
const schemaV2 = JSON.parse(read('volume-settings-preset-schema-v2.json'));

const prohibitedCoreMechanisms = [
  ['coarse-majorant grid constant', /\bMAJORANT_GRID\b/],
  ['coarse-majorant buffer', /\bmajorantBuffer\b/],
  ['coarse-majorant compute pass', /\b(?:csMajorant|encodeMajorant)\b/],
  ['coarse-majorant sampling', /\b(?:sampleWorldMajorant|majorantGradientSignal|majorantCellExitDistance)\b/],
  ['temporal history texture', /\bhistoryTexture\b/],
  ['temporal reprojection', /\b(?:temporalResolveColor|temporalReprojectionConfidence|previousViewProj)\b/],
  ['temporal accumulation control', /\btemporalAccum(?:Effective)?\b/],
  ['temporal jitter control', /\btemporalJitter\b/],
  ['history clamp control', /\bhistoryClamp\b/],
  ['stale temporal camera helper', /\btemporalCameraSignature\b/],
];

for (const [label, pattern] of prohibitedCoreMechanisms) {
  assert.doesNotMatch(activeCore, pattern, `production Volume source retires ${label}`);
}

const prohibitedCockpitMechanisms = [
  ['majorant controls', /\bvolume-majorant-(?:skip|smooth|guard|grid)\b/],
  ['majorant route or state', /\b(?:majorantSkip|majorantSmooth|majorantGuard|majorantGrid|majorantCadence)\b/],
  ['temporal controls', /\bvolume-(?:temporal-accum|temporal-jitter|history-clamp)\b/],
  ['temporal route or state', /\b(?:temporalAccum|temporalJitter|historyClamp)\b/],
];

for (const [label, pattern] of prohibitedCockpitMechanisms) {
  assert.doesNotMatch(cockpit, pattern, `production cockpit retires ${label}`);
}

for (const [name, schema] of [['v1', schemaV1], ['v2', schemaV2]]) {
  const descriptors = [
    ...(schema.controls || []),
    ...(schema.rendererControls || []),
    ...(schema.presentationControls || []),
  ];
  const retired = descriptors.filter(descriptor => /majorant|temporal|history.clamp/i.test(`${descriptor.key} ${descriptor.param}`));
  assert.deepEqual(retired, [], `${name} active control schema omits retired raymarch controls`);
}

assert.doesNotMatch(
  kilnAdapter,
  /volume_(?:majorant_(?:skip|smooth|guard|grid)|temporal_(?:accum|jitter)|history_clamp)/,
  'product adapter does not project retired raymarch controls',
);

assert.match(core, /stripRetiredRaymarchControls/, 'historical package compatibility uses one explicit retirement boundary');
assert.match(core, /retiredRaymarchControls/, 'runtime receipts identify stripped historical controls');

const historicalControls = {
  density: 2.4,
  majorantGrid: 48,
  temporalAccum: 0.35,
  historyClamp: 0.7,
};
const stripped = stripRetiredRaymarchControls(historicalControls);
assert.deepEqual(stripped.controls, { density: 2.4 }, 'historical load keeps active controls and removes retired controls');
assert.deepEqual(stripped.retiredRaymarchControls, [
  { key: 'majorantGrid', value: 48 },
  { key: 'temporalAccum', value: 0.35 },
  { key: 'historyClamp', value: 0.7 },
], 'historical load receipts every stripped control with its exact value');
assert.deepEqual(historicalControls, {
  density: 2.4,
  majorantGrid: 48,
  temporalAccum: 0.35,
  historyClamp: 0.7,
}, 'compatibility stripping does not mutate the caller-owned package object');

const leanStockRequest = {
  legacyPyroBackedOff: true,
  fireRenderMode: 'stock',
  pyroFireMode: 'stock',
  pyroCompareMode: 'base',
  presentationMode: 'beauty',
  smokePresentationMode: 'on',
  appearanceDecompositionActive: false,
  nonRidgeOpticalCaptureActive: false,
  nonRidgeSourceBasisCaptureActive: false,
  liveCompleteFlameOpticalCoefficientsEnabled: false,
};
assert.deepEqual(leanStockRaymarchAdmission(leanStockRequest), {
  eligible: true,
  refusalReasons: [],
}, 'explicit stock beauty smoke with Pyro backed off admits the lean shader');

for (const [field, value, reason] of [
  ['legacyPyroBackedOff', false, 'pyro-not-explicitly-backed-off'],
  ['fireRenderMode', 'topology', 'fire-render-mode-not-stock'],
  ['pyroFireMode', 'bite', 'pyro-fire-mode-not-stock'],
  ['pyroCompareMode', 'live', 'pyro-compare-mode-not-base'],
  ['presentationMode', 'intrinsic', 'presentation-mode-not-beauty'],
  ['smokePresentationMode', 'off', 'smoke-presentation-not-on'],
  ['appearanceDecompositionActive', true, 'appearance-decomposition-active'],
  ['nonRidgeOpticalCaptureActive', true, 'nonridge-optical-capture-active'],
  ['nonRidgeSourceBasisCaptureActive', true, 'nonridge-source-basis-capture-active'],
  ['liveCompleteFlameOpticalCoefficientsEnabled', true, 'live-complete-flame-coefficients-active'],
]) {
  const admission = leanStockRaymarchAdmission({ ...leanStockRequest, [field]: value });
  assert.equal(admission.eligible, false, `${field} drift refuses the lean shader`);
  assert.deepEqual(admission.refusalReasons, [reason], `${field} drift reports its exact refusal reason`);
}

assert.match(core, /override LEAN_STOCK_RAYMARCH:\s*bool\s*=\s*false/, 'WGSL declares an explicit stock-only specialization constant');
assert.match(core, /export function leanStockRaymarchAdmission\(/, 'runtime has one named stock specialization admission boundary');
assert.match(core, /controlsSnapshot\.legacyPyroBackedOff === true/, 'lean specialization requires the explicit Pyro-backoff semantic contract');
assert.match(core, /leanStockPipeline/, 'runtime compiles a dedicated lean stock canvas pipeline');
assert.match(core, /leanStockReadbackPipeline/, 'runtime compiles a dedicated lean stock readback pipeline');
assert.match(core, /LEAN_STOCK_RAYMARCH:\s*true/, 'lean pipeline is compiled with the specialization enabled');
assert.match(core, /state\.raymarchShaderSpecialization/, 'debug state reports the effective shader specialization');
assert.match(core, /setDebugRaymarchShaderSpecialization/, 'runtime exposes a diagnostic-only same-state full-pipeline override');
assert.match(core, /force-full/, 'diagnostic specialization override can force the full pipeline for matched comparison');
assert.doesNotMatch(cockpit, /raymarchShaderSpecialization|force-full/, 'diagnostic specialization selection is not an operator basin control');
for (const schema of [schemaV1, schemaV2]) {
  assert.equal(JSON.stringify(schema).includes('raymarchShaderSpecialization'), false, 'diagnostic specialization selection is not persisted in basin schemas');
}
assert.match(core, /directCellOpticalSupportFromSlots/, 'marcher derives support directly from native-cell slots');
assert.match(core, /directCellOpticalSupport[\s\S]*directCellOpticalSupportAtCell\(c \+ vec3<i32>\(1, 1, 1\)\)/, 'direct support conservatively covers every corner consumed by trilinear reconstruction');
assert.match(core, /directCellExitDistance[\s\S]*f32\(GRID\) - vec3<f32>\(0\.5\)/, 'cell-exit traversal uses the same half-cell lattice as trilinear reconstruction');
assert.match(core, /reconstruction_kernel_controls\.x[\s\S]*directSupport/, 'empty-cell skipping refuses the narrow support claim while wider flow-kernel reconstruction is active');
assert.match(core, /expensiveSamples\s*=\s*expensiveSamples\s*\+\s*1u/, 'occupied reconstruction spends the explicit expensive-sample budget');
assert.match(core, /fn segmentOpacity\(opticalDepth:\s*f32,\s*maxOpacity:\s*f32\)/, 'variable segments preserve optical depth through exponential opacity');

console.log('volume production raymarch retirement contracts passed');
