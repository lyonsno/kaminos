// Smoke the public Klein page (index.html) the way a visitor uses it, in an independent
// Chrome for Testing: check the pre-load state, press Load, generate at each size through the
// page's own controls, then reload, confirm the page reports the weights as cached, and generate
// every size again in reverse order: each size must give identical pixels in both sessions, so
// an output that depends on which sizes ran earlier (stale or undersized buffers) fails.
// Usage: node run-page-smoke.mjs --chrome <exe> (--weights-url <base> | --weights-dir <dir>) --out <dir>
//        [--sizes 512,768,1024 | --levels mint,weathered,off-the-rails [--size 512]] [--seed 7006] [--prompt "..."]
//        [--origin <page origin> | --site-dir <dir>]
// --site-dir serves an assembled Pages site (scripts/assemble-pages-site.mjs) under /kaminos/, as
// project Pages does, and opens the demo at /kaminos/inference-kit/klein/.
// --weights-dir serves a staged repository folder from a second, CORS-enabled origin.
// --throttle-mbps N limits the page's download speed (to watch a slow first visit locally).
// --profile-dir keeps and reuses a Chrome profile (and its weight cache); otherwise the profile is
// temporary and removed at exit. --stall-ms (default 300000) fails a wait whose status stops changing.
// Writes report.json (written even when a phase fails), per-size PNGs and page screenshots.
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, launchChrome, sourceIdentity } from './cdp-harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const outDir = path.resolve(opt('--out'));
const report = { schema: 'kaminos.flux2-klein.page-smoke.v0', host: os.hostname(), startedAt: new Date().toISOString(),
  source: sourceIdentity(here), phase: 'setup', steps: [] };
let browser, server, weightServer;

