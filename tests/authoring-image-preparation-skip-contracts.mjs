// kaminos-test: node
// Where Pillow is missing, tests/authoring-image-preparation-serving.py steps
// aside locally and fails under CI. Stepping aside must not be silent: it
// writes a `kaminos-test-warning: ` line, so the skip reaches the run report's
// warnings and the run ledger. A shim on PYTHONPATH makes `import PIL` fail,
// so these contracts hold whether or not Pillow is installed.

import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runSuite } from '../tools/test-runner.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const FILE = 'tests/authoring-image-preparation-serving.py';

async function withoutPillow(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kaminos-no-pillow-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.mkdir(path.join(dir, 'PIL'));
  await fs.writeFile(path.join(dir, 'PIL', '__init__.py'), "raise ModuleNotFoundError(\"No module named 'PIL'\", name='PIL')\n");
  return dir;
}

const childEnv = (shim, extra = {}) => {
  const { CI: _ci, PYTHONPATH: _pp, ...env } = process.env;
  return { ...env, PYTHONPATH: shim, ...extra };
};

test('without Pillow the image-preparation test exits 0 locally and writes a warning line naming the skip', async t => {
  const shim = await withoutPillow(t);
  const res = spawnSync('python3', [FILE], { cwd: root, encoding: 'utf8', env: childEnv(shim) });
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.match(res.stdout, /^kaminos-test-warning: .*Pillow is not installed/m, res.stdout);
});

test('without Pillow under CI the image-preparation test still fails', async t => {
  const shim = await withoutPillow(t);
  const res = spawnSync('python3', [FILE], { cwd: root, encoding: 'utf8', env: childEnv(shim, { CI: 'true' }) });
  assert.notEqual(res.status, 0, res.stdout + res.stderr);
  assert.doesNotMatch(res.stdout, /kaminos-test-warning: /);
});

test("the runner lists the skip in the report's warnings, under the test that wrote it", async t => {
  const shim = await withoutPillow(t);
  const out = await fs.mkdtemp(path.join(os.tmpdir(), 'kaminos-no-pillow-run-'));
  t.after(() => fs.rm(out, { recursive: true, force: true }));
  const saved = { CI: process.env.CI, PYTHONPATH: process.env.PYTHONPATH };
  delete process.env.CI;
  process.env.PYTHONPATH = shim;
  t.after(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
  const { report } = await runSuite({ root, reportPath: path.join(out, 'report.json'), kinds: ['python'], only: [FILE], executables: { python: 'python3' }, parallel: 1, lateLaunchSettleMs: 0 });
  const result = report.results.find(r => r.file === FILE);
  assert.equal(result?.outcome, 'pass', JSON.stringify(result));
  const skip = report.warnings.filter(w => w.source === 'test' && w.test === FILE);
  assert.equal(skip.length, 1, JSON.stringify(report.warnings));
  assert.match(skip[0].message, /Pillow is not installed/);
});
