import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  evaluateCrawlerBasinRows,
  loadFrozenCrawlerBasinManifest,
  recordCrawlerBasinVisualInspection,
  runCrawlerBasinMatrix,
  validateCrawlerBasinMatrixReport,
  validateCrawlerBasinSubreport,
} from '../lirm-crawler-basin-robustness-core.mjs';
import {
  REFERENCE_FIT_CAMERAS,
  REFERENCE_FIT_ROUTE,
} from '../lirm-reference-fitted-armature-core.mjs';

const sha256 = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const cameraIds = REFERENCE_FIT_CAMERAS.map(camera => camera.id);
const fitViewIds = ['az000', 'az090', 'az180', 'az270'];
const heldOutViewIds = ['az045', 'az135', 'az225', 'az315'];

async function createManifestFixture() {
  const repoRoot = await mkdtemp(join(tmpdir(), 'kaminos-crawler-basin-'));
  const donorRoot = join(repoRoot, 'donors');
  const artifactRoot = join(repoRoot, 'artifacts', 'matrix');
  await mkdir(donorRoot, { recursive: true });
  await mkdir(artifactRoot, { recursive: true });
  const witnessBytes = Buffer.from('pre-fit visual witness');
  const witnessPath = join(repoRoot, 'witness.png');
  await writeFile(witnessPath, witnessBytes);
  const donors = [];
  for (const id of ['crawler-a', 'crawler-b', 'crawler-c', 'crawler-d']) {
    const bytes = Buffer.from(`glb fixture ${id}`);
    const path = `donors/${id}.glb`;
    await writeFile(join(repoRoot, path), bytes);
    donors.push({
      id,
      path,
      bytes: bytes.length,
      sha256: sha256(bytes),
      witnessTitle: id.toUpperCase(),
      visualSelectionRationale: `${id} was selected before fitting for a materially distinct crawler silhouette.`,
    });
  }
  const manifest = {
    schema: 'kaminos.lirm-crawler-basin-robustness-manifest.v0',
    selectionFrozenAt: '2026-07-18T00:00:00Z',
    fitOutcomesObserved: false,
    requestedRoute: REFERENCE_FIT_ROUTE,
    fixedRoute: {
      parameterVocabulary: 'kaminos.reference-fitted-armature.13-semantic-parameters.v0',
      initialization: 'reviewed-default-initialization',
      cameraIds,
      fitViewIds,
      heldOutViewIds,
      width: 40,
      height: 32,
      passes: 4,
      search: 'deterministic-bounded-coordinate-descent',
    },
    acceptance: {
      donorRecovery: { minimumHeldOutSilhouetteImprovements: 3, requireMeanHeldOutDepthMaeImprovement: true },
      basin: { donorCount: 4, minimumRecoveredDonors: 3, requireSingleComparisonWitness: true, allowDonorReplacement: false },
    },
    sourceWitness: {
      path: 'witness.png',
      bytes: witnessBytes.length,
      sha256: sha256(witnessBytes),
      mappingPath: 'witness-inputs.json',
    },
    donors,
    missClassifications: [
      'parameter-range-failure',
      'topology-family-mismatch',
      'donor-incoherence',
      'camera-or-normalization-failure',
    ],
  };
  const manifestPath = join(artifactRoot, 'manifest.json');
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { repoRoot, artifactRoot, manifestPath, manifest };
}

const fixture = await createManifestFixture();
const frozen = await loadFrozenCrawlerBasinManifest({ manifestPath: fixture.manifestPath, repoRoot: fixture.repoRoot });
assert.equal(frozen.donors.length, 4);
assert.ok(frozen.donors.every(donor => donor.absolutePath.startsWith(fixture.repoRoot)));
assert.equal(frozen.fitOutcomesObserved, false);

const threeDonorPath = join(fixture.artifactRoot, 'three-donors.json');
await writeFile(threeDonorPath, `${JSON.stringify({ ...fixture.manifest, donors: fixture.manifest.donors.slice(0, 3) })}\n`);
await assert.rejects(
  () => loadFrozenCrawlerBasinManifest({ manifestPath: threeDonorPath, repoRoot: fixture.repoRoot }),
  /exactly 4 donors/,
);

const duplicatePath = join(fixture.artifactRoot, 'duplicate-donors.json');
const duplicateManifest = structuredClone(fixture.manifest);
duplicateManifest.donors[1].path = duplicateManifest.donors[0].path;
duplicateManifest.donors[1].sha256 = duplicateManifest.donors[0].sha256;
duplicateManifest.donors[1].bytes = duplicateManifest.donors[0].bytes;
await writeFile(duplicatePath, `${JSON.stringify(duplicateManifest)}\n`);
await assert.rejects(
  () => loadFrozenCrawlerBasinManifest({ manifestPath: duplicatePath, repoRoot: fixture.repoRoot }),
  /duplicate donor path|duplicate donor hash/,
);

