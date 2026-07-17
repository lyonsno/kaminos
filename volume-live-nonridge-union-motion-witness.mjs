#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomInt } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { inflateSync } from 'node:zlib';

const SCHEMA = 'kaminos.volume.live-nonridge-union-motion-witness.v0';
const EFFECTIVE_ROUTE = 'native-3d-compute-fluid-raymarch-v0';
const PROTOTYPE_IDENTITY = 'kaminos-volume-prototype-v0';
const MODE = 'kernel_moment_full_flame_union';
const RENDERER = 'live-ridge-nonridge-union-kernel-moment-covariance-splats-v0';
const SELECTOR = 'explicit-source-field-operator-v0';
const SELECTOR_SHA256 = '541836e6c45ef014ab0b8be23ebd8dce9898900a7639a0c4e21f38336daef8f9';
const SEQUENCE_AUTHORITY = 'fixed-camera-live-simulation-sequence-v0';
const VOLUME_PROTOTYPE_EXPRESSION = `(document.querySelector('#basin')?.contentWindow?.__kaminosVolumePrototype || window.__kaminosVolumePrototype)`;
const CAMERA = Object.freeze({
  position: [-2.9303392321261956, 0.345224002268194, 2.115477025708465],
  target: [0.010667493255923342, -0.0050203846009383, 0.1098700760228956],
});
const CONTROL_OVERRIDES = Object.freeze({
  boundarySplatMode: MODE,
  flowKernelStrength: 1,
  flowKernelRadius: 0.03,
  flowKernelCoherence: 1,
  boundarySplatRadianceGain: 2,
  boundarySplatOpacityGain: 2,
});

const args = parseArgs(process.argv.slice(2));
const requestedUrl = required('--url');
const outDir = resolve(String(args.get('--out-dir') || '/tmp/kaminos-live-nonridge-union-motion-witness'));
const reportPath = resolve(String(args.get('--report') || join(outDir, 'motion-report.json')));
const timeoutMs = Math.max(1000, Number(args.get('--timeout-ms') || 360000));
const settleMs = Math.max(0, Number(args.get('--settle-ms') || 1800));
const frameCount = Math.max(3, Math.floor(Number(args.get('--frames') || 16)));
const stepMs = Math.max(1, Number(args.get('--step-ms') || 1000 / 30));
const debugPort = Number(args.get('--debug-port') || randomInt(42000, 62000));
const viewportWidth = Math.max(320, Math.floor(Number(args.get('--viewport-width') || 1280)));
const viewportHeight = Math.max(240, Math.floor(Number(args.get('--viewport-height') || 960)));
const userDataDir = resolve(String(args.get('--user-data-dir') || mkdtempSync(join(tmpdir(), 'kaminos-live-union-motion-profile-'))));

let browser = null;
let socket = null;
let failurePhase = 'argument-validation';
let lastTrustworthyEvidence = {};
const partialFrames = [];

class CdpSocket {
  constructor(url, timeout) {
    this.url = url;
    this.timeout = timeout;
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
          if (['Runtime.exceptionThrown', 'Runtime.consoleAPICalled', 'Log.entryAdded'].includes(message.method)) {
            this.browserEvents.push(message);
          }
          return;
        }
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
      });
    });
  }

  call(method, params = {}) {
    return new Promise((resolveCall, rejectCall) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectCall(new Error(`CDP call timed out: ${method}`));
      }, this.timeout);
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

  close() {
    this.socket?.close();
  }
}

mkdirSync(outDir, { recursive: true });
mkdirSync(dirname(reportPath), { recursive: true });

