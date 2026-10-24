// FLUX.2 Klein demo: text-to-image beside a live WebGPU scene on one device.
// The scene submits frames through the kit foreground service; a cooperative run is a
// queued job on a kit route whose command duties let pending frames submit first, with
// pause/resume/stop through the kit inference control. A blocking run submits per block
// without yielding to the scene. Frame gaps during each run are recorded.
import { KleinPipeline } from './klein-pipeline.js';
import { createKleinApp } from './klein-app.js';
export { KLEIN_ROUTE_ID } from './klein-app.js';

// The live scene: a little blue engine with a grey face and two coaches running round a track,
// puffing smoke. Cheap signed-distance shapes; its job is to show frames keep coming during inference.
const SCENE_SHADER = `
struct Scene { time: f32, aspect: f32, pad: vec2f };
@group(0) @binding(0) var<uniform> scene: Scene;
struct V { @builtin(position) position: vec4f, @location(0) uv: vec2f };
@vertex fn vertex(@builtin(vertex_index) i: u32) -> V {
  let p = array(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3))[i];
  return V(vec4f(p, 0, 1), p * 0.5 + 0.5);
}
const R = 0.285;
const AA = 0.006;
fn box(p: vec2f, b: vec2f, r: f32) -> f32 {
  let q = abs(p) - b + vec2f(r);
  return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - r;
}
fn fill(d: f32) -> f32 { return 1.0 - smoothstep(-AA, AA, d); }
// Position c in the frame of a carriage at angle t on the track: x along the direction of travel.
fn local(c: vec2f, t: f32) -> vec2f {
  let d = c - R * vec2f(cos(t), sin(t));
  return vec2f(dot(d, vec2f(-sin(t), cos(t))), dot(d, vec2f(cos(t), sin(t))));
}
@fragment fn fragment(v: V) -> @location(0) vec4f {
  let c = (v.uv - vec2f(0.5)) * vec2f(scene.aspect, 1.0);
  let r = length(c);
  var color = vec3f(0.07, 0.08, 0.09);
  // Track: sleepers, then two rails.
  let phi = atan2(c.y, c.x);
  let sleeper = step(fract(phi / 6.2831853 * 44.0), 0.3) * fill(abs(r - R) - 0.03);
  color = mix(color, vec3f(0.33, 0.22, 0.13), sleeper);
  color = mix(color, vec3f(0.62, 0.65, 0.68), fill(abs(r - (R - 0.014)) - 0.0035) + fill(abs(r - (R + 0.014)) - 0.0035));
  let a = scene.time * 1.4;
  // Two coaches behind the engine.
  for (var k = 1; k <= 2; k++) {
    let p = local(c, a - 0.36 * f32(k));
    color = mix(color, vec3f(0.80, 0.42, 0.18), fill(box(p, vec2f(0.05, 0.034), 0.012)));
    color = mix(color, vec3f(0.95, 0.85, 0.55), fill(box(p - vec2f(0.0, 0.0), vec2f(0.032, 0.014), 0.004)));
  }
  // The engine: blue body, red buffer beam, grey face with eyes at the front.
  let e = local(c, a);
  color = mix(color, vec3f(0.12, 0.40, 0.86), fill(box(e, vec2f(0.062, 0.04), 0.012)));
  color = mix(color, vec3f(0.82, 0.12, 0.10), fill(box(e - vec2f(0.066, 0.0), vec2f(0.008, 0.044), 0.003)));
  color = mix(color, vec3f(0.72, 0.74, 0.76), fill(length(e - vec2f(0.05, 0.0)) - 0.03));
  color = mix(color, vec3f(0.05, 0.05, 0.06), fill(length(e - vec2f(0.058, 0.011)) - 0.005) + fill(length(e - vec2f(0.058, -0.011)) - 0.005));
  color = mix(color, vec3f(0.05, 0.05, 0.06), fill(abs(length(e - vec2f(0.05, 0.0)) - 0.016) - 0.002) * step(e.x, 0.044));
  // Smoke drifting back from the funnel and fading.
  for (var k = 0; k < 3; k++) {
    let ph = fract(scene.time * 1.1 + f32(k) / 3.0);
    let puff = e - vec2f(0.02 - ph * 0.14, 0.02 + ph * 0.06);
    color = mix(color, vec3f(0.86, 0.88, 0.9), fill(length(puff) - (0.012 + ph * 0.03)) * (1.0 - ph) * 0.7);
  }
  return vec4f(color, 1.0);
}`;

