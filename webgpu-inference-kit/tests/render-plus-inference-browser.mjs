import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = process.env.RENDER_INFERENCE_OUTPUT;
if (!output) throw new Error('RENDER_INFERENCE_OUTPUT must name the caller-owned report directory');
await fs.mkdir(output, { recursive: true });
const report = {
  status: 'failed', phase: 'setup', sourceSha256: {}, checks: [], pageErrors: [],
  requestedRoute: process.env.RENDER_INFERENCE_URL, effectiveRoute: null,
};
let browser;

async function browserPixelProof(page, multiplier) {
  return page.evaluate(async multiplierValue => {
    const source = document.querySelector('#source-image');
    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = source.naturalWidth;
    sourceCanvas.height = source.naturalHeight;
    const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
    sourceContext.drawImage(source, 0, 0);
    const input = sourceContext.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height).data;
    const canvasPixels = document.querySelector('#processed').getContext('2d')
      .getImageData(0, 0, sourceCanvas.width, sourceCanvas.height).data;
    const outputPixels = window.lastBrightnessCompletion.output.pixels;
    let mismatches = 0;
    let canvasMismatches = 0;
    let changedChannels = 0;
    let alphaMismatches = 0;
    const mismatchSamples = [];
    for (let index = 0; index < input.length; index += 4) {
      for (let channel = 0; channel < 3; channel += 1) {
        const expected = Math.min(255, Math.max(0, Math.round(input[index + channel] * multiplierValue)));
        if (outputPixels[index + channel] !== expected) {
          mismatches += 1;
          if (mismatchSamples.length < 12) {
            mismatchSamples.push({ input: input[index + channel], expected, actual: outputPixels[index + channel], channel });
          }
        }
        if (outputPixels[index + channel] !== input[index + channel]) changedChannels += 1;
      }
      if (outputPixels[index + 3] !== input[index + 3]) alphaMismatches += 1;
      for (let channel = 0; channel < 4; channel += 1) {
        if (canvasPixels[index + channel] !== outputPixels[index + channel]) canvasMismatches += 1;
      }
    }
    const digest = await crypto.subtle.digest('SHA-256', outputPixels);
    return {
      width: sourceCanvas.width,
      height: sourceCanvas.height,
      mismatches,
      changedChannels,
      alphaMismatches,
      canvasMismatches,
      mismatchSamples,
      sha256: Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join(''),
    };
  }, multiplier);
}

