#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';

const EXPECTED = Object.freeze({
  schema: 'kaminos.sam31-interactive-pointer-meta-packet.v0',
  receiptSchema: 'kaminos.sam31-interactive-pointer-meta-reference-receipt.v0',
  routeId: 'sam3.1.interactive-pointer.phase-program.webgpu-local.v0',
  boundary: 'binary-mask-to-interactive-prompt-decoder-to-final-object-pointer',
  modelRevision: 'daa63191845a41281374e725f4c9e51c7a824460',
  checkpointSha256: 'sha256:0567debeec80ba4ac6369540c6c248025283cb3ff2b92827509e57e2b3541cb6',
  sourceCommit: '5dd401d1c5c1d5c3eedff06d41b77af824517619',
  mappedTensorCount: 158,
});

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
const root = resolve(new URL('..', import.meta.url).pathname);
const packetDir = resolve(args.get('--packet-dir') || mkdtempSync(join(tmpdir(), 'kaminos-sam31-interactive-pointer-')));
const reportPath = resolve(args.get('--report') || '/tmp/kaminos-sam31-interactive-pointer-webgpu.json');
const screenshotPath = resolve(args.get('--screenshot') || '/tmp/kaminos-sam31-interactive-pointer-webgpu.png');
const debugPort = Number(args.get('--debug-port') || 9590);
const serverPort = Number(args.get('--server-port') || 18590);
const timeoutMs = Number(args.get('--timeout-ms') || 300000);
const reusePacket = args.get('--reuse-packet') === '1';
const requestedExpectedManifestSha256 = args.get('--expected-manifest-sha256') || null;
const chrome = process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const python = process.env.SAM31_TORCH_PYTHON || '/Users/noahlyons/dev/sf3d/.venv/bin/python';
const packetTool = resolve(root, 'tools/sam31-interactive-pointer-meta-packet.py');
const userDataDir = mkdtempSync(join(tmpdir(), `kaminos-sam31-interactive-pointer-chrome-${process.pid}-`));
let requestedUrl = `http://127.0.0.1:${serverPort}/smokes/sam31-interactive-pointer-parity.html`;
let phase = 'initializing';
let server;
let chromeProcess;
let browserVersion;
let packetAuthority;
let lastState;
let screenshotWritten = false;
let screenshotPixelCheck = null;
let viewportLayout = null;
let stderr = '';

