import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const identity = await import('../tools/cat-motion-smoke-source-identity.mjs').catch(() => ({}));
assert.equal(typeof identity.captureCatMotionSourceIdentity, 'function', 'the smoke runner needs a byte-bound source identity');
assert.equal(typeof identity.assertCatMotionSourceIdentity, 'function', 'the smoke runner must reject a changed source identity');

const root = mkdtempSync(join(tmpdir(), 'cat-motion-source-identity-'));
try {
  mkdirSync(join(root, 'tools'));
  writeFileSync(join(root, 'index.html'), 'adapter-v1');
  writeFileSync(join(root, 'motion-rig-retarget-core.mjs'), 'core-v1');
  writeFileSync(join(root, 'scene-object-witness.mjs'), 'witness-v1');
  writeFileSync(join(root, 'tools/run-cat-motion-retarget-smoke.mjs'), 'runner-v1');
  writeFileSync(join(root, 'tools/cat-motion-smoke-source-identity.mjs'), 'identity-v1');
  const expected = identity.captureCatMotionSourceIdentity(root);
  assert.deepEqual(identity.assertCatMotionSourceIdentity(root, expected.sha256), expected);
  assert.throws(() => identity.assertCatMotionSourceIdentity(root, 'wrong-digest'), /requires an exact source identity SHA-256/);
  writeFileSync(join(root, 'motion-rig-retarget-core.mjs'), 'core-v2');
  assert.throws(
    () => identity.assertCatMotionSourceIdentity(root, expected.sha256),
    /source identity mismatch/,
    'a changed adapter must fail before the runner can launch the browser smoke',
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}

const runnerSource = readFileSync(new URL('../tools/run-cat-motion-retarget-smoke.mjs', import.meta.url), 'utf8');
assert.ok(
  runnerSource.indexOf('assertCatMotionSourceIdentity(repoRoot') < runnerSource.indexOf("phase = 'launch-source-matched-kaminos-server'"),
  'exact source identity must be compared before starting the browser-serving process',
);
assert.match(runnerSource, /sourceFilesSha256:\s*sourceIdentity\.filesSha256/, 'successful smoke receipts carry per-file source digests');
assert.match(runnerSource, /sourceIdentity,/, 'failure receipts preserve observed source hashes when identity comparison fails');

console.log('cat motion smoke source identity contracts passed');
