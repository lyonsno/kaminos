import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = process.env.RENDER_INFERENCE_OUTPUT;
if (!output) throw new Error('RENDER_INFERENCE_OUTPUT must name the caller-owned report directory');
await fs.mkdir(output, { recursive: true });
const report = { status: 'failed', phase: 'setup', sourceSha256: {}, checks: [], pageErrors: [], requestedRoute: process.env.RENDER_INFERENCE_URL, effectiveRoute: null };
let browser;
try {
  const files = ['package.json'];
  for (const directory of ['src', 'examples']) {
    for (const file of await fs.readdir(path.join(root, directory), { recursive: true })) {
      if (/\.(?:m?js|html)$/.test(file)) files.push(`${directory}/${file}`);
    }
  }
  for (const file of files.sort()) {
    report.sourceSha256[file] = createHash('sha256').update(await fs.readFile(path.join(root, file))).digest('hex');
  }
  if (process.env.RENDER_INFERENCE_INSTALLED_ROOT) {
    const installedRoot = await fs.realpath(process.env.RENDER_INFERENCE_INSTALLED_ROOT);
    assert.notEqual(installedRoot, await fs.realpath(root), 'installed route must not be the source checkout');
    if (!process.env.RENDER_INFERENCE_TARBALL) throw new Error('installed replay requires its tarball');
    report.packageIdentity = { installedRoot, tarball: process.env.RENDER_INFERENCE_TARBALL,
      tarballSha256: createHash('sha256').update(await fs.readFile(process.env.RENDER_INFERENCE_TARBALL)).digest('hex') };
    for (const [file, hash] of Object.entries(report.sourceSha256)) {
      assert.equal(createHash('sha256').update(await fs.readFile(path.join(installedRoot, file))).digest('hex'), hash, `installed source differs: ${file}`);
    }
  }
  if (!report.requestedRoute) throw new Error('RENDER_INFERENCE_URL must name the served example');
  const { default: puppeteer } = await import(process.env.PUPPETEER_MODULE || 'puppeteer-core');
  report.browserPath = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  browser = await puppeteer.launch({ executablePath: report.browserPath, headless: true, args: ['--enable-unsafe-webgpu'], protocolTimeout: 0 });
  report.browser = await browser.version();
  const page = await browser.newPage();
  page.setDefaultTimeout(0);
  page.on('pageerror', error => report.pageErrors.push(error.message));
  await page.setViewport({ width: 1280, height: 900 });
  report.phase = 'load';
  await page.goto(report.requestedRoute);
  report.effectiveRoute = page.url();
  assert.equal(report.effectiveRoute, report.requestedRoute);
  await page.waitForFunction(() => window.renderInferenceExample || document.querySelector('#error')?.textContent);
  assert.equal(await page.$eval('#error', node => node.textContent), '');
  // Refuse stale servers/import maps, even when their example happens to pass.
  for (const [file, expected] of Object.entries(report.sourceSha256)) {
    const hash = await page.evaluate(async file => {
      const response = await fetch(new URL(`../${file}`, location.href), { cache: 'no-store' });
      if (!response.ok) throw new Error(`source fetch failed: ${file}`);
      const digest = await crypto.subtle.digest('SHA-256', await response.arrayBuffer());
      return Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
    }, file);
    assert.equal(hash, expected, `effective source differs: ${file}`);
  }
  await page.waitForFunction(() => window.renderInferenceExample.snapshot().frames >= 3);
  report.backend = await page.evaluate(() => window.renderInferenceExample.snapshot().backend);
  assert.equal(report.backend.kind, 'webgpu-local');
  report.checks.push('native WebGPU frames before inference');
  report.phase = 'mixed-run';
  await page.evaluate(() => { window.exampleRun = window.renderInferenceExample.run({ inputWaitMs: 500 }); });
  await page.waitForFunction(() => window.renderInferenceExample.snapshot().phase === 'Input wait');
  const during = await page.evaluate(async () => {
    const app = window.renderInferenceExample, before = app.snapshot().frames;
    await new Promise(resolve => setTimeout(resolve, 100));
    return { before, after: app.snapshot().frames, phase: app.snapshot().phase };
  });
  assert.ok(during.after > during.before, 'foreground frames must advance through asynchronous input');
  report.inputWindow = during;
  const completions = await page.evaluate(() => window.exampleRun);
  assert.deepEqual(completions.map(row => row.status), ['succeeded', 'succeeded']);
  assert.deepEqual(completions.map(row => row.output), [[1, 3, 5, 7], [9, 11, 13, 15]]);
  report.completions = completions;
  const after = await page.evaluate(() => window.renderInferenceExample.snapshot().frames);
  await page.waitForFunction(before => window.renderInferenceExample.snapshot().frames > before + 2, {}, after);
  report.checks.push('exact GPU outputs and frames after final drain');
  await page.screenshot({ path: path.join(output, 'desktop.png') });
  const firstCanvas = await (await page.$('canvas')).screenshot();
  await page.waitForFunction(before => window.renderInferenceExample.snapshot().frames > before + 8, {}, after);
  const secondCanvas = await (await page.$('canvas')).screenshot();
  assert.notDeepEqual(firstCanvas, secondCanvas, 'canvas must visibly animate');
  report.phase = 'cancel-queued';
  await page.evaluate(() => { window.exampleRun = window.renderInferenceExample.run({ inputWaitMs: 500 }); });
  await page.waitForFunction(() => window.renderInferenceExample.snapshot().phase === 'Input wait');
  await page.evaluate(() => window.renderInferenceExample.cancelQueued());
  const cancelled = await page.evaluate(() => window.exampleRun);
  assert.deepEqual(cancelled.map(row => row.status), ['succeeded', 'cancelled-before-start']);
  report.checks.push('queued cancellation preserves active job');
  report.phase = 'model-failure';
  const failed = await page.evaluate(() => window.renderInferenceExample.run({ inputWaitMs: 0, inputs: [[1], [4,5,6,7]] }));
  assert.equal(failed[0].status, 'failed');
  assert.equal(failed[1].status, 'succeeded');
  assert.match(failed[0].failure.message, /exactly 4/);
  const recovered = await page.evaluate(() => window.renderInferenceExample.run({ inputWaitMs: 0 }));
  assert.deepEqual(recovered.map(row => row.output), [[1,3,5,7],[9,11,13,15]]);
  report.checks.push('failed input settles and subsequent batch succeeds');
  report.phase = 'invalid-control';
  await page.$eval('#delay', node => { node.value = '-1'; });
  await page.click('#run');
  assert.match(await page.$eval('#error', node => node.textContent), /inputWaitMs must be non-negative/);
  await page.$eval('#delay', node => { node.value = '500'; });
  await page.click('#run');
  await page.waitForFunction(() => window.renderInferenceExample.snapshot().status === 'succeeded');
  report.checks.push('invalid input control reports its error and recovers');
  report.phase = 'mobile';
  await page.setViewport({ width: 390, height: 844 });
  await page.waitForFunction(() => document.querySelector('canvas').width === Math.round(document.querySelector('canvas').clientWidth * devicePixelRatio));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: path.join(output, 'mobile.png') });
  report.phase = 'dispose';
  const stopped = await page.evaluate(async () => {
    const app = window.renderInferenceExample;
    await app.dispose(); await app.dispose();
    const frames = app.snapshot().frames;
    await new Promise(resolve => setTimeout(resolve, 60));
    let rejected = false;
    try { app.run(); } catch (error) { rejected = /disposed/.test(error.message); }
    return { frames, after: app.snapshot().frames, rejected };
  });
  assert.equal(stopped.after, stopped.frames); assert.equal(stopped.rejected, true);
  report.checks.push('idempotent disposal stops rendering and rejects new runs');
  report.phase = 'setup-failure';
  const cleanup = await page.evaluate(async () => {
    const { createRenderPlusInferenceExample } = await import('../examples/render-plus-inference.mjs');
    let destroyed = false;
    const gpu = { getPreferredCanvasFormat: () => navigator.gpu.getPreferredCanvasFormat(), async requestAdapter() {
      const adapter = await navigator.gpu.requestAdapter();
      return { features: adapter.features, limits: adapter.limits, info: adapter.info, async requestDevice(descriptor) {
        const device = await adapter.requestDevice(descriptor), destroy = device.destroy.bind(device);
        device.destroy = () => { destroyed = true; destroy(); };
        return device;
      } };
    } };
    let error;
    try { await createRenderPlusInferenceExample({ gpu, canvas: { getContext() { throw new Error('injected unavailable canvas'); } } }); }
    catch (cause) { error = cause.message; }
    return { destroyed, error };
  });
  assert.match(cleanup.error, /injected unavailable canvas/);
  assert.equal(cleanup.destroyed, true, 'initialization failure must release its owned device');
  report.checks.push('initialization failure releases owned device');
  report.phase = 'observer-failure';
  const observers = await page.evaluate(async () => {
    const { createRenderPlusInferenceExample } = await import('../examples/render-plus-inference.mjs');
    const results = [];
    for (const mode of ['invalid', 'initial', 'running']) {
      let destroyed = false, requested = 0;
      const gpu = { getPreferredCanvasFormat: () => navigator.gpu.getPreferredCanvasFormat(), async requestAdapter() {
        requested += 1;
        const adapter = await navigator.gpu.requestAdapter();
        return { features: adapter.features, limits: adapter.limits, info: adapter.info, async requestDevice(descriptor) {
          const device = await adapter.requestDevice(descriptor), destroy = device.destroy.bind(device);
          device.destroy = () => { destroyed = true; destroy(); }; return device;
        } };
      } };
      const canvas = document.createElement('canvas'); document.body.append(canvas);
      let app, error, completions, snapshot;
      try {
        app = await createRenderPlusInferenceExample({ canvas, gpu, onState: mode === 'invalid' ? null : state => {
          if (mode === 'initial' || state.status === 'running') throw new Error(`injected ${mode} observer`);
        } });
        completions = await app.run({ inputWaitMs: 0 }); snapshot = app.snapshot();
      } catch (cause) { error = cause.message; }
      finally { await app?.dispose(); canvas.remove(); }
      results.push({ mode, destroyed, requested, error, snapshot, statuses: completions?.map(row => row.status) });
    }
    return results;
  });
  assert.equal(observers[0].requested, 0, 'invalid observer is refused before allocation');
  assert.match(observers[0].error, /onState/);
  assert.equal(observers[1].destroyed, true, 'initial observer exception must release device');
  assert.match(observers[1].error, /injected initial observer/);
  assert.deepEqual(observers[2].statuses, ['succeeded', 'succeeded']);
  assert.equal(observers[2].snapshot.status, 'succeeded');
  assert.match(observers[2].snapshot.observerError, /injected running observer/);
  assert.equal(observers[2].destroyed, true);
  report.checks.push('observer validation, initial cleanup, and runtime failure isolation');
  assert.deepEqual(report.pageErrors, []);
  report.status = 'succeeded'; report.phase = null;
} catch (error) {
  report.error = { name: error.name, message: error.message, stack: error.stack };
  process.exitCode = 1;
} finally {
  await fs.writeFile(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  await browser?.close();
  console.log(JSON.stringify({ status: report.status, phase: report.phase, checks: report.checks, error: report.error, reportPath: path.join(output, 'report.json') }, null, 2));
}
