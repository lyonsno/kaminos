#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const key = process.argv[index];
  const value = process.argv[index + 1];
  if (key.startsWith('--') && value && !value.startsWith('--')) {
    args.set(key, value);
    index += 1;
  }
}

const repoRoot = resolve(args.get('--repo-root') || import.meta.dirname);
const outputPath = requiredPath('--output', false);
const routeReceiptPath = requiredPath('--route-receipt');
const sourceManifestPath = requiredPath('--source-field-manifest');
const exactOverlayPath = requiredPath('--exact-overlay-manifest');
const routeReceipt = JSON.parse(await readFile(routeReceiptPath, 'utf8'));
const sourceManifestBytes = await readFile(sourceManifestPath);
const sourceManifest = JSON.parse(sourceManifestBytes);
const exactOverlay = JSON.parse(await readFile(exactOverlayPath, 'utf8'));

assert.equal(sourceManifest.status, 'captured', 'source field manifest is incomplete');
assert.equal(sourceManifest.completeFieldCoverage, true, 'source field manifest is partial');
assert.equal(sourceManifest.grid, 160, 'provisional Stage B requires the state-120 160^3 source');
assert.equal(exactOverlay.status, 'complete', 'exact analytical overlay is incomplete');
assert.equal(exactOverlay.routing?.admittedRowCount, 1_899_742, 'exact analytical overlay population drifted');
assert.equal(exactOverlay.execution?.droppedRowCount, 0, 'exact analytical overlay dropped candidates');
assert.equal(exactOverlay.execution?.sampleCap, null, 'exact analytical overlay was capped');

const presentationPath = resolve(repoRoot, 'volume-splat-radiance-parity-contract.mjs');
const opticalPath = resolve(repoRoot, 'volume-core.js');
const controlsSha256 = sha(Buffer.from(routeReceipt.requestedRoute));
const supportSha256 = sourceManifest.boundarySidecar.sidecars.boundary.sha256;
const coefficientSha256 = exactOverlay.artifacts.coefficients.sha256;
const covariancePath = resolve(dirname(sourceManifestPath), 'coefficient-state-120-kernel-descriptors.f32');
const covarianceSha256 = sha(await readFile(covariancePath));
const candidatePayloadSha256 = exactOverlay.artifacts.nativeCellIndices.sha256;
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
const poseHashes = Array.from({ length: 21 }, (_, cameraIndex) => sha(Buffer.from(JSON.stringify({
  orbit: 'filament-orbit-21-camera-v0',
  cameraIndex,
  azimuthDegrees: cameraIndex * (360 / 21),
  elevationDegrees: 8,
  radius: 2.35,
}))));

const artifacts = await Promise.all([
  artifact('original-presentation', '/volume-splat-radiance-parity-contract.mjs', presentationPath, 'text/javascript', 'matched-presentation-v0'),
  artifact('matched-optical', '/volume-core.js', opticalPath, 'text/javascript', 'matched-optical-recurrence-v0'),
  artifact('source-state', `../state/${basename(sourceManifestPath)}`, sourceManifestPath, 'application/json', 'full-grid-fluid-front-boundary-sidecars-v0'),
]);