async function finish(code) {
  await browser?.close(); server?.close(); weightServer?.close();
  report.finishedAt = new Date().toISOString();
  await fsp.mkdir(outDir, { recursive: true });
  await fsp.writeFile(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  process.exit(code);
}

// SHA-256 of the output canvas pixels.
const imageHash = `(async () => { const c = document.getElementById('out');
  const px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', px))].map(b => b.toString(16).padStart(2, '0')).join(''); })()`;

const pageState = `({ load: document.getElementById('load').textContent, loadDisabled: document.getElementById('load').disabled,
  status: document.getElementById('status').textContent, warn: document.getElementById('status').classList.contains('warn'),
  controls: !document.getElementById('controls').classList.contains('hidden') })`;

// Wait until expr is truthy. There is no overall deadline (a first download can take many minutes
// on a slow link); the wait fails only when the page's status text stops changing for stallMs.
async function waitFor(expr, label, { stallMs = Number(opt('--stall-ms', String(5 * 60e3))) } = {}) {
  let lastStatus = null, lastChange = Date.now();
  for (;;) {
    const value = await browser.evaluate(expr, false).catch(() => null);
    if (value) return value;
    const status = await browser.evaluate(`document.getElementById('status').textContent`, false).catch(() => null);
    if (status !== lastStatus) { lastStatus = status; lastChange = Date.now(); }
    if (Date.now() - lastChange > stallMs) throw new Error(`no progress for ${Math.round(stallMs / 1000)} s waiting for ${label}; last status: ${lastStatus}`);
    await new Promise(r => setTimeout(r, 250));
  }
}

async function screenshot(name, { width, height, mobile = false }) {
  await browser.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
  await new Promise(r => setTimeout(r, 300));
  const shot = await browser.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  if (!shot.result?.data) throw new Error(`screenshot ${name} returned no data`);
  await fsp.writeFile(path.join(outDir, `${name}.png`), Buffer.from(shot.result.data, 'base64'));
  report.steps.push({ step: `screenshot:${name}`, width, height, mobile });
}

try {
  await fsp.mkdir(outDir, { recursive: true });
  if (opt('--weights-dir')) {
    report.weightsDir = path.resolve(opt('--weights-dir'));
    const s = await startServer({ '/': report.weightsDir }, 0, { cors: true });
    weightServer = s.server; report.weightsUrl = s.origin;
  } else report.weightsUrl = opt('--weights-url');
  if (!report.weightsUrl) throw new Error('--weights-url or --weights-dir is required');
  if (opt('--origin')) report.origin = opt('--origin');
  else if (opt('--site-dir')) {
    report.siteDir = path.resolve(opt('--site-dir'));
    const s = await startServer({ '/kaminos/': report.siteDir });
    server = s.server; report.origin = `${s.origin}/kaminos/inference-kit/klein`;
  } else ({ server } = await startServer({ '/webgpu-inference-kit/': path.resolve(opt('--kit', path.join(here, '../../webgpu-inference-kit'))), '/': here })
    .then(s => { report.origin = s.origin; return s; }));
  browser = await launchChrome(opt('--chrome'), [], report, { profileDir: opt('--profile-dir') ?? null });
  const desktop = { width: 1280, height: 900 };
  await browser.send('Emulation.setDeviceMetricsOverride', { ...desktop, deviceScaleFactor: 1, mobile: false });
  const firstLevel = opt('--levels')?.split(',')[0];
  const pageUrl = `${report.origin}/index.html?weights=${encodeURIComponent(report.weightsUrl)}${firstLevel ? `&level=${firstLevel}` : ''}`;
  report.pageUrl = pageUrl;

  report.phase = 'prepare';
  await browser.navigate(pageUrl, 'Boolean(window.kleinPrepared)');
  await browser.evaluate('window.kleinPrepared');
  report.beforeLoad = await browser.evaluate(pageState);
  await screenshot('before-load-desktop', desktop);
  if (report.beforeLoad.loadDisabled) throw new Error(`load button disabled before load: ${report.beforeLoad.status}`);

  report.phase = 'load';
  if (opt('--throttle-mbps')) {
    report.throttleMbps = Number(opt('--throttle-mbps'));
    await browser.send('Network.enable');
    const throttled = await browser.send('Network.emulateNetworkConditions', { offline: false, latency: 0, uploadThroughput: -1,
      downloadThroughput: report.throttleMbps * 1e6 / 8 });
    if (throttled.error) throw new Error(`network throttling failed: ${JSON.stringify(throttled.error)}`);
  }
  // The scene must keep drawing while the weights load: count its frames across the load.
  const framesAtClick = await browser.evaluate('window.kleinDemo.scene.frames');
  const loadStarted = Date.now();
  await browser.evaluate(`document.getElementById('load').click()`, false);
  const during = await waitFor(`(() => { const s = ${pageState}; return /MB\\/s/.test(s.status) || s.controls || /failed/i.test(s.status) ? s : null; })()`, 'load progress');
  if (!during.controls) {
    report.duringLoad = { ...during, sceneFrames: await browser.evaluate('window.kleinDemo.scene.frames') - framesAtClick, atMs: Date.now() - loadStarted };
    await screenshot('during-load-desktop', desktop);
  }
  report.afterLoad = await waitFor(`(() => { const s = ${pageState}; return s.controls || /failed/i.test(s.status) ? s : null; })()`, 'load');
  report.afterLoad.wallMs = Date.now() - loadStarted;
  if (!report.afterLoad.controls) throw new Error(`load failed: ${report.afterLoad.status}`);
  report.afterLoad.sceneFrames = await browser.evaluate('window.kleinDemo.scene.frames') - framesAtClick;
  report.afterLoad.sceneFps = report.afterLoad.sceneFrames / (report.afterLoad.wallMs / 1000);
  if (report.afterLoad.sceneFps < 5) throw new Error(`the scene drew ${report.afterLoad.sceneFrames} frames during a ${report.afterLoad.wallMs} ms load`);
  if (report.throttleMbps) await browser.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  report.loadStats = await browser.evaluate('window.kleinDemo.pipeline.loadStats');

  report.phase = 'generate';
  report.generations = [];
  if (opt('--levels')) { await levelsFlow(opt('--levels').split(',')); report.phase = 'done'; await finish(0); }
  const sizes = opt('--sizes', '512,768,1024').split(',').map(Number);
  await generateSizes(sizes, 1);
  await screenshot('after-generate-mobile', { width: 390, height: 844, mobile: true });

  report.phase = 'cache-check';
  await browser.send('Emulation.setDeviceMetricsOverride', { ...desktop, deviceScaleFactor: 1, mobile: false });
  await browser.navigate(pageUrl, 'Boolean(window.kleinPrepared)');
  await browser.evaluate('window.kleinPrepared');
  report.reload = await browser.evaluate(pageState);
  if (!/cached/i.test(report.reload.load)) throw new Error(`reload does not report cached weights: ${report.reload.load}`);

  report.phase = 'history-check';
  await browser.evaluate(`document.getElementById('load').click()`, false);
  const reloaded = await waitFor(`(() => { const s = ${pageState}; return s.controls || /failed/i.test(s.status) ? s : null; })()`, 'cached load');
  if (!reloaded.controls) throw new Error(`cached load failed: ${reloaded.status}`);
  report.reloadStats = await browser.evaluate('window.kleinDemo.pipeline.loadStats');
  await generateSizes([...sizes].reverse(), 2);
  report.historyCheck = sizes.map(size => {
    const [a, b] = [1, 2].map(session => report.generations.find(g => g.size === size && g.session === session)?.pixelSha256);
    return { size, identical: Boolean(a) && a === b, session1: a, session2: b };
  });
  const differing = report.historyCheck.filter(h => !h.identical).map(h => h.size);
  if (differing.length) throw new Error(`output depends on generation history at sizes ${differing.join(', ')}`);
  report.phase = 'done';
  await finish(0);
} catch (e) {
  report.error = String(e?.stack || e);
  await finish(1);
}

// --levels a,b,c: generate at the loaded level a, switch to each later level through the page's
// selector and generate again, then reload fresh at the last level: the swap path and a fresh load
// of that level must give identical pixels.
async function levelsFlow(levels) {
  const size = Number(opt('--size', '512'));
  report.levels = [];
  const generateOne = async (level, session) => {
    await generateSizes([size], session);
    const row = report.generations.at(-1);
    row.level = await browser.evaluate('window.kleinLast.level');
    if (row.level !== level) throw new Error(`generated at ${row.level}, expected ${level}`);
    await fsp.rename(path.join(outDir, `image-${size}-session${session}.png`), path.join(outDir, `image-${level}-session${session}.png`));
    report.levels.push({ level, session, pixelSha256: row.pixelSha256, wallMs: row.wallMs, status: row.status });
  };
  const loaded = await browser.evaluate('window.kleinLevel');
  if (loaded !== levels[0]) throw new Error(`page loaded level ${loaded}, expected ${levels[0]}`);
  await generateOne(levels[0], 1);
  for (const level of levels.slice(1)) {
    const started = Date.now();
    await browser.evaluate(`document.querySelector('input[name="level"][value="${level}"]').click()`, false);
    const done = await waitFor(`(() => { const s = ${pageState}; return window.kleinLevel === '${level}' && !document.getElementById('go').disabled
      ? s : /failed/i.test(s.status) ? s : null; })()`, `switch to ${level}`);
    if (/failed/i.test(done.status)) throw new Error(`switch to ${level} failed: ${done.status}`);
    report.levels.push({ level, swapMs: Date.now() - started, swapStatus: done.status });
    await generateOne(level, 1);
  }
  await screenshot('after-levels-desktop', { width: 1280, height: 900 });
  report.phase = 'fresh-load';
  const last = levels.at(-1);
  const url = new URL(report.pageUrl); url.searchParams.set('level', last);
  await browser.navigate(url.toString(), 'Boolean(window.kleinPrepared)');
  await browser.evaluate('window.kleinPrepared');
  await browser.evaluate(`document.getElementById('load').click()`, false);
  const ready = await waitFor(`(() => { const s = ${pageState}; return s.controls || /failed/i.test(s.status) ? s : null; })()`, `fresh load of ${last}`);
  if (!ready.controls) throw new Error(`fresh load of ${last} failed: ${ready.status}`);
  await generateOne(last, 2);
  const [swapped, fresh] = report.levels.filter(l => l.level === last && l.pixelSha256);
  report.swapMatchesFreshLoad = swapped.pixelSha256 === fresh.pixelSha256;
  if (!report.swapMatchesFreshLoad) throw new Error(`${last}: swapped ${swapped.pixelSha256} != fresh ${fresh.pixelSha256}`);
}

async function generateSizes(sizes, session) {
  const seed = Number(opt('--seed', '7006'));
  const desktop = { width: 1280, height: 900 };
  for (const size of sizes) {
    await browser.evaluate(`(() => { window.kleinLast = null;
      document.getElementById('size').value = '${size}'; document.getElementById('seed').value = '${seed}';
      ${opt('--prompt') ? `{ const el = document.getElementById('prompt'); el.value = ${JSON.stringify(opt('--prompt'))}; el.dispatchEvent(new Event('input')); }` : ''}
      document.getElementById('go').click(); })()`, false);
    const done = await waitFor(`(() => { const s = ${pageState}; const go = document.getElementById('go');
      return !go.disabled && (window.kleinLast || s.warn || /stopped/i.test(s.status)) ? { ...s, last: window.kleinLast } : null; })()`, `generate ${size}`);
    const row = { session, size, status: done.status, warn: done.warn, ...(done.last ?? {}) };
    report.generations.push(row);
    if (!done.last) throw new Error(`generation at ${size} failed: ${done.status}`);
    row.pixelSha256 = await browser.evaluate(imageHash);
    const png = await browser.evaluate(`document.getElementById('out').toDataURL('image/png')`);
    await fsp.writeFile(path.join(outDir, `image-${size}-session${session}.png`), Buffer.from(png.split(',')[1], 'base64'));
    if (session === 1 && size === sizes[0]) await screenshot('after-generate-desktop', desktop);
  }
}
