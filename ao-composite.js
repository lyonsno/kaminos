/**
 * Raw WebGPU composite pass: fullscreen triangle that multiplies
 * scene color by AO texture and writes to the canvas.
 *
 * This bypasses Three.js entirely for the final blit — it takes
 * a GPUTexture (color) and GPUTexture (AO, r32float) and renders
 * color * ao to the canvas swap chain.
 */

const COMPOSITE_WGSL = /* wgsl */`
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vs(@builtin(vertex_index) vid: u32) -> VertexOutput {
  // Fullscreen triangle (3 vertices cover the screen)
  var pos = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f(3.0, -1.0),
    vec2f(-1.0, 3.0)
  );
  var uvs = array<vec2f, 3>(
    vec2f(0.0, 1.0),
    vec2f(2.0, 1.0),
    vec2f(0.0, -1.0)
  );
  var out: VertexOutput;
  out.position = vec4f(pos[vid], 0.0, 1.0);
  out.uv = uvs[vid];
  return out;
}

@group(0) @binding(0) var colorTex: texture_2d<f32>;
@group(0) @binding(1) var aoTex: texture_2d<f32>;
@group(0) @binding(2) var texSampler: sampler;

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4f {
  let color = textureSample(colorTex, texSampler, in.uv);
  let ao = textureSample(aoTex, texSampler, in.uv).r;
  return vec4f(color.rgb * ao, color.a);
}
`;

class AOCompositePass {
  constructor(device, canvasFormat) {
    this._device = device;
    this._canvasFormat = canvasFormat;
    this._pipeline = null;
    this._sampler = null;
    this._init();
  }

  _init() {
    const device = this._device;

    const module = device.createShaderModule({ code: COMPOSITE_WGSL });

    this._pipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module,
        entryPoint: 'vs',
      },
      fragment: {
        module,
        entryPoint: 'fs',
        targets: [{ format: this._canvasFormat }],
      },
      primitive: {
        topology: 'triangle-list',
      },
    });

    this._sampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
    });
  }

  /**
   * Draw the composite to the canvas.
   * @param {GPUTexture} colorTexture - Scene color (rgba8unorm or similar)
   * @param {GPUTexture} aoTexture - AO result (r32float, 0=occluded 1=visible)
   * @param {GPUTextureView} canvasView - The current frame's canvas texture view
   */
  render(colorTexture, aoTexture, canvasView) {
    const device = this._device;

    const bindGroup = device.createBindGroup({
      layout: this._pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: colorTexture.createView() },
        { binding: 1, resource: aoTexture.createView() },
        { binding: 2, resource: this._sampler },
      ],
    });

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: canvasView,
        loadOp: 'clear',
        storeOp: 'store',
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
      }],
    });

    pass.setPipeline(this._pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3); // fullscreen triangle
    pass.end();

    device.queue.submit([encoder.finish()]);
  }
}

export { AOCompositePass };
