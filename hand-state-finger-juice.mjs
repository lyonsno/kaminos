import { normalizeWorldFingerJuiceEmitterPacket } from './lerms-finger-juice-core.js';

export const MANO_DISPLAY_ORIENTATION_CONTRACT = 'mano-camera-display-x-preserved-y-inverted-v1';
export const LIVE_FINGER_JUICE_ADAPTER_CONTRACT = 'hand-state-distal-axis-full-extension-emitters-v0';
export const FULL_EXTENSION_THRESHOLD = 0.86;

const FINGERS = Object.freeze([
  { id: 'thumb', joints: [1, 2, 3, 4], chemistry: 'splash' },
  { id: 'index', joints: [5, 6, 7, 8], chemistry: 'knockback' },
  { id: 'middle', joints: [9, 10, 11, 12], chemistry: 'pooling' },
  { id: 'ring', joints: [13, 14, 15, 16], chemistry: 'weird' },
  { id: 'pinky', joints: [17, 18, 19, 20], chemistry: 'weird' },
]);

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, finite(value, min)));
}

function vec3(value) {
  const raw = Array.isArray(value) ? value : [value?.x, value?.y, value?.z];
  return [finite(raw[0]), finite(raw[1]), finite(raw[2])];
}

function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function length3(value) {
  return Math.hypot(value[0], value[1], value[2]);
}

function normalize3(value, fallback = [0, 0.35, 0.94]) {
  const length = length3(value);
  return length > 1e-6 ? value.map(component => component / length) : [...fallback];
}

