/**
 * sf3d-live-flame-inject.mjs — composition module for the live Kaminos app:
 * SF3D (Stable Fast 3D, image → textured GLB) running its cooperative product
 * route alongside the app's own fire route, in one page.
 *
 * Loaded by index.html's `#composition_module_url=` seam after the volume
 * prototype exists (the seam MoGe's composition introduced). Same pattern as
 * moge-live-flame-inject.mjs: HUD with the independent frame-cadence witness,
 * a run button, and receipts the HUD never upgrades.
 *
 * Device topology, stated honestly: this app route does not expose its
 * GPUDevice, so SF3D acquires its own through its producer — SAME GPU, TWO
 * DEVICES. SF3D's fine cooperative duties (24 / 2,922 / 702 / 61 per run) are
 * what leaves room for the flame's submissions; the producer's same-device
 * foreground-opportunity interlock is not exercised here (no injected device).
 *
 * The producer is the SF3D library build vendored at ./lib/sf3d/ (code only;
 * weights.bin and tets/ are served from an SF3D checkout — see
 * serve-sf3d-elfinblue.sh).
 */
import { createSf3dProducer } from './lib/sf3d/sf3d-producer.js';

const CANONICAL_DEMO_CHAIR_GLB_SHA256 = 'e1f70de3407df24d571bf68f70fac2b59373bdd948075a2387f1834e4faff8b7';
const WEIGHTS_URL = './lib/sf3d/weights.bin';
const IMAGE_URL = './fixtures/sf3d-demo-chair.png';

const hud = id => document.getElementById(id);
const state = {
  frameIntervals: [],      // rolling, all time
  inferring: false,
  framesDuringInference: 0,
  inferenceGaps: [],
  worstGapDuringInference: 0,
  lastResult: null,
  lastError: null,
};

function injectHud() {
  const style = document.createElement('style');
  style.textContent = `
    #sf3d-hud { position: fixed; top: 12px; right: 12px; z-index: 10000; width: 360px;
      background: rgba(10,10,14,0.88); border: 1px solid #2a2a33; border-radius: 10px;
      padding: 14px 16px; color: #e8e4da; font-family: system-ui, sans-serif; backdrop-filter: blur(6px); }
    #sf3d-hud h1 { font-size: 0.95rem; font-weight: 600; margin: 0 0 2px; }
    #sf3d-hud .sub { color: #8f8a7e; font-size: 0.72rem; margin-bottom: 10px; }
    #sf3d-hud .row { display: flex; justify-content: space-between; font-size: 0.78rem; padding: 2px 0; gap: 8px; }
    #sf3d-hud .row .k { color: #9a958a; white-space: nowrap; } #sf3d-hud .row .v { font-variant-numeric: tabular-nums; text-align: right; }
    #sf3d-run { margin-top: 10px; width: 100%; padding: 9px 0; font-size: 0.85rem; font-weight: 600;
      background: #2a6bb3; color: #fff; border: none; border-radius: 7px; cursor: pointer; }
    #sf3d-run:disabled { background: #3a3a42; color: #777; cursor: default; }
    #sf3d-download { margin-top: 6px; width: 100%; padding: 7px 0; font-size: 0.8rem; background: #2f2f38; color: #e8e4da; border: 1px solid #3a3a44; border-radius: 7px; cursor: pointer; }
    #sf3d-hud .warn { color: #d9a04a; } #sf3d-hud .good { color: #79c98f; } #sf3d-hud .bad { color: #e06c5a; }
    #sf3d-hud progress { width: 100%; height: 6px; margin-top: 6px; }
  `;
  document.head.appendChild(style);
  const el = document.createElement('div');
  el.id = 'sf3d-hud';
  el.innerHTML = `
    <h1>SF3D × Live App Route</h1>
    <div class="sub">Composition module: app fire route (this basin/preset) + SF3D image→mesh cooperative product route — same GPU, two devices</div>
    <div class="row"><span class="k">fire</span><span class="v" id="sf3d-fire">—</span></div>
    <div class="row"><span class="k">frame p95 (rolling)</span><span class="v" id="sf3d-p95">—</span></div>
    <div class="row"><span class="k">frames during inference</span><span class="v" id="sf3d-frames">—</span></div>
    <div class="row"><span class="k">worst gap during inference</span><span class="v" id="sf3d-worst">—</span></div>
    <div class="row"><span class="k">weights</span><span class="v" id="sf3d-weights">not loaded</span></div>
    <div class="row"><span class="k">inference</span><span class="v" id="sf3d-infer">idle</span></div>
    <div class="row"><span class="k">duties (dino / two-stream / post / bake)</span><span class="v" id="sf3d-duties">—</span></div>
    <div class="row"><span class="k">GLB</span><span class="v" id="sf3d-glb">—</span></div>
    <progress id="sf3d-progress" value="0" max="100"></progress>
    <button id="sf3d-run" disabled>Loading SF3D weights…</button>
    <button id="sf3d-download" style="display:none">Download GLB</button>`;
  document.body.appendChild(el);
}

