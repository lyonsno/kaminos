#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const analyzer = join(root, 'volume-grid-resolution-raymarch-morphology.py');
const fixture = mkdtempSync(join(tmpdir(), 'kaminos-grid-morphology-contract-'));
const sourceDir = join(fixture, 'source');
mkdirSync(sourceDir, { recursive: true });

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const writeJson = (name, value) => {
  const path = join(sourceDir, name);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  return path;
};
const writeFloats = (name, values, shape, channelOrder) => {
  const path = join(sourceDir, name);
  const array = Float32Array.from(values);
  const bytes = Buffer.from(array.buffer, array.byteOffset, array.byteLength);
  writeFileSync(path, bytes);
  return {
    path,
    shape,
    channelOrder,
    dtype: 'float32-le',
    byteOrder: 'little-endian',
    elementCount: array.length,
    floatCount: array.length,
    byteLength: bytes.byteLength,
    sha256: sha256(bytes),
  };
};

const channels = [
  'velocityX', 'velocityY', 'velocityZ', 'densityCarrier',
  'smokeDensity', 'heat', 'fuel', 'detail',
  'flame', 'ember', 'visibleFireCarrier', 'combustionFront',
  'microdetail', 'interfaceShred', 'fireLick', 'emberFleck',
];
const lowGrid = 2;
const highGrid = 4;
const lowFluidValues = [];
const lowFrontValues = [];
for (let z = 0; z < lowGrid; z += 1) {
  for (let y = 0; y < lowGrid; y += 1) {
    for (let x = 0; x < lowGrid; x += 1) {
      const edge = x === y ? 1 : 0;
      lowFluidValues.push(
        x * 0.04, y * 0.05, z * 0.03, 0.18 + edge * 0.08,
        0.12 + y * 0.05, 0.22 + edge * 0.32, 0.06 + x * 0.03, 0.04,
        0.10 + edge * 0.28, 0.03, 0.08 + edge * 0.22, 0.09 + edge * 0.18,
        0.07, 0.05 + edge * 0.18, 0.04 + edge * 0.20, 0.02,
      );
      lowFrontValues.push(0.04 + edge * 0.32);
    }
  }
}
const lowFluid = writeFloats('low.fluid.f32', lowFluidValues, [lowGrid, lowGrid, lowGrid, 16], channels);
const lowFront = writeFloats('low.front.f32', lowFrontValues, [lowGrid, lowGrid, lowGrid, 1], ['frontTopology']);

const nearestFluid = [];
const nearestFront = [];
const highFluidValues = [];
const highFrontValues = [];
for (let z = 0; z < highGrid; z += 1) {
  for (let y = 0; y < highGrid; y += 1) {
    for (let x = 0; x < highGrid; x += 1) {
      const lx = Math.floor(x * lowGrid / highGrid);
      const ly = Math.floor(y * lowGrid / highGrid);
      const lz = Math.floor(z * lowGrid / highGrid);
      const lowCell = lx + ly * lowGrid + lz * lowGrid * lowGrid;
      const base = lowFluidValues.slice(lowCell * 16, lowCell * 16 + 16);
      nearestFluid.push(...base);
      nearestFront.push(lowFrontValues[lowCell]);
      const detail = ((x + y + z) % 2) * 0.018;
      const truth = [...base];
      truth[5] += detail;
      truth[8] += detail * 0.7;
      truth[10] += detail;
      truth[13] += detail * 0.8;
      highFluidValues.push(...truth);
      highFrontValues.push(lowFrontValues[lowCell] + detail * 0.5);
    }
  }
}
const highFluid = writeFloats('high.fluid.f32', highFluidValues, [highGrid, highGrid, highGrid, 16], channels);
const highFront = writeFloats('high.front.f32', highFrontValues, [highGrid, highGrid, highGrid, 1], ['frontTopology']);
const deterministicFluid = writeFloats('deterministic.fluid.f32', nearestFluid, [highGrid, highGrid, highGrid, 16], channels);
const deterministicFront = writeFloats('deterministic.front.f32', nearestFront, [highGrid, highGrid, highGrid, 1], ['frontTopology']);

