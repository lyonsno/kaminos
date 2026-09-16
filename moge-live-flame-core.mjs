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
import { INFERENCE_LIMIT_KEYS, borrowedDeviceBackendIdentity } from './lib/moge-inference.js';

import {
  hud, state, startFrameMonitor, loadMoge, restoreLastRunTelemetry, runInference,
} from './moge-live-flame-shared.mjs';

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
  return {
    adapter,
    device,
    // Kit shared-helper identity for the borrowed/shared device (the kit's
    // gpu-environment owns identity shape and validation semantics).
    backendIdentity: borrowedDeviceBackendIdentity({
      adapter, device, requestedFeatures: requiredFeatures,
    }),
  };
}

// --- Frame interval monitor (the independent liveness witness) ---

const FLAME_CONTROLS = {
  // tall_plume is the gate for the current fire pipeline (bonfire_plume runs
  // the legacy path). Values mirror the main app's VOLUME_SCENE_PRESETS.tall_plume.
  volumeScene: 'tall_plume',
  density: 6.00, fire: 1.15, radiance: 3.00, absorption: 2.00, glow: 1.20,
  smoke: 2.80, curl: 3.80, microdetail: 2.50, interfaceShred: 1.20, fireLicks: 5.00,
  projection: 0.90, speed: 5.00, inputRadius: 0.08, flowRate: 0.45, fireScale: 0.35,
  detailScale: 3.20, plumeHeight: 2.20, windStrength: 0, windAngle: 0, windHeight: 0.15,
  canonicalSpread: 1.00, canonicalCenterline: 1.00, canonicalBodyBalance: 0.00,
  resolution: 96, renderScale: 0.85, fireRenderMode: 'stock', boundarySplatMode: 'learned',
  quenchVapor: 0,
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
    getControls: () => ({ ...FLAME_CONTROLS }),
    onStatus: status => {
      hud('hud-fire').textContent = status.error
        ? `error: ${status.error}` : (status.backend || status.phase || 'unknown');
      hud('hud-fire').className = `v ${status.error ? 'bad' : 'good'}`;
    },
    sharedGpuContext,
  });
  // Current fire pipeline: learned boundary-splat fire authority over smoke
  // raymarch (the main app's composition), enabled by tall_plume +
  // boundarySplatMode 'learned'. raymarch-only-v0 was the legacy diagnostic.
  prototype.setSelectiveHeadLiveRenderComposition('raymarch-only-v0');
  // The learned splat fire renders from the selective-head live capture; the
  // main app seats this role before activation (index.html init order).
  prototype.setSelectiveHeadLiveRole('truthHigh');
  prototype.setActive(true);
  window.__flameVolumePrototype = prototype;
  return prototype;
}

// --- MoGe on the same device ---

(async () => {
  restoreLastRunTelemetry();
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

