import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  AUTHORED_MUSCLE_COORDINATE_AUTHORITY_RECEIPT_SCHEMA,
  AUTHORED_MUSCLE_COORDINATE_EXPORT_FAILURE_SCHEMA,
  AUTHORED_MUSCLE_COORDINATE_PARENT_ATLAS_SCHEMA,
  buildAuthoredMuscleCoordinateExport,
  buildPackerAuthorityProbe,
  verifyAuthorityReceiptParentBinding,
} from '../authored-muscle-coordinate-export-core.mjs';
import { admitAuthoredMusclePackingIntake } from '../authored-muscle-packing-intake-core.mjs';

const ASSET_SHA = 'a'.repeat(64);
const GRAPH_SHA = 'b'.repeat(64);
const GRAPH_FILE_SHA = 'c'.repeat(64);
const ROUTING_SHA = 'd'.repeat(64);
const IDENTITY = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return typeof value === 'number' && Object.is(value, -0) ? 0 : value;
}

function hashForFixture(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function component(constructionId, role, instanceId, geometry = null, matrixWorld = IDENTITY) {
  return {
    name: `${constructionId}-${role}`,
    type: geometry?.kind === 'curve' ? 'CURVE' : role === 'surface' ? 'MESH' : 'EMPTY',
    parent: constructionId,
    collections: ['Constructional Model/20 Muscle'],
    matrixWorld,
    modifiers: [],
    role,
    identity: {
      construction_id: `${constructionId}-${role}`,
      instance_id: instanceId,
      lineage_id: `lineage-${constructionId}`,
      schema_version: '1',
      variant: 'parent',
    },
    referenceResolution: 'declared',
    geometry,
  };
}

function muscle(constructionId, offset, { conflict = false } = {}) {
  const origin = [offset, 0, 0];
  const insertion = [offset, 0, 4];
  const pathOrigin = conflict ? [offset + 1, 0, 0] : origin;
  const surfaceOrigin = conflict ? [offset + 2, 0, 0] : origin;
  const pathGeometry = {
    kind: 'curve',
    contentSha256: String(offset + 1).repeat(64).slice(0, 64),
    splineCount: 1,
    pointCount: 3,
    nativeSplines: [{
      type: 'POLY',
      cyclic: false,
      points: [
        { co: [...pathOrigin, 1], radius: 0.2 },
        { co: [offset, 0, 2, 1], radius: 0.4 },
        { co: [...insertion, 1], radius: 0.2 },
      ],
    }],
  };
  const surfaceGeometry = {
    kind: 'mesh',
    contentSha256: String(offset + 4).repeat(64).slice(0, 64),
    vertexCount: 4,
    edgeCount: 4,
    polygonCount: 1,
    sourceMeasurements: {
      vertexPositions: [
        surfaceOrigin,
        insertion,
        [offset, 0.25, 2],
        [offset, -0.25, 2],
      ],
      localTargetVolume: 1.25,
      maximumRadius: 0.5,
    },
  };
  return {
    name: constructionId,
    type: 'EMPTY',
    parent: null,
    collections: ['Constructional Model/20 Muscle'],
    matrixWorld: IDENTITY,
    modifiers: [],
    identity: {
      construction_id: constructionId,
      instance_id: `instance-${constructionId}`,
      lineage_id: `lineage-${constructionId}`,
      schema_version: '1',
      variant: 'parent',
    },
    authoredCompleteness: 'wip_procedural',
    completenessAuthority: 'declared_components_present',
    endpointRoute: 'draw_muscle',
    endpointStrategy: 'surface_hits',
    settings: {},
    origin: {
      handleObject: `${constructionId}-origin`,
      handleInstanceId: `origin-${constructionId}`,
      sourceName: 'SRC_ORIGIN',
      sourceAuthority: 'source_mesh',
      sourceObjectType: 'MESH',
      sourceRole: null,
      sourceInstanceId: null,
    },
    insertion: {
      handleObject: `${constructionId}-insertion`,
      handleInstanceId: `insertion-${constructionId}`,
      sourceName: 'SRC_INSERTION',
      sourceAuthority: 'source_mesh',
      sourceObjectType: 'MESH',
      sourceRole: null,
      sourceInstanceId: null,
    },
    components: {
      origin: component(
        constructionId,
        'origin',
        `origin-${constructionId}`,
        null,
        [...IDENTITY.slice(0, 3), origin[0], ...IDENTITY.slice(4, 7), origin[1], ...IDENTITY.slice(8, 11), origin[2], 0, 0, 0, 1],
      ),
      insertion: component(
        constructionId,
        'insertion',
        `insertion-${constructionId}`,
        null,
        [...IDENTITY.slice(0, 3), insertion[0], ...IDENTITY.slice(4, 7), insertion[1], ...IDENTITY.slice(8, 11), insertion[2], 0, 0, 0, 1],
      ),
      belly: component(constructionId, 'belly', `belly-${constructionId}`),
      path: component(constructionId, 'path', `path-${constructionId}`, pathGeometry),
      surface: component(constructionId, 'surface', `surface-${constructionId}`, surfaceGeometry),
    },
    missingComponentRoles: [],
  };
}

function graph({ conflictId = null } = {}) {
  const muscles = [
    muscle('route-a', 1, { conflict: conflictId === 'route-a' }),
    muscle('route-b', 2, { conflict: conflictId === 'route-b' }),
    muscle('route-c', 3, { conflict: conflictId === 'route-c' }),
  ];
  return {
    schema: 'kaminos.track-m-authored-source-graph.v0',
    compilerId: 'track-m-source-projection-compiler-v0',
    status: 'completed',
    graphSha256: GRAPH_SHA,
    source: {
      requestedPath: '/operator/cat.blend',
      effectivePath: '/operator/cat.blend',
      sha256: ASSET_SHA,
      byteLength: 500,
    },
    scene: {
      name: 'Scene',
      frame: 0,
      unitSettings: { system: 'METRIC', lengthUnit: 'METERS', scaleLength: 1 },
    },
    blender: { version: '5.1.2' },
    muscles,
    sourceMeshes: [],
    semanticMarkers: [],
    missingSemanticRoles: ['attachment_patch', 'clearance_volume', 'joint_frame', 'support_target'],
  };
}

function extraction() {
  return {
    schema: 'kaminos.track-m-blender-extraction.v0',
    extractorId: 'blender-track-m-source-extract-v0',
    status: 'completed',
    source: {
      requestedPath: '/operator/cat.blend',
      effectivePath: '/operator/cat.blend',
      sha256: ASSET_SHA,
      byteLength: 500,
    },
    scene: {
      name: 'Scene',
      frame: 0,
      unitSettings: { system: 'METRIC', lengthUnit: 'METERS', scaleLength: 1 },
    },
    blender: { version: '5.1.2' },
    objects: [],
  };
}

function routingFixture(selected = ['route-a', 'route-b']) {
  return {
    schema: 'kaminos.track-m-source-routing-fixture.v0',
    fixtureSha256: ROUTING_SHA,
    source: {
      assetSha256: ASSET_SHA,
      graphSha256: GRAPH_SHA,
      graphFileSha256: GRAPH_FILE_SHA,
    },
    conditions: {
      correct: {
        routes: selected.map(constructionId => {
          const row = graph().muscles.find(candidate => candidate.identity.construction_id === constructionId);
          return {
            constructionId,
            lineageId: row.identity.lineage_id,
            instanceId: row.identity.instance_id,
            components: {
              surfaceInstanceId: row.components.surface.identity.instance_id,
              surfaceGeometrySha256: row.components.surface.geometry.contentSha256,
              pathInstanceId: row.components.path.identity.instance_id,
              pathGeometrySha256: row.components.path.geometry.contentSha256,
            },
            origin: {
              assignedHandleInstanceId: row.components.origin.identity.instance_id,
              sourceAuthority: 'source_mesh',
              point: [row.components.origin.matrixWorld[3], row.components.origin.matrixWorld[7], row.components.origin.matrixWorld[11]],
            },
            insertion: {
              assignedHandleInstanceId: row.components.insertion.identity.instance_id,
              sourceAuthority: 'source_mesh',
              point: [row.components.insertion.matrixWorld[3], row.components.insertion.matrixWorld[7], row.components.insertion.matrixWorld[11]],
            },
          };
        }),
      },
    },
  };
}

function build(options = {}) {
  return buildAuthoredMuscleCoordinateExport({
    extraction: extraction(),
    sourceGraph: graph(options),
    sourceGraphFileSha256: GRAPH_FILE_SHA,
    routingFixture: routingFixture(),
    routingFixtureFileSha256: ROUTING_SHA,
    requestedConstructionIds: ['route-a', 'route-b'],
  });
}

test('requested route ids are exact, ordered, and never fall back to M31/M47 or a stale prior request', () => {
  const result = buildAuthoredMuscleCoordinateExport({
    extraction: extraction(),
    sourceGraph: graph(),
    sourceGraphFileSha256: GRAPH_FILE_SHA,
    routingFixture: routingFixture(['route-c', 'route-a']),
    routingFixtureFileSha256: ROUTING_SHA,
    requestedConstructionIds: ['route-c', 'route-a'],
  });

  assert.equal(result.parentAtlas.schema, AUTHORED_MUSCLE_COORDINATE_PARENT_ATLAS_SCHEMA);
  assert.equal(result.authorityReceipt.schema, AUTHORED_MUSCLE_COORDINATE_AUTHORITY_RECEIPT_SCHEMA);
  assert.deepEqual(result.authorityReceipt.request.requestedConstructionIds, ['route-c', 'route-a']);
  assert.deepEqual(result.authorityReceipt.derivation.selectedConstructionIds, ['route-c', 'route-a']);
  assert.deepEqual(result.authorityReceipt.rows.map(row => row.constructionId), ['route-c', 'route-a']);
  assert.deepEqual(result.parentAtlas.routeInventory.map(row => row.constructionId), ['route-a', 'route-b', 'route-c']);
  assert.equal(result.authorityReceipt.rows.some(row => /31|47/.test(row.constructionId)), false);
});

test('receipt binding fails after any parent-atlas row changes, including an unselected row', () => {
  const result = build();
  const editedParent = structuredClone(result.parentAtlas);
  const unselected = editedParent.routeInventory.find(row => row.constructionId === 'route-c');
  unselected.state = 'excluded';
  unselected.reasons = ['post-hash mutation outside selected subset'];

  assert.throws(
    () => verifyAuthorityReceiptParentBinding(editedParent, result.authorityReceipt),
    /parent atlas.*sha-256|parent.*hash.*mismatch/i,
  );
});

test('disagreeing helper, curve, and surface candidates remain visible and block authority', () => {
  const result = build({ conflictId: 'route-a' });
  const row = result.authorityReceipt.rows[0];
  const origin = row.fields['attachments.origin.position'];

  assert.equal(row.state, 'conflict');
  assert.equal(origin.state, 'conflict');
  assert.deepEqual(origin.candidates.map(candidate => candidate.kind), [
    'helper-transform',
    'curve-endpoint',
    'visible-surface-endpoint',
    'routing-fixture-endpoint',
  ]);
  assert.deepEqual(origin.candidates.map(candidate => candidate.value), [
    [1, 0, 0],
    [2, 0, 0],
    [3, 0, 0],
    [1, 0, 0],
  ]);
  assert.equal(result.coordinateCarrier, null);
  assert.match(result.authorityReceipt.blockers.join('\n'), /unresolved.*origin.*conflict/i);
});

test('a matching routing endpoint without source_mesh authority remains a candidate', () => {
  const provisionalFixture = routingFixture();
  provisionalFixture.conditions.correct.routes[0].origin.sourceAuthority = 'provisional_muscle_surface';
  const result = buildAuthoredMuscleCoordinateExport({
    extraction: extraction(),
    sourceGraph: graph(),
    sourceGraphFileSha256: GRAPH_FILE_SHA,
    routingFixture: provisionalFixture,
    routingFixtureFileSha256: ROUTING_SHA,
    requestedConstructionIds: ['route-a', 'route-b'],
  });
  const origin = result.authorityReceipt.rows[0].fields['attachments.origin.position'];

  assert.equal(origin.state, 'candidate');
  assert.equal(origin.selected, null);
  assert.equal(origin.candidates.at(-1).authority, 'candidate');
  assert.match(result.authorityReceipt.blockers.join('\n'), /route-a.*origin.*candidate/i);
  assert.equal(result.coordinateCarrier, null);
});

test('an explicit fixture candidate ceiling outranks route-local source_mesh labels', () => {
  const candidateFixture = routingFixture();
  candidateFixture.authority = { geometryAuthority: 'candidate' };
  candidateFixture.selection = {
    authorityReceipt: {
      admitted: false,
      rows: ['route-a', 'route-b'].map(constructionId => ({
        constructionId,
        state: 'candidate',
        requiredFields: {
          'attachments.origin.position': 'candidate',
          'attachments.insertion.position': 'candidate',
          centerline: 'candidate',
          targetVolume: 'candidate',
          volumeAuthority: 'candidate',
        },
      })),
    },
  };
  const result = buildAuthoredMuscleCoordinateExport({
    extraction: extraction(),
    sourceGraph: graph(),
    sourceGraphFileSha256: GRAPH_FILE_SHA,
    routingFixture: candidateFixture,
    routingFixtureFileSha256: ROUTING_SHA,
    requestedConstructionIds: ['route-a', 'route-b'],
  });

  for (const row of result.authorityReceipt.rows) {
    assert.equal(row.state, 'candidate');
    assert.equal(row.fields['attachments.origin.position'].state, 'candidate');
    assert.equal(row.fields['attachments.origin.position'].selected, null);
    assert.equal(row.fields['attachments.insertion.position'].state, 'candidate');
    assert.equal(row.fields['attachments.insertion.position'].selected, null);
  }
  assert.equal(result.coordinateCarrier, null);
});

test('a routing endpoint assigned to the wrong helper remains an explicit identity conflict', () => {
  const staleFixture = routingFixture();
  staleFixture.conditions.correct.routes[0].origin.assignedHandleInstanceId = 'wrong-origin-handle';
  const result = buildAuthoredMuscleCoordinateExport({
    extraction: extraction(),
    sourceGraph: graph(),
    sourceGraphFileSha256: GRAPH_FILE_SHA,
    routingFixture: staleFixture,
    routingFixtureFileSha256: ROUTING_SHA,
    requestedConstructionIds: ['route-a', 'route-b'],
  });
  const origin = result.authorityReceipt.rows[0].fields['attachments.origin.position'];

  assert.equal(origin.state, 'conflict');
  assert.equal(origin.selected, null);
  assert.deepEqual(origin.candidates.at(-1).authorityConflict, {
    field: 'assignedHandleInstanceId',
    expected: 'origin-route-a',
    actual: 'wrong-origin-handle',
  });
  assert.match(result.authorityReceipt.blockers.join('\n'), /assignedHandleInstanceId.*origin-route-a.*wrong-origin-handle/i);
  assert.equal(result.coordinateCarrier, null);
});

test('candidate receipt is byte-identical on replay and keeps non-authoritative geometry out of the carrier', () => {
  const first = build();
  const second = build();

  assert.deepEqual(second, first);
  assert.match(first.parentAtlas.atlasSha256, /^[0-9a-f]{64}$/);
  assert.match(first.authorityReceipt.receiptSha256, /^[0-9a-f]{64}$/);
  assert.equal(first.coordinateCarrier, null);
  assert.equal(first.authorityReceipt.sharedFields['coordinateSpace.unit'].state, 'candidate');
  assert.equal(first.authorityReceipt.sharedFields.compartment.state, 'missing');
  assert.equal(first.authorityReceipt.sharedFields.obstacles.state, 'missing');
});

test('Packer consumes the candidate receipt as an explicit probe and refuses authority-incomplete rows', () => {
  const result = build();
  const probe = buildPackerAuthorityProbe(result.authorityReceipt);
  const packerFixture = routingFixture();
  packerFixture.selection = { id: 'synthetic-route-a-route-b' };
  const fixtureCore = structuredClone(packerFixture);
  delete fixtureCore.schema;
  delete fixtureCore.fixtureSha256;
  packerFixture.fixtureSha256 = hashForFixture(fixtureCore);
  const inputHash = 'e'.repeat(64);
  const receipt = admitAuthoredMusclePackingIntake({
    routingFixture: packerFixture,
    coordinateCarrier: probe,
    input: {
      routingFixture: {
        requested: { kind: 'routing-fixture', id: packerFixture.selection.id, sha256: inputHash },
        effective: { kind: 'routing-fixture', id: packerFixture.selection.id, sha256: inputHash },
      },
      coordinateCarrier: {
        requested: { kind: 'candidate-authority-probe', id: probe.id, sha256: inputHash },
        effective: { kind: 'candidate-authority-probe', id: probe.id, sha256: inputHash },
      },
    },
  });

  assert.equal(probe.diagnostic.notAnAdmittedCoordinateCarrier, true);
  assert.equal(receipt.status, 'authority-incomplete');
  assert.equal(receipt.admitted, false);
  assert.equal(receipt.packingSource, null);
  assert.match(receipt.reason, /route-a.*candidate.*not admitted/i);
});

test('CLI failure before sidecars preserves source identity, exact request, phase, and last evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'authored-coordinate-export-'));
  const extractionPath = join(root, 'extraction.json');
  const graphPath = join(root, 'graph.json');
  const fixturePath = join(root, 'routing.json');
  const outputRoot = join(root, 'outputs');
  const failurePath = join(root, 'failure.json');
  await Promise.all([
    writeFile(extractionPath, `${JSON.stringify(extraction(), null, 2)}\n`),
    writeFile(graphPath, `${JSON.stringify(graph(), null, 2)}\n`),
    writeFile(fixturePath, `${JSON.stringify(routingFixture(), null, 2)}\n`),
  ]);

  const result = spawnSync('node', [
    'tools/export-authored-muscle-coordinates.mjs',
    '--extraction', extractionPath,
    '--source-graph', graphPath,
    '--routing-fixture', fixturePath,
    '--requested-routes', 'route-a,route-missing',
    '--out-dir', outputRoot,
    '--failure', failurePath,
  ], { cwd: process.cwd(), encoding: 'utf8' });

  assert.notEqual(result.status, 0);
  const failure = JSON.parse(await readFile(failurePath, 'utf8'));
  assert.equal(failure.schema, AUTHORED_MUSCLE_COORDINATE_EXPORT_FAILURE_SCHEMA);
  assert.equal(failure.status, 'failed');
  assert.equal(failure.failurePhase, 'route-selection');
  assert.deepEqual(failure.requestedConstructionIds, ['route-a', 'route-missing']);
  assert.equal(failure.source.requestedPath, '/operator/cat.blend');
  assert.equal(failure.source.effectivePath, '/operator/cat.blend');
  assert.equal(failure.source.sha256, ASSET_SHA);
  assert.equal(failure.lastTrustworthyEvidence, 'source extraction and source graph identities verified');
  assert.match(failure.error, /route-missing.*not present/i);
  await assert.rejects(readFile(join(outputRoot, 'parent-atlas.json')), /ENOENT/);
  await assert.rejects(readFile(join(outputRoot, 'authority-receipt.json')), /ENOENT/);
});