const manifest = {
  schema: 'kaminos.pyro-cockpit-manifest.v0',
  status: 'complete',
  evidenceState: 'produced',
  visualQuality: 'operator-unseen',
  acceptance: {
    status: 'unaccepted',
    authority: 'producer-evidence-unverified',
    scope: 'operator-exploration-only',
    decisionBearing: false,
    custodian: 'pyro-radiance-transfer-bailiff',
  },
  experiment: { identity: 'matched-splat-optical-recurrence-parity-v0', originalWitnessImmutable: true },
  producer: { identity: 'radiance-transfer-producer-v0', implementationCommit: commit },
  source: {
    commit,
    presentationBaselineCommit: '0859abf8d5b06359e4d2708f5b597c327b43c4af',
    sameStateCaptureId: 'filament-orbit-f120-s120',
    controlsSha256,
    candidatePayloadSha256,
    supportSha256,
    coefficientSha256,
    covarianceSha256,
    fluidSha256: sourceManifest.sidecars.fluid.sha256,
    frontSha256: sourceManifest.sidecars.front.sha256,
    candidateCount: 1_899_742,
  },
  identities: {
    target: 'smoke-off-complete-flame-local-emission-extinction-v0',
    treatment: 'matched-optical-recurrence-v0',
    support: `sha256:${supportSha256}`,
    coefficient: `sha256:${coefficientSha256}`,
    covariance: `sha256:${covarianceSha256}`,
    accumulation: 'depth-binned-emission-optical-depth-v0',
    transport: 'depth-binned-exponential-self-transmittance-v0',
    presentation: 'raymarch-matched-exponential-power-grade-v0',
  },
  artifacts,
  routes: {
    requested: '/volume-selective-head-live.html',
    effectiveWrapper: 'exact-basin-selective-head-live-v0',
    effectiveRenderer: 'native-3d-compute-fluid-raymarch-v0',
    loadAction: 'load-cockpit-manifest-v0',
  },
  controls: {
    requestedSha256: controlsSha256,
    effectiveSha256: controlsSha256,
    locked: [
      'support', 'candidate-membership', 'candidate-count', 'positions', 'covariance', 'radius',
      'sharpness', 'coefficients', 'learned-attributes', 'authored-layers', 'simulator-state',
      'raymarch-target', 'camera-orbit',
    ],
    mutable: ['presentation-view', 'difference-gain', 'debug-view'],
  },
  camera: { orbitIdentity: 'filament-orbit-21-camera-v0', cameraCount: 21, poseHashes },
  state: {
    sameStateCaptureId: 'filament-orbit-f120-s120',
    fluidSha256: sourceManifest.sidecars.fluid.sha256,
    frontSha256: sourceManifest.sidecars.front.sha256,
    historyIdentity: 'frozen-no-history-advance-v0',
  },
  renderer: {
    composition: 'splat-only-v0',
    backend: exactOverlay.source.state.backend,
    fallbackReason: null,
    targetFormat: 'rgba16float-array',
    layerFormat: 'rgba16float',
    depthBins: {
      requested: 16,
      effective: 16,
      intervalIdentity: 'projected-ndc-zero-to-one-depth-interval-v0',
      orderingIdentity: 'far-to-near-alpha-over-v0',
      alphaIdentity: 'one-minus-exp-negative-summed-optical-depth-v0',
    },
  },
  capacity: { candidateCount: 1_899_742, capacity: 2_000_000, overflowCount: 0 },
  timing: { authority: 'boundary-splat-stage-gpu-timestamp-profile-v0', status: 'not-sampled' },
  viewSockets: {
    target: 'raymarch-target-v0',
    treatment: 'matched-optical-recurrence-v0',
    difference: 'target-minus-treatment-v0',
    ridge: 'ridge-layer-isolation-v0',
    nonRidge: 'non-ridge-layer-isolation-v0',
    combined: 'ridge-plus-non-ridge-v0',
    debug: 'depth-bin-optical-debug-v0',
  },
  authoredFork: {
    outputPath: resolve(dirname(outputPath), 'authored-fork.json'),
    originalWitnessImmutable: true,
    writeMode: 'create-new',
    writes: ['authored-controls', 'route-state-identities'],
  },
};

await mkdir(dirname(outputPath), { recursive: true });
const encoded = `${JSON.stringify(manifest, null, 2)}\n`;
await writeFile(outputPath, encoded);
console.log(JSON.stringify({
  ok: true,
  outputPath,
  bytes: Buffer.byteLength(encoded),
  sha256: sha(Buffer.from(encoded)),
  sourceCommit: commit,
  resourceCount: artifacts.length,
  authority: manifest.acceptance,
}, null, 2));

function requiredPath(name, mustExist = true) {
  const value = args.get(name);
  if (!value) throw new Error(`missing ${name}`);
  const path = resolve(value);
  if (mustExist) return path;
  return path;
}

function sha(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function artifact(id, path, diskPath, mediaType, loadRoute) {
  const bytes = await readFile(diskPath);
  return { id, path, bytes: bytes.byteLength, sha256: sha(bytes), mediaType, loadRoute };
}
