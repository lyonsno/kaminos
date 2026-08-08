import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  applyRouteRestorationTowardRest,
  parseGlbTriangleSoup,
  signedEnvelopeDistance,
} from '../k4-envelope-fit-core.mjs';

const REPO_ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const TOOL = path.join(REPO_ROOT, 'tools/run-k4-two-row-split-assay.mjs');
const RECEIPT = path.join(
  REPO_ROOT,
  'artifacts/source-shaped-k4-envelope-frame-binding-v0/receipt.json',
);
const ENVELOPE = path.join(
  REPO_ROOT,
  'artifacts/source-shaped-k4-envelope-frame-binding-visual-v0/envelope-baseline.glb',
);
const ATTRIBUTION = path.join(
  REPO_ROOT,
  'artifacts/k4-source-route-containment-v0/result.json',
);
const CARRIER = path.join(
  REPO_ROOT,
  'artifacts/current-k4-curvature-contact-volume-bound-assay-v0/packed-carrier.json',
);
const SOURCE = path.join(
  REPO_ROOT,
  'artifacts/current-k4-fixed-contact-assay-v0/contact-admitted-source.json',
);

test('route restoration blends the escaped section back inside toward rest', async () => {
  const frameReceipt = JSON.parse(await readFile(RECEIPT, 'utf8'));
  const envelopeMesh = parseGlbTriangleSoup(await readFile(ENVELOPE));
  const solverCarrier = JSON.parse(await readFile(CARRIER, 'utf8'));
  const restoration = applyRouteRestorationTowardRest({
    frameReceipt,
    envelopeMesh,
    solverCarrier,
    config: {
      constructionId: 'muscle-12',
      sectionId: 'muscle-12:section:0008',
      containmentMargin: 0.05,
      maximumBlend: 1,
    },
  });
  assert.equal(restoration.status, 'completed-provisional');
  assert.equal(restoration.routeAuthority, 'rest-restoring-packing-displacement-rollback');
  assert.ok(restoration.appliedBlend > 0 && restoration.appliedBlend <= 1);
  assert.ok(restoration.axisSignedDistanceBefore > 0, 'fixture premise lost: sec8 was outside');
  assert.ok(restoration.axisSignedDistanceAfter <= -0.05 + 1e-9);
  assert.equal(restoration.fixedNodeMaximumDrift, 0);
  assert.equal(restoration.nonPositiveCellCount, 0);
  // Only the named section moved.
  const before = solverCarrier.cages.find(cage => cage.constructionId === 'muscle-12');
  const after = restoration.outputCarrier.cages.find(
    cage => cage.constructionId === 'muscle-12',
  );
  for (const [index, node] of after.manifest.nodes.entries()) {
    const moved = node.currentPosition.some((value, axisIndex) =>
      value !== before.manifest.nodes[index].currentPosition[axisIndex]);
    const inSection = node.id.startsWith('muscle-12:section:0008');
    if (moved) assert.ok(inSection, `${node.id} moved outside the named section`);
  }
  // The restored axis matches a direct signed-distance recheck.
  const transform = frameReceipt.sourceToEnvelope.transform;
  const axisNode = after.manifest.nodes.find(
    node => node.id === 'muscle-12:section:0008:axis',
  );
  const scaled = axisNode.currentPosition.map(value => value * transform.scale);
  const world = [0, 1, 2].map(row =>
    transform.rotation[row][0] * scaled[0] +
    transform.rotation[row][1] * scaled[1] +
    transform.rotation[row][2] * scaled[2] +
    transform.translation[row]);
  assert.ok(signedEnvelopeDistance(world, envelopeMesh).inside);
});

