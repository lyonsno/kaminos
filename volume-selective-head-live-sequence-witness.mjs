#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash, randomInt } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const SCHEMA = 'kaminos.volume.selective-head-live-sequence-witness.v0';
const ROUTE = 'exact-basin-selective-head-live-v0';
const MODEL = 'exact-basin-selective-carrier-heads-160-to-128-v0';
const SEQUENCE_AUTHORITY = 'frame-locked-consecutive-simulation-steps-v0';
const PRESENTED_FRAME_AUTHORITY = 'cdp-presented-frame-after-consecutive-sim-step-v0';
const ROLE_AUTHORITIES = Object.freeze({
  truthHigh: 'current-high-field-reference-no-learned-composition-v0',
  lowPhaseAligned: 'phase-aligned-low-field-control-v0',
  selectiveFullResidual: 'learned-selective-full-residual-composition-v0',
});
const PRESET_VIEW_COMPOSITIONS = Object.freeze({
  'splat-only': 'splat-only-v0',
  'raymarch-only': 'raymarch-only-v0',
  'smoke-hybrid': 'smoke-raymarch-under-splats-v0',
  'full-hybrid-diagnostic': 'full-raymarch-under-splats-diagnostic-v0',
});
const args = parseArgs(process.argv.slice(2));
const url = required('--url');
const requestedUrl = new URL(url);
const requestedParams = requestedUrl.searchParams;
const requestedPresetView = requestedUrl.pathname.endsWith('/volume-settings-preset.html')
  ? requestedParams.get('view')
  : null;
const expectedComposition = expectedCompositionFromAxes(requestedParams, requestedPresetView);
const out = resolve(String(args.get('--out') || '/tmp/kaminos-selective-head-live-sequence.mp4'));
const reportPath = resolve(String(args.get('--report') || '/tmp/kaminos-selective-head-live-sequence.json'));
const contactPath = resolve(String(args.get('--contact') || out.replace(/\.mp4$/i, '-contact.png')));
const requestedFrameCount = Math.floor(Number(args.get('--frames') || 150));
const playbackFps = Number(args.get('--fps') || 30);
const timeoutMs = Number(args.get('--timeout-ms') || 900000);
const port = Number(args.get('--debug-port') || randomInt(42000, 62000));
let failurePhase = 'argument-validation';
let browser = null;
let socket = null;
let ffmpeg = null;
const capturedSimSteps = [];
let lastTrustworthyEvidence = {};

