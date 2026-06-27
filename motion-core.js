export const MOTION_CLIP_SCHEMA = 'kaminos.motion-clip.v0';
export const MOTION_ACTOR_SCHEMA = 'kaminos.motion-actors.v0';
export const MOTION_SIMULATION_SCHEMA = 'kaminos.motion-simulation.v0';
export const MOTION_WITNESS_SCHEMA = 'kaminos.motion-witness.v0';
export const MOTION_PLAN_SCHEMA = 'kaminos.motion-plan.v0';
export const MOTION_PHRASE_CONTROL_SCHEMA = 'kaminos.motion-phrase-controls.v0';
export const MOTION_TRACK_SCHEMA = 'kaminos.motion-track.v0';
export const GENERATED_POSE_OUTPUT_MAP_SCHEMA = 'kaminos.generated-pose-output-map.v0';
export const GENERATED_MOTION_BEHAVIOR_STATE_SCHEMA = 'kaminos.generated-motion-behavior-state.v0';
export const MOTION_ROUTE_IDENTITY = 'procedural-orb-motion-grammar-v0';
export const DEFAULT_GENERATED_POSE_TEMPORAL_REGISTRY_URL = 'fixtures/generated-pose-temporal/kimodo-matrix.v0.json';
export const MOTION_SERVER_TEMPORAL_SOURCE_FORMAT = 'motion-server-soma77-json';

const SOMA77_TEMPORAL_JOINT = {
  Hips: 0,
  Chest: 3,
  Head: 6,
  LeftHand: 14,
  RightHand: 42,
  LeftFoot: 69,
  RightFoot: 74,
};

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

function defaultMotionServerFrame(frameIndex) {
  const t = frameIndex / 29;
  return Array.from({ length: 77 }, (_, jointIndex) => {
    const side = jointIndex % 2 === 0 ? -1 : 1;
    const height = jointIndex === SOMA77_TEMPORAL_JOINT.Head
      ? 1.62
      : jointIndex === SOMA77_TEMPORAL_JOINT.Chest
        ? 1.18
        : jointIndex >= SOMA77_TEMPORAL_JOINT.LeftFoot
          ? 0.08
          : 0.82;
    return [
      Number((t * 0.55 + side * 0.015 * Math.sin(t * Math.PI * 2 + jointIndex)).toFixed(5)),
      Number((height + 0.08 * Math.sin(t * Math.PI * 3 + jointIndex * 0.13)).toFixed(5)),
      Number((0.18 * Math.sin(t * Math.PI * 1.5) + side * 0.04).toFixed(5)),
    ];
  });
}

export const DEFAULT_MOTION_SERVER_RESULT_FIXTURE = {
  prompt: 'a little lerm creeps uphill and waves',
  model: 'kimodo',
  skeleton_type: 'soma77',
  fps: 30,
  duration: 1,
  num_frames: 30,
  num_joints: 77,
  gen_time: 7.3,
  parents: Array.from({ length: 77 }, (_, index) => (index === 0 ? -1 : Math.max(0, index - 1))),
  joints: Array.from({ length: 30 }, (_, frameIndex) => defaultMotionServerFrame(frameIndex)),
  root_positions: Array.from({ length: 30 }, (_, frameIndex) => [
    Number((frameIndex / 29 * 0.55).toFixed(5)),
    0,
    0,
  ]),
};

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

export const DEFAULT_GENERATED_POSE_OUTPUT_MAP_FIXTURE = {
  schema: GENERATED_POSE_OUTPUT_MAP_SCHEMA,
  ok: true,
  route: 'generated-pose-feature-output-map-v0',
  source: {
    schema: 'kaminos.generated-pose-features.v0',
    effectivePath: '/tmp/kaminos-generated-pose-features-kimodo-bow-0624.json',
    featureReportSha256: 'fixture-bow-feature-report-sha256-not-runtime-file-read',
    generatedMotionInput: '/tmp/kaminos-kimodo-bow-motion.npz',
    generatedMotionInputSha256: 'fixture-bow-motion-input-sha256-not-runtime-file-read',
    sourceFormat: 'kimodo-soma77-explicit-joints',
  },
  inputSockets: [
    { id: 'rootMetrics.travelXZ', label: 'Root travel XZ', valueType: 'number', units: 'meters' },
    { id: 'torsoFrame.chestRootHorizontalLean.range', label: 'Torso lean range', valueType: 'number', units: 'meters' },
    { id: 'torsoFrame.headRootDistance.range', label: 'Head/root separation range', valueType: 'number', units: 'meters' },
    { id: 'limbEnvelope.handSpan.range', label: 'Hand span range', valueType: 'number', units: 'meters' },
    { id: 'limbEnvelope.maxHandSpeed', label: 'Maximum hand speed', valueType: 'number', units: 'metersPerSecond' },
    { id: 'stanceContact.stanceWidth.range', label: 'Stance width range', valueType: 'number', units: 'meters' },
    { id: 'stanceContact.contactBalance', label: 'Foot contact balance', valueType: 'derived-number', units: 'ratio' },
    { id: 'expansionCompression.bboxVolume.range', label: 'Pose volume range', valueType: 'number', units: 'cubicMeters' },
    { id: 'eventSpikes.0.speed', label: 'Primary event spike speed', valueType: 'number', units: 'metersPerSecond' },
  ],
  outputSockets: [
    { id: 'orb.rootOffset', label: 'Orb root offset', valueType: 'number', domain: 'motion-root' },
    { id: 'orb.faceCueLead', label: 'Face cue lead', valueType: 'number', domain: 'attention' },
    { id: 'body.lean', label: 'Body lean', valueType: 'number', domain: 'body-shape' },
    { id: 'body.scalePulse', label: 'Body scale pulse', valueType: 'number', domain: 'body-shape' },
    { id: 'aura.radius', label: 'Aura radius', valueType: 'number', domain: 'expressive-envelope' },
    { id: 'trail.accent', label: 'Trail/accent emission', valueType: 'event', domain: 'accent' },
    { id: 'footfall.pulse', label: 'Footfall pulse', valueType: 'number', domain: 'grounding' },
  ],
  mappingEdges: [
    { id: 'root-travel-to-orb-offset', from: 'rootMetrics.travelXZ', to: 'orb.rootOffset', rule: { type: 'linear-normalized', gain: 1 } },
    { id: 'head-root-to-face-cue', from: 'torsoFrame.headRootDistance.range', to: 'orb.faceCueLead', rule: { type: 'linear-normalized', gain: 1.1 } },
    { id: 'torso-lean-to-body-lean', from: 'torsoFrame.chestRootHorizontalLean.range', to: 'body.lean', rule: { type: 'linear-normalized', gain: 1 } },
    { id: 'volume-range-to-scale-pulse', from: 'expansionCompression.bboxVolume.range', to: 'body.scalePulse', rule: { type: 'linear-normalized', gain: 1 } },
    { id: 'hand-span-to-aura-radius', from: 'limbEnvelope.handSpan.range', to: 'aura.radius', rule: { type: 'linear-normalized', gain: 1 } },
    { id: 'event-spike-to-trail-accent', from: 'eventSpikes.0.speed', to: 'trail.accent', rule: { type: 'event-normalized', gain: 1 } },
    { id: 'stance-and-contact-to-footfall', from: 'stanceContact.stanceWidth.range', to: 'footfall.pulse', rule: { type: 'weighted-average', gain: 1, with: ['stanceContact.contactBalance'] } },
  ],
  normalizedOutputs: {
    'orb.rootOffset': { value: 0.11155, source: 'rootMetrics.travelXZ' },
    'orb.faceCueLead': { value: 0.36544, source: 'torsoFrame.headRootDistance.range' },
    'body.lean': { value: 0.69605, source: 'torsoFrame.chestRootHorizontalLean.range' },
    'body.scalePulse': { value: 0.97807, source: 'expansionCompression.bboxVolume.range' },
    'aura.radius': { value: 0.91799, source: 'limbEnvelope.handSpan.range' },
    'trail.accent': {
      value: 0.70382,
      source: 'eventSpikes.0.speed',
      event: { channel: 'leftHand', time: 3.5, speed: 1.75955 },
    },
    'footfall.pulse': { value: 0.58852, source: 'stanceContact.stanceWidth.range + stanceContact.contactBalance' },
  },
  summary: {
    strongestOutput: 'body.scalePulse',
    outputCount: 7,
    edgeCount: 7,
  },
};

