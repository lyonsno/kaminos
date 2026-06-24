export const MOTION_CLIP_SCHEMA = 'kaminos.motion-clip.v0';
export const MOTION_ACTOR_SCHEMA = 'kaminos.motion-actors.v0';
export const MOTION_SIMULATION_SCHEMA = 'kaminos.motion-simulation.v0';
export const MOTION_WITNESS_SCHEMA = 'kaminos.motion-witness.v0';
export const MOTION_PLAN_SCHEMA = 'kaminos.motion-plan.v0';
export const MOTION_PHRASE_CONTROL_SCHEMA = 'kaminos.motion-phrase-controls.v0';
export const MOTION_TRACK_SCHEMA = 'kaminos.motion-track.v0';
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

function pulse01(t) {
  const x = smooth01(t);
  return clamp(4 * x * (1 - x), 0, 1);
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

export const DEFAULT_DECISION_MOTION_PLAN = {
  schema: MOTION_PLAN_SCHEMA,
  id: 'orb_decision_bad_intent_v1',
  label: 'Orb Decision Bad Intent V1',
  intent: 'notice-prepare-commit-recover',
  duration: 7.2,
  source: 'procedural-authored-phrase-grammar-v0',
  weight: {
    mass: 1.45,
    anticipation: 0.28,
    settle: 0.24,
    effortScale: 1.18,
  },
  phrases: [
    {
      phase: 'idle',
      duration: 1.0,
      from: { root: [0.00, 0.00, -0.82], facing: [0.08, 0, 1], attention: [0, 0.18, 1.1], scale: 0.98, effort: 0.14 },
      to: { root: [0.02, 0.02, -0.78], facing: [0.06, 0, 1], attention: [0, 0.18, 1.1], scale: 1.01, effort: 0.18 },
    },
    {
      phase: 'notice',
      duration: 0.7,
      from: { root: [0.02, 0.02, -0.78], facing: [0.06, 0, 1], attention: [0, 0.18, 1.1], scale: 1.01, effort: 0.18 },
      to: { root: [0.10, 0.06, -0.40], facing: [0, 0, 1], attention: [0.08, 0.24, 1.25], scale: 1.08, effort: 0.42 },
    },
    {
      phase: 'anticipate',
      duration: 0.65,
      from: { root: [0.10, 0.06, -0.40], facing: [0, 0, 1], attention: [0.08, 0.24, 1.25], scale: 1.08, effort: 0.42 },
      to: { root: [-0.08, -0.05, -1.02], facing: [0, 0, 1], attention: [0.00, 0.18, 1.25], scale: 0.86, effort: 0.66 },
    },
    {
      phase: 'commit',
      duration: 1.3,
      from: { root: [-0.08, -0.05, -1.02], facing: [0, 0, 1], attention: [0.00, 0.18, 1.25], scale: 0.86, effort: 0.66 },
      to: { root: [0.03, 0.04, 0.94], facing: [0, 0, 1], attention: [0.00, 0.18, 1.45], scale: 1.22, effort: 1.12 },
    },
    {
      phase: 'overshoot',
      duration: 0.9,
      from: { root: [0.03, 0.04, 0.94], facing: [0, 0, 1], attention: [0.00, 0.18, 1.45], scale: 1.22, effort: 1.12 },
      to: { root: [0.00, -0.02, 1.28], facing: [0, 0, 1], attention: [0.00, 0.14, 1.55], scale: 1.12, effort: 0.74 },
    },
    {
      phase: 'recover',
      duration: 2.65,
      from: { root: [0.00, -0.02, 1.28], facing: [0, 0, 1], attention: [0.00, 0.14, 1.55], scale: 1.12, effort: 0.74 },
      to: { root: [0.02, 0.00, 0.58], facing: [0.04, 0, 1], attention: [0.00, 0.16, 1.25], scale: 1.00, effort: 0.20 },
    },
  ],
};

export const DEFAULT_MOTION_PHRASE_CONTROLS = {
  schema: MOTION_PHRASE_CONTROL_SCHEMA,
  source: 'default',
  mass: 1.45,
  commitment: 1,
  anticipation: 1,
  hold: 1,
  effort: 1,
  overshoot: 1,
  recovery: 1,
  tempo: 1,
};

export const DEFAULT_MOTION_PHRASE_CONTROL_PRESETS = [
  {
    id: 'hesitant_curious',
    label: 'Hesitant Curious',
    color: '#9fe6bd',
    controls: {
      source: 'preset:hesitant_curious',
      mass: 0.85,
      commitment: 0.62,
      anticipation: 1.65,
      hold: 1.42,
      effort: 0.74,
      overshoot: 0.5,
      recovery: 1.28,
      tempo: 0.76,
    },
  },
  {
    id: 'heavy_deliberate',
    label: 'Heavy Deliberate',
    color: '#ffd166',
    controls: {
      source: 'preset:heavy_deliberate',
      mass: 2.6,
      commitment: 0.98,
      anticipation: 1.08,
      hold: 1.08,
      effort: 1.42,
      overshoot: 0.72,
      recovery: 1.7,
      tempo: 0.72,
    },
  },
  {
    id: 'sharp_aggressive',
    label: 'Sharp Aggressive',
    color: '#ff7a66',
    controls: {
      source: 'preset:sharp_aggressive',
      mass: 0.72,
      commitment: 1.68,
      anticipation: 0.82,
      hold: 0.68,
      effort: 1.58,
      overshoot: 1.6,
      recovery: 0.64,
      tempo: 1.45,
    },
  },
];

export const DEFAULT_MOTION_TRACK_FIXTURE = {
  schema: MOTION_TRACK_SCHEMA,
  id: 'fixture_cog_head_decision_v0',
  label: 'Fixture CoG + Head Decision V0',
  intent: 'mass-commits-after-attention-leads',
  sourceKind: 'fixture',
  sourceRoute: 'synthetic-cog-head-fixture-v0',
  fps: 30,
  duration: 5.4,
  units: 'meters',
  upAxis: [0, 1, 0],
  forwardAxis: [0, 0, 1],
  tracks: {
    root: [
      { t: 0.0, value: [0.00, 0.00, -0.74] },
      { t: 0.8, value: [0.02, 0.01, -0.70] },
      { t: 1.45, value: [0.04, 0.03, -0.62] },
      { t: 2.2, value: [-0.12, -0.04, -1.02] },
      { t: 3.1, value: [0.02, 0.05, 0.46] },
      { t: 4.0, value: [0.10, 0.02, 0.92] },
      { t: 5.4, value: [0.00, 0.00, -0.74] },
    ],
    head: [
      { t: 0.0, value: [0.05, 0.40, -0.14] },
      { t: 0.8, value: [0.10, 0.43, 0.18] },
      { t: 1.45, value: [0.28, 0.52, 0.76] },
      { t: 2.2, value: [0.06, 0.38, 0.26] },
      { t: 3.1, value: [0.10, 0.48, 1.22] },
      { t: 4.0, value: [-0.14, 0.43, 1.36] },
      { t: 5.4, value: [0.05, 0.40, -0.14] },
    ],
    effort: [
      { t: 0.0, value: 0.18 },
      { t: 0.8, value: 0.28 },
      { t: 1.45, value: 0.42 },
      { t: 2.2, value: 0.72 },
      { t: 3.1, value: 1.08 },
      { t: 4.0, value: 0.58 },
      { t: 5.4, value: 0.18 },
    ],
    phase: [
      { t: 0.0, value: 'idle' },
      { t: 0.8, value: 'notice' },
      { t: 1.45, value: 'orient' },
      { t: 2.2, value: 'anticipate' },
      { t: 3.1, value: 'commit' },
      { t: 4.0, value: 'recover' },
      { t: 5.4, value: 'idle' },
    ],
  },
};

export const DEFAULT_DIP_WAVE_GENERATED_MOTION_FIXTURE = {
  schema: 'kaminos.generated-joint-motion-fixture.v0',
  id: 'dip_wave_generated_fixture_v0',
  label: 'DiP Wave Generated Fixture V0',
  intent: 'reporting-greeting-enter-wave',
  sourceKind: 'generated-fixture',
  sourceStatus: 'fixture',
  sourceModel: 'DiP',
  sourceRoute: '/Users/noahlyons/dev/motion-diffusion-model/save/DiP_no-target_10steps_context20_predict40/samples_DiP_no-target_10steps_context20_predict40_000600343_seed10_A_person_walks_forward_and_waves_their_hand/results.npy',
  previewRoute: '/Users/noahlyons/dev/motion-diffusion-model/save/DiP_no-target_10steps_context20_predict40/samples_DiP_no-target_10steps_context20_predict40_000600343_seed10_A_person_walks_forward_and_waves_their_hand/samples_00_to_00.mp4',
  prompt: 'A person walks forward and waves their hand.',
  modelRun: {
    dataset: 'humanml',
    seed: 10,
    checkpointStep: 600343,
    sampler: 'DiP_no-target_10steps_context20_predict40',
  },
  fps: 20,
  rawFrameCount: 120,
  jointMapping: {
    root: 0,
    head: 15,
    leftWrist: 20,
    rightWrist: 21,
  },
  extractionAssumptions: [
    'input is generated HumanML/T2M absolute xyz joints shaped joints x xyz x frames',
    'pelvis joint 0 drives root/CoG',
    'head joint 15 drives attention/head',
    'wrist height delta drives wave-effort envelope',
    'phase labels are heuristic and must not claim source-authored semantics',
  ],
  samples: [
    { frame: 0, root: [0.0, 0.95273, 0.0], head: [0.01894, 1.51656, 0.10357], leftWrist: [0.3702, 1.20727, -0.51516], rightWrist: [-0.25789, 1.64283, 0.49596] },
    { frame: 15, root: [-0.60097, 0.93297, 0.41602], head: [-0.6355, 1.53403, 0.50111], leftWrist: [-0.59204, 1.2814, 0.86871], rightWrist: [-0.92538, 1.07961, 0.65751] },
    { frame: 30, root: [-0.60896, 0.93226, 1.05676], head: [-0.60233, 1.53231, 1.14267], leftWrist: [-0.29286, 0.8427, 0.95207], rightWrist: [-0.90081, 0.8558, 0.95677] },
    { frame: 45, root: [-0.59379, 0.93849, 1.73516], head: [-0.62331, 1.54672, 1.78872], leftWrist: [-0.44775, 1.46683, 1.86717], rightWrist: [-0.86584, 0.85536, 1.91721] },
    { frame: 60, root: [-0.45876, 0.91683, 2.45032], head: [-0.50194, 1.5252, 2.50708], leftWrist: [-0.36521, 1.46847, 2.61479], rightWrist: [-0.71617, 0.80492, 2.38342] },
    { frame: 75, root: [-0.41255, 0.93229, 3.1646], head: [-0.42303, 1.5409, 3.19574], leftWrist: [-0.23869, 1.48398, 3.28555], rightWrist: [-0.67507, 0.88593, 3.36423] },
    { frame: 90, root: [-0.35414, 0.9347, 3.86775], head: [-0.41215, 1.53874, 3.92472], leftWrist: [-0.28127, 1.44039, 3.99351], rightWrist: [-0.60071, 0.80135, 3.97426] },
    { frame: 105, root: [-0.2057, 0.93799, 4.53534], head: [-0.21165, 1.54286, 4.58301], leftWrist: [-0.0852, 1.43452, 4.75072], rightWrist: [-0.45245, 0.84739, 4.6188] },
    { frame: 119, root: [-0.20796, 0.94681, 5.03718], head: [-0.2488, 1.55966, 5.0987], leftWrist: [0.02935, 0.87729, 4.98949], rightWrist: [-0.45374, 0.82118, 5.11583] },
  ],
};

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

function controlNumber(controls, key, fallback, min, max) {
  const value = Number(controls?.[key]);
  return Number(clamp(Number.isFinite(value) ? value : fallback, min, max).toFixed(5));
}

export function normalizeMotionPhraseControls(controls = DEFAULT_MOTION_PHRASE_CONTROLS) {
  return {
    schema: controls.schema || MOTION_PHRASE_CONTROL_SCHEMA,
    source: controls.source || 'custom',
    mass: controlNumber(controls, 'mass', DEFAULT_MOTION_PHRASE_CONTROLS.mass, 0.2, 4),
    commitment: controlNumber(controls, 'commitment', DEFAULT_MOTION_PHRASE_CONTROLS.commitment, 0, 2.5),
    anticipation: controlNumber(controls, 'anticipation', DEFAULT_MOTION_PHRASE_CONTROLS.anticipation, 0, 2.5),
    hold: controlNumber(controls, 'hold', DEFAULT_MOTION_PHRASE_CONTROLS.hold, 0.2, 2.5),
    effort: controlNumber(controls, 'effort', DEFAULT_MOTION_PHRASE_CONTROLS.effort, 0, 2.5),
    overshoot: controlNumber(controls, 'overshoot', DEFAULT_MOTION_PHRASE_CONTROLS.overshoot, 0, 2.5),
    recovery: controlNumber(controls, 'recovery', DEFAULT_MOTION_PHRASE_CONTROLS.recovery, 0.2, 2.5),
    tempo: controlNumber(controls, 'tempo', DEFAULT_MOTION_PHRASE_CONTROLS.tempo, 0.25, 3),
  };
}

function poseToPlain(pose) {
  return {
    root: [...pose.root],
    facing: [...pose.facing],
    attention: [...pose.attention],
    scale: pose.scale,
    effort: pose.effort,
  };
}

function scalePhraseDuration(phrase, controls) {
  let phaseScale = 1;
  if (phrase.phase === 'notice') phaseScale *= controls.hold;
  if (phrase.phase === 'anticipate') phaseScale *= controls.hold * (0.85 + controls.anticipation * 0.12);
  if (phrase.phase === 'commit') phaseScale *= clamp(1.18 - controls.commitment * 0.22, 0.68, 1.25);
  if (phrase.phase === 'overshoot') phaseScale *= clamp(0.9 + controls.overshoot * 0.12, 0.78, 1.25);
  if (phrase.phase === 'recover') phaseScale *= controls.recovery;
  return Math.max(0.08, phrase.duration * phaseScale / controls.tempo);
}

function returnPhraseDuration(basePlan, controls) {
  const recover = basePlan.phrases.find(phrase => phrase.phase === 'recover');
  const recoverDuration = recover?.duration || 1;
  return Math.max(0.28, recoverDuration * clamp(0.42 + controls.recovery * 0.18 + controls.hold * 0.08, 0.35, 1.05) / controls.tempo);
}

function controlledPhrasePose(phrase, endpoint, controls) {
  const pose = poseToPlain(endpoint);
  const commitmentScale = 0.78 + controls.commitment * 0.34;
  if (phrase.phase === 'anticipate' && endpoint === phrase.to) {
    const reference = -0.4;
    const depth = Math.max(0, reference - pose.root[2]);
    pose.root[2] = reference - depth * controls.anticipation;
    pose.root[1] *= 0.85 + controls.anticipation * 0.08;
    pose.scale = Math.max(0.72, pose.scale - controls.anticipation * 0.035);
    pose.effort *= 0.75 + controls.anticipation * 0.22;
  }
  if (phrase.phase === 'commit') {
    if (endpoint === phrase.to) pose.root[2] *= commitmentScale;
    pose.effort *= controls.effort * (0.82 + controls.commitment * 0.22);
    pose.scale *= 0.95 + controls.effort * 0.07;
  }
  if (phrase.phase === 'overshoot') {
    const commitTarget = 0.94 * commitmentScale;
    if (endpoint === phrase.from) pose.root[2] = commitTarget;
    if (endpoint === phrase.to) pose.root[2] = commitTarget + (1.28 - 0.94) * controls.overshoot;
    pose.effort *= controls.effort * (0.78 + controls.overshoot * 0.14);
  }
  if (phrase.phase === 'recover') {
    const commitTarget = 0.94 * commitmentScale;
    if (endpoint === phrase.from) pose.root[2] = commitTarget + (1.28 - 0.94) * controls.overshoot;
    if (endpoint === phrase.to) pose.root[2] = 0.58 + (controls.recovery - 1) * 0.08;
    pose.effort *= controls.effort * (0.8 + controls.recovery * 0.08);
  }
  if (phrase.phase === 'notice') {
    pose.effort *= 0.85 + controls.hold * 0.08;
  }
  return {
    root: pose.root.map(value => Number(value.toFixed(5))),
    facing: pose.facing.map(value => Number(value.toFixed(5))),
    attention: pose.attention.map(value => Number(value.toFixed(5))),
    scale: Number(pose.scale.toFixed(5)),
    effort: Number(pose.effort.toFixed(5)),
  };
}

function phaseTimesFromPlan(plan) {
  return Object.fromEntries(plan.phrases.map(phrase => [
    phrase.phase,
    {
      start: Number(phrase.start.toFixed(5)),
      end: Number(phrase.end.toFixed(5)),
      mid: Number(((phrase.start + phrase.end) * 0.5).toFixed(5)),
      duration: Number(phrase.duration.toFixed(5)),
    },
  ]));
}

function clonePhrasePose(pose) {
  return {
    root: [...pose.root],
    facing: [...pose.facing],
    attention: [...pose.attention],
    scale: pose.scale,
    effort: pose.effort,
  };
}

function closeControlledPhraseBoundaries(phrases) {
  return phrases.map((phrase, index) => (
    index === 0
      ? phrase
      : { ...phrase, from: clonePhrasePose(phrases[index - 1].to) }
  ));
}

export function applyMotionPhraseControls(planInput = DEFAULT_DECISION_MOTION_PLAN, controlsInput = DEFAULT_MOTION_PHRASE_CONTROLS) {
  const basePlan = normalizeMotionPlan(planInput);
  const effectiveControls = normalizeMotionPhraseControls(controlsInput);
  const phrases = basePlan.phrases.map(phrase => ({
    phase: phrase.phase,
    duration: scalePhraseDuration(phrase, effectiveControls),
    easing: phrase.easing,
    from: controlledPhrasePose(phrase, phrase.from, effectiveControls),
    to: controlledPhrasePose(phrase, phrase.to, effectiveControls),
  }));
  const firstPhrase = phrases[0];
  const lastPhrase = phrases.at(-1);
  phrases.push({
    phase: 'return',
    duration: returnPhraseDuration(basePlan, effectiveControls),
    easing: 'smoothstep',
    from: { ...lastPhrase.to },
    to: { ...firstPhrase.from },
  });
  const closedPhrases = closeControlledPhraseBoundaries(phrases);
  const controlledDuration = closedPhrases.reduce((sum, phrase) => sum + phrase.duration, 0);
  const controlledPlan = normalizeMotionPlan({
    schema: MOTION_PLAN_SCHEMA,
    id: `${basePlan.id}__${String(effectiveControls.source).replace(/[^a-z0-9_:-]+/gi, '_')}`,
    label: `${basePlan.label} / ${effectiveControls.source}`,
    intent: basePlan.intent,
    duration: controlledDuration,
    source: 'procedural-phrase-controls-v0',
    weight: {
      mass: effectiveControls.mass,
      anticipation: basePlan.weight.anticipation * effectiveControls.anticipation,
      settle: basePlan.weight.settle * effectiveControls.recovery,
      effortScale: basePlan.weight.effortScale * effectiveControls.effort,
    },
    phrases: closedPhrases,
  });
  return {
    schema: 'kaminos.motion-controlled-plan.v0',
    route: MOTION_ROUTE_IDENTITY,
    basePlanId: basePlan.id,
    effectiveControls,
    plan: controlledPlan,
    phaseTimes: phaseTimesFromPlan(controlledPlan),
  };
}

function normalizePlanWeight(weight = {}) {
  return {
    mass: Math.max(0.1, Number.isFinite(Number(weight.mass)) ? Number(weight.mass) : 1),
    anticipation: Math.max(0, Number.isFinite(Number(weight.anticipation)) ? Number(weight.anticipation) : 0),
    settle: Math.max(0, Number.isFinite(Number(weight.settle)) ? Number(weight.settle) : 0),
    effortScale: Math.max(0.1, Number.isFinite(Number(weight.effortScale)) ? Number(weight.effortScale) : 1),
  };
}

function normalizePhrasePose(pose = {}) {
  return normalizeSample({
    t: 0,
    root: pose.root,
    facing: pose.facing,
    attention: pose.attention,
    scale: pose.scale,
    effort: pose.effort,
  });
}

function normalizeMotionPhrase(phrase, index, start) {
  const phase = String(phrase?.phase || `phrase-${index}`).trim();
  if (!phase) throw new Error(`Motion phrase ${index} needs a phase`);
  const duration = Number(phrase?.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error(`Motion phrase ${phase} must have positive duration`);
  const from = normalizePhrasePose(phrase.from || phrase.pose || {});
  const to = normalizePhrasePose(phrase.to || phrase.from || phrase.pose || {});
  return {
    phase,
    duration,
    start,
    end: start + duration,
    easing: phrase.easing || 'smoothstep',
    from,
    to,
  };
}

export function normalizeMotionPlan(planInput = DEFAULT_DECISION_MOTION_PLAN) {
  if (!planInput || typeof planInput !== 'object') throw new Error('Motion plan must be an object');
  const id = String(planInput.id || '').trim();
  if (!id) throw new Error('Motion plan id is required');
  const phrasesInput = Array.isArray(planInput.phrases) ? planInput.phrases : [];
  if (!phrasesInput.length) throw new Error(`Motion plan ${id} needs at least one phrase`);
  let cursor = 0;
  const phrases = phrasesInput.map((phrase, index) => {
    const normalized = normalizeMotionPhrase(phrase, index, cursor);
    cursor = normalized.end;
    return normalized;
  });
  const requestedDuration = Number(planInput.duration);
  const duration = Number.isFinite(requestedDuration) && requestedDuration > 0 ? Math.max(requestedDuration, cursor) : cursor;
  return {
    schema: planInput.schema || MOTION_PLAN_SCHEMA,
    id,
    label: planInput.label || id,
    intent: planInput.intent || 'unspecified',
    duration,
    source: planInput.source || 'unknown',
    weight: normalizePlanWeight(planInput.weight),
    phrases,
  };
}

function phraseAtTime(plan, t) {
  const time = clamp(Number.isFinite(Number(t)) ? Number(t) : 0, 0, plan.duration);
  const phrase = plan.phrases.find(candidate => time >= candidate.start && time < candidate.end) || plan.phrases.at(-1);
  const local = clamp((time - phrase.start) / Math.max(1e-6, phrase.duration), 0, 1);
  return { phrase, time, local };
}

function massSpacingScale(weight) {
  return clamp(1.12 / (0.72 + weight.mass * 0.28), 0.62, 1.45);
}

function weightPlanSample(sample, phrase, local, weight) {
  const root = [...sample.root];
  const directionPhases = new Set(['commit', 'overshoot', 'recover', 'return']);
  if (directionPhases.has(phrase.phase) && root[2] > 0) {
    root[2] *= massSpacingScale(weight);
  }
  if (phrase.phase === 'recover') {
    const settleEase = smooth01(local);
    root[1] *= 1 - clamp(weight.settle * settleEase, 0, 0.85);
  }
  const phasePulse = pulse01(local);
  const massEffort = 0.92 + weight.mass * 0.06;
  let effortAccent = 1;
  if (phrase.phase === 'anticipate') {
    effortAccent += phasePulse * (0.04 + weight.anticipation * 0.07);
  }
  if (phrase.phase === 'commit') {
    effortAccent += phasePulse * (0.12 + weight.mass * 0.035 + weight.effortScale * 0.035);
  }
  if (phrase.phase === 'overshoot') {
    effortAccent += phasePulse * (0.03 + weight.effortScale * 0.025);
  }
  const effort = sample.effort * weight.effortScale * massEffort * effortAccent;
  const scaleAccent = phrase.phase === 'commit' ? phasePulse * clamp(effort * 0.045, 0, 0.08) : 0;
  return {
    ...sample,
    root,
    scale: sample.scale + scaleAccent,
    effort,
  };
}

export function motionPhraseBodyScale(sampleInput = {}) {
  const sample = {
    scale: Number.isFinite(Number(sampleInput.scale)) ? Number(sampleInput.scale) : 1,
    effort: Number.isFinite(Number(sampleInput.effort)) ? Number(sampleInput.effort) : 0,
    phase: String(sampleInput.phase || ''),
    localT: Number.isFinite(Number(sampleInput.localT)) ? Number(sampleInput.localT) : 0,
  };
  const phasePulse = pulse01(sample.localT);
  const anticipatePulse = sample.phase === 'anticipate' ? phasePulse : 0;
  const commitPulse = sample.phase === 'commit' ? phasePulse : 0;
  const overshootPulse = sample.phase === 'overshoot' ? phasePulse : 0;
  const baseScale = Math.max(0.1, sample.scale);
  const effort = Math.max(0, sample.effort);
  return [
    Number((baseScale * (0.94 + effort * 0.06 + anticipatePulse * 0.08 - commitPulse * 0.025)).toFixed(5)),
    Number((baseScale * (0.92 + effort * 0.11 + commitPulse * 0.16 - anticipatePulse * 0.035)).toFixed(5)),
    Number((baseScale * (0.92 + effort * 0.16 + commitPulse * 0.06 + overshootPulse * 0.035)).toFixed(5)),
  ];
}

export function sampleMotionPlan(planInput = DEFAULT_DECISION_MOTION_PLAN, t) {
  const plan = normalizeMotionPlan(planInput);
  const { phrase, time, local } = phraseAtTime(plan, t);
  const u = smooth01(local);
  const sample = {
    t: time,
    phase: phrase.phase,
    localT: local,
    root: mixVec3(phrase.from.root, phrase.to.root, u),
    facing: normalizeVec3(mixVec3(phrase.from.facing, phrase.to.facing, u)),
    attention: mixVec3(phrase.from.attention, phrase.to.attention, u),
    scale: lerp(phrase.from.scale, phrase.to.scale, u),
    effort: lerp(phrase.from.effort, phrase.to.effort, u),
  };
  const weighted = weightPlanSample(sample, phrase, local, plan.weight);
  return {
    ...weighted,
    scale: Number(weighted.scale.toFixed(5)),
    effort: Number(weighted.effort.toFixed(5)),
    root: weighted.root.map(value => Number(value.toFixed(5))),
    facing: weighted.facing.map(value => Number(value.toFixed(5))),
    attention: weighted.attention.map(value => Number(value.toFixed(5))),
  };
}

function motionPlanMetrics(frames) {
  let maxEffort = 0;
  let minRootZ = Infinity;
  let maxRootZ = -Infinity;
  let maxIntentRootZ = -Infinity;
  let noticeRootZ = null;
  let finalIntentRootZ = null;
  let phaseChanges = 0;
  let lastPhase = null;
  for (const frame of frames) {
    const sample = frame.sample;
    maxEffort = Math.max(maxEffort, sample.effort);
    minRootZ = Math.min(minRootZ, sample.root[2]);
    maxRootZ = Math.max(maxRootZ, sample.root[2]);
    if (sample.phase !== 'return') {
      maxIntentRootZ = Math.max(maxIntentRootZ, sample.root[2]);
      finalIntentRootZ = sample.root[2];
    }
    if (sample.phase === 'notice' && noticeRootZ === null) noticeRootZ = sample.root[2];
    if (lastPhase !== null && sample.phase !== lastPhase) phaseChanges++;
    lastPhase = sample.phase;
  }
  const anticipationReference = noticeRootZ ?? frames[0]?.sample.root[2] ?? 0;
  const settleReference = finalIntentRootZ ?? frames.at(-1)?.sample.root[2] ?? 0;
  const overshootReference = Number.isFinite(maxIntentRootZ) ? maxIntentRootZ : maxRootZ;
  return {
    frameCount: frames.length,
    maxEffort: Number(maxEffort.toFixed(5)),
    anticipationDepth: Number(Math.max(0, anticipationReference - minRootZ).toFixed(5)),
    overshootDistance: Number(Math.max(0, overshootReference - settleReference).toFixed(5)),
    phaseChanges,
  };
}

export function simulateMotionPlan(planInput = DEFAULT_DECISION_MOTION_PLAN, { duration, fps = 12 } = {}) {
  const plan = normalizeMotionPlan(planInput);
  const simDuration = Math.max(0.1, Number.isFinite(Number(duration)) ? Number(duration) : plan.duration);
  const simFps = Math.max(1, Math.round(Number(fps) || 12));
  const frameCount = Math.floor(simDuration * simFps) + 1;
  const frames = [];
  for (let index = 0; index < frameCount; index++) {
    const t = index / simFps;
    const sample = sampleMotionPlan(plan, t);
    frames.push({ frameIndex: index, t: Number(t.toFixed(5)), sample });
  }
  return {
    schema: 'kaminos.motion-plan-simulation.v0',
    route: MOTION_ROUTE_IDENTITY,
    planId: plan.id,
    duration: simDuration,
    fps: simFps,
    frames,
    metrics: motionPlanMetrics(frames),
  };
}

function comparisonActorSample(actor, sample, origin) {
  return {
    id: actor.id,
    label: actor.label,
    intent: actor.intent,
    status: sample.phase,
    color: actor.color,
    root: addVec3(origin, sample.root).map(value => Number(value.toFixed(5))),
    localRoot: sample.root,
    facing: sample.facing,
    attention: addVec3(origin, sample.attention).map(value => Number(value.toFixed(5))),
    scale: sample.scale,
    effort: sample.effort,
    speed: 0,
    phase: sample.phase,
  };
}

function naiveDecisionPlan(duration) {
  return {
    schema: MOTION_PLAN_SCHEMA,
    id: 'naive_loop_bad_intent_v0',
    label: 'Naive Loop',
    intent: 'looped-forward-motion',
    duration,
    source: 'procedural-naive-comparison-v0',
    weight: { mass: 1, anticipation: 0, settle: 0, effortScale: 1 },
    phrases: [
      {
        phase: 'loop',
        duration,
        from: { root: [0, 0, -0.82], facing: [0, 0, 1], attention: [0, 0.18, 1.15], scale: 1, effort: 0.24 },
        to: { root: [0, 0, 0.62], facing: [0, 0, 1], attention: [0, 0.18, 1.15], scale: 1.04, effort: 0.52 },
      },
    ],
  };
}

export function buildMotionDecisionComparison({ duration = 7.2, fps = 12, filmstripFrames = 7 } = {}) {
  const simDuration = Math.max(0.1, Number(duration) || 7.2);
  const simFps = Math.max(1, Math.round(Number(fps) || 12));
  const naivePlan = normalizeMotionPlan(naiveDecisionPlan(simDuration));
  const phrasedPlan = normalizeMotionPlan({ ...DEFAULT_DECISION_MOTION_PLAN, duration: simDuration });
  const naiveSimulation = simulateMotionPlan(naivePlan, { duration: simDuration, fps: simFps });
  const phrasedSimulation = simulateMotionPlan(phrasedPlan, { duration: simDuration, fps: simFps });
  const naiveActor = { id: 'naive-loop', label: 'Naive Loop', color: '#8fb6ff', intent: naivePlan.intent };
  const phrasedActor = { id: 'phrased-decision', label: 'Phrased Decision', color: '#ff7a66', intent: phrasedPlan.intent };
  const count = Math.max(1, Math.min(Math.round(Number(filmstripFrames) || 7), phrasedSimulation.frames.length));
  const frameIndexes = Array.from({ length: count }, (_, i) => (
    count === 1 ? 0 : Math.round(i * (phrasedSimulation.frames.length - 1) / (count - 1))
  ));
  const filmstrip = frameIndexes.map(index => {
    const naiveSample = naiveSimulation.frames[index]?.sample || sampleMotionPlan(naivePlan, index / simFps);
    const phrasedSample = phrasedSimulation.frames[index]?.sample || sampleMotionPlan(phrasedPlan, index / simFps);
    return {
      frameIndex: index,
      t: Number((index / simFps).toFixed(5)),
      actors: [
        comparisonActorSample(naiveActor, naiveSample, [-1.05, 0, 0]),
        comparisonActorSample(phrasedActor, phrasedSample, [1.05, 0, 0]),
      ],
      naive: naiveSample,
      phrased: phrasedSample,
    };
  });
  return {
    schema: 'kaminos.motion-decision-comparison.v0',
    route: MOTION_ROUTE_IDENTITY,
    duration: simDuration,
    fps: simFps,
    naive: {
      actor: naiveActor,
      plan: naivePlan,
      metrics: naiveSimulation.metrics,
      simulation: naiveSimulation,
    },
    phrased: {
      actor: phrasedActor,
      plan: phrasedPlan,
      metrics: phrasedSimulation.metrics,
      simulation: phrasedSimulation,
    },
    filmstrip,
  };
}

export function buildMotionPhraseControlHarness({
  basePlan = DEFAULT_DECISION_MOTION_PLAN,
  presets = DEFAULT_MOTION_PHRASE_CONTROL_PRESETS,
  duration,
  fps = 12,
  filmstripFrames = 7,
} = {}) {
  const simFps = Math.max(1, Math.round(Number(fps) || 12));
  const variants = presets.map((preset, index) => {
    const controlled = applyMotionPhraseControls(basePlan, preset.controls);
    const simDuration = Number.isFinite(Number(duration)) && Number(duration) > 0
      ? Number(duration)
      : controlled.plan.duration;
    const simulation = simulateMotionPlan(controlled.plan, { duration: simDuration, fps: simFps });
    return {
      id: preset.id || `motion-control-variant-${index}`,
      label: preset.label || preset.id || `Motion Variant ${index + 1}`,
      color: preset.color || '#d8c38e',
      controls: preset.controls,
      effectiveControls: controlled.effectiveControls,
      plan: controlled.plan,
      phaseTimes: controlled.phaseTimes,
      metrics: simulation.metrics,
      simulation,
    };
  });
  const maxFrames = Math.max(...variants.map(variant => variant.simulation.frames.length));
  const count = Math.max(1, Math.min(Math.round(Number(filmstripFrames) || 7), maxFrames));
  const origins = variants.map((_, index) => [(index - (variants.length - 1) * 0.5) * 1.35, 0, 0]);
  const frameIndexes = Array.from({ length: count }, (_, i) => (
    count === 1 ? 0 : Math.round(i * (maxFrames - 1) / (count - 1))
  ));
  const filmstrip = frameIndexes.map(index => ({
    frameIndex: index,
    t: Number((index / simFps).toFixed(5)),
    actors: variants.map((variant, variantIndex) => {
      const sample = variant.simulation.frames[Math.min(index, variant.simulation.frames.length - 1)]?.sample
        || sampleMotionPlan(variant.plan, index / simFps);
      return comparisonActorSample({
        id: variant.id,
        label: variant.label,
        intent: variant.plan.intent,
        color: variant.color,
      }, sample, origins[variantIndex]);
    }),
  }));
  return {
    schema: 'kaminos.motion-phrase-control-harness.v0',
    route: MOTION_ROUTE_IDENTITY,
    basePlanId: normalizeMotionPlan(basePlan).id,
    fps: simFps,
    variants,
    filmstrip,
  };
}

function normalizeTimedVecTrack(samples, fallback = [0, 0, 0]) {
  const source = Array.isArray(samples) ? samples : [];
  return source
    .map((point, index) => ({
      t: Number.isFinite(Number(point?.t)) ? Number(point.t) : index,
      value: vec3(point?.value, fallback),
    }))
    .filter(point => Number.isFinite(point.t))
    .sort((a, b) => a.t - b.t);
}

function normalizeTimedScalarTrack(samples, fallback = 0) {
  const source = Array.isArray(samples) ? samples : [];
  return source
    .map((point, index) => ({
      t: Number.isFinite(Number(point?.t)) ? Number(point.t) : index,
      value: Number.isFinite(Number(point?.value)) ? Number(point.value) : fallback,
    }))
    .filter(point => Number.isFinite(point.t))
    .sort((a, b) => a.t - b.t);
}

function normalizeTimedLabelTrack(samples, fallback = 'idle') {
  const source = Array.isArray(samples) ? samples : [];
  return source
    .map((point, index) => ({
      t: Number.isFinite(Number(point?.t)) ? Number(point.t) : index,
      value: String(point?.value || fallback),
    }))
    .filter(point => Number.isFinite(point.t))
    .sort((a, b) => a.t - b.t);
}

function clampTrackTimes(samples, duration) {
  return samples.map(point => ({ ...point, t: clamp(point.t, 0, duration) }));
}

export function normalizeMotionTrack(trackInput = DEFAULT_MOTION_TRACK_FIXTURE) {
  const id = String(trackInput?.id || '').trim();
  if (!id) throw new Error('Motion track id is required');
  const duration = Number(trackInput?.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error(`Motion track ${id} must have positive duration`);
  const fps = Math.max(1, Math.round(Number(trackInput?.fps) || 30));
  const tracksInput = trackInput?.tracks || {};
  const root = clampTrackTimes(normalizeTimedVecTrack(tracksInput.root, [0, 0, 0]), duration);
  const head = clampTrackTimes(normalizeTimedVecTrack(tracksInput.head, [0, 0.4, 0.6]), duration);
  const effort = clampTrackTimes(normalizeTimedScalarTrack(tracksInput.effort, 0.18), duration);
  const phase = clampTrackTimes(normalizeTimedLabelTrack(tracksInput.phase, 'idle'), duration);
  if (root.length < 2) throw new Error(`Motion track ${id} needs at least two root samples`);
  if (head.length < 2) throw new Error(`Motion track ${id} needs at least two head samples`);
  return {
    schema: MOTION_TRACK_SCHEMA,
    id,
    label: trackInput.label || id,
    intent: trackInput.intent || 'unspecified',
    sourceKind: trackInput.sourceKind || 'unknown',
    sourceStatus: trackInput.sourceStatus || trackInput.sourceKind || 'unknown',
    sourceModel: trackInput.sourceModel || 'unknown',
    sourceRoute: trackInput.sourceRoute || 'unknown',
    previewRoute: trackInput.previewRoute || null,
    prompt: trackInput.prompt || null,
    rawFrameCount: Number.isFinite(Number(trackInput.rawFrameCount)) ? Number(trackInput.rawFrameCount) : null,
    jointMapping: trackInput.jointMapping || null,
    extractionAssumptions: Array.isArray(trackInput.extractionAssumptions) ? [...trackInput.extractionAssumptions] : [],
    modelRun: trackInput.modelRun || null,
    fps,
    duration,
    units: trackInput.units || 'meters',
    upAxis: normalizeVec3(vec3(trackInput.upAxis, [0, 1, 0]), [0, 1, 0]),
    forwardAxis: normalizeVec3(vec3(trackInput.forwardAxis, [0, 0, 1]), [0, 0, 1]),
    tracks: { root, head, effort, phase },
  };
}

function generatedPhaseForProgress(progress) {
  if (progress < 0.16) return 'entering';
  if (progress < 0.58) return 'wave';
  if (progress < 0.86) return 'reporting';
  return 'settle';
}

export function adaptGeneratedJointMotionToTrack(generatedInput = DEFAULT_DIP_WAVE_GENERATED_MOTION_FIXTURE) {
  const id = String(generatedInput?.id || '').trim();
  if (!id) throw new Error('Generated motion id is required');
  const fps = Math.max(1, Math.round(Number(generatedInput?.fps) || 20));
  const rawFrameCount = Math.max(2, Math.round(Number(generatedInput?.rawFrameCount) || 2));
  const duration = Number(((rawFrameCount - 1) / fps).toFixed(5));
  const samples = Array.isArray(generatedInput?.samples) ? generatedInput.samples : [];
  if (samples.length < 2) throw new Error(`Generated motion ${id} needs at least two distilled samples`);
  const firstRoot = vec3(samples[0]?.root);
  const wristHeights = samples.map(sample => {
    const root = vec3(sample.root);
    const leftWrist = vec3(sample.leftWrist, root);
    const rightWrist = vec3(sample.rightWrist, root);
    return Math.max(Math.abs(leftWrist[1] - root[1]), Math.abs(rightWrist[1] - root[1]));
  });
  const entryWristHeight = wristHeights[0];
  const wristHeightDeltas = wristHeights.map(height => Math.abs(height - entryWristHeight));
  const maxWristDelta = Math.max(...wristHeightDeltas);
  const normalizeWorld = value => {
    const source = vec3(value);
    return [
      Number((source[0] - firstRoot[0]).toFixed(5)),
      Number((source[1] - firstRoot[1]).toFixed(5)),
      Number((source[2] - firstRoot[2]).toFixed(5)),
    ];
  };
  const timeForFrame = sample => Number((clamp(Number(sample.frame) || 0, 0, rawFrameCount - 1) / fps).toFixed(5));
  return normalizeMotionTrack({
    schema: MOTION_TRACK_SCHEMA,
    id,
    label: generatedInput.label || id,
    intent: generatedInput.intent || 'generated-motion',
    sourceKind: generatedInput.sourceKind || 'generated-fixture',
    sourceStatus: generatedInput.sourceStatus || 'fixture',
    sourceModel: generatedInput.sourceModel || 'unknown',
    sourceRoute: generatedInput.sourceRoute || 'unknown',
    previewRoute: generatedInput.previewRoute || null,
    prompt: generatedInput.prompt || null,
    modelRun: generatedInput.modelRun || null,
    rawFrameCount,
    jointMapping: generatedInput.jointMapping || null,
    extractionAssumptions: generatedInput.extractionAssumptions || [],
    fps,
    duration,
    units: 'meters',
    upAxis: [0, 1, 0],
    forwardAxis: [0, 0, 1],
    tracks: {
      root: samples.map(sample => ({ t: timeForFrame(sample), value: normalizeWorld(sample.root) })),
      head: samples.map(sample => ({ t: timeForFrame(sample), value: normalizeWorld(sample.head) })),
      effort: samples.map((sample, index) => {
        const wristEffort = wristHeightDeltas[index] / Math.max(1e-6, maxWristDelta);
        return { t: timeForFrame(sample), value: Number((0.2 + wristEffort * 0.72).toFixed(5)) };
      }),
      phase: samples.map(sample => ({
        t: timeForFrame(sample),
        value: generatedPhaseForProgress((Number(sample.frame) || 0) / Math.max(1, rawFrameCount - 1)),
      })),
    },
  });
}

function sampleTimedVec(samples, t) {
  if (t <= samples[0].t) return [...samples[0].value];
  const last = samples.at(-1);
  if (t >= last.t) return [...last.value];
  const afterIndex = samples.findIndex(point => point.t >= t);
  const before = samples[Math.max(0, afterIndex - 1)];
  const after = samples[afterIndex];
  const u = smooth01((t - before.t) / Math.max(1e-6, after.t - before.t));
  return mixVec3(before.value, after.value, u);
}

function sampleTimedScalar(samples, t) {
  if (!samples.length) return 0;
  if (t <= samples[0].t) return samples[0].value;
  const last = samples.at(-1);
  if (t >= last.t) return last.value;
  const afterIndex = samples.findIndex(point => point.t >= t);
  const before = samples[Math.max(0, afterIndex - 1)];
  const after = samples[afterIndex];
  const u = smooth01((t - before.t) / Math.max(1e-6, after.t - before.t));
  return lerp(before.value, after.value, u);
}

function sampleTimedLabel(samples, t) {
  if (!samples.length) return 'idle';
  let current = samples[0].value;
  for (const point of samples) {
    if (point.t > t) break;
    current = point.value;
  }
  return current;
}

function fallbackHeadFromRoot(root) {
  return [root[0], root[1] + 0.36, root[2] + 0.34];
}

export function sampleMotionTrack(trackInput = DEFAULT_MOTION_TRACK_FIXTURE, t = 0, { mode = 'mass-attention' } = {}) {
  const track = normalizeMotionTrack(trackInput);
  const attentionMode = mode === 'root-only'
    ? 'mass-only'
    : (mode === 'root+head' ? 'mass-attention' : mode);
  const time = clamp(Number.isFinite(Number(t)) ? Number(t) : 0, 0, track.duration);
  const root = sampleTimedVec(track.tracks.root, time);
  const trackedHead = sampleTimedVec(track.tracks.head, time);
  const head = attentionMode === 'mass-only' ? fallbackHeadFromRoot(root) : trackedHead;
  const facing = normalizeVec3(subVec3(head, root), track.forwardAxis);
  const effort = sampleTimedScalar(track.tracks.effort, time);
  const phase = sampleTimedLabel(track.tracks.phase, time);
  const headRootSeparation = lengthVec3(subVec3(head, root));
  const attentionMassContrast = Math.max(0, headRootSeparation - 0.49518);
  return {
    schema: 'kaminos.motion-track-sample.v0',
    trackId: track.id,
    sourceKind: track.sourceKind,
    mode: attentionMode,
    attentionMode,
    t: Number(time.toFixed(5)),
    phase,
    root: root.map(value => Number(value.toFixed(5))),
    head: head.map(value => Number(value.toFixed(5))),
    attention: head.map(value => Number(value.toFixed(5))),
    facing: facing.map(value => Number(value.toFixed(5))),
    effort: Number(effort.toFixed(5)),
    scale: Number((0.94 + clamp(effort * 0.08, 0, 0.18)).toFixed(5)),
    headRootSeparation: Number(headRootSeparation.toFixed(5)),
    attentionMassContrast: Number(attentionMassContrast.toFixed(5)),
  };
}

function motionTrackMetrics(frames) {
  let rootTravel = 0;
  let maxEffort = 0;
  let attentionLeadDistance = 0;
  let maxHeadRootSeparation = 0;
  let attentionMassContrast = 0;
  let phaseChanges = 0;
  let lastPhase = null;
  let lastRoot = null;
  let minRootY = Infinity;
  let maxRootY = -Infinity;
  for (const frame of frames) {
    const sample = frame.sample;
    if (lastRoot) rootTravel += lengthVec3(subVec3(sample.root, lastRoot));
    lastRoot = sample.root;
    minRootY = Math.min(minRootY, sample.root[1]);
    maxRootY = Math.max(maxRootY, sample.root[1]);
    maxEffort = Math.max(maxEffort, sample.effort);
    attentionLeadDistance += Math.max(0, sample.attention[2] - sample.root[2]);
    maxHeadRootSeparation = Math.max(maxHeadRootSeparation, sample.headRootSeparation);
    attentionMassContrast += sample.attentionMassContrast || 0;
    if (lastPhase !== null && sample.phase !== lastPhase) phaseChanges++;
    lastPhase = sample.phase;
  }
  return {
    frameCount: frames.length,
    rootTravel: Number(rootTravel.toFixed(5)),
    rootVerticalRange: Number((maxRootY - minRootY).toFixed(5)),
    maxEffort: Number(maxEffort.toFixed(5)),
    attentionLeadDistance: Number((attentionLeadDistance / Math.max(1, frames.length)).toFixed(5)),
    maxHeadRootSeparation: Number(maxHeadRootSeparation.toFixed(5)),
    attentionMassContrast: Number((attentionMassContrast / Math.max(1, frames.length)).toFixed(5)),
    phaseChanges,
  };
}

export function simulateMotionTrack(trackInput = DEFAULT_MOTION_TRACK_FIXTURE, { duration, fps = 12, mode = 'mass-attention' } = {}) {
  const track = normalizeMotionTrack(trackInput);
  const simDuration = Math.max(0.1, Number.isFinite(Number(duration)) ? Number(duration) : track.duration);
  const simFps = Math.max(1, Math.round(Number(fps) || 12));
  const frameCount = Math.floor(simDuration * simFps) + 1;
  const frames = [];
  for (let index = 0; index < frameCount; index++) {
    const t = Math.min(track.duration, index / simFps);
    const sample = sampleMotionTrack(track, t, { mode });
    frames.push({ frameIndex: index, t: Number(t.toFixed(5)), sample });
  }
  return {
    schema: 'kaminos.motion-track-simulation.v0',
    route: MOTION_ROUTE_IDENTITY,
    trackId: track.id,
    sourceKind: track.sourceKind,
    sourceRoute: track.sourceRoute,
    mode,
    duration: simDuration,
    fps: simFps,
    frames,
    metrics: motionTrackMetrics(frames),
  };
}

function motionTrackActorSample(actor, sample, origin) {
  return {
    id: actor.id,
    label: actor.label,
    intent: actor.intent,
    status: sample.phase,
    color: actor.color,
    root: addVec3(origin, sample.root).map(value => Number(value.toFixed(5))),
    localRoot: sample.root,
    facing: sample.facing,
    attention: addVec3(origin, sample.attention).map(value => Number(value.toFixed(5))),
    scale: sample.scale,
    effort: sample.effort,
    speed: 0,
    phase: sample.phase,
    sourceKind: sample.sourceKind,
    mode: sample.mode,
    headRootSeparation: sample.headRootSeparation,
    attentionMassContrast: sample.attentionMassContrast,
  };
}

export function buildMotionTrackHarness({
  trackInput = DEFAULT_MOTION_TRACK_FIXTURE,
  duration,
  fps = 12,
  filmstripFrames = 7,
} = {}) {
  const track = normalizeMotionTrack(trackInput);
  const simDuration = Math.max(0.1, Number.isFinite(Number(duration)) ? Number(duration) : track.duration);
  const simFps = Math.max(1, Math.round(Number(fps) || 12));
  const phrasePlan = normalizeMotionPlan({ ...DEFAULT_DECISION_MOTION_PLAN, duration: simDuration });
  const phraseSimulation = simulateMotionPlan(phrasePlan, { duration: simDuration, fps: simFps });
  const massOnlySimulation = simulateMotionTrack(track, { duration: simDuration, fps: simFps, mode: 'mass-only' });
  const massAttentionSimulation = simulateMotionTrack(track, { duration: simDuration, fps: simFps, mode: 'mass-attention' });
  const variants = [
    {
      id: 'phrase_baseline',
      label: 'Phrase Baseline',
      color: '#8fb6ff',
      kind: 'procedural-phrase',
      metrics: {
        ...phraseSimulation.metrics,
        attentionLeadDistance: 0,
        maxHeadRootSeparation: 0,
        attentionMassContrast: 0,
      },
      simulation: phraseSimulation,
    },
    {
      id: 'track_mass_only',
      label: 'Mass Only Track',
      color: '#ffd166',
      kind: 'motion-track-mass-only',
      attentionMode: 'mass-only',
      metrics: massOnlySimulation.metrics,
      simulation: massOnlySimulation,
    },
    {
      id: 'track_mass_attention',
      label: 'Mass + Attention Track',
      color: '#ff7a66',
      kind: 'motion-track-mass-attention',
      attentionMode: 'mass-attention',
      metrics: massAttentionSimulation.metrics,
      simulation: massAttentionSimulation,
    },
  ];
  const maxFrames = Math.max(...variants.map(variant => variant.simulation.frames.length));
  const count = Math.max(1, Math.min(Math.round(Number(filmstripFrames) || 7), maxFrames));
  const frameIndexes = Array.from({ length: count }, (_, i) => (
    count === 1 ? 0 : Math.round(i * (maxFrames - 1) / (count - 1))
  ));
  const origins = [[-1.55, 0, 0], [0, 0, 0], [1.55, 0, 0]];
  const actors = [
    { id: 'phrase-baseline', label: 'Phrase Baseline', color: '#8fb6ff', intent: phrasePlan.intent },
    { id: 'track-mass-only', label: 'Mass Only Track', color: '#ffd166', intent: track.intent },
    { id: 'track-mass-attention', label: 'Mass + Attention Track', color: '#ff7a66', intent: track.intent },
  ];
  const filmstrip = frameIndexes.map(index => ({
    frameIndex: index,
    t: Number((index / simFps).toFixed(5)),
    actors: variants.map((variant, variantIndex) => {
      const frame = variant.simulation.frames[Math.min(index, variant.simulation.frames.length - 1)];
      const sample = frame?.sample || (variantIndex === 0
        ? sampleMotionPlan(phrasePlan, index / simFps)
        : sampleMotionTrack(track, index / simFps, { mode: variantIndex === 1 ? 'mass-only' : 'mass-attention' }));
      return variantIndex === 0
        ? comparisonActorSample(actors[variantIndex], sample, origins[variantIndex])
        : motionTrackActorSample(actors[variantIndex], sample, origins[variantIndex]);
    }),
  }));
  return {
    schema: 'kaminos.motion-track-harness.v0',
    route: MOTION_ROUTE_IDENTITY,
    track,
    fps: simFps,
    duration: simDuration,
    variants,
    filmstrip,
  };
}

export function buildGeneratedMotionTrackHarness({
  generatedInput = DEFAULT_DIP_WAVE_GENERATED_MOTION_FIXTURE,
  duration,
  fps = 12,
  filmstripFrames = 7,
} = {}) {
  const authoredTrack = normalizeMotionTrack(DEFAULT_MOTION_TRACK_FIXTURE);
  const generatedTrack = adaptGeneratedJointMotionToTrack(generatedInput);
  const simDuration = Math.max(0.1, Number.isFinite(Number(duration)) ? Number(duration) : generatedTrack.duration);
  const simFps = Math.max(1, Math.round(Number(fps) || 12));
  const authoredSimulation = simulateMotionTrack(authoredTrack, { duration: Math.min(simDuration, authoredTrack.duration), fps: simFps, mode: 'mass-attention' });
  const generatedSimulation = simulateMotionTrack(generatedTrack, { duration: simDuration, fps: simFps, mode: 'mass-attention' });
  const variants = [
    {
      id: 'authored_mass_attention',
      label: 'Authored Mass + Attention',
      color: '#ff7a66',
      kind: 'motion-track-authored-mass-attention',
      attentionMode: 'mass-attention',
      verticalDisplayScale: 1,
      track: authoredTrack,
      metrics: authoredSimulation.metrics,
      simulation: authoredSimulation,
    },
    {
      id: 'generated_dip_wave',
      label: 'Generated DiP Wave',
      color: '#9fe6bd',
      kind: 'motion-track-generated-dip-wave',
      attentionMode: 'mass-attention',
      verticalDisplayScale: 6,
      track: generatedTrack,
      metrics: generatedSimulation.metrics,
      simulation: generatedSimulation,
    },
  ];
  const maxFrames = Math.max(...variants.map(variant => variant.simulation.frames.length));
  const count = Math.max(1, Math.min(Math.round(Number(filmstripFrames) || 7), maxFrames));
  const frameIndexes = Array.from({ length: count }, (_, i) => (
    count === 1 ? 0 : Math.round(i * (maxFrames - 1) / (count - 1))
  ));
  const origins = [[-1.2, 0, 0], [1.2, 0, -1.2]];
  const actors = [
    { id: 'authored-mass-attention', label: 'Authored Mass + Attention', color: '#ff7a66', intent: authoredTrack.intent },
    { id: 'generated-dip-wave', label: 'Generated DiP Wave', color: '#9fe6bd', intent: generatedTrack.intent },
  ];
  const filmstrip = frameIndexes.map(index => ({
    frameIndex: index,
    t: Number((index / simFps).toFixed(5)),
    actors: variants.map((variant, variantIndex) => {
      const frame = variant.simulation.frames[Math.min(index, variant.simulation.frames.length - 1)];
      const sample = frame?.sample || sampleMotionTrack(variant.track, index / simFps, { mode: 'mass-attention' });
      return motionTrackActorSample(actors[variantIndex], sample, origins[variantIndex]);
    }),
  }));
  return {
    schema: 'kaminos.generated-motion-track-harness.v0',
    route: MOTION_ROUTE_IDENTITY,
    sourceStatus: generatedTrack.sourceStatus,
    sourceKind: generatedTrack.sourceKind,
    sourceModel: generatedTrack.sourceModel,
    sourceRoute: generatedTrack.sourceRoute,
    prompt: generatedTrack.prompt,
    track: generatedTrack,
    authoredTrack,
    fps: simFps,
    duration: simDuration,
    variants,
    filmstrip,
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