function frameStats(gaps, marks = []) {
  if (!gaps.length) return null;
  const sorted = gaps.map(g => g.ms).sort((x, y) => x - y);
  const q = p => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  return { frames: gaps.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: sorted.at(-1),
    over33ms: sorted.filter(g => g > 33.4).length, over100ms: sorted.filter(g => g > 100).length,
    // Gaps over 50 ms with when they ended (ms from the run's start) and the stage then running.
    long: gaps.filter(g => g.ms > 50).map(g => ({ ms: g.ms, atMs: g.atMs, stage: marks.filter(m => m.atMs <= g.atMs).at(-1)?.stage ?? 'start' })) };
}

// load: false returns with the scene already drawing and no weights fetched; call demo.load()
// to fetch them, so a page can animate through a long first download.
// limits 'baseline' requests only WebGPU's default limits (128 MiB per storage binding, 256 MiB per
// buffer, 16 KB of workgroup memory), which every WebGPU device supports, to test phone-class
// devices on a desktop: anything beyond them becomes a validation error, collected in gpuErrors.
// Pipeline: the pipeline class (KleinPipeline, or a model built on it such as FLUX.3's Flux3Pipeline).
export async function createKleinDemo({ canvas, urls, kernels = {}, onStatus = () => {}, load = true, limits = 'adapter', Pipeline = KleinPipeline }) {
  const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter?.features.has('shader-f16')) throw new Error('WebGPU with shader-f16 is required');
  const features = ['shader-f16', ...(adapter.features.has('timestamp-query') ? ['timestamp-query'] : [])];
  const device = await adapter.requestDevice({ requiredFeatures: features, requiredLimits: limits === 'baseline' ? {} : {
    maxBufferSize: adapter.limits.maxBufferSize, maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
    maxStorageBuffersPerShaderStage: adapter.limits.maxStorageBuffersPerShaderStage,
    maxComputeWorkgroupStorageSize: adapter.limits.maxComputeWorkgroupStorageSize } });
  const gpuErrors = [];
  device.addEventListener('uncapturederror', e => { if (gpuErrors.length < 50) gpuErrors.push(e.error?.message ?? String(e.error)); });
  device.lost.then(info => gpuErrors.push(`device lost: ${info.reason} ${info.message}`));
  // Count the bytes of every live WebGPU buffer, with the peak since the last reset, so a page or
  // smoke can report exactly how much GPU memory the model holds.
  const gpuBytes = { live: 0, peak: 0 };
  const createBuffer = device.createBuffer.bind(device);
  device.createBuffer = descriptor => {
    const buffer = createBuffer(descriptor), size = descriptor.size;
    gpuBytes.live += size; gpuBytes.peak = Math.max(gpuBytes.peak, gpuBytes.live);
    const destroy = buffer.destroy.bind(buffer); let alive = true;
    buffer.destroy = () => { if (alive) { alive = false; gpuBytes.live -= size; } destroy(); };
    return buffer;
  };
  const app = await createKleinApp({ device, Pipeline, pipelineOptions: { ...urls, ...kernels }, load: false });
  const { foreground } = app;

  // Live scene through the foreground service.
  const surface = canvas.getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();
  surface.configure({ device, format, alphaMode: 'opaque' });
  const uniform = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const module = device.createShaderModule({ code: SCENE_SHADER });
  const scenePipeline = await device.createRenderPipelineAsync({ layout: 'auto', vertex: { module, entryPoint: 'vertex' },
    fragment: { module, entryPoint: 'fragment', targets: [{ format }] }, primitive: { topology: 'triangle-list' } });
  const bind = device.createBindGroup({ layout: scenePipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uniform } }] });
  const scene = { frames: 0, lastFrameAt: null, gaps: null, running: true };
  let frameSeq = 0;
  const requestFrame = time => {
    if (!scene.running) return;
    const handle = foreground.request({ requestId: `scene:${++frameSeq}`, run(opportunity) {
      device.queue.writeBuffer(uniform, 0, new Float32Array([time / 1000, canvas.width / canvas.height, 0, 0]));
      const enc = device.createCommandEncoder();
      const pass = enc.beginRenderPass({ colorAttachments: [{ view: surface.getCurrentTexture().createView(),
        loadOp: 'clear', storeOp: 'store', clearValue: [0.08, 0.09, 0.1, 1] }] });
      pass.setPipeline(scenePipeline); pass.setBindGroup(0, bind); pass.draw(3); pass.end();
      opportunity.submit([enc.finish()]);
    } });
    handle.completion.then(receipt => {
      const now = performance.now();
      if (receipt.status === 'completed') {
        scene.frames++;
        if (scene.gaps && scene.lastFrameAt !== null) scene.gaps.push({ ms: now - scene.lastFrameAt, atMs: now - scene.started });
        scene.lastFrameAt = now;
      }
      requestAnimationFrame(requestFrame);
    });
  };
  requestAnimationFrame(requestFrame);

  let active = null;
  async function generate({ prompt, seed, size, steps = 4, textLength = 512, cooperative = true, targetDutyMs = 12, maxInFlight = 2, onStep, onPhase, onPreview = null }) {
    if (active) throw new Error('a generation is already running');
    active = true;
    scene.gaps = []; scene.lastFrameAt = null;
    gpuBytes.peak = gpuBytes.live;
    const started = performance.now();
    scene.started = started;
    const marks = [];
    const mark = stage => marks.push({ stage, atMs: performance.now() - started });
    const phaseHook = phase => { mark(phase); onPhase?.(phase); };
    const stepHook = (i, n) => { mark(`step${i}`); onStep?.(i, n); };
    try {
      const result = await app.generate({ prompt, seed, width: size, height: size, steps, textLength,
        cooperative, scheduling: { targetDutyMs, maxInFlight }, onStep: stepHook, onPhase: phaseHook, onPreview });
      result.wallMs = performance.now() - started;
      result.gpuBytes = { peak: gpuBytes.peak, live: gpuBytes.live };
      result.gpuErrors = gpuErrors.splice(0);
      result.startedAt = started;
      result.cooperative = cooperative;
      mark('done');
      result.frames = frameStats(scene.gaps, marks);
      result.dutyCount = result.duties.length;
      result.longestDutyMs = Math.max(0, ...result.duties.map(d => d.queueMs ?? 0));
      return result;
    } finally {
      scene.gaps = null;
      active = null;
    }
  }

  async function togglePause() {
    const snap = app.snapshot().control;
    if (!snap) return null;
    if (snap.status === 'paused' || snap.pauseRequested) { await app.resume(); return 'running'; }
    await app.pause(); return 'paused';
  }
  const stop = app.stop;

  let gpuBytesAfterLoad = null;
  async function loadWeights(status = onStatus) {
    gpuBytes.peak = gpuBytes.live;
    await app.load((part, name, p) => status({ phase: 'load', part, detail: `${part} ${name}`, ...p }));
    gpuBytesAfterLoad = { peak: gpuBytes.peak, live: gpuBytes.live };
  }
  if (load) await loadWeights();

  async function destroy() {
    scene.running = false;
    try { await app.destroy(); } finally { uniform.destroy(); surface.unconfigure(); device.destroy(); }
  }

  return { device, get pipeline() { return app.pipeline; }, app, destroy, generate, togglePause, stop, scene, load: loadWeights, get residentBytes() { return app.pipeline?.residentBytes; }, gpuBytes, gpuErrors,
    limits: Object.fromEntries(['maxBufferSize', 'maxStorageBufferBindingSize', 'maxStorageBuffersPerShaderStage', 'maxComputeWorkgroupStorageSize'].map(k => [k, device.limits[k]])),
    get gpuBytesAfterLoad() { return gpuBytesAfterLoad; }, get loadMs() { return app.pipeline?.timings.loadMs; }, get kernels() { return app.pipeline?.kernels; } };
}
