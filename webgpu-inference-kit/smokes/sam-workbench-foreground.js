import { createCooperativeYield } from '../src/index.js';

// The source viewport and inference share one device and queue. Input creates
// demand; idle phase boundaries retain the kit's ordinary event-loop yield.
export async function createSamWorkbenchForeground({ device, canvas, image, onError = () => {},
  now = () => performance.now(), requestFrame = callback => requestAnimationFrame(callback),
  cancelFrame = handle => cancelAnimationFrame(handle), sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  format = navigator.gpu.getPreferredCanvasFormat(),
}) {
  const context = canvas.getContext('webgpu');
  if (!context) throw new Error('source viewport WebGPU context unavailable');
  const shader = device.createShaderModule({ code: `
    struct View { zoom: f32, panX: f32, panY: f32, pad: f32 };
    @group(0) @binding(0) var source: texture_2d<f32>;
    @group(0) @binding(1) var linearSampler: sampler;
    @group(0) @binding(2) var<uniform> view: View;
    struct Vertex { @builtin(position) position: vec4f, @location(0) uv: vec2f };
    @vertex fn vertex(@builtin(vertex_index) i: u32) -> Vertex {
      let p = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3))[i];
      return Vertex(vec4f(p, 0, 1), vec2f((p.x + 1) * 0.5, (1 - p.y) * 0.5));
    }
    @fragment fn fragment(v: Vertex) -> @location(0) vec4f {
      let uv = (v.uv - vec2f(0.5)) / view.zoom + vec2f(0.5) + vec2f(view.panX, view.panY);
      if (any(uv < vec2f(0)) || any(uv > vec2f(1))) { return vec4f(0.04, 0.05, 0.06, 1); }
      return textureSampleLevel(source, linearSampler, uv, 0);
    }` });
  const pipeline = await device.createRenderPipelineAsync({
    layout: 'auto', vertex: { module: shader, entryPoint: 'vertex' },
    fragment: { module: shader, entryPoint: 'fragment', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  });
  const uniform = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
  context.configure({ device, format, alphaMode: 'opaque' });
  const events = [];
  let texture = null, bindGroup = null, frame = null, closed = false;
  let demandAt = null, zoom = 1, panX = 0, panY = 0, drag = null;
  let frameWaiters = [], yieldCount = 0, demandYieldCount = 0;
  let failure = null;

  function draw() {
    frame = null;
    if (closed || demandAt === null) return;
    const requestedAt = demandAt;
    demandAt = null;
    try {
      device.queue.writeBuffer(uniform, 0, new Float32Array([zoom, panX, panY, 0]));
      const encoder = device.createCommandEncoder({ label: 'sam-source-foreground' });
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: context.getCurrentTexture().createView(),
        loadOp: 'clear', storeOp: 'store', clearValue: { r: 0.04, g: 0.05, b: 0.06, a: 1 } }] });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(3);
      pass.end();
      device.queue.submit([encoder.finish()]);
      events.push({ requestedAtMs: requestedAt, submittedAtMs: now(), afterYieldCount: yieldCount, zoom, panX, panY });
      for (const waiter of frameWaiters) waiter.resolve();
    } catch (error) {
      failure = error;
      for (const waiter of frameWaiters) waiter.reject(error);
      onError(error);
    } finally { frameWaiters = []; }
  }

  function requestDraw() {
    if (closed) return;
    demandAt ??= now();
    if (frame === null) frame = requestFrame(draw);
  }

  function setImage(next) {
    if (closed) throw new Error('source viewport is closed');
    texture?.destroy();
    texture = device.createTexture({ size: [next.naturalWidth, next.naturalHeight], format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
    device.queue.copyExternalImageToTexture({ source: next }, { texture }, [next.naturalWidth, next.naturalHeight]);
    bindGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: texture.createView() }, { binding: 1, resource: sampler },
      { binding: 2, resource: { buffer: uniform } },
    ] });
    zoom = 1; panX = 0; panY = 0;
    requestDraw();
  }

  const listeners = {
    wheel(event) { event.preventDefault(); zoom = Math.max(1, zoom * Math.exp(-event.deltaY * 0.001)); requestDraw(); },
    pointerdown(event) { drag = { x: event.clientX, y: event.clientY }; canvas.setPointerCapture(event.pointerId); },
    pointermove(event) {
      if (!drag) return;
      const rect = canvas.getBoundingClientRect();
      panX -= (event.clientX - drag.x) / rect.width / zoom;
      panY -= (event.clientY - drag.y) / rect.height / zoom;
      drag = { x: event.clientX, y: event.clientY }; requestDraw();
    },
    pointerup() { drag = null; }, pointercancel() { drag = null; },
    dblclick() { zoom = 1; panX = 0; panY = 0; requestDraw(); },
  };
  for (const [name, listener] of Object.entries(listeners)) canvas.addEventListener(name, listener, { passive: false });
  setImage(image);
  const cooperativeYield = createCooperativeYield({ queue: device.queue, waitForSubmittedWorkDone: true, yieldMs: 0,
    sleep: async ms => {
      if (failure) throw failure;
      if (closed) throw new Error('source viewport is closed');
      if (demandAt !== null) {
        demandYieldCount += 1;
        await new Promise((resolve, reject) => frameWaiters.push({ resolve, reject }));
      }
      await sleep(ms);
    }, now,
  });
  return {
    setImage,
    async yield(metadata) { yieldCount += 1; return cooperativeYield(metadata); },
    evidence() { return { mode: 'shared-device-input-driven-source-render', yieldCount, demandYieldCount, failure: failure?.message || null,
      frames: events.slice(), authority: 'same-device-queue-submissions-not-presentation-or-frame-budget-verification' }; },
    close() {
      closed = true;
      if (frame !== null) cancelFrame(frame);
      for (const waiter of frameWaiters) waiter.reject(new Error('source viewport closed'));
      frameWaiters = [];
      for (const [name, listener] of Object.entries(listeners)) canvas.removeEventListener(name, listener);
      texture?.destroy(); uniform.destroy(); context.unconfigure();
    },
  };
}
