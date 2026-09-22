import {
  KIMODO_DEFAULT_MAX_IN_FLIGHT_DUTIES,
  createKimodoProducer,
} from './artifacts/kimodo-shared-device/lib/producer.js';
import { createFrontendTelemetry, KIMODO_ROUTE_ID } from './artifacts/kimodo-shared-device/lib/telemetry.js';
import {
  connectKimodoSharedDeviceForeground,
  sharedGpuDeviceRequirements,
  snapshotKimodoSharedDevice,
} from './kimodo-shared-device-host.mjs';

export { sharedGpuDeviceRequirements };

const $ = id => document.getElementById(`kimodo-shared-${id}`);
const percentile = (values, q) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : null;
};
const formatMs = value => Number.isFinite(value) ? `${value.toFixed(1)} ms` : 'unmeasured';

function injectHud() {
  const root = document.createElement('aside');
  root.id = 'kimodo-shared-device-hud';
  root.innerHTML = `<style>
    #kimodo-shared-device-hud{position:fixed;right:14px;top:14px;z-index:10000;width:min(380px,calc(100vw - 52px));max-height:calc(100vh - 40px);overflow:auto;padding:16px;background:rgba(8,15,25,.94);border:1px solid #3d6787;border-radius:12px;color:#e9f4ff;font:12px system-ui;box-shadow:0 14px 44px #0009;backdrop-filter:blur(8px)}
    #kimodo-shared-device-hud h1{font-size:18px;margin:0 0 4px}#kimodo-shared-device-hud .sub{color:#9fb6c9;line-height:1.4;margin:0 0 12px}
    #kimodo-shared-device-hud label{display:block;margin:7px 0}#kimodo-shared-device-hud input,#kimodo-shared-device-hud textarea{box-sizing:border-box;width:100%;padding:6px;background:#0e1c2a;color:#edf7ff;border:1px solid #3f5b72;border-radius:5px;font:inherit}
    #kimodo-shared-device-hud .pair{display:flex;gap:8px}#kimodo-shared-device-hud .pair label{flex:1}
    #kimodo-shared-device-hud button{padding:8px;border:1px solid #4f7fa2;border-radius:6px;background:#145c8d;color:#fff;cursor:pointer;font:inherit}#kimodo-shared-device-hud button:disabled{opacity:.45;cursor:default}
    #kimodo-shared-device-hud progress{width:100%;margin:9px 0}#kimodo-shared-device-hud dl{display:grid;grid-template-columns:112px 1fr;gap:5px;margin:9px 0}#kimodo-shared-device-hud dt{color:#95aec2}#kimodo-shared-device-hud dd{margin:0;overflow-wrap:anywhere;font-variant-numeric:tabular-nums}
    #kimodo-shared-error{color:#ff9b92;white-space:pre-wrap}#kimodo-shared-motion{width:100%;height:178px;background:#07111c;border:1px solid #294b64;border-radius:6px}
  </style>
  <h1>Kimodo × live flame</h1>
  <p class="sub">One host-owned GPUDevice · exact shared queue · full 16-layer passes · persistent inference-kit foreground service.</p>
  <label>Prompt<textarea id="kimodo-shared-prompt" rows="2">a person dances</textarea></label>
  <div class="pair"><label>Seconds<input id="kimodo-shared-duration" type="number" min="1" max="18" value="6"></label><label>DDIM steps<input id="kimodo-shared-steps" type="number" min="1" value="100"></label></div>
  <label>Embedding endpoint<input id="kimodo-shared-embed" value="http://127.0.0.1:8098/embed"></label>
  <div class="pair"><button id="kimodo-shared-load">Load Kimodo</button><button id="kimodo-shared-run" disabled>Generate motion</button><button id="kimodo-shared-cancel" disabled>Cancel</button></div>
  <progress id="kimodo-shared-progress" max="100" value="0"></progress>
  <dl><dt>Topology</dt><dd id="kimodo-shared-topology">same-device verification pending</dd>
  <dt>Stage</dt><dd id="kimodo-shared-stage">flame only · model not loaded</dd>
  <dt>Page p95</dt><dd id="kimodo-shared-p95">unmeasured</dd>
  <dt>Flame</dt><dd id="kimodo-shared-flame">unverified</dd>
  <dt>Foreground</dt><dd id="kimodo-shared-foreground">service not connected</dd>
  <dt>Run</dt><dd id="kimodo-shared-result">—</dd></dl>
  <div id="kimodo-shared-error" role="alert"></div>
  <canvas id="kimodo-shared-motion" width="680" height="356" aria-label="Generated 30-joint motion playback"></canvas>`;
  document.body.appendChild(root);
}