const sourceCaptureSha = 'a'.repeat(64);
const pair = writeJson('pair.json', {
  schema: 'kaminos.volume.full-grid-field-pair.v0',
  identity: 'phase-aligned-exact-basin-field-pair-v0',
  status: 'captured',
  failurePhase: null,
  authority: 'downsampled-same-high-history-input-to-exact-high-target',
  lowGrid,
  highGrid,
  source: {
    exactBasinSourceCaptureSha256: sourceCaptureSha,
    routeIdentity: 'native-3d-compute-fluid-raymarch-v0',
    effectiveRoute: 'native-3d-compute-fluid-raymarch-v0',
    deterministicReplay: {
      authority: 'same-route-controls-fixed-step-replay',
      completedSteps: 7,
      controlsSignature: 'same-controls',
    },
  },
  low: {
    fluid: { ...lowFluid, downsampleOperator: 'box-average-linear-field-v0', sourceSha256: highFluid.sha256 },
    front: { ...lowFront, downsampleOperator: 'max-pool-support-field-v0', sourceSha256: highFront.sha256 },
  },
  high: { fluid: highFluid, front: highFront },
});
const deterministic = writeJson('deterministic.json', {
  schema: 'kaminos.volume.exact-basin-selective-composition.v0',
  identity: 'dense-topology-plus-support-aware-sparse-carriers-v0',
  status: 'captured',
  failurePhase: null,
  compositionAuthority: 'learned-selective-head-composition-not-filtered-high-truth-v0',
  source: {
    pairManifestPath: pair,
    pairManifestSha256: sha256(readFileSync(pair)),
    exactBasinSourceCaptureSha256: sourceCaptureSha,
    effectiveRoute: 'native-3d-compute-fluid-raymarch-v0',
  },
  relationship: { authority: 'downsampled-same-high-history-input-to-exact-high-target', lowGrid, highGrid },
  residualBlend: { identity: 'low-plus-scaled-learned-residual-v0', scale: 0 },
  receiver: { grid: highGrid, fluid: deterministicFluid, front: deterministicFront },
  batching: { cellCount: highGrid ** 3, completeFieldCoverage: true },
});

const renderControls = grid => ({
  simGrid: grid,
  controls: {
    raySteps: 160,
    adaptiveRays: 0,
    occupancySkip: 1,
    majorantSkip: 0,
    majorantGrid: 24,
    majorantCadence: 1,
    majorantSmooth: 1,
    majorantGuard: 1,
    temporalAccum: 0,
    temporalJitter: 0,
    density: 2.7,
    absorption: 1.85,
    smoke: 0.1,
    fire: 0,
    radiance: 0,
    glow: 0,
    fireRenderMode: 'inspect',
    shellInspectMode: 'boundary_fire',
    boundarySidecarControls: {
      identity: 'baked-boundary-sidecar-v0',
      authority: 'band-limited-support-coverage-ridge-proximity-footprint-v1',
      source: 'baked', view: 'off', blur: 0, stepWidth: 0, ridgeGain: 1.94,
    },
  },
});
const render = (name, grid, fluid, front, role) => writeJson(`${name}.render.json`, {
  schema: 'kaminos.volume.held-field-render.v0',
  identity: 'held-imported-field-neural-splat-render-v0',
  status: 'captured',
  failurePhase: null,
  routeIdentity: 'native-3d-compute-fluid-raymarch-v0',
  effectiveRoute: 'native-3d-compute-fluid-raymarch-v0',
  backend: 'WebGPU:contract',
  sourceCapture: {
    payloadSha256: sourceCaptureSha,
    actualPayloadSha256: sourceCaptureSha,
    hashMatches: true,
    effectiveReplayRoute: 'http://127.0.0.1:8090/?volume_reaction_boundary_support_thermal=0.85&volume_reaction_boundary_support_reaction=1.10&volume_reaction_boundary_support_front=1.25&volume_reaction_boundary_support_interface=0.85&volume_reaction_boundary_fire_ridge=1.76&volume_reaction_boundary_fire_ridge_cut=0.08',
  },
  initialFieldImport: { requested: { grid }, uploads: { fluid, front } },
  importedRender: {
    ok: true,
    sampleAuthority: 'render-only-frozen-sim-state',
    imageAuthority: 'contract-image',
    controlOverrides: { selectiveHeadLiveRenderComposition: 'raymarch-only-v0' },
    boundarySplatCompositionEffective: 'raymarch-only-v0',
    raymarchApplied: true,
    splatApplied: false,
    sameStateCaptureId: 'imported-receiver-render-step-0',
    renderWidth: 64,
    renderHeight: 64,
    role,
  },
  lastDebugState: renderControls(grid),
});
const truthRender = render('truth', highGrid, highFluid, highFront, 'truthHigh');
const lowRender = render('low', lowGrid, lowFluid, lowFront, 'filteredLowNative');
const deterministicRender = render('deterministic', highGrid, deterministicFluid, deterministicFront, 'deterministicLowToHigh');