const mutableFixture = await createManifestFixture();
await writeFile(join(mutableFixture.repoRoot, mutableFixture.manifest.donors[0].path), Buffer.from('replacement donor'));
await assert.rejects(
  () => loadFrozenCrawlerBasinManifest({ manifestPath: mutableFixture.manifestPath, repoRoot: mutableFixture.repoRoot }),
  /donor .* (byte count|hash) mismatch/,
  'post-selection donor replacement must fail before fitting',
);

function makeSubreport(donor, { recovered = true } = {}) {
  const initialIou = 0.4;
  const fittedIou = recovered ? 0.6 : 0.35;
  const initialDepth = 0.2;
  const fittedDepth = recovered ? 0.1 : 0.24;
  return {
    schema: 'kaminos.lirm-reference-fitted-armature-assay.v0',
    status: recovered ? 'assay-passed-uninspected' : 'assay-missed-threshold-uninspected',
    requestedRoute: REFERENCE_FIT_ROUTE,
    effectiveRoute: REFERENCE_FIT_ROUTE,
    requestedCameraIds: cameraIds,
    effectiveCameraIds: cameraIds,
    fitViewIds,
    heldOutViewIds,
    donor: { path: donor.absolutePath, sha256: donor.sha256, bytes: donor.bytes, triangleCount: 100 },
    metrics: {
      initial: { heldOut: { meanIou: initialIou, meanDepthMae: initialDepth, byView: Object.fromEntries(heldOutViewIds.map(id => [id, { iou: initialIou }])) } },
      fitted: { heldOut: { meanIou: fittedIou, meanDepthMae: fittedDepth, byView: Object.fromEntries(heldOutViewIds.map(id => [id, { iou: fittedIou }])) } },
    },
    acceptance: {
      heldOutSilhouetteImprovementCount: recovered ? 4 : 0,
      heldOutDepthImproved: recovered,
      visualInspection: 'pending',
    },
    outputInventory: {
      primaryWitness: { path: join(fixture.artifactRoot, `${donor.id}-silhouette.png`), bytes: 16 },
      depthWitness: { path: join(fixture.artifactRoot, `${donor.id}-depth.png`), bytes: 13 },
      donorEvidence: cameraIds.map(cameraId => ({ cameraId, width: 40, height: 32 })),
    },
  };
}

assert.doesNotThrow(() => validateCrawlerBasinSubreport(makeSubreport(frozen.donors[0]), {
  manifest: frozen,
  donor: frozen.donors[0],
  requireFiles: false,
}));
assert.throws(
  () => validateCrawlerBasinSubreport({ ...makeSubreport(frozen.donors[0]), effectiveRoute: 'fallback/route' }, {
    manifest: frozen,
    donor: frozen.donors[0],
    requireFiles: false,
  }),
  /effective route mismatch/,
);
assert.throws(
  () => validateCrawlerBasinSubreport({ ...makeSubreport(frozen.donors[0]), heldOutViewIds: heldOutViewIds.slice(1) }, {
    manifest: frozen,
    donor: frozen.donors[0],
    requireFiles: false,
  }),
  /held-out camera mismatch/,
);

const passRows = [
  { donorId: 'crawler-a', outcome: 'recovered' },
  { donorId: 'crawler-b', outcome: 'recovered' },
  { donorId: 'crawler-c', outcome: 'recovered' },
  { donorId: 'crawler-d', outcome: 'missed' },
];
assert.deepEqual(evaluateCrawlerBasinRows(passRows, frozen.acceptance.basin), {
  donorCount: 4,
  recoveredDonorCount: 3,
  missedDonorCount: 1,
  failedDonorCount: 0,
  passed: true,
});
assert.equal(evaluateCrawlerBasinRows(
  passRows.map((row, index) => index === 2 ? { ...row, outcome: 'failed' } : row),
  frozen.acceptance.basin,
).passed, false);