test('route restoration refuses when the blend cap cannot restore containment', async () => {
  const frameReceipt = JSON.parse(await readFile(RECEIPT, 'utf8'));
  const envelopeMesh = parseGlbTriangleSoup(await readFile(ENVELOPE));
  const solverCarrier = JSON.parse(await readFile(CARRIER, 'utf8'));
  assert.throws(() => applyRouteRestorationTowardRest({
    frameReceipt,
    envelopeMesh,
    solverCarrier,
    config: {
      constructionId: 'muscle-12',
      sectionId: 'muscle-12:section:0008',
      containmentMargin: 0.05,
      maximumBlend: 0.01,
    },
  }), /insufficient-blend-authority/);
});

test('the two-row split assay separates belly and attachment ledgers under the attribution', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'kaminos-k4-tworow-'));
  const result = spawnSync(process.execPath, [
    TOOL,
    '--frame-receipt', RECEIPT,
    '--envelope', ENVELOPE,
    '--attribution', ATTRIBUTION,
    '--carrier', CARRIER,
    '--source', SOURCE,
    '--containment-margin', '0.05',
    '--output', output,
  ], { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const assay = JSON.parse(
    await readFile(path.join(output, 'two-row-result.json'), 'utf8'),
  );
  assert.equal(assay.status, 'completed-provisional');
  // Row 1: belly/interior — carries the packing-induced escape and its re-solve.
  assert.equal(assay.rows.belly.packingInducedSectionIds.length, 1);
  assert.equal(assay.rows.belly.packingInducedSectionIds[0], 'muscle-12:section:0008');
  assert.ok(assay.rows.belly.resolve.appliedBlend > 0);
  assert.ok(assay.rows.belly.resolve.axisSignedDistanceAfter < 0);
  assert.ok(Number.isFinite(assay.rows.belly.resolve.contactCost
    .pairwiseMovableTotalPenetrationDelta));
  // Row 2: attachment-tail — source-attributed, never failure-classed.
  assert.ok(assay.rows.attachmentTail.sections.length >= 10);
  for (const row of assay.rows.attachmentTail.sections) {
    assert.equal(row.markerClass, 'source-geometry-attributed');
  }
  assert.ok(assay.rows.attachmentTail.sections.some(row =>
    row.sectionId === 'muscle-45:section:0008' &&
    row.tags.includes('metric-evidence-only')));
  assert.equal(assay.rows.attachmentTail.caption,
    'outside authored envelope in source geometry');
  // Viewer handoff: registered route with requested/effective identity.
  assert.equal(assay.viewer.route.requested, assay.viewer.route.effective);
  assert.equal(assay.viewer.route.fallbackUsed, false);
  const viewerHtml = await readFile(path.join(output, assay.viewer.path), 'utf8');
  assert.ok(viewerHtml.includes('source-geometry-attributed'));
  const viewerData = JSON.parse(
    await readFile(path.join(output, assay.viewer.dataPath), 'utf8'),
  );
  assert.equal(viewerData.schema, 'kaminos.k4-two-row-viewer-data.v0');
});

test('the two-row assay refuses an attribution that does not match the carrier constructions', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'kaminos-k4-tworow-bad-'));
  const attribution = JSON.parse(await readFile(ATTRIBUTION, 'utf8'));
  attribution.effectiveConstructionIds = ['muscle-99'];
  const badPath = path.join(output, 'bad-attribution.json');
  const { writeFile: write } = await import('node:fs/promises');
  await write(badPath, JSON.stringify(attribution));
  const result = spawnSync(process.execPath, [
    TOOL,
    '--frame-receipt', RECEIPT,
    '--envelope', ENVELOPE,
    '--attribution', badPath,
    '--carrier', CARRIER,
    '--source', SOURCE,
    '--containment-margin', '0.05',
    '--output', path.join(output, 'out'),
  ], { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  const report = JSON.parse(
    await readFile(path.join(output, 'out', 'run-report.json'), 'utf8'),
  );
  assert.equal(report.status, 'failed');
  await assert.rejects(
    readFile(path.join(output, 'out', 'two-row-result.json')),
    /ENOENT/,
  );
});