class CdpSocket {
  constructor(url) { this.url = url; this.socket = null; this.nextId = 1; this.pending = new Map(); }
  open() {
    return new Promise((resolveOpen, reject) => {
      this.socket = new WebSocket(this.url);
      this.socket.addEventListener('open', resolveOpen, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
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
    return new Promise((resolveCall, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve: resolveCall, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  close() { this.socket?.close(); }
}

try {
  assert.ok(requestedFrameCount >= 1, '--frames must be at least one');
  assert.ok(playbackFps > 0, '--fps must be positive');
  mkdirSync(dirname(out), { recursive: true });
  mkdirSync(dirname(reportPath), { recursive: true });
  mkdirSync(dirname(contactPath), { recursive: true });
  failurePhase = 'browser-launch';
  browser = spawn(chromeExecutable(), [
    '--headless=new',
    '--enable-unsafe-webgpu',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    `--remote-debugging-port=${port}`,
    '--window-size=1280,800',
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
    width: 1620, height: 633, deviceScaleFactor: 2, mobile: false,
  });
  await socket.call('Page.navigate', { url });

  failurePhase = 'trained-horizon-settle';
  const settleStarted = performance.now();
  let state = null;
  let expectedRoleAuthority = null;
  while (performance.now() - settleStarted < timeoutMs) {
    state = await evaluate(socket, 'window.__kaminosSelectiveHeadLive?.debugState?.()');
    expectedRoleAuthority = ROLE_AUTHORITIES[state?.requestedRole] || null;
    if (state?.status === 'failed') throw new Error(state.error || state.fallbackReason || 'live route failed');
    if (state?.compositionOverrideReason) {
      throw new Error(`unexpected-composition-override:${state.compositionOverrideReason}`);
    }
    if (
      state?.routeIdentity === ROUTE
      && state?.status === 'running'
      && state?.warmupComplete === true
      && state?.warmupReceipt?.completedSteps === state?.warmupTarget
      && state?.effectiveRole === state?.requestedRole
      && state?.effectiveComposition === expectedComposition
      && state?.roleAuthority === expectedRoleAuthority
      && state?.modelIdentity === MODEL
      && !state?.fallbackReason
      && !state?.compositionFallbackReason
      && !state?.boundarySplatFallbackReason
    ) break;
    await delay(250);
  }
  assert.equal(state?.routeIdentity, ROUTE, 'wrong effective route');
  assert.equal(state?.status, 'running', 'live route did not cross the trained replay horizon');
  assert.equal(state?.warmupComplete, true, 'trained replay warmup was incomplete');
  assert.equal(state?.warmupReceipt?.completedSteps, state?.warmupTarget, 'warmup receipt did not match the requested horizon');
  assert.equal(state?.effectiveRole, state?.requestedRole, 'requested role silently fell back');
  assert.equal(state?.effectiveComposition, expectedComposition, 'requested composition silently fell back');
  assert.equal(state?.compositionOverrideReason, null, 'unexpected-composition-override');
  assert.equal(state?.roleAuthority, expectedRoleAuthority, 'requested role used the wrong composition authority');
  assert.equal(state?.modelIdentity, MODEL, 'wrong frozen model identity');

  await evaluate(socket, "document.getElementById('toolbar').style.display='none'; window.__kaminosSelectiveHeadLive.setCapturePaused(true)");
  state = await evaluate(socket, 'window.__kaminosSelectiveHeadLive.debugState()');
  const clip = await evaluate(socket, `(() => {
    const iframeRect = document.getElementById('basin').getBoundingClientRect();
    const canvasRect = document.getElementById('basin').contentWindow.__kaminosVolumePrototype.canvasElement().getBoundingClientRect();
    return {
      x: iframeRect.x + canvasRect.x,
      y: iframeRect.y + canvasRect.y,
      width: canvasRect.width,
      height: canvasRect.height,
      scale: 1,
    };
  })()`);
  const width = Math.round(Number(clip.width) * 2);
  const height = Math.round(Number(clip.height) * 2);
  assert.ok(width > 0 && height > 0, 'renderer canvas clip was blank');
  ffmpeg = startEncoder();
  failurePhase = 'frame-locked-capture';
  let previousStep = Number(state.simStepCount);
  for (let frameIndex = 0; frameIndex < requestedFrameCount; frameIndex += 1) {
    const stepReceipt = await evaluate(socket, 'window.__kaminosSelectiveHeadLive.stepCaptureFrame()');
    assert.equal(stepReceipt?.ok, true, `renderer-internal step ${frameIndex} failed: ${stepReceipt?.reason || 'unknown'}`);
    assert.equal(Number(stepReceipt.beforeSimStepCount), previousStep, `renderer-internal step ${frameIndex} started from the wrong state`);
    assert.equal(Number(stepReceipt.simStepCount), previousStep + 1, `simulation step discontinuity before captured frame ${frameIndex}`);
    assert.equal(stepReceipt.effectiveRole, stepReceipt.requestedRole, `renderer-internal step ${frameIndex} changed role`);
    assert.equal(stepReceipt.roleAuthority, expectedRoleAuthority, `renderer-internal step ${frameIndex} changed composition authority`);
    assert.equal(stepReceipt.selectiveHeadLiveCompositionEffective, expectedComposition, `composition drift during renderer-internal step ${frameIndex}`);
    assert.equal(stepReceipt.selectiveHeadLiveCompositionFallbackReason, null, `renderer-internal step ${frameIndex} reported composition fallback`);
    assert.ok(stepReceipt.selectiveHeadLivePassReceipt, `renderer-internal step ${frameIndex} omitted selectiveHeadLivePassReceipt`);
    assert.equal(stepReceipt.fallbackReason, null, `renderer-internal step ${frameIndex} reported model fallback`);
    assert.equal(stepReceipt.boundarySplatFallbackReason, null, `renderer-internal step ${frameIndex} reported splat fallback`);
    const capture = await socket.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, clip });
    assert.ok(capture?.data?.length > 1000, `frame ${frameIndex} screenshot was blank or missing`);
    await writeFrame(ffmpeg, capture.data);
    capturedSimSteps.push(Number(stepReceipt.simStepCount));
    assertConsecutiveSteps(capturedSimSteps);
    previousStep = Number(stepReceipt.simStepCount);
    if ((frameIndex + 1) % 10 === 0 || frameIndex + 1 === requestedFrameCount) {
      console.log(JSON.stringify({ phase: 'frame-locked-capture', captured: frameIndex + 1, requestedFrameCount, simStep: stepReceipt.simStepCount }));
    }
  }
  lastTrustworthyEvidence = { state, width, height, capturedSimSteps: [...capturedSimSteps] };

  failurePhase = 'video-encode';
  ffmpeg.stdin.end();
  const encoderResult = await ffmpeg.done;
  assert.equal(encoderResult.code, 0, `ffmpeg encode failed: ${encoderResult.stderr}`);
  ffmpeg = null;
  assert.ok(existsSync(out) && readFileSync(out).byteLength > 0, 'encoded video is missing or blank');

  failurePhase = 'contact-sheet';
  const middle = Math.floor((requestedFrameCount - 1) / 2);
  const last = requestedFrameCount - 1;
  const contact = await runProcess('ffmpeg', [
    '-y', '-v', 'error', '-i', out,
    '-vf', `select='eq(n,0)+eq(n,${middle})+eq(n,${last})',scale=640:-1,tile=3x1`,
    '-frames:v', '1', contactPath,
  ]);
  assert.equal(contact.code, 0, `contact sheet failed: ${contact.stderr}`);
  assert.ok(existsSync(contactPath) && readFileSync(contactPath).byteLength > 0, 'contact sheet is missing or blank');

  const report = {
    schema: SCHEMA,
    identity: 'selective-head-trained-horizon-continuous-sequence-v0',
    status: 'captured',
    failurePhase: null,
    requestedUrl: url,
    effectiveRoute: state.routeIdentity,
    requestedRole: state.requestedRole,
    effectiveRole: state.effectiveRole,
    roleAuthority: state.roleAuthority,
    expectedComposition,
    requestedComposition: state.requestedComposition,
    effectiveComposition: state.effectiveComposition,
    compositionAuthority: state.compositionAuthority,
    compositionOverrideReason: state.compositionOverrideReason,
    compositionFallbackReason: state.compositionFallbackReason,
    selectiveHeadLivePassReceipt: state.selectiveHeadLivePassReceipt,
    modelIdentity: state.modelIdentity,
    featureAuthority: state.featureAuthority,
    pairAuthority: state.pairAuthority,
    warmupAuthority: state.warmupAuthority,
    warmupReceipt: state.warmupReceipt,
    sequenceAuthority: SEQUENCE_AUTHORITY,
    presentedFrameAuthority: PRESENTED_FRAME_AUTHORITY,
    requestedFrameCount,
    capturedFrameCount: capturedSimSteps.length,
    capturedSimSteps,
    playbackFps,
    playbackSeconds: capturedSimSteps.length / playbackFps,
    width,
    height,
    backend: state.backend,
    video: artifact(out),
    contactSheet: artifact(contactPath),
  };
  writeReport(report);
  console.log(JSON.stringify({ ok: true, report: reportPath, video: out, contactSheet: contactPath, capturedFrameCount: capturedSimSteps.length }, null, 2));
} catch (error) {
  writeReport({
    schema: SCHEMA,
    identity: 'selective-head-trained-horizon-continuous-sequence-v0',
    status: 'failed',
    failurePhase,
    error: error?.stack || error?.message || String(error),
    requestedUrl: url,
    requestedFrameCount,
    capturedSimSteps,
    lastTrustworthyEvidence,
  });
  console.error(JSON.stringify({ ok: false, report: reportPath, failurePhase, error: error?.message || String(error) }, null, 2));
  process.exitCode = 1;
} finally {
  try { ffmpeg?.stdin?.destroy(); } catch {}
  try { socket?.close(); } catch {}
  browser?.kill('SIGTERM');
}

function expectedCompositionFromAxes(params, presetView = null) {
  const requestedComposition = params.get('composition')
    || PRESET_VIEW_COMPOSITIONS[presetView]
    || 'smoke-raymarch-under-splats-v0';
  if (requestedComposition === 'full-raymarch-under-splats-diagnostic-v0') return requestedComposition;
  if (requestedComposition === 'raymarch-only-v0') return requestedComposition;
  const requestedSmoke = params.get('volume_raymarch_smoke')
    || (requestedComposition === 'splat-only-v0' ? 'off' : 'on');
  return requestedSmoke === 'off' ? 'splat-only-v0' : 'smoke-raymarch-under-splats-v0';
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
    '-an', '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2', '-c:v', 'libx264', '-preset', 'fast', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out,
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
  return { path, byteLength: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') };
}

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) values.set(key, true);
    else { values.set(key, next); index += 1; }
  }
  return values;
}

function required(name) {
  const value = args.get(name);
  if (!value || value === true) throw new Error(`missing ${name}`);
  return String(value);
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
        const target = targets.find(isInspectablePageTarget);
        if (target?.webSocketDebuggerUrl) return target;
      }
    } catch {}
    await delay(100);
  }
  throw new Error('Chrome debugging target did not appear');
}

function isInspectablePageTarget(target) {
  const targetUrl = String(target?.url || '');
  return target?.type === 'page' && !targetUrl.startsWith('chrome-extension://');
}

async function evaluate(cdp, expression) {
  const result = await cdp.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'browser evaluation failed');
  return result.result?.value;
}

async function runProcess(command, commandArgs) {
  const child = spawn(command, commandArgs, { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  return new Promise(resolveRun => child.once('close', code => resolveRun({ code, stderr })));
}

function delay(ms) { return new Promise(resolveDelay => setTimeout(resolveDelay, ms)); }

function writeReport(value) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(value, null, 2)}\n`);
}
