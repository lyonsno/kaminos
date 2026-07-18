import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const core = readFileSync(join(root, 'volume-core.js'), 'utf8');

assert.match(core, /BOUNDARY_SPLAT_OPTICAL_MODE\s*=\s*['"]matched-optical-recurrence-v0['"]/, 'live splats lack the distinct matched optical recurrence arm');
assert.match(core, /BOUNDARY_SPLAT_OPTICAL_DEPTH_BINS\s*=\s*16/, 'matched optical recurrence must expose the exact depth-bin count');
assert.match(core, /fn boundarySplatOpticalFs[\s\S]*return\s+vec4<f32>\(in\.colorOpacity\.rgb\s*\*\s*alpha,\s*alpha\)/, 'optical raster must accumulate premultiplied emission and optical depth separately');
assert.match(core, /fn boundarySplatOpticalPresentationFs[\s\S]*for\s*\(var binIndex[\s\S]*1\.0\s*-\s*exp\(-opticalDepth\)[\s\S]*binColor\s*\*\s*binAlpha\s*\+\s*color\s*\*\s*\(1\.0\s*-\s*binAlpha\)/, 'optical resolve must apply exponential far-to-near self-transmittance');
assert.match(core, /depth-binned-emission-optical-depth-v0/, 'live receipt must identify depth-binned accumulation');
assert.match(core, /depth-binned-exponential-self-transmittance-v0/, 'live receipt must identify the optical recurrence');
assert.match(core, /projected-ndc-zero-to-one-depth-interval-v0/, 'live receipt must identify the effective depth interval');
assert.match(core, /encodeBoundarySplatOpticalRecurrence/, 'live route must encode the optical treatment separately');
assert.match(core, /overflowCount:\s*state\.boundarySplatOverflowCount\s*[,}]/, 'missing optical overflow telemetry must not be coerced to zero');
const orbitWitness = readFileSync(join(root, 'volume-raymarch-filament-orbit-witness.mjs'), 'utf8');
assert.match(orbitWitness, /worldCovarianceMatchedOpticalRecurrence[\s\S]*matched-optical-recurrence-v0/, 'frozen witness delegate must expose the matched optical arm explicitly');
assert.match(orbitWitness, /captureAndPersist\(camera,\s*['"]worldCovarianceMatchedOpticalRecurrence['"]/, 'frozen orbit must actually capture the matched optical arm');
assert.match(orbitWitness, /opticalRecurrenceRequested[\s\S]*args\.has\(['"]--optical-recurrence-report['"]\)/, 'optical capture must require explicit witness intent');
assert.match(orbitWitness, /['"]--optical-recurrence-report['"]/, 'delegate parser must accept the optical report path');
assert.match(orbitWitness, /validateSplatOpticalRecurrenceReport\(opticalRecurrenceReport\)/, 'frozen orbit must validate its optical report before publication');
assert.match(orbitWitness, /writeFileSync\(opticalRecurrenceReportPath,\s*JSON\.stringify\(opticalRecurrenceReport/, 'frozen orbit must publish the accepted optical report');

const opticalWitnessPath = join(root, 'volume-splat-optical-recurrence-witness.mjs');
assert.ok(existsSync(opticalWitnessPath), 'queue-native optical witness wrapper must exist');
const opticalWitness = readFileSync(opticalWitnessPath, 'utf8');
assert.match(opticalWitness, /--optical-recurrence-report/, 'optical wrapper must request the delegate optical report explicitly');
assert.match(opticalWitness, /buildSplatOpticalCockpitManifest/, 'optical wrapper must build Cockpit Manifest V0 from accepted evidence');
assert.match(opticalWitness, /validateSplatOpticalCockpitManifest/, 'optical wrapper must validate Cockpit Manifest V0 before publication');
assert.match(opticalWitness, /writeSplatOpticalRecurrenceFailureReport/, 'optical wrapper must durably replace false or stale completion evidence on failure');
assert.match(opticalWitness, /ffconcat version 1\.0/, 'dynamic media must enumerate the current accepted capture set');
assert.doesNotMatch(opticalWitness, /pattern_type['"],\s*['"]glob/, 'dynamic media must not absorb stale frames through an output-directory glob');

const contractPath = join(root, 'volume-splat-optical-recurrence-contract.mjs');
assert.ok(existsSync(contractPath), 'optical recurrence evidence and cockpit manifest validator must exist');
const {
  buildSplatOpticalCockpitManifest,
  validateSplatOpticalCockpitManifest,
  validateSplatOpticalRecurrenceReport,
  writeSplatOpticalRecurrenceFailureReport,
} = await import(contractPath);

const sha = character => character.repeat(64);
const hash = value => createHash('sha256').update(value).digest('hex');
const source = {
  commit: 'a'.repeat(40),
  presentationBaselineCommit: '0859abf8d5b06359e4d2708f5b597c327b43c4af',
  sameStateCaptureId: 'filament-orbit-f96-s96',
  controlsSha256: sha('1'),
  candidatePayloadSha256: sha('2'),
  supportSha256: sha('3'),
  coefficientSha256: sha('4'),
  covarianceSha256: sha('5'),
  fluidSha256: sha('6'),
  frontSha256: sha('7'),
  candidateCount: 147389,
};
const cameraHashes = Array.from({ length: 21 }, (_, index) => hash(`camera-${index}`));
const captures = arm => cameraHashes.map((cameraPoseHash, cameraIndex) => ({
  cameraIndex,
  cameraPoseHash,
  pixelHash: hash(`${arm}-${cameraIndex}`),
  controlsSha256: source.controlsSha256,
  candidatePayloadSha256: source.candidatePayloadSha256,
  supportSha256: source.supportSha256,
  coefficientSha256: source.coefficientSha256,
  covarianceSha256: source.covarianceSha256,
  candidateCount: source.candidateCount,
  nonblank: true,
}));
const presentationArm = {
  id: 'matched-presentation-v0',
  requestedRoute: 'matched-presentation-v0',
  effectiveRoute: 'matched-presentation-v0',
  targetFormat: 'rgba16float',
  accumulationIdentity: 'additive-rgb-gaussian-alpha-v0',
  transportIdentity: 'none-additive-control-v0',
  presentationIdentity: 'raymarch-matched-exponential-power-grade-v0',
  fallbackReason: null,
  intermediateClamped: false,
  captures: captures('presentation'),
};
const opticalArm = {
  id: 'matched-optical-recurrence-v0',
  requestedRoute: 'matched-optical-recurrence-v0',
  effectiveRoute: 'matched-optical-recurrence-v0',
  targetFormat: 'rgba16float-array',
  layerFormat: 'rgba16float',
  accumulationIdentity: 'depth-binned-emission-optical-depth-v0',
  transportIdentity: 'depth-binned-exponential-self-transmittance-v0',
  presentationIdentity: 'raymarch-matched-exponential-power-grade-v0',
  depthBins: {
    requested: 16,
    effective: 16,
    intervalIdentity: 'projected-ndc-zero-to-one-depth-interval-v0',
    orderingIdentity: 'far-to-near-alpha-over-v0',
    alphaIdentity: 'one-minus-exp-negative-summed-optical-depth-v0',
  },
  fallbackReason: null,
  intermediateClamped: false,
  intermediateReadbackStatus: 'complete',
  telemetry: { status: 'complete', depthBins: 16, activeDepthBins: 16, nonFiniteChannels: 0, overflowCount: 0 },
  captures: captures('optical'),
};
const validReport = {
  schema: 'kaminos.volume.splat-optical-recurrence.v0',
  status: 'completed',
  failurePhase: null,
  requestedRoute: '/volume-selective-head-live.html',
  effectiveWrapperRoute: 'exact-basin-selective-head-live-v0',
  effectiveRendererRoute: 'native-3d-compute-fluid-raymarch-v0',
  backend: 'WebGPU:apple',
  cameraCount: 21,
  source,
  arms: [presentationArm, opticalArm],
};

assert.doesNotThrow(() => validateSplatOpticalRecurrenceReport(validReport), 'complete checksum-bound optical recurrence evidence must validate');

const partiallyOccupiedDepthReport = structuredClone(validReport);
partiallyOccupiedDepthReport.arms[1].telemetry.activeDepthBins = 5;
assert.doesNotThrow(
  () => validateSplatOpticalRecurrenceReport(partiallyOccupiedDepthReport),
  'configured depth-bin coverage remains complete when lawful projected intervals are empty',
);

const acceptedFalseClosures = [];
const recordFalseClosureAcceptance = (label, validation) => {
  try {
    validation();
    acceptedFalseClosures.push(label);
  } catch {
    // Rejection is the required evidence boundary.
  }
};
const placeholderCaptureReport = structuredClone(validReport);
placeholderCaptureReport.arms[0].captures[0].cameraPoseHash = 'camera-0';
placeholderCaptureReport.arms[1].captures[0].cameraPoseHash = 'camera-0';
placeholderCaptureReport.arms[0].captures[0].pixelHash = 'presentation-0';
placeholderCaptureReport.arms[1].captures[0].pixelHash = 'optical-0';
recordFalseClosureAcceptance('placeholder capture and camera hashes', () => {
  validateSplatOpticalRecurrenceReport(placeholderCaptureReport);
});

for (const [label, mutate] of [
  ['fallback route', report => { report.arms[1].fallbackReason = 'additive-fallback'; }],
  ['partial orbit', report => { report.arms[1].captures.pop(); }],
  ['clamped intermediate', report => { report.arms[1].intermediateClamped = true; }],
  ['depth-bin substitution', report => { report.arms[1].depthBins.effective = 8; }],
  ['stale support', report => { report.arms[1].captures[2].supportSha256 = sha('8'); }],
  ['coefficient drift', report => { report.arms[1].captures[3].coefficientSha256 = sha('9'); }],
  ['covariance drift', report => { report.arms[1].captures[4].covarianceSha256 = sha('a'); }],
  ['candidate substitution', report => { report.arms[1].captures[5].candidatePayloadSha256 = sha('b'); }],
  ['presentation baseline drift', report => { report.source.presentationBaselineCommit = 'b'.repeat(40); }],
  ['partial telemetry', report => { report.arms[1].telemetry.status = 'partial'; }],
  ['configured depth-bin telemetry missing', report => { delete report.arms[1].telemetry.depthBins; }],
  ['blank optical depth occupancy', report => { report.arms[1].telemetry.activeDepthBins = 0; }],
  ['missing overflow telemetry', report => { delete report.arms[1].telemetry.overflowCount; }],
]) {
  const report = structuredClone(validReport);
  mutate(report);
  assert.throws(() => validateSplatOpticalRecurrenceReport(report), undefined, `${label} cannot claim optical recurrence evidence`);
}

const manifest = buildSplatOpticalCockpitManifest({
  report: validReport,
  artifacts: [
    { id: 'original-presentation', path: 'presentation.png', bytes: 128, sha256: sha('c'), mediaType: 'image/png', loadRoute: 'matched-presentation-v0' },
    { id: 'matched-optical', path: 'optical.png', bytes: 256, sha256: sha('d'), mediaType: 'image/png', loadRoute: 'matched-optical-recurrence-v0' },
  ],
  authoredForkOutputPath: 'artifacts/authored-forks/radiance-transfer.json',
});
assert.doesNotThrow(() => validateSplatOpticalCockpitManifest(manifest), 'producer manifest must be cockpit-loadable without Integration-owned wiring');
assert.equal(manifest.evidenceState, 'produced');
assert.equal(manifest.visualQuality, 'operator-unseen');
assert.equal(manifest.authoredFork.originalWitnessImmutable, true);
assert.equal(manifest.producer.identity, 'radiance-transfer-producer-v0');

const arbitraryArtifactManifest = structuredClone(manifest);
arbitraryArtifactManifest.artifacts = arbitraryArtifactManifest.artifacts.map((artifact, index) => ({
  ...artifact,
  id: `debug-artifact-${index}`,
  loadRoute: 'debug-only-v0',
}));
recordFalseClosureAcceptance('arbitrary cockpit artifact roles and routes', () => {
  validateSplatOpticalCockpitManifest(arbitraryArtifactManifest);
});

for (const [label, mutate] of [
  ['missing artifact hash', value => { delete value.artifacts[0].sha256; }],
  ['missing original artifact role', value => { value.artifacts[0].id = 'debug-original'; }],
  ['wrong original artifact route', value => { value.artifacts[0].loadRoute = 'debug-only-v0'; }],
  ['wrong treatment artifact route', value => { value.artifacts[1].loadRoute = 'debug-only-v0'; }],
  ['duplicate artifact role', value => { value.artifacts[1].id = value.artifacts[0].id; }],
  ['fallback hidden', value => { value.renderer.fallbackReason = 'silent-fallback'; }],
  ['missing locked covariance', value => { value.controls.locked = value.controls.locked.filter(item => item !== 'covariance'); }],
  ['overwritten original', value => { value.authoredFork.originalWitnessImmutable = false; }],
  ['visual quality overclaim', value => { value.visualQuality = 'production-ready'; }],
  ['missing authored output', value => { value.authoredFork.outputPath = ''; }],
  ['missing treatment socket', value => { delete value.viewSockets.treatment; }],
]) {
  const candidate = structuredClone(manifest);
  mutate(candidate);
  assert.throws(() => validateSplatOpticalCockpitManifest(candidate), undefined, `${label} cannot claim cockpit-loadable evidence`);
}

assert.deepEqual(acceptedFalseClosures, [], `false closure evidence was accepted: ${acceptedFalseClosures.join(', ')}`);

const failureRoot = mkdtempSync(join(tmpdir(), 'kaminos-optical-failure-contract-'));
const displacedReportPath = join(failureRoot, 'report.json');
writeFileSync(displacedReportPath, JSON.stringify(validReport));
const displacedFailure = writeSplatOpticalRecurrenceFailureReport(displacedReportPath, {
  schema: 'kaminos.volume.splat-optical-recurrence.v0',
  status: 'failed',
  failurePhase: 'route-preflight',
  error: 'unreachable test route',
});
assert.equal(displacedFailure.status, 'failed');
assert.equal(displacedFailure.lastTrustworthyEvidence.displacedPrimaryReport.status, 'completed');
assert.match(displacedFailure.lastTrustworthyEvidence.displacedPrimaryReport.sha256, /^[0-9a-f]{64}$/);
assert.equal(JSON.parse(readFileSync(displacedReportPath, 'utf8')).failurePhase, 'route-preflight');

const nestedFailurePath = join(failureRoot, 'missing', 'parents', 'report.json');
assert.doesNotThrow(() => writeSplatOpticalRecurrenceFailureReport(nestedFailurePath, {
  schema: 'kaminos.volume.splat-optical-recurrence.v0',
  status: 'failed',
  failurePhase: 'route-preflight',
  error: 'nested-path test failure',
}));
assert.equal(JSON.parse(readFileSync(nestedFailurePath, 'utf8')).status, 'failed');

console.log('volume splat optical recurrence contracts passed');
