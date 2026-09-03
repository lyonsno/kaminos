#!/usr/bin/env node

import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

const baseUrl = argument('--base-url', 'http://127.0.0.1:18788');
const outputPath = resolve(argument('--output', '/tmp/kaminos-full-support-instance-consumer/report.json'));
const instanceCount = Math.max(1, Math.min(128, Math.round(Number(argument('--instances', '4')))));
const sharpRepo = resolve(process.env.KAMINOS_SHARP_WEBGPU_REPO || '/Users/noahlyons/dev/sharp-webgpu');
const chromePath = process.env.KAMINOS_SHARP_WEBGPU_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const screenshotPath = resolve(dirname(outputPath), 'frame.png');
const route = new URL('/index.html', baseUrl);
route.searchParams.set('kaminos_volume_smoke', '1');
route.searchParams.set('volume_scene', 'tall_plume');
route.searchParams.set('volume_resolution', '64');
route.searchParams.set('volume_boundary_splat_mode', 'kernel_moment_full_flame_union');
route.searchParams.set('volume_boundary_splat_instance_consumer', '1');
route.searchParams.set('volume_boundary_splat_instances', String(instanceCount));
route.searchParams.set('volume_temporal_accum', '0');
route.searchParams.set('volume_temporal_jitter', '0');

await mkdir(dirname(outputPath), { recursive: true });
const report = {
  schema: 'kaminos.boundary-splat.full-support-instance-consumer-witness.v0',
  status: 'failed',
  route: { requested: route.href, effective: null },
  request: { instanceCount, targetPixels: [6, 9, 24] },
  failurePhase: 'browser-launch',
  lastTrustworthyEvidence: 'route-constructed',
  browserLogs: [],
};

