#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash, randomInt } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const SCHEMA = 'kaminos.volume.native64-causal-cue-feedback-witness.v0';
const IDENTITY = 'native64-causal-cue-feedback-continuous-motion-v0';
const REQUIRED_ROLES = Object.freeze(['control', 'self', 'learnedContinuous', 'learnedRelease']);
const SEQUENCE_AUTHORITY = 'consecutive-native64-simulation-steps-v0';
const args = parseArgs(process.argv.slice(2));
const role = String(args.get('--role') || 'control');
const url = required('--url');
const out = resolve(String(args.get('--out') || `/tmp/kaminos-native64-causal-${role}.mp4`));
const reportPath = resolve(String(args.get('--report') || out.replace(/\.mp4$/i, '.json')));
const requestedFrameCount = integerArg('--frames', 60);
const playbackFps = numberArg('--fps', 30);
const preRollSteps = integerArg('--preroll-steps', 96);
const requestedFlowDebug = numberArg('--flow-debug', 0);
const firstCapturedSimulationStep = preRollSteps + 1;
const timeoutMs = numberArg('--timeout-ms', 900000);
const port = integerArg('--debug-port', randomInt(42000, 62000));
let failurePhase = 'argument-validation';
let lastTrustworthyEvidence = null;
let browser = null;
let socket = null;
let ffmpeg = null;
const frames = [];
const frameHashes = [];

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
  assert.ok(REQUIRED_ROLES.includes(role), `unsupported role ${role}`);
  assert.ok(requestedFrameCount > 1, '--frames must be greater than one');
  assert.ok(playbackFps > 0, '--fps must be positive');
  assert.ok(preRollSteps >= 0, '--preroll-steps must be non-negative');
  assert.ok(requestedFlowDebug >= 0 && requestedFlowDebug <= 1, '--flow-debug must be between zero and one');
  mkdirSync(dirname(out), { recursive: true });
  mkdirSync(dirname(reportPath), { recursive: true });

  failurePhase = 'browser-launch';
  browser = spawn(chromeExecutable(), [
    '--headless=new',
    '--enable-unsafe-webgpu',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    `--remote-debugging-port=${port}`,
    '--window-size=960,960',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ], { stdio: 'ignore' });
  const target = await waitForTarget(port, timeoutMs);
  socket = new CdpSocket(target.webSocketDebuggerUrl);
  await socket.open();
  await socket.call('Page.enable');
  await socket.call('Runtime.enable');
  await socket.call('Emulation.setDeviceMetricsOverride', { width: 960, height: 960, deviceScaleFactor: 1, mobile: false });
  await socket.call('Page.navigate', { url });

  failurePhase = 'route-settle';
  let state = null;
  const settleStarted = performance.now();
  while (performance.now() - settleStarted < timeoutMs) {
    state = await evaluate('window.__kaminosNative64CausalCueFeedback?.debugState?.()');
    if (state?.status === 'failed') throw new Error(`${state.failurePhase || 'route'}:operator route failed`);
    if (state?.status === 'active') break;
    await delay(200);
  }
  assert.equal(state?.status, 'active', 'native64 causal operator route did not activate');
  assert.equal(state.role, role, 'operator route role mismatch');
  assert.equal(state.nativeGrid, 64, 'operator route did not bind native64');
  assert.equal(state.preRollSteps, preRollSteps, 'operator route pre-roll length mismatch');
  assert.equal(state.requestedFlowDebug, requestedFlowDebug, 'operator route flow-debug request mismatch');
  assert.equal(state.firstCapturedSimulationStep, firstCapturedSimulationStep, 'operator route first captured simulation step mismatch');
  assert.equal(state.initialStateContract?.preRollIdentity, 'causal-unforced-deterministic-preroll-v0', 'operator route pre-roll identity mismatch');
  assert.equal(state.runtimeTruthAvailable, false, 'runtime truth must remain unavailable');
  assert.equal(state.syntheticDownsampleApplied, false, 'synthetic source downsampling must remain disabled');

  const clip = await evaluate(`(() => {
    const node = document.getElementById('frame');
    const rect = node?.getBoundingClientRect();
    return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale: 1 } : null;
  })()`);
  assert.ok(clip?.width > 0 && clip?.height > 0, 'native64 causal image clip is missing');
  ffmpeg = startEncoder();

  failurePhase = 'continuous-frame-capture';
  let previousSimulationStep = null;
  for (let frameIndex = 0; frameIndex < requestedFrameCount; frameIndex += 1) {
    const frame = await evaluate('window.__kaminosNative64CausalCueFeedback.stepFrame()');
    validateFrame(frame, frameIndex, previousSimulationStep);
    await evaluate(`document.getElementById('causalNativeSource').decode()`);
    const presented = await evaluate(`(() => {
      const image = document.getElementById('causalNativeSource');
      return { complete: image.complete, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, src: image.currentSrc };
    })()`);
    assert.equal(presented.complete, true, `frame ${frameIndex} image was incomplete`);
    assert.ok(presented.naturalWidth > 0 && presented.naturalHeight > 0, `frame ${frameIndex} image was blank`);
    const capture = await socket.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, clip });
    const png = Buffer.from(capture.data, 'base64');
    assert.ok(png.byteLength > 1000, `frame ${frameIndex} screenshot was blank`);
    const hash = createHash('sha256').update(png).digest('hex');
    if (frameHashes.length) assert.notEqual(hash, frameHashes.at(-1), `frame ${frameIndex} repeated the cached prior image`);
    frameHashes.push(hash);
    await writeFrame(ffmpeg, png);
    const compact = {
      frameIndex,
      preRollSteps: frame.preRollSteps,
      firstCapturedSimulationStep: frame.firstCapturedSimulationStep,
      role: frame.role,
      forcingPhase: frame.forcingPhase,
      simulationStep: frame.simulationStep,
      sourceStepIdentity: frame.sourceStepIdentity,
      sourceStepDelta: frame.sourceStepDelta,
      deterministicNowMs: frame.deterministicNowMs,
      deterministicClockAuthority: frame.deterministicClockAuthority,
      appliedCueFrameId: frame.appliedCueFrameId,
      appliedCueAuthority: frame.appliedCueAuthority,
      appliedCueReceiver: frame.appliedCueReceiver,
      generatedCueFrameId: frame.generatedCueFrameId,
      generatedForNextSimulationStep: frame.generatedForNextSimulationStep,
      learnedCueProjectionIdentity: frame.learnedCueProjectionIdentity,
      learnedFlowActivityModelIdentity: frame.learnedFlowActivityModelIdentity,
      learnedFlowActivityModelSha256: frame.learnedFlowActivityModelSha256,
      learnedCueDiagnosticStats: frame.learnedCueDiagnosticStats,
      forceActive: frame.forceActive,
      renderViewIdentity: frame.renderViewIdentity,
      requestedFlowDebug: frame.requestedFlowDebug,
      effectiveFlowDebug: frame.effectiveFlowDebug,
      requestedBackend: frame.requestedBackend,
      effectiveBackend: frame.effectiveBackend,
      requestedRoute: frame.requestedRoute,
      effectiveRoute: frame.effectiveRoute,
      requestedTransferRouteId: frame.requestedTransferRouteId,
      effectiveTransferRouteId: frame.effectiveTransferRouteId,
      modelIdentity: frame.modelIdentity,
      modelSha256: frame.modelSha256,
      nativeStepMs: frame.nativeStepMs,
      inferenceGpuMs: frame.inferenceGpuMs,
      cueProjectionGpuMs: frame.cueProjectionGpuMs,
      endToEndFrameMs: frame.endToEndFrameMs,
      presentedFrameSha256: hash,
    };
    frames.push(compact);
    previousSimulationStep = frame.simulationStep;
    lastTrustworthyEvidence = { capturedFrameCount: frames.length, lastFrame: compact };
    if ((frameIndex + 1) % 10 === 0 || frameIndex + 1 === requestedFrameCount) {
      console.log(JSON.stringify({ role, capturedFrameCount: frameIndex + 1, simulationStep: frame.simulationStep, forcingPhase: frame.forcingPhase }));
    }
  }

  failurePhase = 'video-encode';
  ffmpeg.stdin.end();
  const encoded = await ffmpeg.done;
  ffmpeg = null;
  assert.equal(encoded.code, 0, `ffmpeg failed: ${encoded.stderr}`);
  assert.ok(existsSync(out) && readFileSync(out).byteLength > 0, 'encoded motion artifact is missing or blank');

  failurePhase = null;
  const finalState = await evaluate('window.__kaminosNative64CausalCueFeedback.debugState()');
  writeReport({
    schema: SCHEMA,
    identity: IDENTITY,
    status: 'passed',
    role,
    sequenceAuthority: SEQUENCE_AUTHORITY,
    requestedFrameCount,
    capturedFrameCount: frames.length,
    preRollSteps,
    firstCapturedSimulationStep,
    playbackFps,
    requestedFlowDebug,
    effectiveFlowDebug: frames.at(-1)?.effectiveFlowDebug ?? null,
    requestedBackend: finalState.requestedBackend,
    effectiveBackend: finalState.effectiveBackend,
    requestedRoute: finalState.requestedRoute,
    effectiveRoute: finalState.effectiveRoute,
    runtimeTruthAvailable: false,
    syntheticDownsampleApplied: false,
    blankFrameRejection: { passed: true, minimumPngBytes: 1000 },
    cachedFrameRejection: { passed: true, distinctFrameCount: new Set(frameHashes).size },
    artifact: artifact(out),
    frames,
    failurePhase: null,
    lastTrustworthyEvidence,
  });
  console.log(JSON.stringify({ status: 'passed', role, out, report: reportPath, frameCount: frames.length }));
} catch (error) {
  if (ffmpeg) {
    ffmpeg.stdin.destroy();
    ffmpeg.kill('SIGTERM');
  }
  writeReport({
    schema: SCHEMA,
    identity: IDENTITY,
    status: 'failed',
    role,
    requestedFrameCount,
    capturedFrameCount: frames.length,
    preRollSteps,
    requestedFlowDebug,
    effectiveFlowDebug: frames.at(-1)?.effectiveFlowDebug ?? null,
    firstCapturedSimulationStep,
    requestedBackend: 'WebGPU',
    effectiveBackend: frames.at(-1)?.effectiveBackend || null,
    requestedRoute: 'native64-causal-cue-feedback-operator-v0',
    effectiveRoute: frames.at(-1)?.effectiveRoute || null,
    blankFrameRejection: { passed: false },
    cachedFrameRejection: { passed: false, distinctFrameCount: new Set(frameHashes).size },
    failurePhase,
    error: error?.stack || error?.message || String(error),
    lastTrustworthyEvidence,
    frames,
  });
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
} finally {
  socket?.close();
  browser?.kill('SIGTERM');
}

