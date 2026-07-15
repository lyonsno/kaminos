import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { validateSmokeSplatMotionManifest } from '../smoke-splat-motion-source.mjs';

const moduleUrl = new URL('../held-basin-smoke-assay-manifest.mjs', import.meta.url);
const { writeHeldSmokeAssayManifest, writeHeldSmokeCompetenceManifest } = await import(moduleUrl);
assert.equal(typeof writeHeldSmokeAssayManifest, 'function');
assert.equal(typeof writeHeldSmokeCompetenceManifest, 'function');

const repoRoot = new URL('..', import.meta.url).pathname;
const viewerManifestPath = '/Users/noahlyons/.local/state/kaminos/volume-basins/operator-live-basin-0715/viewer-manifest.json';
const routeAReportPath = join(repoRoot, 'artifacts/held-basin-smoke-assay-0715/route-a/route-a-report.json');
const routeBReportPath = join(repoRoot, 'artifacts/held-basin-smoke-assay-0715/route-b/route-b-report.json');
const routeUReportPath = join(repoRoot, 'artifacts/held-basin-smoke-assay-0715/route-u/route-u-report.json');
const outputRoot = await mkdtemp(join(tmpdir(), 'kaminos-held-smoke-assay-manifest-'));

try {
  const outputPath = join(outputRoot, 'held-smoke-assay-source.json');
  const manifest = await writeHeldSmokeAssayManifest({
    viewerManifestPath,
    expectedViewerManifestSha256: '553fc56d90ce13309595e8856ce0d54a87800d0b57e4476ea8fc847748149afa',
    routeAReportPath,
    routeBReportPath,
    outputPath,
  });
  assert.equal(manifest.schema, 'kaminos.held-smoke-assay-source.v0');
  assert.equal(manifest.status, 'passed');
  assert.equal(manifest.requestedRoute, 'webgpu-held-smoke-assay-v0');
  assert.equal(manifest.effectiveRoute, manifest.requestedRoute);
  assert.equal(manifest.temporalAuthority, 'held-current-state-only-v0');
  assert.equal(manifest.source.manifestIdentity, 'sha256:553fc56d90ce13309595e8856ce0d54a87800d0b57e4476ea8fc847748149afa');
  assert.equal(manifest.source.simStepCount, 179290);
  assert.equal(manifest.products.length, 2);
  assert.deepEqual(manifest.products.map(product => product.routeCell), ['A', 'B']);
  assert.deepEqual(manifest.products.map(product => product.slotIdentity.slotWriteTick), [179290, 179290]);
  assert.equal(manifest.products.every(product => product.payloadIdentity === manifest.source.fluidIdentity), true);
  assert.equal(validateSmokeSplatMotionManifest(manifest), manifest);
  assert.equal(JSON.parse(await readFile(outputPath, 'utf8')).status, 'passed');

  const competenceOutputPath = join(outputRoot, 'held-smoke-competence-source.json');
  const competence = await writeHeldSmokeCompetenceManifest({
    viewerManifestPath,
    expectedViewerManifestSha256: '553fc56d90ce13309595e8856ce0d54a87800d0b57e4476ea8fc847748149afa',
    routeUReportPath,
    routeBReportPath,
    outputPath: competenceOutputPath,
  });
  assert.equal(competence.schema, 'kaminos.held-smoke-assay-source.v0');
  assert.equal(competence.experiment.identity, 'dense-splat-competence-floor-v0');
  assert.equal(competence.experiment.claimUnderTest, 'splat-raster-and-optical-transfer-can-reconstruct-held-smoke-before-sparsification');
  assert.deepEqual(competence.products.map(product => product.routeCell), ['U', 'B']);
  assert.equal(competence.products[0].producerKind, 'dense-occupied-fine-bin-lift');
  assert.equal(competence.products[0].hierarchyCounts.coarse, 0);
  assert.equal(competence.products[0].hierarchyCounts.fine, competence.products[0].sourceStatistics.occupiedFineBinCount);
  assert.equal(competence.products[0].coarseConsolidation.transferredTailExtinctionMass, 0);
  assert.equal(competence.products[0].accounting.rejectedExtinctionMass, 0);
  assert.equal(validateSmokeSplatMotionManifest(competence), competence);
  assert.equal(JSON.parse(await readFile(competenceOutputPath, 'utf8')).status, 'passed');

  const substitutedB = JSON.parse(await readFile(routeBReportPath, 'utf8'));
  substitutedB.source.fluidIdentity = `sha256:${'e'.repeat(64)}`;
  const substitutedPath = join(outputRoot, 'substituted-b.json');
  await writeFile(substitutedPath, `${JSON.stringify(substitutedB, null, 2)}\n`);
  const failedOutput = join(outputRoot, 'failed-source.json');
  await assert.rejects(
    () => writeHeldSmokeAssayManifest({
      viewerManifestPath,
      expectedViewerManifestSha256: '553fc56d90ce13309595e8856ce0d54a87800d0b57e4476ea8fc847748149afa',
      routeAReportPath,
      routeBReportPath: substitutedPath,
      outputPath: failedOutput,
    }),
    /common held source|fluid identity/i,
  );
  const failure = JSON.parse(await readFile(`${failedOutput}.failure.json`, 'utf8'));
  assert.equal(failure.status, 'failed');
  assert.equal(failure.failurePhase, 'source-coherence');
  assert.equal(failure.lastTrustworthyEvidence.primaryManifestWritten, false);

  const falseDense = JSON.parse(await readFile(routeUReportPath, 'utf8'));
  falseDense.product.hierarchyCounts.fine -= 1;
  falseDense.product.hierarchyCounts.total -= 1;
  const falseDensePath = join(outputRoot, 'false-dense.json');
  await writeFile(falseDensePath, `${JSON.stringify(falseDense, null, 2)}\n`);
  const failedCompetenceOutput = join(outputRoot, 'failed-competence.json');
  await assert.rejects(
    () => writeHeldSmokeCompetenceManifest({
      viewerManifestPath,
      expectedViewerManifestSha256: '553fc56d90ce13309595e8856ce0d54a87800d0b57e4476ea8fc847748149afa',
      routeUReportPath: falseDensePath,
      routeBReportPath,
      outputPath: failedCompetenceOutput,
    }),
    /occupied fine-bin count|dense competence/i,
  );
  const competenceFailure = JSON.parse(await readFile(`${failedCompetenceOutput}.failure.json`, 'utf8'));
  assert.equal(competenceFailure.status, 'failed');
  assert.equal(competenceFailure.failurePhase, 'competence-admission');
  assert.equal(competenceFailure.lastTrustworthyEvidence.primaryManifestWritten, false);
} finally {
  await rm(outputRoot, { recursive: true, force: true });
}

console.log('held basin smoke assay manifest contracts passed');