try {
  const files = ['package.json'];
  for (const directory of ['src', 'examples']) {
    for (const file of await fs.readdir(path.join(root, directory), { recursive: true })) {
      if (/\.(?:m?js|html|jpg)$/.test(file)) files.push(`${directory}/${file}`);
    }
  }
  for (const file of files.sort()) {
    report.sourceSha256[file] = createHash('sha256').update(await fs.readFile(path.join(root, file))).digest('hex');
  }
  if (process.env.RENDER_INFERENCE_INSTALLED_ROOT) {
    const installedRoot = await fs.realpath(process.env.RENDER_INFERENCE_INSTALLED_ROOT);
    assert.notEqual(installedRoot, await fs.realpath(root), 'installed route must not be the source checkout');
    if (!process.env.RENDER_INFERENCE_TARBALL) throw new Error('installed replay requires its tarball');
    report.packageIdentity = {
      installedRoot,
      tarball: process.env.RENDER_INFERENCE_TARBALL,
      tarballSha256: createHash('sha256').update(await fs.readFile(process.env.RENDER_INFERENCE_TARBALL)).digest('hex'),
    };
    for (const [file, hash] of Object.entries(report.sourceSha256)) {
      assert.equal(
        createHash('sha256').update(await fs.readFile(path.join(installedRoot, file))).digest('hex'),
        hash,
        `installed source differs: ${file}`,
      );
    }
  }
  if (!report.requestedRoute) throw new Error('RENDER_INFERENCE_URL must name the served example');
  const { default: puppeteer } = await import(process.env.PUPPETEER_MODULE || 'puppeteer-core');
  report.browserPath = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  browser = await puppeteer.launch({
    executablePath: report.browserPath,
    headless: true,
    args: ['--enable-unsafe-webgpu'],
    protocolTimeout: 0,
  });
  report.browser = await browser.version();
  const page = await browser.newPage();
  page.setDefaultTimeout(0);
  page.on('pageerror', error => report.pageErrors.push(error.message));
  await page.setViewport({ width: 1280, height: 1000 });
  report.phase = 'load';
  await page.goto(report.requestedRoute);
  report.effectiveRoute = page.url();
  assert.equal(report.effectiveRoute, report.requestedRoute);
  await page.waitForFunction(() => window.renderInferenceExample || document.querySelector('#error')?.textContent);
  assert.equal(await page.$eval('#error', node => node.textContent), '');
  assert.match(await page.$eval('h1', node => node.textContent), /Brighten a photo with WebGPU/);
  assert.match(await page.$eval('#mechanism-heading', node => node.textContent), /What happens/);
  assert.equal(await page.$eval('#source-image', image => `${image.naturalWidth}x${image.naturalHeight}`), '768x512');

  for (const [file, expected] of Object.entries(report.sourceSha256)) {
    const hash = await page.evaluate(async fileName => {
      const response = await fetch(new URL(`../${fileName}`, location.href), { cache: 'no-store' });
      if (!response.ok) throw new Error(`source fetch failed: ${fileName}`);
      const digest = await crypto.subtle.digest('SHA-256', await response.arrayBuffer());
      return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
    }, file);
    assert.equal(hash, expected, `effective source differs: ${file}`);
  }
  report.checks.push('friendly explanation, source image, and effective served bytes');

  await page.waitForFunction(() => window.renderInferenceExample.snapshot().frames >= 3);
  report.backend = await page.evaluate(() => window.renderInferenceExample.snapshot().backend);
  assert.equal(report.backend.kind, 'webgpu-local');
  const firstActivity = await (await page.$('#activity')).screenshot();
  const beforeFrames = await page.evaluate(() => window.renderInferenceExample.snapshot().frames);
  await page.waitForFunction(value => window.renderInferenceExample.snapshot().frames > value + 4, {}, beforeFrames);
  const secondActivity = await (await page.$('#activity')).screenshot();
  assert.notDeepEqual(firstActivity, secondActivity, 'activity indicator must visibly animate');
  report.checks.push('native WebGPU renderer is visibly active before inference');

  report.phase = 'brighten';
  await page.click('#apply');
  await page.waitForFunction(() => window.lastBrightnessCompletion);
  assert.equal(await page.evaluate(() => window.lastBrightnessCompletion.status), 'succeeded');
  assert.equal(await page.$eval('#result-title', node => node.textContent), 'Processed · 1.50×');
  assert.match(await page.$eval('#result-caption', node => node.textContent), /multiplied by 1.50 on the GPU/);
  assert.equal(await page.$eval('#empty-result', node => getComputedStyle(node).display), 'none');
  if (process.env.RENDER_INFERENCE_PERTURB_CANVAS === '1') {
    report.injectedFault = 'displayed-canvas-pixel';
    await page.evaluate(() => {
      const context = document.querySelector('#processed').getContext('2d');
      const pixel = context.getImageData(0, 0, 1, 1);
      pixel.data[0] ^= 255;
      context.putImageData(pixel, 0, 0);
    });
  }
  const bright = await browserPixelProof(page, 1.5);
  report.brightResult = bright;
  assert.equal(bright.mismatches, 0);
  assert.equal(bright.alphaMismatches, 0);
  assert.equal(bright.canvasMismatches, 0, 'displayed bright image must match GPU output');
  assert.ok(bright.changedChannels > bright.width * bright.height, 'brightness operation must visibly change the photograph');
  report.checks.push('full photograph matches the exact 1.50x RGB transform');

  report.phase = 'repeat-darker';
  await page.$eval('#brightness', element => {
    element.value = '0.5';
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.click('#apply');
  await page.waitForFunction(() => window.renderInferenceExample.snapshot().runs === 2);
  assert.equal(await page.$eval('#result-title', node => node.textContent), 'Processed · 0.50×');
  const dark = await browserPixelProof(page, 0.5);
  report.darkResult = dark;
  assert.equal(dark.mismatches, 0);
  assert.equal(dark.alphaMismatches, 0);
  assert.equal(dark.canvasMismatches, 0, 'displayed dark image must match GPU output');
  assert.notEqual(dark.sha256, bright.sha256);
  report.checks.push('repeat run reuses the application and produces exact 0.50x pixels');

  report.phase = 'failure-recovery';
  const failure = await page.evaluate(async () => {
    try { await window.renderInferenceExample.run({ multiplier: 1.25, pixels: new Uint8Array([1, 2, 3, 4]) }); }
    catch (error) { return error.message; }
    return null;
  });
  assert.match(failure, /exactly 393216 RGBA pixels/);
  const recovered = await page.evaluate(() => window.renderInferenceExample.run({ multiplier: 1 }));
  assert.equal(recovered.status, 'succeeded');
  assert.equal(await page.evaluate(() => window.renderInferenceExample.snapshot().runs), 3);
  report.checks.push('bad image input settles and the next GPU run succeeds');

  report.phase = 'desktop';
  await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });
  report.phase = 'mobile';
  await page.setViewport({ width: 390, height: 844 });
  await page.waitForFunction(() => document.querySelector('#activity').width === Math.round(document.querySelector('#activity').clientWidth * devicePixelRatio));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true });
  report.checks.push('desktop and mobile worked-example views captured without horizontal overflow');

  report.phase = 'dispose';
  const stopped = await page.evaluate(async () => {
    const app = window.renderInferenceExample;
    await app.dispose();
    await app.dispose();
    const frames = app.snapshot().frames;
    await new Promise(resolve => setTimeout(resolve, 60));
    let rejected = false;
    try { app.run(); } catch (error) { rejected = /disposed/.test(error.message); }
    return { frames, after: app.snapshot().frames, rejected };
  });
  assert.equal(stopped.after, stopped.frames);
  assert.equal(stopped.rejected, true);
  report.checks.push('idempotent disposal stops rendering and rejects new runs');

  report.phase = 'setup-failure';
  const cleanup = await page.evaluate(async () => {
    const { createRenderPlusInferenceExample } = await import('../examples/render-plus-inference.mjs');
    let destroyed = false;
    const gpu = {
      getPreferredCanvasFormat: () => navigator.gpu.getPreferredCanvasFormat(),
      async requestAdapter() {
        const adapter = await navigator.gpu.requestAdapter();
        return {
          features: adapter.features, limits: adapter.limits, info: adapter.info,
          async requestDevice(descriptor) {
            const device = await adapter.requestDevice(descriptor);
            const destroy = device.destroy.bind(device);
            device.destroy = () => { destroyed = true; destroy(); };
            return device;
          },
        };
      },
    };
    let error;
    try {
      await createRenderPlusInferenceExample({
        gpu,
        sourceImage: document.querySelector('#source-image'),
        canvas: { getContext() { throw new Error('injected unavailable activity canvas'); } },
      });
    } catch (cause) { error = cause.message; }
    return { destroyed, error };
  });
  assert.match(cleanup.error, /injected unavailable activity canvas/);
  assert.equal(cleanup.destroyed, true);
  report.checks.push('initialization failure releases its owned device');

  report.phase = 'observer-failure';
  const observers = await page.evaluate(async () => {
    const { createRenderPlusInferenceExample } = await import('../examples/render-plus-inference.mjs');
    const results = [];
    for (const mode of ['invalid', 'initial', 'running', 'reentrant']) {
      let destroyed = false;
      let requested = 0;
      const gpu = {
        getPreferredCanvasFormat: () => navigator.gpu.getPreferredCanvasFormat(),
        async requestAdapter() {
          requested += 1;
          const adapter = await navigator.gpu.requestAdapter();
          return {
            features: adapter.features, limits: adapter.limits, info: adapter.info,
            async requestDevice(descriptor) {
              const device = await adapter.requestDevice(descriptor);
              const destroy = device.destroy.bind(device);
              device.destroy = () => { destroyed = true; destroy(); };
              return device;
            },
          };
        },
      };
      const canvas = document.createElement('canvas');
      document.body.append(canvas);
      let app, error, completion, snapshot, nestedError;
      let attempted = false;
      let nestedRun;
      try {
        app = await createRenderPlusInferenceExample({
          canvas,
          gpu,
          sourceImage: document.querySelector('#source-image'),
          onState: mode === 'invalid' ? null : state => {
            if (mode === 'reentrant') {
              if (state.status === 'running' && !attempted) {
                attempted = true;
                try { nestedRun = app.run().catch(cause => { nestedError = cause.message; }); }
                catch (cause) { nestedError = cause.message; }
              }
              return;
            }
            if (mode === 'initial' || state.status === 'running') throw new Error(`injected ${mode} observer`);
          },
        });
        completion = await app.run({ multiplier: 1.1 });
        snapshot = app.snapshot();
      } catch (cause) { error = cause.message; }
      finally { await nestedRun; await app?.dispose(); canvas.remove(); }
      results.push({ mode, destroyed, requested, error, snapshot, nestedError, attempted, status: completion?.status });
    }
    return results;
  });
  assert.equal(observers[0].requested, 0);
  assert.match(observers[0].error, /onState/);
  assert.equal(observers[1].destroyed, true);
  assert.match(observers[1].error, /injected initial observer/);
  assert.equal(observers[2].status, 'succeeded');
  assert.equal(observers[2].snapshot.status, 'succeeded');
  assert.match(observers[2].snapshot.observerError, /injected running observer/);
  assert.equal(observers[2].destroyed, true);
  report.observers = observers;
  assert.equal(observers[3].attempted, true);
  assert.match(observers[3].nestedError, /already running/);
  assert.equal(observers[3].status, 'succeeded');
  assert.equal(observers[3].snapshot.runs, 1);
  assert.equal(observers[3].destroyed, true);
  report.checks.push('observer validation, initial cleanup, and runtime failure isolation');

  assert.deepEqual(report.pageErrors, []);
  report.status = 'succeeded';
  report.phase = null;
} catch (error) {
  report.error = { name: error.name, message: error.message, stack: error.stack };
  process.exitCode = 1;
} finally {
  await fs.writeFile(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  await browser?.close();
  console.log(JSON.stringify({
    status: report.status,
    phase: report.phase,
    checks: report.checks,
    error: report.error,
    reportPath: path.join(output, 'report.json'),
  }, null, 2));
}
