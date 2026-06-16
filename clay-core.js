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
const SHARED_PRIMITIVE_SOURCE_CONTRACT = POINT_TRIANGLE_SOURCE_CONTRACT;
const GRID_X = 48;
const GRID_Z = 32;
const MAX_COLLIDERS = 8;
const CLAY_RELAXATION_FACTOR = 0.32;
const CLAY_PLASTICITY_FACTOR = 0.10;
const CLAY_CPU_SHADOW_EVIDENCE_KIND = 'benchmark-only-js-shadow-not-runtime-fallback';
const SHARED_PRIMITIVE_PROBE_TRIANGLE_INDEX = 77;
const SHARED_PRIMITIVE_PROBE_EXPECTED_DISTANCE_SQ = 0.25;
const SHARED_PRIMITIVE_PROBE_EXPECTED_FEATURE = POINT_TRIANGLE_FEATURE.FACE;
const HAND_POSE_STALE_MS = 250;
const CLAY_HAND_TIP_INDICES = [4, 8, 12, 16, 20];
const HAND_POSE_EVIDENCE_KINDS = ['live', 'captured', 'fallback', 'synthetic', 'unverified'];

export { pointTriangleDistanceWgsl };

function clampFinite(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
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
    return [0, 0];
  }
  const x = Number(point[0]);
  const y = Number(point[1]);
  const z = Number(point[2]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    warnings.push('nonfinite-hand-point');
    return [0, 0];
  }
  if (coordinateSpace === 'clay-local') {
    return [
      clampFinite(x, -1.2, 1.2, 0),
      clampFinite(Number.isFinite(z) ? z : 0, -1.2, 1.2, 0),
    ];
  }
  if (coordinateSpace === 'volume-local') {
    return [
      clampFinite(x, -1.2, 1.2, 0),
      clampFinite(y, -1.2, 1.2, 0),
    ];
  }
  return [
    clampFinite((x - 0.5) * 1.25, -1.2, 1.2, 0),
    clampFinite((0.5 - y) * 1.25, -1.2, 1.2, 0),
  ];
}

