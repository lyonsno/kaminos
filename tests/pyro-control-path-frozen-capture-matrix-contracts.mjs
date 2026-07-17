#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
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

console.log('pyro control-path frozen capture matrix contracts passed');
