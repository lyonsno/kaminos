import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname;
const manifestPath = join(root, 'pipelines', 'asset-pipelines.json');
const witnessPath = join(root, 'pipeline-witness.mjs');

assert.ok(existsSync(manifestPath), 'pipeline manifest must exist');
assert.ok(existsSync(witnessPath), 'pipeline-witness.mjs must provide a runnable pipeline witness');

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
assert.equal(manifest.schema, 'kaminos.pipeline-manifest.v0');
assert.ok(Array.isArray(manifest.pipelines), 'manifest must list pipelines');

const fixturePipeline = manifest.pipelines.find(pipeline => pipeline.id === 'evil-orb-sharp-fixture-pbr-v0');
assert.ok(fixturePipeline, 'manifest must include the evil orb fixture-backed SHARP/PBR pipeline');
assert.equal(fixturePipeline.routeId, 'fixture.sharp-splat-pbr-sidecar.v0');
assert.ok(Array.isArray(fixturePipeline.stages) && fixturePipeline.stages.length >= 2, 'fixture pipeline must be a chain, not a single opaque step');
assert.ok(fixturePipeline.stages.some(stage => stage.statusMode === 'fixture'), 'fixture pipeline must explicitly mark fixture-backed stages');
assert.ok(fixturePipeline.artifacts?.input?.role === 'source-image', 'manifest must name source image input artifact role');
assert.ok(fixturePipeline.artifacts?.splat?.role === 'splat-candidate', 'manifest must name splat candidate output role');
assert.ok(fixturePipeline.artifacts?.sidecar?.role === 'kaminos-import-sidecar', 'manifest must name Kaminos import sidecar output role');

const tempRoot = mkdtempSync(join(tmpdir(), 'kaminos-pipeline-contract-'));
try {
  const inputPath = join(tempRoot, 'evil-orb-source.fixture');
  const outDir = join(tempRoot, 'out-a');
  const reportPath = join(tempRoot, 'reports', 'witness.json');
  writeFileSync(inputPath, 'fixture source image bytes\n');

  const result = spawnSync(process.execPath, [
    witnessPath,
    '--manifest', manifestPath,
    '--pipeline-id', fixturePipeline.id,
    '--input', inputPath,
    '--out-dir', outDir,
    '--report', reportPath,
  ], { encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.ok(existsSync(reportPath), 'witness must write the requested report path');

  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  assert.equal(report.schema, 'kaminos.pipeline-witness.v0');
  assert.equal(report.ok, true);
  assert.equal(report.requestedPipelineId, fixturePipeline.id);
  assert.equal(report.effectivePipelineId, fixturePipeline.id);
  assert.equal(report.effectiveRouteConfig.routeId, fixturePipeline.routeId);
  assert.equal(report.effectiveRouteConfig.manifestPath, manifestPath);
  assert.ok(/^[a-f0-9]{64}$/.test(report.effectiveRouteConfig.manifestSha256), 'witness must record manifest content identity');
  assert.equal(report.effectiveRouteConfig.outputRoot, outDir);
  assert.equal(report.artifacts.input.path, inputPath);
  assert.equal(report.artifacts.splat.status, 'fixture');
  assert.equal(report.artifacts.sidecar.status, 'fixture');
  assert.ok(report.artifacts.splat.path.startsWith(outDir), 'splat output must live under caller-provided out-dir');
  assert.ok(report.artifacts.sidecar.path.startsWith(outDir), 'sidecar output must live under caller-provided out-dir');
  assert.ok(existsSync(report.artifacts.splat.path), 'witness must write the fixture splat artifact');
  assert.ok(existsSync(report.artifacts.sidecar.path), 'witness must write the import sidecar artifact');
  assert.equal(report.stages.length, fixturePipeline.stages.length);
  assert.deepEqual(new Set(report.stages.map(stage => stage.status)), new Set(['fixture']));
  assert.ok(report.stages.every(stage => stage.requestedRoute && stage.effectiveRoute), 'each stage must record requested and effective route identity');
  assert.ok(report.stages.every(stage => !stage.outputPath || stage.outputPath.startsWith(outDir)), 'stage outputs must not use singleton paths');

  const sidecar = JSON.parse(readFileSync(report.artifacts.sidecar.path, 'utf8'));
  assert.equal(sidecar.schema, 'kaminos.pipeline-import-sidecar.v0');
  assert.equal(sidecar.pipeline.id, fixturePipeline.id);
  assert.equal(sidecar.pipeline.routeId, fixturePipeline.routeId);
  assert.equal(sidecar.source.inputPath, inputPath);
  assert.equal(sidecar.asset.type, 'splat');
  assert.equal(sidecar.asset.renderCapabilities.realHybridRender, false, 'fixture sidecar must not claim real hybrid rendering');

  const rerunReportPath = join(tempRoot, 'reports', 'witness-rerun.json');
  const rerun = spawnSync(process.execPath, [
    witnessPath,
    '--manifest', manifestPath,
    '--pipeline-id', fixturePipeline.id,
    '--input', inputPath,
    '--out-dir', outDir,
    '--report', rerunReportPath,
  ], { encoding: 'utf8' });

  assert.equal(rerun.status, 0, rerun.stderr || rerun.stdout);
  const rerunReport = JSON.parse(readFileSync(rerunReportPath, 'utf8'));
  assert.ok(rerunReport.stages.every(stage => stage.status === 'cached'), 'rerun over same output root must report cached stages');
  assert.ok(rerunReport.artifacts.splat.status === 'cached', 'cached splat artifact must not look freshly produced');
  assert.ok(rerunReport.artifacts.sidecar.status === 'cached', 'cached sidecar artifact must not look freshly produced');

  const failedReportPath = join(tempRoot, 'reports', 'failed.json');
  const failed = spawnSync(process.execPath, [
    witnessPath,
    '--manifest', manifestPath,
    '--pipeline-id', 'missing-pipeline-id',
    '--input', inputPath,
    '--out-dir', join(tempRoot, 'out-b'),
    '--report', failedReportPath,
  ], { encoding: 'utf8' });

  assert.notEqual(failed.status, 0, 'unknown pipeline id must fail');
  assert.ok(existsSync(failedReportPath), 'witness must write a failure report before primary output exists');
  const failedReport = JSON.parse(readFileSync(failedReportPath, 'utf8'));
  assert.equal(failedReport.ok, false);
  assert.equal(failedReport.requestedPipelineId, 'missing-pipeline-id');
  assert.equal(failedReport.phase, 'selecting-pipeline');
  assert.match(failedReport.error, /missing-pipeline-id/);
  assert.ok(failedReport.lastTrustworthyEvidence.manifestPath.endsWith(basename(manifestPath)), 'failure report must preserve last trustworthy manifest evidence');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
