import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { resolveHeadlessBrowser } from '../lib/headless-browser-resolver.mjs';

function executable(filePath) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, '#!/bin/sh\nexit 0\n');
  chmodSync(filePath, 0o755);
  return filePath;
}

test('headless capture rejects installed stable Chrome even as an explicit override', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'kaminos-browser-resolution-'));
  try {
    const stableChrome = executable(path.join(
      root,
      'Applications',
      'Google Chrome.app',
      'Contents',
      'MacOS',
      'Google Chrome',
    ));
    assert.throws(
      () => resolveHeadlessBrowser({ cliExecutable: stableChrome }),
      /installed stable Chrome.*forbidden/i,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('headless capture records requested and effective independent executable identity', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'kaminos-browser-resolution-'));
  try {
    const shell = executable(path.join(root, 'chrome-headless-shell'));
    const resolution = resolveHeadlessBrowser({ cliExecutable: shell });
    assert.deepEqual(resolution.request, { source: 'cli', executable: shell });
    assert.equal(resolution.effective.executable, shell);
    assert.equal(resolution.effective.realPath, realpathSync(shell));
    assert.equal(resolution.effective.kind, 'playwright-chromium-headless-shell');
    assert.equal(resolution.effective.installedStableChrome, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('headless capture fails when no independent browser exists instead of falling back to stable Chrome', () => {
  assert.throws(
    () => resolveHeadlessBrowser({ candidates: [] }),
    /No executable independent headless browser.*stable Chrome fallback is forbidden/i,
  );
});
