const shader = `
@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var linearSampler: sampler;
struct Vertex { @builtin(position) position: vec4f, @location(0) uv: vec2f };
@vertex fn vertex(@builtin(vertex_index) i: u32) -> Vertex {
  let p = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3))[i];
  return Vertex(vec4f(p, 0, 1), vec2f((p.x + 1) * 0.5, (1 - p.y) * 0.5));
}
@fragment fn fragment(v: Vertex) -> @location(0) vec4f {
  return textureSampleLevel(source, linearSampler, v.uv, 0);
}`;

// Rendering requests use the same foreground service as the tracker. Only one
// browser frame is outstanding; a slow model cannot accumulate a render queue.
export async function createSamVideoPreview({ canvas, device, foreground, gpu = navigator.gpu,
  onError = console.error } = {}) {
  if (foreground?.device !== device || foreground.queue !== device.queue) throw new Error('preview must share the foreground device and queue');
  const context = canvas.getContext('webgpu');
  if (!context) throw new Error('WebGPU video canvas unavailable');
  const format = gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'opaque' });
  let texture = null, bindings = null, source = null, width = 0, height = 0;
  let callback = null, pending = null, closed = false, sequence = 0, submissions = 0, failure = null;
  const module = device.createShaderModule({ code: shader });
  let pipeline;
  try { pipeline = await device.createRenderPipelineAsync({ layout: 'auto',
    vertex: { module, entryPoint: 'vertex' }, fragment: { module, entryPoint: 'fragment', targets: [{ format }] },
    primitive: { topology: 'triangle-list' } }); }
  catch (error) { context.unconfigure(); throw error; }
  const sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
  function tick() {
    callback = null;
    if (closed || failure || !source) return;
    try {
      pending = foreground.request({ requestId: `sam-video-preview:${++sequence}`, run(frame) {
        if (closed || !source) return;
        const w = source.videoWidth || source.width, h = source.videoHeight || source.height;
        if (!w || !h) return;
        if (width !== w || height !== h) {
          texture?.destroy(); width = w; height = h;
          texture = device.createTexture({ size: [w, h], format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
          bindings = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
            { binding: 0, resource: texture.createView() }, { binding: 1, resource: sampler } ] });
          canvas.width = w; canvas.height = h;
        }
        device.queue.copyExternalImageToTexture({ source }, { texture }, [w, h]);
        const encoder = device.createCommandEncoder({ label: 'sam-video-preview' });
        const pass = encoder.beginRenderPass({ colorAttachments: [{ view: context.getCurrentTexture().createView(),
          loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
        pass.setPipeline(pipeline); pass.setBindGroup(0, bindings); pass.draw(3); pass.end();
        frame.submit([encoder.finish()]); submissions++;
      } }).completion;
      pending.then(receipt => {
        if (receipt.status !== 'completed') throw new Error(receipt.failure?.error?.message || 'video foreground failed');
      }).catch(error => { failure = error; onError(error); }).finally(() => {
        pending = null;
        if (!closed && !failure && source) callback = requestAnimationFrame(tick);
      });
    } catch (error) { failure = error; onError(error); }
  }
  return Object.freeze({
    setSource(value) {
      if (closed || failure) throw failure || new Error('video preview closed');
      source = value;
      if (source && callback === null && pending === null) callback = requestAnimationFrame(tick);
    },
    snapshot: () => ({ submissions, error: failure?.message ?? null, authority: 'foreground-queue-submissions-not-presentation-cadence' }),
    async close() {
      closed = true; source = null;
      if (callback !== null) cancelAnimationFrame(callback);
      await pending; await device.queue.onSubmittedWorkDone(); texture?.destroy(); context.unconfigure();
    },
  });
}
