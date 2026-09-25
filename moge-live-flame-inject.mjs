/**
 * moge-live-flame-inject.mjs — composition module for the live Kaminos app.
 *
 * Loaded by index.html's optional `?composition_module_url=` seam after the
 * volume prototype exists. Runs MoGe-2 cooperative inference alongside the
 * app's own fire route (the real basin/preset pipeline, e.g. a mounted basin
 * promotion package's loader route) and shows the same evidence HUD as the
 * standalone page.
 *
 * Device topology, stated honestly: the app does not expose its GPUDevice, so
 * MoGe acquires its own device through the kit's shared helper — SAME GPU,
 * TWO DEVICES. The HUD labels it so. The one-GPUDevice composition remains the
 * standalone moge-live-flame.html page.
 */
import { initGPU } from './lib/moge-inference.js';
import {
  hud, state, startFrameMonitor, loadMoge, restoreLastRunTelemetry, runInference,
} from './moge-live-flame-shared.mjs';

function injectHud() {
  const style = document.createElement('style');
  style.textContent = `
    #hud { position: fixed; top: 12px; right: 12px; z-index: 10000; width: 340px;
      background: rgba(10,10,14,0.88); border: 1px solid #2a2a33; border-radius: 10px;
      padding: 14px 16px; color: #e8e4da; font-family: system-ui, sans-serif; backdrop-filter: blur(6px); }
    #hud h1 { font-size: 0.95rem; font-weight: 600; margin: 0 0 2px; }
    #hud .sub { color: #8f8a7e; font-size: 0.72rem; margin-bottom: 10px; }
    #hud .row { display: flex; justify-content: space-between; font-size: 0.78rem; padding: 2px 0; }
    #hud .row .k { color: #9a958a; } #hud .row .v { font-variant-numeric: tabular-nums; }
    #ignite { margin-top: 10px; width: 100%; padding: 9px 0; font-size: 0.85rem; font-weight: 600;
      background: #b3502a; color: #fff; border: none; border-radius: 7px; cursor: pointer; }
    #ignite:disabled { background: #3a3a42; color: #777; cursor: default; }
    #depth-panel { position: fixed; right: 12px; bottom: 12px; z-index: 10000; display: none;
      background: rgba(10,10,14,0.88); border: 1px solid #2a2a33; border-radius: 10px; padding: 8px; }
    #depth-panel h3 { font-size: 0.68rem; color: #9a958a; text-transform: uppercase; letter-spacing: 0.06em; margin: 0 0 6px; }
    #depth-canvas { width: 296px; height: 296px; border-radius: 6px; display: block; }
    #hud .warn { color: #d9a04a; } #hud .good { color: #79c98f; } #hud .bad { color: #e06c5a; }
  `;
  document.head.appendChild(style);
  const hudEl = document.createElement('div');
  hudEl.id = 'hud';
  hudEl.innerHTML = `
    <h1>MoGe × Live App Route</h1>
    <div class="sub">Composition module: app fire route (this basin/preset) + MoGe-2 ViT-L cooperative inference — same GPU, two devices</div>
    <div class="row"><span class="k">fire</span><span class="v" id="hud-fire">—</span></div>
    <div class="row"><span class="k">frame p95 (rolling)</span><span class="v" id="hud-p95">—</span></div>
    <div class="row"><span class="k">frames during inference</span><span class="v" id="hud-frames">—</span></div>
    <div class="row"><span class="k">weights</span><span class="v" id="hud-weights">not loaded</span></div>
    <div class="row"><span class="k">inference</span><span class="v" id="hud-infer">idle</span></div>
    <div class="row"><span class="k">scheduler receipt</span><span class="v" id="hud-sched">—</span></div>
    <button id="ignite" disabled>Loading weights…</button>`;
  document.body.appendChild(hudEl);
  const depth = document.createElement('div');
  depth.id = 'depth-panel';
  depth.innerHTML = `<h3>MoGe depth (live)</h3><canvas id="depth-canvas" width="296" height="296"></canvas>`;
  document.body.appendChild(depth);
}

function mirrorFireStatus() {
  const src = document.getElementById('volume-backend');
  const paint = () => {
    const text = src?.textContent?.trim() || 'unknown';
    hud('hud-fire').textContent = text;
    hud('hud-fire').className = `v ${/error|unavailable/i.test(text) ? 'bad' : 'good'}`;
  };
  paint();
  if (src) new MutationObserver(paint).observe(src, { childList: true, characterData: true, subtree: true });
}

export async function mountComposition({ prototype, params } = {}) {
  injectHud();
  restoreLastRunTelemetry();
  startFrameMonitor();
  mirrorFireStatus();
  window.__flameVolumePrototype = prototype || window.__kaminosVolumePrototype || null;
  window.__compositionRoute = {
    settingsPreset: params?.get('settings_preset') || null,
    settingsPresetAuthority: params?.get('settings_preset_authority') || null,
    deviceTopology: 'same-gpu-two-devices',
  };

  // MoGe owns its device (kit shared helper); the app keeps its own.
  const gpu = await initGPU();
  window.__mogeGpuDevice = gpu.device;
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
  return { inference, gpu };
}
