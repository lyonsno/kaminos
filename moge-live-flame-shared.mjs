/**
 * moge-live-flame-shared.mjs — pieces shared by the standalone shared-device
 * composition page (moge-live-flame-core.mjs) and the in-app injection module
 * (moge-live-flame-inject.mjs): HUD state, frame monitor, MoGe load/run, depth
 * painting, and on-device chunk telemetry with persistence.
 */
import { MoGeInference } from './lib/moge-inference.js';

export const hud = id => document.getElementById(id);
export const state = {
  frameIntervals: [],
  framesDuringInference: 0,
  worstGapDuringInference: 0,
  inferenceGaps: [],
  inferring: false,
  lastRouteResult: null,
  frameTimes: [],
  longTasks: [],
  visibilityChanges: [],
  phases: [],
  unsavedCaptures: [],
  lastCaptureEnd: performance.now(),
  longTaskObserver: null,
};

function markPhase(phase) {
  state.phases.push({ phase, atMs: performance.now() });
}

function collectLongTasks(entries) {
  for (const entry of entries) state.longTasks.push({ startTime: entry.startTime, duration: entry.duration });
}

// --- Shared GPUDevice: union of pyro-volume and inference requirements ---

export function startFrameMonitor() {
  document.addEventListener('visibilitychange', () => {
    state.visibilityChanges.push({ atMs: performance.now(), state: document.visibilityState });
  });
  if (globalThis.PerformanceObserver?.supportedEntryTypes?.includes('longtask')) {
    state.longTaskObserver = new PerformanceObserver(list => collectLongTasks(list.getEntries()));
    state.longTaskObserver.observe({ type: 'longtask' });
  }
  let last = performance.now();
  const tick = now => {
    const dt = now - last;
    state.frameTimes.push(now);
    state.frameIntervals.push(dt);
    if (state.frameIntervals.length > 600) state.frameIntervals.shift();
    if (state.inferring) {
      state.framesDuringInference++;
      state.inferenceGaps.push(dt);
      if (dt > state.worstGapDuringInference) state.worstGapDuringInference = dt;
    }
    last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  setInterval(() => {
    const xs = [...state.frameIntervals].sort((a, b) => a - b);
    if (!xs.length) return;
    const p95 = xs[Math.floor(0.95 * xs.length)];
    hud('hud-p95').textContent = `${p95.toFixed(1)}ms`;
    hud('hud-p95').className = `v ${p95 < 20 ? 'good' : p95 < 34 ? 'warn' : 'bad'}`;
  }, 500);
}

// Bonfire scene preset (mirrors the main app's VOLUME_SCENE_PRESETS.bonfire_plume;
// without these emission/appearance values the sim runs but produces no visible flame).

export async function loadMoge(gpu) {
  markPhase('initialization');
  const inference = new MoGeInference(gpu);
  await inference.init((received, total) => {
    const pct = total ? Math.round((received / total) * 100) : 0;
    hud('hud-weights').textContent = `loading ${pct}%`;
  });
  hud('hud-weights').textContent = inference.useRealWeights
    ? `real (${inference.weightsSource || 'local'})` : 'STUB — not authoritative';
  hud('hud-weights').className = `v ${inference.useRealWeights ? 'good' : 'bad'}`;
  // Warm-up run (discarded): first visible run is then steady state.
  if (inference.useRealWeights) {
    markPhase('warm-up');
    hud('hud-infer').textContent = 'warming up (discarded run)…';
    hud('hud-infer').className = 'v warn';
    const warm = await inference.warmUp();
    hud('hud-infer').textContent = warm ? `warm (${(warm.warmUpMs / 1000).toFixed(1)}s warm-up)` : 'idle';
    hud('hud-infer').className = 'v';
  }
  window.__mogeInference = inference;
  markPhase('idle');
  return inference;
}


export async function fetchTestImageData() {
  const img = new Image();
  img.src = './fixtures/moge-live-flame-source.png';
  // This diagnosis uses a committed, replayable fixture; a missing fixture is
  // an input failure, not permission to silently substitute another image.
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, img.width, img.height);
}

// On-device chunk telemetry: THIS browser's run is the measurement of record
// (headless harness frame numbers are compositor-quantized and only relative).

