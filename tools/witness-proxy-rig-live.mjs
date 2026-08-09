#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { verifyProxyRigPackageIdentity } from '../proxy-rig-runtime.mjs';

const playwrightModule = process.env.PLAYWRIGHT_MODULE_PATH || 'playwright';
const chromiumExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || null;
const baseUrl = process.argv[2] || 'http://localhost:8099';
const outputDir = resolve(process.argv[3] || 'scratch/proxy-rig-live-witness');
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packagePath = process.env.PROXY_RIG_PACKAGE_PATH
  || 'artifacts/cast-correspondence-v0/rig-packages/cast-sf3d-skin-baseline.proxy-rig.json';
const packageDiskPath = resolve(repoRoot, packagePath);
const route = `${baseUrl}/?proxy_rig_package=${encodeURIComponent(packagePath)}`;
const quaternionZ = angleDeg => {
  const halfAngle = angleDeg * Math.PI / 360;
  return [0, 0, Math.sin(halfAngle), Math.cos(halfAngle)];
};
const hierarchyPoses = {
  m31Flex: {
    'hindlimb-left-distal-support': quaternionZ(24),
  },
  planted: {
    'hindlimb-right-hip': quaternionZ(8),
    'hindlimb-right-stifle': quaternionZ(-18),
    'hindlimb-right-hock': quaternionZ(20),
    'hindlimb-right-paw': quaternionZ(-8),
  },
  crouched: {
    'hindlimb-right-hip': quaternionZ(-20),
    'hindlimb-right-stifle': quaternionZ(24),
    'hindlimb-right-hock': quaternionZ(-16),
    'hindlimb-right-paw': quaternionZ(5),
  },
  extended: {
    'hindlimb-right-hip': quaternionZ(16),
    'hindlimb-right-stifle': quaternionZ(-48),
    'hindlimb-right-hock': quaternionZ(38),
    'hindlimb-right-paw': quaternionZ(10),
  },
};
let expectedControlNames = [];
let expectedHierarchy = [];
let expectedMuscles = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertLivePackageIdentity(state, expectedPackageId, label) {
  assert(/^sha256:[a-f0-9]{64}$/.test(state.packageId), `${label}: package id is not a sha256 identity`);
  assert(
    state.packageId === expectedPackageId,
    `${label}: live package id ${state.packageId} differs from fresh source package ${expectedPackageId}`,
  );
}

async function pixelStats(page, imageBuffer) {
  return page.evaluate(async base64 => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = new OffscreenCanvas(image.width, image.height);
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, image.width, image.height).data;
    let sum = 0; let sumSquared = 0; let opaque = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const luminance = 0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2];
      sum += luminance;
      sumSquared += luminance * luminance;
      if (pixels[i + 3] > 0) opaque += 1;
    }
    const count = pixels.length / 4;
    const mean = sum / count;
    return {
      width: image.width,
      height: image.height,
      mean,
      variance: sumSquared / count - mean * mean,
      opaqueFraction: opaque / count,
    };
  }, imageBuffer.toString('base64'));
}

async function pixelDelta(page, beforeBuffer, afterBuffer) {
  return page.evaluate(async ({ beforeBase64, afterBase64 }) => {
    const decode = async base64 => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = new OffscreenCanvas(image.width, image.height);
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      return {
        width: image.width,
        height: image.height,
        pixels: context.getImageData(0, 0, image.width, image.height).data,
      };
    };
    const before = await decode(beforeBase64);
    const after = await decode(afterBase64);
    if (before.width !== after.width || before.height !== after.height) {
      throw new Error(`Pixel comparison dimensions differ: ${before.width}x${before.height} != ${after.width}x${after.height}`);
    }
    let absoluteDelta = 0;
    let changedPixels = 0;
    const pixelCount = before.width * before.height;
    for (let i = 0; i < before.pixels.length; i += 4) {
      const delta = Math.abs(before.pixels[i] - after.pixels[i])
        + Math.abs(before.pixels[i + 1] - after.pixels[i + 1])
        + Math.abs(before.pixels[i + 2] - after.pixels[i + 2]);
      absoluteDelta += delta;
      if (delta >= 12) changedPixels += 1;
    }
    return {
      width: before.width,
      height: before.height,
      meanAbsoluteRgbDelta: absoluteDelta / (pixelCount * 3),
      changedPixelFraction: changedPixels / pixelCount,
    };
  }, {
    beforeBase64: beforeBuffer.toString('base64'),
    afterBase64: afterBuffer.toString('base64'),
  });
}