function mirrorFireStatus() {
  const src = document.getElementById('volume-backend');
  const paint = () => {
    const text = src?.textContent?.trim() || 'unknown';
    hud('sf3d-fire').textContent = text;
    hud('sf3d-fire').className = `v ${/error|unavailable/i.test(text) ? 'bad' : 'good'}`;
  };
  paint();
  if (src) new MutationObserver(paint).observe(src, { childList: true, characterData: true, subtree: true });
}

function startFrameMonitor() {
  let last = performance.now();
  const tick = now => {
    const dt = now - last;
    state.frameIntervals.push(dt);
    if (state.frameIntervals.length > 600) state.frameIntervals.shift();
    if (state.inferring) {
      state.framesDuringInference += 1;
      state.inferenceGaps.push(dt);
      if (dt > state.worstGapDuringInference) state.worstGapDuringInference = dt;
      hud('sf3d-frames').textContent = String(state.framesDuringInference);
      hud('sf3d-worst').textContent = `${state.worstGapDuringInference.toFixed(1)}ms`;
      hud('sf3d-worst').className = `v ${state.worstGapDuringInference < 34 ? 'good' : state.worstGapDuringInference < 100 ? 'warn' : 'bad'}`;
    }
    last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  setInterval(() => {
    const xs = [...state.frameIntervals].sort((a, b) => a - b);
    if (!xs.length) return;
    const p95 = xs[Math.floor(0.95 * xs.length)];
    hud('sf3d-p95').textContent = `${p95.toFixed(1)}ms`;
    hud('sf3d-p95').className = `v ${p95 < 20 ? 'good' : p95 < 34 ? 'warn' : 'bad'}`;
  }, 500);
}

async function loadImage(url) {
  const img = new Image();
  img.src = url;
  await img.decode();
  return img;
}

async function sha256Hex(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function summarizeGaps(gaps) {
  const xs = [...gaps].sort((a, b) => a - b);
  const pick = q => (xs.length ? xs[Math.min(xs.length - 1, Math.floor(q * xs.length))] : null);
  return { count: xs.length, p50Ms: pick(0.5), p95Ms: pick(0.95), p99Ms: pick(0.99), maxMs: xs.length ? xs[xs.length - 1] : null,
    over33_3: xs.filter(g => g > 33.3).length, over100: xs.filter(g => g > 100).length };
}

async function runSf3d(producer, image) {
  const button = hud('sf3d-run');
  button.disabled = true;
  state.inferring = true;
  state.framesDuringInference = 0;
  state.inferenceGaps = [];
  state.worstGapDuringInference = 0;
  state.lastError = null;
  hud('sf3d-infer').textContent = 'running…';
  hud('sf3d-infer').className = 'v warn';
  hud('sf3d-progress').value = 0;
  const runId = `sf3d-live-flame-${Date.now()}`;
  const t0 = performance.now();
  try {
    const result = await producer.run(image, {
      runId,
      onProgress: (msg) => {
        const m = /(\d+)\s*\/\s*(\d+)/.exec(String(msg));
        if (m) hud('sf3d-progress').value = Math.round(100 * Number(m[1]) / Number(m[2]));
        hud('sf3d-infer').textContent = String(msg).slice(0, 44);
      },
    });
    state.inferring = false;
    const wallMs = performance.now() - t0;
    const glbSha256 = await sha256Hex(result.glb);
    const canonical = glbSha256 === CANONICAL_DEMO_CHAIR_GLB_SHA256;
    const duties = ['dinov2-tokenizer', 'two-stream-backbone', 'post-processor', 'texture-bake']
      .map(k => result.cooperativeReports?.[k]?.submittedGpuDutyCount ?? '?');
    const gaps = summarizeGaps(state.inferenceGaps);
    state.lastResult = Object.freeze({
      runId, wallMs, glbSha256, canonical, glbBytes: result.glb.byteLength,
      numVertices: result.numVertices, numFaces: result.numFaces,
      duties: { 'dinov2-tokenizer': duties[0], 'two-stream-backbone': duties[1], 'post-processor': duties[2], 'texture-bake': duties[3] },
      cooperativeStatuses: Object.fromEntries(Object.entries(result.cooperativeReports || {}).map(([k, r]) => [k, r.status])),
      offloads: result.offloads,
      identity: result.identity,
      receiptValidation: result.receiptValidation,
      foregroundOpportunityReport: { status: result.foregroundOpportunityReport?.status ?? null, requestCount: result.foregroundOpportunityReport?.requestCount ?? null },
      framesDuringInference: state.framesDuringInference,
      inferenceGaps: gaps,
      deviceTopology: 'same-gpu-two-devices',
      fireStatus: hud('sf3d-fire').textContent,
      glb: result.glb,
    });
    hud('sf3d-infer').textContent = `done in ${(wallMs / 1000).toFixed(1)}s · ${result.numVertices}v/${result.numFaces}f`;
    hud('sf3d-infer').className = 'v good';
    hud('sf3d-duties').textContent = duties.join(' / ');
    hud('sf3d-glb').textContent = `${glbSha256.slice(0, 12)}… ${canonical ? '= canonical' : '≠ canonical'}`;
    hud('sf3d-glb').className = `v ${canonical ? 'good' : 'warn'}`;
    hud('sf3d-progress').value = 100;
    const dl = hud('sf3d-download');
    dl.style.display = 'block';
    dl.onclick = () => {
      const blob = new Blob([result.glb], { type: 'model/gltf-binary' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = `sf3d-live-flame-${runId}.glb`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    };
  } catch (error) {
    state.inferring = false;
    state.lastError = { message: error?.message || String(error), sf3dRun: error?.sf3dRun ?? null };
    hud('sf3d-infer').textContent = `error: ${state.lastError.message}`.slice(0, 60);
    hud('sf3d-infer').className = 'v bad';
    console.error('SF3D run failed:', error);
  } finally {
    button.disabled = false;
    button.textContent = 'Run SF3D again';
  }
}

export async function mountComposition({ prototype, params } = {}) {
  injectHud();
  startFrameMonitor();
  mirrorFireStatus();
  window.__flameVolumePrototype = prototype || window.__kaminosVolumePrototype || null;
  window.__compositionRoute = {
    settingsPreset: params?.get('settings_preset') || null,
    settingsPresetAuthority: params?.get('settings_preset_authority') || null,
    deviceTopology: 'same-gpu-two-devices',
    producer: 'sf3d.image-to-mesh.webgpu-local.v0',
  };
  window.__sf3dLiveFlame = state;

  // SF3D owns its device (no injected device on this app route); the app keeps its own.
  let producer;
  try {
    producer = await createSf3dProducer({
      weightsUrl: WEIGHTS_URL,
      onWeightsProgress: (received, total) => {
        if (total > 0) {
          const pct = Math.round(100 * received / total);
          hud('sf3d-weights').textContent = `loading ${pct}%`;
          hud('sf3d-progress').value = pct;
        }
      },
    });
  } catch (error) {
    hud('sf3d-weights').textContent = `error: ${error.message}`.slice(0, 60);
    hud('sf3d-weights').className = 'v bad';
    hud('sf3d-run').textContent = 'SF3D unavailable';
    throw error;
  }
  hud('sf3d-weights').textContent = `real (${producer.resources.weightsSource}, kit ${producer.kitVersion})`;
  hud('sf3d-weights').className = 'v good';
  hud('sf3d-progress').value = 0;
  window.__sf3dProducer = producer;

  const image = await loadImage(IMAGE_URL);
  const button = hud('sf3d-run');
  button.disabled = false;
  button.textContent = 'Run SF3D image → mesh (cooperative)';
  button.onclick = () => runSf3d(producer, image);
  window.__sf3dLiveFlameReady = true;
  return { producer, image };
}