try {
  const route = new URL(requestedUrl);
  assert.ok(['http:', 'https:'].includes(route.protocol), 'witness URL must be HTTP(S)');

  failurePhase = 'single-cdp-browser-launch';
  browser = spawn(chromeExecutable(), [
    '--headless=new',
    '--enable-unsafe-webgpu',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    `--window-size=${viewportWidth},${viewportHeight}`,
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ], { stdio: 'ignore' });

  const target = await waitForTarget(debugPort, timeoutMs);
  socket = new CdpSocket(target.webSocketDebuggerUrl, timeoutMs);
  await socket.open();
  await socket.call('Page.enable');
  await socket.call('Runtime.enable');
  await socket.call('Log.enable');
  await socket.call('Emulation.setDeviceMetricsOverride', {
    width: viewportWidth,
    height: viewportHeight,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await socket.call('Page.navigate', { url: requestedUrl });

  failurePhase = 'route-admission';
  const admission = await waitForRuntime(socket, timeoutMs);
  assert.equal(admission.active, true, 'volume renderer did not become active');
  assert.equal(admission.effectiveRoute, EFFECTIVE_ROUTE, 'effective renderer route drifted');
  assert.equal(admission.prototypeIdentity, PROTOTYPE_IDENTITY, 'volume prototype identity drifted');
  assert.ok(String(admission.backend).startsWith('WebGPU'), 'effective backend substituted away from WebGPU');
  lastTrustworthyEvidence = { admission };
  await delay(settleMs);

  failurePhase = 'fixed-camera-and-presentation';
  const presentation = await evaluate(socket, `(async () => {
    const basinWindow = document.querySelector('#basin')?.contentWindow || window;
    const prototype = ${VOLUME_PROTOTYPE_EXPRESSION};
    const operator = window.__kaminosSelectiveHeadLive || null;
    const setPose = basinWindow.kaminosSetCameraDebugPose || window.kaminosSetCameraDebugPose;
    if (typeof setPose !== 'function') throw new Error('camera-debug-pose-api-missing');
    operator?.setCapturePaused?.(true);
    operator?.setPresentation?.('beauty');
    operator?.setComposition?.('splat-only-v0');
    prototype.setSelectiveHeadLiveCapturePaused?.(true);
    prototype.setRaymarchSmokePresentationMode?.('off');
    prototype.setVolumePresentationMode?.('beauty');
    const camera = setPose(${JSON.stringify(CAMERA)});
    const state = prototype.debugState();
    return { camera, state: compactStateForMotion(state) };
    function compactStateForMotion(state) {
      return {
        active: state.active,
        backend: state.backend,
        effectiveRoute: state.effectiveRoute,
        prototypeIdentity: state.prototypeIdentity,
        simGrid: state.simGrid,
        frameCount: state.frameCount,
        simStepCount: state.simStepCount,
        controls: state.controls,
      };
    }
  })()`);
  assert.deepEqual(presentation.camera.position, CAMERA.position, 'fixed camera position drifted');
  assert.deepEqual(presentation.camera.target, CAMERA.target, 'fixed camera target drifted');
  lastTrustworthyEvidence = { admission, presentation };

  failurePhase = 'fixed-camera-live-sequence';
  let sameBrowserSessionId = null;
  let sequenceStartNowMs = null;
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const advanceSim = frameIndex > 0;
    const controlled = await evaluate(socket, `${VOLUME_PROTOTYPE_EXPRESSION}.controlledStepFrame(${JSON.stringify({
      controlledStepFrameIndex: '__FRAME_INDEX__',
      advanceSim: '__ADVANCE_SIM__',
      sameBrowserSessionId: '__SESSION_ID__',
      startNow: '__START_NOW__',
      stepDeltaMs: stepMs,
      renderScales: [1],
      includeRgba: false,
      compactSamples: true,
      resumeRenderLoop: false,
    })})`
      .replace('"__FRAME_INDEX__"', String(frameIndex))
      .replace('"__ADVANCE_SIM__"', advanceSim ? 'true' : 'false')
      .replace('"__SESSION_ID__"', sameBrowserSessionId ? JSON.stringify(sameBrowserSessionId) : 'null')
      .replace('"__START_NOW__"', sequenceStartNowMs === null ? 'null' : String(sequenceStartNowMs)));
    if (controlled?.ok !== true || controlled.sequenceAuthority !== 'controlled-step-sequence-v0') {
      throw new Error(`controlled-step-failed:${frameIndex}:${JSON.stringify(controlled)}`);
    }
    sameBrowserSessionId = controlled.sameBrowserSessionId;
    sequenceStartNowMs = controlled.sequenceStartNowMs;
    const scaleSet = controlled.scaleSet;
    const render = await evaluate(socket, `${VOLUME_PROTOTYPE_EXPRESSION}.renderFrozenScaleToCanvas(${JSON.stringify({
      boundarySplatComposition: 'splat-only-v0',
      controlOverrides: CONTROL_OVERRIDES,
      sameStateCaptureId: scaleSet.sameStateCaptureId,
      baseFrameCount: scaleSet.baseFrameCount,
      baseSimStepCount: scaleSet.baseSimStepCount,
      now: scaleSet.fixedNowMs,
      renderScale: 1,
      restoreControls: false,
      resumeRenderLoop: false,
    })})`);
    assert.equal(render?.ok, true, `full-support render failed at frame ${frameIndex}`);

    const state = await evaluate(socket, `(() => {
      const state = ${VOLUME_PROTOTYPE_EXPRESSION}.debugState();
      const controls = state.controls || {};
      return {
        active: state.active,
        backend: state.backend,
        effectiveRoute: state.effectiveRoute,
        frameCount: state.frameCount,
        simStepCount: state.simStepCount,
        boundarySplatMode: state.boundarySplatMode,
        boundarySplatRendererIdentity: state.boundarySplatRendererIdentity,
        boundarySplatFallbackReason: state.boundarySplatFallbackReason,
        candidateCount: state.boundarySplatCandidateCount,
        instanceCount: state.boundarySplatInstanceCount,
        overflowCount: state.boundarySplatOverflowCount,
        supportControlSnapshot: {
          reactionBoundarySupportThermal: controls.reactionBoundarySupportThermal,
          reactionBoundarySupportReaction: controls.reactionBoundarySupportReaction,
          reactionBoundarySupportFront: controls.reactionBoundarySupportFront,
          reactionBoundarySupportInterface: controls.reactionBoundarySupportInterface,
          reactionBoundaryGradient: controls.reactionBoundaryGradient,
          reactionBoundaryCut: controls.reactionBoundaryCut,
          reactionBoundarySoftness: controls.reactionBoundarySoftness,
          reactionBoundaryCoreReject: controls.reactionBoundaryCoreReject,
          reactionBoundaryTopology: controls.reactionBoundaryTopology,
          reactionBoundaryCurl: controls.reactionBoundaryCurl,
          reactionBoundaryDivergence: controls.reactionBoundaryDivergence,
          reactionBoundaryFireRidge: controls.reactionBoundaryFireRidge,
          reactionBoundaryFireRidgeCut: controls.reactionBoundaryFireRidgeCut,
        },
      };
    })()`);
    assert.equal(state.effectiveRoute, EFFECTIVE_ROUTE, `effective route drifted at frame ${frameIndex}`);
    assert.equal(state.boundarySplatMode, MODE, `full-support mode drifted at frame ${frameIndex}`);
    assert.equal(state.boundarySplatRendererIdentity, RENDERER, `renderer drifted at frame ${frameIndex}`);
    assert.equal(state.boundarySplatFallbackReason, null, `post-render fallback at frame ${frameIndex}`);
    assert.equal(state.overflowCount, 0, `post-render overflow at frame ${frameIndex}`);
    assert.equal(state.candidateCount, state.instanceCount, `post-render population truncation at frame ${frameIndex}`);
    assert.ok(state.candidateCount > 0, `empty full-support population at frame ${frameIndex}`);

    const clip = clipFromCanvas(render.canvasCssRect);
    const screenshot = await socket.call('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      clip,
    });
    const imagePath = join(outDir, `frame-${String(frameIndex + 1).padStart(3, '0')}.png`);
    const imageBytes = Buffer.from(screenshot.data, 'base64');
    writeFileSync(imagePath, imageBytes);
    const pixels = pngPixelMetrics(imageBytes);
    assert.equal(pixels.nonblank, true, `blank full-support frame ${frameIndex}`);

    let populationAudit = null;
    if (frameIndex === 0 || frameIndex === frameCount - 1) {
      populationAudit = await evaluate(socket, `(async () => {
        const audit = await ${VOLUME_PROTOTYPE_EXPRESSION}.sampleBoundarySplatFootprintAudit({ now: ${Number(scaleSet.fixedNowMs)} });
        return {
          ok: audit.ok,
          candidateCount: audit.candidateCount,
          instanceCount: audit.instanceCount,
          overflowCount: audit.overflowCount,
          stableNativeCellIdCount: audit.stableNativeCellIds?.length ?? null,
          stableNativeCellIdSha256: audit.stableNativeCellIdSha256,
          decodedMembershipCounts: audit.decodedMembershipCounts,
          unionReceipt: audit.unionReceipt,
        };
      })()`);
      assert.equal(populationAudit.ok, true, `population audit failed at frame ${frameIndex}`);
      assert.equal(populationAudit.overflowCount, 0, `audited overflow at frame ${frameIndex}`);
      assert.equal(populationAudit.candidateCount, populationAudit.instanceCount, `audited truncation at frame ${frameIndex}`);
      assert.equal(populationAudit.stableNativeCellIdCount, populationAudit.instanceCount, `partial stable-ID population at frame ${frameIndex}`);
      assert.equal(populationAudit.unionReceipt?.selectorAuthorityEffective, SELECTOR, `selector authority drifted at frame ${frameIndex}`);
      assert.equal(populationAudit.unionReceipt?.selectorRecipeSha256, SELECTOR_SHA256, `selector recipe drifted at frame ${frameIndex}`);
    }

    const frame = {
      frameIndex,
      sequenceAuthority: SEQUENCE_AUTHORITY,
      sameBrowserSessionId,
      sameStateCaptureId: scaleSet.sameStateCaptureId,
      controlledStepNowMs: controlled.controlledStepNowMs,
      controlledStepCapture: controlled.controlledStepCapture,
      baseFrameCount: scaleSet.baseFrameCount,
      baseSimStepCount: scaleSet.baseSimStepCount,
      effectiveRoute: state.effectiveRoute,
      backend: state.backend,
      supportControlSnapshot: state.supportControlSnapshot,
      supportControlSha256: sha256(Buffer.from(JSON.stringify(state.supportControlSnapshot))),
      candidateCount: state.candidateCount,
      instanceCount: state.instanceCount,
      overflowCount: state.overflowCount,
      populationAudit,
      image: artifact(imagePath),
      imageAuthority: render.imageAuthority,
      canvasCssRect: render.canvasCssRect,
      clip,
      pixels,
    };
    partialFrames.push(frame);
    lastTrustworthyEvidence = { admission, presentation, frame };
  }

  failurePhase = 'sequence-validation';
  validateSequence(partialFrames);
  const adjacentFramePixelDiffs = [];
  for (let index = 1; index < partialFrames.length; index += 1) {
    adjacentFramePixelDiffs.push({
      fromFrame: index - 1,
      toFrame: index,
      ...imageDiff(partialFrames[index - 1].image.path, partialFrames[index].image.path),
    });
  }
  if (!adjacentFramePixelDiffs.some(diff => diff.meanAbsDiff > 0.1 && diff.changedFraction > 0.001)) {
    throw new Error(`cached-or-static-output:${JSON.stringify(adjacentFramePixelDiffs)}`);
  }
  const controlHashes = [...new Set(partialFrames.map(frame => frame.supportControlSha256))];
  assert.equal(controlHashes.length, 1, `support controls drifted during sequence: ${controlHashes.join(',')}`);

  failurePhase = 'browser-validation';
  const browserEvents = socket.browserEvents.map(summarizeBrowserEvent);
  const materialBrowserErrors = browserEvents.filter(event => /GPUValidationError|Invalid CommandBuffer|does not fit in \[Buffer|uncaught/i.test(
    `${event.text || ''} ${(event.args || []).join(' ')}`,
  ));
  if (materialBrowserErrors.length > 0) throw new Error(`browser-validation-error:${JSON.stringify(materialBrowserErrors)}`);

  failurePhase = 'viewer-and-report';
  const viewerPath = join(outDir, 'sequence-viewer.html');
  writeFileSync(viewerPath, sequenceViewer(partialFrames, stepMs));
  const report = {
    schema: SCHEMA,
    status: 'captured',
    failurePhase: null,
    sequenceAuthority: SEQUENCE_AUTHORITY,
    requestedUrl,
    requestedMode: MODE,
    requestedSelectorAuthority: SELECTOR,
    selectorRecipeSha256: SELECTOR_SHA256,
    effectiveRoute: admission.effectiveRoute,
    prototypeIdentity: admission.prototypeIdentity,
    backend: admission.backend,
    source: {
      commit: gitValue(['rev-parse', 'HEAD']),
      branch: gitValue(['branch', '--show-current']),
      worktree: process.cwd(),
    },
    browser: {
      identity: 'single-cdp-browser',
      debugPort,
      userDataDir,
      viewportWidth,
      viewportHeight,
    },
    camera: CAMERA,
    captureConfig: { frameCount, stepMs, renderScale: 1, diagnosticUntuned: true },
    supportControlSha256: controlHashes[0],
    supportControlSnapshot: partialFrames[0].supportControlSnapshot,
    frames: partialFrames,
    adjacentFramePixelDiffs,
    browserEvents,
    viewer: artifact(viewerPath),
    lastTrustworthyEvidence: 'all serial frames passed route, support-control, population, overflow, image, and motion gates',
  };
  writeReport(report);
  console.log(JSON.stringify({
    ok: true,
    report: reportPath,
    viewer: viewerPath,
    frameCount,
    simSteps: partialFrames.map(frame => frame.baseSimStepCount),
    candidateCounts: partialFrames.map(frame => frame.candidateCount),
    adjacentFramePixelDiffs,
  }, null, 2));
} catch (error) {
  writeReport({
    schema: SCHEMA,
    status: 'failed',
    failurePhase,
    error: error?.stack || error?.message || String(error),
    requestedUrl,
    requestedMode: MODE,
    requestedSelectorAuthority: SELECTOR,
    partialFrames,
    lastTrustworthyEvidence,
    browserEvents: socket?.browserEvents?.map(summarizeBrowserEvent) || [],
  });
  console.error(JSON.stringify({ ok: false, report: reportPath, failurePhase, error: error?.message || String(error), partialFrameCount: partialFrames.length }, null, 2));
  process.exitCode = 1;
} finally {
  try { socket?.close(); } catch {}
  try { browser?.kill('SIGTERM'); } catch {}
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

function chromeExecutable() {
  const candidates = [
    process.env.KAMINOS_CHROME,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ].filter(Boolean);
  const found = candidates.find(existsSync);
  if (!found) throw new Error('Chrome executable not found');
  return found;
}

async function waitForTarget(port, timeout) {
  const started = performance.now();
  while (performance.now() - started < timeout) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) {
        const targets = await response.json();
        const target = targets.find(entry => entry.type === 'page' && !String(entry.url).startsWith('chrome-extension://'));
        if (target?.webSocketDebuggerUrl) return target;
      }
    } catch {}
    await delay(100);
  }
  throw new Error('Chrome debugging target did not appear');
}

