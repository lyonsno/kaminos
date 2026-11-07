// Measures fresh mesh deliveries. Rendering the same mesh again adds no FPS.
// A pending result lowers the displayed rate as its age grows, so a stall
// cannot leave the last fast number frozen on screen.
export function createHandFpsMeter() {
  let active = false, state = 'stopped', previous = null, interval = null;
  let previousFrame = null, frames = 0, timings = null;
  function reset(next) {
    state = next; previous = interval = previousFrame = null; frames = 0; timings = null;
  }
  return {
    start() { active = true; reset('waiting'); },
    stop() { active = false; reset('stopped'); },
    record({ now, frameId = null, hasHand, timings: sample = null }) {
      if (!active || !Number.isFinite(now)) return;
      timings = Object.fromEntries(['detectorMs', 'mobreconMs'].map(key =>
        [key, Number.isFinite(sample?.[key]) && sample[key] >= 0 ? sample[key] : null]));
      if (!hasHand) {
        state = 'no-hand'; previous = interval = previousFrame = null;
        return;
      }
      if (frameId !== null && frameId === previousFrame) return;
      if (previous !== null && now < previous) return;
      interval = previous !== null && now > previous ? now - previous : null;
      previous = now; previousFrame = frameId; frames++; state = 'tracking';
    },
    read(now) {
      const ageMs = previous === null ? null : Math.max(0, now - previous);
      const fps = !active || state === 'waiting' ? null : state === 'no-hand' ? 0 :
        interval > 0 && Number.isFinite(ageMs) ? 1000 / Math.max(interval, ageMs) : null;
      return { fps, state, frames, ageMs, intervalMs: interval, timings };
    },
  };
}
