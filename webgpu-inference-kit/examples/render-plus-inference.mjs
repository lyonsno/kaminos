import {
  composeWebGpuDeviceRequirements,
  requestBrowserWebGpuDevice,
  createWebGpuForegroundService,
  createWebGpuInferenceSession,
} from '@kaminos/webgpu-inference-kit';
import { createMinimalModelAdapter, MINIMAL_MODEL_ROUTE_ID } from './minimal-model-port.mjs';

const PLOT = `
struct Plot { values: vec4f, time: f32, aspect: f32, pad: vec2f };
@group(0) @binding(0) var<uniform> plot: Plot;
struct Vertex { @builtin(position) position: vec4f, @location(0) uv: vec2f };
@vertex fn vertex(@builtin(vertex_index) i: u32) -> Vertex {
  let p = array(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3))[i];
  return Vertex(vec4f(p,0,1), p * 0.5 + 0.5);
}
@fragment fn fragment(v: Vertex) -> @location(0) vec4f {
  let column = min(u32(v.uv.x * 4.0), 3u);
  let x = fract(v.uv.x * 4.0);
  let height = 0.12 + plot.values[column] / 20.0;
  let colors = array(vec3f(0.12,0.81,0.69),vec3f(0.96,0.35,0.55),vec3f(0.90,0.80,0.20),vec3f(0.42,0.65,0.95));
  var color = vec3f(0.055,0.06,0.07);
  if (x > 0.14 && x < 0.86 && v.uv.y < height) {
    let stripe = 0.8 + 0.2 * sin(v.uv.y * 35.0 - plot.time * 4.0);
    color = colors[column] * stripe;
  }
  let cursor = fract(plot.time * 0.15);
  if (abs(v.uv.x - cursor) * plot.aspect < 0.005) { color = vec3f(0.95); }
  return vec4f(color,1);
}`;

