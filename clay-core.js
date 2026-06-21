import {
  POINT_TRIANGLE_FEATURE,
  POINT_TRIANGLE_IMPORT_PATH,
  POINT_TRIANGLE_JOB_FLOATS,
  POINT_TRIANGLE_PACKAGE_COMMIT,
  POINT_TRIANGLE_RESULT_BYTES,
  POINT_TRIANGLE_SOURCE_CONTRACT,
  packPointTriangleDistanceJobs,
  pointTriangleDistanceWgsl,
} from './vendor/webgpu-geometry-primitives/point-triangle.js';

const ROUTE_IDENTITY = 'kaminos-clay-sim-route-v0';
const PROTOTYPE_IDENTITY = 'kaminos-clay-prototype-v0';
const SOLVER_IDENTITY = 'webgpu-clay-surface-lattice-scaffold-v0';
const CUBE_SOLVER_IDENTITY = 'webgpu-clay-material-point-cube-first-loop-v0';
const SHARED_PRIMITIVE_SOURCE_CONTRACT = POINT_TRIANGLE_SOURCE_CONTRACT;
const DEFAULT_CLAY_GRID = '48x32';
const CLAY_GRID_PRESETS = Object.freeze({
  '48x32': Object.freeze({ gridX: 48, gridZ: 32 }),
  '96x64': Object.freeze({ gridX: 96, gridZ: 64 }),
  '128x96': Object.freeze({ gridX: 128, gridZ: 96 }),
  '192x128': Object.freeze({ gridX: 192, gridZ: 128 }),
  '256x192': Object.freeze({ gridX: 256, gridZ: 192 }),
});
const MAX_COLLIDERS = 8;
const CLAY_SURFACE_HALF_X = 1.65 * 0.5;
const CLAY_SURFACE_HALF_Z = 1.05 * 0.5;
const CLAY_BRUSH_BOUNDARY_RADIUS_MARGIN = 1.5;
const CLAY_BRUSH_BOUNDARY_POLICY = 'radius-aware-center-clamp';
const CLAY_BRUSH_BOUNDARY_EDGE_FALLOFF = 'smoothstep-edge-falloff';
const CLAY_RELAXATION_FACTOR = 0.32;
const CLAY_PLASTICITY_FACTOR = 0.10;
const CLAY_CPU_SHADOW_EVIDENCE_KIND = 'benchmark-only-js-shadow-not-runtime-fallback';
const CLAY_CUBE_ORACLE_EVIDENCE_KIND = 'deterministic-js-oracle-not-runtime-fallback';
const SCULPT_SOLVER_IDENTITY = 'webgpu-clay-particle-sculpt-hash-grid-v0';
const CLAY_SCULPT_HASH_GRID_CONTRACT = 'fixed-capacity-uniform-grid-neighbor-bins-v0';
const CLAY_SCULPT_HASH_GRID_EVIDENCE_KIND = 'deterministic-js-hash-grid-oracle-not-runtime-fallback';
const CLAY_SCULPT_ORACLE_EVIDENCE_KIND = 'deterministic-js-sculpt-oracle-not-runtime-fallback';
const CLAY_SCULPT_WEBGPU_EVIDENCE_KIND = 'webgpu-particle-hash-grid-readback';
const CLAY_SCULPT_SURFACE_EVIDENCE_KIND = 'diagnostic-boundary-skin-from-sculpt-particles-not-solver-v0';
const CLAY_SCULPT_SURFACE_VISUAL_MODE = 'structured-lattice-boundary-skin-over-live-sculpt-particles-v0';
const CLAY_SCULPT_POINTER_DEPTH_POLICY = 'camera-ray-nearest-sculpt-surface';
const CLAY_SCULPT_SURFACE_RESOLUTION = 24;
const CLAY_SCULPT_SURFACE_MAX_BALLS = 576;
const CLAY_SCULPT_SURFACE_STRENGTH = 0.21;
const CLAY_SCULPT_SURFACE_SUBTRACT = 7.0;
const CLAY_SCULPT_SURFACE_ISOLATION = 1.45;
const CLAY_SCULPT_SURFACE_UPDATE_STEP_INTERVAL = 1;
const DEFAULT_CLAY_CUBE = '8x8x8';
const CLAY_CUBE_PRESETS = Object.freeze({
  '6x6x6': Object.freeze({ cubeX: 6, cubeY: 6, cubeZ: 6, gridDimension: 12 }),
  '8x8x8': Object.freeze({ cubeX: 8, cubeY: 8, cubeZ: 8, gridDimension: 16 }),
  '10x10x10': Object.freeze({ cubeX: 10, cubeY: 10, cubeZ: 10, gridDimension: 20 }),
});
const CLAY_CUBE_EXTENTS = Object.freeze({
  halfX: 0.44,
  minY: 0.04,
  maxY: 0.68,
  halfZ: 0.34,
});
const CLAY_CUBE_SURFACE_VISIBLE = false;
const CLAY_CUBE_DIAGNOSTIC_COLOR_MODE = 'cube-diagnostic-contact-displacement-colors-v0';
const CLAY_CUBE_BOUNDING_BOX_CONTRACT = 'cube-diagnostic-bounding-box-v0';
const CLAY_CUBE_ISO_SURFACE_EVIDENCE_KIND = 'diagnostic-marching-cubes-cpu-render-surface-not-solver-v0';
const CLAY_CUBE_ISO_SURFACE_VISIBILITY_POLICY = 'hidden-while-boundary-skin-active-v0';
const CLAY_CUBE_ISO_SURFACE_RESOLUTION = 22;
const CLAY_CUBE_ISO_SURFACE_MAX_BALLS = 1000;
const CLAY_CUBE_ISO_SURFACE_STRENGTH = 0.24;
const CLAY_CUBE_ISO_SURFACE_SUBTRACT = 10.0;
const CLAY_CUBE_ISO_SURFACE_ISOLATION = 2.0;
const CLAY_CUBE_BOUNDARY_SKIN_EVIDENCE_KIND = 'diagnostic-boundary-skin-from-material-points-not-solver-v0';
const CLAY_CUBE_BOUNDARY_SKIN_VISUAL_MODE = 'shared-vertex-displacement-heat-boundary-skin-v0';
const CLAY_CUBE_BOUNDARY_SKIN_FAIRING_POLICY = 'contacted-boundary-skin-curvature-fairing-v0';
const CLAY_CUBE_BOUNDARY_SKIN_CULLING_POLICY = 'boundary-skin-folded-triangle-cull-v0';
const CLAY_CUBE_VISIBLE_SURFACE_SOURCE = 'boundary-skin';
const CLAY_CUBE_SURFACE_SOURCE_DEBUG_MODE = 'source-tint-visible-surfaces-v0';
const CLAY_CUBE_FACE_METRIC_EVIDENCE_KIND = 'solver-space-material-point-face-locality-v0';
const CLAY_CUBE_PLASTIC_REST_POLICY = 'plastic-current-state-no-birth-shape-recovery-v0';
const CLAY_CUBE_CORNER_SOFTENING_POLICY = 'contacted-boundary-axis-corner-softening-v0';
const CLAY_CUBE_POINTER_DEPTH_POLICY = 'camera-ray-nearest-cube-surface';
const CLAY_HAND_POSE_PRESSURE_CONTRACT = 'clay_local_y_axis_drives_fingertip_pressure';
const CLAY_PRESSURE_NEUTRAL_AXIS = 0.22;
const CLAY_PRESSURE_AXIS_GAIN = 2.4;
const DEFAULT_CLAY_SCULPT_PARTICLES = '12x8x12';
const CLAY_SCULPT_PRESETS = Object.freeze({
  '8x6x8': Object.freeze({ sculptX: 8, sculptY: 6, sculptZ: 8, hashGridDimension: 12, hashGridCellCapacity: 12 }),
  '12x8x12': Object.freeze({ sculptX: 12, sculptY: 8, sculptZ: 12, hashGridDimension: 16, hashGridCellCapacity: 12 }),
  '16x10x16': Object.freeze({ sculptX: 16, sculptY: 10, sculptZ: 16, hashGridDimension: 20, hashGridCellCapacity: 12 }),
});
const CLAY_SCULPT_EXTENTS = Object.freeze({
  halfX: 0.50,
  minY: 0.02,
  maxY: 0.70,
  halfZ: 0.38,
});
const SHARED_PRIMITIVE_PROBE_TRIANGLE_INDEX = 77;
const SHARED_PRIMITIVE_PROBE_EXPECTED_DISTANCE_SQ = 0.25;
const SHARED_PRIMITIVE_PROBE_EXPECTED_FEATURE = POINT_TRIANGLE_FEATURE.FACE;
const HAND_POSE_STALE_MS = 250;
const CLAY_HAND_TIP_INDICES = [4, 8, 12, 16, 20];
const HAND_POSE_EVIDENCE_KINDS = ['live', 'captured', 'fallback', 'synthetic', 'synthetic-witness', 'stale_visual_only', 'unverified'];

export { pointTriangleDistanceWgsl };

function clampFinite(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function smoothstep(edge0, edge1, value) {
  const t = clamp01((value - edge0) / Math.max(1e-6, edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function normalizeVec3(vector, fallback = [0, -1, 0]) {
  const x = Number(vector?.[0]);
  const y = Number(vector?.[1]);
  const z = Number(vector?.[2]);
  const fx = Number.isFinite(x) ? x : fallback[0];
  const fy = Number.isFinite(y) ? y : fallback[1];
  const fz = Number.isFinite(z) ? z : fallback[2];
  const length = Math.sqrt(fx * fx + fy * fy + fz * fz);
  if (length <= 1e-6) return fallback.slice();
  return [fx / length, fy / length, fz / length];
}

function percentile(values, q) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * q) - 1));
  return sorted[index];
}

function clayHandPoseNowMs() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function normalizeClayHandPoint(point, coordinateSpace, warnings) {
  if (!Array.isArray(point) || point.length < 2) {
    warnings.push('invalid-hand-point');
    return { x: 0, z: 0, pressureAxis: 0, pressureScale: 1 };
  }
  const x = Number(point[0]);
  const y = Number(point[1]);
  const z = Number(point[2]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    warnings.push('nonfinite-hand-point');
    return { x: 0, z: 0, pressureAxis: 0, pressureScale: 1 };
  }
  if (coordinateSpace === 'clay-local') {
    const pressureAxis = clampFinite(y, -1.2, 1.2, 0);
    return {
      x: clampFinite(x, -1.2, 1.2, 0),
      z: clampFinite(Number.isFinite(z) ? z : 0, -1.2, 1.2, 0),
      pressureAxis,
      pressureScale: clampFinite(1 + (pressureAxis - CLAY_PRESSURE_NEUTRAL_AXIS) * CLAY_PRESSURE_AXIS_GAIN, 0.2, 4, 1),
    };
  }
  if (coordinateSpace === 'volume-local') {
    return {
      x: clampFinite(x, -1.2, 1.2, 0),
      z: clampFinite(y, -1.2, 1.2, 0),
      pressureAxis: 0,
      pressureScale: 1,
    };
  }
  return {
    x: clampFinite((x - 0.5) * 1.25, -1.2, 1.2, 0),
    z: clampFinite((0.5 - y) * 1.25, -1.2, 1.2, 0),
    pressureAxis: 0,
    pressureScale: 1,
  };
}

export function normalizeClayHandPoseColliders(payload = {}, nowMs = clayHandPoseNowMs()) {
  const warnings = [];
  const requestedHandPoseBackend = String(payload.requestedBackend || payload.requestedHandPoseBackend || 'unspecified');
  const effectiveHandPoseBackend = String(payload.effectiveBackend || payload.effectiveHandPoseBackend || payload.backend || 'unknown');
  const handPoseEvidenceKind = String(payload.evidenceKind || payload.handPoseEvidenceKind || 'unverified');
  const sourceBackend = String(payload.source_backend || payload.sourceBackend || effectiveHandPoseBackend);
  const sampleAgeMs = Number.isFinite(Number(payload.sample_age_ms ?? payload.sampleAgeMs))
    ? Number(payload.sample_age_ms ?? payload.sampleAgeMs)
    : null;
  const sampleAuthority = Number.isFinite(Number(payload.sample_authority ?? payload.sampleAuthority))
    ? Number(payload.sample_authority ?? payload.sampleAuthority)
    : null;
  const timestampMs = clampFinite(payload.timestampMs, 0, Number.MAX_SAFE_INTEGER, nowMs);
  const ageMs = Math.max(0, nowMs - timestampMs);
  const handPoseStale = handPoseEvidenceKind === 'live' && ageMs > HAND_POSE_STALE_MS;
  const handPoseVisualOnly = handPoseEvidenceKind === 'stale_visual_only';
  const coordinateSpace = payload.coordinateSpace === 'volume-local' || payload.coordinateSpace === 'clay-local'
    ? payload.coordinateSpace
    : 'image-normalized';
  const rawHands = Array.isArray(payload.hands) ? payload.hands : [];
  const mode = `hand_pose:${effectiveHandPoseBackend}`;
  const colliders = [];
  let handPoseHandCount = 0;

  if (rawHands.length && effectiveHandPoseBackend === 'unknown') warnings.push('missing-effective-hand-pose-backend');
  if (!HAND_POSE_EVIDENCE_KINDS.includes(handPoseEvidenceKind)) {
    warnings.push(`unknown-hand-pose-evidence-kind:${handPoseEvidenceKind}`);
  }
  if (handPoseStale) warnings.push('stale-live-hand-pose-frame');

  for (const hand of rawHands) {
    if (!hand || hand.active === false) continue;
    const points = Array.isArray(hand.keypoints_3d) && hand.keypoints_3d.length >= 21
      ? hand.keypoints_3d
      : hand.keypoints3d && Array.isArray(hand.keypoints3d) && hand.keypoints3d.length >= 21
        ? hand.keypoints3d
        : Array.isArray(hand.keypoints_2d) && hand.keypoints_2d.length >= 21
          ? hand.keypoints_2d
          : Array.isArray(hand.keypoints2d) && hand.keypoints2d.length >= 21
            ? hand.keypoints2d
            : [];
    if (!points.length) {
      warnings.push('hand-missing-21-keypoints');
      continue;
    }
    handPoseHandCount += 1;
    if (handPoseStale) continue;
    const side = String(hand.hand_side || hand.handedness || 'unknown').toLowerCase();
    for (const tipIndex of CLAY_HAND_TIP_INDICES) {
      if (colliders.length >= MAX_COLLIDERS) break;
      const point = normalizeClayHandPoint(points[tipIndex], coordinateSpace, warnings);
      const baseStrength = clampFinite(hand.strength, 0.05, 2.5, sampleAuthority === null ? 1.05 : 1.05 * sampleAuthority);
      colliders.push({
        id: `hand-${side}-tip-${tipIndex}`,
        center: [point.x, 0, point.z],
        radius: clampFinite(hand.radius, 0.06, 0.28, 0.16),
        strength: clampFinite(baseStrength * point.pressureScale, 0.05, 5, baseStrength),
        source: mode,
        sourceBackend,
        sampleAuthority,
        pressureAxis: point.pressureAxis,
        pressureScale: point.pressureScale,
      });
    }
  }

  return {
    mode,
    coordinateSpace,
    timestampMs,
    frameId: payload.frameId ?? payload.handPoseFrameId ?? null,
    ageMs,
    colliders,
    requestedHandPoseBackend,
    effectiveHandPoseBackend,
    handPoseEvidenceKind,
    handPoseStale,
    handPoseVisualOnly,
    handPoseFrameId: payload.frameId ?? payload.handPoseFrameId ?? null,
    handPoseHandCount,
    handPoseColliderCount: colliders.length,
    handPoseAdapterWarnings: warnings,
    sourceBackend,
    sampleAgeMs,
    sampleAuthority,
    handPosePressureContract: CLAY_HAND_POSE_PRESSURE_CONTRACT,
    clayPressureNeutralAxis: CLAY_PRESSURE_NEUTRAL_AXIS,
    clayPressureAxisGain: CLAY_PRESSURE_AXIS_GAIN,
  };
}

export function normalizeClayGridConfig(requestedGrid = DEFAULT_CLAY_GRID) {
  const requestedClayGrid = String(requestedGrid || DEFAULT_CLAY_GRID);
  const preset = CLAY_GRID_PRESETS[requestedClayGrid];
  const clayGridConfigWarnings = [];
  const effectiveClayGrid = preset ? requestedClayGrid : DEFAULT_CLAY_GRID;
  if (!preset) clayGridConfigWarnings.push(`unsupported-clay-grid:${requestedClayGrid}`);
  const effectivePreset = preset || CLAY_GRID_PRESETS[DEFAULT_CLAY_GRID];
  return {
    requestedClayGrid,
    effectiveClayGrid,
    gridX: effectivePreset.gridX,
    gridZ: effectivePreset.gridZ,
    clayGridConfigWarnings,
  };
}

export function normalizeClayCubeConfig(requestedCube = DEFAULT_CLAY_CUBE) {
  const requestedClayCube = String(requestedCube || DEFAULT_CLAY_CUBE);
  const preset = CLAY_CUBE_PRESETS[requestedClayCube];
  const clayCubeConfigWarnings = [];
  const effectiveClayCube = preset ? requestedClayCube : DEFAULT_CLAY_CUBE;
  if (!preset) clayCubeConfigWarnings.push(`unsupported-clay-cube:${requestedClayCube}`);
  const effectivePreset = preset || CLAY_CUBE_PRESETS[DEFAULT_CLAY_CUBE];
  const particleCount = effectivePreset.cubeX * effectivePreset.cubeY * effectivePreset.cubeZ;
  return {
    requestedClayCube,
    effectiveClayCube,
    cubeX: effectivePreset.cubeX,
    cubeY: effectivePreset.cubeY,
    cubeZ: effectivePreset.cubeZ,
    gridDimension: effectivePreset.gridDimension,
    particleCount,
    clayCubeConfigWarnings,
  };
}

export function normalizeClaySculptConfig(requestedParticles = DEFAULT_CLAY_SCULPT_PARTICLES) {
  const requestedClaySculptParticles = String(requestedParticles || DEFAULT_CLAY_SCULPT_PARTICLES);
  const preset = CLAY_SCULPT_PRESETS[requestedClaySculptParticles];
  const claySculptConfigWarnings = [];
  const effectiveClaySculptParticles = preset ? requestedClaySculptParticles : DEFAULT_CLAY_SCULPT_PARTICLES;
  if (!preset) claySculptConfigWarnings.push(`unsupported-clay-sculpt-particles:${requestedClaySculptParticles}`);
  const effectivePreset = preset || CLAY_SCULPT_PRESETS[DEFAULT_CLAY_SCULPT_PARTICLES];
  const particleCount = effectivePreset.sculptX * effectivePreset.sculptY * effectivePreset.sculptZ;
  return {
    requestedClaySculptParticles,
    effectiveClaySculptParticles,
    sculptX: effectivePreset.sculptX,
    sculptY: effectivePreset.sculptY,
    sculptZ: effectivePreset.sculptZ,
    hashGridDimension: effectivePreset.hashGridDimension,
    hashGridCellCapacity: effectivePreset.hashGridCellCapacity,
    particleCount,
    claySculptConfigWarnings,
  };
}

export function seedClayCubeMaterialPoints(config = normalizeClayCubeConfig()) {
  const cfg = config?.particleCount ? config : normalizeClayCubeConfig();
  const positions = new Float32Array(cfg.particleCount * 4);
  let cursor = 0;
  for (let y = 0; y < cfg.cubeY; y += 1) {
    const fy = cfg.cubeY === 1 ? 0.5 : y / (cfg.cubeY - 1);
    for (let z = 0; z < cfg.cubeZ; z += 1) {
      const fz = cfg.cubeZ === 1 ? 0.5 : z / (cfg.cubeZ - 1);
      for (let x = 0; x < cfg.cubeX; x += 1) {
        const fx = cfg.cubeX === 1 ? 0.5 : x / (cfg.cubeX - 1);
        positions[cursor] = (fx - 0.5) * CLAY_CUBE_EXTENTS.halfX * 2;
        positions[cursor + 1] = CLAY_CUBE_EXTENTS.minY + fy * (CLAY_CUBE_EXTENTS.maxY - CLAY_CUBE_EXTENTS.minY);
        positions[cursor + 2] = (fz - 0.5) * CLAY_CUBE_EXTENTS.halfZ * 2;
        positions[cursor + 3] = 1;
        cursor += 4;
      }
    }
  }
  return positions;
}

function clayCubeParticleIndexForConfig(config, x, y, z) {
  return y * config.cubeZ * config.cubeX + z * config.cubeX + x;
}

function buildClayCubeBoundarySkinTopology(config = normalizeClayCubeConfig()) {
  const cfg = config?.particleCount ? config : normalizeClayCubeConfig();
  const indices = [];
  const sourceIndices = [];
  const sourceToVertex = new Map();

  const pushVertex = sourceIndex => {
    const existing = sourceToVertex.get(sourceIndex);
    if (existing !== undefined) return existing;
    const vertexIndex = sourceIndices.length;
    sourceIndices.push(sourceIndex);
    sourceToVertex.set(sourceIndex, vertexIndex);
    return vertexIndex;
  };

  const pushQuad = (a, b, c, d) => {
    indices.push(a, b, c, c, b, d);
  };

  for (let y = 0; y < cfg.cubeY - 1; y += 1) {
    for (let x = 0; x < cfg.cubeX - 1; x += 1) {
      pushQuad(
        pushVertex(clayCubeParticleIndexForConfig(cfg, x, y, 0)),
        pushVertex(clayCubeParticleIndexForConfig(cfg, x + 1, y, 0)),
        pushVertex(clayCubeParticleIndexForConfig(cfg, x, y + 1, 0)),
        pushVertex(clayCubeParticleIndexForConfig(cfg, x + 1, y + 1, 0)),
      );
      pushQuad(
        pushVertex(clayCubeParticleIndexForConfig(cfg, x + 1, y, cfg.cubeZ - 1)),
        pushVertex(clayCubeParticleIndexForConfig(cfg, x, y, cfg.cubeZ - 1)),
        pushVertex(clayCubeParticleIndexForConfig(cfg, x + 1, y + 1, cfg.cubeZ - 1)),
        pushVertex(clayCubeParticleIndexForConfig(cfg, x, y + 1, cfg.cubeZ - 1)),
      );
    }
  }

  for (let y = 0; y < cfg.cubeY - 1; y += 1) {
    for (let z = 0; z < cfg.cubeZ - 1; z += 1) {
      pushQuad(
        pushVertex(clayCubeParticleIndexForConfig(cfg, 0, y, z + 1)),
        pushVertex(clayCubeParticleIndexForConfig(cfg, 0, y, z)),
        pushVertex(clayCubeParticleIndexForConfig(cfg, 0, y + 1, z + 1)),
        pushVertex(clayCubeParticleIndexForConfig(cfg, 0, y + 1, z)),
      );
      pushQuad(
        pushVertex(clayCubeParticleIndexForConfig(cfg, cfg.cubeX - 1, y, z)),
        pushVertex(clayCubeParticleIndexForConfig(cfg, cfg.cubeX - 1, y, z + 1)),
        pushVertex(clayCubeParticleIndexForConfig(cfg, cfg.cubeX - 1, y + 1, z)),
        pushVertex(clayCubeParticleIndexForConfig(cfg, cfg.cubeX - 1, y + 1, z + 1)),
      );
    }
  }

  for (let z = 0; z < cfg.cubeZ - 1; z += 1) {
    for (let x = 0; x < cfg.cubeX - 1; x += 1) {
      pushQuad(
        pushVertex(clayCubeParticleIndexForConfig(cfg, x, 0, z + 1)),
        pushVertex(clayCubeParticleIndexForConfig(cfg, x + 1, 0, z + 1)),
        pushVertex(clayCubeParticleIndexForConfig(cfg, x, 0, z)),
        pushVertex(clayCubeParticleIndexForConfig(cfg, x + 1, 0, z)),
      );
      pushQuad(
        pushVertex(clayCubeParticleIndexForConfig(cfg, x, cfg.cubeY - 1, z)),
        pushVertex(clayCubeParticleIndexForConfig(cfg, x + 1, cfg.cubeY - 1, z)),
        pushVertex(clayCubeParticleIndexForConfig(cfg, x, cfg.cubeY - 1, z + 1)),
        pushVertex(clayCubeParticleIndexForConfig(cfg, x + 1, cfg.cubeY - 1, z + 1)),
      );
    }
  }

  const neighbors = Array.from({ length: sourceIndices.length }, () => new Set());
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i];
    const b = indices[i + 1];
    const c = indices[i + 2];
    neighbors[a].add(b);
    neighbors[a].add(c);
    neighbors[b].add(a);
    neighbors[b].add(c);
    neighbors[c].add(a);
    neighbors[c].add(b);
  }

  return {
    sourceIndices,
    indices,
    neighbors: neighbors.map(entry => [...entry]),
  };
}

