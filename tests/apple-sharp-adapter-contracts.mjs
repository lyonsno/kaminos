#!/usr/bin/env node
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = resolve(new URL('..', import.meta.url).pathname);
const adapterPath = join(repoRoot, 'scripts', 'run-apple-sharp-adapter.mjs');
const tempRoot = join(tmpdir(), `kaminos-apple-sharp-adapter-${process.pid}`);

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

try {
  rmSync(tempRoot, { recursive: true, force: true });
  mkdirSync(tempRoot, { recursive: true });
  const inputPath = join(tempRoot, 'source-image.png');
  writeFileSync(inputPath, Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x00,
  ]));
  const fakeSharp = join(tempRoot, 'fake-sharp-cli.mjs');
  writeFileSync(fakeSharp, `#!/usr/bin/env node
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
const argv = process.argv.slice(2);
if (argv[0] !== 'predict') throw new Error('expected sharp predict');
const args = new Map();
for (let i = 1; i < argv.length; i += 1) {
  const key = argv[i];
  if (!key.startsWith('-')) continue;
  if (key === '--no-render') {
    args.set(key, '1');
    continue;
  }
  args.set(key, argv[++i]);
}
const input = args.get('-i') || args.get('--input-path');
const outputDir = args.get('-o') || args.get('--output-path');
if (!input || !outputDir) throw new Error('missing input/output');
mkdirSync(outputDir, { recursive: true });
const out = join(outputDir, basename(input).replace(/\\.[^.]+$/, '.ply'));
const inputBytes = readFileSync(input);
writeFileSync(out, [
  'ply',
  'format ascii 1.0',
  'comment fake apple sharp output',
  'comment input_bytes ' + inputBytes.length,
  'element vertex 2',
  'property float x',
  'property float y',
  'property float z',
  'property uchar red',
  'property uchar green',
  'property uchar blue',
  'end_header',
  '0 0 0 255 0 0',
  '1 0 0 0 255 0',
  ''
].join('\\n'));
console.log(JSON.stringify({ out, bytes: statSync(out).size }));
`);
  chmodSync(fakeSharp, 0o755);

  const outputPath = join(tempRoot, 'requested', 'sharp-output.ply');
  const reportPath = join(tempRoot, 'requested', 'adapter-report.json');
  const ok = spawnSync(process.execPath, [
    adapterPath,
    '--input', inputPath,
    '--output', outputPath,
    '--report', reportPath,
  ], {
    encoding: 'utf8',
    env: {
      ...process.env,
      KAMINOS_APPLE_SHARP_COMMAND: fakeSharp,
      KAMINOS_APPLE_SHARP_DEVICE: 'mps',
    },
  });

  assert.equal(ok.status, 0, ok.stderr || ok.stdout);
  assert.ok(existsSync(outputPath), 'adapter must copy Apple SHARP basename output to requested caller-owned output path');
  assert.ok(existsSync(reportPath), 'adapter must write a durable report');
  assert.match(readFileSync(outputPath, 'utf8'), /fake apple sharp output/);
  const report = readJson(reportPath);
  assert.equal(report.schema, 'kaminos.apple-sharp-adapter-report.v0');
  assert.equal(report.ok, true);
  assert.equal(report.backend.command, fakeSharp);
  assert.equal(report.backend.device, 'mps');
  assert.equal(report.execution.argv[0], fakeSharp);
  assert.equal(report.execution.argv[1], 'predict');
  assert.ok(report.execution.argv.includes('--no-render'), 'adapter should disable render trajectory for pipeline generation');
  assert.equal(report.input.path, inputPath);
  assert.equal(report.output.path, outputPath);
  assert.equal(report.output.sourceGeneratedPath.endsWith(`${basename(inputPath, '.png')}.ply`), true);
  assert.equal(report.output.sourceGeneratedPathRetained, false);
  assert.equal(report.output.bytes, statSync(outputPath).size);

  const missingReportPath = join(tempRoot, 'missing', 'adapter-report.json');
  const missing = spawnSync(process.execPath, [
    adapterPath,
    '--input', inputPath,
    '--output', join(tempRoot, 'missing', 'sharp-output.ply'),
    '--report', missingReportPath,
  ], {
    encoding: 'utf8',
    env: {
      ...process.env,
      KAMINOS_APPLE_SHARP_COMMAND: join(tempRoot, 'does-not-exist'),
    },
  });
  assert.notEqual(missing.status, 0, 'missing Apple SHARP command must fail');
  assert.ok(existsSync(missingReportPath), 'missing command must still write a report');
  const missingReport = readJson(missingReportPath);
  assert.equal(missingReport.ok, false);
  assert.equal(missingReport.phase, 'resolve-backend');
  assert.match(missingReport.error, /KAMINOS_APPLE_SHARP_COMMAND|Apple SHARP command/);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
