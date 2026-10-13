// Live previews for iterative latent models (diffusion, flow matching): a linear map from latent
// channels to RGB, applied per latent pixel on the GPU, with a readback that never blocks the run.
//
// The model owns the latent: it writes a channels-last f32 estimate of the clean latent
// ([pixels][channels], in the space its decoder reads) and encodes the preview into its own
// command encoder. encode() returns take(), to call once that encoder has been submitted; take()
// resolves with { width, height, rgba }. When every readback slot is still being read, encode()
// skips the preview and returns null, so a slow consumer costs previews, never model time.
// The weights are fitted per decoder (rgb = z . W + b with rgb in -1..1); for FLUX.2 see
// models/flux2-klein/fit-latent-preview.py.

export function latentPreviewShader() {
  return `struct P { pixels: u32, channels: u32, z0: u32, z1: u32 };
@group(0) @binding(0) var<storage, read> z: array<f32>;
@group(0) @binding(1) var<storage, read> m: array<f32>;
@group(0) @binding(2) var<storage, read_write> out: array<u32>;
@group(0) @binding(3) var<uniform> p: P;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x; if (i >= p.pixels) { return; }
  let C = p.channels;
  var rgb = vec3<f32>(m[C * 3u], m[C * 3u + 1u], m[C * 3u + 2u]);
  for (var c = 0u; c < C; c++) {
    let v = z[i * C + c];
    rgb += v * vec3<f32>(m[c * 3u], m[c * 3u + 1u], m[c * 3u + 2u]);
  }
  out[i] = pack4x8unorm(vec4<f32>(clamp(rgb * 0.5 + 0.5, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0));
}`;
}

function validate({ channels, weights, bias }) {
  if (!Number.isInteger(channels) || channels < 1) throw new Error('latent preview channels must be a positive integer');
  if (weights?.length !== channels * 3) throw new Error(`latent preview weights must hold channels * 3 = ${channels * 3} values`);
  if (bias?.length !== 3) throw new Error('latent preview bias must hold 3 values');
}

// CPU reference of the shader, for parity checks and tests.
export function projectLatentPreview({ latent, channels, weights, bias, pixels }) {
  validate({ channels, weights, bias });
  const rgba = new Uint8ClampedArray(pixels * 4);
  const unorm = v => Math.floor(0.5 + 255 * Math.min(1, Math.max(0, v * 0.5 + 0.5)));
  for (let i = 0; i < pixels; i++) {
    for (let k = 0; k < 3; k++) {
      let v = bias[k];
      for (let c = 0; c < channels; c++) v += latent[i * channels + c] * weights[c * 3 + k];
      rgba[i * 4 + k] = unorm(Math.fround(v));
    }
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

export async function createWebGpuLatentPreview({ device, channels, weights, bias, maxPixels, slots = 2 }) {
  validate({ channels, weights, bias });
  if (!Number.isInteger(maxPixels) || maxPixels < 1) throw new Error('latent preview maxPixels must be a positive integer');
  const usage = globalThis.GPUBufferUsage ?? { STORAGE: 0x80, UNIFORM: 0x40, COPY_SRC: 0x4, COPY_DST: 0x8, MAP_READ: 0x1 };
  const mapRead = globalThis.GPUMapMode?.READ ?? 1;
  const pipeline = await device.createComputePipelineAsync({ layout: 'auto',
    compute: { module: device.createShaderModule({ code: latentPreviewShader() }), entryPoint: 'main' } });
  const matrix = device.createBuffer({ size: (channels * 3 + 3) * 4, usage: usage.STORAGE | usage.COPY_DST });
  device.queue.writeBuffer(matrix, 0, new Float32Array([...weights, ...bias]));
  const uniform = device.createBuffer({ size: 16, usage: usage.UNIFORM | usage.COPY_DST });
  const out = device.createBuffer({ size: maxPixels * 4, usage: usage.STORAGE | usage.COPY_SRC });
  const pool = Array.from({ length: slots }, () => ({ buffer: device.createBuffer({ size: maxPixels * 4, usage: usage.MAP_READ | usage.COPY_DST }), busy: false }));

  function encode(encoder, latent, { width, height }) {
    const pixels = width * height;
    if (pixels > maxPixels) throw new Error(`latent preview of ${width} x ${height} exceeds maxPixels ${maxPixels}`);
    const slot = pool.find(s => !s.busy);
    if (!slot) return null;
    slot.busy = true;
    device.queue.writeBuffer(uniform, 0, new Uint32Array([pixels, channels, 0, 0]));
    const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: latent } }, { binding: 1, resource: { buffer: matrix } },
      { binding: 2, resource: { buffer: out } }, { binding: 3, resource: { buffer: uniform } }] });
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline); pass.setBindGroup(0, bind); pass.dispatchWorkgroups(Math.ceil(pixels / 64)); pass.end();
    encoder.copyBufferToBuffer(out, 0, slot.buffer, 0, pixels * 4);
    return async function take() {
      try {
        await slot.buffer.mapAsync(mapRead, 0, pixels * 4);
        const rgba = new Uint8ClampedArray(slot.buffer.getMappedRange(0, pixels * 4).slice(0));
        slot.buffer.unmap();
        return { width, height, rgba };
      } finally {
        slot.busy = false;
      }
    };
  }

  function destroy() { for (const b of [matrix, uniform, out, ...pool.map(s => s.buffer)]) b.destroy(); }
  return { encode, destroy, channels, maxPixels };
}