function measureClayCubeBoundarySkinRoughness(framePositions, sourceIndices, neighbors, basePositions, sourceValues) {
  let maxBoundarySkinRoughness = 0;
  let averageBoundarySkinRoughness = 0;
  let sampled = 0;
  for (let i = 0; i < sourceIndices.length; i += 1) {
    const sourceOffset = sourceIndices[i] * 4;
    const dx = sourceValues[sourceOffset] - basePositions[sourceOffset];
    const dy = sourceValues[sourceOffset + 1] - basePositions[sourceOffset + 1];
    const dz = sourceValues[sourceOffset + 2] - basePositions[sourceOffset + 2];
    const displacement = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const contactWeight = sourceValues[sourceOffset + 3] > 0.5 ? 1 : 0;
    const sampleWeight = Math.max(contactWeight, clamp01(displacement / 0.04));
    const vertexNeighbors = neighbors[i] || [];
    if (sampleWeight <= 0 || vertexNeighbors.length === 0) continue;
    let avgX = 0;
    let avgY = 0;
    let avgZ = 0;
    for (const neighbor of vertexNeighbors) {
      const neighborOffset = neighbor * 3;
      avgX += framePositions[neighborOffset];
      avgY += framePositions[neighborOffset + 1];
      avgZ += framePositions[neighborOffset + 2];
    }
    const invNeighborCount = 1 / vertexNeighbors.length;
    avgX *= invNeighborCount;
    avgY *= invNeighborCount;
    avgZ *= invNeighborCount;
    const frameOffset = i * 3;
    const rx = framePositions[frameOffset] - avgX;
    const ry = framePositions[frameOffset + 1] - avgY;
    const rz = framePositions[frameOffset + 2] - avgZ;
    const roughness = Math.sqrt(rx * rx + ry * ry + rz * rz) * sampleWeight;
    maxBoundarySkinRoughness = Math.max(maxBoundarySkinRoughness, roughness);
    averageBoundarySkinRoughness += roughness;
    sampled += 1;
  }
  return {
    maxBoundarySkinRoughness,
    averageBoundarySkinRoughness: sampled > 0 ? averageBoundarySkinRoughness / sampled : 0,
    boundarySkinRoughnessSampleCount: sampled,
  };
}

function cullClayCubeBoundarySkinTriangles(
  framePositions,
  indices,
  sourceIndices,
  basePositions,
  sourceValues,
  config = normalizeClayCubeConfig(),
) {
  const cfg = config?.particleCount ? config : normalizeClayCubeConfig();
  const stepX = (CLAY_CUBE_EXTENTS.halfX * 2) / Math.max(1, cfg.cubeX - 1);
  const stepY = (CLAY_CUBE_EXTENTS.maxY - CLAY_CUBE_EXTENTS.minY) / Math.max(1, cfg.cubeY - 1);
  const stepZ = (CLAY_CUBE_EXTENTS.halfZ * 2) / Math.max(1, cfg.cubeZ - 1);
  const maxEdge = Math.max(stepX, stepY, stepZ) * 2.55;
  const minArea = Math.min(stepX * stepY, stepX * stepZ, stepY * stepZ) * 0.025;
  const culledIndices = [];
  let culledTriangleCount = 0;
  const edgeLength = (a, b, values = framePositions, stride = 3, laneOffset = 0) => {
    const ao = a * 3;
    const bo = b * 3;
    const dx = values[ao + laneOffset] - values[bo + laneOffset];
    const dy = values[ao + laneOffset + 1] - values[bo + laneOffset + 1];
    const dz = values[ao + laneOffset + 2] - values[bo + laneOffset + 2];
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  };
  const normalFor = (values, a, b, c, stride = 3, sourceLookup = null) => {
    const ai = sourceLookup ? sourceLookup[a] * stride : a * stride;
    const bi = sourceLookup ? sourceLookup[b] * stride : b * stride;
    const ci = sourceLookup ? sourceLookup[c] * stride : c * stride;
    const ux = values[bi] - values[ai];
    const uy = values[bi + 1] - values[ai + 1];
    const uz = values[bi + 2] - values[ai + 2];
    const vx = values[ci] - values[ai];
    const vy = values[ci + 1] - values[ai + 1];
    const vz = values[ci + 2] - values[ai + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const length = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (length <= 1e-8) return [0, 0, 0, 0];
    return [nx / length, ny / length, nz / length, length * 0.5];
  };
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i];
    const b = indices[i + 1];
    const c = indices[i + 2];
    const ab = edgeLength(a, b);
    const bc = edgeLength(b, c);
    const ca = edgeLength(c, a);
    const maxTriangleEdge = Math.max(ab, bc, ca);
    const currentNormal = normalFor(framePositions, a, b, c);
    const baseNormal = normalFor(basePositions, a, b, c, 4, sourceIndices);
    const normalDot = currentNormal[0] * baseNormal[0] + currentNormal[1] * baseNormal[1] + currentNormal[2] * baseNormal[2];
    let maxDisplacement = 0;
    for (const vertex of [a, b, c]) {
      const sourceOffset = sourceIndices[vertex] * 4;
      const frameOffset = vertex * 3;
      const dx = framePositions[frameOffset] - basePositions[sourceOffset];
      const dy = framePositions[frameOffset + 1] - basePositions[sourceOffset + 1];
      const dz = framePositions[frameOffset + 2] - basePositions[sourceOffset + 2];
      const contactBoost = sourceValues[sourceOffset + 3] > 0.5 ? 0.025 : 0;
      maxDisplacement = Math.max(maxDisplacement, Math.sqrt(dx * dx + dy * dy + dz * dz) + contactBoost);
    }
    const folded = maxDisplacement > 0.045 && normalDot < 0.12;
    if (maxTriangleEdge > maxEdge || currentNormal[3] < minArea || folded) {
      culledTriangleCount += 1;
      continue;
    }
    culledIndices.push(a, b, c);
  }
  return {
    indices: culledIndices,
    culledTriangleCount,
    cullingMaxEdge: maxEdge,
  };
}

export function buildClayCubeBoundarySkinFrame({
  basePositions,
  positions,
  config = normalizeClayCubeConfig(),
  fair = true,
} = {}) {
  const cfg = config?.particleCount ? config : normalizeClayCubeConfig();
  const sourceValues = positions || basePositions || seedClayCubeMaterialPoints(cfg);
  const sourceBase = basePositions || sourceValues;
  const topology = buildClayCubeBoundarySkinTopology(cfg);
  const framePositions = new Float32Array(topology.sourceIndices.length * 3);
  const fairingWeights = new Float32Array(topology.sourceIndices.length);
  for (let i = 0; i < topology.sourceIndices.length; i += 1) {
    const sourceOffset = topology.sourceIndices[i] * 4;
    const frameOffset = i * 3;
    framePositions[frameOffset] = sourceValues[sourceOffset];
    framePositions[frameOffset + 1] = sourceValues[sourceOffset + 1];
    framePositions[frameOffset + 2] = sourceValues[sourceOffset + 2];
    const dx = sourceValues[sourceOffset] - sourceBase[sourceOffset];
    const dy = sourceValues[sourceOffset + 1] - sourceBase[sourceOffset + 1];
    const dz = sourceValues[sourceOffset + 2] - sourceBase[sourceOffset + 2];
    const displacement = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const contactWeight = sourceValues[sourceOffset + 3] > 0.5 ? 1 : 0;
    fairingWeights[i] = Math.max(contactWeight, clamp01(displacement / 0.055));
  }

  const rawMetrics = measureClayCubeBoundarySkinRoughness(
    framePositions,
    topology.sourceIndices,
    topology.neighbors,
    sourceBase,
    sourceValues,
  );
  let maxFairingDisplacement = 0;
  if (fair) {
    const nextPositions = new Float32Array(framePositions);
    for (let i = 0; i < topology.sourceIndices.length; i += 1) {
      const weight = fairingWeights[i];
      const vertexNeighbors = topology.neighbors[i] || [];
      if (weight <= 0 || vertexNeighbors.length === 0) continue;
      const frameOffset = i * 3;
      let avgX = 0;
      let avgY = 0;
      let avgZ = 0;
      for (const neighbor of vertexNeighbors) {
        const neighborOffset = neighbor * 3;
        avgX += framePositions[neighborOffset];
        avgY += framePositions[neighborOffset + 1];
        avgZ += framePositions[neighborOffset + 2];
      }
      const invNeighborCount = 1 / vertexNeighbors.length;
      avgX *= invNeighborCount;
      avgY *= invNeighborCount;
      avgZ *= invNeighborCount;
      const rawX = framePositions[frameOffset];
      const rawY = framePositions[frameOffset + 1];
      const rawZ = framePositions[frameOffset + 2];
      const strength = 0.46 * weight;
      let fx = (avgX - rawX) * strength;
      let fy = (avgY - rawY) * strength;
      let fz = (avgZ - rawZ) * strength;
      const fairDistance = Math.sqrt(fx * fx + fy * fy + fz * fz);
      const maxDistance = 0.052;
      if (fairDistance > maxDistance) {
        const scale = maxDistance / fairDistance;
        fx *= scale;
        fy *= scale;
        fz *= scale;
      }
      nextPositions[frameOffset] = rawX + fx;
      nextPositions[frameOffset + 1] = rawY + fy;
      nextPositions[frameOffset + 2] = rawZ + fz;
      maxFairingDisplacement = Math.max(maxFairingDisplacement, Math.sqrt(fx * fx + fy * fy + fz * fz));
    }
    framePositions.set(nextPositions);
  }

  const metrics = measureClayCubeBoundarySkinRoughness(
    framePositions,
    topology.sourceIndices,
    topology.neighbors,
    sourceBase,
    sourceValues,
  );
  const culling = cullClayCubeBoundarySkinTriangles(
    framePositions,
    topology.indices,
    topology.sourceIndices,
    sourceBase,
    sourceValues,
    cfg,
  );
  return {
    fairingPolicy: CLAY_CUBE_BOUNDARY_SKIN_FAIRING_POLICY,
    cullingPolicy: CLAY_CUBE_BOUNDARY_SKIN_CULLING_POLICY,
    positions: framePositions,
    indices: culling.indices,
    sourceIndices: topology.sourceIndices,
    vertexCount: topology.sourceIndices.length,
    triangleCount: culling.indices.length / 3,
    rawTriangleCount: topology.indices.length / 3,
    culledTriangleCount: culling.culledTriangleCount,
    cullingMaxEdge: culling.cullingMaxEdge,
    rawMaxBoundarySkinRoughness: rawMetrics.maxBoundarySkinRoughness,
    rawAverageBoundarySkinRoughness: rawMetrics.averageBoundarySkinRoughness,
    maxBoundarySkinRoughness: metrics.maxBoundarySkinRoughness,
    averageBoundarySkinRoughness: metrics.averageBoundarySkinRoughness,
    boundarySkinRoughnessSampleCount: metrics.boundarySkinRoughnessSampleCount,
    maxFairingDisplacement,
  };
}

export function seedClaySculptParticles(config = normalizeClaySculptConfig()) {
  const cfg = config?.particleCount ? config : normalizeClaySculptConfig();
  const positions = new Float32Array(cfg.particleCount * 4);
  let cursor = 0;
  for (let y = 0; y < cfg.sculptY; y += 1) {
    const fy = cfg.sculptY === 1 ? 0.5 : y / (cfg.sculptY - 1);
    for (let z = 0; z < cfg.sculptZ; z += 1) {
      const fz = cfg.sculptZ === 1 ? 0.5 : z / (cfg.sculptZ - 1);
      for (let x = 0; x < cfg.sculptX; x += 1) {
        const fx = cfg.sculptX === 1 ? 0.5 : x / (cfg.sculptX - 1);
        const roundX = Math.abs(fx - 0.5) * 2;
        const roundZ = Math.abs(fz - 0.5) * 2;
        const roundY = Math.abs(fy - 0.5) * 1.7;
        const roundedShell = Math.max(0, Math.max(roundX, roundZ, roundY) - 0.72);
        const ySkew = Math.sin(fx * Math.PI) * Math.sin(fz * Math.PI) * 0.018;
        positions[cursor] = (fx - 0.5) * CLAY_SCULPT_EXTENTS.halfX * 2 * 0.68 * (1 - roundedShell * 0.08);
        positions[cursor + 1] = CLAY_SCULPT_EXTENTS.minY
          + (0.5 + (fy - 0.5) * 0.58) * (CLAY_SCULPT_EXTENTS.maxY - CLAY_SCULPT_EXTENTS.minY)
          + ySkew;
        positions[cursor + 2] = (fz - 0.5) * CLAY_SCULPT_EXTENTS.halfZ * 2 * 0.62 * (1 - roundedShell * 0.08);
        positions[cursor + 3] = 1;
        cursor += 4;
      }
    }
  }
  return positions;
}

function normalizedCubeCollider(collider, index) {
  const center = Array.isArray(collider?.center) ? collider.center : [0, 0, 0];
  const rawX = clampFinite(center[0], -1.2, 1.2, 0);
  const sourceY = Number(collider?.center?.[1]);
  const rawZ = clampFinite(center[2], -1.2, 1.2, 0);
  const x = clampFinite(rawX, -CLAY_CUBE_EXTENTS.halfX, CLAY_CUBE_EXTENTS.halfX, 0);
  const y = Number.isFinite(sourceY) && Math.abs(sourceY) > 1e-5
    ? clampFinite(collider.center[1], CLAY_CUBE_EXTENTS.minY, CLAY_CUBE_EXTENTS.maxY, 0.34)
    : 0.34;
  const z = clampFinite(rawZ, -CLAY_CUBE_EXTENTS.halfZ, CLAY_CUBE_EXTENTS.halfZ, 0);
  return {
    id: collider?.id || `clay-cube-collider-${index}`,
    center: [x, y, z],
    radius: clampFinite(collider?.radius, 0.035, 0.35, 0.12),
    strength: clampFinite(collider?.strength, 0, 5, 1),
    source: collider?.source || null,
    sourceBackend: collider?.sourceBackend || null,
    sampleAuthority: Number.isFinite(collider?.sampleAuthority) ? collider.sampleAuthority : null,
    pressureAxis: Number.isFinite(collider?.pressureAxis) ? collider.pressureAxis : null,
    pressureScale: Number.isFinite(collider?.pressureScale) ? collider.pressureScale : null,
    boundaryClamped: Math.abs(x - rawX) > 1e-6 || Math.abs(z - rawZ) > 1e-6,
    boundaryMargin: [0, 0, 0],
    surfaceNormal: normalizeVec3(collider?.surfaceNormal, [0, -1, 0]),
  };
}

function sculptGridCoord(x, y, z, gridDimension) {
  const gx = Math.max(0, Math.min(gridDimension - 1, Math.floor(((x / (CLAY_SCULPT_EXTENTS.halfX * 2)) + 0.5) * gridDimension)));
  const gy = Math.max(0, Math.min(gridDimension - 1, Math.floor(((y - CLAY_SCULPT_EXTENTS.minY) / (CLAY_SCULPT_EXTENTS.maxY - CLAY_SCULPT_EXTENTS.minY)) * gridDimension)));
  const gz = Math.max(0, Math.min(gridDimension - 1, Math.floor(((z / (CLAY_SCULPT_EXTENTS.halfZ * 2)) + 0.5) * gridDimension)));
  return [gx, gy, gz];
}

function sculptGridCellIndex(x, y, z, gridDimension) {
  const [gx, gy, gz] = sculptGridCoord(x, y, z, gridDimension);
  return gx + gy * gridDimension + gz * gridDimension * gridDimension;
}

function normalizeSculptBrush(brush = {}) {
  const center = Array.isArray(brush.center) ? brush.center : [0.18, 0.42, 0.34];
  return {
    center: [
      clampFinite(center[0], -CLAY_SCULPT_EXTENTS.halfX, CLAY_SCULPT_EXTENTS.halfX, 0.18),
      clampFinite(center[1], CLAY_SCULPT_EXTENTS.minY, CLAY_SCULPT_EXTENTS.maxY, 0.42),
      clampFinite(center[2], -CLAY_SCULPT_EXTENTS.halfZ, CLAY_SCULPT_EXTENTS.halfZ, 0.34),
    ],
    radius: clampFinite(brush.radius, 0.035, 0.45, 0.22),
    strength: clampFinite(brush.strength, 0, 5, 1.1),
    normal: normalizeVec3(brush.normal, [0, 0, -1]),
  };
}

export function buildClaySculptHashGridOracle(particles, config = normalizeClaySculptConfig()) {
  const cfg = config?.particleCount ? config : normalizeClaySculptConfig();
  const particleValues = particles instanceof Float32Array && particles.length >= cfg.particleCount * 4
    ? particles
    : seedClaySculptParticles(cfg);
  const cellCount = cfg.hashGridDimension ** 3;
  const cellCounts = new Uint32Array(cellCount);
  const cellEntries = new Uint32Array(cellCount * cfg.hashGridCellCapacity);
  cellEntries.fill(0xffffffff);
  let overflowCount = 0;
  let activeCellCount = 0;
  let maxCellOccupancy = 0;

  for (let i = 0; i < cfg.particleCount; i += 1) {
    const offset = i * 4;
    const cell = sculptGridCellIndex(
      particleValues[offset],
      particleValues[offset + 1],
      particleValues[offset + 2],
      cfg.hashGridDimension,
    );
    const slot = cellCounts[cell];
    cellCounts[cell] += 1;
    if (slot === 0) activeCellCount += 1;
    maxCellOccupancy = Math.max(maxCellOccupancy, cellCounts[cell]);
    if (slot < cfg.hashGridCellCapacity) {
      cellEntries[cell * cfg.hashGridCellCapacity + slot] = i;
    } else {
      overflowCount += 1;
    }
  }

  return {
    evidenceKind: CLAY_SCULPT_HASH_GRID_EVIDENCE_KIND,
    hashGridContract: CLAY_SCULPT_HASH_GRID_CONTRACT,
    particleCount: cfg.particleCount,
    hashGridDimension: cfg.hashGridDimension,
    hashGridCellCapacity: cfg.hashGridCellCapacity,
    activeCellCount,
    maxCellOccupancy,
    overflowCount,
    cellCounts,
    cellEntries,
  };
}

