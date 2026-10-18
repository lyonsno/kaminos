export const BLUE_NOISE_SIZE = 128;
export const BLUE_NOISE_FRAMES = 32;
export const BLUE_NOISE_URL = new URL('./assets/blue-noise/fast-scalar-temporal.png', import.meta.url);
export const RAY_START_WGSL = /* wgsl */`
@group(0) @binding(25) var rayStartNoise: texture_2d<f32>;
fn rayNoiseSample(pixel: vec2<f32>, phase: f32, dimension: u32) -> f32 {
  // R2 offsets separate per-ray sample dimensions. They stay fixed over time
  // so the precomputed temporal sequence is not scrambled by frame shifts.
  let offset = vec2<u32>(fract(f32(dimension) * vec2<f32>(0.754877666, 0.569840296)) * 128.0);
  let frame = u32(phase) % 32u;
  let tile = vec2<u32>(frame % 8u, frame / 8u) * 128u;
  let texel = vec2<i32>((vec2<u32>(pixel) + offset) % vec2<u32>(128u) + tile);
  return (textureLoad(rayStartNoise, texel, 0).r * 255.0 + 0.5) / 256.0;
}
fn rayStartPhase(pixel: vec2<f32>, enabled: f32, fullGridCapture: bool) -> f32 {
  if (enabled < 0.5 || fullGridCapture) { return 0.5; }
  return rayNoiseSample(pixel, 0.0, 0u);
}
fn rayStartPhaseAtFrame(pixel: vec2<f32>, enabled: f32, fullGridCapture: bool, phase: f32) -> f32 {
  if (enabled < 0.5 || fullGridCapture) { return 0.5; }
  return rayNoiseSample(pixel, phase, 0u);
}
`;

export async function createRayStartTexture(device, {
  fetchImpl = globalThis.fetch, decode = globalThis.createImageBitmap,
} = {}) {
  const response = await fetchImpl(BLUE_NOISE_URL);
  if (!response.ok) throw new Error(`blue-noise texture load failed: HTTP ${response.status}`);
  const image = await decode(await response.blob(), {
    colorSpaceConversion: 'none', premultiplyAlpha: 'none',
  });
  let texture;
  try {
    if (image.width !== BLUE_NOISE_SIZE * 8 || image.height !== BLUE_NOISE_SIZE * 4) {
      throw new Error('blue-noise texture dimensions must be 1024x512 (128x128x32 atlas)');
    }
    texture = device.createTexture({
      label: 'kaminos FAST spatiotemporal scalar sampling',
      size: [BLUE_NOISE_SIZE * 8, BLUE_NOISE_SIZE * 4], format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    device.queue.copyExternalImageToTexture({source:image}, {texture}, [BLUE_NOISE_SIZE * 8, BLUE_NOISE_SIZE * 4]);
    return texture;
  } catch (error) {
    texture?.destroy();
    throw error;
  } finally {
    image.close();
  }
}
