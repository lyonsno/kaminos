import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

const liveSharpPipeline = manifest.pipelines.find(pipeline => pipeline.id === 'sharp-image-to-splat-live-v0');
assert.ok(liveSharpPipeline, 'manifest must include a live SHARP image-to-splat route distinct from the fixture route');
assert.equal(liveSharpPipeline.routeId, 'adapter.sharp-image-to-splat-live.v0');
assert.match(liveSharpPipeline.description, /KAMINOS_SHARP_COMMAND/, 'live SHARP route must name its explicit command configuration');
assert.ok(liveSharpPipeline.stages.some(stage => stage.statusMode === 'model-adapter' && stage.route?.commandEnv === 'KAMINOS_SHARP_COMMAND' && stage.route?.executesModel === true), 'live SHARP route must execute an explicit model adapter command');
assert.ok(liveSharpPipeline.artifacts?.splat?.pathTemplate && !liveSharpPipeline.artifacts.splat.pathTemplate.startsWith('/'), 'live SHARP splat output must be caller-rooted');
assert.equal(liveSharpPipeline.artifacts?.autoCropEvidence?.role, 'splat-autocrop-evidence', 'live SHARP route must declare autocrop evidence as a first-class artifact');
assert.equal(liveSharpPipeline.artifacts?.autoCropEvidence?.schema, 'kaminos.splat-autocrop-evidence.v0', 'live SHARP autocrop evidence must carry a schema');
assert.ok(liveSharpPipeline.artifacts?.autoCropEvidence?.pathTemplate && !liveSharpPipeline.artifacts.autoCropEvidence.pathTemplate.startsWith('/'), 'live SHARP autocrop evidence must be caller-rooted');
assert.ok(liveSharpPipeline.artifacts?.sidecar?.pathTemplate && !liveSharpPipeline.artifacts.sidecar.pathTemplate.startsWith('/'), 'live SHARP sidecar output must be caller-rooted');
assert.deepEqual(liveSharpPipeline.stages[0].requiredSideArtifacts, ['depthMap', 'metadata', 'autoCropEvidence'], 'live SHARP stage must fail loud if autocrop evidence is missing');

const preparedPipeline = manifest.pipelines.find(pipeline => pipeline.id === 'prepared-splat-import-sidecar-v0');
assert.ok(preparedPipeline, 'manifest must include a route for existing splat import sidecar authoring');
assert.match(preparedPipeline.label, /Existing Splat/i, 'prepared route label must say it works on an existing splat');
assert.match(preparedPipeline.label, /Write.*Sidecar|Sidecar.*Write/i, 'prepared route label must say it writes a sidecar');
assert.match(preparedPipeline.description, /does not generate a new splat/i, 'prepared route description must not imply a new visual asset is produced');
assert.match(preparedPipeline.description, /Load Source/i, 'prepared route description must point the operator at loading the source asset after the run');