export function runClaySculptFirstBrushOracle({
  basePositions,
  previousPositions = basePositions,
  config = normalizeClaySculptConfig(),
  brush = {},
} = {}) {
  const cfg = config?.particleCount ? config : normalizeClaySculptConfig();
  const base = basePositions instanceof Float32Array && basePositions.length >= cfg.particleCount * 4
    ? basePositions
    : seedClaySculptParticles(cfg);
  const previous = previousPositions instanceof Float32Array && previousPositions.length === base.length ? previousPositions : base;
  const normalizedBrush = normalizeSculptBrush(brush);
  const grid = buildClaySculptHashGridOracle(previous, cfg);
  const next = new Float32Array(base.length);
  let contactParticleCount = 0;
  let deformedParticleCount = 0;
  let neighborSampleCount = 0;
  let neighborCohesionDisplacement = 0;
  let maxDisplacement = 0;
  const neighborRadius = Math.max(
    CLAY_SCULPT_EXTENTS.halfX * 2 / Math.max(1, cfg.sculptX - 1),
    (CLAY_SCULPT_EXTENTS.maxY - CLAY_SCULPT_EXTENTS.minY) / Math.max(1, cfg.sculptY - 1),
    CLAY_SCULPT_EXTENTS.halfZ * 2 / Math.max(1, cfg.sculptZ - 1),
  ) * 1.65;

  for (let i = 0; i < cfg.particleCount; i += 1) {
    const offset = i * 4;
    const baseX = base[offset];
    const baseY = base[offset + 1];
    const baseZ = base[offset + 2];
    const x = previous[offset];
    const y = previous[offset + 1];
    const z = previous[offset + 2];
    const [gx, gy, gz] = sculptGridCoord(x, y, z, cfg.hashGridDimension);
    let neighborCount = 0;
    let neighborX = 0;
    let neighborY = 0;
    let neighborZ = 0;

    for (let dz = -1; dz <= 1; dz += 1) {
      const cz = gz + dz;
      if (cz < 0 || cz >= cfg.hashGridDimension) continue;
      for (let dy = -1; dy <= 1; dy += 1) {
        const cy = gy + dy;
        if (cy < 0 || cy >= cfg.hashGridDimension) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          const cx = gx + dx;
          if (cx < 0 || cx >= cfg.hashGridDimension) continue;
          const cell = cx + cy * cfg.hashGridDimension + cz * cfg.hashGridDimension * cfg.hashGridDimension;
          const stored = Math.min(grid.cellCounts[cell], cfg.hashGridCellCapacity);
          for (let slot = 0; slot < stored; slot += 1) {
            const other = grid.cellEntries[cell * cfg.hashGridCellCapacity + slot];
            if (other === 0xffffffff || other === i) continue;
            const otherOffset = other * 4;
            const ox = previous[otherOffset];
            const oy = previous[otherOffset + 1];
            const oz = previous[otherOffset + 2];
            const ddx = ox - x;
            const ddy = oy - y;
            const ddz = oz - z;
            if (ddx * ddx + ddy * ddy + ddz * ddz <= neighborRadius * neighborRadius) {
              neighborCount += 1;
              neighborX += ox;
              neighborY += oy;
              neighborZ += oz;
            }
          }
        }
      }
    }

    neighborSampleCount += neighborCount;
    let pushX = (baseX - x) * 0.010;
    let pushY = (baseY - y) * 0.012;
    let pushZ = (baseZ - z) * 0.010;
    let contact = 0;
    const bdx = x - normalizedBrush.center[0];
    const bdy = y - normalizedBrush.center[1];
    const bdz = z - normalizedBrush.center[2];
    const brushDistance = Math.sqrt(bdx * bdx + bdy * bdy + bdz * bdz);
    const reach = clamp01(1 - brushDistance / normalizedBrush.radius);
    if (reach > 0) {
      const force = reach * reach * normalizedBrush.strength;
      const invDistance = 1 / Math.max(brushDistance, 0.025);
      pushX += normalizedBrush.normal[0] * force * 0.088 + bdx * invDistance * force * 0.022;
      pushY += normalizedBrush.normal[1] * force * 0.088 + bdy * invDistance * force * 0.022;
      pushZ += normalizedBrush.normal[2] * force * 0.088 + bdz * invDistance * force * 0.022;
      contact = 1;
    }
    if (neighborCount > 0 && reach > 0.001) {
      const cx = neighborX / neighborCount;
      const cy = neighborY / neighborCount;
      const cz = neighborZ / neighborCount;
      const cohesionScale = (0.020 + reach * 0.020) * reach;
      const cohesionX = (cx - x) * cohesionScale;
      const cohesionY = (cy - y) * cohesionScale;
      const cohesionZ = (cz - z) * cohesionScale;
      pushX += cohesionX;
      pushY += cohesionY;
      pushZ += cohesionZ;
      neighborCohesionDisplacement += Math.sqrt(cohesionX * cohesionX + cohesionY * cohesionY + cohesionZ * cohesionZ);
    }

    const nx = clampFinite(x + pushX, -CLAY_SCULPT_EXTENTS.halfX * 1.12, CLAY_SCULPT_EXTENTS.halfX * 1.12, baseX);
    const ny = clampFinite(y + pushY, -0.10, CLAY_SCULPT_EXTENTS.maxY * 1.10, baseY);
    const nz = clampFinite(z + pushZ, -CLAY_SCULPT_EXTENTS.halfZ * 1.12, CLAY_SCULPT_EXTENTS.halfZ * 1.12, baseZ);
    const disp = Math.sqrt((nx - baseX) ** 2 + (ny - baseY) ** 2 + (nz - baseZ) ** 2);
    if (disp > 0.002) deformedParticleCount += 1;
    if (contact > 0) contactParticleCount += 1;
    maxDisplacement = Math.max(maxDisplacement, disp);
    next[offset] = nx;
    next[offset + 1] = ny;
    next[offset + 2] = nz;
    next[offset + 3] = contact;
  }

  return {
    solverIdentity: SCULPT_SOLVER_IDENTITY,
    evidenceKind: CLAY_SCULPT_ORACLE_EVIDENCE_KIND,
    hashGridEvidenceKind: CLAY_SCULPT_HASH_GRID_EVIDENCE_KIND,
    hashGridContract: CLAY_SCULPT_HASH_GRID_CONTRACT,
    positions: next,
    particleCount: cfg.particleCount,
    activeCellCount: grid.activeCellCount,
    maxCellOccupancy: grid.maxCellOccupancy,
    overflowCount: grid.overflowCount,
    neighborSampleCount,
    averageNeighborCount: neighborSampleCount / Math.max(1, cfg.particleCount),
    contactParticleCount,
    deformedParticleCount,
    maxDisplacement,
    neighborCohesionDisplacement,
  };
}

export function normalizeClayCubePointerCollider(payload = {}) {
  const center = Array.isArray(payload.center) ? payload.center : [payload.x, payload.y, payload.z];
  const rawCenter = Array.isArray(payload.rawCenter) ? payload.rawCenter : center;
  const rawX = clampFinite(center[0], -1.2, 1.2, 0);
  const rawY = clampFinite(center[1], -1.2, 1.2, CLAY_CUBE_EXTENTS.maxY * 0.5);
  const rawZ = clampFinite(center[2], -1.2, 1.2, 0);
  const clampedX = clampFinite(rawX, -CLAY_CUBE_EXTENTS.halfX, CLAY_CUBE_EXTENTS.halfX, 0);
  const clampedY = clampFinite(rawY, CLAY_CUBE_EXTENTS.minY, CLAY_CUBE_EXTENTS.maxY, CLAY_CUBE_EXTENTS.maxY * 0.5);
  const clampedZ = clampFinite(rawZ, -CLAY_CUBE_EXTENTS.halfZ, CLAY_CUBE_EXTENTS.halfZ, 0);
  return {
    id: payload.id || 'cube-pointer-drag',
    center: [clampedX, clampedY, clampedZ],
    rawCenter: rawCenter.slice(0, 3).map(value => Number.isFinite(Number(value)) ? Number(value) : null),
    surfaceNormal: normalizeVec3(payload.surfaceNormal, [0, -1, 0]),
    radius: clampFinite(payload.radius, 0.035, 0.35, 0.18),
    strength: clampFinite(payload.strength, 0, 5, 1.15),
    source: payload.source || 'cube-pointer',
    sourceBackend: payload.sourceBackend || null,
    sampleAuthority: Number.isFinite(payload.sampleAuthority) ? payload.sampleAuthority : null,
    pressureAxis: Number.isFinite(payload.pressureAxis) ? payload.pressureAxis : null,
    pressureScale: Number.isFinite(payload.pressureScale) ? payload.pressureScale : null,
    boundaryClamped: Math.abs(clampedX - rawX) > 1e-6
      || Math.abs(clampedY - rawY) > 1e-6
      || Math.abs(clampedZ - rawZ) > 1e-6,
    boundaryMargin: [0, 0, 0],
  };
}

export function normalizeClaySculptPointerCollider(payload = {}) {
  const center = Array.isArray(payload.center) ? payload.center : [payload.x, payload.y, payload.z];
  const rawCenter = Array.isArray(payload.rawCenter) ? payload.rawCenter : center;
  const rawX = clampFinite(center[0], -1.2, 1.2, 0);
  const rawY = clampFinite(center[1], -1.2, 1.2, CLAY_SCULPT_EXTENTS.maxY * 0.5);
  const rawZ = clampFinite(center[2], -1.2, 1.2, 0);
  const clampedX = clampFinite(rawX, -CLAY_SCULPT_EXTENTS.halfX, CLAY_SCULPT_EXTENTS.halfX, 0);
  const clampedY = clampFinite(rawY, CLAY_SCULPT_EXTENTS.minY, CLAY_SCULPT_EXTENTS.maxY, CLAY_SCULPT_EXTENTS.maxY * 0.5);
  const clampedZ = clampFinite(rawZ, -CLAY_SCULPT_EXTENTS.halfZ, CLAY_SCULPT_EXTENTS.halfZ, 0);
  return {
    id: payload.id || 'sculpt-pointer-drag',
    center: [clampedX, clampedY, clampedZ],
    rawCenter: rawCenter.slice(0, 3).map(value => Number.isFinite(Number(value)) ? Number(value) : null),
    surfaceNormal: normalizeVec3(payload.surfaceNormal, [0, 0, -1]),
    radius: clampFinite(payload.radius, 0.035, 0.45, 0.18),
    strength: clampFinite(payload.strength, 0, 5, 1.15),
    source: payload.source || 'sculpt-pointer',
    sourceBackend: payload.sourceBackend || null,
    sampleAuthority: Number.isFinite(payload.sampleAuthority) ? payload.sampleAuthority : null,
    pressureAxis: Number.isFinite(payload.pressureAxis) ? payload.pressureAxis : null,
    pressureScale: Number.isFinite(payload.pressureScale) ? payload.pressureScale : null,
    boundaryClamped: Math.abs(clampedX - rawX) > 1e-6
      || Math.abs(clampedY - rawY) > 1e-6
      || Math.abs(clampedZ - rawZ) > 1e-6,
    boundaryMargin: [0, 0, 0],
  };
}

function cubeGridCellIndex(x, y, z, gridDimension) {
  const gx = Math.max(0, Math.min(gridDimension - 1, Math.floor(((x / (CLAY_CUBE_EXTENTS.halfX * 2)) + 0.5) * gridDimension)));
  const gy = Math.max(0, Math.min(gridDimension - 1, Math.floor(((y - CLAY_CUBE_EXTENTS.minY) / (CLAY_CUBE_EXTENTS.maxY - CLAY_CUBE_EXTENTS.minY)) * gridDimension)));
  const gz = Math.max(0, Math.min(gridDimension - 1, Math.floor(((z / (CLAY_CUBE_EXTENTS.halfZ * 2)) + 0.5) * gridDimension)));
  return gx + gy * gridDimension + gz * gridDimension * gridDimension;
}

function cubeNearestFace(baseX, baseY, baseZ, band) {
  const distances = [
    ['front', Math.abs(CLAY_CUBE_EXTENTS.halfZ - baseZ)],
    ['back', Math.abs(baseZ + CLAY_CUBE_EXTENTS.halfZ)],
    ['left', Math.abs(baseX + CLAY_CUBE_EXTENTS.halfX)],
    ['right', Math.abs(CLAY_CUBE_EXTENTS.halfX - baseX)],
    ['top', Math.abs(CLAY_CUBE_EXTENTS.maxY - baseY)],
    ['bottom', Math.abs(baseY - CLAY_CUBE_EXTENTS.minY)],
  ].sort((a, b) => a[1] - b[1]);
  return distances[0][1] <= band ? distances[0][0] : 'interior';
}

function computeCubeFaceMetrics({ basePositions, cubeValues, config, colliders = [] }) {
  const cfg = config?.particleCount ? config : normalizeClayCubeConfig();
  const xBand = (CLAY_CUBE_EXTENTS.halfX * 2 / Math.max(1, cfg.cubeX - 1)) * 0.6;
  const yBand = ((CLAY_CUBE_EXTENTS.maxY - CLAY_CUBE_EXTENTS.minY) / Math.max(1, cfg.cubeY - 1)) * 0.6;
  const zBand = (CLAY_CUBE_EXTENTS.halfZ * 2 / Math.max(1, cfg.cubeZ - 1)) * 0.6;
  const faceBand = Math.max(xBand, yBand, zBand);
  let frontFaceDeformedParticleCount = 0;
  let backFaceDeformedParticleCount = 0;
  let edgeBandDeformedParticleCount = 0;
  let cornerBandDeformedParticleCount = 0;
  let maxDisplacement = -1;
  let maxDisplacementFace = 'interior';
  let deformationWeight = 0;
  let deformationX = 0;
  let deformationY = 0;
  let deformationZ = 0;
  let contactWeight = 0;
  let contactX = 0;
  let contactY = 0;
  let contactZ = 0;
  let brushWeight = 0;
  let brushX = 0;
  let brushY = 0;
  let brushZ = 0;

  for (const collider of colliders.slice(0, MAX_COLLIDERS)) {
    const center = Array.isArray(collider?.center) ? collider.center : [0, 0, 0];
    const strength = Math.max(0.0001, Math.abs(Number(collider?.effectiveStrength ?? collider?.strength ?? 1)) || 1);
    brushWeight += strength;
    brushX += center[0] * strength;
    brushY += center[1] * strength;
    brushZ += center[2] * strength;
  }

  for (let i = 0; i < cfg.particleCount; i += 1) {
    const offset = i * 4;
    const baseX = basePositions[offset];
    const baseY = basePositions[offset + 1];
    const baseZ = basePositions[offset + 2];
    const x = cubeValues[offset];
    const y = cubeValues[offset + 1];
    const z = cubeValues[offset + 2];
    const contact = cubeValues[offset + 3];
    const dx = x - baseX;
    const dy = y - baseY;
    const dz = z - baseZ;
    const displacement = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const deformed = displacement > 0.002;
    const onFront = Math.abs(CLAY_CUBE_EXTENTS.halfZ - baseZ) <= zBand;
    const onBack = Math.abs(baseZ + CLAY_CUBE_EXTENTS.halfZ) <= zBand;
    const boundaryAxes = [
      Math.min(Math.abs(baseX + CLAY_CUBE_EXTENTS.halfX), Math.abs(CLAY_CUBE_EXTENTS.halfX - baseX)) <= xBand,
      Math.min(Math.abs(baseY - CLAY_CUBE_EXTENTS.minY), Math.abs(CLAY_CUBE_EXTENTS.maxY - baseY)) <= yBand,
      Math.min(Math.abs(baseZ + CLAY_CUBE_EXTENTS.halfZ), Math.abs(CLAY_CUBE_EXTENTS.halfZ - baseZ)) <= zBand,
    ].filter(Boolean).length;

    if (deformed) {
      if (onFront) frontFaceDeformedParticleCount += 1;
      if (onBack) backFaceDeformedParticleCount += 1;
      if (boundaryAxes >= 2) edgeBandDeformedParticleCount += 1;
      if (boundaryAxes >= 3) cornerBandDeformedParticleCount += 1;
      deformationWeight += displacement;
      deformationX += x * displacement;
      deformationY += y * displacement;
      deformationZ += z * displacement;
    }
    if (contact > 0.5) {
      contactWeight += contact;
      contactX += x * contact;
      contactY += y * contact;
      contactZ += z * contact;
    }
    if (displacement > maxDisplacement) {
      maxDisplacement = displacement;
      maxDisplacementFace = cubeNearestFace(baseX, baseY, baseZ, faceBand);
    }
  }

  const deformationCentroid = deformationWeight > 0
    ? [deformationX / deformationWeight, deformationY / deformationWeight, deformationZ / deformationWeight]
    : null;
  const contactCentroid = contactWeight > 0
    ? [contactX / contactWeight, contactY / contactWeight, contactZ / contactWeight]
    : null;
  const brushCentroid = brushWeight > 0
    ? [brushX / brushWeight, brushY / brushWeight, brushZ / brushWeight]
    : null;
  const distance = (a, b) => a && b
    ? Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2)
    : null;

  return {
    faceMetricEvidenceKind: CLAY_CUBE_FACE_METRIC_EVIDENCE_KIND,
    frontFaceDeformedParticleCount,
    backFaceDeformedParticleCount,
    frontBackDeformationRatio: frontFaceDeformedParticleCount / Math.max(1, backFaceDeformedParticleCount),
    edgeBandDeformedParticleCount,
    cornerBandDeformedParticleCount,
    maxDisplacementFace,
    deformationCentroid,
    contactCentroid,
    brushCentroid,
    brushToDeformationCentroidDistance: distance(brushCentroid, deformationCentroid),
    brushToContactCentroidDistance: distance(brushCentroid, contactCentroid),
  };
}

export function runClayCubeFirstLoopOracle({
  basePositions,
  previousPositions = basePositions,
  config = normalizeClayCubeConfig(),
  colliders = [],
} = {}) {
  const cfg = config?.particleCount ? config : normalizeClayCubeConfig();
  const base = basePositions instanceof Float32Array ? basePositions : seedClayCubeMaterialPoints(cfg);
  const previous = previousPositions instanceof Float32Array && previousPositions.length === base.length ? previousPositions : base;
  const next = new Float32Array(base.length);
  const normalizedColliders = colliders.slice(0, MAX_COLLIDERS).map(normalizedCubeCollider);
  const activeCells = new Set();
  let deformedParticleCount = 0;
  let contactParticleCount = 0;
  let maxDisplacement = 0;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < cfg.particleCount; i += 1) {
    const offset = i * 4;
    const baseX = base[offset];
    const baseY = base[offset + 1];
    const baseZ = base[offset + 2];
    let x = previous[offset];
    let y = previous[offset + 1];
    let z = previous[offset + 2];
    let contact = 0;
    let pushX = 0;
    let pushY = 0;
    let pushZ = 0;

    for (const collider of normalizedColliders) {
      const dx = x - collider.center[0];
      const dy = y - collider.center[1];
      const dz = z - collider.center[2];
      const radius = Math.max(collider.radius, 0.001);
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const reach = clamp01(1 - dist / radius);
      const surfaceNormal = normalizeVec3(collider.surfaceNormal, [0, -1, 0]);
      const normalOffset = dx * surfaceNormal[0] + dy * surfaceNormal[1] + dz * surfaceNormal[2];
      const tangentX = dx - surfaceNormal[0] * normalOffset;
      const tangentY = dy - surfaceNormal[1] * normalOffset;
      const tangentZ = dz - surfaceNormal[2] * normalOffset;
      const tangentDistance = Math.sqrt(tangentX * tangentX + tangentY * tangentY + tangentZ * tangentZ);
      const structuralReach = clamp01(1 - tangentDistance / (radius * 1.35))
        * clamp01(1 - Math.abs(normalOffset) / (radius * 0.85));
      const boundaryX = Math.abs(Math.abs(baseX) - CLAY_CUBE_EXTENTS.halfX) <= 1e-5;
      const boundaryY = Math.abs(baseY - CLAY_CUBE_EXTENTS.minY) <= 1e-5 || Math.abs(baseY - CLAY_CUBE_EXTENTS.maxY) <= 1e-5;
      const boundaryZ = Math.abs(Math.abs(baseZ) - CLAY_CUBE_EXTENTS.halfZ) <= 1e-5;
      const boundaryAxes = Number(boundaryX) + Number(boundaryY) + Number(boundaryZ);
      const boundaryWeight = boundaryAxes >= 3 ? 0.55 : boundaryAxes >= 2 ? 0.35 : 0;
      let touched = false;
      if (reach > 0) {
        const force = reach * reach * collider.strength;
        const invDist = 1 / Math.max(dist, 0.025);
        pushX += dx * invDist * force * 0.028;
        pushX += surfaceNormal[0] * force * 0.082;
        pushY += surfaceNormal[1] * force * 0.082;
        pushZ += dz * invDist * force * 0.028;
        pushZ += surfaceNormal[2] * force * 0.082;
        touched = true;
      }
      if (boundaryWeight > 0 && structuralReach > 0) {
        const structuralForce = structuralReach * structuralReach * collider.strength * boundaryWeight;
        pushX += surfaceNormal[0] * structuralForce * 0.082;
        pushY += surfaceNormal[1] * structuralForce * 0.082;
        pushZ += surfaceNormal[2] * structuralForce * 0.082;
        const axisForce = structuralReach * structuralReach * collider.strength * (boundaryAxes >= 3 ? 0.055 : 0.032);
        if (boundaryX) pushX += (baseX > 0 ? -1 : 1) * axisForce;
        if (boundaryY) pushY += (baseY > (CLAY_CUBE_EXTENTS.minY + CLAY_CUBE_EXTENTS.maxY) * 0.5 ? -1 : 1) * axisForce;
        if (boundaryZ) pushZ += (baseZ > 0 ? -1 : 1) * axisForce;
        touched = true;
      }
      if (touched) contact += 1;
    }

    x += pushX;
    y += pushY;
    z += pushZ;
    x = clampFinite(x, -CLAY_CUBE_EXTENTS.halfX * 1.08, CLAY_CUBE_EXTENTS.halfX * 1.08, baseX);
    y = clampFinite(y, -0.08, CLAY_CUBE_EXTENTS.maxY * 1.04, baseY);
    z = clampFinite(z, -CLAY_CUBE_EXTENTS.halfZ * 1.08, CLAY_CUBE_EXTENTS.halfZ * 1.08, baseZ);

    const dx = x - baseX;
    const dy = y - baseY;
    const dz = z - baseZ;
    const displacement = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (displacement > 0.002) deformedParticleCount += 1;
    if (contact > 0) contactParticleCount += 1;
    maxDisplacement = Math.max(maxDisplacement, displacement);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    activeCells.add(cubeGridCellIndex(x, y, z, cfg.gridDimension));
    next[offset] = x;
    next[offset + 1] = y;
    next[offset + 2] = z;
    next[offset + 3] = contact;
  }

  const faceMetrics = computeCubeFaceMetrics({
    basePositions: base,
    cubeValues: next,
    config: cfg,
    colliders: normalizedColliders,
  });

  return {
    evidenceKind: CLAY_CUBE_ORACLE_EVIDENCE_KIND,
    surfaceVisible: CLAY_CUBE_SURFACE_VISIBLE,
    diagnosticColorMode: CLAY_CUBE_DIAGNOSTIC_COLOR_MODE,
    diagnosticColoredParticleCount: deformedParticleCount,
    diagnosticHotParticleCount: contactParticleCount,
    positions: next,
    particleCount: cfg.particleCount,
    gridDimension: cfg.gridDimension,
    activeGridCellCount: activeCells.size,
    deformedParticleCount,
    contactParticleCount,
    maxDisplacement,
    minY,
    maxY,
    heightRange: maxY - minY,
    ...faceMetrics,
  };
}

function normalizeCollider(collider, index) {
  const center = Array.isArray(collider?.center) ? collider.center : [0, 0, 0];
  const radius = clampFinite(collider?.radius, 0.035, 0.35, 0.12);
  const xMargin = Math.min(CLAY_SURFACE_HALF_X * 0.9, radius * CLAY_BRUSH_BOUNDARY_RADIUS_MARGIN);
  const zMargin = Math.min(CLAY_SURFACE_HALF_Z * 0.9, radius * CLAY_BRUSH_BOUNDARY_RADIUS_MARGIN);
  const rawX = clampFinite(center[0], -1.2, 1.2, 0);
  const rawY = clampFinite(center[1], -1.2, 1.2, 0);
  const rawZ = clampFinite(center[2], -1.2, 1.2, 0);
  const clampedX = clampFinite(rawX, -CLAY_SURFACE_HALF_X + xMargin, CLAY_SURFACE_HALF_X - xMargin, 0);
  const clampedZ = clampFinite(rawZ, -CLAY_SURFACE_HALF_Z + zMargin, CLAY_SURFACE_HALF_Z - zMargin, 0);
  return {
    id: collider?.id || `clay-fixture-${index}`,
    center: [clampedX, rawY, clampedZ],
    radius,
    strength: clampFinite(collider?.strength, 0, 5, 1),
    source: collider?.source || null,
    sourceBackend: collider?.sourceBackend || null,
    sampleAuthority: Number.isFinite(collider?.sampleAuthority) ? collider.sampleAuthority : null,
    pressureAxis: Number.isFinite(collider?.pressureAxis) ? collider.pressureAxis : null,
    pressureScale: Number.isFinite(collider?.pressureScale) ? collider.pressureScale : null,
    boundaryClamped: Math.abs(clampedX - rawX) > 1e-6 || Math.abs(clampedZ - rawZ) > 1e-6,
    boundaryMargin: [xMargin, zMargin],
  };
}

