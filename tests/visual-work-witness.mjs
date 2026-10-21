// kaminos-test: node
import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('missing server executable retains a terminal startup failure without a browser', async () => {
  const out = await fs.mkdtemp(path.join(os.tmpdir(), 'visual-work-startup-'));
  try {
    const child = spawnSync(process.execPath, [fileURLToPath(new URL('../examples/visual-work/cheap-witness.mjs', import.meta.url)),
      '--out', out, '--browser', '/unused-browser', '--playwright', '/unused-playwright', '--python', path.join(out, 'missing-python')],
    {encoding: 'utf8'});
    assert.equal(child.status, 1);
    const report = JSON.parse(await fs.readFile(path.join(out, 'witness.json'), 'utf8'));
    assert.equal(report.status, 'failed');
    assert.equal(report.phase, 'server-start');
    assert.match(report.error, /ENOENT/);
    assert.equal(report.server.started, false);
    assert.equal(report.serverClosed, true);
    assert.equal(child.stderr.includes("Unhandled 'error' event"), false);
  } finally {
    await fs.rm(out, {recursive: true, force: true});
  }
});
