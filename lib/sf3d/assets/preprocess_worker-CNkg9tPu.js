// SF3D resize_foreground at ff21fc4: inclusive alpha bounds, 0.85 occupancy,
// transparent square padding, then Pillow-compatible bicubic RGBA resampling.
const PRECISION = 2 ** 22;
const byte = value => Math.max(0, Math.min(255, value));

function cubic(x) {
  x = Math.abs(x);
  if (x < 1) return ((1.5 * x - 2.5) * x) * x + 1;
  if (x < 2) return ((-0.5 * x + 2.5) * x - 4) * x + 2;
  return 0;
}

function coefficients(sourceSize, targetSize) {
  const scale = sourceSize / targetSize;
  const filterScale = Math.max(1, scale);
  const support = 2 * filterScale;
  return Array.from({ length: targetSize }, (_, target) => {
    const center = (target + 0.5) * scale;
    const start = Math.max(0, Math.trunc(center - support + 0.5));
    const end = Math.min(sourceSize, Math.trunc(center + support + 0.5));
    const weights = Array.from({ length: end - start }, (_, i) => cubic((start + i - center + 0.5) / filterScale));
    const sum = weights.reduce((a, b) => a + b, 0);
    return { start, weights: weights.map(w => Math.trunc(w / sum * PRECISION + (w < 0 ? -0.5 : 0.5))) };
  });
}

function resizeRgba(source, side, size) {
  if (side === size) return source;
  // Pillow resizes RGBA in premultiplied RGBa, quantizing after each pass.
  for (let i = 0; i < source.length; i += 4) {
    for (let c = 0; c < 3; c++) source[i + c] = Math.round(source[i + c] * source[i + 3] / 255);
  }
  const kernel = coefficients(side, size);
  const horizontal = new Uint8Array(size * side * 4);
  const output = new Uint8Array(size * size * 4);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < size; x++) {
      const { start, weights } = kernel[x];
      for (let c = 0; c < 4; c++) {
        let sum = PRECISION / 2;
        for (let i = 0; i < weights.length; i++) sum += source[(y * side + start + i) * 4 + c] * weights[i];
        horizontal[(y * size + x) * 4 + c] = byte(Math.floor(sum / PRECISION));
      }
    }
  }
  for (let y = 0; y < size; y++) {
    const { start, weights } = kernel[y];
    for (let x = 0; x < size; x++) {
      for (let c = 0; c < 4; c++) {
        let sum = PRECISION / 2;
        for (let i = 0; i < weights.length; i++) sum += horizontal[((start + i) * size + x) * 4 + c] * weights[i];
        output[(y * size + x) * 4 + c] = byte(Math.floor(sum / PRECISION));
      }
    }
  }
  for (let i = 0; i < output.length; i += 4) {
    const alpha = output[i + 3];
    if (alpha && alpha < 255) {
      for (let c = 0; c < 3; c++) output[i + c] = byte(Math.floor(output[i + c] * 255 / alpha));
    }
  }
  return output;
}

function prepareForeground(data, width, height, size = 512) {
  if (![width, height, size].every(x => Number.isSafeInteger(x) && x > 0)
      || !(data instanceof Uint8Array || data instanceof Uint8ClampedArray)
      || data.length !== width * height * 4) throw new TypeError('Expected positive dimensions and matching RGBA bytes');
  let x1 = width, y1 = height, x2 = -1, y2 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 0) {
        x1 = Math.min(x1, x); x2 = Math.max(x2, x);
        y1 = Math.min(y1, y); y2 = Math.max(y2, y);
      }
    }
  }
  if (x2 < 0) throw new Error('Empty foreground mask');
  const scale = Math.max(x2 - x1, y2 - y1) / 0.85;
  const side = Math.trunc(scale);
  if (side < 1) throw new Error('Foreground crop is empty');
  const left = Math.trunc((x1 + x2 - scale) / 2) || 0;
  const top = Math.trunc((y1 + y2 - scale) / 2) || 0;
  const cropped = new Uint8Array(side * side * 4);
  for (let y = Math.max(0, top); y < Math.min(height, top + side); y++) {
    const from = Math.max(0, left), to = Math.min(width, left + side);
    cropped.set(data.subarray((y * width + from) * 4, (y * width + to) * 4), ((y - top) * side + from - left) * 4);
  }
  return { data: resizeRgba(cropped, side, size), width: size, height: size,
    crop: [left, top, left + side, top + side] };
}

/**
 * preprocess_core.js — pure, DOM-free image-preprocess math.
 *
 * Extracted from inference.js so the exact same Lanczos-3 resize + alpha-blend +
 * ImageNet-normalize runs on either the main thread OR a Web Worker, guaranteeing
 * byte-identical output. No canvas/DOM here: the caller supplies raw float32 RGBA
 * source pixels (from getImageData) and gets back the CHW float32 tensor.
 *
 * This is the tail-collapse target: image-preprocess is the largest foreground
 * gap (~700ms, main-thread Lanczos), and it has ZERO GPU sync — moving it to a
 * worker removes it from the main thread entirely with no per-duty fence floor.
 */


function lanczosKernel(x, a = 3) {
  if (x === 0) return 1;
  if (Math.abs(x) >= a) return 0;
  const px = Math.PI * x;
  return (a * Math.sin(px) * Math.sin(px / a)) / (px * px);
}

