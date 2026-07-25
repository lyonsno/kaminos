import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const packageReportPath = process.env.HILL_SUPPORT_PACKAGE_REPORT;
assert.ok(
  packageReportPath,
  'HILL_SUPPORT_PACKAGE_REPORT must name the exact LERMS package witness report',
);
const exactPackageReportPath = resolve(packageReportPath);
const witnessPath = resolve('hill-moving-support-consumer-witness.mjs');
const hillRevision = '26b79567597538996b0b8b9f58ef59ea12c5c3a9';
const bigPapaRevision = 'f8e1f6db64fb3a505151d16f83d5131b588d2516';

function runWitness(outputDir, packageReport = exactPackageReportPath, extra = []) {
  return spawnSync(
    process.execPath,
    [
      witnessPath,
      '--output-dir',
      outputDir,
      '--package-report',
      packageReport,
      '--expected-hill-revision',
      hillRevision,
      '--expected-big-papa-revision',
      bigPapaRevision,
      ...extra,
    ],
    {
      cwd: resolve('.'),
      encoding: 'utf8',
    },
  );
}

function readJson(path, label) {
  assert.ok(existsSync(path), `${label} is missing`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

const testRoot = mkdtempSync(
  join(tmpdir(), 'kaminos-hill-moving-support-witness-contract-'),
);
const outputDir = join(testRoot, 'output');

try {
  const success = runWitness(outputDir);
  assert.equal(
    success.status,
    0,
    `exact witness failed: ${success.stderr || success.stdout}`,
  );
  const reportPath = join(outputDir, 'report.json');
  const exercisePath = join(outputDir, 'exercise.json');
  const report = readJson(reportPath, 'witness report');
  const exercise = readJson(exercisePath, 'primary exercise receipt');
  assert.equal(
    report.schema,
    'kaminos.hill-moving-support-consumer-witness.v1',
  );
  assert.equal(report.ok, true);
  assert.equal(report.failurePhase, null);
  assert.equal(report.primaryOutputWritten, true);
  assert.equal(report.artifactFreshness, 'built_current_run');
  assert.equal(report.requested.hillSourceRevision, hillRevision);
  assert.equal(report.effective.hillSourceRevision, hillRevision);
  assert.equal(report.requested.bigPapaRevision, bigPapaRevision);
  assert.equal(report.effective.bigPapaBaseRevision, bigPapaRevision);
  assert.equal(
    report.requested.hillPackageCoordinate,
    '@lerms/hill-of-hills-support/hill-of-hills/analytic-impact-support',
  );
  assert.equal(
    report.effective.hillPackageCoordinate,
    report.requested.hillPackageCoordinate,
  );
  assert.equal(report.effective.fallbackRoute, null);
  assert.match(report.effective.bigPapaHandoffBlobSha, /^[0-9a-f]{40}$/);
  assert.match(report.primaryArtifact.sha256, /^[0-9a-f]{64}$/);
  assert.equal(exercise.schema, report.primaryArtifact.schema);
  assert.equal(exercise.status, 'passed');

  writeFileSync(
    reportPath,
    `${JSON.stringify({ ok: true, artifactFreshness: 'cached_lie' })}\n`,
  );
  writeFileSync(
    exercisePath,
    `${JSON.stringify({ status: 'passed', stale: true })}\n`,
  );
  const wrongHillRevision = 'b'.repeat(40);
  const wrongRevision = runWitness(
    outputDir,
    exactPackageReportPath,
    ['--expected-hill-revision', wrongHillRevision],
  );
  assert.notEqual(wrongRevision.status, 0);
  const wrongRevisionReport = readJson(reportPath, 'revision-failure report');
  assert.equal(wrongRevisionReport.ok, false);
  assert.equal(wrongRevisionReport.primaryOutputWritten, false);
  assert.equal(wrongRevisionReport.artifactFreshness, 'not_built');
  assert.equal(
    wrongRevisionReport.requested.hillSourceRevision,
    wrongHillRevision,
  );
  assert.equal(existsSync(exercisePath), false);

  const exactPackageReport = readJson(
    exactPackageReportPath,
    'exact package report',
  );
  const wrongRouteReportPath = join(testRoot, 'wrong-route-report.json');
  writeFileSync(
    wrongRouteReportPath,
    `${JSON.stringify({
      ...exactPackageReport,
      effective: {
        ...exactPackageReport.effective,
        packageCoordinate: '@lerms/hill-of-hills-support/fallback',
      },
    })}\n`,
  );
  const wrongRoute = runWitness(outputDir, wrongRouteReportPath);
  assert.notEqual(wrongRoute.status, 0);
  const wrongRouteReport = readJson(reportPath, 'wrong-route failure report');
  assert.equal(wrongRouteReport.ok, false);
  assert.equal(wrongRouteReport.failurePhase, 'validate-package-receipt');
  assert.equal(wrongRouteReport.effective, null);
  assert.equal(wrongRouteReport.primaryOutputWritten, false);

  const forgedEffectiveRevisionReportPath = join(
    testRoot,
    'forged-effective-revision-report.json',
  );
  writeFileSync(
    forgedEffectiveRevisionReportPath,
    `${JSON.stringify({
      ...exactPackageReport,
      effective: {
        ...exactPackageReport.effective,
        sourceRevision: 'c'.repeat(40),
        repositoryHead: 'c'.repeat(40),
      },
    })}\n`,
  );
  const forgedEffectiveRevision = runWitness(
    outputDir,
    forgedEffectiveRevisionReportPath,
  );
  assert.notEqual(
    forgedEffectiveRevision.status,
    0,
    'witness accepted a package whose effective source revision diverged from its claim',
  );
  const forgedRevisionReport = readJson(
    reportPath,
    'forged effective-revision failure report',
  );
  assert.equal(forgedRevisionReport.ok, false);
  assert.equal(
    forgedRevisionReport.failurePhase,
    'validate-package-receipt',
  );
  assert.equal(forgedRevisionReport.primaryOutputWritten, false);

  const missingSourceTreeReportPath = join(
    testRoot,
    'missing-source-tree-report.json',
  );
  const effectiveWithoutSourceTree = {
    ...exactPackageReport.effective,
  };
  delete effectiveWithoutSourceTree.sourceTreeSha256;
  writeFileSync(
    missingSourceTreeReportPath,
    `${JSON.stringify({
      ...exactPackageReport,
      effective: effectiveWithoutSourceTree,
    })}\n`,
  );
  const missingSourceTree = runWitness(
    outputDir,
    missingSourceTreeReportPath,
  );
  assert.notEqual(
    missingSourceTree.status,
    0,
    'witness accepted a package receipt without effective source-tree identity',
  );
  const missingSourceTreeReport = readJson(
    reportPath,
    'missing source-tree failure report',
  );
  assert.equal(missingSourceTreeReport.ok, false);
  assert.equal(
    missingSourceTreeReport.failurePhase,
    'validate-package-receipt',
  );
  assert.equal(missingSourceTreeReport.primaryOutputWritten, false);

  const tamperedTarballPath = join(testRoot, 'tampered-package.tgz');
  writeFileSync(tamperedTarballPath, 'not the witnessed package');
  const tamperedPackageReportPath = join(
    testRoot,
    'tampered-package-report.json',
  );
  writeFileSync(
    tamperedPackageReportPath,
    `${JSON.stringify({
      ...exactPackageReport,
      artifact: {
        ...exactPackageReport.artifact,
        path: tamperedTarballPath,
      },
    })}\n`,
  );
  const tamperedArtifact = runWitness(outputDir, tamperedPackageReportPath);
  assert.notEqual(tamperedArtifact.status, 0);
  const tamperedArtifactReport = readJson(
    reportPath,
    'tampered-artifact failure report',
  );
  assert.equal(tamperedArtifactReport.ok, false);
  assert.equal(tamperedArtifactReport.failurePhase, 'verify-package-artifact');
  assert.equal(tamperedArtifactReport.primaryOutputWritten, false);
  assert.match(tamperedArtifactReport.error, /SHA-256|integrity/i);

  const rerun = runWitness(outputDir);
  assert.equal(
    rerun.status,
    0,
    `witness was not idempotently re-runnable: ${rerun.stderr || rerun.stdout}`,
  );
  const rerunReport = readJson(reportPath, 'rerun report');
  assert.equal(rerunReport.ok, true);
  assert.equal(rerunReport.artifactFreshness, 'built_current_run');
  assert.equal(
    rerunReport.lastTrustworthyEvidence.phase,
    'complete-primary-output',
  );
} finally {
  rmSync(testRoot, { recursive: true, force: true });
}

process.stdout.write('hill moving-support consumer witness contracts passed\n');
