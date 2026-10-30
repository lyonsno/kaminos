// Inference contributes images to this texture viewer, not a private frame loop.
export async function createImageView(canvas, device, foreground, onError) {
  const context = canvas.getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'opaque' });
  const params = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const shader = device.createShaderModule({ code: `
    struct View { size: vec2f, image: vec2f, pan: vec2f, zoom: f32, pad: f32 };
    @group(0) @binding(0) var<uniform> view: View;
    @group(0) @binding(1) var picture: texture_2d<f32>;
    @group(0) @binding(2) var filtering: sampler;
    @vertex fn vertex(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
      return vec4f(array(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3))[i],0,1);
    }
    @fragment fn fragment(@builtin(position) point: vec4f) -> @location(0) vec4f {
      let scale = min(view.size.x / view.image.x, view.size.y / view.image.y) * view.zoom;
      let uv = ((point.xy - view.size / 2 - view.pan) / scale + view.image / 2) / view.image;
      let background = vec4f(0.12, 0.13, 0.13, 1);
      if (any(uv < vec2f(0)) || any(uv > vec2f(1))) { return background; }
      let color = textureSampleLevel(picture, filtering, uv, 0);
      return vec4f(mix(background.rgb, color.rgb, color.a), 1);
    }` });
  const pipeline = await device.createRenderPipelineAsync({ layout: 'auto',
    vertex: { module: shader, entryPoint: 'vertex' },
    fragment: { module: shader, entryPoint: 'fragment', targets: [{ format }] } });
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  let texture, bindings, width = 1, height = 1, zoom = 1, pan = [0, 0];
  let pending = null, dirty = false, disposed = false, sequence = 0;
  function redraw() {
    if (disposed) return;
    dirty = true;
    if (pending || !texture) return;
    pending = foreground.request({ requestId: `image:${++sequence}`, run(opportunity) {
      dirty = false;
      if (disposed) return;
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.min(device.limits.maxTextureDimension2D, Math.round(canvas.clientWidth * ratio)));
      canvas.height = Math.max(1, Math.min(device.limits.maxTextureDimension2D, Math.round(canvas.clientHeight * ratio)));
      device.queue.writeBuffer(params, 0, new Float32Array([canvas.width, canvas.height, width, height, pan[0] * ratio, pan[1] * ratio, zoom, 0]));
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: context.getCurrentTexture().createView(),
        loadOp: 'clear', storeOp: 'store', clearValue: [0.12, 0.13, 0.13, 1] }] });
      pass.setPipeline(pipeline); pass.setBindGroup(0, bindings); pass.draw(3); pass.end();
      opportunity.submit([encoder.finish()]);
    } });
    pending.completion.then(receipt => {
      pending = null;
      if (disposed) return;
      if (receipt.status !== 'completed') { onError(new Error(receipt.failure?.error?.message || receipt.status)); return; }
      if (dirty) redraw();
    });
  }
  function setImage(image) {
    texture?.destroy(); width = image.width; height = image.height;
    texture = device.createTexture({ size: [width, height], format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
    if (image.data) device.queue.writeTexture({ texture }, image.data, { bytesPerRow: width * 4 }, [width, height]);
    else device.queue.copyExternalImageToTexture({ source: image }, { texture }, [width, height]);
    bindings = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: params } }, { binding: 1, resource: texture.createView() }, { binding: 2, resource: sampler },
    ] });
    redraw();
  }
  const resize = new ResizeObserver(redraw); resize.observe(canvas);
  canvas.addEventListener('pointerdown', event => { if (event.button === 0) canvas.setPointerCapture(event.pointerId); });
  canvas.addEventListener('pointermove', event => {
    if (!canvas.hasPointerCapture(event.pointerId)) return;
    pan[0] += event.movementX; pan[1] += event.movementY; redraw();
  });
  return {
    setImage,
    setZoom(value) { zoom = value; redraw(); },
    fit() { zoom = 1; pan = [0, 0]; redraw(); },
    destroy() {
      disposed = true; pending?.cancel(); resize.disconnect();
      texture?.destroy(); params.destroy(); context.unconfigure();
    },
  };
}
