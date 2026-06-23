export const MOTION_CLIP_SCHEMA = 'kaminos.motion-clip.v0';
export const MOTION_ACTOR_SCHEMA = 'kaminos.motion-actors.v0';
export const MOTION_SIMULATION_SCHEMA = 'kaminos.motion-simulation.v0';
export const MOTION_WITNESS_SCHEMA = 'kaminos.motion-witness.v0';
export const MOTION_ROUTE_IDENTITY = 'procedural-orb-motion-grammar-v0';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function vec3(value, fallback = [0, 0, 0]) {
  const source = Array.isArray(value) ? value : fallback;
  return [0, 1, 2].map(index => Number.isFinite(Number(source[index])) ? Number(source[index]) : Number(fallback[index] || 0));
}

function addVec3(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function subVec3(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scaleVec3(a, scale) {
  return [a[0] * scale, a[1] * scale, a[2] * scale];
}

function lengthVec3(a) {
  return Math.hypot(a[0], a[1], a[2]);
}

function normalizeVec3(a, fallback = [0, 0, 1]) {
  const len = lengthVec3(a);
  if (len <= 1e-8) return [...fallback];
  return [a[0] / len, a[1] / len, a[2] / len];
}

function mixVec3(a, b, t) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

function smooth01(t) {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

function normalizeSample(sample, fallbackTime = 0) {
  return {
    t: Number.isFinite(Number(sample?.t)) ? Number(sample.t) : fallbackTime,
    root: vec3(sample?.root),
    facing: normalizeVec3(vec3(sample?.facing, [0, 0, 1])),
    attention: vec3(sample?.attention, [0, 0, 0]),
    scale: Number.isFinite(Number(sample?.scale)) ? Number(sample.scale) : 1,
    effort: Number.isFinite(Number(sample?.effort)) ? Number(sample.effort) : 0,
  };
}

export const DEFAULT_MOTION_CLIPS = [
  {
    schema: MOTION_CLIP_SCHEMA,
    id: 'idle_breathe_watch',
    label: 'Idle Breathe Watch',
    duration: 3.6,
    loop: true,
    intent: 'watch-hold-presence',
    source: 'procedural-authored-v0',
    samples: [
      { t: 0.0, root: [0.00, 0.00, 0.00], facing: [0.10, 0, 1], attention: [0, 0.2, 1.4], scale: 1.00, effort: 0.16 },
      { t: 0.9, root: [0.03, 0.04, 0.02], facing: [0.18, 0, 1], attention: [0, 0.2, 1.4], scale: 1.04, effort: 0.22 },
      { t: 1.8, root: [-0.02, 0.00, 0.05], facing: [-0.08, 0, 1], attention: [0, 0.2, 1.4], scale: 0.98, effort: 0.12 },
      { t: 2.7, root: [0.02, -0.02, 0.01], facing: [0.05, 0, 1], attention: [0, 0.2, 1.4], scale: 1.02, effort: 0.18 },
      { t: 3.6, root: [0.00, 0.00, 0.00], facing: [0.10, 0, 1], attention: [0, 0.2, 1.4], scale: 1.00, effort: 0.16 },
    ],
  },
  {
    schema: MOTION_CLIP_SCHEMA,
    id: 'approach_curious',
    label: 'Approach Curious',
    duration: 4.4,
    loop: true,
    intent: 'approach-hesitate-inspect',
    source: 'procedural-authored-v0',
    samples: [
      { t: 0.0, root: [-0.35, 0.00, -0.75], facing: [0.25, 0, 1], attention: [0.35, 0.1, 1.6], scale: 0.96, effort: 0.20 },
      { t: 0.9, root: [-0.10, 0.03, -0.25], facing: [0.42, 0, 1], attention: [0.35, 0.1, 1.6], scale: 1.03, effort: 0.42 },
      { t: 1.6, root: [-0.18, 0.00, -0.18], facing: [-0.15, 0, 1], attention: [0.35, 0.1, 1.6], scale: 0.98, effort: 0.24 },
      { t: 2.7, root: [0.28, 0.05, 0.55], facing: [0.38, 0, 1], attention: [0.35, 0.1, 1.6], scale: 1.06, effort: 0.56 },
      { t: 3.5, root: [0.20, 0.01, 0.70], facing: [-0.35, 0, 1], attention: [0.35, 0.1, 1.6], scale: 1.00, effort: 0.30 },
      { t: 4.4, root: [-0.35, 0.00, -0.75], facing: [0.25, 0, 1], attention: [0.35, 0.1, 1.6], scale: 0.96, effort: 0.20 },
    ],
  },
  {
    schema: MOTION_CLIP_SCHEMA,
    id: 'stalk_bad_intent',
    label: 'Stalk Bad Intent',
    duration: 4.6,
    loop: true,
    intent: 'approach-threaten-commit',
    source: 'procedural-authored-v0',
    samples: [
      { t: 0.0, root: [0.00, 0.00, -1.50], facing: [0, 0, 1], attention: [0, 0.15, 1.2], scale: 0.95, effort: 0.18 },
      { t: 1.1, root: [0.04, 0.01, -1.20], facing: [0, 0, 1], attention: [0, 0.15, 1.2], scale: 0.98, effort: 0.24 },
      { t: 2.2, root: [-0.03, 0.00, -0.82], facing: [0, 0, 1], attention: [0, 0.15, 1.2], scale: 0.96, effort: 0.20 },
      { t: 3.4, root: [0.02, 0.03, 0.08], facing: [0, 0, 1], attention: [0, 0.15, 1.2], scale: 1.08, effort: 0.68 },
      { t: 4.1, root: [0.00, 0.00, 0.54], facing: [0, 0, 1], attention: [0, 0.15, 1.2], scale: 1.14, effort: 0.94 },
      { t: 4.6, root: [0.00, 0.00, -1.50], facing: [0, 0, 1], attention: [0, 0.15, 1.2], scale: 0.95, effort: 0.18 },
    ],
  },
  {
    schema: MOTION_CLIP_SCHEMA,
    id: 'flinch_retreat',
    label: 'Flinch Retreat',
    duration: 2.8,
    loop: true,
    intent: 'recoil-recover-watch',
    source: 'procedural-authored-v0',
    samples: [
      { t: 0.0, root: [0.00, 0.00, 0.00], facing: [0, 0, 1], attention: [0, 0.2, 1.1], scale: 1.00, effort: 0.18 },
      { t: 0.25, root: [-0.08, 0.10, -0.36], facing: [0, 0, 1], attention: [0, 0.2, 1.1], scale: 0.84, effort: 1.00 },
      { t: 0.62, root: [-0.18, 0.04, -0.70], facing: [0.12, 0, 1], attention: [0, 0.2, 1.1], scale: 0.92, effort: 0.78 },
      { t: 1.35, root: [-0.10, 0.02, -0.40], facing: [-0.08, 0, 1], attention: [0, 0.2, 1.1], scale: 1.08, effort: 0.36 },
      { t: 2.2, root: [-0.02, 0.00, -0.12], facing: [0, 0, 1], attention: [0, 0.2, 1.1], scale: 1.02, effort: 0.20 },
      { t: 2.8, root: [0.00, 0.00, 0.00], facing: [0, 0, 1], attention: [0, 0.2, 1.1], scale: 1.00, effort: 0.18 },
    ],
  },
  {
    schema: MOTION_CLIP_SCHEMA,
    id: 'orbit_inspect',
    label: 'Orbit Inspect',
    duration: 5.2,
    loop: true,
    intent: 'circle-lock-attention',
    source: 'procedural-authored-v0',
    samples: [
      { t: 0.0, root: [1.05, 0.00, 0.00], facing: [-1, 0, 0], attention: [0, 0.1, 0], scale: 1.00, effort: 0.36 },
      { t: 1.3, root: [0.00, 0.04, 1.05], facing: [0, 0, -1], attention: [0, 0.1, 0], scale: 1.05, effort: 0.48 },
      { t: 2.6, root: [-1.05, 0.00, 0.00], facing: [1, 0, 0], attention: [0, 0.1, 0], scale: 1.00, effort: 0.36 },
      { t: 3.9, root: [0.00, -0.03, -1.05], facing: [0, 0, 1], attention: [0, 0.1, 0], scale: 0.97, effort: 0.42 },
      { t: 5.2, root: [1.05, 0.00, 0.00], facing: [-1, 0, 0], attention: [0, 0.1, 0], scale: 1.00, effort: 0.36 },
    ],
  },
];

export const DEFAULT_MOTION_ACTORS = [
  { id: 'orb-idle-watch', label: 'Idle Watch', clipId: 'idle_breathe_watch', origin: [-2.0, 0.0, -0.35], color: '#8fb6ff', status: 'watching' },
  { id: 'orb-curious-approach', label: 'Curious Approach', clipId: 'approach_curious', origin: [-0.95, 0.0, -0.75], color: '#9fe6bd', status: 'approaching' },
  { id: 'orb-bad-intent', label: 'Bad Intent', clipId: 'stalk_bad_intent', origin: [0.2, 0.0, -0.65], color: '#ff7a66', status: 'committing' },
  { id: 'orb-flinch-retreat', label: 'Flinch Retreat', clipId: 'flinch_retreat', origin: [1.2, 0.0, 0.38], color: '#ffd166', status: 'recovering' },
  { id: 'orb-orbit-inspect', label: 'Orbit Inspect', clipId: 'orbit_inspect', origin: [2.1, 0.0, -0.1], color: '#caa8ff', status: 'inspecting' },
];

export function normalizeMotionClip(clip) {
  if (!clip || typeof clip !== 'object') throw new Error('Motion clip must be an object');
  const duration = Number(clip.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error(`Motion clip ${clip.id || '(unknown)'} must have positive duration`);
  const id = String(clip.id || '').trim();
  if (!id) throw new Error('Motion clip id is required');
  const samples = (Array.isArray(clip.samples) ? clip.samples : [])
    .map((sample, index) => normalizeSample(sample, index === 0 ? 0 : duration))
    .sort((a, b) => a.t - b.t)
    .map(sample => ({ ...sample, t: clamp(sample.t, 0, duration) }));
  if (samples.length < 2) throw new Error(`Motion clip ${id} needs at least two samples`);
  samples[0] = { ...samples[0], t: 0 };
  samples[samples.length - 1] = { ...samples[samples.length - 1], t: duration };
  for (let i = 1; i < samples.length; i++) {
    if (samples[i].t < samples[i - 1].t) throw new Error(`Motion clip ${id} samples must be ordered`);
  }
  return {
    schema: clip.schema || MOTION_CLIP_SCHEMA,
    id,
    label: clip.label || id,
    duration,
    loop: clip.loop !== false,
    intent: clip.intent || 'unspecified',
    source: clip.source || 'unknown',
    samples,
  };
}

export function motionClipById(id, clips = DEFAULT_MOTION_CLIPS) {
  const normalized = clips.map(normalizeMotionClip);
  const clip = normalized.find(candidate => candidate.id === id);
  if (!clip) throw new Error(`Unknown motion clip id: ${id}`);
  return clip;
}

function localClipTime(clip, t) {
  const time = Number(t);
  if (!Number.isFinite(time)) return 0;
  if (clip.loop) return ((time % clip.duration) + clip.duration) % clip.duration;
  return clamp(time, 0, clip.duration);
}

export function sampleMotionClip(clipInput, t) {
  const clip = normalizeMotionClip(clipInput);
  const time = localClipTime(clip, t);
  let before = clip.samples[0];
  let after = clip.samples.at(-1);
  for (let i = 0; i < clip.samples.length - 1; i++) {
    const a = clip.samples[i];
    const b = clip.samples[i + 1];
    if (time >= a.t && time <= b.t) {
      before = a;
      after = b;
      break;
    }
  }
  const span = Math.max(1e-6, after.t - before.t);
  const u = smooth01((time - before.t) / span);
  return {
    t: time,
    root: mixVec3(before.root, after.root, u),
    facing: normalizeVec3(mixVec3(before.facing, after.facing, u)),
    attention: mixVec3(before.attention, after.attention, u),
    scale: lerp(before.scale, after.scale, u),
    effort: lerp(before.effort, after.effort, u),
  };
}

function normalizeActor(actor, index = 0) {
  return {
    id: String(actor?.id || `motion-actor-${index}`),
    label: String(actor?.label || actor?.id || `Motion Actor ${index + 1}`),
    clipId: String(actor?.clipId || actor?.requestedClipId || 'idle_breathe_watch'),
    origin: vec3(actor?.origin),
    color: actor?.color || '#d8c38e',
    status: actor?.status || null,
  };
}

export function resolveMotionActorClips(actors = DEFAULT_MOTION_ACTORS, clips = DEFAULT_MOTION_CLIPS) {
  const normalizedClips = clips.map(normalizeMotionClip);
  const clipMap = new Map(normalizedClips.map(clip => [clip.id, clip]));
  const fallbackClip = clipMap.get('idle_breathe_watch') || normalizedClips[0];
  const effectiveActors = actors.map((actor, index) => {
    const normalized = normalizeActor(actor, index);
    const requested = normalized.clipId;
    const clip = clipMap.get(requested) || fallbackClip;
    const fallbackUsed = clip.id !== requested;
    return {
      ...normalized,
      requestedClipId: requested,
      effectiveClipId: clip.id,
      effectiveClipIntent: clip.intent,
      fallbackUsed,
      fallbackReason: fallbackUsed ? 'unknown-clip-id' : null,
    };
  });
  return {
    schema: 'kaminos.motion-route-resolution.v0',
    route: MOTION_ROUTE_IDENTITY,
    clipSource: 'default-procedural-clip-pack',
    requestedClipIds: effectiveActors.map(actor => actor.requestedClipId),
    effectiveClipIds: effectiveActors.map(actor => actor.effectiveClipId),
    fallbackCount: effectiveActors.filter(actor => actor.fallbackUsed).length,
    effectiveActors,
  };
}

export function buildMotionActorFixture({ actors = DEFAULT_MOTION_ACTORS, clips = DEFAULT_MOTION_CLIPS } = {}) {
  const resolution = resolveMotionActorClips(actors, clips);
  return {
    schema: MOTION_ACTOR_SCHEMA,
    route: MOTION_ROUTE_IDENTITY,
    fixtureSource: 'default-procedural-orb-agency-fixture-v0',
    clips: clips.map(normalizeMotionClip).map(clip => ({
      id: clip.id,
      label: clip.label,
      duration: clip.duration,
      loop: clip.loop,
      intent: clip.intent,
      source: clip.source,
    })),
    actors: resolution.effectiveActors,
    routeResolution: resolution,
  };
}

function sampleActor(actor, clip, t, dt = 1 / 30) {
  const sample = sampleMotionClip(clip, t);
  const next = sampleMotionClip(clip, t + dt);
  const velocity = scaleVec3(subVec3(next.root, sample.root), 1 / Math.max(dt, 1e-6));
  const worldRoot = addVec3(actor.origin, sample.root);
  const worldAttention = addVec3(actor.origin, sample.attention);
  return {
    id: actor.id,
    label: actor.label,
    requestedClipId: actor.requestedClipId,
    effectiveClipId: actor.effectiveClipId,
    fallbackUsed: actor.fallbackUsed,
    fallbackReason: actor.fallbackReason,
    intent: actor.effectiveClipIntent,
    status: actor.status,
    color: actor.color,
    root: worldRoot,
    localRoot: sample.root,
    facing: sample.facing,
    attention: worldAttention,
    scale: Number(sample.scale.toFixed(5)),
    effort: Number(sample.effort.toFixed(5)),
    speed: Number(lengthVec3(velocity).toFixed(5)),
  };
}

export function simulateMotionActors({
  duration = 5,
  fps = 12,
  actors = DEFAULT_MOTION_ACTORS,
  clips = DEFAULT_MOTION_CLIPS,
} = {}) {
  const simDuration = Math.max(0.1, Number(duration) || 5);
  const simFps = Math.max(1, Math.round(Number(fps) || 12));
  const normalizedClips = clips.map(normalizeMotionClip);
  const clipMap = new Map(normalizedClips.map(clip => [clip.id, clip]));
  const resolution = resolveMotionActorClips(actors, normalizedClips);
  const frameCount = Math.floor(simDuration * simFps) + 1;
  const frames = [];
  let maxEffort = 0;
  let speedSum = 0;
  let speedCount = 0;
  for (let index = 0; index < frameCount; index++) {
    const t = index / simFps;
    const frameActors = resolution.effectiveActors.map(actor => {
      const clip = clipMap.get(actor.effectiveClipId);
      const state = sampleActor(actor, clip, t, 1 / simFps);
      maxEffort = Math.max(maxEffort, state.effort);
      speedSum += state.speed;
      speedCount++;
      return state;
    });
    frames.push({ frameIndex: index, t: Number(t.toFixed(5)), actors: frameActors });
  }
  return {
    schema: MOTION_SIMULATION_SCHEMA,
    route: MOTION_ROUTE_IDENTITY,
    duration: simDuration,
    fps: simFps,
    clipSource: 'default-procedural-clip-pack',
    routeResolution: resolution,
    frames,
    metrics: {
      actorCount: resolution.effectiveActors.length,
      frameCount: frames.length,
      fallbackCount: resolution.fallbackCount,
      maxEffort: Number(maxEffort.toFixed(5)),
      meanSpeed: Number((speedSum / Math.max(1, speedCount)).toFixed(5)),
    },
  };
}

export function buildMotionWitnessTimeline({
  duration = 5,
  fps = 12,
  filmstripFrames = 6,
  actors = DEFAULT_MOTION_ACTORS,
  clips = DEFAULT_MOTION_CLIPS,
} = {}) {
  const simulation = simulateMotionActors({ duration, fps, actors, clips });
  const count = Math.max(1, Math.min(Math.round(Number(filmstripFrames) || 6), simulation.frames.length));
  const frameIndexes = Array.from({ length: count }, (_, i) => (
    count === 1 ? 0 : Math.round(i * (simulation.frames.length - 1) / (count - 1))
  ));
  const filmstrip = frameIndexes.map(index => simulation.frames[index]);
  return {
    schema: MOTION_WITNESS_SCHEMA,
    route: MOTION_ROUTE_IDENTITY,
    clipSource: simulation.clipSource,
    duration: simulation.duration,
    fps: simulation.fps,
    requestedClipIds: simulation.routeResolution.requestedClipIds,
    effectiveClipIds: simulation.routeResolution.effectiveClipIds,
    fallbackCount: simulation.routeResolution.fallbackCount,
    metrics: simulation.metrics,
    filmstrip,
    simulation,
  };
}