const delay = ms => new Promise(resolveDelay => setTimeout(resolveDelay, ms));
const sha256 = value => `sha256:${createHash('sha256').update(value).digest('hex')}`;
function contentType(path) {
  const ext = extname(path);
  return ext === '.html' ? 'text/html; charset=utf-8' : ext === '.js' || ext === '.mjs' ? 'text/javascript; charset=utf-8' : ext === '.json' ? 'application/json; charset=utf-8' : 'application/octet-stream';
}
function report(extra = {}) {
  const value = {
    schema: 'kaminos.sam31-interactive-pointer.browser-parity-smoke.v0', ok: false,
    failure_phase: phase, requestedUrl, packetDir, packetTool, reportPath,
    packetSource: reusePacket ? 'caller-provided-existing' : 'generated',
    requestedExpectedManifestSha256,
    screenshot: screenshotWritten ? screenshotPath : null, primary_output_written: screenshotWritten,
    screenshotPixelCheck, viewportLayout, browserVersion, packetAuthority, lastState,
    adapterInfo: lastState?.adapterInfo || null, requestedRouteId: lastState?.requestedRouteId || null,
    effectiveRouteId: lastState?.effectiveRouteId || null, receipt: lastState?.receipt || null,
    parity: lastState?.parity || null, evidence: lastState?.evidence || null,
    manifest: lastState?.manifest || null, stderrTail: stderr.slice(-4000), ...extra,
  };
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify(value, null, 2));
  return value;
}
function generatePacket() {
  if (reusePacket) {
    if (!existsSync(join(packetDir, 'tensor-manifest.json'))) throw new Error(`reused packet manifest missing: ${packetDir}`);
    return;
  }
  mkdirSync(packetDir, { recursive: true });
  const result = spawnSync(python, [packetTool, '--out-dir', packetDir], { cwd: root, encoding: 'utf8', timeout: 240000 });
  if (result.status !== 0) throw new Error(`official packet generation failed: ${result.stderr || result.stdout}`);
}
function verifyPacketAuthority() {
  const manifestPath = join(packetDir, 'tensor-manifest.json');
  const receiptPath = join(packetDir, 'reference-receipt.json');
  if (!existsSync(manifestPath) || !existsSync(receiptPath)) throw new Error('official packet manifest and reference receipt are required');
  const manifestBytes = readFileSync(manifestPath);
  const receiptBytes = readFileSync(receiptPath);
  const manifest = JSON.parse(manifestBytes);
  const receipt = JSON.parse(receiptBytes);
  const manifestSha256 = sha256(manifestBytes);
  const failures = [];
  if (reusePacket && !requestedExpectedManifestSha256) throw new Error('--expected-manifest-sha256 is required with --reuse-packet=1');
  if (requestedExpectedManifestSha256 && manifestSha256 !== requestedExpectedManifestSha256) {
    failures.push(`requested manifest digest ${manifestSha256} !== ${requestedExpectedManifestSha256}`);
  }
  if (manifest.schema !== EXPECTED.schema) failures.push(`schema=${manifest.schema}`);
  if (receipt.schema !== EXPECTED.receiptSchema || receipt.ok !== true) failures.push(`receipt=${receipt.schema}/${receipt.ok}`);
  if (manifest.routeId !== EXPECTED.routeId || receipt.routeId !== EXPECTED.routeId) failures.push('route identity');
  if (manifest.boundary !== EXPECTED.boundary || receipt.boundary !== EXPECTED.boundary) failures.push('boundary identity');
  if (manifest.reference?.model?.revision !== EXPECTED.modelRevision) failures.push('model revision');
  if (manifest.reference?.model?.sha256 !== EXPECTED.checkpointSha256) failures.push('checkpoint digest');
  if (manifest.reference?.source?.commit !== EXPECTED.sourceCommit || manifest.reference?.source?.workingTreeClean !== true) failures.push('source identity');
  if (manifest.checkpointAudit?.mappedTensorCount !== EXPECTED.mappedTensorCount || manifest.checkpointAudit?.allMappedOfficialKeysPresent !== true) failures.push('checkpoint tensor audit');
  if (receipt.outputs?.tensorManifestSha256 !== manifestSha256) failures.push('manifest digest mismatch against reference receipt');
  for (const entry of [...(manifest.tensors || []), ...(manifest.weights || [])]) {
    const path = resolve(packetDir, entry.file || '');
    if (path !== packetDir && !path.startsWith(`${packetDir}/`)) { failures.push(`unsafe artifact path ${entry.file}`); continue; }
    if (!existsSync(path)) { failures.push(`missing artifact ${entry.file}`); continue; }
    const bytes = readFileSync(path);
    if (bytes.byteLength !== entry.byteLength || sha256(bytes) !== entry.sha256) failures.push(`artifact digest ${entry.file}`);
  }
  if (failures.length > 0) throw new Error(`interactive pointer packet authority failed: ${failures.join(', ')}`);
  return {
    passed: true, manifestSha256, expectedManifestSha256: requestedExpectedManifestSha256 || manifestSha256,
    referenceReceiptSha256: sha256(receiptBytes), schema: manifest.schema, routeId: manifest.routeId,
    boundary: manifest.boundary, mappedTensorCount: manifest.checkpointAudit.mappedTensorCount,
    tensorArtifactCount: manifest.tensors.length, weightArtifactCount: manifest.weights.length,
    reference: manifest.reference,
  };
}
function startServer() {
  server = createServer((request, response) => {
    try {
      const parsed = new URL(request.url, requestedUrl);
      const packet = parsed.pathname.startsWith('/oracle/');
      const base = packet ? packetDir : root;
      const relative = packet ? parsed.pathname.slice(8) : parsed.pathname.slice(1);
      const path = resolve(base, relative || 'smokes/sam31-interactive-pointer-parity.html');
      if (path !== base && !path.startsWith(`${base}/`)) { response.writeHead(403); response.end('forbidden'); return; }
      if (!existsSync(path)) { response.writeHead(404); response.end('missing'); return; }
      response.writeHead(200, { 'content-type': contentType(path), 'cache-control': 'no-store', 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp' });
      response.end(readFileSync(path));
    } catch (error) { response.writeHead(500); response.end(String(error)); }
  });
  return new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(serverPort, '127.0.0.1', resolveListen); });
}
async function cdp(path) {
  const response = await fetch(`http://127.0.0.1:${debugPort}${path}`);
  if (!response.ok) throw new Error(`CDP ${path} failed`);
  return response.json();
}
async function waitCdp() {
  for (let attempt = 0; attempt < 160; attempt += 1) { try { return await cdp('/json/version'); } catch { await delay(125); } }
  throw new Error('Chrome DevTools endpoint did not open');
}
function wsRequest(ws, method, params = {}, requestTimeout = timeoutMs) {
  const id = ws._id = (ws._id || 0) + 1;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolveRequest, reject) => {
    const timer = setTimeout(() => reject(new Error(`${method} timed out`)), requestTimeout);
    const listener = event => {
      const message = JSON.parse(String(event.data));
      if (message.id !== id) return;
      clearTimeout(timer); ws.removeEventListener('message', listener);
      if (message.error) reject(new Error(message.error.message)); else resolveRequest(message.result);
    };
    ws.addEventListener('message', listener);
  });
}
async function evaluate(ws, expression) {
  const result = await wsRequest(ws, 'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}
async function inspectScreenshotPixels(ws, pngBase64, borderX, borderTop) {
  return evaluate(ws, `(async () => {
    const image = new Image(); image.src = ${JSON.stringify(`data:image/png;base64,${pngBase64}`)}; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true }); context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let sampled=0, nonBlack=0, maximumChannel=0;
    for (let offset=0; offset<pixels.length; offset+=16) { const r=pixels[offset], g=pixels[offset+1], b=pixels[offset+2]; sampled+=1; if (r+g+b>24) nonBlack+=1; maximumChannel=Math.max(maximumChannel,r,g,b); }
    const x=Math.max(0,Math.min(canvas.width-1,Math.round(${Number(borderX)}))); const top=Math.max(0,Math.min(canvas.height-1,Math.round(${Number(borderTop)})));
    let borderSamples=0, borderSignals=0;
    for (let y=top; y<canvas.height; y+=1) { const offset=(y*canvas.width+x)*4; const r=pixels[offset], g=pixels[offset+1], b=pixels[offset+2]; borderSamples+=1; if(g>r+30&&g>b+30&&g>100) borderSignals+=1; }
    return { width:canvas.width, height:canvas.height, nonBlackFraction:sampled?nonBlack/sampled:0, maximumChannel, borderSignalFraction:borderSamples?borderSignals/borderSamples:0 };
  })()`);
}

async function main() {
  let ws;
  try {
    phase = 'generate_official_packet'; generatePacket();
    phase = 'verify_packet_authority'; packetAuthority = verifyPacketAuthority();
    requestedUrl = `${requestedUrl}?expectedManifestSha256=${encodeURIComponent(packetAuthority.expectedManifestSha256)}&commit=${encodeURIComponent(process.env.KAMINOS_COMMIT || 'working-tree')}`;
    phase = 'start_server'; await startServer();
    phase = 'launch_chrome';
    chromeProcess = spawn(chrome, [`--remote-debugging-port=${debugPort}`, `--user-data-dir=${userDataDir}`, '--no-first-run', '--disable-extensions', '--enable-unsafe-webgpu', '--window-size=1000,560', '--headless=new', requestedUrl], { stdio: ['ignore', 'ignore', 'pipe'] });
    const spawnError = new Promise((_, reject) => chromeProcess.once('error', reject));
    chromeProcess.stderr.on('data', chunk => { stderr += chunk.toString(); });
    browserVersion = await Promise.race([waitCdp(), spawnError]);
    const pages = await cdp('/json/list');
    const page = pages.find(item => item.url.includes('sam31-interactive-pointer-parity')) || pages[0];
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolveOpen, reject) => { ws.addEventListener('open', resolveOpen, { once: true }); ws.addEventListener('error', reject, { once: true }); });
    await wsRequest(ws, 'Runtime.enable'); await wsRequest(ws, 'Page.enable');
    phase = 'wait_browser_parity';
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      lastState = await evaluate(ws, 'window.sam31InteractivePointerParityState?.() || null');
      if (['passed', 'failed'].includes(lastState?.status)) break;
      await delay(250);
    }
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
      mkdirSync(dirname(screenshotPath), { recursive: true }); writeFileSync(screenshotPath, Buffer.from(shot.data, 'base64')); screenshotWritten = true; break;
    }
    if (!screenshotWritten) throw new Error(`screenshot remained blank: ${JSON.stringify(screenshotPixelCheck)}`);
    phase = 'write_report';
    const value = report({ ok: true, failure_phase: null });
    process.stdout.write(`${JSON.stringify({ ok: value.ok, reportPath, screenshot: value.screenshot, adapterInfo: value.adapterInfo, parity: value.parity, evidence: value.evidence }, null, 2)}\n`);
  } catch (error) {
    const value = report({ ok: false, failure_phase: phase, error: String(error?.stack || error) });
    process.stderr.write(`${JSON.stringify(value, null, 2)}\n`);
    throw error;
  } finally {
    try { ws?.close(); } catch {}
    if (chromeProcess) chromeProcess.kill('SIGTERM');
    if (server) server.close();
  }
}

main().catch(error => { console.error(error); process.exit(1); });
