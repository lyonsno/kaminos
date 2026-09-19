import {
  WEBGPU_BUFFER_USAGE,
  composeWebGpuDeviceRequirements,
  requestBrowserWebGpuDevice,
  createWebGpuForegroundService,
  createWebGpuInferenceSession,
} from '@kaminos/webgpu-inference-kit';

export const BRIGHTNESS_ROUTE_ID = 'example.brightness-rgba8.webgpu-local.v0';

const BRIGHTNESS_KERNEL = `
struct Params { multiplier: f32, pixel_count: u32, pad: vec2u };
@group(0) @binding(0) var<storage, read> input_pixels: array<u32>;
@group(0) @binding(1) var<storage, read_write> output_pixels: array<u32>;
@group(0) @binding(2) var<uniform> params: Params;

fn brighten(channel: u32) -> u32 {
  return u32(clamp(floor(f32(channel) * params.multiplier + 0.5), 0.0, 255.0));
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= params.pixel_count) { return; }
  let pixel = input_pixels[id.x];
  let red = brighten(pixel & 255u);
  let green = brighten((pixel >> 8u) & 255u);
  let blue = brighten((pixel >> 16u) & 255u);
  let alpha = (pixel >> 24u) & 255u;
  output_pixels[id.x] = red | (green << 8u) | (blue << 16u) | (alpha << 24u);
}`;

const ACTIVITY_SHADER = `
struct Activity { time: f32, aspect: f32, pad: vec2f };
@group(0) @binding(0) var<uniform> activity: Activity;
struct Vertex { @builtin(position) position: vec4f, @location(0) uv: vec2f };
@vertex fn vertex(@builtin(vertex_index) i: u32) -> Vertex {
  let p = array(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3))[i];
  return Vertex(vec4f(p,0,1), p * 0.5 + 0.5);
}
@fragment fn fragment(v: Vertex) -> @location(0) vec4f {
  let centered = (v.uv - vec2f(0.5)) * vec2f(activity.aspect, 1.0);
  let radius = length(centered);
  var color = vec3f(0.09, 0.105, 0.115);
  if (radius > 0.26 && radius < 0.31) { color = vec3f(0.27, 0.31, 0.32); }
  let angle = activity.time * 2.4;
  let marker = vec2f(cos(angle), sin(angle)) * 0.285;
  if (distance(centered, marker) < 0.072) { color = vec3f(0.1, 0.73, 0.57); }
  return vec4f(color, 1.0);
}`;

export function normalizeBrightnessMultiplier(value) {
  const multiplier = Number(value);
  if (!Number.isFinite(multiplier)) throw new Error('brightness multiplier must be finite');
  if (multiplier < 0.25 || multiplier > 2) {
    throw new Error('brightness multiplier must be between 0.25 and 2');
  }
  return multiplier;
}

export function packRgbaPixels(bytes) {
  if (!ArrayBuffer.isView(bytes)) throw new Error('RGBA pixels must be a typed array');
  if (bytes.byteLength === 0 || bytes.byteLength % 4 !== 0) {
    throw new Error('RGBA pixels must contain non-empty groups of four channels');
  }
  const packed = new Uint32Array(bytes.byteLength / 4);
  for (let index = 0; index < packed.length; index += 1) {
    const offset = index * 4;
    packed[index] = bytes[offset]
      | (bytes[offset + 1] << 8)
      | (bytes[offset + 2] << 16)
      | (bytes[offset + 3] << 24);
  }
  return packed;
}

export function unpackRgbaPixels(packed) {
  if (!(packed instanceof Uint32Array)) throw new Error('packed pixels must be a Uint32Array');
  const bytes = new Uint8ClampedArray(packed.length * 4);
  for (let index = 0; index < packed.length; index += 1) {
    const offset = index * 4;
    const pixel = packed[index];
    bytes[offset] = pixel & 255;
    bytes[offset + 1] = (pixel >>> 8) & 255;
    bytes[offset + 2] = (pixel >>> 16) & 255;
    bytes[offset + 3] = (pixel >>> 24) & 255;
  }
  return bytes;
}

function readSourceImage(sourceImage) {
  const width = sourceImage?.naturalWidth;
  const height = sourceImage?.naturalHeight;
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
    throw new Error('sourceImage must be a decoded image with positive dimensions');
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('2D source image context unavailable');
  context.drawImage(sourceImage, 0, 0, width, height);
  return { width, height, pixels: context.getImageData(0, 0, width, height).data };
}