test('successful CLI replay clears a stale failure report instead of presenting contradictory status', async () => {
  const root = await mkdtemp(join(tmpdir(), 'authored-coordinate-replay-'));
  const extractionPath = join(root, 'extraction.json');
  const graphPath = join(root, 'graph.json');
  const fixturePath = join(root, 'routing.json');
  const outputRoot = join(root, 'outputs');
  const failurePath = join(root, 'failure.json');
  await Promise.all([
    writeFile(extractionPath, `${JSON.stringify(extraction(), null, 2)}\n`),
    writeFile(graphPath, `${JSON.stringify(graph(), null, 2)}\n`),
    writeFile(fixturePath, `${JSON.stringify(routingFixture(), null, 2)}\n`),
    writeFile(failurePath, `${JSON.stringify({ status: 'failed', error: 'stale prior run' })}\n`),
  ]);

  const result = spawnSync('node', [
    'tools/export-authored-muscle-coordinates.mjs',
    '--extraction', extractionPath,
    '--source-graph', graphPath,
    '--routing-fixture', fixturePath,
    '--requested-routes', 'route-a,route-b',
    '--out-dir', outputRoot,
    '--failure', failurePath,
  ], { cwd: process.cwd(), encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  await assert.rejects(readFile(failurePath), /ENOENT/);
  const receipt = JSON.parse(await readFile(join(outputRoot, 'authority-receipt.json'), 'utf8'));
  assert.equal(receipt.status, 'authority-incomplete');
});
