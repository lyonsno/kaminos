#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const part = process.argv[i];
  if (!part.startsWith('--')) continue;
  const key = part.slice(2);
  const next = process.argv[i + 1];
  if (next && !next.startsWith('--')) {
    args.set(key, next);
    i += 1;
  } else {
    args.set(key, '1');
  }
}

const usage = 'crucible-viewport-witness.mjs --url <kaminos-url> --out <screenshot.png> --report <report.json> [--cdp-port <port>] [--fire-friendly] [--expected-sharp-revision <sha>]';
if (args.has('help')) {
  console.log(usage);
  process.exit(0);
}

const url = args.get('url') || 'http://127.0.0.1:8095/';
const out = args.get('out') || '/tmp/kaminos-crucible-viewport-witness.png';
const reportPath = args.get('report') || '/tmp/kaminos-crucible-viewport-witness.json';
const chrome = args.get('chrome') || process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = Number(args.get('cdp-port') || 9341);
const fireFriendly = args.has('fire-friendly');
const fireTimeoutMs = Number(args.get('fire-timeout-ms') || 420000);
const expectedSharpRevision = args.get('expected-sharp-revision') || null;
const userDataDir = mkdtempSync(path.join(tmpdir(), 'kaminos-crucible-viewport-'));
const startedAt = new Date().toISOString();
const openGenerateTabExpression = 'document.querySelector(\'[data-tab="generate"]\').click()';

let phase = 'starting';
let browser = null;
let primaryOutputWritten = false;
let stderr = '';
let lastTrustworthyEvidence = null;
const runtimeExceptions = [];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function ensureParent(filePath) {
  mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeReport(payload) {
  ensureParent(reportPath);
  writeFileSync(reportPath, JSON.stringify({
    schema: 'crucible-viewport-witness.v0',
    url,
    screenshot: primaryOutputWritten ? out : null,
    reportPath,
    primaryOutputWritten,
    phase,
    startedAt,
    finishedAt: new Date().toISOString(),
    ...payload,
  }, null, 2));
}

async function cdp(pathname) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`);
  if (!response.ok) throw new Error(`CDP ${pathname} failed ${response.status}`);
  return response.json();
}

async function waitForCdp() {
  for (let i = 0; i < 100; i += 1) {
    try {
      await cdp('/json/version');
      return;
    } catch {
      await sleep(100);
    }
  }
  throw new Error(`CDP did not open on ${port}`);
}

function connectWebSocket(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.onopen = () => resolve(ws);
    ws.onerror = reject;
  });
}

let seq = 0;
function wsRequest(ws, method, params = {}, timeoutMs = 20000) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${method} timed out`)), timeoutMs);
    const onMessage = event => {
      const message = JSON.parse(event.data);
      if (message.id !== id) return;
      clearTimeout(timer);
      ws.removeEventListener('message', onMessage);
      if (message.error) reject(new Error(`${method}: ${JSON.stringify(message.error)}`));
      else resolve(message.result || {});
    };
    ws.addEventListener('message', onMessage);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(ws, expression) {
  const result = await wsRequest(ws, 'Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(`evaluation failed during ${phase}: ${result.exceptionDetails.text || 'exception'}`);
  }
  return result.result?.value;
}

