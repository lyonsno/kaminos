import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { createPng } from './png-fixture.mjs';

import {
  TRACK_M_CONDITION_IDS,
  TRACK_M_FAILURE_SCHEMA,
  TRACK_M_PLAN_SCHEMA,
  TRACK_M_POINTER_SCHEMA,
  TRACK_M_REPORT_SCHEMA,
  TRACK_M_ROUTE_RECEIPT_SCHEMA,
  TRACK_M_SOURCE_SCHEMA,
  buildTrackMEvidencePlan,
  hashBytes,
  validateTrackMEvidenceOutcome,
} from '../track-m-evidence-bundle-core.mjs';

const H = {
  asset: '0'.repeat(64),
  pose: '1'.repeat(64),
  camera: '2'.repeat(64),
  material: '3'.repeat(64),
  illumination: '4'.repeat(64),
  render: '5'.repeat(64),
  content: '6'.repeat(64),
  endpoints: '7'.repeat(64),
  expectedRoute: '8'.repeat(64),
  wrongRoute: '9'.repeat(64),
  absentTransform: 'a'.repeat(64),
  correctTransform: 'b'.repeat(64),
  wrongTransform: 'c'.repeat(64),
  permutation: 'd'.repeat(64),
};

const budget = {
  primitiveCount: 12,
  vertexCount: 480,
  triangleCount: 912,
  parameterCount: 36,
};

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map(key => [key, canonical(value[key])]),
    );
  }
  return value;
}

function rehashPlan(plan) {
  const { schema: _schema, id: _id, bundleOutputIdentity: _bundle, ...planCore } = plan;
  plan.id = hashBytes(Buffer.from(JSON.stringify(canonical(planCore))));
  plan.bundleOutputIdentity = hashBytes(Buffer.from(JSON.stringify(canonical({
    planId: plan.id,
    conditionOutputs: plan.conditions.map(item => item.outputIdentity),
  }))));
}

function source() {
  return {
    schema: TRACK_M_SOURCE_SCHEMA,
    trackId: 'shape-bearing-musculature',
    receiptId: 'operator-musculature-source-receipt-v0',
    asset: { id: 'operator-musculature-source-v0', path: '/caller/source.blend', sha256: H.asset },
    pose: { id: 'conservative-pose-v0', kind: 'conservative', authorityId: 'external-pose-authority', sha256: H.pose },
    camera: { id: 'track-m-fixed-camera-v0', projection: 'orthographic', width: 640, height: 640, sha256: H.camera },
    material: { id: 'track-m-clay-v0', sha256: H.material },
    illumination: { id: 'track-m-light-v0', sha256: H.illumination },
    renderConfig: { id: 'track-m-render-v0', width: 640, height: 640, sha256: H.render },
    route: {
      requestedRouteId: 'cpu-shape-bearing-oracle-route',
      executionClass: 'cpu',
      requiresGpu: false,
      adapterContractSha256: 'e'.repeat(64),
    },
    productContract: [
      { kind: 'clay', mimeType: 'image/png' },
      { kind: 'depth', mimeType: 'image/png' },
      { kind: 'normal', mimeType: 'image/png' },
    ],
    testedRelation: {
      id: 'deep-flexor-routing-v0',
      deepGeometryIds: ['deep-flexor-a', 'deep-flexor-b'],
      deepGeometryContentSetSha256: H.content,
      attachmentEndpointMultisetSha256: H.endpoints,
      expectedRoutingGraphSha256: H.expectedRoute,
      representationalBudget: { ...budget },
    },
    conditions: {
      'deep-geometry-absent': {
        transform: { id: 'remove-deep-geometry-v0', kind: 'remove-deep-geometry', sha256: H.absentTransform },
        deepGeometryPresent: false,
        testedRelationPresent: false,
        removedGeometryIds: ['deep-flexor-a', 'deep-flexor-b'],
      },
      'deep-geometry-correctly-routed': {
        transform: { id: 'correct-routing-v0', kind: 'preserve-correct-routing', sha256: H.correctTransform },
        deepGeometryPresent: true,
        testedRelationPresent: true,
        deepGeometryContentSetSha256: H.content,
        attachmentEndpointMultisetSha256: H.endpoints,
        routingGraphSha256: H.expectedRoute,
        representationalBudget: { ...budget },
      },
      'deep-geometry-matched-wrong-routing': {
        transform: { id: 'wrong-routing-v0', kind: 'matched-wrong-routing', sha256: H.wrongTransform },
        deepGeometryPresent: true,
        testedRelationPresent: false,
        destroyedRelationId: 'deep-flexor-routing-v0',
        deepGeometryContentSetSha256: H.content,
        attachmentEndpointMultisetSha256: H.endpoints,
        routingGraphSha256: H.wrongRoute,
        routingPermutationSha256: H.permutation,
        representationalBudget: { ...budget },
      },
    },
  };
}

