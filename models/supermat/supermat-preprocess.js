// SuperMat input preprocessing, matching the pinned source exactly:
// PIL `Image.resize(size, BILINEAR)` on RGBA (Pillow 12.3 libImaging/Resample.c
// with RGBA -> RGBa premultiplication) followed by the source's float32 gray
// composite (src/utils.load_rgba_image_as_rgb_tensor).

const PRECISION_BITS = 22;
const ONE = 1 << PRECISION_BITS;

function requireImage({ width, height, data }) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error('image width and height must be positive integers');
  }
  if (!(data instanceof Uint8Array || data instanceof Uint8ClampedArray) || data.length !== width * height * 4) {
    throw new Error('image data must be RGBA bytes of width * height * 4');
  }
}

function clip8(sum) {
  const value = Math.floor(sum / ONE);
  return value < 0 ? 0 : value > 255 ? 255 : value;
}

// precompute_coeffs + normalize_coeffs_8bpc for the bilinear (triangle) filter.
function coefficients(inSize, outSize) {
  const scale = inSize / outSize;
  const filterScale = Math.max(scale, 1);
  const support = filterScale;
  const inverse = 1 / filterScale;
  const rows = [];
  for (let xx = 0; xx < outSize; xx++) {
    const center = (xx + 0.5) * scale;
    const min = Math.max(Math.trunc(center - support + 0.5), 0);
    const count = Math.min(Math.trunc(center + support + 0.5), inSize) - min;
    const weights = new Float64Array(count);
    let total = 0;
    for (let x = 0; x < count; x++) {
      let t = Math.abs((x + min - center + 0.5) * inverse);
      weights[x] = t < 1 ? 1 - t : 0;
      total += weights[x];
    }
    const fixed = new Int32Array(count);
    for (let x = 0; x < count; x++) {
      const w = total !== 0 ? weights[x] / total : weights[x];
      fixed[x] = w < 0 ? Math.trunc(-0.5 + w * ONE) : Math.trunc(0.5 + w * ONE);
    }
    rows.push({ min, fixed });
  }
  return rows;
}

function premultiply(data) {
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    for (let c = 0; c < 3; c++) {
      const tmp = data[i + c] * alpha + 128;
      out[i + c] = ((tmp >> 8) + tmp) >> 8;
    }
    out[i + 3] = alpha;
  }
  return out;
}

function unpremultiply(data) {
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    for (let c = 0; c < 3; c++) {
      out[i + c] = alpha === 0 || alpha === 255 ? data[i + c] : Math.min(255, Math.floor((255 * data[i + c]) / alpha));
    }
    out[i + 3] = alpha;
  }
  return out;
}

export function resizeRgbaBilinear(image, width, height) {
  requireImage(image);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error('target width and height must be positive integers');
  }
  if (image.width === width && image.height === height) {
    return { width, height, data: new Uint8Array(image.data) };
  }
  let data = premultiply(image.data), currentWidth = image.width, currentHeight = image.height;
  const vertical = height !== image.height ? coefficients(image.height, height) : null;
  if (width !== image.width) {
    const horizontal = coefficients(image.width, width);
    const first = vertical ? vertical[0].min : 0;
    const last = vertical ? vertical.at(-1).min + vertical.at(-1).fixed.length : image.height;
    const temp = new Uint8Array(width * (last - first) * 4);
    for (let y = first; y < last; y++) {
      const inRow = y * image.width * 4, outRow = (y - first) * width * 4;
      for (let xx = 0; xx < width; xx++) {
        const { min, fixed } = horizontal[xx];
        let s0 = ONE / 2, s1 = ONE / 2, s2 = ONE / 2, s3 = ONE / 2;
        for (let x = 0; x < fixed.length; x++) {
          const p = inRow + (x + min) * 4, k = fixed[x];
          s0 += data[p] * k; s1 += data[p + 1] * k; s2 += data[p + 2] * k; s3 += data[p + 3] * k;
        }
        const o = outRow + xx * 4;
        temp[o] = clip8(s0); temp[o + 1] = clip8(s1); temp[o + 2] = clip8(s2); temp[o + 3] = clip8(s3);
      }
    }
    if (vertical) for (const row of vertical) row.min -= first;
    data = temp;
    currentWidth = width;
    currentHeight = last - first;
  }
  if (vertical) {
    const out = new Uint8Array(currentWidth * height * 4);
    for (let yy = 0; yy < height; yy++) {
      const { min, fixed } = vertical[yy];
      for (let xx = 0; xx < currentWidth; xx++) {
        let s0 = ONE / 2, s1 = ONE / 2, s2 = ONE / 2, s3 = ONE / 2;
        for (let y = 0; y < fixed.length; y++) {
          const p = ((y + min) * currentWidth + xx) * 4, k = fixed[y];
          s0 += data[p] * k; s1 += data[p + 1] * k; s2 += data[p + 2] * k; s3 += data[p + 3] * k;
        }
        const o = (yy * currentWidth + xx) * 4;
        out[o] = clip8(s0); out[o + 1] = clip8(s1); out[o + 2] = clip8(s2); out[o + 3] = clip8(s3);
      }
    }
    data = out;
    currentHeight = height;
  }
  return { width: currentWidth, height: currentHeight, data: unpremultiply(data) };
}

// rgb * alpha + 0.5 * (1 - alpha) in float32, as CHW [3, height, width] in [0, 1].
export function compositeOnGray(image) {
  requireImage(image);
  const f = Math.fround, plane = image.width * image.height;
  const out = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    const alpha = f(image.data[i * 4 + 3] / 255);
    const background = f(0.5 * f(1 - alpha));
    for (let c = 0; c < 3; c++) {
      out[c * plane + i] = f(f(f(image.data[i * 4 + c] / 255) * alpha) + background);
    }
  }
  return out;
}

export function preprocessForSuperMat(image, size = 512) {
  return compositeOnGray(resizeRgbaBilinear(image, size, size));
}
