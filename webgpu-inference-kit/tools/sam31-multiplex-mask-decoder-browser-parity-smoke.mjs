#!/usr/bin/env node
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
const root = resolve(new URL('..', import.meta.url).pathname);
const packetDir = resolve(args.get('--packet-dir') || mkdtempSync(join(tmpdir(), 'kaminos-sam31-multiplex-decoder-')));
const reportPath = resolve(args.get('--report') || '/tmp/kaminos-sam31-multiplex-decoder-webgpu.json');
const screenshotPath = resolve(args.get('--screenshot') || '/tmp/kaminos-sam31-multiplex-decoder-webgpu.png');
const debugPort = Number(args.get('--debug-port') || 9575);
const serverPort = Number(args.get('--server-port') || 18575);
const timeoutMs = Number(args.get('--timeout-ms') || 180000);
const chrome = process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const python = process.env.SAM31_TORCH_PYTHON || '/Users/noahlyons/dev/sf3d/.venv/bin/python';
const packetTool = resolve(root, 'tools/sam31-multiplex-mask-decoder-meta-packet.py');
const userDataDir = mkdtempSync(join(tmpdir(), `kaminos-sam31-multiplex-chrome-${process.pid}-`));
const url = `http://127.0.0.1:${serverPort}/smokes/sam31-multiplex-mask-decoder-parity.html`;
let phase = 'initializing';
let server;
let chromeProcess;
let browserVersion;
let lastState;
let screenshotWritten = false;
let screenshotPixelCheck = null;
let viewportLayout = null;
let stderr = '';