const selectedViewBakePipeline = manifest.pipelines.find(pipeline => pipeline.id === 'selected-splat-view-bake-layer-v0');
assert.ok(selectedViewBakePipeline, 'manifest must include a selected-splat current-view bake-layer route');
assert.equal(selectedViewBakePipeline.routeId, 'selected-splat.view-bake-layer.v0');
assert.equal(selectedViewBakePipeline.artifacts?.layerPayload?.role, 'selected-view-pbr-layer', 'selected-view bake route must declare a real per-splat PBR layer payload');
assert.ok(selectedViewBakePipeline.stages.some(stage => stage.statusMode === 'model-adapter' && stage.route?.executesModel === true && stage.outputArtifact === 'layerPayload'), 'selected-view bake route must execute a real model adapter instead of stopping at a receipt');
assert.equal(selectedViewBakePipeline.artifacts?.requestContext?.schema, 'kaminos.selected-splat-view-bake-request.v0', 'selected-view bake route must declare request context as a first-class artifact');
assert.equal(selectedViewBakePipeline.artifacts?.layerReceipt?.schema, 'kaminos.selected-splat-view-bake-layer.pipeline-receipt.v0', 'selected-view bake route must declare its layer receipt artifact');
assert.ok(selectedViewBakePipeline.stages.some(stage => stage.statusMode === 'selected-view-bake-request-context' && stage.outputArtifact === 'requestContext'), 'selected-view bake route must preserve request context through the witness');
assert.ok(selectedViewBakePipeline.stages.some(stage => stage.statusMode === 'selected-view-bake-receipt' && stage.outputArtifact === 'layerReceipt'), 'selected-view bake route must write a layer receipt artifact');

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

  const selectedViewContextPath = join(tempRoot, 'selected-view-request-context.json');
  const selectedViewOutDir = join(tempRoot, 'selected-view-out');
  const selectedViewReportPath = join(tempRoot, 'reports', 'selected-view-bake.json');
  const selectedViewAdapterPath = join(tempRoot, 'mock-selected-view-bake-adapter.mjs');
  writeFileSync(selectedViewAdapterPath, `#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
const output = args.get('--output');
const report = args.get('--report');
mkdirSync(dirname(output), { recursive: true });
mkdirSync(dirname(report), { recursive: true });
writeFileSync(output, 'mock selected-view per-splat layer payload\\n');
writeFileSync(report, JSON.stringify({
  schema: 'mock.selected-splat-view-bake-adapter-report.v0',
  ok: true,
  backend: { modelFamily: 'Lotus-D', runtime: 'mock-adapter' },
  output: { path: output },
}, null, 2) + '\\n');
`);
  chmodSync(selectedViewAdapterPath, 0o755);
  writeFileSync(selectedViewContextPath, JSON.stringify({
    schema: 'kaminos.selected-splat-view-bake-request.v0',
    layerId: 'layer-contract',
    targetObjectId: 'splat-contract',
    camera: { schema: 'kaminos.splat-bake-layer.camera.v0', position: [1, 2, 3], viewport: { width: 640, height: 480 } },
    rendererControls: { schema: 'hybrid-render.splat-renderer-controls.v0', material: { roughness: { contrast: 1.25 } } },
  }, null, 2));

  const selectedViewBake = spawnSync(process.execPath, [
    witnessPath,
    '--manifest', manifestPath,
    '--pipeline-id', 'selected-splat-view-bake-layer-v0',
    '--input', preparedInputPath,
    '--out-dir', selectedViewOutDir,
    '--report', selectedViewReportPath,
    '--request-context', selectedViewContextPath,
  ], {
    encoding: 'utf8',
    env: {
      ...process.env,
      KAMINOS_SELECTED_SPLAT_VIEW_BAKE_COMMAND: selectedViewAdapterPath,
    },
  });

  assert.equal(selectedViewBake.status, 0, selectedViewBake.stderr || selectedViewBake.stdout);
  const selectedViewReport = JSON.parse(readFileSync(selectedViewReportPath, 'utf8'));
  assert.equal(selectedViewReport.ok, true);
  assert.equal(selectedViewReport.effectiveRouteConfig.routeId, 'selected-splat.view-bake-layer.v0');
  assert.equal(selectedViewReport.artifacts.requestContext.status, 'real');
  assert.equal(selectedViewReport.artifacts.layerPayload.status, 'fixture', 'mock selected-view adapter output must remain fixture-labeled in contract tests');
  assert.equal(selectedViewReport.artifacts.layerPayload.role, 'selected-view-pbr-layer');
  assert.equal(selectedViewReport.artifacts.layerReceipt.status, 'real');
  assert.ok(selectedViewReport.artifacts.requestContext.path.startsWith(selectedViewOutDir), 'selected-view request context artifact must be caller-rooted');
  assert.ok(selectedViewReport.artifacts.layerReceipt.path.startsWith(selectedViewOutDir), 'selected-view layer receipt artifact must be caller-rooted');
  const selectedViewRequestContext = JSON.parse(readFileSync(selectedViewReport.artifacts.requestContext.path, 'utf8'));
  assert.equal(selectedViewRequestContext.schema, 'kaminos.selected-splat-view-bake-request.v0');
  assert.equal(selectedViewRequestContext.layerId, 'layer-contract');
  assert.equal(selectedViewRequestContext.camera.position[2], 3);
  const selectedViewLayerReceipt = JSON.parse(readFileSync(selectedViewReport.artifacts.layerReceipt.path, 'utf8'));
  assert.equal(selectedViewLayerReceipt.schema, 'kaminos.selected-splat-view-bake-layer.pipeline-receipt.v0');
  assert.equal(selectedViewLayerReceipt.pipeline.id, 'selected-splat-view-bake-layer-v0');
  assert.equal(selectedViewLayerReceipt.pipeline.routeId, 'selected-splat.view-bake-layer.v0');
  assert.equal(selectedViewLayerReceipt.source.inputPath, preparedInputPath);
  assert.equal(selectedViewLayerReceipt.requestContext.layerId, 'layer-contract');
  assert.equal(selectedViewLayerReceipt.outputAuthority, 'model-baked-layer-payload');

  const liveMissingOutDir = join(tempRoot, 'live-missing-out');
  const liveMissingReportPath = join(tempRoot, 'reports', 'live-missing.json');
  const liveMissing = spawnSync(process.execPath, [
    witnessPath,
    '--manifest', manifestPath,
    '--pipeline-id', 'sharp-image-to-splat-live-v0',
    '--input', inputPath,
    '--out-dir', liveMissingOutDir,
    '--report', liveMissingReportPath,
  ], {
    encoding: 'utf8',
    env: {
      ...process.env,
      KAMINOS_SHARP_COMMAND: '',
      KAMINOS_SHARP_WEBGPU_REPO: join(tempRoot, 'missing-sharp-webgpu'),
    },
  });

  assert.notEqual(liveMissing.status, 0, 'live SHARP route must fail when the native SHARP-WebGPU substrate is unavailable');
  assert.ok(existsSync(liveMissingReportPath), 'unavailable native SHARP must still write a failure report');
  const liveMissingReport = JSON.parse(readFileSync(liveMissingReportPath, 'utf8'));
  assert.equal(liveMissingReport.ok, false);
  assert.equal(liveMissingReport.requestedPipelineId, 'sharp-image-to-splat-live-v0');
  assert.equal(liveMissingReport.effectiveRouteConfig.routeId, 'adapter.sharp-image-to-splat-live.v0');
  assert.match(liveMissingReport.error, /live model adapter exited 1/, 'live SHARP failure must name the adapter execution failure');
  assert.equal(liveMissingReport.stages[0].status, 'failed');
  assert.equal(liveMissingReport.stages[0].effectiveRoute.realModel, true, 'failed live SHARP stage must still record the requested real backend identity');
  assert.equal(liveMissingReport.stages[0].effectiveRoute.availability.status, 'available');
  assert.equal(liveMissingReport.stages[0].effectiveRoute.availability.source, 'default');
  assert.match(liveMissingReport.stages[0].effectiveRoute.stderrTail, /SHARP-WebGPU repo does not exist/, 'adapter stderr must name the missing native substrate');
  assert.equal(liveMissingReport.stages[0].effectiveRoute.pipelineScheduler.schema, 'kaminos.pipeline-scheduler-composition.v0');
  assert.equal(liveMissingReport.stages[0].effectiveRoute.pipelineScheduler.source, 'pipeline-adapter-report');
  assert.equal(liveMissingReport.stages[0].effectiveRoute.pipelineScheduler.verificationState, 'scheduler-unverified');
  assert.equal(liveMissingReport.stages[0].effectiveRoute.pipelineScheduler.requestedScheduler.mode, 'default');
  assert.equal(liveMissingReport.stages[0].effectiveRoute.pipelineScheduler.effectiveScheduler, null);
  assert.equal(liveMissingReport.stages[0].effectiveRoute.pipelineScheduler.scheduler.schema, 'kaminos.webgpu-route-scheduler.v0');
  assert.equal(liveMissingReport.stages[0].effectiveRoute.pipelineScheduler.scheduler.requestedScheduler.mode, 'throughput');
  assert.equal(liveMissingReport.stages[0].effectiveRoute.pipelineScheduler.scheduler.verificationState, 'scheduler-unverified');
  assert.equal(liveMissingReport.stages[0].effectiveRoute.pipelineScheduler.scheduler.effectiveScheduler.unsupportedFields.includes('phaseChunkSize'), true);
  assert.equal(liveMissingReport.stages[0].effectiveRoute.pipelineScheduler.scheduler.breathability.spans.length, 5);
  assert.equal(liveMissingReport.stages[0].effectiveRoute.pipelineScheduler.scheduler.breathability.checkpoints.length, 5);
  assert.equal(liveMissingReport.stages[0].effectiveRoute.pipelineScheduler.scheduler.breathability.spans[0].kind, 'gpu-submit-bound');
  assert.equal(liveMissingReport.stages[0].effectiveRoute.pipelineScheduler.backpressure.schema, 'kaminos.webgpu-route-backpressure.v0');
  assert.equal(liveMissingReport.stages[0].effectiveRoute.pipelineScheduler.raw.breathingRoom.status, 'scheduler-unverified');
  assert.deepEqual(liveMissingReport.stages[0].effectiveRoute.pipelineScheduler.failureDowngrades, ['effective-scheduler-missing']);
  assert.equal(existsSync(join(liveMissingOutDir, 'artifacts', 'sharp-output.ply')), false, 'failed native SHARP must not write a placeholder PLY');

  const mockSharpCommand = join(tempRoot, 'mock-sharp-command.mjs');
  writeFileSync(mockSharpCommand, `#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
const input = args.get('--input');
const output = args.get('--output');
const report = args.get('--report');
if (!input || !output || !report) throw new Error('mock SHARP expected --input --output --report');
const bytes = readFileSync(input);
const hash = createHash('sha256').update(bytes).digest('hex');
const artifactPaths = JSON.parse(process.env.KAMINOS_PIPELINE_ARTIFACT_PATHS || '{}');
const depthPath = artifactPaths.depthMap;
const metadataPath = artifactPaths.metadata;
const autoCropEvidencePath = artifactPaths.autoCropEvidence;
if (!depthPath || !metadataPath || !autoCropEvidencePath) throw new Error('mock SHARP expected manifest side artifact paths');
const points = [];
for (let y = 0; y < 27; y += 1) {
  for (let x = 0; x < 27; x += 1) {
    const nx = (x - 13) / 13;
    const ny = (y - 13) / 13;
    const radius = Math.hypot(nx, ny);
    const z = Math.cos(radius * Math.PI) * 0.18;
    const red = Math.round(80 + 175 * Math.max(0, 1 - radius * 0.55));
    const green = Math.round(80 + 140 * Math.max(0, 1 - Math.abs(nx)));
    const blue = Math.round(120 + 100 * Math.max(0, 1 - Math.abs(ny)));
    points.push(\`\${nx.toFixed(4)} \${ny.toFixed(4)} \${z.toFixed(4)} \${red} \${green} \${blue}\`);
  }
}
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, [
  'ply',
  'format ascii 1.0',
  'comment mock live SHARP output',
  'comment source_sha256 ' + hash,
  'element vertex ' + points.length,
  'property float x',
  'property float y',
  'property float z',
  'property uchar red',
  'property uchar green',
  'property uchar blue',
  'end_header',
  ...points,
  ''
].join('\\n'));
mkdirSync(dirname(depthPath), { recursive: true });
writeFileSync(depthPath, 'mock sharp depth png bytes\\n');
mkdirSync(dirname(metadataPath), { recursive: true });
writeFileSync(metadataPath, JSON.stringify({
  schema: 'kaminos.sharp-webgpu-metadata.v0',
  input: { path: input, sha256: hash },
  output: { path: output },
  depthMap: { path: depthPath }
}, null, 2) + '\\n');
mkdirSync(dirname(autoCropEvidencePath), { recursive: true });
writeFileSync(autoCropEvidencePath, JSON.stringify({
  schema: 'kaminos.splat-autocrop-evidence.v0',
  status: 'complete',
  authority: {
    freshness: 'fresh',
    evidenceMode: 'fixture-derived-from-generated-ply-and-depth',
    downgrades: ['mock-adapter-fixture-not-real-sharp-inference']
  },
  sourceImage: { path: input, sha256: hash },
  generated: {
    ply: { path: output },
    sidecar: { path: artifactPaths.sidecar || null, routeIdentity: 'sharp-image-to-splat-live-v0' }
  },
  sharp: {
    depthMap: { path: depthPath },
    metadata: { path: metadataPath }
  },
  cropSignal: {
    provenance: 'mock adapter generated point bounds',
    bounds: {
      min: { x: -1, y: -1, z: -0.18 },
      max: { x: 1, y: 1, z: 0.18 }
    },
    suggestedPivot: { x: 0, y: 0, z: 0 },
    candidateCrop: { min: { x: -1, y: -1 }, max: { x: 1, y: 1 }, units: 'normalized-image' }
  },
  rejectedDebugSurfaces: []
}, null, 2) + '\\n');
const stat = statSync(output);
mkdirSync(dirname(report), { recursive: true });
writeFileSync(report, JSON.stringify({
  schema: 'mock.sharp-adapter-report.v0',
  ok: true,
  backend: {
    modelFamily: 'SHARP-WebGPU',
    runtime: 'mock-adapter',
    schedulerMode: {
      requested: 'friendly',
      effective: 'friendly',
      profileId: 'cooperative-spn-gaussian'
    }
  },
  input,
  output,
  inputSha256: hash,
  outputBytes: stat.size,
  breathingRoom: {
    schema: 'kaminos.sharp-webgpu-scheduler-evidence.v0',
    status: 'verified',
    schedulerMode: {
      requested: 'friendly',
      effective: 'friendly',
      profileId: 'cooperative-spn-gaussian'
    },
    requestedScheduler: {
      mode: 'cooperative',
      spnPatchChunkSize: 1,
      yieldMs: 2,
      waitForSubmittedWorkDone: true,
      gaussianPhaseYieldMs: 3,
      vitBlockChunkSize: 2
    },
    effectiveScheduler: {
      mode: 'cooperative',
      spnPatchChunkSize: 1,
      yieldMs: 2,
      waitForSubmittedWorkDone: true,
      gaussianPhaseYieldMs: 3,
      vitBlockChunkSize: null
    },
    unsupportedFields: ['vitBlockChunkSize'],
    telemetry: {
      schema: 'sharp-webgpu.scheduler-telemetry.v0',
      status: 'verified',
      events: [{ phase: 'spn-patch-chunk', yieldMs: 2 }]
    }
  },
  sideArtifacts: [
    { id: 'depthMap', role: 'depth-map', path: depthPath },
    { id: 'metadata', role: 'sharp-webgpu-metadata', path: metadataPath },
    { id: 'autoCropEvidence', role: 'splat-autocrop-evidence', path: autoCropEvidencePath, schema: 'kaminos.splat-autocrop-evidence.v0' }
  ],
  outputs: {
    splat: { id: 'splat', role: 'splat-candidate', path: output },
    depthMap: { id: 'depthMap', role: 'depth-map', path: depthPath },
    metadata: { id: 'metadata', role: 'sharp-webgpu-metadata', path: metadataPath },
    autoCropEvidence: { id: 'autoCropEvidence', role: 'splat-autocrop-evidence', path: autoCropEvidencePath, schema: 'kaminos.splat-autocrop-evidence.v0' }
  }
}, null, 2) + '\\n');
`);
  chmodSync(mockSharpCommand, 0o755);
  const liveOutDir = join(tempRoot, 'live-out');
  const liveReportPath = join(tempRoot, 'reports', 'live.json');
  const live = spawnSync(process.execPath, [
    witnessPath,
    '--manifest', manifestPath,
    '--pipeline-id', 'sharp-image-to-splat-live-v0',
    '--input', inputPath,
    '--out-dir', liveOutDir,
    '--report', liveReportPath,
  ], {
    encoding: 'utf8',
    env: {
      ...process.env,
      KAMINOS_SHARP_COMMAND: mockSharpCommand,
    },
  });

  assert.equal(live.status, 0, live.stderr || live.stdout);
  const liveReport = JSON.parse(readFileSync(liveReportPath, 'utf8'));
  assert.equal(liveReport.ok, true);
  assert.equal(liveReport.effectiveRouteConfig.routeId, 'adapter.sharp-image-to-splat-live.v0');
  assert.deepEqual(liveReport.stages.map(stage => stage.status), ['fixture', 'fixture']);
  assert.equal(liveReport.stages[0].effectiveRoute.realModel, false);
  assert.equal(liveReport.stages[0].effectiveRoute.requestedRealModel, true);
  assert.equal(liveReport.stages[0].effectiveRoute.adapterReport.schema, 'mock.sharp-adapter-report.v0');
  assert.equal(liveReport.stages[0].effectiveRoute.adapterReport.backend.schedulerMode.requested, 'friendly');
  assert.equal(liveReport.stages[0].effectiveRoute.adapterReport.backend.schedulerMode.effective, 'friendly');
  assert.equal(liveReport.stages[0].effectiveRoute.adapterReport.breathingRoom.status, 'verified');
  assert.equal(liveReport.stages[0].effectiveRoute.adapterReport.breathingRoom.schedulerMode.requested, 'friendly');
  assert.equal(liveReport.stages[0].effectiveRoute.adapterReport.breathingRoom.requestedScheduler.spnPatchChunkSize, 1);
  assert.equal(liveReport.stages[0].effectiveRoute.adapterReport.breathingRoom.effectiveScheduler.spnPatchChunkSize, 1);
  assert.deepEqual(liveReport.stages[0].effectiveRoute.adapterReport.breathingRoom.unsupportedFields, ['vitBlockChunkSize']);
  assert.equal(liveReport.stages[0].effectiveRoute.adapterReport.schedulerVerification.schema, 'kaminos.webgpu-scheduler-verification-receipt.v0');
  assert.equal(liveReport.stages[0].effectiveRoute.adapterReport.schedulerVerification.boundaryAssertions.some(assertion => assertion.field === 'phaseChunkSize.vitBlock' && assertion.status === 'unsupported'), true);
  assert.equal(liveReport.stages[0].effectiveRoute.adapterReport.pipelineScheduler.schema, 'kaminos.pipeline-scheduler-composition.v0');
  assert.equal(liveReport.stages[0].effectiveRoute.adapterReport.pipelineScheduler.source, 'pipeline-adapter-report');
  assert.equal(liveReport.stages[0].effectiveRoute.adapterReport.pipelineScheduler.verificationState, 'unsupported');
  assert.equal(liveReport.stages[0].effectiveRoute.adapterReport.pipelineScheduler.schedulerMode.requested, 'friendly');
  assert.equal(liveReport.stages[0].effectiveRoute.adapterReport.pipelineScheduler.schedulerMode.effective, 'friendly');
  assert.equal(liveReport.stages[0].effectiveRoute.adapterReport.pipelineScheduler.requestedScheduler.spnPatchChunkSize, 1);
  assert.equal(liveReport.stages[0].effectiveRoute.adapterReport.pipelineScheduler.effectiveScheduler.spnPatchChunkSize, 1);
  assert.deepEqual(liveReport.stages[0].effectiveRoute.adapterReport.pipelineScheduler.unsupportedFields, ['vitBlockChunkSize']);
  assert.equal(liveReport.stages[0].effectiveRoute.adapterReport.pipelineScheduler.scheduler.schema, 'kaminos.webgpu-route-scheduler.v0');
  assert.equal(liveReport.stages[0].effectiveRoute.adapterReport.pipelineScheduler.scheduler.verificationState, 'unsupported');
  assert.equal(liveReport.stages[0].effectiveRoute.adapterReport.pipelineScheduler.scheduler.requestedScheduler.phaseChunkSize.spnPatch, 1);
  assert.equal(liveReport.stages[0].effectiveRoute.adapterReport.pipelineScheduler.scheduler.effectiveScheduler.phaseChunkSize.spnPatch, 1);
  assert.equal(liveReport.stages[0].effectiveRoute.adapterReport.pipelineScheduler.scheduler.effectiveScheduler.unsupportedFields.includes('phaseChunkSize'), true);
  assert.equal(liveReport.stages[0].effectiveRoute.adapterReport.pipelineScheduler.scheduler.breathability.spans.length, 5);
  assert.equal(liveReport.stages[0].effectiveRoute.adapterReport.pipelineScheduler.scheduler.breathability.checkpoints.length, 5);
  assert.match(liveReport.stages[0].effectiveRoute.adapterReport.pipelineScheduler.scheduler.breathability.notes, /SHARP is furnace-class/);
  assert.equal(liveReport.stages[0].effectiveRoute.adapterReport.pipelineScheduler.backpressure.schema, 'kaminos.webgpu-route-backpressure.v0');
  assert.equal(liveReport.stages[0].effectiveRoute.adapterReport.pipelineScheduler.raw.breathingRoom.status, 'verified');
  assert.deepEqual(liveReport.stages[0].effectiveRoute.adapterReport.pipelineScheduler.phaseBoundaries, ['spn-patch-chunk']);
  assert.equal(liveReport.stages[0].effectiveRoute.adapterReport.pipelineScheduler.backendIdentity.modelFamily, 'SHARP-WebGPU');
  assert.equal(liveReport.stages[0].effectiveRoute.adapterReport.pipelineScheduler.backendIdentity.runtime, 'mock-adapter');
  assert.equal(liveReport.stages[0].effectiveRoute.adapterReport.pipelineScheduler.optimizationIdentity.vitEncoderMode, 'fused');
  assert.deepEqual(liveReport.stages[0].effectiveRoute.adapterReport.pipelineScheduler.failureDowngrades, ['unsupported-fields-present']);
  assert.deepEqual(liveReport.stages[0].effectiveRoute.pipelineScheduler, liveReport.stages[0].effectiveRoute.adapterReport.pipelineScheduler);
  assert.equal(liveReport.stages[0].effectiveRoute.fixtureMode, 'mock-adapter');
  assert.match(liveReport.stages[0].effectiveRoute.truthBoundary, /mock SHARP(?:-WebGPU)? adapter fixture output/);
  assert.equal(liveReport.stages[0].effectiveRoute.availability.status, 'available');
  assert.equal(liveReport.stages[0].effectiveRoute.commandEnv, 'KAMINOS_SHARP_COMMAND');
  assert.equal(liveReport.stages[0].effectiveRoute.executedCommand[0], mockSharpCommand);
  assert.ok(liveReport.artifacts.splat.path.startsWith(liveOutDir), 'live SHARP splat output must use caller out-dir');
  assert.ok(liveReport.artifacts.autoCropEvidence.path.startsWith(liveOutDir), 'live SHARP autocrop evidence must use caller out-dir');
  assert.ok(liveReport.artifacts.sidecar.path.startsWith(liveOutDir), 'live SHARP sidecar output must use caller out-dir');
  assert.equal(liveReport.artifacts.splat.status, 'fixture');
  assert.equal(liveReport.artifacts.autoCropEvidence.status, 'fixture');
  assert.equal(liveReport.artifacts.sidecar.status, 'fixture');
  assert.equal(liveReport.artifacts.splat.fixtureSource?.mode, 'mock-adapter');
  assert.match(liveReport.artifacts.splat.fixtureSource?.truthBoundary || '', /mock SHARP(?:-WebGPU)? adapter fixture output/);
  const liveSplat = readFileSync(liveReport.artifacts.splat.path, 'utf8');
  assert.match(liveSplat, /element vertex 729/, 'configured live SHARP mock route must emit enough points to be visibly inspectable');
  assert.match(liveSplat, /property uchar red/, 'configured live SHARP mock route must emit RGB colors for the Kaminos point-cloud preview');
  assert.match(liveSplat, /mock live SHARP output/, 'configured live SHARP route must preserve adapter output bytes');
  const liveSidecar = JSON.parse(readFileSync(liveReport.artifacts.sidecar.path, 'utf8'));
  assert.equal(liveSidecar.pipeline.id, 'sharp-image-to-splat-live-v0');
  assert.equal(liveSidecar.asset.type, 'splat');
  assert.equal(liveSidecar.asset.path, liveReport.artifacts.splat.path);
  assert.equal(liveSidecar.status.stageMode, 'fixture');
  assert.match(liveSidecar.status.truthBoundary, /mock SHARP(?:-WebGPU)? adapter fixture output/);
  assert.equal(liveSidecar.asset.renderCapabilities.realHybridRender, false);
  assert.ok(liveSidecar.asset.sideArtifacts.some(artifact => artifact.id === 'autoCropEvidence' && artifact.role === 'splat-autocrop-evidence'), 'live SHARP sidecar must list autocrop evidence as a side artifact');
  const liveAutoCropEvidence = JSON.parse(readFileSync(liveReport.artifacts.autoCropEvidence.path, 'utf8'));
  assert.equal(liveAutoCropEvidence.schema, 'kaminos.splat-autocrop-evidence.v0');
  assert.equal(liveAutoCropEvidence.status, 'complete');
  assert.equal(liveAutoCropEvidence.sourceImage.path, inputPath);
  assert.equal(liveAutoCropEvidence.generated.ply.path, liveReport.artifacts.splat.path);
  assert.equal(liveAutoCropEvidence.generated.sidecar.path, liveReport.artifacts.sidecar.path);
  assert.equal(liveAutoCropEvidence.sharp.depthMap.path, liveReport.artifacts.depthMap.path);
  assert.equal(liveAutoCropEvidence.sharp.metadata.path, liveReport.artifacts.metadata.path);
  assert.deepEqual(liveAutoCropEvidence.cropSignal.suggestedPivot, { x: 0, y: 0, z: 0 });
  const liveBundle = JSON.parse(readFileSync(liveReport.bundleIndex.path, 'utf8'));
  assert.ok(liveBundle.artifacts.some(artifact => artifact.id === 'autoCropEvidence' && artifact.role === 'splat-autocrop-evidence'), 'bundle index must list autocrop evidence by role');

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
