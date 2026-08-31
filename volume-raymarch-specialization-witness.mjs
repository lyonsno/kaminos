#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash, randomInt } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import {
  EXPECTED_RAYMARCH_COMPOSITION,
  EXPECTED_RAYMARCH_RENDERER_ROUTE,
  EXPECTED_RAYMARCH_WRAPPER_ROUTE,
  assertSpecializationSampleRoute,
  createEvidenceSourceManifest,
  runtimeAdmissionAccepted,
} from './volume-raymarch-specialization-evidence.mjs';

const SCHEMA = 'kaminos.volume.raymarch-specialization-witness.v0';
const args = parseArgs(process.argv.slice(2));
const outDir = resolve(String(args.get('--out-dir') || '/tmp/kaminos-raymarch-specialization-witness'));
const reportPath = resolve(String(args.get('--report') || join(outDir, 'report.json')));
let requestedUrl = null;
let expectedRole = null;
let timeoutMs = null;
let sampleCount = null;
let port = null;
let sourceCommit = null;
let sourceTreeStatus = null;
let sourceDiffSha256 = null;
let sourceManifest = null;
let userDataDir = null;
let browser = null;
let socket = null;
let failurePhase = 'argument-validation';
let lastTrustworthyEvidence = null;

class CdpSocket {
  constructor(url, deadlineMs) {
    this.url = url;
    this.deadlineMs = deadlineMs;
    this.socket = null;
    this.nextId = 1;
    this.pending = new Map();
    this.browserEvents = [];
  }