test('plan freezes one source into the exact three Track M conditions', () => {
  const plan = buildTrackMEvidencePlan(source());
  assert.equal(plan.schema, TRACK_M_PLAN_SCHEMA);
  assert.deepEqual(plan.conditions.map(condition => condition.id), TRACK_M_CONDITION_IDS);
  assert.equal(new Set(plan.conditions.map(condition => condition.sourceIdentitySha256)).size, 1);
  assert.equal(new Set(plan.conditions.map(condition => condition.poseSha256)).size, 1);
  assert.equal(new Set(plan.conditions.map(condition => condition.cameraSha256)).size, 1);
  assert.equal(new Set(plan.conditions.map(condition => condition.materialSha256)).size, 1);
  assert.equal(new Set(plan.conditions.map(condition => condition.illuminationSha256)).size, 1);
  assert.equal(new Set(plan.conditions.map(condition => condition.renderConfigSha256)).size, 1);
  assert.equal(new Set(plan.conditions.map(condition => condition.outputDimensions.join('x'))).size, 1);
  assert.equal(new Set(plan.conditions.map(condition => condition.outputIdentity)).size, 3);
});

test('wrong routing preserves representation while destroying only the tested relation', () => {
  const plan = buildTrackMEvidencePlan(source());
  const correct = plan.conditions.find(condition => condition.id === 'deep-geometry-correctly-routed');
  const wrong = plan.conditions.find(condition => condition.id === 'deep-geometry-matched-wrong-routing');
  assert.deepEqual(wrong.representationalBudget, correct.representationalBudget);
  assert.equal(wrong.deepGeometryContentSetSha256, correct.deepGeometryContentSetSha256);
  assert.equal(wrong.attachmentEndpointMultisetSha256, correct.attachmentEndpointMultisetSha256);
  assert.notEqual(wrong.routingGraphSha256, correct.routingGraphSha256);
  assert.equal(wrong.destroyedRelationId, plan.testedRelationId);
  assert.equal(wrong.testedRelationPresent, false);
});

test('plan rejects counterfeit wrong-routing comparison classes', () => {
  const missingGeometry = source();
  missingGeometry.conditions['deep-geometry-matched-wrong-routing'].deepGeometryPresent = false;
  assert.throws(() => buildTrackMEvidencePlan(missingGeometry), /wrong-routing.*deep geometry/i);

  const budgetDrift = source();
  budgetDrift.conditions['deep-geometry-matched-wrong-routing'].representationalBudget.vertexCount += 1;
  assert.throws(() => buildTrackMEvidencePlan(budgetDrift), /representational budget/i);

  const routeSurvives = source();
  routeSurvives.conditions['deep-geometry-matched-wrong-routing'].routingGraphSha256 = H.expectedRoute;
  assert.throws(() => buildTrackMEvidencePlan(routeSurvives), /destroy.*routing relation/i);

  const endpointDrift = source();
  endpointDrift.conditions['deep-geometry-matched-wrong-routing'].attachmentEndpointMultisetSha256 = 'e'.repeat(64);
  assert.throws(() => buildTrackMEvidencePlan(endpointDrift), /endpoint multiset/i);
});

test('plan rejects Track R semantics and cross-condition identity drift', () => {
  const relational = source();
  relational.trackId = 'generator-relational-sensitivity';
  assert.throws(() => buildTrackMEvidencePlan(relational), /shape-bearing-musculature/);

  const cameraDrift = source();
  cameraDrift.conditions['deep-geometry-absent'].cameraSha256 = 'f'.repeat(64);
  assert.throws(() => buildTrackMEvidencePlan(cameraDrift), /condition.*camera/i);

  const baggage = source();
  baggage.variants = { parent: {}, positive: {}, negative: {} };
  assert.throws(() => buildTrackMEvidencePlan(baggage), /field set|unexpected/i);
});