export const DEFAULT_KIMODO_BOW_TEMPORAL_POSE_FIXTURE = {
  schema: 'kaminos.generated-pose-temporal.v0',
  id: 'kimodo_theatrical_bow_temporal_v0',
  label: 'Kimodo Theatrical Bow Temporal V0',
  intent: 'exaggerated-theatrical-bow',
  sourceKind: 'generated-pose-temporal',
  sourceStatus: 'fixture',
  sourceModel: 'Kimodo',
  sourceRoute: '/private/tmp/kimodo_matrix/03_a_person_performs_an_exaggerated_theatrical_bow_sw.npz',
  sourceFormat: 'kimodo-soma77-explicit-joints',
  inputSha256: '0d8d0c3533e63e2f06e783fa80b6e194a81fa9770c0c89e6e4cce600e6ad38f6',
  fps: 30,
  rawFrameCount: 180,
  duration: 5.96667,
  jointMapping: { Hips: 0, Chest: 3, Head: 6, LeftHand: 14, RightHand: 42, LeftFoot: 69, RightFoot: 74 },
  sourceFrameStride: 11,
  sampleCount: 18,
  extractionAssumptions: [
    'input temporal samples are distilled from actual SOMA77 joints in a Kimodo NPZ',
    'Hips/root_positions drive root motion when present',
    'Head and Chest drive attention, bow compression, and body lean',
    'Hands and feet drive effort, limb spread, and grounding cues',
    'phase labels are heuristic and must not claim source-authored semantics',
  ],
  temporalSamples: [
    { frame: 0, time: 0, phaseLabel: 'enter', root: [0.04437, 1.00735, 0.04932], head: [0.04229, 1.60229, 0.09108], chest: [0.04294, 1.20295, 0.03764], leftHand: [0.25898, 0.89271, 0.1968], rightHand: [-0.13022, 0.86501, 0.18485], leftFoot: [0.19302, 0.07302, -0.01729], rightFoot: [-0.01675, 0.07151, -0.00538], headRoot: [-0.00208, 0.59493, 0.04176], chestRoot: [-0.00143, 0.1956, -0.01168], handSpan: 0.39036, stanceWidth: 0.21012, bboxVolume: 0.23844, bowCompression: 0.37731 },
    { frame: 11, time: 0.36667, phaseLabel: 'enter', root: [-0.01098, 1.00434, 0.02475], head: [-0.01026, 1.5948, 0.10844], chest: [-0.01625, 1.20062, 0.02231], leftHand: [0.10547, 1.09378, 0.33967], rightHand: [-0.08702, 1.06018, 0.33994], leftFoot: [0.18047, 0.0845, -0.02191], rightFoot: [-0.01711, 0.07246, -0.00815], headRoot: [0.00072, 0.59047, 0.08369], chestRoot: [-0.00527, 0.19628, -0.00244], handSpan: 0.1954, stanceWidth: 0.19842, bboxVolume: 0.46358, bowCompression: 0.33392 },
    { frame: 21, time: 0.7, phaseLabel: 'enter', root: [-0.04781, 0.99408, 0.00899], head: [-0.01666, 1.56703, 0.17141], chest: [-0.03665, 1.18921, 0.02941], leftHand: [0.09795, 1.24472, 0.34801], rightHand: [-0.03578, 1.22679, 0.36902], leftFoot: [-0.10403, 0.20655, -0.28233], rightFoot: [-0.02302, 0.07227, -0.01261], headRoot: [0.03115, 0.57295, 0.16242], chestRoot: [0.01116, 0.19513, 0.02042], handSpan: 0.13656, stanceWidth: 0.31201, bboxVolume: 0.73874, bowCompression: 0.28073 },
    { frame: 32, time: 1.06667, phaseLabel: 'enter', root: [-0.06703, 0.95155, -0.02737], head: [0.01725, 1.44277, 0.29308], chest: [-0.0216, 1.13067, 0.03967], leftHand: [0.13492, 1.10841, 0.36729], rightHand: [-0.01453, 1.0908, 0.38213], leftFoot: [-0.36848, 0.26551, -0.4714], rightFoot: [-0.02284, 0.06644, -0.01559], headRoot: [0.08428, 0.49122, 0.32046], chestRoot: [0.04543, 0.17912, 0.06704], handSpan: 0.15121, stanceWidth: 0.60569, bboxVolume: 1.10781, bowCompression: 0.24858 },
    { frame: 42, time: 1.4, phaseLabel: 'commit', root: [-0.07356, 0.93489, -0.0906], head: [0.00287, 1.24106, 0.37688], chest: [-0.01878, 1.08635, 0.0218], leftHand: [0.30314, 0.81598, 0.26362], rightHand: [-0.21362, 0.78329, 0.30495], leftFoot: [-0.45962, 0.22521, -0.47219], rightFoot: [-0.02498, 0.07004, -0.01764], headRoot: [0.07643, 0.30617, 0.46748], chestRoot: [0.05478, 0.15146, 0.1124], handSpan: 0.51945, stanceWidth: 0.64777, bboxVolume: 1.08681, bowCompression: 0.54827 },
    { frame: 53, time: 1.76667, phaseLabel: 'compress', root: [-0.0754, 0.91369, -0.14671], head: [-0.03654, 1.12342, 0.35939], chest: [-0.03011, 1.04681, -0.00999], leftHand: [0.608, 0.92047, 0.0422], rightHand: [-0.65701, 0.85853, 0.11687], leftFoot: [-0.46615, 0.19243, -0.49345], rightFoot: [-0.01991, 0.06905, -0.02432], headRoot: [0.03886, 0.20973, 0.5061], chestRoot: [0.04529, 0.13312, 0.13671], handSpan: 1.26872, stanceWidth: 0.65912, bboxVolume: 1.81676, bowCompression: 0.56004 },
    { frame: 63, time: 2.1, phaseLabel: 'compress', root: [-0.08924, 0.91555, -0.1557], head: [-0.04524, 1.146, 0.3294], chest: [-0.04262, 1.05883, -0.03016], leftHand: [0.64838, 1.14952, -0.00036], rightHand: [-0.72876, 1.06088, 0.07377], leftFoot: [-0.4685, 0.18957, -0.48632], rightFoot: [-0.02655, 0.06569, -0.02663], headRoot: [0.04401, 0.23045, 0.4851], chestRoot: [0.04662, 0.14327, 0.12553], handSpan: 1.38198, stanceWidth: 0.6496, bboxVolume: 2.01814, bowCompression: 0.62826 },
    { frame: 74, time: 2.46667, phaseLabel: 'compress', root: [-0.08423, 0.94143, -0.11803], head: [-0.05361, 1.26143, 0.31308], chest: [-0.0478, 1.10846, -0.02137], leftHand: [0.65826, 1.27511, 0.01303], rightHand: [-0.74413, 1.15582, 0.15971], leftFoot: [-0.41898, 0.2187, -0.46013], rightFoot: [-0.03343, 0.06284, -0.02977], headRoot: [0.03062, 0.31999, 0.43112], chestRoot: [0.03643, 0.16703, 0.09666], handSpan: 1.41508, stanceWidth: 0.59845, bboxVolume: 2.12827, bowCompression: 0.61813 },
    { frame: 84, time: 2.8, phaseLabel: 'release', root: [-0.06796, 0.96781, -0.0675], head: [-0.05376, 1.42777, 0.24548], chest: [-0.05678, 1.15764, -0.01728], leftHand: [0.64633, 1.41495, 0.0377], rightHand: [-0.75651, 1.34625, 0.16409], leftFoot: [-0.21463, 0.17889, -0.34886], rightFoot: [-0.02887, 0.06076, -0.02797], headRoot: [0.0142, 0.45996, 0.31298], chestRoot: [0.01118, 0.18984, 0.05022], handSpan: 1.4102, stanceWidth: 0.38915, bboxVolume: 1.90065, bowCompression: 0.46785 },
    { frame: 95, time: 3.16667, phaseLabel: 'carry', root: [-0.01656, 0.99139, -0.0255], head: [-0.04163, 1.5577, 0.11412], chest: [-0.02408, 1.18778, -0.01894], leftHand: [0.6512, 1.35589, 0.03055], rightHand: [-0.70603, 1.22838, 0.0748], leftFoot: [0.07412, 0.0921, -0.15514], rightFoot: [-0.0189, 0.06242, -0.02689], headRoot: [-0.02506, 0.56631, 0.13962], chestRoot: [-0.00752, 0.19639, 0.00656], handSpan: 1.36392, stanceWidth: 0.16119, bboxVolume: 1.01196, bowCompression: 0.35764 },
    { frame: 105, time: 3.5, phaseLabel: 'carry', root: [0.04028, 1.00093, -0.01749], head: [0.0161, 1.59221, 0.01105], chest: [0.03349, 1.19627, -0.0356], leftHand: [0.50102, 0.97045, 0.0376], rightHand: [-0.3565, 0.89756, 0.07808], leftFoot: [0.16165, 0.06846, -0.06102], rightFoot: [-0.01399, 0.06453, -0.03266], headRoot: [-0.02419, 0.59128, 0.02854], chestRoot: [-0.00679, 0.19534, -0.0181], handSpan: 0.86156, stanceWidth: 0.17795, bboxVolume: 0.40028, bowCompression: 0.38672 },
    { frame: 116, time: 3.86667, phaseLabel: 'carry', root: [0.05132, 0.99969, -0.02763], head: [0.05396, 1.59481, -0.04437], chest: [0.04948, 1.19348, -0.05708], leftHand: [0.22439, 0.91595, 0.14918], rightHand: [-0.07123, 0.91996, 0.16066], leftFoot: [0.16238, 0.06536, -0.06295], rightFoot: [-0.01543, 0.06249, -0.03857], headRoot: [0.00265, 0.59512, -0.01674], chestRoot: [-0.00183, 0.1938, -0.02944], handSpan: 0.29586, stanceWidth: 0.17949, bboxVolume: 0.30829, bowCompression: 0.37454 },
    { frame: 126, time: 4.2, phaseLabel: 'carry', root: [0.04756, 1.00008, -0.03199], head: [0.05476, 1.59579, -0.05062], chest: [0.0461, 1.19372, -0.06242], leftHand: [0.2465, 0.88274, 0.12063], rightHand: [-0.10491, 0.89689, 0.1526], leftFoot: [0.16097, 0.06569, -0.06444], rightFoot: [-0.01752, 0.06314, -0.03986], headRoot: [0.00719, 0.59571, -0.01863], chestRoot: [-0.00147, 0.19365, -0.03043], handSpan: 0.35314, stanceWidth: 0.18019, bboxVolume: 0.30049, bowCompression: 0.3689 },
    { frame: 137, time: 4.56667, phaseLabel: 'carry', root: [0.04349, 1.00077, -0.0325], head: [0.05298, 1.59586, -0.04014], chest: [0.04198, 1.19449, -0.0623], leftHand: [0.29383, 0.85995, 0.04188], rightHand: [-0.17462, 0.84763, 0.0384], leftFoot: [0.16069, 0.06627, -0.06537], rightFoot: [-0.01854, 0.06395, -0.04122], headRoot: [0.00949, 0.59509, -0.00763], chestRoot: [-0.00151, 0.19373, -0.0298], handSpan: 0.46862, stanceWidth: 0.18086, bboxVolume: 0.20051, bowCompression: 0.39696 },
    { frame: 147, time: 4.9, phaseLabel: 'recover', root: [0.04366, 1.00168, -0.03343], head: [0.05381, 1.59657, -0.02811], chest: [0.04298, 1.19598, -0.05971], leftHand: [0.28304, 0.87034, 0.07569], rightHand: [-0.16683, 0.856, 0.07133], leftFoot: [0.16152, 0.06666, -0.06381], rightFoot: [-0.01863, 0.06443, -0.03955], headRoot: [0.01016, 0.59489, 0.00531], chestRoot: [-0.00068, 0.1943, -0.02628], handSpan: 0.45012, stanceWidth: 0.18179, bboxVolume: 0.1902, bowCompression: 0.40123 },
    { frame: 158, time: 5.26667, phaseLabel: 'recover', root: [0.04339, 1.00104, -0.02484], head: [0.05614, 1.59596, -0.01664], chest: [0.04303, 1.19547, -0.05009], leftHand: [0.27718, 0.8662, 0.08875], rightHand: [-0.15054, 0.8595, 0.09077], leftFoot: [0.16056, 0.06644, -0.06279], rightFoot: [-0.01903, 0.0638, -0.03872], headRoot: [0.01275, 0.59492, 0.0082], chestRoot: [-0.00036, 0.19443, -0.02524], handSpan: 0.42778, stanceWidth: 0.18122, bboxVolume: 0.19483, bowCompression: 0.3991 },
    { frame: 168, time: 5.6, phaseLabel: 'recover', root: [0.04644, 1.00123, -0.0189], head: [0.05872, 1.59622, -0.01174], chest: [0.04643, 1.19563, -0.04448], leftHand: [0.29355, 0.86774, 0.0942], rightHand: [-0.17035, 0.85743, 0.08514], leftFoot: [0.1598, 0.06702, -0.06283], rightFoot: [-0.01929, 0.06426, -0.03837], headRoot: [0.01229, 0.59499, 0.00717], chestRoot: [0, 0.1944, -0.02557], handSpan: 0.4641, stanceWidth: 0.18077, bboxVolume: 0.19095, bowCompression: 0.39942 },
    { frame: 179, time: 5.96667, phaseLabel: 'recover', root: [0.05097, 1.00143, -0.01436], head: [0.0603, 1.59681, -0.00067], chest: [0.05157, 1.19611, -0.03766], leftHand: [0.28218, 0.86473, 0.09808], rightHand: [-0.14487, 0.85592, 0.08905], leftFoot: [0.15897, 0.06686, -0.06057], rightFoot: [-0.01864, 0.06421, -0.03534], headRoot: [0.00933, 0.59538, 0.01368], chestRoot: [0.0006, 0.19468, -0.02331], handSpan: 0.42724, stanceWidth: 0.17941, bboxVolume: 0.18835, bowCompression: 0.39523 },
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

function normalizeGeneratedPoseTemporalInput(generatedInput = DEFAULT_KIMODO_BOW_TEMPORAL_POSE_FIXTURE) {
  if (generatedInput?.schema !== 'kaminos.generated-pose-temporal.v0') {
    throw new Error(`Expected kaminos.generated-pose-temporal.v0, got ${generatedInput?.schema || 'missing schema'}`);
  }
  const samples = Array.isArray(generatedInput.temporalSamples) ? generatedInput.temporalSamples : [];
  if (samples.length < 2) throw new Error(`Generated pose temporal input ${generatedInput.id || 'unknown'} needs at least two temporal samples`);
  return {
    ...generatedInput,
    temporalSamples: samples.map((sample, index) => ({
      frame: Math.round(Number(sample.frame) || index),
      time: Number.isFinite(Number(sample.time)) ? Number(sample.time) : index / Math.max(1, Number(generatedInput.fps) || 30),
      phaseLabel: String(sample.phaseLabel || 'carry'),
      root: vec3(sample.root),
      head: vec3(sample.head),
      chest: vec3(sample.chest),
      leftHand: vec3(sample.leftHand),
      rightHand: vec3(sample.rightHand),
      leftFoot: vec3(sample.leftFoot),
      rightFoot: vec3(sample.rightFoot),
      headRoot: vec3(sample.headRoot),
      chestRoot: vec3(sample.chestRoot),
      handSpan: Number.isFinite(Number(sample.handSpan)) ? Number(sample.handSpan) : 0,
      stanceWidth: Number.isFinite(Number(sample.stanceWidth)) ? Number(sample.stanceWidth) : 0,
      bboxVolume: Number.isFinite(Number(sample.bboxVolume)) ? Number(sample.bboxVolume) : 0,
      bowCompression: clamp(Number(sample.bowCompression) || 0, 0, 1),
    })).sort((a, b) => a.time - b.time),
  };
}

function temporalFixtureMetrics(generatedInput) {
  const input = normalizeGeneratedPoseTemporalInput(generatedInput);
  const phaseLabels = [...new Set(input.temporalSamples.map(sample => sample.phaseLabel))];
  const handSpanValues = input.temporalSamples.map(sample => sample.handSpan);
  const bowValues = input.temporalSamples.map(sample => sample.bowCompression);
  return {
    sampleCount: input.temporalSamples.length,
    sourceFrameStride: Number(input.sourceFrameStride || 1),
    phaseLabels,
    maxBowCompression: Number(Math.max(...bowValues).toFixed(5)),
    meanBowCompression: Number((bowValues.reduce((sum, value) => sum + value, 0) / Math.max(1, bowValues.length)).toFixed(5)),
    handSpanRange: Number((Math.max(...handSpanValues) - Math.min(...handSpanValues)).toFixed(5)),
  };
}

function motionServerPhaseLabel(frameIndex, frameCount, sample) {
  const p = frameCount <= 1 ? 0 : frameIndex / (frameCount - 1);
  if (sample?.bowCompression > 0.62) return 'compress';
  if (p < 0.18) return 'enter';
  if (p < 0.36) return 'notice';
  if (p < 0.72) return 'commit';
  if (p < 0.9) return 'recover';
  return 'return';
}

function motionServerRootForFrame(result, frameIndex, frame) {
  const root = Array.isArray(result?.root_positions?.[frameIndex])
    ? result.root_positions[frameIndex]
    : frame?.[SOMA77_TEMPORAL_JOINT.Hips];
  return vec3(root);
}

function motionServerJoint(frame, jointName, fallbackRoot) {
  return vec3(frame?.[SOMA77_TEMPORAL_JOINT[jointName]], fallbackRoot);
}

export function adaptMotionServerResultToGeneratedPoseTemporalClip(result = DEFAULT_MOTION_SERVER_RESULT_FIXTURE, options = {}) {
  const joints = Array.isArray(result?.joints) ? result.joints : [];
  if (joints.length < 2) throw new Error('Motion server result needs at least two joint frames');
  const jointCount = Array.isArray(joints[0]) ? joints[0].length : 0;
  if (jointCount < 77) throw new Error(`Motion server result needs SOMA77 joints; got ${jointCount}`);
  const fps = Math.max(1, Math.round(Number(result.fps || options.fps || 30)));
  const duration = Number.isFinite(Number(result.duration))
    ? Number(result.duration)
    : (joints.length - 1) / fps;
  const id = String(options.id || result.id || `motion_panel_${String(result.prompt || 'generated').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 48) || 'clip'}_temporal_v0`);
  const label = String(options.label || result.label || result.prompt || 'Motion Panel Generated Clip');
  const sourceRoute = String(options.sourceRoute || result.sourceRoute || 'motion-server:unknown/generate');
  const sourceModel = String(options.sourceModel || result.model || 'kimodo');
  const rawSamples = joints.map((frame, frameIndex) => {
    const root = motionServerRootForFrame(result, frameIndex, frame);
    const head = motionServerJoint(frame, 'Head', root);
    const chest = motionServerJoint(frame, 'Chest', root);
    const leftHand = motionServerJoint(frame, 'LeftHand', root);
    const rightHand = motionServerJoint(frame, 'RightHand', root);
    const leftFoot = motionServerJoint(frame, 'LeftFoot', root);
    const rightFoot = motionServerJoint(frame, 'RightFoot', root);
    const xs = [];
    const ys = [];
    const zs = [];
    for (const joint of frame) {
      const point = vec3(joint, root);
      xs.push(point[0]);
      ys.push(point[1]);
      zs.push(point[2]);
    }
    const extent = [
      Math.max(...xs) - Math.min(...xs),
      Math.max(...ys) - Math.min(...ys),
      Math.max(...zs) - Math.min(...zs),
    ];
    const headRoot = subVec3(head, root);
    return {
      frame: frameIndex,
      sourceFrame: frameIndex,
      time: Number((frameIndex / fps).toFixed(5)),
      root,
      head,
      chest,
      leftHand,
      rightHand,
      leftFoot,
      rightFoot,
      headRoot,
      chestRoot: subVec3(chest, root),
      handSpan: lengthVec3(subVec3(rightHand, leftHand)),
      stanceWidth: lengthVec3(subVec3(rightFoot, leftFoot)),
      bboxVolume: Math.max(0, extent[0] * extent[1] * extent[2]),
    };
  });
  const headRootYValues = rawSamples.map(sample => sample.headRoot[1]);
  const maxHeadRootY = Math.max(...headRootYValues);
  const minHeadRootY = Math.min(...headRootYValues);
  const headRootRange = Math.max(1e-6, maxHeadRootY - minHeadRootY);
  const temporalSamples = rawSamples.map(sample => {
    const bowCompression = clamp((maxHeadRootY - sample.headRoot[1]) / headRootRange, 0, 1);
    const rounded = {
      ...sample,
      phaseLabel: motionServerPhaseLabel(sample.frame, rawSamples.length, { bowCompression }),
      root: sample.root.map(value => Number(value.toFixed(5))),
      head: sample.head.map(value => Number(value.toFixed(5))),
      chest: sample.chest.map(value => Number(value.toFixed(5))),
      leftHand: sample.leftHand.map(value => Number(value.toFixed(5))),
      rightHand: sample.rightHand.map(value => Number(value.toFixed(5))),
      leftFoot: sample.leftFoot.map(value => Number(value.toFixed(5))),
      rightFoot: sample.rightFoot.map(value => Number(value.toFixed(5))),
      headRoot: sample.headRoot.map(value => Number(value.toFixed(5))),
      chestRoot: sample.chestRoot.map(value => Number(value.toFixed(5))),
      handSpan: Number(sample.handSpan.toFixed(5)),
      stanceWidth: Number(sample.stanceWidth.toFixed(5)),
      bboxVolume: Number(sample.bboxVolume.toFixed(5)),
      bowCompression: Number(bowCompression.toFixed(5)),
    };
    return rounded;
  });
  return {
    schema: 'kaminos.generated-pose-temporal.v0',
    id,
    label,
    intent: String(result.prompt || label),
    sourceKind: 'motion-panel-generated-pose-temporal',
    sourceStatus: 'live-generated',
    sourceModel,
    sourceFormat: MOTION_SERVER_TEMPORAL_SOURCE_FORMAT,
    sourceRoute,
    registrySource: 'motion-panel-memory',
    inputSha256: options.inputSha256 || null,
    rawFrameCount: Number(result.num_frames || joints.length),
    fps,
    duration,
    sourceFrameStride: 1,
    jointMapping: { ...SOMA77_TEMPORAL_JOINT },
    extractionAssumptions: [
      'input is motion server JSON shaped frames x SOMA77 joints x xyz',
      'all source frames are preserved for live panel preview; no temporal cap is applied',
      'root_positions drive root when present, otherwise SOMA77 Hips is used',
      'head/chest/hand/foot channels drive orb attention, effort, envelope, and behavior evidence',
    ],
    generatedFrom: {
      schema: 'kaminos.motion-server-result.v0',
      prompt: result.prompt || null,
      model: result.model || null,
      skeletonType: result.skeleton_type || null,
      genTime: Number.isFinite(Number(result.gen_time)) ? Number(result.gen_time) : null,
      sourceRoute,
    },
    temporalSamples,
  };
}

export function normalizeGeneratedPoseTemporalRegistry(registryInput = {}) {
  if (registryInput?.schema !== 'kaminos.generated-pose-temporal-registry.v0') {
    throw new Error(`Expected kaminos.generated-pose-temporal-registry.v0, got ${registryInput?.schema || 'missing schema'}`);
  }
  const registrySource = String(registryInput.registrySource || DEFAULT_GENERATED_POSE_TEMPORAL_REGISTRY_URL);
  const clips = (Array.isArray(registryInput.clips) ? registryInput.clips : [])
    .map(clip => normalizeGeneratedPoseTemporalInput({
      ...clip,
      sourceModel: clip.sourceModel || registryInput.sourceModel || 'unknown',
      sourceFormat: clip.sourceFormat || registryInput.sourceFormat || 'unknown',
      registrySource: clip.registrySource || registrySource,
    }));
  if (clips.length < 1) throw new Error(`Generated pose temporal registry ${registryInput.id || 'unknown'} needs at least one clip`);
  const seen = new Set();
  for (const clip of clips) {
    if (seen.has(clip.id)) throw new Error(`Generated pose temporal registry has duplicate clip id: ${clip.id}`);
    seen.add(clip.id);
  }
  return {
    schema: 'kaminos.generated-pose-temporal-registry.v0',
    id: String(registryInput.id || 'generated_pose_temporal_registry'),
    label: registryInput.label || registryInput.id || 'Generated Pose Temporal Registry',
    sourceModel: registryInput.sourceModel || 'unknown',
    sourceFormat: registryInput.sourceFormat || 'unknown',
    registrySource,
    generatedFrom: registryInput.generatedFrom || null,
    clipCount: clips.length,
    clips,
  };
}

export function generatedPoseTemporalClipById(id, registryInput) {
  const registry = normalizeGeneratedPoseTemporalRegistry(registryInput);
  const requestedId = String(id || registry.clips[0]?.id || '').trim();
  const clip = registry.clips.find(candidate => candidate.id === requestedId);
  if (!clip) throw new Error(`Unknown generated pose temporal clip id: ${requestedId}`);
  return {
    ...clip,
    registrySource: clip.registrySource || registry.registrySource,
  };
}

export function interpolateGeneratedPoseTemporalSample(trackOrInput = DEFAULT_KIMODO_BOW_TEMPORAL_POSE_FIXTURE, t = 0) {
  const input = trackOrInput?.temporalSamples
    ? { temporalSamples: trackOrInput.temporalSamples, duration: trackOrInput.duration }
    : normalizeGeneratedPoseTemporalInput(trackOrInput);
  const samples = input.temporalSamples || [];
  if (!samples.length) return null;
  const duration = Math.max(0, Number(input.duration) || samples.at(-1).time || 0);
  const time = clamp(Number.isFinite(Number(t)) ? Number(t) : 0, 0, duration || samples.at(-1).time || 0);
  const first = samples[0];
  const last = samples.at(-1);
  const afterIndex = time <= first.time
    ? 1
    : samples.findIndex(sample => sample.time >= time);
  const toIndex = afterIndex < 0 ? samples.length - 1 : Math.max(1, afterIndex);
  const fromIndex = Math.max(0, toIndex - 1);
  const before = samples[fromIndex] || first;
  const after = samples[toIndex] || last;
  const previous = samples[Math.max(0, fromIndex - 1)] || before;
  const next = samples[Math.min(samples.length - 1, toIndex + 1)] || after;
  const span = Math.max(1e-6, after.time - before.time);
  const rawU = before === after ? 0 : clamp((time - before.time) / span, 0, 1);
  const u = rawU;
  const hermite = (p0, p1, p2, p3) => {
    const t0 = Number(previous.time) || 0;
    const t1 = Number(before.time) || 0;
    const t2 = Number(after.time) || t1 + span;
    const t3 = Number(next.time) || t2 + span;
    const m1 = (Number(p2) - Number(p0)) / Math.max(1e-6, t2 - t0);
    const m2 = (Number(p3) - Number(p1)) / Math.max(1e-6, t3 - t1);
    const u2 = u * u;
    const u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * Number(p1)
      + (u3 - 2 * u2 + u) * span * m1
      + (-2 * u3 + 3 * u2) * Number(p2)
      + (u3 - u2) * span * m2;
  };
  const mixNumber = key => {
    const values = [previous, before, after, next].map(sample => Number(sample[key]) || 0);
    const interpolated = hermite(values[0], values[1], values[2], values[3]);
    const minValue = Math.min(values[1], values[2]);
    const maxValue = Math.max(values[1], values[2]);
    const bounded = clamp(interpolated, minValue, maxValue);
    return Number(bounded.toFixed(5));
  };
  const mixVector = key => [0, 1, 2].map(index => {
    const values = [previous, before, after, next].map(sample => vec3(sample[key])[index]);
    return Number(hermite(values[0], values[1], values[2], values[3]).toFixed(5));
  });
  return {
    schema: 'kaminos.generated-pose-temporal-sample.v0',
    sampler: 'catmull-rom-continuous-velocity',
    time: Number(time.toFixed(5)),
    sourceFrame: Number(lerp(Number(before.frame) || 0, Number(after.frame) || 0, rawU).toFixed(5)),
    sourceTime: Number(lerp(Number(before.time) || 0, Number(after.time) || 0, rawU).toFixed(5)),
    phaseLabel: rawU < 0.5 ? before.phaseLabel : after.phaseLabel,
    interpolation: Number(u.toFixed(5)),
    rawInterpolation: Number(rawU.toFixed(5)),
    bracket: {
      fromFrame: before.frame,
      toFrame: after.frame,
      fromTime: before.time,
      toTime: after.time,
      fromPhaseLabel: before.phaseLabel,
      toPhaseLabel: after.phaseLabel,
    },
    root: mixVector('root'),
    head: mixVector('head'),
    chest: mixVector('chest'),
    leftHand: mixVector('leftHand'),
    rightHand: mixVector('rightHand'),
    leftFoot: mixVector('leftFoot'),
    rightFoot: mixVector('rightFoot'),
    headRoot: mixVector('headRoot'),
    chestRoot: mixVector('chestRoot'),
    handSpan: mixNumber('handSpan'),
    stanceWidth: mixNumber('stanceWidth'),
    bboxVolume: mixNumber('bboxVolume'),
    bowCompression: clamp(mixNumber('bowCompression'), 0, 1),
  };
}

export function sampleGeneratedPoseTemporalMotion(trackOrInput = DEFAULT_KIMODO_BOW_TEMPORAL_POSE_FIXTURE, t = 0) {
  const track = trackOrInput?.schema === MOTION_TRACK_SCHEMA
    ? trackOrInput
    : adaptGeneratedPoseTemporalToTrack(trackOrInput);
  const temporalSample = interpolateGeneratedPoseTemporalSample(track, t);
  const firstRoot = vec3(track.temporalSamples?.[0]?.root);
  const normalizeWorld = value => {
    const source = vec3(value);
    return [
      Number((source[0] - firstRoot[0]).toFixed(5)),
      Number((source[1] - firstRoot[1]).toFixed(5)),
      Number((source[2] - firstRoot[2]).toFixed(5)),
    ];
  };
  const root = normalizeWorld(temporalSample.root);
  const head = normalizeWorld(temporalSample.head);
  const facing = normalizeVec3(subVec3(head, root), track.forwardAxis || [0, 0, 1]);
  const maxHandSpan = Math.max(...track.temporalSamples.map(sample => Number(sample.handSpan) || 0), 1e-6);
  const effort = clamp(0.18 + temporalSample.bowCompression * 0.78 + (temporalSample.handSpan / maxHandSpan) * 0.22, 0, 1);
  const headRootSeparation = lengthVec3(subVec3(head, root));
  const attentionMassContrast = Math.max(0, headRootSeparation - 0.49518);
  return {
    schema: 'kaminos.generated-pose-temporal-motion-sample.v0',
    sampler: temporalSample.sampler,
    trackId: track.id,
    sourceKind: track.sourceKind,
    mode: 'generated-pose-temporal',
    attentionMode: 'generated-pose-temporal',
    t: temporalSample.time,
    phase: temporalSample.phaseLabel,
    root: root.map(value => Number(value.toFixed(5))),
    head: head.map(value => Number(value.toFixed(5))),
    attention: head.map(value => Number(value.toFixed(5))),
    facing: facing.map(value => Number(value.toFixed(5))),
    scale: Number((1 + effort * 0.012).toFixed(5)),
    effort: Number(effort.toFixed(5)),
    headRootSeparation: Number(headRootSeparation.toFixed(5)),
    attentionMassContrast: Number(attentionMassContrast.toFixed(5)),
    temporalSample,
  };
}

function generatedTemporalBehaviorLabel(track, sample, temporalSample) {
  const phase = String(sample?.phase || temporalSample?.phaseLabel || 'carry');
  const intent = String(track?.intent || track?.label || '').toLowerCase();
  if (intent.includes('cautious') || intent.includes('sneak')) return phase === 'enter' || phase === 'notice' || phase === 'anticipate' ? 'hesitating' : 'approaching';
  if (intent.includes('startled') || intent.includes('fright') || intent.includes('jumpback')) return 'avoiding-collision';
  if (phase === 'enter') return intent.includes('curious') || intent.includes('look') ? 'noticed-target' : 'approaching';
  if (phase === 'notice' || phase === 'anticipate') return 'hesitating';
  if (phase === 'commit') return 'approaching';
  if (phase === 'recover') return 'returning-to-anchor';
  if (phase === 'compress' || phase === 'release') return 'performing-flourish';
  if (intent.includes('dance') || intent.includes('bow') || intent.includes('kick') || intent.includes('punch')) return 'performing-flourish';
  return 'wandering';
}

export function buildGeneratedPoseTemporalBehaviorState({
  track,
  sample,
  temporalSample = sample?.temporalSample || null,
  target = null,
  anchor = null,
} = {}) {
  if (!track?.id) throw new Error('Generated pose temporal behavior state requires a track');
  if (!sample?.schema) throw new Error('Generated pose temporal behavior state requires a motion sample');
  const phase = String(sample.phase || temporalSample?.phaseLabel || 'carry');
  const state = generatedTemporalBehaviorLabel(track, sample, temporalSample);
  const evidence = {
    phase,
    sourceFrame: Number.isFinite(Number(temporalSample?.sourceFrame)) ? Number(temporalSample.sourceFrame) : null,
    sourceTime: Number.isFinite(Number(temporalSample?.time)) ? Number(temporalSample.time) : null,
    sourceBracket: temporalSample?.bracket || null,
    sourceInterpolation: Number.isFinite(Number(temporalSample?.interpolation)) ? Number(temporalSample.interpolation) : null,
    sampler: temporalSample?.sampler || sample.sampler || null,
    effort: Number.isFinite(Number(sample.effort)) ? Number(sample.effort.toFixed(5)) : 0,
    bowCompression: Number.isFinite(Number(temporalSample?.bowCompression)) ? Number(temporalSample.bowCompression.toFixed(5)) : 0,
    headRootSeparation: Number.isFinite(Number(sample.headRootSeparation)) ? Number(sample.headRootSeparation.toFixed(5)) : null,
    attentionMassContrast: Number.isFinite(Number(sample.attentionMassContrast)) ? Number(sample.attentionMassContrast.toFixed(5)) : null,
  };
  return {
    schema: GENERATED_MOTION_BEHAVIOR_STATE_SCHEMA,
    state,
    phase,
    visibility: 'inspectable-not-canvas-label',
    clipId: track.registryClipId || track.id,
    trackId: track.id,
    label: track.label || track.id,
    intent: track.intent || 'generated-pose-temporal',
    sourceKind: track.sourceKind || 'generated-pose-temporal',
    sourceStatus: track.sourceStatus || 'fixture',
    sourceModel: track.sourceModel || 'unknown',
    sourceRoute: track.sourceRoute || 'unknown',
    target: target ? {
      id: String(target.id || 'target'),
      kind: String(target.kind || 'attention-target'),
    } : null,
    anchor: anchor ? {
      id: String(anchor.id || 'anchor'),
      kind: String(anchor.kind || 'home-anchor'),
    } : null,
    reason: `${state} because phase ${phase} is active at source frame ${evidence.sourceFrame ?? 'unknown'} with effort ${evidence.effort}`,
    evidence,
  };
}

export function adaptGeneratedPoseTemporalToTrack(generatedInput = DEFAULT_KIMODO_BOW_TEMPORAL_POSE_FIXTURE) {
  const input = normalizeGeneratedPoseTemporalInput(generatedInput);
  const id = String(input.id || '').trim();
  if (!id) throw new Error('Generated pose temporal id is required');
  const fps = Math.max(1, Math.round(Number(input.fps) || 30));
  const duration = Number.isFinite(Number(input.duration))
    ? Number(input.duration)
    : input.temporalSamples.at(-1).time;
  const firstRoot = input.temporalSamples[0].root;
  const maxHandSpan = Math.max(...input.temporalSamples.map(sample => sample.handSpan), 1e-6);
  const normalizeWorld = value => {
    const source = vec3(value);
    return [
      Number((source[0] - firstRoot[0]).toFixed(5)),
      Number((source[1] - firstRoot[1]).toFixed(5)),
      Number((source[2] - firstRoot[2]).toFixed(5)),
    ];
  };
  const track = normalizeMotionTrack({
    schema: MOTION_TRACK_SCHEMA,
    id,
    label: input.label || id,
    intent: input.intent || 'generated-pose-temporal',
    sourceKind: input.sourceKind || 'generated-pose-temporal',
    sourceStatus: input.sourceStatus || 'fixture',
    sourceModel: input.sourceModel || 'unknown',
    sourceRoute: input.sourceRoute || 'unknown',
    prompt: input.intent || null,
    rawFrameCount: input.rawFrameCount || input.temporalSamples.length,
    jointMapping: input.jointMapping || null,
    extractionAssumptions: input.extractionAssumptions || [],
    fps,
    duration,
    units: 'meters',
    upAxis: [0, 1, 0],
    forwardAxis: [0, 0, 1],
    tracks: {
      root: input.temporalSamples.map(sample => ({ t: sample.time, value: normalizeWorld(sample.root) })),
      head: input.temporalSamples.map(sample => ({ t: sample.time, value: normalizeWorld(sample.head) })),
      effort: input.temporalSamples.map(sample => ({
        t: sample.time,
        value: Number((0.18 + sample.bowCompression * 0.78 + (sample.handSpan / maxHandSpan) * 0.22).toFixed(5)),
      })),
      phase: input.temporalSamples.map(sample => ({ t: sample.time, value: sample.phaseLabel })),
    },
  });
  return {
    ...track,
    sourceFormat: input.sourceFormat || 'unknown',
    inputSha256: input.inputSha256 || null,
    registryClipId: input.id,
    registrySource: input.registrySource || null,
    sourceFrameStride: input.sourceFrameStride || 1,
    temporalSamples: input.temporalSamples,
    temporalMetrics: temporalFixtureMetrics(input),
  };
}

export function buildGeneratedPoseTemporalHarness({
  generatedInput = DEFAULT_KIMODO_BOW_TEMPORAL_POSE_FIXTURE,
  duration,
  fps = 12,
  filmstripFrames = 7,
} = {}) {
  const track = adaptGeneratedPoseTemporalToTrack(generatedInput);
  const simDuration = Math.max(0.1, Number.isFinite(Number(duration)) ? Number(duration) : track.duration);
  const simFps = Math.max(1, Math.round(Number(fps) || 12));
  const simulation = simulateMotionTrack(track, { duration: simDuration, fps: simFps, mode: 'mass-attention' });
  const count = Math.max(1, Math.min(Math.round(Number(filmstripFrames) || 7), simulation.frames.length));
  const frameIndexes = Array.from({ length: count }, (_, i) => (
    count === 1 ? 0 : Math.round(i * (simulation.frames.length - 1) / (count - 1))
  ));
  const actor = {
    id: track.id,
    label: track.label,
    color: '#f0b184',
    intent: track.intent,
  };
  return {
    schema: 'kaminos.generated-pose-temporal-harness.v0',
    route: MOTION_ROUTE_IDENTITY,
    sourceStatus: track.sourceStatus,
    sourceKind: track.sourceKind,
    sourceModel: track.sourceModel,
    sourceRoute: track.sourceRoute,
    sourceFormat: track.sourceFormat,
    inputSha256: track.inputSha256,
    registryClipId: track.registryClipId || track.id,
    registrySource: track.registrySource || null,
    sourceFrameStride: track.sourceFrameStride,
    sampleCount: track.temporalSamples.length,
    track,
    fps: simFps,
    duration: simDuration,
    metrics: {
      ...simulation.metrics,
      ...track.temporalMetrics,
    },
    simulation,
    filmstrip: frameIndexes.map(index => ({
      frameIndex: index,
      t: simulation.frames[index].t,
      actors: [motionTrackActorSample(actor, simulation.frames[index].sample, [0, 0, 0])],
    })),
  };
}

function outputValue(outputs, key, fallback = 0) {
  const value = Number(outputs?.[key]?.value);
  return Number.isFinite(value) ? clamp(value, 0, 1) : fallback;
}

function normalizeGeneratedPoseOutputMap(outputMap = DEFAULT_GENERATED_POSE_OUTPUT_MAP_FIXTURE) {
  if (outputMap?.schema !== GENERATED_POSE_OUTPUT_MAP_SCHEMA) {
    throw new Error(`Expected ${GENERATED_POSE_OUTPUT_MAP_SCHEMA}, got ${outputMap?.schema || 'missing schema'}`);
  }
  if (outputMap.ok !== true) throw new Error(`Generated pose output map is not ok: ${outputMap?.error || 'unknown mapping failure'}`);
  const normalizedOutputs = outputMap.normalizedOutputs || {};
  const entries = Object.entries(normalizedOutputs)
    .filter(([, record]) => Number.isFinite(Number(record?.value)))
    .sort((a, b) => Number(b[1].value) - Number(a[1].value));
  return {
    ...outputMap,
    inputSockets: Array.isArray(outputMap.inputSockets) ? outputMap.inputSockets : [],
    outputSockets: Array.isArray(outputMap.outputSockets) ? outputMap.outputSockets : [],
    mappingEdges: Array.isArray(outputMap.mappingEdges) ? outputMap.mappingEdges : [],
    normalizedOutputs,
    summary: {
      ...(outputMap.summary || {}),
      strongestOutput: outputMap.summary?.strongestOutput || entries[0]?.[0] || null,
      outputCount: Array.isArray(outputMap.outputSockets) ? outputMap.outputSockets.length : 0,
      edgeCount: Array.isArray(outputMap.mappingEdges) ? outputMap.mappingEdges.length : 0,
    },
  };
}

function eventPulseAt(t, eventTime, width = 0.72) {
  const distance = Math.abs(t - eventTime);
  if (distance >= width) return 0;
  return pulse01(1 - distance / width);
}

function generatedPoseOutputActorSample(outputMap, t, duration) {
  const outputs = outputMap.normalizedOutputs;
  const rootOffset = outputValue(outputs, 'orb.rootOffset');
  const faceCueLead = outputValue(outputs, 'orb.faceCueLead');
  const bodyLean = outputValue(outputs, 'body.lean');
  const bodyScalePulse = outputValue(outputs, 'body.scalePulse');
  const auraRadius = outputValue(outputs, 'aura.radius');
  const trailAccent = outputValue(outputs, 'trail.accent');
  const footfallPulse = outputValue(outputs, 'footfall.pulse');
  const event = outputs?.['trail.accent']?.event || {};
  const eventTime = Number.isFinite(Number(event.time)) ? clamp(Number(event.time), 0, duration) : duration * 0.55;
  const eventPulse = eventPulseAt(t, eventTime);
  const travelPhase = Math.sin((t / Math.max(0.1, duration)) * Math.PI * 2);
  const footPulse = 0.35 + footfallPulse * (0.45 + 0.2 * Math.max(0, Math.sin(t * Math.PI * 3.2)));
  const scaleKick = bodyScalePulse * (0.22 + eventPulse * 0.18);
  const leanRadians = (bodyLean - 0.5) * 0.82 + eventPulse * 0.18;
  const root = [
    Number((rootOffset * 0.82 * travelPhase).toFixed(5)),
    Number((0.18 + footPulse * 0.07 + eventPulse * 0.04).toFixed(5)),
    Number((rootOffset * 1.35 * Math.cos(t * 1.18)).toFixed(5)),
  ];
  const facing = normalizeVec3([
    Number((0.2 + faceCueLead * 0.55 + bodyLean * 0.16).toFixed(5)),
    Number((0.05 + eventPulse * 0.08).toFixed(5)),
    1,
  ]);
  const attention = addVec3(root, scaleVec3(facing, 0.65 + faceCueLead * 0.52));
  const bodyScale = [
    Number((1 + scaleKick * 0.28 + eventPulse * 0.08).toFixed(5)),
    Number((1 + scaleKick * 0.64 + bodyLean * 0.12).toFixed(5)),
    Number((1 + scaleKick * 0.18 + auraRadius * 0.08).toFixed(5)),
  ];
  return {
    id: 'generated-output-map-orb',
    label: 'Mapped Output Orb',
    intent: 'socket-mapped-generated-motion-affordance',
    status: eventPulse > 0.45 ? 'accent-spike' : 'mapped-breath',
    color: '#f0b184',
    t: Number(t.toFixed(5)),
    root,
    localRoot: root,
    facing: facing.map(value => Number(value.toFixed(5))),
    attention: attention.map(value => Number(value.toFixed(5))),
    scale: Number(((bodyScale[0] + bodyScale[1] + bodyScale[2]) / 3).toFixed(5)),
    bodyScale,
    effort: Number(Math.max(bodyScalePulse, trailAccent * eventPulse, auraRadius * 0.8).toFixed(5)),
    bodyLean: Number(leanRadians.toFixed(5)),
    auraRadius: Number((0.48 + auraRadius * 0.94 + eventPulse * 0.08).toFixed(5)),
    trailAccent: Number((trailAccent * (0.32 + eventPulse * 0.68)).toFixed(5)),
    footfallPulse: Number(footPulse.toFixed(5)),
    faceCueLead,
    eventPulse: Number(eventPulse.toFixed(5)),
    event,
  };
}

function generatedPoseOutputMetrics(frames) {
  let maxAuraRadius = 0;
  let maxBodyScale = 0;
  let maxTrailAccent = 0;
  let maxFootfallPulse = 0;
  let maxEventPulse = 0;
  for (const frame of frames) {
    const actor = frame.actors[0];
    maxAuraRadius = Math.max(maxAuraRadius, actor.auraRadius);
    maxBodyScale = Math.max(maxBodyScale, ...actor.bodyScale);
    maxTrailAccent = Math.max(maxTrailAccent, actor.trailAccent);
    maxFootfallPulse = Math.max(maxFootfallPulse, actor.footfallPulse);
    maxEventPulse = Math.max(maxEventPulse, actor.eventPulse);
  }
  return {
    actorCount: 1,
    frameCount: frames.length,
    maxAuraRadius: Number(maxAuraRadius.toFixed(5)),
    maxBodyScale: Number(maxBodyScale.toFixed(5)),
    maxTrailAccent: Number(maxTrailAccent.toFixed(5)),
    maxFootfallPulse: Number(maxFootfallPulse.toFixed(5)),
    maxEventPulse: Number(maxEventPulse.toFixed(5)),
  };
}

export function buildGeneratedPoseOutputMapHarness({
  outputMap = DEFAULT_GENERATED_POSE_OUTPUT_MAP_FIXTURE,
  duration = 5.4,
  fps = 12,
  filmstripFrames = 7,
} = {}) {
  const normalizedMap = normalizeGeneratedPoseOutputMap(outputMap);
  const simDuration = Math.max(0.1, Number.isFinite(Number(duration)) ? Number(duration) : 5.4);
  const simFps = Math.max(1, Math.round(Number(fps) || 12));
  const frameCount = Math.floor(simDuration * simFps) + 1;
  const frames = [];
  for (let index = 0; index < frameCount; index++) {
    const t = Math.min(simDuration, index / simFps);
    frames.push({
      frameIndex: index,
      t: Number(t.toFixed(5)),
      actors: [generatedPoseOutputActorSample(normalizedMap, t, simDuration)],
    });
  }
  const count = Math.max(1, Math.min(Math.round(Number(filmstripFrames) || 7), frames.length));
  const frameIndexes = Array.from({ length: count }, (_, i) => (
    count === 1 ? 0 : Math.round(i * (frames.length - 1) / (count - 1))
  ));
  const entries = Object.entries(normalizedMap.normalizedOutputs)
    .filter(([, record]) => Number.isFinite(Number(record?.value)))
    .sort((a, b) => Number(b[1].value) - Number(a[1].value));
  return {
    schema: 'kaminos.generated-pose-output-map-harness.v0',
    route: MOTION_ROUTE_IDENTITY,
    sourceStatus: 'fixture',
    sourceKind: 'generated-pose-output-map',
    sourceRoute: normalizedMap.route || 'generated-pose-feature-output-map-v0',
    outputMap: normalizedMap,
    normalizedOutputs: normalizedMap.normalizedOutputs,
    inputSocketCount: normalizedMap.inputSockets.length,
    outputSocketCount: normalizedMap.outputSockets.length,
    edgeCount: normalizedMap.mappingEdges.length,
    strongestOutput: normalizedMap.summary.strongestOutput || entries[0]?.[0] || null,
    maxOutputValue: Number((entries[0]?.[1]?.value || 0).toFixed(5)),
    fps: simFps,
    duration: simDuration,
    frames,
    metrics: generatedPoseOutputMetrics(frames),
    filmstrip: frameIndexes.map(index => frames[index]),
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
