#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  buildFrozenCaptureMatrixFromManifest,
  PYRO_CONTROL_PATH_FROZEN_CAPTURE_MATRIX_MANIFEST_SCHEMA,
} from '../pyro-control-path-frozen-capture-matrix.mjs';
import { PYRO_CONTROL_PATH_FROZEN_CAPTURE_MATRIX_SCHEMA } from '../pyro-control-path-frozen-capture-ledger.mjs';

const repoRoot = resolve(import.meta.dirname, '..');
const manifestPath = resolve(repoRoot, 'artifacts/pyro-control-path-parity-audit/browser-gpu-frozen-capture-matrix/manifest.json');
const generatedPath = resolve(repoRoot, 'artifacts/pyro-control-path-parity-audit/browser-gpu-frozen-capture-matrix/matrix.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const generated = JSON.parse(await readFile(generatedPath, 'utf8'));
const rebuilt = await buildFrozenCaptureMatrixFromManifest(manifest, { repoRoot });
const volumeCoreSource = await readFile(resolve(repoRoot, 'volume-core.js'), 'utf8');
const cameraUploadMarker = 'if (boundarySplatCameraBuffer) {';
const cameraUploadLine = volumeCoreSource.slice(0, volumeCoreSource.indexOf(cameraUploadMarker)).split('\n').length;

assert.equal(manifest.schema, PYRO_CONTROL_PATH_FROZEN_CAPTURE_MATRIX_MANIFEST_SCHEMA);
assert.equal(rebuilt.schema, PYRO_CONTROL_PATH_FROZEN_CAPTURE_MATRIX_SCHEMA);
assert.equal(rebuilt.enumerationCount, 206, 'matrix preserves the uncapped enumeration count, not only priority rows');
assert.equal(rebuilt.auditedControlCount, 6);
assert.deepEqual(rebuilt.summary, generated.summary);
assert.deepEqual(rebuilt.rows.map(row => ({
  control: row.control,
  classification: row.classification,
  staticClassificationDisposition: row.staticClassificationDisposition,
})), generated.rows.map(row => ({
  control: row.control,
  classification: row.classification,
  staticClassificationDisposition: row.staticClassificationDisposition,
})));
assert.equal(rebuilt.noiseControl.classification, 'browser-gpu-frozen-capture-no-delta');
assert.equal(rebuilt.noiseControl.pixelDelta.materialChangedCompositionCount, 0);
assert.equal(rebuilt.summary.provedClaimedStageCouplingCount, 4);
assert.equal(rebuilt.summary.negativeClaimedStageCouplingCount, 2);
assert.equal(rebuilt.summary.provedIntentionalRouteSpecificControlCount, 2);
assert.equal(rebuilt.summary.falsifiedStaticClassificationHintCount, 2);
assert.equal(rebuilt.summary.falsifiedStaticRaymarchDownstreamCount, 2);
assert.match(generated.generatedAt, /^\d{4}-\d{2}-\d{2}T/, 'committed matrix records its generation time');
assert.deepEqual(
  { ...rebuilt, generatedAt: generated.generatedAt },
  generated,
  'committed matrix must exactly match manifest-driven regeneration apart from generation time',
);

for (const control of ['volume_boundary_splat_radius', 'volume_boundary_splat_sharpness']) {
  const cameraEvidence = rebuilt.rows.find(row => row.control === control)
    .sourceEvidence.find(evidence => evidence.stage === 'splat-camera-uniform');
  assert.equal(cameraEvidence.marker, cameraUploadMarker);
  assert.equal(cameraEvidence.line, cameraUploadLine, `${control} camera evidence starts at the actual upload block`);
  assert.equal(cameraEvidence.scopeEnd, 'device.queue.writeBuffer(boundarySplatCameraBuffer, 0, splatCamera);');
  assert.ok(cameraEvidence.requiredMarkers.some(({ marker }) => marker.includes(control.endsWith('radius')
    ? 'normalizeBoundarySplatRadius'
    : 'normalizeBoundarySplatSharpness')));
}

for (const control of ['volume_reaction_boundary_topology', 'volume_reaction_boundary_fire_tip']) {
  const row = rebuilt.rows.find(candidate => candidate.control === control);
  assert.equal(row.classification, 'negative-claimed-stage-uncoupled-with-route-specific-delta');
  assert.equal(row.stageEvidence.splatPresentation, false);
  const exclusion = row.sourceEvidence.find(evidence => evidence.stage === 'splat-sidecar-exclusion');
  assert.ok(exclusion?.scopeSha256, `${control} records a bounded sidecar exclusion scope`);
  assert.ok(exclusion.excludedMarkers.length > 0, `${control} records enforced absent source markers`);
}

const lyingManifest = structuredClone(manifest);
const topologyExclusion = lyingManifest.rows
  .find(row => row.control === 'volume_reaction_boundary_topology')
  .sourceEvidence.find(evidence => evidence.stage === 'splat-sidecar-exclusion');
topologyExclusion.absent.push('u.boundary_fire_structure.x');
await assert.rejects(
  buildFrozenCaptureMatrixFromManifest(lyingManifest, { repoRoot }),
  /unexpectedly contains excluded marker: u\.boundary_fire_structure\.x/,
);

const sourceFixtureRoot = await mkdtemp(join(tmpdir(), 'pyro-matrix-source-evidence-'));
try {
  const sourceFixturePath = resolve(sourceFixtureRoot, 'volume-core-source-fixture.js');
  const radiusMarker = 'normalizeBoundarySplatRadius(controlsSnapshot.boundarySplatRadius)';
  const sharpnessMarker = 'normalizeBoundarySplatSharpness(controlsSnapshot.boundarySplatSharpness)';
  const uploadStart = 'if (boundarySplatCameraBuffer) {';
  const uploadEnd = 'device.queue.writeBuffer(boundarySplatCameraBuffer, 0, splatCamera);';
  const radiusRow = structuredClone(manifest.rows.find(row => row.control === 'volume_boundary_splat_radius'));
  const fixtureManifest = {
    schema: PYRO_CONTROL_PATH_FROZEN_CAPTURE_MATRIX_MANIFEST_SCHEMA,
    enumerationLedger: resolve(repoRoot, manifest.enumerationLedger),
    rows: [{
      ...radiusRow,
      comparison: resolve(repoRoot, radiusRow.comparison),
      sourceEvidence: [{
        stage: 'splat-camera-uniform',
        path: sourceFixturePath,
        marker: radiusMarker,
      }],
    }],
  };

  await writeFile(sourceFixturePath, [
    `const initialRadius = ${radiusMarker};`,
    uploadStart,
    `  splatCamera.set([${radiusMarker}, ${sharpnessMarker}], 24);`,
    `  ${uploadEnd}`,
    '}',
    `state.radius = ${radiusMarker};`,
  ].join('\n'));
  await assert.rejects(
    buildFrozenCaptureMatrixFromManifest(fixtureManifest, { repoRoot: sourceFixtureRoot }),
    /source evidence marker is not unique.*3 occurrences/,
    'an unbounded positive marker must not silently bind its first occurrence',
  );

  fixtureManifest.rows[0].sourceEvidence[0] = {
    stage: 'splat-camera-uniform',
    path: sourceFixturePath,
    marker: uploadStart,
    scopeEnd: uploadEnd,
    required: [radiusMarker, sharpnessMarker, 'splatCamera.set([', uploadEnd],
  };
  await writeFile(sourceFixturePath, [
    `const initialRadius = ${radiusMarker};`,
    uploadStart,
    `  splatCamera.set([0.35, ${sharpnessMarker}], 24);`,
    `  ${uploadEnd}`,
    '}',
    `state.radius = ${radiusMarker};`,
  ].join('\n'));
  await assert.rejects(
    buildFrozenCaptureMatrixFromManifest(fixtureManifest, { repoRoot: sourceFixtureRoot }),
    /source evidence scope.*missing required marker.*normalizeBoundarySplatRadius/,
    'state normalization must not satisfy a missing radius upload',
  );
} finally {
  await rm(sourceFixtureRoot, { recursive: true, force: true });
}

console.log('pyro control-path frozen capture matrix contracts passed');
