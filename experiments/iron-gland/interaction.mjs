const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const midpoint = (a, b) => a.map((v, i) => (v + b[i]) / 2);
const angleDelta = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

// FreiHAND order: wrist, thumb 1..4, index 5..8, middle 9..12,
// ring 13..16, little 17..20 (HandMesh utils/draw3d.py).
export function handObservation(result, { width, height, mirror = true } = {}) {
  if (![width, height].every(v => Number.isFinite(v) && v > 0)) throw Error('invalid image dimensions');
  if (!result?.hasHand || result.acquisition?.fallback) return null;
  const { cropUV: uv, cropBox: box } = result;
  if (uv?.length !== 42 || !uv.every(Number.isFinite) || box?.length !== 4 || !box.every(Number.isFinite)
      || box[2] <= box[0] || box[3] <= box[1]) return null;
  const pixels = Array.from({ length: 21 }, (_, i) => {
    const x = box[0] + uv[i * 2] * (box[2] - box[0]);
    return [mirror ? width - x : x, box[1] + uv[i * 2 + 1] * (box[3] - box[1])];
  });
  const span = distance(pixels[5], pixels[17]);
  const length = distance(pixels[0], pixels[9]);
  if (span < 1 || length < 1) return null;
  const axis = pixels[9].map((v, i) => (v - pixels[0][i]) / length);
  const palm = midpoint(pixels[0], pixels[9]);
  const normalize = p => [p[0] / width, p[1] / height];
  return {
    handedness: result.handedness,
    wrist: normalize(pixels[0]), pinch: normalize(midpoint(pixels[4], pixels[8])),
    anchor: normalize(palm),
    span: span / width, angle: Math.atan2(-axis[1], axis[0]),
    pinchRatio: distance(pixels[4], pixels[8]) / span,
  };
}

export function createHoverController({ closeRatio = .28, openRatio = .42 } = {}) {
  if (!(closeRatio > 0 && openRatio > closeRatio)) throw Error('invalid pinch hysteresis');
  let state = { visible: false, mode: 'absent', anchor: [.5, .5], span: .15, rotation: [.25, -.35, 0], openness: 0, pinchRatio: null };
  let armed = false, grab = null, side = null;
  const read = () => structuredClone(state);
  return {
    read,
    update(observation, deltaSeconds) {
      if (!(Number.isFinite(deltaSeconds) && deltaSeconds >= 0)) throw Error('invalid frame interval');
      if (!observation) {
        state = { ...state, visible: false, mode: 'absent', pinchRatio: null, openness: 0 };
        armed = false; grab = null; side = null;
        return read();
      }
      const fresh = !state.visible || side !== observation.handedness;
      if (fresh) { armed = false; grab = null; }
      side = observation.handedness;
      if (observation.pinchRatio >= openRatio) { armed = true; grab = null; }
      if (armed && !grab && observation.pinchRatio < closeRatio) {
        grab = { pinch: [...observation.pinch], angle: observation.angle, span: observation.span, rotation: [...state.rotation] };
      }
      const blend = fresh ? 1 : 1 - Math.exp(-deltaSeconds / .06);
      const rotation = grab ? [
        grab.rotation[0] + (observation.pinch[1] - grab.pinch[1]) / grab.span * 1.5,
        grab.rotation[1] + (observation.pinch[0] - grab.pinch[0]) / grab.span * 1.5,
        grab.rotation[2] + angleDelta(observation.angle, grab.angle),
      ] : state.rotation;
      state = { visible: true, mode: grab ? 'grab' : 'hover',
        anchor: state.anchor.map((v, i) => v + (observation.anchor[i] - v) * blend),
        span: state.span + (observation.span - state.span) * blend, rotation,
        openness: state.openness + ((grab ? 1 : 0) - state.openness) * (1 - Math.exp(-deltaSeconds / .12)),
        pinchRatio: observation.pinchRatio };
      return read();
    },
  };
}
