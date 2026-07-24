import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  discoverIndependentHeadlessBrowsers,
  headlessBrowserRequest,
  resolveHeadlessBrowser,
} from '../lib/headless-browser-resolver.mjs';

function executable(filePath) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, '#!/bin/sh\nexit 0\n');
  chmodSync(filePath, 0o755);
  return filePath;
}

const root = mkdtempSync(path.join(tmpdir(), 'kaminos-headless-browser-resolver-'));
try {
  const cacheRoot = path.join(root, 'ms-playwright');
  const oldShell = executable(path.join(
    cacheRoot,
    'chromium_headless_shell-1223',
    'chrome-headless-shell-mac-arm64',
    'chrome-headless-shell',
  ));
  const newestTesting = executable(path.join(
    cacheRoot,
    'chromium-1228',
    'chrome-mac-arm64',
    'Google Chrome for Testing.app',
    'Contents',
    'MacOS',
    'Google Chrome for Testing',
  ));
  const newestShell = executable(path.join(
    cacheRoot,
    'chromium_headless_shell-1228',
    'chrome-headless-shell-mac-arm64',
    'chrome-headless-shell',
  ));

  const candidates = discoverIndependentHeadlessBrowsers({
    cacheRoot,
    platform: 'darwin',
    arch: 'arm64',
  });
  assert.equal(candidates[0].executable, newestTesting);
  assert.equal(candidates[0].kind, 'playwright-chrome-for-testing');
  assert.equal(
    candidates.find(candidate => candidate.kind === 'playwright-chromium-headless-shell')?.executable,
    newestShell,
  );
  assert.equal(candidates.at(-1).executable, oldShell);

  const defaultResolution = resolveHeadlessBrowser({
    cacheRoot,
    platform: 'darwin',
    arch: 'arm64',
  });
  assert.deepEqual(defaultResolution.request, {
    source: 'independent-default',
    executable: null,
  });
  assert.equal(defaultResolution.effective.executable, newestTesting);
  assert.equal(defaultResolution.effective.realPath, realpathSync(newestTesting));
  assert.equal(defaultResolution.effective.kind, 'playwright-chrome-for-testing');
  assert.equal(defaultResolution.effective.playwrightRevision, 1228);
  assert.equal(defaultResolution.effective.installedStableChrome, false);
  assert.equal(defaultResolution.fallbackPolicy, 'independent-artifact-or-fail-no-stable-chrome');

  const cliBrowser = executable(path.join(root, 'cli-browser'));
  const envBrowser = executable(path.join(root, 'env-browser'));
  assert.deepEqual(headlessBrowserRequest({
    cliExecutable: cliBrowser,
    envExecutable: envBrowser,
  }), {
    source: 'cli',
    executable: cliBrowser,
  });
  assert.equal(resolveHeadlessBrowser({
    cliExecutable: cliBrowser,
    envExecutable: envBrowser,
    candidates,
  }).effective.executable, cliBrowser);
  assert.equal(resolveHeadlessBrowser({
    envExecutable: envBrowser,
    candidates,
  }).effective.executable, envBrowser);

  assert.throws(
    () => resolveHeadlessBrowser({
      cliExecutable: path.join(root, 'missing-cli-browser'),
      envExecutable: envBrowser,
      candidates,
    }),
    /not an executable file/,
    'an invalid CLI override must fail instead of falling through to environment or defaults',
  );
  assert.throws(
    () => resolveHeadlessBrowser({
      envExecutable: path.join(root, 'missing-env-browser'),
      candidates,
    }),
    /not an executable file/,
    'an invalid environment override must fail instead of silently using a default',
  );
  assert.throws(
    () => resolveHeadlessBrowser({ candidates: [] }),
    /installed stable Chrome fallback is forbidden/,
  );

  const stableChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (existsSync(stableChrome)) {
    assert.throws(
      () => resolveHeadlessBrowser({
        candidates: [{
          executable: stableChrome,
          kind: 'playwright-chrome-for-testing',
          playwrightRevision: 9999,
        }],
      }),
      /installed stable Chrome fallback is forbidden/,
      'resolved stable-Chrome identity must outrank a benign implicit candidate descriptor',
    );
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
