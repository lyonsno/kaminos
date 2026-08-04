import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  TRACK_M_SELECTED_ROUTE_FIXTURE_COMPILER_ID,
  compileTrackMSelectedRouteFixture,
} from '../track-m-selected-route-fixture-core.mjs';
import { TRACK_M_ROUTING_FIXTURE_SCHEMA } from '../track-m-routing-fixture-core.mjs';

const SOURCE_SHA256 = 'a'.repeat(64);
const GRAPH_SHA256 = 'b'.repeat(64);
const CONSTRUCTION_IDS = Object.freeze([
  'muscle-34',
  'muscle-13',
  'muscle-12',
  'muscle-45',
]);
const REQUIRED_FIELDS = Object.freeze([
  'attachments.insertion.position',
  'attachments.origin.position',
  'centerline',
  'targetVolume',
  'volumeAuthority',
]);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

function hashJson(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function matrixAt(point) {
  return [1, 0, 0, point[0], 0, 1, 0, point[1], 0, 0, 1, point[2], 0, 0, 0, 1];
}

function route(index, constructionId) {
  const origin = [index + 1, index + 2, index + 3];
  const insertion = [index + 4, index + 6, index + 8];
  const lineageId = `lineage-${constructionId}`;
  const component = (role, point = [0, 0, 0]) => ({
    identity: {
      construction_id: `${constructionId}-${role}`,
      instance_id: `instance-${constructionId}-${role}`,
      lineage_id: lineageId,
      schema_version: '1',
      variant: 'parent',
    },
    matrixWorld: matrixAt(point),
  });
  return {
    name: `Muscle ${constructionId.split('-')[1]}`,
    identity: {
      construction_id: constructionId,
      instance_id: `instance-${constructionId}`,
      lineage_id: lineageId,
      schema_version: '1',
      variant: 'parent',
    },
    authoredCompleteness: 'wip_procedural',
    completenessAuthority: 'declared_components_present',
    endpointRoute: 'draw_muscle',
    endpointStrategy: 'surface_hits',
    settings: {
      insertion_tendon_fraction: 0.18,
      longitudinal_sections: 12,
      origin_tendon_fraction: 0.18,
      profile_sides: 12,
    },
    origin: {
      handleInstanceId: `instance-${constructionId}-origin`,
      sourceAuthority: 'source_mesh',
      sourceName: 'SRC_PELVIS',
    },
    insertion: {
      handleInstanceId: `instance-${constructionId}-insertion`,
      sourceAuthority: 'source_mesh',
      sourceName: 'SRC_FEMUR',
    },
    components: {
      origin: component('origin', origin),
      insertion: component('insertion', insertion),
      path: {
        ...component('path'),
        geometry: {
          contentSha256: String(index + 1).repeat(64),
          pointCount: 25,
          splineCount: 1,
        },
      },
      surface: {
        ...component('surface'),
        geometry: {
          contentSha256: String(index + 5).repeat(64),
          vertexCount: 300,
          edgeCount: 588,
          polygonCount: 290,
        },
      },
    },
    missingComponentRoles: [],
  };
}

function sourceGraph() {
  return {
    schema: 'kaminos.track-m-authored-source-graph.v0',
    compilerId: 'track-m-source-projection-compiler-v0',
    status: 'compiled',
    trackId: 'shape-bearing-musculature',
    graphSha256: GRAPH_SHA256,
    source: {
      requestedPath: '/source/cat.blend',
      effectivePath: '/source/cat.blend',
      sha256: SOURCE_SHA256,
      byteLength: 42,
    },
    muscles: CONSTRUCTION_IDS.map((id, index) => route(index, id)),
  };
}

function candidate(value, locator) {
  return {
    candidates: [{ authority: 'candidate', evidenceLocators: [locator], kind: 'measurement', method: 'test', value }],
    reason: 'mechanically measured agreement is not an authority source',
    selected: null,
    state: 'candidate',
  };
}

function authorityReceipt(graph, graphFileSha256) {
  const rows = CONSTRUCTION_IDS.map(constructionId => {
    const muscle = graph.muscles.find(item => item.identity.construction_id === constructionId);
    const origin = [muscle.components.origin.matrixWorld[3], muscle.components.origin.matrixWorld[7], muscle.components.origin.matrixWorld[11]];
    const insertion = [muscle.components.insertion.matrixWorld[3], muscle.components.insertion.matrixWorld[7], muscle.components.insertion.matrixWorld[11]];
    return {
      constructionId,
      name: muscle.name,
      lineageId: muscle.identity.lineage_id,
      instanceId: muscle.identity.instance_id,
      state: 'candidate',
      selectedConstructionIds: Object.values(muscle.components).map(component => component.identity.construction_id),
      selectedComponentInstanceIds: Object.values(muscle.components).map(component => component.identity.instance_id),
      sourceAuthorities: { insertion: 'source_mesh', origin: 'source_mesh' },
      attachments: {
        insertion: { id: muscle.insertion.handleInstanceId, sourceAuthority: 'source_mesh' },
        origin: { id: muscle.origin.handleInstanceId, sourceAuthority: 'source_mesh' },
      },
      components: {
        pathGeometrySha256: muscle.components.path.geometry.contentSha256,
        pathInstanceId: muscle.components.path.identity.instance_id,
        surfaceGeometrySha256: muscle.components.surface.geometry.contentSha256,
        surfaceInstanceId: muscle.components.surface.identity.instance_id,
      },
      fields: {
        'attachments.insertion.position': candidate(insertion, `sourceGraph.${constructionId}.insertion`),
        'attachments.origin.position': candidate(origin, `sourceGraph.${constructionId}.origin`),
        centerline: candidate({ sourcePathSha256: muscle.components.path.geometry.contentSha256 }, `sourceGraph.${constructionId}.path`),
        targetVolume: candidate(10, `sourceGraph.${constructionId}.surface.volume`),
        volumeAuthority: candidate('source-visible-surface-measured-candidate', `sourceGraph.${constructionId}.surface`),
      },
      reasons: [],
    };
  });
  const packingSelectionAuthority = {
    rows: rows.map(row => ({
      constructionId: row.constructionId,
      requiredFields: Object.fromEntries(REQUIRED_FIELDS.map(field => [field, 'candidate'])),
      state: 'candidate',
    })),
    sharedFields: {
      compartment: 'missing',
      'coordinateSpace.unit': 'candidate',
      obstacles: 'missing',
    },
  };
  const core = {
    schema: 'kaminos.authored-muscle-coordinate-authority-receipt.v0',
    id: 'coordinate-authority-receipt-k4',
    status: 'authority-incomplete',
    admitted: false,
    source: {
      assetSha256: SOURCE_SHA256,
      graphSha256: GRAPH_SHA256,
      graphFileSha256,
      routingFixtureSha256: 'c'.repeat(64),
    },
    request: {
      requestedConstructionIds: [...CONSTRUCTION_IDS],
      effectiveConstructionIds: [...CONSTRUCTION_IDS],
    },
    packingSelectionAuthority,
    sharedFields: {
      compartment: { candidates: [], selected: null, state: 'missing' },
      'coordinateSpace.unit': { candidates: [], selected: null, state: 'candidate' },
      obstacles: { candidates: [], selected: null, state: 'missing' },
    },
    rows,
    blockers: ['candidate authority intentionally held'],
    bindingConflicts: [],
    derivation: {},
  };
  return { receiptSha256: hashJson(core), ...core };
}

function encode(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function compile({ mutateGraph, mutateReceipt, expectedOrder = CONSTRUCTION_IDS, preserveReceiptHash = false } = {}) {
  const graph = sourceGraph();
  mutateGraph?.(graph);
  const graphBytes = encode(graph);
  const graphFileSha256 = createHash('sha256').update(graphBytes).digest('hex');
  const receipt = authorityReceipt(graph, graphFileSha256);
  mutateReceipt?.(receipt);
  if (mutateReceipt && !preserveReceiptHash) {
    const { receiptSha256: ignored, ...core } = receipt;
    receipt.receiptSha256 = hashJson(core);
  }
  const receiptBytes = encode(receipt);
  return compileTrackMSelectedRouteFixture(graphBytes, receiptBytes, {
    expectedConstructionIds: [...expectedOrder],
    expectedSourceSha256: SOURCE_SHA256,
    expectedGraphSha256: GRAPH_SHA256,
    expectedGraphFileSha256: graphFileSha256,
    expectedReceiptFileSha256: createHash('sha256').update(receiptBytes).digest('hex'),
  });
}

test('compiles exact ordered K4 current-graph routes without promoting candidate authority', () => {
  const fixture = compile();
  assert.equal(fixture.schema, TRACK_M_ROUTING_FIXTURE_SCHEMA);
  assert.equal(fixture.compilerId, TRACK_M_SELECTED_ROUTE_FIXTURE_COMPILER_ID);
  assert.deepEqual(fixture.selection.constructionIds, CONSTRUCTION_IDS);
  assert.deepEqual(fixture.conditions.correct.routes.map(route => route.constructionId), CONSTRUCTION_IDS);
  assert.equal(fixture.selection.authorityReceipt.status, 'authority-incomplete');
  assert.equal(fixture.selection.authorityReceipt.admitted, false);
  assert.ok(fixture.selection.authorityReceipt.rows.every(row => row.state === 'candidate'));
  assert.ok(fixture.selection.authorityReceipt.rows.every(row => Object.values(row.requiredFields).every(state => state === 'candidate')));
  assert.equal(fixture.authority.geometryAuthority, 'candidate');
  assert.deepEqual(fixture.authority.admittedClaims, ['current-graph-selected-route-identity-fixture']);
  assert.ok(fixture.authority.heldClaims.includes('packing-geometry-admission'));
  assert.match(fixture.fixtureSha256, /^[0-9a-f]{64}$/);
});

test('preserves construction, lineage, instance, handle, path, surface, and point identities', () => {
  const fixture = compile();
  const graph = sourceGraph();
  for (const output of fixture.conditions.correct.routes) {
    const source = graph.muscles.find(item => item.identity.construction_id === output.constructionId);
    assert.equal(output.lineageId, source.identity.lineage_id);
    assert.equal(output.instanceId, source.identity.instance_id);
    assert.equal(output.origin.assignedHandleInstanceId, source.origin.handleInstanceId);
    assert.equal(output.insertion.assignedHandleInstanceId, source.insertion.handleInstanceId);
    assert.equal(output.components.pathInstanceId, source.components.path.identity.instance_id);
    assert.equal(output.components.pathGeometrySha256, source.components.path.geometry.contentSha256);
    assert.equal(output.components.surfaceInstanceId, source.components.surface.identity.instance_id);
    assert.equal(output.components.surfaceGeometrySha256, source.components.surface.geometry.contentSha256);
    assert.deepEqual(output.origin.point, [source.components.origin.matrixWorld[3], source.components.origin.matrixWorld[7], source.components.origin.matrixWorld[11]]);
    assert.deepEqual(output.insertion.point, [source.components.insertion.matrixWorld[3], source.components.insertion.matrixWorld[7], source.components.insertion.matrixWorld[11]]);
  }
});

test('rejects reordered selection and any attempted candidate-authority promotion', () => {
  assert.throws(
    () => compile({ mutateReceipt: receipt => receipt.request.effectiveConstructionIds.reverse() }),
    /effective construction order/i,
  );
  assert.throws(
    () => compile({ mutateReceipt: receipt => { receipt.rows[0].state = 'admitted'; } }),
    /muscle-34.*candidate/i,
  );
  assert.throws(
    () => compile({ mutateReceipt: receipt => { receipt.packingSelectionAuthority.rows[0].requiredFields.centerline = 'admitted'; } }),
    /muscle-34.*centerline.*candidate/i,
  );
});

test('rejects stale graph identity, altered component identity, and receipt tampering', () => {
  assert.throws(
    () => compile({ mutateGraph: graph => { graph.graphSha256 = 'f'.repeat(64); } }),
    /graph identity.*mismatch/i,
  );
  assert.throws(
    () => compile({ mutateReceipt: receipt => { receipt.rows[0].components.pathGeometrySha256 = 'e'.repeat(64); } }),
    /muscle-34.*path geometry/i,
  );
  assert.throws(
    () => compile({ mutateReceipt: receipt => { receipt.rows[0].attachments.origin.id = 'wrong-handle'; } }),
    /muscle-34.*origin handle/i,
  );
  assert.throws(
    () => compile({ mutateReceipt: receipt => { receipt.receiptSha256 = 'd'.repeat(64); }, preserveReceiptHash: true }),
    /receipt internal identity/i,
  );
});

async function writeCliInputs(root) {
  const graph = sourceGraph();
  const graphBytes = encode(graph);
  const graphFileSha256 = createHash('sha256').update(graphBytes).digest('hex');
  const receipt = authorityReceipt(graph, graphFileSha256);
  const receiptBytes = encode(receipt);
  const receiptFileSha256 = createHash('sha256').update(receiptBytes).digest('hex');
  const graphPath = join(root, 'source-graph.json');
  const receiptPath = join(root, 'authority-receipt.json');
  await writeFile(graphPath, graphBytes);
  await writeFile(receiptPath, receiptBytes);
  return { graphPath, receiptPath, graphFileSha256, receiptFileSha256 };
}

function cliArgs(inputs, outputPath, reportPath, overrides = {}) {
  const graphFileSha256 = overrides.graphFileSha256 ?? inputs.graphFileSha256;
  return [
    'tools/compile-track-m-selected-route-fixture.mjs',
    '--graph', inputs.graphPath,
    '--receipt', inputs.receiptPath,
    '--output', outputPath,
    '--report', reportPath,
    '--expected-source-sha256', SOURCE_SHA256,
    '--expected-graph-sha256', GRAPH_SHA256,
    '--expected-graph-file-sha256', graphFileSha256,
    '--expected-receipt-file-sha256', inputs.receiptFileSha256,
    ...CONSTRUCTION_IDS.flatMap(id => ['--construction-id', id]),
  ];
}

test('CLI records effective identities and writes the authenticated fixture', async () => {
  const root = await mkdtemp(join(tmpdir(), 'track-m-selected-route-success-'));
  const inputs = await writeCliInputs(root);
  const outputPath = join(root, 'fixture.json');
  const reportPath = join(root, 'report.json');
  const result = spawnSync(process.execPath, cliArgs(inputs, outputPath, reportPath), { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const fixture = JSON.parse(await readFile(outputPath, 'utf8'));
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  assert.deepEqual(fixture.selection.constructionIds, CONSTRUCTION_IDS);
  assert.equal(report.status, 'compiled');
  assert.equal(report.effective.graphFileSha256, inputs.graphFileSha256);
  assert.equal(report.effective.receiptFileSha256, inputs.receiptFileSha256);
  assert.equal(report.output.fixtureSha256, fixture.fixtureSha256);
});

test('CLI failure before fixture output still leaves a phase-specific durable report', async () => {
  const root = await mkdtemp(join(tmpdir(), 'track-m-selected-route-failure-'));
  const inputs = await writeCliInputs(root);
  const outputPath = join(root, 'fixture.json');
  const reportPath = join(root, 'report.json');
  await writeFile(outputPath, '{"stale":true}\n');
  const result = spawnSync(
    process.execPath,
    cliArgs(inputs, outputPath, reportPath, { graphFileSha256: 'f'.repeat(64) }),
    { cwd: process.cwd(), encoding: 'utf8' },
  );
  assert.notEqual(result.status, 0);
  await assert.rejects(access(outputPath), /ENOENT/);
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  assert.equal(report.status, 'failed');
  assert.equal(report.failure.phase, 'compile');
  assert.match(report.failure.message, /graph file SHA-256.*mismatch/i);
  assert.equal(report.requested.graphPath, inputs.graphPath);
  assert.equal(report.lastTrustworthyEvidence.graphPath, await realpath(inputs.graphPath));
  assert.equal(report.requested.expectedGraphFileSha256, 'f'.repeat(64));
});

test('CLI rejects primary output aliases without overwriting authenticated inputs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'track-m-selected-route-output-alias-'));
  const inputs = await writeCliInputs(root);
  const graphBefore = await readFile(inputs.graphPath);
  const reportPath = join(root, 'report.json');
  const result = spawnSync(process.execPath, cliArgs(inputs, inputs.graphPath, reportPath), {
    cwd: process.cwd(), encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.deepEqual(await readFile(inputs.graphPath), graphBefore);
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  assert.equal(report.status, 'failed');
  assert.match(report.failure.message, /primary output path.*alias.*input/i);
});

test('CLI redirects report aliases without overwriting authenticated inputs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'track-m-selected-route-report-alias-'));
  const inputs = await writeCliInputs(root);
  const receiptBefore = await readFile(inputs.receiptPath);
  const outputPath = join(root, 'fixture.json');
  const sidecarPath = `${inputs.receiptPath}.track-m-selected-route-fixture-failure.json`;
  const result = spawnSync(process.execPath, cliArgs(inputs, outputPath, inputs.receiptPath), {
    cwd: process.cwd(), encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.deepEqual(await readFile(inputs.receiptPath), receiptBefore);
  await assert.rejects(access(outputPath), /ENOENT/);
  const report = JSON.parse(await readFile(sidecarPath, 'utf8'));
  assert.equal(report.status, 'failed');
  assert.match(report.failure.message, /report path.*alias.*input/i);
});

test('CLI rejects output and report collision without publishing false success', async () => {
  const root = await mkdtemp(join(tmpdir(), 'track-m-selected-route-destination-collision-'));
  const inputs = await writeCliInputs(root);
  const sharedPath = join(root, 'fixture-and-report.json');
  const sidecarPath = `${sharedPath}.track-m-selected-route-fixture-failure.json`;
  await writeFile(sharedPath, '{"status":"stale"}\n');
  const result = spawnSync(process.execPath, cliArgs(inputs, sharedPath, sharedPath), {
    cwd: process.cwd(), encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  await assert.rejects(access(sharedPath), /ENOENT/);
  const report = JSON.parse(await readFile(sidecarPath, 'utf8'));
  assert.equal(report.status, 'failed');
  assert.match(report.failure.message, /output and report paths must be distinct/i);
});

test('CLI protects symlink-resolved inputs and preserves a noncolliding failure sidecar', async () => {
  const root = await mkdtemp(join(tmpdir(), 'track-m-selected-route-symlink-alias-'));
  const inputs = await writeCliInputs(root);
  const graphAliasPath = join(root, 'graph-alias.json');
  await symlink(inputs.graphPath, graphAliasPath);
  const graphBefore = await readFile(inputs.graphPath);
  const reportPath = join(root, 'report.json');
  const result = spawnSync(process.execPath, cliArgs(inputs, graphAliasPath, reportPath), {
    cwd: process.cwd(), encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.deepEqual(await readFile(inputs.graphPath), graphBefore);
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  assert.equal(report.status, 'failed');
  assert.match(report.failure.message, /primary output path.*alias.*input/i);
});

test('CLI rejects absent output and report leaves below symlink-equivalent parents', async () => {
  const root = await mkdtemp(join(tmpdir(), 'track-m-selected-route-parent-alias-'));
  const inputs = await writeCliInputs(root);
  const realDirectory = join(root, 'real');
  const aliasDirectory = join(root, 'alias');
  await mkdir(realDirectory);
  await symlink(realDirectory, aliasDirectory, 'dir');
  const outputPath = join(realDirectory, 'fixture.json');
  const reportPath = join(aliasDirectory, 'fixture.json');
  const sidecarPath = `${reportPath}.track-m-selected-route-fixture-failure.json`;
  const result = spawnSync(process.execPath, cliArgs(inputs, outputPath, reportPath), {
    cwd: process.cwd(), encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  await assert.rejects(access(outputPath), /ENOENT/);
  const report = JSON.parse(await readFile(sidecarPath, 'utf8'));
  assert.equal(report.status, 'failed');
  assert.match(report.failure.message, /output and report paths must be distinct/i);
});