try {
  phase = 'launching-chrome';
  browser = spawn(chrome, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--disable-gpu-sandbox',
    '--no-first-run',
    '--window-size=1600,1100',
    'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  browser.stderr.on('data', chunk => { stderr += chunk.toString(); });

  phase = 'opening-cdp';
  await waitForCdp();
  const targets = await cdp('/json/list');
  const page = targets.find(target => target.type === 'page');
  if (!page) throw new Error('no CDP page target found');
  const ws = await connectWebSocket(page.webSocketDebuggerUrl);

  phase = 'arming-runtime';
  await wsRequest(ws, 'Runtime.enable');
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') {
      runtimeExceptions.push(message.params.exceptionDetails?.text || 'Runtime.exceptionThrown');
    }
  });
  await wsRequest(ws, 'Page.enable');
  await wsRequest(ws, 'Emulation.setDeviceMetricsOverride', {
    width: 1600,
    height: 1100,
    deviceScaleFactor: 1,
    mobile: false,
  });

  phase = 'loading-page';
  await wsRequest(ws, 'Page.navigate', { url }, 20000);
  await sleep(Number(args.get('settle-ms') || 2500));

  phase = 'opening-generate-tab';
  await evaluate(ws, openGenerateTabExpression);
  await sleep(900);

  phase = 'reading-workroom-state';
  const state = await evaluate(ws, `(() => {
    const workspace = document.getElementById('crucible-viewport-workspace');
    const stage = document.getElementById('crucible-worktable-stage');
    const sourceThumb = document.getElementById('crucible-viewport-source-thumb');
    const sourceSelect = document.getElementById('crucible-viewport-source-select');
    const fireButton = document.getElementById('crucible-viewport-fire-button');
    const castButton = document.getElementById('crucible-viewport-cast-button');
    const debug = window.kaminosCrucibleViewportDebugState?.() || null;
    const stageRect = stage?.getBoundingClientRect();
    return {
      requestedSelectors: {
        workspace: { id: 'crucible-viewport-workspace', data: 'data-crucible-workroom' },
        heat: { attribute: 'data-crucible-heat-state' },
        routeStatus: { attribute: 'data-crucible-route-status' },
        stage: { id: 'crucible-worktable-stage' },
      },
      activeTab: document.querySelector('.tab.active')?.dataset.tab || null,
      workspaceHidden: Boolean(workspace?.hidden),
      workroom: workspace?.dataset.crucibleWorkroom || null,
      heatState: workspace?.dataset.crucibleHeatState || null,
      routeStatus: workspace?.dataset.crucibleRouteStatus || null,
      pointerEvents: workspace ? getComputedStyle(workspace).pointerEvents : null,
      stageRect: stageRect ? { width: stageRect.width, height: stageRect.height } : null,
      sourceThumbHidden: Boolean(sourceThumb?.hidden),
      sourceOptionCount: sourceSelect?.options?.length || 0,
      selectedSourceId: sourceSelect?.value || null,
      fireButtonDisabled: Boolean(fireButton?.disabled),
      fireButtonLabel: fireButton?.textContent || null,
      castButtonDisabled: Boolean(castButton?.disabled),
      castButtonLabel: castButton?.textContent || null,
      effectiveState: debug,
      castHasTarget: Boolean(debug?.lastCast?.assetId && debug?.castTargetSceneObjectId),
      title: document.getElementById('crucible-viewport-title')?.textContent || null,
      source: document.getElementById('crucible-viewport-source')?.textContent || null,
      firing: document.getElementById('crucible-viewport-firing')?.textContent || null,
      cast: document.getElementById('crucible-viewport-cast')?.textContent || null,
      receipt: document.getElementById('crucible-viewport-receipt')?.textContent || null,
    };
  })()`);
  lastTrustworthyEvidence = { workroom: state };
  if (state.activeTab !== 'generate') throw new Error(`Generate tab did not activate: ${state.activeTab}`);
  if (state.workspaceHidden) throw new Error('Crucible viewport workspace is hidden');
  if (state.workroom !== 'active') throw new Error(`Crucible workroom identity missing: ${state.workroom}`);
  if (state.pointerEvents === 'none') throw new Error('Crucible workroom controls are not hittable');
  if (!state.stageRect || state.stageRect.width < 300 || state.stageRect.height < 220) {
    throw new Error(`Crucible worktable stage is not visibly mounted: ${JSON.stringify(state.stageRect)}`);
  }
  if (state.sourceOptionCount < 1 || !state.selectedSourceId) {
    throw new Error(`Crucible source plate has no selectable indexed source: ${JSON.stringify(state)}`);
  }
  if (state.fireButtonDisabled) throw new Error('Crucible primary firing action is disabled despite a selected source');
  if (!state.castButtonDisabled && !state.castHasTarget) throw new Error('Crucible cast action is enabled without a scene target');
  phase = 'exercising-source-selection';
  state.sourceSelectionExercise = await evaluate(ws, `(async () => {
    const select = document.getElementById('crucible-viewport-source-select');
    const before = window.kaminosCrucibleViewportDebugState?.() || null;
    const target = Array.from(select?.options || []).find(option => option.value && option.value !== before?.source?.assetId);
    if (!target) return { attempted: false, reason: 'no alternate indexed source' };
    select.value = target.value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const after = window.kaminosCrucibleViewportDebugState?.() || null;
    return {
      attempted: true,
      requestedAssetId: target.value,
      beforeAssetId: before?.source?.assetId || null,
      effectiveAssetId: after?.source?.assetId || null,
      effectiveRouteId: after?.effectiveRouteId || null,
      effectivePipelineId: after?.effectivePipelineId || null,
    };
  })()`);
  if (state.sourceSelectionExercise.attempted && state.sourceSelectionExercise.effectiveAssetId !== state.sourceSelectionExercise.requestedAssetId) {
    throw new Error(`Crucible source selection did not become effective: ${JSON.stringify(state.sourceSelectionExercise)}`);
  }
  lastTrustworthyEvidence = { ...lastTrustworthyEvidence, sourceSelectionExercise: state.sourceSelectionExercise };
  if (runtimeExceptions.length) throw new Error(`browser runtime exceptions: ${runtimeExceptions.join('; ')}`);

  if (fireFriendly) {
    phase = 'starting-friendly-firing';
    await evaluate(ws, `(() => {
      const profile = document.getElementById('crucible-viewport-profile-select');
      profile.value = 'cooperative-spn-gaussian';
      profile.dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('crucible-viewport-fire-button').click();
      return true;
    })()`);
    const deadline = Date.now() + fireTimeoutMs;
    let observedRunning = false;
    let routeState = null;
    while (Date.now() < deadline) {
      await sleep(1000);
      routeState = await evaluate(ws, `(() => ({
        status: window.__kaminosKilnRouteBenchState?.status || null,
        message: window.__kaminosKilnRouteBenchState?.message || null,
        runningProfileId: window.__kaminosKilnRouteBenchState?.runningProfileId || null,
      }))()`);
      if (routeState.runningProfileId || routeState.status === 'running') observedRunning = true;
      if (observedRunning && !routeState.runningProfileId && ['complete', 'error', 'evidence-only'].includes(routeState.status)) break;
    }
    if (!observedRunning) throw new Error(`Friendly firing never entered running state: ${JSON.stringify(routeState)}`);
    if (!routeState || routeState.runningProfileId || !['complete', 'error', 'evidence-only'].includes(routeState.status)) {
      throw new Error(`Friendly firing did not finish within ${fireTimeoutMs}ms: ${JSON.stringify(routeState)}`);
    }
    phase = 'reading-friendly-firing-evidence';
    state.fullRoute = await evaluate(ws, `(() => {
      const routeState = window.__kaminosKilnRouteBenchState || {};
      const report = routeState.result?.report?.document || {};
      const stage = (report.stages || [])[0] || {};
      const adapter = stage.effectiveRoute?.adapterReport || {};
      const backgroundHeartbeat = adapter.backgroundHeartbeat || null;
      const schedulerEvents = adapter.breathingRoom?.telemetry?.events || [];
      const routeTailEvents = schedulerEvents.filter(event => event?.phase === 'route-tail');
      const prepSteps = new Set(['depth-normalize', 'depth-min', 'depth-rescale', 'base-disparity', 'base-grid', 'base-color']);
      const prepEvents = routeTailEvents.filter(event => prepSteps.has(event?.step) && event?.role === 'cpu-materialization-chunk');
      const gaussianEvents = routeTailEvents.filter(event => event?.step === 'gaussian-compose' && event?.role === 'cpu-materialization-chunk');
      const gaussianCpuDutyIntervals = routeTailEvents
        .filter(event => event?.step === 'gaussian-compose' && event?.kind === 'duty-interval' && event?.granularity === 'row-batched')
        .map(event => ({
          phase: event.phase,
          boundary: event.boundary,
          stage: event.stage,
          step: event.step,
          role: event.role,
          granularity: event.granularity,
          checkpointItems: event.checkpointItems,
          segmentStartProcessedItems: event.segmentStartProcessedItems,
          segmentEndProcessedItems: event.segmentEndProcessedItems,
          intervalStartMs: event.intervalStartMs,
          intervalEndMs: event.intervalEndMs,
          durationMs: event.durationMs,
        }));
      const lateTailSteps = new Set(['ply-blob-assembly', 'object-url-create', 'output-bind']);
      const lateTailBlockingIntervals = routeTailEvents
        .filter(event => lateTailSteps.has(event?.step) && event?.kind === 'duty-interval')
        .map(event => ({
          phase: event.phase,
          boundary: event.boundary,
          stage: event.stage,
          step: event.step,
          role: event.role,
          intervalStartMs: event.intervalStartMs,
          intervalEndMs: event.intervalEndMs,
          durationMs: event.durationMs,
          bytes: event.bytes,
        }));
      const inferenceWindowFinalizeInterval = routeTailEvents.find(event =>
        event?.step === 'inference-window-finalize' && event?.kind === 'duty-interval' && event?.role === 'localization-envelope'
      ) || null;
      const splat = report.artifacts?.splat || null;
      const fire = window.kaminosSharpBreathingRoomKilnFireDebug?.state?.()?.fire || null;
      return {
        status: routeState.status || null,
        message: routeState.message || null,
        requestedPipelineId: report.requestedPipelineId || null,
        effectiveRouteId: report.effectiveRouteConfig?.routeId || null,
        effectiveSharpRevision: adapter.revision || adapter.backend?.revision || null,
        requestedScheduler: adapter.breathingRoom?.requestedScheduler || null,
        effectiveScheduler: adapter.breathingRoom?.effectiveScheduler || null,
        routeTailCheckpointEvents: {
          total: routeTailEvents.length,
          prep: prepEvents.length,
          gaussian: gaussianEvents.length,
          prepSteps: [...new Set(prepEvents.map(event => event.step))].sort(),
          gaussianProcessedItems: [...new Set(gaussianEvents.map(event => event.processedItems).filter(Number.isFinite))].sort((a, b) => a - b),
        },
        gaussianCpuDutyIntervals,
        lateTailBlockingIntervals,
        inferenceWindowFinalizeInterval,
        output: splat ? { path: splat.path, bytes: splat.bytes, sha256: splat.sha256, status: splat.status } : null,
        backgroundHeartbeat,
        volumeReleased: Boolean(fire?.volumeReleased),
        volumeReleaseConfirmed: Boolean(fire?.volumeReleaseConfirmed),
        autoOpenedTab: document.querySelector('.tab.active')?.dataset.tab || null,
      };
    })()`);
    lastTrustworthyEvidence = { ...lastTrustworthyEvidence, fullRoute: state.fullRoute };
    if (state.fullRoute.status !== 'complete') throw new Error(`Friendly firing failed: ${state.fullRoute.message || state.fullRoute.status}`);
    if (expectedSharpRevision && state.fullRoute.effectiveSharpRevision !== expectedSharpRevision) {
      throw new Error(`Friendly firing used unexpected SHARP revision: ${state.fullRoute.effectiveSharpRevision}`);
    }
    if (state.fullRoute.effectiveScheduler?.cpuChunkItems !== 65536 || state.fullRoute.effectiveScheduler?.routeTailYieldMs !== 3) {
      throw new Error(`Friendly firing did not use cooperative compose/PLY settings: ${JSON.stringify(state.fullRoute.effectiveScheduler)}`);
    }
    if (state.fullRoute.routeTailCheckpointEvents?.prep < 6 || state.fullRoute.routeTailCheckpointEvents?.gaussian < 1) {
      throw new Error(`Friendly firing is missing prep or Gaussian route-tail checkpoints: ${JSON.stringify(state.fullRoute.routeTailCheckpointEvents)}`);
    }
    const backgroundHeartbeat = state.fullRoute.backgroundHeartbeat;
    if (backgroundHeartbeat?.schema !== 'sharp-webgpu.background-heartbeat.v0') throw new Error('Friendly firing is missing the corrected backgroundHeartbeat schema');
    if (!backgroundHeartbeat.inferenceWindow || !Number.isFinite(backgroundHeartbeat.inferenceWindow.durationMs)) throw new Error('Friendly firing is missing its measured inferenceWindow');
    if (!Array.isArray(backgroundHeartbeat.worstFrameGaps) || !backgroundHeartbeat.worstFrameGaps.length) throw new Error('Friendly firing is missing scoped worstFrameGaps');
    const expectedLateTailSteps = ['ply-blob-assembly', 'object-url-create', 'output-bind'];
    for (const step of expectedLateTailSteps) {
      const interval = state.fullRoute.lateTailBlockingIntervals?.find(candidate => candidate.step === step);
      if (!interval || !Number.isFinite(interval.intervalStartMs) || !Number.isFinite(interval.intervalEndMs) || !Number.isFinite(interval.durationMs)) {
        throw new Error(`Friendly firing is missing ${step} blocking interval evidence: ${JSON.stringify(state.fullRoute.lateTailBlockingIntervals)}`);
      }
    }
    if (!state.fullRoute.gaussianCpuDutyIntervals?.length || state.fullRoute.gaussianCpuDutyIntervals.some(interval =>
      interval.granularity !== 'row-batched'
      || !Number.isFinite(interval.segmentStartProcessedItems)
      || !Number.isFinite(interval.segmentEndProcessedItems)
      || interval.segmentEndProcessedItems <= interval.segmentStartProcessedItems
      || !Number.isFinite(interval.intervalStartMs)
      || !Number.isFinite(interval.intervalEndMs)
    )) {
      throw new Error(`Friendly firing is missing truthful row-batched Gaussian CPU intervals: ${JSON.stringify(state.fullRoute.gaussianCpuDutyIntervals)}`);
    }
    const finalizeInterval = state.fullRoute.inferenceWindowFinalizeInterval;
    if (!finalizeInterval || finalizeInterval.role !== 'localization-envelope'
      || !Number.isFinite(finalizeInterval.intervalStartMs) || !Number.isFinite(finalizeInterval.intervalEndMs)) {
      throw new Error(`Friendly firing is missing its non-causal inference finalization envelope: ${JSON.stringify(finalizeInterval)}`);
    }
    for (const [index, gap] of backgroundHeartbeat.worstFrameGaps.slice(0, 2).entries()) {
      if (gap?.overlapClassification === 'uninstrumented-gap') {
        throw new Error(`Friendly firing residual gap ${index + 1} remains unattributed: ${JSON.stringify(gap)}`);
      }
      const intervalEvidence = gap?.overlappedEvents?.filter(event =>
        Number.isFinite(event?.intervalStartMs) && Number.isFinite(event?.intervalEndMs)
      ) || [];
      if (!intervalEvidence.length) {
        throw new Error(`Friendly firing residual gap ${index + 1} has no overlapping interval evidence: ${JSON.stringify(gap)}`);
      }
    }
    if (!state.fullRoute.output?.sha256 || state.fullRoute.output.status !== 'real') throw new Error('Friendly firing did not preserve a real hashed output');
    if (!state.fullRoute.volumeReleased) throw new Error('Friendly firing completed without releasing the furnace volume');
    phase = 'returning-to-completed-crucible';
    await evaluate(ws, openGenerateTabExpression);
    await sleep(900);
    state.fullRoute.completedWorkroom = await evaluate(ws, `(() => ({
      heatState: document.getElementById('crucible-viewport-workspace')?.dataset.crucibleHeatState || null,
      routeStatus: document.getElementById('crucible-viewport-workspace')?.dataset.crucibleRouteStatus || null,
      castButtonDisabled: Boolean(document.getElementById('crucible-viewport-cast-button')?.disabled),
      cast: document.getElementById('crucible-viewport-cast')?.textContent || null,
      receipt: document.getElementById('crucible-viewport-receipt')?.textContent || null,
    }))()`);
    lastTrustworthyEvidence = { ...lastTrustworthyEvidence, completedWorkroom: state.fullRoute.completedWorkroom };
    if (state.fullRoute.completedWorkroom.castButtonDisabled) throw new Error('Completed real cast is not actuatable from the Crucible tray');
  }

  phase = 'capturing-screenshot';
  const screenshot = await wsRequest(ws, 'Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  });
  const png = Buffer.from(screenshot.data, 'base64');
  if (png.length < 4096) throw new Error('screenshot is too small to be credible evidence');
  ensureParent(out);
  writeFileSync(out, png);
  primaryOutputWritten = true;

  phase = 'writing-report';
  writeReport({
    ok: true,
    state,
    bytes: png.length,
    runtimeExceptions,
    stderrTail: stderr.slice(-1000),
  });
  console.log(JSON.stringify({ ok: true, out, report: reportPath, state }, null, 2));
  ws.close();
  browser.kill('SIGTERM');
} catch (error) {
  writeReport({
    ok: false,
    error: error.message || String(error),
    lastTrustworthyEvidence,
    runtimeExceptions,
    stderrTail: stderr.slice(-1000),
  });
  if (browser) browser.kill('SIGTERM');
  console.error(error.stack || error.message || String(error));
  process.exit(1);
}
