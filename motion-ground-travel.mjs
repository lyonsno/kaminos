// Kinematic rear-paw locomotion, not a physics or authored-contact solver.
// The supporting (lower) painted paw's backward stroke buys forward travel.
// Forward recovery is swing: it never pulls the creature backwards.
export function buildHindPawTravel(frames, forward) {
  if (!Array.isArray(frames) || frames.length < 2) throw new Error('Ground travel needs two paw frames');
  const norm = Math.hypot(forward[0], forward[2]);
  if (!(norm > 1e-8)) throw new Error('Ground travel needs a horizontal forward direction');
  const direction = [forward[0] / norm, 0, forward[2] / norm];
  let distance = 0;
  const offset = [0, 0, 0];
  return frames.map((frame, index) => {
    for (const side of ['left', 'right']) {
      if (!frame[side]?.center?.every(Number.isFinite) || frame[side].center.length !== 3 || !Number.isFinite(frame[side].soleY)) {
        throw new Error(`Ground travel has invalid ${side} paw at frame ${index}`);
      }
    }
    const support = frame.left.soleY <= frame.right.soleY ? 'left' : 'right';
    if (index) {
      const previous = frames[index - 1];
      const backwardStroke = direction.reduce((sum, axis, i) => sum + axis * (previous[support].center[i] - frame[support].center[i]), 0);
      distance += Math.max(0, backwardStroke);
      if (backwardStroke > 0) {
        for (const axis of [0, 2]) offset[axis] += previous[support].center[axis] - frame[support].center[axis];
      }
    }
    return { distance, support, offset: [...offset] };
  });
}

export function sampleHindPawSupportOffset(track, frame) {
  const position = Math.max(0, Math.min(track.length - 1, frame));
  const index = Math.floor(position), next = Math.min(index + 1, track.length - 1);
  return track[index].offset.map((value, axis) => value + (track[next].offset[axis] - value) * (position - index));
}

export function sampleHindPawTravel(track, frame) {
  const position = Math.max(0, Math.min(track.length - 1, frame));
  const index = Math.floor(position);
  const next = Math.min(index + 1, track.length - 1);
  return track[index].distance + (track[next].distance - track[index].distance) * (position - index);
}