async function browserRouteIdentity(browser, page) {
  const pageIdentity = await page.evaluate(async () => {
    let observedGpuAdapter = null;
    try {
      const adapter = await navigator.gpu?.requestAdapter();
      const info = adapter?.info ?? await adapter?.requestAdapterInfo?.();
      if (info) {
        observedGpuAdapter = {
          vendor: info.vendor || null,
          architecture: info.architecture || null,
          device: info.device || null,
          description: info.description || null,
        };
      }
    } catch (error) {
      observedGpuAdapter = { error: error?.message || String(error) };
    }
    const state = window.kaminosProxyRigDebugState();
    return {
      userAgent: navigator.userAgent,
      gpuApiAvailable: !!navigator.gpu,
      observedGpuAdapter,
      rendererDataEngine: document.querySelector('#viewport > canvas')?.dataset?.engine ?? null,
      renderBackend: state.renderBackend,
      renderKernel: state.renderKernel,
    };
  });
  return {
    playwrightModuleRequested: playwrightModule,
    playwrightModuleEffective: playwrightModule.startsWith('/')
      ? pathToFileURL(playwrightModule).href
      : playwrightModule,
    chromiumVersion: browser.version(),
    chromiumExecutableRequested: chromiumExecutable,
    ...pageIdentity,
  };
}

async function loadWitnessPage(browser, viewport, label) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.kaminosProxyRigDebugState?.().status === 'live', null, { timeout: 60000 });
  const state = await page.evaluate(() => window.kaminosProxyRigDebugState());
  assert(state.requestedPackagePath === packagePath, `${label}: requested package identity was not preserved`);
  assert(state.effectivePackagePath.endsWith(packagePath), `${label}: effective package identity was not preserved`);
  assertLivePackageIdentity(state, report.expectedPackageId, label);
  assert(
    JSON.stringify(state.controls) === JSON.stringify(expectedControlNames),
    `${label}: controls differ from the verified package (${JSON.stringify(state.controls)})`,
  );
  assert(
    JSON.stringify(state.hierarchy) === JSON.stringify(expectedHierarchy),
    `${label}: live hierarchy differs from the verified package (${JSON.stringify(state.hierarchy)})`,
  );
  assert(
    JSON.stringify(state.muscles) === JSON.stringify(expectedMuscles),
    `${label}: live muscle identity differs from the verified package (${JSON.stringify(state.muscles)})`,
  );
  assert(
    state.selectedControl === 'hindlimb-right-hock',
    `${label}: initial selection drifted onto ${String(state.selectedControl)}`,
  );
  assert(
    state.selectedControlKind === 'skeletal-support'
      && state.transformTargetName === state.selectedControl,
    `${label}: transform target is not the selected skeletal support (${JSON.stringify(state)})`,
  );
  assert(
    state.skeletalSupportSegmentCount >= 1,
    `${label}: rendered scene has no visible parent-child skeletal linkage`,
  );
  assert(state.error === null, `${label}: live state contains an error: ${state.error}`);
  const panelBox = await page.locator('#proxy-rig-live-controls').boundingBox();
  const viewportBox = await page.locator('#viewport').boundingBox();
  assert(panelBox && viewportBox, `${label}: live panel or viewport is missing`);
  assert(panelBox.x >= viewportBox.x && panelBox.y >= viewportBox.y, `${label}: live panel begins outside viewport`);
  assert(panelBox.x + panelBox.width <= viewportBox.x + viewportBox.width + 1, `${label}: live panel overflows viewport width`);
  assert(panelBox.y + panelBox.height <= viewportBox.y + viewportBox.height + 1, `${label}: live panel overflows viewport height`);
  return { page, errors, state, panelBox, viewportBox };
}

const report = {
  schema: 'kaminos.proxy-rig-live-witness.v0',
  requestedRoute: route,
  packagePath,
  desktop: null,
  narrow: null,
  missingPackage: null,
  storageDenied: null,
  hierarchyPoses: null,
  status: 'running',
  failurePhase: null,
  lastTrustworthyEvidence: null,
  effectiveRuntime: null,
  expectedPackageId: null,
};
let browser = null;
let playwright = null;
let terminalError = null;