export function normalizeClayHandPoseColliders(payload = {}, nowMs = clayHandPoseNowMs()) {
  const warnings = [];
  const requestedHandPoseBackend = String(payload.requestedBackend || payload.requestedHandPoseBackend || 'unspecified');
  const effectiveHandPoseBackend = String(payload.effectiveBackend || payload.effectiveHandPoseBackend || payload.backend || 'unknown');
  const handPoseEvidenceKind = String(payload.evidenceKind || payload.handPoseEvidenceKind || 'unverified');
  const timestampMs = clampFinite(payload.timestampMs, 0, Number.MAX_SAFE_INTEGER, nowMs);
  const ageMs = Math.max(0, nowMs - timestampMs);
  const handPoseStale = handPoseEvidenceKind === 'live' && ageMs > HAND_POSE_STALE_MS;
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
      const [x, z] = normalizeClayHandPoint(points[tipIndex], coordinateSpace, warnings);
      colliders.push({
        id: `hand-${side}-tip-${tipIndex}`,
        center: [x, 0, z],
        radius: clampFinite(hand.radius, 0.06, 0.28, 0.16),
        strength: clampFinite(hand.strength, 0.05, 2.5, 1.05),
        source: mode,
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
    handPoseFrameId: payload.frameId ?? payload.handPoseFrameId ?? null,
    handPoseHandCount,
    handPoseColliderCount: colliders.length,
    handPoseAdapterWarnings: warnings,
  };
}

function normalizeCollider(collider, index) {
  const center = Array.isArray(collider?.center) ? collider.center : [0, 0, 0];
  return {
    id: collider?.id || `clay-fixture-${index}`,
    center: [
      clampFinite(center[0], -1.2, 1.2, 0),
      clampFinite(center[1], -1.2, 1.2, 0),
      clampFinite(center[2], -1.2, 1.2, 0),
    ],
    radius: clampFinite(collider?.radius, 0.035, 0.35, 0.12),
    strength: clampFinite(collider?.strength, 0, 2.5, 1),
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
    let force = collider.w;
    depression = depression - reach * reach * force * 0.18;
    lift = lift + rim * rim * force * 0.035;
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

export function createKaminosClayPrototype({ THREE, scene, viewport, camera, controls, onStatus = () => {} }) {
  let active = false;
  let device = null;
  let pipeline = null;
  let bindGroup = null;
  let baseBuffer = null;
  let colliderBuffer = null;
  let paramsBuffer = null;
  let stateBuffer = null;
  let outputBuffer = null;
  let readbackBuffer = null;
  let mesh = null;
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
  const clayTimingEvidenceSource = 'webgpu-step-readback-wall-time';
  const clayTimingDisclaimer = 'includes primitive-contact and clay readback; not gpu-exclusive-or-present-latency';
  const clayPhaseTimingDisclaimer = 'performance.now wall timings; lattice phase includes dispatch/readback sync and is not GPU timestamp-query kernel time';
  const clayStepDurationHistory = [];
  let clayStepLatestMs = 0;
  let clayStepP95Ms = 0;
  let clayContactWallMs = 0;
  let clayColliderPrepWallMs = 0;
  let clayLatticeReadbackWallMs = 0;
  let clayCpuMeshUpdateMs = 0;
  let clayNormalUpdateMs = 0;
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
  let handPoseAdapterState = normalizeClayHandPoseColliders({});
  const clayRelaxationFactor = CLAY_RELAXATION_FACTOR;
  const clayPlasticityFactor = CLAY_PLASTICITY_FACTOR;
  let lastError = '';
  const vertexCount = GRID_X * GRID_Z;
  const basePositions = new Float32Array(vertexCount * 4);
  let lastStateValues = null;

  for (let z = 0; z < GRID_Z; z += 1) {
    for (let x = 0; x < GRID_X; x += 1) {
      const i = z * GRID_X + x;
      basePositions[i * 4] = (x / (GRID_X - 1) - 0.5) * 1.65;
      basePositions[i * 4 + 1] = 0;
      basePositions[i * 4 + 2] = (z / (GRID_Z - 1) - 0.5) * 1.05;
      basePositions[i * 4 + 3] = 1;
    }
  }

  function ensureMesh() {
    if (mesh) return;
    const geometry = new THREE.PlaneGeometry(1.65, 1.05, GRID_X - 1, GRID_Z - 1);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.MeshStandardMaterial({
      color: 0x8f6f4a,
      roughness: 0.82,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'kaminos-clay-surface-lattice';
    mesh.position.set(0, 0.02, 0);
    mesh.renderOrder = 4;
    scene.add(mesh);

    colliderGroup = new THREE.Group();
    colliderGroup.name = 'kaminos-clay-collider-debug';
    scene.add(colliderGroup);
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

  function setDebugCollidersVisible(nextVisible) {
    clayDebugCollidersVisible = !!nextVisible;
    if (!colliderGroup) return;
    colliderGroup.visible = active && clayDebugCollidersVisible;
    for (const child of colliderGroup.children) {
      child.visible = clayDebugCollidersVisible;
      if (child.material) child.material.opacity = clayDebugCollidersVisible ? 0.68 : 0.12;
    }
  }

  function latticeVertex(ix, iz) {
    const i = iz * GRID_X + ix;
    return [
      basePositions[i * 4],
      basePositions[i * 4 + 1],
      basePositions[i * 4 + 2],
    ];
  }

  function claySurfaceTriangleForCollider(collider) {
    const u = clamp01((collider.center[0] / 1.65) + 0.5);
    const v = clamp01((collider.center[2] / 1.05) + 0.5);
    const gx = Math.min(GRID_X - 2, Math.max(0, Math.floor(u * (GRID_X - 1))));
    const gz = Math.min(GRID_Z - 2, Math.max(0, Math.floor(v * (GRID_Z - 1))));
    const localX = (u * (GRID_X - 1)) - gx;
    const localZ = (v * (GRID_Z - 1)) - gz;
    const p00 = latticeVertex(gx, gz);
    const p10 = latticeVertex(gx + 1, gz);
    const p01 = latticeVertex(gx, gz + 1);
    const p11 = latticeVertex(gx + 1, gz + 1);
    const cellTriangleIndex = (gz * (GRID_X - 1) + gx) * 2;
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
        const force = collider.effectiveStrength;
        depression -= reach * reach * force * 0.18;
        lift += rim * rim * force * 0.035;
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
    if (device) return;
    if (!navigator.gpu) {
      lastError = 'webgpu-unavailable-no-runtime-fallback';
      throw new Error(lastError);
    }
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      lastError = 'webgpu-adapter-unavailable-no-runtime-fallback';
      throw new Error(lastError);
    }
    device = await adapter.requestDevice();
    await runSharedPrimitiveProbe();
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
    mesh.geometry.computeVertexNormals();
    clayNormalUpdateMs = performance.now() - normalUpdateStartedAt;
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
    onStatus(debugState());
    globalThis._kaminosDirty?.();
  }

  function setColliders(payload = {}) {
    const incoming = Array.isArray(payload.colliders) ? payload.colliders : [];
    colliders = incoming.slice(0, MAX_COLLIDERS).map(normalizeCollider);
    handPoseAdapterState = normalizeClayHandPoseColliders({});
    clayInteractionMode = payload.mode || (colliders.length ? 'fixture' : 'idle');
    clayPointerActive = false;
    clayPointerColliderCount = 0;
    refreshColliderMeshes();
  }

  function setHandPoseFrame(payload = {}) {
    handPoseAdapterState = normalizeClayHandPoseColliders(payload);
    colliders = handPoseAdapterState.colliders.slice(0, MAX_COLLIDERS).map(normalizeCollider);
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
      handPoseHandCount: handPoseAdapterState.handPoseHandCount,
      handPoseColliderCount: handPoseAdapterState.handPoseColliderCount,
      handPoseAdapterWarnings: handPoseAdapterState.handPoseAdapterWarnings.slice(),
    };
  }

  function setPointerClayCollider(payload = {}) {
    const center = Array.isArray(payload.center)
      ? payload.center
      : [payload.x, 0, payload.z];
    const pointerCollider = normalizeCollider({
      id: payload.id || 'pointer-drag',
      center,
      radius: payload.radius ?? 0.18,
      strength: payload.strength ?? 1.15,
    }, 0);
    colliders = [pointerCollider];
    handPoseAdapterState = normalizeClayHandPoseColliders({});
    clayInteractionMode = 'pointer_drag';
    clayPointerActive = true;
    clayPointerColliderCount = 1;
    clayPointerLastHit = {
      x: pointerCollider.center[0],
      y: pointerCollider.center[1],
      z: pointerCollider.center[2],
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

  function clearPointerClayCollider() {
    if (clayInteractionMode !== 'pointer_drag' && !clayPointerActive) return;
    colliders = [];
    clayInteractionMode = 'pointer_idle';
    clayPointerActive = false;
    clayPointerColliderCount = 0;
    refreshColliderMeshes();
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
      clayTimingEvidenceSource,
      clayTimingDisclaimer,
      clayPhaseTimingDisclaimer,
      clayStepDurationHistory: clayStepDurationHistory.slice(),
      clayStepLatestMs,
      clayStepP95Ms,
      clayStepSampleCount: clayStepDurationHistory.length,
      clayContactWallMs,
      clayColliderPrepWallMs,
      clayLatticeReadbackWallMs,
      clayCpuMeshUpdateMs,
      clayNormalUpdateMs,
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
      claySurfaceTriangleCount: (GRID_X - 1) * (GRID_Z - 1) * 2,
      clayDebugCollidersVisible,
      clayInteractionMode,
      clayPointerActive,
      clayPointerColliderCount,
      clayPointerDragStepCount,
      clayPointerLastHit,
      requestedHandPoseBackend: handPoseAdapterState.requestedHandPoseBackend,
      effectiveHandPoseBackend: handPoseAdapterState.effectiveHandPoseBackend,
      handPoseEvidenceKind: handPoseAdapterState.handPoseEvidenceKind,
      handPoseStale: handPoseAdapterState.handPoseStale,
      handPoseFrameId: handPoseAdapterState.handPoseFrameId,
      handPoseHandCount: handPoseAdapterState.handPoseHandCount,
      handPoseColliderCount: handPoseAdapterState.handPoseColliderCount,
      handPoseAdapterWarnings: handPoseAdapterState.handPoseAdapterWarnings.slice(),
      clayRelaxationFactor,
      clayPlasticityFactor,
      clayGrid: `${GRID_X}x${GRID_Z}`,
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
        if (colliderGroup) colliderGroup.visible = false;
        onStatus(debugState());
        return;
      }
      await ensureGpu();
      ensureMesh();
      mesh.visible = true;
      colliderGroup.visible = clayDebugCollidersVisible;
      refreshColliderMeshes();
      await step();
    },
    setColliders,
    setHandPoseFrame,
    setPointerClayCollider,
    clearPointerClayCollider,
    setCpuShadowBenchmarkEnabled,
    setDebugCollidersVisible,
    step,
    debugState,
  };
}
