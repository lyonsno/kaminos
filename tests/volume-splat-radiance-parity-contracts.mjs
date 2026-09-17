import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const core = readFileSync(join(root, 'volume-core.js'), 'utf8');

assert.match(core, /let volumeExposure = clamp\(u\.volume_presentation_controls\.x, 0\.0, 3\.0\)[\s\S]*let exposed = vec3<f32>\(1\.0\) - exp\(-color \* \(0\.96 \* volumeExposure\)\)[\s\S]*let current = pow\(max\(grade, vec3<f32>\(0\.0\)\), vec3<f32>\(0\.84\)\)/, 'raymarch source retains the exponential and power-law grade with authored top-level exposure');
assert.match(core, /BOUNDARY_SPLAT_HDR_TARGET_FORMAT\s*=\s*['"]rgba16float['"]/, 'splat radiance must accumulate in an unclipped rgba16float target');
assert.match(core, /BOUNDARY_SPLAT_PRESENTATION_RESOLVE_IDENTITY\s*=\s*['"]raymarch-matched-exponential-power-grade-v0['"]/, 'matched splats must name the exact raymarch presentation resolve');
assert.match(core, /fn boundarySplatPresentationFs[\s\S]*volumeExposure = clamp\(presentationControls\.exposure\.x, 0\.0, 3\.0\)[\s\S]*1\.0\) - exp\(-color \* \(0\.96 \* volumeExposure\)\)[\s\S]*0\.80 \+ 0\.18 \* vignette[\s\S]*pow\(max\(grade, vec3<f32>\(0\.0\)\), vec3<f32>\(0\.84\)\)/, 'matched splat resolve must apply the same authored exposure, vignette gain, and power grade as raymarch');
assert.match(core, /let sampleUv = vec2<f32>\(in\.uv\.x, 1\.0 - in\.uv\.y\)[\s\S]*textureLoad\(boundarySplatHdr, pixel, 0\)/, 'matched splat resolve must preserve top-left image registration when sampling the WebGPU texture');
assert.match(core, /boundarySplatHdrPipeline[\s\S]*BOUNDARY_SPLAT_HDR_TARGET_FORMAT/, 'matched splat raster must use the HDR accumulation pipeline');
assert.match(core, /boundarySplatPresentationReceipt/, 'frame evidence must expose the effective splat target, curve, and blend identity');
assert.match(core, /intermediateClamped:\s*false/, 'matched presentation receipt must state that the HDR intermediate was not clamped');

const contractPath = join(root, 'volume-splat-radiance-parity-contract.mjs');
assert.ok(existsSync(contractPath), 'radiance parity evidence validator must exist');
const { validateSplatRadianceParityReport } = await import(contractPath);

const cameraHashes = Array.from({ length: 21 }, (_, index) => `camera-${index}`);
const makeArm = (id, overrides = {}) => ({
  id,
  requestedRoute: id,
  effectiveRoute: id,
  targetFormat: id === 'current-additive-v0' ? 'rgba8unorm' : 'rgba16float',
  resolveIdentity: id === 'current-additive-v0' ? 'direct-additive-presentation-v0' : 'raymarch-matched-exponential-power-grade-v0',
  blendIdentity: 'additive-rgb-gaussian-alpha-v0',
  intermediateClamped: false,
  intermediateReadbackStatus: id === 'current-additive-v0' ? 'not-applicable' : 'complete',
  fallbackReason: null,
  captures: cameraHashes.map((cameraPoseHash, cameraIndex) => ({
    cameraIndex,
    cameraPoseHash,
    pixelHash: `${id}-${cameraIndex}`,
    candidateCount: 147389,
    candidatePayloadSha256: 'c'.repeat(64),
    controlsSha256: 'd'.repeat(64),
    nonblank: true,
    ...(id === 'current-additive-v0' ? {} : {
      hdrTelemetry: { status: 'complete', targetFormat: 'rgba16float', nonFiniteChannels: 0 },
    }),
  })),
  ...overrides,
});

const valid = {
  schema: 'kaminos.volume.splat-radiance-parity.v0',
  status: 'completed',
  requestedRoute: '/volume-selective-head-live.html',
  effectiveWrapperRoute: 'exact-basin-selective-head-live-v0',
  effectiveRendererRoute: 'native-3d-compute-fluid-raymarch-v0',
  backend: 'WebGPU:apple',
  failurePhase: null,
  cameraCount: 21,
  source: {
    commit: 'a'.repeat(40),
    sameStateCaptureId: 'filament-orbit-f96-s96',
    controlsSha256: 'd'.repeat(64),
    candidatePayloadSha256: 'c'.repeat(64),
    candidateCount: 147389,
    fluidSha256: 'e'.repeat(64),
    frontSha256: 'f'.repeat(64),
  },
  curve: { exposure: 0.96, vignetteBase: 0.80, vignetteGain: 0.18, power: 0.84 },
  arms: [makeArm('current-additive-v0'), makeArm('matched-presentation-v0')],
};

assert.doesNotThrow(() => validateSplatRadianceParityReport(valid), 'complete checksum-bound 21-camera evidence may claim parity');

for (const [label, mutate] of [
  ['fallback route', report => { report.arms[1].fallbackReason = 'silent-additive-fallback'; }],
  ['clamped HDR intermediate', report => { report.arms[1].intermediateClamped = true; }],
  ['partial orbit', report => { report.arms[1].captures.pop(); }],
  ['stale controls', report => { report.arms[1].captures[3].controlsSha256 = '0'.repeat(64); }],
  ['candidate payload substitution', report => { report.arms[1].captures[4].candidatePayloadSha256 = '1'.repeat(64); }],
  ['effective arm substitution', report => { report.arms[1].effectiveRoute = 'current-additive-v0'; }],
  ['missing source commit', report => { delete report.source.commit; }],
]) {
  const report = structuredClone(valid);
  mutate(report);
  assert.throws(() => validateSplatRadianceParityReport(report), undefined, `${label} cannot claim parity`);
}

const witnessPath = join(root, 'volume-splat-radiance-parity-witness.mjs');
assert.ok(existsSync(witnessPath), 'dedicated radiance parity witness must exist');
const witness = readFileSync(witnessPath, 'utf8');
assert.match(witness, /failurePhase/, 'witness records the failure phase before primary output');
assert.match(witness, /lastTrustworthyEvidence/, 'witness preserves the last trustworthy evidence on failure');
assert.match(witness, /validateSplatRadianceParityReport/, 'witness applies the false-closure validator before completion');
assert.match(witness, /current-additive-v0[\s\S]*matched-presentation-v0/, 'witness captures additive and matched-presentation arms separately');
assert.match(witness, /failurePhase = 'route-preflight'/, 'witness preflights the requested route before launching the browser delegate');
assert.match(witness, /response\.status[\s\S]*response\.url[\s\S]*volume-selective-head-live/, 'route preflight rejects non-success and wrong-document responses with effective identity evidence');

console.log('volume splat radiance parity contracts passed');