async function waitForRuntime(cdp, timeout) {
  const started = performance.now();
  let last = null;
  while (performance.now() - started < timeout) {
    try {
      last = await evaluate(cdp, `(() => {
        const prototype = ${VOLUME_PROTOTYPE_EXPRESSION};
        const state = prototype?.debugState?.() || null;
        return state ? {
          active: state.active,
          backend: state.backend,
          error: state.error,
          effectiveRoute: state.effectiveRoute,
          prototypeIdentity: state.prototypeIdentity,
          simGrid: state.simGrid,
          frameCount: state.frameCount,
          simStepCount: state.simStepCount,
          requiredApis: Boolean(prototype.controlledStepFrame && prototype.renderFrozenScaleToCanvas && prototype.sampleBoundarySplatFootprintAudit),
        } : null;
      })()`);
    } catch (error) {
      last = { error: error?.message || String(error) };
      await delay(250);
      continue;
    }
    if (last?.error) throw new Error(`volume runtime reported error: ${last.error}`);
    if (last?.active && last.requiredApis && String(last.backend).startsWith('WebGPU') && last.frameCount > 3) return last;
    await delay(250);
  }
  throw new Error(`volume runtime did not become active: ${JSON.stringify(last)}`);
}

async function evaluate(cdp, expression) {
  const result = await cdp.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) {
    const detail = result.exceptionDetails.exception?.description
      || result.exceptionDetails.exception?.value
      || result.exceptionDetails.text
      || 'runtime evaluation failed';
    throw new Error(`${detail}\nExpression: ${expression}`);
  }
  return result.result.value;
}