try {
  await mkdir(outputDir, { recursive: true });
  await writeFile(resolve(outputDir, 'witness-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  report.failurePhase = 'package-freshness';
  const freshPackagePath = resolve(outputDir, 'fresh-source-package.json');
  const freshBuild = spawnSync(process.execPath, [
    'tools/build-proxy-rig-package.mjs',
    '--output',
    freshPackagePath,
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert(
    freshBuild.status === 0,
    `current source package build failed: ${freshBuild.stderr || freshBuild.stdout || `exit ${freshBuild.status}`}`,
  );
  const [checkedPackage, freshPackage] = await Promise.all([
    readFile(packageDiskPath, 'utf8').then(JSON.parse),
    readFile(freshPackagePath, 'utf8').then(JSON.parse),
  ]);
  await verifyProxyRigPackageIdentity(checkedPackage);
  await verifyProxyRigPackageIdentity(freshPackage);
  expectedControlNames = checkedPackage.skinBinding.groups.map(group => group.name);
  expectedHierarchy = checkedPackage.skinBinding.groups.map(group => ({
    name: group.name,
    parent: group.parent ?? null,
  }));
  expectedMuscles = checkedPackage.muscles.map(muscle => ({
    relationId: muscle.relationId,
    requestedRoute: muscle.requestedRoute,
    effectiveRoute: muscle.effectiveRoute,
    fallbackUsed: muscle.fallbackUsed,
    historicalRef: muscle.source.historicalRef,
    fixtureId: muscle.source.fixtureId,
    fixedSupport: muscle.supportMapping.fixed,
    movingSupport: muscle.supportMapping.moving,
  }));
  assert(expectedControlNames.length === 11, `expected eleven controls, got ${expectedControlNames.length}`);
  assert(
    JSON.stringify(expectedHierarchy.filter(group => group.name.startsWith('hindlimb-left'))) === JSON.stringify([
      { name: 'hindlimb-left', parent: null },
      { name: 'hindlimb-left-distal-support', parent: 'hindlimb-left' },
    ]),
    `verified package does not carry the M31 support hierarchy (${JSON.stringify(expectedHierarchy)})`,
  );
  assert(
    expectedMuscles.length === 1
      && expectedMuscles[0].relationId === 'muscle-31'
      && expectedMuscles[0].fallbackUsed === false,
    `verified package does not carry one exact non-fallback M31 overlay (${JSON.stringify(expectedMuscles)})`,
  );
  assert(
    JSON.stringify(expectedHierarchy.filter(group => group.name.startsWith('hindlimb-right'))) === JSON.stringify([
      { name: 'hindlimb-right-hip', parent: null },
      { name: 'hindlimb-right-stifle', parent: 'hindlimb-right-hip' },
      { name: 'hindlimb-right-hock', parent: 'hindlimb-right-stifle' },
      { name: 'hindlimb-right-paw', parent: 'hindlimb-right-hock' },
    ]),
    `verified package does not carry the preregistered hindlimb chain (${JSON.stringify(expectedHierarchy)})`,
  );
  report.expectedPackageId = freshPackage.packageId;
  assert(
    checkedPackage.packageId === freshPackage.packageId,
    `stale package ${checkedPackage.packageId} does not match current source build ${freshPackage.packageId}`,
  );
  report.failurePhase = 'playwright-import';
  playwright = await import(playwrightModule.startsWith('/') ? pathToFileURL(playwrightModule) : playwrightModule);
  report.failurePhase = 'browser-launch';
  browser = await playwright.chromium.launch({
    headless: true,
    ...(chromiumExecutable ? { executablePath: chromiumExecutable } : {}),
    args: ['--enable-unsafe-webgpu', '--use-angle=swiftshader', '--disable-vulkan-surface'],
  });

  report.failurePhase = 'missing-package-rejection';
  const negativePage = await browser.newPage({ viewport: { width: 960, height: 720 }, deviceScaleFactor: 1 });
  const missingPath = 'artifacts/cast-correspondence-v0/rig-packages/absent.proxy-rig.json';
  await negativePage.goto(`${baseUrl}/?proxy_rig_package=${encodeURIComponent(missingPath)}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await negativePage.waitForFunction(() => window.kaminosProxyRigDebugState?.().status === 'error', null, { timeout: 60000 });
  const missingState = await negativePage.evaluate(() => window.kaminosProxyRigDebugState());
  assert(missingState.requestedPackagePath === missingPath, 'missing package: requested route identity was lost');
  assert(missingState.effectivePackagePath === null, 'missing package: a fallback effective route was installed');
  assert(missingState.packageId === null, 'missing package: a fallback package identity was installed');
  assert(/404/.test(missingState.error), `missing package: error did not identify the failed fetch (${missingState.error})`);
  report.missingPackage = missingState;
  report.lastTrustworthyEvidence = missingState;
  await negativePage.close();

  report.failurePhase = 'storage-denied-load';
  const storageDeniedContext = await browser.newContext({ viewport: { width: 960, height: 720 }, deviceScaleFactor: 1 });
  await storageDeniedContext.addInitScript(() => {
    const posePrefix = 'kaminos.proxy-rig.pose-run.v0:';
    const originalGetItem = Storage.prototype.getItem;
    const originalRemoveItem = Storage.prototype.removeItem;
    Storage.prototype.getItem = function getItem(key) {
      if (String(key).startsWith(posePrefix)) throw new DOMException('simulated storage read denial', 'SecurityError');
      return originalGetItem.call(this, key);
    };
    Storage.prototype.removeItem = function removeItem(key) {
      if (String(key).startsWith(posePrefix)) throw new DOMException('simulated storage purge denial', 'SecurityError');
      return originalRemoveItem.call(this, key);
    };
  });
  const storageDeniedPage = await storageDeniedContext.newPage();
  await storageDeniedPage.goto(route, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await storageDeniedPage.waitForFunction(() => window.kaminosProxyRigDebugState?.().status === 'live', null, { timeout: 60000 });
  const storageDeniedState = await storageDeniedPage.evaluate(() => window.kaminosProxyRigDebugState());
  assertLivePackageIdentity(storageDeniedState, report.expectedPackageId, 'storage denied');
  assert(storageDeniedState.effectivePackagePath.endsWith(packagePath), 'storage denied: effective package route was lost');
  assert(/simulated storage read denial/i.test(storageDeniedState.storageError), 'storage denied: degraded persistence was not surfaced');
  assert(storageDeniedState.error === null, `storage denied: live rig reported route error (${storageDeniedState.error})`);
  report.storageDenied = storageDeniedState;
  report.lastTrustworthyEvidence = storageDeniedState;
  await storageDeniedContext.close();

  report.failurePhase = 'desktop-load';
  const desktop = await loadWitnessPage(browser, { width: 1440, height: 900 }, 'desktop');
  report.lastTrustworthyEvidence = desktop.state;
  report.effectiveRuntime = await browserRouteIdentity(browser, desktop.page);
  const engineRevision = report.effectiveRuntime.rendererDataEngine?.match(/three\.js r([^ ]+) webgpu/i)?.[1] ?? null;
  assert(engineRevision, `desktop: renderer did not expose its effective revision (${report.effectiveRuntime.rendererDataEngine})`);
  assert(
    report.effectiveRuntime.renderKernel === `three-r${engineRevision}-webgpu-render-pipeline`,
    `desktop: reported kernel does not match renderer identity (${JSON.stringify(report.effectiveRuntime)})`,
  );
  const canvas = desktop.page.locator('#viewport > canvas').first();
  await desktop.page.evaluate(() => window.kaminosProxyRigSetControlVisibility(false));
  await desktop.page.waitForTimeout(800);
  const hiddenRestState = await desktop.page.evaluate(() => window.kaminosProxyRigDebugState());
  assert(hiddenRestState.controlsVisible === false, 'desktop: controls remained visible in the rest witness');
  assert(hiddenRestState.transformHelperVisible === false, 'desktop: transform helper remained visible in the rest witness');
  const restCanvas = await canvas.screenshot({ path: resolve(outputDir, 'proxy-rig-rest-canvas.png') });
  const restStats = await pixelStats(desktop.page, restCanvas);
  assert(restStats.variance > 20, `desktop: rest canvas is visually blank (${JSON.stringify(restStats)})`);
  await desktop.page.screenshot({ path: resolve(outputDir, 'proxy-rig-rest-page.png'), fullPage: true });

  report.failurePhase = 'hindlimb-hierarchy-poses';
  report.hierarchyPoses = {};
  for (const [poseName, controls] of Object.entries(hierarchyPoses)) {
    await desktop.page.locator('#proxy-rig-reset-all').click();
    for (const [controlName, quaternion] of Object.entries(controls)) {
      await desktop.page.evaluate(({ name, value }) => {
        window.kaminosProxyRigSetControlQuaternion(name, value);
      }, { name: controlName, value: quaternion });
    }
    await desktop.page.waitForTimeout(350);
    const poseState = await desktop.page.evaluate(() => window.kaminosProxyRigDebugState());
    assert(poseState.maxDisplacement > 0.005, `${poseName}: hierarchy pose did not move the cast`);
    const poseCanvas = await canvas.screenshot({
      path: resolve(outputDir, `proxy-rig-hindlimb-${poseName}-canvas.png`),
    });
    const stats = await pixelStats(desktop.page, poseCanvas);
    const delta = await pixelDelta(desktop.page, restCanvas, poseCanvas);
    assert(stats.variance > 20, `${poseName}: hierarchy canvas is visually blank (${JSON.stringify(stats)})`);
    assert(
      delta.changedPixelFraction > 0.0005 && delta.meanAbsoluteRgbDelta > 0.02,
      `${poseName}: hierarchy pose did not materially differ from rest (${JSON.stringify(delta)})`,
    );
    report.hierarchyPoses[poseName] = { controls, state: poseState, pixelStats: stats, renderedPoseDelta: delta };
    if (poseName === 'm31Flex') {
      assert(
        poseState.muscleMaxDisplacements?.['muscle-31'] > 0.005,
        `${poseName}: authenticated M31 overlay did not move with its insertion support`,
      );
    } else {
      const restPaw = hiddenRestState.controlWorldPositions['hindlimb-right-paw'];
      const posedPaw = poseState.controlWorldPositions['hindlimb-right-paw'];
      assert(
        Math.hypot(...posedPaw.map((value, axis) => value - restPaw[axis])) > 0.01,
        `${poseName}: descendant paw handle did not follow the hierarchy`,
      );
    }
  }
  await desktop.page.evaluate(() => window.kaminosProxyRigSetControlVisibility(true));
  await desktop.page.screenshot({ path: resolve(outputDir, 'proxy-rig-hindlimb-extended-page.png'), fullPage: true });
  await desktop.page.evaluate(() => window.kaminosProxyRigSetControlVisibility(false));
  await desktop.page.locator('#proxy-rig-reset-all').click();

  report.failurePhase = 'desktop-pose';
  const angle = 25 * Math.PI / 180;
  await desktop.page.evaluate(({ sine, cosine }) => {
    window.kaminosProxyRigSelectControl('forelimb-right');
    window.kaminosProxyRigSetControlQuaternion('forelimb-right', [Math.sin(sine), 0, 0, Math.cos(cosine)]);
  }, { sine: angle / 2, cosine: angle / 2 });
  await desktop.page.waitForFunction(() => window.kaminosProxyRigDebugState().maxDisplacement > 0.01);
  await desktop.page.waitForTimeout(400);
  const hiddenPosedState = await desktop.page.evaluate(() => window.kaminosProxyRigDebugState());
  assert(hiddenPosedState.controlsVisible === false, 'desktop: controls reappeared in the posed witness');
  assert(hiddenPosedState.transformHelperVisible === false, 'desktop: transform helper reappeared in the posed witness');
  const posedCanvas = await canvas.screenshot({ path: resolve(outputDir, 'proxy-rig-posed-canvas.png') });
  const posedStats = await pixelStats(desktop.page, posedCanvas);
  assert(posedStats.variance > 20, `desktop: posed canvas is visually blank (${JSON.stringify(posedStats)})`);
  const renderedPoseDelta = await pixelDelta(desktop.page, restCanvas, posedCanvas);
  assert(
    renderedPoseDelta.changedPixelFraction > 0.001 && renderedPoseDelta.meanAbsoluteRgbDelta > 0.05,
    `desktop: posed pixels did not materially differ from rest (${JSON.stringify(renderedPoseDelta)})`,
  );
  await desktop.page.evaluate(() => window.kaminosProxyRigSetControlVisibility(true));
  await desktop.page.waitForTimeout(150);
  await desktop.page.screenshot({ path: resolve(outputDir, 'proxy-rig-posed-page.png'), fullPage: true });

  report.failurePhase = 'desktop-record-replay';
  await desktop.page.locator('#proxy-rig-record-button').click();
  await desktop.page.evaluate(() => window.kaminosProxyRigSetControlQuaternion('forelimb-right', [0, 0, 0, 1]));
  await desktop.page.waitForTimeout(120);
  await desktop.page.evaluate(({ sine, cosine }) => {
    window.kaminosProxyRigSetControlQuaternion('forelimb-right', [Math.sin(sine), 0, 0, Math.cos(cosine)]);
  }, { sine: angle / 2, cosine: angle / 2 });
  await desktop.page.waitForTimeout(120);
  await desktop.page.locator('#proxy-rig-record-button').click();
  const recorded = await desktop.page.evaluate(() => window.kaminosProxyRigDebugState());
  assert(recorded.recordedFrames >= 4, `desktop: recording captured only ${recorded.recordedFrames} frames`);
  await desktop.page.locator('#proxy-rig-reset-all').click();
  await desktop.page.locator('#proxy-rig-replay-button').click();
  await desktop.page.waitForFunction(() => window.kaminosProxyRigDebugState().replaying === true);
  await desktop.page.waitForFunction(() => window.kaminosProxyRigDebugState().replaying === false);
  const replayed = await desktop.page.evaluate(() => window.kaminosProxyRigDebugState());
  assert(replayed.maxDisplacement > 0.01, 'desktop: replay did not restore the recorded pose');

  report.failurePhase = 'desktop-storage-degradation';
  await desktop.page.locator('#proxy-rig-record-button').click();
  await desktop.page.evaluate(() => window.kaminosProxyRigSetControlQuaternion('forelimb-right', [0, 0, 0, 1]));
  const storageDegraded = await desktop.page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new DOMException('simulated quota exhaustion', 'QuotaExceededError'); };
    try {
      document.getElementById('proxy-rig-record-button').click();
      return {
        state: window.kaminosProxyRigDebugState(),
        replayDisabled: document.getElementById('proxy-rig-replay-button').disabled,
      };
    } finally {
      Storage.prototype.setItem = original;
    }
  });
  assert(storageDegraded.state.status === 'live', 'desktop: storage failure took the live assay offline');
  assert(storageDegraded.state.recording === false, 'desktop: storage failure left recording active');
  assert(storageDegraded.state.recordedFrames >= 2, 'desktop: storage failure discarded the in-memory pose run');
  assert(/simulated quota exhaustion/i.test(storageDegraded.state.storageError), 'desktop: storage failure was not surfaced');
  assert(storageDegraded.replayDisabled === false, 'desktop: in-memory replay was disabled after storage failure');
  assert(desktop.errors.length === 0, `desktop console errors: ${desktop.errors.join(' | ')}`);
  report.desktop = {
    restStats,
    posedStats,
    renderedPoseDelta,
    state: replayed,
    storageDegradation: storageDegraded,
    panelBox: desktop.panelBox,
    viewportBox: desktop.viewportBox,
  };
  await desktop.page.close();

  report.failurePhase = 'narrow-load';
  const narrow = await loadWitnessPage(browser, { width: 760, height: 900 }, 'narrow');
  await narrow.page.waitForTimeout(600);
  const narrowCanvas = await narrow.page.locator('#viewport > canvas').first().screenshot({
    path: resolve(outputDir, 'proxy-rig-narrow-canvas.png'),
  });
  const narrowStats = await pixelStats(narrow.page, narrowCanvas);
  assert(narrowStats.variance > 20, `narrow: canvas is visually blank (${JSON.stringify(narrowStats)})`);
  await narrow.page.screenshot({ path: resolve(outputDir, 'proxy-rig-narrow-page.png'), fullPage: true });
  assert(narrow.errors.length === 0, `narrow console errors: ${narrow.errors.join(' | ')}`);
  report.narrow = { pixelStats: narrowStats, state: narrow.state, panelBox: narrow.panelBox, viewportBox: narrow.viewportBox };
  await narrow.page.close();

  report.status = 'passed';
  report.failurePhase = null;
  report.lastTrustworthyEvidence = report.desktop.state;
} catch (error) {
  report.status = 'failed';
  report.error = error?.stack || String(error);
  terminalError = error;
} finally {
  try {
    await browser?.close();
  } catch (error) {
    report.status = 'failed';
    report.failurePhase ||= 'browser-close';
    report.error ||= error?.stack || String(error);
    terminalError ||= error;
  }
  try {
    await mkdir(outputDir, { recursive: true });
    await writeFile(resolve(outputDir, 'witness-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    console.error(`Unable to write proxy-rig witness report: ${error?.stack || error}`);
    terminalError ||= error;
  }
}

process.stdout.write(`${JSON.stringify(report)}\n`);
if (terminalError) process.exitCode = 1;
