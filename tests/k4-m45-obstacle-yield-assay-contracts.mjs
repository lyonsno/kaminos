import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const REPO_ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const TOOL = path.join(REPO_ROOT, 'tools/run-k4-m45-obstacle-yield-assay.mjs');
const RECEIPT = path.join(
  REPO_ROOT,
  'artifacts/source-shaped-k4-envelope-frame-binding-v0/receipt.json',
);
const ENVELOPE = path.join(
  REPO_ROOT,
  'artifacts/source-shaped-k4-envelope-frame-binding-visual-v0/envelope-baseline.glb',
);
const CONTAINED = path.join(
  REPO_ROOT,
  'artifacts/k4-coupled-envelope-contact-frontier-v0/states/' +
  'endpoint-contained-rollback-carrier.json',
);
const SOURCE = path.join(
  REPO_ROOT,
  'artifacts/current-k4-fixed-contact-assay-v0/contact-admitted-source.json',
);

function run(output, extra = []) {
  return spawnSync(process.execPath, [
    TOOL,
    '--frame-receipt', RECEIPT,
    '--envelope', ENVELOPE,
    '--carrier', CONTAINED,
    '--source', SOURCE,
    '--yield-scales', '0.9',
    '--solver-iterations', '2',
    '--output', output,
    ...extra,
  ], { cwd: REPO_ROOT, encoding: 'utf8' });
}

test('the M45 yield assay pairs each treatment with a sham and holds M34 byte-fixed', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'kaminos-k4-m45yield-'));
  const result = run(output);
  assert.equal(result.status, 0, result.stderr);
  const assay = JSON.parse(
    await readFile(path.join(output, 'yield-assay-result.json'), 'utf8'),
  );
  assert.equal(assay.status, 'completed-provisional');
  assert.equal(assay.control.heldConstructionId, 'muscle-34');
  const arms = assay.arms.map(row => row.id);
  assert.ok(arms.includes('baseline-contained'));
  assert.ok(arms.includes('treatment-s090'));
  assert.ok(arms.includes('sham-s090'));
  const contained = JSON.parse(await readFile(CONTAINED, 'utf8'));
  const m34Reference = JSON.stringify(contained.cages
    .find(cage => cage.constructionId === 'muscle-34').manifest.nodes);
  for (const arm of assay.arms) {
    // M34 held fixed as control in every arm.
    const carrier = JSON.parse(await readFile(
      path.join(output, arm.carrier.path), 'utf8'));
    assert.equal(JSON.stringify(carrier.cages
      .find(cage => cage.constructionId === 'muscle-34').manifest.nodes),
    m34Reference, `${arm.id} moved muscle-34`);
    // Required metric surface per Bytebound contract.
    assert.ok(Number.isFinite(arm.metrics.s8AxisSignedDistance));
    assert.ok(Number.isFinite(arm.metrics.pairwiseMovableTotalPenetration));
    assert.ok(Number.isFinite(arm.metrics.skeletalTotalPenetration));
    assert.ok(Number.isFinite(arm.metrics.maximumRelativeVolumeError));
    assert.ok(arm.ledgerRows, `${arm.id} lacks ledger rows`);
    for (const key of ['m12s8ToM45', 'm45s8ToM12', 'm12s8ToM13', 'm34Linked']) {
      assert.ok(key in arm.ledgerRows, `${arm.id} lacks ledger row ${key}`);
    }
  }
  // Containment non-worsening holds for every treatment arm.
  const baseline = assay.arms.find(row => row.id === 'baseline-contained');
  for (const arm of assay.arms.filter(row => row.id.startsWith('treatment'))) {
    assert.ok(arm.metrics.s8AxisSignedDistance <=
      baseline.metrics.s8AxisSignedDistance + 1e-9,
    `${arm.id} worsened s8 containment`);
    assert.ok(arm.yield, `${arm.id} lacks a yield receipt`);
    assert.deepEqual(arm.yield.heldConstructionIds, ['muscle-34']);
  }
  // Sham arms record the deliberately non-causal section set.
  for (const arm of assay.arms.filter(row => row.id.startsWith('sham'))) {
    assert.ok(arm.yield.shamSectionIds.length > 0);
    assert.ok(arm.yield.shamSectionIds.every(sectionId =>
      !assay.contactNeighborhood.sectionIds.includes(sectionId)));
  }
});

test('the assay refuses when the contact neighborhood cannot be derived', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'kaminos-k4-m45yield-bad-'));
  const result = run(path.join(output, 'out'), [
    '--obstacle-construction', 'muscle-13',
  ]);
  // M12 s8 has only one M13 contact at the contained endpoint; below the
  // causal-neighborhood floor the assay must refuse rather than fabricate.
  assert.notEqual(result.status, 0);
  const report = JSON.parse(
    await readFile(path.join(output, 'out', 'run-report.json'), 'utf8'),
  );
  assert.equal(report.status, 'failed');
});
