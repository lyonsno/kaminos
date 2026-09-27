import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const value = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index < 0 ? fallback : args[index + 1] || fallback;
};
const outputDir = path.resolve(value('--output-dir', '/private/tmp/kaminos-sf3d-learn-full-run'));
const baseUrl = value('--url', 'http://127.0.0.1:8179');
const puppeteerPath = value('--puppeteer', '');
const chromePath = value('--chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const bundle = fs.readFileSync('lib/sf3d/sf3d-learn-producer.js');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
fs.mkdirSync(outputDir, { recursive: true });
const reportPath = path.join(outputDir, 'report.json');
const report = {
  schema: 'kaminos.sf3d-learn-full-run.v0', ok: false, phase: 'preflight',
  requested: { baseUrl, page: '/', previewDetail: '32' },
  effective: { sourceCommit, bundleSha256: sha256(bundle), bundleSource: fs.readFileSync('lib/sf3d/LEARN_BUILD.txt', 'utf8').trim(), puppeteerPath, chromePath },
  events: [], statusTrace: [], stages: {},
};
const write = () => fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
write();
let browser;
try {
  if (!puppeteerPath || !fs.existsSync(puppeteerPath)) throw new Error('missing Puppeteer module');
  if (!fs.existsSync(chromePath)) throw new Error('missing Chrome');
  const { default: puppeteer } = await import(pathToFileURL(puppeteerPath).href);
  browser = await puppeteer.launch({ executablePath: chromePath, headless: false,
    args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--no-first-run', '--no-default-browser-check'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  page.on('pageerror', error => { report.events.push({ type: 'pageerror', message: error.message }); write(); });
  page.on('error', error => { report.events.push({ type: 'page-crash', message: error.message }); write(); });
  page.on('requestfailed', request => { report.events.push({ type: 'request-failed', url: request.url(), reason: request.failure()?.errorText }); write(); });
  page.on('response', response => { if (response.status() >= 400) { report.events.push({ type: 'http-error', url: response.url(), status: response.status() }); write(); } });
  report.phase = 'host-tab'; write();
  await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
  await page.click('[data-tab="learn"]');
  const iframe = await page.waitForSelector('#learn-viewport-frame');
  const frame = await iframe.contentFrame();
  await frame.waitForSelector('#learn-viewer canvas');
  const identity = await frame.evaluate(() => ({ page: location.href, sourceLoaded: document.querySelector('#learn-source').naturalWidth > 0,
    resolution: document.querySelector('#learn-resolution').value, runEnabled: !document.querySelector('#learn-run').disabled,
    error: document.querySelector('#learn-error').hidden ? null : document.querySelector('#learn-error').textContent }));
  report.effective.page = identity.page;
  if (!identity.sourceLoaded || !identity.runEnabled || identity.resolution !== '32' || identity.error) throw new Error(`Learn first screen invalid: ${JSON.stringify(identity)}`);
  const canvas = await frame.$('#learn-viewer canvas');
  const started = Date.now();
  await canvas.screenshot({ path: path.join(outputDir, 'empty.png') });
  report.phase = 'inference'; write();
  await frame.click('#learn-run');
  const stageIds = ['block-0-fuse-out', 'block-1-fuse-out', 'final'];
  while (Object.keys(report.stages).length < stageIds.length) {
    const state = await frame.evaluate(() => ({
      status: document.querySelector('#learn-status').textContent,
      error: document.querySelector('#learn-error').hidden ? null : document.querySelector('#learn-error').textContent,
      running: document.querySelector('#learn-run').disabled,
      stages: Object.fromEntries([...document.querySelectorAll('#learn-stages [data-stage]')].map(row => [row.dataset.stage, row.dataset.state])),
    }));
    if (report.statusTrace.at(-1)?.text !== state.status) { report.statusTrace.push({ atMs: Date.now() - started, text: state.status }); write(); }
    for (const stageId of stageIds) {
      if (report.stages[stageId] || !['done', 'skipped'].includes(state.stages[stageId])) continue;
      const file = `${stageId}.png`;
      const bytes = await canvas.screenshot({ path: path.join(outputDir, file) });
      report.stages[stageId] = { state: state.stages[stageId], atMs: Date.now() - started, file, canvasSha256: sha256(bytes) };
      write();
    }
    if (state.error || (!state.running && stageIds.some(stageId => state.stages[stageId] === 'waiting'))) {
      throw new Error(`Learn stopped before all stages settled: ${state.error || state.status}`);
    }
    if (Object.keys(report.stages).length < stageIds.length) await new Promise(resolve => setTimeout(resolve, 500));
  }
  report.phase = 'output'; write();
  report.output = await frame.evaluate(async () => {
    const link = document.querySelector('#learn-download');
    if (link.hidden || !link.href.startsWith('blob:')) return { visible: false };
    const bytes = await (await fetch(link.href)).arrayBuffer();
    const header = String.fromCharCode(...new Uint8Array(bytes, 0, 4));
    return { visible: true, byteLength: bytes.byteLength, header, meshCount: document.querySelector('#learn-mesh-count').textContent };
  });
  const stageHashes = Object.values(report.stages).map(stage => stage.canvasSha256);
  if (Object.values(report.stages).some(stage => stage.state !== 'done')) throw new Error('one or more visible stages were skipped');
  if (new Set(stageHashes).size !== stageHashes.length) throw new Error('stage canvases did not change');
  if (!report.output.visible || report.output.header !== 'glTF' || report.output.byteLength < 1024) throw new Error('missing or invalid final GLB');
  if (report.events.some(event => ['pageerror', 'page-crash', 'http-error'].includes(event.type))) throw new Error('browser errors occurred during the route');
  report.ok = true;
  report.phase = 'complete'; write();
} catch (error) {
  report.error = error?.stack || String(error);
  write();
  process.exitCode = 1;
} finally {
  await browser?.close();
}
