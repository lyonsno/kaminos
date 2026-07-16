import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

const oracle = await import('../boundary-splat-footprint-oracle.mjs');

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function writeArtifact(root, name, bytes) {
  const path = join(root, name);
  await writeFile(path, bytes);
  return { path, bytes: bytes.length, sha256: sha256(bytes) };
}

async function makeCorpus(root, overrides = {}) {
  const candidates = Buffer.alloc(2 * 19 * 4);
  const candidateView = new Float32Array(candidates.buffer, candidates.byteOffset, candidates.byteLength / 4);
  for (let index = 0; index < candidateView.length; index += 1) candidateView[index] = index / 100;
  const targetBytes = Buffer.from([255, 20, 10, 255, 0, 0, 0, 255]);
  const candidateArtifact = await writeArtifact(root, 'candidates.f32', candidates);
  const targetArtifact = await writeArtifact(root, 'target.rgba', targetBytes);
  const frame = {
    id: 'frame-000',
    sameStateCaptureId: 'same-state-000',
    grid: 2,
    requestedRoute: '?kaminos_volume_smoke=1',
    effectiveRoute: 'native-3d-compute-fluid-raymarch-v0',
    rendererIdentity: 'live-boundary-sidecar-analytic-splats-v0',
    sourceAuthority: 'live-baked-sidecar-plus-fluid-material-v0',
    fallbackReason: null,
    camera: {
      viewProjection: new Array(16).fill(0).map((_, index) => (index % 5 === 0 ? 1 : 0)),
      cameraRight: [1, 0, 0],
      cameraUp: [0, 1, 0],
      viewport: [2, 1],
    },
    splatControls: { radius: 0.8, sharpness: 6.5 },
    candidates: {
      ...candidateArtifact,
      dtype: 'float32-le',
      count: 2,
      strideFloats: 19,
    },
    target: {
      ...targetArtifact,
      authority: 'gpu-rgba8-raymarch-readback-frozen-sim-state',
      rendererIdentity: 'native-3d-compute-fluid-raymarch-v0',
      decomposition: 'candidate-support-gated-unit-gain-direct-flame-native-raymarch-v0',
      requestedRaySteps: 160,
      effectiveRaySteps: 160,
      renderScale: 1,
    },
  };
  return {
    schema: 'kaminos-boundary-splat-supervision-corpus-v0',
    authority: 'live-simulator-frozen-state-candidate-raymarch-v0',
    candidateOrder: oracle.BOUNDARY_SPLAT_SUPERVISION_CANDIDATE_ORDER,
    frames: [{ ...frame, ...(overrides.frame || {}) }],
    ...(overrides.manifest || {}),
  };
}

const root = await mkdtemp(join(tmpdir(), 'kaminos-footprint-oracle-contract-'));
const corpusPath = join(root, 'corpus.json');
const corpus = await makeCorpus(root);
await writeFile(corpusPath, JSON.stringify(corpus, null, 2));

const loaded = await oracle.loadFootprintOracleCorpus(corpusPath, {
  expectedRaySteps: 160,
  expectedRenderScale: 1,
});
assert.equal(loaded.frames.length, 1);
assert.equal(loaded.candidateCount, 2);
assert.equal(loaded.identity.startsWith('sha256:'), true);

const variant = await oracle.writeGlobalFootprintVariant({
  sourceCorpus: loaded,
  outDir: join(root, 'variant'),
  radius: 0.92,
  sharpness: 7.25,
});
assert.equal(variant.manifest.frames[0].splatControls.radius, 0.92);
assert.equal(variant.manifest.frames[0].splatControls.sharpness, 7.25);
assert.equal(variant.manifest.frames[0].candidates.sha256, corpus.frames[0].candidates.sha256);
assert.equal(variant.manifest.frames[0].sameStateCaptureId, corpus.frames[0].sameStateCaptureId);
assert.equal(variant.footprintSemantics.radiusUnits, 'global-billboard-scale-times-learned-radius-scale');
assert.equal(variant.footprintSemantics.absoluteRadiusSubstitution, 'rejected');

const corrupted = structuredClone(variant.manifest);
corrupted.frames[0].candidates.sha256 = '0'.repeat(64);
assert.throws(
  () => oracle.assertCandidatePayloadPreserved(loaded.manifest, corrupted),
  /candidate payload changed/i,
);

