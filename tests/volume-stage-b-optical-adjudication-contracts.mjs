import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const core = readFileSync(join(root, 'volume-core.js'), 'utf8');
const witness = readFileSync(join(root, 'volume-stage-b-optical-adjudication-witness.mjs'), 'utf8');
const {
  STAGE_B_OPTICAL_ADJUDICATION_SCHEMA,
  adjudicateStageBOpticalLayers,
  validateStageBOpticalAuthority,
} = await import(join(root, 'volume-stage-b-optical-adjudication.mjs'));

assert.equal(STAGE_B_OPTICAL_ADJUDICATION_SCHEMA, 'kaminos.pyro.stage-b-optical-adjudication.v0');
assert.match(core, /sampleBoundarySplatOpticalAdjudication/, 'volume runtime must expose exact GPU layer versus analytical recurrence adjudication');
assert.match(core, /readBoundarySplatOpticalAdjudication/, 'volume runtime must read the exact optical attachments for adjudication');
assert.match(witness, /analytical-exact[\s\S]*__kaminosApplyStageBTreatment[\s\S]*sampleBoundarySplatOpticalAdjudication/, 'witness must reapply Stage B to the exact analytical source before comparison');
assert.match(witness, /failurePhase[\s\S]*lastTrustworthyEvidence/, 'witness must preserve a phase-specific report before primary output');

const hash = character => character.repeat(64);
const authority = {
  sameStateCaptureId: 'filament-orbit-f120-s120',
  sourceManifestSha256: hash('1'),
  manifestSha256: hash('2'),
  fluidSha256: hash('3'),
  frontSha256: hash('4'),
  supportSha256: hash('5'),
  coefficientSha256: hash('6'),
  covarianceSha256: hash('7'),
  candidatePayloadSha256: hash('8'),
  controlsSha256: hash('9'),
  requestedMode: 'matched-optical-recurrence-v0',
  effectiveMode: 'matched-optical-recurrence-v0',
  requestedTargetFormat: 'rgba16float-array',
  effectiveTargetFormat: 'rgba16float-array',
  layerFormat: 'rgba16float',
  outputAttachmentFormat: 'rgba8unorm',
  depthBins: 16,
  candidateCount: 1_899_742,
  capacity: 2_000_000,
  overflowCount: 0,
  fallbackUsed: false,
  rendererRequested: true,
  rendererEncoded: true,
  rendererApplied: true,
};
assert.doesNotThrow(() => validateStageBOpticalAuthority(authority));

for (const [label, mutate] of [
  ['fallback', value => { value.fallbackUsed = true; }],
  ['resource hash drift', value => { value.supportSha256 = hash('a'); value.effectiveSupportSha256 = hash('b'); }],
  ['format substitution', value => { value.effectiveTargetFormat = 'rgba8unorm'; }],
  ['partial depth layers', value => { value.depthBins = 15; }],
  ['candidate overflow', value => { value.overflowCount = 1; }],
  ['renderer not applied', value => { value.rendererApplied = false; }],
]) {
  const candidate = structuredClone(authority);
  mutate(candidate);
  assert.throws(() => validateStageBOpticalAuthority(candidate), undefined, `${label} cannot look authoritative`);
}

const width = 2;
const height = 1;
const depthBins = 16;
const layers = Array.from({ length: depthBins }, () => new Float32Array(width * height * 4));
// Pixel zero has a far orange slab and a near blue slab. Pixel one is blank.
layers[15].set([4, 2, 0, 2], 0);
layers[0].set([0, 0, 1, 1], 0);
const baseline = adjudicateStageBOpticalLayers({
  width,
  height,
  layers,
  gpuRgba: new Uint8Array([91, 68, 173, 255, 0, 0, 0, 255]),
  outputToleranceBytes: 255,
  authority,
});
assert.equal(baseline.status, 'completed');
assert.equal(baseline.layers.length, 16);
assert.equal(baseline.layers[15].positiveOpticalDepthPixels, 1);
assert.equal(baseline.layers[0].positiveOpticalDepthPixels, 1);
assert.ok(baseline.layers[15].emission.max > baseline.layers[0].emission.max);
assert.ok(baseline.preTonemap.luminance.quantiles.p100 > 0);
assert.ok(baseline.postTonemap.analyticalLuminance.quantiles.p100 > 0);
assert.equal(baseline.semantics.layerRgb, 'summed-emission-coefficient-times-deposition-weight-v0');
assert.equal(baseline.semantics.layerAlpha, 'summed-optical-depth-coefficient-times-deposition-weight-v0');
assert.equal(baseline.semantics.premultiplication, 'integrated-emission-not-alpha-premultiplied-v0');
assert.equal(baseline.formats.accumulationAttachment, 'rgba16float-array');
assert.equal(baseline.formats.presentationAttachment, 'rgba8unorm');

const exactGpu = Uint8Array.from(baseline.postTonemap.analyticalRgba);
const matched = adjudicateStageBOpticalLayers({
  width,
  height,
  layers,
  gpuRgba: exactGpu,
  outputToleranceBytes: 1,
  authority,
});
assert.equal(matched.comparison.exactWithinTolerance, true);
assert.equal(matched.comparison.mismatchChannelCount, 0);

const lyingGpu = Uint8Array.from(exactGpu);
lyingGpu[0] = Math.min(255, lyingGpu[0] + 12);
const mismatch = adjudicateStageBOpticalLayers({
  width,
  height,
  layers,
  gpuRgba: lyingGpu,
  outputToleranceBytes: 1,
  authority,
});
assert.equal(mismatch.comparison.exactWithinTolerance, false, 'GPU mismatch must fail optical-chain fidelity');
assert.ok(mismatch.comparison.maxAbsByteError >= 12);

const nonFinite = layers.map(layer => Float32Array.from(layer));
nonFinite[3][0] = Number.NaN;
assert.throws(() => adjudicateStageBOpticalLayers({
  width,
  height,
  layers: nonFinite,
  gpuRgba: exactGpu,
  authority,
}), /non-finite/, 'non-finite optical layers cannot become evidence');

console.log('volume Stage B optical adjudication contracts passed');
