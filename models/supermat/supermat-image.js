// Decode a browser image source to straight (unpremultiplied) RGBA8 bytes.
// A 2D canvas stores premultiplied pixels and would round partial-alpha edges;
// copying the bitmap into an rgba8unorm texture with premultipliedAlpha:false
// keeps the decoder's straight-alpha values.
const COPY_SRC = 0x01, COPY_DST = 0x02, RENDER_ATTACHMENT = 0x10;

export async function decodeImageRgba(source, device) {
  const bitmap = source instanceof ImageBitmap ? source
    : await createImageBitmap(source, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const { width, height } = bitmap;
  const texture = device.createTexture({ label: 'supermat.decoded-image', size: [width, height],
    format: 'rgba8unorm', usage: COPY_SRC | COPY_DST | RENDER_ATTACHMENT });
  const bytesPerRow = Math.ceil((width * 4) / 256) * 256;
  const staging = device.createBuffer({ label: 'supermat.decoded-image.readback', size: bytesPerRow * height,
    usage: 0x0001 | 0x0008 });
  try {
    device.queue.copyExternalImageToTexture({ source: bitmap }, { texture, premultipliedAlpha: false }, [width, height]);
    const encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer({ texture }, { buffer: staging, bytesPerRow, rowsPerImage: height }, [width, height]);
    device.queue.submit([encoder.finish()]);
    await staging.mapAsync(0x0001);
    const padded = new Uint8Array(staging.getMappedRange());
    const data = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) data.set(padded.subarray(y * bytesPerRow, y * bytesPerRow + width * 4), y * width * 4);
    staging.unmap();
    return { width, height, data };
  } finally {
    staging.destroy();
    texture.destroy();
    if (bitmap !== source) bitmap.close();
  }
}
