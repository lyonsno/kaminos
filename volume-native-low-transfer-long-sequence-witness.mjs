#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash, randomInt } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const args = parseArgs(process.argv.slice(2));
const newBasinZeroShot = args.has('--new-basin-zero-shot');
const latestBasinTrainedComparison = args.has('--latest-basin-trained-comparison');
const SCHEMA = latestBasinTrainedComparison
  ? 'kaminos.volume.latest-happy-bowl-trained-raymarch-witness.v0'
  : newBasinZeroShot
  ? 'kaminos.volume.new-basin-zero-shot-raymarch-witness.v0'
  : 'kaminos.volume.native-low-transfer-long-sequence-witness.v0';
const IDENTITY = latestBasinTrainedComparison
  ? 'latest-happy-bowl-trained-raymarch-witness-v0'
  : newBasinZeroShot
  ? 'new-basin-zero-shot-raymarch-witness-v0'
  : 'native-low-two-model-long-sequence-witness-v0';
const PRESENTED_FRAME_AUTHORITY = newBasinZeroShot
  ? 'cdp-presented-four-role-raymarch-frame-after-one-native-step-v0'
  : 'cdp-presented-three-role-frame-after-one-native-step-v0';
const captureViewport = newBasinZeroShot
  ? Object.freeze({ width: 1200, height: 1200 })
  : Object.freeze({ width: 1800, height: 720 });
const expectedGrid = integerArg('--expected-grid', 96);
const controlRole = `native${expectedGrid}Control`;
const SEQUENCE_AUTHORITY = `frame-locked-consecutive-native-${expectedGrid}-simulation-steps-v0`;
const ROLES = Object.freeze(latestBasinTrainedComparison
  ? [controlRole, 'latestBasin96Trained', 'candidate96Trained', 'deterministicUpscale']
  : newBasinZeroShot
  ? [controlRole, 'baseline128Trained', 'candidate96Trained', 'deterministicUpscale']
  : [controlRole, 'baseline128Trained', 'candidate96Trained']);
const ALL_MODELS = Object.freeze({
  baseline128Trained: Object.freeze({
    identity: 'exact-basin-selective-carrier-heads-160-to-128-v0',
    sha256: 'dc1886384f87c4e51015f6ffd5ac8c0a48ac6f32b6f02a238ac5e3c3bd883dc9',
  }),
  candidate96Trained: Object.freeze({
    identity: 'exact-basin-selective-carrier-heads-160-to-96-v0',
    sha256: 'baa54236f04c28eab278cf60e4a60745cd3c0160a985a9adbb1e06db7958f6e8',
  }),
  latestBasin96Trained: Object.freeze({
    identity: 'latest-happy-bowl-selective-carrier-heads-160-to-96-step96-v0',
    sha256: '97e25caa711395f26e8b39f22c506e38e772bfc1a12cf518d5e048511d2bee08',
  }),
});
const MODELS = Object.freeze(Object.fromEntries(
  Object.entries(ALL_MODELS).filter(([role]) => ROLES.includes(role)),
));

