// structural-material-chunk-integration.js
import { StorageBufferAttribute } from "three/webgpu";

// vendor/webphysics/src/physics/gpu/integration.ts
import * as THREE from "three";

// vendor/webphysics/src/physics/gpu/tslCompat.ts
import { storage as rawStorage } from "three/tsl";
import { localId, uniform, wgsl, wgslFn, workgroupId } from "three/tsl";
var storage = ((value, type, count) => rawStorage(value, type, count));

// vendor/webphysics/src/physics/gpu/quatUtils.ts
var qmul = wgsl(
  /* wgsl */
  `
  fn qmul(a: vec4f, b: vec4f) -> vec4f {
    return vec4f(
      a.w*b.x + a.x*b.w + a.y*b.z - a.z*b.y,
      a.w*b.y - a.x*b.z + a.y*b.w + a.z*b.x,
      a.w*b.z + a.x*b.y - a.y*b.x + a.z*b.w,
      a.w*b.w - a.x*b.x - a.y*b.y - a.z*b.z);
  }
`
);
var qrot = wgsl(
  /* wgsl */
  `
  fn qrot(q: vec4f, v: vec3f) -> vec3f {
    let t = 2.0 * cross(q.xyz, v);
    return v + q.w * t + cross(q.xyz, t);
  }
`
);
var qconj = wgsl(
  /* wgsl */
  `
  fn qconj(q: vec4f) -> vec4f {
    return vec4f(-q.xyz, q.w);
  }
`
);
var obbSupport = wgsl(
  /* wgsl */
  `
  fn obbSupport(pos: vec3f, q: vec4f, half: vec3f, dir: vec3f) -> vec3f {
    let localDir = qrot(qconj(q), dir);
    // Avoid WGSL sign(0.0) -> 0.0; always choose a corner for support.
    let s = vec3f(
      select(-1.0, 1.0, localDir.x >= 0.0),
      select(-1.0, 1.0, localDir.y >= 0.0),
      select(-1.0, 1.0, localDir.z >= 0.0)
    );
    return pos + qrot(q, s * half);
  }
`,
  [qrot, qconj]
);
var worldInvInertia = wgsl(
  /* wgsl */
  `
  fn worldInvInertia(q: vec4f, invI: vec3f) -> mat3x3f {
    let c0 = qrot(q, vec3f(1.0, 0.0, 0.0));
    let c1 = qrot(q, vec3f(0.0, 1.0, 0.0));
    let c2 = qrot(q, vec3f(0.0, 0.0, 1.0));
    return mat3x3f(c0 * invI.x, c1 * invI.y, c2 * invI.z) *
           transpose(mat3x3f(c0, c1, c2));
  }
`,
  [qrot]
);

// vendor/webphysics/src/gpuLimits.ts
var REQUESTED_MAX_STORAGE_BUFFERS_PER_SHADER_STAGE = 10;

// vendor/webphysics/src/physics/gpu/bindingBudget.ts
function assertStorageBufferBudget(kernelName, storageBufferCount) {
  if (storageBufferCount > REQUESTED_MAX_STORAGE_BUFFERS_PER_SHADER_STAGE) {
    throw new Error(
      `[${kernelName}] uses ${storageBufferCount} storage buffers; limit is ${REQUESTED_MAX_STORAGE_BUFFERS_PER_SHADER_STAGE}.`
    );
  }
}

