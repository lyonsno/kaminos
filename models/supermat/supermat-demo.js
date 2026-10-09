// SuperMat demo on one shared WebGPU device: a live animated scene keeps
// submitting frames through the kit foreground service while SuperMat runs as
// cooperative command duties that can be paused, resumed or stopped.
//
// Query: ?image_root=&image_path= (Kaminos /api/read) or ?image=<url>,
// ?weights=<base url> (default /scratch/supermat-weights/f32/),
// ?cooperative=0 for the blocking A/B, ?autopause=<ms after start> with
// ?pausefor=<ms> for an unattended pause/resume check.
import {
  createWebGpuForegroundService, createWebGpuInferenceControl, createWebGpuInferenceSession,
  requestBrowserWebGpuDevice,
} from '../../webgpu-inference-kit/src/core.js';
import { createSuperMatAdapter, SUPERMAT_ROUTE_ID } from './supermat-route.js';
import { decodeImageRgba } from './supermat-image.js';
import { compositeOnGray, resizeRgbaBilinear } from './supermat-preprocess.js';

const params = new URLSearchParams(location.search);
const weightsUrl = params.get('weights') ?? '/scratch/supermat-weights/f32/';
const imageUrl = params.get('image_root') && params.get('image_path')
  ? `/api/read?${new URLSearchParams({ root: params.get('image_root'), path: params.get('image_path') })}`
  : params.get('image');
const autopauseMs = params.has('autopause') ? Number(params.get('autopause')) : null;
const pauseForMs = Number(params.get('pausefor') ?? 1500);
const autostopMs = params.has('autostop') ? Number(params.get('autostop')) : null;
const repeat = Math.max(1, Number(params.get('repeat') ?? 1));
const state = window.__supermatDemo = { status: 'loading', error: null, runs: [], identity: null, imageSource: null };
const $ = id => document.getElementById(id);
$('cooperative').checked = params.get('cooperative') !== '0';
if (params.get('size')) $('size').value = params.get('size');
const attention = params.get('attention') ?? 'streaming';
let adapter, device, session, foreground, current = null, lastResult = null, active = null;

function setStatus(text, isError = false) {
  $('status').textContent = text;
  $('status').classList.toggle('error', isError);
}

function fail(error) {
  state.status = 'error';
  state.error = `${error?.name ?? 'Error'}: ${error?.message ?? String(error)}`;
  setStatus(state.error, true);
}

function draw(id, map, alpha) {
  const canvas = $(id);
  canvas.width = map.width;
  canvas.height = map.height;
  const data = new Uint8ClampedArray(map.data);
  if (alpha) for (let i = 0; i < alpha.length; i++) data[i * 4 + 3] = alpha[i];
  canvas.getContext('2d').putImageData(new ImageData(data, map.width, map.height), 0, 0);
}

function drawModelInput(image) {
  const planes = compositeOnGray(resizeRgbaBilinear(image, 512, 512)), plane = 512 * 512;
  const data = new Uint8ClampedArray(plane * 4);
  for (let i = 0; i < plane; i++) {
    for (let c = 0; c < 3; c++) data[i * 4 + c] = Math.round(planes[c * plane + i] * 255);
    data[i * 4 + 3] = 255;
  }
  draw('input', { width: 512, height: 512, data });
}

async function setDownload(id, map) {
  const canvas = new OffscreenCanvas(map.width, map.height);
  canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(map.data), map.width, map.height), 0, 0);
  const link = $(`${id}-link`);
  if (link.href) URL.revokeObjectURL(link.href);
  link.href = URL.createObjectURL(await canvas.convertToBlob({ type: 'image/png' }));
  link.hidden = false;
}

function render() {
  if (!lastResult) return;
  const alpha = $('mask').checked ? lastResult.alpha : null;
  for (const name of ['albedo', 'roughness', 'metallic']) draw(name, lastResult.maps[name], alpha);
}

