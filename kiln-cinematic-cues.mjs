import {normalizeCueTune, blendCueTunes, tuneForCue} from './kiln-cue-tunes.mjs';
export const KILN_CUE_SCHEMA = 'kaminos.kiln-cues.v1';

function number(value, name, min, max = Infinity) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`Invalid kiln cue ${name}`);
  }
  return value;
}

export function normalizeKilnCues(recipe) {
  if (recipe == null) return null;
  if (recipe.schema !== KILN_CUE_SCHEMA) throw new Error('Unsupported kiln cue schema');
  const result = { ...recipe };
  for (const name of ['ignition', 'work']) {
    if (!Array.isArray(recipe[name]) || recipe[name].length < 2) throw new Error(`Invalid kiln cue ${name} keyframes`);
    let previous = -1;
    result[name] = recipe[name].map((key, index) => {
      const time = number(key.time, 'time', 0);
      if (time <= previous || (index === 0 && time !== 0)) throw new Error('Invalid kiln cue time order');
      previous = time;
      return { time, radius: number(key.radius, 'radius', 0.08, 0.7), flow: number(key.flow, 'flow', 0, 4),
        ...(key.tune ? {tune:normalizeCueTune(key.tune)} : {}) };
    });
  }
  for (const key of ['extinguishSeconds', 'revealSeconds', 'previewWorkSeconds']) result[key] = number(recipe[key], key, 0.001);
  result.workLight = number(recipe.workLight, 'workLight', 0);
  result.cameraPush = number(recipe.cameraPush, 'cameraPush', 0, 0.9);
  return structuredClone(result);
}

export function defaultKilnCues({ inputRadius = 0.52, flowRate = 2.5 } = {}) {
  return normalizeKilnCues({
    schema: KILN_CUE_SCHEMA,
    ignition: [{time: 0, radius: 0.1, flow: 0}, {time: 1.2, radius: 0.2, flow: flowRate * 0.3}, {time: 3, radius: inputRadius, flow: flowRate}],
    work: [{time: 0, radius: inputRadius, flow: flowRate}, {time: 2.5, radius: Math.max(0.08, inputRadius * 0.65), flow: flowRate * 0.55}, {time: 4, radius: inputRadius, flow: flowRate}],
    extinguishSeconds: 5, revealSeconds: 3, previewWorkSeconds: 9, workLight: 0.35, cameraPush: 0.12,
  });
}

export function sampleKilnKeys(keys, seconds) {
  if (seconds <= 0) return { ...keys[0] };
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i], a = keys[i - 1];
    if (seconds <= b.time) {
      const t = (seconds - a.time) / (b.time - a.time);
      return { time: seconds, radius: a.radius + (b.radius - a.radius) * t, flow: a.flow + (b.flow - a.flow) * t,
        ...(a.tune && b.tune ? {tune:blendCueTunes(tuneForCue(a,a.tune),tuneForCue(b,b.tune),t)} : {}) };
    }
  }
  return { ...keys.at(-1) };
}

export function createKilnPerformance(recipe, { now = () => performance.now() / 1000 } = {}) {
  const cues = normalizeKilnCues(recipe);
  if (!cues) throw new Error('Kiln cues required');
  let started = null, completed = null, result = null, failure = null, mode = null;
  return {
    start(kind) {
      if (!['preview', 'live'].includes(kind)) throw new Error('Invalid kiln performance mode');
      if (started !== null) throw new Error('Kiln performance already started');
      mode = kind; started = now();
    },
    complete(presentation) {
      if (started === null || completed !== null || failure) throw new Error('Kiln performance cannot complete');
      if (presentation?.status !== 'registered' || !presentation.objectId) throw new Error('Kiln reveal requires a registered output');
      result = structuredClone(presentation); completed = now();
    },
    fail(message) { failure = String(message); },
    sample() {
      const elapsed = started === null ? 0 : Math.max(0, now() - started);
      let phase = 'idle', key = cues.ignition[0], light = 1, push = 0;
      if (failure) phase = 'failed';
      else if (completed !== null) {
        const tail = Math.max(0, now() - completed);
        const reveal = Math.min(1, Math.max(0, (tail - cues.extinguishSeconds) / cues.revealSeconds));
        phase = tail < cues.extinguishSeconds ? 'extinguish' : reveal < 1 ? 'reveal' : 'complete';
        key = { ...cues.work.at(-1), flow: 0 };
        light = cues.workLight + (1 - cues.workLight) * reveal;
        push = cues.cameraPush;
      } else if (started !== null) {
        const ignition = cues.ignition.at(-1).time;
        phase = elapsed < ignition ? 'ignition' : 'work';
        key = phase === 'ignition' ? sampleKilnKeys(cues.ignition, elapsed)
          : sampleKilnKeys(cues.work, (elapsed - ignition) % cues.work.at(-1).time);
        const t = Math.min(1, elapsed / ignition);
        light = 1 + (cues.workLight - 1) * t;
        push = cues.cameraPush * t;
      }
      const sourceEnabled = ['ignition', 'work'].includes(phase) && key.flow > 0;
      return { mode, phase, elapsed, radius: key.radius, flow: sourceEnabled ? key.flow : 0,
        ...(key.tune ? {tune:tuneForCue({...key,flow:sourceEnabled?key.flow:0},key.tune)} : {}),
        sourceEnabled, light, push, outputVisible: !!result && ['reveal', 'complete'].includes(phase), result, failure };
    },
  };
}