// vendor/webphysics/src/physics/gpu/integration.ts
var WORKGROUP_SIZE = 256;
var INERTIAL_POSE_VEC4S_PER_BODY = 4;
var IntegrationStage = class {
  kernel;
  constructor(positions, initialPose, inertialPose, velocities, prevLinearVelocities, quaternions, angularVelocities, gravity, maxBodies) {
    const shader = wgslFn(
      /* wgsl */
      `
      fn compute(
        positions: ptr<storage, array<vec4f>, read>,
        initialPose: ptr<storage, array<vec4f>, read_write>,
        inertialPose: ptr<storage, array<vec4f>, read_write>,
        velocities: ptr<storage, array<vec4f>, read>,
        prevLinearVelocities: ptr<storage, array<vec4f>, read>,
        quaternions: ptr<storage, array<vec4f>, read>,
        angularVelocities: ptr<storage, array<vec4f>, read>,
        gravity: vec3f,
        dt: f32,
        bodyCount: u32,
        workgroupId: vec3u,
        localId: vec3u,
      ) -> void {
        let gid = workgroupId.x * ${WORKGROUP_SIZE}u + localId.x;
        if (gid >= bodyCount) { return; }

        let poseBase = gid * 2u;
        let currentPos4 = positions[gid];
        let currentPos = currentPos4.xyz;
        let invMass = currentPos4.w;
        let currentQ = normalize(quaternions[gid]);
        initialPose[poseBase] = currentPos4;
        initialPose[poseBase + 1u] = currentQ;

        let inertialBase = gid * ${INERTIAL_POSE_VEC4S_PER_BODY}u;
        if (invMass == 0.0) {
          inertialPose[inertialBase] = vec4f(currentPos, invMass);
          inertialPose[inertialBase + 1u] = currentQ;
          inertialPose[inertialBase + 2u] = vec4f(currentPos, invMass);
          inertialPose[inertialBase + 3u] = currentQ;
          return;
        }

        let v = velocities[gid].xyz;
        let prevV = prevLinearVelocities[gid].xyz;
        let w = angularVelocities[gid].xyz;
        let gravityScale = 1.0;
        let gravityLen = length(gravity);

        let inertialPos = currentPos + v * dt + gravity * (gravityScale * dt * dt);
        let dq = 0.5 * qmul(vec4f(w, 0.0), currentQ);
        let inertialQNow = normalize(currentQ + dq * dt);
        let accel = (v - prevV) / max(dt, 1e-6);
        let gravityDir = select(vec3f(0.0), gravity / gravityLen, gravityLen > 1e-6);
        let accelExt = dot(accel, gravityDir);
        let accelWeightRaw = select(0.0, accelExt / gravityLen, gravityLen > 1e-6);
        let accelWeight = clamp(accelWeightRaw, 0.0, 1.0);
        let guessPos = currentPos + v * dt + gravity * (gravityScale * accelWeight * dt * dt);

        inertialPose[inertialBase] = vec4f(inertialPos, invMass);
        inertialPose[inertialBase + 1u] = inertialQNow;
        inertialPose[inertialBase + 2u] = vec4f(guessPos, invMass);
        inertialPose[inertialBase + 3u] = inertialQNow;
      }
    `,
      [qmul]
    );
    this.kernel = shader({
      positions: storage(positions, "vec4f", maxBodies).toReadOnly(),
      initialPose: storage(initialPose, "vec4f", maxBodies * 2),
      inertialPose: storage(inertialPose, "vec4f", maxBodies * INERTIAL_POSE_VEC4S_PER_BODY),
      velocities: storage(velocities, "vec4f", maxBodies).toReadOnly(),
      prevLinearVelocities: storage(prevLinearVelocities, "vec4f", maxBodies).toReadOnly(),
      quaternions: storage(quaternions, "vec4f", maxBodies).toReadOnly(),
      angularVelocities: storage(angularVelocities, "vec4f", maxBodies).toReadOnly(),
      gravity: uniform(new THREE.Vector3(...gravity)),
      dt: uniform(1 / 60 / 4),
      bodyCount: uniform(0),
      workgroupId,
      localId
    }).computeKernel([WORKGROUP_SIZE, 1, 1]).setName("Physics Integrate + AVBD Initialize Primal Guess");
    assertStorageBufferBudget("Physics Integrate + AVBD Initialize Primal Guess", 7);
  }
  dispatch(renderer, bodyCount, dt) {
    this.kernel.computeNode.parameters.bodyCount.value = bodyCount;
    this.kernel.computeNode.parameters.dt.value = dt;
    const workgroups = Math.ceil(bodyCount / WORKGROUP_SIZE);
    renderer.compute(this.kernel, [workgroups, 1, 1]);
  }
};

// structural-material-disposal.mjs
function disposeAll(actions, message, initialError) {
  const errors = initialError ? [initialError] : [];
  for (const action of actions) try {
    action();
  } catch (error) {
    errors.push(error);
  }
  if (errors.length) throw new AggregateError(errors, `${message}: ${errors.map((error) => error.message).join("; ")}`, { cause: initialError ?? errors[0] });
}

// structural-material-chunk-integration.js
async function createChunkIntegration(renderer, count) {
  const attributes = {}, make = (name, vecs = 1) => {
    const a = new StorageBufferAttribute(new Float32Array(count * vecs * 4), 4);
    attributes[name] = a;
    return a;
  };
  const positions = make("positions"), initial = make("initial", 2), inertial = make("inertial", 4), velocities = make("velocities"), previous = make("previous"), quaternions = make("quaternions"), angular = make("angular");
  for (let i = 0; i < count; i++) quaternions.array[i * 4 + 3] = 1;
  const stage = new IntegrationStage(positions, initial, inertial, velocities, previous, quaternions, angular, [0, 0, 0], count);
  try {
    await renderer.computeAsync(stage.kernel, [1, 1, 1]);
    return {
      sourceRevision: "96b043c88dc2a4af5367820caf1e1e9f458d5560",
      motion: "translation-only",
      buffers: Object.fromEntries(Object.entries(attributes).map(([name, a]) => [name, renderer.backend.get(a).buffer])),
      step(timeStep, gravity) {
        stage.kernel.computeNode.parameters.gravity.value.set(0, -gravity, 0);
        stage.dispatch(renderer, count, timeStep);
      },
      dispose() {
        disposeAll([() => stage.kernel.dispose(), ...Object.values(attributes).map((a) => () => {
          if (renderer.backend.get(a).buffer) renderer.backend.destroyAttribute(a);
        })], "Chunk integration cleanup failed");
      }
    };
  } catch (error) {
    disposeAll([() => stage.kernel.dispose(), ...Object.values(attributes).map((a) => () => {
      if (renderer.backend.get(a).buffer) renderer.backend.destroyAttribute(a);
    })], "Chunk integration initialization failed", error);
  }
}
export {
  createChunkIntegration
};
