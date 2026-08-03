import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  TRACK_M_AUTHORED_SOURCE_GRAPH_SCHEMA,
  TRACK_M_BLENDER_EXTRACTION_SCHEMA,
  TRACK_M_SOURCE_PROJECTION_FAILURE_SCHEMA,
  compileTrackMSourceProjection,
} from '../track-m-source-projection-core.mjs';

const SOURCE_SHA256 = 'a'.repeat(64);
const MATRIX = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

function cmkProperties({
  role,
  lineageId = 'lineage-muscle-01',
  constructionId = 'muscle-01',
  instanceId,
  completeness = 'wip_procedural',
  extra = {},
}) {
  return {
    cmk_schema_version: '1',
    cmk_lineage_id: lineageId,
    cmk_construction_id: constructionId,
    cmk_instance_id: instanceId,
    cmk_variant: 'parent',
    cmk_role: role,
    cmk_completeness: completeness,
    ...extra,
  };
}

function object({ name, type = 'EMPTY', parent = null, properties = {}, geometry = null, modifiers = [] }) {
  return {
    name,
    type,
    parent,
    collections: type === 'EMPTY' ? ['Constructional Model/20 Muscle'] : ['Collection'],
    matrixWorld: MATRIX,
    customProperties: properties,
    geometry,
    modifiers,
  };
}

function rawExtraction() {
  const rootProperties = cmkProperties({
    role: 'muscle_rig',
    instanceId: 'instance-rig-01',
    extra: {
      cmk_origin_name: 'Muscle 01 | Origin',
      cmk_belly_name: 'Muscle 01 | Belly',
      cmk_insertion_name: 'Muscle 01 | Insertion',
      cmk_path_name: 'Muscle 01 | Path',
      cmk_surface_name: 'Muscle 01 | Surface',
      cmk_origin_source: 'SRC_PELVIS',
      cmk_insertion_source: 'DISTAL_BONE',
      cmk_endpoint_route: 'draw_muscle',
      cmk_endpoint_strategy: 'surface_hits',
      cmk_origin_tendon_fraction: 0.18,
      cmk_insertion_tendon_fraction: 0.18,
      cmk_longitudinal_sections: 12,
      cmk_profile_sides: 12,
    },
  });
  return {
    schema: TRACK_M_BLENDER_EXTRACTION_SCHEMA,
    extractorId: 'blender-track-m-source-extract-v0',
    status: 'completed',
    source: {
      requestedPath: '/caller/cat.blend',
      effectivePath: '/frozen/cat.blend',
      sha256: SOURCE_SHA256,
      byteLength: 549819,
    },
    blender: { version: '5.1.2' },
    scene: {
      name: 'Scene',
      frame: 1,
      unitSettings: {
        system: 'METRIC',
        lengthUnit: 'METERS',
        scaleLength: 1,
      },
    },
    objects: [
      object({
        name: 'SRC_PELVIS',
        type: 'MESH',
        geometry: { kind: 'mesh', contentSha256: '1'.repeat(64), vertexCount: 384, edgeCount: 753, polygonCount: 372 },
        modifiers: [{
          name: 'Mirror',
          type: 'MIRROR',
          showViewport: true,
          showRender: true,
          useAxis: [true, false, false],
          useClip: false,
          useMirrorMerge: true,
          mergeThreshold: 0.001,
          useBisectAxis: [false, false, false],
          useBisectFlipAxis: [false, false, false],
          mirrorObject: null,
        }],
      }),
      object({
        name: 'DISTAL_BONE',
        type: 'MESH',
        geometry: { kind: 'mesh', contentSha256: '2'.repeat(64), vertexCount: 80, edgeCount: 150, polygonCount: 72 },
      }),
      object({ name: 'Muscle 01', properties: rootProperties }),
      object({
        name: 'Muscle 01 | Origin',
        parent: 'Muscle 01',
        properties: cmkProperties({ role: 'attachment_origin', instanceId: 'instance-origin-01' }),
      }),
      object({
        name: 'Muscle 01 | Belly',
        parent: 'Muscle 01',
        properties: cmkProperties({ role: 'belly_profile', instanceId: 'instance-belly-01' }),
      }),
      object({
        name: 'Muscle 01 | Insertion',
        parent: 'Muscle 01',
        properties: cmkProperties({ role: 'attachment_insertion', instanceId: 'instance-insertion-01' }),
      }),
      object({
        name: 'Muscle 01 | Path',
        type: 'CURVE',
        parent: 'Muscle 01',
        properties: cmkProperties({ role: 'muscle_path', instanceId: 'instance-path-01' }),
        geometry: { kind: 'curve', contentSha256: '3'.repeat(64), splineCount: 1, pointCount: 5 },
      }),
      object({
        name: 'Muscle 01 | Surface',
        type: 'MESH',
        parent: 'Muscle 01',
        properties: cmkProperties({ role: 'muscle_surface_provisional', instanceId: 'instance-surface-01' }),
        geometry: { kind: 'mesh', contentSha256: '4'.repeat(64), vertexCount: 300, edgeCount: 580, polygonCount: 288 },
      }),
    ],
  };
}

