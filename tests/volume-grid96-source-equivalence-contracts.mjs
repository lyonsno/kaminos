import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  buildGrid96NativeSourcePairEquivalence,
  buildGrid96SourceEquivalence,
} from '../volume-grid96-source-equivalence.mjs';

const scratch = mkdtempSync(join(tmpdir(), 'kaminos-grid96-source-equivalence-'));
const root = resolve(import.meta.dirname, '..');
const checker = join(root, 'volume-grid96-source-equivalence.mjs');
const sourceHashes = {
  fluidSha256: '1'.repeat(64),
  frontSha256: '2'.repeat(64),
  boundarySidecarSha256: '3'.repeat(64),
  majorantSha256: '4'.repeat(64),
};
const source = {
  schema: 'kaminos.volume.grid96-source.v0',
  status: 'complete',
  failurePhase: null,
  authority: 'native-grid96-full-field-export-v0',
  identity: `sha256:${'a'.repeat(64)}`,
  grid: 96,
  majorantGrid: 24,
  completeFieldCoverage: true,
  fullGridCellCount: 96 ** 3,
  sameStateCaptureId: 'exact-full-flame-grid96-state120-v0',
  simStepCount: 120,
  requestedControlIdentity: `sha256:${'b'.repeat(64)}`,
  effectiveControlIdentity: `sha256:${'b'.repeat(64)}`,
  route: {
    requested: 'http://127.0.0.1:19096/?volume_resolution=96',
    effective: 'native-3d-compute-fluid-raymarch-v0',
    backend: 'WebGPU:apple',
    fallbackReason: null,
  },
  sourceBasin: {
    presetId: 'vsp-5d9fedbab31583860d39a34751ff5cd847116cd6fe6eeee6b4379909ef4bb2a2',
    contentHash: 'sha256:5d9fedbab31583860d39a34751ff5cd847116cd6fe6eeee6b4379909ef4bb2a2',
    sourceCommit: '1dfd4ca96164860fd983f7267856bccd91e322db',
    artifactFileSha256: '4928df29729e9316d059ccee6c46a946c07743d322363489d99518ecdd9a3172',
    controlOverrideAuthority: 'exact-required-control-overrides-v0',
    controlOverrideRequired: { volume_resolution: '96', volume_render_scale: '1' },
    controlOverrides: {
      volume_resolution: { preset: '128', effective: '96' },
      volume_render_scale: { preset: '0.296917052331791', effective: '1' },
    },
  },
  replay: {
    identity: 'deterministic-replay-same-route-controls-fixed-step-v0',
    authority: 'same-route-controls-fixed-step-replay',
    requestedSteps: 120,
    completedSteps: 120,
    controlsSignature: 'exact-grid96-controls',
  },
  sidecars: {
    fluid: { sha256: sourceHashes.fluidSha256, shape: [96, 96, 96, 16] },
    front: { sha256: sourceHashes.frontSha256, shape: [96, 96, 96, 1] },
    boundary: { sha256: sourceHashes.boundarySidecarSha256, shape: [96, 96, 96, 4] },
    majorant: { sha256: sourceHashes.majorantSha256, shape: [24, 24, 24, 4] },
  },
  claimBoundary: {
    causalQuestion: 'source-lattice-subcell-vs-deposit-space-quadrature-v0',
    cheaperDemoClaim: false,
    resizedGrid160Evidence: false,
    learnerCampaign: false,
    depositionAdjudication: false,
  },
};
const candidate = {
  schema: 'kaminos.volume.layer-coefficient-bilinear-motion-manifest.v0',
  status: 'complete',
  authority: 'single-browser-multi-state-exact-bilinear-motion-v0',
  identity: `sha256:${'c'.repeat(64)}`,
  route: {
    requested: 'http://127.0.0.1:19296/volume-selective-head-live.html?volume_resolution=96',
    effective: 'native-3d-compute-fluid-raymarch-v0',
    prototypeIdentity: 'kaminos-volume-prototype-v0',
    backend: 'WebGPU:apple',
    fallbackReason: null,
  },
  sequence: {
    identity: 'single-browser-multi-state-exact-bilinear-motion-v0',
    stateSteps: [120, 121],
    stateCount: 2,
    sampleCap: null,
    droppedRowCount: 0,
  },
  states: [
    {
      id: 'coefficient-state-120',
      sameStateCaptureId: 'coefficient-state-120',
      requestedControlIdentity: `sha256:${'d'.repeat(64)}`,
      effectiveControlIdentity: `sha256:${'d'.repeat(64)}`,
      replay: {
        identity: 'deterministic-replay-same-route-controls-fixed-step-v0',
        requestedSteps: 120,
        completedSteps: 120,
        grid: 96,
        effectiveRoute: 'native-3d-compute-fluid-raymarch-v0',
        backend: 'WebGPU:apple',
      },
      sourceFieldManifest: {
        identity: 'transient-full-field-source-receipt-v0',
        retained: false,
        sha256: 'e'.repeat(64),
        sourceHashes,
      },
      sourceFieldRetention: {
        identity: 'checksum-bound-transient-full-field-deletion-v0',
        deleted: true,
        deletedArtifactCount: 5,
        sourceManifestSha256: 'e'.repeat(64),
        sourceHashes,
      },
      rows: {
        count: 10,
        sourceRowCount: 96 ** 3,
        sampleCap: null,
        droppedRowCount: 0,
      },
    },
    {
      id: 'coefficient-state-121',
      replay: { requestedSteps: 121, completedSteps: 121, grid: 96 },
    },
  ],
};

