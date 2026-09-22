function dimensions(width, height) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw new Error('mask dimensions must be positive integers');
  }
}

// Meta's image processor interpolates logits with align_corners=False before
// sigmoid > 0.5 (equivalently logit > 0); binary nearest-neighbor is different.
export function resizeSam3MaskLogits(logits, width, height, targetWidth, targetHeight) {
  dimensions(width, height);
  dimensions(targetWidth, targetHeight);
  if (!logits || logits.length !== width * height) throw new Error('mask logits length does not match dimensions');
  for (const value of logits) if (!Number.isFinite(value)) throw new Error('mask logits must be finite');
  const output = new Float32Array(targetWidth * targetHeight);
  for (let y = 0; y < targetHeight; y += 1) {
    const sy = Math.max(0, (y + 0.5) * height / targetHeight - 0.5);
    const y0 = Math.floor(sy), y1 = Math.min(y0 + 1, height - 1), fy = sy - y0;
    for (let x = 0; x < targetWidth; x += 1) {
      const sx = Math.max(0, (x + 0.5) * width / targetWidth - 0.5);
      const x0 = Math.floor(sx), x1 = Math.min(x0 + 1, width - 1), fx = sx - x0;
      const top = logits[y0 * width + x0] * (1 - fx) + logits[y0 * width + x1] * fx;
      const bottom = logits[y1 * width + x0] * (1 - fx) + logits[y1 * width + x1] * fx;
      output[y * targetWidth + x] = top * (1 - fy) + bottom * fy;
    }
  }
  return output;
}

export function createSam3SourceMask(output, indices, width, height) {
  dimensions(width, height);
  const mask = new Uint8Array(width * height);
  for (const index of indices) {
    const instance = output.instances.find(row => row.index === index);
    if (!instance) throw new Error(`unknown instance ${index}`);
    const logits = resizeSam3MaskLogits(instance.logits, output.width, output.height, width, height);
    for (let i = 0; i < mask.length; i += 1) if (logits[i] > 0) mask[i] = 1;
  }
  return mask;
}
