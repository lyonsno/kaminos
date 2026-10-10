// Smoke the public Klein page (index.html) the way a visitor uses it, in an independent
// Chrome for Testing: check the pre-load state, press Load, generate at each size through the
// page's own controls, then reload, confirm the page reports the weights as cached, and generate
// every size again in reverse order: each size must give identical pixels in both sessions, so
// an output that depends on which sizes ran earlier (stale or undersized buffers) fails.
// Usage: node run-page-smoke.mjs --chrome <exe> (--weights-url <base> | --weights-dir <dir>) --out <dir>
//        [--sizes 512,768,1024] [--seed 7006] [--prompt "..."] [--origin <page origin>]
// --weights-dir serves a staged repository folder from a second, CORS-enabled origin.
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
  report.finishedAt = new Date().toISOString();
  await fsp.mkdir(outDir, { recursive: true });
  await fsp.writeFile(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  browser?.close(); server?.close(); weightServer?.close();
  process.exit(code);
}

// SHA-256 of the output canvas pixels.
const imageHash = `(async () => { const c = document.getElementById('out');
  const px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', px))].map(b => b.toString(16).padStart(2, '0')).join(''); })()`;

const pageState = `({ load: document.getElementById('load').textContent, loadDisabled: document.getElementById('load').disabled,
  status: document.getElementById('status').textContent, warn: document.getElementById('status').classList.contains('warn'),
  controls: !document.getElementById('controls').classList.contains('hidden') })`;

async function waitFor(expr, timeoutMs, label) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const value = await browser.evaluate(expr, false).catch(() => null);
    if (value) return value;
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error(`timed out waiting for ${label}`);
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
  else ({ server } = await startServer({ '/webgpu-inference-kit/': path.resolve(opt('--kit', path.join(here, '../../webgpu-inference-kit'))), '/': here })
    .then(s => { report.origin = s.origin; return s; }));
  browser = await launchChrome(opt('--chrome'), [], report);
  const desktop = { width: 1280, height: 900 };
  await browser.send('Emulation.setDeviceMetricsOverride', { ...desktop, deviceScaleFactor: 1, mobile: false });
  const pageUrl = `${report.origin}/index.html?weights=${encodeURIComponent(report.weightsUrl)}`;
  report.pageUrl = pageUrl;

  report.phase = 'prepare';
  await browser.navigate(pageUrl, 'Boolean(window.kleinPrepared)');
  await browser.evaluate('window.kleinPrepared');
  report.beforeLoad = await browser.evaluate(pageState);
  await screenshot('before-load-desktop', desktop);
  if (report.beforeLoad.loadDisabled) throw new Error(`load button disabled before load: ${report.beforeLoad.status}`);

  report.phase = 'load';
  const loadStarted = Date.now();
  await browser.evaluate(`document.getElementById('load').click()`, false);
  report.afterLoad = await waitFor(`(() => { const s = ${pageState}; return s.controls || /failed/i.test(s.status) ? s : null; })()`, 15 * 60e3, 'load');
  report.afterLoad.wallMs = Date.now() - loadStarted;
  if (!report.afterLoad.controls) throw new Error(`load failed: ${report.afterLoad.status}`);
  report.loadStats = await browser.evaluate('window.kleinDemo.pipeline.loadStats');

  report.phase = 'generate';
  report.generations = [];
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
  const reloaded = await waitFor(`(() => { const s = ${pageState}; return s.controls || /failed/i.test(s.status) ? s : null; })()`, 5 * 60e3, 'cached load');
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

async function generateSizes(sizes, session) {
  const seed = Number(opt('--seed', '7006'));
  const desktop = { width: 1280, height: 900 };
  for (const size of sizes) {
    await browser.evaluate(`(() => { window.kleinLast = null;
      document.getElementById('size').value = '${size}'; document.getElementById('seed').value = '${seed}';
      ${opt('--prompt') ? `document.getElementById('prompt').value = ${JSON.stringify(opt('--prompt'))};` : ''}
      document.getElementById('go').click(); })()`, false);
    const done = await waitFor(`(() => { const s = ${pageState}; const go = document.getElementById('go');
      return !go.disabled && (window.kleinLast || s.warn || /stopped/i.test(s.status)) ? { ...s, last: window.kleinLast } : null; })()`, 10 * 60e3, `generate ${size}`);
    const row = { session, size, status: done.status, warn: done.warn, ...(done.last ?? {}) };
    report.generations.push(row);
    if (!done.last) throw new Error(`generation at ${size} failed: ${done.status}`);
    row.pixelSha256 = await browser.evaluate(imageHash);
    const png = await browser.evaluate(`document.getElementById('out').toDataURL('image/png')`);
    await fsp.writeFile(path.join(outDir, `image-${size}-session${session}.png`), Buffer.from(png.split(',')[1], 'base64'));
    if (session === 1 && size === sizes[0]) await screenshot('after-generate-desktop', desktop);
  }
}