  open() {
    return new Promise((resolveOpen, rejectOpen) => {
      this.socket = new WebSocket(this.url);
      this.socket.addEventListener('open', resolveOpen, { once: true });
      this.socket.addEventListener('error', rejectOpen, { once: true });
      this.socket.addEventListener('close', () => this.rejectPending(new Error('CDP socket closed')));
      this.socket.addEventListener('message', event => {
        const message = JSON.parse(event.data);
        if (!message.id) {
          if (message.method === 'Runtime.exceptionThrown' || message.method === 'Runtime.consoleAPICalled') {
            this.browserEvents.push(message);
          }
          return;
        }
        const pending = this.pending.get(message.id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
      });
    });
  }

  call(method, params = {}) {
    return new Promise((resolveCall, rejectCall) => {
      const remainingMs = Math.max(1, this.deadlineMs - Date.now());
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectCall(new Error(`caller deadline expired during CDP call ${method}`));
      }, remainingMs);
      this.pending.set(id, { resolve: resolveCall, reject: rejectCall, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  rejectPending(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  close() { this.socket?.close(); }
}

try {
  requestedUrl = required('--url');
  expectedRole = new URL(requestedUrl).searchParams.get('role');
  if (!expectedRole) throw new Error('missing role query in --url');
  timeoutMs = positiveNumber('--timeout-ms', 240000);
  sampleCount = Math.max(1, Math.floor(positiveNumber('--samples', 3)));
  port = Number(args.get('--debug-port') || randomInt(42000, 62000));
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('invalid --debug-port');

  failurePhase = 'source-provenance';
  sourceCommit = gitOutput(['rev-parse', 'HEAD']);
  sourceTreeStatus = gitOutput(['status', '--short']);
  sourceDiffSha256 = createHash('sha256').update(gitOutput(['diff', '--binary', 'HEAD'])).digest('hex');
  sourceManifest = createEvidenceSourceManifest({
    root: process.cwd(),
    excludedPaths: [outDir, reportPath],
  });

  failurePhase = 'profile-creation';
  const profileRoot = process.env.KAMINOS_RAYMARCH_WITNESS_PROFILE_ROOT || tmpdir();
  userDataDir = mkdtempSync(join(profileRoot, 'kaminos-raymarch-specialization-profile-'));

  mkdirSync(outDir, { recursive: true });
  mkdirSync(dirname(reportPath), { recursive: true });
  const callerDeadlineMs = Date.now() + timeoutMs;
  failurePhase = 'browser-launch';
  browser = spawn(chromeExecutable(), [
    '--headless=new',
    '--enable-unsafe-webgpu',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--window-size=1620,760',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ], { stdio: 'ignore' });
  const target = await waitForTarget(port, callerDeadlineMs);
  socket = new CdpSocket(target.webSocketDebuggerUrl, callerDeadlineMs);
  await socket.open();
  await socket.call('Page.enable');
  await socket.call('Runtime.enable');
  await socket.call('Page.navigate', { url: requestedUrl });

  failurePhase = 'runtime-admission';
  const admitted = await waitForRuntime(callerDeadlineMs);
  lastTrustworthyEvidence = { phase: failurePhase, admitted };

  failurePhase = 'frozen-full-versus-lean-capture';
  const evidence = await evaluate(`(async () => {
    const basinWindow = document.querySelector('#basin')?.contentWindow || window;
    const prototype = basinWindow.__kaminosVolumePrototype;
    if (!prototype) throw new Error('missing volume prototype');
    const digest = async value => {
      const bytes = new TextEncoder().encode(JSON.stringify(value));
      const hash = await crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
    };
    const pngDataUrl = image => {
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d');
      context.putImageData(new ImageData(new Uint8ClampedArray(image.rgba), image.width, image.height), 0, 0);
      return canvas.toDataURL('image/png');
    };
    const metrics = rgba => {
      let litChannels = 0;
      let alphaPixels = 0;
      for (let index = 0; index < rgba.length; index += 4) {
        if (rgba[index] + rgba[index + 1] + rgba[index + 2] > 12) litChannels += 1;
        if (rgba[index + 3] > 0) alphaPixels += 1;
      }
      return { nonblank: litChannels > 64 && alphaPixels > 64, litPixels: litChannels, alphaPixels };
    };
    const pixelDelta = (a, b) => {
      if (a.length !== b.length) throw new Error('pixel-length-mismatch');
      let maxChannelDelta = 0;
      let sum = 0;
      let changedPixels = 0;
      for (let index = 0; index < a.length; index += 4) {
        let changed = false;
        for (let channel = 0; channel < 4; channel += 1) {
          const delta = Math.abs(a[index + channel] - b[index + channel]);
          maxChannelDelta = Math.max(maxChannelDelta, delta);
          sum += delta;
          changed ||= delta !== 0;
        }
        changedPixels += changed ? 1 : 0;
      }
      return {
        maxChannelDelta,
        meanAbsChannelDelta: sum / Math.max(1, a.length),
        changedPixelRatio: changedPixels / Math.max(1, a.length / 4),
      };
    };
    prototype.setSelectiveHeadLiveCapturePaused(true);
    prototype.setControls({
      lookFreeze: 1,
      fireRenderMode: 'stock',
      pyroFireMode: 'stock',
      pyroCompareMode: 'base',
    });
    prototype.setVolumePresentationMode('beauty');
    prototype.setRaymarchSmokePresentationMode('on');
    prototype.setAppearanceDecompositionMode('off');
    prototype.setSelectiveHeadLiveRenderComposition('raymarch-only-v0');
    prototype.setDebugRaymarchShaderSpecialization('force-full');
    const untimedFreezeWarmup = await prototype.captureSelectiveHeadLiveFrame({
      advanceSim: false,
      presentToCanvas: false,
      collectGpuTiming: false,
      presentationArm: 'freeze-warmup',
      frameIndex: 0,
      startNow: 1000,
      stepDeltaMs: 0,
    });
    if (!untimedFreezeWarmup?.ok) {
      throw new Error('untimed-freeze-warmup-failed:' + (untimedFreezeWarmup?.reason || 'unknown'));
    }
    const before = prototype.debugState();
    const sameStateIdentity = {
      simStepCount: before.simStepCount,
      controlsHash: await digest(before.controls),
      cameraHash: await digest(basinWindow.kaminosCameraDebugState?.() || null),
      renderPhaseTimeMs: before.lookFreezeRenderTimeMs,
      renderPhaseFrame: before.lookFreezeRenderFrame,
    };
    const samples = { full: [], lean: [] };
    let fullPixels = null;
    let leanPixels = null;
    const captureArm = async (arm, index) => {
      prototype.setDebugRaymarchShaderSpecialization(arm === 'full' ? 'force-full' : 'auto');
      const capture = await prototype.captureSelectiveHeadLiveFrame({
        advanceSim: false,
        presentToCanvas: false,
        collectGpuTiming: true,
        presentationArm: arm,
        frameIndex: 0,
        startNow: 1000,
        stepDeltaMs: 0,
      });
      if (!capture?.ok) throw new Error(arm + '-capture-failed:' + (capture?.reason || 'unknown'));
      const wrapperState = window.__kaminosSelectiveHeadLive?.debugState?.() || null;
      const rgba = capture.rgba;
      const compact = {
        arm,
        index,
        simStepCount: capture.simStepCount,
        beforeSimStepCount: capture.beforeSimStepCount,
        renderPhaseTimeMs: capture.renderPhaseTimeMs,
        renderPhaseFrame: capture.renderPhaseFrame,
        imageAuthority: capture.imageAuthority,
        pixelHash: await digest(rgba),
        metrics: metrics(rgba),
        raymarchShaderSpecialization: capture.raymarchShaderSpecialization,
        gpuStageTiming: capture.gpuStageTiming,
        selectiveHeadLivePassReceipt: capture.selectiveHeadLivePassReceipt,
        effectiveRoute: capture.effectiveRoute,
        backend: capture.backend,
        requestedRole: capture.requestedRole,
        effectiveRole: capture.effectiveRole,
        roleAuthority: capture.roleAuthority,
        fallbackReason: capture.fallbackReason,
        boundarySplatFallbackReason: capture.boundarySplatFallbackReason,
        wrapperRoute: wrapperState?.routeIdentity || null,
        wrapperStatus: wrapperState?.status || null,
        wrapperFallbackReason: wrapperState?.fallbackReason || null,
        wrapperEffectiveComposition: wrapperState?.effectiveComposition || null,
        pngDataUrl: index === 0 ? pngDataUrl({ width: capture.width, height: capture.height, rgba }) : null,
      };
      if (index === 0 && arm === 'full') fullPixels = rgba;
      if (index === 0 && arm === 'lean') leanPixels = rgba;
      samples[arm].push(compact);
    };
    for (let index = 0; index < ${sampleCount}; index += 1) {
      await captureArm('full', index);
      await captureArm('lean', index);
    }
    const after = prototype.debugState();
    return {
      sameStateIdentity,
      afterStateIdentity: {
        simStepCount: after.simStepCount,
        controlsHash: await digest(after.controls),
        cameraHash: await digest(basinWindow.kaminosCameraDebugState?.() || null),
        renderPhaseTimeMs: after.renderPhaseTimeMs,
        renderPhaseFrame: after.renderPhaseFrame,
      },
      compositionContract: {
        identity: 'raymarch-only-v0',
        raymarchApplied: samples.lean[0].selectiveHeadLivePassReceipt?.raymarchApplied,
        splatApplied: samples.lean[0].selectiveHeadLivePassReceipt?.splatApplied,
      },
      samples,
      pixelDelta: pixelDelta(fullPixels, leanPixels),
    };
  })()`);
  lastTrustworthyEvidence = { phase: failurePhase, admitted, evidence: stripPngData(evidence) };
  assertSameState(evidence);
  assert.equal(evidence.compositionContract.identity, 'raymarch-only-v0', 'wrong render composition');
  assert.equal(evidence.compositionContract.raymarchApplied, true, 'raymarch pass absent');
  assert.equal(evidence.compositionContract.splatApplied, false, 'splat pass contaminated comparison');
  assert.equal(evidence.pixelDelta.maxChannelDelta, 0, 'lean specialization changed pixels');
  for (const sample of evidence.samples.full) validateSample(sample, 'full');
  for (const sample of evidence.samples.lean) validateSample(sample, 'lean');

  failurePhase = 'artifact-write';
  const fullPath = join(outDir, 'full-authored-raymarch.png');
  const leanPath = join(outDir, 'lean-stock-direct-cell-raymarch.png');
  writePngDataUrl(fullPath, evidence.samples.full[0].pngDataUrl);
  writePngDataUrl(leanPath, evidence.samples.lean[0].pngDataUrl);
  const effectiveUrl = await evaluate('location.href');
  const report = {
    schema: SCHEMA,
    status: 'captured',
    failurePhase: null,
    requestedUrl,
    expectedRuntime: {
      wrapperRoute: EXPECTED_RAYMARCH_WRAPPER_ROUTE,
      rendererRoute: EXPECTED_RAYMARCH_RENDERER_ROUTE,
      composition: EXPECTED_RAYMARCH_COMPOSITION,
      backendClass: 'WebGPU',
      requestedRole: expectedRole,
      roleAuthority: admitted.roleAuthority,
      fallbackReason: null,
    },
    effectiveUrl,
    effectiveRoute: admitted.wrapperRoute,
    rendererRoute: admitted.effectiveRoute,
    backend: admitted.backend,
    sourceCommit,
    sourceTreeStatus,
    sourceDiffSha256,
    sourceManifest,
    sampleCount,
    sameStateIdentity: evidence.sameStateIdentity,
    compositionContract: evidence.compositionContract,
    arms: {
      full: summarizeArm(evidence.samples.full),
      lean: summarizeArm(evidence.samples.lean),
    },
    pixelDelta: evidence.pixelDelta,
    browserEvents: summarizeBrowserEvents(socket.browserEvents),
    artifacts: {
      full: artifact(fullPath),
      lean: artifact(leanPath),
    },
  };
  assertNoBrowserErrors(report.browserEvents);
  writeReport(report);
  console.log(JSON.stringify({ ok: true, report: reportPath, artifacts: report.artifacts, arms: report.arms, pixelDelta: report.pixelDelta }, null, 2));
} catch (error) {
  const failureReport = {
    schema: SCHEMA,
    status: 'failed',
    failurePhase,
    error: error?.stack || error?.message || String(error),
    requestedUrl,
    expectedRuntime: {
      wrapperRoute: EXPECTED_RAYMARCH_WRAPPER_ROUTE,
      rendererRoute: EXPECTED_RAYMARCH_RENDERER_ROUTE,
      composition: EXPECTED_RAYMARCH_COMPOSITION,
      backendClass: 'WebGPU',
      requestedRole: expectedRole,
      roleAuthority: lastTrustworthyEvidence?.admitted?.roleAuthority || null,
      fallbackReason: null,
    },
    sourceCommit,
    sourceTreeStatus,
    sourceDiffSha256,
    sourceManifest,
    lastTrustworthyEvidence,
    browserEvents: summarizeBrowserEvents(socket?.browserEvents || []),
  };
  const durableReportWritten = writeReportSafely(failureReport);
  console.error(JSON.stringify({
    ok: false,
    report: durableReportWritten ? reportPath : null,
    intendedReport: reportPath,
    durableReportWritten,
    failurePhase,
    error: error?.message || String(error),
  }, null, 2));
  process.exitCode = 1;
} finally {
  try { socket?.close(); } catch {}
  if (browser?.exitCode === null) browser.kill('SIGTERM');
  if (userDataDir) rmSync(userDataDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}

function parseArgs(argv) {
  const parsed = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    const next = argv[index + 1];
    parsed.set(key, next && !next.startsWith('--') ? next : true);
    if (next && !next.startsWith('--')) index += 1;
  }
  return parsed;
}

function required(name) {
  const value = args.get(name);
  if (!value || value === true) throw new Error(`missing ${name}`);
  return String(value);
}

function positiveNumber(name, fallback) {
  const value = Number(args.get(name) || fallback);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`invalid ${name}`);
  return value;
}

function gitOutput(argv) {
  return execFileSync('git', argv, { encoding: 'utf8' }).trim();
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

async function waitForTarget(port, deadlineMs) {
  while (Date.now() < deadlineMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const target = targets.find(candidate => candidate.type === 'page' && !String(candidate.url || '').startsWith('chrome-extension://'));
      if (target?.webSocketDebuggerUrl) return target;
    } catch {}
    await delay(100);
  }
  throw new Error('caller deadline expired waiting for Chrome target');
}

async function waitForRuntime(deadlineMs) {
  let last = null;
  while (Date.now() < deadlineMs) {
    last = await evaluate(`(() => {
      const wrapper = window.__kaminosSelectiveHeadLive?.debugState?.() || null;
      const basinWindow = document.querySelector('#basin')?.contentWindow || window;
      const state = basinWindow.__kaminosVolumePrototype?.debugState?.() || null;
      return state ? {
        wrapperRoute: wrapper?.routeIdentity || null,
        wrapperStatus: wrapper?.status || null,
        wrapperError: wrapper?.error || null,
        wrapperFallbackReason: wrapper?.fallbackReason || null,
        effectiveComposition: wrapper?.effectiveComposition || null,
        active: state.active,
        error: state.error,
        effectiveRoute: state.effectiveRoute,
        rendererFallbackReason: state.fallbackReason || null,
        backend: state.backend,
        requestedRole: wrapper?.requestedRole || null,
        effectiveRole: wrapper?.effectiveRole || null,
        roleAuthority: wrapper?.roleAuthority || null,
        frameCount: state.frameCount,
        simStepCount: state.simStepCount,
      } : null;
    })()`);
    const events = summarizeBrowserEvents(socket.browserEvents);
    assertNoBrowserErrors(events);
    if (last?.wrapperError) throw new Error(`selective loader failed: ${last.wrapperError}`);
    if (last?.error) throw new Error(`runtime failed: ${last.error}`);
    if (runtimeAdmissionAccepted(last, { requestedRole: expectedRole })) return last;
    await delay(250);
  }
  throw new Error(`caller deadline expired waiting for WebGPU runtime: ${JSON.stringify(last)}`);
}

async function evaluate(expression) {
  const result = await socket.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) {
    const detail = result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'runtime evaluation failed';
    throw new Error(`${detail}\nExpression: ${expression.slice(0, 300)}`);
  }
  return result.result.value;
}

function assertSameState(evidence) {
  const before = evidence.sameStateIdentity;
  const after = evidence.afterStateIdentity;
  assert.equal(after.simStepCount, before.simStepCount, 'comparison advanced simulation state');
  assert.equal(after.controlsHash, before.controlsHash, 'comparison mutated authored controls');
  assert.equal(after.cameraHash, before.cameraHash, 'comparison mutated camera');
  assert.equal(after.renderPhaseTimeMs, before.renderPhaseTimeMs, 'comparison changed frozen render time');
  assert.equal(after.renderPhaseFrame, before.renderPhaseFrame, 'comparison changed frozen render frame');
}

function validateSample(sample, arm) {
  assertSpecializationSampleRoute(sample, arm, lastTrustworthyEvidence?.admitted);
  assert.equal(sample.metrics.nonblank, true, `${arm} pixels were blank`);
  assert.ok(sample.pixelHash, `${arm} pixelHash missing`);
  assert.equal(sample.selectiveHeadLivePassReceipt?.raymarchApplied, true, `${arm} raymarch pass absent`);
  assert.equal(sample.selectiveHeadLivePassReceipt?.splatApplied, false, `${arm} splat pass present`);
  const specialization = sample.raymarchShaderSpecialization;
  assert.equal(specialization?.eligible, true, `${arm} specialization admission refused: ${specialization?.refusalReasons?.join(',')}`);
  assert.deepEqual(specialization?.refusalReasons, [], `${arm} specialization had refusal reasons`);
  assert.equal(specialization?.effective, arm === 'lean' ? 'lean-stock-direct-cell-raymarch-v0' : 'full-authored-raymarch-v0', `${arm} effective specialization drift`);
  assert.equal(specialization?.debugOverride, arm === 'lean' ? 'auto' : 'force-full', `${arm} debug selection drift`);
  const timing = sample.gpuStageTiming?.stages?.matchedRaymarchRaster;
  assert.equal(timing?.status, 'sampled', `${arm} raymarch timing unavailable`);
  assert.ok(Number.isFinite(timing?.ms) && timing.ms > 0, `${arm} raymarch timing invalid`);
}

function summarizeArm(samples) {
  const timings = samples.map(sample => sample.gpuStageTiming.stages.matchedRaymarchRaster.ms);
  const sorted = [...timings].sort((a, b) => a - b);
  return {
    specialization: samples[0].raymarchShaderSpecialization,
    pixelHash: samples[0].pixelHash,
    nonblank: samples[0].metrics.nonblank,
    matchedRaymarchRasterMs: timings,
    medianMatchedRaymarchRasterMs: sorted[Math.floor(sorted.length / 2)],
    sampleRuntimeIdentities: samples.map(sample => ({
      index: sample.index,
      effectiveRoute: sample.effectiveRoute,
      backend: sample.backend,
      requestedRole: sample.requestedRole,
      effectiveRole: sample.effectiveRole,
      roleAuthority: sample.roleAuthority,
      fallbackReason: sample.fallbackReason,
      boundarySplatFallbackReason: sample.boundarySplatFallbackReason,
      wrapperRoute: sample.wrapperRoute,
      wrapperStatus: sample.wrapperStatus,
      wrapperFallbackReason: sample.wrapperFallbackReason,
      wrapperEffectiveComposition: sample.wrapperEffectiveComposition,
      composition: sample.selectiveHeadLivePassReceipt?.composition || null,
      compositionFallbackReason: sample.selectiveHeadLivePassReceipt?.fallbackReason || null,
    })),
  };
}

function stripPngData(evidence) {
  if (!evidence?.samples) return evidence;
  return {
    ...evidence,
    samples: Object.fromEntries(Object.entries(evidence.samples).map(([arm, samples]) => [
      arm,
      samples.map(({ pngDataUrl, ...sample }) => sample),
    ])),
  };
}

function writePngDataUrl(path, value) {
  const match = /^data:image\/png;base64,(.+)$/.exec(String(value || ''));
  if (!match) throw new Error(`missing PNG output for ${path}`);
  const bytes = Buffer.from(match[1], 'base64');
  if (bytes.byteLength < 1000) throw new Error(`partial or blank PNG output for ${path}`);
  writeFileSync(path, bytes);
}

function artifact(path) {
  const bytes = readFileSync(path);
  return { path, byteLength: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') };
}

function summarizeBrowserEvents(events) {
  return events.map(event => ({
    method: event.method,
    type: event.params?.type || null,
    text: event.params?.exceptionDetails?.exception?.description
      || event.params?.exceptionDetails?.text
      || event.params?.args?.map(arg => arg.value || arg.description).filter(Boolean).join(' ')
      || null,
  }));
}

function assertNoBrowserErrors(events) {
  const exception = events.find(event => event.method === 'Runtime.exceptionThrown');
  if (exception) throw new Error(`browser exception: ${exception.text}`);
  const consoleError = events.find(event => event.method === 'Runtime.consoleAPICalled' && event.type === 'error');
  if (consoleError) throw new Error(`browser console error: ${consoleError.text}`);
}

function writeReport(report) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

function writeReportSafely(report) {
  try {
    writeReport(report);
    return true;
  } catch (reportError) {
    console.error(JSON.stringify({
      schema: SCHEMA,
      status: 'failed',
      failurePhase: 'report-write',
      originalFailurePhase: report.failurePhase,
      intendedReport: reportPath,
      reportWriteError: reportError?.message || String(reportError),
      lastTrustworthyEvidence: report.lastTrustworthyEvidence || null,
    }, null, 2));
    return false;
  }
}

function delay(ms) { return new Promise(resolveDelay => setTimeout(resolveDelay, ms)); }
