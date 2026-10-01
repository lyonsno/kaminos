import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { assertServedSourceIdentity } from './served-source-contract.mjs';
import { acceptLearnObservations } from './learn-observation-acceptance.mjs';

const args = process.argv.slice(2);
const value = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index < 0 ? fallback : args[index + 1] || fallback;
};
const outputDir = path.resolve(value('--output-dir', '/private/tmp/kaminos-sf3d-learn-full-run'));
const baseUrl = value('--url', 'http://127.0.0.1:8179');
const puppeteerPath = value('--puppeteer', '');
const chromePath = value('--chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
const imagePath = value('--image', '');
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim();
const bundle = fs.readFileSync('lib/sf3d/sf3d-learn-producer.js');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
fs.mkdirSync(outputDir, { recursive: true });
const reportPath = path.join(outputDir, 'report.json');
const report = {
  schema: 'kaminos.sf3d-learn-full-run.v0', ok: false, phase: 'preflight',
  requested: { baseUrl, page: '/', previewDetail: '32' },
  effective: { sourceCommit, bundleSha256: sha256(bundle), bundleSource: fs.readFileSync('lib/sf3d/LEARN_BUILD.txt', 'utf8').trim(), puppeteerPath, chromePath },
  events: [], statusTrace: [], stages: {}, observations: [],
};
const write = () => fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
write();
let browser;
try {
  if (dirty) throw new Error(`source checkout is dirty: ${dirty}`);
  if (!puppeteerPath || !fs.existsSync(puppeteerPath)) throw new Error('missing Puppeteer module');
  if (!fs.existsSync(chromePath)) throw new Error('missing Chrome');
  const { default: puppeteer } = await import(pathToFileURL(puppeteerPath).href);
  browser = await puppeteer.launch({ executablePath: chromePath, headless: false,
    args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--no-first-run', '--no-default-browser-check'] });
  const page = await browser.newPage();
  await page.exposeFunction('recordLearnObservation', sample => { report.observations.push(sample); write(); });
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
  report.phase = 'source-identity'; write();
  const sourceFiles = ['index.html', 'sf3d-learn.html', 'sf3d-learn.css', 'sf3d-learn.mjs', 'lib/sf3d/sf3d-learn-producer.js'];
  const localHashes = Object.fromEntries(sourceFiles.map(file => [file, sha256(fs.readFileSync(file))]));
  const servedHashes = await frame.evaluate(async files => {
    const entries = await Promise.all(files.map(async file => {
      const response = await fetch(`/${file}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`served source missing: ${file} (${response.status})`);
      const digest = await crypto.subtle.digest('SHA-256', await response.arrayBuffer());
      return [file, [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')];
    }));
    return Object.fromEntries(entries);
  }, sourceFiles);
  report.effective.servedHashes = servedHashes;
  write();
  assertServedSourceIdentity(localHashes, servedHashes);
  const identity = await frame.evaluate(() => ({ page: location.href, sourceLoaded: document.querySelector('#learn-source').naturalWidth > 0,
    resolution: document.querySelector('#learn-resolution').value, runEnabled: !document.querySelector('#learn-run').disabled,
    error: document.querySelector('#learn-error').hidden ? null : document.querySelector('#learn-error').textContent }));
  report.effective.page = identity.page;
  if (!identity.sourceLoaded || !identity.runEnabled || identity.resolution !== '32' || identity.error) throw new Error(`Learn first screen invalid: ${JSON.stringify(identity)}`);
  const canvas = await frame.$('#learn-viewer canvas');
  await frame.evaluate(() => window.addEventListener('sf3d-learn-observation', event => {
    void window.recordLearnObservation(event.detail);
  }));
  if (imagePath) {
    await (await frame.$('#learn-file')).uploadFile(imagePath);
    await frame.waitForFunction(() => !document.querySelector('#learn-run').disabled);
    report.effective.input = { path: imagePath, sha256: sha256(fs.readFileSync(imagePath)) };
  }
  const started = Date.now();
  await canvas.screenshot({ path: path.join(outputDir, 'empty.png') });
  report.phase = 'inference'; write();
  await frame.click('#learn-run');
  const stageIds = ['encoder', 'block-0-fuse-out', 'block-1-fuse-out', 'final', 'export'];
  const capturedBlocks = new Set();
  while (Object.keys(report.stages).length < stageIds.length) {
    const state = await frame.evaluate(() => ({
      status: document.querySelector('#learn-status').textContent,
      error: document.querySelector('#learn-error').hidden ? null : document.querySelector('#learn-error').textContent,
      running: document.querySelector('#learn-run').disabled,
      block: Number(document.querySelector('#learn-feature-map').dataset.block),
      stages: Object.fromEntries([...document.querySelectorAll('#learn-stages [data-stage]')].map(row => [row.dataset.stage, row.dataset.state])),
    }));
    if (report.statusTrace.at(-1)?.text !== state.status) { report.statusTrace.push({ atMs: Date.now() - started, text: state.status }); write(); }
    if (state.block && !capturedBlocks.has(state.block) && !report.stages['block-0-fuse-out']) {
      await page.screenshot({ path: path.join(outputDir, `features-${state.block}.png`) });
      capturedBlocks.add(state.block);
    }
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
  const outputPayload = await frame.evaluate(async () => {
    const link = document.querySelector('#learn-download');
    if (link.hidden || !link.href.startsWith('blob:')) return { visible: false };
    const buffer = await (await fetch(link.href)).arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const chunks = [];
    for (let offset = 0; offset < bytes.length; offset += 32768) {
      chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 32768)));
    }
    return { visible: true, byteLength: bytes.byteLength, header: String.fromCharCode(...bytes.subarray(0, 4)),
      meshCount: document.querySelector('#learn-mesh-count').textContent, base64: btoa(chunks.join('')) };
  });
  const glb = outputPayload.visible ? Buffer.from(outputPayload.base64, 'base64') : null;
  report.output = { visible: outputPayload.visible, byteLength: outputPayload.byteLength, header: outputPayload.header,
    meshCount: outputPayload.meshCount, sha256: glb ? sha256(glb) : null, file: glb ? 'result.glb' : null };
  if (glb) fs.writeFileSync(path.join(outputDir, 'result.glb'), glb);
  const stageHashes = ['block-0-fuse-out', 'block-1-fuse-out', 'final'].map(id => report.stages[id].canvasSha256);
  if (Object.values(report.stages).some(stage => stage.state !== 'done')) throw new Error('one or more visible stages were skipped');
  if (new Set(stageHashes).size !== stageHashes.length) throw new Error('stage canvases did not change');
  report.observationSummary = acceptLearnObservations(report.observations, report.stages.export.atMs);
  if (!report.output.visible || report.output.header !== 'glTF' || report.output.byteLength < 1024 || glb.length !== report.output.byteLength) {
    throw new Error('missing, partial, or invalid final GLB');
  }
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
