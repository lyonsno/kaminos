/**
 * clip_prep_core.js — pure CPU preparation for the CLIP material estimator:
 * alpha-blend, 512→224 bilinear resize + normalize, and the 32×32 patch
 * embedding (49 patches × 3072 → 768, plus CLS and positional embeddings).
 *
 * This is the exact math that lived inline in main.js (blend) and
 * clip_estimator.js (_preprocessForCLIP / _patchEmbed), extracted unchanged so
 * it can run on a Web Worker (clip_prep_worker.js) with byte-identical output.
 * The patch embedding alone is ~115M multiply-adds in JavaScript — the largest
 * single contiguous main-thread stall in the route (~225ms) when run inline.
 *
 * No DOM, no GPU: typed arrays in, typed arrays out.
 */

const CLIP_HIDDEN_DIM = 768;
const CLIP_PATCH_SIZE = 32;
const CLIP_IMAGE_SIZE = 224;
const CLIP_NUM_PATCHES = (CLIP_IMAGE_SIZE / CLIP_PATCH_SIZE) ** 2; // 49
const CLIP_NUM_TOKENS = CLIP_NUM_PATCHES + 1; // 50
const CLIP_COND_IMAGE_SIZE = 512;
const CLIP_PATCH_DIM = 3 * CLIP_PATCH_SIZE * CLIP_PATCH_SIZE; // 3072

const CLIP_MEAN = Object.freeze([0.48145466, 0.4578275, 0.40821073]);
const CLIP_STD = Object.freeze([0.26862954, 0.26130258, 0.27577711]);

function validateClipPrepWeights({ conv1W, classEmb, posEmb }) {
  if (!(conv1W instanceof Float32Array) || conv1W.length !== CLIP_HIDDEN_DIM * CLIP_PATCH_DIM) {
    throw new Error(`clip conv1 weight must be Float32Array[${CLIP_HIDDEN_DIM * CLIP_PATCH_DIM}], got ${conv1W?.length}`);
  }
  if (!(classEmb instanceof Float32Array) || classEmb.length !== CLIP_HIDDEN_DIM) {
    throw new Error(`clip class embedding must be Float32Array[${CLIP_HIDDEN_DIM}], got ${classEmb?.length}`);
  }
  if (!(posEmb instanceof Float32Array) || posEmb.length !== CLIP_NUM_TOKENS * CLIP_HIDDEN_DIM) {
    throw new Error(`clip positional embedding must be Float32Array[${CLIP_NUM_TOKENS * CLIP_HIDDEN_DIM}], got ${posEmb?.length}`);
  }
  return { conv1W, classEmb, posEmb };
}

/**
 * Match the PyTorch preprocessing order exactly:
 *   1. (caller) PIL/canvas resize to cond_image_size on uint8 RGBA
 *   2. convert to float, alpha-blend with grey [0.5, 0.5, 0.5]
 *   3. multiply by mask (alpha)
 * Returns float32 RGBA (premultiplied by mask), same length as the input.
 * @param {Uint8ClampedArray|Uint8Array} rgba8  width*height*4 bytes
 */
function blendClipPixels(rgba8, width, height) {
  const count = width * height;
  if (rgba8.length !== count * 4) {
    throw new Error(`clip input must be ${count * 4} RGBA bytes for ${width}x${height}, got ${rgba8.length}`);
  }
  const clipPixels = new Float32Array(count * 4);
  for (let i = 0; i < rgba8.length; i++) clipPixels[i] = rgba8[i] / 255.0;
  for (let i = 0; i < count; i++) {
    const a = clipPixels[i * 4 + 3];
    clipPixels[i * 4]     = (clipPixels[i * 4] * a + 0.5 * (1 - a)) * a;
    clipPixels[i * 4 + 1] = (clipPixels[i * 4 + 1] * a + 0.5 * (1 - a)) * a;
    clipPixels[i * 4 + 2] = (clipPixels[i * 4 + 2] * a + 0.5 * (1 - a)) * a;
  }
  return clipPixels;
}

/** Resize RGBA float32 image using bilinear interpolation (align_corners=False). */
function bilinearResizeRGBA(src, srcW, srcH, dstW, dstH) {
  const dst = new Float32Array(dstW * dstH * 4);
  for (let y = 0; y < dstH; y++) {
    for (let x = 0; x < dstW; x++) {
      const srcX = Math.max(0, (x + 0.5) * (srcW / dstW) - 0.5);
      const srcY = Math.max(0, (y + 0.5) * (srcH / dstH) - 0.5);
      const x0 = Math.floor(srcX), y0 = Math.floor(srcY);
      const x1 = Math.min(x0 + 1, srcW - 1), y1 = Math.min(y0 + 1, srcH - 1);
      const fx = srcX - x0, fy = srcY - y0;
      for (let c = 0; c < 4; c++) {
        dst[(y * dstW + x) * 4 + c] =
          src[(y0 * srcW + x0) * 4 + c] * (1-fx)*(1-fy) +
          src[(y0 * srcW + x1) * 4 + c] * fx*(1-fy) +
          src[(y1 * srcW + x0) * 4 + c] * (1-fx)*fy +
          src[(y1 * srcW + x1) * 4 + c] * fx*fy;
      }
    }
  }
  return dst;
}

/**
 * Float RGBA (blended) → normalized CHW float32 [3, 224, 224].
 * First resizes to cond_image_size (512) if needed, then 512→224 bilinear
 * (F.interpolate, align_corners=False) and CLIP mean/std normalization.
 */
