import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  adjudicateStageBOpticalLayers,
} from '../volume-stage-b-optical-adjudication.mjs';

const root = new URL('..', import.meta.url).pathname;
const core = readFileSync(join(root, 'volume-core.js'), 'utf8');
const witness = readFileSync(join(root, 'volume-live-full-support-optics-witness.mjs'), 'utf8');

const authority = {
  sameStateCaptureId: 'depth-order-contract',
  sourceManifestSha256: '1'.repeat(64),
  manifestSha256: '2'.repeat(64),
  fluidSha256: '3'.repeat(64),
  frontSha256: '4'.repeat(64),
  supportSha256: '5'.repeat(64),
  coefficientSha256: '6'.repeat(64),
  covarianceSha256: '7'.repeat(64),
  candidatePayloadSha256: '8'.repeat(64),
  controlsSha256: '9'.repeat(64),
  requestedMode: 'matched-optical-recurrence-v0',
  effectiveMode: 'matched-optical-recurrence-v0',
  requestedTargetFormat: 'rgba16float-array',
  effectiveTargetFormat: 'rgba16float-array',
  layerFormat: 'rgba16float',
  outputAttachmentFormat: 'rgba8unorm',
  depthBins: 16,
  candidateCount: 2,
  capacity: 2,
  overflowCount: 0,
  rendererRequested: true,
  rendererEncoded: true,
  rendererApplied: true,
  fallbackUsed: false,
};

const layers = Array.from({ length: authority.depthBins }, () => new Float32Array(4));
layers[15].set([4, 0, 0, 2]);
layers[0].set([0, 0, 2, 2]);
const analytical = adjudicateStageBOpticalLayers({
  width: 1,
  height: 1,
  layers,
  gpuRgba: new Uint8Array(4),
  outputToleranceBytes: 255,
  authority,
});
assert.ok(
  analytical.postTonemap.analyticalRgba[2] > analytical.postTonemap.analyticalRgba[0],
  'near bin zero must alpha-over and attenuate the far bin fifteen slab',
);

assert.match(
  core,
  /fn boundarySplatOpticalDepthOrderDiagnosticFs[\s\S]*near-bin-zero[\s\S]*far-bin-fifteen/,
  'the live GPU lacks an explicit near/far depth-order diagnostic over its deposited layers',
);
assert.match(
  core,
  /sampleBoundarySplatOpticalDepthOrderDiagnostic/,
  'the live runtime does not expose a receipt-bearing depth-order diagnostic sample',
);
assert.match(
  core,
  /camera-linear-volume-aabb-near-zero-far-one-v0/,
  'the live diagnostic does not report its camera-linear volume-bounded depth convention',
);
assert.match(
  core,
  /far-to-near-alpha-over-near-authoritative-v0/,
  'the live diagnostic does not report its recurrence ordering authority',
);
assert.match(
  core,
  /fn boundarySplatCameraLinearDepthBin[\s\S]*cameraForward[\s\S]*projectedHalfExtent[\s\S]*normalizedDepth/,
  'the optical depositor lacks one shared camera-linear depth-bin function',
);
assert.match(
  core,
  /fn boundarySplatVs[\s\S]*out\.depthBin\s*=\s*boundarySplatCameraLinearDepthBin\(transformedPosition\)/,
  'Gaussian optical deposition does not use transformed camera-linear depth',
);
assert.match(
  core,
  /fn boundarySplatBilinearVs[\s\S]*out\.depthBin\s*=\s*boundarySplatCameraLinearDepthBin\(splat\.positionSupport\.xyz\)/,
  'bilinear optical deposition does not use camera-linear depth',
);
assert.doesNotMatch(
  core,
  /out\.depthBin\s*=\s*u32\(floor\(projectedDepth\s*\*\s*f32\(\$\{BOUNDARY_SPLAT_OPTICAL_DEPTH_BINS\}\)\)\)/,
  'nonlinear projected NDC depth must not silently collapse the live volume into the far bin',
);
assert.match(
  witness,
  /sampleBoundarySplatOpticalDepthOrderDiagnostic[\s\S]*orientationA[\s\S]*orientationB/,
  'the live witness does not sample the GPU depth diagnostic at two orientations',
);
assert.match(
  witness,
  /setSelectiveHeadLiveCapturePaused\(true\)[\s\S]*setSelectiveHeadLiveCapturePaused\(false\)/,
  'the depth-order witness must hold one simulation state and resume it after diagnosis',
);
assert.match(
  witness,
  /writeDepthDiagnosticPreview/,
  'the live witness does not preserve inspectable depth diagnostic images',
);
assert.match(
  witness,
  /nearGreenFraction\s*>\s*0\.01[\s\S]*farMagentaFraction\s*>\s*0\.01/,
  'the live witness can falsely pass when every deposited primitive collapses to one end of the depth interval',
);

console.log('volume optical depth order contracts passed');