const result = buildGrid96SourceEquivalence(source, candidate, { stateId: 'coefficient-state-120' });
assert.equal(result.status, 'equivalent');
assert.equal(result.exactByteIdentity, true);
assert.equal(result.stateId, 'coefficient-state-120');
assert.equal(result.claimBoundary.cheaperDemoClaim, false);
assert.equal(result.claimBoundary.learnerCampaign, false);
assert.deepEqual(result.sourceHashes, sourceHashes);

const nativeCandidate = {
  ...source,
  identity: `sha256:${'9'.repeat(64)}`,
  requestedControlIdentity: `sha256:${'8'.repeat(64)}`,
  effectiveControlIdentity: `sha256:${'8'.repeat(64)}`,
  route: {
    ...source.route,
    requested: 'http://127.0.0.1:19496/?volume_resolution=96',
  },
};
const nativePair = buildGrid96NativeSourcePairEquivalence(source, nativeCandidate, {
  stateId: 'coefficient-state-120',
});
assert.equal(nativePair.status, 'equivalent');
assert.equal(nativePair.exactByteIdentity, true);
assert.equal(nativePair.reuseDecision.tigerRuntimeSourceEquivalent, true);
assert.equal(nativePair.reuseDecision.directCoefficientCaptureMayProceed, true);
assert.equal(nativePair.reuseDecision.frozenFieldImportRequired, false);
assert.throws(
  () => buildGrid96NativeSourcePairEquivalence(source, {
    ...nativeCandidate,
    sidecars: {
      ...nativeCandidate.sidecars,
      boundary: { ...nativeCandidate.sidecars.boundary, sha256: 'f'.repeat(64) },
    },
  }, { stateId: 'coefficient-state-120' }),
  /boundary checksum differs/,
  'one divergent native payload must require a frozen-field import path',
);

assert.throws(
  () => buildGrid96SourceEquivalence(source, {
    ...candidate,
    states: [{
      ...candidate.states[0],
      sourceFieldManifest: {
        ...candidate.states[0].sourceFieldManifest,
        sourceHashes: { ...sourceHashes, fluidSha256: 'f'.repeat(64) },
      },
      sourceFieldRetention: {
        ...candidate.states[0].sourceFieldRetention,
        sourceHashes: { ...sourceHashes, fluidSha256: 'f'.repeat(64) },
      },
    }, candidate.states[1]],
  }, { stateId: 'coefficient-state-120' }),
  /fluid checksum differs/,
  'one divergent field must reject producer reuse',
);
assert.throws(
  () => buildGrid96SourceEquivalence(source, { ...candidate, route: { ...candidate.route, effective: 'fallback-2d-v0' } }, { stateId: 'coefficient-state-120' }),
  /native route/,
  'fallback evidence cannot establish source equivalence',
);
assert.throws(
  () => buildGrid96SourceEquivalence(source, { ...candidate, sequence: { ...candidate.sequence, sampleCap: 100 } }, { stateId: 'coefficient-state-120' }),
  /sample cap/,
  'a capped producer witness cannot establish full-support equivalence',
);
assert.throws(
  () => buildGrid96SourceEquivalence(source, candidate, { stateId: 'coefficient-state-999' }),
  /state is missing/,
  'a nearby state cannot impersonate the exact state-120 source',
);

const sourcePath = join(scratch, 'source.json');
const candidatePath = join(scratch, 'candidate.json');
const outputPath = join(scratch, 'equivalence.json');
const reportPath = join(scratch, 'report.json');
writeFileSync(sourcePath, `${JSON.stringify(source, null, 2)}\n`);
writeFileSync(candidatePath, `${JSON.stringify({ ...candidate, status: 'failed' }, null, 2)}\n`);
writeFileSync(outputPath, '{"status":"equivalent","stale":true}\n');
const failed = spawnSync(process.execPath, [
  checker,
  '--source-manifest', sourcePath,
  '--candidate-manifest', candidatePath,
  '--state-id', 'coefficient-state-120',
  '--out', outputPath,
  '--report', reportPath,
], { cwd: root, encoding: 'utf8' });
assert.notEqual(failed.status, 0, 'failed candidate corpus must fail the equivalence CLI');
assert.equal(JSON.parse(readFileSync(reportPath, 'utf8')).failurePhase, 'source-equivalence-validation');
assert.equal(JSON.parse(readFileSync(outputPath, 'utf8')).status, 'failed', 'failed validation must overwrite stale equivalence output');

rmSync(scratch, { recursive: true, force: true });
console.log('grid96 source equivalence contracts passed');
