#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash, randomInt } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const SCHEMA = 'kaminos.volume.native-low-transfer-long-sequence-witness.v0';
const IDENTITY = 'native-low-two-model-long-sequence-witness-v0';
const SEQUENCE_AUTHORITY = 'frame-locked-consecutive-native-96-simulation-steps-v0';
const PRESENTED_FRAME_AUTHORITY = 'cdp-presented-three-role-frame-after-one-native-step-v0';
const EXPECTED_GRID = 96;
const ROLES = Object.freeze(['native96Control', 'baseline128Trained', 'candidate96Trained']);
const MODELS = Object.freeze({
  baseline128Trained: Object.freeze({
    identity: 'exact-basin-selective-carrier-heads-160-to-128-v0',
    sha256: 'dc1886384f87c4e51015f6ffd5ac8c0a48ac6f32b6f02a238ac5e3c3bd883dc9',
  }),
  candidate96Trained: Object.freeze({
    identity: 'exact-basin-selective-carrier-heads-160-to-96-v0',
    sha256: 'baa54236f04c28eab278cf60e4a60745cd3c0160a985a9adbb1e06db7958f6e8',
  }),
});

const args = parseArgs(process.argv.slice(2));
let url = null;
const out = resolve(String(args.get('--out') || '/tmp/kaminos-native-low-transfer-long-sequence.mp4'));
const reportPath = resolve(String(args.get('--report') || '/tmp/kaminos-native-low-transfer-long-sequence.json'));
const contactPath = resolve(String(args.get('--contact') || out.replace(/\.mp4$/i, '-contact.png')));
const pagePath = resolve(String(args.get('--page') || `${dirname(out)}/index.html`));
const requestedFrameCount = integerArg('--frames', 150);
const playbackFps = numberArg('--fps', 30);
const timeoutMs = numberArg('--timeout-ms', 900000);
const port = integerArg('--debug-port', randomInt(42000, 62000));
let failurePhase = 'argument-validation';
let browser = null;
let socket = null;
let ffmpeg = null;
let lastTrustworthyEvidence = null;
const frames = [];

class CdpSocket {
  constructor(socketUrl) {
    this.socketUrl = socketUrl;
    this.socket = null;
    this.nextId = 1;
    this.pending = new Map();
  }

  open() {
    return new Promise((resolveOpen, rejectOpen) => {
      this.socket = new WebSocket(this.socketUrl);
      this.socket.addEventListener('open', resolveOpen, { once: true });
      this.socket.addEventListener('error', rejectOpen, { once: true });
      this.socket.addEventListener('message', event => {
        const message = JSON.parse(event.data);
        if (!message.id) return;
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
      });
    });
  }

  call(method, params = {}) {
    return new Promise((resolveCall, rejectCall) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve: resolveCall, reject: rejectCall });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket?.close();
  }
}

