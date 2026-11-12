// kaminos-test: manual - browser upload/seed flow with explicitly mocked model inference
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, realpath } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({ options: Object.fromEntries(['out', 'chrome', 'playwright', 'clip'].map(name => [name, { type: 'string' }])) });
for (const name of ['out', 'chrome', 'playwright', 'clip']) if (!args[name]) throw new Error(`--${name} is required`);
const out = resolve(args.out), root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const report = { status: 'running', authority: 'actual-browser-upload-and-seed-flow; mocked-model-no-segmentation-quality-claim', phase: 'setup', cases: [] };
let browser, server, initialized = false;
const save = () => writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
try {
  await mkdir(out, { recursive: false }); initialized = true;
  report.chrome = await realpath(args.chrome);
  if (report.chrome.includes('/Google Chrome.app/')) throw new Error('installed GUI Chrome is not an automation executable');
  report.source = { commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    moduleSha256: createHash('sha256').update(await readFile(resolve(root, 'examples/sam-video.mjs'))).digest('hex') };
  const clip = await readFile(args.clip);
  await writeFile(resolve(out, 'input.mp4'), clip);
  report.clipSha256 = createHash('sha256').update(clip).digest('hex');
  server = createServer(async (request, response) => {
    try {
      const file = await realpath(resolve(root, `.${new URL(request.url, 'http://localhost').pathname}`));
      if (!file.startsWith(root + sep)) throw new Error('mount escape');
      response.setHeader('Content-Type', ({ '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript' })[extname(file)] || 'application/octet-stream');
      response.end(await readFile(file));
    } catch { response.writeHead(404); response.end(); }
  });
  report.phase = 'server-start';
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const { chromium } = await import(pathToFileURL(resolve(args.playwright)).href);
  browser = await chromium.launchPersistentContext(resolve(out, 'profile'), { executablePath: report.chrome, headless: true,
    args: ['--use-mock-keychain', '--password-store=basic', '--no-first-run', '--no-default-browser-check'], timeout: 0 });
  const baseline = execFileSync('git', ['show', '6ae9f8ac184aa685bac850ad54b16967a9219b1c:webgpu-inference-kit/examples/sam-video.mjs'], { cwd: root, encoding: 'utf8' });
  for (const kind of ['baseline', 'repaired']) {
    report.phase = kind; await save();
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.setDefaultTimeout(0); page.setDefaultNavigationTimeout(0);
    await page.route('**/src/core.js', route => route.fulfill({ contentType: 'text/javascript', body: `
      const device={lost:new Promise(()=>{}),destroy(){}};
      export async function requestBrowserWebGpuDevice(){return {device,adapter:{},backendIdentity:{}}}
      export async function createWebGpuInferenceSession(){return {drain:async()=>{},close(){}}}
      export function createWebGpuForegroundService(){return {dispose:async()=>{}}}` }));
    await page.route('**/examples/sam-video-preview.mjs', route => route.fulfill({ contentType: 'text/javascript', body: `
      export async function createSamVideoPreview({canvas}) {let source,id,closed=false;function draw(){if(closed)return;if(source?.videoWidth){canvas.width=source.videoWidth;canvas.height=source.videoHeight;canvas.getContext('2d').drawImage(source,0,0);}id=requestAnimationFrame(draw)}draw();return {setSource(v){source=v},snapshot(){return {submissions:0}},async close(){closed=true;cancelAnimationFrame(id)}}}` }));
    await page.route('**/src/sam.js', route => route.fulfill({ contentType: 'text/javascript', body: `
      export {createSam31LiveLoop} from './sam31-live-loop.js';
      export async function createSam31VideoTracker(){let count=0;window.playbackCalls=[];async function run(source){await new Promise(r=>setTimeout(r,500));window.playbackCalls.push({index:count,time:source.mediaTime});return {frameIndex:count++,timestamp:source.timestamp,objectSlot:0,maskWidth:8,maskHeight:8,maskLogits:new Float32Array(16*64).fill(1),objectScores:new Float32Array(16).fill(1),sourceImageSha256:'sha256:'+Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',source.rgba)),n=>n.toString(16).padStart(2,'0')).join(''),timing:{frameMs:500}}}return {imageWidth:96,imageHeight:96,packageId:'mock-playback-only',initialize:run,track:run,snapshot:()=>({status:count?'tracking':'idle'}),reset(){count=0},close:async()=>{}}}` }));
    if (kind === 'baseline') await page.route('**/examples/sam-video.mjs', route => route.fulfill({ contentType: 'text/javascript', body: baseline }));
    await page.goto(`http://127.0.0.1:${server.address().port}/examples/sam-video.html`);
    await page.locator('#file').setInputFiles({ name: 'short-person.mp4', mimeType: 'video/mp4', buffer: clip });
    await page.waitForFunction(() => document.querySelector('#status').textContent === 'short-person.mp4');
    await page.locator('#load').click();
    await page.waitForFunction(() => !document.querySelector('#capture').disabled);
    await page.locator('#capture').click();
    // Authoring is deliberately longer than the fixture clip.
    await page.waitForTimeout(1000);
    const seed = page.locator('#seed'), box = await seed.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down(); await page.mouse.up();
    await page.locator('#start').click();
    await page.waitForFunction(() => window.playbackCalls.length >= 3 || /Failed|Stopped|Video ended/.test(document.querySelector('#status').textContent));
    const calls = await page.evaluate(() => window.playbackCalls);
    if (!await page.locator('#stop').isDisabled()) await page.locator('#stop').click();
    await page.waitForFunction(() => !document.querySelector('#start').disabled);
    await page.screenshot({ path: resolve(out, `${kind}.png`), fullPage: true });
    report.cases.push({ kind, calls, status: await page.locator('#status').textContent() });
    await page.evaluate(() => window.samVideoExample.close());
    await page.close(); await save();
  }
  assert.equal(report.cases[0].calls.length, 1, 'old uploaded-video flow must reproduce seed-only failure');
  const repaired = report.cases[1].calls;
  assert.ok(repaired.length >= 3, 'repaired upload/paint/start must reach successive model calls');
  for (let i = 1; i < repaired.length; i++) assert.ok(repaired[i].time > repaired[i - 1].time, 'successive captures must advance decoded media time');
  report.status = 'passed'; report.phase = 'complete';
} catch (error) { report.status = 'failed'; report.error = String(error.stack || error); process.exitCode = 1; }
finally {
  const cleanupErrors = [];
  for (const close of [() => browser?.close(), () => new Promise(resolve => server ? server.close(resolve) : resolve())]) {
    try { await close(); } catch (error) { cleanupErrors.push(String(error)); }
  }
  if (cleanupErrors.length) { report.status = 'failed'; report.cleanupErrors = cleanupErrors; process.exitCode = 1; }
  if (initialized) try { await save(); } catch (error) { report.status = 'failed'; report.outputReportError = String(error); process.exitCode = 1; }
  if (process.env.EPISTAXIS_JOB_PRIMARY_OUTPUT) await writeFile(process.env.EPISTAXIS_JOB_PRIMARY_OUTPUT, JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report));
