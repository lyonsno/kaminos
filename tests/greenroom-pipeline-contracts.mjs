import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname;
const manifestPath = join(root, 'pipelines', 'asset-pipelines.json');
const witnessPath = join(root, 'pipeline-witness.mjs');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

const lotusPipeline = manifest.pipelines.find(pipeline => pipeline.id === 'lotus-normals-from-image-v0');
assert.ok(lotusPipeline, 'manifest must include a Lotus-D image-to-normal-map greenroom route');
assert.equal(lotusPipeline.routeId, 'adapter.lotus-normals.v0');
assert.match(lotusPipeline.description, /KAMINOS_LOTUS_NORMALS_COMMAND/, 'Lotus route must name its explicit adapter command env');
assert.ok(lotusPipeline.stages.some(stage => stage.statusMode === 'model-adapter' && stage.route?.commandEnv === 'KAMINOS_LOTUS_NORMALS_COMMAND' && stage.route?.modelFamily === 'Lotus-D'), 'Lotus route must execute a Lotus-D model adapter command');
assert.equal(lotusPipeline.artifacts?.normalMap?.role, 'normal-map');
assert.ok(lotusPipeline.artifacts?.normalMap?.pathTemplate && !lotusPipeline.artifacts.normalMap.pathTemplate.startsWith('/'), 'Lotus normal output must be caller-rooted');

const chordPipeline = manifest.pipelines.find(pipeline => pipeline.id === 'chord-materials-from-image-v0');
assert.ok(chordPipeline, 'manifest must include a CHORD image-to-PBR-materials greenroom route');
assert.equal(chordPipeline.routeId, 'adapter.chord-materials.v0');
assert.match(chordPipeline.description, /KAMINOS_CHORD_MATERIALS_COMMAND/, 'CHORD route must name its explicit adapter command env');
assert.ok(chordPipeline.stages.some(stage => stage.statusMode === 'model-adapter' && stage.route?.commandEnv === 'KAMINOS_CHORD_MATERIALS_COMMAND' && stage.route?.modelFamily === 'CHORD'), 'CHORD route must execute a CHORD model adapter command');
assert.equal(chordPipeline.artifacts?.materialBundle?.role, 'pbr-material-bundle');
assert.ok(chordPipeline.artifacts?.materialBundle?.pathTemplate && !chordPipeline.artifacts.materialBundle.pathTemplate.startsWith('/'), 'CHORD material bundle output must be caller-rooted');

function writeMockGreenroomCommand(path, { schema, outputBody }) {
  writeFileSync(path, `#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
const input = args.get('--input');
const output = args.get('--output');
const report = args.get('--report');
if (!input || !output || !report) throw new Error('mock greenroom adapter expected --input --output --report');
const inputBytes = readFileSync(input);
const inputSha256 = createHash('sha256').update(inputBytes).digest('hex');
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, ${JSON.stringify(outputBody)});
const stat = statSync(output);
mkdirSync(dirname(report), { recursive: true });
writeFileSync(report, JSON.stringify({
  schema: ${JSON.stringify(schema)},
  ok: true,
  input,
  output,
  inputSha256,
  output: { path: output, bytes: stat.size },
  backend: 'mock-greenroom-adapter'
}, null, 2) + '\\n');
`);
  chmodSync(path, 0o755);
}