// Live scene: a moving pattern rendered on the shared device every animation
// frame through the foreground service. Completed-frame gaps are recorded.
const SCENE_SHADER = `
struct U { time: f32, aspect: f32, pad: vec2f };
@group(0) @binding(0) var<uniform> u: U;
struct V { @builtin(position) p: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> V {
  let p = array(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3))[i];
  return V(vec4f(p, 0, 1), p * 0.5 + 0.5);
}
@fragment fn fs(v: V) -> @location(0) vec4f {
  let q = (v.uv - 0.5) * vec2f(u.aspect, 1.0);
  let a = u.time * 1.7;
  let marker = vec2f(cos(a), sin(a)) * 0.3;
  var c = vec3f(0.08, 0.09, 0.1) + 0.04 * sin(vec3f(18.0 * q.x + u.time * 3.0, 18.0 * q.y, 0.0));
  if (distance(q, marker) < 0.06) { c = vec3f(0.95, 0.62, 0.2); }
  return vec4f(c, 1.0);
}`;

function startScene() {
  const canvas = $('scene');
  const context = canvas.getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'opaque' });
  const uniform = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const module = device.createShaderModule({ code: SCENE_SHADER });
  const pipeline = device.createRenderPipeline({ layout: 'auto', vertex: { module, entryPoint: 'vs' },
    fragment: { module, entryPoint: 'fs', targets: [{ format }] } });
  const bindGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uniform } }] });
  const frames = { completed: 0, last: null, gaps: null };
  state.scene = frames;
  let sequence = 0;
  const frame = time => {
    const handle = foreground.request({ requestId: `scene:${++sequence}`, run(opportunity) {
      device.queue.writeBuffer(uniform, 0, new Float32Array([time / 1000, canvas.width / canvas.height, 0, 0]));
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: context.getCurrentTexture().createView(),
        loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(3);
      pass.end();
      opportunity.submit([encoder.finish()]);
    } });
    handle.completion.then(receipt => {
      if (receipt.status !== 'completed') return;
      const now = performance.now();
      if (frames.last !== null && frames.gaps) frames.gaps.push(now - frames.last);
      frames.last = now;
      frames.completed++;
      requestAnimationFrame(frame);
    });
  };
  requestAnimationFrame(frame);
}

function frameStats(gaps) {
  if (!gaps?.length) return null;
  const sorted = [...gaps].sort((a, b) => a - b);
  const at = q => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return { frames: gaps.length, p50: at(0.5), p95: at(0.95), p99: at(0.99), max: sorted.at(-1),
    over33ms: gaps.filter(gap => gap > 33.3).length, over100ms: gaps.filter(gap => gap > 100).length };
}

function setRunControls(running) {
  $('run').disabled = running || !current;
  $('pause').disabled = !running;
  $('stop').disabled = !running;
  $('pause').textContent = 'Pause';
}

async function load(blob, label) {
  try {
    current = await decodeImageRgba(blob, device);
    state.imageSource = label;
    drawModelInput(current);
    for (let index = 0; index < repeat; index++) {
      await infer({ final: index === repeat - 1 });
      if (state.runs.at(-1)?.status !== 'done') break;
    }
  } catch (error) { fail(error); }
}

