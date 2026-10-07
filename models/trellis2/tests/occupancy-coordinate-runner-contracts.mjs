import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const root = path.resolve(new URL('../../..', import.meta.url).pathname), folder = await fs.mkdtemp(path.join(os.tmpdir(), 'trellis-coordinate-runner-'));
try {
  await fs.writeFile(path.join(folder, 'manifest.json'), '{}'); const output = path.join(folder, 'report.json');
  const run = spawnSync(process.execPath, [path.join(root, 'models/trellis2/run-sparse-prefix-witness.mjs'),
    '--repo-root', root, '--expected-commit', '0'.repeat(40), '--fixture', folder, '--witness', 'coordinates',
    '--chrome', path.join(folder, 'missing-independent-browser'), '--report', output, '--receiver', 'coordinate-test'], { encoding: 'utf8' });
  assert.notEqual(run.status, 0); const report = JSON.parse(await fs.readFile(output, 'utf8'));
  assert.doesNotMatch(report.error?.message ?? '', /--witness must be/, 'Native coordinate consumer needs an admitted witness class.');
  assert.equal(report.status, 'failed'); assert.ok(report.phase && report.finishedAt); assert.ok(!report.ownedBrowserPid);
} finally { await fs.rm(folder, { recursive: true, force: true }); }
console.log('Coordinate witness is recognized; wrong source and missing input cannot launch a browser or suppress negative terminal evidence.');
