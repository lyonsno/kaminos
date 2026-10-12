// FLUX.2 Klein demo: text-to-image beside a live WebGPU scene on one device.
// The scene submits frames through the kit foreground service; a cooperative run is a
// queued job on a kit route whose command duties let pending frames submit first, with
// pause/resume/stop through the kit inference control. A blocking run submits per block
// without yielding to the scene. Frame gaps during each run are recorded.
import { KleinPipeline } from './klein-pipeline.js';
import { createWebGpuForegroundService, createWebGpuInferenceControl, createWebGpuInferenceSession }
  from '../../webgpu-inference-kit/src/core.js';

export const KLEIN_ROUTE_ID = 'flux2-klein.text-to-image.webgpu-local.v0';

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

function frameStats(gaps) {
  if (!gaps.length) return null;
  const sorted = [...gaps].sort((x, y) => x - y);
  const q = p => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  return { frames: gaps.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: sorted.at(-1),
    over33ms: gaps.filter(g => g > 33.4).length, over100ms: gaps.filter(g => g > 100).length };
}

// load: false returns with the scene already drawing and no weights fetched; call demo.load()
// to fetch them, so a page can animate through a long first download.
export async function createKleinDemo({ canvas, urls, kernels = {}, onStatus = () => {}, load = true }) {
  const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter?.features.has('shader-f16')) throw new Error('WebGPU with shader-f16 is required');
  const features = ['shader-f16', ...(adapter.features.has('timestamp-query') ? ['timestamp-query'] : [])];
  const device = await adapter.requestDevice({ requiredFeatures: features, requiredLimits: {
    maxBufferSize: adapter.limits.maxBufferSize, maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
    maxStorageBuffersPerShaderStage: adapter.limits.maxStorageBuffersPerShaderStage,
    maxComputeWorkgroupStorageSize: adapter.limits.maxComputeWorkgroupStorageSize } });
  const session = await createWebGpuInferenceSession({ sessionId: `flux2-klein:${crypto.randomUUID()}`, device, adapterName: 'browser-primary-adapter' });
  const foreground = createWebGpuForegroundService({ routeId: KLEIN_ROUTE_ID, device });
  const pipeline = new KleinPipeline(device, { ...urls, ...kernels });

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
        if (scene.gaps && scene.lastFrameAt !== null) scene.gaps.push(now - scene.lastFrameAt);
        scene.lastFrameAt = now;
      }
      requestAnimationFrame(requestFrame);
    });
  };
  requestAnimationFrame(requestFrame);

  let active = null;
  async function generate({ prompt, seed, size, textLength = 512, cooperative = true, targetDutyMs = 12, maxInFlight = 1, onStep, onPhase }) {
    if (active) throw new Error('a generation is already running');
    const runId = `flux2-klein:${crypto.randomUUID()}`;
    const abort = new AbortController();
    active = { abort, control: null, cooperative };
    scene.gaps = []; scene.lastFrameAt = null;
    const started = performance.now();
    let frameRun = null, route = null, result;
    try {
      if (cooperative) {
        frameRun = await foreground.beginRun(runId);
        route = await session.registerRoute({ routeId: KLEIN_ROUTE_ID, runtimeOptions: {
          runtimeLabel: 'flux2-klein', foregroundOpportunities: frameRun.foregroundOpportunities } });
        const control = createWebGpuInferenceControl({ queue: device.queue, signal: abort.signal, withForeground: frameRun.withForeground });
        active.control = control;
        const job = route.enqueue({ jobId: runId, execute: invocation => pipeline.generate({
          prompt, seed, width: size, height: size, textLength, onStep, onPhase,
          schedule: { runtime: route.runtime, invocation, control, signal: abort.signal, targetDutyMs, maxInFlight } }) });
        const completion = await job.completion;
        if (completion.status !== 'succeeded') {
          const error = new Error(completion.failure?.message ?? completion.status);
          error.name = completion.failure?.name ?? 'Error';
          throw error;
        }
        result = completion.output;
      } else {
        result = await pipeline.generate({ prompt, seed, width: size, height: size, textLength, onStep, onPhase });
      }
      result.wallMs = performance.now() - started;
      result.cooperative = cooperative;
      result.frames = frameStats(scene.gaps);
      result.dutyCount = result.duties.length;
      result.longestDutyMs = Math.max(0, ...result.duties.map(d => d.queueMs ?? 0));
      return result;
    } finally {
      try { await active.control?.close(); } catch { /* close failures are reported by the control */ }
      if (route) { await route.drain(); session.unregisterRoute(route.routeId); }
      if (frameRun) await frameRun.finish();
      scene.gaps = null;
      active = null;
    }
  }

  async function togglePause() {
    const control = active?.control;
    if (!control) return null;
    const snap = control.snapshot();
    if (snap.status === 'paused' || snap.pauseRequested) { await control.resume(); return 'running'; }
    await control.pause(); return 'paused';
  }
  function stop(reason = 'stopped by user') { active?.abort.abort(new Error(reason)); }

  async function loadWeights(status = onStatus) {
    await pipeline.load((part, name, p) => status({ phase: 'load', part, detail: `${part} ${name}`, ...p }));
  }
  if (load) await loadWeights();

  return { device, pipeline, generate, togglePause, stop, scene, load: loadWeights, residentBytes: pipeline.residentBytes,
    get loadMs() { return pipeline.timings.loadMs; }, kernels: pipeline.kernels };
}
