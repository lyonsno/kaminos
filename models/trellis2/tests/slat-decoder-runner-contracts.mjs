import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const root = path.resolve(new URL('../../..', import.meta.url).pathname), folder = await fs.mkdtemp(path.join(os.tmpdir(), 'trellis-learned-decoder-runner-'));
try {
  await fs.writeFile(path.join(folder, 'manifest.json'), '{}');const report = path.join(folder, 'report.json');
  const run = spawnSync(process.execPath, [path.join(root, 'models/trellis2/run-sparse-prefix-witness.mjs'), '--repo-root', root,
    '--expected-commit', '0'.repeat(40), '--fixture', folder, '--witness', 'slat-decoder', '--chrome', path.join(folder, 'absent-browser'),
    '--report', report, '--receiver', 'learned-decoder-test'], { encoding: 'utf8' });
  assert.notEqual(run.status, 0);const result = JSON.parse(await fs.readFile(report, 'utf8'));
  assert.doesNotMatch(result.error?.message ?? '', /--witness must be/, 'The learned-decoder hardware witness needs an admitted class.');
  assert.equal(result.status, 'failed');assert.ok(result.phase && result.finishedAt);assert.ok(!result.ownedBrowserPid);
} finally { await fs.rm(folder, { recursive: true, force: true }); }
console.log('Learned-decoder witness is recognized; wrong source retains a negative terminal before browser/model execution.');