let browser = null;
try {
  const require = createRequire(import.meta.url);
  const puppeteerPath = require.resolve('puppeteer-core', { paths: [sharpRepo] });
  const { default: puppeteer } = await import(pathToFileURL(puppeteerPath).href);
  browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: 'new',
    args: ['--enable-unsafe-webgpu', '--disable-gpu-sandbox', '--no-sandbox', '--disable-gpu-shader-disk-cache'],
    defaultViewport: { width: 1280, height: 900, deviceScaleFactor: 1 },
  });
  const page = await browser.newPage();
  page.on('console', message => report.browserLogs.push({ type: message.type(), text: message.text() }));
  page.on('pageerror', error => report.browserLogs.push({ type: 'pageerror', text: error?.message || String(error) }));
  report.failurePhase = 'route-load';
  await page.goto(route.href, { waitUntil: 'domcontentloaded', timeout: 180000 });
  report.route.effective = page.url();
  report.lastTrustworthyEvidence = 'document-loaded';
  report.failurePhase = 'webgpu-initialization';
  await page.waitForFunction(() => {
    const state = window.__kaminosVolumePrototype?.debugState?.();
    return state?.active === true || Boolean(state?.error);
  }, { timeout: 180000 });
  const initialState = await page.evaluate(() => window.__kaminosVolumePrototype.debugState());
  if (initialState.error) throw new Error(`volume-runtime-error:${initialState.error}`);
  report.lastTrustworthyEvidence = `runtime-active:${initialState.backend}`;
  report.failurePhase = 'instance-consumer-application';
  await page.evaluate(count => {
    window.__kaminosVolumePrototype.setControls({
      boundarySplatMode: 'kernel_moment_full_flame_union',
      boundarySplatInstanceConsumer: true,
      boundarySplatInstances: count,
      selectiveHeadLiveRenderComposition: 'splat-only-v0',
      lookFreeze: 1,
    });
  }, instanceCount);
  await new Promise(resolveTimeout => setTimeout(resolveTimeout, 4000));
  report.failurePhase = 'frozen-sample';
  const sameStateCaptureId = `full-support-instance-consumer-${Date.now()}`;
  const sample = await page.evaluate(async captureId => (
    window.__kaminosVolumePrototype.sampleFrame({
      advanceSim: false,
      includeRgba: false,
      sameStateCaptureId: captureId,
    })
  ), sameStateCaptureId);
  if (!sample?.ok) throw new Error(`sample-failed:${sample?.reason || 'unknown'}`);
  report.lastTrustworthyEvidence = `nonblank-frozen-sample:${sample.litPixels}`;
  report.failurePhase = 'stable-native-cell-residency';
  const residency = await page.evaluate(
    ({ captureId, lookFreezeFrame, simStepCount }) => window.__kaminosVolumePrototype.sampleBoundarySplatInstanceResidency({
      sameStateCaptureId: captureId,
      expectedLookFreezeFrame: lookFreezeFrame,
      expectedSimStepCount: simStepCount,
    }),
    {
      captureId: sameStateCaptureId,
      lookFreezeFrame: sample.lookFreezeFrame,
      simStepCount: sample.simStepCount,
    },
  );
  if (residency?.status !== 'validated' || residency?.nestedSetValidated !== true) {
    throw new Error(`instance-residency-not-validated:${residency?.status || 'missing'}`);
  }
  if (sample.sameStateCaptureId !== sameStateCaptureId
    || residency.sameStateCorrelationId !== sameStateCaptureId
    || residency.lookFreezeFrame !== sample.lookFreezeFrame
    || residency.simStepCount !== sample.simStepCount
    || typeof residency.populationStateSha256 !== 'string') {
    throw new Error('instance-residency-same-state-binding-mismatch');
  }
  const state = await page.evaluate(() => window.__kaminosVolumePrototype.debugState());
  if (state.error) throw new Error(`post-sample-runtime-error:${state.error}`);
  const receipt = state.boundarySplatInstanceConsumerReceipt;
  if (!receipt?.effective) throw new Error(`instance-consumer-not-effective:${receipt?.fallbackReason || 'missing-receipt'}`);
  if (receipt.requestedInstanceCount !== instanceCount || receipt.effectiveInstanceCount !== instanceCount) {
    throw new Error(`instance-count-mismatch:${receipt.requestedInstanceCount}/${receipt.effectiveInstanceCount}/${instanceCount}`);
  }
  if (receipt.sourceCompactionCount !== 1) {
    throw new Error('source-compaction-count-not-one');
  }
  if (!(receipt.sourceCandidateCount > 0)
    || !(receipt.renderedInstanceCount > receipt.sourceCandidateCount)) {
    throw new Error(`source-render-count-authority-not-separated:${receipt.sourceCandidateCount}/${receipt.renderedInstanceCount}`);
  }
  if (!(sample.litPixels > 0)) throw new Error('blank-capture');
  report.lastTrustworthyEvidence = `validated-residency:${residency.populationStateId}`;
  report.failurePhase = 'visual-capture';
  const canvas = await page.$('#kaminos-volume-canvas');
  if (!canvas) throw new Error('volume-canvas-missing');
  await canvas.screenshot({ path: screenshotPath });
  report.status = 'captured';
  report.failurePhase = null;
  report.sample = {
    width: sample.width,
    height: sample.height,
    litPixels: sample.litPixels,
    fireLikePixels: sample.fireLikePixels,
    sameStateCaptureId: sample.sameStateCaptureId,
    backend: sample.backend,
    effectiveRoute: sample.effectiveRoute,
    rendererIdentity: sample.boundarySplatRendererIdentity,
    candidateCount: sample.boundarySplatCandidateCount,
    renderedInstanceCount: sample.boundarySplatInstanceCount,
  };
  report.consumer = receipt;
  report.residency = residency;
  report.screenshotPath = screenshotPath;
  report.lastTrustworthyEvidence = `visual-capture:${screenshotPath}`;
} catch (error) {
  report.error = error?.stack || error?.message || String(error);
} finally {
  await browser?.close().catch(() => {});
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
}

console.log(JSON.stringify(report, null, 2));
if (report.status !== 'captured') process.exitCode = 1;