export function createBrightnessModelAdapter({ route, width, height }) {
  if (!route || typeof route !== 'object') throw new Error('route is required');
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
    throw new Error('image width and height must be positive integers');
  }
  const runtime = route.runtime;
  const pixelCount = width * height;
  const input = runtime.createTensor({
    name: 'brightness.input-rgba8', shape: [pixelCount], dtype: 'u32',
    usage: WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst,
  });
  const output = runtime.createTensor({
    name: 'brightness.output-rgba8', shape: [pixelCount], dtype: 'u32',
    usage: WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copySrc,
  });
  const params = runtime.createUniformBuffer({
    label: 'brightness.params',
    schema: [
      { name: 'multiplier', type: 'f32' },
      { name: 'pixelCount', type: 'u32' },
      { name: 'pad', type: 'vec2<u32>' },
    ],
    values: { multiplier: 1, pixelCount, pad: [0, 0] },
  });
  const kernel = runtime.defineComputeKernel({
    name: 'brightness.rgba8', code: BRIGHTNESS_KERNEL,
    bindings: [
      { name: 'input', resource: input, access: 'read-only-storage' },
      { name: 'output', resource: output, access: 'storage' },
      { name: 'params', resource: params, type: 'uniform' },
    ],
  });
  let disposed = false;

  return Object.freeze({
    modelId: 'brightness-rgba8-v0',
    async run(pixels, multiplierValue, invocation) {
      if (disposed) throw new Error('brightness adapter is disposed');
      if (!invocation || typeof invocation.reportProgress !== 'function') {
        throw new Error('queued invocation context with reportProgress is required');
      }
      const packed = packRgbaPixels(pixels);
      if (packed.length !== pixelCount) {
        throw new Error(`brightness input must contain exactly ${pixelCount} RGBA pixels`);
      }
      const multiplier = normalizeBrightnessMultiplier(multiplierValue);
      runtime.uploadTensor(input, packed);
      params.update({ multiplier, pixelCount, pad: [0, 0] });
      invocation.reportProgress({ phase: 'Upload pixels', completed: 1, total: 3 });

      await runtime.runKernel(kernel, {
        stage: 'Adjust brightness', dispatch: [Math.ceil(pixelCount / 64), 1, 1],
        schedulerInvocation: invocation, yieldAfter: true,
      });
      invocation.reportProgress({ phase: 'Adjust brightness', completed: 2, total: 3 });

      const result = await runtime.readTensor(output, { schedulerInvocation: invocation });
      invocation.reportProgress({ phase: 'Return image', completed: 3, total: 3 });
      return { width, height, multiplier, pixels: unpackRgbaPixels(new Uint32Array(result)) };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      input.buffer?.destroy?.();
      output.buffer?.destroy?.();
      params.buffer?.destroy?.();
    },
  });
}

