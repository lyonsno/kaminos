// Detections from the decoded hand detector head, as WiLoR-MLX's
// HandPosePipeline makes them: best class score >= threshold, class-agnostic
// NMS at IoU 0.5, letterbox pixels mapped back to the source image. NumPy 2
// keeps float32 arrays float32 against Python float scalars, so the mapping
// rounds to float32 at each step, as here.

import { DETECTOR_SIZE } from './detector-kernels.js';

const f32 = Math.fround;

function nms(boxes, scores, iouThreshold) {
  const corners = boxes.map(([cx, cy, w, h]) => [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2]);
  const areas = corners.map(([x1, y1, x2, y2]) => (x2 - x1) * (y2 - y1));
  let order = scores.map((s, i) => i).sort((a, b) => scores[b] - scores[a] || a - b);
  const keep = [];
  while (order.length) {
    const i = order[0];
    keep.push(i);
    order = order.slice(1).filter(j => {
      const iw = Math.max(0, Math.min(corners[i][2], corners[j][2]) - Math.max(corners[i][0], corners[j][0]));
      const ih = Math.max(0, Math.min(corners[i][3], corners[j][3]) - Math.max(corners[i][1], corners[j][1]));
      const inter = iw * ih;
      return inter / (areas[i] + areas[j] - inter + 1e-6) <= iouThreshold;
    });
  }
  return keep;
}

// output: Float32Array [69, anchors]. Returns [{ handSide, confidence, bbox:
// [x1, y1, x2, y2], keypoints: [[x, y] x 21], visibility: [21], anchor }] in
// source pixels, highest confidence first.
export function decodeDetections(output, { width, height, threshold = 0.3, iouThreshold = 0.5, anchors = output.length / 69 } = {}) {
  if (!Number.isInteger(anchors) || output.length !== anchors * 69) throw new Error('decoded head output must be [69, anchors]');
  if (!(threshold >= 0 && threshold <= 1)) throw new RangeError('threshold must be in [0, 1]');
  const at = (row, a) => output[row * anchors + a];
  const candidates = [];
  for (let a = 0; a < anchors; a++) {
    const left = at(4, a), right = at(5, a), score = Math.max(left, right);
    if (score >= threshold) candidates.push(a);
  }
  const boxes = candidates.map(a => [at(0, a), at(1, a), at(2, a), at(3, a)]);
  const scores = candidates.map(a => Math.max(at(4, a), at(5, a)));
  const side = f32(Math.max(width, height)), scale = f32(side / DETECTOR_SIZE);
  const ox = f32((side - width) / 2), oy = f32((side - height) / 2);
  return nms(boxes, scores, iouThreshold).map(k => {
    const a = candidates[k], [cx, cy, bw, bh] = boxes[k];
    const cxo = f32(f32(cx * scale) - ox), cyo = f32(f32(cy * scale) - oy), bwo = f32(bw * scale), bho = f32(bh * scale);
    return {
      handSide: at(5, a) > at(4, a) ? 'right' : 'left', confidence: scores[k], anchor: a,
      bbox: [f32(cxo - f32(bwo / 2)), f32(cyo - f32(bho / 2)), f32(cxo + f32(bwo / 2)), f32(cyo + f32(bho / 2))],
      keypoints: Array.from({ length: 21 }, (_, j) => [f32(f32(at(6 + 3 * j, a) * scale) - ox), f32(f32(at(7 + 3 * j, a) * scale) - oy)]),
      visibility: Array.from({ length: 21 }, (_, j) => at(8 + 3 * j, a)),
    };
  });
}

// Good/Bad's native acquisition: a square box `padding` times the detection's
// longer side, centred on it (hand-state-runtime native_crop_assay.square_crop).
export function squareCrop(bbox, padding) {
  const [x0, y0, x1, y1] = bbox.map(Number);
  if (![x0, y0, x1, y1].every(Number.isFinite) || x1 <= x0 || y1 <= y0) throw new RangeError('invalid detector box');
  if (!(padding >= 1)) throw new RangeError('invalid crop padding');
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, extent = Math.max(x1 - x0, y1 - y0) * padding;
  return [cx - extent / 2, cy - extent / 2, cx + extent / 2, cy + extent / 2];
}
