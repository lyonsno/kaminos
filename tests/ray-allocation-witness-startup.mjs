// kaminos-test: node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ray-witness-startup-'));
try {
  const preset = path.join(dir, 'observed.json');
  await fs.writeFile(preset, '{}');
  // Exercise the complete diagnostic with a real OS spawn failure; change only
  // the server executable, before importing its named child_process binding.
  const preload = path.join(dir, 'missing-server.mjs');
  const missing = path.join(dir, 'missing-python3');
  await fs.writeFile(preload, `import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
const spawn=cp.spawn;
cp.spawn=(command,...args)=>spawn(command==='python3'?${JSON.stringify(missing)}:command,...args);
syncBuiltinESMExports();\n`);
  const out = path.join(dir, 'evidence');
  const result = spawnSync(process.execPath, ['--import', preload,
    'tools/ray-allocation-witness.mjs', out, preset], {cwd:root, encoding:'utf8'});
  assert.equal(result.signal, null, result.stderr);
  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(await fs.readFile(path.join(out, 'report.json'), 'utf8'));
  assert.equal(report.status, 'failed');
  assert.equal(report.phase, 'server-start', 'startup failure must retain its actual phase');
  assert.match(report.error, /ENOENT/);
  assert.ok(report.error.includes(missing));
  assert.equal(report.serverClosed, true, 'failed spawn must finish cleanup');
  assert.equal(report.browserClosed, true);
  assert.doesNotMatch(result.stderr, /Unhandled 'error' event/);
  console.log('Missing Python produces a terminal startup failure report and cleanup');
} finally {
  await fs.rm(dir, {recursive:true, force:true});
}
