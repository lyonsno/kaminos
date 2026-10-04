import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { validateAttentionBrowser } from './sam-attention-witness-checks.mjs';
import { validateSamImageRun } from './sam-image-native-checks.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = process.env.SAM_IMAGE_OUTPUT;
if (!out) throw new Error('SAM_IMAGE_OUTPUT must name the caller-owned directory');
await fs.mkdir(out, { recursive: true });
const reportPath = path.join(out, 'report.json');
const report = { status: 'failed', phase: 'setup', repoRoot: root, runs: [], errors: [], sourceSha256: {},
  requestedCommit: process.env.SAM_IMAGE_EXPECTED_COMMIT, requestedKernelRef: process.env.SAM_IMAGE_KERNEL_REF,
  instrumentation: 'public page mount handle exposed; native adapter observation; browser rAF timestamps and finite screenshots, not physical display timing' };
const hash = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const persist = () => fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
let browser, server, page;
try {
  await persist();
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  report.commit = git(['rev-parse', 'HEAD']);
  assert.equal(report.commit, report.requestedCommit, 'exact source revision required');
  const prefix = git(['rev-parse', '--show-prefix']);
  const served = new Map();
  for (const file of git(['ls-files', 'src', 'examples']).split('\n').filter(Boolean)) {
    const bytes = await fs.readFile(path.join(root, file));
    assert.ok(bytes.equals(execFileSync('git', ['show', `${report.commit}:${prefix}${file}`], { cwd: root })), `dirty source: ${file}`);
    served.set(`/${file}`, bytes); report.sourceSha256[file] = hash(bytes);
  }
  if (report.requestedKernelRef) {
    report.effectiveKernelCommit = git(['rev-parse', report.requestedKernelRef]);
    const bytes = execFileSync('git', ['show', `${report.effectiveKernelCommit}:${prefix}src/sam-online-attention-wgsl.js`], { cwd: root });
    served.set('/src/sam-online-attention-wgsl.js', bytes);
    report.sourceSha256['src/sam-online-attention-wgsl.js'] = hash(bytes);
  } else report.effectiveKernelCommit = report.commit;
  const originalHtml = served.get('/examples/sam-image.html').toString();
  const mount = 'mountSamImagePage(document).catch';
  assert.equal(originalHtml.split(mount).length, 2, 'page mount instrumentation must match once');
  served.set('/examples/sam-image.html', Buffer.from(originalHtml.replace(mount,
    'mountSamImagePage(document).then(app => { window.samImageExample = app; }).catch')));
  report.instrumentedHtmlSha256 = hash(served.get('/examples/sam-image.html'));
  const modelRoot = await fs.realpath(process.env.SAM_IMAGE_MODEL_ROOT);
  const manifest = await fs.readFile(path.join(modelRoot, 'tensor-manifest.json'));
  report.model = { root: modelRoot, manifestSha256: hash(manifest) };
  assert.equal(report.model.manifestSha256, process.env.SAM_IMAGE_MANIFEST_SHA256, 'model manifest changed');
  const inputs = JSON.parse(await fs.readFile(process.env.SAM_IMAGE_CASES, 'utf8'));
  assert.ok(Array.isArray(inputs) && inputs.length > 0, 'case list required');
  for (const input of inputs) {
    assert.match(input.name, /^[a-z0-9-]+$/);
    assert.equal(hash(await fs.readFile(input.image)), input.sha256, `image changed: ${input.name}`);
  }
  report.inputs = inputs;
  server = http.createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      res.setHeader('Cache-Control', 'no-store');
      if (served.has(pathname)) {
        res.setHeader('Content-Type', pathname.endsWith('.html') ? 'text/html' : 'text/javascript');
        res.end(served.get(pathname)); return;
      }
      if (!pathname.startsWith('/sam3-packet/')) { res.writeHead(404).end(); return; }
      const file = await fs.realpath(path.resolve(modelRoot, decodeURIComponent(pathname.slice('/sam3-packet/'.length))));
      assert.ok(file.startsWith(modelRoot + path.sep), 'model path escaped mount');
      res.setHeader('Content-Type', file.endsWith('.json') ? 'application/json' : 'application/octet-stream');
      const stream = createReadStream(file); stream.on('error', error => res.destroy(error)); stream.pipe(res);
    } catch (error) { report.errors.push({ phase: 'http', message: error.message }); res.writeHead(500).end(error.message); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  report.requestedUrl = `http://127.0.0.1:${server.address().port}/examples/sam-image.html`;
  report.phase = 'browser-launch'; await persist();
  report.browserPath = await fs.realpath(process.env.CHROME_PATH);
  validateAttentionBrowser(report.browserPath);
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
  browser = await chromium.launch({ executablePath: report.browserPath, headless: true, timeout: 0,
    args: ['--enable-unsafe-webgpu'] });
  report.browserVersion = browser.version();
  page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, acceptDownloads: true });
  page.setDefaultTimeout(0); page.setDefaultNavigationTimeout(0);
  page.on('pageerror', error => report.errors.push({ phase: report.phase, message: error.message }));
  await page.addInitScript(() => {
    window.samAdapters = [];
    const request = navigator.gpu.requestAdapter.bind(navigator.gpu);
    navigator.gpu.requestAdapter = async options => {
      const adapter = await request(options);
      if (adapter) window.samAdapters.push(Object.fromEntries(['vendor', 'architecture', 'device', 'description', 'isFallbackAdapter'].map(key => [key, adapter.info[key]])));
      return adapter;
    };
  });
  await page.goto(report.requestedUrl);
  report.effectiveUrl = page.url();
  assert.equal(report.effectiveUrl, report.requestedUrl);
  await page.waitForFunction(() => window.samImageExample || document.getElementById('status').dataset.error === 'true');
  assert.equal(await page.locator('#status').getAttribute('data-error'), 'false');
  let previousSource;
  for (const input of inputs) {
    report.phase = input.name; await persist();
    if (input.sha256 !== previousSource) {
      await page.locator('#image').setInputFiles(input.image);
      await page.waitForFunction(sha => window.samImageExample.snapshot().error
        || (!window.samImageExample.snapshot().busy && window.samImageExample.snapshot().source?.sha256 === sha), input.sha256);
      assert.equal(await page.evaluate(() => window.samImageExample.snapshot().error), null);
      previousSource = input.sha256;
    }
    await page.locator('#prompt').fill(input.prompt);
    await page.evaluate(() => {
      const app = window.samImageExample;
      const row = window.samTrial = { startedAt: performance.now(), frames: [], phases: [], done: false };
      const frame = time => {
        row.frames.push(time);
        const phase = app.snapshot().phase;
        if (row.phases.at(-1)?.phase !== phase) row.phases.push({ time: performance.now(), phase });
        if (!row.done) requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
      app.run({ manifestUrl: document.getElementById('manifest').value, promptText: document.getElementById('prompt').value })
        .then(output => { row.output = output; }, error => { row.error = error.stack || error.message; })
        .finally(() => { row.completedAt = performance.now(); row.done = true; });
    });
    const motion = [];
    await page.waitForFunction(() => window.samTrial.done || window.samImageExample.snapshot().phase.startsWith('run-'));
    for (let sample = 0; sample < 2; sample++) {
      const observation = await page.evaluate(() => ({ time: performance.now(), done: window.samTrial.done,
        phase: window.samImageExample.snapshot().phase }));
      const capture = path.join(out, `${input.name}-motion-${sample}.png`);
      await page.locator('#source').screenshot({ path: capture, animations: 'allow' });
      motion.push({ ...observation, path: capture, sha256: hash(await fs.readFile(capture)) });
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    await page.waitForFunction(() => window.samTrial.done);
    const error = await page.evaluate(() => window.samTrial.error || window.samImageExample.snapshot().error);
    assert.ok(!error, error);
    const row = await page.evaluate(() => ({ wallMilliseconds: window.samTrial.completedAt - window.samTrial.startedAt,
      adapter: window.samAdapters.at(-1), invocationId: window.samImageExample.provenance().request.invocationId,
      foreground: window.samImageExample.snapshot().foreground, phases: window.samTrial.phases, frames: window.samTrial.frames }));
    row.name = input.name; row.motion = motion;
    const downloadEvent = page.waitForEvent('download');
    await page.evaluate(() => {
      const blob = new Blob([JSON.stringify(window.samTrial.output, (_key, value) => ArrayBuffer.isView(value) ? Array.from(value) : value)], { type: 'application/json' });
      const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = 'output.json'; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    });
    const download = await downloadEvent;
    row.outputPath = path.join(out, `${input.name}-output.json`); await download.saveAs(row.outputPath);
    const outputBytes = await fs.readFile(row.outputPath); row.outputSha256 = hash(outputBytes);
    row.output = JSON.parse(outputBytes);
    validateSamImageRun(row, { invocationId: row.invocationId, sourceSha256: input.sha256,
      prompt: input.prompt, cache: input.cache, empty: input.empty, maskSize: input.maskSize });
    row.capture = path.join(out, `${input.name}.png`); await page.screenshot({ path: row.capture, fullPage: true });
    row.summary = { instances: row.output.instances.map(({ index, score, box, foregroundPixelCount }) => ({ index, score, box, foregroundPixelCount })),
      servingTimings: row.output.servingTimings, imageCache: row.output.imageCache.status };
    delete row.output;
    report.runs.push(row); await persist();
    for (const kind of ['mask', 'cutout']) {
      const event = page.waitForEvent('download'); await page.locator(`#save-${kind}`).click();
      await (await event).saveAs(path.join(out, `${input.name}-${kind}.png`));
    }
  }
  report.phase = 'mobile';
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'mobile overflow');
  await page.screenshot({ path: path.join(out, 'mobile.png'), fullPage: true });
  report.phase = 'dispose';
  report.disposed = await page.evaluate(async () => { await window.samImageExample.dispose(); return window.samImageExample.snapshot().status; });
  assert.equal(report.disposed, 'closed');
  assert.deepEqual(report.errors, []);
  report.status = 'succeeded'; report.phase = null;
} catch (error) {
  report.error = { message: error.message, stack: error.stack }; process.exitCode = 1;
  if (page && !page.isClosed()) {
    try { await page.screenshot({ path: path.join(out, 'failure.png'), fullPage: true }); }
    catch (captureError) { report.captureError = captureError.message; }
  }
} finally {
  await persist();
  try { await browser?.close(); } catch (error) { report.cleanupError = error.message; process.exitCode = 1; }
  if (server) await new Promise(resolve => server.close(resolve));
  report.cleanup = { browserClosed: browser ? !browser.isConnected() : null, serverClosed: server ? !server.listening : null };
  await persist();
  console.log(JSON.stringify({ status: report.status, phase: report.phase, reportPath, error: report.error?.message }));
}