function clipFromCanvas(rect = {}) {
  return {
    x: Math.max(0, Number(rect.x) || 0),
    y: Math.max(0, Number(rect.y) || 0),
    width: Math.max(2, Number(rect.width) || 0),
    height: Math.max(2, Number(rect.height) || 0),
    scale: 1,
  };
}

function validateSequence(frames) {
  assert.equal(frames.length, frameCount, 'partial sequence cannot satisfy the witness');
  const sessionIds = [...new Set(frames.map(frame => frame.sameBrowserSessionId))];
  assert.equal(sessionIds.length, 1, 'sequence crossed browser-session identity');
  for (let index = 1; index < frames.length; index += 1) {
    assert.ok(frames[index].baseFrameCount > frames[index - 1].baseFrameCount, `frame count did not advance at ${index}`);
    assert.equal(frames[index].baseSimStepCount, frames[index - 1].baseSimStepCount + 1, `simulation step did not advance exactly once at ${index}`);
  }
}

function sequenceViewer(frames, intervalMs) {
  const names = frames.map(frame => frame.image.path.split('/').pop());
  return `<!doctype html><meta charset="utf-8"><title>Kaminos exact full-support motion</title>
<style>html,body{margin:0;background:#050505;color:#eee;font:14px system-ui;height:100%}body{display:grid;grid-template-rows:auto 1fr}.bar{padding:10px;display:flex;gap:8px;align-items:center;background:#171717}button,input{font:inherit}.stage{min-height:0;display:grid;place-items:center}.stage img{max-width:100%;max-height:100%;object-fit:contain}.meta{margin-left:auto;color:#aaa}</style>
<div class="bar"><button id="play">Pause</button><input id="frame" type="range" min="0" max="${names.length - 1}" value="0" step="1"><span id="label"></span><span class="meta">Untuned analytical Ridge union Non-Ridge · ${SEQUENCE_AUTHORITY}</span></div><div class="stage"><img id="image"></div>
<script>const frames=${JSON.stringify(names)};const image=document.querySelector('#image');const slider=document.querySelector('#frame');const label=document.querySelector('#label');const play=document.querySelector('#play');let index=0;let running=true;function show(next){index=(next+frames.length)%frames.length;slider.value=index;image.src=frames[index];label.textContent=(index+1)+' / '+frames.length;}slider.oninput=()=>{running=false;play.textContent='Play';show(Number(slider.value));};play.onclick=()=>{running=!running;play.textContent=running?'Pause':'Play';};show(0);setInterval(()=>{if(running)show(index+1);},${Math.max(33, Math.round(intervalMs))});</script>`;
}

