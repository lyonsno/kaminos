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

const preparedPipeline = manifest.pipelines.find(pipeline => pipeline.id === 'prepared-splat-import-sidecar-v0');
assert.ok(preparedPipeline, 'manifest must include a route for existing splat import sidecar authoring');
assert.match(preparedPipeline.label, /Existing Splat/i, 'prepared route label must say it works on an existing splat');
assert.match(preparedPipeline.label, /Write.*Sidecar|Sidecar.*Write/i, 'prepared route label must say it writes a sidecar');
assert.match(preparedPipeline.description, /does not generate a new splat/i, 'prepared route description must not imply a new visual asset is produced');
assert.match(preparedPipeline.description, /Load Source/i, 'prepared route description must point the operator at loading the source asset after the run');

const tempRoot = mkdtempSync(join(tmpdir(), 'kaminos-pipeline-contract-'));
try {
  const inputPath = join(tempRoot, 'evil-orb-source.fixture');
  const fixtureSplatPath = join(tempRoot, 'evil-orb-sharp-fixture-source.ply');
  const outDir = join(tempRoot, 'out-a');
  const reportPath = join(tempRoot, 'reports', 'witness.json');
  writeFileSync(inputPath, 'fixture source image bytes\n');
  writeFileSync(fixtureSplatPath, [
    'ply',
    'format ascii 1.0',
    'comment configured sharp fixture source',
    'element vertex 123',
    'property float x',
    'property float y',
    'property float z',
    'property float f_dc_0',
    'property float opacity',
    'end_header',
    '0 0 0 1 1',
    '',
  ].join('\n'));

  const result = spawnSync(process.execPath, [
    witnessPath,
    '--manifest', manifestPath,
    '--pipeline-id', fixturePipeline.id,
    '--input', inputPath,
    '--out-dir', outDir,
    '--report', reportPath,
  ], {
    encoding: 'utf8',
    env: {
      ...process.env,
      KAMINOS_SHARP_FIXTURE_SPLAT: fixtureSplatPath,
    },
  });

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
  assert.equal(report.bundleIndex.path, join(outDir, 'pipeline-run.index.json'));
  assert.equal(report.bundleIndex.status, 'written');
  assert.equal(report.artifacts.input.path, inputPath);
  assert.equal(report.artifacts.splat.status, 'fixture');
  assert.equal(report.artifacts.sidecar.status, 'fixture');
  assert.ok(report.artifacts.splat.path.startsWith(outDir), 'splat output must live under caller-provided out-dir');
  assert.ok(report.artifacts.sidecar.path.startsWith(outDir), 'sidecar output must live under caller-provided out-dir');
  assert.ok(existsSync(report.artifacts.splat.path), 'witness must write the fixture splat artifact');
  assert.ok(existsSync(report.artifacts.sidecar.path), 'witness must write the import sidecar artifact');
  const copiedFixtureSplat = readFileSync(report.artifacts.splat.path, 'utf8');
  assert.match(copiedFixtureSplat, /element vertex 123/, 'configured SHARP fixture route must copy a visible fixture splat instead of one-vertex placeholder output');
  assert.match(copiedFixtureSplat, /property float f_dc_0/, 'configured SHARP fixture route must preserve gaussian-splat-like fixture properties');
  assert.equal(report.stages.length, fixturePipeline.stages.length);
  assert.deepEqual(new Set(report.stages.map(stage => stage.status)), new Set(['fixture']));
  assert.ok(report.stages.every(stage => stage.requestedRoute && stage.effectiveRoute), 'each stage must record requested and effective route identity');
  assert.equal(report.stages[0].effectiveRoute.fixtureSource, fixtureSplatPath, 'SHARP fixture stage must record copied fixture source identity');
  assert.ok(report.stages.every(stage => !stage.outputPath || stage.outputPath.startsWith(outDir)), 'stage outputs must not use singleton paths');
  assert.ok(existsSync(report.bundleIndex.path), 'witness must write a per-run bundle index');

  const bundleIndex = JSON.parse(readFileSync(report.bundleIndex.path, 'utf8'));
  assert.equal(bundleIndex.schema, 'kaminos.pipeline-run-bundle.v0');
  assert.equal(bundleIndex.pipeline.id, fixturePipeline.id);
  assert.equal(bundleIndex.pipeline.routeId, fixturePipeline.routeId);
  assert.equal(bundleIndex.outputRoot, outDir);
  assert.equal(bundleIndex.report.path, reportPath);
  assert.equal(bundleIndex.report.status, 'written');
  assert.deepEqual(bundleIndex.stageStatuses, report.stages.map(stage => ({
    id: stage.id,
    status: stage.status,
    routeId: stage.requestedRoute,
  })));
  assert.ok(bundleIndex.artifacts.some(artifact => artifact.id === 'sidecar' && artifact.role === 'kaminos-import-sidecar'), 'bundle index must list sidecar artifacts by role');
  assert.equal(bundleIndex.artifacts.find(artifact => artifact.id === 'splat')?.fixtureSource?.path, fixtureSplatPath, 'bundle index must keep SHARP fixture source provenance with the splat artifact');
  assert.ok(bundleIndex.artifacts.every(artifact => artifact.id === 'input' || artifact.path.startsWith(outDir)), 'bundle index must keep generated artifacts caller-rooted');
  assert.equal(bundleIndex.registryScope, 'run-local', 'bundle index must not claim to be a global sidecar registry');

  const sidecar = JSON.parse(readFileSync(report.artifacts.sidecar.path, 'utf8'));
  assert.equal(sidecar.schema, 'kaminos.pipeline-import-sidecar.v0');
  assert.equal(sidecar.pipeline.id, fixturePipeline.id);
  assert.equal(sidecar.pipeline.routeId, fixturePipeline.routeId);
  assert.equal(sidecar.source.inputPath, inputPath);
  assert.equal(sidecar.asset.type, 'splat');
  assert.equal(sidecar.asset.fixtureSource?.path, fixtureSplatPath, 'sidecar must preserve SHARP fixture source identity');
  assert.equal(sidecar.asset.fixtureSource?.stageMode, 'fixture', 'sidecar must label copied SHARP output as fixture-backed');
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

  const preparedInputPath = join(tempRoot, 'prepared-existing-splat.ply');
  const preparedOutDir = join(tempRoot, 'prepared-out');
  const preparedReportPath = join(tempRoot, 'reports', 'prepared.json');
  writeFileSync(preparedInputPath, [
    'ply',
    'format ascii 1.0',
    'element vertex 1',
    'property float x',
    'property float y',
    'property float z',
    'end_header',
    '0 0 0',
    '',
  ].join('\n'));

  const prepared = spawnSync(process.execPath, [
    witnessPath,
    '--manifest', manifestPath,
    '--pipeline-id', 'prepared-splat-import-sidecar-v0',
    '--input', preparedInputPath,
    '--out-dir', preparedOutDir,
    '--report', preparedReportPath,
  ], { encoding: 'utf8' });

  assert.equal(prepared.status, 0, prepared.stderr || prepared.stdout);
  const preparedReport = JSON.parse(readFileSync(preparedReportPath, 'utf8'));
  assert.equal(preparedReport.ok, true);
  assert.equal(preparedReport.effectiveRouteConfig.routeId, 'prepared.splat-import-sidecar.v0');
  assert.ok(existsSync(preparedReport.bundleIndex.path), 'prepared route must write a bundle index');
  assert.deepEqual(preparedReport.stages.map(stage => stage.status), ['real', 'real']);
  assert.equal(preparedReport.artifacts.input.status, 'requested');
  assert.equal(preparedReport.artifacts.inspection.status, 'real');
  assert.equal(preparedReport.artifacts.sidecar.status, 'real');
  assert.ok(preparedReport.artifacts.inspection.path.startsWith(preparedOutDir), 'prepared inspection output must use caller out-dir');
  assert.ok(preparedReport.artifacts.sidecar.path.startsWith(preparedOutDir), 'prepared sidecar output must use caller out-dir');
  const inspection = JSON.parse(readFileSync(preparedReport.artifacts.inspection.path, 'utf8'));
  assert.equal(inspection.schema, 'kaminos.prepared-artifact-inspection.v0');
  assert.equal(inspection.artifact.path, preparedInputPath);
  assert.equal(inspection.artifact.kind, 'splat');
  assert.equal(inspection.artifact.extension, '.ply');
  const preparedSidecar = JSON.parse(readFileSync(preparedReport.artifacts.sidecar.path, 'utf8'));
  assert.equal(preparedSidecar.schema, 'kaminos.pipeline-import-sidecar.v0');
  assert.equal(preparedSidecar.pipeline.id, 'prepared-splat-import-sidecar-v0');
  assert.equal(preparedSidecar.pipeline.routeId, 'prepared.splat-import-sidecar.v0');
  assert.equal(preparedSidecar.source.inputPath, preparedInputPath);
  assert.equal(preparedSidecar.asset.type, 'splat');
  assert.equal(preparedSidecar.asset.path, preparedInputPath);
  assert.equal(preparedSidecar.asset.renderCapabilities.realHybridRender, false, 'prepared sidecar must not claim real hybrid rendering');
  assert.equal(preparedSidecar.status.stageMode, 'prepared-artifact');
  const preparedBundle = JSON.parse(readFileSync(preparedReport.bundleIndex.path, 'utf8'));
  assert.ok(preparedBundle.artifacts.some(artifact => artifact.id === 'inspection' && artifact.role === 'prepared-artifact-inspection'), 'prepared bundle must list inspection artifact');
  assert.ok(preparedBundle.artifacts.some(artifact => artifact.id === 'sidecar' && artifact.role === 'kaminos-import-sidecar'), 'prepared bundle must list import sidecar');

  const adapterOutDir = join(tempRoot, 'adapter-out');
  const adapterReportPath = join(tempRoot, 'reports', 'adapters.json');
  const adapterEnv = {
    ...process.env,
    KAMINOS_SHARP_COMMAND: '',
    KAMINOS_MOGE_COMMAND: '',
    KAMINOS_SUPERMAT_COMMAND: '',
  };
  const adapters = spawnSync(process.execPath, [
    witnessPath,
    '--manifest', manifestPath,
    '--pipeline-id', 'live-model-route-adapter-check-v0',
    '--input', inputPath,
    '--out-dir', adapterOutDir,
    '--report', adapterReportPath,
  ], { encoding: 'utf8', env: adapterEnv });

  assert.equal(adapters.status, 0, adapters.stderr || adapters.stdout);
  const adapterReport = JSON.parse(readFileSync(adapterReportPath, 'utf8'));
  assert.equal(adapterReport.ok, true);
  assert.equal(adapterReport.effectiveRouteConfig.routeId, 'adapter.model-chain-availability.v0');
  assert.ok(existsSync(adapterReport.bundleIndex.path), 'adapter route must write a bundle index');
  assert.deepEqual(adapterReport.stages.map(stage => stage.status), ['skipped', 'skipped', 'skipped']);
  assert.ok(adapterReport.stages.every(stage => stage.effectiveRoute.availability?.status === 'unconfigured'), 'unconfigured live adapters must be explicit');
  assert.ok(adapterReport.stages.every(stage => stage.effectiveRoute.availability?.envVar?.startsWith('KAMINOS_')), 'adapter checks must record env/config identity');
  assert.ok(adapterReport.stages.every(stage => stage.outputPath.startsWith(adapterOutDir)), 'adapter reports must use caller out-dir');
  const adapterArtifacts = ['sharpAdapter', 'mogeAdapter', 'supermatAdapter'];
  for (const artifactName of adapterArtifacts) {
    assert.equal(adapterReport.artifacts[artifactName].status, 'skipped');
    const adapterArtifact = JSON.parse(readFileSync(adapterReport.artifacts[artifactName].path, 'utf8'));
    assert.equal(adapterArtifact.schema, 'kaminos.route-adapter-availability.v0');
    assert.equal(adapterArtifact.availability.status, 'unconfigured');
    assert.equal(adapterArtifact.execution.executed, false, 'availability checks must not execute live model routes');
  }
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
