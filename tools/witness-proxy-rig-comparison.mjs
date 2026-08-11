#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  validateProxyRigComparisonLiveState,
  validateProxyRigComparisonManifest,
} from '../proxy-rig-comparison.mjs';
import { verifyProxyRigPackageIdentity } from '../proxy-rig-runtime.mjs';

const playwrightModule = process.env.PLAYWRIGHT_MODULE_PATH || 'playwright';
const chromiumExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || null;
const baseUrl = process.argv[2] || 'http://127.0.0.1:8101';
const outputDir = resolve(process.argv[3] || 'scratch/proxy-rig-comparison-witness');
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = process.env.PROXY_RIG_COMPARISON_MANIFEST
  || 'artifacts/cast-correspondence-v0/cast-topology-comparison.json';
const routeFor = candidateId => `${baseUrl}/?proxy_rig_comparison=${encodeURIComponent(manifestPath)}&proxy_rig_candidate=${encodeURIComponent(candidateId)}`;
const quaternionZ = angleDeg => {
  const halfAngle = angleDeg * Math.PI / 360;
  return [0, 0, Math.sin(halfAngle), Math.cos(halfAngle)];
};
const pose = {
  'hindlimb-right-hip': quaternionZ(-18),
  'hindlimb-right-stifle': quaternionZ(28),
  'hindlimb-right-hock': quaternionZ(-22),
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function arraysNear(left, right, tolerance = 1e-8) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => Math.abs(value - right[index]) <= tolerance);
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
    let sum = 0;
    let sumSquared = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      const luminance = 0.2126 * pixels[index]
        + 0.7152 * pixels[index + 1]
        + 0.0722 * pixels[index + 2];
      sum += luminance;
      sumSquared += luminance * luminance;
    }
    const count = pixels.length / 4;
    const mean = sum / count;
    return {
      width: image.width,
      height: image.height,
      mean,
      variance: sumSquared / count - mean * mean,
    };
  }, imageBuffer.toString('base64'));
}

const report = {
  schema: 'kaminos.proxy-rig-comparison-witness.v0',
  requestedManifestPath: manifestPath,
  effectiveManifestPath: null,
  requestedRuntime: {
    baseUrl,
    playwrightModule,
    chromiumExecutable,
  },
  effectiveRuntime: null,
  candidates: [],
  missingCandidate: null,
  missingManifest: null,
  status: 'running',
  failurePhase: 'initialization',
  lastTrustworthyEvidence: null,
};
let browser = null;
let terminalError = null;