async function infer({ final = true } = {}) {
  if (!current || !adapter || active) return;
  const cooperative = $('cooperative').checked;
  const runId = `supermat:${crypto.randomUUID()}`;
  const abort = new AbortController();
  const frames = state.scene;
  frames.gaps = [];
  const size = Number($('size').value);
  const record = { runId, cooperative, size, attention, pauses: [] };
  active = { abort, control: null, record };
  setRunControls(true);
  state.status = 'running';
  setStatus(`Inferring materials (${cooperative ? 'cooperative' : 'blocking'})…`);
  const started = performance.now();
  let frameRun = null, route = null;
  try {
    frameRun = await foreground.beginRun(runId);
    route = await session.registerRoute({ routeId: SUPERMAT_ROUTE_ID, runtimeOptions: {
      runtimeLabel: 'supermat-demo', kernel: { profile: 'supermat-f32-v0' },
      foregroundOpportunities: frameRun.foregroundOpportunities } });
    const control = cooperative ? createWebGpuInferenceControl({ queue: device.queue, signal: abort.signal,
      withForeground: frameRun.withForeground }) : null;
    active.control = control;
    if (autopauseMs !== null && control) {
      setTimeout(async () => {
        if (!active?.control) return;
        const requested = performance.now();
        await togglePause();
        const paused = performance.now();
        const framesAtPause = frames.completed;
        setTimeout(async () => {
          const framesDuringPause = frames.completed - framesAtPause;
          await togglePause();
          record.pauses.push({ requestedAtMs: requested - started, pauseSettledMs: paused - requested,
            heldMs: performance.now() - paused, framesDuringPause });
        }, pauseForMs);
      }, autopauseMs);
    }
    if (autostopMs !== null) setTimeout(() => {
      record.stopRequestedAtMs = performance.now() - started;
      active?.abort.abort(new Error('stopped by autostop'));
    }, autostopMs);
    const job = route.enqueue({ jobId: runId, execute: invocation => adapter.run({ image: current, size,
      schedule: cooperative ? { runtime: route.runtime, invocation, control, signal: abort.signal } : null }) });
    const completion = await job.completion;
    if (completion.status !== 'succeeded') {
      const failure = completion.failure;
      const error = new Error(failure?.message ?? completion.status);
      error.name = failure?.name ?? 'Error';
      throw error;
    }
    lastResult = completion.output;
    const wallMs = performance.now() - started;
    record.wallMs = wallMs;
    record.timings = lastResult.timings;
    record.dutyCount = lastResult.dutyCount;
    record.longestDutyQueueMs = Math.max(0, ...lastResult.duties.map(duty => duty.queueMs ?? 0));
    record.slowestDuties = [...lastResult.duties].sort((a, b) => (b.queueMs ?? 0) - (a.queueMs ?? 0)).slice(0, 6)
      .map(({ label, queueMs, estimatedFlops, gateWaitMs }) => ({ label, queueMs, gflops: estimatedFlops / 1e9, gateWaitMs }));
    render();
    await Promise.all(['albedo', 'roughness', 'metallic'].map(name => setDownload(name, lastResult.maps[name])));
    record.status = 'done';
    setStatus(`Done in ${(wallMs / 1000).toFixed(2)} s. Drop another image or choose a file.`);
  } catch (error) {
    record.status = abort.signal.aborted ? 'stopped' : 'error';
    record.stoppedAtMs = performance.now() - started;
    record.error = `${error?.name ?? 'Error'}: ${error?.message ?? String(error)}`;
    if (record.status === 'stopped') setStatus('Stopped.'); else fail(error);
  } finally {
    try { await active.control?.close(); } catch (error) { record.controlCloseError = String(error?.message ?? error); }
    if (route) { await route.drain(); session.unregisterRoute(route.routeId); }
    if (frameRun) await frameRun.finish();
    record.frames = frameStats(frames.gaps);
    frames.gaps = null;
    state.runs.push(record);
    showRun(record);
    if (state.status !== 'error') state.status = final || record.status !== 'done' ? record.status : 'running';
    active = null;
    setRunControls(false);
  }
}

