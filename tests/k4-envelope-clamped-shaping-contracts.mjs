import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  applyEnvelopeClampedSectionShaping,
  parseGlbTriangleSoup,
  computeK4EnvelopeFitMetric,
} from '../k4-envelope-fit-core.mjs';

const REPO_ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const TOOL = path.join(REPO_ROOT, 'tools/run-k4-envelope-clamped-shape-assay.mjs');
const RECEIPT = path.join(
  REPO_ROOT,
  'artifacts/source-shaped-k4-envelope-frame-binding-v0/receipt.json',
);
const ENVELOPE = path.join(
  REPO_ROOT,
  'artifacts/source-shaped-k4-envelope-frame-binding-visual-v0/envelope-baseline.glb',
);
const REFERENCE_CARRIER = path.join(
  REPO_ROOT,
  'artifacts/current-k4-curvature-contact-volume-bound-assay-v0/packed-carrier.json',
);
const SOURCE = path.join(
  REPO_ROOT,
  'artifacts/current-k4-fixed-contact-assay-v0/contact-admitted-source.json',
);

const SHAPING_CONFIG = Object.freeze({
  marginFraction: 0.92,
  maximumGrowth: 1.15,
  minimumShrink: 0.35,
});

async function loadInputs() {
  const [receiptBytes, envelopeBytes, carrierBytes] = await Promise.all([
    readFile(RECEIPT), readFile(ENVELOPE), readFile(REFERENCE_CARRIER),
  ]);
  return {
    frameReceipt: JSON.parse(receiptBytes),
    envelopeMesh: parseGlbTriangleSoup(envelopeBytes),
    solverCarrier: JSON.parse(carrierBytes),
  };
}

test('envelope-clamped shaping preserves route identity and moves only ring nodes', async () => {
  const { frameReceipt, envelopeMesh, solverCarrier } = await loadInputs();
  const shaping = applyEnvelopeClampedSectionShaping({
    frameReceipt,
    envelopeMesh,
    solverCarrier,
    config: SHAPING_CONFIG,
  });
  assert.equal(shaping.status, 'completed-provisional');
  assert.equal(shaping.shapeAuthority, 'envelope-fit-derived-provisional');
  assert.equal(shaping.fixedNodeMaximumDrift, 0);
  assert.equal(shaping.centerlineMaximumDrift, 0);
  assert.equal(shaping.nonPositiveCellCount, 0);
  assert.equal(shaping.sourceCarrierSha256, solverCarrier.identity.sha256);
  assert.equal(
    shaping.outputCarrierSha256,
    shaping.outputCarrier.identity.sha256,
  );
  // Route identity: same cages, same node ids, same section structure.
  assert.deepEqual(
    shaping.outputCarrier.cages.map(cage => cage.constructionId),
    solverCarrier.cages.map(cage => cage.constructionId),
  );
  for (const [index, cage] of shaping.outputCarrier.cages.entries()) {
    assert.deepEqual(
      cage.manifest.nodes.map(node => node.id),
      solverCarrier.cages[index].manifest.nodes.map(node => node.id),
    );
  }
  // The shaped profile must actually vary: per-node scales are not all equal
  // within at least one shaped section (non-elliptical shaping is per-ray).
  const shapedSections = shaping.sectionReceipts.filter(row =>
    row.status === 'shaped');
  assert.ok(shapedSections.length > 0, 'no section was shaped');
  assert.ok(shapedSections.some(row => {
    const scales = row.nodeReceipts.map(node => node.appliedRadialScale);
    return Math.max(...scales) - Math.min(...scales) > 1e-3;
  }), 'shaping is uniform per section — that is elliptical, not envelope-clamped');
  // Sections whose axis lies outside the envelope are recorded, not mangled.
  for (const row of shaping.sectionReceipts) {
    assert.ok(['shaped', 'axis-outside-envelope', 'fixed-section'].includes(row.status));
  }
});

test('envelope-clamped shaping materially improves containment under the same metric', async () => {
  const { frameReceipt, envelopeMesh, solverCarrier } = await loadInputs();
  const shaping = applyEnvelopeClampedSectionShaping({
    frameReceipt,
    envelopeMesh,
    solverCarrier,
    config: SHAPING_CONFIG,
  });
  const before = computeK4EnvelopeFitMetric({
    frameReceipt, envelopeMesh, solverCarrier,
  });
  const after = computeK4EnvelopeFitMetric({
    frameReceipt, envelopeMesh, solverCarrier: shaping.outputCarrier,
  });
  const insideBefore = before.constructions
    .reduce((sum, row) => sum + row.insideFraction, 0) / 4;
  const insideAfter = after.constructions
    .reduce((sum, row) => sum + row.insideFraction, 0) / 4;
  // Route-preserving shaping can only fix sections whose axis is inside the
  // envelope; sections whose centerline exits the envelope are out of shape's
  // lawful reach and must be loudly accounted instead of silently improved.
  assert.ok(insideAfter > insideBefore + 0.01,
    `shaping did not improve containment: ${insideBefore} -> ${insideAfter}`);
  for (const [index, row] of after.constructions.entries()) {
    assert.ok(row.insideFraction >= before.constructions[index].insideFraction - 1e-12,
      `shaping worsened ${row.constructionId}`);
  }
  const routeEscapes = shaping.sectionReceipts.filter(row =>
    row.status === 'axis-outside-envelope');
  assert.ok(routeEscapes.length > 0,
    'expected the known route-escape sections to be loudly reported');
});

test('envelope-clamped shaping refuses an invalid config instead of guessing', async () => {
  const { frameReceipt, envelopeMesh, solverCarrier } = await loadInputs();
  assert.throws(() => applyEnvelopeClampedSectionShaping({
    frameReceipt,
    envelopeMesh,
    solverCarrier,
    config: { ...SHAPING_CONFIG, minimumShrink: 0 },
  }), /config/);
});

test('the shape-assay CLI binds shaping, metric comparison, and overlays durably', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'kaminos-k4-shape-'));
  const result = spawnSync(process.execPath, [
    TOOL,
    '--frame-receipt', RECEIPT,
    '--envelope', ENVELOPE,
    '--carrier', REFERENCE_CARRIER,
    '--source', SOURCE,
    '--margin-fraction', String(SHAPING_CONFIG.marginFraction),
    '--maximum-growth', String(SHAPING_CONFIG.maximumGrowth),
    '--minimum-shrink', String(SHAPING_CONFIG.minimumShrink),
    '--output', output,
  ], { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(await readFile(path.join(output, 'run-report.json'), 'utf8'));
  const assay = JSON.parse(
    await readFile(path.join(output, 'shape-assay-result.json'), 'utf8'),
  );
  assert.equal(report.status, 'completed');
  assert.equal(assay.shapeAuthority, 'envelope-fit-derived-provisional');
  assert.deepEqual(assay.rows.map(row => row.id), ['reference', 'envelope-clamped']);
  const shapedCarrier = JSON.parse(
    await readFile(path.join(output, 'shaped-carrier.json'), 'utf8'),
  );
  assert.equal(assay.shaping.outputCarrierSha256, shapedCarrier.identity.sha256);
  assert.ok(assay.sectionOverlays.length >= 3);
  // Contact-state secondary ledger is present for both rows.
  for (const row of assay.rows) {
    assert.ok(Number.isFinite(row.contact.pairwiseMovableTotalPenetration));
  }
});
