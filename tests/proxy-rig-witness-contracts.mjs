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