// The input wait is caller-controlled: it demonstrates an asynchronous input
// phase, not a benchmark or an artificial claim of expensive model work.
export async function createRenderPlusInferenceExample({ canvas, onState = () => {}, gpu = globalThis.navigator?.gpu } = {}) {
  if (typeof onState !== 'function') throw new Error('onState must be a function');
  const requirements = composeWebGpuDeviceRequirements([
    { requiredLimits: { maxStorageBuffersPerShaderStage: 2 } },
    { requiredLimits: { maxUniformBuffersPerShaderStage: 1 } },
  ]);
  const context = await requestBrowserWebGpuDevice(gpu, { requirements });
  const { device } = context;
  let foreground, session, surface, uniform, pipeline, bindings;
  try {
    foreground = createWebGpuForegroundService({ routeId: MINIMAL_MODEL_ROUTE_ID, device });
    session = await createWebGpuInferenceSession({
      sessionId: 'render-plus-inference', device, adapter: context.adapter,
      backendIdentity: context.backendIdentity,
    });
    surface = canvas.getContext('webgpu');
    if (!surface) throw new Error('WebGPU canvas context unavailable');
    const format = gpu.getPreferredCanvasFormat();
    surface.configure({ device, format, alphaMode: 'opaque' });
    uniform = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const module = device.createShaderModule({ code: PLOT });
    pipeline = await device.createRenderPipelineAsync({
      layout: 'auto', vertex: { module, entryPoint: 'vertex' },
      fragment: { module, entryPoint: 'fragment', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    });
    bindings = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uniform } }] });
  } catch (error) {
    await foreground?.dispose(); session?.close();
    surface?.unconfigure(); uniform?.destroy(); device.destroy();
    throw error;
  }
  const state = { status: 'idle', phase: 'Idle', frames: 0, values: [0, 0, 0, 0], jobs: [], error: null, observerError: null, backend: context.backendIdentity };
  let batch = null;
  let jobs = [];
  let runSequence = 0;
  let frameSequence = 0;
  let raf = null;
  let frameHandle = null;
  let disposed = false;
  let disposal = null;
  const snapshot = () => structuredClone(state);
  // After construction, a broken view observer is detached; inference and
  // cleanup keep their own outcome. The caller can inspect observerError.
  const publish = () => {
    if (state.observerError !== null) return;
    try { onState(snapshot()); }
    catch (error) { state.observerError = String(error?.message ?? error); }
  };

  function requestFrame(time) {
    if (disposed) return;
    frameHandle = foreground.request({ requestId: `frame:${++frameSequence}`, run(opportunity) {
      const width = Math.round(canvas.clientWidth * devicePixelRatio);
      const height = Math.round(canvas.clientHeight * devicePixelRatio);
      if (width > 0 && height > 0 && (canvas.width !== width || canvas.height !== height)) {
        canvas.width = width; canvas.height = height;
      }
      device.queue.writeBuffer(uniform, 0, new Float32Array([...state.values, time / 1000, canvas.width / canvas.height, 0, 0]));
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: surface.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0,0,0,1] }] });
      pass.setPipeline(pipeline); pass.setBindGroup(0, bindings); pass.draw(3); pass.end();
      opportunity.submit([encoder.finish()]);
      state.frames += 1;
    } });
    frameHandle.completion.then(receipt => {
      if (disposed) return;
      if (receipt.status !== 'completed') {
        state.error = receipt.failure?.error?.message || receipt.status;
        publish(); return;
      }
      publish();
      raf = requestAnimationFrame(requestFrame);
    });
  }

  function run({ inputWaitMs = 500, inputs = [[0, 1, 2, 3], [4, 5, 6, 7]] } = {}) {
    if (disposed) throw new Error('example is disposed');
    if (batch) throw new Error('a batch is already running');
    if (!Number.isFinite(inputWaitMs) || inputWaitMs < 0) throw new Error('inputWaitMs must be non-negative');
    if (!Array.isArray(inputs) || inputs.length !== 2) throw new Error('this example queues two inputs');
    const runId = `batch:${++runSequence}`;
    state.status = 'running'; state.error = null;
    state.jobs = inputs.map((_, i) => ({ id: `${runId}:${i}`, status: 'queued', phase: 'Queued', percent: 0 }));
    batch = (async () => {
      const active = await foreground.beginRun(runId);
      let route;
      let model;
      try {
        publish();
        route = await session.registerRoute({ routeId: MINIMAL_MODEL_ROUTE_ID, runtimeOptions: {
          runtimeLabel: 'render-plus-inference', kernel: { profile: 'example.affine-f32.v0' },
          foregroundOpportunities: active.foregroundOpportunities, yieldMs: 0,
        } });
        model = createMinimalModelAdapter({ route });
        jobs = inputs.map((values, index) => route.enqueue({ jobId: state.jobs[index].id, async execute(invocation) {
          const row = state.jobs[index]; row.status = 'running'; row.phase = 'Input wait'; state.phase = row.phase; publish();
          await active.withForeground('input-wait', () => new Promise(resolve => setTimeout(resolve, inputWaitMs)));
          const result = await model.run(values, { ...invocation, reportProgress(progress) {
            invocation.reportProgress(progress);
            row.phase = progress.phase; row.percent = 100 * progress.completed / progress.total;
            state.phase = row.phase; publish();
          } });
          state.values = result;
          return result;
        } }));
        const completions = await Promise.all(jobs.map((job, index) => job.completion.then(completion => {
          state.jobs[index].status = completion.status;
          state.jobs[index].output = completion.output ?? null;
          state.jobs[index].failure = completion.failure ?? null;
          publish(); return completion;
        })));
        state.status = completions.every(result => result.status === 'succeeded') ? 'succeeded'
          : completions.some(result => result.status === 'failed') ? 'failed' : 'cancelled';
        return completions;
      } finally {
        if (route) await route.drain();
        model?.dispose();
        if (route) session.unregisterRoute(route.routeId);
        await active.finish();
        state.phase = 'Idle'; jobs = [];
      }
    })().catch(error => { state.status = 'failed'; state.error = error.message; throw error; })
      .finally(() => { batch = null; publish(); });
    return batch;
  }

  function cancelQueued() { return jobs.map(job => job.cancel('example-cancel-queued')); }
  function dispose() {
    if (disposal) return disposal;
    disposed = true;
    cancelAnimationFrame(raf);
    frameHandle?.cancel('example-disposed');
    cancelQueued();
    disposal = (async () => {
      try { await batch; } catch { /* The job failure remains in the caller's result and state. */ }
      await foreground.dispose(); await session.drain(); session.close();
      surface.unconfigure(); uniform.destroy(); device.destroy();
    })();
    return disposal;
  }
  try { onState(snapshot()); }
  catch (error) { await dispose(); throw error; }
  raf = requestAnimationFrame(requestFrame);
  return Object.freeze({ run, cancelQueued, snapshot, dispose });
}