const badRayStepsPath = join(root, 'bad-ray-steps.json');
const badRaySteps = await makeCorpus(root, {
  frame: {
    target: {
      ...corpus.frames[0].target,
      effectiveRaySteps: 88,
    },
  },
});
await writeFile(badRayStepsPath, JSON.stringify(badRaySteps, null, 2));
await assert.rejects(
  () => oracle.loadFootprintOracleCorpus(badRayStepsPath, { expectedRaySteps: 160, expectedRenderScale: 1 }),
  /effective ray steps/i,
);

const blankTargetPath = join(root, 'blank-target.json');
const blankTargetArtifact = await writeArtifact(root, 'blank.rgba', Buffer.alloc(0));
const blankTarget = await makeCorpus(root, {
  frame: {
    target: {
      ...corpus.frames[0].target,
      ...blankTargetArtifact,
    },
  },
});
await writeFile(blankTargetPath, JSON.stringify(blankTarget, null, 2));
await assert.rejects(
  () => oracle.loadFootprintOracleCorpus(blankTargetPath, { expectedRaySteps: 160, expectedRenderScale: 1 }),
  /blank/i,
);

const reportPath = join(root, 'training-report.json');
await writeFile(reportPath, JSON.stringify({
  schema: 'kaminos.boundary-splat-radiance-training.v0',
  status: 'trained',
  backend: 'mlx',
  training: {
    modelAuthority: 'per-candidate-free-attribute-oracle-v0',
    frameSplitAuthority: 'explicit-single-frame-per-candidate-table-oracle-v0',
    evaluationLossAuthority: 'same-frame-per-candidate-table-oracle-v0',
    trainFrameIds: ['frame-000'],
    evaluationFrameIds: ['frame-000'],
    requestedSteps: 25,
    steps: 25,
    initialLoss: 0.4,
    trainedLoss: 0.2,
  },
  evaluationFrames: [
    { frameId: 'frame-000', sameStateCaptureId: 'same-state-000', initialLoss: 0.4, trainedLoss: 0.2 },
  ],
  modelArtifact: {
    authority: 'per-candidate-free-attribute-oracle-v0',
    schema: 'kaminos-boundary-splat-candidate-attribute-table-v0',
    deployable: false,
    candidateCount: 2,
  },
}));
const summary = await oracle.summarizeTrainingReport(reportPath, {
  family: 'per-splat-table-oracle',
  requestedRadius: 0.92,
  requestedSharpness: 7.25,
});
assert.equal(summary.family, 'per-splat-table-oracle');
assert.equal(summary.evaluationLossAuthority, 'same-frame-per-candidate-table-oracle-v0');
assert.equal(summary.modelAuthority, 'per-candidate-free-attribute-oracle-v0');
assert.equal(summary.trainedLoss, 0.2);

await writeFile(reportPath, JSON.stringify({
  schema: 'kaminos.boundary-splat-radiance-training.v0',
  status: 'failed',
  failurePhase: 'geometry',
  error: 'frame 0 produced no projected splat fragments',
}));
await assert.rejects(
  () => oracle.summarizeTrainingReport(reportPath, { family: 'broken' }),
  /failed.*geometry/i,
);

const ranked = oracle.rankOracleRows([
  { family: 'global', trainedLoss: 0.31 },
  { family: 'conditioned', trainedLoss: 0.22 },
]);
assert.deepEqual(ranked.map(row => row.family), ['conditioned', 'global']);

const report = oracle.buildFootprintOracleReport({
  sourceCorpus: loaded,
  rows: ranked,
  requestedFamilies: ['global', 'conditioned'],
  commandReceipts: [],
});
assert.equal(report.schema, 'kaminos.boundary-splat-footprint-oracle.v0');
assert.equal(report.footprintPath.radiusMultiplicationOrder.includes('global radius'), true);
assert.equal(report.rows[0].rank, 1);

const source = await readFile(new URL('../boundary-splat-footprint-oracle.mjs', import.meta.url), 'utf8');
assert.match(source, /best-global-radius-sharpness-grid-v0/);
assert.match(source, /least-expressive-conditioned-footprint-family-v0/);
assert.match(source, /strongest-current-per-splat-footprint-oracle-v0/);

console.log('boundary splat footprint oracle contracts passed');