function preprocessForClip(pixels, width, height) {
  let img = pixels;
  let w = width, h = height;
  if (w !== CLIP_COND_IMAGE_SIZE || h !== CLIP_COND_IMAGE_SIZE) {
    img = bilinearResizeRGBA(img, w, h, CLIP_COND_IMAGE_SIZE, CLIP_COND_IMAGE_SIZE);
    w = CLIP_COND_IMAGE_SIZE;
    h = CLIP_COND_IMAGE_SIZE;
  }
  const S = CLIP_IMAGE_SIZE;
  const out = new Float32Array(3 * S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const srcX = Math.max(0, (x + 0.5) * (w / S) - 0.5);
      const srcY = Math.max(0, (y + 0.5) * (h / S) - 0.5);
      const x0 = Math.floor(srcX), y0 = Math.floor(srcY);
      const x1 = Math.min(x0 + 1, w - 1), y1 = Math.min(y0 + 1, h - 1);
      const fx = srcX - x0, fy = srcY - y0;
      for (let c = 0; c < 3; c++) {
        const v = img[(y0 * w + x0) * 4 + c] * (1-fx)*(1-fy) +
                  img[(y0 * w + x1) * 4 + c] * fx*(1-fy) +
                  img[(y1 * w + x0) * 4 + c] * (1-fx)*fy +
                  img[(y1 * w + x1) * 4 + c] * fx*fy;
        out[c * S * S + y * S + x] = (v - CLIP_MEAN[c]) / CLIP_STD[c];
      }
    }
  }
  return out;
}

/**
 * CLIP ViT-B/32 patch embedding: CHW [3,224,224] → [50, 768] tokens
 * (CLS + 49 patches), positional embedding added.
 */
function patchEmbedClip(image, { conv1W, classEmb, posEmb }) {
  if (!(image instanceof Float32Array) || image.length !== 3 * CLIP_IMAGE_SIZE * CLIP_IMAGE_SIZE) {
    throw new Error(`clip image must be Float32Array[${3 * CLIP_IMAGE_SIZE * CLIP_IMAGE_SIZE}], got ${image?.length}`);
  }
  const D = CLIP_HIDDEN_DIM, P = CLIP_PATCH_SIZE, S = CLIP_IMAGE_SIZE;
  const patchDim = CLIP_PATCH_DIM;
  const result = new Float32Array(CLIP_NUM_TOKENS * D);

  for (let d = 0; d < D; d++) result[d] = classEmb[d];

  for (let py = 0; py < 7; py++) {
    for (let px = 0; px < 7; px++) {
      const patchIdx = py * 7 + px;
      for (let d = 0; d < D; d++) {
        let sum = 0;
        for (let c = 0; c < 3; c++) {
          for (let dy = 0; dy < P; dy++) {
            for (let dx = 0; dx < P; dx++) {
              sum += image[c * S * S + (py*P+dy) * S + (px*P+dx)]
                   * conv1W[d * patchDim + c * P * P + dy * P + dx];
            }
          }
        }
        result[(patchIdx + 1) * D + d] = sum;
      }
    }
  }

  for (let i = 0; i < CLIP_NUM_TOKENS * D; i++) result[i] += posEmb[i];
  return result;
}

/**
 * The complete CPU prep: uint8 RGBA (already resized to cond size by the
 * caller's canvas) → [50, 768] token embeddings ready for the transformer.
 */
function prepareClipEmbeddings(rgba8, width, height, prepWeights) {
  const w = validateClipPrepWeights(prepWeights);
  const blended = blendClipPixels(rgba8, width, height);
  const chw = preprocessForClip(blended, width, height);
  return patchEmbedClip(chw, w);
}

/**
 * clip_prep_worker.js — Web Worker running the CLIP CPU prep (alpha-blend,
 * 512→224 resize + normalize, 32×32 patch embedding) off the main thread.
 *
 * Protocol (request/response by id, driven through worker_call.js):
 *   { type: 'init', id, conv1W, classEmb, posEmb }   ArrayBuffers (copied in
 *       for the caller's current weight identity)  → { id, ok: true, initialized: true }
 *   { type: 'reset', id }                            releases copied tensors
 *                                                   → { id, ok: true, reset: true }
 *   { id, rgba, width, height }                     rgba ArrayBuffer (transferred)
 *                                                    → { id, ok: true, embeddings }  (transferred)
 * Uses the SAME clip_prep_core math as the main-thread path, so the
 * [50, 768] embeddings are byte-identical.
 */

let prepWeights = null;

self.onmessage = (e) => {
  const d = e.data;
  if (d?.type === 'init') {
    try {
      // Revoke old copied tensors before validating a replacement. A failed
      // replacement must not leave a caller believing it can still use old
      // preparation weights.
      prepWeights = null;
      prepWeights = validateClipPrepWeights({
        conv1W: new Float32Array(d.conv1W),
        classEmb: new Float32Array(d.classEmb),
        posEmb: new Float32Array(d.posEmb),
      });
      self.postMessage({ id: d.id, ok: true, initialized: true });
    } catch (err) {
      self.postMessage({ id: d.id, ok: false, error: String(err?.stack || err) });
    }
    return;
  }
  if (d?.type === 'reset') {
    prepWeights = null;
    self.postMessage({ id: d.id, ok: true, reset: true });
    return;
  }
  try {
    if (!prepWeights) throw new Error('clip prep worker used before init');
    const embeddings = prepareClipEmbeddings(new Uint8ClampedArray(d.rgba), d.width, d.height, prepWeights);
    self.postMessage({ id: d.id, ok: true, embeddings: embeddings.buffer }, [embeddings.buffer]);
  } catch (err) {
    self.postMessage({ id: d.id, ok: false, error: String(err?.stack || err) });
  }
};
//# sourceMappingURL=clip_prep_worker-LK4p3S_6.js.map