test('plan rejects a GPU-capable or unauthenticated execution route', () => {
  const gpu = source();
  gpu.route.executionClass = 'gpu';
  gpu.route.requiresGpu = true;
  assert.throws(() => buildTrackMEvidencePlan(gpu), /CPU|GPU/i);

  const unauthenticated = source();
  delete unauthenticated.route.adapterContractSha256;
  assert.throws(() => buildTrackMEvidencePlan(unauthenticated), /adapter.*hash|field set/i);
});

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function publishedFixture({ publicationId = 'track-m-publication-v0' } = {}) {
  const plan = buildTrackMEvidencePlan(source());
  const root = await mkdtemp(join(tmpdir(), 'track-m-evidence-'));
  const versionDir = join(root, 'versions', publicationId);
  await mkdir(versionDir, { recursive: true });
  const conditions = [];
  for (const condition of plan.conditions) {
    const products = [];
    for (const contract of plan.productContract) {
      const relativePath = `products/${condition.id}/${contract.kind}.png`;
      const bytes = createPng(plan.outputDimensions[0], plan.outputDimensions[1], 41 + products.length);
      const path = join(versionDir, relativePath);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, bytes);
      products.push({
        ...contract,
        width: plan.outputDimensions[0],
        height: plan.outputDimensions[1],
        relativePath,
        byteLength: bytes.length,
        sha256: hashBytes(bytes),
      });
    }
    const routeReceipt = {
      schema: TRACK_M_ROUTE_RECEIPT_SCHEMA,
      status: 'completed',
      trackId: plan.trackId,
      planId: plan.id,
      sourceReceiptId: plan.sourceReceiptId,
      conditionId: condition.id,
      outputIdentity: condition.outputIdentity,
      requestedRouteId: plan.requestedRouteId,
      effectiveRouteId: plan.requestedRouteId,
      executionClass: 'cpu',
      requiresGpu: false,
      adapterContractSha256: plan.adapterContractSha256,
      backendIdentity: { id: 'cpu-test-renderer-v0', sha256: 'f'.repeat(64) },
      products,
    };
    const routeReceiptPath = `route-receipts/${condition.id}.json`;
    const absoluteRouteReceiptPath = join(versionDir, routeReceiptPath);
    await writeJson(absoluteRouteReceiptPath, routeReceipt);
    const routeReceiptBytes = await readFile(absoluteRouteReceiptPath);
    conditions.push({
      id: condition.id,
      outputIdentity: condition.outputIdentity,
      conditionTransformSha256: condition.conditionTransformSha256,
      requestedRouteId: plan.requestedRouteId,
      effectiveRouteId: plan.requestedRouteId,
      routeReceiptPath,
      routeReceiptSha256: hashBytes(routeReceiptBytes),
      products,
    });
  }
  const report = {
    schema: TRACK_M_REPORT_SCHEMA,
    compilerId: plan.compilerId,
    status: 'completed',
    trackId: plan.trackId,
    planId: plan.id,
    sourceReceiptId: plan.sourceReceiptId,
    assetId: plan.asset.id,
    publicationId,
    requestedRouteId: plan.requestedRouteId,
    conditions,
  };
  const reportPath = join(versionDir, 'evidence-report.json');
  await writeJson(reportPath, report);
  const reportBytes = await readFile(reportPath);
  const pointer = {
    schema: TRACK_M_POINTER_SCHEMA,
    status: 'published',
    publicationId,
    relativeVersionPath: `versions/${publicationId}`,
    reportPath: `versions/${publicationId}/evidence-report.json`,
    reportSha256: hashBytes(reportBytes),
    planId: plan.id,
    sourceReceiptId: plan.sourceReceiptId,
    requestedRouteId: plan.requestedRouteId,
  };
  const pointerPath = join(root, 'current.json');
  await writeJson(pointerPath, pointer);
  return { plan, root, reportPath, pointerPath };
}

test('outcome admission authenticates report, pointer, route, and product bytes', async () => {
  const fixture = await publishedFixture();
  const accepted = await validateTrackMEvidenceOutcome({
    plan: fixture.plan,
    reportPath: fixture.reportPath,
    publicationPointerPath: fixture.pointerPath,
  });
  assert.equal(accepted.ok, true, JSON.stringify(accepted.failures));
  assert.equal(accepted.status, 'published-outcome-validated');

  const report = JSON.parse(await readFile(fixture.reportPath, 'utf8'));
  const product = report.conditions[0].products[0];
  await writeFile(join(dirname(fixture.reportPath), product.relativePath), 'tampered');
  const tampered = await validateTrackMEvidenceOutcome({
    plan: fixture.plan,
    reportPath: fixture.reportPath,
    publicationPointerPath: fixture.pointerPath,
  });
  assert.equal(tampered.ok, false);
  assert.match(JSON.stringify(tampered.failures), /product.*hash|byte.*length/i);
});