const runFixture = await createManifestFixture();
const runManifest = await loadFrozenCrawlerBasinManifest({ manifestPath: runFixture.manifestPath, repoRoot: runFixture.repoRoot });
const runOut = join(runFixture.repoRoot, 'matrix-output');
const fakeRunner = async ({ donorPath, outDir }) => {
  const donor = runManifest.donors.find(item => item.absolutePath === donorPath);
  if (donor.id === 'crawler-d') {
    await mkdir(outDir, { recursive: true });
    await writeFile(join(outDir, 'report.json'), `${JSON.stringify({ status: 'failed', failurePhase: 'donor-evidence' })}\n`);
    throw new Error('synthetic donor-evidence failure');
  }
  const report = makeSubreport(donor, { recovered: true });
  report.outputInventory.primaryWitness.path = join(outDir, 'silhouette-residual-witness.png');
  report.outputInventory.depthWitness.path = join(outDir, 'depth-residual-witness.png');
  const silhouetteBytes = Buffer.from('silhouette data');
  const depthBytes = Buffer.from('depth witness');
  report.outputInventory.primaryWitness.bytes = silhouetteBytes.length;
  report.outputInventory.depthWitness.bytes = depthBytes.length;
  await mkdir(outDir, { recursive: true });
  await Promise.all([
    writeFile(report.outputInventory.primaryWitness.path, silhouetteBytes),
    writeFile(report.outputInventory.depthWitness.path, depthBytes),
    writeFile(join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`),
  ]);
  return report;
};

const matrix = await runCrawlerBasinMatrix({
  manifestPath: runFixture.manifestPath,
  repoRoot: runFixture.repoRoot,
  outDir: runOut,
  runAssay: fakeRunner,
  buildComparisonWitness: async ({ path, depthPath }) => {
    await writeFile(path, Buffer.from('aggregate visual witness'));
    await writeFile(depthPath, Buffer.from('aggregate depth witness'));
    return {
      comparisonWitness: { path, bytes: 24, sha256: sha256(Buffer.from('aggregate visual witness')) },
      depthComparisonWitness: { depthPath, path: depthPath, bytes: 23, sha256: sha256(Buffer.from('aggregate depth witness')) },
    };
  },
});
assert.equal(matrix.rows.length, 4, 'every precommitted donor must receive a durable matrix row');
assert.deepEqual(matrix.rows.map(row => row.outcome), ['recovered', 'recovered', 'recovered', 'failed']);
assert.match(matrix.rows[3].error, /synthetic donor-evidence failure/);
assert.equal(matrix.acceptance.passed, true);
assert.ok(existsSync(join(runOut, 'report.json')));
assert.ok(existsSync(matrix.outputInventory.comparisonWitness.path));
assert.ok(existsSync(matrix.outputInventory.depthComparisonWitness.path));
assert.doesNotThrow(() => validateCrawlerBasinMatrixReport(matrix));

const routeLie = structuredClone(matrix);
routeLie.rows[0].subreport.effectiveRoute = 'fallback/route';
assert.throws(() => validateCrawlerBasinMatrixReport(routeLie, { requireFiles: false }), /effective route mismatch/);
const matrixRequestedRouteLie = structuredClone(matrix);
matrixRequestedRouteLie.requestedRoute = 'fallback/route';
assert.throws(
  () => validateCrawlerBasinMatrixReport(matrixRequestedRouteLie, { requireFiles: false }),
  /matrix requested route mismatch/,
);
const matrixEffectiveRouteLie = structuredClone(matrix);
matrixEffectiveRouteLie.effectiveRoute = 'fallback/route';
assert.throws(
  () => validateCrawlerBasinMatrixReport(matrixEffectiveRouteLie, { requireFiles: false }),
  /matrix effective route mismatch/,
);
const unknownStatus = structuredClone(matrix);
unknownStatus.status = 'basin-passed-definitely-trust-me';
assert.throws(
  () => validateCrawlerBasinMatrixReport(unknownStatus, { requireFiles: false }),
  /matrix status\/inspection mismatch/,
);
const missingRow = structuredClone(matrix);
missingRow.rows.pop();
assert.throws(() => validateCrawlerBasinMatrixReport(missingRow, { requireFiles: false }), /exactly 4 matrix rows/);

const corruptedEmbeddedSource = structuredClone(matrix);
corruptedEmbeddedSource.manifest.sourceWitness.sha256 = `sha256:${'0'.repeat(64)}`;
assert.throws(
  () => validateCrawlerBasinMatrixReport(corruptedEmbeddedSource),
  /embedded manifest identity mismatch|source witness hash mismatch/,
  'matrix validation must bind the embedded frozen manifest to its original source evidence',
);
const corruptedEmbeddedDonor = structuredClone(matrix);
corruptedEmbeddedDonor.manifest.donors[0].bytes += 1;
assert.throws(
  () => validateCrawlerBasinMatrixReport(corruptedEmbeddedDonor),
  /embedded donor .* byte count mismatch/,
  'matrix validation must revalidate every frozen donor file identity',
);
const rewrittenEmbeddedManifest = structuredClone(matrix);
rewrittenEmbeddedManifest.manifest.donors[0].visualSelectionRationale = 'outcome-dependent replacement rationale';
assert.throws(
  () => validateCrawlerBasinMatrixReport(rewrittenEmbeddedManifest),
  /embedded manifest identity mismatch/,
  'matrix validation must reject an embedded manifest that diverges from the frozen manifest bytes',
);
const escapedEmbeddedDonor = structuredClone(matrix);
escapedEmbeddedDonor.manifest.donors[0].path = '../outside.glb';
assert.throws(
  () => validateCrawlerBasinMatrixReport(escapedEmbeddedDonor, { requireFiles: false }),
  /escapes repo root/,
  'embedded donor path containment must not depend on external file reads',
);

const persisted = JSON.parse(await readFile(join(runOut, 'report.json'), 'utf8'));
assert.equal(persisted.rows.length, 4);
assert.equal(persisted.lastTrustworthyEvidence, 'all four precommitted donors accounted for; comparison witness written but not inspected');
assert.ok(readFileSync(persisted.outputInventory.comparisonWitness.path).length > 0);

const inspected = await recordCrawlerBasinVisualInspection({
  reportPath: join(runOut, 'report.json'),
  disposition: 'accepted',
  visibleDelta: 'All four donor rows were inspected in the aggregate silhouette and depth witnesses.',
  missClassifications: { 'crawler-d': 'donor-incoherence' },
});
assert.equal(inspected.status, 'basin-passed-inspected');
assert.equal(inspected.visualInspection.depthComparisonWitness.sha256, matrix.outputInventory.depthComparisonWitness.sha256);
const corruptedInspection = structuredClone(inspected);
corruptedInspection.visualInspection.depthComparisonWitness.sha256 = `sha256:${'0'.repeat(64)}`;
assert.throws(
  () => validateCrawlerBasinMatrixReport(corruptedInspection),
  /visual inspection depth witness identity mismatch/,
  'inspected matrix must reject a receipt bound to different aggregate depth evidence',
);
const inspectedPending = structuredClone(inspected);
inspectedPending.visualInspection = 'pending';
assert.throws(
  () => validateCrawlerBasinMatrixReport(inspectedPending),
  /matrix status\/inspection mismatch/,
  'inspected green status must require an inspection receipt',
);
const inspectedMissing = structuredClone(inspected);
delete inspectedMissing.visualInspection;
assert.throws(
  () => validateCrawlerBasinMatrixReport(inspectedMissing),
  /matrix status\/inspection mismatch/,
  'inspected green status must not survive a missing inspection receipt',
);
const uninspectedWithReceipt = structuredClone(inspected);
uninspectedWithReceipt.status = 'basin-passed-uninspected';
assert.throws(
  () => validateCrawlerBasinMatrixReport(uninspectedWithReceipt),
  /matrix status\/inspection mismatch/,
  'an inspection receipt must not coexist with uninspected status',
);

const allRecoveredVisualRejection = structuredClone(inspected);
allRecoveredVisualRejection.rows[3] = {
  donorId: runManifest.donors[3].id,
  donorPath: runManifest.donors[3].absolutePath,
  donorSha256: runManifest.donors[3].sha256,
  outcome: 'recovered',
  subreport: makeSubreport(runManifest.donors[3], { recovered: true }),
};
allRecoveredVisualRejection.acceptance = evaluateCrawlerBasinRows(
  allRecoveredVisualRejection.rows,
  allRecoveredVisualRejection.manifest.acceptance.basin,
);
allRecoveredVisualRejection.visualInspection = {
  disposition: 'rejected',
  visibleDelta: 'All four numerical recoveries still collapse the selected upright family into the crawler topology.',
  missClassifications: {},
  comparisonWitness: allRecoveredVisualRejection.outputInventory.comparisonWitness,
  depthComparisonWitness: allRecoveredVisualRejection.outputInventory.depthComparisonWitness,
};
allRecoveredVisualRejection.status = 'basin-visual-rejected';
assert.equal(allRecoveredVisualRejection.acceptance.recoveredDonorCount, 4);
assert.equal(allRecoveredVisualRejection.acceptance.passed, true);
assert.doesNotThrow(
  () => validateCrawlerBasinMatrixReport(allRecoveredVisualRejection, { requireFiles: false }),
  'visual rejection must override a 4-of-4 numerical basin pass',
);
const relabeledVisualRejection = structuredClone(allRecoveredVisualRejection);
relabeledVisualRejection.status = 'basin-passed-inspected';
assert.throws(
  () => validateCrawlerBasinMatrixReport(relabeledVisualRejection, { requireFiles: false }),
  /matrix status\/inspection mismatch/,
  'a 4-of-4 numerical pass must not launder an explicit visual rejection into green status',
);

console.log('LIRM crawler basin robustness contracts passed');