function lanczosResize(src, srcW, srcH, dstW, dstH) {
  // src is Float32Array [srcH, srcW, 4] RGBA
  const a = 3; // Lanczos-3
  const dst = new Float32Array(dstH * dstW * 4);
  const tmp = new Float32Array(dstW * srcH * 4);

  // Horizontal pass
  const xScale = srcW / dstW;
  for (let y = 0; y < srcH; y++) {
    for (let x = 0; x < dstW; x++) {
      const center = (x + 0.5) * xScale - 0.5;
      const left = Math.ceil(center - a);
      const right = Math.floor(center + a);
      let sumR = 0, sumG = 0, sumB = 0, sumA = 0, sumW = 0;
      for (let i = left; i <= right; i++) {
        const si = Math.min(Math.max(i, 0), srcW - 1);
        const w = lanczosKernel(center - i, a);
        const off = (y * srcW + si) * 4;
        sumR += src[off] * w;
        sumG += src[off + 1] * w;
        sumB += src[off + 2] * w;
        sumA += src[off + 3] * w;
        sumW += w;
      }
      const off = (y * dstW + x) * 4;
      tmp[off] = sumR / sumW;
      tmp[off + 1] = sumG / sumW;
      tmp[off + 2] = sumB / sumW;
      tmp[off + 3] = sumA / sumW;
    }
  }

  // Vertical pass
  const yScale = srcH / dstH;
  for (let y = 0; y < dstH; y++) {
    const center = (y + 0.5) * yScale - 0.5;
    const top = Math.ceil(center - a);
    const bottom = Math.floor(center + a);
    for (let x = 0; x < dstW; x++) {
      let sumR = 0, sumG = 0, sumB = 0, sumA = 0, sumW = 0;
      for (let j = top; j <= bottom; j++) {
        const sj = Math.min(Math.max(j, 0), srcH - 1);
        const w = lanczosKernel(center - j, a);
        const off = (sj * dstW + x) * 4;
        sumR += tmp[off] * w;
        sumG += tmp[off + 1] * w;
        sumB += tmp[off + 2] * w;
        sumA += tmp[off + 3] * w;
        sumW += w;
      }
      const off = (y * dstW + x) * 4;
      dst[off] = sumR / sumW;
      dst[off + 1] = sumG / sumW;
      dst[off + 2] = sumB / sumW;
      dst[off + 3] = sumA / sumW;
    }
  }
  return dst;
}

/**
 * Resize + alpha-blend + ImageNet-normalize raw float32 RGBA source pixels into
 * a CHW float32 tensor. Pure — identical on main thread and worker.
 *
 * @param {Float32Array} srcFloat  [srcH*srcW*4] float32 RGBA in [0,1]
 * @param {number} srcW
 * @param {number} srcH
 * @param {number} size            output size (512)
 * @param {number[]} bg            background color [r,g,b]
 * @param {number[]} imageMean
 * @param {number[]} imageStd
 * @returns {Float32Array} CHW [3*size*size]
 */
function resizeBlendNormalize(srcFloat, srcW, srcH, size, bg, imageMean, imageStd) {
  const resized = lanczosResize(srcFloat, srcW, srcH, size, size);
  const chw = new Float32Array(3 * size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const off = (y * size + x) * 4;
      const r = resized[off];
      const g = resized[off + 1];
      const b = resized[off + 2];
      const a = Math.max(0, Math.min(1, resized[off + 3]));
      const blendR = bg[0] * (1 - a) + r * a;
      const blendG = bg[1] * (1 - a) + g * a;
      const blendB = bg[2] * (1 - a) + b * a;
      chw[0 * size * size + y * size + x] = (blendR - imageMean[0]) / imageStd[0];
      chw[1 * size * size + y * size + x] = (blendG - imageMean[1]) / imageStd[1];
      chw[2 * size * size + y * size + x] = (blendB - imageMean[2]) / imageStd[2];
    }
  }
  return chw;
}

// One source preparation feeds both geometry and CLIP material estimation.
function prepareConditionImage(srcFloat, srcW, srcH, size, bg, imageMean, imageStd) {
  const rgba = Uint8Array.from(srcFloat, x => Math.round(x * 255));
  const framed = prepareForeground(rgba, srcW, srcH, size);
  const normalized = Float32Array.from(framed.data, x => x / 255);
  return {
    chw: resizeBlendNormalize(normalized, size, size, size, bg, imageMean, imageStd),
    rgba: framed.data,
  };
}

/**
 * preprocess_worker.js — Web Worker that runs the expensive image-preprocess
 * math (foreground framing, bicubic resize, blend and normalize) off the main thread.
 *
 * Receives raw float32 RGBA source pixels (transferred, zero-copy) + params,
 * returns the CHW tensor and shared framed RGBA pixels (transferred back). The main thread stays
 * responsive during the ~700ms that this work would otherwise block it.
 *
 * Uses the same condition_image math as the main-thread path, so output is
 * byte-identical.
 */

self.onmessage = (e) => {
  const { srcBuffer, srcW, srcH, size, bg, imageMean, imageStd, id } = e.data;
  try {
    const srcFloat = new Float32Array(srcBuffer);
    const { chw, rgba } = prepareConditionImage(srcFloat, srcW, srcH, size, bg, imageMean, imageStd);
    self.postMessage({ id, ok: true, chwBuffer: chw.buffer, rgbaBuffer: rgba.buffer }, [chw.buffer, rgba.buffer]);
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err?.stack || err) });
  }
};
//# sourceMappingURL=preprocess_worker-CNkg9tPu.js.map
