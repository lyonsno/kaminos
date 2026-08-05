import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  CAT_BAUPLAN_SOURCE_CLASSIFICATION_SCHEMA,
  classifyCatBauplanSource,
} from '../cat-bauplan-source-classifier-core.mjs';

const SOURCE_SHA256 = 'a'.repeat(64);
const CAT_BAUPLAN_SHA256 = '9453608cdf721ee98ad2924ac16a459b7b810d96159566133e7a573327b9744c';
const BOUNDS = { min: [-1, -2, -3], max: [1, 2, 3] };

function object({
  name,
  collection,
  type = 'MESH',
  hidden = false,
  role = null,
}) {
  return {
    name,
    type,
    parent: name.endsWith('| Surface') ? name.replace(/ \| Surface$/, '') : null,
    collections: [collection],
    visibility: {
      hideViewport: hidden,
      hideRender: hidden,
      hiddenInViewLayer: hidden,
      visibleInViewLayer: !hidden,
    },
    worldBounds: BOUNDS,
    customProperties: role === null ? {} : { cmk_role: role },
    geometry: type === 'MESH' ? { kind: 'mesh', vertexCount: 12 } : null,
    modifiers: [],
  };
}

function extraction(objects, sourceSha256 = SOURCE_SHA256) {
  return {
    schema: 'kaminos.track-m-blender-extraction.v0',
    extractorId: 'blender-track-m-source-extract-v0',
    status: 'completed',
    source: {
      requestedPath: '/operator/cat-bauplan.blend',
      effectivePath: '/operator/cat-bauplan.blend',
      sha256: sourceSha256,
      byteLength: 123,
    },
    objects,
  };
}

test('classification admits visible authored meshes and visible generated muscle surfaces', () => {
  const result = classifyCatBauplanSource(extraction([
    object({ name: 'SRC_PELVIS', collection: 'Collection' }),
    object({
      name: 'Muscle 31 | Surface',
      collection: 'Constructional Model/20 Muscle',
      role: 'muscle_surface_provisional',
    }),
    object({
      name: 'Muscle 32 | Surface',
      collection: 'Constructional Model/20 Muscle',
      hidden: true,
      role: 'muscle_surface_provisional',
    }),
  ]), { expectedSourceSha256: SOURCE_SHA256 });

  assert.equal(result.schema, CAT_BAUPLAN_SOURCE_CLASSIFICATION_SCHEMA);
  assert.deepEqual(result.admittedObjectNames, ['Muscle 31 | Surface', 'SRC_PELVIS']);
  assert.deepEqual(result.admittedRoleCounts, { authored_mesh: 1, muscle_surface: 1 });
  assert.equal(result.rejectedObjects[0].reason, 'hidden_source_surface');
});

test('classification recovers source-hash-bound authored bones from semantic custody', () => {
  const result = classifyCatBauplanSource(extraction([
    object({ name: 'Cube.001', collection: 'Constructional Model/90 Semantics/Attachment Patches' }),
    object({ name: 'Unbound Patch Control', collection: 'Constructional Model/90 Semantics/Attachment Patches' }),
    object({ name: 'SRC_PELVIS Muscle | Origin Paint', collection: 'Constructional Model/20 Muscle' }),
    object({ name: 'Muscle 07 | Path', collection: 'Constructional Model/20 Muscle', type: 'CURVE' }),
  ], CAT_BAUPLAN_SHA256), { expectedSourceSha256: CAT_BAUPLAN_SHA256 });

  assert.deepEqual(result.admittedObjectNames, ['Cube.001']);
  assert.equal(result.admittedObjects[0].role, 'authored_mesh');
  assert.equal(result.admittedObjects[0].admissionBasis, 'source_bound_anatomical_recovery');
  assert.deepEqual(result.rejectedObjects.map(item => item.reason), [
    'semantic_control_surface',
    'construction_paint_surface',
    'non_mesh_object',
  ]);
});

test('classification fails loud when source identity or visibility evidence is missing', () => {
  const raw = extraction([object({ name: 'Cube', collection: 'Collection' })]);
  assert.throws(
    () => classifyCatBauplanSource(raw, { expectedSourceSha256: 'b'.repeat(64) }),
    /source SHA-256 mismatch/,
  );

  delete raw.objects[0].visibility;
  assert.throws(
    () => classifyCatBauplanSource(raw, { expectedSourceSha256: SOURCE_SHA256 }),
    /visibility evidence/,
  );
});

test('CLI preserves a durable failure report when source identity is wrong', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cat-bauplan-classifier-'));
  const input = join(directory, 'extraction.json');
  const output = join(directory, 'classification.json');
  const failure = join(directory, 'failure.json');
  await writeFile(input, `${JSON.stringify(extraction([]))}\n`);

  const result = spawnSync(process.execPath, [
    'tools/cat-bauplan-source-classify.mjs',
    '--input', input,
    '--out', output,
    '--failure', failure,
    '--expected-source-sha256', 'b'.repeat(64),
  ], { cwd: process.cwd(), encoding: 'utf8' });

  assert.notEqual(result.status, 0);
  const report = JSON.parse(await readFile(failure, 'utf8'));
  assert.equal(report.status, 'failed');
  assert.equal(report.failurePhase, 'source-classification');
  assert.match(report.error, /source SHA-256 mismatch/);
  assert.match(report.lastTrustworthyEvidence, /input extraction was readable/);
});