test('projection preserves authored muscle relations and source-mesh endpoint authority', () => {
  const graph = compileTrackMSourceProjection(rawExtraction(), { expectedSourceSha256: SOURCE_SHA256 });
  assert.equal(graph.schema, TRACK_M_AUTHORED_SOURCE_GRAPH_SCHEMA);
  assert.equal(graph.source.sha256, SOURCE_SHA256);
  assert.equal(graph.source.requestedPath, '/caller/cat.blend');
  assert.equal(graph.source.effectivePath, '/frozen/cat.blend');
  assert.equal(graph.sourceMeshes.length, 2);
  assert.equal(graph.sourceMeshes[1].name, 'SRC_PELVIS');
  assert.equal(graph.sourceMeshes[1].modifiers[0].type, 'MIRROR');
  assert.deepEqual(graph.sourceMeshes[1].modifiers[0].useAxis, [true, false, false]);
  assert.equal(graph.muscles.length, 1);
  assert.equal(graph.muscles[0].origin.sourceAuthority, 'source_mesh');
  assert.equal(graph.muscles[0].insertion.sourceAuthority, 'source_mesh');
  assert.equal(graph.muscles[0].endpointRoute, 'draw_muscle');
  assert.equal(graph.muscles[0].endpointStrategy, 'surface_hits');
  assert.deepEqual(graph.muscles[0].missingComponentRoles, []);
  assert.match(graph.graphSha256, /^[0-9a-f]{64}$/);
});

test('projection preserves provisional intermuscular attachment instead of promoting it to bone authority', () => {
  const raw = rawExtraction();
  const secondSurface = object({
    name: 'Muscle 02 | Surface',
    type: 'MESH',
    parent: 'Muscle 02',
    properties: cmkProperties({
      role: 'muscle_surface_provisional',
      lineageId: 'lineage-muscle-02',
      constructionId: 'muscle-02',
      instanceId: 'instance-surface-02',
    }),
    geometry: { kind: 'mesh', contentSha256: '5'.repeat(64), vertexCount: 200, edgeCount: 380, polygonCount: 188 },
  });
  raw.objects.push(secondSurface);
  raw.objects.find(item => item.name === 'Muscle 01').customProperties.cmk_insertion_source = secondSurface.name;
  const graph = compileTrackMSourceProjection(raw, { expectedSourceSha256: SOURCE_SHA256 });
  assert.equal(graph.muscles[0].insertion.sourceAuthority, 'provisional_muscle_surface');
  assert.equal(graph.endpointAuthorityCounts.provisional_muscle_surface, 1);
});