try {
  url = required('--url');
  assert.ok(requestedFrameCount >= 1, '--frames must be at least one');
  assert.ok(playbackFps > 0, '--fps must be positive');
  assert.ok(timeoutMs > 0, '--timeout-ms must be positive');
  mkdirSync(dirname(out), { recursive: true });
  mkdirSync(dirname(reportPath), { recursive: true });
  mkdirSync(dirname(contactPath), { recursive: true });
  mkdirSync(dirname(pagePath), { recursive: true });

  failurePhase = 'browser-launch';
  browser = spawn(chromeExecutable(), [
    '--headless=new',
    '--enable-unsafe-webgpu',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    `--remote-debugging-port=${port}`,
    '--window-size=1800,720',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ], { stdio: 'ignore' });
  const target = await waitForTarget(port, timeoutMs);
  socket = new CdpSocket(target.webSocketDebuggerUrl);
  await socket.open();
  await socket.call('Page.enable');
  await socket.call('Runtime.enable');
  await socket.call('Emulation.setDeviceMetricsOverride', {
    width: 1800,
    height: 720,
    deviceScaleFactor: 2,
    mobile: false,
  });
  await socket.call('Page.navigate', { url });

  failurePhase = 'route-settle';
  let state = null;
  const settleStarted = performance.now();
  while (performance.now() - settleStarted < timeoutMs) {
    state = await evaluate(socket, 'window.__kaminosNativeLowSelectiveLive?.debugState?.()');
    if (state?.status === 'failed') throw new Error(state.error || state.failureReason || 'native-low route failed');
    if (state?.status === 'running' && state?.nativeGrid === EXPECTED_GRID) break;
    await delay(250);
  }
  assert.equal(state?.status, 'running', 'native-low route did not become running');
  assert.equal(state?.nativeGrid, EXPECTED_GRID, 'native-low route used the wrong source grid');
  assert.equal(state?.runtimeTruthAvailable, false, 'runtime truth must be unavailable');
  assert.equal(state?.syntheticDownsampleApplied, false, 'native-low route silently used a synthetic downsample');
  assertModels(state.models || state.modelPackages);

  failurePhase = 'capture-handshake';
  const paused = await evaluate(socket, 'window.__kaminosNativeLowSelectiveLive.setCapturePaused(true)');
  assert.notEqual(paused, false, 'runtime rejected the witness pause handshake');
  state = await evaluate(socket, 'window.__kaminosNativeLowSelectiveLive.debugState()');
  assert.equal(state?.capturePaused, true, 'runtime did not report paused capture state');
  const clip = await evaluate(socket, `(() => {
    const panes = document.getElementById('panes');
    if (!panes) return null;
    const rect = panes.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale: 1 };
  })()`);
  assert.ok(clip && clip.width > 0 && clip.height > 0, 'three-role pane clip is missing or blank');
  const width = Math.round(Number(clip.width) * 2);
  const height = Math.round(Number(clip.height) * 2);
  ffmpeg = startEncoder();

  failurePhase = 'frame-locked-capture';
  let previousStep = Number(state.simulationStep);
  let previousStateIdentity = null;
  for (let frameIndex = 0; frameIndex < requestedFrameCount; frameIndex += 1) {
    const receipt = await evaluate(socket, 'window.__kaminosNativeLowSelectiveLive.stepCaptureFrame()');
    assert.equal(receipt?.ok, true, `runtime step ${frameIndex} failed: ${receipt?.reason || receipt?.error || 'unknown'}`);
    validateFrameReceipt(receipt, frameIndex, previousStep, previousStateIdentity);
    const capture = await socket.call('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
      clip,
    });
    assert.ok(capture?.data?.length > 1000, `captured frame ${frameIndex} was missing or blank`);
    await writeFrame(ffmpeg, capture.data);
    const compact = compactFrameReceipt(receipt, frameIndex);
    frames.push(compact);
    previousStep = compact.simulationStep;
    previousStateIdentity = compact.sameNativeStateIdentity;
    lastTrustworthyEvidence = {
      capturedFrameCount: frames.length,
      lastFrame: compact,
      width,
      height,
    };
    if ((frameIndex + 1) % 10 === 0 || frameIndex + 1 === requestedFrameCount) {
      console.log(JSON.stringify({
        phase: failurePhase,
        capturedFrameCount: frameIndex + 1,
        requestedFrameCount,
        simulationStep: compact.simulationStep,
      }));
    }
  }
  assertConsecutiveSteps(frames.map(frame => frame.simulationStep));

  failurePhase = 'video-encode';
  ffmpeg.stdin.end();
  const encoderResult = await ffmpeg.done;
  assert.equal(encoderResult.code, 0, `ffmpeg encode failed: ${encoderResult.stderr}`);
  ffmpeg = null;
  assert.ok(existsSync(out) && readFileSync(out).byteLength > 0, 'encoded video is missing or blank');

  failurePhase = 'contact-sheet';
  const middle = Math.floor((requestedFrameCount - 1) / 2);
  const last = requestedFrameCount - 1;
  const contactResult = await runProcess('ffmpeg', [
    '-y', '-v', 'error', '-i', out,
    '-vf', `select='eq(n,0)+eq(n,${middle})+eq(n,${last})',scale=900:-1,tile=3x1`,
    '-frames:v', '1', contactPath,
  ]);
  assert.equal(contactResult.code, 0, `contact sheet failed: ${contactResult.stderr}`);
  assert.ok(existsSync(contactPath) && readFileSync(contactPath).byteLength > 0, 'contact sheet is missing or blank');

  failurePhase = 'operator-page';
  writeOperatorPage();
  assert.ok(existsSync(pagePath) && readFileSync(pagePath).byteLength > 0, 'operator page is missing or blank');

  state = await evaluate(socket, 'window.__kaminosNativeLowSelectiveLive.debugState()');
  const report = {
    schema: SCHEMA,
    identity: IDENTITY,
    status: 'captured',
    failurePhase: null,
    requestedUrl: url,
    requestedRoute: state.requestedRoute,
    effectiveRoute: state.effectiveRoute,
    requestedBackend: state.requestedBackend,
    effectiveBackend: state.effectiveBackend,
    requestedComposition: state.requestedComposition,
    effectiveComposition: state.effectiveComposition,
    nativeGrid: EXPECTED_GRID,
    runtimeTruthAvailable: false,
    syntheticDownsampleApplied: false,
    roles: ROLES,
    models: MODELS,
    sequenceAuthority: SEQUENCE_AUTHORITY,
    presentedFrameAuthority: PRESENTED_FRAME_AUTHORITY,
    requestedFrameCount,
    capturedFrameCount: frames.length,
    simulationSteps: frames.map(frame => frame.simulationStep),
    playbackFps,
    playbackSeconds: frames.length / playbackFps,
    width,
    height,
    frames,
    video: artifact(out),
    contactSheet: artifact(contactPath),
    operatorPage: artifact(pagePath),
    lastTrustworthyEvidence,
  };
  writeReport(report);
  console.log(JSON.stringify({
    ok: true,
    report: reportPath,
    video: out,
    contactSheet: contactPath,
    operatorPage: pagePath,
    capturedFrameCount: frames.length,
    playbackSeconds: report.playbackSeconds,
  }, null, 2));
} catch (error) {
  writeReport({
    schema: SCHEMA,
    identity: IDENTITY,
    status: 'failed',
    failurePhase,
    error: error?.stack || error?.message || String(error),
    requestedUrl: url,
    requestedFrameCount,
    capturedFrameCount: frames.length,
    frames,
    lastTrustworthyEvidence,
  });
  console.error(JSON.stringify({
    ok: false,
    report: reportPath,
    failurePhase,
    error: error?.message || String(error),
  }, null, 2));
  process.exitCode = 1;
} finally {
  try { ffmpeg?.stdin?.destroy(); } catch {}
  try { socket?.close(); } catch {}
  browser?.kill('SIGTERM');
}