try {
  await mkdir(outputDir, { recursive: true });
  await writeFile(resolve(outputDir, 'witness-report.json'), `${JSON.stringify(report, null, 2)}\n`);

  report.failurePhase = 'source-validation';
  const manifest = validateProxyRigComparisonManifest(JSON.parse(
    await readFile(resolve(repoRoot, manifestPath), 'utf8'),
  ));
  const packageByCandidate = new Map();
  for (const candidate of manifest.candidates) {
    const packageData = JSON.parse(await readFile(resolve(repoRoot, candidate.package), 'utf8'));
    await verifyProxyRigPackageIdentity(packageData);
    assert(
      packageData.source?.comparisonCandidate?.id === candidate.id,
      `${candidate.id}: package embeds ${String(packageData.source?.comparisonCandidate?.id)} instead of its candidate identity`,
    );
    packageByCandidate.set(candidate.id, packageData);
  }

  report.failurePhase = 'playwright-import';
  const playwright = await import(playwrightModule.startsWith('/')
    ? pathToFileURL(playwrightModule)
    : playwrightModule);
  report.failurePhase = 'browser-launch';
  browser = await playwright.chromium.launch({
    headless: true,
    ...(chromiumExecutable ? { executablePath: chromiumExecutable } : {}),
    args: ['--enable-unsafe-webgpu', '--use-angle=swiftshader', '--disable-vulkan-surface'],
  });
  report.effectiveRuntime = {
    playwrightModule: playwrightModule.startsWith('/')
      ? pathToFileURL(playwrightModule).href
      : playwrightModule,
    chromiumVersion: browser.version(),
  };

  report.failurePhase = 'missing-candidate-rejection';
  const missingCandidatePage = await browser.newPage({ viewport: { width: 1100, height: 760 } });
  await missingCandidatePage.goto(routeFor('absent-candidate'), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await missingCandidatePage.waitForFunction(
    () => window.kaminosProxyRigComparisonDebugState?.().status === 'error',
    null,
    { timeout: 60000 },
  );
  const missingCandidateState = await missingCandidatePage.evaluate(
    () => window.kaminosProxyRigComparisonDebugState(),
  );
  assert(/unknown comparison candidate absent-candidate/i.test(missingCandidateState.error), 'missing candidate did not fail with its identity');
  assert(missingCandidateState.candidateId === null, 'missing candidate installed a candidate identity');
  assert(missingCandidateState.liveRig === null, 'missing candidate loaded a fallback rig');
  report.missingCandidate = missingCandidateState;
  report.lastTrustworthyEvidence = missingCandidateState;
  await missingCandidatePage.close();

  report.failurePhase = 'missing-manifest-rejection';
  const missingManifestPath = 'artifacts/cast-correspondence-v0/absent-comparison.json';
  const missingManifestPage = await browser.newPage({ viewport: { width: 1100, height: 760 } });
  await missingManifestPage.goto(
    `${baseUrl}/?proxy_rig_comparison=${encodeURIComponent(missingManifestPath)}`,
    { waitUntil: 'domcontentloaded', timeout: 60000 },
  );
  await missingManifestPage.waitForFunction(
    () => window.kaminosProxyRigComparisonDebugState?.().status === 'error',
    null,
    { timeout: 60000 },
  );
  const missingManifestState = await missingManifestPage.evaluate(
    () => window.kaminosProxyRigComparisonDebugState(),
  );
  assert(/404/.test(missingManifestState.error), 'missing manifest did not preserve its failed fetch');
  assert(missingManifestState.requestedManifestPath === missingManifestPath, 'missing manifest lost requested route identity');
  assert(missingManifestState.effectiveManifestPath === null, 'missing manifest installed an effective route');
  assert(missingManifestState.liveRig === null, 'missing manifest loaded a fallback rig');
  report.missingManifest = missingManifestState;
  report.lastTrustworthyEvidence = missingManifestState;
  await missingManifestPage.close();

  report.failurePhase = 'comparison-load';
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const consoleErrors = [];
  page.on('pageerror', error => consoleErrors.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(`console: ${message.text()}`);
  });
  const firstCandidate = manifest.candidates[0];
  await page.goto(routeFor(firstCandidate.id), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(
    candidateId => window.kaminosProxyRigComparisonDebugState?.().status === 'live'
      && window.kaminosProxyRigComparisonDebugState().candidateId === candidateId,
    firstCandidate.id,
    { timeout: 60000 },
  );
  const firstComparison = await page.evaluate(() => window.kaminosProxyRigComparisonDebugState());
  report.effectiveManifestPath = firstComparison.effectiveManifestPath;
  assert(firstComparison.requestedManifestPath === manifestPath, 'comparison lost requested manifest identity');
  assert(firstComparison.effectiveManifestPath.endsWith(manifestPath), 'comparison lost effective manifest identity');
  const expectedControls = firstComparison.liveRig.controls;
  assert(expectedControls.length === 12, `comparison exposed ${expectedControls.length} controls instead of twelve`);

  await page.evaluate(poseEntries => {
    window.kaminosProxyRigSelectControl('hindlimb-right-stifle');
    for (const [name, quaternion] of poseEntries) {
      window.kaminosProxyRigSetControlQuaternion(name, quaternion);
    }
  }, Object.entries(pose));
  const canvas = page.locator('#viewport > canvas').first();
  const canvasBox = await canvas.boundingBox();
  assert(canvasBox, 'comparison canvas is missing');
  await page.mouse.move(canvasBox.x + canvasBox.width * 0.84, canvasBox.y + canvasBox.height * 0.24);
  await page.mouse.wheel(0, -420);
  await page.waitForTimeout(300);
  const carryReference = await page.evaluate(() => window.kaminosProxyRigDebugState());
  assert(!arraysNear(carryReference.cameraPosition, [0.25, 0.7, 3.15], 1e-4), 'camera exercise did not change the default view');

  for (const candidate of manifest.candidates) {
    report.failurePhase = `candidate-${candidate.id}`;
    if (candidate.id !== firstCandidate.id) {
      await page.selectOption('#proxy-rig-candidate-select', candidate.id);
      await page.waitForFunction(
        candidateId => window.kaminosProxyRigComparisonDebugState?.().status === 'live'
          && window.kaminosProxyRigComparisonDebugState().candidateId === candidateId,
        candidate.id,
        { timeout: 60000 },
      );
    }
    await page.waitForTimeout(500);
    const comparisonState = await page.evaluate(() => window.kaminosProxyRigComparisonDebugState());
    const liveState = comparisonState.liveRig;
    const packageData = packageByCandidate.get(candidate.id);
    validateProxyRigComparisonLiveState({
      manifest,
      candidateId: candidate.id,
      expectedPackageId: packageData.packageId,
      liveState,
    });
    assert(comparisonState.candidatePackagePath === candidate.package, `${candidate.id}: controller package path drifted`);
    assert(JSON.stringify(liveState.controls) === JSON.stringify(expectedControls), `${candidate.id}: control contract drifted`);
    assert(liveState.selectedControl === 'hindlimb-right-stifle', `${candidate.id}: selected control was not carried`);
    assert(arraysNear(liveState.cameraPosition, carryReference.cameraPosition), `${candidate.id}: camera position was not carried`);
    assert(arraysNear(liveState.orbitTarget, carryReference.orbitTarget), `${candidate.id}: orbit target was not carried`);
    for (const [name, quaternion] of Object.entries(pose)) {
      assert(arraysNear(liveState.controlQuaternions[name], quaternion), `${candidate.id}: pose for ${name} was not carried`);
    }
    const image = await canvas.screenshot({
      path: resolve(outputDir, `${candidate.id}-posed-canvas.png`),
    });
    const stats = await pixelStats(page, image);
    assert(stats.variance > 20, `${candidate.id}: canvas is visually blank (${JSON.stringify(stats)})`);
    await page.screenshot({
      path: resolve(outputDir, `${candidate.id}-posed-page.png`),
      fullPage: true,
    });
    const candidateResult = {
      id: candidate.id,
      role: candidate.role,
      seriousVisibleChoice: candidate.seriousVisibleChoice,
      requestedPackagePath: liveState.requestedPackagePath,
      effectivePackagePath: liveState.effectivePackagePath,
      packageId: liveState.packageId,
      selectedControl: liveState.selectedControl,
      cameraPosition: liveState.cameraPosition,
      orbitTarget: liveState.orbitTarget,
      pixelStats: stats,
      renderBackend: liveState.renderBackend,
      renderKernel: liveState.renderKernel,
    };
    report.candidates.push(candidateResult);
    report.lastTrustworthyEvidence = candidateResult;
  }
  assert(consoleErrors.length === 0, `comparison console errors: ${consoleErrors.join(' | ')}`);
  await page.close();

  report.status = 'passed';
  report.failurePhase = null;
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
    console.error(`Unable to write comparison witness report: ${error?.stack || error}`);
    terminalError ||= error;
  }
}

process.stdout.write(`${JSON.stringify(report)}\n`);
if (terminalError) process.exitCode = 1;
