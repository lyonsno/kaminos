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
const SHARED_PRIMITIVE_PROBE_TRIANGLE_INDEX = 77;
const SHARED_PRIMITIVE_PROBE_EXPECTED_DISTANCE_SQ = 0.25;
const SHARED_PRIMITIVE_PROBE_EXPECTED_FEATURE = POINT_TRIANGLE_FEATURE.FACE;

export { pointTriangleDistanceWgsl };

function clampFinite(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
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
@group(0) @binding(2) var<storage, read_write> deformedPositions: array<vec4f>;
@group(0) @binding(3) var<uniform> params: Params;

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
  let mound = 0.035 * exp(-2.2 * dot(base.xz, base.xz));
  let y = mound + depression + lift;
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
  let sharedPrimitiveProbeStatus = 'not-run';
  let sharedPrimitiveProbeDistanceSq = null;
  let sharedPrimitiveProbeFeature = null;
  let sharedPrimitiveProbeTriangleIndex = null;
  let lastError = '';
  const vertexCount = GRID_X * GRID_Z;
  const basePositions = new Float32Array(vertexCount * 4);

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
    const material = new THREE.MeshBasicMaterial({
      color: 0x8f6f4a,
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
        opacity: 0.68,
        depthWrite: false,
      });
      const sphere = new THREE.Mesh(geometry, material);
      sphere.position.set(collider.center[0], 0.11, collider.center[2]);
      sphere.name = `kaminos-clay-collider-${collider.id}`;
      colliderGroup.add(sphere);
    }
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
    const jobBuffer = device.createBuffer({
      label: 'kaminos-clay-shared-point-triangle-jobs',
      size: jobs.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const resultBuffer = device.createBuffer({
      label: 'kaminos-clay-shared-point-triangle-results',
      size: POINT_TRIANGLE_RESULT_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    const probeReadback = device.createBuffer({
      label: 'kaminos-clay-shared-point-triangle-readback',
      size: POINT_TRIANGLE_RESULT_BYTES,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    device.queue.writeBuffer(jobBuffer, 0, jobs);
    const probePipeline = await device.createComputePipelineAsync({
      label: 'kaminos-clay-shared-point-triangle-probe',
      layout: 'auto',
      compute: {
        module: device.createShaderModule({ code: pointTriangleDistanceWgsl }),
        entryPoint: 'point_triangle_distance_main',
      },
    });
    const probeBindGroup = device.createBindGroup({
      layout: probePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: jobBuffer } },
        { binding: 1, resource: { buffer: resultBuffer } },
      ],
    });
    const encoder = device.createCommandEncoder({ label: 'kaminos-clay-shared-point-triangle-probe' });
    const pass = encoder.beginComputePass({ label: 'kaminos-clay-shared-point-triangle-pass' });
    pass.setPipeline(probePipeline);
    pass.setBindGroup(0, probeBindGroup);
    pass.dispatchWorkgroups(1);
    pass.end();
    encoder.copyBufferToBuffer(resultBuffer, 0, probeReadback, 0, POINT_TRIANGLE_RESULT_BYTES);
    device.queue.submit([encoder.finish()]);
    await probeReadback.mapAsync(GPUMapMode.READ);
    const resultView = new DataView(probeReadback.getMappedRange());
    sharedPrimitiveProbeDistanceSq = resultView.getFloat32(0, true);
    sharedPrimitiveProbeFeature = resultView.getUint32(4, true);
    sharedPrimitiveProbeTriangleIndex = resultView.getUint32(8, true);
    probeReadback.unmap();
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
        { binding: 2, resource: { buffer: outputBuffer } },
        { binding: 3, resource: { buffer: paramsBuffer } },
      ],
    });
  }

  async function step() {
    if (!active) return;
    await ensureGpu();
    ensureMesh();
    const colliderData = new Float32Array(MAX_COLLIDERS * 4);
    colliders.slice(0, MAX_COLLIDERS).forEach((collider, index) => {
      colliderData[index * 4] = collider.center[0];
      colliderData[index * 4 + 1] = collider.center[2];
      colliderData[index * 4 + 2] = collider.radius;
      colliderData[index * 4 + 3] = collider.strength;
    });
    device.queue.writeBuffer(colliderBuffer, 0, colliderData);
    device.queue.writeBuffer(paramsBuffer, 0, new Uint32Array([vertexCount, colliders.length, gpuStepCount + 1, 0]));
    const encoder = device.createCommandEncoder({ label: 'kaminos-clay-step' });
    const pass = encoder.beginComputePass({ label: 'kaminos-clay-lattice-pass' });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(vertexCount / 64));
    pass.end();
    encoder.copyBufferToBuffer(outputBuffer, 0, readbackBuffer, 0, basePositions.byteLength);
    device.queue.submit([encoder.finish()]);
    await readbackBuffer.mapAsync(GPUMapMode.READ);
    const values = new Float32Array(readbackBuffer.getMappedRange()).slice();
    readbackBuffer.unmap();

    const position = mesh.geometry.attributes.position;
    clayDeformationCount = 0;
    clayContactCount = 0;
    clayDeformationMax = 0;
    for (let i = 0; i < vertexCount; i += 1) {
      const y = values[i * 4 + 1];
      const contact = values[i * 4 + 3];
      position.setY(i, y);
      if (Math.abs(y) > 0.003) clayDeformationCount += 1;
      if (contact > 0.5) clayContactCount += 1;
      clayDeformationMax = Math.max(clayDeformationMax, Math.abs(y));
    }
    position.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    gpuStepCount += 1;
    frameCount += 1;
    onStatus(debugState());
    globalThis._kaminosDirty?.();
  }

  function setColliders(payload = {}) {
    const incoming = Array.isArray(payload.colliders) ? payload.colliders : [];
    colliders = incoming.slice(0, MAX_COLLIDERS).map(normalizeCollider);
    refreshColliderMeshes();
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
      colliderGroup.visible = true;
      refreshColliderMeshes();
      await step();
    },
    setColliders,
    step,
    debugState,
  };
}