test('outcome admission rejects hash-authenticated bytes that lie about image/png', async () => {
  const fixture = await publishedFixture();
  const report = JSON.parse(await readFile(fixture.reportPath, 'utf8'));
  const product = report.conditions[0].products[0];
  const falsePng = Buffer.from('not a PNG despite a self-consistent receipt');
  await writeFile(join(dirname(fixture.reportPath), product.relativePath), falsePng);
  product.byteLength = falsePng.length;
  product.sha256 = hashBytes(falsePng);
  await writeJson(fixture.reportPath, report);
  const reportBytes = await readFile(fixture.reportPath);
  const pointer = JSON.parse(await readFile(fixture.pointerPath, 'utf8'));
  pointer.reportSha256 = hashBytes(reportBytes);
  await writeJson(fixture.pointerPath, pointer);

  const rejected = await validateTrackMEvidenceOutcome({
    plan: fixture.plan,
    reportPath: fixture.reportPath,
    publicationPointerPath: fixture.pointerPath,
  });
  assert.equal(rejected.ok, false);
  assert.match(JSON.stringify(rejected.failures), /PNG/i);
});

test('outcome admission rejects an effective route fallback with otherwise valid products', async () => {
  const fixture = await publishedFixture();
  const report = JSON.parse(await readFile(fixture.reportPath, 'utf8'));
  report.conditions[1].effectiveRouteId = 'silent-fallback-route';
  await writeJson(fixture.reportPath, report);
  const reportBytes = await readFile(fixture.reportPath);
  const pointer = JSON.parse(await readFile(fixture.pointerPath, 'utf8'));
  pointer.reportSha256 = hashBytes(reportBytes);
  await writeJson(fixture.pointerPath, pointer);

  const rejected = await validateTrackMEvidenceOutcome({
    plan: fixture.plan,
    reportPath: fixture.reportPath,
    publicationPointerPath: fixture.pointerPath,
  });
  assert.equal(rejected.ok, false);
  assert.match(JSON.stringify(rejected.failures), /route-mismatch/);
});

test('outcome admission rejects a forged route label contradicted by its route receipt', async () => {
  const fixture = await publishedFixture();
  const report = JSON.parse(await readFile(fixture.reportPath, 'utf8'));
  const condition = report.conditions[0];
  const receiptPath = join(dirname(fixture.reportPath), condition.routeReceiptPath);
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  receipt.effectiveRouteId = 'silent-fallback-route';
  await writeJson(receiptPath, receipt);
  condition.routeReceiptSha256 = hashBytes(await readFile(receiptPath));
  await writeJson(fixture.reportPath, report);
  const pointer = JSON.parse(await readFile(fixture.pointerPath, 'utf8'));
  pointer.reportSha256 = hashBytes(await readFile(fixture.reportPath));
  await writeJson(fixture.pointerPath, pointer);

  const rejected = await validateTrackMEvidenceOutcome({
    plan: fixture.plan,
    reportPath: fixture.reportPath,
    publicationPointerPath: fixture.pointerPath,
  });
  assert.equal(rejected.ok, false);
  assert.match(JSON.stringify(rejected.failures), /route.*receipt|effective.*route/i);
});

test('outcome admission requires a safe immutable publication segment', async () => {
  const fixture = await publishedFixture({ publicationId: '../escaped-publication' });
  const rejected = await validateTrackMEvidenceOutcome({
    plan: fixture.plan,
    reportPath: fixture.reportPath,
    publicationPointerPath: fixture.pointerPath,
  });
  assert.equal(rejected.ok, false);
  assert.match(JSON.stringify(rejected.failures), /publication.*id|safe.*segment/i);
});

test('outcome admission rejects Track R baggage and symlinked product custody', async () => {
  const baggageFixture = await publishedFixture();
  const baggageReport = JSON.parse(await readFile(baggageFixture.reportPath, 'utf8'));
  baggageReport.variants = { parent: {}, positive: {}, negative: {} };
  await writeJson(baggageFixture.reportPath, baggageReport);
  const baggagePointer = JSON.parse(await readFile(baggageFixture.pointerPath, 'utf8'));
  baggagePointer.reportSha256 = hashBytes(await readFile(baggageFixture.reportPath));
  await writeJson(baggageFixture.pointerPath, baggagePointer);
  const baggage = await validateTrackMEvidenceOutcome({
    plan: baggageFixture.plan,
    reportPath: baggageFixture.reportPath,
    publicationPointerPath: baggageFixture.pointerPath,
  });
  assert.equal(baggage.ok, false);
  assert.match(JSON.stringify(baggage.failures), /field set|unexpected/i);

  const linkFixture = await publishedFixture();
  const linkReport = JSON.parse(await readFile(linkFixture.reportPath, 'utf8'));
  const product = linkReport.conditions[0].products[0];
  const productPath = join(dirname(linkFixture.reportPath), product.relativePath);
  const outsidePath = join(linkFixture.root, 'mutable-outside.png');
  await writeFile(outsidePath, await readFile(productPath));
  await rm(productPath);
  await symlink(outsidePath, productPath);
  const linked = await validateTrackMEvidenceOutcome({
    plan: linkFixture.plan,
    reportPath: linkFixture.reportPath,
    publicationPointerPath: linkFixture.pointerPath,
  });
  assert.equal(linked.ok, false);
  assert.match(JSON.stringify(linked.failures), /product.*outside|realpath|symlink/i);
});