let url = null;
const out = resolve(String(args.get('--out') || '/tmp/kaminos-native-low-transfer-long-sequence.mp4'));
const reportPath = resolve(String(args.get('--report') || '/tmp/kaminos-native-low-transfer-long-sequence.json'));
const contactPath = resolve(String(args.get('--contact') || out.replace(/\.mp4$/i, '-contact.png')));
const pagePath = resolve(String(args.get('--page') || `${dirname(out)}/index.html`));
const requestedFrameCount = integerArg('--frames', 150);
const playbackFps = numberArg('--fps', 30);
const timeoutMs = numberArg('--timeout-ms', 900000);
const captureCallTimeoutMs = numberArg('--capture-call-timeout-ms', 30000);
const port = integerArg('--debug-port', randomInt(42000, 62000));
let failurePhase = 'argument-validation';
let activeFramePhase = 'not-started';
let browser = null;
let socket = null;
let captureSocket = null;
let captureTargetUrl = null;
let ffmpeg = null;
let lastTrustworthyEvidence = null;
let lastObservedRouteState = null;
const frames = [];
let screenshotRetryCount = 0;

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
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
      });
    });
  }

  call(method, params = {}, { timeoutMs: callTimeoutMs = 0 } = {}) {
    return new Promise((resolveCall, rejectCall) => {
      const id = this.nextId++;
      const timer = callTimeoutMs > 0 ? setTimeout(() => {
        this.pending.delete(id);
        rejectCall(new Error(`[cdp-call-timeout] ${method} exceeded ${callTimeoutMs}ms`));
      }, callTimeoutMs) : null;
      this.pending.set(id, { resolve: resolveCall, reject: rejectCall, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket?.close();
  }
}

try {
  url = required('--url');
  if (latestBasinTrainedComparison) {
    const requested = new URL(url);
    requested.searchParams.set('new_basin_zero_shot', '1');
    requested.searchParams.set('latest_basin_trained_comparison', '1');
    url = requested.href;
  }
  assert.ok(requestedFrameCount >= 1, '--frames must be at least one');
  assert.ok(playbackFps > 0, '--fps must be positive');
  assert.ok(timeoutMs > 0, '--timeout-ms must be positive');
  assert.ok(captureCallTimeoutMs > 0, '--capture-call-timeout-ms must be positive');
  const supportedGrid = newBasinZeroShot
    ? [48, 64, 96, 128].includes(expectedGrid)
    : [64, 96, 128].includes(expectedGrid);
  assert.ok(supportedGrid, newBasinZeroShot
    ? '--expected-grid must be 48, 64, 96, or 128'
    : '--expected-grid must be 64, 96, or 128');
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
    `--window-size=${captureViewport.width},${captureViewport.height}`,
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ], { stdio: 'ignore' });
  const target = await waitForTarget(port, timeoutMs);
  captureTargetUrl = target.webSocketDebuggerUrl;
  socket = new CdpSocket(target.webSocketDebuggerUrl);
  await socket.open();
  await socket.call('Page.enable');
  await socket.call('Runtime.enable');
  await socket.call('Emulation.setDeviceMetricsOverride', {
    width: captureViewport.width,
    height: captureViewport.height,
    deviceScaleFactor: 2,
    mobile: false,
  });
  await socket.call('Page.navigate', { url });
  await reconnectCaptureSocket();

  failurePhase = 'route-settle';
  let state = null;
  const settleStarted = performance.now();
  while (performance.now() - settleStarted < timeoutMs) {
    state = await evaluate(socket, 'window.__kaminosNativeLowSelectiveLive?.debugState?.()');
    lastObservedRouteState = state;
    if (state?.status === 'failed') {
      const routeError = state?.lastTrustworthyEvidence?.error || state.error || state.failureReason || 'native-low route failed';
      throw new Error(routeError);
    }
    const settledStatus = ['running', 'paused'].includes(state?.status);
    const pausedManualRoute = state?.status !== 'paused' || state?.capturePaused === true;
    if (settledStatus && pausedManualRoute && state?.nativeGrid === expectedGrid) break;
    await delay(250);
  }
  assert.ok(['running', 'paused'].includes(state?.status), 'native-low route did not become running or explicitly paused');
  if (state.status === 'paused') assert.equal(state.capturePaused, true, 'paused route did not report capturePaused');
  assert.equal(state?.nativeGrid, expectedGrid, 'native-low route used the wrong source grid');
  assert.equal(state?.runtimeTruthAvailable, false, 'runtime truth must be unavailable');
  assert.equal(state?.syntheticDownsampleApplied, false, 'native-low route silently used a synthetic downsample');
  if (newBasinZeroShot) {
    assert.equal(state?.requestedBasinIdentity, 'vsp-48617494d68e4f24bba358676733f2aaa5f03622b1747c45056de56884fe78d8', 'requested basin identity drifted');
    const presetReceipt = state?.latestHappyBowlPresetReceipt || {};
    const exactPresetExpected = expectedGrid === Number(presetReceipt.presetGrid);
    assert.equal(presetReceipt.exactPresetRouteApplied, exactPresetExpected, 'exact preset route status drifted');
    assert.equal(presetReceipt.sourceGridOverrideApplied, !exactPresetExpected, 'source-grid override status drifted');
    if (exactPresetExpected) {
      assert.deepEqual(presetReceipt.controlOverrides, {}, 'exact preset route carried hidden control overrides');
      assert.equal(state?.effectiveBasinIdentity, state.requestedBasinIdentity, 'exact preset route silently substituted its basin identity');
    } else {
      assert.deepEqual(presetReceipt.controlOverrides, {
        volume_resolution: { requested: String(expectedGrid), preset: String(presetReceipt.presetGrid) },
      }, 'grid-overridden route did not record its sole control override');
      assert.equal(state?.effectiveBasinIdentity, `${state.requestedBasinIdentity}+volume_resolution=${expectedGrid}`, 'overridden route impersonated the exact preset identity');
    }
    assert.equal(state?.latestHappyBowlPresetReceipt?.presetFileSha256, 'bf13e68b6904cfc5677b13af14afe4426f15f9649bfda22105eed8611c5d0967', 'preset file checksum drifted');
  }
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
    activeFramePhase = `frame-${frameIndex}:runtime-step`;
    const receipt = await evaluate(socket, 'window.__kaminosNativeLowSelectiveLive.stepCaptureFrame()');
    assert.equal(receipt?.ok, true, `runtime step ${frameIndex} failed: ${receipt?.reason || receipt?.error || 'unknown'}`);
    validateFrameReceipt(receipt, frameIndex, previousStep, previousStateIdentity);
    activeFramePhase = `frame-${frameIndex}:presented-frame-capture`;
    const capture = await captureScreenshotWithRetry({
      format: 'png',
      captureBeyondViewport: false,
      clip,
    }, frameIndex);
    assert.ok(capture?.data?.length > 1000, `captured frame ${frameIndex} was missing or blank`);
    activeFramePhase = `frame-${frameIndex}:encoder-write`;
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
      activeFramePhase: `frame-${frameIndex}:complete`,
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
  activeFramePhase = 'all-frames-captured';
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
    requestedBasinIdentity: state.requestedBasinIdentity || null,
    effectiveBasinIdentity: state.effectiveBasinIdentity || null,
    latestHappyBowlPresetReceipt: state.latestHappyBowlPresetReceipt || null,
    nativeGrid: expectedGrid,
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
    captureCallTimeoutMs,
    screenshotRetryCount,
    width,
    height,
    captureViewport,
    frames,
    video: artifact(out),
    contactSheet: artifact(contactPath),
    operatorPage: artifact(pagePath),
    lastTrustworthyEvidence,
    lastObservedRouteState,
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
    activeFramePhase,
    error: error?.stack || error?.message || String(error),
    requestedUrl: url,
    requestedFrameCount,
    capturedFrameCount: frames.length,
    captureCallTimeoutMs,
    screenshotRetryCount,
    frames,
    lastTrustworthyEvidence,
    lastObservedRouteState,
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
  try { captureSocket?.close(); } catch {}
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
  assert.ok(receipt.requestedRoute, `frame ${frameIndex} omitted requested route identity`);
  assert.ok(receipt.effectiveRoute, `frame ${frameIndex} omitted effective route identity`);
  assert.equal(receipt.requestedBackend, receipt.effectiveBackend, `frame ${frameIndex} backend identity drifted`);
  assert.equal(receipt.requestedComposition, receipt.effectiveComposition, `frame ${frameIndex} composition identity drifted`);
  assertModels(receipt.models || receipt.modelPackages || receipt.modelReceipts);
  const roleReceipts = receipt.roles || receipt.visualRoles;
  for (const role of ROLES) {
    const roleReceipt = roleReceipts?.[role];
    assert.ok(roleReceipt, `frame ${frameIndex} is missing ${role}`);
    assert.equal(roleReceipt.sameNativeStateIdentity, receipt.sameNativeStateIdentity, `${role} used a different native state at frame ${frameIndex}`);
    assert.equal(roleReceipt.sourceStepIdentity, receipt.sourceStepIdentity, `${role} used a different source step at frame ${frameIndex}`);
    assert.equal(roleReceipt.fallbackReason ?? null, null, `${role} fell back at frame ${frameIndex}`);
    assert.equal(roleReceipt.staleFrameReason ?? null, null, `${role} reused stale output at frame ${frameIndex}`);
    if (role === 'candidate96Trained') {
      const verification = roleReceipt.sourceStepIdentityVerification;
      assert.ok(verification, `${role} omitted source-step identity verification at frame ${frameIndex}`);
      assert.equal(verification.expectationSupplied, true, `${role} did not guard the expected source identity at frame ${frameIndex}`);
      assert.equal(verification.expectationMatched, true, `${role} source identity expectation did not match at frame ${frameIndex}`);
      assert.equal(verification.expectedSourceStepIdentity, receipt.sourceStepIdentity, `${role} expected a different source identity at frame ${frameIndex}`);
      assert.equal(verification.computedSourceStepIdentity, receipt.sourceStepIdentity, `${role} computed a different source identity at frame ${frameIndex}`);
      assert.equal(verification.effectiveSourceStepIdentity, receipt.sourceStepIdentity, `${role} used a different effective source identity at frame ${frameIndex}`);
    }
    if (receipt.requestedComposition === 'splat-only-v0') {
      const candidateCount = Number(roleReceipt.candidateCount);
      const instanceCount = Number(roleReceipt.instanceCount);
      const overflowCount = Number(roleReceipt.overflowCount);
      assert.ok(Number.isInteger(candidateCount) && candidateCount > 0, `${role} has no positive candidateCount at frame ${frameIndex}`);
      assert.equal(instanceCount, candidateCount, `${role} clipped candidates at frame ${frameIndex}`);
      assert.equal(overflowCount, 0, `${role} overflowed at frame ${frameIndex}`);
    }
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
      const value = (receipt.roles || receipt.visualRoles)[role];
      return [role, {
        candidateCount: value.candidateCount,
        instanceCount: value.instanceCount,
        overflowCount: value.overflowCount,
        modelIdentity: value.modelIdentity || null,
        modelSha256: value.modelSha256 || null,
        expectedSourceStepIdentity: value.expectedSourceStepIdentity ?? null,
        computedSourceStepIdentity: value.computedSourceStepIdentity || null,
        sourceStepIdentityVerification: value.sourceStepIdentityVerification || null,
        stageTiming: value.stageTiming || null,
        modelSpecificTiming: value.modelSpecificTiming || null,
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
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out,
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

async function captureScreenshotWithRetry(params, frameIndex) {
  let firstError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await captureSocket.call('Page.captureScreenshot', params, { timeoutMs: captureCallTimeoutMs });
    } catch (error) {
      if (attempt > 0) throw error;
      firstError = error;
      screenshotRetryCount += 1;
      console.warn(JSON.stringify({
        phase: 'presented-frame-capture-retry',
        frameIndex,
        reason: error?.message || String(error),
      }));
      await reconnectCaptureSocket();
    }
  }
  throw firstError;
}

async function reconnectCaptureSocket() {
  captureSocket?.close();
  captureSocket = new CdpSocket(captureTargetUrl);
  await captureSocket.open();
  await captureSocket.call('Page.enable');
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
<title>Native ${expectedGrid} two-model long motion</title><style>
:root{color-scheme:dark;font-family:Inter,system-ui,sans-serif;background:#080a0b;color:#eef2f3}*{box-sizing:border-box}body{margin:0;background:#080a0b}header{padding:12px 16px;border-bottom:1px solid #30383a;background:#111516}h1{font-size:17px;margin:0 0 4px}p{font-size:12px;color:#aab5b8;margin:0}.roles{display:grid;grid-template-columns:repeat(${newBasinZeroShot ? 4 : 3},1fr);gap:1px;background:#30383a}.role{padding:9px 12px;background:#121617}.role strong{display:block;font-size:13px}.role span{display:block;color:#98a6a9;font-size:10px;margin-top:2px}main{padding:0 0 18px}video{display:block;width:100%;height:auto;background:#000}nav{padding:12px 16px}a{color:#8fd4ff}@media(max-width:760px){.roles{grid-template-columns:1fr}.role{min-height:48px}}
</style></head><body><header><h1>Native ${expectedGrid} ${newBasinZeroShot ? 'new-basin raymarch reconstruction' : 'control vs both learned transfer models'}</h1><p>${requestedFrameCount} consecutive simulation steps at ${playbackFps} fps. ${newBasinZeroShot ? (expectedGrid === 96 ? 'Raymarch-only, exact latest_happy_bowl preset.' : 'Raymarch-only, latest_happy_bowl preset + explicit source-grid override.') : 'Splat-only.'} No native-phase high-grid truth target.</p></header>
<section class="roles"><div class="role"><strong>Native ${expectedGrid} control</strong><span>No learned residual</span></div>${latestBasinTrainedComparison ? `<div class="role"><strong>Latest-basin 96-trained</strong><span>${MODELS.latestBasin96Trained.identity}</span></div><div class="role"><strong>Legacy 96-trained</strong><span>${MODELS.candidate96Trained.identity}</span></div>` : `<div class="role"><strong>128-trained zero-shot</strong><span>${MODELS.baseline128Trained.identity}</span></div><div class="role"><strong>96-trained zero-shot</strong><span>${MODELS.candidate96Trained.identity}</span></div>`}${newBasinZeroShot ? '<div class="role"><strong>Deterministic upscale</strong><span>Native field at 160^3, no learned residual</span></div>' : ''}</section>
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