function showRun(record) {
  const t = record.timings, f = record.frames, ms = value => `${value.toFixed(0)} ms`;
  const lines = [`${record.size}×${record.size} ${record.cooperative ? 'cooperative' : 'blocking'} run (${record.attention} attention): ${record.status}`
    + (record.wallMs ? `, ${ms(record.wallMs)} wall` : '')];
  if (t) lines.push(`preprocess ${ms(t.preprocessMs)} · encode ${ms(t.encodeMs)} · unet ${ms(t.unetMs)}`
    + ` · decode albedo ${ms(t.decodeAlbedoMs)} · decode orm ${ms(t.decodeOrmMs)}`
    + (record.dutyCount ? ` · ${record.dutyCount} duties, longest ${ms(record.longestDutyQueueMs)}` : ''));
  if (f) lines.push(`scene during run: ${f.frames} frames · p50 ${ms(f.p50)} · p95 ${ms(f.p95)} · max ${ms(f.max)}`
    + ` · ${f.over33ms} gaps > 33 ms · ${f.over100ms} gaps > 100 ms`);
  for (const pause of record.pauses) lines.push(`paused ${ms(pause.heldMs)} after ${ms(pause.pauseSettledMs)} to settle;`
    + ` scene drew ${pause.framesDuringPause} frames while paused`);
  if (adapter) lines.push(`route ${adapter.identity.routeId} · backend ${adapter.identity.backend} · weights ${adapter.identity.weightDtype}`);
  $('timings').textContent = lines.join('\n');
}

async function togglePause() {
  const control = active?.control;
  if (!control) return;
  const button = $('pause');
  button.disabled = true;
  try {
    if (control.snapshot().status === 'paused' || control.snapshot().pauseRequested) {
      await control.resume();
      button.textContent = 'Pause';
      setStatus('Resumed.');
    } else {
      setStatus('Pausing at the next duty boundary…');
      await control.pause();
      button.textContent = 'Resume';
      setStatus('Paused. The scene keeps running; model memory stays resident.');
    }
  } finally { button.disabled = !active; }
}

$('file').addEventListener('change', event => {
  const file = event.target.files?.[0];
  if (file) load(file, `file:${file.name}`);
});
$('run').addEventListener('click', infer);
$('pause').addEventListener('click', togglePause);
$('stop').addEventListener('click', () => active?.abort.abort(new Error('stopped by user')));
$('cooperative').addEventListener('change', () => {
  if (!$('cooperative').checked) $('pause').title = 'Pause needs cooperative mode';
});
$('mask').addEventListener('change', render);
const drop = $('drop');
drop.addEventListener('dragover', event => { event.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', event => {
  event.preventDefault();
  drop.classList.remove('over');
  const file = event.dataTransfer.files?.[0];
  if (file) load(file, `drop:${file.name}`);
});

try {
  if (!navigator.gpu) throw new Error('WebGPU is not available in this browser');
  const context = await requestBrowserWebGpuDevice(navigator.gpu, { adapterName: 'supermat-demo' });
  device = context.device;
  foreground = createWebGpuForegroundService({ routeId: SUPERMAT_ROUTE_ID, device });
  session = await createWebGpuInferenceSession({ sessionId: crypto.randomUUID(), device, adapter: context.adapter,
    backendIdentity: context.backendIdentity });
  startScene();
  const weightsRoute = await session.registerRoute({ routeId: `${SUPERMAT_ROUTE_ID}.resident-weights` });
  adapter = await createSuperMatAdapter({ route: weightsRoute, weightsUrl, attention, onProgress(event) {
    if (event.phase === 'weights') {
      const mb = value => (value / 1e6).toFixed(0);
      setStatus(`Loading weights ${event.resourceIndex + 1}/${event.resourceCount} (${event.resourceId}`
        + `${event.totalBytes ? `, ${mb(event.loadedBytes)}/${mb(event.totalBytes)} MB` : ''})…`);
    }
  } });
  state.identity = adapter.identity;
  state.weightLoadMs = adapter.weightLoadMs;
  state.status = 'ready';
  setStatus(`Model resident (${(adapter.weightLoadMs / 1000).toFixed(1)} s load). Choose or drop an image.`);
  if (imageUrl) {
    const response = await fetch(imageUrl);
    if (!response.ok) throw new Error(`image ${imageUrl}: HTTP ${response.status}`);
    await load(await response.blob(), imageUrl);
  }
} catch (error) { fail(error); }