test('invalid plans return structured rejection instead of throwing', async () => {
  const fixture = await publishedFixture();
  const outcome = await validateTrackMEvidenceOutcome({
    plan: null,
    reportPath: fixture.reportPath,
    publicationPointerPath: fixture.pointerPath,
  });
  assert.equal(outcome.ok, false);
  assert.match(JSON.stringify(outcome.failures), /plan-contract-invalid/);
});

test('outcome admission rejects recomputed nested Track R baggage in a persisted plan', async () => {
  const fixture = await publishedFixture();
  fixture.plan.asset.variants = { parent: {}, positive: {}, negative: {} };
  rehashPlan(fixture.plan);

  const rejected = await validateTrackMEvidenceOutcome({
    plan: fixture.plan,
    reportPath: fixture.reportPath,
    publicationPointerPath: fixture.pointerPath,
  });
  assert.equal(rejected.ok, false);
  assert.match(JSON.stringify(rejected.failures), /plan.*field set|unexpected/i);
});

test('outcome admission rejects recomputed semantic drift in a persisted plan', async () => {
  const mutations = [
    plan => { plan.pose.kind = 'dramatic'; },
    plan => { plan.conditions[0].deepGeometryPresent = true; },
    plan => { plan.conditions[2].routingGraphSha256 = plan.conditions[1].routingGraphSha256; },
    plan => { plan.conditions[2].representationalBudget.vertexCount += 1; },
  ];
  for (const mutate of mutations) {
    const fixture = await publishedFixture();
    mutate(fixture.plan);
    rehashPlan(fixture.plan);
    const rejected = await validateTrackMEvidenceOutcome({
      plan: fixture.plan,
      reportPath: fixture.reportPath,
      publicationPointerPath: fixture.pointerPath,
    });
    assert.equal(rejected.ok, false);
    assert.match(JSON.stringify(rejected.failures), /plan.*semantic|comparison.*contract/i);
  }
});

test('durable failure admission is exclusive and bound to the exact plan', async () => {
  const plan = buildTrackMEvidencePlan(source());
  const root = await mkdtemp(join(tmpdir(), 'track-m-failure-'));
  const failurePath = join(root, 'attempt.failure.json');
  await writeJson(failurePath, {
    schema: TRACK_M_FAILURE_SCHEMA,
    compilerId: plan.compilerId,
    status: 'failed',
    trackId: plan.trackId,
    planId: plan.id,
    sourceReceiptId: plan.sourceReceiptId,
    requestedRouteId: plan.requestedRouteId,
    attemptId: 'attempt-v0',
    outputIdentity: plan.bundleOutputIdentity,
    failure: { phase: 'bundle-dispatch', name: 'AdapterUnavailable', message: 'No CPU adapter supplied.' },
    lastTrustworthyEvidence: 'source and three-condition plan validated',
  });
  const accepted = await validateTrackMEvidenceOutcome({ plan, failurePath });
  assert.equal(accepted.ok, true, JSON.stringify(accepted.failures));
  assert.equal(accepted.status, 'failed-outcome-validated');

  const stalePlan = structuredClone(plan);
  stalePlan.camera.id = 'silently-substituted-camera';
  const stale = await validateTrackMEvidenceOutcome({ plan: stalePlan, failurePath });
  assert.equal(stale.ok, false);
  assert.match(JSON.stringify(stale.failures), /plan.*integrity/i);

  const ambiguous = await validateTrackMEvidenceOutcome({
    plan,
    failurePath,
    reportPath: join(root, 'invented-report.json'),
  });
  assert.equal(ambiguous.ok, false);
  assert.match(JSON.stringify(ambiguous.failures), /exactly one/i);
});