function clayComputeShader() {
  return /* wgsl */`
struct Params {
  vertexCount: u32,
  colliderCount: u32,
  stepIndex: u32,
  _pad: u32,
};

@group(0) @binding(0) var<storage, read> basePositions: array<vec4f>;
@group(0) @binding(1) var<storage, read> colliders: array<vec4f>;
@group(0) @binding(2) var<storage, read> statePositions: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> deformedPositions: array<vec4f>;
@group(0) @binding(4) var<uniform> params: Params;

@compute @workgroup_size(64)
fn clay_surface_lattice_main(@builtin(global_invocation_id) global_id: vec3u) {
  let i = global_id.x;
  if (i >= params.vertexCount) {
    return;
  }
  let base = basePositions[i];
  var depression = 0.0;
  var lift = 0.0;
  var contact = 0.0;
  for (var c = 0u; c < 8u; c = c + 1u) {
    if (c >= params.colliderCount) {
      break;
    }
    let collider = colliders[c];
    let delta = vec2f(base.x - collider.x, base.z - collider.y);
    let dist = length(delta);
    let radius = max(collider.z, 0.001);
    let reach = clamp(1.0 - dist / radius, 0.0, 1.0);
    let rim = clamp(1.0 - abs(dist - radius * 0.72) / (radius * 0.36), 0.0, 1.0);
    let boundaryDistance = min(0.825 - abs(base.x), 0.525 - abs(base.z));
    let boundaryGuard = smoothstep(0.0, radius * 0.75, boundaryDistance);
    let force = collider.w;
    depression = depression - reach * reach * force * 0.18 * boundaryGuard;
    lift = lift + rim * rim * force * 0.035 * boundaryGuard;
    contact = contact + select(0.0, 1.0, reach > 0.001);
  }
  let previous = statePositions[i];
  let mound = 0.035 * exp(-2.2 * dot(base.xz, base.xz));
  let targetY = mound + depression + lift;
  let relaxedY = previous.y + (targetY - previous.y) * ${CLAY_RELAXATION_FACTOR.toFixed(8)};
  let y = clamp(relaxedY + depression * ${CLAY_PLASTICITY_FACTOR.toFixed(8)}, -0.32, 0.16);
  deformedPositions[i] = vec4f(base.x, y, base.z, contact);
}
`;
}

function clayCubeComputeShader() {
  return /* wgsl */`
struct CubeParams {
  particleCount: u32,
  colliderCount: u32,
  stepIndex: u32,
  gridDimension: u32,
};

@group(0) @binding(0) var<storage, read> basePositions: array<vec4f>;
@group(0) @binding(1) var<storage, read> cubeColliders: array<vec4f>;
@group(0) @binding(2) var<storage, read> cubeColliderForces: array<vec4f>;
@group(0) @binding(3) var<storage, read> statePositions: array<vec4f>;
@group(0) @binding(4) var<storage, read_write> outputPositions: array<vec4f>;
@group(0) @binding(5) var<uniform> params: CubeParams;

@compute @workgroup_size(64)
fn clay_material_point_cube_first_loop_main(@builtin(global_invocation_id) global_id: vec3u) {
  let i = global_id.x;
  if (i >= params.particleCount) {
    return;
  }
  let base = basePositions[i];
  var p = statePositions[i];
  var push = vec3f(0.0);
  var contact = 0.0;
  for (var c = 0u; c < 8u; c = c + 1u) {
    if (c >= params.colliderCount) {
      break;
    }
    let collider = cubeColliders[c];
    let forceLane = cubeColliderForces[c];
    let radius = max(collider.w, 0.001);
    let delta = p.xyz - collider.xyz;
    let dist = length(delta);
    let reach = clamp(1.0 - dist / radius, 0.0, 1.0);
    let surfaceNormal = normalize(forceLane.yzw);
    let normalOffset = dot(delta, surfaceNormal);
    let tangentDelta = delta - surfaceNormal * normalOffset;
    let structuralReach = clamp(1.0 - length(tangentDelta) / (radius * 1.35), 0.0, 1.0)
      * clamp(1.0 - abs(normalOffset) / (radius * 0.85), 0.0, 1.0);
    var boundaryAxes = 0.0;
    if (abs(abs(base.x) - ${CLAY_CUBE_EXTENTS.halfX.toFixed(8)}) <= 0.00001) {
      boundaryAxes = boundaryAxes + 1.0;
    }
    if (abs(base.y - ${CLAY_CUBE_EXTENTS.minY.toFixed(8)}) <= 0.00001 || abs(base.y - ${CLAY_CUBE_EXTENTS.maxY.toFixed(8)}) <= 0.00001) {
      boundaryAxes = boundaryAxes + 1.0;
    }
    if (abs(abs(base.z) - ${CLAY_CUBE_EXTENTS.halfZ.toFixed(8)}) <= 0.00001) {
      boundaryAxes = boundaryAxes + 1.0;
    }
    let boundaryAxisDirection = vec3f(
      select(0.0, -sign(base.x), abs(abs(base.x) - ${CLAY_CUBE_EXTENTS.halfX.toFixed(8)}) <= 0.00001),
      select(0.0, select(1.0, -1.0, base.y > ${(CLAY_CUBE_EXTENTS.minY + CLAY_CUBE_EXTENTS.maxY) * 0.5}), abs(base.y - ${CLAY_CUBE_EXTENTS.minY.toFixed(8)}) <= 0.00001 || abs(base.y - ${CLAY_CUBE_EXTENTS.maxY.toFixed(8)}) <= 0.00001),
      select(0.0, -sign(base.z), abs(abs(base.z) - ${CLAY_CUBE_EXTENTS.halfZ.toFixed(8)}) <= 0.00001)
    );
    var boundaryWeight = 0.0;
    if (boundaryAxes >= 3.0) {
      boundaryWeight = 0.55;
    } else if (boundaryAxes >= 2.0) {
      boundaryWeight = 0.35;
    }
    var touched = false;
    if (reach > 0.0) {
      let force = reach * reach * forceLane.x;
      let direction = delta / max(dist, 0.025);
      push = push + (vec3f(direction.x * 0.028, 0.0, direction.z * 0.028) + surfaceNormal * 0.082) * force;
      touched = true;
    }
    if (boundaryWeight > 0.0 && structuralReach > 0.0) {
      let structuralForce = structuralReach * structuralReach * forceLane.x * boundaryWeight;
      push = push + surfaceNormal * 0.082 * structuralForce;
      let axisForce = structuralReach * structuralReach * forceLane.x * select(0.032, 0.055, boundaryAxes >= 3.0);
      push = push + boundaryAxisDirection * axisForce;
      touched = true;
    }
    if (touched) {
      contact = contact + 1.0;
    }
  }
  var next = p.xyz + push;
  next.x = clamp(next.x, ${(-CLAY_CUBE_EXTENTS.halfX * 1.08).toFixed(8)}, ${(CLAY_CUBE_EXTENTS.halfX * 1.08).toFixed(8)});
  next.y = clamp(next.y, -0.08000000, ${(CLAY_CUBE_EXTENTS.maxY * 1.04).toFixed(8)});
  next.z = clamp(next.z, ${(-CLAY_CUBE_EXTENTS.halfZ * 1.08).toFixed(8)}, ${(CLAY_CUBE_EXTENTS.halfZ * 1.08).toFixed(8)});
  outputPositions[i] = vec4f(next, contact);
}
`;
}

function claySculptHashGridShader() {
  return /* wgsl */`
struct SculptParams {
  particleCount: u32,
  hashGridDimension: u32,
  hashGridCellCapacity: u32,
  phase: u32,
};

@group(0) @binding(0) var<storage, read> basePositions: array<vec4f>;
@group(0) @binding(1) var<storage, read> statePositions: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> outputPositions: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> cellCounts: array<atomic<u32>>;
@group(0) @binding(4) var<storage, read_write> cellEntries: array<atomic<u32>>;
@group(0) @binding(5) var<storage, read_write> metrics: array<atomic<u32>>;
@group(0) @binding(6) var<storage, read> brush: array<vec4f>;
@group(0) @binding(7) var<uniform> params: SculptParams;

fn grid_coord(p: vec3f) -> vec3u {
  let dim = params.hashGridDimension;
  let maxIndex = f32(dim - 1u);
  let gx = u32(clamp(floor(((p.x / ${(CLAY_SCULPT_EXTENTS.halfX * 2).toFixed(8)}) + 0.5) * f32(dim)), 0.0, maxIndex));
  let gy = u32(clamp(floor(((p.y - ${CLAY_SCULPT_EXTENTS.minY.toFixed(8)}) / ${(CLAY_SCULPT_EXTENTS.maxY - CLAY_SCULPT_EXTENTS.minY).toFixed(8)}) * f32(dim)), 0.0, maxIndex));
  let gz = u32(clamp(floor(((p.z / ${(CLAY_SCULPT_EXTENTS.halfZ * 2).toFixed(8)}) + 0.5) * f32(dim)), 0.0, maxIndex));
  return vec3u(gx, gy, gz);
}

fn cell_index(c: vec3u) -> u32 {
  return c.x + c.y * params.hashGridDimension + c.z * params.hashGridDimension * params.hashGridDimension;
}

fn safe_normal(v: vec3f) -> vec3f {
  let len = length(v);
  if (len <= 0.000001) {
    return vec3f(0.0, 0.0, -1.0);
  }
  return v / len;
}

@compute @workgroup_size(64)
fn clay_particle_sculpt_hash_grid_main(@builtin(global_invocation_id) global_id: vec3u) {
  let i = global_id.x;
  let cellCount = params.hashGridDimension * params.hashGridDimension * params.hashGridDimension;
  let entryCount = cellCount * params.hashGridCellCapacity;
  if (params.phase == 0u) {
    if (i < cellCount) {
      atomicStore(&cellCounts[i], 0u);
    }
    if (i < entryCount) {
      atomicStore(&cellEntries[i], 0xffffffffu);
    }
    if (i < 8u) {
      atomicStore(&metrics[i], 0u);
    }
    return;
  }
  if (i >= params.particleCount) {
    return;
  }
  if (params.phase == 1u) {
    let p = statePositions[i].xyz;
    let cell = cell_index(grid_coord(p));
    let slot = atomicAdd(&cellCounts[cell], 1u);
    if (slot == 0u) {
      atomicAdd(&metrics[0], 1u);
    }
    atomicMax(&metrics[1], slot + 1u);
    if (slot < params.hashGridCellCapacity) {
      atomicStore(&cellEntries[cell * params.hashGridCellCapacity + slot], i);
    } else {
      atomicAdd(&metrics[2], 1u);
    }
    return;
  }

  let base = basePositions[i];
  let p = statePositions[i];
  let coord = grid_coord(p.xyz);
  let neighborRadius = ${Math.max(
    CLAY_SCULPT_EXTENTS.halfX * 2 / 11,
    (CLAY_SCULPT_EXTENTS.maxY - CLAY_SCULPT_EXTENTS.minY) / 7,
    CLAY_SCULPT_EXTENTS.halfZ * 2 / 11,
  ).toFixed(8)} * 1.65;
  var neighborCount = 0u;
  var neighborSum = vec3f(0.0);
  for (var oz = -1; oz <= 1; oz = oz + 1) {
    let cz = i32(coord.z) + oz;
    if (cz < 0 || cz >= i32(params.hashGridDimension)) {
      continue;
    }
    for (var oy = -1; oy <= 1; oy = oy + 1) {
      let cy = i32(coord.y) + oy;
      if (cy < 0 || cy >= i32(params.hashGridDimension)) {
        continue;
      }
      for (var ox = -1; ox <= 1; ox = ox + 1) {
        let cx = i32(coord.x) + ox;
        if (cx < 0 || cx >= i32(params.hashGridDimension)) {
          continue;
        }
        let cell = cell_index(vec3u(u32(cx), u32(cy), u32(cz)));
        let stored = min(atomicLoad(&cellCounts[cell]), params.hashGridCellCapacity);
        for (var slot = 0u; slot < stored; slot = slot + 1u) {
          let other = atomicLoad(&cellEntries[cell * params.hashGridCellCapacity + slot]);
          if (other == 0xffffffffu || other == i) {
            continue;
          }
          let q = statePositions[other].xyz;
          let delta = q - p.xyz;
          if (dot(delta, delta) <= neighborRadius * neighborRadius) {
            neighborCount = neighborCount + 1u;
            neighborSum = neighborSum + q;
          }
        }
      }
    }
  }

  let brushCenter = brush[0].xyz;
  let brushRadius = max(brush[0].w, 0.001);
  let brushNormal = safe_normal(brush[1].xyz);
  let brushStrength = brush[1].w;
  let brushDelta = p.xyz - brushCenter;
  let brushDistance = length(brushDelta);
  let reach = clamp(1.0 - brushDistance / brushRadius, 0.0, 1.0);
  var push = (base.xyz - p.xyz) * vec3f(0.010, 0.012, 0.010);
  var contact = 0.0;
  if (reach > 0.0) {
    let force = reach * reach * brushStrength;
    push = push + brushNormal * force * 0.088 + safe_normal(brushDelta) * force * 0.022;
    contact = 1.0;
  }
  if (neighborCount > 0u && reach > 0.001) {
    let centroid = neighborSum / f32(neighborCount);
    let cohesion = (centroid - p.xyz) * ((0.020 + reach * 0.020) * reach);
    push = push + cohesion;
    atomicAdd(&metrics[6], u32(clamp(length(cohesion) * 1000000.0, 0.0, 4294967040.0)));
  }
  var next = p.xyz + push;
  next.x = clamp(next.x, ${(-CLAY_SCULPT_EXTENTS.halfX * 1.12).toFixed(8)}, ${(CLAY_SCULPT_EXTENTS.halfX * 1.12).toFixed(8)});
  next.y = clamp(next.y, -0.10000000, ${(CLAY_SCULPT_EXTENTS.maxY * 1.10).toFixed(8)});
  next.z = clamp(next.z, ${(-CLAY_SCULPT_EXTENTS.halfZ * 1.12).toFixed(8)}, ${(CLAY_SCULPT_EXTENTS.halfZ * 1.12).toFixed(8)});
  let disp = length(next - base.xyz);
  if (contact > 0.5) {
    atomicAdd(&metrics[3], 1u);
  }
  if (disp > 0.002) {
    atomicAdd(&metrics[4], 1u);
  }
  atomicAdd(&metrics[5], neighborCount);
  outputPositions[i] = vec4f(next, contact);
}
`;
}