export async function createRenderPlusInferenceExample({
  canvas,
  sourceImage,
  onState = () => {},
  gpu = globalThis.navigator?.gpu,
} = {}) {
  if (typeof onState !== 'function') throw new Error('onState must be a function');
  const source = readSourceImage(sourceImage);
  const requirements = composeWebGpuDeviceRequirements([
    { requiredLimits: { maxStorageBuffersPerShaderStage: 2, maxUniformBuffersPerShaderStage: 1 } },
    { requiredLimits: { maxUniformBuffersPerShaderStage: 1 } },
  ]);
  const context = await requestBrowserWebGpuDevice(gpu, { requirements });
  const { device } = context;
  let foreground, session, surface, activityUniform, activityPipeline, activityBindings;
  try {
    foreground = createWebGpuForegroundService({ routeId: BRIGHTNESS_ROUTE_ID, device });
    session = await createWebGpuInferenceSession({
      sessionId: 'brightness-worked-example', device, adapter: context.adapter,
      backendIdentity: context.backendIdentity,
    });
    surface = canvas.getContext('webgpu');
    if (!surface) throw new Error('WebGPU activity canvas unavailable');
    const format = gpu.getPreferredCanvasFormat();
    surface.configure({ device, format, alphaMode: 'opaque' });
    activityUniform = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const module = device.createShaderModule({ code: ACTIVITY_SHADER });
    activityPipeline = await device.createRenderPipelineAsync({
      layout: 'auto', vertex: { module, entryPoint: 'vertex' },
      fragment: { module, entryPoint: 'fragment', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    });
    activityBindings = device.createBindGroup({
      layout: activityPipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: activityUniform } }],
    });
  } catch (error) {
    await foreground?.dispose();
    session?.close();
    surface?.unconfigure();
    activityUniform?.destroy();
    device.destroy();
    throw error;
  }

  const state = {
    status: 'idle', phase: 'Waiting for an adjustment', frames: 0, runs: 0,
    result: null, error: null, observerError: null, backend: context.backendIdentity,
    source: { width: source.width, height: source.height },
  };
  let activeBatch = null;
  let runSequence = 0;
  let frameSequence = 0;
  let raf = null;
  let frameHandle = null;
  let disposed = false;
  let disposal = null;
  const snapshot = () => structuredClone(state);
  const publish = () => {
    if (state.observerError !== null) return;
    try { onState(snapshot()); }
    catch (error) { state.observerError = String(error?.message ?? error); }
  };

  function requestFrame(time) {
    if (disposed) return;
    frameHandle = foreground.request({ requestId: `activity:${++frameSequence}`, run(opportunity) {
      const width = Math.max(1, Math.round(canvas.clientWidth * devicePixelRatio));
      const height = Math.max(1, Math.round(canvas.clientHeight * devicePixelRatio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      device.queue.writeBuffer(activityUniform, 0, new Float32Array([time / 1000, canvas.width / canvas.height, 0, 0]));
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: surface.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store',
          clearValue: [0.09, 0.105, 0.115, 1],
        }],
      });
      pass.setPipeline(activityPipeline);
      pass.setBindGroup(0, activityBindings);
      pass.draw(3);
      pass.end();
      opportunity.submit([encoder.finish()]);
      state.frames += 1;
    } });
    frameHandle.completion.then(receipt => {
      if (disposed) return;
      if (receipt.status !== 'completed') {
        state.error = receipt.failure?.error?.message || receipt.status;
        publish();
        return;
      }
      publish();
      raf = requestAnimationFrame(requestFrame);
    });
  }

  function run({ multiplier = 1.5, pixels = source.pixels } = {}) {
    if (disposed) throw new Error('example is disposed');
    if (activeBatch) throw new Error('a brightness adjustment is already running');
    const normalizedMultiplier = normalizeBrightnessMultiplier(multiplier);
    const runId = `brightness:${++runSequence}`;
    state.status = 'running';
    state.phase = 'Starting GPU work';
    state.error = null;
    publish();

    activeBatch = (async () => {
      const active = await foreground.beginRun(runId);
      let route;
      let model;
      try {
        route = await session.registerRoute({
          routeId: BRIGHTNESS_ROUTE_ID,
          runtimeOptions: {
            runtimeLabel: 'brightness-worked-example',
            kernel: { profile: 'example.brightness-rgba8.v0' },
            foregroundOpportunities: active.foregroundOpportunities,
            yieldMs: 0,
          },
        });
        model = createBrightnessModelAdapter({ route, width: source.width, height: source.height });
        const job = route.enqueue({
          jobId: runId,
          metadata: { modelId: model.modelId, multiplier: normalizedMultiplier },
          async execute(invocation) {
            return model.run(pixels, normalizedMultiplier, {
              ...invocation,
              reportProgress(progress) {
                invocation.reportProgress(progress);
                state.phase = progress.phase;
                publish();
              },
            });
          },
        });
        const completion = await job.completion;
        if (completion.status !== 'succeeded') {
          throw new Error(completion.failure?.message || completion.cancellation?.reason || completion.status);
        }
        state.result = {
          width: completion.output.width,
          height: completion.output.height,
          multiplier: completion.output.multiplier,
          byteLength: completion.output.pixels.byteLength,
        };
        state.status = 'succeeded';
        state.phase = 'Complete';
        state.runs += 1;
        publish();
        return completion;
      } finally {
        if (route) await route.drain();
        model?.dispose();
        if (route) session.unregisterRoute(route.routeId);
        await active.finish();
      }
    })().catch(error => {
      state.status = 'failed';
      state.phase = 'Adjustment failed';
      state.error = error.message;
      throw error;
    }).finally(() => {
      activeBatch = null;
      publish();
    });
    return activeBatch;
  }

  function dispose() {
    if (disposal) return disposal;
    disposed = true;
    cancelAnimationFrame(raf);
    frameHandle?.cancel('example-disposed');
    disposal = (async () => {
      try { await activeBatch; } catch { /* Failure remains visible in state and the run promise. */ }
      await foreground.dispose();
      await session.drain();
      session.close();
      surface.unconfigure();
      activityUniform.destroy();
      device.destroy();
    })();
    return disposal;
  }

  try { onState(snapshot()); }
  catch (error) { await dispose(); throw error; }
  raf = requestAnimationFrame(requestFrame);
  return Object.freeze({ run, snapshot, dispose });
}