function summarizeBrowserEvent(event) {
  if (event.method === 'Runtime.exceptionThrown') {
    const details = event.params?.exceptionDetails || {};
    return { method: event.method, text: details.exception?.description || details.text || null, url: details.url || null };
  }
  if (event.method === 'Log.entryAdded') {
    return { method: event.method, level: event.params?.entry?.level || null, text: event.params?.entry?.text || null, url: event.params?.entry?.url || null };
  }
  return { method: event.method, type: event.params?.type || null, args: (event.params?.args || []).map(argument => argument.value ?? argument.description ?? null) };
}

function writeReport(report) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

function artifact(path) {
  const bytes = readFileSync(path);
  return { path: relative(process.cwd(), path), byteLength: bytes.byteLength, sha256: sha256(bytes) };
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function gitValue(gitArgs) {
  try {
    return execFileSync('git', gitArgs, { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function pngPixelMetrics(png) {
  const decoded = decodePng(png);
  let litPixels = 0;
  let lumaSum = 0;
  for (const row of decoded.rows) {
    for (let x = 0; x < decoded.width; x += 1) {
      const offset = x * decoded.channels;
      const luma = 0.2126 * row[offset] + 0.7152 * row[offset + 1] + 0.0722 * row[offset + 2];
      if (luma > 8) litPixels += 1;
      lumaSum += luma;
    }
  }
  const pixelCount = decoded.width * decoded.height;
  return {
    width: decoded.width,
    height: decoded.height,
    pixelCount,
    litPixels,
    litPixelRatio: litPixels / Math.max(1, pixelCount),
    meanLuma: lumaSum / Math.max(1, pixelCount),
    nonblank: litPixels > 64,
  };
}

function imageDiff(pathA, pathB) {
  const a = decodePng(readFileSync(pathA));
  const b = decodePng(readFileSync(pathB));
  assert.equal(a.width, b.width, 'motion frame widths differ');
  assert.equal(a.height, b.height, 'motion frame heights differ');
  let total = 0;
  let changed = 0;
  let samples = 0;
  for (let y = 0; y < a.height; y += 2) {
    const rowA = a.rows[y];
    const rowB = b.rows[y];
    for (let x = 0; x < a.width; x += 2) {
      const offsetA = x * a.channels;
      const offsetB = x * b.channels;
      const diff = (Math.abs(rowA[offsetA] - rowB[offsetB]) + Math.abs(rowA[offsetA + 1] - rowB[offsetB + 1]) + Math.abs(rowA[offsetA + 2] - rowB[offsetB + 2])) / 3;
      total += diff;
      if (diff > 3) changed += 1;
      samples += 1;
    }
  }
  return { samples, meanAbsDiff: total / Math.max(1, samples), changedFraction: changed / Math.max(1, samples) };
}

function decodePng(png) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.subarray(0, 8).compare(signature), 0, 'capture is not PNG');
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const compressed = [];
  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      assert.equal(data[12], 0, 'interlaced PNG is unsupported');
    } else if (type === 'IDAT') compressed.push(data);
    else if (type === 'IEND') break;
    offset += length + 12;
  }
  assert.equal(bitDepth, 8, 'capture PNG must be 8-bit');
  assert.ok(colorType === 2 || colorType === 6, `unsupported PNG color type ${colorType}`);
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const encoded = inflateSync(Buffer.concat(compressed));
  assert.equal(encoded.length, height * (stride + 1), 'capture PNG is partial');
  const rows = [];
  let prior = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    const filter = encoded[rowStart];
    const row = Buffer.alloc(stride);
    for (let x = 0; x < stride; x += 1) {
      const raw = encoded[rowStart + 1 + x];
      const left = x >= channels ? row[x - channels] : 0;
      const up = prior[x] || 0;
      const upLeft = x >= channels ? prior[x - channels] : 0;
      let value = raw;
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += Math.floor((left + up) / 2);
      else if (filter === 4) value += paeth(left, up, upLeft);
      else assert.equal(filter, 0, `unsupported PNG filter ${filter}`);
      row[x] = value & 255;
    }
    rows.push(row);
    prior = row;
  }
  return { width, height, channels, rows };
}

function paeth(left, up, upLeft) {
  const prediction = left + up - upLeft;
  const leftDistance = Math.abs(prediction - left);
  const upDistance = Math.abs(prediction - up);
  const upLeftDistance = Math.abs(prediction - upLeft);
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left;
  if (upDistance <= upLeftDistance) return up;
  return upLeft;
}

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}