test('projection exposes incomplete WIP rigs while rejecting contradictory extant component identity', () => {
  const incomplete = rawExtraction();
  incomplete.objects = incomplete.objects.filter(item => item.name !== 'Muscle 01 | Surface');
  const graph = compileTrackMSourceProjection(incomplete, { expectedSourceSha256: SOURCE_SHA256 });
  assert.deepEqual(graph.muscles[0].missingComponentRoles, ['muscle_surface_provisional']);
  assert.equal(graph.muscles[0].completenessAuthority, 'incomplete_wip');

  const contradictory = rawExtraction();
  contradictory.objects.find(item => item.name === 'Muscle 01 | Belly').customProperties.cmk_lineage_id = 'different-lineage';
  assert.throws(
    () => compileTrackMSourceProjection(contradictory, { expectedSourceSha256: SOURCE_SHA256 }),
    /belly.*lineage|lineage.*belly/i,
  );

  const contradictoryRecoveredChild = rawExtraction();
  const contradictoryRoot = contradictoryRecoveredChild.objects.find(item => item.name === 'Muscle 01');
  delete contradictoryRoot.customProperties.cmk_surface_name;
  contradictoryRecoveredChild.objects.find(item => item.name === 'Muscle 01 | Surface')
    .customProperties.cmk_lineage_id = 'different-lineage';
  assert.throws(
    () => compileTrackMSourceProjection(contradictoryRecoveredChild, { expectedSourceSha256: SOURCE_SHA256 }),
    /surface.*lineage|lineage.*surface/i,
  );
});

test('projection is order-independent and leaves absent semantic roles explicit', () => {
  const raw = rawExtraction();
  const first = compileTrackMSourceProjection(raw, { expectedSourceSha256: SOURCE_SHA256 });
  raw.objects.reverse();
  const reversed = compileTrackMSourceProjection(raw, { expectedSourceSha256: SOURCE_SHA256 });
  assert.equal(reversed.graphSha256, first.graphSha256);
  assert.deepEqual(reversed, first);
  assert.deepEqual(first.semanticMarkers, []);
  assert.deepEqual(first.missingSemanticRoles, [
    'attachment_patch',
    'clearance_volume',
    'joint_frame',
    'segment_axis',
    'support_target',
  ]);
});

test('projection fails loud on source substitution, duplicate names, and missing endpoint objects', () => {
  assert.throws(
    () => compileTrackMSourceProjection(rawExtraction(), { expectedSourceSha256: 'f'.repeat(64) }),
    /source.*sha-256.*mismatch/i,
  );

  const duplicate = rawExtraction();
  duplicate.objects.push(structuredClone(duplicate.objects[0]));
  assert.throws(
    () => compileTrackMSourceProjection(duplicate, { expectedSourceSha256: SOURCE_SHA256 }),
    /duplicate object name.*SRC_PELVIS/i,
  );

  const missing = rawExtraction();
  missing.objects.find(item => item.name === 'Muscle 01').customProperties.cmk_insertion_source = 'MISSING_BONE';
  assert.throws(
    () => compileTrackMSourceProjection(missing, { expectedSourceSha256: SOURCE_SHA256 }),
    /insertion source.*MISSING_BONE.*missing/i,
  );
});

test('CLI writes a durable phase-local failure report before primary output exists', async () => {
  const root = await mkdtemp(join(tmpdir(), 'track-m-source-projection-'));
  const rawPath = join(root, 'raw.json');
  const graphPath = join(root, 'graph.json');
  const failurePath = join(root, 'failure.json');
  await writeFile(rawPath, `${JSON.stringify(rawExtraction(), null, 2)}\n`);
  const result = spawnSync('node', [
    'tools/compile-track-m-source-projection.mjs',
    '--input', rawPath,
    '--out', graphPath,
    '--failure', failurePath,
    '--expected-source-sha256', 'f'.repeat(64),
  ], { cwd: process.cwd(), encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  const failure = JSON.parse(await readFile(failurePath, 'utf8'));
  assert.equal(failure.schema, TRACK_M_SOURCE_PROJECTION_FAILURE_SCHEMA);
  assert.equal(failure.status, 'failed');
  assert.equal(failure.failurePhase, 'source-validation');
  assert.equal(failure.requestedInputPath, rawPath);
  assert.equal(failure.expectedSourceSha256, 'f'.repeat(64));
  assert.match(failure.error, /source.*sha-256.*mismatch/i);
  assert.equal(failure.lastTrustworthyEvidence, 'raw extraction bytes read and hashed');
});