export function renderChunkTelemetry(sched, worstGapMs, gaps = []) {
  let panel = document.getElementById('chunk-telemetry');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'chunk-telemetry';
    panel.style.cssText = 'margin-top:10px;border-top:1px solid #2a2a33;padding-top:8px;font-size:0.72rem;';
    document.getElementById('hud').appendChild(panel);
  }
  const waits = (sched?.eventTrace?.events || [])
    .filter(e => e.kind === 'queue-work-done-end' || e.kind === 'readback-wait-end')
    .map(e => ({ label: e.chunk || (Number.isFinite(e.firstBlock) ? `blocks ${e.firstBlock}-${e.lastBlock}` : e.phase), waitMs: e.waitMs ?? 0 }))
    .sort((a, b) => b.waitMs - a.waitMs);
  const rows = waits.slice(0, 5).map(w =>
    `<div style="display:flex;justify-content:space-between"><span style="color:#9a958a">${w.label}</span><span>${w.waitMs.toFixed(0)}ms</span></div>`).join('');
  const xs = [...gaps].sort((a, b) => a - b);
  const pick = q => xs.length ? xs[Math.min(xs.length - 1, Math.floor(q * xs.length))] : 0;
  const over = t => gaps.filter(g => g > t).length;
  const dist = xs.length
    ? `frames ${xs.length} · p50 ${pick(0.5).toFixed(1)}ms · p95 ${pick(0.95).toFixed(1)}ms · >34ms: ${over(34)} · >50ms: ${over(50)}`
    : 'no frame samples';
  panel.innerHTML = `<div style="color:#9a958a;margin-bottom:3px">worst frame gap this run: <b style="color:${worstGapMs > 34 ? '#e06c5a' : '#79c98f'}">${worstGapMs.toFixed(0)}ms</b><br>${dist}<br>${waits.length} chunks · worst queue waits:</div>${rows}`;
  // Persist: HUD results must survive tab close / box restart.
  try {
    localStorage.setItem('mogeLiveFlameLastRun', JSON.stringify({
      at: new Date().toISOString(), worstGapMs, dist, waits: waits.slice(0, 5), html: panel.innerHTML,
    }));
  } catch { /* storage unavailable: display-only */ }
}

// Restore the previous run's telemetry on load, clearly labeled as historical.
export function restoreLastRunTelemetry() {
  try {
    const saved = JSON.parse(localStorage.getItem('mogeLiveFlameLastRun') || 'null');
    if (!saved?.html) return;
    const panel = document.createElement('div');
    panel.id = 'chunk-telemetry';
    panel.style.cssText = 'margin-top:10px;border-top:1px solid #2a2a33;padding-top:8px;font-size:0.72rem;';
    panel.innerHTML = `<div style="color:#d9a04a;margin-bottom:3px">previous run (${new Date(saved.at).toLocaleString()}):</div>${saved.html}`;
    document.getElementById('hud').appendChild(panel);
  } catch { /* ignore */ }
}