const args = (outDir, overrides = {}) => [
  analyzer,
  '--pair-manifest', overrides.pair ?? pair,
  '--deterministic-manifest', overrides.deterministic ?? deterministic,
  '--truth-render-manifest', overrides.truthRender ?? truthRender,
  '--low-render-manifest', overrides.lowRender ?? lowRender,
  '--deterministic-render-manifest', overrides.deterministicRender ?? deterministicRender,
  '--renderer-source', join(root, 'volume-core.js'),
  '--materializer-source', join(root, 'volume-exact-basin-support-probe.py'),
  '--out-dir', outDir,
];

assert.ok(existsSync(analyzer), 'grid-resolution morphology analyzer exists');
{
  const outDir = join(fixture, 'out');
  const run = spawnSync('python3', args(outDir), { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const report = JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8'));
  assert.equal(report.schema, 'kaminos.volume.grid-resolution-raymarch-morphology-discriminant.v0');
  assert.equal(report.status, 'captured');
  assert.equal(report.relationship.deterministicMaterialization.verifiedExact, true);
  assert.equal(report.relationship.deterministicMaterialization.samplingIdentity, 'normalized-nearest-cell-low-to-output-grid-v0');
  assert.equal(report.routeAndPresetParity.effectiveRoute, 'native-3d-compute-fluid-raymarch-v0');
  assert.equal(report.routeAndPresetParity.parityStatus, 'partial-camera-unverified');
  assert.equal(report.routeAndPresetParity.completeParity, false);
  assert.equal(report.routeAndPresetParity.renderVisualComparisonAdmitted, false);
  assert.equal(report.routeAndPresetParity.cameraEvidence.status, 'missing-effective-receipt');
  assert.equal(report.scaleAccounting.low.voxelWorldWidth, 1);
  assert.equal(report.scaleAccounting.high.voxelWorldWidth, 0.5);
  assert.equal(report.scaleAccounting.gridResolutionRatio, 2);
  assert.equal(report.scaleAccounting.boundarySidecar.neighborWorldWidthRatio, 2);
  assert.equal(report.scaleAccounting.boundarySidecar.gradientNormalization, 'cell-difference-unnormalized');
  assert.equal(report.scaleAccounting.raymarch.baseOpacityDistanceScalingGridDependent, false);
  assert.equal(report.scaleAccounting.raymarch.overallTraversalGridIndependent, false);
  assert.ok(report.scaleAccounting.raymarch.gridDependentTraversalTerms.includes('majorant-grid'));
  assert.ok(report.metrics.channels.heat.nativeLowLinearVsTruth.rmse >= 0);
  assert.ok(report.metrics.boundarySidecar.ridge.deterministicVsTruth.rmse >= 0);
  assert.equal(report.derivedArtifacts.deterministicSidecar.shape.join('x'), `${highGrid}x${highGrid}x${highGrid}x4`);
  assert.match(report.derivedArtifacts.deterministicSidecar.sha256, /^[0-9a-f]{64}$/);
  assert.equal(report.derivedArtifacts.deterministicSidecar.byteLength, highGrid ** 3 * 4 * Float32Array.BYTES_PER_ELEMENT);
  assert.equal(report.verdict.classification, 'target-directional-deterministic-lift');
  assert.equal(report.verdict.fieldChannelsMovingTowardTruth, 7);
  assert.equal(report.verdict.sidecarChannelsMovingTowardTruth, 3);
  assert.ok(report.verdict.mechanisms.some(item => item.id === 'nearest-materialization-reconstruction-kernel'));
  assert.ok(report.verdict.mechanisms.some(item => item.id === 'cell-unit-boundary-sidecar-rebake'));

  const expectContractFailure = (name, overrides, phase = 'render-contract-validation') => {
    const failedDir = join(fixture, `failed-${name}`);
    const failed = spawnSync('python3', args(failedDir, overrides), { encoding: 'utf8' });
    assert.notEqual(failed.status, 0, `${name} must fail closed`);
    const failedReport = JSON.parse(readFileSync(join(failedDir, 'manifest.json'), 'utf8'));
    assert.equal(failedReport.status, 'failed');
    assert.equal(failedReport.failurePhase, phase);
  };
  const expectRenderContractFailure = (name, manifest) => {
    const manifestPath = writeJson(`${name}.render.json`, manifest);
    expectContractFailure(name, { lowRender: manifestPath });
  };

  const routeDrift = JSON.parse(readFileSync(lowRender, 'utf8'));
  routeDrift.effectiveRoute = 'fallback-canvas-v0';
  expectRenderContractFailure('route-drift', routeDrift);

  const missingEffectiveRoute = JSON.parse(readFileSync(lowRender, 'utf8'));
  delete missingEffectiveRoute.effectiveRoute;
  expectRenderContractFailure('missing-effective-route', missingEffectiveRoute);

  const wrongUpload = JSON.parse(readFileSync(lowRender, 'utf8'));
  wrongUpload.initialFieldImport.uploads.fluid = highFluid;
  expectRenderContractFailure('wrong-upload', wrongUpload);

  const missingHashReceipt = JSON.parse(readFileSync(lowRender, 'utf8'));
  delete missingHashReceipt.sourceCapture.hashMatches;
  expectRenderContractFailure('missing-hash-receipt', missingHashReceipt);

  const backendDrift = JSON.parse(readFileSync(lowRender, 'utf8'));
  backendDrift.backend = 'WebGPU:other-adapter';
  expectRenderContractFailure('backend-drift', backendDrift);

  const materialControlDrift = JSON.parse(readFileSync(lowRender, 'utf8'));
  materialControlDrift.lastDebugState.controls.density = 9.5;
  expectRenderContractFailure('material-control-drift', materialControlDrift);

  const replayControlDrift = JSON.parse(readFileSync(lowRender, 'utf8'));
  replayControlDrift.sourceCapture.effectiveReplayRoute = replayControlDrift.sourceCapture.effectiveReplayRoute.replace(
    'volume_reaction_boundary_support_thermal=0.85',
    'volume_reaction_boundary_support_thermal=0.15',
  );
  expectRenderContractFailure('replay-control-drift', replayControlDrift);

  const missingReplayRoute = JSON.parse(readFileSync(lowRender, 'utf8'));
  delete missingReplayRoute.sourceCapture.effectiveReplayRoute;
  expectRenderContractFailure('missing-replay-route', missingReplayRoute);

  const renderControlKeys = [
    'raySteps', 'adaptiveRays', 'occupancySkip', 'majorantSkip',
    'majorantGrid', 'majorantCadence', 'majorantSmooth', 'majorantGuard',
    'temporalAccum', 'temporalJitter', 'density', 'absorption', 'smoke',
    'fire', 'radiance', 'glow', 'fireRenderMode', 'shellInspectMode',
  ];
  const withoutEffectiveReceipts = (path, name) => {
    const manifest = JSON.parse(readFileSync(path, 'utf8'));
    delete manifest.backend;
    for (const key of renderControlKeys) delete manifest.lastDebugState.controls[key];
    return writeJson(`${name}.render.json`, manifest);
  };
  expectContractFailure('all-missing-backend-controls', {
    truthRender: withoutEffectiveReceipts(truthRender, 'truth-missing-backend-controls'),
    lowRender: withoutEffectiveReceipts(lowRender, 'low-missing-backend-controls'),
    deterministicRender: withoutEffectiveReceipts(deterministicRender, 'deterministic-missing-backend-controls'),
  });

  const provenanceDrift = JSON.parse(readFileSync(deterministic, 'utf8'));
  provenanceDrift.source.pairManifestSha256 = 'b'.repeat(64);
  const provenancePath = writeJson('deterministic-provenance-drift.json', provenanceDrift);
  expectContractFailure('deterministic-provenance', { deterministic: provenancePath }, 'manifest-validation');

  /* Preserve this destructive case last so earlier contract checks see valid bytes. */
  writeFileSync(deterministicFluid.path, Buffer.alloc(deterministicFluid.byteLength));
  const corruptDir = join(fixture, 'failed-corrupt');
  const corrupt = spawnSync('python3', args(corruptDir), { encoding: 'utf8' });
  assert.notEqual(corrupt.status, 0, 'corrupt deterministic bytes must fail closed');
  const corruptReport = JSON.parse(readFileSync(join(corruptDir, 'manifest.json'), 'utf8'));
  assert.equal(corruptReport.status, 'failed');
  assert.equal(corruptReport.failurePhase, 'artifact-validation');
  assert.ok(corruptReport.lastTrustworthyEvidence.pairManifestSha256);

  console.log('grid-resolution raymarch morphology contracts passed');
}