const tempRoot = mkdtempSync(join(tmpdir(), 'kaminos-greenroom-contract-'));
try {
  const inputPath = join(tempRoot, 'source.png');
  writeFileSync(inputPath, 'fake image bytes for greenroom adapter contract\n');

  const lotusMock = join(tempRoot, 'mock-lotus-command.mjs');
  writeMockGreenroomCommand(lotusMock, {
    schema: 'mock.lotus-normal-adapter-report.v0',
    outputBody: 'PNG MOCK LOTUS NORMALS\\n',
  });
  const lotusOutDir = join(tempRoot, 'lotus-out');
  const lotusReportPath = join(tempRoot, 'reports', 'lotus.json');
  const lotusRun = spawnSync(process.execPath, [
    witnessPath,
    '--manifest', manifestPath,
    '--pipeline-id', 'lotus-normals-from-image-v0',
    '--input', inputPath,
    '--out-dir', lotusOutDir,
    '--report', lotusReportPath,
  ], {
    encoding: 'utf8',
    env: {
      ...process.env,
      KAMINOS_LOTUS_NORMALS_COMMAND: lotusMock,
    },
  });
  assert.equal(lotusRun.status, 0, lotusRun.stderr || lotusRun.stdout);
  const lotusReport = JSON.parse(readFileSync(lotusReportPath, 'utf8'));
  assert.equal(lotusReport.ok, true);
  assert.equal(lotusReport.effectiveRouteConfig.routeId, 'adapter.lotus-normals.v0');
  assert.equal(lotusReport.artifacts.normalMap.status, 'fixture', 'mock Lotus adapter output must be fixture-labeled');
  assert.equal(lotusReport.artifacts.normalMap.role, 'normal-map');
  assert.ok(lotusReport.artifacts.normalMap.path.startsWith(lotusOutDir), 'Lotus output must live under caller out-dir');
  assert.match(readFileSync(lotusReport.artifacts.normalMap.path, 'utf8'), /MOCK LOTUS NORMALS/);
  assert.equal(lotusReport.stages[0].effectiveRoute.adapterReport.schema, 'mock.lotus-normal-adapter-report.v0');
  assert.equal(lotusReport.stages[0].effectiveRoute.requestedRealModel, true);
  assert.equal(lotusReport.stages[0].effectiveRoute.realModel, false, 'mock Lotus adapter must not count as real model evidence');

  const chordMock = join(tempRoot, 'mock-chord-command.mjs');
  writeMockGreenroomCommand(chordMock, {
    schema: 'mock.chord-material-adapter-report.v0',
    outputBody: JSON.stringify({
      schema: 'kaminos.pbr-material-bundle.v0',
      outputs: {
        basecolor: 'basecolor.png',
        normal: 'normal.png',
        roughness: 'roughness.png',
        metalness: 'metalness.png',
      },
      truthBoundary: 'mock CHORD material adapter output',
    }, null, 2) + '\n',
  });
  const chordOutDir = join(tempRoot, 'chord-out');
  const chordReportPath = join(tempRoot, 'reports', 'chord.json');
  const chordRun = spawnSync(process.execPath, [
    witnessPath,
    '--manifest', manifestPath,
    '--pipeline-id', 'chord-materials-from-image-v0',
    '--input', inputPath,
    '--out-dir', chordOutDir,
    '--report', chordReportPath,
  ], {
    encoding: 'utf8',
    env: {
      ...process.env,
      KAMINOS_CHORD_MATERIALS_COMMAND: chordMock,
    },
  });
  assert.equal(chordRun.status, 0, chordRun.stderr || chordRun.stdout);
  const chordReport = JSON.parse(readFileSync(chordReportPath, 'utf8'));
  assert.equal(chordReport.ok, true);
  assert.equal(chordReport.effectiveRouteConfig.routeId, 'adapter.chord-materials.v0');
  assert.equal(chordReport.artifacts.materialBundle.status, 'fixture', 'mock CHORD adapter output must be fixture-labeled');
  assert.equal(chordReport.artifacts.materialBundle.role, 'pbr-material-bundle');
  assert.ok(chordReport.artifacts.materialBundle.path.startsWith(chordOutDir), 'CHORD output must live under caller out-dir');
  const materialBundle = JSON.parse(readFileSync(chordReport.artifacts.materialBundle.path, 'utf8'));
  assert.equal(materialBundle.schema, 'kaminos.pbr-material-bundle.v0');
  assert.equal(chordReport.stages[0].effectiveRoute.adapterReport.schema, 'mock.chord-material-adapter-report.v0');
  assert.equal(chordReport.stages[0].effectiveRoute.requestedRealModel, true);
  assert.equal(chordReport.stages[0].effectiveRoute.realModel, false, 'mock CHORD adapter must not count as real model evidence');

  const missingReportPath = join(tempRoot, 'reports', 'missing-lotus.json');
  const missingLotus = spawnSync(process.execPath, [
    witnessPath,
    '--manifest', manifestPath,
    '--pipeline-id', 'lotus-normals-from-image-v0',
    '--input', inputPath,
    '--out-dir', join(tempRoot, 'missing-lotus-out'),
    '--report', missingReportPath,
  ], {
    encoding: 'utf8',
    env: {
      ...process.env,
      KAMINOS_LOTUS_NORMALS_COMMAND: '',
    },
  });
  assert.notEqual(missingLotus.status, 0, 'Lotus route must fail when its command env is unconfigured');
  assert.ok(existsSync(missingReportPath), 'missing Lotus command must still write a failure report');
  const missingReport = JSON.parse(readFileSync(missingReportPath, 'utf8'));
  assert.equal(missingReport.ok, false);
  assert.equal(missingReport.requestedPipelineId, 'lotus-normals-from-image-v0');
  assert.equal(missingReport.stages[0].status, 'failed');
  assert.match(missingReport.error, /KAMINOS_LOTUS_NORMALS_COMMAND/, 'Lotus failure must name the missing command env');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