function validateFrameReceipt(receipt, frameIndex, previousStep, previousStateIdentity) {
  const simulationStep = Number(receipt.simulationStep ?? receipt.sourceStep);
  assert.ok(Number.isInteger(simulationStep), `frame ${frameIndex} has no integer simulation step`);
  if (Number.isFinite(previousStep)) {
    assert.equal(simulationStep, previousStep + 1, `simulation step discontinuity at frame ${frameIndex}`);
  }
  assert.ok(receipt.sameNativeStateIdentity, `frame ${frameIndex} has no sameNativeStateIdentity`);
  assert.ok(receipt.sourceStepIdentity, `frame ${frameIndex} has no sourceStepIdentity`);
  if (previousStateIdentity) {
    assert.notEqual(receipt.sameNativeStateIdentity, previousStateIdentity, `frame ${frameIndex} reused a stale native state`);
  }
  assert.equal(receipt.staleFrameReason ?? null, null, `frame ${frameIndex} reported a stale frame`);
  assert.equal(receipt.fallbackReason ?? null, null, `frame ${frameIndex} reported route fallback`);
  assert.equal(receipt.requestedRoute, receipt.effectiveRoute, `frame ${frameIndex} route identity drifted`);
  assert.equal(receipt.requestedBackend, receipt.effectiveBackend, `frame ${frameIndex} backend identity drifted`);
  assert.equal(receipt.requestedComposition, receipt.effectiveComposition, `frame ${frameIndex} composition identity drifted`);
  assertModels(receipt.models || receipt.modelPackages);
  for (const role of ROLES) {
    const roleReceipt = receipt.roles?.[role];
    assert.ok(roleReceipt, `frame ${frameIndex} is missing ${role}`);
    assert.equal(roleReceipt.sameNativeStateIdentity, receipt.sameNativeStateIdentity, `${role} used a different native state at frame ${frameIndex}`);
    assert.equal(roleReceipt.sourceStepIdentity, receipt.sourceStepIdentity, `${role} used a different source step at frame ${frameIndex}`);
    assert.equal(roleReceipt.fallbackReason ?? null, null, `${role} fell back at frame ${frameIndex}`);
    assert.equal(roleReceipt.staleFrameReason ?? null, null, `${role} reused stale output at frame ${frameIndex}`);
    const candidateCount = Number(roleReceipt.candidateCount);
    const instanceCount = Number(roleReceipt.instanceCount);
    const overflowCount = Number(roleReceipt.overflowCount);
    assert.ok(Number.isInteger(candidateCount) && candidateCount > 0, `${role} has no positive candidateCount at frame ${frameIndex}`);
    assert.equal(instanceCount, candidateCount, `${role} clipped candidates at frame ${frameIndex}`);
    assert.equal(overflowCount, 0, `${role} overflowed at frame ${frameIndex}`);
    if (MODELS[role]) {
      assert.equal(roleReceipt.modelIdentity, MODELS[role].identity, `${role} used the wrong model at frame ${frameIndex}`);
      assert.equal(roleReceipt.modelSha256, MODELS[role].sha256, `${role} used the wrong model checksum at frame ${frameIndex}`);
    }
  }
}

