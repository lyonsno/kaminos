/**
 * moge-live-flame-core.mjs — shared-device composition of the Kaminos pyro
 * volume (live fire simulation, every frame) and MoGe-2 WebGPU cooperative
 * inference, in one page on one GPUDevice.
 *
 * Route identity is surfaced in the HUD: fire backend status, rolling frame
 * p95, frames observed during inference, weights source, and the scheduler
 * verification receipt status of the last run. Stub or unverified runs are
 * shown as such — the HUD never upgrades evidence.
 */
import * as THREE from 'three';
import { createKaminosVolumePrototype } from './volume-core.js';
import { MoGeInference, INFERENCE_LIMIT_KEYS } from './lib/moge-inference.js';

const hud = id => document.getElementById(id);
const state = {
  frameIntervals: [],
  framesDuringInference: 0,
  inferring: false,
  lastRouteResult: null,
};

// --- Shared GPUDevice: union of pyro-volume and inference requirements ---
async function createSharedGpu() {
  if (!navigator.gpu) throw new Error('WebGPU unavailable');
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('WebGPU adapter unavailable');
  const requiredLimits = {};
  for (const key of INFERENCE_LIMIT_KEYS) {
    if (Number.isFinite(adapter.limits?.[key])) requiredLimits[key] = adapter.limits[key];
  }
  // Pyro volume needs (volume-core ensureGpu): large storage binding + 9 storage buffers.
  if ((adapter.limits?.maxStorageBuffersPerShaderStage ?? 0) >= 9) {
    requiredLimits.maxStorageBuffersPerShaderStage = Math.max(
      requiredLimits.maxStorageBuffersPerShaderStage ?? 0, adapter.limits.maxStorageBuffersPerShaderStage);
  }
  const requiredFeatures = adapter.features?.has?.('timestamp-query') ? ['timestamp-query'] : [];
  const device = await adapter.requestDevice({ requiredFeatures, requiredLimits });
  const info = adapter.info || {};
  return {
    adapter,
    device,
    backendIdentity: {
      kind: 'webgpu-local',
      runtime: 'browser',
      adapterName: info.description || [info.vendor, info.architecture].filter(Boolean).join(' ') || 'unknown-webgpu-adapter',
      browser: navigator.userAgent,
      requestedFeatures: requiredFeatures,
      features: [...(device.features || [])].map(String),
      limits: requiredLimits,
      timestampQuery: requiredFeatures.length ? 'requested' : 'unavailable',
    },
  };
}

// --- Frame interval monitor (the independent liveness witness) ---
function startFrameMonitor() {
  let last = performance.now();
  const tick = now => {
    state.frameIntervals.push(now - last);
    if (state.frameIntervals.length > 600) state.frameIntervals.shift();
    if (state.inferring) state.framesDuringInference++;
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
const BONFIRE_CONTROLS = {
  volumeScene: 'bonfire_plume',
  density: 4.80, fire: 0.95, radiance: 1.90, absorption: 1.45, glow: 1.05,
  smoke: 2.80, curl: 3.40, microdetail: 2.50, interfaceShred: 1.85, fireLicks: 4.25,
  projection: 0.85, speed: 5.00, inputRadius: 0.16, flowRate: 0.24, fireScale: 0.78,
  detailScale: 2.75, plumeHeight: 2.20, windStrength: 0, windAngle: 0, windHeight: 0.15,
  canonicalSpread: 1.00, canonicalCenterline: 1.00, canonicalBodyBalance: 0.00,
  resolution: 96, renderScale: 0.85, fireRenderMode: 'stock',
};

// --- Fire volume on the shared device ---
function startFire(sharedGpuContext) {
  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 100);
  camera.position.set(0, 0.4, 2.4);
  camera.lookAt(0, 0.2, 0);
  camera.updateMatrixWorld(true);
  const controls = { enabled: false, target: new THREE.Vector3(0, 0.2, 0), update() {} };
  const prototype = createKaminosVolumePrototype({
    THREE,
    viewport: document.getElementById('viewport'),
    camera,
    controls,
    getControls: () => ({ ...BONFIRE_CONTROLS }),
    onStatus: status => {
      hud('hud-fire').textContent = status.error
        ? `error: ${status.error}` : (status.backend || status.phase || 'unknown');
      hud('hud-fire').className = `v ${status.error ? 'bad' : 'good'}`;
    },
    sharedGpuContext,
  });
  // Default composition renders raymarch smoke only and delegates fire to the
  // learned-splat path, which this minimal page does not feed; take the full
  // fire raymarch authority so the flame itself is visible.
  prototype.setSelectiveHeadLiveRenderComposition('raymarch-only-v0');
  prototype.setActive(true);
  window.__flameVolumePrototype = prototype;
  return prototype;
}

// --- MoGe on the same device ---
async function loadMoge(gpu) {
  const inference = new MoGeInference(gpu);
  await inference.init((received, total) => {
    const pct = total ? Math.round((received / total) * 100) : 0;
    hud('hud-weights').textContent = `loading ${pct}%`;
  });
  hud('hud-weights').textContent = inference.useRealWeights
    ? `real (${inference.weightsSource || 'local'})` : 'STUB — not authoritative';
  hud('hud-weights').className = `v ${inference.useRealWeights ? 'good' : 'bad'}`;
  window.__mogeInference = inference;
  return inference;
}

async function fetchTestImageData() {
  const img = new Image();
  img.src = './fixtures/moge-live-flame-source.png';
  try {
    await img.decode();
  } catch {
    // Fallback: synthesize a gradient test card so the button still works
    // without the fixture; the receipt records the artifact identity either way.
    const c = document.createElement('canvas');
    c.width = c.height = 518;
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 518, 518);
    g.addColorStop(0, '#7a4a2a'); g.addColorStop(1, '#1a2a3a');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 518, 518);
    ctx.fillStyle = '#c8b89a'; ctx.beginPath(); ctx.arc(259, 300, 120, 0, 7); ctx.fill();
    return ctx.getImageData(0, 0, 518, 518);
  }
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, img.width, img.height);
}

