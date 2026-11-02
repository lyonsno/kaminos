// Source, cutout and comparison share the model's device and foreground service.
export async function createImageView(canvas, device, foreground, onError) {
  const context = canvas.getContext('webgpu'), format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'opaque' });
  const params = device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const shader = device.createShaderModule({ code: `
    struct View { size: vec2f, image: vec2f, pan: vec2f, zoom: f32, mode: f32, split: f32, background: f32 };
    @group(0) @binding(0) var<uniform> view: View;
    @group(0) @binding(1) var original: texture_2d<f32>;
    @group(0) @binding(2) var cutout: texture_2d<f32>;
    @group(0) @binding(3) var filtering: sampler;
    @vertex fn vertex(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
      return vec4f(array(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3))[i],0,1);
    }
    @fragment fn fragment(@builtin(position) point: vec4f) -> @location(0) vec4f {
      let scale = min(view.size.x / view.image.x, view.size.y / view.image.y) * view.zoom;
      let uv = ((point.xy - view.size / 2 - view.pan) / scale + view.image / 2) / view.image;
      let checker = (u32(point.x / 20) + u32(point.y / 20)) % 2u;
      var background = vec3f(select(0.80, 0.88, checker == 0u));
      if (view.background == 1) { background = vec3f(0.96); }
      if (view.background == 2) { background = vec3f(0.12, 0.13, 0.14); }
      if (any(uv < vec2f(0)) || any(uv > vec2f(1))) { return vec4f(background, 1); }
      var color = textureSampleLevel(original, filtering, uv, 0);
      if (view.mode == 1 || (view.mode == 2 && uv.x >= view.split)) {
        color = textureSampleLevel(cutout, filtering, uv, 0);
      }
      if (view.mode == 2 && abs(uv.x - view.split) * view.image.x * scale < 1) { return vec4f(1); }
      return vec4f(mix(background, color.rgb, color.a), 1);
    }` });
  const pipeline = await device.createRenderPipelineAsync({ layout: 'auto',
    vertex: { module: shader, entryPoint: 'vertex' },
    fragment: { module: shader, entryPoint: 'fragment', targets: [{ format }] } });
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  let textures = [], bindings, width = 1, height = 1, zoom = 1, pan = [0, 0], mode = 0, split = .5, background = 0;
  let pending = null, dirty = false, disposed = false, sequence = 0;
  function redraw() {
    if (disposed) return;
    dirty = true;
    if (pending || !bindings) return;
    pending = foreground.request({ requestId: `cutout-view:${++sequence}`, run(opportunity) {
      dirty = false; if (disposed) return;
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.min(device.limits.maxTextureDimension2D, Math.round(canvas.clientWidth * ratio)));
      canvas.height = Math.max(1, Math.min(device.limits.maxTextureDimension2D, Math.round(canvas.clientHeight * ratio)));
      device.queue.writeBuffer(params, 0, new Float32Array([canvas.width, canvas.height, width, height,
        pan[0] * ratio, pan[1] * ratio, zoom, mode, split, background, 0, 0]));
      const encoder = device.createCommandEncoder(), pass = encoder.beginRenderPass({ colorAttachments: [{
        view: context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0.8, 0.8, 0.8, 1] }] });
      pass.setPipeline(pipeline); pass.setBindGroup(0, bindings); pass.draw(3); pass.end();
      opportunity.submit([encoder.finish()]);
    } });
    pending.completion.then(receipt => {
      pending = null; if (disposed) return;
      if (receipt.status !== 'completed') { onError(Error(receipt.failure?.error?.message || receipt.status)); return; }
      if (dirty) redraw();
    }).catch(onError);
  }
  function setImages(source, result) {
    const images = result ? [source, result] : [source];
    for (const image of images) if (Math.max(image.width, image.height) > device.limits.maxTextureDimension2D)
      throw Error(`Image exceeds this device's ${device.limits.maxTextureDimension2D}-pixel texture dimension`);
    const next = [];
    try {
      for (const image of images) {
        const texture = device.createTexture({ size: [image.width, image.height], format: 'rgba8unorm',
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
        next.push(texture);
        device.queue.writeTexture({ texture }, image.rgba, { bytesPerRow: image.width * 4 }, [image.width, image.height]);
      }
      bindings = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
        { binding: 0, resource: { buffer: params } }, { binding: 1, resource: next[0].createView() },
        { binding: 2, resource: (next[1] || next[0]).createView() }, { binding: 3, resource: sampler }] });
    } catch (error) { next.forEach(texture => texture.destroy()); throw error; }
    textures.forEach(texture => texture.destroy()); textures = next;
    width = source.width; height = source.height; redraw();
  }
  const resize = new ResizeObserver(redraw); resize.observe(canvas);
  const down = event => { if (event.button === 0) canvas.setPointerCapture(event.pointerId); };
  const move = event => {
    if (!canvas.hasPointerCapture(event.pointerId)) return;
    pan[0] += event.movementX; pan[1] += event.movementY; redraw();
  };
  canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move);
  return {
    setImages,
    setMode(value) { mode = { original: 0, cutout: 1, compare: 2 }[value]; redraw(); },
    setSplit(value) { split = value; redraw(); },
    setBackground(value) { background = { checker: 0, light: 1, dark: 2 }[value]; redraw(); },
    setZoom(value) { zoom = value; redraw(); },
    fit() { zoom = 1; pan = [0, 0]; redraw(); },
    destroy() {
      if (disposed) return;
      disposed = true; pending?.cancel(); resize.disconnect();
      canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move);
      textures.forEach(texture => texture.destroy()); params.destroy(); context.unconfigure();
    },
  };
}