function compactFrameReceipt(receipt, frameIndex) {
  return {
    frameIndex,
    simulationStep: Number(receipt.simulationStep ?? receipt.sourceStep),
    sameNativeStateIdentity: receipt.sameNativeStateIdentity,
    sourceStepIdentity: receipt.sourceStepIdentity,
    requestedRoute: receipt.requestedRoute,
    effectiveRoute: receipt.effectiveRoute,
    requestedBackend: receipt.requestedBackend,
    effectiveBackend: receipt.effectiveBackend,
    requestedComposition: receipt.requestedComposition,
    effectiveComposition: receipt.effectiveComposition,
    fallbackReason: receipt.fallbackReason ?? null,
    staleFrameReason: receipt.staleFrameReason ?? null,
    roles: Object.fromEntries(ROLES.map(role => {
      const value = receipt.roles[role];
      return [role, {
        candidateCount: value.candidateCount,
        instanceCount: value.instanceCount,
        overflowCount: value.overflowCount,
        modelIdentity: value.modelIdentity || null,
        modelSha256: value.modelSha256 || null,
      }];
    })),
  };
}

function assertModels(models) {
  assert.ok(models, 'runtime omitted model package identities');
  for (const [role, expected] of Object.entries(MODELS)) {
    const observed = models[role];
    assert.ok(observed, `runtime omitted ${role} model package`);
    assert.equal(observed.identity ?? observed.modelIdentity, expected.identity, `${role} model identity mismatch`);
    assert.equal(observed.sha256 ?? observed.modelSha256, expected.sha256, `${role} model checksum mismatch`);
  }
}

function assertConsecutiveSteps(steps) {
  for (let index = 1; index < steps.length; index += 1) {
    assert.equal(steps[index], steps[index - 1] + 1, `simulation step discontinuity at captured frame ${index}`);
  }
}