function validateFrame(frame, frameIndex, previousSimulationStep) {
  assert.equal(frame?.ok, true, `frame ${frameIndex} failed`);
  assert.equal(frame.role, role, `frame ${frameIndex} role mismatch`);
  assert.equal(frame.nativeGrid, 64, `frame ${frameIndex} grid mismatch`);
  assert.equal(frame.sourceStepDelta, 1, `frame ${frameIndex} skipped or repeated a simulation step`);
  assert.equal(frame.preRollSteps, preRollSteps, `frame ${frameIndex} pre-roll length mismatch`);
  assert.equal(frame.firstCapturedSimulationStep, firstCapturedSimulationStep, `frame ${frameIndex} first captured step mismatch`);
  if (frameIndex === 0) assert.equal(frame.simulationStep, firstCapturedSimulationStep, 'capture did not begin immediately after pre-roll');
  assert.equal(frame.deterministicClockAuthority, 'causal-deterministic-step-clock-v0', `frame ${frameIndex} used wall-clock simulation phase`);
  assert.ok(Math.abs(frame.deterministicNowMs - ((preRollSteps + frameIndex + 1) * (1000 / 30))) < 0.0001, `frame ${frameIndex} deterministic phase time mismatch`);
  assert.equal(frame.runtimeTruthAvailable, false, `frame ${frameIndex} exposed runtime truth`);
  assert.equal(frame.syntheticDownsampleApplied, false, `frame ${frameIndex} used synthetic downsampling`);
  assert.equal(frame.renderViewIdentity, 'causal-render-view-identity-v0', `frame ${frameIndex} render-view identity mismatch`);
  assert.equal(frame.requestedFlowDebug, requestedFlowDebug, `frame ${frameIndex} requested flow-debug mismatch`);
  assert.equal(frame.effectiveFlowDebug, requestedFlowDebug, `frame ${frameIndex} effective flow-debug drift`);
  assert.equal(frame.requestedBackend, 'WebGPU', `frame ${frameIndex} requested wrong backend`);
  assert.match(String(frame.effectiveBackend), /^WebGPU/, `frame ${frameIndex} fell back from WebGPU`);
  assert.equal(frame.fallbackBackend, null, `frame ${frameIndex} reported fallback backend`);
  assert.equal(frame.requestedTransferRouteId, 'native-low-transfer-160-to-96-deployment-grid-v0', `frame ${frameIndex} used wrong model route`);
  assert.equal(frame.modelSha256, 'baa54236f04c28eab278cf60e4a60745cd3c0160a985a9adbb1e06db7958f6e8', `frame ${frameIndex} model checksum mismatch`);
  if (previousSimulationStep !== null) {
    assert.equal(frame.simulationStep, previousSimulationStep + 1, `frame ${frameIndex} was not consecutive`);
  }
  if (frame.generatedCueFrameId) {
    assert.equal(frame.generatedForNextSimulationStep, frame.simulationStep + 1, `frame ${frameIndex} cue timing mismatch`);
    assert.equal(frame.learnedCueProjectionIdentity, 'native-low-learned-flow-activity-head-projection-v0', `frame ${frameIndex} learned cue projection mismatch`);
    assert.equal(frame.learnedFlowActivityModelIdentity, 'exact-basin-derived-flow-activity-head-160-to-96-v0', `frame ${frameIndex} learned activity model mismatch`);
    assert.equal(frame.learnedFlowActivityModelSha256, '34aff071fac1375f6ae44d38ad8047162593f4be0bed9671b18bd438e723274b', `frame ${frameIndex} learned activity model checksum mismatch`);
  }
  if (frame.forcingPhase === 'release' || frame.forcingPhase === 'off' || frame.forcingPhase === 'priming') {
    assert.equal(frame.forceActive, false, `frame ${frameIndex} forced during ${frame.forcingPhase}`);
  }
  if (frame.forceActive) {
    assert.ok(frame.appliedCueReceiver?.enabled > 0, `frame ${frameIndex} claimed forcing with a disabled receiver`);
    assert.ok(frame.appliedCueReceiver?.curlNoiseGain > 0 || frame.appliedCueReceiver?.vorticityGain > 0, `frame ${frameIndex} claimed forcing with zero effective gains`);
  }
}

function startEncoder() {
  const child = spawn('ffmpeg', [
    '-y', '-v', 'error', '-f', 'image2pipe', '-framerate', String(playbackFps), '-vcodec', 'png', '-i', '-',
    '-an', '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2', '-c:v', 'libx264', '-preset', 'fast', '-crf', '16',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out,
  ], { stdio: ['pipe', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.done = new Promise(resolveDone => child.once('close', code => resolveDone({ code, stderr })));
  return child;
}

async function writeFrame(child, bytes) {
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
  const candidates = [process.env.CHROME_BIN, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary', '/Applications/Chromium.app/Contents/MacOS/Chromium'].filter(Boolean);
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

async function evaluate(expression) {
  const result = await socket.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'browser evaluation failed');
  return result.result?.value;
}

function writeReport(value) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(value, null, 2)}\n`);
}

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}
