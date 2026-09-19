import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('missing invocation inputs leave a failed terminal report before browser or GPU launch', async () => {
  const out = await mkdtemp(join(tmpdir(), 'kaminos-placement-failure-'));
  try {
    const run = spawnSync(process.execPath, ['scene-placement-witness.mjs', '--out', out], {
      cwd: new URL('..', import.meta.url), encoding: 'utf8',
    });
    assert.equal(run.status, 1);
    const report = JSON.parse(await readFile(join(out, 'report.json'), 'utf8'));
    assert.equal(report.status, 'failed');
    assert.equal(report.phase, 'arguments');
    assert.match(report.error, /--origin required/);
    assert.equal(report.lease, undefined);
    const failure = JSON.parse(await readFile(join(out, 'failure.json'), 'utf8'));
    assert.equal(failure.phase, report.phase);
  } finally { await rm(out, {recursive:true, force:true}); }
});