function startEncoder() {
  const child = spawn('ffmpeg', [
    '-y', '-v', 'error',
    '-f', 'image2pipe', '-framerate', String(playbackFps), '-vcodec', 'png', '-i', '-',
    '-an', '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2',
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+fast', out,
  ], { stdio: ['pipe', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.done = new Promise(resolveDone => child.once('close', code => resolveDone({ code, stderr })));
  return child;
}

async function writeFrame(child, pngBase64) {
  const bytes = Buffer.from(pngBase64, 'base64');
  if (!child.stdin.write(bytes)) await new Promise(resolveDrain => child.stdin.once('drain', resolveDrain));
}

function artifact(path) {
  const bytes = readFileSync(path);
  return {
    path,
    byteLength: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

function writeOperatorPage() {
  const videoName = basename(out);
  const contactName = basename(contactPath);
  writeFileSync(pagePath, `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Native 96 two-model long motion</title><style>
:root{color-scheme:dark;font-family:Inter,system-ui,sans-serif;background:#080a0b;color:#eef2f3}*{box-sizing:border-box}body{margin:0;background:#080a0b}header{padding:12px 16px;border-bottom:1px solid #30383a;background:#111516}h1{font-size:17px;margin:0 0 4px}p{font-size:12px;color:#aab5b8;margin:0}.roles{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:#30383a}.role{padding:9px 12px;background:#121617}.role strong{display:block;font-size:13px}.role span{display:block;color:#98a6a9;font-size:10px;margin-top:2px}main{padding:0 0 18px}video{display:block;width:100%;height:auto;background:#000}nav{padding:12px 16px}a{color:#8fd4ff}@media(max-width:760px){.roles{grid-template-columns:1fr}.role{min-height:48px}}
</style></head><body><header><h1>Native 96 control vs both learned transfer models</h1><p>${requestedFrameCount} consecutive simulation steps at ${playbackFps} fps. Splat-only. No native-phase high-grid truth target.</p></header>
<section class="roles"><div class="role"><strong>Native 96 control</strong><span>No learned residual</span></div><div class="role"><strong>128-trained zero-shot</strong><span>${MODELS.baseline128Trained.identity}</span></div><div class="role"><strong>96-trained deployment-grid</strong><span>${MODELS.candidate96Trained.identity}</span></div></section>
<main><video autoplay loop controls muted playsinline src="./${videoName}"></video><nav><a href="./${contactName}">Open first / middle / last contact sheet</a></nav></main></body></html>\n`);
}

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) values.set(key, true);
    else {
      values.set(key, next);
      index += 1;
    }
  }
  return values;
}

function required(name) {
  const value = args.get(name);
  if (!value || value === true) throw new Error(`missing ${name}`);
  return String(value);
}

function integerArg(name, fallback) {
  const value = Math.floor(Number(args.get(name) ?? fallback));
  if (!Number.isFinite(value)) throw new Error(`${name} must be a finite integer`);
  return value;
}

function numberArg(name, fallback) {
  const value = Number(args.get(name) ?? fallback);
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
  return value;
}

function chromeExecutable() {
  const candidates = [
    process.env.CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ].filter(Boolean);
  const found = candidates.find(existsSync);
  if (!found) throw new Error('Chrome executable not found');
  return found;
}

async function waitForTarget(debugPort, timeout) {
  const started = performance.now();
  while (performance.now() - started < timeout) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      if (response.ok) {
        const targets = await response.json();
        const target = targets.find(item => item.type === 'page');
        if (target?.webSocketDebuggerUrl) return target;
      }
    } catch {}
    await delay(100);
  }
  throw new Error('Chrome debugging target did not appear');
}

async function evaluate(cdp, expression) {
  const result = await cdp.call('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'browser evaluation failed');
  return result.result?.value;
}

async function runProcess(command, commandArgs) {
  const child = spawn(command, commandArgs, { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  return new Promise(resolveRun => child.once('close', code => resolveRun({ code, stderr })));
}

function writeReport(value) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(value, null, 2)}\n`);
}

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}