export function createKaminosClayPrototype({
  THREE,
  scene,
  viewport,
  camera,
  controls,
  MarchingCubes = null,
  clayGrid = DEFAULT_CLAY_GRID,
  clayCube = false,
  clayCubeGrid = DEFAULT_CLAY_CUBE,
  claySurfaceSourceDebug = false,
  claySculpt = false,
  claySculptParticles = DEFAULT_CLAY_SCULPT_PARTICLES,
  onStatus = () => {},
}) {
  const gridConfig = normalizeClayGridConfig(clayGrid);
  const cubeConfig = normalizeClayCubeConfig(clayCubeGrid);
  const sculptConfig = normalizeClaySculptConfig(claySculptParticles);
  const gridX = gridConfig.gridX;
  const gridZ = gridConfig.gridZ;
  const clayCubeEnabled = !!clayCube;
  const claySculptEnabled = !!claySculpt;
  const clayCubeSurfaceSourceDebugEnabled = clayCubeEnabled && !!claySurfaceSourceDebug;
  let active = false;
  let device = null;
  let gpuReadyPromise = null;
  let sharedPrimitiveProbePromise = null;
  let pipeline = null;
  let bindGroup = null;
  let baseBuffer = null;
  let colliderBuffer = null;
  let paramsBuffer = null;
  let stateBuffer = null;
  let outputBuffer = null;
  let readbackBuffer = null;
  let cubePipeline = null;
  let cubeBindGroup = null;
  let cubeBaseBuffer = null;
  let cubeColliderBuffer = null;
  let cubeColliderForceBuffer = null;
  let cubeParamsBuffer = null;
  let cubeStateBuffer = null;
  let cubeOutputBuffer = null;
  let cubeReadbackBuffer = null;
  let sculptPipeline = null;
  let sculptBindGroup = null;
  let sculptBaseBuffer = null;
  let sculptStateBuffer = null;
  let sculptOutputBuffer = null;
  let sculptReadbackBuffer = null;
  let sculptCellCountsBuffer = null;
  let sculptCellEntriesBuffer = null;
  let sculptMetricsBuffer = null;
  let sculptMetricsReadbackBuffer = null;
  let sculptBrushBuffer = null;
  let sculptParamsBuffer = null;
  let mesh = null;
  let cubePointCloud = null;
  let sculptPointCloud = null;
  let sculptBoundarySkin = null;
  let sculptBoundarySkinSourceIndices = [];
  let sculptIsoSurface = null;
  let cubeBoundingBox = null;
  let cubeIsoSurface = null;
  let cubeBoundarySkin = null;
  let cubeBoundarySkinSourceIndices = [];
  let colliderGroup = null;
  let colliders = [];
  let frameCount = 0;
  let gpuStepCount = 0;
  let clayDeformationCount = 0;
  let clayContactCount = 0;
  let clayDeformationMax = 0;
  let claySurfaceMinY = 0;
  let claySurfaceMaxY = 0;
  let claySurfaceHeightRange = 0;
  let claySurfaceMeanAbsHeight = 0;
  let clayDebugCollidersVisible = true;
  let clayInteractionMode = 'idle';
  let clayPointerActive = false;
  let clayPointerColliderCount = 0;
  let clayPointerDragStepCount = 0;
  let clayPointerLastHit = null;
  let clayPointerDepthPolicy = null;
  const sculptSurfaceRayOrigin = new THREE.Vector3();
  const sculptSurfaceRayDirection = new THREE.Vector3();
  const sculptSurfaceRayA = new THREE.Vector3();
  const sculptSurfaceRayB = new THREE.Vector3();
  const sculptSurfaceRayC = new THREE.Vector3();
  const sculptSurfaceRayEdge1 = new THREE.Vector3();
  const sculptSurfaceRayEdge2 = new THREE.Vector3();
  const sculptSurfaceRayH = new THREE.Vector3();
  const sculptSurfaceRayS = new THREE.Vector3();
  const sculptSurfaceRayQ = new THREE.Vector3();
  const sculptSurfaceRayPoint = new THREE.Vector3();
  const sculptSurfaceWorldNormal = new THREE.Vector3();
  let clayBrushBoundaryClampCount = 0;
  const clayBrushBoundaryWarnings = [];
  const clayTimingEvidenceSource = 'webgpu-step-readback-wall-time';
  const clayTimingDisclaimer = 'includes primitive-contact and clay readback; not gpu-exclusive-or-present-latency';
  const clayPhaseTimingDisclaimer = 'performance.now wall timings; lattice phase includes dispatch/readback sync and is not GPU timestamp-query kernel time';
  const CLAY_TIMING_WARMUP_STEP_COUNT = 3;
  const clayTimingWarmupPolicy = 'first-three-steps-treated-as-warmup';
  const clayStepDurationHistory = [];
  const claySteadyStepDurationHistory = [];
  let clayStepLatestMs = 0;
  let clayStepP95Ms = 0;
  let claySteadyStepP50Ms = 0;
  let claySteadyStepP95Ms = 0;
  let clayStepMaxOutlierMs = 0;
  let clayContactWallMs = 0;
  let clayColliderPrepWallMs = 0;
  let clayLatticeReadbackWallMs = 0;
  let clayCpuMeshUpdateMs = 0;
  let clayNormalUpdateMs = 0;
  let clayNormalCadence = 'every_step';
  let clayNormalUpdateCount = 0;
  let clayNormalSkippedCount = 0;
  let clayNormalsStale = false;
  const clayNormalCadenceWarnings = [];
  let clayStepTotalWallMs = 0;
  let clayCpuShadowBenchmarkEnabled = false;
  let clayCpuShadowEstimateMs = 0;
  let clayCpuShadowRatio = null;
  let clayCpuShadowSampleCount = 0;
  let clayCpuShadowChecksum = 0;
  let clayCpuContactShadowEstimateMs = 0;
  let clayCpuContactShadowRatio = null;
  let clayCpuContactShadowSampleCount = 0;
  let clayCpuContactShadowChecksum = 0;
  let sharedPrimitiveProbeStatus = 'not-run';
  let sharedPrimitiveProbeDistanceSq = null;
  let sharedPrimitiveProbeFeature = null;
  let sharedPrimitiveProbeTriangleIndex = null;
  let primitiveContactPassStatus = 'not-run';
  let primitiveContactJobCount = 0;
  let primitiveContactActiveCount = 0;
  let primitiveContactMinDistance = null;
  let primitiveContactForceSum = 0;
  let persistentClayStateStatus = 'not-run';
  let persistentClayStepCount = 0;
  let persistentClayMaxDelta = 0;
  const persistentClayDeltaHistory = [];
  let persistentClayInitialDelta = null;
  let persistentClayLatestDelta = null;
  let persistentClaySettlingRatio = null;
  let clayCubeStepStatus = clayCubeEnabled ? 'not-run' : 'disabled';
  let clayCubeEvidenceKind = clayCubeEnabled ? 'webgpu-material-point-readback' : 'disabled';
  let clayCubeParticleCount = cubeConfig.particleCount;
  let clayCubeActiveGridCellCount = 0;
  let clayCubeDeformedParticleCount = 0;
  let clayCubeContactParticleCount = 0;
  let clayCubeMaxDisplacement = 0;
  let clayCubeMinY = 0;
  let clayCubeMaxY = 0;
  let clayCubeHeightRange = 0;
  let clayCubeReadbackWallMs = 0;
  let clayCubeDispatchWorkgroups = 0;
  let clayCubeSurfaceVisible = clayCubeEnabled ? CLAY_CUBE_SURFACE_VISIBLE : true;
  let clayCubeBoundingBoxVisible = clayCubeEnabled;
  let clayCubeDiagnosticColoredParticleCount = 0;
  let clayCubeDiagnosticHotParticleCount = 0;
  let clayCubeIsoSurfaceVisible = false;
  let clayCubeIsoSurfaceEvidenceKind = clayCubeEnabled && MarchingCubes
    ? CLAY_CUBE_ISO_SURFACE_EVIDENCE_KIND
    : 'disabled';
  let clayCubeIsoSurfaceVisibilityPolicy = clayCubeEnabled ? CLAY_CUBE_ISO_SURFACE_VISIBILITY_POLICY : 'disabled';
  let clayCubeIsoSurfaceResolution = clayCubeEnabled && MarchingCubes ? CLAY_CUBE_ISO_SURFACE_RESOLUTION : 0;
  let clayCubeIsoSurfaceBallCount = 0;
  let clayCubeIsoSurfaceTriangleCount = 0;
  let clayCubeIsoSurfaceNeedsRefresh = false;
  let clayCubeBoundarySkinVisible = clayCubeEnabled;
  let clayCubeBoundarySkinEvidenceKind = clayCubeEnabled ? CLAY_CUBE_BOUNDARY_SKIN_EVIDENCE_KIND : 'disabled';
  let clayCubeBoundarySkinVisualMode = clayCubeEnabled ? CLAY_CUBE_BOUNDARY_SKIN_VISUAL_MODE : 'disabled';
  let clayCubeBoundarySkinVertexCount = 0;
  let clayCubeBoundarySkinTriangleCount = 0;
  let clayCubeBoundarySkinSharedVertexCount = 0;
  let clayCubeVisibleSurfaceSource = clayCubeEnabled ? CLAY_CUBE_VISIBLE_SURFACE_SOURCE : 'disabled';
  let clayCubeSurfaceSourceDebug = clayCubeSurfaceSourceDebugEnabled ? CLAY_CUBE_SURFACE_SOURCE_DEBUG_MODE : 'disabled';
  let clayCubeBoundarySkinFairingPolicy = clayCubeEnabled ? CLAY_CUBE_BOUNDARY_SKIN_FAIRING_POLICY : 'disabled';
  let clayCubeBoundarySkinCullingPolicy = clayCubeEnabled ? CLAY_CUBE_BOUNDARY_SKIN_CULLING_POLICY : 'disabled';
  let clayCubeBoundarySkinCulledTriangleCount = 0;
  let clayCubeBoundarySkinRawRoughness = 0;
  let clayCubeBoundarySkinRoughness = 0;
  let clayCubeBoundarySkinMaxFairingDisplacement = 0;
  let clayCubeFaceMetricEvidenceKind = clayCubeEnabled ? CLAY_CUBE_FACE_METRIC_EVIDENCE_KIND : 'disabled';
  let clayCubeFrontFaceDeformedParticleCount = 0;
  let clayCubeBackFaceDeformedParticleCount = 0;
  let clayCubeFrontBackDeformationRatio = 0;
  let clayCubeEdgeBandDeformedParticleCount = 0;
  let clayCubeCornerBandDeformedParticleCount = 0;
  let clayCubeMaxDisplacementFace = 'interior';
  let clayCubeDeformationCentroid = null;
  let clayCubeContactCentroid = null;
  let clayCubeBrushCentroid = null;
  let clayCubeBrushToDeformationCentroidDistance = null;
  let clayCubeBrushToContactCentroidDistance = null;
  let lastCubeStateValues = null;
  let claySculptStepStatus = claySculptEnabled ? 'not-run' : 'disabled';
  let claySculptEvidenceKind = claySculptEnabled ? CLAY_SCULPT_WEBGPU_EVIDENCE_KIND : 'disabled';
  let claySculptParticleCount = sculptConfig.particleCount;
  let claySculptActiveCellCount = 0;
  let claySculptMaxCellOccupancy = 0;
  let claySculptOverflowCount = 0;
  let claySculptContactParticleCount = 0;
  let claySculptDeformedParticleCount = 0;
  let claySculptNeighborSampleCount = 0;
  let claySculptAverageNeighborCount = 0;
  let claySculptNeighborCohesionDisplacement = 0;
  let claySculptMaxDisplacement = 0;
  let claySculptReadbackWallMs = 0;
  let claySculptDispatchWorkgroups = 0;
  let claySculptPointCloudVisible = claySculptEnabled;
  let claySculptSurfaceVisible = false;
  let claySculptSurfaceEvidenceKind = claySculptEnabled ? CLAY_SCULPT_SURFACE_EVIDENCE_KIND : 'disabled';
  let claySculptSurfaceVisualMode = claySculptEnabled ? CLAY_SCULPT_SURFACE_VISUAL_MODE : 'disabled';
  let claySculptSurfaceResolution = 0;
  let claySculptSurfaceBallCount = 0;
  let claySculptSurfaceVertexCount = 0;
  let claySculptSurfaceTriangleCount = 0;
  let claySculptSurfaceNeedsRefresh = false;
  let claySculptSurfaceUpdateCount = 0;
  let claySculptSurfaceSkippedUpdateCount = 0;
  let claySculptSurfaceLastRefreshStep = -CLAY_SCULPT_SURFACE_UPDATE_STEP_INTERVAL;
  let lastSculptStateValues = null;
  let handPoseAdapterState = normalizeClayHandPoseColliders({});
  const clayRelaxationFactor = CLAY_RELAXATION_FACTOR;
  const clayPlasticityFactor = CLAY_PLASTICITY_FACTOR;
  let lastError = '';
  const vertexCount = gridX * gridZ;
  const basePositions = new Float32Array(vertexCount * 4);
  const cubeBasePositions = seedClayCubeMaterialPoints(cubeConfig);
  const sculptBasePositions = seedClaySculptParticles(sculptConfig);
  const sculptCellCount = sculptConfig.hashGridDimension ** 3;
  const sculptEntryCount = sculptCellCount * sculptConfig.hashGridCellCapacity;
  let lastStateValues = null;

  for (let z = 0; z < gridZ; z += 1) {
    for (let x = 0; x < gridX; x += 1) {
      const i = z * gridX + x;
      basePositions[i * 4] = (x / (gridX - 1) - 0.5) * 1.65;
      basePositions[i * 4 + 1] = 0;
      basePositions[i * 4 + 2] = (z / (gridZ - 1) - 0.5) * 1.05;
      basePositions[i * 4 + 3] = 1;
    }
  }

  function ensureMesh() {
    if (mesh) return;
    const geometry = new THREE.PlaneGeometry(1.65, 1.05, gridX - 1, gridZ - 1);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.MeshStandardMaterial({
      color: 0x8f6f4a,
      roughness: 0.82,
      metalness: 0,
      side: THREE.DoubleSide,
      transparent: clayCubeEnabled || claySculptEnabled,
      opacity: clayCubeEnabled || claySculptEnabled ? 0.30 : 1,
    });
    mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'kaminos-clay-surface-lattice';
    mesh.position.set(0, 0.02, 0);
    mesh.renderOrder = 4;
    scene.add(mesh);

    colliderGroup = new THREE.Group();
    colliderGroup.name = 'kaminos-clay-collider-debug';
    scene.add(colliderGroup);

    if (clayCubeEnabled) {
      const cubeGeometry = new THREE.BufferGeometry();
      const cubePositions = new Float32Array(cubeConfig.particleCount * 3);
      const cubeColors = new Float32Array(cubeConfig.particleCount * 3);
      for (let i = 0; i < cubeConfig.particleCount; i += 1) {
        cubePositions[i * 3] = cubeBasePositions[i * 4];
        cubePositions[i * 3 + 1] = cubeBasePositions[i * 4 + 1];
        cubePositions[i * 3 + 2] = cubeBasePositions[i * 4 + 2];
        cubeColors[i * 3] = 0.76;
        cubeColors[i * 3 + 1] = 0.59;
        cubeColors[i * 3 + 2] = 0.36;
      }
      cubeGeometry.setAttribute('position', new THREE.BufferAttribute(cubePositions, 3));
      cubeGeometry.setAttribute('color', new THREE.BufferAttribute(cubeColors, 3));
      const cubeMaterial = new THREE.PointsMaterial({
        size: 0.066,
        sizeAttenuation: true,
        vertexColors: true,
        transparent: true,
        opacity: 0.92,
        depthTest: false,
        depthWrite: false,
      });
      cubePointCloud = new THREE.Points(cubeGeometry, cubeMaterial);
      cubePointCloud.name = 'kaminos-clay-material-point-cube-first-loop';
      cubePointCloud.renderOrder = 5;
      scene.add(cubePointCloud);

      const skinMaterial = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.86,
        metalness: 0,
        vertexColors: true,
        transparent: true,
        opacity: 0.54,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      cubeBoundarySkin = new THREE.Mesh(createCubeBoundarySkinGeometry(), skinMaterial);
      cubeBoundarySkin.name = 'kaminos-clay-cube-diagnostic-boundary-skin';
      cubeBoundarySkin.renderOrder = 4;
      scene.add(cubeBoundarySkin);

      if (MarchingCubes) {
        const isoMaterial = new THREE.MeshStandardMaterial({
          color: 0xb88f5d,
          roughness: 0.9,
          metalness: 0,
          transparent: true,
          opacity: 0.42,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        cubeIsoSurface = new MarchingCubes(
          CLAY_CUBE_ISO_SURFACE_RESOLUTION,
          isoMaterial,
          false,
          false,
          42000,
        );
        cubeIsoSurface.name = 'kaminos-clay-cube-diagnostic-marching-cubes-surface';
        cubeIsoSurface.isolation = CLAY_CUBE_ISO_SURFACE_ISOLATION;
        cubeIsoSurface.scale.set(
          CLAY_CUBE_EXTENTS.halfX,
          (CLAY_CUBE_EXTENTS.maxY - CLAY_CUBE_EXTENTS.minY) * 0.5,
          CLAY_CUBE_EXTENTS.halfZ,
        );
        cubeIsoSurface.position.set(0, (CLAY_CUBE_EXTENTS.minY + CLAY_CUBE_EXTENTS.maxY) * 0.5, 0);
        cubeIsoSurface.renderOrder = 4;
        scene.add(cubeIsoSurface);
      }

      const boxGeometry = new THREE.BoxGeometry(
        CLAY_CUBE_EXTENTS.halfX * 2,
        CLAY_CUBE_EXTENTS.maxY - CLAY_CUBE_EXTENTS.minY,
        CLAY_CUBE_EXTENTS.halfZ * 2,
      );
      const boxEdges = new THREE.EdgesGeometry(boxGeometry);
      const boxMaterial = new THREE.LineBasicMaterial({
        color: 0xd6b57a,
        transparent: true,
        opacity: 0.48,
        depthTest: false,
      });
      cubeBoundingBox = new THREE.LineSegments(boxEdges, boxMaterial);
      cubeBoundingBox.name = 'kaminos-clay-cube-diagnostic-bounding-box';
      cubeBoundingBox.position.set(0, (CLAY_CUBE_EXTENTS.minY + CLAY_CUBE_EXTENTS.maxY) * 0.5, 0);
      cubeBoundingBox.renderOrder = 6;
      scene.add(cubeBoundingBox);
    }
    if (claySculptEnabled) {
      const sculptGeometry = new THREE.BufferGeometry();
      const sculptPositions = new Float32Array(sculptConfig.particleCount * 3);
      const sculptColors = new Float32Array(sculptConfig.particleCount * 3);
      for (let i = 0; i < sculptConfig.particleCount; i += 1) {
        sculptPositions[i * 3] = sculptBasePositions[i * 4];
        sculptPositions[i * 3 + 1] = sculptBasePositions[i * 4 + 1];
        sculptPositions[i * 3 + 2] = sculptBasePositions[i * 4 + 2];
        sculptColors[i * 3] = 0.73;
        sculptColors[i * 3 + 1] = 0.55;
        sculptColors[i * 3 + 2] = 0.34;
      }
      sculptGeometry.setAttribute('position', new THREE.BufferAttribute(sculptPositions, 3));
      sculptGeometry.setAttribute('color', new THREE.BufferAttribute(sculptColors, 3));
      const sculptMaterial = new THREE.PointsMaterial({
        size: 0.041,
        sizeAttenuation: true,
        vertexColors: true,
        transparent: true,
        opacity: 0.54,
        depthTest: true,
        depthWrite: false,
      });
      sculptPointCloud = new THREE.Points(sculptGeometry, sculptMaterial);
      sculptPointCloud.name = 'kaminos-clay-particle-sculpt-hash-grid';
      sculptPointCloud.renderOrder = 6;
      scene.add(sculptPointCloud);
      const sculptSkinMaterial = new THREE.MeshStandardMaterial({
        color: 0xb9905d,
        roughness: 0.9,
        metalness: 0,
        vertexColors: true,
        transparent: true,
        opacity: 0.86,
        side: THREE.DoubleSide,
        depthWrite: true,
      });
      sculptBoundarySkin = new THREE.Mesh(createSculptBoundarySkinGeometry(), sculptSkinMaterial);
      sculptBoundarySkin.name = 'kaminos-clay-sculpt-diagnostic-boundary-skin';
      sculptBoundarySkin.renderOrder = 4;
      scene.add(sculptBoundarySkin);
    }
  }

  function sculptParticleIndex(x, y, z) {
    return y * sculptConfig.sculptZ * sculptConfig.sculptX + z * sculptConfig.sculptX + x;
  }

  function createCubeBoundarySkinGeometry() {
    const colors = [];
    const frame = buildClayCubeBoundarySkinFrame({
      basePositions: cubeBasePositions,
      positions: cubeBasePositions,
      config: cubeConfig,
      fair: false,
    });
    for (let i = 0; i < frame.vertexCount; i += 1) {
      colors.push(0.74, 0.56, 0.34);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(frame.positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
    geometry.setIndex(frame.indices);
    geometry.computeVertexNormals();
    cubeBoundarySkinSourceIndices = frame.sourceIndices;
    clayCubeBoundarySkinVertexCount = frame.vertexCount;
    clayCubeBoundarySkinSharedVertexCount = frame.vertexCount;
    clayCubeBoundarySkinTriangleCount = frame.triangleCount;
    clayCubeBoundarySkinCullingPolicy = frame.cullingPolicy;
    clayCubeBoundarySkinCulledTriangleCount = frame.culledTriangleCount;
    clayCubeBoundarySkinFairingPolicy = frame.fairingPolicy;
    clayCubeBoundarySkinRawRoughness = frame.rawMaxBoundarySkinRoughness;
    clayCubeBoundarySkinRoughness = frame.maxBoundarySkinRoughness;
    clayCubeBoundarySkinMaxFairingDisplacement = frame.maxFairingDisplacement;
    return geometry;
  }

  function createSculptBoundarySkinGeometry() {
    const positions = [];
    const colors = [];
    const indices = [];
    const sourceIndices = [];
    const sourceToVertex = new Map();

    const pushVertex = sourceIndex => {
      const existing = sourceToVertex.get(sourceIndex);
      if (existing !== undefined) return existing;
      const offset = sourceIndex * 4;
      sourceIndices.push(sourceIndex);
      positions.push(sculptBasePositions[offset], sculptBasePositions[offset + 1], sculptBasePositions[offset + 2]);
      colors.push(0.72, 0.54, 0.34);
      const vertexIndex = sourceIndices.length - 1;
      sourceToVertex.set(sourceIndex, vertexIndex);
      return vertexIndex;
    };

    const pushQuad = (a, b, c, d) => {
      indices.push(a, b, c, c, b, d);
    };

    for (let y = 0; y < sculptConfig.sculptY - 1; y += 1) {
      for (let x = 0; x < sculptConfig.sculptX - 1; x += 1) {
        pushQuad(
          pushVertex(sculptParticleIndex(x, y, 0)),
          pushVertex(sculptParticleIndex(x + 1, y, 0)),
          pushVertex(sculptParticleIndex(x, y + 1, 0)),
          pushVertex(sculptParticleIndex(x + 1, y + 1, 0)),
        );
        pushQuad(
          pushVertex(sculptParticleIndex(x + 1, y, sculptConfig.sculptZ - 1)),
          pushVertex(sculptParticleIndex(x, y, sculptConfig.sculptZ - 1)),
          pushVertex(sculptParticleIndex(x + 1, y + 1, sculptConfig.sculptZ - 1)),
          pushVertex(sculptParticleIndex(x, y + 1, sculptConfig.sculptZ - 1)),
        );
      }
    }

    for (let y = 0; y < sculptConfig.sculptY - 1; y += 1) {
      for (let z = 0; z < sculptConfig.sculptZ - 1; z += 1) {
        pushQuad(
          pushVertex(sculptParticleIndex(0, y, z + 1)),
          pushVertex(sculptParticleIndex(0, y, z)),
          pushVertex(sculptParticleIndex(0, y + 1, z + 1)),
          pushVertex(sculptParticleIndex(0, y + 1, z)),
        );
        pushQuad(
          pushVertex(sculptParticleIndex(sculptConfig.sculptX - 1, y, z)),
          pushVertex(sculptParticleIndex(sculptConfig.sculptX - 1, y, z + 1)),
          pushVertex(sculptParticleIndex(sculptConfig.sculptX - 1, y + 1, z)),
          pushVertex(sculptParticleIndex(sculptConfig.sculptX - 1, y + 1, z + 1)),
        );
      }
    }

    for (let z = 0; z < sculptConfig.sculptZ - 1; z += 1) {
      for (let x = 0; x < sculptConfig.sculptX - 1; x += 1) {
        pushQuad(
          pushVertex(sculptParticleIndex(x, 0, z + 1)),
          pushVertex(sculptParticleIndex(x + 1, 0, z + 1)),
          pushVertex(sculptParticleIndex(x, 0, z)),
          pushVertex(sculptParticleIndex(x + 1, 0, z)),
        );
        pushQuad(
          pushVertex(sculptParticleIndex(x, sculptConfig.sculptY - 1, z)),
          pushVertex(sculptParticleIndex(x + 1, sculptConfig.sculptY - 1, z)),
          pushVertex(sculptParticleIndex(x, sculptConfig.sculptY - 1, z + 1)),
          pushVertex(sculptParticleIndex(x + 1, sculptConfig.sculptY - 1, z + 1)),
        );
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    sculptBoundarySkinSourceIndices = sourceIndices;
    claySculptSurfaceVertexCount = sourceIndices.length;
    claySculptSurfaceTriangleCount = indices.length / 3;
    return geometry;
  }

  function refreshColliderMeshes() {
    if (!colliderGroup) return;
    colliderGroup.clear();
    for (const collider of colliders) {
      const geometry = new THREE.SphereGeometry(collider.radius, 16, 10);
      const material = new THREE.MeshBasicMaterial({
        color: 0x8eb6ff,
        wireframe: true,
        transparent: true,
        opacity: clayDebugCollidersVisible ? 0.68 : 0.12,
        depthWrite: false,
      });
      const sphere = new THREE.Mesh(geometry, material);
      sphere.position.set(collider.center[0], 0.11, collider.center[2]);
      sphere.visible = clayDebugCollidersVisible;
      sphere.name = `kaminos-clay-collider-${collider.id}`;
      colliderGroup.add(sphere);
    }
  }

  function refreshCubeIsoSurface(cubeValues) {
    if (!cubeIsoSurface || !cubeValues) {
      clayCubeIsoSurfaceVisible = false;
      clayCubeIsoSurfaceBallCount = 0;
      clayCubeIsoSurfaceTriangleCount = 0;
      return;
    }
    cubeIsoSurface.reset();
    clayCubeIsoSurfaceBallCount = 0;
    const invX = 1 / (CLAY_CUBE_EXTENTS.halfX * 2);
    const invY = 1 / (CLAY_CUBE_EXTENTS.maxY - CLAY_CUBE_EXTENTS.minY);
    const invZ = 1 / (CLAY_CUBE_EXTENTS.halfZ * 2);
    const stride = Math.max(1, Math.ceil(cubeConfig.particleCount / CLAY_CUBE_ISO_SURFACE_MAX_BALLS));
    for (let i = 0; i < cubeConfig.particleCount; i += stride) {
      const offset = i * 4;
      const x = (cubeValues[offset] + CLAY_CUBE_EXTENTS.halfX) * invX;
      const y = (cubeValues[offset + 1] - CLAY_CUBE_EXTENTS.minY) * invY;
      const z = (cubeValues[offset + 2] + CLAY_CUBE_EXTENTS.halfZ) * invZ;
      cubeIsoSurface.addBall(
        clamp01(x),
        clamp01(y),
        clamp01(z),
        CLAY_CUBE_ISO_SURFACE_STRENGTH,
        CLAY_CUBE_ISO_SURFACE_SUBTRACT,
      );
      clayCubeIsoSurfaceBallCount += 1;
    }
    cubeIsoSurface.update();
    clayCubeIsoSurfaceTriangleCount = Math.floor((cubeIsoSurface.count || 0) / 3);
    clayCubeIsoSurfaceVisible = clayCubeIsoSurfaceTriangleCount > 0 && !clayCubeBoundarySkinVisible;
    cubeIsoSurface.visible = clayCubeIsoSurfaceVisible;
  }

  function refreshSculptIsoSurface(sculptValues) {
    if (!sculptIsoSurface || !sculptValues) {
      claySculptSurfaceVisible = false;
      claySculptSurfaceBallCount = 0;
      claySculptSurfaceTriangleCount = 0;
      return;
    }
    sculptIsoSurface.reset();
    claySculptSurfaceBallCount = 0;
    const invX = 1 / (CLAY_SCULPT_EXTENTS.halfX * 2);
    const invY = 1 / (CLAY_SCULPT_EXTENTS.maxY - CLAY_SCULPT_EXTENTS.minY);
    const invZ = 1 / (CLAY_SCULPT_EXTENTS.halfZ * 2);
    const stride = Math.max(1, Math.ceil(sculptConfig.particleCount / CLAY_SCULPT_SURFACE_MAX_BALLS));
    for (let i = 0; i < sculptConfig.particleCount; i += stride) {
      const offset = i * 4;
      const contact = sculptValues[offset + 3];
      const x = (sculptValues[offset] + CLAY_SCULPT_EXTENTS.halfX) * invX;
      const y = (sculptValues[offset + 1] - CLAY_SCULPT_EXTENTS.minY) * invY;
      const z = (sculptValues[offset + 2] + CLAY_SCULPT_EXTENTS.halfZ) * invZ;
      const contactBoost = contact > 0.5 ? 1.18 : 1;
      sculptIsoSurface.addBall(
        clamp01(x),
        clamp01(y),
        clamp01(z),
        CLAY_SCULPT_SURFACE_STRENGTH * contactBoost,
        CLAY_SCULPT_SURFACE_SUBTRACT,
      );
      claySculptSurfaceBallCount += 1;
    }
    sculptIsoSurface.update();
    claySculptSurfaceTriangleCount = Math.floor((sculptIsoSurface.count || 0) / 3);
    claySculptSurfaceVisible = claySculptSurfaceTriangleCount > 0;
    claySculptSurfaceNeedsRefresh = false;
    claySculptSurfaceUpdateCount += 1;
    claySculptSurfaceLastRefreshStep = gpuStepCount;
    sculptIsoSurface.visible = claySculptSurfaceVisible;
  }

  function refreshSculptBoundarySkin(sculptValues) {
    const position = sculptBoundarySkin?.geometry?.attributes?.position || null;
    const color = sculptBoundarySkin?.geometry?.attributes?.color || null;
    if (!position || !sculptValues) {
      claySculptSurfaceVisible = false;
      claySculptSurfaceTriangleCount = 0;
      return;
    }
    for (let i = 0; i < sculptBoundarySkinSourceIndices.length; i += 1) {
      const sourceOffset = sculptBoundarySkinSourceIndices[i] * 4;
      const x = sculptValues[sourceOffset];
      const y = sculptValues[sourceOffset + 1];
      const z = sculptValues[sourceOffset + 2];
      const contact = sculptValues[sourceOffset + 3];
      position.setXYZ(i, x, y, z);
      if (color) {
        const dx = x - sculptBasePositions[sourceOffset];
        const dy = y - sculptBasePositions[sourceOffset + 1];
        const dz = z - sculptBasePositions[sourceOffset + 2];
        const displacement = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const heat = clamp01(displacement / 0.18);
        const contactHeat = contact > 0.5 ? 1 : 0;
        color.setXYZ(
          i,
          0.66 + contactHeat * 0.22 + heat * 0.08,
          0.50 + heat * 0.28,
          0.31 + (1 - contactHeat) * heat * 0.12,
        );
      }
    }
    position.needsUpdate = true;
    if (color) color.needsUpdate = true;
    sculptBoundarySkin.geometry.computeVertexNormals();
    claySculptSurfaceBallCount = 0;
    claySculptSurfaceVertexCount = sculptBoundarySkinSourceIndices.length;
    claySculptSurfaceTriangleCount = Math.floor((sculptBoundarySkin.geometry.index?.count || 0) / 3);
    claySculptSurfaceVisible = claySculptSurfaceTriangleCount > 0;
    claySculptSurfaceNeedsRefresh = false;
    claySculptSurfaceUpdateCount += 1;
    claySculptSurfaceLastRefreshStep = gpuStepCount;
    sculptBoundarySkin.visible = claySculptSurfaceVisible;
  }

  function refreshCubeBoundarySkin(cubeValues) {
    const position = cubeBoundarySkin?.geometry?.attributes?.position || null;
    const color = cubeBoundarySkin?.geometry?.attributes?.color || null;
    if (!position || !cubeValues) {
      clayCubeBoundarySkinVisible = false;
      return;
    }
    const frame = buildClayCubeBoundarySkinFrame({
      basePositions: cubeBasePositions,
      positions: cubeValues,
      config: cubeConfig,
      fair: true,
    });
    for (let i = 0; i < cubeBoundarySkinSourceIndices.length; i += 1) {
      const sourceOffset = cubeBoundarySkinSourceIndices[i] * 4;
      const frameOffset = i * 3;
      position.setXYZ(i, frame.positions[frameOffset], frame.positions[frameOffset + 1], frame.positions[frameOffset + 2]);
      if (color) {
        const dx = cubeValues[sourceOffset] - cubeBasePositions[sourceOffset];
        const dy = cubeValues[sourceOffset + 1] - cubeBasePositions[sourceOffset + 1];
        const dz = cubeValues[sourceOffset + 2] - cubeBasePositions[sourceOffset + 2];
        const displacement = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const heat = clamp01(displacement / 0.20);
        const contactHeat = cubeValues[sourceOffset + 3] > 0.5 ? 1 : 0;
        if (clayCubeSurfaceSourceDebugEnabled) {
          color.setXYZ(i, 0.32 + heat * 0.08, 0.76 + contactHeat * 0.18, 0.92);
        } else {
          color.setXYZ(
            i,
            0.63 + contactHeat * 0.25 + heat * 0.08,
            0.49 + heat * 0.25,
            0.32 - contactHeat * 0.06 + heat * 0.08,
          );
        }
      }
    }
    if (cubeBoundarySkin.geometry.index?.array !== frame.indices) {
      cubeBoundarySkin.geometry.setIndex(frame.indices);
    }
    cubeBoundarySkin.geometry.index.needsUpdate = true;
    position.needsUpdate = true;
    if (color) color.needsUpdate = true;
    cubeBoundarySkin.geometry.computeVertexNormals();
    clayCubeVisibleSurfaceSource = CLAY_CUBE_VISIBLE_SURFACE_SOURCE;
    clayCubeSurfaceSourceDebug = clayCubeSurfaceSourceDebugEnabled ? CLAY_CUBE_SURFACE_SOURCE_DEBUG_MODE : 'disabled';
    clayCubeBoundarySkinCullingPolicy = frame.cullingPolicy;
    clayCubeBoundarySkinCulledTriangleCount = frame.culledTriangleCount;
    clayCubeBoundarySkinTriangleCount = frame.triangleCount;
    clayCubeBoundarySkinFairingPolicy = frame.fairingPolicy;
    clayCubeBoundarySkinRawRoughness = frame.rawMaxBoundarySkinRoughness;
    clayCubeBoundarySkinRoughness = frame.maxBoundarySkinRoughness;
    clayCubeBoundarySkinMaxFairingDisplacement = frame.maxFairingDisplacement;
    clayCubeBoundarySkinVisible = true;
    cubeBoundarySkin.visible = true;
  }

  function setDebugCollidersVisible(nextVisible) {
    clayDebugCollidersVisible = !!nextVisible;
    if (!colliderGroup) return;
    colliderGroup.visible = active && clayDebugCollidersVisible;
    for (const child of colliderGroup.children) {
      child.visible = clayDebugCollidersVisible;
      if (child.material) child.material.opacity = clayDebugCollidersVisible ? 0.68 : 0.12;
    }
  }

  function setNormalCadence(nextCadence = 'every_step') {
    clayNormalCadenceWarnings.length = 0;
    const requested = String(nextCadence || 'every_step');
    if (requested === 'every_step' || requested === 'every_3' || requested === 'off') {
      clayNormalCadence = requested;
    } else {
      clayNormalCadence = 'every_step';
      clayNormalCadenceWarnings.push(`Unsupported clay normal cadence "${requested}"; using every_step`);
    }
    onStatus(debugState());
  }

  function shouldUpdateNormalsForStep() {
    if (clayNormalCadence === 'every_step') return true;
    if (clayNormalCadence === 'off') return false;
    if (clayNormalCadence === 'every_3') return gpuStepCount % 3 === 0;
    return true;
  }

  function normalizeColliderBatch(incoming) {
    clayBrushBoundaryWarnings.length = 0;
    let clampCount = 0;
    const normalized = incoming.slice(0, MAX_COLLIDERS).map((collider, index) => {
      const nextCollider = normalizeCollider(collider, index);
      if (nextCollider.boundaryClamped) {
        clampCount += 1;
        clayBrushBoundaryWarnings.push(`${CLAY_BRUSH_BOUNDARY_POLICY}:${nextCollider.id}`);
      }
      return nextCollider;
    });
    clayBrushBoundaryClampCount = clampCount;
    return normalized;
  }

  function latticeVertex(ix, iz) {
    const i = iz * gridX + ix;
    return [
      basePositions[i * 4],
      basePositions[i * 4 + 1],
      basePositions[i * 4 + 2],
    ];
  }

  function claySurfaceTriangleForCollider(collider) {
    const u = clamp01((collider.center[0] / 1.65) + 0.5);
    const v = clamp01((collider.center[2] / 1.05) + 0.5);
    const gx = Math.min(gridX - 2, Math.max(0, Math.floor(u * (gridX - 1))));
    const gz = Math.min(gridZ - 2, Math.max(0, Math.floor(v * (gridZ - 1))));
    const localX = (u * (gridX - 1)) - gx;
    const localZ = (v * (gridZ - 1)) - gz;
    const p00 = latticeVertex(gx, gz);
    const p10 = latticeVertex(gx + 1, gz);
    const p01 = latticeVertex(gx, gz + 1);
    const p11 = latticeVertex(gx + 1, gz + 1);
    const cellTriangleIndex = (gz * (gridX - 1) + gx) * 2;
    if (localX + localZ <= 1) {
      return { triangle: [p00, p10, p01], triangleIndex: cellTriangleIndex };
    }
    return { triangle: [p10, p11, p01], triangleIndex: cellTriangleIndex + 1 };
  }

  function runCpuShadowIteration(primitiveColliders, previousValues) {
    let checksum = 0;
    for (let i = 0; i < vertexCount; i += 1) {
      const offset = i * 4;
      const baseX = basePositions[offset];
      const baseZ = basePositions[offset + 2];
      let depression = 0;
      let lift = 0;
      let contact = 0;
      for (let c = 0; c < Math.min(MAX_COLLIDERS, primitiveColliders.length); c += 1) {
        const collider = primitiveColliders[c];
        const dx = baseX - collider.center[0];
        const dz = baseZ - collider.center[2];
        const dist = Math.sqrt(dx * dx + dz * dz);
        const radius = Math.max(collider.radius, 0.001);
        const reach = clamp01(1 - dist / radius);
        const rim = clamp01(1 - Math.abs(dist - radius * 0.72) / (radius * 0.36));
        const boundaryDistance = Math.min(CLAY_SURFACE_HALF_X - Math.abs(baseX), CLAY_SURFACE_HALF_Z - Math.abs(baseZ));
        const boundaryGuard = smoothstep(0, radius * 0.75, boundaryDistance);
        const force = collider.effectiveStrength;
        depression -= reach * reach * force * 0.18 * boundaryGuard;
        lift += rim * rim * force * 0.035 * boundaryGuard;
        contact += reach > 0.001 ? 1 : 0;
      }
      const previousY = previousValues[offset + 1];
      const mound = 0.035 * Math.exp(-2.2 * (baseX * baseX + baseZ * baseZ));
      const targetY = mound + depression + lift;
      const relaxedY = previousY + (targetY - previousY) * CLAY_RELAXATION_FACTOR;
      const y = Math.max(-0.32, Math.min(0.16, relaxedY + depression * CLAY_PLASTICITY_FACTOR));
      checksum += y + contact * 0.0001;
    }
    return checksum;
  }

  function estimateCpuShadowClayMs(primitiveColliders, previousValues) {
    const startedAt = performance.now();
    let checksum = 0;
    let iterations = 0;
    let elapsedMs = 0;
    do {
      checksum += runCpuShadowIteration(primitiveColliders, previousValues);
      iterations += 1;
      elapsedMs = performance.now() - startedAt;
    } while (elapsedMs < 0.75);
    clayCpuShadowChecksum = checksum;
    clayCpuShadowSampleCount = iterations;
    return elapsedMs / iterations;
  }

  function closestSegmentDistanceSq(point, a, b) {
    const abx = b[0] - a[0];
    const aby = b[1] - a[1];
    const abz = b[2] - a[2];
    const apx = point[0] - a[0];
    const apy = point[1] - a[1];
    const apz = point[2] - a[2];
    const denom = Math.max(abx * abx + aby * aby + abz * abz, 1e-8);
    const t = clamp01((apx * abx + apy * aby + apz * abz) / denom);
    const cx = a[0] + abx * t;
    const cy = a[1] + aby * t;
    const cz = a[2] + abz * t;
    const dx = point[0] - cx;
    const dy = point[1] - cy;
    const dz = point[2] - cz;
    return dx * dx + dy * dy + dz * dz;
  }

  function pointTriangleDistanceSqCpu(point, triangle) {
    const [a, b, c] = triangle;
    let best = Math.min(
      (point[0] - a[0]) ** 2 + (point[1] - a[1]) ** 2 + (point[2] - a[2]) ** 2,
      (point[0] - b[0]) ** 2 + (point[1] - b[1]) ** 2 + (point[2] - b[2]) ** 2,
      (point[0] - c[0]) ** 2 + (point[1] - c[1]) ** 2 + (point[2] - c[2]) ** 2,
      closestSegmentDistanceSq(point, a, b),
      closestSegmentDistanceSq(point, b, c),
      closestSegmentDistanceSq(point, c, a),
    );
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const ap = [point[0] - a[0], point[1] - a[1], point[2] - a[2]];
    const nx = ab[1] * ac[2] - ab[2] * ac[1];
    const ny = ab[2] * ac[0] - ab[0] * ac[2];
    const nz = ab[0] * ac[1] - ab[1] * ac[0];
    const nn = nx * nx + ny * ny + nz * nz;
    if (nn > 1e-8) {
      const signed = (ap[0] * nx + ap[1] * ny + ap[2] * nz) / nn;
      const projected = [point[0] - nx * signed, point[1] - ny * signed, point[2] - nz * signed];
      const v2 = [projected[0] - a[0], projected[1] - a[1], projected[2] - a[2]];
      const d00 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
      const d01 = ab[0] * ac[0] + ab[1] * ac[1] + ab[2] * ac[2];
      const d11 = ac[0] * ac[0] + ac[1] * ac[1] + ac[2] * ac[2];
      const d20 = v2[0] * ab[0] + v2[1] * ab[1] + v2[2] * ab[2];
      const d21 = v2[0] * ac[0] + v2[1] * ac[1] + v2[2] * ac[2];
      const denom = d00 * d11 - d01 * d01;
      if (Math.abs(denom) > 1e-8) {
        const bv = (d11 * d20 - d01 * d21) / denom;
        const bw = (d00 * d21 - d01 * d20) / denom;
        const bu = 1 - bv - bw;
        const faceDist = (point[0] - projected[0]) ** 2 + (point[1] - projected[1]) ** 2 + (point[2] - projected[2]) ** 2;
        if (bu >= -1e-7 && bv >= -1e-7 && bw >= -1e-7) best = Math.min(best, faceDist);
      }
    }
    return best;
  }

  function runCpuContactShadowIteration() {
    let checksum = 0;
    for (const collider of colliders.slice(0, MAX_COLLIDERS)) {
      const { triangle, triangleIndex } = claySurfaceTriangleForCollider(collider);
      const distance = Math.sqrt(Math.max(0, pointTriangleDistanceSqCpu(collider.center, triangle)));
      const contactScale = clamp01(1 - distance / Math.max(collider.radius, 0.001));
      checksum += triangleIndex + contactScale * collider.strength;
    }
    return checksum;
  }

  function estimateCpuContactShadowMs() {
    const startedAt = performance.now();
    let checksum = 0;
    let iterations = 0;
    let elapsedMs = 0;
    do {
      checksum += runCpuContactShadowIteration();
      iterations += 1;
      elapsedMs = performance.now() - startedAt;
    } while (elapsedMs < 0.75);
    clayCpuContactShadowChecksum = checksum;
    clayCpuContactShadowSampleCount = iterations;
    return elapsedMs / iterations;
  }

  async function runPointTriangleDistanceJobs(packedJobs, jobCount, label) {
    const resultBytes = POINT_TRIANGLE_RESULT_BYTES * jobCount;
    const jobBuffer = device.createBuffer({
      label: `${label}-point-triangle-jobs`,
      size: packedJobs.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const resultBuffer = device.createBuffer({
      label: `${label}-point-triangle-results`,
      size: resultBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    const jobReadback = device.createBuffer({
      label: `${label}-point-triangle-readback`,
      size: resultBytes,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    device.queue.writeBuffer(jobBuffer, 0, packedJobs);
    const pointTrianglePipeline = await device.createComputePipelineAsync({
      label: `${label}-point-triangle-pipeline`,
      layout: 'auto',
      compute: {
        module: device.createShaderModule({ code: pointTriangleDistanceWgsl }),
        entryPoint: 'point_triangle_distance_main',
      },
    });
    const pointTriangleBindGroup = device.createBindGroup({
      layout: pointTrianglePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: jobBuffer } },
        { binding: 1, resource: { buffer: resultBuffer } },
      ],
    });
    const encoder = device.createCommandEncoder({ label: `${label}-point-triangle` });
    const pass = encoder.beginComputePass({ label: `${label}-point-triangle-pass` });
    pass.setPipeline(pointTrianglePipeline);
    pass.setBindGroup(0, pointTriangleBindGroup);
    pass.dispatchWorkgroups(Math.ceil(jobCount / 64));
    pass.end();
    encoder.copyBufferToBuffer(resultBuffer, 0, jobReadback, 0, resultBytes);
    device.queue.submit([encoder.finish()]);
    await jobReadback.mapAsync(GPUMapMode.READ);
    const resultView = new DataView(jobReadback.getMappedRange());
    const results = [];
    for (let i = 0; i < jobCount; i += 1) {
      const offset = i * POINT_TRIANGLE_RESULT_BYTES;
      results.push({
        distanceSq: resultView.getFloat32(offset, true),
        feature: resultView.getUint32(offset + 4, true),
        triangleIndex: resultView.getUint32(offset + 8, true),
      });
    }
    jobReadback.unmap();
    return results;
  }

  async function runSharedPrimitiveProbe() {
    if (sharedPrimitiveProbeStatus === 'pass') return;
    if (sharedPrimitiveProbePromise) return sharedPrimitiveProbePromise;
    sharedPrimitiveProbePromise = (async () => {
      sharedPrimitiveProbeStatus = 'running';
      const jobs = packPointTriangleDistanceJobs([{
        point: [0.25, 0.25, 0.5],
        triangle: [
          [0, 0, 0],
          [1, 0, 0],
          [0, 1, 0],
        ],
        triangleIndex: SHARED_PRIMITIVE_PROBE_TRIANGLE_INDEX,
      }]);
      const [result] = await runPointTriangleDistanceJobs(jobs, 1, 'kaminos-clay-shared-probe');
      sharedPrimitiveProbeDistanceSq = result.distanceSq;
      sharedPrimitiveProbeFeature = result.feature;
      sharedPrimitiveProbeTriangleIndex = result.triangleIndex;
      const distanceOk = Math.abs(sharedPrimitiveProbeDistanceSq - SHARED_PRIMITIVE_PROBE_EXPECTED_DISTANCE_SQ) <= 1e-5;
      const featureOk = sharedPrimitiveProbeFeature === SHARED_PRIMITIVE_PROBE_EXPECTED_FEATURE;
      const identityOk = sharedPrimitiveProbeTriangleIndex === SHARED_PRIMITIVE_PROBE_TRIANGLE_INDEX;
      if (!distanceOk || !featureOk || !identityOk) {
        sharedPrimitiveProbeStatus = 'fail';
        lastError = `shared-primitive-probe-mismatch:${JSON.stringify({
          distanceSq: sharedPrimitiveProbeDistanceSq,
          feature: sharedPrimitiveProbeFeature,
          triangleIndex: sharedPrimitiveProbeTriangleIndex,
        })}`;
        throw new Error(lastError);
      }
      sharedPrimitiveProbeStatus = 'pass';
    })();
    try {
      await sharedPrimitiveProbePromise;
    } finally {
      sharedPrimitiveProbePromise = null;
    }
  }

  async function runPrimitiveContactPass() {
    primitiveContactJobCount = colliders.length;
    primitiveContactActiveCount = 0;
    primitiveContactMinDistance = null;
    primitiveContactForceSum = 0;
    if (!colliders.length) {
      primitiveContactPassStatus = 'idle';
      return [];
    }
    primitiveContactPassStatus = 'running';
    const contactJobs = colliders.map((collider) => {
      const { triangle, triangleIndex } = claySurfaceTriangleForCollider(collider);
      return { point: collider.center, triangle, triangleIndex };
    });
    const packedJobs = packPointTriangleDistanceJobs(contactJobs);
    const results = await runPointTriangleDistanceJobs(packedJobs, contactJobs.length, 'kaminos-clay-contact');
    const effectiveColliders = colliders.map((collider, index) => {
      const result = results[index];
      if (result.triangleIndex !== contactJobs[index].triangleIndex) {
        primitiveContactPassStatus = 'fail';
        lastError = `primitive-contact-triangle-identity-mismatch:${JSON.stringify({
          expected: contactJobs[index].triangleIndex,
          actual: result.triangleIndex,
        })}`;
        throw new Error(lastError);
      }
      const distance = Math.sqrt(Math.max(0, result.distanceSq));
      const contactScale = clamp01(1 - distance / Math.max(collider.radius, 0.001));
      const effectiveStrength = collider.strength * contactScale;
      if (contactScale > 0) primitiveContactActiveCount += 1;
      primitiveContactMinDistance = primitiveContactMinDistance === null
        ? distance
        : Math.min(primitiveContactMinDistance, distance);
      primitiveContactForceSum += effectiveStrength;
      return { ...collider, effectiveStrength };
    });
    primitiveContactPassStatus = 'pass';
    return effectiveColliders;
  }

  async function ensureGpu() {
    if (
      device
      && pipeline
      && bindGroup
      && (!clayCubeEnabled || (cubePipeline && cubeBindGroup))
      && (!claySculptEnabled || (sculptPipeline && sculptBindGroup))
    ) return;
    if (gpuReadyPromise) return gpuReadyPromise;
    gpuReadyPromise = (async () => {
      if (!navigator.gpu) {
        lastError = 'webgpu-unavailable-no-runtime-fallback';
        throw new Error(lastError);
      }
      if (!device) {
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) {
          lastError = 'webgpu-adapter-unavailable-no-runtime-fallback';
          throw new Error(lastError);
        }
        device = await adapter.requestDevice();
      }
      await runSharedPrimitiveProbe();
      if (pipeline && bindGroup) return;
      baseBuffer = device.createBuffer({
        label: 'kaminos-clay-base-positions',
        size: basePositions.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      colliderBuffer = device.createBuffer({
        label: 'kaminos-clay-colliders',
        size: MAX_COLLIDERS * 4 * Float32Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      paramsBuffer = device.createBuffer({
        label: 'kaminos-clay-params',
        size: 4 * Uint32Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      stateBuffer = device.createBuffer({
        label: 'kaminos-clay-persistent-state',
        size: basePositions.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
      });
      outputBuffer = device.createBuffer({
        label: 'kaminos-clay-deformed-positions',
        size: basePositions.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      });
      readbackBuffer = device.createBuffer({
        label: 'kaminos-clay-readback',
        size: basePositions.byteLength,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      device.queue.writeBuffer(baseBuffer, 0, basePositions);
      device.queue.writeBuffer(stateBuffer, 0, basePositions);
      pipeline = device.createComputePipeline({
        label: SOLVER_IDENTITY,
        layout: 'auto',
        compute: {
          module: device.createShaderModule({ code: clayComputeShader() }),
          entryPoint: 'clay_surface_lattice_main',
        },
      });
      bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: baseBuffer } },
          { binding: 1, resource: { buffer: colliderBuffer } },
          { binding: 2, resource: { buffer: stateBuffer } },
          { binding: 3, resource: { buffer: outputBuffer } },
          { binding: 4, resource: { buffer: paramsBuffer } },
        ],
      });
      if (clayCubeEnabled && !cubePipeline) {
        cubeBaseBuffer = device.createBuffer({
          label: 'kaminos-clay-cube-base-positions',
          size: cubeBasePositions.byteLength,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        cubeColliderBuffer = device.createBuffer({
          label: 'kaminos-clay-cube-colliders',
          size: MAX_COLLIDERS * 4 * Float32Array.BYTES_PER_ELEMENT,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        cubeColliderForceBuffer = device.createBuffer({
          label: 'kaminos-clay-cube-collider-forces',
          size: MAX_COLLIDERS * 4 * Float32Array.BYTES_PER_ELEMENT,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        cubeParamsBuffer = device.createBuffer({
          label: 'kaminos-clay-cube-params',
          size: 4 * Uint32Array.BYTES_PER_ELEMENT,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        cubeStateBuffer = device.createBuffer({
          label: 'kaminos-clay-cube-persistent-state',
          size: cubeBasePositions.byteLength,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
        });
        cubeOutputBuffer = device.createBuffer({
          label: 'kaminos-clay-cube-output-positions',
          size: cubeBasePositions.byteLength,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
        });
        cubeReadbackBuffer = device.createBuffer({
          label: 'kaminos-clay-cube-readback',
          size: cubeBasePositions.byteLength,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
        device.queue.writeBuffer(cubeBaseBuffer, 0, cubeBasePositions);
        device.queue.writeBuffer(cubeStateBuffer, 0, cubeBasePositions);
        cubePipeline = device.createComputePipeline({
          label: CUBE_SOLVER_IDENTITY,
          layout: 'auto',
          compute: {
            module: device.createShaderModule({ code: clayCubeComputeShader() }),
            entryPoint: 'clay_material_point_cube_first_loop_main',
          },
        });
        cubeBindGroup = device.createBindGroup({
          layout: cubePipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: cubeBaseBuffer } },
            { binding: 1, resource: { buffer: cubeColliderBuffer } },
            { binding: 2, resource: { buffer: cubeColliderForceBuffer } },
            { binding: 3, resource: { buffer: cubeStateBuffer } },
            { binding: 4, resource: { buffer: cubeOutputBuffer } },
            { binding: 5, resource: { buffer: cubeParamsBuffer } },
          ],
        });
      }
      if (claySculptEnabled && !sculptPipeline) {
        sculptBaseBuffer = device.createBuffer({
          label: 'kaminos-clay-sculpt-base-positions',
          size: sculptBasePositions.byteLength,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        sculptStateBuffer = device.createBuffer({
          label: 'kaminos-clay-sculpt-state-positions',
          size: sculptBasePositions.byteLength,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
        });
        sculptOutputBuffer = device.createBuffer({
          label: 'kaminos-clay-sculpt-output-positions',
          size: sculptBasePositions.byteLength,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
        });
        sculptReadbackBuffer = device.createBuffer({
          label: 'kaminos-clay-sculpt-readback',
          size: sculptBasePositions.byteLength,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
        sculptCellCountsBuffer = device.createBuffer({
          label: 'kaminos-clay-sculpt-hash-cell-counts',
          size: sculptCellCount * Uint32Array.BYTES_PER_ELEMENT,
          usage: GPUBufferUsage.STORAGE,
        });
        sculptCellEntriesBuffer = device.createBuffer({
          label: 'kaminos-clay-sculpt-hash-cell-entries',
          size: sculptEntryCount * Uint32Array.BYTES_PER_ELEMENT,
          usage: GPUBufferUsage.STORAGE,
        });
        sculptMetricsBuffer = device.createBuffer({
          label: 'kaminos-clay-sculpt-hash-metrics',
          size: 8 * Uint32Array.BYTES_PER_ELEMENT,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
        });
        sculptMetricsReadbackBuffer = device.createBuffer({
          label: 'kaminos-clay-sculpt-hash-metrics-readback',
          size: 8 * Uint32Array.BYTES_PER_ELEMENT,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
        sculptBrushBuffer = device.createBuffer({
          label: 'kaminos-clay-sculpt-brush',
          size: 8 * Float32Array.BYTES_PER_ELEMENT,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        sculptParamsBuffer = device.createBuffer({
          label: 'kaminos-clay-sculpt-params',
          size: 4 * Uint32Array.BYTES_PER_ELEMENT,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(sculptBaseBuffer, 0, sculptBasePositions);
        device.queue.writeBuffer(sculptStateBuffer, 0, sculptBasePositions);
        sculptPipeline = device.createComputePipeline({
          label: SCULPT_SOLVER_IDENTITY,
          layout: 'auto',
          compute: {
            module: device.createShaderModule({ code: claySculptHashGridShader() }),
            entryPoint: 'clay_particle_sculpt_hash_grid_main',
          },
        });
        sculptBindGroup = device.createBindGroup({
          layout: sculptPipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: sculptBaseBuffer } },
            { binding: 1, resource: { buffer: sculptStateBuffer } },
            { binding: 2, resource: { buffer: sculptOutputBuffer } },
            { binding: 3, resource: { buffer: sculptCellCountsBuffer } },
            { binding: 4, resource: { buffer: sculptCellEntriesBuffer } },
            { binding: 5, resource: { buffer: sculptMetricsBuffer } },
            { binding: 6, resource: { buffer: sculptBrushBuffer } },
            { binding: 7, resource: { buffer: sculptParamsBuffer } },
          ],
        });
      }
    })();
    try {
      await gpuReadyPromise;
    } finally {
      gpuReadyPromise = null;
    }
  }

  async function runCubeFirstLoop(primitiveColliders) {
    if (!clayCubeEnabled) return;
    clayCubeStepStatus = 'running';
    clayCubeEvidenceKind = 'webgpu-material-point-readback';
    const cubeStartedAt = performance.now();
    const cubeColliderData = new Float32Array(MAX_COLLIDERS * 4);
    const cubeColliderForceData = new Float32Array(MAX_COLLIDERS * 4);
    primitiveColliders.slice(0, MAX_COLLIDERS).forEach((collider, index) => {
      const cubeCollider = normalizedCubeCollider(collider, index);
      cubeColliderData[index * 4] = cubeCollider.center[0];
      cubeColliderData[index * 4 + 1] = cubeCollider.center[1];
      cubeColliderData[index * 4 + 2] = cubeCollider.center[2];
      cubeColliderData[index * 4 + 3] = cubeCollider.radius;
      cubeColliderForceData[index * 4] = Number.isFinite(collider.effectiveStrength) && collider.effectiveStrength > 0
        ? collider.effectiveStrength
        : cubeCollider.strength;
      cubeColliderForceData[index * 4 + 1] = cubeCollider.surfaceNormal[0];
      cubeColliderForceData[index * 4 + 2] = cubeCollider.surfaceNormal[1];
      cubeColliderForceData[index * 4 + 3] = cubeCollider.surfaceNormal[2];
    });
    device.queue.writeBuffer(cubeColliderBuffer, 0, cubeColliderData);
    device.queue.writeBuffer(cubeColliderForceBuffer, 0, cubeColliderForceData);
    device.queue.writeBuffer(cubeParamsBuffer, 0, new Uint32Array([
      cubeConfig.particleCount,
      Math.min(MAX_COLLIDERS, primitiveColliders.length),
      gpuStepCount + 1,
      cubeConfig.gridDimension,
    ]));
    const encoder = device.createCommandEncoder({ label: 'kaminos-clay-cube-first-loop-step' });
    const pass = encoder.beginComputePass({ label: 'kaminos-clay-cube-first-loop-pass' });
    pass.setPipeline(cubePipeline);
    pass.setBindGroup(0, cubeBindGroup);
    clayCubeDispatchWorkgroups = Math.ceil(cubeConfig.particleCount / 64);
    pass.dispatchWorkgroups(clayCubeDispatchWorkgroups);
    pass.end();
    encoder.copyBufferToBuffer(cubeOutputBuffer, 0, cubeReadbackBuffer, 0, cubeBasePositions.byteLength);
    encoder.copyBufferToBuffer(cubeOutputBuffer, 0, cubeStateBuffer, 0, cubeBasePositions.byteLength);
    device.queue.submit([encoder.finish()]);
    await cubeReadbackBuffer.mapAsync(GPUMapMode.READ);
    const cubeValues = new Float32Array(cubeReadbackBuffer.getMappedRange()).slice();
    cubeReadbackBuffer.unmap();
    clayCubeReadbackWallMs = performance.now() - cubeStartedAt;

    const activeCells = new Set();
    clayCubeDeformedParticleCount = 0;
    clayCubeContactParticleCount = 0;
    clayCubeMaxDisplacement = 0;
    clayCubeMinY = Number.POSITIVE_INFINITY;
    clayCubeMaxY = Number.NEGATIVE_INFINITY;
    const pointPosition = cubePointCloud?.geometry?.attributes?.position || null;
    const pointColor = cubePointCloud?.geometry?.attributes?.color || null;
    clayCubeDiagnosticColoredParticleCount = 0;
    clayCubeDiagnosticHotParticleCount = 0;
    for (let i = 0; i < cubeConfig.particleCount; i += 1) {
      const offset = i * 4;
      const x = cubeValues[offset];
      const y = cubeValues[offset + 1];
      const z = cubeValues[offset + 2];
      const contact = cubeValues[offset + 3];
      const dx = x - cubeBasePositions[offset];
      const dy = y - cubeBasePositions[offset + 1];
      const dz = z - cubeBasePositions[offset + 2];
      const displacement = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (displacement > 0.002) clayCubeDeformedParticleCount += 1;
      if (contact > 0.5) clayCubeContactParticleCount += 1;
      if (displacement > 0.002 || contact > 0.5) clayCubeDiagnosticColoredParticleCount += 1;
      if (contact > 0.5 || displacement > 0.08) clayCubeDiagnosticHotParticleCount += 1;
      clayCubeMaxDisplacement = Math.max(clayCubeMaxDisplacement, displacement);
      clayCubeMinY = Math.min(clayCubeMinY, y);
      clayCubeMaxY = Math.max(clayCubeMaxY, y);
      activeCells.add(cubeGridCellIndex(x, y, z, cubeConfig.gridDimension));
      if (pointPosition) pointPosition.setXYZ(i, x, y, z);
      if (pointColor) {
        const heat = clamp01(displacement / 0.20);
        const contactHeat = contact > 0.5 ? 1 : 0;
        pointColor.setXYZ(
          i,
          0.68 + contactHeat * 0.28,
          0.46 + heat * 0.34,
          0.26 + (1 - contactHeat) * heat * 0.28,
        );
      }
    }
    if (pointPosition) pointPosition.needsUpdate = true;
    if (pointColor) pointColor.needsUpdate = true;
    refreshCubeBoundarySkin(cubeValues);
    const faceMetrics = computeCubeFaceMetrics({
      basePositions: cubeBasePositions,
      cubeValues,
      config: cubeConfig,
      colliders: primitiveColliders,
    });
    clayCubeFaceMetricEvidenceKind = faceMetrics.faceMetricEvidenceKind;
    clayCubeFrontFaceDeformedParticleCount = faceMetrics.frontFaceDeformedParticleCount;
    clayCubeBackFaceDeformedParticleCount = faceMetrics.backFaceDeformedParticleCount;
    clayCubeFrontBackDeformationRatio = faceMetrics.frontBackDeformationRatio;
    clayCubeEdgeBandDeformedParticleCount = faceMetrics.edgeBandDeformedParticleCount;
    clayCubeCornerBandDeformedParticleCount = faceMetrics.cornerBandDeformedParticleCount;
    clayCubeMaxDisplacementFace = faceMetrics.maxDisplacementFace;
    clayCubeDeformationCentroid = faceMetrics.deformationCentroid;
    clayCubeContactCentroid = faceMetrics.contactCentroid;
    clayCubeBrushCentroid = faceMetrics.brushCentroid;
    clayCubeBrushToDeformationCentroidDistance = faceMetrics.brushToDeformationCentroidDistance;
    clayCubeBrushToContactCentroidDistance = faceMetrics.brushToContactCentroidDistance;
    clayCubeHeightRange = clayCubeMaxY - clayCubeMinY;
    clayCubeActiveGridCellCount = activeCells.size;
    clayCubeStepStatus = 'pass';
    lastCubeStateValues = cubeValues;
    if (!clayCubeIsoSurfaceVisible && !clayPointerActive) {
      refreshCubeIsoSurface(cubeValues);
      clayCubeIsoSurfaceNeedsRefresh = false;
    } else {
      clayCubeIsoSurfaceNeedsRefresh = true;
    }
  }

  function sculptBrushFromColliders(primitiveColliders) {
    const fallback = {
      center: [0.18, 0.42, 0.34],
      radius: 0.22,
      strength: 1.1,
      normal: [0, 0, -1],
    };
    if (!primitiveColliders.length) return fallback;
    const collider = primitiveColliders.slice().sort((a, b) => {
      const aStrength = Number(a.effectiveStrength ?? a.strength ?? 0);
      const bStrength = Number(b.effectiveStrength ?? b.strength ?? 0);
      return bStrength - aStrength;
    })[0];
    const center = Array.isArray(collider.center) ? collider.center : fallback.center;
    const y = Number.isFinite(center[1]) && Math.abs(center[1]) > 1e-5
      ? center[1]
      : fallback.center[1];
    return normalizeSculptBrush({
      center: [center[0], y, center[2]],
      radius: collider.radius ?? fallback.radius,
      strength: Number.isFinite(collider.effectiveStrength) && collider.effectiveStrength > 0
        ? collider.effectiveStrength
        : collider.strength ?? fallback.strength,
      normal: collider.surfaceNormal || fallback.normal,
    });
  }

  async function dispatchSculptPhase(phase, workgroups, label, copyReadback = false) {
    device.queue.writeBuffer(sculptParamsBuffer, 0, new Uint32Array([
      sculptConfig.particleCount,
      sculptConfig.hashGridDimension,
      sculptConfig.hashGridCellCapacity,
      phase,
    ]));
    const encoder = device.createCommandEncoder({ label });
    const pass = encoder.beginComputePass({ label: `${label}-pass` });
    pass.setPipeline(sculptPipeline);
    pass.setBindGroup(0, sculptBindGroup);
    pass.dispatchWorkgroups(workgroups);
    pass.end();
    if (copyReadback) {
      encoder.copyBufferToBuffer(sculptOutputBuffer, 0, sculptReadbackBuffer, 0, sculptBasePositions.byteLength);
      encoder.copyBufferToBuffer(sculptOutputBuffer, 0, sculptStateBuffer, 0, sculptBasePositions.byteLength);
      encoder.copyBufferToBuffer(sculptMetricsBuffer, 0, sculptMetricsReadbackBuffer, 0, 8 * Uint32Array.BYTES_PER_ELEMENT);
    }
    device.queue.submit([encoder.finish()]);
    if (!copyReadback) await device.queue.onSubmittedWorkDone();
  }

  async function runSculptFirstBrush(primitiveColliders) {
    if (!claySculptEnabled) return;
    claySculptStepStatus = 'running';
    claySculptEvidenceKind = CLAY_SCULPT_WEBGPU_EVIDENCE_KIND;
    const sculptStartedAt = performance.now();
    const brush = sculptBrushFromColliders(primitiveColliders);
    device.queue.writeBuffer(sculptBrushBuffer, 0, new Float32Array([
      brush.center[0],
      brush.center[1],
      brush.center[2],
      brush.radius,
      brush.normal[0],
      brush.normal[1],
      brush.normal[2],
      brush.strength,
    ]));
    const clearWorkgroups = Math.ceil(Math.max(sculptEntryCount, sculptCellCount, 8) / 64);
    const particleWorkgroups = Math.ceil(sculptConfig.particleCount / 64);
    claySculptDispatchWorkgroups = clearWorkgroups + particleWorkgroups + particleWorkgroups;
    await dispatchSculptPhase(0, clearWorkgroups, 'kaminos-clay-sculpt-hash-grid-clear');
    await dispatchSculptPhase(1, particleWorkgroups, 'kaminos-clay-sculpt-hash-grid-insert');
    await dispatchSculptPhase(2, particleWorkgroups, 'kaminos-clay-sculpt-hash-grid-solve', true);
    await Promise.all([
      sculptReadbackBuffer.mapAsync(GPUMapMode.READ),
      sculptMetricsReadbackBuffer.mapAsync(GPUMapMode.READ),
    ]);
    const sculptValues = new Float32Array(sculptReadbackBuffer.getMappedRange()).slice();
    const metrics = new Uint32Array(sculptMetricsReadbackBuffer.getMappedRange()).slice();
    sculptReadbackBuffer.unmap();
    sculptMetricsReadbackBuffer.unmap();
    claySculptReadbackWallMs = performance.now() - sculptStartedAt;
    claySculptActiveCellCount = metrics[0];
    claySculptMaxCellOccupancy = metrics[1];
    claySculptOverflowCount = metrics[2];
    claySculptContactParticleCount = metrics[3];
    claySculptDeformedParticleCount = metrics[4];
    claySculptNeighborSampleCount = metrics[5];
    claySculptAverageNeighborCount = claySculptNeighborSampleCount / Math.max(1, sculptConfig.particleCount);
    claySculptNeighborCohesionDisplacement = metrics[6] / 1000000;
    claySculptMaxDisplacement = 0;
    const pointPosition = sculptPointCloud?.geometry?.attributes?.position || null;
    const pointColor = sculptPointCloud?.geometry?.attributes?.color || null;
    for (let i = 0; i < sculptConfig.particleCount; i += 1) {
      const offset = i * 4;
      const x = sculptValues[offset];
      const y = sculptValues[offset + 1];
      const z = sculptValues[offset + 2];
      const contact = sculptValues[offset + 3];
      const dx = x - sculptBasePositions[offset];
      const dy = y - sculptBasePositions[offset + 1];
      const dz = z - sculptBasePositions[offset + 2];
      const displacement = Math.sqrt(dx * dx + dy * dy + dz * dz);
      claySculptMaxDisplacement = Math.max(claySculptMaxDisplacement, displacement);
      if (pointPosition) pointPosition.setXYZ(i, x, y, z);
      if (pointColor) {
        const heat = clamp01(displacement / 0.16);
        const contactHeat = contact > 0.5 ? 1 : 0;
        pointColor.setXYZ(
          i,
          0.65 + contactHeat * 0.32 + heat * 0.10,
          0.45 + heat * 0.34,
          0.27 + (1 - contactHeat) * heat * 0.26,
        );
      }
    }
    if (pointPosition) pointPosition.needsUpdate = true;
    if (pointColor) pointColor.needsUpdate = true;
    refreshSculptBoundarySkin(sculptValues);
    claySculptStepStatus = 'pass';
    claySculptPointCloudVisible = !!sculptPointCloud?.visible;
    lastSculptStateValues = sculptValues;
  }

  async function step() {
    if (!active) return;
    const stepStartedAt = performance.now();
    await ensureGpu();
    ensureMesh();
    const contactStartedAt = performance.now();
    const primitiveColliders = await runPrimitiveContactPass();
    clayContactWallMs = performance.now() - contactStartedAt;
    const cpuShadowPreviousValues = lastStateValues || basePositions;
    const colliderPrepStartedAt = performance.now();
    const colliderData = new Float32Array(MAX_COLLIDERS * 4);
    primitiveColliders.slice(0, MAX_COLLIDERS).forEach((collider, index) => {
      colliderData[index * 4] = collider.center[0];
      colliderData[index * 4 + 1] = collider.center[2];
      colliderData[index * 4 + 2] = collider.radius;
      colliderData[index * 4 + 3] = collider.effectiveStrength;
    });
    device.queue.writeBuffer(colliderBuffer, 0, colliderData);
    device.queue.writeBuffer(paramsBuffer, 0, new Uint32Array([vertexCount, colliders.length, gpuStepCount + 1, 0]));
    clayColliderPrepWallMs = performance.now() - colliderPrepStartedAt;
    const latticeStartedAt = performance.now();
    const encoder = device.createCommandEncoder({ label: 'kaminos-clay-step' });
    const pass = encoder.beginComputePass({ label: 'kaminos-clay-lattice-pass' });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(vertexCount / 64));
    pass.end();
    encoder.copyBufferToBuffer(outputBuffer, 0, readbackBuffer, 0, basePositions.byteLength);
    encoder.copyBufferToBuffer(outputBuffer, 0, stateBuffer, 0, basePositions.byteLength);
    device.queue.submit([encoder.finish()]);
    await readbackBuffer.mapAsync(GPUMapMode.READ);
    const values = new Float32Array(readbackBuffer.getMappedRange()).slice();
    readbackBuffer.unmap();
    clayLatticeReadbackWallMs = performance.now() - latticeStartedAt;
    await runCubeFirstLoop(primitiveColliders);
    await runSculptFirstBrush(primitiveColliders);

    const meshUpdateStartedAt = performance.now();
    const position = mesh.geometry.attributes.position;
    clayDeformationCount = 0;
    clayContactCount = 0;
    clayDeformationMax = 0;
    claySurfaceMinY = Number.POSITIVE_INFINITY;
    claySurfaceMaxY = Number.NEGATIVE_INFINITY;
    let claySurfaceAbsSum = 0;
    persistentClayMaxDelta = 0;
    for (let i = 0; i < vertexCount; i += 1) {
      const y = values[i * 4 + 1];
      const contact = values[i * 4 + 3];
      position.setY(i, y);
      if (Math.abs(y) > 0.003) clayDeformationCount += 1;
      if (contact > 0.5) clayContactCount += 1;
      clayDeformationMax = Math.max(clayDeformationMax, Math.abs(y));
      claySurfaceMinY = Math.min(claySurfaceMinY, y);
      claySurfaceMaxY = Math.max(claySurfaceMaxY, y);
      claySurfaceAbsSum += Math.abs(y);
      if (lastStateValues) {
        persistentClayMaxDelta = Math.max(persistentClayMaxDelta, Math.abs(y - lastStateValues[i * 4 + 1]));
      }
    }
    claySurfaceHeightRange = claySurfaceMaxY - claySurfaceMinY;
    claySurfaceMeanAbsHeight = claySurfaceAbsSum / vertexCount;
    if (!lastStateValues) persistentClayMaxDelta = clayDeformationMax;
    lastStateValues = values;
    persistentClayStepCount += 1;
    persistentClayStateStatus = persistentClayStepCount > 1 ? 'persistent' : 'initialized';
    if (persistentClayStepCount > 1) {
      persistentClayDeltaHistory.push(persistentClayMaxDelta);
      if (persistentClayInitialDelta === null && persistentClayMaxDelta > 0) {
        persistentClayInitialDelta = persistentClayMaxDelta;
      }
      persistentClayLatestDelta = persistentClayMaxDelta;
      persistentClaySettlingRatio = persistentClayInitialDelta > 0
        ? persistentClayLatestDelta / persistentClayInitialDelta
        : null;
    }
    position.needsUpdate = true;
    clayCpuMeshUpdateMs = performance.now() - meshUpdateStartedAt;
    const normalUpdateStartedAt = performance.now();
    if (shouldUpdateNormalsForStep()) {
      mesh.geometry.computeVertexNormals();
      clayNormalUpdateMs = performance.now() - normalUpdateStartedAt;
      clayNormalUpdateCount += 1;
      clayNormalsStale = false;
    } else {
      clayNormalUpdateMs = 0;
      clayNormalSkippedCount += 1;
      clayNormalsStale = true;
    }
    gpuStepCount += 1;
    frameCount += 1;
    if (clayPointerActive && clayPointerColliderCount > 0) clayPointerDragStepCount += 1;
    clayStepTotalWallMs = performance.now() - stepStartedAt;
    clayStepLatestMs = clayStepTotalWallMs;
    if (clayCpuShadowBenchmarkEnabled) {
      clayCpuShadowEstimateMs = estimateCpuShadowClayMs(primitiveColliders, cpuShadowPreviousValues);
      clayCpuShadowRatio = clayLatticeReadbackWallMs > 0
        ? clayCpuShadowEstimateMs / clayLatticeReadbackWallMs
        : null;
      clayCpuContactShadowEstimateMs = estimateCpuContactShadowMs();
      clayCpuContactShadowRatio = clayContactWallMs > 0
        ? clayCpuContactShadowEstimateMs / clayContactWallMs
        : null;
    } else {
      clayCpuShadowEstimateMs = 0;
      clayCpuShadowRatio = null;
      clayCpuShadowSampleCount = 0;
      clayCpuShadowChecksum = 0;
      clayCpuContactShadowEstimateMs = 0;
      clayCpuContactShadowRatio = null;
      clayCpuContactShadowSampleCount = 0;
      clayCpuContactShadowChecksum = 0;
    }
    clayStepDurationHistory.push(clayStepLatestMs);
    clayStepP95Ms = percentile(clayStepDurationHistory, 0.95);
    clayStepMaxOutlierMs = Math.max(clayStepMaxOutlierMs, clayStepLatestMs);
    if (clayStepDurationHistory.length > CLAY_TIMING_WARMUP_STEP_COUNT) {
      claySteadyStepDurationHistory.push(clayStepLatestMs);
      claySteadyStepP50Ms = percentile(claySteadyStepDurationHistory, 0.50);
      claySteadyStepP95Ms = percentile(claySteadyStepDurationHistory, 0.95);
    }
    onStatus(debugState());
    globalThis._kaminosDirty?.();
  }

  function setColliders(payload = {}) {
    const incoming = Array.isArray(payload.colliders) ? payload.colliders : [];
    colliders = normalizeColliderBatch(incoming);
    handPoseAdapterState = normalizeClayHandPoseColliders({});
    clayInteractionMode = payload.mode || (colliders.length ? 'fixture' : 'idle');
    clayPointerActive = false;
    clayPointerColliderCount = 0;
    refreshColliderMeshes();
  }

  function setHandPoseFrame(payload = {}) {
    handPoseAdapterState = normalizeClayHandPoseColliders(payload);
    colliders = normalizeColliderBatch(handPoseAdapterState.colliders);
    clayInteractionMode = handPoseAdapterState.mode;
    clayPointerActive = false;
    clayPointerColliderCount = 0;
    refreshColliderMeshes();
    onStatus(debugState());
    return {
      mode: handPoseAdapterState.mode,
      coordinateSpace: handPoseAdapterState.coordinateSpace,
      count: handPoseAdapterState.handPoseColliderCount,
      ageMs: handPoseAdapterState.ageMs,
      frameId: handPoseAdapterState.handPoseFrameId,
      requestedHandPoseBackend: handPoseAdapterState.requestedHandPoseBackend,
      effectiveHandPoseBackend: handPoseAdapterState.effectiveHandPoseBackend,
      handPoseEvidenceKind: handPoseAdapterState.handPoseEvidenceKind,
      handPoseStale: handPoseAdapterState.handPoseStale,
      handPoseVisualOnly: handPoseAdapterState.handPoseVisualOnly,
      handPoseHandCount: handPoseAdapterState.handPoseHandCount,
      handPoseColliderCount: handPoseAdapterState.handPoseColliderCount,
      handPoseAdapterWarnings: handPoseAdapterState.handPoseAdapterWarnings.slice(),
      sourceBackend: handPoseAdapterState.sourceBackend,
      sampleAgeMs: handPoseAdapterState.sampleAgeMs,
      sampleAuthority: handPoseAdapterState.sampleAuthority,
      handPosePressureContract: handPoseAdapterState.handPosePressureContract,
    };
  }

  function setPointerClayCollider(payload = {}) {
    const center = Array.isArray(payload.center)
      ? payload.center
      : [payload.x, 0, payload.z];
    const rawCenter = Array.isArray(payload.rawCenter) ? payload.rawCenter : center;
    const pointerPayload = {
      id: payload.id || 'pointer-drag',
      center,
      rawCenter,
      surfaceNormal: payload.surfaceNormal,
      surfaceSource: payload.surfaceSource || null,
      radius: payload.radius ?? 0.18,
      strength: payload.strength ?? 1.15,
      requestedStrength: payload.requestedStrength ?? payload.strength ?? 1.15,
      strengthScale: payload.strengthScale ?? 1,
      brushRampSteps: payload.brushRampSteps ?? 0,
      brushRampMinScale: payload.brushRampMinScale ?? 1,
      brushSampleIndex: payload.brushSampleIndex ?? null,
    };
    const pointerCollider = payload.depthPolicy === CLAY_CUBE_POINTER_DEPTH_POLICY
      ? normalizeClayCubePointerCollider(pointerPayload)
      : payload.depthPolicy === CLAY_SCULPT_POINTER_DEPTH_POLICY
        ? normalizeClaySculptPointerCollider(pointerPayload)
        : normalizeCollider(pointerPayload, 0);
    clayPointerDepthPolicy = payload.depthPolicy || null;
    clayBrushBoundaryWarnings.length = 0;
    clayBrushBoundaryClampCount = pointerCollider.boundaryClamped ? 1 : 0;
    if (pointerCollider.boundaryClamped) {
      clayBrushBoundaryWarnings.push(`${CLAY_BRUSH_BOUNDARY_POLICY}:${pointerCollider.id}`);
    }
    colliders = [pointerCollider];
    handPoseAdapterState = normalizeClayHandPoseColliders({});
    clayInteractionMode = 'pointer_drag';
    clayPointerActive = true;
    clayPointerColliderCount = 1;
    clayPointerLastHit = {
      x: pointerCollider.center[0],
      y: pointerCollider.center[1],
      z: pointerCollider.center[2],
      rawCenter: Array.isArray(pointerCollider.rawCenter)
        ? pointerCollider.rawCenter
        : rawCenter.slice(0, 3).map(value => Number.isFinite(Number(value)) ? Number(value) : null),
      surfaceNormal: Array.isArray(pointerCollider.surfaceNormal) ? pointerCollider.surfaceNormal : null,
      surfaceSource: pointerPayload.surfaceSource,
      depthPolicy: clayPointerDepthPolicy,
      radius: pointerCollider.radius,
      strength: pointerCollider.strength,
      requestedStrength: Number.isFinite(pointerPayload.requestedStrength) ? pointerPayload.requestedStrength : pointerCollider.strength,
      strengthScale: Number.isFinite(pointerPayload.strengthScale) ? pointerPayload.strengthScale : 1,
      brushRampSteps: Number.isFinite(pointerPayload.brushRampSteps) ? pointerPayload.brushRampSteps : 0,
      brushRampMinScale: Number.isFinite(pointerPayload.brushRampMinScale) ? pointerPayload.brushRampMinScale : 1,
      brushSampleIndex: Number.isFinite(pointerPayload.brushSampleIndex) ? pointerPayload.brushSampleIndex : null,
      screenX: Number.isFinite(payload.screenX) ? payload.screenX : null,
      screenY: Number.isFinite(payload.screenY) ? payload.screenY : null,
    };
    refreshColliderMeshes();
    onStatus(debugState());
    return {
      mode: clayInteractionMode,
      active: clayPointerActive,
      colliderCount: clayPointerColliderCount,
      lastHit: clayPointerLastHit,
    };
  }

  function intersectSculptSurfaceRay(payload = {}) {
    if (!claySculptEnabled || !sculptBoundarySkin || !claySculptSurfaceVisible) return null;
    const origin = Array.isArray(payload.origin) ? payload.origin : null;
    const direction = Array.isArray(payload.direction) ? payload.direction : null;
    if (!origin || !direction) return null;
    const ox = Number(origin[0]);
    const oy = Number(origin[1]);
    const oz = Number(origin[2]);
    const dx = Number(direction[0]);
    const dy = Number(direction[1]);
    const dz = Number(direction[2]);
    if (![ox, oy, oz, dx, dy, dz].every(Number.isFinite)) return null;
    sculptSurfaceRayOrigin.set(ox, oy, oz);
    sculptSurfaceRayDirection.set(dx, dy, dz);
    if (sculptSurfaceRayDirection.lengthSq() < 1e-12) return null;
    sculptSurfaceRayDirection.normalize();
    sculptBoundarySkin.updateMatrixWorld(true);
    const geometry = sculptBoundarySkin.geometry;
    const position = geometry?.attributes?.position || null;
    const index = geometry?.index || null;
    if (!position || !index) return null;

    let bestDistance = Number.POSITIVE_INFINITY;
    let bestNormal = null;
    const epsilon = 1e-7;
    for (let i = 0; i < index.count; i += 3) {
      sculptSurfaceRayA.fromBufferAttribute(position, index.getX(i)).applyMatrix4(sculptBoundarySkin.matrixWorld);
      sculptSurfaceRayB.fromBufferAttribute(position, index.getX(i + 1)).applyMatrix4(sculptBoundarySkin.matrixWorld);
      sculptSurfaceRayC.fromBufferAttribute(position, index.getX(i + 2)).applyMatrix4(sculptBoundarySkin.matrixWorld);
      sculptSurfaceRayEdge1.subVectors(sculptSurfaceRayB, sculptSurfaceRayA);
      sculptSurfaceRayEdge2.subVectors(sculptSurfaceRayC, sculptSurfaceRayA);
      sculptSurfaceRayH.crossVectors(sculptSurfaceRayDirection, sculptSurfaceRayEdge2);
      const determinant = sculptSurfaceRayEdge1.dot(sculptSurfaceRayH);
      if (Math.abs(determinant) < epsilon) continue;
      const inverseDeterminant = 1 / determinant;
      sculptSurfaceRayS.subVectors(sculptSurfaceRayOrigin, sculptSurfaceRayA);
      const u = inverseDeterminant * sculptSurfaceRayS.dot(sculptSurfaceRayH);
      if (u < -epsilon || u > 1 + epsilon) continue;
      sculptSurfaceRayQ.crossVectors(sculptSurfaceRayS, sculptSurfaceRayEdge1);
      const v = inverseDeterminant * sculptSurfaceRayDirection.dot(sculptSurfaceRayQ);
      if (v < -epsilon || u + v > 1 + epsilon) continue;
      const distance = inverseDeterminant * sculptSurfaceRayEdge2.dot(sculptSurfaceRayQ);
      if (distance <= epsilon || distance >= bestDistance) continue;
      bestDistance = distance;
      sculptSurfaceWorldNormal.crossVectors(sculptSurfaceRayEdge1, sculptSurfaceRayEdge2).normalize();
      if (sculptSurfaceWorldNormal.dot(sculptSurfaceRayDirection) < 0) {
        sculptSurfaceWorldNormal.multiplyScalar(-1);
      }
      bestNormal = sculptSurfaceWorldNormal.toArray();
    }
    if (!Number.isFinite(bestDistance)) return null;
    sculptSurfaceRayPoint
      .copy(sculptSurfaceRayDirection)
      .multiplyScalar(bestDistance)
      .add(sculptSurfaceRayOrigin);
    return {
      point: sculptSurfaceRayPoint.toArray(),
      surfaceNormal: bestNormal,
      distance: bestDistance,
      source: 'sculpt-boundary-skin-raycast-v0',
    };
  }

  function clearPointerClayCollider() {
    if (clayInteractionMode !== 'pointer_drag' && !clayPointerActive) return;
    colliders = [];
    clayBrushBoundaryClampCount = 0;
    clayBrushBoundaryWarnings.length = 0;
    clayInteractionMode = 'pointer_idle';
    clayPointerActive = false;
    clayPointerColliderCount = 0;
    refreshColliderMeshes();
    if (clayCubeIsoSurfaceNeedsRefresh && lastCubeStateValues) {
      refreshCubeIsoSurface(lastCubeStateValues);
      clayCubeIsoSurfaceNeedsRefresh = false;
    }
    if (claySculptSurfaceNeedsRefresh && lastSculptStateValues) {
      refreshSculptBoundarySkin(lastSculptStateValues);
    }
    onStatus(debugState());
  }

  function setCpuShadowBenchmarkEnabled(nextEnabled) {
    clayCpuShadowBenchmarkEnabled = !!nextEnabled;
    onStatus(debugState());
  }

  function debugState() {
    return {
      active,
      effectiveRoute: ROUTE_IDENTITY,
      prototypeIdentity: PROTOTYPE_IDENTITY,
      solverIdentity: SOLVER_IDENTITY,
      effectiveBackend: device ? 'WebGPU' : 'inactive',
      substrateEvidenceKind: device ? 'webgpu-compute-readback' : 'none',
      runtimeCpuFallback: false,
      packagePrimitiveSourceContract: SHARED_PRIMITIVE_SOURCE_CONTRACT,
      packagePrimitiveImportPath: POINT_TRIANGLE_IMPORT_PATH,
      packagePrimitiveCommit: POINT_TRIANGLE_PACKAGE_COMMIT,
      pointTriangleJobFloats: POINT_TRIANGLE_JOB_FLOATS,
      pointTriangleResultBytes: POINT_TRIANGLE_RESULT_BYTES,
      pointTriangleDistanceWgslEntry: 'point_triangle_distance_main',
      sharedPrimitiveProbeStatus,
      sharedPrimitiveProbeDistanceSq,
      sharedPrimitiveProbeFeature,
      sharedPrimitiveProbeTriangleIndex,
      primitiveContactPassStatus,
      primitiveContactJobCount,
      primitiveContactActiveCount,
      primitiveContactMinDistance,
      primitiveContactForceSum,
      persistentClayStateStatus,
      persistentClayStepCount,
      persistentClayMaxDelta,
      persistentClayDeltaHistory: persistentClayDeltaHistory.slice(),
      persistentClayInitialDelta,
      persistentClayLatestDelta,
      persistentClaySettlingRatio,
      clayCubeEnabled,
      clayCubeSolverIdentity: CUBE_SOLVER_IDENTITY,
      clayCubeStepStatus,
      clayCubeEvidenceKind,
      requestedClayCube: cubeConfig.requestedClayCube,
      effectiveClayCube: cubeConfig.effectiveClayCube,
      clayCubeConfigWarnings: cubeConfig.clayCubeConfigWarnings.slice(),
      clayCubeGridDimension: cubeConfig.gridDimension,
      clayCubeParticleCount,
      clayCubeActiveGridCellCount,
      clayCubeDeformedParticleCount,
      clayCubeContactParticleCount,
      clayCubeMaxDisplacement,
      clayCubeMinY,
      clayCubeMaxY,
      clayCubeHeightRange,
      clayCubeReadbackWallMs,
      clayCubeDispatchWorkgroups,
      clayCubeSurfaceVisible,
      clayCubeBoundingBoxVisible,
      clayCubeBoundingBoxContract: CLAY_CUBE_BOUNDING_BOX_CONTRACT,
      clayCubeDiagnosticColorMode: CLAY_CUBE_DIAGNOSTIC_COLOR_MODE,
      clayCubeDiagnosticColoredParticleCount,
      clayCubeDiagnosticHotParticleCount,
      clayCubeIsoSurfaceVisible,
      clayCubeIsoSurfaceEvidenceKind,
      clayCubeIsoSurfaceVisibilityPolicy,
      clayCubeIsoSurfaceResolution,
      clayCubeIsoSurfaceBallCount,
      clayCubeIsoSurfaceTriangleCount,
      clayCubeBoundarySkinVisible,
      clayCubeBoundarySkinEvidenceKind,
      clayCubeBoundarySkinVisualMode,
      clayCubeBoundarySkinVertexCount,
      clayCubeBoundarySkinSharedVertexCount,
      clayCubeBoundarySkinTriangleCount,
      clayCubeVisibleSurfaceSource,
      clayCubeSurfaceSourceDebug,
      clayCubeBoundarySkinCullingPolicy,
      clayCubeBoundarySkinCulledTriangleCount,
      clayCubeBoundarySkinFairingPolicy,
      clayCubeBoundarySkinRawRoughness,
      clayCubeBoundarySkinRoughness,
      clayCubeBoundarySkinMaxFairingDisplacement,
      clayCubeFaceMetricEvidenceKind,
      clayCubePlasticRestPolicy: CLAY_CUBE_PLASTIC_REST_POLICY,
      clayCubeCornerSofteningPolicy: CLAY_CUBE_CORNER_SOFTENING_POLICY,
      clayCubeFrontFaceDeformedParticleCount,
      clayCubeBackFaceDeformedParticleCount,
      clayCubeFrontBackDeformationRatio,
      clayCubeEdgeBandDeformedParticleCount,
      clayCubeCornerBandDeformedParticleCount,
      clayCubeMaxDisplacementFace,
      clayCubeDeformationCentroid,
      clayCubeContactCentroid,
      clayCubeBrushCentroid,
      clayCubeBrushToDeformationCentroidDistance,
      clayCubeBrushToContactCentroidDistance,
      clayCubeOracleEvidenceKind: CLAY_CUBE_ORACLE_EVIDENCE_KIND,
      claySculptEnabled,
      claySculptSolverIdentity: SCULPT_SOLVER_IDENTITY,
      claySculptStepStatus,
      claySculptEvidenceKind,
      requestedClaySculptParticles: sculptConfig.requestedClaySculptParticles,
      effectiveClaySculptParticles: sculptConfig.effectiveClaySculptParticles,
      claySculptConfigWarnings: sculptConfig.claySculptConfigWarnings.slice(),
      claySculptParticleCount,
      claySculptHashGridContract: CLAY_SCULPT_HASH_GRID_CONTRACT,
      claySculptHashGridEvidenceKind: CLAY_SCULPT_HASH_GRID_EVIDENCE_KIND,
      claySculptOracleEvidenceKind: CLAY_SCULPT_ORACLE_EVIDENCE_KIND,
      claySculptHashGridDimension: sculptConfig.hashGridDimension,
      claySculptHashGridCellCapacity: sculptConfig.hashGridCellCapacity,
      claySculptActiveCellCount,
      claySculptMaxCellOccupancy,
      claySculptOverflowCount,
      claySculptNeighborSampleCount,
      claySculptAverageNeighborCount,
      claySculptContactParticleCount,
      claySculptDeformedParticleCount,
      claySculptMaxDisplacement,
      claySculptNeighborCohesionDisplacement,
      claySculptReadbackWallMs,
      claySculptDispatchWorkgroups,
      claySculptPointCloudVisible,
      claySculptSurfaceVisible,
      claySculptSurfaceEvidenceKind,
      claySculptSurfaceVisualMode,
      claySculptSurfaceResolution,
      claySculptSurfaceBallCount,
      claySculptSurfaceVertexCount,
      claySculptSurfaceTriangleCount,
      claySculptSurfaceNeedsRefresh,
      claySculptSurfaceUpdateStepInterval: CLAY_SCULPT_SURFACE_UPDATE_STEP_INTERVAL,
      claySculptSurfaceUpdateCount,
      claySculptSurfaceSkippedUpdateCount,
      clayTimingEvidenceSource,
      clayTimingDisclaimer,
      clayPhaseTimingDisclaimer,
      clayTimingWarmupPolicy,
      clayWarmupStepCount: CLAY_TIMING_WARMUP_STEP_COUNT,
      clayStepDurationHistory: clayStepDurationHistory.slice(),
      claySteadyStepDurationHistory: claySteadyStepDurationHistory.slice(),
      clayStepLatestMs,
      clayStepP95Ms,
      clayStepSampleCount: clayStepDurationHistory.length,
      claySteadyStepP50Ms,
      claySteadyStepP95Ms,
      claySteadyStepSampleCount: claySteadyStepDurationHistory.length,
      clayStepMaxOutlierMs,
      clayContactWallMs,
      clayColliderPrepWallMs,
      clayLatticeReadbackWallMs,
      clayCpuMeshUpdateMs,
      clayNormalUpdateMs,
      clayNormalCadence,
      clayNormalCadenceWarnings: clayNormalCadenceWarnings.slice(),
      clayNormalUpdateCount,
      clayNormalSkippedCount,
      clayNormalsStale,
      clayStepTotalWallMs,
      clayCpuShadowBenchmarkEnabled,
      clayCpuShadowEvidenceKind: CLAY_CPU_SHADOW_EVIDENCE_KIND,
      clayCpuShadowEstimateMs,
      clayCpuShadowRatio,
      clayCpuShadowSampleCount,
      clayCpuShadowChecksum,
      clayCpuContactShadowEstimateMs,
      clayCpuContactShadowRatio,
      clayCpuContactShadowSampleCount,
      clayCpuContactShadowChecksum,
      claySurfaceMinY,
      claySurfaceMaxY,
      claySurfaceHeightRange,
      claySurfaceMeanAbsHeight,
      claySurfaceVertexCount: vertexCount,
      claySurfaceTriangleCount: (gridX - 1) * (gridZ - 1) * 2,
      requestedClayGrid: gridConfig.requestedClayGrid,
      effectiveClayGrid: gridConfig.effectiveClayGrid,
      clayGridConfigWarnings: gridConfig.clayGridConfigWarnings.slice(),
      clayDebugCollidersVisible,
      clayInteractionMode,
      clayPointerActive,
      clayPointerColliderCount,
      clayPointerDragStepCount,
      clayPointerLastHit,
      clayPointerDepthPolicy,
      clayBrushBoundaryPolicy: CLAY_BRUSH_BOUNDARY_POLICY,
      clayBrushBoundaryEdgeFalloff: CLAY_BRUSH_BOUNDARY_EDGE_FALLOFF,
      clayBrushBoundaryClampCount,
      clayBrushBoundaryWarnings: clayBrushBoundaryWarnings.slice(),
      requestedHandPoseBackend: handPoseAdapterState.requestedHandPoseBackend,
      effectiveHandPoseBackend: handPoseAdapterState.effectiveHandPoseBackend,
      handPoseEvidenceKind: handPoseAdapterState.handPoseEvidenceKind,
      handPoseStale: handPoseAdapterState.handPoseStale,
      handPoseVisualOnly: handPoseAdapterState.handPoseVisualOnly,
      handPoseFrameId: handPoseAdapterState.handPoseFrameId,
      handPoseHandCount: handPoseAdapterState.handPoseHandCount,
      handPoseColliderCount: handPoseAdapterState.handPoseColliderCount,
      handPoseAdapterWarnings: handPoseAdapterState.handPoseAdapterWarnings.slice(),
      sourceBackend: handPoseAdapterState.sourceBackend,
      sampleAgeMs: handPoseAdapterState.sampleAgeMs,
      sampleAuthority: handPoseAdapterState.sampleAuthority,
      handPosePressureContract: handPoseAdapterState.handPosePressureContract,
      clayPressureNeutralAxis: CLAY_PRESSURE_NEUTRAL_AXIS,
      clayPressureAxisGain: CLAY_PRESSURE_AXIS_GAIN,
      clayRelaxationFactor,
      clayPlasticityFactor,
      clayGrid: `${gridX}x${gridZ}`,
      clayColliderCount: colliders.length,
      clayDeformationCount,
      clayContactCount,
      clayDeformationMax,
      frameCount,
      gpuStepCount,
      lastError,
    };
  }

  return {
    async setActive(nextActive) {
      active = !!nextActive;
      if (!active) {
        if (mesh) mesh.visible = false;
        if (cubePointCloud) cubePointCloud.visible = false;
        if (sculptPointCloud) sculptPointCloud.visible = false;
        if (sculptBoundarySkin) sculptBoundarySkin.visible = false;
        if (sculptIsoSurface) sculptIsoSurface.visible = false;
        if (cubeBoundingBox) cubeBoundingBox.visible = false;
        if (cubeIsoSurface) cubeIsoSurface.visible = false;
        if (cubeBoundarySkin) cubeBoundarySkin.visible = false;
        if (colliderGroup) colliderGroup.visible = false;
        onStatus(debugState());
        return;
      }
      await ensureGpu();
      ensureMesh();
      clayCubeSurfaceVisible = clayCubeEnabled ? CLAY_CUBE_SURFACE_VISIBLE : true;
      clayCubeBoundingBoxVisible = clayCubeEnabled;
      mesh.visible = claySculptEnabled ? false : clayCubeSurfaceVisible;
      if (cubePointCloud) cubePointCloud.visible = clayCubeEnabled;
      if (sculptPointCloud) sculptPointCloud.visible = claySculptEnabled;
      if (sculptBoundarySkin) sculptBoundarySkin.visible = claySculptEnabled && claySculptSurfaceVisible;
      if (sculptIsoSurface) sculptIsoSurface.visible = claySculptEnabled && claySculptSurfaceVisible;
      if (cubeBoundingBox) cubeBoundingBox.visible = clayCubeBoundingBoxVisible;
      if (cubeIsoSurface) cubeIsoSurface.visible = clayCubeEnabled && clayCubeIsoSurfaceVisible;
      if (cubeBoundarySkin) cubeBoundarySkin.visible = clayCubeEnabled && clayCubeBoundarySkinVisible;
      colliderGroup.visible = clayDebugCollidersVisible;
      refreshColliderMeshes();
      await step();
    },
    setColliders,
    setHandPoseFrame,
    intersectSculptSurfaceRay,
    setPointerClayCollider,
    clearPointerClayCollider,
    setCpuShadowBenchmarkEnabled,
    setNormalCadence,
    setDebugCollidersVisible,
    step,
    debugState,
  };
}
