import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { computeProxyRigPackageId } from '../proxy-rig-runtime.mjs';

test('witness setup failure overwrites any stale pass with a terminal failure report', async () => {
  const outputDir = await mkdtemp(join(tmpdir(), 'proxy-rig-witness-failure-'));
  try {
    const reportPath = join(outputDir, 'witness-report.json');
    const result = spawnSync(process.execPath, ['tools/witness-proxy-rig-live.mjs', 'http://127.0.0.1:1', outputDir], {
      cwd: new URL('..', import.meta.url),
      encoding: 'utf8',
      env: { ...process.env, PLAYWRIGHT_MODULE_PATH: '/definitely/absent/playwright.mjs' },
    });
    assert.notEqual(result.status, 0, 'setup failure must return a non-zero status');
    const report = JSON.parse(await readFile(reportPath, 'utf8'));
    assert.equal(report.status, 'failed');
    assert.equal(report.failurePhase, 'playwright-import');
    assert.match(report.error, /absent|cannot find/i);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test('witness rejects a self-consistent stale package before browser startup', async () => {
  const root = await mkdtemp(join(tmpdir(), 'proxy-rig-witness-stale-'));
  try {
    const stalePackagePath = join(root, 'stale-package.json');
    const outputDir = join(root, 'witness');
    const currentPackage = JSON.parse(await readFile(new URL(
      '../artifacts/cast-correspondence-v0/rig-packages/cast-sf3d-skin-baseline.proxy-rig.json',
      import.meta.url,
    ), 'utf8'));
    currentPackage.source.effectiveRoute = `${currentPackage.source.effectiveRoute} stale`;
    currentPackage.packageId = await computeProxyRigPackageId(currentPackage);
    await writeFile(stalePackagePath, `${JSON.stringify(currentPackage)}\n`);

    const result = spawnSync(process.execPath, [
      'tools/witness-proxy-rig-live.mjs',
      'http://127.0.0.1:1',
      outputDir,
    ], {
      cwd: new URL('..', import.meta.url),
      encoding: 'utf8',
      env: {
        ...process.env,
        PLAYWRIGHT_MODULE_PATH: '/definitely/absent/playwright.mjs',
        PROXY_RIG_PACKAGE_PATH: stalePackagePath,
      },
    });
    assert.notEqual(result.status, 0, 'stale package must fail the witness');
    const report = JSON.parse(await readFile(join(outputDir, 'witness-report.json'), 'utf8'));
    assert.equal(report.status, 'failed');
    assert.equal(report.failurePhase, 'package-freshness');
    assert.match(report.error, /stale|fresh|current source/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('witness rejects a live package whose identity differs from the fresh source build', async () => {
  const root = await mkdtemp(join(tmpdir(), 'proxy-rig-witness-live-mismatch-'));
  try {
    const outputDir = join(root, 'witness');
    const fakePlaywrightPath = join(root, 'fake-playwright.mjs');
    const currentPackage = JSON.parse(await readFile(new URL(
      '../artifacts/cast-correspondence-v0/rig-packages/cast-sf3d-skin-baseline.proxy-rig.json',
      import.meta.url,
    ), 'utf8'));
    const controls = currentPackage.skinBinding.groups.map(group => group.name);
    const hierarchy = currentPackage.skinBinding.groups.map(group => ({
      name: group.name,
      parent: group.parent ?? null,
    }));
    const liveState = {
      status: 'live',
      requestedPackagePath: 'artifacts/cast-correspondence-v0/rig-packages/cast-sf3d-skin-baseline.proxy-rig.json',
      effectivePackagePath: 'http://fixture/artifacts/cast-correspondence-v0/rig-packages/cast-sf3d-skin-baseline.proxy-rig.json',
      packageId: `sha256:${'0'.repeat(64)}`,
      controls,
      hierarchy,
      error: null,
    };
    await writeFile(fakePlaywrightPath, `
let directPageCount = 0;
const state = ${JSON.stringify(liveState)};
function page(kind) {
  let evaluation = 0;
  return {
    on() {},
    async goto() {},
    async waitForFunction() {},
    async close() {},
    async evaluate() {
      evaluation += 1;
      if (kind === 'missing') return {
        status: 'error',
        requestedPackagePath: 'artifacts/cast-correspondence-v0/rig-packages/absent.proxy-rig.json',
        effectivePackagePath: null,
        packageId: null,
        error: 'Proxy rig load failed (404)',
      };
      if (kind === 'storage') return {
        ...state,
        storageError: 'simulated storage read denial',
      };
      if (evaluation === 1) return state;
      throw new Error('fixture expected live package identity rejection before runtime probing');
    },
    locator(selector) {
      return {
        async boundingBox() {
          return selector === '#viewport'
            ? { x: 0, y: 0, width: 1440, height: 900 }
            : { x: 1120, y: 16, width: 296, height: 420 };
        },
      };
    },
  };
}
export const chromium = {
  async launch() {
    return {
      version() { return 'fixture-chromium'; },
      async newPage() {
        directPageCount += 1;
        return page(directPageCount === 1 ? 'missing' : 'desktop');
      },
      async newContext() {
        return {
          async addInitScript() {},
          async newPage() { return page('storage'); },
          async close() {},
        };
      },
      async close() {},
    };
  },
};
`);

    const result = spawnSync(process.execPath, [
      'tools/witness-proxy-rig-live.mjs',
      'http://fixture',
      outputDir,
    ], {
      cwd: new URL('..', import.meta.url),
      encoding: 'utf8',
      env: {
        ...process.env,
        PLAYWRIGHT_MODULE_PATH: fakePlaywrightPath,
      },
    });
    assert.notEqual(result.status, 0, 'mismatched live package must fail the witness');
    const report = JSON.parse(await readFile(join(outputDir, 'witness-report.json'), 'utf8'));
    assert.equal(report.status, 'failed');
    assert.equal(report.failurePhase, 'storage-denied-load');
    assert.match(report.error, /live package id .* fresh source package/i);
    assert.equal(report.storageDenied, null, 'mismatched package state must not be admitted as storage evidence');
    if (report.lastTrustworthyEvidence?.packageId) {
      assert.equal(
        report.lastTrustworthyEvidence.packageId,
        report.expectedPackageId,
        'last trustworthy package evidence must carry the fresh source identity',
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
