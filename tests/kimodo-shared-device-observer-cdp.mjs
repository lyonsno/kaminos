import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { once } from 'node:events';

const kimodoCheckout = process.env.KIMODO_WEBGPU_CHECKOUT;
assert.ok(kimodoCheckout, 'KIMODO_WEBGPU_CHECKOUT selects the exact puppeteer-core dependency');
const requireFromKimodo = createRequire(join(resolve(kimodoCheckout), 'package.json'));
const puppeteer = requireFromKimodo('puppeteer-core');
const html = `<!doctype html><script>
window.__kimodoSharedDevice={schema:'fixture',status:'generating',progressSequence:0,samples:[],frameIntervals:[],foregroundReceipts:[],runs:[],source:{status:'built'}};
setInterval(()=>{const s=window.__kimodoSharedDevice;s.progressSequence++;s.samples.push({atMs:performance.now(),frameCount:s.progressSequence});s.frameIntervals.push(16.7);if(s.progressSequence%3===0)s.foregroundReceipts.push({requestId:'r'+s.progressSequence});s.runs=[{runId:'run-1',pageP95Ms:s.progressSequence>8?16.7:null}];},25);
</script>`;
const server = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html' });
  response.end(html);
});
const outputDir = mkdtempSync(join(tmpdir(), 'kimodo-observer-cdp-'));
let browser;
let observer;
try {
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  const url = `http://127.0.0.1:${server.address().port}/kimodo-shared-device.html`;
  browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: ['--disable-gpu', '--disable-webgpu', '--no-sandbox'],
  });
  const page = await browser.newPage();
  await page.goto(url);
  const observerPath = new URL('../scripts/observe-kimodo-shared-device.mjs', import.meta.url).pathname;
  let browserUrl = new URL(browser.wsEndpoint());
  browserUrl.protocol = browserUrl.protocol === 'wss:' ? 'https:' : 'http:';
  browserUrl = browserUrl.origin;
  observer = spawn(process.execPath, [observerPath, '--browser-url', browserUrl, '--url', url, '--output-dir', outputDir, '--poll-ms', '100'], {
    env: { ...process.env, KIMODO_WEBGPU_CHECKOUT: kimodoCheckout },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let observerOutput = '';
  observer.stdout.setEncoding('utf8').on('data', value => { observerOutput += value; });
  observer.stderr.setEncoding('utf8').on('data', value => { observerOutput += value; });
  const reportPath = join(outputDir, 'operator-telemetry.json');
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      if (JSON.parse(readFileSync(reportPath, 'utf8')).status === 'capturing') break;
    } catch {}
    await new Promise(resolveDelay => setTimeout(resolveDelay, 100));
  }
  const connectedReport = JSON.parse(readFileSync(reportPath, 'utf8'));
  assert.equal(connectedReport.status, 'capturing', `observer connects to the exact open browser page: ${JSON.stringify(connectedReport)} ${observerOutput}`);
  await new Promise(resolveDelay => setTimeout(resolveDelay, 900));
  const observerExit = once(observer, 'exit');
  observer.kill('SIGINT');
  await observerExit;
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  assert.equal(report.status, 'stopped', 'operator stop flushes a terminal capture report');
  assert.equal(report.effective.pageUrl, url, 'report binds the observed page URL');
  assert.ok(report.telemetryCounts.samples > 10, 'browser samples are incrementally captured');
  assert.ok(report.telemetryCounts.frameIntervals > 10, 'RAF intervals are incrementally captured');
  assert.ok(report.telemetryCounts.foregroundReceipts > 1, 'foreground service receipts are captured');
  assert.equal(report.runs[0].pageP95Ms, 16.7, 'latest per-run metrics are refreshed after completion');
  const chunks = readFileSync(join(outputDir, 'operator-telemetry.ndjson'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.ok(chunks.length > 2, 'durable telemetry is flushed in multiple incremental chunks');
  assert.ok(chunks.every(chunk => chunk.schema === 'kaminos.kimodo-shared-device-telemetry-chunk.v1'));
  console.log('Kimodo shared-device observer CDP integration passed');
} finally {
  if (observer && observer.exitCode === null) {
    const observerExit = once(observer, 'exit');
    observer.kill('SIGTERM');
    await observerExit;
  }
  if (browser) await browser.close();
  await new Promise(resolveClose => server.close(resolveClose));
  rmSync(outputDir, { recursive: true, force: true });
}