function drawMotion(motion, startedAtMs) {
  const canvas = $('motion');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!motion) {
    ctx.fillStyle = '#819bb0';
    ctx.font = '21px system-ui';
    ctx.fillText('Generated motion will play here', 22, 180);
    return;
  }
  const elapsed = Math.max(0, performance.now() - startedAtMs);
  const frame = Math.floor(elapsed * motion.fps / 1000) % motion.numFrames;
  const joints = motion.joints[frame];
  const center = joints[0];
  const project = ([x, y, z]) => [340 + ((x - center[0]) * .86 + (z - center[2]) * .52) * 128, 292 - y * 128];
  ctx.strokeStyle = '#74d3ff';
  ctx.lineWidth = 4;
  ctx.beginPath();
  joints.forEach((joint, index) => {
    const parent = motion.parents[index];
    if (parent < 0) return;
    const a = project(joint);
    const b = project(joints[parent]);
    ctx.moveTo(...a);
    ctx.lineTo(...b);
  });
  ctx.stroke();
  ctx.fillStyle = '#e7f9ff';
  joints.forEach(joint => {
    ctx.beginPath();
    ctx.arc(...project(joint), 3, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.fillStyle = '#819bb0';
  ctx.font = '17px system-ui';
  ctx.fillText(`frame ${frame + 1}/${motion.numFrames} · ${motion.fps} fps`, 14, 24);
}

export async function mountComposition({ prototype, sharedGpu, host } = {}) {
  if (!prototype?.debugState || !host) throw new Error('Kimodo composition requires the live Kaminos volume host');
  injectHud();
  const deviceReceipt = snapshotKimodoSharedDevice(sharedGpu);
  const state = {
    schema: 'kimodo.live-flame-shared-device.v0',
    status: 'idle',
    deviceTopology: 'same-device',
    queueTopology: 'exact-device-queue',
    deviceReceipt,
    source: null,
    samples: [],
    frameIntervals: [],
    foregroundReceipts: [],
    runs: [],
    lastError: null,
  };
  window.__kimodoSharedDevice = state;
  $('topology').textContent = `same GPUDevice + exact queue · kit ${deviceReceipt.kitVersion}`;

  let producer = null;
  let foreground = null;
  let controller = null;
  let activeGeneration = null;
  let motion = null;
  let motionStartedAtMs = 0;
  let lastFrameAt = performance.now();
  let raf = 0;
  let lastPaintAt = 0;
  let generationSequence = 0;

  const frame = now => {
    const flame = prototype.debugState();
    const dt = now - lastFrameAt;
    lastFrameAt = now;
    state.frameIntervals.push(dt);
    state.samples.push({
      atMs: now,
      status: state.status,
      frameCount: flame.frameCount,
      simStepCount: flame.simStepCount,
      backend: flame.backend,
      active: flame.active,
      error: flame.error ?? null,
      foreground: flame.ordinaryForeground ?? null,
    });
    drawMotion(motion, motionStartedAtMs);
    if (now - lastPaintAt >= 250) {
      const p95 = percentile(state.frameIntervals, .95);
      $('p95').textContent = formatMs(p95);
      $('flame').textContent = `${flame.backend || 'unknown'} · frame ${flame.frameCount ?? '?'} / sim ${flame.simStepCount ?? '?'} · ${flame.active ? 'active' : 'inactive'}`;
      const snapshot = foreground?.snapshot();
      $('foreground').textContent = snapshot
        ? `${snapshot.activeRun || 'idle'} · ${state.foregroundReceipts.length} completed frame receipts`
        : 'service not connected';
      lastPaintAt = now;
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  // Seat the persistent requester before source fetch and model allocation so
  // the ordinary flame remains the product frame owner throughout model load,
  // between generations, and after generation. Producer admission remains a
  // separate exact-device check once its buffers exist.
  foreground = connectKimodoSharedDeviceForeground({
    prototype,
    host,
    sharedGpu,
    onReceipt: receipt => state.foregroundReceipts.push(receipt),
  });

  $('cancel').onclick = () => controller?.abort('operator-cancel');
  $('load').onclick = async () => {
    if (producer) return;
    $('load').disabled = true;
    $('embed').disabled = true;
    state.status = 'loading';
    $('stage').textContent = 'loading source manifest and Kimodo weights';
    try {
      const response = await fetch('./artifacts/kimodo-shared-device/manifest.json', { cache: 'no-store' });
      if (!response.ok) throw new Error(`Kimodo source manifest unavailable (${response.status})`);
      state.source = await response.json();
      if (state.source.status !== 'built') throw new Error('Kimodo derived library is incomplete');
      producer = await createKimodoProducer({
        device: sharedGpu.device,
        adapter: sharedGpu.adapter,
        backendIdentity: sharedGpu.backendIdentity,
        assetBase: './artifacts/kimodo-shared-device/assets',
        embedUrl: $('embed').value,
        onLoadProgress: ({ loaded, total }) => {
          $('stage').textContent = `loading weights · ${(loaded / 1048576).toFixed(0)} MiB`;
          if (total) $('progress').value = 100 * loaded / total;
        },
      });
      if (producer.identity.model.weightsHash !== state.source.assets['kimodo.bin'].sha256) {
        throw new Error('loaded Kimodo weights differ from the source manifest');
      }
      foreground.attachProducer(producer);
      state.producerIdentity = producer.identity;
      state.status = 'loaded';
      $('stage').textContent = 'model loaded · persistent foreground service connected';
      $('progress').value = 0;
      $('run').disabled = false;
      $('load').textContent = 'Model loaded';
    } catch (error) {
      state.status = 'failed';
      state.lastError = { phase: 'load', message: error?.message || String(error) };
      $('error').textContent = state.lastError.message;
      producer?.dispose();
      producer = null;
      $('load').disabled = false;
    }
  };

  $('run').onclick = async () => {
    if (!producer || !foreground || activeGeneration) return;
    const prompt = $('prompt').value.trim();
    const steps = Number($('steps').value);
    const duration = Number($('duration').value);
    if (!prompt || !Number.isSafeInteger(steps) || steps < 1 || !Number.isFinite(duration) || duration < 1 || duration > 18) {
      $('error').textContent = 'Use a prompt, a positive integer step count, and 1–18 seconds.';
      return;
    }
    $('error').textContent = '';
    $('run').disabled = true;
    $('cancel').disabled = false;
    for (const id of ['prompt', 'steps', 'duration']) $(id).disabled = true;
    const generationId = ++generationSequence;
    const runId = `kimodo-shared-${Date.now()}-${generationId}`;
    const record = {
      runId,
      generationId,
      prompt,
      steps,
      duration,
      startedAtMs: performance.now(),
      status: 'running',
      deviceTopology: 'same-device',
      foregroundReceiptStart: state.foregroundReceipts.length,
      frameIntervalStart: state.frameIntervals.length,
      flameBefore: prototype.debugState(),
    };
    state.runs.push(record);
    state.status = 'running';
    controller = new AbortController();
    const telemetry = createFrontendTelemetry({
      generationId,
      numSteps: steps,
      requestedMaxInFlightDuties: KIMODO_DEFAULT_MAX_IN_FLIGHT_DUTIES,
    });
    let run = null;
    let generationError = null;
    try {
      run = await foreground.beginRun(runId);
      activeGeneration = producer.generate({
        prompt,
        steps,
        duration,
        generationId,
        signal: controller.signal,
        embedUrl: $('embed').value,
        onStage: (name, event) => {
          telemetry.stage(name, event);
          $('stage').textContent = `${name} · ${event}`;
        },
        onProgress: progress => {
          telemetry.progress(progress);
          $('progress').value = progress.pct;
        },
        foregroundWindow: (phase, work) => run.withForeground(phase, work),
        foregroundOpportunity: boundary => {
          telemetry.foreground(boundary);
          return run.foregroundOpportunity(boundary);
        },
      });
      const result = await activeGeneration;
      motion = result.motion;
      motionStartedAtMs = performance.now();
      telemetry.succeed(result.receipt, result.submission);
      record.receipt = result.receipt;
      record.submission = result.submission;
      record.motion = { numFrames: motion.numFrames, numJoints: motion.numJoints, fps: motion.fps };
      record.status = 'succeeded';
      state.status = 'succeeded';
    } catch (error) {
      generationError = error;
      telemetry.fail(error);
      record.status = controller.signal.aborted ? 'canceled' : 'failed';
      record.error = { phase: error?.phase || 'generation', message: error?.message || String(error) };
      state.lastError = record.error;
      state.status = record.status;
      $('error').textContent = record.error.message;
    } finally {
      if (run) {
        try {
          record.foregroundRunReport = await run.finish();
        } catch (finishError) {
          record.foregroundFinishError = finishError?.message || String(finishError);
          if (!generationError) {
            record.status = 'failed';
            state.status = 'failed';
            state.lastError = { phase: 'foreground-finish', message: record.foregroundFinishError };
            $('error').textContent = state.lastError.message;
          }
        }
      }
      record.endedAtMs = performance.now();
      record.wallMs = record.endedAtMs - record.startedAtMs;
      record.frameIntervals = state.frameIntervals.slice(record.frameIntervalStart);
      record.pageP95Ms = percentile(record.frameIntervals, .95);
      record.pageP99Ms = percentile(record.frameIntervals, .99);
      record.pageMaxMs = record.frameIntervals.length ? Math.max(...record.frameIntervals) : null;
      record.frameIntervalsOver33Ms = record.frameIntervals.filter(value => value > 33).length;
      record.frameIntervalsOver100Ms = record.frameIntervals.filter(value => value > 100).length;
      record.telemetry = telemetry.snapshot();
      record.foregroundReceipts = state.foregroundReceipts.slice(record.foregroundReceiptStart);
      record.flameAfter = prototype.debugState();
      record.foregroundSnapshot = foreground.snapshot();
      $('result').textContent = `${record.status} · ${(record.wallMs / 1000).toFixed(1)} s · ${record.foregroundReceipts.length} ordinary frames`;
      $('stage').textContent = `${record.status} · ${record.telemetry.currentStage}`;
      activeGeneration = null;
      controller = null;
      $('cancel').disabled = true;
      $('run').disabled = false;
      for (const id of ['prompt', 'steps', 'duration']) $(id).disabled = false;
    }
  };

  addEventListener('pagehide', () => {
    cancelAnimationFrame(raf);
    controller?.abort('pagehide');
    Promise.resolve(activeGeneration).catch(() => {}).finally(async () => {
      try { await foreground?.dispose(); } catch {}
      producer?.dispose();
    });
  }, { once: true });

  return Object.freeze({ state, deviceReceipt });
}