function paintDepth(result) {
  const canvas = document.getElementById('depth-canvas');
  canvas.width = result.width; canvas.height = result.height;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(result.width, result.height);
  let dMin = Infinity, dMax = -Infinity;
  for (const d of result.depth) if (isFinite(d)) { dMin = Math.min(dMin, d); dMax = Math.max(dMax, d); }
  const span = Math.max(dMax - dMin, 1e-6);
  for (let i = 0; i < result.depth.length; i++) {
    const t = 1 - (result.depth[i] - dMin) / span;
    img.data[i * 4] = 255 * Math.min(1, Math.max(0, 1.5 - Math.abs(4 * t - 3)));
    img.data[i * 4 + 1] = 255 * Math.min(1, Math.max(0, 1.5 - Math.abs(4 * t - 2)));
    img.data[i * 4 + 2] = 255 * Math.min(1, Math.max(0, 1.5 - Math.abs(4 * t - 1)));
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  document.getElementById('depth-panel').style.display = 'block';
}

async function runInference(inference) {
  const imageData = await fetchTestImageData();
  hud('hud-infer').textContent = 'running (cooperative)…';
  hud('hud-infer').className = 'v warn';
  state.framesDuringInference = 0;
  state.inferring = true;
  const t0 = performance.now();
  try {
    const result = await inference.run(imageData, {
      scheduler: { mode: 'cooperative', yieldMs: 4, vitBlockChunkSize: 1, waitForSubmittedWorkDone: true },
    });
    const elapsed = ((performance.now() - t0) / 1000).toFixed(2);
    state.inferring = false;
    state.lastRouteResult = result.routeResult || null;
    hud('hud-infer').textContent = `done in ${elapsed}s`;
    hud('hud-infer').className = 'v good';
    hud('hud-frames').textContent = String(state.framesDuringInference);
    hud('hud-frames').className = `v ${state.framesDuringInference > 30 ? 'good' : 'warn'}`;
    const sched = result.schedulerVerificationReceipt;
    hud('hud-sched').textContent = sched ? `${sched.status} / ${sched.classification}` : 'missing';
    hud('hud-sched').className = `v ${sched?.status === 'verified' ? 'good' : 'warn'}`;
    paintDepth(result);
  } catch (e) {
    state.inferring = false;
    hud('hud-infer').textContent = `error: ${e.message}`;
    hud('hud-infer').className = 'v bad';
    throw e;
  }
}

// --- Boot ---
(async () => {
  startFrameMonitor();
  const gpu = await createSharedGpu();
  window.__sharedGpuDevice = gpu.device;
  startFire({ device: gpu.device, adapter: gpu.adapter });
  const inference = await loadMoge(gpu);
  const button = document.getElementById('ignite');
  button.disabled = false;
  button.textContent = 'Run MoGe inference (cooperative)';
  button.onclick = async () => {
    button.disabled = true;
    try { await runInference(inference); } finally {
      button.disabled = false;
      button.textContent = 'Run again';
    }
  };
  window.__mogeLiveFlameReady = true;
})().catch(e => {
  hud('hud-fire').textContent = `boot error: ${e.message}`;
  hud('hud-fire').className = 'v bad';
  console.error(e);
});