const delay = ms => new Promise(resolveDelay => setTimeout(resolveDelay, ms));
function contentType(path) { const ext = extname(path); return ext === '.html' ? 'text/html; charset=utf-8' : ext === '.js' || ext === '.mjs' ? 'text/javascript; charset=utf-8' : ext === '.json' ? 'application/json; charset=utf-8' : 'application/octet-stream'; }
function report(extra = {}) {
  const value = { schema: 'kaminos.sam31-multiplex-mask-decoder.browser-parity-smoke.v0', ok: false, failure_phase: phase, url, packetDir, packetTool, reportPath, screenshot: screenshotWritten ? screenshotPath : null, primary_output_written: screenshotWritten, screenshotPixelCheck, viewportLayout, browserVersion, lastState, adapterInfo: lastState?.adapterInfo || null, requestedRouteId: lastState?.requestedRouteId || null, effectiveRouteId: lastState?.effectiveRouteId || null, receipt: lastState?.receipt || null, parity: lastState?.parity || null, evidence: lastState?.evidence || null, manifest: lastState?.manifest || null, stderrTail: stderr.slice(-4000), ...extra };
  mkdirSync(dirname(reportPath), { recursive: true }); writeFileSync(reportPath, JSON.stringify(value, null, 2)); return value;
}
function generatePacket() {
  mkdirSync(packetDir, { recursive: true });
  const result = spawnSync(python, [packetTool, '--out-dir', packetDir], { cwd: root, encoding: 'utf8', timeout: 180000 });
  if (result.status !== 0) throw new Error(`official packet generation failed: ${result.stderr || result.stdout}`);
}
function startServer() {
  server = createServer((request, response) => {
    try {
      const parsed = new URL(request.url, url); const packet = parsed.pathname.startsWith('/oracle/'); const base = packet ? packetDir : root; const relative = packet ? parsed.pathname.slice(8) : parsed.pathname.slice(1); const path = resolve(base, relative || 'smokes/sam31-multiplex-mask-decoder-parity.html');
      if (path !== base && !path.startsWith(`${base}/`)) { response.writeHead(403); response.end('forbidden'); return; }
      if (!existsSync(path)) { response.writeHead(404); response.end('missing'); return; }
      response.writeHead(200, { 'content-type': contentType(path), 'cache-control': 'no-store', 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp' }); response.end(readFileSync(path));
    } catch (error) { response.writeHead(500); response.end(String(error)); }
  });
  return new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(serverPort, '127.0.0.1', resolveListen); });
}
async function cdp(path) { const response = await fetch(`http://127.0.0.1:${debugPort}${path}`); if (!response.ok) throw new Error(`CDP ${path} failed`); return response.json(); }
async function waitCdp() { for (let attempt = 0; attempt < 120; attempt += 1) { try { return await cdp('/json/version'); } catch { await delay(125); } } throw new Error('Chrome DevTools endpoint did not open'); }
function wsRequest(ws, method, params = {}, requestTimeout = timeoutMs) {
  const id = ws._id = (ws._id || 0) + 1; ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolveRequest, reject) => { const timer = setTimeout(() => reject(new Error(`${method} timed out`)), requestTimeout); const listener = event => { const message = JSON.parse(String(event.data)); if (message.id !== id) return; clearTimeout(timer); ws.removeEventListener('message', listener); if (message.error) reject(new Error(message.error.message)); else resolveRequest(message.result); }; ws.addEventListener('message', listener); });
}
async function evaluate(ws, expression) { const result = await wsRequest(ws, 'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.text); return result.result.value; }

async function inspectScreenshotPixels(ws, pngBase64, expectedBorderX, expectedBorderTop) {
  const dataUrl = `data:image/png;base64,${pngBase64}`;
  return evaluate(ws, `(async () => {
    const image = new Image();
    image.src = ${JSON.stringify(dataUrl)};
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let sampled = 0;
    let nonBlack = 0;
    let maximumChannel = 0;
    for (let offset = 0; offset < pixels.length; offset += 16) {
      const red = pixels[offset]; const green = pixels[offset + 1]; const blue = pixels[offset + 2];
      sampled += 1;
      if (red + green + blue > 24) nonBlack += 1;
      maximumChannel = Math.max(maximumChannel, red, green, blue);
    }
    const borderX = Math.max(0, Math.min(canvas.width - 1, Math.round(${JSON.stringify(expectedBorderX)})));
    const borderTop = Math.max(0, Math.min(canvas.height - 1, Math.round(${JSON.stringify(expectedBorderTop)})));
    let borderSamples = 0;
    let borderSignals = 0;
    for (let y = borderTop; y < canvas.height; y += 1) {
      const offset = (y * canvas.width + borderX) * 4;
      const red = pixels[offset]; const green = pixels[offset + 1]; const blue = pixels[offset + 2];
      borderSamples += 1;
      if (green > red + 30 && green > blue + 30 && green > 100) borderSignals += 1;
    }
    return {
      width: canvas.width, height: canvas.height, sampledPixels: sampled, nonBlackPixels: nonBlack,
      nonBlackFraction: sampled > 0 ? nonBlack / sampled : 0, maximumChannel,
      expectedBorderX: borderX, expectedBorderTop: borderTop, borderSignalPixels: borderSignals,
      borderSignalFraction: borderSamples > 0 ? borderSignals / borderSamples : 0,
    };
  })()`);
}

async function main() {
  let ws;
  try {
    phase = 'generate_official_packet'; generatePacket();
    phase = 'start_server'; await startServer();
    phase = 'launch_chrome';
    chromeProcess = spawn(chrome, [`--remote-debugging-port=${debugPort}`, `--user-data-dir=${userDataDir}`, '--no-first-run', '--disable-extensions', '--enable-unsafe-webgpu', '--window-size=1000,540', '--headless=new', url], { stdio: ['ignore', 'ignore', 'pipe'] });
    const spawnError = new Promise((_, reject) => chromeProcess.once('error', reject)); chromeProcess.stderr.on('data', chunk => { stderr += chunk.toString(); }); browserVersion = await Promise.race([waitCdp(), spawnError]);
    const pages = await cdp('/json/list'); const page = pages.find(item => item.url.includes('sam31-multiplex-mask-decoder-parity')) || pages[0]; ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((resolveOpen, reject) => { ws.addEventListener('open', resolveOpen, { once: true }); ws.addEventListener('error', reject, { once: true }); }); await wsRequest(ws, 'Runtime.enable'); await wsRequest(ws, 'Page.enable');
    phase = 'wait_browser_parity'; const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) { lastState = await evaluate(ws, `window.sam31MultiplexMaskDecoderParityState?.() || null`); if (['passed', 'failed'].includes(lastState?.status)) break; await delay(250); }
    if (lastState?.status !== 'passed') throw new Error(lastState?.error || `browser ended in ${lastState?.status}`);
    phase = 'capture_screenshot';
    viewportLayout = await evaluate(ws, `(() => { const h=document.querySelector('h1').getBoundingClientRect(); const s=document.querySelector('#status').getBoundingClientRect(); return {innerWidth,innerHeight,scrollWidth:document.documentElement.scrollWidth,heading:{left:h.left,right:h.right,top:h.top},status:{left:s.left,right:s.right,top:s.top},layoutPassed:document.documentElement.scrollWidth<=innerWidth&&h.left>=0&&h.right<=innerWidth&&s.left>=0&&s.right<=innerWidth}; })()`);
    if (!viewportLayout.layoutPassed) throw new Error('receipt surface clipped');
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await delay(attempt === 1 ? 250 : 750);
      await evaluate(ws, 'new Promise(resolveFrame => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)))');
      const shot = await wsRequest(ws, 'Page.captureScreenshot', { format: 'png', fromSurface: true });
      const pixels = await inspectScreenshotPixels(ws, shot.data, viewportLayout.status.left + 1, viewportLayout.status.top + 4);
      screenshotPixelCheck = { ...pixels, attempt, passed: pixels.nonBlackFraction >= 0.05 && pixels.maximumChannel > 24 && pixels.borderSignalFraction >= 0.25 };
      if (!screenshotPixelCheck.passed) continue;
      mkdirSync(dirname(screenshotPath), { recursive: true });
      writeFileSync(screenshotPath, Buffer.from(shot.data, 'base64'));
      screenshotWritten = true;
      break;
    }
    if (!screenshotWritten) throw new Error(`screenshot remained blank after capture retries: ${JSON.stringify(screenshotPixelCheck)}`);
    phase = 'write_report'; const value = report({ ok: true, failure_phase: null }); process.stdout.write(`${JSON.stringify({ ok: value.ok, reportPath, screenshot: value.screenshot, adapterInfo: value.adapterInfo, parity: value.parity, evidence: value.evidence }, null, 2)}\n`);
  } catch (error) { const value = report({ ok: false, failure_phase: phase, error: String(error?.stack || error) }); process.stderr.write(`${JSON.stringify(value, null, 2)}\n`); throw error; }
  finally { try { ws?.close(); } catch {} if (chromeProcess) chromeProcess.kill('SIGTERM'); if (server) server.close(); }
}
main().catch(error => { console.error(error); process.exit(1); });
