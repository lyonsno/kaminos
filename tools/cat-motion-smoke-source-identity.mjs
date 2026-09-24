import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const CAT_MOTION_SMOKE_SOURCE_FILES = Object.freeze([
  'index.html',
  'motion-rig-retarget-core.mjs',
  'scene-object-witness.mjs',
  'tools/run-cat-motion-retarget-smoke.mjs',
  'tools/cat-motion-smoke-source-identity.mjs',
]);

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function captureCatMotionSourceIdentity(repoRoot) {
  const filesSha256 = Object.fromEntries(CAT_MOTION_SMOKE_SOURCE_FILES.map(relativePath => [
    relativePath,
    digest(readFileSync(resolve(repoRoot, relativePath))),
  ]));
  const canonicalFiles = JSON.stringify(Object.entries(filesSha256));
  return {
    filesSha256,
    sha256: digest(Buffer.from(canonicalFiles)),
  };
}

export function assertCatMotionSourceIdentity(repoRoot, expectedSha256) {
  if (!/^[a-f0-9]{64}$/.test(String(expectedSha256 || ''))) {
    throw new Error('cat motion smoke requires an exact source identity SHA-256');
  }
  const actual = captureCatMotionSourceIdentity(repoRoot);
  if (actual.sha256 !== expectedSha256) {
    throw new Error(`cat motion smoke source identity mismatch: expected ${expectedSha256}, got ${actual.sha256}`);
  }
  return actual;
}