function cosine(a, b) {
  const denominator = length3(a) * length3(b);
  return denominator > 1e-6 ? clamp((a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / denominator, -1, 1) : -1;
}

function displayPoint(point, transform) {
  const source = vec3(point);
  const center = transform?.center || [0, 0, 0];
  const scale = finite(transform?.scale, 1);
  return [
    (source[0] - center[0]) * scale,
    -(source[1] - center[1]) * scale,
    (source[2] - center[2]) * scale,
  ];
}

export function normalizeManoSurface(vertices) {
  const points = (vertices || []).map(vec3).filter(point => point.every(Number.isFinite));
  if (!points.length) return null;
  const center = [0, 0, 0];
  for (const point of points) {
    center[0] += point[0];
    center[1] += point[1];
    center[2] += point[2];
  }
  center[0] /= points.length;
  center[1] /= points.length;
  center[2] /= points.length;
  let radius = 0;
  for (const point of points) radius = Math.max(radius, length3(sub(point, center)));
  const transform = { center, scale: 1.05 / Math.max(radius, 1e-5) };
  const positions = new Float32Array(points.length * 3);
  points.forEach((point, index) => positions.set(displayPoint(point, transform), index * 3));
  return { positions, transform, orientationContract: MANO_DISPLAY_ORIENTATION_CONTRACT };
}

function fingerExtension(points, joints) {
  const chain = joints.map(index => points[index]);
  if (chain.some(point => !point)) return 0;
  const segments = chain.slice(1).map((point, index) => sub(point, chain[index]));
  const chainLength = segments.reduce((sum, segment) => sum + length3(segment), 0);
  const reach = chainLength > 1e-6 ? length3(sub(chain.at(-1), chain[0])) / chainLength : 0;
  const straightness = Math.min(cosine(segments[0], segments[1]), cosine(segments[1], segments[2]));
  const reachScore = clamp((reach - 0.72) / 0.25);
  const angleScore = clamp((straightness - 0.68) / 0.3);
  return clamp(Math.min(reachScore, angleScore));
}

export function projectDisplayPointToFingerJuiceWorld(display, viewport = {}) {
  const width = Math.max(1, finite(viewport.width, 1340));
  const height = Math.max(1, finite(viewport.height, 1080));
  const fluidZ = -0.8 + display[2] * 0.16;
  const handFocalLength = height / (2 * Math.tan((33 * Math.PI / 180) / 2));
  const handDepth = Math.max(0.01, 3.8 - display[2]);
  const screenX = width * 0.5 + display[0] * handFocalLength / handDepth;
  const screenY = height * 0.5 - (display[1] - 0.05) * handFocalLength / handDepth;
  const fluidEyeZ = -0.2 + 4.45;
  const fluidDepth = Math.max(0.01, fluidEyeZ - fluidZ);
  const fluidFocalLength = height / (2 * Math.tan((Math.PI / 3.15) / 2));
  return [
    (screenX - width * 0.5) * fluidDepth / fluidFocalLength,
    -(screenY - height * 0.5) * fluidDepth / fluidFocalLength,
    fluidZ,
  ];
}

function inactivePacket(state, reason, nowMs) {
  return normalizeWorldFingerJuiceEmitterPacket({
    packet_id: `hand-state-inactive-${Math.round(nowMs)}`,
    source_route: 'hand-state-runtime/state-next',
    source_backend: 'hand-state-runtime',
    source_frame_id: state?.frame?.frame?.frameId || 'no-live-hand-frame',
    sidecar_sequence: state?.eventSequence ?? null,
    timestamp_ms: nowMs,
    evidence_kind: 'invalid',
    simulation_authority: 'invalid',
    route_identity: LIVE_FINGER_JUICE_ADAPTER_CONTRACT,
    hand_sample_space: { id: 'hand-state-runtime.wilor-local-v0' },
    lerms_world_frame: {
      id: 'kaminos-live-hand-fluid-v0',
      terrain_frame_id: 'kaminos-live-hand-fluid-v0',
      world_from_hand_sample: LIVE_FINGER_JUICE_ADAPTER_CONTRACT,
    },
    authority: { stale_visual_only: true, simulation_safe: false, reason },
    emitters: [],
  });
}

export function createLiveFingerJuiceEmitterPacket(state, {
  manoTransform = null,
  viewport = null,
  previousTips = null,
  previousTimestampMs = null,
  nowMs = Date.now(),
} = {}) {
  const frame = state?.frame;
  const keypoints = Array.isArray(frame?.hand?.keypoints3d) ? frame.hand.keypoints3d.map(vec3) : [];
  const live = state?.runtimeOwner === 'hand-state-runtime'
    && frame?.authority?.sourceAuthority === 'live_simulation'
    && frame?.authority?.freshness === 'fresh'
    && keypoints.length >= 21
    && Number(frame?.hand?.confidence) > 0;
  if (!live) return inactivePacket(state, 'missing fresh runtime-owned 3D hand state', nowMs);

  const timestampMs = finite(frame.frame?.captureTimestampMs, nowMs);
  const dt = previousTimestampMs == null ? 0 : Math.max(1, timestampMs - previousTimestampMs) / 1000;
  const tips = {};
  const emitters = FINGERS.map(finger => {
    const root = keypoints[finger.joints[0]];
    const distal = keypoints[finger.joints[2]];
    const tip = keypoints[finger.joints[3]];
    const extension = fingerExtension(keypoints, finger.joints);
    const active = extension >= FULL_EXTENSION_THRESHOLD;
    const displayTip = displayPoint(tip, manoTransform);
    const displayDistal = displayPoint(distal, manoTransform);
    const originWorld = projectDisplayPointToFingerJuiceWorld(displayTip, viewport);
    const distalWorld = projectDisplayPointToFingerJuiceWorld(displayDistal, viewport);
    const previous = previousTips?.[finger.id];
    const motionWorld = previous && dt > 0
      ? sub(originWorld, previous).map(component => component / dt)
      : [0, 0, 0];
    tips[finger.id] = originWorld;
    return {
      id: finger.id,
      tip_index: finger.joints[3],
      origin_world: originWorld,
      aim_world: normalize3(sub(originWorld, distalWorld)),
      motion_world: motionWorld.map(component => clamp(component, -1.2, 1.2)),
      extension,
      emission_state: active ? 'jet' : 'off',
      chemistry: finger.chemistry,
      radius: finger.id === 'middle' ? 0.052 : 0.044,
      strength: 1.15,
      active,
      authority: {
        valid: true,
        stale: false,
        confidence: clamp(frame.hand.confidence),
        force_safe: true,
        render_safe: true,
      },
    };
  });

  const packet = normalizeWorldFingerJuiceEmitterPacket({
    packet_id: `hand-state-fluid-${state.eventSequence ?? frame.source?.rawEventSequence ?? timestampMs}`,
    source_route: 'hand-state-runtime/state-next',
    source_backend: frame.source?.effectiveRoute || 'hand-state-runtime',
    source_frame_id: frame.frame?.frameId,
    sidecar_sequence: state.eventSequence ?? frame.source?.rawEventSequence ?? null,
    sample_age_ms: Math.max(0, nowMs - timestampMs),
    timestamp_ms: timestampMs,
    evidence_kind: 'live_simulation',
    simulation_authority: 'live_simulation',
    route_identity: LIVE_FINGER_JUICE_ADAPTER_CONTRACT,
    hand_sample_space: {
      id: 'hand-state-runtime.wilor-local-v0',
      convention: MANO_DISPLAY_ORIENTATION_CONTRACT,
      handedness: frame.hand.handedness,
      screen_x: 'operator_unmirrored',
      world_coordinates: 'wilor_mlx_hand_local',
    },
    lerms_world_frame: {
      id: 'kaminos-live-hand-fluid-v0',
      terrain_frame_id: 'kaminos-live-hand-fluid-v0',
      units: 'normalized_world',
      projection_contract: 'kaminos-hand-overlay-projection-v0',
      world_from_hand_sample: LIVE_FINGER_JUICE_ADAPTER_CONTRACT,
    },
    emitters,
  });
  packet.adapter = { contract: LIVE_FINGER_JUICE_ADAPTER_CONTRACT, threshold: FULL_EXTENSION_THRESHOLD, tips, timestampMs };
  return packet;
}