export async function paintDepth(result) {
  const canvas = document.getElementById('depth-canvas');
  canvas.width = result.width; canvas.height = result.height;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(result.width, result.height);
  let dMin = Infinity, dMax = -Infinity;
  for (const d of result.depth) if (isFinite(d)) { dMin = Math.min(dMin, d); dMax = Math.max(dMax, d); }
  const span = Math.max(dMax - dMin, 1e-6);
  // Row-banded with yields so the paint does not stall the host's frame.
  const band = 48 * result.width;
  for (let i = 0; i < result.depth.length; i++) {
    if (i && i % band === 0) await new Promise(r => setTimeout(r, 0));
    const t = 1 - (result.depth[i] - dMin) / span;
    img.data[i * 4] = 255 * Math.min(1, Math.max(0, 1.5 - Math.abs(4 * t - 3)));
    img.data[i * 4 + 1] = 255 * Math.min(1, Math.max(0, 1.5 - Math.abs(4 * t - 2)));
    img.data[i * 4 + 2] = 255 * Math.min(1, Math.max(0, 1.5 - Math.abs(4 * t - 1)));
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  document.getElementById('depth-panel').style.display = 'block';
}


export async function runInference(inference) {
  const capture = {
    kind: 'moge-frame-timing', runId: crypto.randomUUID(),
    at: new Date().toISOString(), timeOrigin: performance.timeOrigin,
    windowStartMs: state.lastCaptureEnd, url: location.href,
    compositionRoute: structuredClone(window.__compositionRoute ?? null),
    visibilityAtStart: document.visibilityState,
    browser: { userAgent: globalThis.navigator?.userAgent, webdriver: globalThis.navigator?.webdriver },
    input: { source: 'fixtures/moge-live-flame-source.png', status: 'unavailable' },
    longTaskSupport: !!state.longTaskObserver,
    routeResult: null, status: 'running',
    requestedScheduler: {
      mode: 'cooperative', yieldMs: 0, vitBlockChunkSize: 1,
      splitVitBlocks: true, splitDecoderResBlocks: true,
      pacing: 'bounded-prefix', maxInFlightChunks: 1,
    },
  };
  state.lastRouteResult = null;
  markPhase('image-input');
  try {
    const imageData = await fetchTestImageData();
    capture.input = { ...capture.input, status: 'decoded', width: imageData.width, height: imageData.height };
    hud('hud-infer').textContent = 'running (cooperative)…';
    hud('hud-infer').className = 'v warn';
    state.framesDuringInference = 0;
    state.worstGapDuringInference = 0;
    state.inferenceGaps = [];
    state.inferring = true;
    const t0 = performance.now();
    markPhase('inference');
    const result = await inference.run(imageData, {
      scheduler: capture.requestedScheduler,
    });
    const elapsed = ((performance.now() - t0) / 1000).toFixed(2);
    state.inferring = false;
    state.lastRouteResult = result.routeResult || null;
    capture.routeResult = state.lastRouteResult;
    hud('hud-infer').textContent = `done in ${elapsed}s`;
    hud('hud-infer').className = 'v good';
    hud('hud-frames').textContent = String(state.framesDuringInference);
    hud('hud-frames').className = `v ${state.framesDuringInference > 30 ? 'good' : 'warn'}`;
    const sched = result.schedulerVerificationReceipt;
    hud('hud-sched').textContent = sched ? `${sched.status} / ${sched.classification}` : 'missing';
    hud('hud-sched').className = `v ${sched?.status === 'verified' ? 'good' : 'warn'}`;
    renderChunkTelemetry(sched, state.worstGapDuringInference, state.inferenceGaps);
    markPhase('depth-paint');
    await paintDepth(result);
    // Include the first presented frame after CPU painting in the timing window.
    await new Promise(requestAnimationFrame);
    capture.status = 'complete';
    markPhase('complete');
  } catch (e) {
    capture.status = 'failed';
    capture.failure = { phase: state.phases.at(-1)?.phase, message: String(e) };
    state.inferring = false;
    hud('hud-infer').textContent = `error: ${e.message}`;
    hud('hud-infer').className = 'v bad';
    throw e;
  } finally {
    collectLongTasks(state.longTaskObserver?.takeRecords() ?? []);
    capture.windowEndMs = performance.now();
    capture.visibilityAtEnd = document.visibilityState;
    capture.frameTimes = state.frameTimes;
    capture.longTasks = state.longTasks;
    capture.visibilityChanges = state.visibilityChanges;
    capture.phases = state.phases;
    state.frameTimes = [];
    state.longTasks = [];
    state.visibilityChanges = [];
    state.phases = [{ phase: 'idle', atMs: capture.windowEndMs }];
    state.lastCaptureEnd = capture.windowEndMs;
    await saveRunCapture(capture);
  }
}

// Reuse Kaminos's existing file-in/file-out capture endpoint. The rolling HUD
// and localStorage summary are presentation only; this is the uncapped raw run.
async function saveRunCapture(capture) {
  let panel = document.getElementById('moge-capture-status');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'moge-capture-status';
    document.getElementById('hud').appendChild(panel);
  }
  panel.textContent = 'Saving raw timing…';
  try {
    const response = await fetch('/api/volume-capture', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...capture, name: `moge-${capture.runId}` }),
    });
    if (!response.ok) throw new Error(`capture HTTP ${response.status}`);
    const saved = await response.json();
    if (!saved.ok || !saved.relativePath || saved.document?.capture?.runId !== capture.runId) {
      throw new Error('capture save returned no matching run');
    }
    const unsaved = state.unsavedCaptures.length;
    panel.textContent = `Raw timing saved: ${saved.relativePath}`
      + (unsaved ? ` · ${unsaved} earlier capture(s) NOT SAVED: keep this tab open.` : '');
    panel.style.color = unsaved ? '#e06c5a' : '#79c98f';
  } catch (error) {
    state.unsavedCaptures.push(capture);
    window.__mogeUnsavedCaptures = state.unsavedCaptures;
    panel.textContent = `RAW TIMING NOT SAVED: ${error.message}. Keep this tab open; raw data is retained in memory.`;
    panel.style.color = '#e06c5a';
  }
}

// --- Boot ---
