import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const runner = fileURLToPath(new URL('../run-sparse-prefix-witness.mjs', import.meta.url));
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'trellis-prefix-admission-test-'));
try {
  for (const phase of ['fixture-admission', 'repo-root-admission']) {
    const reportPath = path.join(scratch, `${phase}.json`);
    const absent = path.join(scratch, 'does-not-exist');
    const result = spawnSync(process.execPath, [runner,
      '--repo-root', phase === 'repo-root-admission' ? absent : root,
      '--fixture', phase === 'fixture-admission' ? absent : scratch,
      '--chrome', 'not-launched', '--report', reportPath, '--receiver', 'trellis-prefix-test',
      '--expected-commit', 'not-admitted'], { encoding: 'utf8' });
    assert.equal(result.status, 1, result.stderr);
    const report = JSON.parse(await fs.readFile(reportPath));
    assert.equal(report.status, 'failed');
    assert.equal(report.phase, phase);
    assert.match(report.error.message, /ENOENT/);
    assert.equal(typeof report.finishedAt, 'string');
    assert.equal(report.requestedRepoRoot, phase === 'repo-root-admission' ? absent : root);
    assert.equal(report.requestedFixtureRoot, phase === 'fixture-admission' ? absent : scratch);
    assert.equal(report.ownedBrowserPid, undefined, 'no browser launches before input admission');
  }
  console.log('Missing fixture/source inputs preserve failed admission phase and terminal report');
} finally { await fs.rm(scratch, { recursive: true, force: true }); }
