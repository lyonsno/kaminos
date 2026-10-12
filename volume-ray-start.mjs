export const BLUE_NOISE_SIZE = 64;
export const BLUE_NOISE_URL = new URL('./assets/blue-noise/64-LDR-L0.png', import.meta.url);
export const RAY_START_WGSL = /* wgsl */`
@group(0) @binding(23) var rayStartNoise: texture_2d<f32>;
fn rayStartPhase(pixel: vec2<f32>, enabled: f32, fullGridCapture: bool) -> f32 {
  if (enabled < 0.5 || fullGridCapture) { return 0.5; }
  let texel = vec2<i32>(vec2<u32>(pixel) % vec2<u32>(64u));
  // Bin centers avoid either endpoint and retain a mean phase of one half.
  return (textureLoad(rayStartNoise, texel, 0).r * 255.0 + 0.5) / 256.0;
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
    if (image.width !== BLUE_NOISE_SIZE || image.height !== BLUE_NOISE_SIZE) {
      throw new Error('blue-noise texture dimensions must be 64x64');
    }
    texture = device.createTexture({
      label: 'kaminos stable spatial blue-noise ray starts',
      size: [BLUE_NOISE_SIZE, BLUE_NOISE_SIZE], format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    device.queue.copyExternalImageToTexture({source:image}, {texture}, [BLUE_NOISE_SIZE, BLUE_NOISE_SIZE]);
    return texture;
  } catch (error) {
    texture?.destroy();
    throw error;
  } finally {
    image.close();
  }
}
