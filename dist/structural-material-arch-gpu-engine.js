// vendor/webphysics/src/physics/PhysicsEngine.ts
import { StorageBufferAttribute as StorageBufferAttribute5 } from "three/webgpu";

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

// vendor/webphysics/src/physics/gpu/contactGeneration.ts
import { IndirectStorageBufferAttribute, StorageBufferAttribute } from "three/webgpu";

// vendor/webphysics/src/physics/avbdParams.ts
var AVBD_FRICTION_STATIC = 0.75;
var AVBD_FRICTION_DYNAMIC = 0.75;
var AVBD_COLLISION_MARGIN = 5e-4;

// vendor/webphysics/src/physics/gpu/contactRecord.ts
var CONTACT_RECORD_META_OFFSET = 0;
var CONTACT_RECORD_NORMAL_PEN_OFFSET = 1;
var CONTACT_RECORD_ARM_A_OFFSET = 2;
var CONTACT_RECORD_ARM_B_OFFSET = 3;
var CONTACT_RECORD_CONSTRAINT_C0_OFFSET = 4;
var CONTACT_RECORD_SHADOW_OFFSET = 5;
var CONTACT_RECORD_DUAL_OFFSET = 6;
var CONTACT_RECORD_PENALTY_OFFSET = 7;
var CONTACT_RECORD_CACHE_OFFSET = 8;
var CONTACT_RECORD_VEC4S = 9;
var CONTACT_RECORD_FLOATS = CONTACT_RECORD_VEC4S * 4;
var contactRecordHelpers = wgsl(
  /* wgsl */
  `
      const CONTACT_RECORD_META_OFFSET: u32 = ${CONTACT_RECORD_META_OFFSET}u;
      const CONTACT_RECORD_NORMAL_PEN_OFFSET: u32 = ${CONTACT_RECORD_NORMAL_PEN_OFFSET}u;
      const CONTACT_RECORD_ARM_A_OFFSET: u32 = ${CONTACT_RECORD_ARM_A_OFFSET}u;
      const CONTACT_RECORD_ARM_B_OFFSET: u32 = ${CONTACT_RECORD_ARM_B_OFFSET}u;
      const CONTACT_RECORD_CONSTRAINT_C0_OFFSET: u32 = ${CONTACT_RECORD_CONSTRAINT_C0_OFFSET}u;
      const CONTACT_RECORD_SHADOW_OFFSET: u32 = ${CONTACT_RECORD_SHADOW_OFFSET}u;
      const CONTACT_RECORD_DUAL_OFFSET: u32 = ${CONTACT_RECORD_DUAL_OFFSET}u;
      const CONTACT_RECORD_PENALTY_OFFSET: u32 = ${CONTACT_RECORD_PENALTY_OFFSET}u;
      const CONTACT_RECORD_CACHE_OFFSET: u32 = ${CONTACT_RECORD_CACHE_OFFSET}u;
      const CONTACT_RECORD_VEC4S: u32 = ${CONTACT_RECORD_VEC4S}u;

      fn contactRecordBase(p: u32) -> u32 {
        return p * CONTACT_RECORD_VEC4S;
      }

      fn loadContactMeta(pairContacts: ptr<storage, array<vec4f>, read_write>, p: u32) -> vec4f {
        return pairContacts[contactRecordBase(p) + CONTACT_RECORD_META_OFFSET];
      }

      fn storeContactMeta(
        pairContacts: ptr<storage, array<vec4f>, read_write>,
        p: u32,
        value: vec4f,
      ) {
        pairContacts[contactRecordBase(p) + CONTACT_RECORD_META_OFFSET] = value;
      }

      fn loadContactNormalPen(pairContacts: ptr<storage, array<vec4f>, read_write>, p: u32) -> vec4f {
        return pairContacts[contactRecordBase(p) + CONTACT_RECORD_NORMAL_PEN_OFFSET];
      }

      fn storeContactNormalPen(
        pairContacts: ptr<storage, array<vec4f>, read_write>,
        p: u32,
        value: vec4f,
      ) {
        pairContacts[contactRecordBase(p) + CONTACT_RECORD_NORMAL_PEN_OFFSET] = value;
      }

      fn loadContactArmA(pairContacts: ptr<storage, array<vec4f>, read_write>, p: u32) -> vec4f {
        return pairContacts[contactRecordBase(p) + CONTACT_RECORD_ARM_A_OFFSET];
      }

      fn storeContactArmA(
        pairContacts: ptr<storage, array<vec4f>, read_write>,
        p: u32,
        value: vec4f,
      ) {
        pairContacts[contactRecordBase(p) + CONTACT_RECORD_ARM_A_OFFSET] = value;
      }

      fn loadContactArmB(pairContacts: ptr<storage, array<vec4f>, read_write>, p: u32) -> vec4f {
        return pairContacts[contactRecordBase(p) + CONTACT_RECORD_ARM_B_OFFSET];
      }

      fn storeContactArmB(
        pairContacts: ptr<storage, array<vec4f>, read_write>,
        p: u32,
        value: vec4f,
      ) {
        pairContacts[contactRecordBase(p) + CONTACT_RECORD_ARM_B_OFFSET] = value;
      }

      fn loadContactConstraintC0(pairContacts: ptr<storage, array<vec4f>, read_write>, p: u32) -> vec4f {
        return pairContacts[contactRecordBase(p) + CONTACT_RECORD_CONSTRAINT_C0_OFFSET];
      }

      fn storeContactConstraintC0(
        pairContacts: ptr<storage, array<vec4f>, read_write>,
        p: u32,
        value: vec4f,
      ) {
        pairContacts[contactRecordBase(p) + CONTACT_RECORD_CONSTRAINT_C0_OFFSET] = value;
      }

      fn loadContactShadow(pairContacts: ptr<storage, array<vec4f>, read_write>, p: u32) -> vec4f {
        return pairContacts[contactRecordBase(p) + CONTACT_RECORD_SHADOW_OFFSET];
      }

      fn storeContactShadow(
        pairContacts: ptr<storage, array<vec4f>, read_write>,
        p: u32,
        value: vec4f,
      ) {
        pairContacts[contactRecordBase(p) + CONTACT_RECORD_SHADOW_OFFSET] = value;
      }

      fn loadContactDual(pairContacts: ptr<storage, array<vec4f>, read_write>, p: u32) -> vec4f {
        return pairContacts[contactRecordBase(p) + CONTACT_RECORD_DUAL_OFFSET];
      }

      fn storeContactDual(
        pairContacts: ptr<storage, array<vec4f>, read_write>,
        p: u32,
        value: vec4f,
      ) {
        pairContacts[contactRecordBase(p) + CONTACT_RECORD_DUAL_OFFSET] = value;
      }

      fn loadContactPenalty(pairContacts: ptr<storage, array<vec4f>, read_write>, p: u32) -> vec4f {
        return pairContacts[contactRecordBase(p) + CONTACT_RECORD_PENALTY_OFFSET];
      }

      fn storeContactPenalty(
        pairContacts: ptr<storage, array<vec4f>, read_write>,
        p: u32,
        value: vec4f,
      ) {
        pairContacts[contactRecordBase(p) + CONTACT_RECORD_PENALTY_OFFSET] = value;
      }

      fn loadContactCache(pairContacts: ptr<storage, array<vec4f>, read_write>, p: u32) -> vec4u {
        return bitcast<vec4u>(pairContacts[contactRecordBase(p) + CONTACT_RECORD_CACHE_OFFSET]);
      }

      fn storeContactCache(
        pairContacts: ptr<storage, array<vec4f>, read_write>,
        p: u32,
        value: vec4u,
      ) {
        pairContacts[contactRecordBase(p) + CONTACT_RECORD_CACHE_OFFSET] = bitcast<vec4f>(value);
      }

      fn loadContactCacheWord(pairContacts: ptr<storage, array<vec4f>, read_write>, p: u32) -> u32 {
        return loadContactCache(pairContacts, p).x;
      }

      fn storeContactCacheWord(
        pairContacts: ptr<storage, array<vec4f>, read_write>,
        p: u32,
        value: u32,
      ) {
        let cache = loadContactCache(pairContacts, p);
        storeContactCache(pairContacts, p, vec4u(value, cache.y, cache.z, cache.w));
      }
`
);
function contactRecordBaseFloatIndex(contactIndex) {
  return contactIndex * CONTACT_RECORD_FLOATS;
}
function contactRecordVec4FloatIndex(contactIndex, vec4Offset) {
  return contactRecordBaseFloatIndex(contactIndex) + vec4Offset * 4;
}

// vendor/webphysics/src/physics/gpu/shapeEncoding.ts
var SHAPE_FRICTION_MAX = 2;
var SHAPE_FRICTION_WORD_MASK = 16383;
var SHAPE_TYPE_SHIFT = 14;
var SHAPE_TYPE_MASK = 3;
var DEFAULT_COLLISION_GROUP = 1;
var DEFAULT_COLLISION_MASK = 255;
var SHAPE_TYPE_BOX = 0;
var SHAPE_TYPE_SPHERE = 1;
function clampShapeFriction(friction) {
  return Math.max(0, Math.min(SHAPE_FRICTION_MAX, friction));
}
function clampCollisionFilterWord(value, fallback) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(255, Math.floor(value)));
}
function packShapeMetaWord(friction, collisionGroup = DEFAULT_COLLISION_GROUP, collisionMask = DEFAULT_COLLISION_MASK, shapeType = SHAPE_TYPE_BOX) {
  const clampedFriction = clampShapeFriction(friction);
  const frictionWord = Math.round(clampedFriction / SHAPE_FRICTION_MAX * SHAPE_FRICTION_WORD_MASK) & SHAPE_FRICTION_WORD_MASK;
  const groupWord = clampCollisionFilterWord(collisionGroup, DEFAULT_COLLISION_GROUP) & 255;
  const maskWord = clampCollisionFilterWord(collisionMask, DEFAULT_COLLISION_MASK) & 255;
  const shapeWord = (shapeType & SHAPE_TYPE_MASK) << SHAPE_TYPE_SHIFT;
  return (frictionWord | shapeWord | groupWord << 16 | maskWord << 24) >>> 0;
}
function decodeShapeFrictionWord(metaWord) {
  return (metaWord & SHAPE_FRICTION_WORD_MASK) / SHAPE_FRICTION_WORD_MASK * SHAPE_FRICTION_MAX;
}
function decodeShapeTypeWord(metaWord) {
  return metaWord >> SHAPE_TYPE_SHIFT & SHAPE_TYPE_MASK;
}
var shapeEncodingHelpers = wgsl(
  /* wgsl */
  `
      const SHAPE_FRICTION_MAX: f32 = 2.0;
      const SHAPE_FRICTION_WORD_SCALE: f32 = 2.0 / 16383.0;
      const SHAPE_TYPE_SHIFT: u32 = ${SHAPE_TYPE_SHIFT}u;
      const SHAPE_TYPE_MASK: u32 = ${SHAPE_TYPE_MASK}u;
      const SHAPE_TYPE_BOX: u32 = ${SHAPE_TYPE_BOX}u;
      const SHAPE_TYPE_SPHERE: u32 = ${SHAPE_TYPE_SPHERE}u;

      fn decodeShapeMetaWord(shapeMeta: f32) -> u32 {
        return bitcast<u32>(shapeMeta);
      }

      fn decodeShapeFriction(shapeMeta: f32) -> f32 {
        return f32(decodeShapeMetaWord(shapeMeta) & 0xffffu) * SHAPE_FRICTION_WORD_SCALE;
      }

      fn decodeShapeCollisionGroup(shapeMeta: f32) -> u32 {
        return (decodeShapeMetaWord(shapeMeta) >> 16u) & 0xffu;
      }

      fn decodeShapeCollisionMask(shapeMeta: f32) -> u32 {
        return (decodeShapeMetaWord(shapeMeta) >> 24u) & 0xffu;
      }

      fn decodeShapeType(shapeMeta: f32) -> u32 {
        return (decodeShapeMetaWord(shapeMeta) >> SHAPE_TYPE_SHIFT) & SHAPE_TYPE_MASK;
      }

      fn shapesCanCollide(shapeA: vec4f, shapeB: vec4f) -> bool {
        let groupA = decodeShapeCollisionGroup(shapeA.x);
        let groupB = decodeShapeCollisionGroup(shapeB.x);
        let maskA = decodeShapeCollisionMask(shapeA.x);
        let maskB = decodeShapeCollisionMask(shapeB.x);
        return (maskA & groupB) != 0u && (maskB & groupA) != 0u;
      }
    `
);

// vendor/webphysics/src/physics/gpu/contactGeneration.ts
var WORKGROUP_SIZE2 = 256;
var tangentBasisHelpers = wgsl(
  /* wgsl */
  `
      const TANGENT_BASIS_TWO_PI: f32 = 6.283185307179586;

      struct TangentBasis {
        t1: vec3f,
        t2: vec3f,
      };

      fn canonicalTangentBasis(n: vec3f) -> TangentBasis {
        let refAxis = select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(n.y) > 0.999);
        let t1Raw = cross(refAxis, n);
        let t1Len2 = dot(t1Raw, t1Raw);
        var t1 = vec3f(0.0, 0.0, 1.0);
        if (t1Len2 > 1e-12) {
          t1 = t1Raw * inverseSqrt(t1Len2);
        }
        let t2Raw = cross(n, t1);
        let t2Len2 = dot(t2Raw, t2Raw);
        var t2 = vec3f(1.0, 0.0, 0.0);
        if (t2Len2 > 1e-12) {
          t2 = t2Raw * inverseSqrt(t2Len2);
        }
        return TangentBasis(t1, t2);
      }

      fn tangentBasisFromPreferredT1(n: vec3f, preferredT1: vec3f) -> TangentBasis {
        let projected = preferredT1 - n * dot(preferredT1, n);
        let projectedLen2 = dot(projected, projected);
        if (projectedLen2 <= 1e-12) {
          return canonicalTangentBasis(n);
        }
        let t1 = projected * inverseSqrt(projectedLen2);
        let t2Raw = cross(n, t1);
        let t2Len2 = dot(t2Raw, t2Raw);
        if (t2Len2 <= 1e-12) {
          return canonicalTangentBasis(n);
        }
        let t2 = t2Raw * inverseSqrt(t2Len2);
        return TangentBasis(t1, t2);
      }

      fn tangentBasisFromAngle(n: vec3f, theta: f32) -> TangentBasis {
        let canonical = canonicalTangentBasis(n);
        let c = cos(theta);
        let s = sin(theta);
        let t1 = canonical.t1 * c + canonical.t2 * s;
        return tangentBasisFromPreferredT1(n, t1);
      }

      fn tangentBasisAngleFromT1(n: vec3f, t1: vec3f) -> f32 {
        let canonical = canonicalTangentBasis(n);
        var theta = atan2(dot(t1, canonical.t2), dot(t1, canonical.t1));
        if (theta < 0.0) {
          theta += TANGENT_BASIS_TWO_PI;
        }
        return theta;
      }
`
);
var ContactGenerationStage = class {
  pairKernel;
  pairKernelDebug;
  clearPairBodyCountsKernel;
  clearDebugCountersKernel;
  clearActiveCandidateSlotsKernel;
  buildActiveCandidateSlotsKernel;
  buildPairDispatchArgsKernel;
  buildPairBodyListsKernel;
  buildPairBodyListsKernelDebug;
  finalizeDebugCountersKernel;
  pairDispatchIndirectAttr;
  debugCountersAttr;
  pairContactsAttr;
  maxPairContacts;
  pairManifoldSlots;
  floorDebugBody = 4294967295;
  debugEnabled = false;
  debugReadbackInFlight = false;
  lastDebugLogFrame = -1;
  debugEveryNFrames = 30;
  constructor(positions, quaternions, shapes, pairContacts, pairActivity, pairBodyContactCounts, pairBodyContactIndices, maxBodies, maxPairContacts, pairManifoldSlots, maxPairContactsPerBody, maxActivePairContacts, pairCandidateIndicesOffset, pairActiveCandidateSlotsOffset, pairActiveContactsOffset, pairIgnoredBitsOffset, pairActivityWordCount) {
    this.pairContactsAttr = pairContacts;
    this.maxPairContacts = maxPairContacts;
    this.pairManifoldSlots = pairManifoldSlots;
    const maxPairBodyContacts = maxBodies * maxPairContactsPerBody;
    const maxPairDispatchPairs = Math.floor(maxPairContacts / pairManifoldSlots);
    this.pairDispatchIndirectAttr = new IndirectStorageBufferAttribute(new Uint32Array([0, 1, 1]), 1);
    this.pairDispatchIndirectAttr.name = "Contact Pair Dispatch Indirect";
    this.debugCountersAttr = new StorageBufferAttribute(new Uint32Array(27), 1);
    const pairShaderSource = (
      /* wgsl */
      `
      fn compute(
        positions: ptr<storage, array<vec4f>, read>,
        quaternions: ptr<storage, array<vec4f>, read>,
        shapes: ptr<storage, array<vec4f>, read>,
        pairContacts: ptr<storage, array<vec4f>, read_write>,
        pairActivity: ptr<storage, array<u32>, read_write>,
        debugCounters: ptr<storage, array<atomic<u32>>, read_write>,
        debugEnabled: u32,
        bodyCount: u32,
        pairCount: u32,
        pairDispatchCount: u32,
        useCandidatePairs: u32,
        floorDebugBody: u32,
        contactSlop: f32,
        frictionStatic: f32,
        workgroupId: vec3u,
        localId: vec3u,
      ) -> void {
        let gid = workgroupId.x * ${WORKGROUP_SIZE2}u + localId.x;
        if (gid >= pairDispatchCount) { return; }
        var manifold = gid;
        if (useCandidatePairs > 0u) {
          let activeCandidateCount = min(pairActivity[${pairActiveCandidateSlotsOffset}u], pairDispatchCount);
          if (gid >= activeCandidateCount) { return; }
          manifold = pairActivity[${pairActiveCandidateSlotsOffset}u + gid + 1u];
          if (manifold >= pairDispatchCount) { return; }
        }
        if (manifold >= ${maxPairDispatchPairs}u) { return; }
        let pairBase = manifold * ${pairManifoldSlots}u;

        var i = 0u;
        var j = 0u;
        if (useCandidatePairs > 0u) {
          let packedPair = pairActivity[${pairCandidateIndicesOffset}u + manifold + 1u];
          i = packedPair & 0xFFFFu;
          j = packedPair >> 16u;
          if (i >= j) {
            // Empty fixed candidate slots only need to be marked inactive.
            deactivateManifold(pairContacts, pairBase, 0.0, 0.0);
            return;
          }
        } else {
          var pairIndex = 0u;
          if (manifold >= pairCount || manifold >= ${maxPairDispatchPairs}u) { return; }
          pairIndex = manifold;
          if (pairIndex >= pairCount) { return; }

          // Brute-force fallback path (small-N only): decode triangular pair index.
          j = u32(floor((1.0 + sqrt(1.0 + 8.0 * f32(pairIndex))) * 0.5));
          if (j == 0u) { return; }
          var triangular = (j * (j - 1u)) / 2u;
          if (triangular > pairIndex) {
            j -= 1u;
            triangular = (j * (j - 1u)) / 2u;
          }
          i = pairIndex - triangular;
          if (i >= j) { return; }
        }

        let isFloorPair = floorDebugBody != 0xffffffffu && (i == floorDebugBody || j == floorDebugBody);
        if (isFloorPair && debugEnabled > 0u) {
          atomicAdd(&debugCounters[7], 1u);
        }

        let ignoredPairIndex = (j * (j - 1u)) / 2u + i;
        let ignoredPairWord = ignoredPairIndex >> 5u;
        let ignoredPairBit = 1u << (ignoredPairIndex & 31u);
        if ((pairActivity[${pairIgnoredBitsOffset}u + ignoredPairWord] & ignoredPairBit) != 0u) {
          deactivateManifold(pairContacts, pairBase, f32(i), f32(j));
          return;
        }

        let firstInfo = loadContactMeta(pairContacts, pairBase);
        let firstI = u32(firstInfo.x + 0.5);
        let firstJ = u32(firstInfo.y + 0.5);
        if (firstI != i || firstJ != j) {
          if (debugEnabled > 0u) {
            atomicAdd(&debugCounters[0], 1u);
            if (isFloorPair) {
              atomicAdd(&debugCounters[8], 1u);
            }
          }
          deactivateManifold(pairContacts, pairBase, f32(i), f32(j));
        }

        var wasActive = false;
        var prevPairFeature: i32 = -1;
        var prevPairNormal = vec3f(0.0);
        for (var s = 0u; s < ${pairManifoldSlots}u; s++) {
          let slot = pairBase + s;
          let slotInfo = loadContactMeta(pairContacts, slot);
          if (slotInfo.z > 0.5) {
            if (!wasActive) {
              prevPairFeature = i32(decodePackedBaseFeature(slotInfo.w));
              prevPairNormal = loadContactNormalPen(pairContacts, slot).xyz;
            }
            wasActive = true;
          }
        }

        let hysteresis = 0.35 * contactSlop;
        let sepSlop = contactSlop + select(0.0, hysteresis, wasActive);

        if (i >= bodyCount || j >= bodyCount) {
          deactivateManifold(pairContacts, pairBase, f32(i), f32(j));
          return;
        }

        let invMassA = positions[i].w;
        let invMassB = positions[j].w;
        if (invMassA + invMassB == 0.0) {
          deactivateManifold(pairContacts, pairBase, f32(i), f32(j));
          return;
        }

        let posA = positions[i].xyz;
        let posB = positions[j].xyz;
        let qA = quaternions[i];
        let qB = quaternions[j];
        let shpA = shapes[i];
        let shpB = shapes[j];
        if (!shapesCanCollide(shpA, shpB)) {
          deactivateManifold(pairContacts, pairBase, f32(i), f32(j));
          return;
        }
        let frictionScale = sqrt(max(decodeShapeFriction(shpA.x), 0.0) * max(decodeShapeFriction(shpB.x), 0.0));
        let shapeTypeA = decodeShapeType(shpA.x);
        let shapeTypeB = decodeShapeType(shpB.x);
        let isSphereA = shapeTypeA == SHAPE_TYPE_SPHERE;
        let isSphereB = shapeTypeB == SHAPE_TYPE_SPHERE;
        let specialPair = isSphereA || isSphereB;
        let halfA = vec3f(shpA.y, shpA.z, shpA.w);
        let halfB = vec3f(shpB.y, shpB.z, shpB.w);
        let radiusA = max(halfA.x, 0.0);
        let radiusB = max(halfB.x, 0.0);
        let e0 = vec3f(1.0, 0.0, 0.0);
        let e1 = vec3f(0.0, 1.0, 0.0);
        let e2 = vec3f(0.0, 0.0, 1.0);
        let axA0 = qrot(qA, e0);
        let axA1 = qrot(qA, e1);
        let axA2 = qrot(qA, e2);
        let axB0 = qrot(qB, e0);
        let axB1 = qrot(qB, e1);
        let axB2 = qrot(qB, e2);

        var penetration = 0.0;
        var keepContact = false;
        var specialPointA = vec3f(0.0);
        var specialPointB = vec3f(0.0);
        var specialRAWorld = vec3f(0.0);
        var specialRBWorld = vec3f(0.0);
        var specialContactKey = 0u;
        var specialRefIsA = false;
        var specialRefFeature = 0u;
        var specialIncFeature = 0u;
        var specialManifoldPreferredT1 = vec3f(0.0);
        var specialManifoldHasPreferredT1 = false;
        var bestNormal = vec3f(0.0);
        var bestFeature: i32 = -1;
        var keepRejectClass = 0u;
        var separatedFeature: i32 = -1;
        if (!specialPair) {
        let d = posB - posA;
        let eps = 1e-6;

        let R00 = dot(axA0, axB0); let R01 = dot(axA0, axB1); let R02 = dot(axA0, axB2);
        let R10 = dot(axA1, axB0); let R11 = dot(axA1, axB1); let R12 = dot(axA1, axB2);
        let R20 = dot(axA2, axB0); let R21 = dot(axA2, axB1); let R22 = dot(axA2, axB2);

        let aR00 = abs(R00) + eps; let aR01 = abs(R01) + eps; let aR02 = abs(R02) + eps;
        let aR10 = abs(R10) + eps; let aR11 = abs(R11) + eps; let aR12 = abs(R12) + eps;
        let aR20 = abs(R20) + eps; let aR21 = abs(R21) + eps; let aR22 = abs(R22) + eps;

        let tA = vec3f(dot(d, axA0), dot(d, axA1), dot(d, axA2));
        var minPen = 1e30;
        var faceMinPen = 1e30;
        var faceBestNormal = vec3f(0.0);
        var faceBestFeature: i32 = -1;
        var separated = false;

        // Face normals of A
        {
          let ra = halfA.x;
          let rb = aR00 * halfB.x + aR01 * halfB.y + aR02 * halfB.z;
          let s = abs(tA.x);
          let pen = ra + rb - s;
          if (pen < -sepSlop) { separated = true; separatedFeature = 0; }
          if (!separated && pen < faceMinPen) {
            faceMinPen = pen;
            faceBestNormal = select(axA0, -axA0, tA.x < 0.0);
            faceBestFeature = 0;
          }
          if (!separated && pen < minPen) {
            minPen = pen;
            bestNormal = select(axA0, -axA0, tA.x < 0.0);
            bestFeature = 0;
          }
        }
        if (!separated) {
          let ra = halfA.y;
          let rb = aR10 * halfB.x + aR11 * halfB.y + aR12 * halfB.z;
          let s = abs(tA.y);
          let pen = ra + rb - s;
          if (pen < -sepSlop) { separated = true; separatedFeature = 1; }
          if (!separated && pen < faceMinPen) {
            faceMinPen = pen;
            faceBestNormal = select(axA1, -axA1, tA.y < 0.0);
            faceBestFeature = 1;
          }
          if (!separated && pen < minPen) {
            minPen = pen;
            bestNormal = select(axA1, -axA1, tA.y < 0.0);
            bestFeature = 1;
          }
        }
        if (!separated) {
          let ra = halfA.z;
          let rb = aR20 * halfB.x + aR21 * halfB.y + aR22 * halfB.z;
          let s = abs(tA.z);
          let pen = ra + rb - s;
          if (pen < -sepSlop) { separated = true; separatedFeature = 2; }
          if (!separated && pen < faceMinPen) {
            faceMinPen = pen;
            faceBestNormal = select(axA2, -axA2, tA.z < 0.0);
            faceBestFeature = 2;
          }
          if (!separated && pen < minPen) {
            minPen = pen;
            bestNormal = select(axA2, -axA2, tA.z < 0.0);
            bestFeature = 2;
          }
        }

        // Face normals of B
        let tB = vec3f(dot(d, axB0), dot(d, axB1), dot(d, axB2));
        if (!separated) {
          let ra = aR00 * halfA.x + aR10 * halfA.y + aR20 * halfA.z;
          let rb = halfB.x;
          let s = abs(tB.x);
          let pen = ra + rb - s;
          if (pen < -sepSlop) { separated = true; separatedFeature = 3; }
          if (!separated && pen < faceMinPen) {
            faceMinPen = pen;
            faceBestNormal = select(axB0, -axB0, tB.x < 0.0);
            faceBestFeature = 3;
          }
          if (!separated && pen < minPen) {
            minPen = pen;
            bestNormal = select(axB0, -axB0, tB.x < 0.0);
            bestFeature = 3;
          }
        }
        if (!separated) {
          let ra = aR01 * halfA.x + aR11 * halfA.y + aR21 * halfA.z;
          let rb = halfB.y;
          let s = abs(tB.y);
          let pen = ra + rb - s;
          if (pen < -sepSlop) { separated = true; separatedFeature = 4; }
          if (!separated && pen < faceMinPen) {
            faceMinPen = pen;
            faceBestNormal = select(axB1, -axB1, tB.y < 0.0);
            faceBestFeature = 4;
          }
          if (!separated && pen < minPen) {
            minPen = pen;
            bestNormal = select(axB1, -axB1, tB.y < 0.0);
            bestFeature = 4;
          }
        }
        if (!separated) {
          let ra = aR02 * halfA.x + aR12 * halfA.y + aR22 * halfA.z;
          let rb = halfB.z;
          let s = abs(tB.z);
          let pen = ra + rb - s;
          if (pen < -sepSlop) { separated = true; separatedFeature = 5; }
          if (!separated && pen < faceMinPen) {
            faceMinPen = pen;
            faceBestNormal = select(axB2, -axB2, tB.z < 0.0);
            faceBestFeature = 5;
          }
          if (!separated && pen < minPen) {
            minPen = pen;
            bestNormal = select(axB2, -axB2, tB.z < 0.0);
            bestFeature = 5;
          }
        }

        // Edge-edge axes (9)
        if (!separated) {
          let axis = cross(axA0, axB0);
          let len2 = dot(axis, axis);
          if (len2 > 1e-6) {
            let invLen = inverseSqrt(len2);
            let n = axis * invLen;
            let ra = halfA.y * aR20 + halfA.z * aR10;
            let rb = halfB.y * aR02 + halfB.z * aR01;
            let s = abs(dot(d, n));
            let pen = (ra + rb) * invLen - s;
            if (pen < -sepSlop) { separated = true; separatedFeature = 6; }
            if (!separated && pen < minPen) {
              minPen = pen;
              bestNormal = select(n, -n, dot(d, n) < 0.0);
              bestFeature = 6;
            }
          }
        }
        if (!separated) {
          let axis = cross(axA0, axB1);
          let len2 = dot(axis, axis);
          if (len2 > 1e-6) {
            let invLen = inverseSqrt(len2);
            let n = axis * invLen;
            let ra = halfA.y * aR21 + halfA.z * aR11;
            let rb = halfB.x * aR02 + halfB.z * aR00;
            let s = abs(dot(d, n));
            let pen = (ra + rb) * invLen - s;
            if (pen < -sepSlop) { separated = true; separatedFeature = 7; }
            if (!separated && pen < minPen) {
              minPen = pen;
              bestNormal = select(n, -n, dot(d, n) < 0.0);
              bestFeature = 7;
            }
          }
        }
        if (!separated) {
          let axis = cross(axA0, axB2);
          let len2 = dot(axis, axis);
          if (len2 > 1e-6) {
            let invLen = inverseSqrt(len2);
            let n = axis * invLen;
            let ra = halfA.y * aR22 + halfA.z * aR12;
            let rb = halfB.x * aR01 + halfB.y * aR00;
            let s = abs(dot(d, n));
            let pen = (ra + rb) * invLen - s;
            if (pen < -sepSlop) { separated = true; separatedFeature = 8; }
            if (!separated && pen < minPen) {
              minPen = pen;
              bestNormal = select(n, -n, dot(d, n) < 0.0);
              bestFeature = 8;
            }
          }
        }
        if (!separated) {
          let axis = cross(axA1, axB0);
          let len2 = dot(axis, axis);
          if (len2 > 1e-6) {
            let invLen = inverseSqrt(len2);
            let n = axis * invLen;
            let ra = halfA.x * aR20 + halfA.z * aR00;
            let rb = halfB.y * aR12 + halfB.z * aR11;
            let s = abs(dot(d, n));
            let pen = (ra + rb) * invLen - s;
            if (pen < -sepSlop) { separated = true; separatedFeature = 9; }
            if (!separated && pen < minPen) {
              minPen = pen;
              bestNormal = select(n, -n, dot(d, n) < 0.0);
              bestFeature = 9;
            }
          }
        }
        if (!separated) {
          let axis = cross(axA1, axB1);
          let len2 = dot(axis, axis);
          if (len2 > 1e-6) {
            let invLen = inverseSqrt(len2);
            let n = axis * invLen;
            let ra = halfA.x * aR21 + halfA.z * aR01;
            let rb = halfB.x * aR12 + halfB.z * aR10;
            let s = abs(dot(d, n));
            let pen = (ra + rb) * invLen - s;
            if (pen < -sepSlop) { separated = true; separatedFeature = 10; }
            if (!separated && pen < minPen) {
              minPen = pen;
              bestNormal = select(n, -n, dot(d, n) < 0.0);
              bestFeature = 10;
            }
          }
        }
        if (!separated) {
          let axis = cross(axA1, axB2);
          let len2 = dot(axis, axis);
          if (len2 > 1e-6) {
            let invLen = inverseSqrt(len2);
            let n = axis * invLen;
            let ra = halfA.x * aR22 + halfA.z * aR02;
            let rb = halfB.x * aR11 + halfB.y * aR10;
            let s = abs(dot(d, n));
            let pen = (ra + rb) * invLen - s;
            if (pen < -sepSlop) { separated = true; separatedFeature = 11; }
            if (!separated && pen < minPen) {
              minPen = pen;
              bestNormal = select(n, -n, dot(d, n) < 0.0);
              bestFeature = 11;
            }
          }
        }
        if (!separated) {
          let axis = cross(axA2, axB0);
          let len2 = dot(axis, axis);
          if (len2 > 1e-6) {
            let invLen = inverseSqrt(len2);
            let n = axis * invLen;
            let ra = halfA.x * aR10 + halfA.y * aR00;
            let rb = halfB.y * aR22 + halfB.z * aR21;
            let s = abs(dot(d, n));
            let pen = (ra + rb) * invLen - s;
            if (pen < -sepSlop) { separated = true; separatedFeature = 12; }
            if (!separated && pen < minPen) {
              minPen = pen;
              bestNormal = select(n, -n, dot(d, n) < 0.0);
              bestFeature = 12;
            }
          }
        }
        if (!separated) {
          let axis = cross(axA2, axB1);
          let len2 = dot(axis, axis);
          if (len2 > 1e-6) {
            let invLen = inverseSqrt(len2);
            let n = axis * invLen;
            let ra = halfA.x * aR11 + halfA.y * aR01;
            let rb = halfB.x * aR22 + halfB.z * aR20;
            let s = abs(dot(d, n));
            let pen = (ra + rb) * invLen - s;
            if (pen < -sepSlop) { separated = true; separatedFeature = 13; }
            if (!separated && pen < minPen) {
              minPen = pen;
              bestNormal = select(n, -n, dot(d, n) < 0.0);
              bestFeature = 13;
            }
          }
        }
        if (!separated) {
          let axis = cross(axA2, axB2);
          let len2 = dot(axis, axis);
          if (len2 > 1e-6) {
            let invLen = inverseSqrt(len2);
            let n = axis * invLen;
            let ra = halfA.x * aR12 + halfA.y * aR02;
            let rb = halfB.x * aR21 + halfB.y * aR20;
            let s = abs(dot(d, n));
            let pen = (ra + rb) * invLen - s;
            if (pen < -sepSlop) { separated = true; separatedFeature = 14; }
            if (!separated && pen < minPen) {
              minPen = pen;
              bestNormal = select(n, -n, dot(d, n) < 0.0);
              bestFeature = 14;
            }
          }
        }

        // SAT winner hysteresis: if the previous active feature is still close in
        // penetration, keep it to avoid face/edge normal flicker on rotating boxes.
        if (!separated && wasActive && prevPairFeature >= 0) {
          let axisHysteresis = 0.5 * contactSlop;
          var prevPen = 1e30;
          var prevNormalEval = bestNormal;
          var prevValid = false;

          if (prevPairFeature == 0) {
            prevPen = halfA.x + (aR00 * halfB.x + aR01 * halfB.y + aR02 * halfB.z) - abs(tA.x);
            prevNormalEval = select(axA0, -axA0, tA.x < 0.0);
            prevValid = true;
          } else if (prevPairFeature == 1) {
            prevPen = halfA.y + (aR10 * halfB.x + aR11 * halfB.y + aR12 * halfB.z) - abs(tA.y);
            prevNormalEval = select(axA1, -axA1, tA.y < 0.0);
            prevValid = true;
          } else if (prevPairFeature == 2) {
            prevPen = halfA.z + (aR20 * halfB.x + aR21 * halfB.y + aR22 * halfB.z) - abs(tA.z);
            prevNormalEval = select(axA2, -axA2, tA.z < 0.0);
            prevValid = true;
          } else if (prevPairFeature == 3) {
            prevPen = (aR00 * halfA.x + aR10 * halfA.y + aR20 * halfA.z) + halfB.x - abs(tB.x);
            prevNormalEval = select(axB0, -axB0, tB.x < 0.0);
            prevValid = true;
          } else if (prevPairFeature == 4) {
            prevPen = (aR01 * halfA.x + aR11 * halfA.y + aR21 * halfA.z) + halfB.y - abs(tB.y);
            prevNormalEval = select(axB1, -axB1, tB.y < 0.0);
            prevValid = true;
          } else if (prevPairFeature == 5) {
            prevPen = (aR02 * halfA.x + aR12 * halfA.y + aR22 * halfA.z) + halfB.z - abs(tB.z);
            prevNormalEval = select(axB2, -axB2, tB.z < 0.0);
            prevValid = true;
          } else if (prevPairFeature == 6) {
            let axis = cross(axA0, axB0);
            let len2 = dot(axis, axis);
            if (len2 > 1e-6) {
              let invLen = inverseSqrt(len2);
              let n = axis * invLen;
              let ra = halfA.y * aR20 + halfA.z * aR10;
              let rb = halfB.y * aR02 + halfB.z * aR01;
              prevPen = (ra + rb) * invLen - abs(dot(d, n));
              prevNormalEval = select(n, -n, dot(d, n) < 0.0);
              prevValid = true;
            }
          } else if (prevPairFeature == 7) {
            let axis = cross(axA0, axB1);
            let len2 = dot(axis, axis);
            if (len2 > 1e-6) {
              let invLen = inverseSqrt(len2);
              let n = axis * invLen;
              let ra = halfA.y * aR21 + halfA.z * aR11;
              let rb = halfB.x * aR02 + halfB.z * aR00;
              prevPen = (ra + rb) * invLen - abs(dot(d, n));
              prevNormalEval = select(n, -n, dot(d, n) < 0.0);
              prevValid = true;
            }
          } else if (prevPairFeature == 8) {
            let axis = cross(axA0, axB2);
            let len2 = dot(axis, axis);
            if (len2 > 1e-6) {
              let invLen = inverseSqrt(len2);
              let n = axis * invLen;
              let ra = halfA.y * aR22 + halfA.z * aR12;
              let rb = halfB.x * aR01 + halfB.y * aR00;
              prevPen = (ra + rb) * invLen - abs(dot(d, n));
              prevNormalEval = select(n, -n, dot(d, n) < 0.0);
              prevValid = true;
            }
          } else if (prevPairFeature == 9) {
            let axis = cross(axA1, axB0);
            let len2 = dot(axis, axis);
            if (len2 > 1e-6) {
              let invLen = inverseSqrt(len2);
              let n = axis * invLen;
              let ra = halfA.x * aR20 + halfA.z * aR00;
              let rb = halfB.y * aR12 + halfB.z * aR11;
              prevPen = (ra + rb) * invLen - abs(dot(d, n));
              prevNormalEval = select(n, -n, dot(d, n) < 0.0);
              prevValid = true;
            }
          } else if (prevPairFeature == 10) {
            let axis = cross(axA1, axB1);
            let len2 = dot(axis, axis);
            if (len2 > 1e-6) {
              let invLen = inverseSqrt(len2);
              let n = axis * invLen;
              let ra = halfA.x * aR21 + halfA.z * aR01;
              let rb = halfB.x * aR12 + halfB.z * aR10;
              prevPen = (ra + rb) * invLen - abs(dot(d, n));
              prevNormalEval = select(n, -n, dot(d, n) < 0.0);
              prevValid = true;
            }
          } else if (prevPairFeature == 11) {
            let axis = cross(axA1, axB2);
            let len2 = dot(axis, axis);
            if (len2 > 1e-6) {
              let invLen = inverseSqrt(len2);
              let n = axis * invLen;
              let ra = halfA.x * aR22 + halfA.z * aR02;
              let rb = halfB.x * aR11 + halfB.y * aR10;
              prevPen = (ra + rb) * invLen - abs(dot(d, n));
              prevNormalEval = select(n, -n, dot(d, n) < 0.0);
              prevValid = true;
            }
          } else if (prevPairFeature == 12) {
            let axis = cross(axA2, axB0);
            let len2 = dot(axis, axis);
            if (len2 > 1e-6) {
              let invLen = inverseSqrt(len2);
              let n = axis * invLen;
              let ra = halfA.x * aR10 + halfA.y * aR00;
              let rb = halfB.y * aR22 + halfB.z * aR21;
              prevPen = (ra + rb) * invLen - abs(dot(d, n));
              prevNormalEval = select(n, -n, dot(d, n) < 0.0);
              prevValid = true;
            }
          } else if (prevPairFeature == 13) {
            let axis = cross(axA2, axB1);
            let len2 = dot(axis, axis);
            if (len2 > 1e-6) {
              let invLen = inverseSqrt(len2);
              let n = axis * invLen;
              let ra = halfA.x * aR11 + halfA.y * aR01;
              let rb = halfB.x * aR22 + halfB.z * aR20;
              prevPen = (ra + rb) * invLen - abs(dot(d, n));
              prevNormalEval = select(n, -n, dot(d, n) < 0.0);
              prevValid = true;
            }
          } else if (prevPairFeature == 14) {
            let axis = cross(axA2, axB2);
            let len2 = dot(axis, axis);
            if (len2 > 1e-6) {
              let invLen = inverseSqrt(len2);
              let n = axis * invLen;
              let ra = halfA.x * aR12 + halfA.y * aR02;
              let rb = halfB.x * aR21 + halfB.y * aR20;
              prevPen = (ra + rb) * invLen - abs(dot(d, n));
              prevNormalEval = select(n, -n, dot(d, n) < 0.0);
              prevValid = true;
            }
          }

          if (prevValid && prevPen > -sepSlop && prevPen <= minPen + axisHysteresis && dot(prevPairNormal, prevNormalEval) > 0.85) {
            minPen = prevPen;
            bestNormal = prevNormalEval;
            bestFeature = prevPairFeature;
          }
        }

        // Edge-edge axes are noisy near face-edge ties on rotating boxes.
        // Require a clear penetration advantage before choosing an edge axis.
        if (!separated && bestFeature >= 6 && faceBestFeature >= 0) {
          let edgeWinMargin = 0.5 * contactSlop;
          if (minPen >= faceMinPen - edgeWinMargin) {
            minPen = faceMinPen;
            bestNormal = faceBestNormal;
            bestFeature = faceBestFeature;
          }
        }

        penetration = minPen;
        keepContact = !separated
          && (penetration > -contactSlop || (wasActive && penetration > -(contactSlop + hysteresis)));
        if (!keepContact) {
          keepRejectClass = select(select(14u, 15u, wasActive), 13u, separated);
        }
        } else {
          if (isSphereA && isSphereB) {
            let centerDelta = posB - posA;
            let centerDist2 = dot(centerDelta, centerDelta);
            let rSum = radiusA + radiusB;
            if (centerDist2 > 1e-12) {
              let centerDist = sqrt(centerDist2);
              bestNormal = centerDelta / centerDist;
              penetration = rSum - centerDist;
            } else {
              bestNormal = select(prevPairNormal, vec3f(0.0, 1.0, 0.0), dot(prevPairNormal, prevPairNormal) < 1e-12);
              penetration = rSum;
            }
            bestFeature = 6;
            keepContact = penetration > -contactSlop || (wasActive && penetration > -(contactSlop + hysteresis));
            if (!keepContact) {
              keepRejectClass = select(14u, 15u, wasActive);
            }
            specialPointA = posA + bestNormal * radiusA;
            specialPointB = posB - bestNormal * radiusB;
            specialRAWorld = specialPointA - posA;
            specialRBWorld = specialPointB - posB;
            specialContactKey = packEdgeContactFeature(0u, 0u);
          } else if (isSphereA != isSphereB) {
            let sphereIsA = isSphereA;
            let sphereCenter = select(posB, posA, sphereIsA);
            let boxCenter = select(posA, posB, sphereIsA);
            let sphereRadius = select(radiusB, radiusA, sphereIsA);
            let halfBox = select(halfA, halfB, sphereIsA);
            let boxAx0 = select(axA0, axB0, sphereIsA);
            let boxAx1 = select(axA1, axB1, sphereIsA);
            let boxAx2 = select(axA2, axB2, sphereIsA);

            let rel = sphereCenter - boxCenter;
            let sphereLocal = vec3f(dot(rel, boxAx0), dot(rel, boxAx1), dot(rel, boxAx2));
            let clampedLocal = clamp(sphereLocal, -halfBox, halfBox);
            let deltaLocal = sphereLocal - clampedLocal;
            var boxPointLocal = clampedLocal;
            var faceAxis = 0u;
            var faceSign = 1.0;
            var boxOutwardNormal = boxAx0;
            let outsideDist2 = dot(deltaLocal, deltaLocal);

            if (outsideDist2 > 1e-12) {
              faceAxis = dominantAbsAxis3(deltaLocal);
              faceSign = sgnnz(axisValue3(deltaLocal, faceAxis));
              boxOutwardNormal = axisVector3(faceAxis, boxAx0, boxAx1, boxAx2) * faceSign;
              penetration = sphereRadius - sqrt(outsideDist2);
            } else {
              let faceGap = halfBox - abs(sphereLocal);
              faceAxis = leastAxis3(faceGap);
              faceSign = sgnnz(axisValue3(sphereLocal, faceAxis));
              if (faceAxis == 0u) {
                boxPointLocal = vec3f(faceSign * halfBox.x, sphereLocal.y, sphereLocal.z);
              } else if (faceAxis == 1u) {
                boxPointLocal = vec3f(sphereLocal.x, faceSign * halfBox.y, sphereLocal.z);
              } else {
                boxPointLocal = vec3f(sphereLocal.x, sphereLocal.y, faceSign * halfBox.z);
              }
              boxOutwardNormal = axisVector3(faceAxis, boxAx0, boxAx1, boxAx2) * faceSign;
              penetration = sphereRadius + axisValue3(faceGap, faceAxis);
            }

            keepContact = penetration > -contactSlop || (wasActive && penetration > -(contactSlop + hysteresis));
            if (!keepContact) {
              keepRejectClass = select(14u, 15u, wasActive);
            }
            let boxPointWorld = boxCenter
              + boxAx0 * boxPointLocal.x
              + boxAx1 * boxPointLocal.y
              + boxAx2 * boxPointLocal.z;
            let spherePointWorld = sphereCenter - boxOutwardNormal * sphereRadius;
            bestNormal = select(boxOutwardNormal, -boxOutwardNormal, sphereIsA);
            bestFeature = i32(faceAxis) + select(0, 3, sphereIsA);
            specialRefIsA = !sphereIsA;
            specialRefFeature = faceAxis;
            specialIncFeature = 0u;
            specialContactKey = packFaceContactFeature(!sphereIsA, faceAxis, 0u, 0u);
            specialPointA = select(boxPointWorld, spherePointWorld, sphereIsA);
            specialPointB = select(spherePointWorld, boxPointWorld, sphereIsA);
            specialRAWorld = specialPointA - posA;
            specialRBWorld = specialPointB - posB;
            specialManifoldHasPreferredT1 = true;
            specialManifoldPreferredT1 = select(
              axisVector3(0u, boxAx0, boxAx1, boxAx2),
              axisVector3(1u, boxAx0, boxAx1, boxAx2),
              faceAxis == 0u,
            );
            if (faceAxis == 1u) {
              specialManifoldPreferredT1 = boxAx2;
            } else if (faceAxis == 2u) {
              specialManifoldPreferredT1 = boxAx0;
            }
          }
        }
        if (!keepContact) {
          if (debugEnabled > 0u && isFloorPair) {
            atomicAdd(&debugCounters[9], 1u);
            if (keepRejectClass == 13u) {
              atomicAdd(&debugCounters[13], 1u);
              if (separatedFeature >= 0 && separatedFeature <= 2) {
                atomicAdd(&debugCounters[16u + u32(separatedFeature)], 1u);
              } else if (separatedFeature >= 3 && separatedFeature <= 5) {
                atomicAdd(&debugCounters[16u + u32(separatedFeature)], 1u);
              } else if (separatedFeature >= 6) {
                atomicAdd(&debugCounters[22], 1u);
              } else {
                atomicAdd(&debugCounters[23], 1u);
              }
            } else if (keepRejectClass == 15u) {
              atomicAdd(&debugCounters[15], 1u);
            } else {
              atomicAdd(&debugCounters[14], 1u);
            }
          }
          deactivateManifold(pairContacts, pairBase, f32(i), f32(j));
          return;
        }
        let storedPenetration = max(penetration, 0.0);
        // Keep more temporary face candidates, then reduce to manifold slots by
        // spread (not only depth) for better torque stability.
        var candidatePointWorld: array<vec3f, 8>;
        var candidateRAWorld: array<vec3f, 8>;
        var candidateRBWorld: array<vec3f, 8>;
        var candidatePenetration: array<f32, 8>;
        var candidateContactKey: array<u32, 8>;
        var candidateCount = 0u;
        var manifoldPreferredT1 = specialManifoldPreferredT1;
        var manifoldHasPreferredT1 = specialManifoldHasPreferredT1;
        var refIsA = specialRefIsA;
        var refFeature = specialRefFeature;
        var incFeature = specialIncFeature;
        if (specialPair) {
          candidatePointWorld[0] = 0.5 * (specialPointA + specialPointB);
          candidateRAWorld[0] = specialRAWorld;
          candidateRBWorld[0] = specialRBWorld;
          candidatePenetration[0] = storedPenetration;
          candidateContactKey[0] = specialContactKey;
          candidateCount = 1u;
        } else if (bestFeature >= 6) {
          // Edge-edge: keep closest-segment single contact.
          let code = u32(bestFeature - 6);
          let k = code / 3u;
          let l = code - k * 3u;

          var uA = vec3f(0.0);
          var sA1 = vec3f(0.0);
          var sA2 = vec3f(0.0);
          var huA = 0.0;
          var hA1 = 0.0;
          var hA2 = 0.0;
          if (k == 0u) {
            uA = axA0; sA1 = axA1; sA2 = axA2;
            huA = halfA.x; hA1 = halfA.y; hA2 = halfA.z;
          } else if (k == 1u) {
            uA = axA1; sA1 = axA0; sA2 = axA2;
            huA = halfA.y; hA1 = halfA.x; hA2 = halfA.z;
          } else {
            uA = axA2; sA1 = axA0; sA2 = axA1;
            huA = halfA.z; hA1 = halfA.x; hA2 = halfA.y;
          }

          let sgnA1 = sgnnz(dot(sA1, bestNormal));
          let sgnA2 = sgnnz(dot(sA2, bestNormal));
          let cA = posA + sA1 * (sgnA1 * hA1) + sA2 * (sgnA2 * hA2);
          let pA0 = cA - uA * huA;
          let pA1 = cA + uA * huA;

          var uB = vec3f(0.0);
          var sB1 = vec3f(0.0);
          var sB2 = vec3f(0.0);
          var huB = 0.0;
          var hB1 = 0.0;
          var hB2 = 0.0;
          if (l == 0u) {
            uB = axB0; sB1 = axB1; sB2 = axB2;
            huB = halfB.x; hB1 = halfB.y; hB2 = halfB.z;
          } else if (l == 1u) {
            uB = axB1; sB1 = axB0; sB2 = axB2;
            huB = halfB.y; hB1 = halfB.x; hB2 = halfB.z;
          } else {
            uB = axB2; sB1 = axB0; sB2 = axB1;
            huB = halfB.z; hB1 = halfB.x; hB2 = halfB.y;
          }

          let sgnB1 = sgnnz(-dot(sB1, bestNormal));
          let sgnB2 = sgnnz(-dot(sB2, bestNormal));
          let cB = posB + sB1 * (sgnB1 * hB1) + sB2 * (sgnB2 * hB2);
          let pB0 = cB - uB * huB;
          let pB1 = cB + uB * huB;

          let seg = closestPointsSegments(pA0, pA1, pB0, pB1);
          let raWorld = seg.p - posA;
          let rbWorld = seg.q - posB;
          candidatePointWorld[0] = 0.5 * (seg.p + seg.q);
          candidateRAWorld[0] = raWorld;
          candidateRBWorld[0] = rbWorld;
          candidatePenetration[0] = storedPenetration;
          candidateContactKey[0] = packEdgeContactFeature(k, l);
          candidateCount = 1u;
          manifoldPreferredT1 = uA;
          manifoldHasPreferredT1 = true;
        } else {
          // Face features: generate up to 8 clipped candidates, then reduce.
          var refPos = vec3f(0.0);
          var refHalf = vec3f(0.0);
          var refX = vec3f(0.0);
          var refY = vec3f(0.0);
          var refZ = vec3f(0.0);
          var incPos = vec3f(0.0);
          var incHalf = vec3f(0.0);
          var incX = vec3f(0.0);
          var incY = vec3f(0.0);
          var incZ = vec3f(0.0);
          if (bestFeature < 3) {
            refPos = posA; refHalf = halfA; refX = axA0; refY = axA1; refZ = axA2;
            incPos = posB; incHalf = halfB; incX = axB0; incY = axB1; incZ = axB2;
            refFeature = u32(bestFeature);
          } else {
            refPos = posB; refHalf = halfB; refX = axB0; refY = axB1; refZ = axB2;
            incPos = posA; incHalf = halfA; incX = axA0; incY = axA1; incZ = axA2;
            refFeature = u32(bestFeature - 3);
          }

          var refAxis = vec3f(0.0);
          var refU = vec3f(0.0);
          var refV = vec3f(0.0);
          var refH = 0.0;
          var refHU = 0.0;
          var refHV = 0.0;
          if (refFeature == 0u) {
            refAxis = refX; refU = refY; refV = refZ;
            refH = refHalf.x; refHU = refHalf.y; refHV = refHalf.z;
          } else if (refFeature == 1u) {
            refAxis = refY; refU = refX; refV = refZ;
            refH = refHalf.y; refHU = refHalf.x; refHV = refHalf.z;
          } else {
            refAxis = refZ; refU = refX; refV = refY;
            refH = refHalf.z; refHU = refHalf.x; refHV = refHalf.y;
          }

          refIsA = bestFeature < 3;
          // Reference-face clipping uses the reference outward normal.
          let nRef = select(-bestNormal, bestNormal, refIsA);
          let refSign = sgnnz(dot(refAxis, nRef));
          let refCenter = refPos + refAxis * (refSign * refH);
          manifoldPreferredT1 = refU;
          manifoldHasPreferredT1 = true;

          let ad0 = abs(dot(incX, nRef));
          let ad1 = abs(dot(incY, nRef));
          let ad2 = abs(dot(incZ, nRef));
          incFeature = 0u;
          if (ad1 > ad0 && ad1 >= ad2) {
            incFeature = 1u;
          } else if (ad2 > ad0 && ad2 > ad1) {
            incFeature = 2u;
          }

          var incAxis = vec3f(0.0);
          var incU = vec3f(0.0);
          var incV = vec3f(0.0);
          var incH = 0.0;
          var incHU = 0.0;
          var incHV = 0.0;
          if (incFeature == 0u) {
            incAxis = incX; incU = incY; incV = incZ;
            incH = incHalf.x; incHU = incHalf.y; incHV = incHalf.z;
          } else if (incFeature == 1u) {
            incAxis = incY; incU = incX; incV = incZ;
            incH = incHalf.y; incHU = incHalf.x; incHV = incHalf.z;
          } else {
            incAxis = incZ; incU = incX; incV = incY;
            incH = incHalf.z; incHU = incHalf.x; incHV = incHalf.y;
          }

          // Incident face must oppose the reference normal.
          let incSign = select(1.0, -1.0, dot(incAxis, nRef) > 0.0);
          let incCenter = incPos + incAxis * (incSign * incH);

          var polyIn: array<vec3f, 8>;
          var polyOut: array<vec3f, 8>;
          polyIn[0] = incCenter + incU * incHU + incV * incHV;
          polyIn[1] = incCenter - incU * incHU + incV * incHV;
          polyIn[2] = incCenter - incU * incHU - incV * incHV;
          polyIn[3] = incCenter + incU * incHU - incV * incHV;
          var polyCount = 4u;

          for (var planeIdx = 0u; planeIdx < 4u; planeIdx++) {
            if (polyCount == 0u) { break; }

            var planeN = vec3f(0.0);
            var planeD = 0.0;
            if (planeIdx == 0u) {
              planeN = refU;
              planeD = dot(refU, refCenter) + refHU;
            } else if (planeIdx == 1u) {
              planeN = -refU;
              planeD = dot(-refU, refCenter) + refHU;
            } else if (planeIdx == 2u) {
              planeN = refV;
              planeD = dot(refV, refCenter) + refHV;
            } else {
              planeN = -refV;
              planeD = dot(-refV, refCenter) + refHV;
            }

            var outCount = 0u;
            for (var vi = 0u; vi < polyCount; vi++) {
              let a = polyIn[vi];
              let b = polyIn[(vi + 1u) % polyCount];
              let da = dot(planeN, a) - planeD;
              let db = dot(planeN, b) - planeD;
              let inA = da <= 0.0;
              let inB = db <= 0.0;

              if (inA && inB) {
                if (outCount < 8u) {
                  polyOut[outCount] = b;
                  outCount += 1u;
                }
              } else if (inA && !inB) {
                let denom = da - db;
                if (abs(denom) > 1e-6 && outCount < 8u) {
                  let t = da / denom;
                  polyOut[outCount] = a + (b - a) * t;
                  outCount += 1u;
                }
              } else if (!inA && inB) {
                let denom = da - db;
                if (abs(denom) > 1e-6 && outCount < 8u) {
                  let t = da / denom;
                  polyOut[outCount] = a + (b - a) * t;
                  outCount += 1u;
                }
                if (outCount < 8u) {
                  polyOut[outCount] = b;
                  outCount += 1u;
                }
              }
            }

            polyCount = outCount;
            for (var vi = 0u; vi < polyCount; vi++) {
              polyIn[vi] = polyOut[vi];
            }
          }

          for (var vi = 0u; vi < polyCount; vi++) {
            let p = polyIn[vi];
            // Signed distance to reference plane (outward normal = nRef).
            let dist = dot(nRef, p - refCenter);
            if (dist > contactSlop) { continue; }

            let pStored = max(-dist, 0.0);
            let pRef = p - nRef * dist;
            let xA = select(p, pRef, refIsA);
            let xB = select(pRef, p, refIsA);
            // Keep the manifold point at the midpoint for dedupe/reduction,
            // but store distinct surface anchors for A/B like the reference.
            let cp = 0.5 * (xA + xB);
            var duplicate = false;
            for (var c = 0u; c < candidateCount; c++) {
              let dd = cp - candidatePointWorld[c];
              if (dot(dd, dd) < 1e-6) {
                duplicate = true;
                if (pStored > candidatePenetration[c]) {
                  candidatePointWorld[c] = cp;
                  candidateRAWorld[c] = xA - posA;
                  candidateRBWorld[c] = xB - posB;
                  candidatePenetration[c] = pStored;
                }
              }
            }
            if (duplicate) { continue; }

            if (candidateCount < 8u) {
              candidatePointWorld[candidateCount] = cp;
              candidateRAWorld[candidateCount] = xA - posA;
              candidateRBWorld[candidateCount] = xB - posB;
              candidatePenetration[candidateCount] = pStored;
              candidateContactKey[candidateCount] = packFaceContactFeature(refIsA, refFeature, incFeature, min(vi, 7u));
              candidateCount += 1u;
            }
          }
        }

        if (candidateCount > ${pairManifoldSlots}u) {
          // 4-point manifold reduction heuristic:
          // 1) deepest, 2) farthest from deepest,
          // 3) max triangle area, 4) max min-distance from previous 3.
          var selectedIdx: array<u32, ${pairManifoldSlots}>;
          var selCount = 0u;

          var deepestIdx = 0u;
          var deepestPen = -1e30;
          for (var c = 0u; c < candidateCount; c++) {
            if (candidatePenetration[c] > deepestPen) {
              deepestPen = candidatePenetration[c];
              deepestIdx = c;
            }
          }
          selectedIdx[0] = deepestIdx;
          selCount = 1u;

          if (${pairManifoldSlots}u > 1u) {
            var farIdx = deepestIdx;
            var farD2 = -1.0;
            let p0 = candidatePointWorld[deepestIdx];
            for (var c = 0u; c < candidateCount; c++) {
              if (c == deepestIdx) { continue; }
              let dp = candidatePointWorld[c] - p0;
              let d2 = dot(dp, dp);
              if (d2 > farD2) {
                farD2 = d2;
                farIdx = c;
              }
            }
            selectedIdx[1] = farIdx;
            selCount = 2u;
          }

          if (${pairManifoldSlots}u > 2u) {
            var areaIdx = selectedIdx[0];
            var areaBest = -1.0;
            let p0 = candidatePointWorld[selectedIdx[0]];
            let p1 = candidatePointWorld[selectedIdx[1]];
            let base = p1 - p0;
            for (var c = 0u; c < candidateCount; c++) {
              if (c == selectedIdx[0] || c == selectedIdx[1]) { continue; }
              let v = candidatePointWorld[c] - p0;
              let cr = cross(base, v);
              let a2 = dot(cr, cr);
              if (a2 > areaBest) {
                areaBest = a2;
                areaIdx = c;
              }
            }
            selectedIdx[2] = areaIdx;
            selCount = 3u;
          }

          if (${pairManifoldSlots}u > 3u) {
            var spreadIdx = selectedIdx[0];
            var spreadBest = -1.0;
            for (var c = 0u; c < candidateCount; c++) {
              var used = false;
              for (var s = 0u; s < selCount; s++) {
                if (c == selectedIdx[s]) {
                  used = true;
                }
              }
              if (used) { continue; }

              var minD2 = 1e30;
              for (var s = 0u; s < selCount; s++) {
                let dp = candidatePointWorld[c] - candidatePointWorld[selectedIdx[s]];
                let d2 = dot(dp, dp);
                if (d2 < minD2) {
                  minD2 = d2;
                }
              }
              if (minD2 > spreadBest) {
                spreadBest = minD2;
                spreadIdx = c;
              }
            }
            selectedIdx[3] = spreadIdx;
            selCount = 4u;
          }

          var reducedPointWorld: array<vec3f, ${pairManifoldSlots}>;
          var reducedRAWorld: array<vec3f, ${pairManifoldSlots}>;
          var reducedRBWorld: array<vec3f, ${pairManifoldSlots}>;
          var reducedPenetration: array<f32, ${pairManifoldSlots}>;
          var reducedContactKey: array<u32, ${pairManifoldSlots}>;
          for (var s = 0u; s < ${pairManifoldSlots}u; s++) {
            let idx = selectedIdx[s];
            reducedPointWorld[s] = candidatePointWorld[idx];
            reducedRAWorld[s] = candidateRAWorld[idx];
            reducedRBWorld[s] = candidateRBWorld[idx];
            reducedPenetration[s] = candidatePenetration[idx];
            reducedContactKey[s] = candidateContactKey[idx];
          }
          for (var s = 0u; s < ${pairManifoldSlots}u; s++) {
            candidatePointWorld[s] = reducedPointWorld[s];
            candidateRAWorld[s] = reducedRAWorld[s];
            candidateRBWorld[s] = reducedRBWorld[s];
            candidatePenetration[s] = reducedPenetration[s];
            candidateContactKey[s] = reducedContactKey[s];
          }
          candidateCount = ${pairManifoldSlots}u;
        }

        if (candidateCount == 0u) {
          if (debugEnabled > 0u && isFloorPair) {
            atomicAdd(&debugCounters[10], 1u);
          }
          // Degenerate face clipping fallback.
          let pA = obbSupport(posA, qA, halfA, bestNormal);
          let pB = obbSupport(posB, qB, halfB, -bestNormal);
          candidatePointWorld[0] = 0.5 * (pA + pB);
          candidateRAWorld[0] = pA - posA;
          candidateRBWorld[0] = pB - posB;
          candidatePenetration[0] = storedPenetration;
          candidateContactKey[0] = packFaceContactFeature(refIsA, refFeature, incFeature, 0u);
          candidateCount = 1u;
        }

        // Match the reference demo's compact manifold behavior more closely by
        // removing duplicate contact samples before persistent slot assignment.
        // The fixed-slot GPU backing store still keeps up to pairManifoldSlots
        // contacts, but each physical contact should appear at most once.
        if (candidateCount > 1u) {
          var compactPointWorld: array<vec3f, 8>;
          var compactRAWorld: array<vec3f, 8>;
          var compactRBWorld: array<vec3f, 8>;
          var compactPenetration: array<f32, 8>;
          var compactContactKey: array<u32, 8>;
          var compactCount = 0u;

          for (var c = 0u; c < candidateCount; c++) {
            let candidatePoint = candidatePointWorld[c];
            let candidateRA = candidateRAWorld[c];
            let candidateRB = candidateRBWorld[c];
            let candidatePen = candidatePenetration[c];
            let candidateKey = candidateContactKey[c];

            var duplicateIdx = 0xffffffffu;
            for (var k = 0u; k < compactCount; k++) {
              let dp = candidatePoint - compactPointWorld[k];
              let d2 = dot(dp, dp);
              if (d2 < 1e-6) {
                duplicateIdx = k;
                break;
              }
            }

            if (duplicateIdx != 0xffffffffu) {
              // Match the reference addContact behavior: keep the first
              // clipped-polygon contact and ignore later near-duplicate rows
              // instead of replacing them with a deeper sample.
              continue;
            }

            compactPointWorld[compactCount] = candidatePoint;
            compactRAWorld[compactCount] = candidateRA;
            compactRBWorld[compactCount] = candidateRB;
            compactPenetration[compactCount] = candidatePen;
            compactContactKey[compactCount] = candidateKey;
            compactCount += 1u;
          }

          for (var c = 0u; c < compactCount; c++) {
            candidatePointWorld[c] = compactPointWorld[c];
            candidateRAWorld[c] = compactRAWorld[c];
            candidateRBWorld[c] = compactRBWorld[c];
            candidatePenetration[c] = compactPenetration[c];
            candidateContactKey[c] = compactContactKey[c];
          }
          candidateCount = compactCount;
        }

        if (candidateCount > 1u) {
          // Preserve a deterministic in-manifold ordinal closer to the reference
          // contact list semantics instead of the reduction-selection order.
          for (var passIdx = 0u; passIdx < 8u; passIdx++) {
            if (passIdx + 1u >= candidateCount) { break; }
            let last = candidateCount - 1u - passIdx;
            for (var idx = 0u; idx < 8u; idx++) {
              if (idx >= last) { break; }
              let next = idx + 1u;
              let leftKey = candidateContactKey[idx];
              let rightKey = candidateContactKey[next];
              var shouldSwap = leftKey > rightKey;
              if (!shouldSwap && leftKey == rightKey) {
                shouldSwap = candidatePenetration[idx] < candidatePenetration[next];
              }
              if (!shouldSwap) { continue; }

              let swapPoint = candidatePointWorld[idx];
              candidatePointWorld[idx] = candidatePointWorld[next];
              candidatePointWorld[next] = swapPoint;

              let swapRA = candidateRAWorld[idx];
              candidateRAWorld[idx] = candidateRAWorld[next];
              candidateRAWorld[next] = swapRA;

              let swapRB = candidateRBWorld[idx];
              candidateRBWorld[idx] = candidateRBWorld[next];
              candidateRBWorld[next] = swapRB;

              let swapPen = candidatePenetration[idx];
              candidatePenetration[idx] = candidatePenetration[next];
              candidatePenetration[next] = swapPen;

              let swapKey = candidateContactKey[idx];
              candidateContactKey[idx] = candidateContactKey[next];
              candidateContactKey[next] = swapKey;
            }
          }
        }

        if (bestFeature < 6 && candidateCount > 0u) {
          // Match avbd-demo3d contact identity more closely: assign the final
          // face-contact ordinal only after manifold reduction/compaction and
          // deterministic sorting, so each stored row gets a unique feature
          // key within the manifold.
          for (var c = 0u; c < candidateCount; c++) {
            candidateContactKey[c] = packFaceContactFeature(refIsA, refFeature, incFeature, c);
          }
        }

        let staleBand = contactSlop + hysteresis;
        let separatingKeepBand = 0.25 * staleBand;
        let separatingKeepMinNormal = 2.0;
        // Tangential drift pruning removes ghost contacts from rotating pairs.
        // Lower thresholds are safer but can look softer (more manifold churn).
        let maxDrift = max(3.5 * contactSlop, 0.016);
        let maxDrift2 = maxDrift * maxDrift;
        let normalThreshold = 0.95;
        let invalidSlot = 0xffffffffu;
        let warmstartReasonNone = 0u;
        let warmstartReasonExactFeature = 1u;
        let warmstartReasonNormalGate = 3u;
        let warmstartReasonInactiveSlot = 4u;
        let manifoldStickCooldown = 0u;
        var manifoldTangentBasis = canonicalTangentBasis(bestNormal);
        if (manifoldHasPreferredT1) {
          manifoldTangentBasis = tangentBasisFromPreferredT1(bestNormal, manifoldPreferredT1);
        }
        var manifoldTangentAngle = tangentBasisAngleFromT1(bestNormal, manifoldTangentBasis.t1);

        // Snapshot the previous manifold state so the new compact manifold can
        // exact-match against last frame without depending on slot continuity.
        var prevSlotActive: array<u32, ${pairManifoldSlots}>;
        var prevSlotMeta: array<vec4f, ${pairManifoldSlots}>;
        var prevSlotArmA: array<vec4f, ${pairManifoldSlots}>;
        var prevSlotArmB: array<vec4f, ${pairManifoldSlots}>;
        for (var s = 0u; s < ${pairManifoldSlots}u; s++) {
          let slot = pairBase + s;
          let slotInfo = loadContactMeta(pairContacts, slot);
          let slotActive = select(0u, 1u, slotInfo.z >= 0.5);
          prevSlotActive[s] = slotActive;
          prevSlotMeta[s] = slotInfo;
          if (slotActive > 0u) {
            prevSlotArmA[s] = loadContactArmA(pairContacts, slot);
            prevSlotArmB[s] = loadContactArmB(pairContacts, slot);
          }
        }

        var prevSlotMatched: array<u32, ${pairManifoldSlots}>;
        var candidatePrevSlot: array<u32, ${pairManifoldSlots}>;
        var candidateWarmstartReason: array<u32, ${pairManifoldSlots}>;
        for (var s = 0u; s < ${pairManifoldSlots}u; s++) {
          prevSlotMatched[s] = 0u;
          candidatePrevSlot[s] = invalidSlot;
          candidateWarmstartReason[s] = warmstartReasonNone;
        }

        for (var c = 0u; c < candidateCount; c++) {
          let candidatePoint = candidatePointWorld[c];
          let candidateFeatureKey = candidateContactKey[c];
          var bestSlot = invalidSlot;
          var bestD2 = 1e30;
          for (var s = 0u; s < ${pairManifoldSlots}u; s++) {
            if (prevSlotActive[s] == 0u || prevSlotMatched[s] != 0u) { continue; }
            if (decodePackedContactFeatureKey(prevSlotMeta[s].w) != candidateFeatureKey) { continue; }
            let oldRAStored = prevSlotArmA[s].xyz;
            let oldRBStored = prevSlotArmB[s].xyz;
            let oldRA = qrot(qA, oldRAStored);
            let oldRB = qrot(qB, oldRBStored);
            let oldPoint = 0.5 * ((posA + oldRA) + (posB + oldRB));
            let dp = candidatePoint - oldPoint;
            let d2 = dot(dp, dp);
            if (d2 < bestD2) {
              bestD2 = d2;
              bestSlot = s;
            }
          }
          if (bestSlot != invalidSlot) {
            prevSlotMatched[bestSlot] = 1u;
            candidatePrevSlot[c] = bestSlot;
            candidateWarmstartReason[c] = warmstartReasonExactFeature;
          }
        }

        var exactMatchPreferredT1 = vec3f(0.0);
        var exactMatchPreferredCount = 0u;
        for (var c = 0u; c < candidateCount; c++) {
          let matchedPrevSlot = candidatePrevSlot[c];
          if (matchedPrevSlot == invalidSlot) { continue; }
          if (candidateWarmstartReason[c] != warmstartReasonExactFeature) { continue; }
          let prevNormal = loadContactNormalPen(pairContacts, pairBase + matchedPrevSlot).xyz;
          let prevTangentAngle = prevSlotArmA[matchedPrevSlot].w;
          let prevBasis = tangentBasisFromAngle(prevNormal, prevTangentAngle);
          exactMatchPreferredT1 += prevBasis.t1;
          exactMatchPreferredCount += 1u;
        }
        // Preserve manifold-level tangent sign continuity for exact matched
        // manifolds without abandoning the shared-basis convention.
        if (
          exactMatchPreferredCount > 0u
          && dot(exactMatchPreferredT1, manifoldTangentBasis.t1) < 0.0
        ) {
          manifoldTangentBasis = TangentBasis(-manifoldTangentBasis.t1, -manifoldTangentBasis.t2);
          manifoldTangentAngle = tangentBasisAngleFromT1(bestNormal, manifoldTangentBasis.t1);
          if (debugEnabled > 0u) {
            atomicAdd(&debugCounters[6], 1u);
          }
        }

        var writeCount = 0u;
        for (var c = 0u; c < candidateCount; c++) {
          let candidatePoint = candidatePointWorld[c];
          let candidateFeatureKey = candidateContactKey[c];
          let raWorld = candidateRAWorld[c];
          let rbWorld = candidateRBWorld[c];
          var contactRAWorld = raWorld;
          var contactRBWorld = rbWorld;
          var candidateStoredPen = candidatePenetration[c];
          let matchedPrevSlot = candidatePrevSlot[c];
          let matchedPrevContact = pairBase + matchedPrevSlot;
          let preserveWarmstart = matchedPrevSlot != invalidSlot;
          var warmstartDebugReason = candidateWarmstartReason[c];
          var tangentBasis = manifoldTangentBasis;
          var useStickingPoint = false;
          var canWarmstart = false;
          var exactFeatureWarmstart = false;
          var carryStick = 0u;
          var carryStickAnchorReuse = 0u;
          var lambdaNKeep = 0.0;
          var lambdaT = vec2f(0.0, 0.0);
          var carriedC0T = vec2f(0.0, 0.0);
          var useCarriedC0T = false;
          var carriedShadow = vec4f(0.0);
          var carriedDual = vec4f(0.0);
          var carriedPenalty = vec4f(1.0, 1.0, 1.0, frictionScale);

          if (preserveWarmstart) {
            let prevInfo = prevSlotMeta[matchedPrevSlot];
            let prevNormalPen = loadContactNormalPen(pairContacts, matchedPrevContact);
            let prevNormal = prevNormalPen.xyz;
            let prevFeature = i32(decodePackedBaseFeature(prevInfo.w));
            let prevFeatureKey = decodePackedContactFeatureKey(prevInfo.w);
            let prevStick = decodePackedStick(prevInfo.w);
            let prevTangentAngle = prevSlotArmA[matchedPrevSlot].w;
            let sameFeature = prevFeatureKey == candidateFeatureKey;
            exactFeatureWarmstart = sameFeature;
            var matchNormalDot = dot(prevNormal, bestNormal);
            if ((prevFeature >= 6) != (bestFeature >= 6)) {
              matchNormalDot = -1.0;
            }

            // Exact-key matches reuse prior state like the reference compact
            // manifold merge, while still requiring normal agreement.
            canWarmstart = preserveWarmstart && select(
              matchNormalDot > normalThreshold,
              true,
              sameFeature,
            );
            if (!canWarmstart) {
              warmstartDebugReason = warmstartReasonNormalGate;
            }

            if (canWarmstart) {
              let oldRAStored = prevSlotArmA[matchedPrevSlot].xyz;
              let oldRBStored = prevSlotArmB[matchedPrevSlot].xyz;
              let oldRA = qrot(qA, oldRAStored);
              let oldRB = qrot(qB, oldRBStored);
              let oldPointA = posA + oldRA;
              let oldPointB = posB + oldRB;
              useStickingPoint = prevStick > 0u && sameFeature && !specialPair;
              if (useStickingPoint) {
                if (debugEnabled > 0u) {
                  atomicAdd(&debugCounters[5], 1u);
                }
                // avbd-demo3d parity: exact sticky matches keep the old
                // anchors; otherwise the matched contact keeps the new anchors
                // and C0 is recomputed from whichever anchors were chosen.
                contactRAWorld = oldRA;
                contactRBWorld = oldRB;
                candidateStoredPen = max(
                  -dot((posB + contactRBWorld) - (posA + contactRAWorld), bestNormal),
                  0.0,
                );
              }
              carryStick = select(0u, prevStick, sameFeature && !specialPair);
              carryStickAnchorReuse = select(0u, 1u, useStickingPoint);
              let prevShadow = loadContactShadow(pairContacts, matchedPrevContact);
              let prevDual = loadContactDual(pairContacts, matchedPrevContact);
              lambdaNKeep = max(prevShadow.x, 0.0);
              carriedShadow = prevShadow;
              carriedDual = prevDual;
              carriedPenalty = loadContactPenalty(pairContacts, matchedPrevContact);

              let warmFriction = frictionStatic * frictionScale;
              let prevNLen2 = dot(prevNormal, prevNormal);
              let writeTangentBasis = tangentBasisFromAngle(bestNormal, manifoldTangentAngle);
              if (prevNLen2 > 1e-10) {
                let prevBasis = tangentBasisFromAngle(prevNormal, prevTangentAngle);
                let jtWorld = prevBasis.t1 * prevShadow.y + prevBasis.t2 * prevShadow.z;
                lambdaT = vec2f(
                  dot(jtWorld, writeTangentBasis.t1),
                  dot(jtWorld, writeTangentBasis.t2),
                );
                let maxT = warmFriction * lambdaNKeep;
                let maxT2 = maxT * maxT;
                let lt2 = dot(lambdaT, lambdaT);
                if (lt2 > maxT2 && lt2 > 1e-12) {
                  lambdaT *= maxT * inverseSqrt(lt2);
                }
                carriedShadow = vec4f(lambdaNKeep, lambdaT.x, lambdaT.y, prevShadow.w);
                let prevC0TB = loadContactConstraintC0(pairContacts, matchedPrevContact).yz;
                let c0TWorld = prevBasis.t1 * prevC0TB.x + prevBasis.t2 * prevC0TB.y;
                carriedC0T = vec2f(
                  dot(c0TWorld, writeTangentBasis.t1),
                  dot(c0TWorld, writeTangentBasis.t2),
                );
                useCarriedC0T = sameFeature;
                let prevDualTB = prevDual.yz;
                let dualTWorld = prevBasis.t1 * prevDualTB.x + prevBasis.t2 * prevDualTB.y;
                let rotatedDualTB = vec2f(
                  dot(dualTWorld, writeTangentBasis.t1),
                    dot(dualTWorld, writeTangentBasis.t2),
                );
                carriedDual = vec4f(prevDual.x, rotatedDualTB, 0.0);
              }
            }
          } else {
            warmstartDebugReason = warmstartReasonInactiveSlot;
          }

          let finalPointA = posA + contactRAWorld;
          let finalPointB = posB + contactRBWorld;
          let finalRawPen = -dot(finalPointB - finalPointA, bestNormal);
          if (finalRawPen < 0.0) {
            if (debugEnabled > 0u && useStickingPoint) {
              atomicAdd(&debugCounters[4], 1u);
            }
            continue;
          }
          candidateStoredPen = max(finalRawPen, 0.0);

          let writeTangentBasis = tangentBasisFromAngle(bestNormal, manifoldTangentAngle);
          let tangentAngle = manifoldTangentAngle;
          let normalContactMargin = ${AVBD_COLLISION_MARGIN};
          let cachedC0Vec = finalPointA - finalPointB;
          let cachedC0N = -dot(cachedC0Vec, bestNormal) + normalContactMargin;
          var cachedC0T1 = dot(cachedC0Vec, writeTangentBasis.t1);
          var cachedC0T2 = dot(cachedC0Vec, writeTangentBasis.t2);
          if (canWarmstart && exactFeatureWarmstart && useCarriedC0T) {
            cachedC0T1 = carriedC0T.x;
            cachedC0T2 = carriedC0T.y;
          }
          let storedRA = qrot(qconj(qA), contactRAWorld);
          let storedRB = qrot(qconj(qB), contactRBWorld);
          let targetIndex = pairBase + writeCount;
          // Preserve the actual pair/manifold slot order seen by the contact
          // pipeline instead of reconstructing a synthetic rank from (i, j).
          let manifoldSequence = manifold;
          storeContactMeta(pairContacts, targetIndex, vec4f(
            f32(i),
            f32(j),
            f32(manifoldSequence + 1u),
            packContactInfo(
              candidateFeatureKey,
              manifoldStickCooldown,
              select(0u, 1u, canWarmstart),
              carryStick,
              carryStickAnchorReuse,
              warmstartDebugReason,
            ),
          ));
          storeContactNormalPen(pairContacts, targetIndex, vec4f(bestNormal, candidateStoredPen));
          storeContactArmA(pairContacts, targetIndex, vec4f(storedRA, tangentAngle));
          storeContactArmB(pairContacts, targetIndex, vec4f(storedRB, 0.0));
          storeContactConstraintC0(pairContacts, targetIndex, vec4f(cachedC0N, cachedC0T1, cachedC0T2, 0.0));
          if (canWarmstart && exactFeatureWarmstart && matchedPrevSlot != invalidSlot) {
            // avbd-demo3d parity: exact matches carry the previous contact
            // object into the new slot first, then geometry/C0 are refreshed
            // from the chosen anchors above.
            storeContactShadow(pairContacts, targetIndex, carriedShadow);
            storeContactDual(pairContacts, targetIndex, carriedDual);
            storeContactPenalty(pairContacts, targetIndex, carriedPenalty);
            storeContactCache(pairContacts, targetIndex, loadContactCache(pairContacts, matchedPrevContact));
          } else {
            // Unmatched rows start fresh; prepareState owns any
            // subsequent warmstart decision.
            storeContactShadow(pairContacts, targetIndex, select(
              vec4f(0.0, 0.0, 0.0, frictionScale),
              vec4f(lambdaNKeep, lambdaT.x, lambdaT.y, frictionScale),
              canWarmstart,
            ));
            storeContactDual(pairContacts, targetIndex, vec4f(0.0));
            storeContactPenalty(pairContacts, targetIndex, vec4f(1.0, 1.0, 1.0, frictionScale));
            storeContactCacheWord(pairContacts, targetIndex, 0u);
          }
          writeCount += 1u;
        }

        for (var s = writeCount; s < ${pairManifoldSlots}u; s++) {
          deactivateContactSlot(pairContacts, pairBase + s, f32(i), f32(j));
        }

        if (debugEnabled > 0u && isFloorPair) {
          if (writeCount == 0u) {
            atomicAdd(&debugCounters[11], 1u);
          } else {
            atomicAdd(&debugCounters[12], 1u);
          }
        }
      }

      fn deactivateContactSlot(
        pairContacts: ptr<storage, array<vec4f>, read_write>,
        slot: u32,
        pairI: f32,
        pairJ: f32,
      ) {
        storeContactMeta(pairContacts, slot, vec4f(pairI, pairJ, 0.0, 0.0));
        storeContactCacheWord(pairContacts, slot, 0u);
      }

      fn deactivateManifold(
        pairContacts: ptr<storage, array<vec4f>, read_write>,
        pairBase: u32,
        pairI: f32,
        pairJ: f32,
      ) {
        for (var s = 0u; s < ${pairManifoldSlots}u; s++) {
          deactivateContactSlot(pairContacts, pairBase + s, pairI, pairJ);
        }
      }

      fn packFaceContactFeature(referenceIsA: bool, referenceAxis: u32, incidentAxis: u32, ordinal: u32) -> u32 {
        let featureType = select(1u, 0u, referenceIsA);
        return (ordinal & 0x7u)
          | ((incidentAxis & 0x3u) << 3u)
          | ((referenceAxis & 0x3u) << 5u)
          | ((featureType & 0x3u) << 7u);
      }

      fn packEdgeContactFeature(axisA: u32, axisB: u32) -> u32 {
        return ((axisB & 0x3u) << 3u)
          | ((axisA & 0x3u) << 5u)
          | (2u << 7u);
      }

      fn axisValue3(v: vec3f, axis: u32) -> f32 {
        if (axis == 0u) { return v.x; }
        if (axis == 1u) { return v.y; }
        return v.z;
      }

      fn axisVector3(axis: u32, axis0: vec3f, axis1: vec3f, axis2: vec3f) -> vec3f {
        if (axis == 0u) { return axis0; }
        if (axis == 1u) { return axis1; }
        return axis2;
      }

      fn dominantAbsAxis3(v: vec3f) -> u32 {
        let av = abs(v);
        if (av.y > av.x && av.y >= av.z) { return 1u; }
        if (av.z > av.x && av.z > av.y) { return 2u; }
        return 0u;
      }

      fn leastAxis3(v: vec3f) -> u32 {
        if (v.y < v.x && v.y <= v.z) { return 1u; }
        if (v.z < v.x && v.z < v.y) { return 2u; }
        return 0u;
      }

      fn decodePackedContactFeatureKey(encoded: f32) -> u32 {
        return bitcast<u32>(encoded) & 0x1FFu;
      }

      fn decodePackedContactFeatureTypeKey(featureKey: u32) -> u32 {
        return (featureKey >> 7u) & 0x3u;
      }

      fn decodePackedBaseFeature(encoded: f32) -> u32 {
        let featureKey = decodePackedContactFeatureKey(encoded);
        let featureType = decodePackedContactFeatureTypeKey(featureKey);
        let referenceAxis = (featureKey >> 5u) & 0x3u;
        let incidentAxis = (featureKey >> 3u) & 0x3u;
        if (featureType == 0u) {
          return referenceAxis;
        }
        if (featureType == 1u) {
          return 3u + referenceAxis;
        }
        return 6u + referenceAxis * 3u + incidentAxis;
      }

      fn decodePackedCooldown(encoded: f32) -> u32 {
        return (bitcast<u32>(encoded) >> 9u) & 0x7Fu;
      }

      fn decodePackedStick(encoded: f32) -> u32 {
        return (bitcast<u32>(encoded) >> 17u) & 0x1u;
      }

	      fn decodePackedStickAnchorReuse(encoded: f32) -> u32 {
	        return (bitcast<u32>(encoded) >> 18u) & 0x1u;
	      }

	      fn decodePackedWarmstartDebugReason(encoded: f32) -> u32 {
	        return (bitcast<u32>(encoded) >> 21u) & 0x7u;
	      }

      fn packContactInfo(
        featureKey: u32,
        cooldown: u32,
        preserveWarmstart: u32,
        stick: u32,
        stickAnchorReuse: u32,
        warmstartDebugReason: u32,
      ) -> f32 {
        return bitcast<f32>(
          (featureKey & 0x1FFu)
          | ((cooldown & 0x7Fu) << 9u)
          | ((preserveWarmstart & 0x1u) << 16u)
          | ((stick & 0x1u) << 17u)
          | ((stickAnchorReuse & 0x1u) << 18u)
          | ((warmstartDebugReason & 0x7u) << 21u),
        );
      }

      struct SegResult {
        p: vec3f,
        q: vec3f,
      };

      fn sgnnz(x: f32) -> f32 {
        return select(1.0, -1.0, x < 0.0);
      }

      fn closestPointsSegments(p0: vec3f, p1: vec3f, q0: vec3f, q1: vec3f) -> SegResult {
        let u = p1 - p0;
        let v = q1 - q0;
        let w0 = p0 - q0;

        let a = dot(u, u);
        let b = dot(u, v);
        let c = dot(v, v);
        let d = dot(u, w0);
        let e = dot(v, w0);

        let D = a * c - b * b;
        let EPS = 1e-6;

        var sN: f32;
        var sD = D;
        var tN: f32;
        var tD = D;

        if (D < EPS) {
          sN = 0.0;
          sD = 1.0;
          tN = e;
          tD = c;
        } else {
          sN = b * e - c * d;
          tN = a * e - b * d;

          if (sN < 0.0) {
            sN = 0.0;
            tN = e;
            tD = c;
          } else if (sN > sD) {
            sN = sD;
            tN = e + b;
            tD = c;
          }
        }

        if (tN < 0.0) {
          tN = 0.0;
          if (-d < 0.0) {
            sN = 0.0;
          } else if (-d > a) {
            sN = sD;
          } else {
            sN = -d;
            sD = a;
          }
        } else if (tN > tD) {
          tN = tD;
          if (-d + b < 0.0) {
            sN = 0.0;
          } else if (-d + b > a) {
            sN = sD;
          } else {
            sN = -d + b;
            sD = a;
          }
        }

        let sc = select(0.0, sN / sD, abs(sN) > EPS);
        let tc = select(0.0, tN / tD, abs(tN) > EPS);

        let p = p0 + sc * u;
        let q = q0 + tc * v;
        return SegResult(p, q);
      }
    `
    );
    const pairShader = wgslFn(
      pairShaderSource,
      [qrot, qconj, obbSupport, tangentBasisHelpers, contactRecordHelpers, shapeEncodingHelpers]
    );
    const pairKernelStorageBuffers = 6;
    assertStorageBufferBudget("Contact Pair Generate", pairKernelStorageBuffers);
    this.pairKernel = pairShader({
      positions: storage(positions, "vec4f", maxBodies).toReadOnly(),
      quaternions: storage(quaternions, "vec4f", maxBodies).toReadOnly(),
      shapes: storage(shapes, "vec4f", maxBodies).toReadOnly(),
      pairContacts: storage(pairContacts, "vec4f", maxPairContacts * CONTACT_RECORD_VEC4S),
      pairActivity: storage(pairActivity, "uint", pairActivityWordCount),
      debugCounters: storage(this.debugCountersAttr, "uint", 27).toAtomic(),
      debugEnabled: uniform(0),
      bodyCount: uniform(0),
      pairCount: uniform(0),
      pairDispatchCount: uniform(0),
      useCandidatePairs: uniform(0),
      floorDebugBody: uniform(4294967295),
      contactSlop: uniform(5e-3),
      frictionStatic: uniform(AVBD_FRICTION_STATIC),
      workgroupId,
      localId
    }).computeKernel([WORKGROUP_SIZE2, 1, 1]).setName("Contact Pair Generate");
    this.pairKernelDebug = pairShader({
      positions: storage(positions, "vec4f", maxBodies).toReadOnly(),
      quaternions: storage(quaternions, "vec4f", maxBodies).toReadOnly(),
      shapes: storage(shapes, "vec4f", maxBodies).toReadOnly(),
      pairContacts: storage(pairContacts, "vec4f", maxPairContacts * CONTACT_RECORD_VEC4S),
      pairActivity: storage(pairActivity, "uint", pairActivityWordCount),
      debugCounters: storage(this.debugCountersAttr, "uint", 27).toAtomic(),
      debugEnabled: uniform(0),
      bodyCount: uniform(0),
      pairCount: uniform(0),
      pairDispatchCount: uniform(0),
      useCandidatePairs: uniform(0),
      floorDebugBody: uniform(4294967295),
      contactSlop: uniform(5e-3),
      frictionStatic: uniform(AVBD_FRICTION_STATIC),
      workgroupId,
      localId
    }).computeKernel([WORKGROUP_SIZE2, 1, 1]).setName("Contact Pair Generate");
    const clearPairBodyCountsShader = wgslFn(
      /* wgsl */
      `
      fn compute(
        pairBodyContactCounts: ptr<storage, array<atomic<u32>>, read_write>,
        pairActivity: ptr<storage, array<atomic<u32>>, read_write>,
        bodyCount: u32,
        workgroupId: vec3u,
        localId: vec3u,
      ) -> void {
        let gid = workgroupId.x * ${WORKGROUP_SIZE2}u + localId.x;
        if (gid == 0u) {
          atomicStore(&pairActivity[${pairActiveContactsOffset}u], 0u);
        }
        if (gid >= bodyCount) { return; }
        atomicStore(&pairBodyContactCounts[gid], 0u);
      }
    `
    );
    this.clearPairBodyCountsKernel = clearPairBodyCountsShader({
      pairBodyContactCounts: storage(pairBodyContactCounts, "uint", maxBodies).toAtomic(),
      pairActivity: storage(pairActivity, "uint", pairActivityWordCount).toAtomic(),
      bodyCount: uniform(0),
      workgroupId,
      localId
    }).computeKernel([WORKGROUP_SIZE2, 1, 1]).setName("Contact Clear Body Counts");
    const clearDebugCountersShader = wgslFn(
      /* wgsl */
      `
      fn compute(
        debugCounters: ptr<storage, array<atomic<u32>>, read_write>,
        debugEnabled: u32,
      ) -> void {
        if (debugEnabled == 0u) { return; }
        for (var i = 0u; i < 27u; i++) {
          atomicStore(&debugCounters[i], 0u);
        }
      }
    `
    );
    this.clearDebugCountersKernel = clearDebugCountersShader({
      debugCounters: storage(this.debugCountersAttr, "uint", 27).toAtomic(),
      debugEnabled: uniform(0)
    }).computeKernel([1, 1, 1]).setName("Contact Clear Debug Counters");
    const clearActiveCandidateSlotsShader = wgslFn(
      /* wgsl */
      `
      fn compute(
        pairActivity: ptr<storage, array<atomic<u32>>, read_write>,
      ) -> void {
        atomicStore(&pairActivity[${pairActiveCandidateSlotsOffset}u], 0u);
      }
    `
    );
    this.clearActiveCandidateSlotsKernel = clearActiveCandidateSlotsShader({
      pairActivity: storage(pairActivity, "uint", pairActivityWordCount).toAtomic()
    }).computeKernel([1, 1, 1]).setName("Contact Clear Active Candidate Slots");
    const buildActiveCandidateSlotsShader = wgslFn(
      /* wgsl */
      `
      fn compute(
        pairActivity: ptr<storage, array<atomic<u32>>, read_write>,
        pairCount: u32,
        pairDispatchCount: u32,
        useCandidatePairs: u32,
        workgroupId: vec3u,
        localId: vec3u,
      ) -> void {
        let gid = workgroupId.x * ${WORKGROUP_SIZE2}u + localId.x;
        if (gid >= pairDispatchCount) { return; }

        var manifold = gid;
        if (useCandidatePairs > 0u) {
          let packedPair = atomicLoad(&pairActivity[${pairCandidateIndicesOffset}u + gid + 1u]);
          let i = packedPair & 0xFFFFu;
          let j = packedPair >> 16u;
          if (i >= j) { return; }
        } else {
          if (gid >= pairCount) { return; }
          if (gid >= ${maxPairDispatchPairs}u) { return; }
        }

        let outIndex = atomicAdd(&pairActivity[${pairActiveCandidateSlotsOffset}u], 1u);
        if (outIndex < ${maxPairDispatchPairs}u) {
          atomicStore(&pairActivity[${pairActiveCandidateSlotsOffset}u + outIndex + 1u], manifold);
        }
      }
    `
    );
    this.buildActiveCandidateSlotsKernel = buildActiveCandidateSlotsShader({
      pairActivity: storage(pairActivity, "uint", pairActivityWordCount).toAtomic(),
      pairCount: uniform(0),
      pairDispatchCount: uniform(0),
      useCandidatePairs: uniform(0),
      workgroupId,
      localId
    }).computeKernel([WORKGROUP_SIZE2, 1, 1]).setName("Contact Build Active Candidate Slots");
    const buildPairDispatchArgsShader = wgslFn(
      /* wgsl */
      `
      fn compute(
        pairActivity: ptr<storage, array<u32>, read_write>,
        pairDispatchIndirect: ptr<storage, array<u32>, read_write>,
        pairDispatchCount: u32,
      ) -> void {
        let dispatchThreads = min(pairActivity[${pairActiveCandidateSlotsOffset}u], pairDispatchCount);

        let workgroups = (dispatchThreads + ${WORKGROUP_SIZE2}u - 1u) / ${WORKGROUP_SIZE2}u;
        pairDispatchIndirect[0] = workgroups;
        pairDispatchIndirect[1] = 1u;
        pairDispatchIndirect[2] = 1u;
      }
    `
    );
    this.buildPairDispatchArgsKernel = buildPairDispatchArgsShader({
      pairActivity: storage(pairActivity, "uint", pairActivityWordCount),
      pairDispatchIndirect: storage(this.pairDispatchIndirectAttr, "uint", 3),
      pairDispatchCount: uniform(0)
    }).computeKernel([1, 1, 1]).setName("Contact Build Dispatch Args");
    const buildPairBodyListsShaderSource = (
      /* wgsl */
      `
      fn compute(
        pairContacts: ptr<storage, array<vec4f>, read_write>,
        positions: ptr<storage, array<vec4f>, read>,
        pairActivity: ptr<storage, array<atomic<u32>>, read_write>,
        pairBodyContactCounts: ptr<storage, array<atomic<u32>>, read_write>,
        pairBodyContactIndices: ptr<storage, array<u32>, read_write>,
        debugCounters: ptr<storage, array<atomic<u32>>, read_write>,
        bodyCount: u32,
        pairDispatchCount: u32,
        debugEnabled: u32,
        workgroupId: vec3u,
        localId: vec3u,
      ) -> void {
        let gid = workgroupId.x * ${WORKGROUP_SIZE2}u + localId.x;
        let activeCandidateCount = min(atomicLoad(&pairActivity[${pairActiveCandidateSlotsOffset}u]), pairDispatchCount);
        if (gid >= activeCandidateCount) { return; }
        let manifold = atomicLoad(&pairActivity[${pairActiveCandidateSlotsOffset}u + gid + 1u]);
        if (manifold >= pairDispatchCount) { return; }

        let pairBase = manifold * ${pairManifoldSlots}u;
        var manifoldHasActive = false;
        for (var s = 0u; s < ${pairManifoldSlots}u; s++) {
          let p = pairBase + s;
          let pairInfo = loadContactMeta(pairContacts, p);
          if (pairInfo.z < 0.5) { continue; }
          manifoldHasActive = true;

          let i = u32(pairInfo.x);
          let j = u32(pairInfo.y);
          if (i >= bodyCount || j >= bodyCount) { continue; }
          let dynamicI = positions[i].w > 0.0;
          let dynamicJ = positions[j].w > 0.0;
          if (!dynamicI && !dynamicJ) { continue; }

          var wroteI = false;
          var slotI = 0u;
          if (dynamicI) {
            slotI = atomicAdd(&pairBodyContactCounts[i], 1u);
            if (slotI < ${maxPairContactsPerBody}u) {
              pairBodyContactIndices[i * ${maxPairContactsPerBody}u + slotI] = p;
              wroteI = true;
            }
            if (slotI >= ${maxPairContactsPerBody}u && debugEnabled > 0u) {
              atomicAdd(&debugCounters[24], 1u);
            }
          }

          var wroteJ = false;
          var slotJ = 0u;
          if (dynamicJ) {
            slotJ = atomicAdd(&pairBodyContactCounts[j], 1u);
            if (slotJ < ${maxPairContactsPerBody}u) {
              pairBodyContactIndices[j * ${maxPairContactsPerBody}u + slotJ] = p;
              wroteJ = true;
            }
            if (slotJ >= ${maxPairContactsPerBody}u && debugEnabled > 0u) {
              atomicAdd(&debugCounters[24], 1u);
            }
          }

          var keepContact = false;
          if (dynamicI && dynamicJ) {
            // Dynamic-dynamic contacts require both bodies to store the slot.
            keepContact = wroteI && wroteJ;
            if (!keepContact) {
              if (debugEnabled > 0u) {
                atomicAdd(&debugCounters[25], 1u);
              }
              if (wroteI) {
                pairBodyContactIndices[i * ${maxPairContactsPerBody}u + slotI] = ${maxPairContacts}u;
              }
              if (wroteJ) {
                pairBodyContactIndices[j * ${maxPairContactsPerBody}u + slotJ] = ${maxPairContacts}u;
              }
            }
          } else if (dynamicI) {
            // Static-dynamic contacts are solved by the dynamic body only.
            keepContact = wroteI;
          } else if (dynamicJ) {
            keepContact = wroteJ;
          }

          if (keepContact) {
            // Build a compact active-contact list consumed by solver kernels.
            let activeWrite = atomicAdd(&pairActivity[${pairActiveContactsOffset}u], 1u);
            if (activeWrite < ${maxActivePairContacts}u) {
              atomicStore(&pairActivity[${pairActiveContactsOffset}u + activeWrite + 1u], p);
            } else if (debugEnabled > 0u) {
              atomicAdd(&debugCounters[26], 1u);
            }
          }
        }

        if (manifoldHasActive) {
          if (debugEnabled > 0u) {
            atomicAdd(&debugCounters[1], 1u);
          }
        }
      }
    `
    );
    const buildPairBodyListsShaderReleaseSource = buildPairBodyListsShaderSource.replace(
      `        debugCounters: ptr<storage, array<atomic<u32>>, read_write>,
`,
      ""
    ).replace(
      `        debugEnabled: u32,
`,
      ""
    ).replace(
      `          if (debugEnabled > 0u) {
            atomicAdd(&debugCounters[1], 1u);
          }
`,
      ""
    ).replace(
      `            if (slotI >= ${maxPairContactsPerBody}u && debugEnabled > 0u) {
              atomicAdd(&debugCounters[24], 1u);
            }
`,
      ""
    ).replace(
      `            if (slotJ >= ${maxPairContactsPerBody}u && debugEnabled > 0u) {
              atomicAdd(&debugCounters[24], 1u);
            }
`,
      ""
    ).replace(
      `              if (debugEnabled > 0u) {
                atomicAdd(&debugCounters[25], 1u);
              }
`,
      ""
    ).replace(
      `            } else if (debugEnabled > 0u) {
              atomicAdd(&debugCounters[26], 1u);
            }
`,
      `            }
`
    );
    const buildPairBodyListsShaderDebug = wgslFn(buildPairBodyListsShaderSource, [contactRecordHelpers]);
    const buildPairBodyListsShaderRelease = wgslFn(buildPairBodyListsShaderReleaseSource, [contactRecordHelpers]);
    this.buildPairBodyListsKernel = buildPairBodyListsShaderRelease({
      pairContacts: storage(pairContacts, "vec4f", maxPairContacts * CONTACT_RECORD_VEC4S),
      positions: storage(positions, "vec4f", maxBodies).toReadOnly(),
      pairActivity: storage(pairActivity, "uint", pairActivityWordCount).toAtomic(),
      pairBodyContactCounts: storage(pairBodyContactCounts, "uint", maxBodies).toAtomic(),
      pairBodyContactIndices: storage(pairBodyContactIndices, "uint", maxPairBodyContacts),
      bodyCount: uniform(0),
      pairDispatchCount: uniform(0),
      workgroupId,
      localId
    }).computeKernel([WORKGROUP_SIZE2, 1, 1]).setName("Contact Build Body Lists");
    this.buildPairBodyListsKernelDebug = buildPairBodyListsShaderDebug({
      pairContacts: storage(pairContacts, "vec4f", maxPairContacts * CONTACT_RECORD_VEC4S),
      positions: storage(positions, "vec4f", maxBodies).toReadOnly(),
      pairActivity: storage(pairActivity, "uint", pairActivityWordCount).toAtomic(),
      pairBodyContactCounts: storage(pairBodyContactCounts, "uint", maxBodies).toAtomic(),
      pairBodyContactIndices: storage(pairBodyContactIndices, "uint", maxPairBodyContacts),
      debugCounters: storage(this.debugCountersAttr, "uint", 27).toAtomic(),
      bodyCount: uniform(0),
      pairDispatchCount: uniform(0),
      debugEnabled: uniform(0),
      workgroupId,
      localId
    }).computeKernel([WORKGROUP_SIZE2, 1, 1]).setName("Contact Build Body Lists");
    const finalizeDebugCountersShader = wgslFn(
      /* wgsl */
      `
      fn compute(
        pairActivity: ptr<storage, array<u32>, read_write>,
        debugCounters: ptr<storage, array<atomic<u32>>, read_write>,
        debugEnabled: u32,
      ) -> void {
        if (debugEnabled == 0u) { return; }
        atomicStore(&debugCounters[2], pairActivity[${pairActiveCandidateSlotsOffset}u]);
      }
    `
    );
    this.finalizeDebugCountersKernel = finalizeDebugCountersShader({
      pairActivity: storage(pairActivity, "uint", pairActivityWordCount),
      debugCounters: storage(this.debugCountersAttr, "uint", 27).toAtomic(),
      debugEnabled: uniform(0)
    }).computeKernel([1, 1, 1]).setName("Contact Finalize Debug Counters");
  }
  setFriction(staticFriction) {
    const clamped = Math.max(0, staticFriction);
    this.pairKernel.computeNode.parameters.frictionStatic.value = clamped;
    this.pairKernelDebug.computeNode.parameters.frictionStatic.value = clamped;
  }
  setDebugLogInterval(intervalFrames) {
    this.debugEveryNFrames = Math.max(1, Math.floor(intervalFrames));
    this.lastDebugLogFrame = -1;
  }
  setDebugEnabled(enabled) {
    this.debugEnabled = enabled;
    this.debugReadbackInFlight = false;
    this.lastDebugLogFrame = -1;
  }
  setFloorDebugBody(bodyIndex) {
    this.floorDebugBody = Number.isFinite(bodyIndex) && bodyIndex >= 0 ? Math.floor(bodyIndex) : 4294967295;
  }
  dispatch(renderer, bodyCount, pairCount, pairDispatchCount, useCandidatePairs, frameId) {
    this.dispatchPairKernelPhase(
      renderer,
      bodyCount,
      pairCount,
      pairDispatchCount,
      useCandidatePairs
    );
    this.dispatchBodyListPhase(renderer, bodyCount, pairDispatchCount, frameId);
  }
  dispatchPairKernelPhase(renderer, bodyCount, pairCount, pairDispatchCount, useCandidatePairs) {
    const candidateFlag = useCandidatePairs ? 1 : 0;
    const debugFlag = this.debugEnabled ? 1 : 0;
    const pairKernel = debugFlag ? this.pairKernelDebug : this.pairKernel;
    const buildPairBodyListsKernel = debugFlag ? this.buildPairBodyListsKernelDebug : this.buildPairBodyListsKernel;
    pairKernel.computeNode.parameters.bodyCount.value = bodyCount;
    pairKernel.computeNode.parameters.pairCount.value = pairCount;
    pairKernel.computeNode.parameters.pairDispatchCount.value = pairDispatchCount;
    pairKernel.computeNode.parameters.useCandidatePairs.value = candidateFlag;
    if (debugFlag) {
      pairKernel.computeNode.parameters.floorDebugBody.value = this.floorDebugBody >>> 0;
      pairKernel.computeNode.parameters.debugEnabled.value = debugFlag;
    }
    this.clearDebugCountersKernel.computeNode.parameters.debugEnabled.value = debugFlag;
    this.clearPairBodyCountsKernel.computeNode.parameters.bodyCount.value = bodyCount;
    if (bodyCount > 0) {
      const bodyWorkgroups = Math.ceil(bodyCount / WORKGROUP_SIZE2);
      renderer.compute(this.clearPairBodyCountsKernel, [bodyWorkgroups, 1, 1]);
    }
    buildPairBodyListsKernel.computeNode.parameters.bodyCount.value = bodyCount;
    buildPairBodyListsKernel.computeNode.parameters.pairDispatchCount.value = pairDispatchCount;
    if (debugFlag) {
      buildPairBodyListsKernel.computeNode.parameters.debugEnabled.value = debugFlag;
    }
    this.buildActiveCandidateSlotsKernel.computeNode.parameters.pairCount.value = pairCount;
    this.buildActiveCandidateSlotsKernel.computeNode.parameters.pairDispatchCount.value = pairDispatchCount;
    this.buildActiveCandidateSlotsKernel.computeNode.parameters.useCandidatePairs.value = candidateFlag;
    this.buildPairDispatchArgsKernel.computeNode.parameters.pairDispatchCount.value = pairDispatchCount;
    this.finalizeDebugCountersKernel.computeNode.parameters.debugEnabled.value = debugFlag;
    if (debugFlag) {
      renderer.compute(this.clearDebugCountersKernel, [1, 1, 1]);
    }
    if (pairDispatchCount > 0) {
      const pairWorkgroups = Math.ceil(pairDispatchCount / WORKGROUP_SIZE2);
      renderer.compute(this.clearActiveCandidateSlotsKernel, [1, 1, 1]);
      renderer.compute(this.buildActiveCandidateSlotsKernel, [pairWorkgroups, 1, 1]);
      renderer.compute(this.buildPairDispatchArgsKernel, [1, 1, 1]);
      renderer.compute(pairKernel, this.pairDispatchIndirectAttr);
    }
  }
  dispatchBodyListPhase(renderer, bodyCount, pairDispatchCount, frameId) {
    const debugFlag = this.debugEnabled ? 1 : 0;
    const buildPairBodyListsKernel = debugFlag ? this.buildPairBodyListsKernelDebug : this.buildPairBodyListsKernel;
    buildPairBodyListsKernel.computeNode.parameters.bodyCount.value = bodyCount;
    buildPairBodyListsKernel.computeNode.parameters.pairDispatchCount.value = pairDispatchCount;
    if (debugFlag) {
      buildPairBodyListsKernel.computeNode.parameters.debugEnabled.value = debugFlag;
    }
    this.finalizeDebugCountersKernel.computeNode.parameters.debugEnabled.value = debugFlag;
    if (pairDispatchCount > 0) {
      renderer.compute(buildPairBodyListsKernel, this.pairDispatchIndirectAttr);
      if (debugFlag) {
        renderer.compute(this.finalizeDebugCountersKernel, [1, 1, 1]);
      }
    }
    this.maybeLogDebug(renderer, frameId, bodyCount, pairDispatchCount);
  }
  maybeLogDebug(renderer, frameId, bodyCount, pairDispatchCount) {
    if (!this.debugEnabled) return;
    if (!renderer || typeof renderer.getArrayBufferAsync !== "function") return;
    if (this.debugReadbackInFlight) return;
    if (this.lastDebugLogFrame === frameId) return;
    if (this.lastDebugLogFrame >= 0 && frameId - this.lastDebugLogFrame < this.debugEveryNFrames) return;
    this.debugReadbackInFlight = true;
    this.lastDebugLogFrame = frameId;
    Promise.all([
      renderer.getArrayBufferAsync(this.debugCountersAttr),
      renderer.getArrayBufferAsync(this.pairContactsAttr)
    ]).then(([debugRaw, pairContactsRaw]) => {
      const values = new Uint32Array(debugRaw);
      const warmstartResets = values[0] ?? 0;
      const activeManifolds = values[1] ?? 0;
      const activeCandidateSlots = values[2] ?? 0;
      const stalePrunedSlots = values[3] ?? 0;
      const separatingKeptSlots = values[4] ?? 0;
      const stickingAnchorReuses = values[5] ?? 0;
      const sharedTangentSignFlips = values[6] ?? 0;
      const floorPairCandidates = values[7] ?? 0;
      const floorPairWarmstartResets = values[8] ?? 0;
      const floorPairKeepRejected = values[9] ?? 0;
      const floorPairDegenerateFallbacks = values[10] ?? 0;
      const floorPairWriteZero = values[11] ?? 0;
      const floorPairActive = values[12] ?? 0;
      const floorPairSeparatedRejects = values[13] ?? 0;
      const floorPairInactiveThresholdRejects = values[14] ?? 0;
      const floorPairHysteresisRejects = values[15] ?? 0;
      const floorPairSeparatedFaceA0 = values[16] ?? 0;
      const floorPairSeparatedFaceA1 = values[17] ?? 0;
      const floorPairSeparatedFaceA2 = values[18] ?? 0;
      const floorPairSeparatedFaceB0 = values[19] ?? 0;
      const floorPairSeparatedFaceB1 = values[20] ?? 0;
      const floorPairSeparatedFaceB2 = values[21] ?? 0;
      const floorPairSeparatedEdge = values[22] ?? 0;
      const floorPairSeparatedOther = values[23] ?? 0;
      const pairBodyListOverflowWrites = values[24] ?? 0;
      const pairBodyListDroppedContacts = values[25] ?? 0;
      const activeContactListOverflowWrites = values[26] ?? 0;
      console.info(
        `[Contact Debug] frame=${frameId} bodies=${bodyCount} pairDispatch=${pairDispatchCount} activeCandidates=${activeCandidateSlots} activeManifolds=${activeManifolds} warmstartResets=${warmstartResets} stalePruned=${stalePrunedSlots} separatingKept=${separatingKeptSlots} stickAnchorReuses=${stickingAnchorReuses} sharedTangentSignFlips=${sharedTangentSignFlips} floorPairs=${floorPairCandidates} floorWarmstartResets=${floorPairWarmstartResets} floorRejected=${floorPairKeepRejected} floorDegenerate=${floorPairDegenerateFallbacks} floorWriteZero=${floorPairWriteZero} floorActive=${floorPairActive} floorRejectSeparated=${floorPairSeparatedRejects} floorRejectInactiveGap=${floorPairInactiveThresholdRejects} floorRejectHysteresis=${floorPairHysteresisRejects} floorSepFaceA=(${floorPairSeparatedFaceA0},${floorPairSeparatedFaceA1},${floorPairSeparatedFaceA2}) floorSepFaceB=(${floorPairSeparatedFaceB0},${floorPairSeparatedFaceB1},${floorPairSeparatedFaceB2}) floorSepEdge=${floorPairSeparatedEdge} floorSepOther=${floorPairSeparatedOther} bodyListOverflowWrites=${pairBodyListOverflowWrites} bodyListDroppedContacts=${pairBodyListDroppedContacts} activeListOverflowWrites=${activeContactListOverflowWrites}`
      );
      if (frameId <= 12 && activeManifolds > 0) {
        const contacts = new Float32Array(pairContactsRaw);
        const contactWords = new Uint32Array(pairContactsRaw);
        const groups = /* @__PURE__ */ new Map();
        for (let p = 0; p < this.maxPairContacts; p++) {
          const base = contactRecordVec4FloatIndex(p, CONTACT_RECORD_META_OFFSET);
          const i = Math.max(0, Math.round(contacts[base] ?? 0));
          const j = Math.max(0, Math.round(contacts[base + 1] ?? 0));
          const active = (contacts[base + 2] ?? 0) >= 0.5;
          if (!active) continue;
          const featureWord = contactWords[base + 3] ?? 0;
          const featureKey = featureWord & 511;
          const preserveWarmstart = (featureWord >>> 16 & 1) !== 0;
          const warmstartReason = featureWord >>> 21 & 7;
          const groupKey = `${i}/${j}`;
          const row = `p=${p} feat=0x${featureKey.toString(16)} warm=${preserveWarmstart ? 1 : 0} r=${warmstartReason}`;
          const rows = groups.get(groupKey) ?? [];
          rows.push(row);
          groups.set(groupKey, rows);
        }
        if (groups.size > 0) {
          const summary = Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([pair, rows]) => `${pair}[${rows.join(", ")}]`).join(" | ");
          console.info(`[Contact Debug Rows] frame=${frameId} ${summary}`);
        }
      }
    }).catch((error) => {
      console.warn("Contact debug readback failed:", error);
    }).finally(() => {
      this.debugReadbackInFlight = false;
    });
  }
};

// vendor/webphysics/src/physics/gpu/avbdState.ts
import { IndirectStorageBufferAttribute as IndirectStorageBufferAttribute2, StorageBufferAttribute as StorageBufferAttribute2 } from "three/webgpu";

// vendor/webphysics/src/physics/gpu/jointRecord.ts
var JOINT_RECORD_META_OFFSET = 0;
var JOINT_RECORD_ANCHOR_A_OFFSET = 1;
var JOINT_RECORD_ANCHOR_B_OFFSET = 2;
var JOINT_RECORD_REST_RELATIVE_ROTATION_OFFSET = 3;
var JOINT_RECORD_STIFFNESS_OFFSET = 4;
var JOINT_RECORD_C0_LIN_OFFSET = 5;
var JOINT_RECORD_C0_ANG_OFFSET = 6;
var JOINT_RECORD_LAMBDA_LIN_OFFSET = 7;
var JOINT_RECORD_LAMBDA_ANG_OFFSET = 8;
var JOINT_RECORD_PENALTY_LIN_OFFSET = 9;
var JOINT_RECORD_PENALTY_ANG_OFFSET = 10;
var JOINT_RECORD_VEC4S = 11;
var JOINT_RECORD_FLOATS = JOINT_RECORD_VEC4S * 4;
var jointRecordHelpers = wgsl(
  /* wgsl */
  `
      const JOINT_RECORD_META_OFFSET: u32 = ${JOINT_RECORD_META_OFFSET}u;
      const JOINT_RECORD_ANCHOR_A_OFFSET: u32 = ${JOINT_RECORD_ANCHOR_A_OFFSET}u;
      const JOINT_RECORD_ANCHOR_B_OFFSET: u32 = ${JOINT_RECORD_ANCHOR_B_OFFSET}u;
      const JOINT_RECORD_REST_RELATIVE_ROTATION_OFFSET: u32 = ${JOINT_RECORD_REST_RELATIVE_ROTATION_OFFSET}u;
      const JOINT_RECORD_STIFFNESS_OFFSET: u32 = ${JOINT_RECORD_STIFFNESS_OFFSET}u;
      const JOINT_RECORD_C0_LIN_OFFSET: u32 = ${JOINT_RECORD_C0_LIN_OFFSET}u;
      const JOINT_RECORD_C0_ANG_OFFSET: u32 = ${JOINT_RECORD_C0_ANG_OFFSET}u;
      const JOINT_RECORD_LAMBDA_LIN_OFFSET: u32 = ${JOINT_RECORD_LAMBDA_LIN_OFFSET}u;
      const JOINT_RECORD_LAMBDA_ANG_OFFSET: u32 = ${JOINT_RECORD_LAMBDA_ANG_OFFSET}u;
      const JOINT_RECORD_PENALTY_LIN_OFFSET: u32 = ${JOINT_RECORD_PENALTY_LIN_OFFSET}u;
      const JOINT_RECORD_PENALTY_ANG_OFFSET: u32 = ${JOINT_RECORD_PENALTY_ANG_OFFSET}u;
      const JOINT_RECORD_VEC4S: u32 = ${JOINT_RECORD_VEC4S}u;

      fn jointRecordBase(jointIndex: u32) -> u32 {
        return jointIndex * JOINT_RECORD_VEC4S;
      }

      fn loadJointMetaWords(jointRecords: ptr<storage, array<vec4f>, read_write>, jointIndex: u32) -> vec4u {
        return bitcast<vec4u>(jointRecords[jointRecordBase(jointIndex) + JOINT_RECORD_META_OFFSET]);
      }

      fn storeJointMetaWords(
        jointRecords: ptr<storage, array<vec4f>, read_write>,
        jointIndex: u32,
        value: vec4u,
      ) {
        jointRecords[jointRecordBase(jointIndex) + JOINT_RECORD_META_OFFSET] = bitcast<vec4f>(value);
      }

      fn loadJointAnchorA(jointRecords: ptr<storage, array<vec4f>, read_write>, jointIndex: u32) -> vec4f {
        return jointRecords[jointRecordBase(jointIndex) + JOINT_RECORD_ANCHOR_A_OFFSET];
      }

      fn storeJointAnchorA(
        jointRecords: ptr<storage, array<vec4f>, read_write>,
        jointIndex: u32,
        value: vec4f,
      ) {
        jointRecords[jointRecordBase(jointIndex) + JOINT_RECORD_ANCHOR_A_OFFSET] = value;
      }

      fn loadJointAnchorB(jointRecords: ptr<storage, array<vec4f>, read_write>, jointIndex: u32) -> vec4f {
        return jointRecords[jointRecordBase(jointIndex) + JOINT_RECORD_ANCHOR_B_OFFSET];
      }

      fn storeJointAnchorB(
        jointRecords: ptr<storage, array<vec4f>, read_write>,
        jointIndex: u32,
        value: vec4f,
      ) {
        jointRecords[jointRecordBase(jointIndex) + JOINT_RECORD_ANCHOR_B_OFFSET] = value;
      }

      fn loadJointRestRelativeRotation(
        jointRecords: ptr<storage, array<vec4f>, read_write>,
        jointIndex: u32,
      ) -> vec4f {
        return jointRecords[jointRecordBase(jointIndex) + JOINT_RECORD_REST_RELATIVE_ROTATION_OFFSET];
      }

      fn storeJointRestRelativeRotation(
        jointRecords: ptr<storage, array<vec4f>, read_write>,
        jointIndex: u32,
        value: vec4f,
      ) {
        jointRecords[jointRecordBase(jointIndex) + JOINT_RECORD_REST_RELATIVE_ROTATION_OFFSET] = value;
      }

      fn loadJointStiffness(jointRecords: ptr<storage, array<vec4f>, read_write>, jointIndex: u32) -> vec4f {
        return jointRecords[jointRecordBase(jointIndex) + JOINT_RECORD_STIFFNESS_OFFSET];
      }

      fn storeJointStiffness(
        jointRecords: ptr<storage, array<vec4f>, read_write>,
        jointIndex: u32,
        value: vec4f,
      ) {
        jointRecords[jointRecordBase(jointIndex) + JOINT_RECORD_STIFFNESS_OFFSET] = value;
      }

      fn loadJointC0Lin(jointRecords: ptr<storage, array<vec4f>, read_write>, jointIndex: u32) -> vec4f {
        return jointRecords[jointRecordBase(jointIndex) + JOINT_RECORD_C0_LIN_OFFSET];
      }

      fn storeJointC0Lin(
        jointRecords: ptr<storage, array<vec4f>, read_write>,
        jointIndex: u32,
        value: vec4f,
      ) {
        jointRecords[jointRecordBase(jointIndex) + JOINT_RECORD_C0_LIN_OFFSET] = value;
      }

      fn loadJointC0Ang(jointRecords: ptr<storage, array<vec4f>, read_write>, jointIndex: u32) -> vec4f {
        return jointRecords[jointRecordBase(jointIndex) + JOINT_RECORD_C0_ANG_OFFSET];
      }

      fn storeJointC0Ang(
        jointRecords: ptr<storage, array<vec4f>, read_write>,
        jointIndex: u32,
        value: vec4f,
      ) {
        jointRecords[jointRecordBase(jointIndex) + JOINT_RECORD_C0_ANG_OFFSET] = value;
      }

      fn loadJointLambdaLin(jointRecords: ptr<storage, array<vec4f>, read_write>, jointIndex: u32) -> vec4f {
        return jointRecords[jointRecordBase(jointIndex) + JOINT_RECORD_LAMBDA_LIN_OFFSET];
      }

      fn storeJointLambdaLin(
        jointRecords: ptr<storage, array<vec4f>, read_write>,
        jointIndex: u32,
        value: vec4f,
      ) {
        jointRecords[jointRecordBase(jointIndex) + JOINT_RECORD_LAMBDA_LIN_OFFSET] = value;
      }

      fn loadJointLambdaAng(jointRecords: ptr<storage, array<vec4f>, read_write>, jointIndex: u32) -> vec4f {
        return jointRecords[jointRecordBase(jointIndex) + JOINT_RECORD_LAMBDA_ANG_OFFSET];
      }

      fn storeJointLambdaAng(
        jointRecords: ptr<storage, array<vec4f>, read_write>,
        jointIndex: u32,
        value: vec4f,
      ) {
        jointRecords[jointRecordBase(jointIndex) + JOINT_RECORD_LAMBDA_ANG_OFFSET] = value;
      }

      fn loadJointPenaltyLin(jointRecords: ptr<storage, array<vec4f>, read_write>, jointIndex: u32) -> vec4f {
        return jointRecords[jointRecordBase(jointIndex) + JOINT_RECORD_PENALTY_LIN_OFFSET];
      }

      fn storeJointPenaltyLin(
        jointRecords: ptr<storage, array<vec4f>, read_write>,
        jointIndex: u32,
        value: vec4f,
      ) {
        jointRecords[jointRecordBase(jointIndex) + JOINT_RECORD_PENALTY_LIN_OFFSET] = value;
      }

      fn loadJointPenaltyAng(jointRecords: ptr<storage, array<vec4f>, read_write>, jointIndex: u32) -> vec4f {
        return jointRecords[jointRecordBase(jointIndex) + JOINT_RECORD_PENALTY_ANG_OFFSET];
      }

      fn storeJointPenaltyAng(
        jointRecords: ptr<storage, array<vec4f>, read_write>,
        jointIndex: u32,
        value: vec4f,
      ) {
        jointRecords[jointRecordBase(jointIndex) + JOINT_RECORD_PENALTY_ANG_OFFSET] = value;
      }
`
);
function jointRecordBaseFloatIndex(jointIndex) {
  return jointIndex * JOINT_RECORD_FLOATS;
}
function jointRecordVec4FloatIndex(jointIndex, vec4Offset) {
  return jointRecordBaseFloatIndex(jointIndex) + vec4Offset * 4;
}

// vendor/webphysics/src/physics/gpu/springRecord.ts
var SPRING_RECORD_META_OFFSET = 0;
var SPRING_RECORD_ANCHOR_A_OFFSET = 1;
var SPRING_RECORD_ANCHOR_B_OFFSET = 2;
var SPRING_RECORD_VEC4S = 3;
var SPRING_RECORD_FLOATS = SPRING_RECORD_VEC4S * 4;
var springRecordHelpers = wgsl(
  /* wgsl */
  `
      const SPRING_RECORD_META_OFFSET: u32 = ${SPRING_RECORD_META_OFFSET}u;
      const SPRING_RECORD_ANCHOR_A_OFFSET: u32 = ${SPRING_RECORD_ANCHOR_A_OFFSET}u;
      const SPRING_RECORD_ANCHOR_B_OFFSET: u32 = ${SPRING_RECORD_ANCHOR_B_OFFSET}u;
      const SPRING_RECORD_VEC4S: u32 = ${SPRING_RECORD_VEC4S}u;

      fn springRecordBase(springIndex: u32) -> u32 {
        return springIndex * SPRING_RECORD_VEC4S;
      }

      fn loadSpringMetaWords(
        springRecords: ptr<storage, array<vec4f>, read_write>,
        springIndex: u32,
      ) -> vec4u {
        return bitcast<vec4u>(springRecords[springRecordBase(springIndex) + SPRING_RECORD_META_OFFSET]);
      }

      fn storeSpringMetaWords(
        springRecords: ptr<storage, array<vec4f>, read_write>,
        springIndex: u32,
        value: vec4u,
      ) {
        springRecords[springRecordBase(springIndex) + SPRING_RECORD_META_OFFSET] = bitcast<vec4f>(value);
      }

      fn loadSpringAnchorARest(
        springRecords: ptr<storage, array<vec4f>, read_write>,
        springIndex: u32,
      ) -> vec4f {
        return springRecords[springRecordBase(springIndex) + SPRING_RECORD_ANCHOR_A_OFFSET];
      }

      fn storeSpringAnchorARest(
        springRecords: ptr<storage, array<vec4f>, read_write>,
        springIndex: u32,
        value: vec4f,
      ) {
        springRecords[springRecordBase(springIndex) + SPRING_RECORD_ANCHOR_A_OFFSET] = value;
      }

      fn loadSpringAnchorBStiffness(
        springRecords: ptr<storage, array<vec4f>, read_write>,
        springIndex: u32,
      ) -> vec4f {
        return springRecords[springRecordBase(springIndex) + SPRING_RECORD_ANCHOR_B_OFFSET];
      }

      fn storeSpringAnchorBStiffness(
        springRecords: ptr<storage, array<vec4f>, read_write>,
        springIndex: u32,
        value: vec4f,
      ) {
        springRecords[springRecordBase(springIndex) + SPRING_RECORD_ANCHOR_B_OFFSET] = value;
      }
`
);
function springRecordBaseFloatIndex(springIndex) {
  return springIndex * SPRING_RECORD_FLOATS;
}
function springRecordVec4FloatIndex(springIndex, vec4Offset) {
  return springRecordBaseFloatIndex(springIndex) + vec4Offset * 4;
}

// vendor/webphysics/src/physics/gpu/avbdState.ts
var WORKGROUP_SIZE3 = 64;
var AVBD_GAMMA = 0.99;
var AVBD_BETA = 10;
var AVBD_K_START = 1;
var AVBD_JOINT_PENALTY_MAX = 1e10;
var AVBD_STICK_THRESHOLD = 1e-5;
var AVBD_REGULARIZATION_ALPHA_DEFAULT = 0.95;
var INERTIAL_POSE_VEC4S_PER_BODY2 = 4;
var BODY_COLOR_FALLBACK_FLAG = 16777216;
var BODY_COLOR_REPAIR_FLAG = 33554432;
var CONSTRAINT_REF_TAG_MASK = 3221225472;
var CONSTRAINT_REF_INDEX_MASK = 1073741823;
var CONSTRAINT_REF_TAG_JOINT = 2147483648;
var CONSTRAINT_REF_TAG_SPRING = 3221225472;
var BODY_COLOR_HARD_REPAIR_ROUNDS = 2;
var tangentBasisHelpers2 = wgsl(
  /* wgsl */
  `
      const TANGENT_BASIS_TWO_PI: f32 = 6.283185307179586;

      struct TangentBasis {
        t1: vec3f,
        t2: vec3f,
      };

      fn canonicalTangentBasis(n: vec3f) -> TangentBasis {
        let refAxis = select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(n.y) > 0.999);
        let t1Raw = cross(refAxis, n);
        let t1Len2 = dot(t1Raw, t1Raw);
        var t1 = vec3f(0.0, 0.0, 1.0);
        if (t1Len2 > 1e-12) {
          t1 = t1Raw * inverseSqrt(t1Len2);
        }
        let t2Raw = cross(n, t1);
        let t2Len2 = dot(t2Raw, t2Raw);
        var t2 = vec3f(1.0, 0.0, 0.0);
        if (t2Len2 > 1e-12) {
          t2 = t2Raw * inverseSqrt(t2Len2);
        }
        return TangentBasis(t1, t2);
      }

      fn tangentBasisFromPreferredT1(n: vec3f, preferredT1: vec3f) -> TangentBasis {
        let projected = preferredT1 - n * dot(preferredT1, n);
        let projectedLen2 = dot(projected, projected);
        if (projectedLen2 <= 1e-12) {
          return canonicalTangentBasis(n);
        }
        let t1 = projected * inverseSqrt(projectedLen2);
        let t2Raw = cross(n, t1);
        let t2Len2 = dot(t2Raw, t2Raw);
        if (t2Len2 <= 1e-12) {
          return canonicalTangentBasis(n);
        }
        let t2 = t2Raw * inverseSqrt(t2Len2);
        return TangentBasis(t1, t2);
      }

      fn tangentBasisFromAngle(n: vec3f, theta: f32) -> TangentBasis {
        let canonical = canonicalTangentBasis(n);
        let c = cos(theta);
        let s = sin(theta);
        let t1 = canonical.t1 * c + canonical.t2 * s;
        return tangentBasisFromPreferredT1(n, t1);
      }
`
);
var contactStateHelpers = wgsl(
  /* wgsl */
  `
      struct AvbdContactShadow {
        packed: vec4f,
        lambdaN: f32,
        lambdaTB: vec2f,
        frictionScale: f32,
      };

      struct AvbdContactState {
        dual: vec4f,
        penalty: vec4f,
        lambdaN: f32,
        penaltyN: f32,
        frictionScale: f32,
      };

      struct AvbdContactRecord {
        state: AvbdContactState,
        shadow: AvbdContactShadow,
      };

      fn makeContactState(
        dual: vec4f,
        penalty: vec4f,
        fallbackFrictionScale: f32,
        kStart: f32,
      ) -> AvbdContactState {
        let dualN = min(dual.x, 0.0);
        let penaltyN = max(penalty.x, kStart);
        let penaltyFrictionScale = max(penalty.w, 0.0);
        let frictionScale = max(
          select(fallbackFrictionScale, penaltyFrictionScale, penaltyFrictionScale > 0.0),
          0.0,
        );
        return AvbdContactState(
          dual,
          vec4f(penaltyN, penalty.y, penalty.z, frictionScale),
          max(-dualN, 0.0),
          penaltyN,
          frictionScale,
        );
      }

      fn makeContactShadow(shadow: vec4f) -> AvbdContactShadow {
        let frictionScale = max(shadow.w, 0.0);
        let lambdaN = max(shadow.x, 0.0);
        return AvbdContactShadow(
          vec4f(lambdaN, shadow.y, shadow.z, frictionScale),
          lambdaN,
          shadow.yz,
          frictionScale,
        );
      }

      fn makeContactRecord(
        dual: vec4f,
        penalty: vec4f,
        shadow: vec4f,
        kStart: f32,
      ) -> AvbdContactRecord {
        let contactShadow = makeContactShadow(shadow);
        let contactState = makeContactState(
          dual,
          penalty,
          contactShadow.frictionScale,
          kStart,
        );
        return AvbdContactRecord(contactState, contactShadow);
      }

      // Hot solver passes only need live dual/penalty state. The friction scale is
      // mirrored into penalty.w during prepare/capture so they can avoid pulling
      // shadow/cache data from global memory on every contact touch.
      fn loadContactStateHot(
        pairContacts: ptr<storage, array<vec4f>, read_write>,
        p: u32,
        kStart: f32,
      ) -> AvbdContactState {
        let penalty = loadContactPenalty(pairContacts, p);
        return makeContactState(
          loadContactDual(pairContacts, p),
          penalty,
          max(penalty.w, 0.0),
          kStart,
        );
      }

      fn loadContactRecord(
        pairContacts: ptr<storage, array<vec4f>, read_write>,
        p: u32,
        kStart: f32,
      ) -> AvbdContactRecord {
        var record = makeContactRecord(
          loadContactDual(pairContacts, p),
          loadContactPenalty(pairContacts, p),
          loadContactShadow(pairContacts, p),
          kStart,
        );
        return record;
      }

      fn packContactPenalty(penaltyN: f32, penaltyTB: vec2f, frictionScale: f32, kStart: f32) -> vec4f {
        return vec4f(
          max(penaltyN, kStart),
          max(penaltyTB.x, kStart),
          max(penaltyTB.y, kStart),
          max(frictionScale, 0.0),
        );
      }

      fn packContactShadow(lambdaN: f32, lambdaTB: vec2f, frictionScale: f32) -> vec4f {
        return vec4f(max(lambdaN, 0.0), lambdaTB, max(frictionScale, 0.0));
      }

      fn storeContactRecord(
        pairContacts: ptr<storage, array<vec4f>, read_write>,
        p: u32,
        dual: vec4f,
        penaltyN: f32,
        penaltyTB: vec2f,
        lambdaN: f32,
        lambdaTB: vec2f,
        frictionScale: f32,
        kStart: f32,
      ) {
        storeContactDual(pairContacts, p, dual);
        storeContactPenalty(pairContacts, p, packContactPenalty(
          penaltyN,
          penaltyTB,
          frictionScale,
          kStart,
        ));
        storeContactShadow(pairContacts, p, packContactShadow(
          lambdaN,
          lambdaTB,
          frictionScale,
        ));
      }

      fn packSeedDualFromShadow(
        shadow: AvbdContactShadow,
        n: vec3f,
        t1: vec3f,
        t2: vec3f,
        useReferenceTangentialUpdate: u32,
      ) -> vec4f {
        let seedDualN = -shadow.lambdaN;
        let seedDualTWorld = t1 * shadow.lambdaTB.x + t2 * shadow.lambdaTB.y;
        return select(
          vec4f(seedDualN, seedDualTWorld),
          vec4f(seedDualN, shadow.lambdaTB, 0.0),
          useReferenceTangentialUpdate > 0u,
        );
      }

      fn contactStateDualTB(
        state: AvbdContactState,
        n: vec3f,
        t1: vec3f,
        t2: vec3f,
        useReferenceTangentialUpdate: u32,
      ) -> vec2f {
        let dualTWorldRaw = state.dual.yzw;
        let dualTWorld = dualTWorldRaw - n * dot(dualTWorldRaw, n);
        return select(
          vec2f(dot(dualTWorld, t1), dot(dualTWorld, t2)),
          state.dual.yz,
          useReferenceTangentialUpdate > 0u,
        );
      }
`
);
var jointConstraintHelpers = wgsl(
  /* wgsl */
  `
      const WORLD_BODY_INDEX: u32 = 0xffffffffu;
      const JOINT_TYPE_SPHERICAL: u32 = 0u;
      const JOINT_TYPE_FIXED: u32 = 1u;

      struct JointPoseState {
        position: vec3f,
        rotation: vec4f,
      };

      fn isFiniteF32(value: f32) -> bool {
        return value == value && abs(value) <= 0x1.fffffep+127f;
      }

      fn integrateQuaternionBackByAngularVelocity(
        currentQ: vec4f,
        angularVelocity: vec3f,
        dt: f32,
      ) -> vec4f {
        let speed = length(angularVelocity);
        if (speed <= 1e-8 || dt <= 0.0) {
          return normalize(currentQ);
        }
        let axis = angularVelocity / speed;
        let halfAngle = 0.5 * speed * dt;
        let delta = vec4f(axis * sin(halfAngle), cos(halfAngle));
        return normalize(qmul(qconj(delta), normalize(currentQ)));
      }

      fn jointRegularizationPose(
        bodyIndex: u32,
        initialPose: ptr<storage, array<vec4f>, read>,
        positions: ptr<storage, array<vec4f>, read>,
        quaternions: ptr<storage, array<vec4f>, read>,
        velocities: ptr<storage, array<vec4f>, read>,
        angularVelocities: ptr<storage, array<vec4f>, read>,
        dt: f32,
      ) -> JointPoseState {
        if (bodyIndex == WORLD_BODY_INDEX) {
          return JointPoseState(vec3f(0.0), vec4f(0.0, 0.0, 0.0, 1.0));
        }

        let invMass = positions[bodyIndex].w;
        if (invMass == 0.0) {
          let currentPos = positions[bodyIndex].xyz;
          let currentQ = normalize(quaternions[bodyIndex]);
          let previousPos = currentPos - velocities[bodyIndex].xyz * dt;
          let previousQ = integrateQuaternionBackByAngularVelocity(
            currentQ,
            angularVelocities[bodyIndex].xyz,
            dt,
          );
          return JointPoseState(previousPos, previousQ);
        }

        let poseBase = bodyIndex * 2u;
        return JointPoseState(
          initialPose[poseBase].xyz,
          normalize(initialPose[poseBase + 1u]),
        );
      }

      fn jointWorldAnchor(
        bodyIndex: u32,
        anchorLocal: vec3f,
        position: vec3f,
        rotation: vec4f,
      ) -> vec3f {
        return select(position + qrot(rotation, anchorLocal), anchorLocal, bodyIndex == WORLD_BODY_INDEX);
      }

      fn jointFixedAngularConstraint(
        bodyA: u32,
        qA: vec4f,
        qB: vec4f,
        restRelative: vec4f,
        torqueArm: f32,
      ) -> vec3f {
        let worldQA = normalize(select(qA, vec4f(0.0, 0.0, 0.0, 1.0), bodyA == WORLD_BODY_INDEX));
        let delta = qmul(qmul(worldQA, normalize(restRelative)), qconj(normalize(qB)));
        return 2.0 * delta.xyz * torqueArm;
      }

      fn jointBallSocketGeometricDiagonal(r: vec3f, force: vec3f) -> vec3f {
        let col0 = vec3f(
          -force.y * r.y - force.z * r.z,
          force.x * r.y,
          force.x * r.z,
        );
        let col1 = vec3f(
          force.y * r.x,
          -force.x * r.x - force.z * r.z,
          force.y * r.z,
        );
        let col2 = vec3f(
          force.z * r.x,
          force.z * r.y,
          -force.x * r.x - force.y * r.y,
        );
        return vec3f(length(col0), length(col1), length(col2));
      }

      fn addDiagonalVectorConstraint(
        lhs: ptr<function, array<array<f32, 6>, 6>>,
        rhs: ptr<function, array<f32, 6>>,
        j0: array<f32, 6>,
        j1: array<f32, 6>,
        j2: array<f32, 6>,
        stiffness: vec3f,
        force: vec3f,
      ) {
        let rows = array<array<f32, 6>, 3>(j0, j1, j2);
        for (var axis = 0u; axis < 3u; axis++) {
          let k = max(stiffness[axis], 0.0);
          if (k <= 0.0) { continue; }
          let f = force[axis];
          let row = rows[axis];
          for (var r = 0u; r < 6u; r++) {
            (*rhs)[r] += row[r] * f;
            for (var c = 0u; c < 6u; c++) {
              (*lhs)[r][c] += k * row[r] * row[c];
            }
          }
        }
      }

      fn addScalarConstraint(
        lhs: ptr<function, array<array<f32, 6>, 6>>,
        rhs: ptr<function, array<f32, 6>>,
        row: array<f32, 6>,
        stiffness: f32,
        force: f32,
      ) {
        let k = max(stiffness, 0.0);
        if (k <= 0.0) { return; }
        for (var r = 0u; r < 6u; r++) {
          (*rhs)[r] += row[r] * force;
          for (var c = 0u; c < 6u; c++) {
            (*lhs)[r][c] += k * row[r] * row[c];
          }
        }
      }
`
);
var AvbdStateStage = class {
  buildContactDispatchArgsKernel;
  clearPhaseDebugCountersKernel;
  accumulatePhaseDebugCountersKernel;
  clearDebugCountersKernel;
  accumulateDebugCountersKernel;
  accumulateBodyColorDebugCountersKernel;
  prepareStateKernel;
  prepareJointStateKernel;
  buildSolverConstraintListsKernel;
  appendJointConstraintRefsKernel;
  appendSpringConstraintRefsKernel;
  greedyBodyColorsKernel;
  markHardColorConflictsKernel;
  repairHardBodyColorsKernel;
  primalBodySolveKernelGeneric;
  primalBodySolveKernelLocalDiag;
  primalBodySolveKernel;
  commitBodySolveKernel;
  capturePairDualStateKernel;
  captureJointDualStateKernel;
  finalizeVelocitiesKernel;
  contactDispatchIndirectAttr;
  phaseDebugCountersAttr;
  debugCountersAttr;
  pairContactsAttr;
  jointRecordsAttr;
  springRecordsAttr;
  positionsAttr;
  initialPoseAttr;
  quaternionsAttr;
  pairActivityAttr;
  bodySolveOutputPoseAttr;
  maxPairContacts;
  maxJoints;
  maxSprings;
  maxActivePairContacts;
  pairActiveContactsOffset;
  contactKeySlotBitCount;
  useLocalDiagonalPrimalSolveFastPath = false;
  debugEnabled = false;
  debugReadbackInFlight = false;
  separatingTraceReadbackInFlight = false;
  separatingTraceArmed = true;
  lastDebugLogFrame = -1;
  debugEveryNFrames = 30;
  constructor(pairContacts, jointRecords, springRecords, positions, initialPose, inertialPose, quaternions, velocities, prevLinearVelocities, angularVelocities, inverseInertia, derivedInvInertia, bodyConstraintCounts, bodyConstraintRefs, pairBodyContactCounts, pairBodyContactIndices, bodyColorScratch, pairActivity, maxBodies, maxPairContacts, maxJoints, maxSprings, maxActivePairContacts, maxConstraintsPerBody, maxPairContactsPerBody, pairManifoldSlots, pairActiveContactsOffset, pairActivityWordCount) {
    this.pairContactsAttr = pairContacts;
    this.jointRecordsAttr = jointRecords;
    this.springRecordsAttr = springRecords;
    this.positionsAttr = positions;
    this.initialPoseAttr = initialPose;
    this.quaternionsAttr = quaternions;
    this.pairActivityAttr = pairActivity;
    this.bodySolveOutputPoseAttr = new StorageBufferAttribute2(new Float32Array(maxBodies * 2 * 4), 4);
    this.bodySolveOutputPoseAttr.name = "AVBD Body Solve Output Pose";
    this.maxPairContacts = maxPairContacts;
    this.maxJoints = maxJoints;
    this.maxSprings = maxSprings;
    this.maxActivePairContacts = maxActivePairContacts;
    this.pairActiveContactsOffset = pairActiveContactsOffset;
    const clampedPairManifoldSlots = Math.max(1, Math.min(8, Math.floor(pairManifoldSlots)));
    const contactKeySlotBitCount = Math.ceil(Math.log2(clampedPairManifoldSlots));
    this.contactKeySlotBitCount = contactKeySlotBitCount;
    const contactKeyFeatureBitCount = 9;
    const contactKeyBaseBitCount = Math.max(1, 31 - contactKeySlotBitCount);
    const contactKeyPairHashBitCount = Math.max(1, contactKeyBaseBitCount - contactKeyFeatureBitCount);
    const contactKeyPairHashMax = Math.max(1, 2 ** contactKeyPairHashBitCount - 1);
    this.contactDispatchIndirectAttr = new IndirectStorageBufferAttribute2(new Uint32Array([0, 1, 1]), 1);
    this.contactDispatchIndirectAttr.name = "AVBD Contact Dispatch Indirect";
    this.debugCountersAttr = new StorageBufferAttribute2(new Uint32Array(18), 1);
    this.phaseDebugCountersAttr = new StorageBufferAttribute2(new Uint32Array(18), 1);
    const buildContactDispatchArgsShader = wgslFn(
      /* wgsl */
      `
      fn compute(
        pairActivity: ptr<storage, array<u32>, read_write>,
        dispatchIndirect: ptr<storage, array<u32>, read_write>,
        pairDispatchCount: u32,
      ) -> void {
        let activeCount = min(min(pairActivity[${pairActiveContactsOffset}u], pairDispatchCount), ${maxActivePairContacts}u);
        let workgroups = (activeCount + ${WORKGROUP_SIZE3}u - 1u) / ${WORKGROUP_SIZE3}u;
        dispatchIndirect[0] = workgroups;
        dispatchIndirect[1] = 1u;
        dispatchIndirect[2] = 1u;
      }
    `
    );
    this.buildContactDispatchArgsKernel = buildContactDispatchArgsShader({
      pairActivity: storage(pairActivity, "uint", pairActivityWordCount),
      dispatchIndirect: storage(this.contactDispatchIndirectAttr, "uint", 3),
      pairDispatchCount: uniform(0)
    }).computeKernel([1, 1, 1]).setName("AVBD Build Contact Dispatch Args");
    const clearPhaseDebugCountersShader = wgslFn(
      /* wgsl */
      `
      fn compute(
        phaseDebugCounters: ptr<storage, array<atomic<u32>>, read_write>,
      ) -> void {
        for (var i = 0u; i < 18u; i++) {
          atomicStore(&phaseDebugCounters[i], 0u);
        }
      }
    `
    );
    this.clearPhaseDebugCountersKernel = clearPhaseDebugCountersShader({
      phaseDebugCounters: storage(this.phaseDebugCountersAttr, "uint", 18).toAtomic()
    }).computeKernel([1, 1, 1]).setName("AVBD Clear Phase Debug Counters");
    const accumulatePhaseDebugCountersShader = wgslFn(
      /* wgsl */
      `
      fn compute(
        positions: ptr<storage, array<vec4f>, read>,
        quaternions: ptr<storage, array<vec4f>, read>,
        initialPose: ptr<storage, array<vec4f>, read>,
        pairContacts: ptr<storage, array<vec4f>, read_write>,
        pairActivity: ptr<storage, array<u32>, read_write>,
        phaseDebugCounters: ptr<storage, array<atomic<u32>>, read_write>,
        pairDispatchCount: u32,
        regularizationAlpha: f32,
        tangentialRegularizationAlpha: f32,
        phaseOffset: u32,
        frictionSolveScale: f32,
        useReferenceTangentialUpdate: u32,
        frictionStatic: f32,
        frictionDynamic: f32,
        kStart: f32,
        dualForceMax: f32,
        enableNormalReleaseHeuristic: u32,
        useNormalContactMargin: u32,
        useLocalContactArms: u32,
        workgroupId: vec3u,
        localId: vec3u,
      ) -> void {
        let gid = workgroupId.x * ${WORKGROUP_SIZE3}u + localId.x;
        let activeCount = min(min(pairActivity[${pairActiveContactsOffset}u], pairDispatchCount), ${maxActivePairContacts}u);
        if (gid >= activeCount) { return; }

        let p = pairActivity[${pairActiveContactsOffset}u + gid + 1u];
        if (p >= ${maxPairContacts}u) { return; }
        let base = min(phaseOffset, 9u);
        atomicAdd(&phaseDebugCounters[base + 0u], 1u);

        let n = loadContactNormalPen(pairContacts, p).xyz;
        if (dot(n, n) <= 1e-10) { return; }

        if (n.y >= 0.0) {
          atomicAdd(&phaseDebugCounters[base + 4u], 1u);
        } else {
          atomicAdd(&phaseDebugCounters[base + 5u], 1u);
        }

        let armA = loadContactArmA(pairContacts, p);
        let armB = loadContactArmB(pairContacts, p);
        let contactMeta = loadContactMeta(pairContacts, p);
        let i = u32(contactMeta.x + 0.5);
        let j = u32(contactMeta.y + 0.5);
        if (i >= ${maxBodies}u || j >= ${maxBodies}u || i == j) { return; }

        let raStored = armA.xyz;
        let rbStored = armB.xyz;
        let posA = positions[i].xyz;
        let posB = positions[j].xyz;
        let qA = normalize(quaternions[i]);
        let qB = normalize(quaternions[j]);
        let poseBaseA = i * 2u;
        let poseBaseB = j * 2u;
        let prevPosA = initialPose[poseBaseA].xyz;
        let prevPosB = initialPose[poseBaseB].xyz;
        let prevQA = normalize(initialPose[poseBaseA + 1u]);
        let prevQB = normalize(initialPose[poseBaseB + 1u]);
        let localContactArms = useLocalContactArms > 0u;
        let ra = select(raStored, qrot(qA, raStored), localContactArms);
        let rb = select(rbStored, qrot(qB, rbStored), localContactArms);
        let dqAraw = qmul(qA, qconj(prevQA));
        let dqBraw = qmul(qB, qconj(prevQB));
        let dqA = select(dqAraw, -dqAraw, dqAraw.w < 0.0);
        let dqB = select(dqBraw, -dqBraw, dqBraw.w < 0.0);
        let dThetaA = 2.0 * dqA.xyz;
        let dThetaB = 2.0 * dqB.xyz;
        let dPosA = posA - prevPosA;
        let dPosB = posB - prevPosB;

        let jAL = -n;
        let jBL = n;
        let jAA = -cross(ra, n);
        let jBA = cross(rb, n);

        let tangentBasis = tangentBasisFromAngle(n, armA.w);
        let t1 = tangentBasis.t1;
        let t2 = tangentBasis.t2;

        let jt1AL = -t1;
        let jt1BL = t1;
        let jt1AA = -cross(ra, t1);
        let jt1BA = cross(rb, t1);
        let jt2AL = -t2;
        let jt2BL = t2;
        let jt2AA = -cross(ra, t2);
        let jt2BA = cross(rb, t2);

        let penetration0 = max(loadContactNormalPen(pairContacts, p).w, 0.0);
        let cachedConstraintC0 = loadContactConstraintC0(pairContacts, p);
        let c0 = cachedConstraintC0.x;
        let cRegN = (1.0 - regularizationAlpha) * c0
          + dot(jAL, dPosA)
          + dot(jAA, dThetaA)
          + dot(jBL, dPosB)
          + dot(jBA, dThetaB);
        if (cRegN > 0.0) {
          atomicAdd(&phaseDebugCounters[base + 6u], 1u);
        }

        let c0T1 = cachedConstraintC0.y;
        let c0T2 = cachedConstraintC0.z;
        let cRegT1 = (1.0 - tangentialRegularizationAlpha) * c0T1
          + dot(jt1AL, dPosA)
          + dot(jt1AA, dThetaA)
          + dot(jt1BL, dPosB)
          + dot(jt1BA, dThetaB);
        let cRegT2 = (1.0 - tangentialRegularizationAlpha) * c0T2
          + dot(jt2AL, dPosA)
          + dot(jt2AA, dThetaA)
          + dot(jt2BL, dPosB)
          + dot(jt2BA, dThetaB);

        let contactState = loadContactStateHot(pairContacts, p, kStart);
        let dualState = contactState.dual;
        let dualN = clamp(dualState.x, -dualForceMax, 0.0);
        let penaltyN = max(contactState.penaltyN, kStart);
        let penaltyTB = max(contactState.penalty.yz, vec2f(kStart));
        let lambdaPlusN = dualN + penaltyN * cRegN;
        var lambdaAppliedN = clamp(lambdaPlusN, -dualForceMax, 0.0);
        let normalSupportThreshold = 1e-6;
        let normalReleaseTolerance = max(2e-5, 1.25 * penetration0);
        let normalReleaseDecayNear = 0.85;
        let normalReleaseDecayFar = 0.6;
        let normalReleaseMinSupport = -5e-4;
        if (
          enableNormalReleaseHeuristic > 0u &&
          penetration0 > 1e-6
          && dualN < -normalSupportThreshold
          && cRegN > 0.0
          && -lambdaAppliedN <= normalSupportThreshold
        ) {
          let releaseDecay = select(normalReleaseDecayFar, normalReleaseDecayNear, cRegN <= normalReleaseTolerance);
          lambdaAppliedN = min(dualN * releaseDecay, normalReleaseMinSupport);
        }
        if (-lambdaAppliedN <= normalSupportThreshold) {
          atomicAdd(&phaseDebugCounters[base + 3u], 1u);
        }
        let frictionSeparationTolerance = normalReleaseTolerance;
        let frictionOffSeparation = -lambdaAppliedN <= normalSupportThreshold
          || (enableNormalReleaseHeuristic > 0u && cRegN > frictionSeparationTolerance);

        let frictionScale = contactState.frictionScale;
        let muStatic = frictionStatic * frictionScale * frictionSolveScale;
        let muDynamic = frictionDynamic * frictionScale * frictionSolveScale;
        let dualTB = contactStateDualTB(contactState, n, t1, t2, useReferenceTangentialUpdate);
        let prevTMag = length(dualTB);
        let staticBoundPrev = muStatic * abs(dualN);
        let useStatic = prevTMag <= staticBoundPrev + 1e-6;
        let mu = select(muDynamic, muStatic, useStatic);
        let frictionBound = max(mu * (-dualN), 0.0);
        if (frictionOffSeparation && frictionBound > 1e-6) {
          atomicAdd(&phaseDebugCounters[base + 8u], 1u);
        }
        if (frictionBound > 1e-6) {
          atomicAdd(&phaseDebugCounters[base + 1u], 1u);
          let lambdaPlusTB = vec2f(
            penaltyTB.x * cRegT1 + dualTB.x,
            penaltyTB.y * cRegT2 + dualTB.y,
          );
          let lambdaPlusTBLen2 = dot(lambdaPlusTB, lambdaPlusTB);
          var lambdaAppliedTB = lambdaPlusTB;
          if (lambdaPlusTBLen2 > frictionBound * frictionBound && lambdaPlusTBLen2 > 1e-12) {
            lambdaAppliedTB *= frictionBound * inverseSqrt(lambdaPlusTBLen2);
            atomicAdd(&phaseDebugCounters[base + 7u], 1u);
          }
          let lambdaAppliedTBLen2 = dot(lambdaAppliedTB, lambdaAppliedTB);
          if (lambdaAppliedTBLen2 >= (0.95 * 0.95) * frictionBound * frictionBound) {
            atomicAdd(&phaseDebugCounters[base + 2u], 1u);
          }
        }
      }
    `,
      [qrot, qmul, qconj, tangentBasisHelpers2, contactRecordHelpers, contactStateHelpers]
    );
    this.accumulatePhaseDebugCountersKernel = accumulatePhaseDebugCountersShader({
      positions: storage(positions, "vec4f", maxBodies).toReadOnly(),
      quaternions: storage(quaternions, "vec4f", maxBodies).toReadOnly(),
      initialPose: storage(initialPose, "vec4f", maxBodies * 2).toReadOnly(),
      pairContacts: storage(pairContacts, "vec4f", maxPairContacts * CONTACT_RECORD_VEC4S),
      pairActivity: storage(pairActivity, "uint", pairActivityWordCount),
      phaseDebugCounters: storage(this.phaseDebugCountersAttr, "uint", 18).toAtomic(),
      pairDispatchCount: uniform(0),
      regularizationAlpha: uniform(1),
      tangentialRegularizationAlpha: uniform(1),
      phaseOffset: uniform(0),
      frictionSolveScale: uniform(1),
      useReferenceTangentialUpdate: uniform(1),
      frictionStatic: uniform(AVBD_FRICTION_STATIC),
      frictionDynamic: uniform(AVBD_FRICTION_DYNAMIC),
      kStart: uniform(AVBD_K_START),
      dualForceMax: uniform(5e5),
      enableNormalReleaseHeuristic: uniform(0),
      useNormalContactMargin: uniform(1),
      useLocalContactArms: uniform(1),
      workgroupId,
      localId
    }).computeKernel([WORKGROUP_SIZE3, 1, 1]).setName("AVBD Accumulate Phase Debug Counters");
    const clearDebugCountersShader = wgslFn(
      /* wgsl */
      `
      fn compute(
        debugCounters: ptr<storage, array<atomic<u32>>, read_write>,
      ) -> void {
        for (var i = 0u; i < 18u; i++) {
          atomicStore(&debugCounters[i], 0u);
        }
      }
    `
    );
    this.clearDebugCountersKernel = clearDebugCountersShader({
      debugCounters: storage(this.debugCountersAttr, "uint", 18).toAtomic()
    }).computeKernel([1, 1, 1]).setName("AVBD Clear Debug Counters");
    const accumulateDebugCountersShader = wgslFn(
      /* wgsl */
      `
      fn compute(
        pairActivity: ptr<storage, array<u32>, read_write>,
        pairContacts: ptr<storage, array<vec4f>, read_write>,
        debugCounters: ptr<storage, array<atomic<u32>>, read_write>,
        pairDispatchCount: u32,
        useReferenceTangentialUpdate: u32,
        frictionStatic: f32,
        frictionDynamic: f32,
        kStart: f32,
        workgroupId: vec3u,
        localId: vec3u,
      ) -> void {
        let gid = workgroupId.x * ${WORKGROUP_SIZE3}u + localId.x;
        let activeCount = min(min(pairActivity[${pairActiveContactsOffset}u], pairDispatchCount), ${maxActivePairContacts}u);
        if (gid >= activeCount) { return; }

        let p = pairActivity[${pairActiveContactsOffset}u + gid + 1u];
        if (p >= ${maxPairContacts}u) { return; }
        atomicAdd(&debugCounters[0], 1u);

        let n = loadContactNormalPen(pairContacts, p).xyz;
        let nLen2 = dot(n, n);
        if (nLen2 <= 1e-10) { return; }
        atomicAdd(&debugCounters[1], 1u);

        if (n.y >= 0.0) {
          atomicAdd(&debugCounters[6], 1u);
        } else {
          atomicAdd(&debugCounters[7], 1u);
        }
        let absNy = abs(n.y);
        if (absNy > 0.9) {
          atomicAdd(&debugCounters[9], 1u);
        } else if (absNy < 0.2) {
          atomicAdd(&debugCounters[10], 1u);
        }

        let contactState = loadContactStateHot(pairContacts, p, kStart);
        let dualState = contactState.dual;
        let normalMag = contactState.lambdaN;
        if (normalMag <= 1e-6) {
          atomicAdd(&debugCounters[5], 1u);
        }

        let frictionScale = contactState.frictionScale;
        let muStatic = frictionStatic * frictionScale;
        let muDynamic = frictionDynamic * frictionScale;
        let dualTB = contactStateDualTB(contactState, n, vec3f(1.0, 0.0, 0.0), vec3f(0.0, 1.0, 0.0), 1u);
        let dualTWorldRaw = dualState.yzw;
        let dualTWorld = dualTWorldRaw - n * dot(dualTWorldRaw, n);
        let dualTMag = select(length(dualTWorld), length(dualTB), useReferenceTangentialUpdate > 0u);
        let staticBound = muStatic * normalMag;
        let useStatic = dualTMag <= staticBound + 1e-6;

        let mu = select(muDynamic, muStatic, useStatic);
        let frictionBound = max(mu * normalMag, 0.0);
        if (frictionBound > 1e-6) {
          atomicAdd(&debugCounters[2], 1u);
          if (useStatic) {
            atomicAdd(&debugCounters[3], 1u);
          }
          if (dualTMag >= 0.95 * frictionBound) {
            atomicAdd(&debugCounters[4], 1u);
          }
          // Strict violation against static-cone bound.
          if (dualTMag > staticBound + 1e-3) {
            atomicAdd(&debugCounters[8], 1u);
          }
        }
      }
    `,
      [tangentBasisHelpers2, contactRecordHelpers, contactStateHelpers]
    );
    this.accumulateDebugCountersKernel = accumulateDebugCountersShader({
      pairActivity: storage(pairActivity, "uint", pairActivityWordCount),
      pairContacts: storage(pairContacts, "vec4f", maxPairContacts * CONTACT_RECORD_VEC4S),
      debugCounters: storage(this.debugCountersAttr, "uint", 18).toAtomic(),
      pairDispatchCount: uniform(0),
      useReferenceTangentialUpdate: uniform(0),
      frictionStatic: uniform(AVBD_FRICTION_STATIC),
      frictionDynamic: uniform(AVBD_FRICTION_DYNAMIC),
      kStart: uniform(AVBD_K_START),
      workgroupId,
      localId
    }).computeKernel([WORKGROUP_SIZE3, 1, 1]).setName("AVBD Accumulate Debug Counters");
    const accumulateBodyColorDebugCountersShader = wgslFn(
      /* wgsl */
      `
      fn compute(
        bodyConstraintCounts: ptr<storage, array<u32>, read>,
        bodyConstraintRefs: ptr<storage, array<u32>, read>,
        pairContacts: ptr<storage, array<vec4f>, read_write>,
        jointRecords: ptr<storage, array<vec4f>, read_write>,
        springRecords: ptr<storage, array<vec4f>, read_write>,
        debugCounters: ptr<storage, array<atomic<u32>>, read_write>,
        bodyCount: u32,
        workgroupId: vec3u,
        localId: vec3u,
      ) -> void {
        let gid = workgroupId.x * ${WORKGROUP_SIZE3}u + localId.x;
        if (gid >= bodyCount) { return; }

        let word = bodyConstraintCounts[gid];
        let constraintCount = min(word & 0xFFFFu, ${maxConstraintsPerBody}u);
        if (constraintCount == 0u) { return; }

        atomicAdd(&debugCounters[11], 1u);
        atomicAdd(&debugCounters[13], constraintCount);
        atomicMax(&debugCounters[15], constraintCount);
        if (constraintCount >= ${maxConstraintsPerBody}u) {
          atomicAdd(&debugCounters[14], 1u);
        }
        if ((word & ${BODY_COLOR_FALLBACK_FLAG}u) != 0u) {
          atomicAdd(&debugCounters[12], 1u);
        }

        let bodyColor = (word >> 16u) & 0xFFu;
        let base = gid * ${maxConstraintsPerBody}u;
        for (var k = 0u; k < ${maxConstraintsPerBody}u; k++) {
          if (k >= constraintCount) { break; }
          let constraintRef = bodyConstraintRefs[base + k];
          let constraintTag = constraintRef & ${CONSTRAINT_REF_TAG_MASK}u;
          let constraintIndex = constraintRef & ${CONSTRAINT_REF_INDEX_MASK}u;
          var other = debugConstraintOtherBodyForContact(gid, constraintRef, pairContacts);
          if (constraintTag == ${CONSTRAINT_REF_TAG_JOINT}u) {
            other = debugConstraintOtherBodyForJoint(gid, constraintIndex, jointRecords);
          } else if (constraintTag == ${CONSTRAINT_REF_TAG_SPRING}u) {
            other = debugConstraintOtherBodyForSpring(gid, constraintIndex, springRecords);
          }
          if (other >= bodyCount || other <= gid) { continue; }

          let otherWord = bodyConstraintCounts[other];
          let otherConstraintCount = min(otherWord & 0xFFFFu, ${maxConstraintsPerBody}u);
          if (otherConstraintCount == 0u) { continue; }

          atomicAdd(&debugCounters[16], 1u);
          let otherColor = (otherWord >> 16u) & 0xFFu;
          if (otherColor == bodyColor) {
            atomicAdd(&debugCounters[17], 1u);
          }
        }
      }

      fn debugConstraintOtherBodyForContact(
        body: u32,
        contactIndex: u32,
        pairContacts: ptr<storage, array<vec4f>, read_write>,
      ) -> u32 {
        if (contactIndex >= ${maxPairContacts}u) { return ${maxBodies}u; }
        let contactMeta = loadContactMeta(pairContacts, contactIndex);
        let i = u32(contactMeta.x + 0.5);
        let j = u32(contactMeta.y + 0.5);
        if (i == body) { return j; }
        if (j == body) { return i; }
        return ${maxBodies}u;
      }

      fn debugConstraintOtherBodyForJoint(
        body: u32,
        jointIndex: u32,
        jointRecords: ptr<storage, array<vec4f>, read_write>,
      ) -> u32 {
        if (jointIndex >= ${maxJoints}u) { return ${maxBodies}u; }
        let jointMeta = loadJointMetaWords(jointRecords, jointIndex);
        if (jointMeta.w == 0u) { return ${maxBodies}u; }
        if (jointMeta.x == body) { return jointMeta.y; }
        if (jointMeta.y == body) { return jointMeta.x; }
        return ${maxBodies}u;
      }

      fn debugConstraintOtherBodyForSpring(
        body: u32,
        springIndex: u32,
        springRecords: ptr<storage, array<vec4f>, read_write>,
      ) -> u32 {
        if (springIndex >= ${maxSprings}u) { return ${maxBodies}u; }
        let springMeta = loadSpringMetaWords(springRecords, springIndex);
        if (springMeta.z == 0u) { return ${maxBodies}u; }
        if (springMeta.x == body) { return springMeta.y; }
        if (springMeta.y == body) { return springMeta.x; }
        return ${maxBodies}u;
      }
    `,
      [contactRecordHelpers, jointRecordHelpers, springRecordHelpers]
    );
    this.accumulateBodyColorDebugCountersKernel = accumulateBodyColorDebugCountersShader({
      bodyConstraintCounts: storage(bodyConstraintCounts, "uint", maxBodies).toReadOnly(),
      bodyConstraintRefs: storage(bodyConstraintRefs, "uint", maxBodies * maxConstraintsPerBody).toReadOnly(),
      pairContacts: storage(pairContacts, "vec4f", maxPairContacts * CONTACT_RECORD_VEC4S),
      jointRecords: storage(jointRecords, "vec4f", maxJoints * JOINT_RECORD_VEC4S),
      springRecords: storage(springRecords, "vec4f", maxSprings * SPRING_RECORD_VEC4S),
      debugCounters: storage(this.debugCountersAttr, "uint", 18).toAtomic(),
      bodyCount: uniform(0),
      workgroupId,
      localId
    }).computeKernel([WORKGROUP_SIZE3, 1, 1]).setName("AVBD Accumulate Body Color Debug Counters");
    const prepareStateShader = wgslFn(
      /* wgsl */
      `
      fn compute(
        pairContacts: ptr<storage, array<vec4f>, read_write>,
        pairActivity: ptr<storage, array<u32>, read_write>,
        pairDispatchCount: u32,
        lambdaWarmstartScale: f32,
        softenWarmstartOnSlotChange: u32,
        useReferenceTangentialUpdate: u32,
        preserveTangentialPenaltyOnStick: u32,
        useIsotropicTangentialPenaltyOnStick: u32,
        tangentialPenaltyCapScale: f32,
        frictionStatic: f32,
        gamma: f32,
        kStart: f32,
        workgroupId: vec3u,
        localId: vec3u,
      ) -> void {
        let gid = workgroupId.x * ${WORKGROUP_SIZE3}u + localId.x;
        let activeCount = min(min(pairActivity[${pairActiveContactsOffset}u], pairDispatchCount), ${maxActivePairContacts}u);
        if (gid >= activeCount) { return; }

        let p = pairActivity[${pairActiveContactsOffset}u + gid + 1u];
        if (p >= ${maxPairContacts}u) { return; }
        let prevContactRecord = loadContactRecord(pairContacts, p, kStart);
        let contactShadow = prevContactRecord.shadow.packed;
        let prevContactState = prevContactRecord.state;
        let frictionScale = prevContactState.frictionScale;

        let info = loadContactMeta(pairContacts, p);
        if (info.z < 0.5) {
          storeContactCacheWord(pairContacts, p, 0u);
          storeContactDual(pairContacts, p, vec4f(0.0));
          storeContactPenalty(pairContacts, p, packContactPenalty(kStart, vec2f(kStart), frictionScale, kStart));
          return;
        }

        var i = u32(info.x + 0.5);
        var j = u32(info.y + 0.5);
        if (i > j) {
          let t = i;
          i = j;
          j = t;
        }
        let encodedInfo = bitcast<u32>(info.w);
        let feature = encodedInfo & 0x1FFu;
        let preserveWarmstart = ((encodedInfo >> 16u) & 0x1u) != 0u;
        let stick = ((encodedInfo >> 17u) & 0x1u) != 0u;
        let warmstartReason = (encodedInfo >> 21u) & 0x7u;
        let exactFeatureWarmstart = warmstartReason == 1u;
        let localSlot = p % ${clampedPairManifoldSlots}u;
        let packedBodies = (i & 0xFFFFu) | ((j & 0xFFFFu) << 16u);
        // Build a structured key:
        // high identity bits = body-pair/contact identity, low slot bits = slot id.
        // This allows continuity across manifold slot remaps without letting
        // unrelated clipped contact points inherit the same dual state.
        // Preserve the exact geometric feature bits inside the continuity key.
        // The previous hash-only base could alias adjacent face ordinals
        // (for example 0xa9 and 0xaa), which made slot swaps look like valid
        // continuity holds. Match avbd-demo3d more closely by keeping the
        // feature exact and hashing only the body-pair portion.
        let pairHash = 1u + (((packedBodies * 2246822519u) ^ (packedBodies >> 16u) ^ (packedBodies << 7u)) % ${contactKeyPairHashMax}u);
        let keyBase = (pairHash << ${contactKeyFeatureBitCount}u) | feature;
        let key = (keyBase << ${contactKeySlotBitCount}u) | localSlot;

        let prevKeyPacked = loadContactCacheWord(pairContacts, p);
        let prevKey = prevKeyPacked & 0x7fffffffu;
        let prevBase = prevKey >> ${contactKeySlotBitCount}u;
        let continuityHeld = preserveWarmstart && prevKey != 0u && prevBase == keyBase;
        let slotChanged = prevKey != key;
        var prevDual = prevContactState.dual;
        var prevPenalty = prevContactState.penalty;
        let prevDualN = min(prevDual.x, 0.0);
        let prevLambdaN = prevContactState.lambdaN;
        let prevPenaltyN = prevContactState.penaltyN;
        // pairLambdas is a derived positive-magnitude shadow used for
        // heuristics/debug and one-step contact-generation seed transport.
        // Once prepare runs, avbdDualState becomes the authoritative record.
        let seedShadow = prevContactRecord.shadow;
        let matchedCarryN = seedShadow.lambdaN;
        if (!continuityHeld) {
          // Reference parity: unmatched rows start from zero lambda and
          // minimum penalty. Do not promote generation-time shadow seeds into
          // the live solver state on continuity miss.
          storeContactDual(pairContacts, p, vec4f(0.0));
          storeContactPenalty(
            pairContacts,
            p,
            packContactPenalty(kStart, vec2f(kStart), seedShadow.frictionScale, kStart),
          );
        } else {
          let slotWarmstartScale = 1.0;
          var warmDual = prevDual * lambdaWarmstartScale;
          var warmDualN = min(warmDual.x, 0.0);
          var warmStoredDual = vec4f(0.0);
          if (useReferenceTangentialUpdate > 0u) {
            // Reference parity: warmstart is a plain Eq.19-style decay.
            // Do not reclamp tangential dual against the friction cone during
            // prepare; the references leave cone enforcement to the dual
            // update/solve path.
            warmStoredDual = vec4f(warmDualN, warmDual.yz, 0.0);
          } else {
            var warmDualT = warmDual.yzw;
            let nRaw = loadContactNormalPen(pairContacts, p).xyz;
            let nLen2 = dot(nRaw, nRaw);
            if (nLen2 > 1e-10) {
              let nUnit = nRaw * inverseSqrt(nLen2);
              warmDualT -= nUnit * dot(warmDualT, nUnit);
            } else {
              warmDualT = vec3f(0.0);
            }
            warmStoredDual = vec4f(warmDualN, warmDualT);
          }
          var warmPenaltyN = max(prevPenalty.x * gamma, kStart);
          var warmPenaltyT1 = max(prevPenalty.y * gamma, kStart);
          var warmPenaltyT2 = max(prevPenalty.z * gamma, kStart);
          let holdTangentialPenalty = preserveTangentialPenaltyOnStick > 0u
            && useReferenceTangentialUpdate == 0u
            && stick
            && prevKey == key;
          if (holdTangentialPenalty) {
            warmPenaltyT1 = max(prevPenalty.y, kStart);
            warmPenaltyT2 = max(prevPenalty.z, kStart);
          }
          if (tangentialPenaltyCapScale > 0.0 && useReferenceTangentialUpdate == 0u) {
            let tangentialPenaltyCap = max(warmPenaltyN * tangentialPenaltyCapScale, kStart);
            warmPenaltyT1 = min(warmPenaltyT1, tangentialPenaltyCap);
            warmPenaltyT2 = min(warmPenaltyT2, tangentialPenaltyCap);
          }
          if (
            useIsotropicTangentialPenaltyOnStick > 0u
            && useReferenceTangentialUpdate == 0u
            && stick
            && prevKey == key
          ) {
            let sharedPenaltyT = max(0.5 * (warmPenaltyT1 + warmPenaltyT2), kStart);
            warmPenaltyT1 = sharedPenaltyT;
            warmPenaltyT2 = sharedPenaltyT;
          }
          storeContactDual(pairContacts, p, warmStoredDual);
          storeContactPenalty(pairContacts, p, packContactPenalty(
            warmPenaltyN,
            vec2f(warmPenaltyT1, warmPenaltyT2),
            frictionScale,
            kStart,
          ));
        }

        storeContactCacheWord(pairContacts, p, key | select(0u, 0x80000000u, continuityHeld));
      }
    `,
      [tangentBasisHelpers2, contactRecordHelpers, contactStateHelpers]
    );
    this.prepareStateKernel = prepareStateShader({
      pairContacts: storage(pairContacts, "vec4f", maxPairContacts * CONTACT_RECORD_VEC4S),
      pairActivity: storage(pairActivity, "uint", pairActivityWordCount),
      pairDispatchCount: uniform(0),
      lambdaWarmstartScale: uniform(0.95 * AVBD_GAMMA),
      softenWarmstartOnSlotChange: uniform(0),
      useReferenceTangentialUpdate: uniform(1),
      preserveTangentialPenaltyOnStick: uniform(0),
      useIsotropicTangentialPenaltyOnStick: uniform(0),
      tangentialPenaltyCapScale: uniform(0),
      frictionStatic: uniform(AVBD_FRICTION_STATIC),
      gamma: uniform(AVBD_GAMMA),
      kStart: uniform(AVBD_K_START),
      workgroupId,
      localId
    }).computeKernel([WORKGROUP_SIZE3, 1, 1]).setName("AVBD Prepare Contact State");
    assertStorageBufferBudget("AVBD Prepare Contact State", 9);
    const prepareJointStateShader = wgslFn(
      /* wgsl */
      `
      fn compute(
        positions: ptr<storage, array<vec4f>, read>,
        quaternions: ptr<storage, array<vec4f>, read>,
        velocities: ptr<storage, array<vec4f>, read>,
        angularVelocities: ptr<storage, array<vec4f>, read>,
        initialPose: ptr<storage, array<vec4f>, read>,
        jointRecords: ptr<storage, array<vec4f>, read_write>,
        jointCount: u32,
        lambdaWarmstartScale: f32,
        gamma: f32,
        kStart: f32,
        dt: f32,
        workgroupId: vec3u,
        localId: vec3u,
      ) -> void {
        let gid = workgroupId.x * ${WORKGROUP_SIZE3}u + localId.x;
        if (gid >= jointCount) { return; }

        let jointMetaWords = loadJointMetaWords(jointRecords, gid);
        if (jointMetaWords.w == 0u) { return; }

        let bodyA = jointMetaWords.x;
        let bodyB = jointMetaWords.y;
        let jointType = jointMetaWords.z;
        let anchorA = loadJointAnchorA(jointRecords, gid);
        let anchorB = loadJointAnchorB(jointRecords, gid);
        let torqueArm = max(anchorA.w, 1.0);

        var qA = vec4f(0.0, 0.0, 0.0, 1.0);
        var posA = anchorA.xyz;
        if (bodyA != WORLD_BODY_INDEX) {
          qA = normalize(initialPose[bodyA * 2u + 1u]);
          posA = initialPose[bodyA * 2u].xyz;
        }
        let qB = normalize(initialPose[bodyB * 2u + 1u]);
        let posB = initialPose[bodyB * 2u].xyz;
        let worldAnchorA = jointWorldAnchor(bodyA, anchorA.xyz, posA, qA);
        let worldAnchorB = posB + qrot(qB, anchorB.xyz);
        let regularizationPoseA = jointRegularizationPose(
          bodyA,
          initialPose,
          positions,
          quaternions,
          velocities,
          angularVelocities,
          dt,
        );
        let regularizationPoseB = jointRegularizationPose(
          bodyB,
          initialPose,
          positions,
          quaternions,
          velocities,
          angularVelocities,
          dt,
        );
        let regularizationAnchorA = jointWorldAnchor(
          bodyA,
          anchorA.xyz,
          regularizationPoseA.position,
          regularizationPoseA.rotation,
        );
        let regularizationAnchorB = jointWorldAnchor(
          bodyB,
          anchorB.xyz,
          regularizationPoseB.position,
          regularizationPoseB.rotation,
        );
        let c0Lin = regularizationAnchorA - regularizationAnchorB;
        storeJointC0Lin(jointRecords, gid, vec4f(c0Lin, 0.0));

        let c0Ang = select(
          vec3f(0.0),
          jointFixedAngularConstraint(
            bodyA,
            regularizationPoseA.rotation,
            regularizationPoseB.rotation,
            loadJointRestRelativeRotation(jointRecords, gid),
            torqueArm,
          ),
          jointType == JOINT_TYPE_FIXED,
        );
        storeJointC0Ang(jointRecords, gid, vec4f(c0Ang, 0.0));

        let prevLambdaLin = loadJointLambdaLin(jointRecords, gid).xyz;
        let prevLambdaAng = loadJointLambdaAng(jointRecords, gid).xyz;
        let prevPenaltyLin = max(loadJointPenaltyLin(jointRecords, gid).xyz, vec3f(kStart));
        let stiffness = loadJointStiffness(jointRecords, gid);
        let rigidLinear = !isFiniteF32(stiffness.x);
        let angularEnabled = jointType == JOINT_TYPE_FIXED && stiffness.y > 0.0;
        let rigidAngular = angularEnabled && !isFiniteF32(stiffness.y);
        let minPenaltyAng = select(vec3f(0.0), vec3f(kStart), angularEnabled);
        let prevPenaltyAng = max(loadJointPenaltyAng(jointRecords, gid).xyz, minPenaltyAng);
        let maxPenaltyLin = vec3f(min(max(stiffness.x, kStart), ${AVBD_JOINT_PENALTY_MAX}));
        let maxPenaltyAng = vec3f(min(max(stiffness.y, 0.0), ${AVBD_JOINT_PENALTY_MAX}));

        storeJointLambdaLin(
          jointRecords,
          gid,
          vec4f(prevLambdaLin * lambdaWarmstartScale, 0.0),
        );
        storeJointLambdaAng(
          jointRecords,
          gid,
          vec4f(select(vec3f(0.0), prevLambdaAng * lambdaWarmstartScale, angularEnabled), 0.0),
        );
        storeJointPenaltyLin(
          jointRecords,
          gid,
          vec4f(min(max(prevPenaltyLin * gamma, vec3f(kStart)), maxPenaltyLin), 0.0),
        );
        storeJointPenaltyAng(
          jointRecords,
          gid,
          vec4f(min(max(prevPenaltyAng * gamma, minPenaltyAng), maxPenaltyAng), 0.0),
        );
      }
    `,
      [qrot, qmul, qconj, jointRecordHelpers, jointConstraintHelpers]
    );
    this.prepareJointStateKernel = prepareJointStateShader({
      positions: storage(positions, "vec4f", maxBodies).toReadOnly(),
      quaternions: storage(quaternions, "vec4f", maxBodies).toReadOnly(),
      velocities: storage(velocities, "vec4f", maxBodies).toReadOnly(),
      angularVelocities: storage(angularVelocities, "vec4f", maxBodies).toReadOnly(),
      initialPose: storage(initialPose, "vec4f", maxBodies * 2).toReadOnly(),
      jointRecords: storage(jointRecords, "vec4f", maxJoints * JOINT_RECORD_VEC4S),
      jointCount: uniform(0),
      lambdaWarmstartScale: uniform(0.95 * AVBD_GAMMA),
      gamma: uniform(AVBD_GAMMA),
      kStart: uniform(AVBD_K_START),
      dt: uniform(1 / 60 / 4),
      workgroupId,
      localId
    }).computeKernel([WORKGROUP_SIZE3, 1, 1]).setName("AVBD Prepare Joint State");
    assertStorageBufferBudget("AVBD Prepare Joint State", 6);
    const buildSolverConstraintListsShader = wgslFn(
      /* wgsl */
      `
      fn compute(
        pairBodyContactCounts: ptr<storage, array<u32>, read>,
        pairBodyContactIndices: ptr<storage, array<u32>, read>,
        bodyConstraintCounts: ptr<storage, array<u32>, read_write>,
        bodyConstraintRefs: ptr<storage, array<u32>, read_write>,
        bodyColorScratch: ptr<storage, array<u32>, read_write>,
        bodyCount: u32,
        workgroupId: vec3u,
        localId: vec3u,
      ) -> void {
        let gid = workgroupId.x * ${WORKGROUP_SIZE3}u + localId.x;
        if (gid >= bodyCount) { return; }

        let previousColor = (bodyConstraintCounts[gid] >> 16u) & 0xFFu;
        bodyColorScratch[gid] = previousColor << 16u;
        let contactCount = min(pairBodyContactCounts[gid] & 0xFFFFu, ${maxPairContactsPerBody}u);
        let solverCount = min(contactCount, ${maxConstraintsPerBody}u);
        bodyConstraintCounts[gid] = solverCount;
        let srcBase = gid * ${maxPairContactsPerBody}u;
        let dstBase = gid * ${maxConstraintsPerBody}u;
        for (var k = 0u; k < ${maxConstraintsPerBody}u; k++) {
          if (k < solverCount) {
            bodyConstraintRefs[dstBase + k] = pairBodyContactIndices[srcBase + k];
          } else {
            bodyConstraintRefs[dstBase + k] = 0u;
          }
        }
      }
    `
    );
    this.buildSolverConstraintListsKernel = buildSolverConstraintListsShader({
      pairBodyContactCounts: storage(pairBodyContactCounts, "uint", maxBodies).toReadOnly(),
      pairBodyContactIndices: storage(pairBodyContactIndices, "uint", maxBodies * maxPairContactsPerBody).toReadOnly(),
      bodyConstraintCounts: storage(bodyConstraintCounts, "uint", maxBodies),
      bodyConstraintRefs: storage(bodyConstraintRefs, "uint", maxBodies * maxConstraintsPerBody),
      bodyColorScratch: storage(bodyColorScratch, "uint", maxBodies),
      bodyCount: uniform(0),
      workgroupId,
      localId
    }).computeKernel([WORKGROUP_SIZE3, 1, 1]).setName("AVBD Build Solver Constraint Lists");
    assertStorageBufferBudget("AVBD Build Solver Constraint Lists", 5);
    const appendJointConstraintRefsShader = wgslFn(
      /* wgsl */
      `
      fn compute(
        positions: ptr<storage, array<vec4f>, read>,
        jointRecords: ptr<storage, array<vec4f>, read_write>,
        bodyConstraintCounts: ptr<storage, array<atomic<u32>>, read_write>,
        bodyConstraintRefs: ptr<storage, array<u32>, read_write>,
        jointCount: u32,
        workgroupId: vec3u,
        localId: vec3u,
      ) -> void {
        let gid = workgroupId.x * ${WORKGROUP_SIZE3}u + localId.x;
        if (gid >= jointCount) { return; }

        let jointMetaWords = loadJointMetaWords(jointRecords, gid);
        if (jointMetaWords.w == 0u) { return; }

        let taggedRef = ${CONSTRAINT_REF_TAG_JOINT}u | gid;
        let bodyA = jointMetaWords.x;
        let bodyB = jointMetaWords.y;

        if (bodyA != 0xffffffffu && positions[bodyA].w > 0.0) {
          let slotA = atomicAdd(&bodyConstraintCounts[bodyA], 1u);
          if (slotA < ${maxConstraintsPerBody}u) {
            bodyConstraintRefs[bodyA * ${maxConstraintsPerBody}u + slotA] = taggedRef;
          }
        }
        if (positions[bodyB].w > 0.0) {
          let slotB = atomicAdd(&bodyConstraintCounts[bodyB], 1u);
          if (slotB < ${maxConstraintsPerBody}u) {
            bodyConstraintRefs[bodyB * ${maxConstraintsPerBody}u + slotB] = taggedRef;
          }
        }
      }
    `,
      [qrot, qmul, qconj, jointRecordHelpers, jointConstraintHelpers]
    );
    this.appendJointConstraintRefsKernel = appendJointConstraintRefsShader({
      positions: storage(positions, "vec4f", maxBodies).toReadOnly(),
      jointRecords: storage(jointRecords, "vec4f", maxJoints * JOINT_RECORD_VEC4S),
      bodyConstraintCounts: storage(bodyConstraintCounts, "uint", maxBodies).toAtomic(),
      bodyConstraintRefs: storage(bodyConstraintRefs, "uint", maxBodies * maxConstraintsPerBody),
      jointCount: uniform(0),
      workgroupId,
      localId
    }).computeKernel([WORKGROUP_SIZE3, 1, 1]).setName("AVBD Append Joint Constraint Refs");
    assertStorageBufferBudget("AVBD Append Joint Constraint Refs", 4);
    const appendSpringConstraintRefsShader = wgslFn(
      /* wgsl */
      `
      fn compute(
        positions: ptr<storage, array<vec4f>, read>,
        springRecords: ptr<storage, array<vec4f>, read_write>,
        bodyConstraintCounts: ptr<storage, array<atomic<u32>>, read_write>,
        bodyConstraintRefs: ptr<storage, array<u32>, read_write>,
        springCount: u32,
        workgroupId: vec3u,
        localId: vec3u,
      ) -> void {
        let gid = workgroupId.x * ${WORKGROUP_SIZE3}u + localId.x;
        if (gid >= springCount) { return; }

        let springMetaWords = loadSpringMetaWords(springRecords, gid);
        if (springMetaWords.z == 0u) { return; }

        let taggedRef = ${CONSTRAINT_REF_TAG_SPRING}u | gid;
        let bodyA = springMetaWords.x;
        let bodyB = springMetaWords.y;

        if (bodyA != 0xffffffffu && positions[bodyA].w > 0.0) {
          let slotA = atomicAdd(&bodyConstraintCounts[bodyA], 1u);
          if (slotA < ${maxConstraintsPerBody}u) {
            bodyConstraintRefs[bodyA * ${maxConstraintsPerBody}u + slotA] = taggedRef;
          }
        }
        if (positions[bodyB].w > 0.0) {
          let slotB = atomicAdd(&bodyConstraintCounts[bodyB], 1u);
          if (slotB < ${maxConstraintsPerBody}u) {
            bodyConstraintRefs[bodyB * ${maxConstraintsPerBody}u + slotB] = taggedRef;
          }
        }
      }
    `,
      [springRecordHelpers]
    );
    this.appendSpringConstraintRefsKernel = appendSpringConstraintRefsShader({
      positions: storage(positions, "vec4f", maxBodies).toReadOnly(),
      springRecords: storage(springRecords, "vec4f", maxSprings * SPRING_RECORD_VEC4S),
      bodyConstraintCounts: storage(bodyConstraintCounts, "uint", maxBodies).toAtomic(),
      bodyConstraintRefs: storage(bodyConstraintRefs, "uint", maxBodies * maxConstraintsPerBody),
      springCount: uniform(0),
      workgroupId,
      localId
    }).computeKernel([WORKGROUP_SIZE3, 1, 1]).setName("AVBD Append Spring Constraint Refs");
    assertStorageBufferBudget("AVBD Append Spring Constraint Refs", 4);
    const greedyBodyColorsShader = wgslFn(
      /* wgsl */
      `
      fn compute(
        bodyConstraintCounts: ptr<storage, array<u32>, read_write>,
        bodyConstraintRefs: ptr<storage, array<u32>, read>,
        pairContacts: ptr<storage, array<vec4f>, read_write>,
        jointRecords: ptr<storage, array<vec4f>, read_write>,
        springRecords: ptr<storage, array<vec4f>, read_write>,
        bodyColorScratch: ptr<storage, array<u32>, read>,
        bodyCount: u32,
        colorCount: u32,
        workgroupId: vec3u,
        localId: vec3u,
      ) -> void {
        let gid = workgroupId.x * ${WORKGROUP_SIZE3}u + localId.x;
        if (gid >= bodyCount) { return; }

        let word = bodyConstraintCounts[gid];
        let contactCount = min(word & 0xFFFFu, ${maxConstraintsPerBody}u);
        if (contactCount == 0u) {
          bodyConstraintCounts[gid] = 0u;
          return;
        }

        let colors = max(1u, min(colorCount, 32u));
        var usedMask = 0u;
        let base = gid * ${maxConstraintsPerBody}u;
        for (var k = 0u; k < ${maxConstraintsPerBody}u; k++) {
          if (k >= contactCount) { break; }
          let constraintRef = bodyConstraintRefs[base + k];
          let constraintTag = constraintRef & ${CONSTRAINT_REF_TAG_MASK}u;
          let constraintIndex = constraintRef & ${CONSTRAINT_REF_INDEX_MASK}u;
          var other = constraintOtherBodyForContact(gid, constraintRef, pairContacts);
          if (constraintTag == ${CONSTRAINT_REF_TAG_JOINT}u) {
            other = constraintOtherBodyForJoint(gid, constraintIndex, jointRecords);
          } else if (constraintTag == ${CONSTRAINT_REF_TAG_SPRING}u) {
            other = constraintOtherBodyForSpring(gid, constraintIndex, springRecords);
          }
          if (other >= bodyCount || other == gid) { continue; }
          if (other <= gid) { continue; }

          let otherPrevColor = (bodyColorScratch[other] >> 16u) & 0xFFu;
          if (otherPrevColor < colors) {
            usedMask |= 1u << otherPrevColor;
          }
        }

        var chosenColor = (bodyColorScratch[gid] >> 16u) & 0xFFu;
        var fallback = false;
        var needsNewColor = chosenColor >= colors;
        if (!needsNewColor) {
          needsNewColor = (usedMask & (1u << chosenColor)) != 0u;
        }
        if (needsNewColor) {
          fallback = true;
          var found = false;
          for (var color = 0u; color < 32u; color++) {
            if (color >= colors) { break; }
            if ((usedMask & (1u << color)) == 0u) {
              chosenColor = color;
              found = true;
              fallback = false;
              break;
            }
          }
          if (!found) {
            chosenColor = gid % colors;
          }
        }

        bodyConstraintCounts[gid] = (chosenColor << 16u) | contactCount | select(0u, ${BODY_COLOR_FALLBACK_FLAG}u, fallback);
      }
      
      fn constraintOtherBodyForContact(
        body: u32,
        contactIndex: u32,
        pairContacts: ptr<storage, array<vec4f>, read_write>,
      ) -> u32 {
        if (contactIndex >= ${maxPairContacts}u) { return ${maxBodies}u; }
        let contactMeta = loadContactMeta(pairContacts, contactIndex);
        let i = u32(contactMeta.x + 0.5);
        let j = u32(contactMeta.y + 0.5);
        if (i == body) { return j; }
        if (j == body) { return i; }
        return ${maxBodies}u;
      }

      fn constraintOtherBodyForJoint(
        body: u32,
        jointIndex: u32,
        jointRecords: ptr<storage, array<vec4f>, read_write>,
      ) -> u32 {
        if (jointIndex >= ${maxJoints}u) { return ${maxBodies}u; }
        let jointMetaWords = loadJointMetaWords(jointRecords, jointIndex);
        if (jointMetaWords.w == 0u) { return ${maxBodies}u; }
        if (jointMetaWords.x == body) { return jointMetaWords.y; }
        if (jointMetaWords.y == body) { return jointMetaWords.x; }
        return ${maxBodies}u;
      }

      fn constraintOtherBodyForSpring(
        body: u32,
        springIndex: u32,
        springRecords: ptr<storage, array<vec4f>, read_write>,
      ) -> u32 {
        if (springIndex >= ${maxSprings}u) { return ${maxBodies}u; }
        let springMetaWords = loadSpringMetaWords(springRecords, springIndex);
        if (springMetaWords.z == 0u) { return ${maxBodies}u; }
        if (springMetaWords.x == body) { return springMetaWords.y; }
        if (springMetaWords.y == body) { return springMetaWords.x; }
        return ${maxBodies}u;
      }
    `,
      [contactRecordHelpers, jointRecordHelpers, springRecordHelpers]
    );
    this.greedyBodyColorsKernel = greedyBodyColorsShader({
      bodyConstraintCounts: storage(bodyConstraintCounts, "uint", maxBodies),
      bodyConstraintRefs: storage(bodyConstraintRefs, "uint", maxBodies * maxConstraintsPerBody).toReadOnly(),
      pairContacts: storage(pairContacts, "vec4f", maxPairContacts * CONTACT_RECORD_VEC4S),
      jointRecords: storage(jointRecords, "vec4f", maxJoints * JOINT_RECORD_VEC4S),
      springRecords: storage(springRecords, "vec4f", maxSprings * SPRING_RECORD_VEC4S),
      bodyColorScratch: storage(bodyColorScratch, "uint", maxBodies).toReadOnly(),
      bodyCount: uniform(0),
      colorCount: uniform(1),
      workgroupId,
      localId
    }).computeKernel([WORKGROUP_SIZE3, 1, 1]).setName("AVBD Incremental Greedy Body Colors");
    assertStorageBufferBudget("AVBD Incremental Greedy Body Colors", 6);
    const markHardColorConflictsShader = wgslFn(
      /* wgsl */
      `
      fn compute(
        bodyConstraintCounts: ptr<storage, array<atomic<u32>>, read_write>,
        jointRecords: ptr<storage, array<vec4f>, read_write>,
        springRecords: ptr<storage, array<vec4f>, read_write>,
        bodyCount: u32,
        jointCount: u32,
        springCount: u32,
        workgroupId: vec3u,
        localId: vec3u,
      ) -> void {
        let gid = workgroupId.x * ${WORKGROUP_SIZE3}u + localId.x;

        if (gid < jointCount) {
          let jointMetaWords = loadJointMetaWords(jointRecords, gid);
          if (jointMetaWords.w != 0u) {
            markHardColorConflictEdge(bodyConstraintCounts, bodyCount, jointMetaWords.x, jointMetaWords.y);
          }
        }

        if (gid < springCount) {
          let springMetaWords = loadSpringMetaWords(springRecords, gid);
          if (springMetaWords.z != 0u) {
            markHardColorConflictEdge(bodyConstraintCounts, bodyCount, springMetaWords.x, springMetaWords.y);
          }
        }
      }

      fn markHardColorConflictEdge(
        bodyConstraintCounts: ptr<storage, array<atomic<u32>>, read_write>,
        bodyCount: u32,
        bodyA: u32,
        bodyB: u32,
      ) {
        if (bodyA == 0xffffffffu || bodyB == 0xffffffffu) { return; }
        if (bodyA >= bodyCount || bodyB >= bodyCount || bodyA == bodyB) { return; }

        let wordA = atomicLoad(&bodyConstraintCounts[bodyA]);
        let wordB = atomicLoad(&bodyConstraintCounts[bodyB]);
        let countA = wordA & 0xFFFFu;
        let countB = wordB & 0xFFFFu;
        if (countA == 0u || countB == 0u) { return; }

        let colorA = (wordA >> 16u) & 0xFFu;
        let colorB = (wordB >> 16u) & 0xFFu;
        if (colorA != colorB) { return; }

        // Match the paper author's higher-id dependency orientation: lower-id
        // bodies adapt, higher-id bodies stay fixed for this repair round.
        let loser = min(bodyA, bodyB);
        atomicOr(&bodyConstraintCounts[loser], ${BODY_COLOR_REPAIR_FLAG}u);
      }
    `,
      [jointRecordHelpers, springRecordHelpers]
    );
    this.markHardColorConflictsKernel = markHardColorConflictsShader({
      bodyConstraintCounts: storage(bodyConstraintCounts, "uint", maxBodies).toAtomic(),
      jointRecords: storage(jointRecords, "vec4f", maxJoints * JOINT_RECORD_VEC4S),
      springRecords: storage(springRecords, "vec4f", maxSprings * SPRING_RECORD_VEC4S),
      bodyCount: uniform(0),
      jointCount: uniform(0),
      springCount: uniform(0),
      workgroupId,
      localId
    }).computeKernel([WORKGROUP_SIZE3, 1, 1]).setName("AVBD Mark Hard Body Color Conflicts");
    assertStorageBufferBudget("AVBD Mark Hard Body Color Conflicts", 3);
    const repairHardBodyColorsShader = wgslFn(
      /* wgsl */
      `
      fn compute(
        bodyConstraintCounts: ptr<storage, array<u32>, read_write>,
        bodyConstraintRefs: ptr<storage, array<u32>, read>,
        jointRecords: ptr<storage, array<vec4f>, read_write>,
        springRecords: ptr<storage, array<vec4f>, read_write>,
        bodyCount: u32,
        colorCount: u32,
        workgroupId: vec3u,
        localId: vec3u,
      ) -> void {
        let gid = workgroupId.x * ${WORKGROUP_SIZE3}u + localId.x;
        if (gid >= bodyCount) { return; }

        let word = bodyConstraintCounts[gid];
        if ((word & ${BODY_COLOR_REPAIR_FLAG}u) == 0u) { return; }

        let constraintCount = min(word & 0xFFFFu, ${maxConstraintsPerBody}u);
        if (constraintCount == 0u) {
          bodyConstraintCounts[gid] = 0u;
          return;
        }

        let colors = max(1u, min(colorCount, 32u));
        var usedMask = 0u;
        let base = gid * ${maxConstraintsPerBody}u;
        for (var k = 0u; k < ${maxConstraintsPerBody}u; k++) {
          if (k >= constraintCount) { break; }

          let constraintRef = bodyConstraintRefs[base + k];
          let constraintTag = constraintRef & ${CONSTRAINT_REF_TAG_MASK}u;
          let constraintIndex = constraintRef & ${CONSTRAINT_REF_INDEX_MASK}u;
          var other = ${maxBodies}u;
          if (constraintTag == ${CONSTRAINT_REF_TAG_JOINT}u) {
            other = repairConstraintOtherBodyForJoint(gid, constraintIndex, jointRecords);
          } else if (constraintTag == ${CONSTRAINT_REF_TAG_SPRING}u) {
            other = repairConstraintOtherBodyForSpring(gid, constraintIndex, springRecords);
          } else {
            continue;
          }
          if (other >= bodyCount || other == gid) { continue; }

          let otherWord = bodyConstraintCounts[other];
          let otherConstraintCount = min(otherWord & 0xFFFFu, ${maxConstraintsPerBody}u);
          if (otherConstraintCount == 0u) { continue; }

          let otherColor = (otherWord >> 16u) & 0xFFu;
          if (otherColor < colors) {
            usedMask |= 1u << otherColor;
          }
        }

        var chosenColor = (word >> 16u) & 0xFFu;
        var fallback = false;
        var needsNewColor = chosenColor >= colors;
        if (!needsNewColor) {
          needsNewColor = (usedMask & (1u << chosenColor)) != 0u;
        }
        if (needsNewColor) {
          var found = false;
          for (var color = 0u; color < 32u; color++) {
            if (color >= colors) { break; }
            if ((usedMask & (1u << color)) == 0u) {
              chosenColor = color;
              found = true;
              break;
            }
          }
          if (!found) {
            chosenColor = gid % colors;
            fallback = true;
          }
        }

        bodyConstraintCounts[gid] = (chosenColor << 16u) | constraintCount | select(0u, ${BODY_COLOR_FALLBACK_FLAG}u, fallback);
      }

      fn repairConstraintOtherBodyForJoint(
        body: u32,
        jointIndex: u32,
        jointRecords: ptr<storage, array<vec4f>, read_write>,
      ) -> u32 {
        if (jointIndex >= ${maxJoints}u) { return ${maxBodies}u; }
        let jointMetaWords = loadJointMetaWords(jointRecords, jointIndex);
        if (jointMetaWords.w == 0u) { return ${maxBodies}u; }
        if (jointMetaWords.x == body) { return jointMetaWords.y; }
        if (jointMetaWords.y == body) { return jointMetaWords.x; }
        return ${maxBodies}u;
      }

      fn repairConstraintOtherBodyForSpring(
        body: u32,
        springIndex: u32,
        springRecords: ptr<storage, array<vec4f>, read_write>,
      ) -> u32 {
        if (springIndex >= ${maxSprings}u) { return ${maxBodies}u; }
        let springMetaWords = loadSpringMetaWords(springRecords, springIndex);
        if (springMetaWords.z == 0u) { return ${maxBodies}u; }
        if (springMetaWords.x == body) { return springMetaWords.y; }
        if (springMetaWords.y == body) { return springMetaWords.x; }
        return ${maxBodies}u;
      }
    `,
      [jointRecordHelpers, springRecordHelpers]
    );
    this.repairHardBodyColorsKernel = repairHardBodyColorsShader({
      bodyConstraintCounts: storage(bodyConstraintCounts, "uint", maxBodies),
      bodyConstraintRefs: storage(bodyConstraintRefs, "uint", maxBodies * maxConstraintsPerBody).toReadOnly(),
      jointRecords: storage(jointRecords, "vec4f", maxJoints * JOINT_RECORD_VEC4S),
      springRecords: storage(springRecords, "vec4f", maxSprings * SPRING_RECORD_VEC4S),
      bodyCount: uniform(0),
      colorCount: uniform(1),
      workgroupId,
      localId
    }).computeKernel([WORKGROUP_SIZE3, 1, 1]).setName("AVBD Repair Hard Body Colors");
    assertStorageBufferBudget("AVBD Repair Hard Body Colors", 4);
    const makePrimalBodySolveShader = (mode) => {
      const inertiaParam = mode === "localDiag" ? "        inverseInertia: ptr<storage, array<vec4f>, read>,\n" : "        derivedInvInertia: ptr<storage, array<vec4f>, read>,\n";
      const localDiagonalUniformParam = mode === "generic" ? "        useLocalDiagonalInertia: u32,\n" : "";
      const inertiaSetup = mode === "localDiag" ? (
        /* wgsl */
        `
        let inv = inverseInertia[gid];
        let invMass = inv.w;
        let initialBase = gid * 2u;
        let poseBase = gid * ${INERTIAL_POSE_VEC4S_PER_BODY2}u;
        let currentPose = inertialPose[poseBase + 2u];
        var pos = currentPose.xyz;
        var q = normalize(inertialPose[poseBase + 3u]);
        if (!(invMass > 0.0)) {
          bodySolveOutputPose[bodySolveOutputBase] = currentPose;
          bodySolveOutputPose[bodySolveOutputBase + 1u] = q;
          return;
        }
        let localInvI = vec3f(
          max(inv.x, 1e-8),
          max(inv.y, 1e-8),
          max(inv.z, 1e-8),
        );

        let initialPos = initialPose[initialBase].xyz;
        let initialQ = normalize(initialPose[initialBase + 1u]);
        let inertialPos = inertialPose[poseBase].xyz;
        let inertialQ = normalize(inertialPose[poseBase + 1u]);

        let dqConstraintRaw = qmul(q, qconj(initialQ));
        let dqConstraint = select(dqConstraintRaw, -dqConstraintRaw, dqConstraintRaw.w < 0.0);
        let dThetaConstraint = 2.0 * dqConstraint.xyz;
        let dqInertialRaw = qmul(q, qconj(inertialQ));
        let dqInertial = select(dqInertialRaw, -dqInertialRaw, dqInertialRaw.w < 0.0);
        let dThetaInertial = 2.0 * dqInertial.xyz;
        let dPosInertial = pos - inertialPos;
        let dPosConstraint = pos - initialPos;

        var A: array<array<f32, 6>, 6>;
        var b: array<f32, 6>;
        for (var r = 0u; r < 6u; r++) {
          b[r] = 0.0;
          for (var c = 0u; c < 6u; c++) {
            A[r][c] = 0.0;
          }
        }

        let invDt2 = 1.0 / max(dt * dt, 1e-8);
        let mass = 1.0 / max(invMass, 1e-8);
        let mOverDt2 = inertialDiagWeight * invDt2;
        let localIx = 1.0 / localInvI.x;
        let localIy = 1.0 / localInvI.y;
        let localIz = 1.0 / localInvI.z;
        let i00 = localIx;
        let i11 = localIy;
        let i22 = localIz;
        let i01 = 0.0;
        let i02 = 0.0;
        let i12 = 0.0;

        A[0][0] = mOverDt2 * mass + 1e-4;
        A[1][1] = mOverDt2 * mass + 1e-4;
        A[2][2] = mOverDt2 * mass + 1e-4;
        A[3][3] = mOverDt2 * i00 + 1e-4;
        A[4][4] = mOverDt2 * i11 + 1e-4;
        A[5][5] = mOverDt2 * i22 + 1e-4;
        b[0] = mOverDt2 * mass * dPosInertial.x;
        b[1] = mOverDt2 * mass * dPosInertial.y;
        b[2] = mOverDt2 * mass * dPosInertial.z;
        b[3] = mOverDt2 * (i00 * dThetaInertial.x);
        b[4] = mOverDt2 * (i11 * dThetaInertial.y);
        b[5] = mOverDt2 * (i22 * dThetaInertial.z);
`
      ) : (
        /* wgsl */
        `
        let base = gid * 3u;
        let invIWorld0 = derivedInvInertia[base + 0u];
        let invIWorld1 = derivedInvInertia[base + 1u];
        let invIWorld2 = derivedInvInertia[base + 2u];
        let invMass = invIWorld0.w;
        let initialBase = gid * 2u;
        let poseBase = gid * ${INERTIAL_POSE_VEC4S_PER_BODY2}u;
        let currentPose = inertialPose[poseBase + 2u];
        var pos = currentPose.xyz;
        var q = normalize(inertialPose[poseBase + 3u]);
        if (!(invMass > 0.0)) {
          bodySolveOutputPose[bodySolveOutputBase] = currentPose;
          bodySolveOutputPose[bodySolveOutputBase + 1u] = q;
          return;
        }
        let invIWorld = mat3x3f(
          vec3f(invIWorld0.x, invIWorld0.y, invIWorld0.z),
          vec3f(invIWorld0.y, invIWorld1.x, invIWorld1.y),
          vec3f(invIWorld0.z, invIWorld1.y, invIWorld2.x),
        );
        let localInvI = vec3f(
          max(invIWorld1.z, 1e-8),
          max(invIWorld1.w, 1e-8),
          max(invIWorld2.y, 1e-8),
        );

        let initialPos = initialPose[initialBase].xyz;
        let initialQ = normalize(initialPose[initialBase + 1u]);
        let inertialPos = inertialPose[poseBase].xyz;
        let inertialQ = normalize(inertialPose[poseBase + 1u]);

        let dqConstraintRaw = qmul(q, qconj(initialQ));
        let dqConstraint = select(dqConstraintRaw, -dqConstraintRaw, dqConstraintRaw.w < 0.0);
        let dThetaConstraint = 2.0 * dqConstraint.xyz;
        let dqInertialRaw = qmul(q, qconj(inertialQ));
        let dqInertial = select(dqInertialRaw, -dqInertialRaw, dqInertialRaw.w < 0.0);
        let dThetaInertial = 2.0 * dqInertial.xyz;
        let dPosInertial = pos - inertialPos;
        let dPosConstraint = pos - initialPos;

        var A: array<array<f32, 6>, 6>;
        var b: array<f32, 6>;
        for (var r = 0u; r < 6u; r++) {
          b[r] = 0.0;
          for (var c = 0u; c < 6u; c++) {
            A[r][c] = 0.0;
          }
        }

        let invDt2 = 1.0 / max(dt * dt, 1e-8);
        let mass = 1.0 / max(invMass, 1e-8);
        let mOverDt2 = inertialDiagWeight * invDt2;

        // Reconstruct world inertia tensor I_world from inv(I_world) and keep
        // it symmetric so the local 6x6 block stays close to SPD.
        let invICol0 = invIWorld[0];
        let invICol1 = invIWorld[1];
        let invICol2 = invIWorld[2];
        let cof0 = cross(invICol1, invICol2);
        let cof1 = cross(invICol2, invICol0);
        let cof2 = cross(invICol0, invICol1);
        let detInvI = dot(invICol0, cof0);
        let detOk = abs(detInvI) > 1e-10;

        let fallbackIx = 1.0 / max(abs(invICol0.x), 1e-8);
        let fallbackIy = 1.0 / max(abs(invICol1.y), 1e-8);
        let fallbackIz = 1.0 / max(abs(invICol2.z), 1e-8);
        let invDetInvI = select(0.0, 1.0 / detInvI, detOk);
        var inertiaCol0 = select(vec3f(fallbackIx, 0.0, 0.0), cof0 * invDetInvI, detOk);
        var inertiaCol1 = select(vec3f(0.0, fallbackIy, 0.0), cof1 * invDetInvI, detOk);
        var inertiaCol2 = select(vec3f(0.0, 0.0, fallbackIz), cof2 * invDetInvI, detOk);

        let useLocalDiag = useLocalDiagonalInertia > 0u;
        let localIx = 1.0 / localInvI.x;
        let localIy = 1.0 / localInvI.y;
        let localIz = 1.0 / localInvI.z;
        let i00 = select(max(inertiaCol0.x, 1e-8), localIx, useLocalDiag);
        let i11 = select(max(inertiaCol1.y, 1e-8), localIy, useLocalDiag);
        let i22 = select(max(inertiaCol2.z, 1e-8), localIz, useLocalDiag);
        let i01 = select(0.5 * (inertiaCol1.x + inertiaCol0.y), 0.0, useLocalDiag);
        let i02 = select(0.5 * (inertiaCol2.x + inertiaCol0.z), 0.0, useLocalDiag);
        let i12 = select(0.5 * (inertiaCol2.y + inertiaCol1.z), 0.0, useLocalDiag);

        A[0][0] = mOverDt2 * mass + 1e-4;
        A[1][1] = mOverDt2 * mass + 1e-4;
        A[2][2] = mOverDt2 * mass + 1e-4;
        A[3][3] = mOverDt2 * i00 + 1e-4;
        A[4][4] = mOverDt2 * i11 + 1e-4;
        A[5][5] = mOverDt2 * i22 + 1e-4;
        A[3][4] = mOverDt2 * i01;
        A[4][3] = A[3][4];
        A[3][5] = mOverDt2 * i02;
        A[5][3] = A[3][5];
        A[4][5] = mOverDt2 * i12;
        A[5][4] = A[4][5];
        b[0] = mOverDt2 * mass * dPosInertial.x;
        b[1] = mOverDt2 * mass * dPosInertial.y;
        b[2] = mOverDt2 * mass * dPosInertial.z;
        b[3] = mOverDt2 * (i00 * dThetaInertial.x + i01 * dThetaInertial.y + i02 * dThetaInertial.z);
        b[4] = mOverDt2 * (i01 * dThetaInertial.x + i11 * dThetaInertial.y + i12 * dThetaInertial.z);
        b[5] = mOverDt2 * (i02 * dThetaInertial.x + i12 * dThetaInertial.y + i22 * dThetaInertial.z);
`
      );
      return wgslFn(
        /* wgsl */
        `
      fn compute(
        initialPose: ptr<storage, array<vec4f>, read>,
        inertialPose: ptr<storage, array<vec4f>, read>,
        bodySolveOutputPose: ptr<storage, array<vec4f>, read_write>,
${inertiaParam}        bodyConstraintCounts: ptr<storage, array<u32>, read>,
        bodyConstraintRefs: ptr<storage, array<u32>, read>,
        pairContacts: ptr<storage, array<vec4f>, read_write>,
        jointRecords: ptr<storage, array<vec4f>, read_write>,
        springRecords: ptr<storage, array<vec4f>, read_write>,
        bodyCount: u32,
        bodyIndexBase: u32,
        dispatchBodyCount: u32,
        bodySolveMode: u32,
        currentColor: u32,
        sweepOffset: u32,
        regularizationAlpha: f32,
        tangentialRegularizationAlpha: f32,
        relaxation: f32,
        frictionRelaxation: f32,
        frictionStatic: f32,
        frictionDynamic: f32,
        useReferenceTangentialUpdate: u32,
        frictionSolveScale: f32,
        kStart: f32,
        dualForceMax: f32,
        enableNormalReleaseHeuristic: u32,
        enableHessianRescaling: u32,
        dt: f32,
        inertialDiagWeight: f32,
        maxLinearCorrection: f32,
        maxAngularCorrection: f32,
${localDiagonalUniformParam}        useNormalContactMargin: u32,
        useLocalContactArms: u32,
        alwaysStampNormalHessian: u32,
        alwaysStampTangentialHessian: u32,
        workgroupId: vec3u,
        localId: vec3u,
      ) -> void {
        let localIndex = workgroupId.x * ${WORKGROUP_SIZE3}u + localId.x;
        if (localIndex >= dispatchBodyCount) { return; }
        let gid = bodyIndexBase + localIndex;
        if (gid >= bodyCount) { return; }

        let countWord = bodyConstraintCounts[gid];
        let bodyColor = (countWord >> 16u) & 0xFFu;
        if (bodySolveMode == 0u && bodyColor != currentColor) { return; }
        let contactCount = min(countWord & 0xFFFFu, ${maxConstraintsPerBody}u);
        let bodySolveOutputBase = gid * 2u;

${inertiaSetup}

        let bodyBase = gid * ${maxConstraintsPerBody}u;
        for (var k = 0u; k < ${maxConstraintsPerBody}u; k++) {
          if (k >= contactCount) { break; }
          let contactIndex = (k + sweepOffset) % contactCount;
          let constraintRef = bodyConstraintRefs[bodyBase + contactIndex];
          let constraintTag = constraintRef & ${CONSTRAINT_REF_TAG_MASK}u;
          let constraintIndex = constraintRef & ${CONSTRAINT_REF_INDEX_MASK}u;
          if (constraintTag == ${CONSTRAINT_REF_TAG_JOINT}u) {
            let jointIndex = constraintIndex;
            if (jointIndex >= ${maxJoints}u) { continue; }
            let jointMeta = loadJointMetaWords(jointRecords, jointIndex);
            if (jointMeta.w == 0u) { continue; }
            let jointBodyA = jointMeta.x;
            let jointBodyB = jointMeta.y;
            let jointType = jointMeta.z;
            let isJointA = jointBodyA == gid;
            let isJointB = jointBodyB == gid;
            if (!isJointA && !isJointB) { continue; }

            let anchorA = loadJointAnchorA(jointRecords, jointIndex);
            let anchorB = loadJointAnchorB(jointRecords, jointIndex);
            let stiffness = loadJointStiffness(jointRecords, jointIndex);
            let penaltyLin = loadJointPenaltyLin(jointRecords, jointIndex).xyz;
            let penaltyAng = loadJointPenaltyAng(jointRecords, jointIndex).xyz;
            let lambdaLin = loadJointLambdaLin(jointRecords, jointIndex).xyz;
            let lambdaAng = loadJointLambdaAng(jointRecords, jointIndex).xyz;
            let c0Lin = loadJointC0Lin(jointRecords, jointIndex).xyz;
            let c0Ang = loadJointC0Ang(jointRecords, jointIndex).xyz;
            let torqueArm = max(anchorA.w, 1.0);

            var currentQA = vec4f(0.0, 0.0, 0.0, 1.0);
            var currentPosA = anchorA.xyz;
            if (jointBodyA != WORLD_BODY_INDEX) {
              currentQA = normalize(select(
                inertialPose[jointBodyA * ${INERTIAL_POSE_VEC4S_PER_BODY2}u + 3u],
                q,
                jointBodyA == gid,
              ));
              currentPosA = select(
                inertialPose[jointBodyA * ${INERTIAL_POSE_VEC4S_PER_BODY2}u + 2u].xyz,
                pos,
                jointBodyA == gid,
              );
            }
            let currentQB = normalize(select(
              inertialPose[jointBodyB * ${INERTIAL_POSE_VEC4S_PER_BODY2}u + 3u],
              q,
              jointBodyB == gid,
            ));
            let currentPosB = select(
              inertialPose[jointBodyB * ${INERTIAL_POSE_VEC4S_PER_BODY2}u + 2u].xyz,
              pos,
              jointBodyB == gid,
            );
            let rA = qrot(currentQA, anchorA.xyz);
            let rB = qrot(currentQB, anchorB.xyz);
            let worldAnchorA = jointWorldAnchor(jointBodyA, anchorA.xyz, currentPosA, currentQA);
            let worldAnchorB = currentPosB + rB;
            let rigidLinear = !isFiniteF32(stiffness.x);
            let linearConstraint = (worldAnchorA - worldAnchorB) - select(vec3f(0.0), c0Lin * regularizationAlpha, rigidLinear);
            let linearForce = penaltyLin * linearConstraint + lambdaLin;

            var linearRow0 = array<f32, 6>(0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
            var linearRow1 = array<f32, 6>(0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
            var linearRow2 = array<f32, 6>(0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
            if (isJointA) {
              linearRow0 = array<f32, 6>(1.0, 0.0, 0.0, 0.0, rA.z, -rA.y);
              linearRow1 = array<f32, 6>(0.0, 1.0, 0.0, -rA.z, 0.0, rA.x);
              linearRow2 = array<f32, 6>(0.0, 0.0, 1.0, rA.y, -rA.x, 0.0);
            } else {
              linearRow0 = array<f32, 6>(-1.0, 0.0, 0.0, 0.0, -rB.z, rB.y);
              linearRow1 = array<f32, 6>(0.0, -1.0, 0.0, rB.z, 0.0, -rB.x);
              linearRow2 = array<f32, 6>(0.0, 0.0, -1.0, -rB.y, rB.x, 0.0);
            }
            let linearSign = select(-1.0, 1.0, isJointA);
            addDiagonalVectorConstraint(&A, &b, linearRow0, linearRow1, linearRow2, penaltyLin, linearForce);
            let rGeom = select(-rB, rA, isJointA);
            let jointGeomDiag = jointBallSocketGeometricDiagonal(rGeom, linearForce);
            A[3][3] += jointGeomDiag.x;
            A[4][4] += jointGeomDiag.y;
            A[5][5] += jointGeomDiag.z;

            if (jointType == JOINT_TYPE_FIXED && stiffness.y > 0.0) {
              let rigidAngular = !isFiniteF32(stiffness.y);
              let angularConstraint = jointFixedAngularConstraint(jointBodyA, currentQA, currentQB, loadJointRestRelativeRotation(jointRecords, jointIndex), torqueArm) - select(vec3f(0.0), c0Ang * regularizationAlpha, rigidAngular);
              let angularForce = penaltyAng * angularConstraint + lambdaAng;
              let angularRow0 = array<f32, 6>(0.0, 0.0, 0.0, linearSign * torqueArm, 0.0, 0.0);
              let angularRow1 = array<f32, 6>(0.0, 0.0, 0.0, 0.0, linearSign * torqueArm, 0.0);
              let angularRow2 = array<f32, 6>(0.0, 0.0, 0.0, 0.0, 0.0, linearSign * torqueArm);
              addDiagonalVectorConstraint(&A, &b, angularRow0, angularRow1, angularRow2, penaltyAng, angularForce);
            }
            continue;
          }

          if (constraintTag == ${CONSTRAINT_REF_TAG_SPRING}u) {
            let springIndex = constraintIndex;
            if (springIndex >= ${maxSprings}u) { continue; }
            let springMeta = loadSpringMetaWords(springRecords, springIndex);
            if (springMeta.z == 0u) { continue; }
            let springBodyA = springMeta.x;
            let springBodyB = springMeta.y;
            let isSpringA = springBodyA == gid;
            let isSpringB = springBodyB == gid;
            if (!isSpringA && !isSpringB) { continue; }

            let anchorARest = loadSpringAnchorARest(springRecords, springIndex);
            let anchorBStiffness = loadSpringAnchorBStiffness(springRecords, springIndex);
            let restLength = max(anchorARest.w, 0.0);
            let springStiffness = max(anchorBStiffness.w, 0.0);
            if (springStiffness <= 0.0) { continue; }

            var currentSpringQA = vec4f(0.0, 0.0, 0.0, 1.0);
            var currentSpringPosA = anchorARest.xyz;
            if (springBodyA != WORLD_BODY_INDEX) {
              currentSpringQA = normalize(select(
                inertialPose[springBodyA * ${INERTIAL_POSE_VEC4S_PER_BODY2}u + 3u],
                q,
                springBodyA == gid,
              ));
              currentSpringPosA = select(
                inertialPose[springBodyA * ${INERTIAL_POSE_VEC4S_PER_BODY2}u + 2u].xyz,
                pos,
                springBodyA == gid,
              );
            }
            let currentSpringQB = normalize(select(
              inertialPose[springBodyB * ${INERTIAL_POSE_VEC4S_PER_BODY2}u + 3u],
              q,
              springBodyB == gid,
            ));
            let currentSpringPosB = select(
              inertialPose[springBodyB * ${INERTIAL_POSE_VEC4S_PER_BODY2}u + 2u].xyz,
              pos,
              springBodyB == gid,
            );
            let rSpringA = qrot(currentSpringQA, anchorARest.xyz);
            let rSpringB = qrot(currentSpringQB, anchorBStiffness.xyz);
            let worldSpringA = jointWorldAnchor(springBodyA, anchorARest.xyz, currentSpringPosA, currentSpringQA);
            let worldSpringB = currentSpringPosB + rSpringB;
            let springDelta = worldSpringA - worldSpringB;
            let springLength = length(springDelta);
            if (springLength <= 1e-6) { continue; }
            let springNormal = springDelta / springLength;
            let springConstraint = springLength - restLength;
            let springForce = springStiffness * springConstraint;
            let springJLin = select(-springNormal, springNormal, isSpringA);
            let springArm = select(rSpringB, rSpringA, isSpringA);
            let springJAng = select(-cross(springArm, springNormal), cross(springArm, springNormal), isSpringA);
            let springRow = array<f32, 6>(
              springJLin.x,
              springJLin.y,
              springJLin.z,
              springJAng.x,
              springJAng.y,
              springJAng.z,
            );
            addScalarConstraint(&A, &b, springRow, springStiffness, springForce);
            continue;
          }

          let p = constraintIndex;
          if (p >= ${maxPairContacts}u) { continue; }

          let n = loadContactNormalPen(pairContacts, p).xyz;
          if (dot(n, n) <= 1e-10) { continue; }

          let armA = loadContactArmA(pairContacts, p);
          let armB = loadContactArmB(pairContacts, p);
          let contactMeta = loadContactMeta(pairContacts, p);
          let i = u32(contactMeta.x + 0.5);
          let j = u32(contactMeta.y + 0.5);
          let isA = i == gid;
          let isB = j == gid;
          if (!isA && !isB) { continue; }
          let other = select(i, j, isA);
          if (other >= bodyCount || other == gid) { continue; }
          let raStored = armA.xyz;
          let rbStored = armB.xyz;
          let otherPoseBase = other * ${INERTIAL_POSE_VEC4S_PER_BODY2}u;
          let otherPos = inertialPose[otherPoseBase + 2u].xyz;
          let otherQ = normalize(inertialPose[otherPoseBase + 3u]);
          let otherInitialBase = other * 2u;
          let initialOtherPos = initialPose[otherInitialBase].xyz;
          let initialOtherQ = normalize(initialPose[otherInitialBase + 1u]);
          let currentQA = select(otherQ, q, isA);
          let currentQB = select(q, otherQ, isA);
          let initialQA = select(initialOtherQ, initialQ, isA);
          let initialQB = select(initialQ, initialOtherQ, isA);
          let localContactArms = useLocalContactArms > 0u;
          let ra = select(raStored, qrot(currentQA, raStored), localContactArms);
          let rb = select(rbStored, qrot(currentQB, rbStored), localContactArms);
          let dqOtherConstraintRaw = qmul(otherQ, qconj(initialOtherQ));
          let dqOtherConstraint = select(dqOtherConstraintRaw, -dqOtherConstraintRaw, dqOtherConstraintRaw.w < 0.0);
          let dThetaOtherConstraint = 2.0 * dqOtherConstraint.xyz;
          let dPosOtherConstraint = otherPos - initialOtherPos;

          let dPosA = select(dPosOtherConstraint, dPosConstraint, isA);
          let dPosB = select(dPosConstraint, dPosOtherConstraint, isA);
          let dThetaA = select(dThetaOtherConstraint, dThetaConstraint, isA);
          let dThetaB = select(dThetaConstraint, dThetaOtherConstraint, isA);

          let jAL = -n;
          let jBL = n;
          let jAA = -cross(ra, n);
          let jBA = cross(rb, n);

          let tangentBasis = tangentBasisFromAngle(n, armA.w);
          let t1 = tangentBasis.t1;
          let t2 = tangentBasis.t2;

          let penetration0 = max(loadContactNormalPen(pairContacts, p).w, 0.0);
          let cachedConstraintC0 = loadContactConstraintC0(pairContacts, p);
          let c0 = cachedConstraintC0.x;
          let cRegN = (1.0 - regularizationAlpha) * c0
            + dot(jAL, dPosA)
            + dot(jAA, dThetaA)
            + dot(jBL, dPosB)
            + dot(jBA, dThetaB);
          let c0T1 = cachedConstraintC0.y;
          let c0T2 = cachedConstraintC0.z;

          let contactState = loadContactStateHot(pairContacts, p, kStart);
          let dualState = contactState.dual;
          let dualN = clamp(dualState.x, -dualForceMax, 0.0);
          let penaltyN = max(contactState.penaltyN, kStart);
          let penaltyTBRaw = max(contactState.penalty.yz, vec2f(kStart));
          let contactFrictionScale = contactState.frictionScale;
          let frictionStaticLocal = frictionStatic * contactFrictionScale * frictionSolveScale;
          let frictionDynamicLocal = frictionDynamic * contactFrictionScale * frictionSolveScale;
          let useReferenceTangential = useReferenceTangentialUpdate > 0u;
          let penaltyTB = penaltyTBRaw;
          var dualTB = contactStateDualTB(
            contactState,
            n,
            t1,
            t2,
            select(0u, 1u, useReferenceTangential),
          );
          let prevTMag = length(dualTB);
          let staticBoundPrev = frictionStaticLocal * abs(dualN);
          let useStatic = prevTMag <= staticBoundPrev + 1e-6;

          let bodyR = select(rb, ra, isA);
          let sign = select(1.0, -1.0, isA);
          let jNLinear = sign * n;
          let jNAngular = sign * cross(bodyR, n);

          let lambdaLower = -dualForceMax;
          let lambdaPlusN = dualN + penaltyN * cRegN;
          var lambdaAppliedN = clamp(lambdaPlusN, lambdaLower, 0.0);
          let normalSupportThreshold = 1e-6;
          let normalReleaseTolerance = max(2e-5, 1.25 * penetration0);
          let normalReleaseDecayNear = 0.85;
          let normalReleaseDecayFar = 0.6;
          let normalReleaseMinSupport = -5e-4;
          if (
            enableNormalReleaseHeuristic > 0u &&
            penetration0 > 1e-6
            && dualN < -normalSupportThreshold
            && cRegN > 0.0
            && -lambdaAppliedN <= normalSupportThreshold
          ) {
            let releaseDecay = select(normalReleaseDecayFar, normalReleaseDecayNear, cRegN <= normalReleaseTolerance);
            lambdaAppliedN = min(dualN * releaseDecay, normalReleaseMinSupport);
          }
          let frictionSeparationTolerance = normalReleaseTolerance;
          let frictionOffSeparation = -lambdaAppliedN <= normalSupportThreshold
            || (enableNormalReleaseHeuristic > 0u && cRegN > frictionSeparationTolerance);
          if (lambdaAppliedN < -1e-9 || alwaysStampNormalHessian > 0u) {
            var kHessN = penaltyN;
            if (
              lambdaAppliedN < -1e-9 &&
              enableHessianRescaling > 0u
              && abs(lambdaAppliedN - lambdaPlusN) > 1e-8
              && abs(cRegN) > 1e-8
            ) {
              // Eq.14-style stiffness rescaling for clamped multipliers.
              kHessN = max(abs((lambdaAppliedN - dualN) / cRegN), 1e-6);
            }
            var jNRhs: array<f32, 6>;
            jNRhs[0] = jNLinear.x; jNRhs[1] = jNLinear.y; jNRhs[2] = jNLinear.z;
            jNRhs[3] = jNAngular.x; jNRhs[4] = jNAngular.y; jNRhs[5] = jNAngular.z;
            var jNHess: array<f32, 6>;
            jNHess[0] = jNLinear.x; jNHess[1] = jNLinear.y; jNHess[2] = jNLinear.z;
            jNHess[3] = jNAngular.x; jNHess[4] = jNAngular.y; jNHess[5] = jNAngular.z;
            for (var r = 0u; r < 6u; r++) {
              b[r] += jNRhs[r] * lambdaAppliedN;
              for (var c = 0u; c < 6u; c++) {
                A[r][c] += kHessN * jNHess[r] * jNHess[c];
              }
            }
          }

          if (frictionStaticLocal > 1e-8 || frictionDynamicLocal > 1e-8) {
            let stampTangentialOnSeparating = frictionOffSeparation && alwaysStampTangentialHessian > 0u;
            // Default AVBD friction policy skips tangential rows when the
            // contact is separating. The full-hessian experiment keeps the
            // tangential stiffness in A while still clamping the RHS to zero.
            if (!useReferenceTangential && frictionOffSeparation && !stampTangentialOnSeparating) {
              continue;
            }
            if (useReferenceTangential && lambdaAppliedN >= -1e-9 && alwaysStampTangentialHessian == 0u) {
              continue;
            }
            let jt1AL = -t1;
            let jt1BL = t1;
            let jt1AA = -cross(ra, t1);
            let jt1BA = cross(rb, t1);
            let cRegT1 = (1.0 - tangentialRegularizationAlpha) * c0T1
              + dot(jt1AL, dPosA)
              + dot(jt1AA, dThetaA)
              + dot(jt1BL, dPosB)
              + dot(jt1BA, dThetaB);
            let jT1Linear = sign * t1;
            let jT1Angular = sign * cross(bodyR, t1);
            var jT1: array<f32, 6>;
            jT1[0] = jT1Linear.x; jT1[1] = jT1Linear.y; jT1[2] = jT1Linear.z;
            jT1[3] = jT1Angular.x; jT1[4] = jT1Angular.y; jT1[5] = jT1Angular.z;

            let jt2AL = -t2;
            let jt2BL = t2;
            let jt2AA = -cross(ra, t2);
            let jt2BA = cross(rb, t2);
            let cRegT2 = (1.0 - tangentialRegularizationAlpha) * c0T2
              + dot(jt2AL, dPosA)
              + dot(jt2AA, dThetaA)
              + dot(jt2BL, dPosB)
              + dot(jt2BA, dThetaB);
            // Couple tangential rows with a conical clamp in (t1,t2) space.
            // Independent axis clamps allow sqrt(2) overshoot and can cause
            // lateral breakout in stacked contacts.
            let lambdaPlusTB = vec2f(
              penaltyTB.x * cRegT1 + dualTB.x,
              penaltyTB.y * cRegT2 + dualTB.y,
            );
            var lambdaAppliedTB = lambdaPlusTB;
            var wT1 = penaltyTB.x * frictionRelaxation;
            var wT2 = penaltyTB.y * frictionRelaxation;
            if (useReferenceTangential) {
              let referenceBound = frictionStaticLocal * max(-lambdaAppliedN, 0.0);
              let lambdaAppliedTBLen2 = dot(lambdaAppliedTB, lambdaAppliedTB);
              if (lambdaAppliedTBLen2 > referenceBound * referenceBound && lambdaAppliedTBLen2 > 1e-12) {
                lambdaAppliedTB *= referenceBound * inverseSqrt(lambdaAppliedTBLen2);
              }
              if (referenceBound <= 1e-6) {
                lambdaAppliedTB = vec2f(0.0);
              }
            } else {
              // AVBD friction policy:
              // start in static mode only when previous dual was inside static cone.
              // if this iteration violates static cone, switch to dynamic cone.
              // In the primal stage, keep tangential bounds on the previous normal
              // dual state for this contact iteration. This matches the 2D reference
              // structure where tangential bounds are derived from persisted lambda_n
              // (updated in dual/capture), not from the row-local normal projection.
              let frictionSupportN = select(max(dualN, lambdaAppliedN), 0.0, stampTangentialOnSeparating);
              let staticBound = frictionStaticLocal * max(-frictionSupportN, 0.0);
              let dynamicBound = frictionDynamicLocal * max(-frictionSupportN, 0.0);
              let lambdaPlusTBlen2 = dot(lambdaAppliedTB, lambdaAppliedTB);
              var frictionBound = select(dynamicBound, staticBound, useStatic);
              if (useStatic && lambdaPlusTBlen2 > staticBound * staticBound + 1e-12) {
                frictionBound = dynamicBound;
              }
              frictionBound = max(frictionBound, 0.0);

              let lambdaAppliedTBLen2 = dot(lambdaAppliedTB, lambdaAppliedTB);
              if (lambdaAppliedTBLen2 > frictionBound * frictionBound && lambdaAppliedTBLen2 > 1e-12) {
                lambdaAppliedTB *= frictionBound * inverseSqrt(lambdaAppliedTBLen2);
              }
              // Eq.14-style tangential stiffness rescaling when cone projection
              // clamps the unconstrained lambda update.
              if (
                !stampTangentialOnSeparating &&
                enableHessianRescaling > 0u
                && abs(lambdaAppliedTB.x - lambdaPlusTB.x) > 1e-8
                && abs(cRegT1) > 1e-8
              ) {
                wT1 = max(abs((lambdaAppliedTB.x - dualTB.x) / cRegT1), 1e-6) * frictionRelaxation;
              }
              if (
                !stampTangentialOnSeparating &&
                enableHessianRescaling > 0u
                && abs(lambdaAppliedTB.y - lambdaPlusTB.y) > 1e-8
                && abs(cRegT2) > 1e-8
              ) {
                wT2 = max(abs((lambdaAppliedTB.y - dualTB.y) / cRegT2), 1e-6) * frictionRelaxation;
              }
            }
            let lambdaAppliedT1 = lambdaAppliedTB.x;
            let lambdaAppliedT2 = lambdaAppliedTB.y;

            let jT2Linear = sign * t2;
            let jT2Angular = sign * cross(bodyR, t2);
            var jT2: array<f32, 6>;
            jT2[0] = jT2Linear.x; jT2[1] = jT2Linear.y; jT2[2] = jT2Linear.z;
            jT2[3] = jT2Angular.x; jT2[4] = jT2Angular.y; jT2[5] = jT2Angular.z;
            for (var r = 0u; r < 6u; r++) {
              b[r] += jT1[r] * lambdaAppliedT1;
              for (var c = 0u; c < 6u; c++) {
                A[r][c] += wT1 * jT1[r] * jT1[c];
              }
            }
            for (var r = 0u; r < 6u; r++) {
              b[r] += jT2[r] * lambdaAppliedT2;
              for (var c = 0u; c < 6u; c++) {
                A[r][c] += wT2 * jT2[r] * jT2[c];
              }
            }
          }
        }

        // Re-symmetrize before solve to reduce drift from accumulation order.
        for (var r = 0u; r < 6u; r++) {
          for (var c = r + 1u; c < 6u; c++) {
            let s = 0.5 * (A[r][c] + A[c][r]);
            A[r][c] = s;
            A[c][r] = s;
          }
          A[r][r] = max(A[r][r], 1e-6);
        }

        // SPD-focused LDL^T factorization with diagonal regularization fallback.
        var L: array<array<f32, 6>, 6>;
        var D: array<f32, 6>;
        for (var r = 0u; r < 6u; r++) {
          D[r] = 0.0;
          for (var c = 0u; c < 6u; c++) {
            L[r][c] = 0.0;
          }
        }

        for (var i = 0u; i < 6u; i++) {
          for (var j = 0u; j < i; j++) {
            var sumL = A[i][j];
            for (var k = 0u; k < j; k++) {
              sumL -= L[i][k] * D[k] * L[j][k];
            }
            let d = select(1e-6, D[j], abs(D[j]) > 1e-6);
            L[i][j] = sumL / d;
          }

          var diag = A[i][i];
          for (var k = 0u; k < i; k++) {
            diag -= L[i][k] * L[i][k] * D[k];
          }
          D[i] = max(diag, 1e-6);
          L[i][i] = 1.0;
        }

        var y: array<f32, 6>;
        for (var i = 0u; i < 6u; i++) {
          var sumF = b[i];
          for (var k = 0u; k < i; k++) {
            sumF -= L[i][k] * y[k];
          }
          y[i] = sumF;
        }

        var z: array<f32, 6>;
        for (var i = 0u; i < 6u; i++) {
          z[i] = y[i] / D[i];
        }

        var x: array<f32, 6>;
        for (var i = 0u; i < 6u; i++) { x[i] = 0.0; }
        for (var rev = 0u; rev < 6u; rev++) {
          let row = 5u - rev;
          var sumB = z[row];
          for (var c = row + 1u; c < 6u; c++) {
            sumB -= L[c][row] * x[c];
          }
          x[row] = sumB;
        }

        var dPosSolve = vec3f(x[0], x[1], x[2]);
        var dThetaSolve = vec3f(x[3], x[4], x[5]);
        let linLen2 = dot(dPosSolve, dPosSolve);
        if (linLen2 > maxLinearCorrection * maxLinearCorrection && linLen2 > 1e-12) {
          dPosSolve *= maxLinearCorrection * inverseSqrt(linLen2);
        }
        let angLen2 = dot(dThetaSolve, dThetaSolve);
        if (angLen2 > maxAngularCorrection * maxAngularCorrection && angLen2 > 1e-12) {
          dThetaSolve *= maxAngularCorrection * inverseSqrt(angLen2);
        }

        let appliedDPos = -dPosSolve * relaxation;
        let appliedDTheta = -dThetaSolve * relaxation;
        pos += appliedDPos;
        q = normalize(q + 0.5 * qmul(vec4f(appliedDTheta, 0.0), q));

        bodySolveOutputPose[bodySolveOutputBase] = vec4f(pos, currentPose.w);
        bodySolveOutputPose[bodySolveOutputBase + 1u] = q;
      }
    `,
        [qrot, qmul, qconj, tangentBasisHelpers2, contactRecordHelpers, contactStateHelpers, jointRecordHelpers, springRecordHelpers, jointConstraintHelpers]
      );
    };
    const primalBodySolveStorageBuffers = 9;
    assertStorageBufferBudget("AVBD Body Primal Solve", primalBodySolveStorageBuffers);
    const primalBodySolveShaderGeneric = makePrimalBodySolveShader("generic");
    const primalBodySolveShaderLocalDiag = makePrimalBodySolveShader("localDiag");
    this.primalBodySolveKernelGeneric = primalBodySolveShaderGeneric({
      initialPose: storage(initialPose, "vec4f", maxBodies * 2).toReadOnly(),
      inertialPose: storage(inertialPose, "vec4f", maxBodies * INERTIAL_POSE_VEC4S_PER_BODY2).toReadOnly(),
      bodySolveOutputPose: storage(this.bodySolveOutputPoseAttr, "vec4f", maxBodies * 2),
      derivedInvInertia: storage(derivedInvInertia, "vec4f", maxBodies * 3).toReadOnly(),
      bodyConstraintCounts: storage(bodyConstraintCounts, "uint", maxBodies).toReadOnly(),
      bodyConstraintRefs: storage(bodyConstraintRefs, "uint", maxBodies * maxConstraintsPerBody).toReadOnly(),
      pairContacts: storage(pairContacts, "vec4f", maxPairContacts * CONTACT_RECORD_VEC4S),
      jointRecords: storage(jointRecords, "vec4f", maxJoints * JOINT_RECORD_VEC4S),
      springRecords: storage(springRecords, "vec4f", maxSprings * SPRING_RECORD_VEC4S),
      bodyCount: uniform(0),
      bodyIndexBase: uniform(0),
      dispatchBodyCount: uniform(0),
      bodySolveMode: uniform(0),
      currentColor: uniform(0),
      sweepOffset: uniform(0),
      regularizationAlpha: uniform(AVBD_REGULARIZATION_ALPHA_DEFAULT),
      tangentialRegularizationAlpha: uniform(AVBD_REGULARIZATION_ALPHA_DEFAULT),
      relaxation: uniform(1),
      // Keep tangential rows numerically consistent with clamped-force RHS.
      // The 2D AVBD reference effectively uses 1.0 here.
      frictionRelaxation: uniform(1),
      frictionStatic: uniform(AVBD_FRICTION_STATIC),
      frictionDynamic: uniform(AVBD_FRICTION_DYNAMIC),
      useReferenceTangentialUpdate: uniform(1),
      frictionSolveScale: uniform(1),
      kStart: uniform(AVBD_K_START),
      dualForceMax: uniform(1e10),
      enableNormalReleaseHeuristic: uniform(0),
      enableHessianRescaling: uniform(0),
      dt: uniform(1 / 60 / 4),
      inertialDiagWeight: uniform(1),
      maxLinearCorrection: uniform(1e9),
      maxAngularCorrection: uniform(1e9),
      useLocalDiagonalInertia: uniform(1),
      useNormalContactMargin: uniform(1),
      useLocalContactArms: uniform(1),
      alwaysStampNormalHessian: uniform(1),
      alwaysStampTangentialHessian: uniform(0),
      workgroupId,
      localId
    }).computeKernel([WORKGROUP_SIZE3, 1, 1]).setName("AVBD Body Primal Solve Generic");
    this.primalBodySolveKernelLocalDiag = primalBodySolveShaderLocalDiag({
      initialPose: storage(initialPose, "vec4f", maxBodies * 2).toReadOnly(),
      inertialPose: storage(inertialPose, "vec4f", maxBodies * INERTIAL_POSE_VEC4S_PER_BODY2).toReadOnly(),
      bodySolveOutputPose: storage(this.bodySolveOutputPoseAttr, "vec4f", maxBodies * 2),
      inverseInertia: storage(inverseInertia, "vec4f", maxBodies).toReadOnly(),
      bodyConstraintCounts: storage(bodyConstraintCounts, "uint", maxBodies).toReadOnly(),
      bodyConstraintRefs: storage(bodyConstraintRefs, "uint", maxBodies * maxConstraintsPerBody).toReadOnly(),
      pairContacts: storage(pairContacts, "vec4f", maxPairContacts * CONTACT_RECORD_VEC4S),
      jointRecords: storage(jointRecords, "vec4f", maxJoints * JOINT_RECORD_VEC4S),
      springRecords: storage(springRecords, "vec4f", maxSprings * SPRING_RECORD_VEC4S),
      bodyCount: uniform(0),
      bodyIndexBase: uniform(0),
      dispatchBodyCount: uniform(0),
      bodySolveMode: uniform(0),
      currentColor: uniform(0),
      sweepOffset: uniform(0),
      regularizationAlpha: uniform(AVBD_REGULARIZATION_ALPHA_DEFAULT),
      tangentialRegularizationAlpha: uniform(AVBD_REGULARIZATION_ALPHA_DEFAULT),
      relaxation: uniform(1),
      frictionRelaxation: uniform(1),
      frictionStatic: uniform(AVBD_FRICTION_STATIC),
      frictionDynamic: uniform(AVBD_FRICTION_DYNAMIC),
      useReferenceTangentialUpdate: uniform(1),
      frictionSolveScale: uniform(1),
      kStart: uniform(AVBD_K_START),
      dualForceMax: uniform(1e10),
      enableNormalReleaseHeuristic: uniform(0),
      enableHessianRescaling: uniform(0),
      dt: uniform(1 / 60 / 4),
      inertialDiagWeight: uniform(1),
      maxLinearCorrection: uniform(1e9),
      maxAngularCorrection: uniform(1e9),
      useNormalContactMargin: uniform(1),
      useLocalContactArms: uniform(1),
      alwaysStampNormalHessian: uniform(1),
      alwaysStampTangentialHessian: uniform(0),
      workgroupId,
      localId
    }).computeKernel([WORKGROUP_SIZE3, 1, 1]).setName("AVBD Body Primal Solve Local Diag");
    this.primalBodySolveKernel = this.useLocalDiagonalPrimalSolveFastPath ? this.primalBodySolveKernelLocalDiag : this.primalBodySolveKernelGeneric;
    const commitBodySolveShader = wgslFn(
      /* wgsl */
      `
      fn compute(
        bodyConstraintCounts: ptr<storage, array<u32>, read>,
        bodySolveOutputPose: ptr<storage, array<vec4f>, read>,
        inertialPose: ptr<storage, array<vec4f>, read_write>,
        bodyCount: u32,
        bodyIndexBase: u32,
        dispatchBodyCount: u32,
        bodySolveMode: u32,
        currentColor: u32,
        workgroupId: vec3u,
        localId: vec3u,
      ) -> void {
        let localIndex = workgroupId.x * ${WORKGROUP_SIZE3}u + localId.x;
        if (localIndex >= dispatchBodyCount) { return; }
        let gid = bodyIndexBase + localIndex;
        if (gid >= bodyCount) { return; }

        let countWord = bodyConstraintCounts[gid];
        let bodyColor = (countWord >> 16u) & 0xFFu;
        if (bodySolveMode == 0u && bodyColor != currentColor) { return; }

        let outputBase = gid * 2u;
        let poseBase = gid * ${INERTIAL_POSE_VEC4S_PER_BODY2}u;
        inertialPose[poseBase + 2u] = bodySolveOutputPose[outputBase];
        inertialPose[poseBase + 3u] = normalize(bodySolveOutputPose[outputBase + 1u]);
      }
    `
    );
    this.commitBodySolveKernel = commitBodySolveShader({
      bodyConstraintCounts: storage(bodyConstraintCounts, "uint", maxBodies).toReadOnly(),
      bodySolveOutputPose: storage(this.bodySolveOutputPoseAttr, "vec4f", maxBodies * 2).toReadOnly(),
      inertialPose: storage(inertialPose, "vec4f", maxBodies * INERTIAL_POSE_VEC4S_PER_BODY2),
      bodyCount: uniform(0),
      bodyIndexBase: uniform(0),
      dispatchBodyCount: uniform(0),
      bodySolveMode: uniform(0),
      currentColor: uniform(0),
      workgroupId,
      localId
    }).computeKernel([WORKGROUP_SIZE3, 1, 1]).setName("AVBD Commit Body Solve");
    assertStorageBufferBudget("AVBD Commit Body Solve", 3);
    const capturePairDualStateShader = wgslFn(
      /* wgsl */
      `
      fn compute(
        inertialPose: ptr<storage, array<vec4f>, read>,
        initialPose: ptr<storage, array<vec4f>, read>,
        pairContacts: ptr<storage, array<vec4f>, read_write>,
        pairActivity: ptr<storage, array<u32>, read_write>,
        pairDispatchCount: u32,
        regularizationAlpha: f32,
        beta: f32,
        frictionStatic: f32,
        frictionDynamic: f32,
        kStart: f32,
        kMax: f32,
        lambdaMax: f32,
        preventPenetratingNormalDropout: u32,
        enableNormalReleaseHeuristic: u32,
        freezeTangentialPenaltyOnStick: u32,
        freezeTangentialPenaltyUpdates: u32,
        useIsotropicTangentialPenaltyOnStick: u32,
        rampTangentialPenaltyOnlyWhenNotSticking: u32,
        useReferenceTangentialUpdate: u32,
        stickExitThreshold: f32,
        tangentialPenaltyRampDeadzone: f32,
        tangentialPenaltySlipRampMaxDelta: f32,
        tangentialPenaltyCapScale: f32,
        useNormalContactMargin: u32,
        useLocalContactArms: u32,
        dt: f32,
        workgroupId: vec3u,
        localId: vec3u,
      ) -> void {
        let gid = workgroupId.x * ${WORKGROUP_SIZE3}u + localId.x;
        let activeCount = min(min(pairActivity[${pairActiveContactsOffset}u], pairDispatchCount), ${maxActivePairContacts}u);
        if (gid >= activeCount) { return; }

        let p = pairActivity[${pairActiveContactsOffset}u + gid + 1u];
        if (p >= ${maxPairContacts}u) { return; }
        let prevContactStateSeed = loadContactStateHot(pairContacts, p, kStart);

        let n = loadContactNormalPen(pairContacts, p).xyz;
        if (dot(n, n) <= 1e-10) {
          storeContactRecord(
            pairContacts,
            p,
            vec4f(0.0),
            kStart,
            vec2f(kStart),
            0.0,
            vec2f(0.0),
            prevContactStateSeed.frictionScale,
            kStart,
          );
          return;
        }

        let contactMeta = loadContactMeta(pairContacts, p);
        let i = u32(contactMeta.x + 0.5);
        let j = u32(contactMeta.y + 0.5);
        if (i >= ${maxBodies}u || j >= ${maxBodies}u || i == j) {
          storeContactRecord(
            pairContacts,
            p,
            vec4f(0.0),
            kStart,
            vec2f(kStart),
            0.0,
            vec2f(0.0),
            prevContactStateSeed.frictionScale,
            kStart,
          );
          return;
        }

        let penetration0 = max(loadContactNormalPen(pairContacts, p).w, 0.0);
        let armA = loadContactArmA(pairContacts, p);
        let armB = loadContactArmB(pairContacts, p);
        let raStored = armA.xyz;
        let rbStored = armB.xyz;

        let solvePoseBaseA = i * ${INERTIAL_POSE_VEC4S_PER_BODY2}u;
        let solvePoseBaseB = j * ${INERTIAL_POSE_VEC4S_PER_BODY2}u;
        let posA = inertialPose[solvePoseBaseA + 2u].xyz;
        let posB = inertialPose[solvePoseBaseB + 2u].xyz;
        let qA = normalize(inertialPose[solvePoseBaseA + 3u]);
        let qB = normalize(inertialPose[solvePoseBaseB + 3u]);
        let poseBaseA = i * 2u;
        let poseBaseB = j * 2u;
        let prevPosA = initialPose[poseBaseA].xyz;
        let prevPosB = initialPose[poseBaseB].xyz;
        let prevQA = normalize(initialPose[poseBaseA + 1u]);
        let prevQB = normalize(initialPose[poseBaseB + 1u]);
        let localContactArms = useLocalContactArms > 0u;
        let ra = select(raStored, qrot(qA, raStored), localContactArms);
        let rb = select(rbStored, qrot(qB, rbStored), localContactArms);

        let dqAraw = qmul(qA, qconj(prevQA));
        let dqBraw = qmul(qB, qconj(prevQB));
        let dqA = select(dqAraw, -dqAraw, dqAraw.w < 0.0);
        let dqB = select(dqBraw, -dqBraw, dqBraw.w < 0.0);
        let dThetaA = 2.0 * dqA.xyz;
        let dThetaB = 2.0 * dqB.xyz;

        let dPosA = posA - prevPosA;
        let dPosB = posB - prevPosB;

        let jAL = -n;
        let jBL = n;
        let jAA = -cross(ra, n);
        let jBA = cross(rb, n);

        let tangentBasis = tangentBasisFromAngle(n, armA.w);
        let t1 = tangentBasis.t1;
        let t2 = tangentBasis.t2;

        let jt1AL = -t1;
        let jt1BL = t1;
        let jt1AA = -cross(ra, t1);
        let jt1BA = cross(rb, t1);

        let jt2AL = -t2;
        let jt2BL = t2;
        let jt2AA = -cross(ra, t2);
        let jt2BA = cross(rb, t2);

        let cachedConstraintC0 = loadContactConstraintC0(pairContacts, p);
        let c0 = cachedConstraintC0.x;
        let cRegN = (1.0 - regularizationAlpha) * c0
          + dot(jAL, dPosA)
          + dot(jAA, dThetaA)
          + dot(jBL, dPosB)
          + dot(jBA, dThetaB);
        let c0T1 = cachedConstraintC0.y;
        let c0T2 = cachedConstraintC0.z;
        let cRegT1 = (1.0 - regularizationAlpha) * c0T1
          + dot(jt1AL, dPosA)
          + dot(jt1AA, dThetaA)
          + dot(jt1BL, dPosB)
          + dot(jt1BA, dThetaB);
        let cRegT2 = (1.0 - regularizationAlpha) * c0T2
          + dot(jt2AL, dPosA)
          + dot(jt2AA, dThetaA)
          + dot(jt2BL, dPosB)
          + dot(jt2BA, dThetaB);
        let currentPointA = posA + ra;
        let currentPointB = posB + rb;
        let currentGap = -dot(currentPointA - currentPointB, n);
        let rawPenetration = -currentGap;
        let normalReleaseTolerance = max(2e-5, 1.25 * penetration0);
        let normalReleaseDecayNear = 0.85;
        let normalReleaseDecayFar = 0.6;
        let normalReleaseMinSupport = -5e-4;
        let normalSupportThreshold = 1e-6;
        let frictionSeparationTolerance = normalReleaseTolerance;
        let encodedMeta = bitcast<u32>(loadContactMeta(pairContacts, p).w);
        let featureKey = encodedMeta & 0x1FFu;
        let cooldown = (encodedMeta >> 9u) & 0x7Fu;
        let preserveWarmstart = (encodedMeta >> 16u) & 0x1u;
        let warmstartDebugReason = (encodedMeta >> 21u) & 0x7u;
        let prevStick = ((encodedMeta >> 17u) & 0x1u) != 0u;
        let stickAnchorReuse = (encodedMeta >> 18u) & 0x1u;

        let prevContactState = prevContactStateSeed;
        let prevDual = prevContactState.dual;
        let prevDualN = min(prevDual.x, 0.0);
        let prevDualTWorldRaw = prevDual.yzw;
        let prevDualTWorld = prevDualTWorldRaw - n * dot(prevDualTWorldRaw, n);
        let prevDualTB = select(
          vec2f(dot(prevDualTWorld, t1), dot(prevDualTWorld, t2)),
          prevDual.yz,
          useReferenceTangentialUpdate > 0u,
        );
        let prevPenalty = prevContactState.penalty;
        let prevPenaltyN = clamp(prevContactState.penaltyN, kStart, kMax);
        let prevPenaltyTBRaw = clamp(max(prevPenalty.yz, vec2f(kStart)), vec2f(kStart), vec2f(kMax));
        let prevPenaltyTB = prevPenaltyTBRaw;
        let frictionScale = prevContactState.frictionScale;
        let frictionStaticLocal = frictionStatic * frictionScale;
        let frictionDynamicLocal = frictionDynamic * frictionScale;
        var dualN = clamp(prevDualN + prevPenaltyN * cRegN, -lambdaMax, 0.0);
        // Diagnostic A/B: do not let the raw dual clamp drop all normal support
        // while the row is still geometrically penetrating.
        if (
          preventPenetratingNormalDropout > 0u
          && rawPenetration > 0.0
          && prevDualN < -normalSupportThreshold
          && dualN > -normalSupportThreshold
        ) {
          dualN = prevDualN;
        }
        if (
          enableNormalReleaseHeuristic > 0u &&
          penetration0 > 1e-6
          && prevDualN < -normalSupportThreshold
          && cRegN > 0.0
          && dualN > -normalSupportThreshold
        ) {
          let releaseDecay = select(normalReleaseDecayFar, normalReleaseDecayNear, cRegN <= normalReleaseTolerance);
          dualN = min(prevDualN * releaseDecay, normalReleaseMinSupport);
        }

        let prevTMag = length(prevDualTB);
        let staticBoundPrev = frictionStaticLocal * abs(prevDualN);
        let useStatic = prevTMag <= staticBoundPrev + 1e-6;
        let lambdaPlusTB = vec2f(
          prevDualTB.x + prevPenaltyTB.x * cRegT1,
          prevDualTB.y + prevPenaltyTB.y * cRegT2,
        );
        let frictionSupportN = max(prevDualN, dualN);
        let staticBound = frictionStaticLocal * max(-frictionSupportN, 0.0);
        let dynamicBound = frictionDynamicLocal * max(-frictionSupportN, 0.0);
        let lambdaPlusTBlen2 = dot(lambdaPlusTB, lambdaPlusTB);
        let noNormalSupportNow = dualN > -normalSupportThreshold;
        var penaltyN = prevPenaltyN;
        if (dualN < 0.0 && dualN > -lambdaMax) {
          penaltyN = clamp(prevPenaltyN + beta * abs(cRegN), kStart, kMax);
        }
        let tangentialError = length(vec2f(cRegT1, cRegT2));
        var penaltyTB = prevPenaltyTB;
        var dualTB = lambdaPlusTB;
        var stick = false;
        var tangentialInsideCone = false;
        var tangentialRampHappened = false;
        let freezeAllTangentialPenaltyUpdates = freezeTangentialPenaltyUpdates > 0u;
        if (useReferenceTangentialUpdate > 0u) {
          let referenceBound = frictionStaticLocal * max(-dualN, 0.0);
          let dualTBLen2 = dot(dualTB, dualTB);
          if (dualTBLen2 > referenceBound * referenceBound && dualTBLen2 > 1e-12) {
            dualTB *= referenceBound * inverseSqrt(dualTBLen2);
          }
          if (dualN >= 0.0 || referenceBound <= 1e-6) {
            dualTB = vec2f(0.0);
          }
          let tangentialClamped1 = abs(dualTB.x - lambdaPlusTB.x) > 1e-5;
          let tangentialClamped2 = abs(dualTB.y - lambdaPlusTB.y) > 1e-5;
          tangentialInsideCone = !tangentialClamped1 && !tangentialClamped2 && referenceBound > 1e-6;
          if (dualN < 0.0) {
            if (!freezeAllTangentialPenaltyUpdates) {
              let updatedPenaltyTB = min(
                prevPenaltyTB + beta * abs(vec2f(cRegT1, cRegT2)),
                vec2f(kMax),
              );
              penaltyTB = vec2f(
                select(updatedPenaltyTB.x, prevPenaltyTB.x, tangentialClamped1),
                select(updatedPenaltyTB.y, prevPenaltyTB.y, tangentialClamped2),
              );
              tangentialRampHappened = abs(penaltyTB.x - prevPenaltyTB.x) > 1e-6
                || abs(penaltyTB.y - prevPenaltyTB.y) > 1e-6;
            }
            stick = tangentialInsideCone && tangentialError < ${AVBD_STICK_THRESHOLD};
          } else {
            stick = false;
          }
        } else {
          var frictionBound = select(dynamicBound, staticBound, useStatic);
          if (useStatic && lambdaPlusTBlen2 > staticBound * staticBound + 1e-12) {
            frictionBound = dynamicBound;
          }
          frictionBound = max(frictionBound, 0.0);

          let dualTBLen2 = dot(dualTB, dualTB);
          if (dualTBLen2 > frictionBound * frictionBound && dualTBLen2 > 1e-12) {
            if (dualTBLen2 > frictionBound * frictionBound) {
              dualTB *= frictionBound * inverseSqrt(dualTBLen2);
            }
          }
          // If the normal row has no support (or contact is separating), drop
          // tangential memory so friction does not persist without contact.
          if (noNormalSupportNow || (enableNormalReleaseHeuristic > 0u && cRegN > frictionSeparationTolerance)) {
            dualTB = vec2f(0.0);
          }
          let stickThreshold = select(
            ${AVBD_STICK_THRESHOLD},
            max(stickExitThreshold, ${AVBD_STICK_THRESHOLD}),
            prevStick,
          );
          let insideStaticCone = staticBound > 1e-6
            && lambdaPlusTBlen2 <= staticBound * staticBound + 1e-12
            && !noNormalSupportNow;
          stick = insideStaticCone && tangentialError < stickThreshold;
          let freezeTangentialPenalty = freezeTangentialPenaltyOnStick > 0u && stick;
          let isInteriorCone = frictionBound > 1e-6
            && lambdaPlusTBlen2 < frictionBound * frictionBound - 1e-8;
          tangentialInsideCone = isInteriorCone;
          let tangentialRampActive = tangentialError > tangentialPenaltyRampDeadzone;
          let allowTangentialRamp = !freezeAllTangentialPenaltyUpdates
            && !freezeTangentialPenalty
            && (rampTangentialPenaltyOnlyWhenNotSticking == 0u || !stick);
          if (isInteriorCone && tangentialRampActive && allowTangentialRamp) {
            var tangentialRampT1 = beta * abs(cRegT1);
            var tangentialRampT2 = beta * abs(cRegT2);
            if (tangentialPenaltySlipRampMaxDelta > 0.0) {
              tangentialRampT1 = min(tangentialRampT1, tangentialPenaltySlipRampMaxDelta);
              tangentialRampT2 = min(tangentialRampT2, tangentialPenaltySlipRampMaxDelta);
            }
            penaltyTB.x = clamp(prevPenaltyTB.x + tangentialRampT1, kStart, kMax);
            penaltyTB.y = clamp(prevPenaltyTB.y + tangentialRampT2, kStart, kMax);
            tangentialRampHappened = true;
          }
          if (tangentialPenaltyCapScale > 0.0) {
            let tangentialPenaltyCap = max(penaltyN * tangentialPenaltyCapScale, kStart);
            penaltyTB = min(penaltyTB, vec2f(tangentialPenaltyCap));
          }
          if (useIsotropicTangentialPenaltyOnStick > 0u && stick) {
            let sharedPenaltyT = max(0.5 * (penaltyTB.x + penaltyTB.y), kStart);
            penaltyTB = vec2f(sharedPenaltyT);
          }
        }

        let storedDual = select(
          vec4f(dualN, t1 * dualTB.x + t2 * dualTB.y),
          vec4f(dualN, dualTB, 0.0),
          useReferenceTangentialUpdate > 0u,
        );
        let storedPenaltyTB = penaltyTB;
        let storedPenaltyN = penaltyN;
        // pairLambdas mirrors the live dual state in positive magnitudes for
        // debug/readback. It is derived state, not the
        // authoritative contact record.
        let pairLambdaTB = dualTB;
        let pairLambdaN = -dualN;
        storeContactRecord(
          pairContacts,
          p,
          storedDual,
          storedPenaltyN,
          storedPenaltyTB,
          pairLambdaN,
          pairLambdaTB,
          frictionScale,
          kStart,
        );

        let currentMeta = loadContactMeta(pairContacts, p);
        storeContactMeta(pairContacts, p, vec4f(
          currentMeta.x,
          currentMeta.y,
          currentMeta.z,
          bitcast<f32>(
          featureKey
          | (cooldown << 9u)
          | (preserveWarmstart << 16u)
          | (select(0u, 1u, stick) << 17u)
          | (stickAnchorReuse << 18u)
          | (select(0u, 1u, tangentialInsideCone) << 19u)
          | (select(0u, 1u, tangentialRampHappened) << 20u)
          | (warmstartDebugReason << 21u),
          ),
        ));
      }
    `,
      [qrot, qmul, qconj, tangentBasisHelpers2, contactRecordHelpers, contactStateHelpers]
    );
    this.capturePairDualStateKernel = capturePairDualStateShader({
      inertialPose: storage(inertialPose, "vec4f", maxBodies * INERTIAL_POSE_VEC4S_PER_BODY2).toReadOnly(),
      initialPose: storage(initialPose, "vec4f", maxBodies * 2).toReadOnly(),
      pairContacts: storage(pairContacts, "vec4f", maxPairContacts * CONTACT_RECORD_VEC4S),
      pairActivity: storage(pairActivity, "uint", pairActivityWordCount),
      pairDispatchCount: uniform(0),
      regularizationAlpha: uniform(AVBD_REGULARIZATION_ALPHA_DEFAULT),
      beta: uniform(AVBD_BETA),
      frictionStatic: uniform(AVBD_FRICTION_STATIC),
      frictionDynamic: uniform(AVBD_FRICTION_DYNAMIC),
      kStart: uniform(AVBD_K_START),
      kMax: uniform(1e10),
      lambdaMax: uniform(1e10),
      preventPenetratingNormalDropout: uniform(0),
      enableNormalReleaseHeuristic: uniform(0),
      freezeTangentialPenaltyOnStick: uniform(0),
      freezeTangentialPenaltyUpdates: uniform(0),
      useIsotropicTangentialPenaltyOnStick: uniform(0),
      rampTangentialPenaltyOnlyWhenNotSticking: uniform(0),
      useReferenceTangentialUpdate: uniform(1),
      stickExitThreshold: uniform(AVBD_STICK_THRESHOLD),
      tangentialPenaltyRampDeadzone: uniform(0),
      tangentialPenaltySlipRampMaxDelta: uniform(0),
      tangentialPenaltyCapScale: uniform(0),
      useNormalContactMargin: uniform(1),
      useLocalContactArms: uniform(1),
      dt: uniform(1 / 60 / 4),
      workgroupId,
      localId
    }).computeKernel([WORKGROUP_SIZE3, 1, 1]).setName("AVBD Capture Pair Dual");
    const captureJointDualStateShader = wgslFn(
      /* wgsl */
      `
      fn compute(
        inertialPose: ptr<storage, array<vec4f>, read>,
        jointRecords: ptr<storage, array<vec4f>, read_write>,
        jointCount: u32,
        regularizationAlpha: f32,
        beta: f32,
        betaAngular: f32,
        kStart: f32,
        lambdaMax: f32,
        workgroupId: vec3u,
        localId: vec3u,
      ) -> void {
        let gid = workgroupId.x * ${WORKGROUP_SIZE3}u + localId.x;
        if (gid >= jointCount) { return; }

        let jointMetaWords = loadJointMetaWords(jointRecords, gid);
        if (jointMetaWords.w == 0u) { return; }

        let bodyA = jointMetaWords.x;
        let bodyB = jointMetaWords.y;
        let jointType = jointMetaWords.z;
        let anchorA = loadJointAnchorA(jointRecords, gid);
        let anchorB = loadJointAnchorB(jointRecords, gid);
        let torqueArm = max(anchorA.w, 1.0);
        var currentQA = vec4f(0.0, 0.0, 0.0, 1.0);
        var currentPosA = anchorA.xyz;
        if (bodyA != WORLD_BODY_INDEX) {
          let solvePoseBaseA = bodyA * ${INERTIAL_POSE_VEC4S_PER_BODY2}u;
          currentQA = normalize(inertialPose[solvePoseBaseA + 3u]);
          currentPosA = inertialPose[solvePoseBaseA + 2u].xyz;
        }
        let solvePoseBaseB = bodyB * ${INERTIAL_POSE_VEC4S_PER_BODY2}u;
        let currentQB = normalize(inertialPose[solvePoseBaseB + 3u]);
        let currentPosB = inertialPose[solvePoseBaseB + 2u].xyz;
        let worldAnchorA = jointWorldAnchor(bodyA, anchorA.xyz, currentPosA, currentQA);
        let worldAnchorB = currentPosB + qrot(currentQB, anchorB.xyz);

        let stiffness = loadJointStiffness(jointRecords, gid);
        let maxPenaltyLin = vec3f(min(max(stiffness.x, kStart), ${AVBD_JOINT_PENALTY_MAX}));
        let maxPenaltyAng = vec3f(min(max(stiffness.y, 0.0), ${AVBD_JOINT_PENALTY_MAX}));

        let prevLambdaLin = loadJointLambdaLin(jointRecords, gid).xyz;
        let prevLambdaAng = loadJointLambdaAng(jointRecords, gid).xyz;
        let prevPenaltyLin = max(loadJointPenaltyLin(jointRecords, gid).xyz, vec3f(kStart));
        let c0Lin = loadJointC0Lin(jointRecords, gid).xyz;
        let c0Ang = loadJointC0Ang(jointRecords, gid).xyz;

        let rigidLinear = !isFiniteF32(stiffness.x);
        let angularEnabled = jointType == JOINT_TYPE_FIXED && stiffness.y > 0.0;
        let rigidAngular = angularEnabled && !isFiniteF32(stiffness.y);
        let minPenaltyAng = select(vec3f(0.0), vec3f(kStart), angularEnabled);
        let prevPenaltyAng = max(loadJointPenaltyAng(jointRecords, gid).xyz, minPenaltyAng);
        let linearConstraint = (worldAnchorA - worldAnchorB) - select(vec3f(0.0), c0Lin * regularizationAlpha, rigidLinear);
        let penaltyLin = min(prevPenaltyLin + beta * abs(linearConstraint), maxPenaltyLin);
        let lambdaLin = clamp(prevLambdaLin + prevPenaltyLin * linearConstraint, vec3f(-lambdaMax), vec3f(lambdaMax));
        storeJointLambdaLin(
          jointRecords,
          gid,
          vec4f(select(prevLambdaLin, lambdaLin, rigidLinear), 0.0),
        );
        storeJointPenaltyLin(jointRecords, gid, vec4f(penaltyLin, 0.0));

        if (angularEnabled) {
          let angularConstraint = jointFixedAngularConstraint(bodyA, currentQA, currentQB, loadJointRestRelativeRotation(jointRecords, gid), torqueArm) - select(vec3f(0.0), c0Ang * regularizationAlpha, rigidAngular);
          let lambdaAng = clamp(prevLambdaAng + prevPenaltyAng * angularConstraint, vec3f(-lambdaMax), vec3f(lambdaMax));
          let penaltyAng = min(prevPenaltyAng + betaAngular * abs(angularConstraint), maxPenaltyAng);
          storeJointLambdaAng(
            jointRecords,
            gid,
            vec4f(select(prevLambdaAng, lambdaAng, rigidAngular), 0.0),
          );
          storeJointPenaltyAng(jointRecords, gid, vec4f(penaltyAng, 0.0));
        } else {
          storeJointLambdaAng(jointRecords, gid, vec4f(0.0));
          storeJointPenaltyAng(jointRecords, gid, vec4f(0.0));
        }
      }
    `,
      [qrot, qmul, qconj, jointRecordHelpers, jointConstraintHelpers]
    );
    this.captureJointDualStateKernel = captureJointDualStateShader({
      inertialPose: storage(inertialPose, "vec4f", maxBodies * INERTIAL_POSE_VEC4S_PER_BODY2).toReadOnly(),
      jointRecords: storage(jointRecords, "vec4f", maxJoints * JOINT_RECORD_VEC4S),
      jointCount: uniform(0),
      regularizationAlpha: uniform(AVBD_REGULARIZATION_ALPHA_DEFAULT),
      beta: uniform(AVBD_BETA),
      betaAngular: uniform(100),
      kStart: uniform(AVBD_K_START),
      lambdaMax: uniform(1e10),
      workgroupId,
      localId
    }).computeKernel([WORKGROUP_SIZE3, 1, 1]).setName("AVBD Capture Joint Dual");
    assertStorageBufferBudget("AVBD Capture Joint Dual", 3);
    const finalizeVelocitiesShader = wgslFn(
      /* wgsl */
      `
      fn compute(
        inertialPose: ptr<storage, array<vec4f>, read>,
        initialPose: ptr<storage, array<vec4f>, read>,
        positions: ptr<storage, array<vec4f>, read_write>,
        quaternions: ptr<storage, array<vec4f>, read_write>,
        velocities: ptr<storage, array<vec4f>, read_write>,
        prevLinearVelocities: ptr<storage, array<vec4f>, read_write>,
        angularVelocities: ptr<storage, array<vec4f>, read_write>,
        dt: f32,
        bodyCount: u32,
        workgroupId: vec3u,
        localId: vec3u,
      ) -> void {
        let gid = workgroupId.x * ${WORKGROUP_SIZE3}u + localId.x;
        if (gid >= bodyCount) { return; }

        let solvePoseBase = gid * ${INERTIAL_POSE_VEC4S_PER_BODY2}u;
        let currentPose = inertialPose[solvePoseBase + 2u];
        let currentQ = normalize(inertialPose[solvePoseBase + 3u]);
        positions[gid] = currentPose;
        quaternions[gid] = currentQ;

        if (currentPose.w == 0.0) {
          prevLinearVelocities[gid] = vec4f(0.0);
          velocities[gid] = vec4f(0.0);
          angularVelocities[gid] = vec4f(0.0);
          return;
        }

        // Preserve the pre-finalize linear velocity for adaptive warmstarting.
        prevLinearVelocities[gid] = velocities[gid];

        let dtSafe = max(dt, 1e-6);
        let poseBase = gid * 2u;
        let prevPos = initialPose[poseBase].xyz;
        var v = (currentPose.xyz - prevPos) / dtSafe;

        let prevQ = normalize(initialPose[poseBase + 1u]);
        let dqRaw = qmul(currentQ, qconj(prevQ));
        let dq = select(dqRaw, -dqRaw, dqRaw.w < 0.0);
        let w = 2.0 * dq.xyz / dtSafe;

        velocities[gid] = vec4f(v, 0.0);
        angularVelocities[gid] = vec4f(w, 0.0);
      }
    `,
      [qmul, qconj]
    );
    this.finalizeVelocitiesKernel = finalizeVelocitiesShader({
      inertialPose: storage(inertialPose, "vec4f", maxBodies * INERTIAL_POSE_VEC4S_PER_BODY2).toReadOnly(),
      initialPose: storage(initialPose, "vec4f", maxBodies * 2).toReadOnly(),
      positions: storage(positions, "vec4f", maxBodies),
      quaternions: storage(quaternions, "vec4f", maxBodies),
      velocities: storage(velocities, "vec4f", maxBodies),
      prevLinearVelocities: storage(prevLinearVelocities, "vec4f", maxBodies),
      angularVelocities: storage(angularVelocities, "vec4f", maxBodies),
      dt: uniform(1 / 60 / 4),
      bodyCount: uniform(0),
      workgroupId,
      localId
    }).computeKernel([WORKGROUP_SIZE3, 1, 1]).setName("AVBD Finalize Velocities");
  }
  prepare(renderer, bodyCount, pairDispatchCount, jointCount, springCount, bodyColorCount, lambdaWarmstartScale, dt, bodySolveMode = "colored") {
    const boundedDispatch = Math.min(pairDispatchCount, this.maxActivePairContacts);
    const warmstartScale = Math.max(0, Math.min(1, lambdaWarmstartScale));
    if (boundedDispatch > 0) {
      this.buildContactDispatchArgsKernel.computeNode.parameters.pairDispatchCount.value = boundedDispatch;
      this.prepareStateKernel.computeNode.parameters.pairDispatchCount.value = boundedDispatch;
      this.prepareStateKernel.computeNode.parameters.lambdaWarmstartScale.value = warmstartScale;
      renderer.compute(this.buildContactDispatchArgsKernel, [1, 1, 1]);
      renderer.compute(this.prepareStateKernel, this.contactDispatchIndirectAttr);
    }
    if (jointCount > 0) {
      this.prepareJointStateKernel.computeNode.parameters.jointCount.value = jointCount;
      this.prepareJointStateKernel.computeNode.parameters.lambdaWarmstartScale.value = warmstartScale;
      this.prepareJointStateKernel.computeNode.parameters.dt.value = dt;
      renderer.compute(this.prepareJointStateKernel, [Math.ceil(jointCount / WORKGROUP_SIZE3), 1, 1]);
    }
    if (bodyCount <= 0) {
      return;
    }
    const bodyWorkgroups = Math.ceil(bodyCount / WORKGROUP_SIZE3);
    this.buildSolverConstraintListsKernel.computeNode.parameters.bodyCount.value = bodyCount;
    renderer.compute(this.buildSolverConstraintListsKernel, [bodyWorkgroups, 1, 1]);
    if (jointCount > 0) {
      this.appendJointConstraintRefsKernel.computeNode.parameters.jointCount.value = jointCount;
      renderer.compute(this.appendJointConstraintRefsKernel, [Math.ceil(jointCount / WORKGROUP_SIZE3), 1, 1]);
    }
    if (springCount > 0) {
      this.appendSpringConstraintRefsKernel.computeNode.parameters.springCount.value = springCount;
      renderer.compute(this.appendSpringConstraintRefsKernel, [Math.ceil(springCount / WORKGROUP_SIZE3), 1, 1]);
    }
    if (bodySolveMode === "serial") {
      return;
    }
    const clampedColors = Math.max(1, Math.min(32, Math.floor(bodyColorCount)));
    this.greedyBodyColorsKernel.computeNode.parameters.bodyCount.value = bodyCount;
    this.greedyBodyColorsKernel.computeNode.parameters.colorCount.value = clampedColors;
    renderer.compute(this.greedyBodyColorsKernel, [bodyWorkgroups, 1, 1]);
    const hardConstraintCount = Math.max(jointCount, springCount);
    if (hardConstraintCount > 0) {
      this.markHardColorConflictsKernel.computeNode.parameters.bodyCount.value = bodyCount;
      this.markHardColorConflictsKernel.computeNode.parameters.jointCount.value = jointCount;
      this.markHardColorConflictsKernel.computeNode.parameters.springCount.value = springCount;
      this.repairHardBodyColorsKernel.computeNode.parameters.bodyCount.value = bodyCount;
      this.repairHardBodyColorsKernel.computeNode.parameters.colorCount.value = clampedColors;
      const hardConstraintWorkgroups = Math.ceil(hardConstraintCount / WORKGROUP_SIZE3);
      for (let round = 0; round < BODY_COLOR_HARD_REPAIR_ROUNDS; round++) {
        renderer.compute(this.markHardColorConflictsKernel, [hardConstraintWorkgroups, 1, 1]);
        renderer.compute(this.repairHardBodyColorsKernel, [bodyWorkgroups, 1, 1]);
      }
    }
  }
  primalSolveBodies(renderer, bodyCount, sweepCount, bodyColorCount, regularizationAlpha, dt, frictionSolveScale = 1, tangentialRegularizationAlpha = regularizationAlpha, solveTuning, sweepStartOffset = 0, colorStart = 0, colorCountOverride, bodySolveMode = "colored") {
    if (bodyCount <= 0 || sweepCount <= 0 || bodyColorCount <= 0) return;
    const bodyWorkgroups = Math.ceil(bodyCount / WORKGROUP_SIZE3);
    const bodySolveModeValue = bodySolveMode === "serial" ? 1 : 0;
    const solveParams = this.primalBodySolveKernel.computeNode.parameters;
    const commitParams = this.commitBodySolveKernel.computeNode.parameters;
    solveParams.bodyCount.value = bodyCount;
    solveParams.bodyIndexBase.value = 0;
    solveParams.dispatchBodyCount.value = bodyCount;
    solveParams.bodySolveMode.value = bodySolveModeValue;
    solveParams.regularizationAlpha.value = regularizationAlpha;
    solveParams.tangentialRegularizationAlpha.value = tangentialRegularizationAlpha;
    solveParams.dt.value = dt;
    solveParams.frictionSolveScale.value = frictionSolveScale;
    solveParams.relaxation.value = Math.max(0, solveTuning?.relaxation ?? 1);
    solveParams.frictionRelaxation.value = Math.max(0, solveTuning?.frictionRelaxation ?? 1);
    solveParams.inertialDiagWeight.value = Math.max(0, solveTuning?.inertialDiagWeight ?? 1);
    solveParams.maxLinearCorrection.value = Math.max(0, solveTuning?.maxLinearCorrection ?? 0.25);
    solveParams.maxAngularCorrection.value = Math.max(0, solveTuning?.maxAngularCorrection ?? 0.35);
    commitParams.bodyCount.value = bodyCount;
    commitParams.bodyIndexBase.value = 0;
    commitParams.dispatchBodyCount.value = bodyCount;
    commitParams.bodySolveMode.value = bodySolveModeValue;
    const clampedColors = Math.max(1, Math.min(32, Math.floor(bodyColorCount)));
    const clampedColorStart = Math.max(0, Math.min(clampedColors - 1, Math.floor(colorStart)));
    const requestedColorCount = colorCountOverride === void 0 ? clampedColors - clampedColorStart : Math.max(0, Math.floor(colorCountOverride));
    const colorEnd = Math.min(clampedColors, clampedColorStart + requestedColorCount);
    if (colorEnd <= clampedColorStart) return;
    const sweepPasses = Math.max(1, Math.floor(sweepCount));
    if (bodySolveMode === "serial") {
      solveParams.currentColor.value = 0;
      commitParams.currentColor.value = 0;
      for (let sweep = 0; sweep < sweepPasses; sweep++) {
        solveParams.sweepOffset.value = sweepStartOffset + sweep;
        for (let bodyIndex = 0; bodyIndex < bodyCount; bodyIndex++) {
          solveParams.bodyIndexBase.value = bodyIndex;
          solveParams.dispatchBodyCount.value = 1;
          commitParams.bodyIndexBase.value = bodyIndex;
          commitParams.dispatchBodyCount.value = 1;
          renderer.compute(this.primalBodySolveKernel, [1, 1, 1]);
          renderer.compute(this.commitBodySolveKernel, [1, 1, 1]);
        }
      }
      return;
    }
    for (let sweep = 0; sweep < sweepPasses; sweep++) {
      solveParams.sweepOffset.value = sweepStartOffset + sweep;
      for (let color = clampedColorStart; color < colorEnd; color++) {
        solveParams.currentColor.value = color;
        commitParams.currentColor.value = color;
        renderer.compute(this.primalBodySolveKernel, [bodyWorkgroups, 1, 1]);
        renderer.compute(this.commitBodySolveKernel, [bodyWorkgroups, 1, 1]);
      }
    }
  }
  usesDerivedInertiaInPrimalSolve() {
    return !this.useLocalDiagonalPrimalSolveFastPath;
  }
  captureFromSolve(renderer, pairDispatchCount, jointCount, dt, regularizationAlpha, captureIterationIndex = -1) {
    const boundedDispatch = Math.min(pairDispatchCount, this.maxActivePairContacts);
    if (boundedDispatch > 0) {
      this.capturePairDualStateKernel.computeNode.parameters.pairDispatchCount.value = boundedDispatch;
      this.capturePairDualStateKernel.computeNode.parameters.regularizationAlpha.value = regularizationAlpha;
      this.capturePairDualStateKernel.computeNode.parameters.dt.value = dt;
      renderer.compute(this.capturePairDualStateKernel, this.contactDispatchIndirectAttr);
    }
    if (jointCount > 0) {
      this.captureJointDualStateKernel.computeNode.parameters.jointCount.value = jointCount;
      this.captureJointDualStateKernel.computeNode.parameters.regularizationAlpha.value = regularizationAlpha;
      renderer.compute(this.captureJointDualStateKernel, [Math.ceil(jointCount / WORKGROUP_SIZE3), 1, 1]);
    }
  }
  finalizeVelocities(renderer, bodyCount, dt) {
    if (bodyCount <= 0) return;
    this.finalizeVelocitiesKernel.computeNode.parameters.bodyCount.value = bodyCount;
    this.finalizeVelocitiesKernel.computeNode.parameters.dt.value = dt;
    const workgroups = Math.ceil(bodyCount / WORKGROUP_SIZE3);
    renderer.compute(this.finalizeVelocitiesKernel, [workgroups, 1, 1]);
  }
  clearPhaseDebugCounters(renderer) {
    if (!this.debugEnabled) return;
    renderer.compute(this.clearPhaseDebugCountersKernel, [1, 1, 1]);
  }
  capturePhaseDebug(renderer, pairDispatchCount, regularizationAlpha, phaseOffset, frictionSolveScale = 1, tangentialRegularizationAlpha = regularizationAlpha) {
    if (!this.debugEnabled) return;
    const boundedDispatch = Math.min(pairDispatchCount, this.maxActivePairContacts);
    if (boundedDispatch <= 0) return;
    this.accumulatePhaseDebugCountersKernel.computeNode.parameters.pairDispatchCount.value = boundedDispatch;
    this.accumulatePhaseDebugCountersKernel.computeNode.parameters.regularizationAlpha.value = regularizationAlpha;
    this.accumulatePhaseDebugCountersKernel.computeNode.parameters.tangentialRegularizationAlpha.value = tangentialRegularizationAlpha;
    this.accumulatePhaseDebugCountersKernel.computeNode.parameters.phaseOffset.value = phaseOffset;
    this.accumulatePhaseDebugCountersKernel.computeNode.parameters.frictionSolveScale.value = frictionSolveScale;
    renderer.compute(this.accumulatePhaseDebugCountersKernel, this.contactDispatchIndirectAttr);
  }
  setDebugEnabled(enabled) {
    this.debugEnabled = enabled;
    this.debugReadbackInFlight = false;
    this.separatingTraceReadbackInFlight = false;
    this.separatingTraceArmed = true;
    this.lastDebugLogFrame = -1;
  }
  setDebugLogInterval(intervalFrames) {
    this.debugEveryNFrames = Math.max(1, Math.floor(intervalFrames));
    this.lastDebugLogFrame = -1;
  }
  setFriction(staticFriction, dynamicFriction = staticFriction) {
    const staticClamped = Math.max(0, staticFriction);
    const dynamicClamped = Math.max(0, dynamicFriction);
    this.primalBodySolveKernel.computeNode.parameters.frictionStatic.value = staticClamped;
    this.primalBodySolveKernel.computeNode.parameters.frictionDynamic.value = dynamicClamped;
    this.prepareStateKernel.computeNode.parameters.frictionStatic.value = staticClamped;
    this.capturePairDualStateKernel.computeNode.parameters.frictionStatic.value = staticClamped;
    this.capturePairDualStateKernel.computeNode.parameters.frictionDynamic.value = dynamicClamped;
    this.accumulatePhaseDebugCountersKernel.computeNode.parameters.frictionStatic.value = staticClamped;
    this.accumulatePhaseDebugCountersKernel.computeNode.parameters.frictionDynamic.value = dynamicClamped;
    this.accumulateDebugCountersKernel.computeNode.parameters.frictionStatic.value = staticClamped;
    this.accumulateDebugCountersKernel.computeNode.parameters.frictionDynamic.value = dynamicClamped;
  }
  setDualUpdateBeta(beta) {
    const clamped = Math.max(0, beta);
    this.capturePairDualStateKernel.computeNode.parameters.beta.value = clamped;
    this.captureJointDualStateKernel.computeNode.parameters.beta.value = clamped;
    this.captureJointDualStateKernel.computeNode.parameters.betaAngular.value = Math.min(clamped, 100);
  }
  setPreventPenetratingNormalDropout(enabled) {
    this.capturePairDualStateKernel.computeNode.parameters.preventPenetratingNormalDropout.value = enabled ? 1 : 0;
  }
  setFreezeTangentialPenaltyUpdates(enabled) {
    this.capturePairDualStateKernel.computeNode.parameters.freezeTangentialPenaltyUpdates.value = enabled ? 1 : 0;
  }
  setPenaltyDecayGamma(gamma) {
    const clamped = Math.max(0, Math.min(1, gamma));
    this.prepareStateKernel.computeNode.parameters.gamma.value = clamped;
    this.prepareJointStateKernel.computeNode.parameters.gamma.value = clamped;
  }
  setPenaltyFloor(kStart) {
    const clamped = Math.max(1e-6, kStart);
    this.accumulatePhaseDebugCountersKernel.computeNode.parameters.kStart.value = clamped;
    this.accumulateDebugCountersKernel.computeNode.parameters.kStart.value = clamped;
    this.prepareStateKernel.computeNode.parameters.kStart.value = clamped;
    this.prepareJointStateKernel.computeNode.parameters.kStart.value = clamped;
    this.primalBodySolveKernel.computeNode.parameters.kStart.value = clamped;
    this.capturePairDualStateKernel.computeNode.parameters.kStart.value = clamped;
    this.captureJointDualStateKernel.computeNode.parameters.kStart.value = clamped;
  }
  traceSeparatingContacts(renderer, frameId, mainSeparating, mainBounded) {
    if (this.separatingTraceReadbackInFlight) return;
    if (!renderer || typeof renderer.getArrayBufferAsync !== "function") return;
    this.separatingTraceReadbackInFlight = true;
    const regularizationAlpha = AVBD_REGULARIZATION_ALPHA_DEFAULT;
    const normalContactMargin = AVBD_COLLISION_MARGIN;
    const suspiciousGapThreshold = 2 * normalContactMargin + 1e-6;
    const keySlotMask = this.contactKeySlotBitCount > 0 ? (1 << this.contactKeySlotBitCount) - 1 : 0;
    Promise.all([
      renderer.getArrayBufferAsync(this.pairActivityAttr),
      renderer.getArrayBufferAsync(this.pairContactsAttr),
      renderer.getArrayBufferAsync(this.initialPoseAttr),
      renderer.getArrayBufferAsync(this.quaternionsAttr),
      renderer.getArrayBufferAsync(this.positionsAttr)
    ]).then(([
      activityRaw,
      pairContactsRaw,
      initialPoseRaw,
      quaternionsRaw,
      positionsRaw
    ]) => {
      const activity = new Uint32Array(activityRaw);
      const pairContacts = new Float32Array(pairContactsRaw);
      const pairContactWords = new Uint32Array(pairContactsRaw);
      const initialPose = new Float32Array(initialPoseRaw);
      const quaternions = new Float32Array(quaternionsRaw);
      const positions = new Float32Array(positionsRaw);
      const contactMetaBase = (p) => contactRecordVec4FloatIndex(p, CONTACT_RECORD_META_OFFSET);
      const contactNormalPenBase = (p) => contactRecordVec4FloatIndex(p, CONTACT_RECORD_NORMAL_PEN_OFFSET);
      const contactArmABase = (p) => contactRecordVec4FloatIndex(p, CONTACT_RECORD_ARM_A_OFFSET);
      const contactArmBBase = (p) => contactRecordVec4FloatIndex(p, CONTACT_RECORD_ARM_B_OFFSET);
      const contactConstraintC0Base = (p) => contactRecordVec4FloatIndex(p, CONTACT_RECORD_CONSTRAINT_C0_OFFSET);
      const contactDualBase = (p) => contactRecordVec4FloatIndex(p, CONTACT_RECORD_DUAL_OFFSET);
      const contactPenaltyBase = (p) => contactRecordVec4FloatIndex(p, CONTACT_RECORD_PENALTY_OFFSET);
      const dot3 = (ax, ay, az, bx, by, bz) => ax * bx + ay * by + az * bz;
      const cross3 = (ax, ay, az, bx, by, bz) => [
        ay * bz - az * by,
        az * bx - ax * bz,
        ax * by - ay * bx
      ];
      const normalizeQuat2 = (x, y, z, w) => {
        const len = Math.hypot(x, y, z, w);
        if (len <= 1e-12) return [0, 0, 0, 1];
        const inv = 1 / len;
        return [x * inv, y * inv, z * inv, w * inv];
      };
      const rotateVecByQuat = (qx, qy, qz, qw, vx, vy, vz) => {
        const tx = 2 * (qy * vz - qz * vy);
        const ty = 2 * (qz * vx - qx * vz);
        const tz = 2 * (qx * vy - qy * vx);
        return [
          vx + qw * tx + (qy * tz - qz * ty),
          vy + qw * ty + (qz * tx - qx * tz),
          vz + qw * tz + (qx * ty - qy * tx)
        ];
      };
      const buildCanonicalTangentBasis = (nx, ny, nz) => {
        const refAxis = Math.abs(ny) > 0.999 ? [1, 0, 0] : [0, 1, 0];
        const [t1RawX, t1RawY, t1RawZ] = cross3(refAxis[0], refAxis[1], refAxis[2], nx, ny, nz);
        const t1Len2 = dot3(t1RawX, t1RawY, t1RawZ, t1RawX, t1RawY, t1RawZ);
        const t1 = t1Len2 > 1e-12 ? [t1RawX / Math.sqrt(t1Len2), t1RawY / Math.sqrt(t1Len2), t1RawZ / Math.sqrt(t1Len2)] : [0, 0, 1];
        const [t2RawX, t2RawY, t2RawZ] = cross3(nx, ny, nz, t1[0], t1[1], t1[2]);
        const t2Len2 = dot3(t2RawX, t2RawY, t2RawZ, t2RawX, t2RawY, t2RawZ);
        const t2 = t2Len2 > 1e-12 ? [t2RawX / Math.sqrt(t2Len2), t2RawY / Math.sqrt(t2Len2), t2RawZ / Math.sqrt(t2Len2)] : [1, 0, 0];
        return { t1, t2 };
      };
      const buildTangentBasisFromPreferredT1 = (nx, ny, nz, preferredT1X, preferredT1Y, preferredT1Z) => {
        const dotPreferred = preferredT1X * nx + preferredT1Y * ny + preferredT1Z * nz;
        const projectedX = preferredT1X - nx * dotPreferred;
        const projectedY = preferredT1Y - ny * dotPreferred;
        const projectedZ = preferredT1Z - nz * dotPreferred;
        const projectedLen2 = dot3(projectedX, projectedY, projectedZ, projectedX, projectedY, projectedZ);
        if (projectedLen2 <= 1e-12) {
          return buildCanonicalTangentBasis(nx, ny, nz);
        }
        const invProjectedLen = 1 / Math.sqrt(projectedLen2);
        const t1 = [
          projectedX * invProjectedLen,
          projectedY * invProjectedLen,
          projectedZ * invProjectedLen
        ];
        const [t2RawX, t2RawY, t2RawZ] = cross3(nx, ny, nz, t1[0], t1[1], t1[2]);
        const t2Len2 = dot3(t2RawX, t2RawY, t2RawZ, t2RawX, t2RawY, t2RawZ);
        if (t2Len2 <= 1e-12) {
          return buildCanonicalTangentBasis(nx, ny, nz);
        }
        const invT2Len = 1 / Math.sqrt(t2Len2);
        return {
          t1,
          t2: [t2RawX * invT2Len, t2RawY * invT2Len, t2RawZ * invT2Len]
        };
      };
      const buildTangentBasisFromAngle = (nx, ny, nz, theta) => {
        const canonical = buildCanonicalTangentBasis(nx, ny, nz);
        const c = Math.cos(theta);
        const s = Math.sin(theta);
        const preferredT1X = canonical.t1[0] * c + canonical.t2[0] * s;
        const preferredT1Y = canonical.t1[1] * c + canonical.t2[1] * s;
        const preferredT1Z = canonical.t1[2] * c + canonical.t2[2] * s;
        return buildTangentBasisFromPreferredT1(nx, ny, nz, preferredT1X, preferredT1Y, preferredT1Z);
      };
      const formatWarmstartReason = (reason) => {
        switch (reason) {
          case 1:
            return "ex";
          case 2:
            return "pr";
          case 3:
            return "ng";
          case 4:
            return "in";
          case 5:
            return "rp";
          case 6:
            return "mx";
          default:
            return "--";
        }
      };
      const activeContacts = activity.subarray(
        this.pairActiveContactsOffset,
        this.pairActiveContactsOffset + this.maxActivePairContacts + 1
      );
      const activeListCount = Math.min(activeContacts[0] ?? 0, this.maxActivePairContacts);
      const offenders = [];
      for (let k = 0; k < activeListCount; k++) {
        const p = activeContacts[k + 1] ?? this.maxPairContacts;
        if (p >= this.maxPairContacts) continue;
        const metaBase = contactMetaBase(p);
        if ((pairContacts[metaBase + 2] ?? 0) < 0.5) continue;
        const i = Math.round(pairContacts[metaBase] ?? -1);
        const j = Math.round(pairContacts[metaBase + 1] ?? -1);
        if (i < 0 || j < 0 || i === j) continue;
        const nBase = contactNormalPenBase(p);
        const nx = pairContacts[nBase] ?? 0;
        const ny = pairContacts[nBase + 1] ?? 0;
        const nz = pairContacts[nBase + 2] ?? 0;
        const penetration = pairContacts[nBase + 3] ?? 0;
        if (dot3(nx, ny, nz, nx, ny, nz) <= 1e-12) continue;
        const iBase = i * 4;
        const jBase = j * 4;
        const iPosX = positions[iBase] ?? 0;
        const iPosY = positions[iBase + 1] ?? 0;
        const iPosZ = positions[iBase + 2] ?? 0;
        const jPosX = positions[jBase] ?? 0;
        const jPosY = positions[jBase + 1] ?? 0;
        const jPosZ = positions[jBase + 2] ?? 0;
        const iInitBase = i * 8;
        const jInitBase = j * 8;
        const dPosIX = iPosX - (initialPose[iInitBase] ?? iPosX);
        const dPosIY = iPosY - (initialPose[iInitBase + 1] ?? iPosY);
        const dPosIZ = iPosZ - (initialPose[iInitBase + 2] ?? iPosZ);
        const dPosJX = jPosX - (initialPose[jInitBase] ?? jPosX);
        const dPosJY = jPosY - (initialPose[jInitBase + 1] ?? jPosY);
        const dPosJZ = jPosZ - (initialPose[jInitBase + 2] ?? jPosZ);
        const iQuatBase = i * 4;
        const jQuatBase = j * 4;
        const [currQIX, currQIY, currQIZ, currQIW] = normalizeQuat2(
          quaternions[iQuatBase] ?? 0,
          quaternions[iQuatBase + 1] ?? 0,
          quaternions[iQuatBase + 2] ?? 0,
          quaternions[iQuatBase + 3] ?? 1
        );
        const [currQJX, currQJY, currQJZ, currQJW] = normalizeQuat2(
          quaternions[jQuatBase] ?? 0,
          quaternions[jQuatBase + 1] ?? 0,
          quaternions[jQuatBase + 2] ?? 0,
          quaternions[jQuatBase + 3] ?? 1
        );
        const [initQIX, initQIY, initQIZ, initQIW] = normalizeQuat2(
          initialPose[iInitBase + 4] ?? 0,
          initialPose[iInitBase + 5] ?? 0,
          initialPose[iInitBase + 6] ?? 0,
          initialPose[iInitBase + 7] ?? 1
        );
        const [initQJX, initQJY, initQJZ, initQJW] = normalizeQuat2(
          initialPose[jInitBase + 4] ?? 0,
          initialPose[jInitBase + 5] ?? 0,
          initialPose[jInitBase + 6] ?? 0,
          initialPose[jInitBase + 7] ?? 1
        );
        const armABase = contactArmABase(p);
        const armBBase = contactArmBBase(p);
        const raStoredX = pairContacts[armABase] ?? 0;
        const raStoredY = pairContacts[armABase + 1] ?? 0;
        const raStoredZ = pairContacts[armABase + 2] ?? 0;
        const tangentAngle = pairContacts[armABase + 3] ?? 0;
        const rbStoredX = pairContacts[armBBase] ?? 0;
        const rbStoredY = pairContacts[armBBase + 1] ?? 0;
        const rbStoredZ = pairContacts[armBBase + 2] ?? 0;
        const [raX, raY, raZ] = rotateVecByQuat(currQIX, currQIY, currQIZ, currQIW, raStoredX, raStoredY, raStoredZ);
        const [rbX, rbY, rbZ] = rotateVecByQuat(currQJX, currQJY, currQJZ, currQJW, rbStoredX, rbStoredY, rbStoredZ);
        const [prevRaX, prevRaY, prevRaZ] = rotateVecByQuat(initQIX, initQIY, initQIZ, initQIW, raStoredX, raStoredY, raStoredZ);
        const [prevRbX, prevRbY, prevRbZ] = rotateVecByQuat(initQJX, initQJY, initQJZ, initQJW, rbStoredX, rbStoredY, rbStoredZ);
        const [crossRaN_X, crossRaN_Y, crossRaN_Z] = cross3(raX, raY, raZ, nx, ny, nz);
        const [crossRbN_X, crossRbN_Y, crossRbN_Z] = cross3(rbX, rbY, rbZ, nx, ny, nz);
        const tangentBasis = buildTangentBasisFromAngle(nx, ny, nz, tangentAngle);
        const [t1X, t1Y, t1Z] = tangentBasis.t1;
        const [t2X, t2Y, t2Z] = tangentBasis.t2;
        const dqArawX = currQIW * -initQIX + currQIX * initQIW + currQIY * -initQIZ - currQIZ * -initQIY;
        const dqArawY = currQIW * -initQIY - currQIX * -initQIZ + currQIY * initQIW + currQIZ * -initQIX;
        const dqArawZ = currQIW * -initQIZ + currQIX * -initQIY - currQIY * -initQIX + currQIZ * initQIW;
        const dqArawW = currQIW * initQIW - currQIX * -initQIX - currQIY * -initQIY - currQIZ * -initQIZ;
        const dqAX = dqArawW < 0 ? -dqArawX : dqArawX;
        const dqAY = dqArawW < 0 ? -dqArawY : dqArawY;
        const dqAZ = dqArawW < 0 ? -dqArawZ : dqArawZ;
        const dqBrawX = currQJW * -initQJX + currQJX * initQJW + currQJY * -initQJZ - currQJZ * -initQJY;
        const dqBrawY = currQJW * -initQJY - currQJX * -initQJZ + currQJY * initQJW + currQJZ * -initQJX;
        const dqBrawZ = currQJW * -initQJZ + currQJX * -initQJY - currQJY * -initQJX + currQJZ * initQJW;
        const dqBrawW = currQJW * initQJW - currQJX * -initQJX - currQJY * -initQJY - currQJZ * -initQJZ;
        const dqBX = dqBrawW < 0 ? -dqBrawX : dqBrawX;
        const dqBY = dqBrawW < 0 ? -dqBrawY : dqBrawY;
        const dqBZ = dqBrawW < 0 ? -dqBrawZ : dqBrawZ;
        const dThetaAX = 2 * dqAX;
        const dThetaAY = 2 * dqAY;
        const dThetaAZ = 2 * dqAZ;
        const dThetaBX = 2 * dqBX;
        const dThetaBY = 2 * dqBY;
        const dThetaBZ = 2 * dqBZ;
        const constraintC0Base = contactConstraintC0Base(p);
        const c0 = pairContacts[constraintC0Base] ?? 0;
        const anchorGap = c0 - normalContactMargin;
        const cRegN = (1 - regularizationAlpha) * c0 + dot3(-nx, -ny, -nz, dPosIX, dPosIY, dPosIZ) + dot3(-crossRaN_X, -crossRaN_Y, -crossRaN_Z, dThetaAX, dThetaAY, dThetaAZ) + dot3(nx, ny, nz, dPosJX, dPosJY, dPosJZ) + dot3(crossRbN_X, crossRbN_Y, crossRbN_Z, dThetaBX, dThetaBY, dThetaBZ);
        if (cRegN <= 0) continue;
        const currentPointAX = iPosX + raX;
        const currentPointAY = iPosY + raY;
        const currentPointAZ = iPosZ + raZ;
        const currentPointBX = jPosX + rbX;
        const currentPointBY = jPosY + rbY;
        const currentPointBZ = jPosZ + rbZ;
        const currentGap = -dot3(
          currentPointAX - currentPointBX,
          currentPointAY - currentPointBY,
          currentPointAZ - currentPointBZ,
          nx,
          ny,
          nz
        );
        const rawPenetration = -currentGap;
        const dualBase = contactDualBase(p);
        const penaltyBase = contactPenaltyBase(p);
        const dualN = Math.min(pairContacts[dualBase] ?? 0, 0);
        const penaltyN = Math.max(pairContacts[penaltyBase] ?? 0, 1e-6);
        const featureWord = pairContactWords[metaBase + 3] ?? 0;
        const preserveWarmstart = (featureWord >>> 16 & 1) !== 0;
        const stick = (featureWord >>> 17 & 1) !== 0;
        const reuse = (featureWord >>> 18 & 1) !== 0;
        const warmstartReason = featureWord >>> 21 & 7;
        const featureKey = featureWord & 511;
        const keyWord = pairContactWords[contactRecordVec4FloatIndex(p, CONTACT_RECORD_CACHE_OFFSET)] ?? 0;
        const key = keyWord & 2147483647;
        const keyBase = this.contactKeySlotBitCount > 0 ? key >>> this.contactKeySlotBitCount : key;
        const keySlot = this.contactKeySlotBitCount > 0 ? key & keySlotMask : 0;
        const clampedSeparated = penetration <= 1e-6 && currentGap > suspiciousGapThreshold;
        const reusedSeparated = reuse && clampedSeparated;
        offenders.push({
          p,
          i,
          j,
          keyBase,
          keySlot,
          featureKey,
          warmstartReason,
          preserveWarmstart,
          stick,
          reuse,
          penetration,
          rawPenetration,
          currentGap,
          c0,
          cRegN,
          dualN,
          penaltyN,
          clampedSeparated,
          reusedSeparated
        });
      }
      offenders.sort(
        (a, b) => Number(b.reusedSeparated) - Number(a.reusedSeparated) || Number(b.clampedSeparated) - Number(a.clampedSeparated) || b.cRegN - a.cRegN || b.currentGap - a.currentGap || b.penaltyN - a.penaltyN
      );
      const top = offenders.slice(0, 6).map(
        (entry) => `p=${entry.p} ij=${entry.i}/${entry.j} key=${entry.keyBase.toString(16)}:${entry.keySlot} feat=0x${entry.featureKey.toString(16)} warm=${entry.preserveWarmstart ? 1 : 0} wsrc=${formatWarmstartReason(entry.warmstartReason)} stick=${entry.stick ? 1 : 0} reuse=${entry.reuse ? 1 : 0} pen=${entry.penetration.toFixed(4)} pRaw=${entry.rawPenetration.toFixed(4)} gNow=${entry.currentGap.toFixed(4)} c0N=${entry.c0.toFixed(4)} cRegN=${entry.cRegN.toFixed(4)} dualN=${entry.dualN.toFixed(3)} kN=${entry.penaltyN.toFixed(3)} clampSep=${entry.clampedSeparated ? 1 : 0} reuseSep=${entry.reusedSeparated ? 1 : 0}`
      );
      console.log(
        `[AVBD Separating Trace] frame=${frameId} mainSep=${mainSeparating}/${mainBounded} activeList=${activeListCount} offenders=${offenders.length} top=${top[0] ?? "none"}`
      );
      if (top.length > 0) {
        console.log(`[AVBD Separating Trace Dump] ${top.join(" ; ")}`);
      }
      if (offenders.length === 0) {
        console.log(
          `[AVBD Separating Trace] frame=${frameId} mismatch=1 reason=reconstruction_found_no_positive_cRegN_rows`
        );
      }
    }).catch((error) => {
      console.warn("AVBD separating trace readback failed:", error);
    }).finally(() => {
      this.separatingTraceReadbackInFlight = false;
    });
  }
  maybeLogDebug(renderer, frameId, pairDispatchCount, bodyCount) {
    if (!this.debugEnabled) return;
    if (this.debugReadbackInFlight) return;
    if (this.lastDebugLogFrame === frameId) return;
    if (this.lastDebugLogFrame >= 0 && frameId - this.lastDebugLogFrame < this.debugEveryNFrames) return;
    if (!renderer || typeof renderer.getArrayBufferAsync !== "function") return;
    const boundedDispatch = Math.min(pairDispatchCount, this.maxActivePairContacts);
    if (boundedDispatch <= 0) return;
    this.debugReadbackInFlight = true;
    this.lastDebugLogFrame = frameId;
    this.accumulateDebugCountersKernel.computeNode.parameters.pairDispatchCount.value = boundedDispatch;
    this.accumulateBodyColorDebugCountersKernel.computeNode.parameters.bodyCount.value = bodyCount;
    renderer.compute(this.clearDebugCountersKernel, [1, 1, 1]);
    renderer.compute(this.accumulateDebugCountersKernel, this.contactDispatchIndirectAttr);
    renderer.compute(this.accumulateBodyColorDebugCountersKernel, [Math.ceil(bodyCount / WORKGROUP_SIZE3), 1, 1]);
    Promise.all([
      renderer.getArrayBufferAsync(this.debugCountersAttr),
      renderer.getArrayBufferAsync(this.phaseDebugCountersAttr)
    ]).then(([dualRaw, phaseRaw]) => {
      const values = new Uint32Array(dualRaw);
      const scanned = values[0] ?? 0;
      const valid = values[1] ?? 0;
      const bounded = values[2] ?? 0;
      const staticRegime = values[3] ?? 0;
      const nearCone = values[4] ?? 0;
      const tinyNormal = values[5] ?? 0;
      const nyPos = values[6] ?? 0;
      const nyNeg = values[7] ?? 0;
      const boundViol = values[8] ?? 0;
      const nyVertical = values[9] ?? 0;
      const nyHorizontal = values[10] ?? 0;
      const constrainedBodies = values[11] ?? 0;
      const fallbackBodies = values[12] ?? 0;
      const totalBodyConstraintRefs = values[13] ?? 0;
      const saturatedBodyConstraintLists = values[14] ?? 0;
      const maxBodyConstraintRefs = values[15] ?? 0;
      const coloredConstraintEdges = values[16] ?? 0;
      const sameColorConstraintEdges = values[17] ?? 0;
      const staticPct = bounded > 0 ? (100 * staticRegime / bounded).toFixed(1) : "0.0";
      const nearConePct = bounded > 0 ? (100 * nearCone / bounded).toFixed(1) : "0.0";
      const fallbackPct = constrainedBodies > 0 ? (100 * fallbackBodies / constrainedBodies).toFixed(1) : "0.0";
      const avgBodyConstraintRefs = constrainedBodies > 0 ? (totalBodyConstraintRefs / constrainedBodies).toFixed(2) : "0.00";
      const colorConflictPct = coloredConstraintEdges > 0 ? (100 * sameColorConstraintEdges / coloredConstraintEdges).toFixed(2) : "0.00";
      console.log(
        `[AVBD Debug] frame=${frameId} scanned=${scanned} valid=${valid} bounded=${bounded} static=${staticRegime}(${staticPct}%) nearCone=${nearCone}(${nearConePct}%) tinyNormal=${tinyNormal} nyPos=${nyPos} nyNeg=${nyNeg} nyVertical=${nyVertical} nyHorizontal=${nyHorizontal} boundViol=${boundViol} colorFallback=${fallbackBodies}/${constrainedBodies}(${fallbackPct}%) bodyRefs=${totalBodyConstraintRefs} avgBodyRefs=${avgBodyConstraintRefs} maxBodyRefs=${maxBodyConstraintRefs} saturatedBodies=${saturatedBodyConstraintLists} colorConflicts=${sameColorConstraintEdges}/${coloredConstraintEdges}(${colorConflictPct}%)`
      );
      const phase = new Uint32Array(phaseRaw);
      const mainScanned = phase[0] ?? 0;
      const mainBounded = phase[1] ?? 0;
      const mainNearCone = phase[2] ?? 0;
      const mainTinyNormal = phase[3] ?? 0;
      const mainNyPos = phase[4] ?? 0;
      const mainNyNeg = phase[5] ?? 0;
      const mainSeparating = phase[6] ?? 0;
      const mainConeClamp = phase[7] ?? 0;
      const mainFrictionSuppressed = phase[8] ?? 0;
      const postScanned = phase[9] ?? 0;
      const postBounded = phase[10] ?? 0;
      const postNearCone = phase[11] ?? 0;
      const postTinyNormal = phase[12] ?? 0;
      const postNyPos = phase[13] ?? 0;
      const postNyNeg = phase[14] ?? 0;
      const postSeparating = phase[15] ?? 0;
      const postConeClamp = phase[16] ?? 0;
      const postFrictionSuppressed = phase[17] ?? 0;
      const mainNearConePct = mainBounded > 0 ? (100 * mainNearCone / mainBounded).toFixed(1) : "0.0";
      const postNearConePct = postBounded > 0 ? (100 * postNearCone / postBounded).toFixed(1) : "0.0";
      console.log(
        `[AVBD Solve Phase Debug] frame=${frameId} main(scanned=${mainScanned} bounded=${mainBounded} nearCone=${mainNearCone}(${mainNearConePct}%) tinyN=${mainTinyNormal} ny+/-=${mainNyPos}/${mainNyNeg} sep=${mainSeparating} coneClamp=${mainConeClamp} fricOffSep=${mainFrictionSuppressed}) post(scanned=${postScanned} bounded=${postBounded} nearCone=${postNearCone}(${postNearConePct}%) tinyN=${postTinyNormal} ny+/-=${postNyPos}/${postNyNeg} sep=${postSeparating} coneClamp=${postConeClamp} fricOffSep=${postFrictionSuppressed})`
      );
      if (mainSeparating > 0) {
        if (this.separatingTraceArmed) {
          this.traceSeparatingContacts(renderer, frameId, mainSeparating, mainBounded);
          this.separatingTraceArmed = false;
        }
      } else {
        this.separatingTraceArmed = true;
      }
    }).catch((error) => {
      console.warn("AVBD debug readback failed:", error);
    }).finally(() => {
      this.debugReadbackInFlight = false;
    });
  }
};

// vendor/webphysics/src/physics/gpu/broadPhase.ts
import { StorageBufferAttribute as StorageBufferAttribute3 } from "three/webgpu";

// vendor/webphysics/src/lvbh/shaders/setupShaders.ts
var computeBoundsShader = (
  /* wgsl */
  `

struct Uniforms {
	primCount: u32,
	workgroupCount: u32,
	positionStride: u32,
	pad1: u32,
};

struct BVH2Node {
	boundsMin: vec3f,
	leftChild: u32,
	boundsMax: vec3f,
	rightChild: u32,
};

struct Bounds {
	min: vec3f,
	max: vec3f,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
// Zero-copy: read packed f32/u32 arrays directly (no vec4 padding)
@group(0) @binding(1) var<storage, read> positions: array<f32>;
@group(0) @binding(2) var<storage, read> indices: array<u32>;
@group(0) @binding(3) var<storage, read_write> bvh2Nodes: array<BVH2Node>;
// Phase 1 optimization: plain u32 instead of atomic - no contention on initial write
@group(0) @binding(4) var<storage, read_write> clusterIdx: array<u32>;
// Atomic scene bounds in sortable-u32 format:
// [minX, minY, minZ, maxX, maxY, maxZ]
@group(0) @binding(5) var<storage, read_write> atomicSceneBounds: array<atomic<u32>, 6>;
// GPU-side initialization: moved from CPU
@group(0) @binding(6) var<storage, read_write> parentIdx: array<u32>;
@group(0) @binding(7) var<storage, read_write> hplocState: array<vec4u>;
@group(0) @binding(8) var<storage, read_write> activeList: array<u32>;

const INVALID_IDX: u32 = 0xFFFFFFFFu;
const WORKGROUP_SIZE: u32 = 256u;

var<workgroup> sharedMin: array<vec3f, WORKGROUP_SIZE>;
var<workgroup> sharedMax: array<vec3f, WORKGROUP_SIZE>;

// Map f32 to sortable u32 so unsigned integer order matches float order.
// Negative values: invert all bits. Non-negative values: set sign bit.
fn f32ToOrderedU32(val: f32) -> u32 {
	let bits = bitcast<u32>(val);
	return select(bits | 0x80000000u, ~bits, (bits & 0x80000000u) != 0u);
}

// Atomic min for f32 via native atomicMin on sortable-u32
fn atomicMinF32(idx: u32, val: f32) {
	atomicMin(&atomicSceneBounds[idx], f32ToOrderedU32(val));
}

// Atomic max for f32 via native atomicMax on sortable-u32
fn atomicMaxF32(idx: u32, val: f32) {
	atomicMax(&atomicSceneBounds[idx], f32ToOrderedU32(val));
}

// Load position from packed f32 array (configurable stride: 3 for vec3, 4 for vec4)
fn loadPosition(vertexIdx: u32) -> vec3f {
	let base = vertexIdx * uniforms.positionStride;
	return vec3f(positions[base], positions[base + 1u], positions[base + 2u]);
}

fn computeTriangleBounds(primIdx: u32) -> Bounds {
	// Load indices from packed u32 array (stride 3)
	let base = primIdx * 3u;
	let i0 = indices[base];
	let i1 = indices[base + 1u];
	let i2 = indices[base + 2u];

	let v0 = loadPosition(i0);
	let v1 = loadPosition(i1);
	let v2 = loadPosition(i2);

	var bounds: Bounds;
	bounds.min = min(min(v0, v1), v2);
	bounds.max = max(max(v0, v1), v2);
	return bounds;
}

@compute @workgroup_size(256)
fn computeBounds(
	@builtin(global_invocation_id) globalId: vec3u,
	@builtin(local_invocation_id) localId: vec3u,
	@builtin(workgroup_id) workgroupId: vec3u
) {
	let primIdx = globalId.x;
	let localIdx = localId.x;

	var localMin = vec3f(1e30);
	var localMax = vec3f(-1e30);

	if (primIdx < uniforms.primCount) {
		let bounds = computeTriangleBounds(primIdx);

		// Store as leaf node
		var node: BVH2Node;
		node.boundsMin = bounds.min;
		node.boundsMax = bounds.max;
		node.leftChild = INVALID_IDX;
		node.rightChild = primIdx;
		bvh2Nodes[primIdx] = node;

		// Initialize cluster index (plain store - no atomic needed)
		clusterIdx[primIdx] = primIdx;

		// GPU-side initialization (moved from CPU)
		parentIdx[primIdx] = INVALID_IDX;

		// hplocState: vec4u(left, right, split, active) - single vectorized write
		hplocState[primIdx] = vec4u(primIdx, primIdx, 0u, 1u);

		// Initialize active list (folded from separate initActiveList dispatch)
		activeList[primIdx] = primIdx;

		localMin = bounds.min;
		localMax = bounds.max;
	}

	sharedMin[localIdx] = localMin;
	sharedMax[localIdx] = localMax;

	workgroupBarrier();

	// Workgroup reduction
	for (var stride = WORKGROUP_SIZE / 2u; stride > 0u; stride = stride >> 1u) {
		if (localIdx < stride) {
			sharedMin[localIdx] = min(sharedMin[localIdx], sharedMin[localIdx + stride]);
			sharedMax[localIdx] = max(sharedMax[localIdx], sharedMax[localIdx + stride]);
		}
		workgroupBarrier();
	}

	// Thread 0 atomically updates global scene bounds (eliminates reduction passes!)
	if (localIdx == 0u) {
		let wgMin = sharedMin[0];
		let wgMax = sharedMax[0];

		// Atomic min for each component of min bounds
		atomicMinF32(0u, wgMin.x);
		atomicMinF32(1u, wgMin.y);
		atomicMinF32(2u, wgMin.z);

		// Atomic max for each component of max bounds
		atomicMaxF32(3u, wgMax.x);
		atomicMaxF32(4u, wgMax.y);
		atomicMaxF32(5u, wgMax.z);
	}
}
`
);
var reduceBoundsShader = (
  /* wgsl */
  `

struct Uniforms {
	primCount: u32,
	workgroupCount: u32,
	pad0: u32,
	pad1: u32,
};

struct SceneBounds {
	min: vec3f,
	pad0: f32,
	max: vec3f,
	pad1: f32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> partialBoundsMin: array<vec4f>;
@group(0) @binding(2) var<storage, read> partialBoundsMax: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> sceneBounds: SceneBounds;

const WORKGROUP_SIZE: u32 = 256u;

var<workgroup> sharedMin: array<vec3f, WORKGROUP_SIZE>;
var<workgroup> sharedMax: array<vec3f, WORKGROUP_SIZE>;

@compute @workgroup_size(256)
fn reduceBounds(
	@builtin(local_invocation_id) localId: vec3u
) {
	let localIdx = localId.x;

	var localMin = vec3f(1e30);
	var localMax = vec3f(-1e30);

	// Load partial results
	if (localIdx < uniforms.workgroupCount) {
		localMin = partialBoundsMin[localIdx].xyz;
		localMax = partialBoundsMax[localIdx].xyz;
	}

	sharedMin[localIdx] = localMin;
	sharedMax[localIdx] = localMax;

	workgroupBarrier();

	// Reduction
	for (var stride = WORKGROUP_SIZE / 2u; stride > 0u; stride = stride >> 1u) {
		if (localIdx < stride) {
			sharedMin[localIdx] = min(sharedMin[localIdx], sharedMin[localIdx + stride]);
			sharedMax[localIdx] = max(sharedMax[localIdx], sharedMax[localIdx + stride]);
		}
		workgroupBarrier();
	}

	// Write final result
	if (localIdx == 0u) {
		sceneBounds.min = sharedMin[0];
		sceneBounds.max = sharedMax[0];
	}
}
`
);
var reduceBoundsToPartialShader = (
  /* wgsl */
  `

struct Uniforms {
	primCount: u32,
	workgroupCount: u32,
	pad0: u32,
	pad1: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> partialBoundsMinIn: array<vec4f>;
@group(0) @binding(2) var<storage, read> partialBoundsMaxIn: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> partialBoundsMinOut: array<vec4f>;
@group(0) @binding(4) var<storage, read_write> partialBoundsMaxOut: array<vec4f>;

const WORKGROUP_SIZE: u32 = 256u;

var<workgroup> sharedMin: array<vec3f, WORKGROUP_SIZE>;
var<workgroup> sharedMax: array<vec3f, WORKGROUP_SIZE>;

@compute @workgroup_size(256)
fn reduceBoundsToPartial(
	@builtin(local_invocation_id) localId: vec3u,
	@builtin(workgroup_id) workgroupId: vec3u
) {
	let localIdx = localId.x;
	let base = workgroupId.x * WORKGROUP_SIZE;
	let idx = base + localIdx;

	var localMin = vec3f(1e30);
	var localMax = vec3f(-1e30);

	// Load partial results
	if (idx < uniforms.workgroupCount) {
		localMin = partialBoundsMinIn[idx].xyz;
		localMax = partialBoundsMaxIn[idx].xyz;
	}

	sharedMin[localIdx] = localMin;
	sharedMax[localIdx] = localMax;

	workgroupBarrier();

	// Reduction
	for (var stride = WORKGROUP_SIZE / 2u; stride > 0u; stride = stride >> 1u) {
		if (localIdx < stride) {
			sharedMin[localIdx] = min(sharedMin[localIdx], sharedMin[localIdx + stride]);
			sharedMax[localIdx] = max(sharedMax[localIdx], sharedMax[localIdx + stride]);
		}
		workgroupBarrier();
	}

	// Write reduced result
	if (localIdx == 0u) {
		partialBoundsMinOut[workgroupId.x] = vec4f(sharedMin[0], 0.0);
		partialBoundsMaxOut[workgroupId.x] = vec4f(sharedMax[0], 0.0);
	}
}
`
);
var computeMortonShader = (
  /* wgsl */
  `

struct Uniforms {
	primCount: u32,
	workgroupCount: u32,
	pad0: u32,
	pad1: u32,
};

struct BVH2Node {
	boundsMin: vec3f,
	leftChild: u32,
	boundsMax: vec3f,
	rightChild: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> bvh2Nodes: array<BVH2Node>;
// Atomic scene bounds in sortable-u32 format:
// [minX, minY, minZ, maxX, maxY, maxZ]
@group(0) @binding(2) var<storage, read> atomicSceneBounds: array<u32, 6>;
@group(0) @binding(3) var<storage, read_write> mortonCodes: array<u32>;

fn orderedU32ToF32(key: u32) -> f32 {
	let bits = select(key & 0x7FFFFFFFu, ~key, (key & 0x80000000u) == 0u);
	return bitcast<f32>(bits);
}

fn expandBits(v: u32) -> u32 {
	var x = v & 0x3FFu;
	x = (x | (x << 16u)) & 0x030000FFu;
	x = (x | (x << 8u)) & 0x0300F00Fu;
	x = (x | (x << 4u)) & 0x030C30C3u;
	x = (x | (x << 2u)) & 0x09249249u;
	return x;
}

fn computeMortonCode(normalizedPos: vec3f) -> u32 {
	let clamped = clamp(normalizedPos, vec3f(0.0), vec3f(1.0));
	let scaled = vec3u(clamped * 1023.0);

	let xx = expandBits(scaled.x);
	let yy = expandBits(scaled.y);
	let zz = expandBits(scaled.z);

	return (xx << 2u) | (yy << 1u) | zz;
}

@compute @workgroup_size(256)
fn computeMorton(
	@builtin(global_invocation_id) globalId: vec3u
) {
	let primIdx = globalId.x;

	if (primIdx >= uniforms.primCount) {
		return;
	}

	let node = bvh2Nodes[primIdx];
	let centroid = (node.boundsMin + node.boundsMax) * 0.5;

	// Decode scene bounds from sortable-u32 format.
	let sceneMin = vec3f(
		orderedU32ToF32(atomicSceneBounds[0]),
		orderedU32ToF32(atomicSceneBounds[1]),
		orderedU32ToF32(atomicSceneBounds[2])
	);
	let sceneMax = vec3f(
		orderedU32ToF32(atomicSceneBounds[3]),
		orderedU32ToF32(atomicSceneBounds[4]),
		orderedU32ToF32(atomicSceneBounds[5])
	);

	let sceneExtent = sceneMax - sceneMin;
	let safeExtent = select(sceneExtent, vec3f(1.0), sceneExtent == vec3f(0.0));

	let normalized = (centroid - sceneMin) / safeExtent;
	mortonCodes[primIdx] = computeMortonCode(normalized);
}
`
);
var computeBoundsSubgroupShader = (
  /* wgsl */
  `
enable subgroups;

struct Uniforms {
	primCount: u32,
	workgroupCount: u32,
	positionStride: u32,
	pad1: u32,
};

struct BVH2Node {
	boundsMin: vec3f,
	leftChild: u32,
	boundsMax: vec3f,
	rightChild: u32,
};

struct Bounds {
	min: vec3f,
	max: vec3f,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> positions: array<f32>;
@group(0) @binding(2) var<storage, read> indices: array<u32>;
@group(0) @binding(3) var<storage, read_write> bvh2Nodes: array<BVH2Node>;
@group(0) @binding(4) var<storage, read_write> clusterIdx: array<u32>;
@group(0) @binding(5) var<storage, read_write> atomicSceneBounds: array<atomic<u32>, 6>;
@group(0) @binding(6) var<storage, read_write> parentIdx: array<u32>;
@group(0) @binding(7) var<storage, read_write> hplocState: array<vec4u>;
@group(0) @binding(8) var<storage, read_write> activeList: array<u32>;

const INVALID_IDX: u32 = 0xFFFFFFFFu;
const WORKGROUP_SIZE: u32 = 256u;

// Shared memory sized for worst case (subgroupSize=1 means 256 subgroups)
// Most GPUs have subgroupSize=32, so only 8 slots used, but we need to be safe
var<workgroup> sharedMin: array<vec3f, WORKGROUP_SIZE>;
var<workgroup> sharedMax: array<vec3f, WORKGROUP_SIZE>;

fn f32ToOrderedU32(val: f32) -> u32 {
	let bits = bitcast<u32>(val);
	return select(bits | 0x80000000u, ~bits, (bits & 0x80000000u) != 0u);
}

fn atomicMinF32(idx: u32, val: f32) {
	atomicMin(&atomicSceneBounds[idx], f32ToOrderedU32(val));
}

fn atomicMaxF32(idx: u32, val: f32) {
	atomicMax(&atomicSceneBounds[idx], f32ToOrderedU32(val));
}

fn loadPosition(vertexIdx: u32) -> vec3f {
	let base = vertexIdx * uniforms.positionStride;
	return vec3f(positions[base], positions[base + 1u], positions[base + 2u]);
}

fn computeTriangleBounds(primIdx: u32) -> Bounds {
	let base = primIdx * 3u;
	let i0 = indices[base];
	let i1 = indices[base + 1u];
	let i2 = indices[base + 2u];

	let v0 = loadPosition(i0);
	let v1 = loadPosition(i1);
	let v2 = loadPosition(i2);

	var bounds: Bounds;
	bounds.min = min(min(v0, v1), v2);
	bounds.max = max(max(v0, v1), v2);
	return bounds;
}

@compute @workgroup_size(256)
fn computeBounds(
	@builtin(global_invocation_id) globalId: vec3u,
	@builtin(local_invocation_id) localId: vec3u,
	@builtin(subgroup_invocation_id) subgroupInvocationId: u32,
	@builtin(subgroup_size) subgroupSize: u32
) {
	let primIdx = globalId.x;
	let localIdx = localId.x;
	let subgroupIdx = localIdx / subgroupSize;

	var localMin = vec3f(1e30);
	var localMax = vec3f(-1e30);

	if (primIdx < uniforms.primCount) {
		let bounds = computeTriangleBounds(primIdx);

		// Store as leaf node
		var node: BVH2Node;
		node.boundsMin = bounds.min;
		node.boundsMax = bounds.max;
		node.leftChild = INVALID_IDX;
		node.rightChild = primIdx;
		bvh2Nodes[primIdx] = node;

		// Initialize cluster index
		clusterIdx[primIdx] = primIdx;

		// GPU-side initialization
		parentIdx[primIdx] = INVALID_IDX;

		// hplocState: vec4u(left, right, split, active) - single vectorized write
		hplocState[primIdx] = vec4u(primIdx, primIdx, 0u, 1u);

		// Initialize active list (folded from separate initActiveList dispatch)
		activeList[primIdx] = primIdx;

		localMin = bounds.min;
		localMax = bounds.max;
	}

	// Subgroup reduction - no barrier needed, hardware handles it
	let sgMinX = subgroupMin(localMin.x);
	let sgMinY = subgroupMin(localMin.y);
	let sgMinZ = subgroupMin(localMin.z);
	let sgMaxX = subgroupMax(localMax.x);
	let sgMaxY = subgroupMax(localMax.y);
	let sgMaxZ = subgroupMax(localMax.z);

	// subgroupSize is uniform within workgroup, so this is uniform (no barrier needed)
	let subgroupCount = WORKGROUP_SIZE / subgroupSize;

	// First thread of each subgroup writes to shared memory
	if (subgroupInvocationId == 0u) {
		sharedMin[subgroupIdx] = vec3f(sgMinX, sgMinY, sgMinZ);
		sharedMax[subgroupIdx] = vec3f(sgMaxX, sgMaxY, sgMaxZ);
	}

	workgroupBarrier();

	// Final reduction: tree reduction across subgroup results
	// Use fixed iteration count for uniform control flow (8 iterations covers up to 256 subgroups)
	// Each iteration halves the active range until only element 0 remains
	for (var s = 128u; s > 0u; s = s >> 1u) {
		// Only reduce if this stride is within our subgroup count
		if (s < subgroupCount && localIdx < s) {
			sharedMin[localIdx] = min(sharedMin[localIdx], sharedMin[localIdx + s]);
			sharedMax[localIdx] = max(sharedMax[localIdx], sharedMax[localIdx + s]);
		}
		workgroupBarrier();
	}

	// Thread 0 atomically updates global scene bounds
	if (localIdx == 0u) {
		let wgMin = sharedMin[0];
		let wgMax = sharedMax[0];
		atomicMinF32(0u, wgMin.x);
		atomicMinF32(1u, wgMin.y);
		atomicMinF32(2u, wgMin.z);
		atomicMaxF32(3u, wgMax.x);
		atomicMaxF32(4u, wgMax.y);
		atomicMaxF32(5u, wgMax.z);
	}
}
`
);
var setupShaders = {
  computeBounds: computeBoundsShader,
  computeBoundsSubgroup: computeBoundsSubgroupShader,
  reduceBounds: reduceBoundsShader,
  reduceBoundsToPartial: reduceBoundsToPartialShader,
  computeMorton: computeMortonShader
};

// vendor/webphysics/src/lvbh/shaders/radixSortShaders.ts
var histogramShader = (
  /* wgsl */
  `

struct Uniforms {
	primCount: u32,
	bitOffset: u32,
	workgroupCount: u32,
	pad1: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> keys: array<u32>;
@group(0) @binding(2) var<storage, read_write> groupCounts: array<u32>;
@group(0) @binding(3) var<storage, read_write> globalDigitCount: array<atomic<u32>>;

const WORKGROUP_SIZE: u32 = 256u;
const RADIX_SIZE: u32 = 256u;

var<workgroup> localHistogram: array<atomic<u32>, RADIX_SIZE>;

@compute @workgroup_size(256)
fn computeHistogram(
	@builtin(global_invocation_id) globalId: vec3u,
	@builtin(local_invocation_id) localId: vec3u,
	@builtin(workgroup_id) workgroupId: vec3u
) {
	let idx = globalId.x;
	let localIdx = localId.x;

	// Initialize local histogram
	if (localIdx < RADIX_SIZE) {
		atomicStore(&localHistogram[localIdx], 0u);
	}

	workgroupBarrier();

	// Count local occurrences
	if (idx < uniforms.primCount) {
		let key = keys[idx];
		let digit = (key >> uniforms.bitOffset) & 0xFFu;
		atomicAdd(&localHistogram[digit], 1u);
	}

	workgroupBarrier();

	// Store per-workgroup counts (not reservations - that was non-deterministic!)
	// Also accumulate global totals for digit base offset calculation
	if (localIdx < RADIX_SIZE) {
		let count = atomicLoad(&localHistogram[localIdx]);
		// Store count for workgroup scan to process in deterministic order
		groupCounts[workgroupId.x * RADIX_SIZE + localIdx] = count;
		// Accumulate global total for this digit
		atomicAdd(&globalDigitCount[localIdx], count);
	}
}
`
);
var workgroupScanShader = (
  /* wgsl */
  `

struct Uniforms {
	primCount: u32,
	bitOffset: u32,
	workgroupCount: u32,
	pad1: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> groupCounts: array<u32>;
@group(0) @binding(2) var<storage, read_write> groupPrefix: array<u32>;

const RADIX_SIZE: u32 = 256u;

@compute @workgroup_size(256)
fn workgroupScan(
	@builtin(local_invocation_id) localId: vec3u
) {
	let digit = localId.x;  // Each thread handles one digit (256 threads = 256 digits)

	// Compute exclusive prefix sum across all workgroups for this digit
	// This is O(workgroupCount) per thread, but ensures deterministic ordering
	var sum = 0u;
	for (var wg = 0u; wg < uniforms.workgroupCount; wg++) {
		let count = groupCounts[wg * RADIX_SIZE + digit];
		groupPrefix[wg * RADIX_SIZE + digit] = sum;  // Exclusive prefix
		sum += count;
	}
}
`
);
var scanShader = (
  /* wgsl */
  `

@group(0) @binding(1) var<storage, read> globalDigitCount: array<u32>;
@group(0) @binding(2) var<storage, read_write> digitOffsets: array<u32>;

const RADIX_SIZE: u32 = 256u;

var<workgroup> sharedScan: array<u32, RADIX_SIZE>;

@compute @workgroup_size(256)
fn prefixScan(
	@builtin(local_invocation_id) localId: vec3u
) {
	let idx = localId.x;

	// Load digit counts
	sharedScan[idx] = globalDigitCount[idx];
	workgroupBarrier();

	// Hillis-Steele inclusive prefix sum (log2(256) = 8 iterations)
	for (var stride = 1u; stride < RADIX_SIZE; stride = stride * 2u) {
		var addVal = 0u;
		if (idx >= stride) {
			addVal = sharedScan[idx - stride];
		}
		workgroupBarrier();
		sharedScan[idx] = sharedScan[idx] + addVal;
		workgroupBarrier();
	}

	// Convert inclusive to exclusive prefix sum and store
	if (idx == 0u) {
		digitOffsets[0] = 0u;
	} else {
		digitOffsets[idx] = sharedScan[idx - 1u];
	}
}
`
);
var scatterShader = (
  /* wgsl */
  `

struct Uniforms {
	primCount: u32,
	bitOffset: u32,
	workgroupCount: u32,
	pad1: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> keysIn: array<u32>;
@group(0) @binding(2) var<storage, read_write> keysOut: array<u32>;
@group(0) @binding(3) var<storage, read> valsIn: array<u32>;
@group(0) @binding(4) var<storage, read_write> valsOut: array<u32>;
@group(0) @binding(5) var<storage, read> groupPrefix: array<u32>;
@group(0) @binding(6) var<storage, read> digitOffsets: array<u32>;

const WORKGROUP_SIZE: u32 = 256u;
const RADIX_SIZE: u32 = 256u;

var<workgroup> sharedDigits: array<u32, WORKGROUP_SIZE>;
var<workgroup> sharedRanks: array<u32, WORKGROUP_SIZE>;
var<workgroup> digitCounts: array<u32, RADIX_SIZE>;

@compute @workgroup_size(256)
fn scatter(
	@builtin(global_invocation_id) globalId: vec3u,
	@builtin(local_invocation_id) localId: vec3u,
	@builtin(workgroup_id) workgroupId: vec3u
) {
	let idx = globalId.x;
	let localIdx = localId.x;
	let valid = idx < uniforms.primCount;

	var digit = 0xFFFFFFFFu;
	if (valid) {
		let key = keysIn[idx];
		digit = (key >> uniforms.bitOffset) & 0xFFu;
	}

	sharedDigits[localIdx] = digit;
	workgroupBarrier();

	// Thread 0 computes all ranks in single O(n) pass
	// This maintains stability: threads are processed in order
	if (localIdx == 0u) {
		// Zero digit counts
		for (var d = 0u; d < RADIX_SIZE; d = d + 1u) {
			digitCounts[d] = 0u;
		}
		// Assign ranks in thread order (stable)
		for (var i = 0u; i < WORKGROUP_SIZE; i = i + 1u) {
			let d = sharedDigits[i];
			if (d < RADIX_SIZE) {
				sharedRanks[i] = digitCounts[d];
				digitCounts[d] = digitCounts[d] + 1u;
			} else {
				sharedRanks[i] = 0u;
			}
		}
	}
	workgroupBarrier();

	if (!valid) {
		return;
	}

	let localRank = sharedRanks[localIdx];
	let key = keysIn[idx];
	let val = valsIn[idx];
	let groupOffset = groupPrefix[workgroupId.x * RADIX_SIZE + digit];
	let baseOffset = digitOffsets[digit];
	let destIdx = baseOffset + groupOffset + localRank;

	keysOut[destIdx] = key;
	valsOut[destIdx] = val;
}
`
);
var radixSortShaders = {
  histogram: histogramShader,
  workgroupScan: workgroupScanShader,
  scan: scanShader,
  scatter: scatterShader
};

// vendor/webphysics/src/lvbh/shaders/lbvhShaders.ts
var WORKGROUP_SIZE4 = 256;
var lbvhInitStateShader = (
  /* wgsl */
  `
struct Uniforms {
  primCount: u32,
  _pad0: u32,
  _pad1: u32,
  _pad2: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read_write> parentIdx: array<u32>;
@group(0) @binding(2) var<storage, read_write> visitCount: array<atomic<u32>>;

const INVALID_IDX: u32 = 0xFFFFFFFFu;

@compute @workgroup_size(${WORKGROUP_SIZE4})
fn initState(@builtin(global_invocation_id) globalId: vec3u) {
  let idx = globalId.x;
  let maxNodes = uniforms.primCount * 2u;
  if (idx >= maxNodes) {
    return;
  }

  parentIdx[idx] = INVALID_IDX;
  atomicStore(&visitCount[idx], 0u);
}
`
);
var lbvhBuildTopologyShader = (
  /* wgsl */
  `
struct Uniforms {
  primCount: u32,
  _pad0: u32,
  _pad1: u32,
  _pad2: u32,
};

struct BVH2Node {
  boundsMin: vec3f,
  leftChild: u32,
  boundsMax: vec3f,
  rightChild: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> mortonCodes: array<u32>;
@group(0) @binding(2) var<storage, read> clusterIdx: array<u32>;
@group(0) @binding(3) var<storage, read_write> bvh2Nodes: array<BVH2Node>;
@group(0) @binding(4) var<storage, read_write> parentIdx: array<u32>;

const INVALID_IDX: u32 = 0xFFFFFFFFu;

fn delta(idx: i32, other: i32, n: i32) -> i32 {
  if (other < 0 || other >= n) {
    return -1;
  }

  let a = u32(idx);
  let b = u32(other);
  let ka = mortonCodes[a];
  let kb = mortonCodes[b];

  if (ka == kb) {
    return 32 + i32(countLeadingZeros(a ^ b));
  }

  return i32(countLeadingZeros(ka ^ kb));
}

fn determineRange(idx: i32, n: i32) -> vec2i {
  if (idx == 0) {
    return vec2i(0, n - 1);
  }

  let deltaLeft = delta(idx, idx - 1, n);
  let deltaRight = delta(idx, idx + 1, n);
  let direction = select(-1, 1, deltaRight > deltaLeft);

  let deltaMin = delta(idx, idx - direction, n);
  var lMax = 2;
  loop {
    let nextIdx = idx + lMax * direction;
    if (delta(idx, nextIdx, n) <= deltaMin) {
      break;
    }
    lMax = lMax * 2;
  }

  var length = 0;
  var t = lMax / 2;
  loop {
    if (t <= 0) {
      break;
    }

    let nextLength = length + t;
    let nextIdx = idx + nextLength * direction;
    if (delta(idx, nextIdx, n) > deltaMin) {
      length = nextLength;
    }

    t = t / 2;
  }

  let j = idx + length * direction;
  if (direction < 0) {
    return vec2i(j, idx);
  }

  return vec2i(idx, j);
}

fn findSplit(first: i32, last: i32, n: i32) -> i32 {
  let commonPrefix = delta(first, last, n);
  var split = first;
  var step = last - first;

  loop {
    step = (step + 1) / 2;
    if (step <= 0) {
      break;
    }

    let candidate = split + step;
    if (candidate < last && delta(first, candidate, n) > commonPrefix) {
      split = candidate;
    }

    if (step == 1) {
      break;
    }
  }

  return split;
}

@compute @workgroup_size(${WORKGROUP_SIZE4})
fn buildTopology(@builtin(global_invocation_id) globalId: vec3u) {
  let internalId = globalId.x;
  if (uniforms.primCount <= 1u || internalId >= uniforms.primCount - 1u) {
    return;
  }

  let n = i32(uniforms.primCount);
  let idx = i32(internalId);
  let range = determineRange(idx, n);
  let split = findSplit(range.x, range.y, n);

  let nodeIdx = uniforms.primCount + internalId;

  var leftChild = INVALID_IDX;
  if (split == range.x) {
    leftChild = clusterIdx[u32(split)];
  } else {
    leftChild = uniforms.primCount + u32(split);
  }

  var rightChild = INVALID_IDX;
  if (split + 1 == range.y) {
    rightChild = clusterIdx[u32(split + 1)];
  } else {
    rightChild = uniforms.primCount + u32(split + 1);
  }

  var node = bvh2Nodes[nodeIdx];
  node.leftChild = leftChild;
  node.rightChild = rightChild;
  bvh2Nodes[nodeIdx] = node;

  parentIdx[leftChild] = nodeIdx;
  parentIdx[rightChild] = nodeIdx;
}
`
);
var lbvhSeedInternalShader = (
  /* wgsl */
  `
struct Uniforms {
  primCount: u32,
  _pad0: u32,
  _pad1: u32,
  _pad2: u32,
};

struct BVH2Node {
  boundsMin: vec3f,
  leftChild: u32,
  boundsMax: vec3f,
  rightChild: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> clusterIdx: array<u32>;
@group(0) @binding(2) var<storage, read> parentIdx: array<u32>;
@group(0) @binding(3) var<storage, read_write> visitCount: array<atomic<u32>>;
@group(0) @binding(4) var<storage, read_write> activeListOut: array<u32>;
@group(0) @binding(5) var<storage, read_write> activeCountOut: atomic<u32>;

const INVALID_IDX: u32 = 0xFFFFFFFFu;

@compute @workgroup_size(${WORKGROUP_SIZE4})
fn seedInternal(@builtin(global_invocation_id) globalId: vec3u) {
  let sortedLeafIdx = globalId.x;
  if (sortedLeafIdx >= uniforms.primCount) {
    return;
  }

  let leafNodeIdx = clusterIdx[sortedLeafIdx];
  let parent = parentIdx[leafNodeIdx];
  if (parent == INVALID_IDX) {
    return;
  }

  // First child arrival stores 0 -> 1, second stores 1 -> 2.
  // Only second arrival can enqueue this internal node as ready.
  let previous = atomicAdd(&visitCount[parent], 1u);
  if (previous == 1u) {
    let writeIdx = atomicAdd(&activeCountOut, 1u);
    activeListOut[writeIdx] = parent;
  }
}
`
);
var lbvhRefitWaveShader = (
  /* wgsl */
  `
struct Uniforms {
  primCount: u32,
  _pad0: u32,
  _pad1: u32,
  _pad2: u32,
};

struct BVH2Node {
  boundsMin: vec3f,
  leftChild: u32,
  boundsMax: vec3f,
  rightChild: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read_write> bvh2Nodes: array<BVH2Node>;
@group(0) @binding(2) var<storage, read> parentIdx: array<u32>;
@group(0) @binding(3) var<storage, read_write> visitCount: array<atomic<u32>>;
@group(0) @binding(4) var<storage, read> activeListIn: array<u32>;
@group(0) @binding(5) var<storage, read_write> activeListOut: array<u32>;
@group(0) @binding(6) var<storage, read_write> activeCountIn: atomic<u32>;
@group(0) @binding(7) var<storage, read_write> activeCountOut: atomic<u32>;

const INVALID_IDX: u32 = 0xFFFFFFFFu;

@compute @workgroup_size(${WORKGROUP_SIZE4})
fn refitWave(@builtin(global_invocation_id) globalId: vec3u) {
  // Keep the uniform binding live in auto-layout.
  if (uniforms.primCount == 0u) {
    return;
  }

  let idx = globalId.x;
  let activeCount = atomicLoad(&activeCountIn);
  if (idx >= activeCount) {
    return;
  }

  let nodeIdx = activeListIn[idx];
  if (nodeIdx == INVALID_IDX) {
    return;
  }

  let node = bvh2Nodes[nodeIdx];
  let c0 = node.leftChild;
  let c1 = node.rightChild;
  if (c0 == INVALID_IDX || c1 == INVALID_IDX) {
    return;
  }

  let mergedMin = min(bvh2Nodes[c0].boundsMin, bvh2Nodes[c1].boundsMin);
  let mergedMax = max(bvh2Nodes[c0].boundsMax, bvh2Nodes[c1].boundsMax);
  bvh2Nodes[nodeIdx].boundsMin = mergedMin;
  bvh2Nodes[nodeIdx].boundsMax = mergedMax;

  let parent = parentIdx[nodeIdx];
  if (parent == INVALID_IDX) {
    return;
  }

  let previous = atomicAdd(&visitCount[parent], 1u);
  if (previous == 1u) {
    let writeIdx = atomicAdd(&activeCountOut, 1u);
    activeListOut[writeIdx] = parent;
  }
}
`
);
var lbvhUpdateDispatchShader = (
  /* wgsl */
  `
@group(0) @binding(0) var<storage, read_write> activeCountIn: atomic<u32>;
@group(0) @binding(1) var<storage, read_write> indirectDispatch: array<u32>;
@group(0) @binding(2) var<storage, read_write> activeCountOut: atomic<u32>;

const WORKGROUP_SIZE: u32 = ${WORKGROUP_SIZE4}u;

@compute @workgroup_size(1)
fn updateDispatch() {
  let count = atomicLoad(&activeCountIn);
  let workgroups = (count + WORKGROUP_SIZE - 1u) / WORKGROUP_SIZE;
  indirectDispatch[0] = workgroups;
  indirectDispatch[1] = 1u;
  indirectDispatch[2] = 1u;
  atomicStore(&activeCountOut, 0u);
}
`
);
var lbvhFinalizeShader = (
  /* wgsl */
  `
struct Uniforms {
  primCount: u32,
  _pad0: u32,
  _pad1: u32,
  _pad2: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read_write> clusterIdx: array<u32>;
@group(0) @binding(2) var<storage, read_write> nodeCounter: atomic<u32>;

@compute @workgroup_size(1)
fn finalizeTree() {
  if (uniforms.primCount == 0u) {
    atomicStore(&nodeCounter, 0u);
    return;
  }

  let rootIdx = select(0u, uniforms.primCount, uniforms.primCount > 1u);
  clusterIdx[0] = rootIdx;
  atomicStore(&nodeCounter, uniforms.primCount * 2u - 1u);
}
`
);

// vendor/webphysics/src/lvbh/sorting/BaseSorter.js
var BaseSorter = class {
  constructor(device) {
    this.device = device;
    this.name = "BaseSorter";
    this._initialized = false;
  }
  /**
   * Initialize the sorter (create pipelines, allocate buffers)
   * @param {number} maxKeys - Maximum number of keys to sort
   * @returns {Promise<void>}
   */
  async init(_maxKeys) {
    void _maxKeys;
    throw new Error("BaseSorter.init() must be implemented by subclass");
  }
  /**
   * Sort keys and values in place (or into output buffers)
   * @param {Object} params
   * @param {GPUCommandEncoder} params.commandEncoder - Command encoder to record commands to
   * @param {GPUBuffer} params.keysIn - Input keys buffer
   * @param {GPUBuffer} params.keysOut - Output keys buffer (may be same as keysIn)
   * @param {GPUBuffer} params.valsIn - Input values buffer
   * @param {GPUBuffer} params.valsOut - Output values buffer (may be same as valsIn)
   * @param {number} params.count - Number of elements to sort
   * @param {GPUBuffer} [params.uniforms] - Optional uniforms buffer
   * @param {number} [params.uniformOffset] - Offset into uniforms buffer
   * @returns {Object} - { keysResult, valsResult } - buffers containing sorted results
   */
  sort(_params) {
    void _params;
    throw new Error("BaseSorter.sort() must be implemented by subclass");
  }
  /**
   * Dispose of GPU resources
   */
  dispose() {
  }
  /**
   * Get timing information from last sort (if available)
   * @returns {Object|null}
   */
  getTimings() {
    return null;
  }
};

// vendor/webphysics/src/lvbh/sorting/shaders/onesweep.wgsl.js
var oneSweep16Shader = `
//****************************************************************************
// GPUSorting
// OneSweep - WaveSize 16-32 variant
//
// SPDX-License-Identifier: MIT
// Copyright Thomas Smith 12/7/2024
// https://github.com/b0nes164/GPUSorting
//
// Modified for WGSL compatibility and variable subgroup sizes by Dino Metarapi, 2025
// Based on original work by Thomas Smith
//
// NOTE: This shader uses ballot.x (32 bits) for peer masks, so it only works
// for lane_count <= 32. For lane_count > 32, use the wave64 variant.
//****************************************************************************

enable subgroups;

@diagnostic(off, subgroup_uniformity)
fn unsafeSubgroupInclusiveAdd(x: u32) -> u32 { return subgroupInclusiveAdd(x); }

@diagnostic(off, subgroup_uniformity)
fn unsafeSubgroupExclusiveAdd(x: u32) -> u32 { return subgroupExclusiveAdd(x); }

@diagnostic(off, subgroup_uniformity)
fn unsafeSubgroupShuffle(x: u32, source: u32) -> u32 { return subgroupShuffle(x, source); }

@diagnostic(off, subgroup_uniformity)
fn unsafeSubgroupBallot(pred: bool) -> vec4<u32> { return subgroupBallot(pred); }

@diagnostic(off, subgroup_uniformity)
fn unsafeSubgroupAdd(x: u32) -> u32 { return subgroupAdd(x); }

struct InfoStruct
{
    size: u32,
    shift: u32,
    thread_blocks: u32,
    seed: u32,
};

@group(0) @binding(0)
var<uniform> info : InfoStruct;

@group(0) @binding(1)
var<storage, read_write> bump: array<atomic<u32>>;

@group(0) @binding(2)
var<storage, read_write> sort: array<u32>;

@group(0) @binding(3)
var<storage, read_write> alt: array<u32>;

@group(0) @binding(4)
var<storage, read_write> payload: array<u32>;

@group(0) @binding(5)
var<storage, read_write> alt_payload: array<u32>;

@group(0) @binding(6)
var<storage, read_write> hist: array<atomic<u32>>;

@group(0) @binding(7)
var<storage, read_write> pass_hist: array<atomic<u32>>;

@group(0) @binding(8)
var<storage, read_write> status: array<u32>;

const SORT_PASSES = 4u;
const BLOCK_DIM = 256u;
const MIN_SUBGROUP_SIZE = 16u;
const MAX_SUBGROUP_SIZE_W16 = 32u;  // ballot.x is only 32 bits - wave16 max
const MAX_REDUCE_SIZE = BLOCK_DIM / MIN_SUBGROUP_SIZE;

const STATUS_ERR_GLOBAL_HIST = 0u;
const STATUS_ERR_SCAN = 1u;
const STATUS_ERR_PASS = 2u;
const STATUS_ERR_LANE_COUNT = 3u;

const FLAG_NOT_READY = 0u;
const FLAG_REDUCTION = 1u;
const FLAG_INCLUSIVE = 2u;
const FLAG_MASK = 3u;

const RADIX = 256u;
const ALL_RADIX = RADIX * SORT_PASSES;
const RADIX_MASK = 255u;
const RADIX_LOG = 8u;

const KEYS_PER_THREAD = 15u;
const PART_SIZE = KEYS_PER_THREAD * BLOCK_DIM;

const REDUCE_BLOCK_DIM = 128u;
const REDUCE_KEYS_PER_THREAD = 30u;
const REDUCE_HIST_SIZE = REDUCE_BLOCK_DIM / MIN_SUBGROUP_SIZE * ALL_RADIX;
const REDUCE_PART_SIZE = REDUCE_KEYS_PER_THREAD * REDUCE_BLOCK_DIM;

const MAX_SUBGROUPS_PER_BLOCK = BLOCK_DIM / MIN_SUBGROUP_SIZE;
const WARP_HIST_CAPACITY = MAX_SUBGROUPS_PER_BLOCK * RADIX;

var<workgroup> wg_globalHist: array<atomic<u32>, REDUCE_HIST_SIZE>;

@compute @workgroup_size(REDUCE_BLOCK_DIM, 1, 1)
fn global_hist(
    @builtin(local_invocation_id) threadid: vec3<u32>,
    @builtin(subgroup_invocation_id) laneid: u32,
    @builtin(subgroup_size) lane_count: u32,
    @builtin(workgroup_id) wgid: vec3<u32>) {

    if (lane_count < MIN_SUBGROUP_SIZE || (REDUCE_BLOCK_DIM % lane_count) != 0u) {
        if (threadid.x == 0u) {
            status[STATUS_ERR_GLOBAL_HIST] = 0xDEAD0001u;
        }
        return;
    }

    let sid = threadid.x / lane_count;

    //Clear shared memory
    for (var i = threadid.x; i < REDUCE_HIST_SIZE; i += REDUCE_BLOCK_DIM) {
        atomicStore(&wg_globalHist[i], 0u);
    }
    workgroupBarrier();

    let radix_shift = info.shift;
    let hist_offset = sid * ALL_RADIX;
    {
        var i = threadid.x + wgid.x * REDUCE_PART_SIZE;
        if(wgid.x < info.thread_blocks - 1) {
            for (var k = 0u; k < REDUCE_KEYS_PER_THREAD; k += 1u) {
                let key = sort[i];
                atomicAdd(&wg_globalHist[(key & RADIX_MASK) + hist_offset], 1u);
                atomicAdd(&wg_globalHist[((key >> 8u) & RADIX_MASK) + hist_offset + 256u], 1u);
                atomicAdd(&wg_globalHist[((key >> 16u) & RADIX_MASK) + hist_offset + 512u], 1u);
                atomicAdd(&wg_globalHist[((key >> 24u) & RADIX_MASK) + hist_offset + 768u], 1u);
                i += REDUCE_BLOCK_DIM;
            }
        }

        if(wgid.x == info.thread_blocks - 1) {
            for (var k = 0u; k < REDUCE_KEYS_PER_THREAD; k += 1u) {
                if (i < info.size) {
                    let key = sort[i];
                    atomicAdd(&wg_globalHist[(key & RADIX_MASK) + hist_offset], 1u);
                    atomicAdd(&wg_globalHist[((key >> 8u) & RADIX_MASK) + hist_offset + 256u], 1u);
                    atomicAdd(&wg_globalHist[((key >> 16u) & RADIX_MASK) + hist_offset + 512u], 1u);
                    atomicAdd(&wg_globalHist[((key >> 24u) & RADIX_MASK) + hist_offset + 768u], 1u);
                }
                i += REDUCE_BLOCK_DIM;
            }
        }
    }
    workgroupBarrier();

    // Merge subgroup histograms
    let subgroup_histograms = REDUCE_BLOCK_DIM / lane_count;
    for(var i = threadid.x; i < RADIX; i += REDUCE_BLOCK_DIM) {
        var reduction0 = atomicLoad(&wg_globalHist[i]);
        var reduction1 = atomicLoad(&wg_globalHist[i + 256u]);
        var reduction2 = atomicLoad(&wg_globalHist[i + 512u]);
        var reduction3 = atomicLoad(&wg_globalHist[i + 768u]);

        for (var h = 1u; h < subgroup_histograms; h += 1u) {
            let idx = h * ALL_RADIX;
            reduction0 += atomicLoad(&wg_globalHist[i + idx]);
            reduction1 += atomicLoad(&wg_globalHist[i + 256u + idx]);
            reduction2 += atomicLoad(&wg_globalHist[i + 512u + idx]);
            reduction3 += atomicLoad(&wg_globalHist[i + 768u + idx]);
        }

        atomicAdd(&hist[i], reduction0);
        atomicAdd(&hist[i + 256u], reduction1);
        atomicAdd(&hist[i + 512u], reduction2);
        atomicAdd(&hist[i + 768u], reduction3);
    }
}

//Assumes block dim 256
const SCAN_MEM_SIZE = RADIX / MIN_SUBGROUP_SIZE;
var<workgroup> wg_scan: array<u32, SCAN_MEM_SIZE>;
@compute @workgroup_size(BLOCK_DIM, 1, 1)
fn onesweep_scan(
    @builtin(local_invocation_id) threadid: vec3<u32>,
    @builtin(subgroup_invocation_id) laneid: u32,
    @builtin(subgroup_size) lane_count: u32,
    @builtin(workgroup_id) wgid: vec3<u32>) {

    if (lane_count < MIN_SUBGROUP_SIZE || (BLOCK_DIM % lane_count) != 0u) {
        if (threadid.x == 0u) {
            status[STATUS_ERR_SCAN] = 0xDEAD0002u;
        }
        return;
    }

    let sid = threadid.x / lane_count;
    let pass_plane = info.shift >> 3u;
    let hist_index = threadid.x + pass_plane * RADIX;
    let scan = atomicLoad(&hist[hist_index]);
    let red = unsafeSubgroupAdd(scan);
    if(laneid == 0u){
        wg_scan[sid] = red;
    }
    workgroupBarrier();

    //Non-divergent subgroup agnostic inclusive scan across subgroup reductions
    {
        var offset0 = 0u;
        var offset1 = 0u;
        let lane_log = u32(countTrailingZeros(lane_count));
        let spine_size = BLOCK_DIM >> lane_log;
        let aligned_size = 1u << ((u32(countTrailingZeros(spine_size)) + lane_log - 1u) / lane_log * lane_log);
        for(var j = lane_count; j <= aligned_size; j <<= lane_log){
            let i0 = ((threadid.x + offset0) << offset1) - select(0u, 1u, j != lane_count);
            let pred0 = i0 < spine_size;
            let t0 = unsafeSubgroupInclusiveAdd(select(0u, wg_scan[i0], pred0));
            if(pred0){
                wg_scan[i0] = t0;
            }
            workgroupBarrier();

            if(j != lane_count){
                let rshift = j >> lane_log;
                let i1 = threadid.x + rshift;
                if ((i1 & (j - 1u)) >= rshift){
                    let pred1 = i1 < spine_size;
                    let t1 = select(0u, wg_scan[((i1 >> offset1) << offset1) - 1u], pred1);
                    if(pred1 && ((i1 + 1u) & (rshift - 1u)) != 0u){
                        wg_scan[i1] += t1;
                    }
                }
            } else {
                offset0 += 1u;
            }
            offset1 += lane_log;
        }
    }
    workgroupBarrier();

    if (wgid.x != 0u) {
        return;
    }

    let plane_stride = info.thread_blocks * RADIX;
    let pass_index = threadid.x + pass_plane * plane_stride;
    let subgroup_prefix = unsafeSubgroupExclusiveAdd(scan);
    var spine_prefix = 0u;
    if (sid > 0u) {
        spine_prefix = wg_scan[sid - 1u];
    }
    atomicStore(&pass_hist[pass_index], ((subgroup_prefix + spine_prefix) << 2u) | FLAG_INCLUSIVE);
}

var<workgroup> wg_subgroupHist: array<atomic<u32>, WARP_HIST_CAPACITY>;
var<workgroup> wg_localHist: array<u32, RADIX>;
var<workgroup> wg_broadcast: u32;

// Wave16 WLMS: uses ballot.x (32 bits) - only valid for lane_count <= 32
fn WLMS(key: u32, shift: u32, laneid: u32, lane_count: u32, lane_mask_lt: u32, s_offset: u32, key_valid: bool) -> u32 {
    // FIX: Compute valid_mask FIRST to exclude invalid lanes from peer groups.
    // Without this, invalid lanes (key_valid=false) look like "bit=0" lanes during ballot,
    // allowing them to join peer groups with valid keys. If an invalid lane becomes
    // highest_rank_peer, the atomicAdd is skipped (gated by key_valid), causing missing
    // histogram increments \u2192 offset collisions \u2192 duplicates/missing elements.
    let valid_mask = unsafeSubgroupBallot(key_valid).x;

    var eq_mask = 0xffffffffu;
    for (var k = 0u; k < RADIX_LOG; k += 1u) {
        let curr_bit = 1u << (k + shift);
        let pred = key_valid && ((key & curr_bit) != 0u);
        let ballot = unsafeSubgroupBallot(pred);
        eq_mask &= select(~ballot.x, ballot.x, pred);
    }

    // Remove invalid lanes from the peer group (critical fix for partial last partitions)
    eq_mask &= valid_mask;

    var subgroup_mask = 0xffffffffu;
    if (lane_count != 32u) {
        subgroup_mask = (1u << lane_count) - 1u;
    }
    eq_mask &= subgroup_mask;

    if (!key_valid) {
        eq_mask = 0u;
    }
    var out = countOneBits(eq_mask & lane_mask_lt);
    let highest_rank_peer = select(lane_count - 1u, 31u - countLeadingZeros(eq_mask), eq_mask != 0u);
    var pre_inc = 0u;
    if (key_valid && eq_mask != 0u && laneid == highest_rank_peer) {
        pre_inc = atomicAdd(&wg_subgroupHist[((key >> shift) & RADIX_MASK) + s_offset], out + 1u);
    }
    workgroupBarrier();
    // Call shuffle unconditionally to maintain uniform control flow across subgroup.
    // Divergent subgroup ops (when some lanes skip due to keyValid=false) cause undefined behavior.
    let bcast = unsafeSubgroupShuffle(pre_inc, highest_rank_peer);
    // Only apply it for real keys / real peer groups
    out += select(0u, bcast, eq_mask != 0u);
    return select(0u, out, key_valid);
}

fn fake_wlms(key: u32, shift: u32, laneid: u32, lane_count: u32, lane_mask_lt: u32, s_offset: u32) -> u32 {
    return 0u;
}

@compute @workgroup_size(BLOCK_DIM, 1, 1)
fn onesweep_pass(
    @builtin(local_invocation_id) threadid: vec3<u32>,
    @builtin(subgroup_invocation_id) laneid: u32,
    @builtin(subgroup_size) lane_count: u32) {

    let shift = info.shift;
    let sid = threadid.x / lane_count;

    // CRITICAL: This wave16 shader uses ballot.x (32 bits only) for peer masks.
    // If lane_count > 32, the ballot mask would miss lanes 32+, causing corruption.
    // Also lane_mask_lt = (1u << laneid) - 1u overflows for laneid >= 32.
    if (lane_count > MAX_SUBGROUP_SIZE_W16) {
        if (threadid.x == 0u) {
            status[STATUS_ERR_LANE_COUNT] = 0xDEAD0016u | (lane_count << 16u);
        }
        return;
    }

    let subgroup_hist_size = (BLOCK_DIM / lane_count) * RADIX;
    if (subgroup_hist_size > WARP_HIST_CAPACITY) {
        if (threadid.x == 0u) {
            status[STATUS_ERR_PASS] = 0xDEAD0004u;
        }
        return;
    }

    for (var i = threadid.x; i < subgroup_hist_size; i += BLOCK_DIM) {
        atomicStore(&wg_subgroupHist[i], 0u);
    }
    workgroupBarrier();

    if (threadid.x == 0u) {
        wg_broadcast = atomicAdd(&bump[shift >> 3u], 1u);
    }
    // Explicit barrier to ensure wg_broadcast is visible to all threads
    workgroupBarrier();
    let partid = wg_broadcast;

    var keys = array<u32, KEYS_PER_THREAD>();
    var values = array<u32, KEYS_PER_THREAD>();
    var keyValid = array<bool, KEYS_PER_THREAD>();
    {
        let dev_offset = partid * PART_SIZE;
        let lane_stride = sid * lane_count * KEYS_PER_THREAD;
        var idx = laneid + lane_stride + dev_offset;
        if (partid < info.thread_blocks - 1u) {
            for (var k = 0u; k < KEYS_PER_THREAD; k += 1u) {
                keys[k] = sort[idx];
                values[k] = payload[idx];
                keyValid[k] = true;
                idx += lane_count;
            }
        } else {
            for (var k = 0u; k < KEYS_PER_THREAD; k += 1u) {
                if (idx < info.size) {
                    keys[k] = sort[idx];
                    values[k] = payload[idx];
                    keyValid[k] = true;
                } else {
                    keys[k] = 0xffffffffu;
                    values[k] = 0xffffffffu;
                    keyValid[k] = false;
                }
                idx += lane_count;
            }
        }
    }

    var offsets = array<u32, KEYS_PER_THREAD>();
    {
        let lane_mask_lt = (1u << laneid) - 1u;
        let hist_offset = sid * RADIX;
        for (var k = 0u; k < KEYS_PER_THREAD; k += 1u) {
            offsets[k] = WLMS(keys[k], shift, laneid, lane_count, lane_mask_lt, hist_offset, keyValid[k]);
        }
    }
    workgroupBarrier();

    var local_reduction = 0u;
    if (threadid.x < RADIX) {
        local_reduction = atomicLoad(&wg_subgroupHist[threadid.x]);
        var subtotal = local_reduction;
        for (var i = threadid.x + RADIX; i < subgroup_hist_size; i += RADIX) {
            let current = atomicLoad(&wg_subgroupHist[i]);
            atomicStore(&wg_subgroupHist[i], subtotal);
            subtotal += current;
        }
        local_reduction = subtotal;

        if (partid < info.thread_blocks - 1u) {
            let pass_plane = shift >> 3u;
            let pass_index = threadid.x + pass_plane * info.thread_blocks * RADIX + (partid + 1u) * RADIX;
            atomicStore(&pass_hist[pass_index], (local_reduction << 2u) | FLAG_REDUCTION);
        }

        let lane_mask = lane_count - 1u;
        let circular_lane_shift = (laneid + lane_mask) & lane_mask;
        let t = unsafeSubgroupInclusiveAdd(local_reduction);
        wg_localHist[threadid.x] = unsafeSubgroupShuffle(t, circular_lane_shift);
    }
    workgroupBarrier();

    if (threadid.x < lane_count) {
        let pred = threadid.x < RADIX / lane_count;
        let t = unsafeSubgroupExclusiveAdd(select(0u, wg_localHist[threadid.x * lane_count], pred));
        if (pred) {
            wg_localHist[threadid.x * lane_count] = t;
        }
    }
    workgroupBarrier();

    if (threadid.x < RADIX && laneid != 0u) {
        wg_localHist[threadid.x] += wg_localHist[(threadid.x / lane_count) * lane_count];
    }
    workgroupBarrier();

    for (var k = 0u; k < KEYS_PER_THREAD; k += 1u) {
        if (keyValid[k]) {
            let digit = (keys[k] >> shift) & RADIX_MASK;
            let block_prefix = wg_localHist[digit];
            if (sid == 0u) {
                offsets[k] += block_prefix;
            } else {
                let subgroup_prefix = atomicLoad(&wg_subgroupHist[digit + sid * RADIX]);
                offsets[k] += block_prefix + subgroup_prefix;
            }
        }
    }
    workgroupBarrier();

    if (threadid.x < RADIX) {
        let pass_plane = shift >> 3u;
        let base_plane = pass_plane * info.thread_blocks * RADIX;
        let bin = threadid.x;
        let block_prefix = wg_localHist[bin];
        var prev_reduction = 0u;
        var lookbackid = partid;
        loop {
            let flag_payload = atomicLoad(&pass_hist[bin + base_plane + lookbackid * RADIX]);
            if ((flag_payload & FLAG_MASK) > FLAG_NOT_READY) {
                prev_reduction += flag_payload >> 2u;
                if ((flag_payload & FLAG_MASK) == FLAG_INCLUSIVE) {
                    if (partid < info.thread_blocks - 1u) {
                        let next_idx = bin + base_plane + (partid + 1u) * RADIX;
                        atomicStore(&pass_hist[next_idx], ((prev_reduction + local_reduction) << 2u) | FLAG_INCLUSIVE);
                    }
                    wg_localHist[bin] = prev_reduction - block_prefix;
                    break;
                } else {
                    lookbackid -= 1u;
                }
            }
        }
    }
    workgroupBarrier();

    for (var k = 0u; k < KEYS_PER_THREAD; k += 1u) {
        if (keyValid[k]) {
            let digit = (keys[k] >> shift) & RADIX_MASK;
            let global_offset = wg_localHist[digit] + offsets[k];
            if (global_offset < info.size) {
                alt[global_offset] = keys[k];
                alt_payload[global_offset] = values[k];
            }
        }
    }
}
`;
var oneSweep32Shader = `
//****************************************************************************
// GPUSorting
// OneSweep - WaveSize 32 variant
//
// SPDX-License-Identifier: MIT
// Copyright Thomas Smith 12/7/2024
// https://github.com/b0nes164/GPUSorting
//
// Modified for WGSL compatibility and variable subgroup sizes by Dino Metarapi, 2025
// Based on original work by Thomas Smith
//****************************************************************************

enable subgroups;

@diagnostic(off, subgroup_uniformity)
fn unsafeSubgroupInclusiveAdd(x: u32) -> u32 { return subgroupInclusiveAdd(x); }

@diagnostic(off, subgroup_uniformity)
fn unsafeSubgroupExclusiveAdd(x: u32) -> u32 { return subgroupExclusiveAdd(x); }

@diagnostic(off, subgroup_uniformity)
fn unsafeSubgroupShuffle(x: u32, source: u32) -> u32 { return subgroupShuffle(x, source); }

@diagnostic(off, subgroup_uniformity)
fn unsafeSubgroupBallot(pred: bool) -> vec4<u32> { return subgroupBallot(pred); }

@diagnostic(off, subgroup_uniformity)
fn unsafeSubgroupAdd(x: u32) -> u32 { return subgroupAdd(x); }

struct InfoStruct
{
    size: u32,
    shift: u32,
    thread_blocks: u32,
    seed: u32,
};

@group(0) @binding(0)
var<uniform> info : InfoStruct;

@group(0) @binding(1)
var<storage, read_write> bump: array<atomic<u32>>;

@group(0) @binding(2)
var<storage, read_write> sort: array<u32>;

@group(0) @binding(3)
var<storage, read_write> alt: array<u32>;

@group(0) @binding(4)
var<storage, read_write> payload: array<u32>;

@group(0) @binding(5)
var<storage, read_write> alt_payload: array<u32>;

@group(0) @binding(6)
var<storage, read_write> hist: array<atomic<u32>>;

@group(0) @binding(7)
var<storage, read_write> pass_hist: array<atomic<u32>>;

@group(0) @binding(8)
var<storage, read_write> status: array<u32>;

const SORT_PASSES = 4u;
const BLOCK_DIM = 256u;
const MIN_SUBGROUP_SIZE = 32u;
const MAX_SUBGROUP_SIZE_W32 = 32u;  // ballot.x is only 32 bits - wave32 max
const MAX_REDUCE_SIZE = BLOCK_DIM / MIN_SUBGROUP_SIZE;

const STATUS_ERR_GLOBAL_HIST = 0u;
const STATUS_ERR_SCAN = 1u;
const STATUS_ERR_PASS = 2u;
const STATUS_ERR_LANE_COUNT = 3u;

const FLAG_NOT_READY = 0u;
const FLAG_REDUCTION = 1u;
const FLAG_INCLUSIVE = 2u;
const FLAG_MASK = 3u;

const RADIX = 256u;
const ALL_RADIX = RADIX * SORT_PASSES;
const RADIX_MASK = 255u;
const RADIX_LOG = 8u;

const KEYS_PER_THREAD = 15u;
const PART_SIZE = KEYS_PER_THREAD * BLOCK_DIM;

const REDUCE_BLOCK_DIM = 128u;
const REDUCE_KEYS_PER_THREAD = 30u;
const REDUCE_HIST_SIZE = REDUCE_BLOCK_DIM / MIN_SUBGROUP_SIZE * ALL_RADIX;
const REDUCE_PART_SIZE = REDUCE_KEYS_PER_THREAD * REDUCE_BLOCK_DIM;

const MAX_SUBGROUPS_PER_BLOCK = BLOCK_DIM / MIN_SUBGROUP_SIZE;
const WARP_HIST_CAPACITY = MAX_SUBGROUPS_PER_BLOCK * RADIX;

var<workgroup> wg_globalHist: array<atomic<u32>, REDUCE_HIST_SIZE>;

@compute @workgroup_size(REDUCE_BLOCK_DIM, 1, 1)
fn global_hist(
    @builtin(local_invocation_id) threadid: vec3<u32>,
    @builtin(subgroup_invocation_id) laneid: u32,
    @builtin(subgroup_size) lane_count: u32,
    @builtin(workgroup_id) wgid: vec3<u32>) {

    if (lane_count < MIN_SUBGROUP_SIZE || (REDUCE_BLOCK_DIM % lane_count) != 0u) {
        if (threadid.x == 0u) {
            status[STATUS_ERR_GLOBAL_HIST] = 0xDEAD0001u;
        }
        return;
    }

    let sid = threadid.x / lane_count;

    //Clear shared memory
    for (var i = threadid.x; i < REDUCE_HIST_SIZE; i += REDUCE_BLOCK_DIM) {
        atomicStore(&wg_globalHist[i], 0u);
    }
    workgroupBarrier();

    let radix_shift = info.shift;
    let hist_offset = sid * ALL_RADIX;
    {
        var i = threadid.x + wgid.x * REDUCE_PART_SIZE;
        if(wgid.x < info.thread_blocks - 1) {
            for (var k = 0u; k < REDUCE_KEYS_PER_THREAD; k += 1u) {
                let key = sort[i];
                atomicAdd(&wg_globalHist[(key & RADIX_MASK) + hist_offset], 1u);
                atomicAdd(&wg_globalHist[((key >> 8u) & RADIX_MASK) + hist_offset + 256u], 1u);
                atomicAdd(&wg_globalHist[((key >> 16u) & RADIX_MASK) + hist_offset + 512u], 1u);
                atomicAdd(&wg_globalHist[((key >> 24u) & RADIX_MASK) + hist_offset + 768u], 1u);
                i += REDUCE_BLOCK_DIM;
            }
        }

        if(wgid.x == info.thread_blocks - 1) {
            for (var k = 0u; k < REDUCE_KEYS_PER_THREAD; k += 1u) {
                if (i < info.size) {
                    let key = sort[i];
                    atomicAdd(&wg_globalHist[(key & RADIX_MASK) + hist_offset], 1u);
                    atomicAdd(&wg_globalHist[((key >> 8u) & RADIX_MASK) + hist_offset + 256u], 1u);
                    atomicAdd(&wg_globalHist[((key >> 16u) & RADIX_MASK) + hist_offset + 512u], 1u);
                    atomicAdd(&wg_globalHist[((key >> 24u) & RADIX_MASK) + hist_offset + 768u], 1u);
                }
                i += REDUCE_BLOCK_DIM;
            }
        }
    }
    workgroupBarrier();

    // Merge subgroup histograms
    let subgroup_histograms = REDUCE_BLOCK_DIM / lane_count;
    for(var i = threadid.x; i < RADIX; i += REDUCE_BLOCK_DIM) {
        var reduction0 = atomicLoad(&wg_globalHist[i]);
        var reduction1 = atomicLoad(&wg_globalHist[i + 256u]);
        var reduction2 = atomicLoad(&wg_globalHist[i + 512u]);
        var reduction3 = atomicLoad(&wg_globalHist[i + 768u]);

        for (var h = 1u; h < subgroup_histograms; h += 1u) {
            let idx = h * ALL_RADIX;
            reduction0 += atomicLoad(&wg_globalHist[i + idx]);
            reduction1 += atomicLoad(&wg_globalHist[i + 256u + idx]);
            reduction2 += atomicLoad(&wg_globalHist[i + 512u + idx]);
            reduction3 += atomicLoad(&wg_globalHist[i + 768u + idx]);
        }

        atomicAdd(&hist[i], reduction0);
        atomicAdd(&hist[i + 256u], reduction1);
        atomicAdd(&hist[i + 512u], reduction2);
        atomicAdd(&hist[i + 768u], reduction3);
    }
}

//Assumes block dim 256
const SCAN_MEM_SIZE = RADIX / MIN_SUBGROUP_SIZE;
var<workgroup> wg_scan: array<u32, SCAN_MEM_SIZE>;
@compute @workgroup_size(BLOCK_DIM, 1, 1)
fn onesweep_scan(
    @builtin(local_invocation_id) threadid: vec3<u32>,
    @builtin(subgroup_invocation_id) laneid: u32,
    @builtin(subgroup_size) lane_count: u32,
    @builtin(workgroup_id) wgid: vec3<u32>) {

    if (lane_count < MIN_SUBGROUP_SIZE || (BLOCK_DIM % lane_count) != 0u) {
        if (threadid.x == 0u) {
            status[STATUS_ERR_SCAN] = 0xDEAD0002u;
        }
        return;
    }

    let sid = threadid.x / lane_count;
    let pass_plane = info.shift >> 3u;
    let hist_index = threadid.x + pass_plane * RADIX;
    let scan = atomicLoad(&hist[hist_index]);
    let red = unsafeSubgroupAdd(scan);
    if(laneid == 0u){
        wg_scan[sid] = red;
    }
    workgroupBarrier();

    //Non-divergent subgroup agnostic inclusive scan across subgroup reductions
    {
        var offset0 = 0u;
        var offset1 = 0u;
        let lane_log = u32(countTrailingZeros(lane_count));
        let spine_size = BLOCK_DIM >> lane_log;
        let aligned_size = 1u << ((u32(countTrailingZeros(spine_size)) + lane_log - 1u) / lane_log * lane_log);
        for(var j = lane_count; j <= aligned_size; j <<= lane_log){
            let i0 = ((threadid.x + offset0) << offset1) - select(0u, 1u, j != lane_count);
            let pred0 = i0 < spine_size;
            let t0 = unsafeSubgroupInclusiveAdd(select(0u, wg_scan[i0], pred0));
            if(pred0){
                wg_scan[i0] = t0;
            }
            workgroupBarrier();

            if(j != lane_count){
                let rshift = j >> lane_log;
                let i1 = threadid.x + rshift;
                if ((i1 & (j - 1u)) >= rshift){
                    let pred1 = i1 < spine_size;
                    let t1 = select(0u, wg_scan[((i1 >> offset1) << offset1) - 1u], pred1);
                    if(pred1 && ((i1 + 1u) & (rshift - 1u)) != 0u){
                        wg_scan[i1] += t1;
                    }
                }
            } else {
                offset0 += 1u;
            }
            offset1 += lane_log;
        }
    }
    workgroupBarrier();

    if (wgid.x != 0u) {
        return;
    }

    let plane_stride = info.thread_blocks * RADIX;
    let pass_index = threadid.x + pass_plane * plane_stride;
    let subgroup_prefix = unsafeSubgroupExclusiveAdd(scan);
    var spine_prefix = 0u;
    if (sid > 0u) {
        spine_prefix = wg_scan[sid - 1u];
    }
    atomicStore(&pass_hist[pass_index], ((subgroup_prefix + spine_prefix) << 2u) | FLAG_INCLUSIVE);
}

var<workgroup> wg_subgroupHist: array<atomic<u32>, WARP_HIST_CAPACITY>;
var<workgroup> wg_localHist: array<u32, RADIX>;
var<workgroup> wg_broadcast: u32;

// Wave32 WLMS: uses ballot.x (32 bits) - only valid for lane_count <= 32
fn WLMS(key: u32, shift: u32, laneid: u32, lane_count: u32, lane_mask_lt: u32, s_offset: u32, key_valid: bool) -> u32 {
    // FIX: Compute valid_mask FIRST to exclude invalid lanes from peer groups.
    // Without this, invalid lanes (key_valid=false) look like "bit=0" lanes during ballot,
    // allowing them to join peer groups with valid keys. If an invalid lane becomes
    // highest_rank_peer, the atomicAdd is skipped (gated by key_valid), causing missing
    // histogram increments \u2192 offset collisions \u2192 duplicates/missing elements.
    let valid_mask = unsafeSubgroupBallot(key_valid).x;

    var eq_mask = 0xffffffffu;
    for (var k = 0u; k < RADIX_LOG; k += 1u) {
        let curr_bit = 1u << (k + shift);
        let pred = key_valid && ((key & curr_bit) != 0u);
        let ballot = unsafeSubgroupBallot(pred);
        eq_mask &= select(~ballot.x, ballot.x, pred);
    }

    // Remove invalid lanes from the peer group (critical fix for partial last partitions)
    eq_mask &= valid_mask;

    var subgroup_mask = 0xffffffffu;
    if (lane_count != 32u) {
        subgroup_mask = (1u << lane_count) - 1u;
    }
    eq_mask &= subgroup_mask;

    if (!key_valid) {
        eq_mask = 0u;
    }
    var out = countOneBits(eq_mask & lane_mask_lt);
    let highest_rank_peer = select(lane_count - 1u, 31u - countLeadingZeros(eq_mask), eq_mask != 0u);
    var pre_inc = 0u;
    if (key_valid && eq_mask != 0u && laneid == highest_rank_peer) {
        pre_inc = atomicAdd(&wg_subgroupHist[((key >> shift) & RADIX_MASK) + s_offset], out + 1u);
    }
    workgroupBarrier();
    // Call shuffle unconditionally to maintain uniform control flow across subgroup.
    // Divergent subgroup ops (when some lanes skip due to keyValid=false) cause undefined behavior.
    let bcast = unsafeSubgroupShuffle(pre_inc, highest_rank_peer);
    // Only apply it for real keys / real peer groups
    out += select(0u, bcast, eq_mask != 0u);
    return select(0u, out, key_valid);
}

fn fake_wlms(key: u32, shift: u32, laneid: u32, lane_count: u32, lane_mask_lt: u32, s_offset: u32) -> u32 {
    return 0u;
}

@compute @workgroup_size(BLOCK_DIM, 1, 1)
fn onesweep_pass(
    @builtin(local_invocation_id) threadid: vec3<u32>,
    @builtin(subgroup_invocation_id) laneid: u32,
    @builtin(subgroup_size) lane_count: u32) {

    let shift = info.shift;
    let sid = threadid.x / lane_count;

    // CRITICAL: This wave32 shader uses ballot.x (32 bits only) for peer masks.
    // If lane_count > 32, the ballot mask would miss lanes 32+, causing corruption.
    // Also lane_mask_lt = (1u << laneid) - 1u overflows for laneid >= 32.
    if (lane_count > MAX_SUBGROUP_SIZE_W32) {
        if (threadid.x == 0u) {
            status[STATUS_ERR_LANE_COUNT] = 0xDEAD0032u | (lane_count << 16u);
        }
        return;
    }

    let subgroup_hist_size = (BLOCK_DIM / lane_count) * RADIX;
    if (subgroup_hist_size > WARP_HIST_CAPACITY) {
        if (threadid.x == 0u) {
            status[STATUS_ERR_PASS] = 0xDEAD0004u;
        }
        return;
    }

    for (var i = threadid.x; i < subgroup_hist_size; i += BLOCK_DIM) {
        atomicStore(&wg_subgroupHist[i], 0u);
    }
    workgroupBarrier();

    if (threadid.x == 0u) {
        wg_broadcast = atomicAdd(&bump[shift >> 3u], 1u);
    }
    // Explicit barrier to ensure wg_broadcast is visible to all threads
    workgroupBarrier();
    let partid = wg_broadcast;

    var keys = array<u32, KEYS_PER_THREAD>();
    var values = array<u32, KEYS_PER_THREAD>();
    var keyValid = array<bool, KEYS_PER_THREAD>();
    {
        let dev_offset = partid * PART_SIZE;
        let lane_stride = sid * lane_count * KEYS_PER_THREAD;
        var idx = laneid + lane_stride + dev_offset;
        if (partid < info.thread_blocks - 1u) {
            for (var k = 0u; k < KEYS_PER_THREAD; k += 1u) {
                keys[k] = sort[idx];
                values[k] = payload[idx];
                keyValid[k] = true;
                idx += lane_count;
            }
        } else {
            for (var k = 0u; k < KEYS_PER_THREAD; k += 1u) {
                if (idx < info.size) {
                    keys[k] = sort[idx];
                    values[k] = payload[idx];
                    keyValid[k] = true;
                } else {
                    keys[k] = 0xffffffffu;
                    values[k] = 0xffffffffu;
                    keyValid[k] = false;
                }
                idx += lane_count;
            }
        }
    }

    var offsets = array<u32, KEYS_PER_THREAD>();
    {
        let lane_mask_lt = (1u << laneid) - 1u;
        let hist_offset = sid * RADIX;
        for (var k = 0u; k < KEYS_PER_THREAD; k += 1u) {
            offsets[k] = WLMS(keys[k], shift, laneid, lane_count, lane_mask_lt, hist_offset, keyValid[k]);
        }
    }
    workgroupBarrier();

    var local_reduction = 0u;
    if (threadid.x < RADIX) {
        local_reduction = atomicLoad(&wg_subgroupHist[threadid.x]);
        var subtotal = local_reduction;
        for (var i = threadid.x + RADIX; i < subgroup_hist_size; i += RADIX) {
            let current = atomicLoad(&wg_subgroupHist[i]);
            atomicStore(&wg_subgroupHist[i], subtotal);
            subtotal += current;
        }
        local_reduction = subtotal;

        if (partid < info.thread_blocks - 1u) {
            let pass_plane = shift >> 3u;
            let pass_index = threadid.x + pass_plane * info.thread_blocks * RADIX + (partid + 1u) * RADIX;
            atomicStore(&pass_hist[pass_index], (local_reduction << 2u) | FLAG_REDUCTION);
        }

        let lane_mask = lane_count - 1u;
        let circular_lane_shift = (laneid + lane_mask) & lane_mask;
        let t = unsafeSubgroupInclusiveAdd(local_reduction);
        wg_localHist[threadid.x] = unsafeSubgroupShuffle(t, circular_lane_shift);
    }
    workgroupBarrier();

    if (threadid.x < lane_count) {
        let pred = threadid.x < RADIX / lane_count;
        let t = unsafeSubgroupExclusiveAdd(select(0u, wg_localHist[threadid.x * lane_count], pred));
        if (pred) {
            wg_localHist[threadid.x * lane_count] = t;
        }
    }
    workgroupBarrier();

    if (threadid.x < RADIX && laneid != 0u) {
        wg_localHist[threadid.x] += wg_localHist[(threadid.x / lane_count) * lane_count];
    }
    workgroupBarrier();

    for (var k = 0u; k < KEYS_PER_THREAD; k += 1u) {
        if (keyValid[k]) {
            let digit = (keys[k] >> shift) & RADIX_MASK;
            let block_prefix = wg_localHist[digit];
            if (sid == 0u) {
                offsets[k] += block_prefix;
            } else {
                let subgroup_prefix = atomicLoad(&wg_subgroupHist[digit + sid * RADIX]);
                offsets[k] += block_prefix + subgroup_prefix;
            }
        }
    }
    workgroupBarrier();

    if (threadid.x < RADIX) {
        let pass_plane = shift >> 3u;
        let base_plane = pass_plane * info.thread_blocks * RADIX;
        let bin = threadid.x;
        let block_prefix = wg_localHist[bin];
        var prev_reduction = 0u;
        var lookbackid = partid;
        loop {
            let flag_payload = atomicLoad(&pass_hist[bin + base_plane + lookbackid * RADIX]);
            if ((flag_payload & FLAG_MASK) > FLAG_NOT_READY) {
                prev_reduction += flag_payload >> 2u;
                if ((flag_payload & FLAG_MASK) == FLAG_INCLUSIVE) {
                    if (partid < info.thread_blocks - 1u) {
                        let next_idx = bin + base_plane + (partid + 1u) * RADIX;
                        atomicStore(&pass_hist[next_idx], ((prev_reduction + local_reduction) << 2u) | FLAG_INCLUSIVE);
                    }
                    wg_localHist[bin] = prev_reduction - block_prefix;
                    break;
                } else {
                    lookbackid -= 1u;
                }
            }
        }
    }
    workgroupBarrier();

    for (var k = 0u; k < KEYS_PER_THREAD; k += 1u) {
        if (keyValid[k]) {
            let digit = (keys[k] >> shift) & RADIX_MASK;
            let global_offset = wg_localHist[digit] + offsets[k];
            if (global_offset < info.size) {
                alt[global_offset] = keys[k];
                alt_payload[global_offset] = values[k];
            }
        }
    }
}
`;
var oneSweep64Shader = `
//****************************************************************************
// GPUSorting
// OneSweep - WaveSize 64 variant
//
// SPDX-License-Identifier: MIT
// Copyright Thomas Smith 12/7/2024
// https://github.com/b0nes164/GPUSorting
//
// Modified for WGSL compatibility and variable subgroup sizes by Dino Metarapi, 2025
// Based on original work by Thomas Smith
//****************************************************************************

enable subgroups;

@diagnostic(off, subgroup_uniformity)
fn unsafeSubgroupInclusiveAdd(x: u32) -> u32 { return subgroupInclusiveAdd(x); }

@diagnostic(off, subgroup_uniformity)
fn unsafeSubgroupExclusiveAdd(x: u32) -> u32 { return subgroupExclusiveAdd(x); }

@diagnostic(off, subgroup_uniformity)
fn unsafeSubgroupShuffle(x: u32, source: u32) -> u32 { return subgroupShuffle(x, source); }

@diagnostic(off, subgroup_uniformity)
fn unsafeSubgroupBallot(pred: bool) -> vec4<u32> { return subgroupBallot(pred); }

@diagnostic(off, subgroup_uniformity)
fn unsafeSubgroupAdd(x: u32) -> u32 { return subgroupAdd(x); }

struct InfoStruct
{
    size: u32,
    shift: u32,
    thread_blocks: u32,
    seed: u32,
};

@group(0) @binding(0)
var<uniform> info : InfoStruct;

@group(0) @binding(1)
var<storage, read_write> bump: array<atomic<u32>>;

@group(0) @binding(2)
var<storage, read_write> sort: array<u32>;

@group(0) @binding(3)
var<storage, read_write> alt: array<u32>;

@group(0) @binding(4)
var<storage, read_write> payload: array<u32>;

@group(0) @binding(5)
var<storage, read_write> alt_payload: array<u32>;

@group(0) @binding(6)
var<storage, read_write> hist: array<atomic<u32>>;

@group(0) @binding(7)
var<storage, read_write> pass_hist: array<atomic<u32>>;

@group(0) @binding(8)
var<storage, read_write> status: array<u32>;

const SORT_PASSES = 4u;
const BLOCK_DIM = 256u;
const MIN_SUBGROUP_SIZE = 64u;
const MAX_REDUCE_SIZE = BLOCK_DIM / MIN_SUBGROUP_SIZE;

const STATUS_ERR_GLOBAL_HIST = 0u;
const STATUS_ERR_SCAN = 1u;
const STATUS_ERR_PASS = 2u;

const FLAG_NOT_READY = 0u;
const FLAG_REDUCTION = 1u;
const FLAG_INCLUSIVE = 2u;
const FLAG_MASK = 3u;

const RADIX = 256u;
const ALL_RADIX = RADIX * SORT_PASSES;
const RADIX_MASK = 255u;
const RADIX_LOG = 8u;

const KEYS_PER_THREAD = 15u;
const PART_SIZE = KEYS_PER_THREAD * BLOCK_DIM;

const REDUCE_BLOCK_DIM = 128u;
const REDUCE_KEYS_PER_THREAD = 30u;
const REDUCE_HIST_SIZE = REDUCE_BLOCK_DIM / MIN_SUBGROUP_SIZE * ALL_RADIX;
const REDUCE_PART_SIZE = REDUCE_KEYS_PER_THREAD * REDUCE_BLOCK_DIM;

const MAX_SUBGROUPS_PER_BLOCK = BLOCK_DIM / MIN_SUBGROUP_SIZE;
const WARP_HIST_CAPACITY = MAX_SUBGROUPS_PER_BLOCK * RADIX;

var<workgroup> wg_globalHist: array<atomic<u32>, REDUCE_HIST_SIZE>;

@compute @workgroup_size(REDUCE_BLOCK_DIM, 1, 1)
fn global_hist(
    @builtin(local_invocation_id) threadid: vec3<u32>,
    @builtin(subgroup_invocation_id) laneid: u32,
    @builtin(subgroup_size) lane_count: u32,
    @builtin(workgroup_id) wgid: vec3<u32>) {

    if (lane_count < MIN_SUBGROUP_SIZE || (REDUCE_BLOCK_DIM % lane_count) != 0u) {
        if (threadid.x == 0u) {
            status[STATUS_ERR_GLOBAL_HIST] = 0xDEAD0001u;
        }
        return;
    }

    let sid = threadid.x / lane_count;

    //Clear shared memory
    for (var i = threadid.x; i < REDUCE_HIST_SIZE; i += REDUCE_BLOCK_DIM) {
        atomicStore(&wg_globalHist[i], 0u);
    }
    workgroupBarrier();

    let radix_shift = info.shift;
    let hist_offset = sid * ALL_RADIX;
    {
        var i = threadid.x + wgid.x * REDUCE_PART_SIZE;
        if(wgid.x < info.thread_blocks - 1u) {
            for (var k = 0u; k < REDUCE_KEYS_PER_THREAD; k += 1u) {
                let key = sort[i];
                atomicAdd(&wg_globalHist[(key & RADIX_MASK) + hist_offset], 1u);
                atomicAdd(&wg_globalHist[((key >> 8u) & RADIX_MASK) + hist_offset + 256u], 1u);
                atomicAdd(&wg_globalHist[((key >> 16u) & RADIX_MASK) + hist_offset + 512u], 1u);
                atomicAdd(&wg_globalHist[((key >> 24u) & RADIX_MASK) + hist_offset + 768u], 1u);
                i += REDUCE_BLOCK_DIM;
            }
        }

        if(wgid.x == info.thread_blocks - 1u) {
            for (var k = 0u; k < REDUCE_KEYS_PER_THREAD; k += 1u) {
                if (i < info.size) {
                    let key = sort[i];
                    atomicAdd(&wg_globalHist[(key & RADIX_MASK) + hist_offset], 1u);
                    atomicAdd(&wg_globalHist[((key >> 8u) & RADIX_MASK) + hist_offset + 256u], 1u);
                    atomicAdd(&wg_globalHist[((key >> 16u) & RADIX_MASK) + hist_offset + 512u], 1u);
                    atomicAdd(&wg_globalHist[((key >> 24u) & RADIX_MASK) + hist_offset + 768u], 1u);
                }
                i += REDUCE_BLOCK_DIM;
            }
        }
    }
    workgroupBarrier();

    // Merge subgroup histograms
    let subgroup_histograms = REDUCE_BLOCK_DIM / lane_count;
    for(var i = threadid.x; i < RADIX; i += REDUCE_BLOCK_DIM) {
        var reduction0 = atomicLoad(&wg_globalHist[i]);
        var reduction1 = atomicLoad(&wg_globalHist[i + 256u]);
        var reduction2 = atomicLoad(&wg_globalHist[i + 512u]);
        var reduction3 = atomicLoad(&wg_globalHist[i + 768u]);

        for (var h = 1u; h < subgroup_histograms; h += 1u) {
            let idx = h * ALL_RADIX;
            reduction0 += atomicLoad(&wg_globalHist[i + idx]);
            reduction1 += atomicLoad(&wg_globalHist[i + 256u + idx]);
            reduction2 += atomicLoad(&wg_globalHist[i + 512u + idx]);
            reduction3 += atomicLoad(&wg_globalHist[i + 768u + idx]);
        }

        atomicAdd(&hist[i], reduction0);
        atomicAdd(&hist[i + 256u], reduction1);
        atomicAdd(&hist[i + 512u], reduction2);
        atomicAdd(&hist[i + 768u], reduction3);
    }
}

//Assumes block dim 256
const SCAN_MEM_SIZE = RADIX / MIN_SUBGROUP_SIZE;
var<workgroup> wg_scan: array<u32, SCAN_MEM_SIZE>;
@compute @workgroup_size(BLOCK_DIM, 1, 1)
fn onesweep_scan(
    @builtin(local_invocation_id) threadid: vec3<u32>,
    @builtin(subgroup_invocation_id) laneid: u32,
    @builtin(subgroup_size) lane_count: u32,
    @builtin(workgroup_id) wgid: vec3<u32>) {

    if (lane_count < MIN_SUBGROUP_SIZE || (BLOCK_DIM % lane_count) != 0u) {
        if (threadid.x == 0u) {
            status[STATUS_ERR_SCAN] = 0xDEAD0002u;
        }
        return;
    }

    let sid = threadid.x / lane_count;
    let pass_plane = info.shift >> 3u;
    let hist_index = threadid.x + pass_plane * RADIX;
    let scan = atomicLoad(&hist[hist_index]);
    let red = unsafeSubgroupAdd(scan);
    if(laneid == 0u){
        wg_scan[sid] = red;
    }
    workgroupBarrier();

    //Non-divergent subgroup agnostic inclusive scan across subgroup reductions
    {
        var offset0 = 0u;
        var offset1 = 0u;
        let lane_log = u32(countTrailingZeros(lane_count));
        let spine_size = BLOCK_DIM >> lane_log;
        let aligned_size = 1u << ((u32(countTrailingZeros(spine_size)) + lane_log - 1u) / lane_log * lane_log);
        for(var j = lane_count; j <= aligned_size; j <<= lane_log){
            let i0 = ((threadid.x + offset0) << offset1) - select(0u, 1u, j != lane_count);
            let pred0 = i0 < spine_size;
            let t0 = unsafeSubgroupInclusiveAdd(select(0u, wg_scan[i0], pred0));
            if(pred0){
                wg_scan[i0] = t0;
            }
            workgroupBarrier();

            if(j != lane_count){
                let rshift = j >> lane_log;
                let i1 = threadid.x + rshift;
                if ((i1 & (j - 1u)) >= rshift){
                    let pred1 = i1 < spine_size;
                    let t1 = select(0u, wg_scan[((i1 >> offset1) << offset1) - 1u], pred1);
                    if(pred1 && ((i1 + 1u) & (rshift - 1u)) != 0u){
                        wg_scan[i1] += t1;
                    }
                }
            } else {
                offset0 += 1u;
            }
            offset1 += lane_log;
        }
    }
    workgroupBarrier();

    if (wgid.x != 0u) {
        return;
    }

    let plane_stride = info.thread_blocks * RADIX;
    let pass_index = threadid.x + pass_plane * plane_stride;
    let subgroup_prefix = unsafeSubgroupExclusiveAdd(scan);
    var spine_prefix = 0u;
    if (sid > 0u) {
        spine_prefix = wg_scan[sid - 1u];
    }
    atomicStore(&pass_hist[pass_index], ((subgroup_prefix + spine_prefix) << 2u) | FLAG_INCLUSIVE);
}

var<workgroup> wg_subgroupHist: array<atomic<u32>, WARP_HIST_CAPACITY>;
var<workgroup> wg_localHist: array<u32, RADIX>;
var<workgroup> wg_broadcast: u32;

fn lowMask(bits: u32) -> u32 {
    if (bits == 0u) {
        return 0u;
    }
    if (bits >= 32u) {
        return 0xffffffffu;
    }
    return (1u << bits) - 1u;
}

fn laneMaskLessThan(laneid: u32) -> vec4<u32> {
    if (laneid >= 32u) {
        return vec4<u32>(0xffffffffu, lowMask(laneid - 32u), 0u, 0u);
    }
    return vec4<u32>(lowMask(laneid), 0u, 0u, 0u);
}

fn subgroupMaskForSize(size: u32) -> vec4<u32> {
    if (size <= 32u) {
        return vec4<u32>(lowMask(size), 0u, 0u, 0u);
    }
    return vec4<u32>(0xffffffffu, lowMask(size - 32u), 0u, 0u);
}

fn maskAnd(a: vec4<u32>, b: vec4<u32>) -> vec4<u32> {
    return vec4<u32>(a.x & b.x, a.y & b.y, 0u, 0u);
}

fn maskFilter(ballot: vec4<u32>, pred: bool) -> vec4<u32> {
    let keep = vec4<u32>(ballot.x, ballot.y, 0u, 0u);
    let reject = vec4<u32>(~ballot.x, ~ballot.y, 0u, 0u);
    let cond = vec4<bool>(pred, pred, pred, pred);
    return select(reject, keep, cond);
}

fn maskBitCount(mask: vec4<u32>) -> u32 {
    return countOneBits(mask.x) + countOneBits(mask.y);
}

fn maskHasBits(mask: vec4<u32>) -> bool {
    return (mask.x | mask.y) != 0u;
}

fn maskHighestLane(mask: vec4<u32>) -> u32 {
    if (mask.y != 0u) {
        return 32u + (31u - countLeadingZeros(mask.y));
    }
    return 31u - countLeadingZeros(mask.x);
}

fn WLMS(key: u32, shift: u32, laneid: u32, lane_count: u32, s_offset: u32, key_valid: bool) -> u32 {
    // FIX: Compute valid_mask FIRST to exclude invalid lanes from peer groups.
    // Without this, invalid lanes (key_valid=false) look like "bit=0" lanes during ballot,
    // allowing them to join peer groups with valid keys. If an invalid lane becomes
    // highest_rank_peer, the atomicAdd is skipped (gated by key_valid), causing missing
    // histogram increments \u2192 offset collisions \u2192 duplicates/missing elements.
    let valid_ballot = unsafeSubgroupBallot(key_valid);
    let valid_mask = vec4<u32>(valid_ballot.x, valid_ballot.y, 0u, 0u);

    var eq_mask = vec4<u32>(0xffffffffu, 0xffffffffu, 0u, 0u);
    for (var k = 0u; k < RADIX_LOG; k += 1u) {
        let curr_bit = 1u << (k + shift);
        let pred = key_valid && ((key & curr_bit) != 0u);
        let ballot = unsafeSubgroupBallot(pred);
        eq_mask = maskAnd(eq_mask, maskFilter(ballot, pred));
    }

    // Remove invalid lanes from the peer group (critical fix for partial last partitions)
    eq_mask = maskAnd(eq_mask, valid_mask);

    if (!key_valid) {
        eq_mask = vec4<u32>(0u);
    }
    eq_mask = maskAnd(eq_mask, subgroupMaskForSize(lane_count));
    let lane_mask_lt = laneMaskLessThan(laneid);
    var out = maskBitCount(maskAnd(eq_mask, lane_mask_lt));
    let has_peers = maskHasBits(eq_mask);
    let highest_rank_peer = select(lane_count - 1u, maskHighestLane(eq_mask), has_peers);
    var pre_inc = 0u;
    if (key_valid && has_peers && laneid == highest_rank_peer) {
        pre_inc = atomicAdd(&wg_subgroupHist[((key >> shift) & RADIX_MASK) + s_offset], out + 1u);
    }
    workgroupBarrier();
    // Call shuffle unconditionally to maintain uniform control flow across subgroup.
    // Divergent subgroup ops (when some lanes skip due to keyValid=false) cause undefined behavior.
    let bcast = unsafeSubgroupShuffle(pre_inc, highest_rank_peer);
    // Only apply it for real keys / real peer groups
    out += select(0u, bcast, has_peers);
    return select(0u, out, key_valid);
}

fn fake_wlms(key: u32, shift: u32, laneid: u32, lane_count: u32, s_offset: u32) -> u32 {
    return 0u;
}

@compute @workgroup_size(BLOCK_DIM, 1, 1)
fn onesweep_pass(
    @builtin(local_invocation_id) threadid: vec3<u32>,
    @builtin(subgroup_invocation_id) laneid: u32,
    @builtin(subgroup_size) lane_count: u32) {

    let shift = info.shift;
    let sid = threadid.x / lane_count;

    let subgroup_hist_size = (BLOCK_DIM / lane_count) * RADIX;
    if (subgroup_hist_size > WARP_HIST_CAPACITY) {
        if (threadid.x == 0u) {
            status[STATUS_ERR_PASS] = 0xDEAD0004u;
        }
        return;
    }

    for (var i = threadid.x; i < subgroup_hist_size; i += BLOCK_DIM) {
        atomicStore(&wg_subgroupHist[i], 0u);
    }
    workgroupBarrier();

    if (threadid.x == 0u) {
        wg_broadcast = atomicAdd(&bump[shift >> 3u], 1u);
    }
    // Explicit barrier to ensure wg_broadcast is visible to all threads
    workgroupBarrier();
    let partid = wg_broadcast;

    var keys = array<u32, KEYS_PER_THREAD>();
    var values = array<u32, KEYS_PER_THREAD>();
    var keyValid = array<bool, KEYS_PER_THREAD>();
    {
        let dev_offset = partid * PART_SIZE;
        let lane_stride = sid * lane_count * KEYS_PER_THREAD;
        var idx = laneid + lane_stride + dev_offset;
        if (partid < info.thread_blocks - 1u) {
            for (var k = 0u; k < KEYS_PER_THREAD; k += 1u) {
                keys[k] = sort[idx];
                values[k] = payload[idx];
                keyValid[k] = true;
                idx += lane_count;
            }
        } else {
            for (var k = 0u; k < KEYS_PER_THREAD; k += 1u) {
                if (idx < info.size) {
                    keys[k] = sort[idx];
                    values[k] = payload[idx];
                    keyValid[k] = true;
                } else {
                    keys[k] = 0xffffffffu;
                    values[k] = 0xffffffffu;
                    keyValid[k] = false;
                }
                idx += lane_count;
            }
        }
    }

    var offsets = array<u32, KEYS_PER_THREAD>();
    {
        let hist_offset = sid * RADIX;
        for (var k = 0u; k < KEYS_PER_THREAD; k += 1u) {
            offsets[k] = WLMS(keys[k], shift, laneid, lane_count, hist_offset, keyValid[k]);
        }
    }
    workgroupBarrier();

    var local_reduction = 0u;
    if (threadid.x < RADIX) {
        local_reduction = atomicLoad(&wg_subgroupHist[threadid.x]);
        var subtotal = local_reduction;
        for (var i = threadid.x + RADIX; i < subgroup_hist_size; i += RADIX) {
            let current = atomicLoad(&wg_subgroupHist[i]);
            atomicStore(&wg_subgroupHist[i], subtotal);
            subtotal += current;
        }
        local_reduction = subtotal;

        if (partid < info.thread_blocks - 1u) {
            let pass_plane = shift >> 3u;
            let pass_index = threadid.x + pass_plane * info.thread_blocks * RADIX + (partid + 1u) * RADIX;
            atomicStore(&pass_hist[pass_index], (local_reduction << 2u) | FLAG_REDUCTION);
        }

        let lane_mask = lane_count - 1u;
        let circular_lane_shift = (laneid + lane_mask) & lane_mask;
        let t = unsafeSubgroupInclusiveAdd(local_reduction);
        wg_localHist[threadid.x] = unsafeSubgroupShuffle(t, circular_lane_shift);
    }
    workgroupBarrier();

    if (threadid.x < lane_count) {
        let pred = threadid.x < RADIX / lane_count;
        let t = unsafeSubgroupExclusiveAdd(select(0u, wg_localHist[threadid.x * lane_count], pred));
        if (pred) {
            wg_localHist[threadid.x * lane_count] = t;
        }
    }
    workgroupBarrier();

    if (threadid.x < RADIX && laneid != 0u) {
        wg_localHist[threadid.x] += wg_localHist[(threadid.x / lane_count) * lane_count];
    }
    workgroupBarrier();

    for (var k = 0u; k < KEYS_PER_THREAD; k += 1u) {
        if (keyValid[k]) {
            let digit = (keys[k] >> shift) & RADIX_MASK;
            let block_prefix = wg_localHist[digit];
            if (sid == 0u) {
                offsets[k] += block_prefix;
            } else {
                let subgroup_prefix = atomicLoad(&wg_subgroupHist[digit + sid * RADIX]);
                offsets[k] += block_prefix + subgroup_prefix;
            }
        }
    }
    workgroupBarrier();

    if (threadid.x < RADIX) {
        let pass_plane = shift >> 3u;
        let base_plane = pass_plane * info.thread_blocks * RADIX;
        let bin = threadid.x;
        let block_prefix = wg_localHist[bin];
        var prev_reduction = 0u;
        var lookbackid = partid;
        loop {
            let flag_payload = atomicLoad(&pass_hist[bin + base_plane + lookbackid * RADIX]);
            if ((flag_payload & FLAG_MASK) > FLAG_NOT_READY) {
                prev_reduction += flag_payload >> 2u;
                if ((flag_payload & FLAG_MASK) == FLAG_INCLUSIVE) {
                    if (partid < info.thread_blocks - 1u) {
                        let next_idx = bin + base_plane + (partid + 1u) * RADIX;
                        atomicStore(&pass_hist[next_idx], ((prev_reduction + local_reduction) << 2u) | FLAG_INCLUSIVE);
                    }
                    wg_localHist[bin] = prev_reduction - block_prefix;
                    break;
                } else {
                    lookbackid -= 1u;
                }
            }
        }
    }
    workgroupBarrier();

    for (var k = 0u; k < KEYS_PER_THREAD; k += 1u) {
        if (keyValid[k]) {
            let digit = (keys[k] >> shift) & RADIX_MASK;
            let global_offset = wg_localHist[digit] + offsets[k];
            if (global_offset < info.size) {
                alt[global_offset] = keys[k];
                alt_payload[global_offset] = values[k];
            }
        }
    }
}
`;
var subgroupDetectShader = `
enable subgroups;

@group(0) @binding(0)
var<storage, read_write> outSize : array<u32, 1>;

@compute @workgroup_size(1)
fn main(@builtin(subgroup_size) subgroupSize : u32) {
    outSize[0] = subgroupSize;
}
`;

// vendor/webphysics/src/lvbh/sorting/OneSweepSorter.js
var SORT_PASSES = 4;
var BLOCK_DIM = 256;
var RADIX = 256;
var RADIX_LOG = 8;
var KEYS_PER_THREAD = 15;
var REDUCE_BLOCK_DIM = 128;
var REDUCE_KEYS_PER_THREAD = 30;
var STATUS_LENGTH = 4;
var OneSweepSorter = class extends BaseSorter {
  constructor(device) {
    super(device);
    this.name = "OneSweep";
    this._pipelines = null;
    this._buffers = null;
    this._bindGroupLayout = null;
    this._maxKeys = 0;
    this._subgroupSize = 0;
    this._shaderVariantLabel = "";
    this._sortBindGroups = {
      even: null,
      odd: null,
      keysIn: null,
      valsIn: null
    };
    this.blockDim = BLOCK_DIM;
    this.reduceBlockDim = REDUCE_BLOCK_DIM;
    this.partSize = this.blockDim * KEYS_PER_THREAD;
    this.reducePartSize = this.reduceBlockDim * REDUCE_KEYS_PER_THREAD;
    const FLAG_INCLUSIVE = 2;
    this._flagInclusiveBlock = new Uint32Array(RADIX);
    this._flagInclusiveBlock.fill(FLAG_INCLUSIVE);
    this._infoUploadData = new Uint32Array(SORT_PASSES * 4);
  }
  async init(maxKeys) {
    this._maxKeys = maxKeys;
    const device = this.device;
    const subgroupSize = await this._detectSubgroupSize();
    const { shaderSource, label } = this._selectShaderVariant(subgroupSize);
    this._shaderVariantLabel = label;
    const shaderModule = device.createShaderModule({
      label: `OneSweep Shader (${label})`,
      code: shaderSource
    });
    const compilationInfo = await shaderModule.getCompilationInfo();
    for (const msg of compilationInfo.messages) {
      if (msg.type === "error") {
        throw new Error(`OneSweep shader compilation error: ${msg.message} at line ${msg.lineNum}`);
      }
    }
    this._bindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 8, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }
      ]
    });
    const pipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [this._bindGroupLayout]
    });
    this._pipelines = {
      globalHist: device.createComputePipeline({
        layout: pipelineLayout,
        compute: { module: shaderModule, entryPoint: "global_hist" }
      }),
      scan: device.createComputePipeline({
        layout: pipelineLayout,
        compute: { module: shaderModule, entryPoint: "onesweep_scan" }
      }),
      pass: device.createComputePipeline({
        layout: pipelineLayout,
        compute: { module: shaderModule, entryPoint: "onesweep_pass" }
      })
    };
    this._createBuffers(maxKeys);
    this._initialized = true;
  }
  _createBuffers(maxKeys) {
    const device = this.device;
    const threadBlocks = Math.ceil(maxKeys / this.partSize);
    if (this._buffers) {
      for (const key in this._buffers) {
        this._buffers[key]?.destroy();
      }
    }
    this._buffers = {
      // Internal alt buffers for ping-pong
      altKeys: device.createBuffer({
        label: "LBVH OneSweep AltKeys",
        size: Math.max(16, maxKeys * 4),
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
      }),
      altVals: device.createBuffer({
        label: "LBVH OneSweep AltVals",
        size: Math.max(16, maxKeys * 4),
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
      }),
      // Bump counter for workgroup scheduling
      bump: device.createBuffer({
        label: "LBVH OneSweep Bump",
        size: (SORT_PASSES + 1) * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
      }),
      // Global histogram
      hist: device.createBuffer({
        label: "LBVH OneSweep Hist",
        size: RADIX * SORT_PASSES * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
      }),
      // Per-block histograms for decoupled lookback
      passHist: device.createBuffer({
        label: "LBVH OneSweep PassHist",
        size: threadBlocks * RADIX * SORT_PASSES * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
      }),
      // Status/error buffer
      status: device.createBuffer({
        label: "LBVH OneSweep Status",
        size: STATUS_LENGTH * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
      }),
      // Uniforms
      info: device.createBuffer({
        label: "LBVH OneSweep Info",
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
      }),
      // Upload buffer for info data (all 4 passes)
      infoUpload: device.createBuffer({
        label: "LBVH OneSweep InfoUpload",
        size: 16 * SORT_PASSES,
        usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
      }),
      // Staging buffer for FLAG_INCLUSIVE initialization (256 u32s per pass = 1024 u32s total)
      // Used to avoid race between writeBuffer (immediate) and clearBuffer (recorded)
      flagInclusiveStaging: device.createBuffer({
        label: "LBVH OneSweep FlagInclusiveStaging",
        size: RADIX * SORT_PASSES * 4,
        usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
      })
    };
    const stagingStrideBytes = RADIX * 4;
    for (let pass = 0; pass < SORT_PASSES; pass++) {
      device.queue.writeBuffer(
        this._buffers.flagInclusiveStaging,
        pass * stagingStrideBytes,
        this._flagInclusiveBlock
      );
    }
    this._sortBindGroups.even = null;
    this._sortBindGroups.odd = null;
    this._sortBindGroups.keysIn = null;
    this._sortBindGroups.valsIn = null;
  }
  /**
   * Sort using command encoder (records commands, doesn't submit)
   */
  sort(params) {
    const { commandEncoder, keysIn, valsIn, count, timing } = params;
    const device = this.device;
    if (count > this._maxKeys) {
      this._maxKeys = count;
      this._createBuffers(count);
    }
    const threadBlocks = Math.ceil(count / this.partSize);
    commandEncoder.clearBuffer(this._buffers.bump);
    commandEncoder.clearBuffer(this._buffers.hist);
    commandEncoder.clearBuffer(this._buffers.status);
    commandEncoder.clearBuffer(this._buffers.passHist);
    const passHistStrideBytes = threadBlocks * RADIX * 4;
    const stagingStrideBytes = RADIX * 4;
    for (let pass = 0; pass < SORT_PASSES; pass++) {
      commandEncoder.copyBufferToBuffer(
        this._buffers.flagInclusiveStaging,
        pass * stagingStrideBytes,
        this._buffers.passHist,
        pass * passHistStrideBytes,
        stagingStrideBytes
      );
    }
    for (let pass = 0; pass < SORT_PASSES; pass++) {
      const offset = pass * 4;
      this._infoUploadData[offset + 0] = count;
      this._infoUploadData[offset + 1] = pass * RADIX_LOG;
      this._infoUploadData[offset + 2] = threadBlocks;
      this._infoUploadData[offset + 3] = 0;
    }
    device.queue.writeBuffer(this._buffers.infoUpload, 0, this._infoUploadData);
    this._ensureSortBindGroups(keysIn, valsIn);
    for (let pass = 0; pass < SORT_PASSES; pass++) {
      commandEncoder.copyBufferToBuffer(
        this._buffers.infoUpload,
        pass * 16,
        this._buffers.info,
        0,
        16
      );
      const isEven = pass % 2 === 0;
      const bindGroup = isEven ? this._sortBindGroups.even : this._sortBindGroups.odd;
      const passDescriptor = {};
      const isFirstPass = pass === 0;
      const isLastPass = pass === SORT_PASSES - 1;
      if (timing && (isFirstPass && timing.beginIndex !== void 0 || isLastPass && timing.endIndex !== void 0)) {
        passDescriptor.timestampWrites = {
          querySet: timing.querySet
        };
        if (isFirstPass && timing.beginIndex !== void 0) {
          passDescriptor.timestampWrites.beginningOfPassWriteIndex = timing.beginIndex;
        }
        if (isLastPass && timing.endIndex !== void 0) {
          passDescriptor.timestampWrites.endOfPassWriteIndex = timing.endIndex;
        }
      }
      const passEncoder = commandEncoder.beginComputePass(passDescriptor);
      if (pass === 0) {
        passEncoder.setPipeline(this._pipelines.globalHist);
        passEncoder.setBindGroup(0, bindGroup);
        const globalHistBlocks = Math.ceil(count / this.reducePartSize);
        passEncoder.dispatchWorkgroups(globalHistBlocks);
      }
      passEncoder.setPipeline(this._pipelines.scan);
      passEncoder.setBindGroup(0, bindGroup);
      passEncoder.dispatchWorkgroups(1);
      passEncoder.setPipeline(this._pipelines.pass);
      passEncoder.setBindGroup(0, bindGroup);
      passEncoder.dispatchWorkgroups(threadBlocks);
      passEncoder.end();
    }
    return { keysResult: keysIn, valsResult: valsIn };
  }
  _ensureSortBindGroups(keysIn, valsIn) {
    if (this._sortBindGroups.even && this._sortBindGroups.odd && this._sortBindGroups.keysIn === keysIn && this._sortBindGroups.valsIn === valsIn) {
      return;
    }
    this._sortBindGroups.even = this.device.createBindGroup({
      layout: this._bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this._buffers.info } },
        { binding: 1, resource: { buffer: this._buffers.bump } },
        { binding: 2, resource: { buffer: keysIn } },
        { binding: 3, resource: { buffer: this._buffers.altKeys } },
        { binding: 4, resource: { buffer: valsIn } },
        { binding: 5, resource: { buffer: this._buffers.altVals } },
        { binding: 6, resource: { buffer: this._buffers.hist } },
        { binding: 7, resource: { buffer: this._buffers.passHist } },
        { binding: 8, resource: { buffer: this._buffers.status } }
      ]
    });
    this._sortBindGroups.odd = this.device.createBindGroup({
      layout: this._bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this._buffers.info } },
        { binding: 1, resource: { buffer: this._buffers.bump } },
        { binding: 2, resource: { buffer: this._buffers.altKeys } },
        { binding: 3, resource: { buffer: keysIn } },
        { binding: 4, resource: { buffer: this._buffers.altVals } },
        { binding: 5, resource: { buffer: valsIn } },
        { binding: 6, resource: { buffer: this._buffers.hist } },
        { binding: 7, resource: { buffer: this._buffers.passHist } },
        { binding: 8, resource: { buffer: this._buffers.status } }
      ]
    });
    this._sortBindGroups.keysIn = keysIn;
    this._sortBindGroups.valsIn = valsIn;
  }
  async _detectSubgroupSize() {
    if (this._subgroupSize > 0) {
      return this._subgroupSize;
    }
    const device = this.device;
    const module = device.createShaderModule({
      label: "Subgroup Probe",
      code: subgroupDetectShader
    });
    const pipeline = device.createComputePipeline({
      layout: "auto",
      compute: { module, entryPoint: "main" }
    });
    const outputBuffer = device.createBuffer({
      label: "LBVH OneSweep SubgroupProbeOut",
      size: 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
    });
    const stagingBuffer = device.createBuffer({
      label: "LBVH OneSweep SubgroupProbeReadback",
      size: 4,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: outputBuffer } }]
    });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(1);
    pass.end();
    encoder.copyBufferToBuffer(outputBuffer, 0, stagingBuffer, 0, 4);
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
    try {
      await stagingBuffer.mapAsync(GPUMapMode.READ);
      const detected = new Uint32Array(stagingBuffer.getMappedRange())[0];
      stagingBuffer.unmap();
      this._subgroupSize = detected !== 0 ? detected : 16;
    } finally {
      stagingBuffer.destroy();
      outputBuffer.destroy();
    }
    return this._subgroupSize;
  }
  _selectShaderVariant(size) {
    if (size > 32) {
      return { shaderSource: oneSweep64Shader, label: "wave64" };
    }
    if (size === 32) {
      return { shaderSource: oneSweep32Shader, label: "wave32" };
    }
    if (size >= 16) {
      return { shaderSource: oneSweep16Shader, label: "wave16" };
    }
    console.warn(`OneSweepSorter: detected subgroup size ${size}, below minimum (16). Forcing wave16.`);
    return { shaderSource: oneSweep16Shader, label: "wave16 (forced)" };
  }
  dispose() {
    if (this._buffers) {
      for (const key in this._buffers) {
        this._buffers[key]?.destroy();
      }
      this._buffers = null;
    }
  }
  // Minimal validation getters (added for debugging)
  get subgroupSize() {
    return this._subgroupSize;
  }
  get shaderVariant() {
    return this._shaderVariantLabel;
  }
};

// vendor/webphysics/src/lvbh/GPULBVHBuilder.ts
var BUILD_WORKGROUP_SIZE = 256;
var RADIX_PASSES = 4;
var RADIX_WORKGROUP_SIZE = 256;
var RADIX_SIZE = 256;
var LBVH_REFIT_MAX_ITERATION_FACTOR = 4;
var UNIFORM_BYTES = 16;
var UNIFORM_ALIGN = 256;
var UNIFORM_SETUP_OFFSET = 0 * UNIFORM_ALIGN;
var UNIFORM_MORTON_OFFSET = 1 * UNIFORM_ALIGN;
var UNIFORM_LBVH_OFFSET = 2 * UNIFORM_ALIGN;
var UNIFORM_RADIX_BASE_OFFSET = 3 * UNIFORM_ALIGN;
var UNIFORM_SLOT_COUNT = 3 + RADIX_PASSES;
var LBVHSorterType = {
  BUILTIN: "builtin",
  ONESWEEP: "onesweep"
};
var GPULBVHBuilder = class {
  device;
  requestedSorterType;
  warnedNoSubgroups = false;
  sorter = null;
  sorterCapacity = 0;
  pipelines = null;
  buildBuffers = null;
  bufferCapacity = 0;
  sorterInitPromise = null;
  prewarmPromise = null;
  staticBindGroups = {
    setupBounds: null,
    setupMorton: null,
    lbvhInitState: null,
    lbvhBuildTopology: null,
    lbvhSeedInternal: null,
    lbvhRefitWave0to1: null,
    lbvhRefitWave1to0: null,
    lbvhUpdateDispatch0to1: null,
    lbvhUpdateDispatch1to0: null,
    lbvhFinalize: null
  };
  staticBindGroupBuffers = {
    buildBuffers: null,
    position: null,
    index: null
  };
  positionBuffer = null;
  indexBuffer = null;
  primCount = 0;
  positionStride = 3;
  constructor(device, options = {}) {
    this.device = device;
    this.requestedSorterType = options.sorterType ?? LBVHSorterType.ONESWEEP;
  }
  get bvh2Buffer() {
    return this.buildBuffers ? this.buildBuffers.bvh2Nodes : null;
  }
  get clusterIdxBuffer() {
    return this.buildBuffers ? this.buildBuffers.clusterIdx : null;
  }
  get maxNodeCount() {
    return this.primCount > 0 ? this.primCount * 2 : 0;
  }
  async prewarm(primCapacity) {
    if (this.prewarmPromise) {
      return this.prewarmPromise;
    }
    const target = Math.max(1, primCapacity | 0);
    this.prewarmPromise = (async () => {
      this.allocateBuffers(target);
      this.ensurePipelines();
      await this.ensureSorter(target);
    })().finally(() => {
      this.prewarmPromise = null;
    });
    return this.prewarmPromise;
  }
  async buildAsyncFromGPUBuffers(options) {
    const {
      positionBuffer,
      indexBuffer,
      primCount,
      positionStride = 3,
      waitForGpuCompletion = true
    } = options;
    this.positionBuffer = positionBuffer;
    this.indexBuffer = indexBuffer;
    this.primCount = Math.max(0, primCount | 0);
    this.positionStride = positionStride;
    if (this.prewarmPromise) {
      await this.prewarmPromise;
    }
    this.allocateBuffers(this.primCount);
    this.ensurePipelines();
    await this.ensureSorter(this.primCount);
    this.initBuildState();
    this.ensureStaticBindGroups();
    if (this.primCount === 0 || !this.buildBuffers || !this.pipelines) {
      if (waitForGpuCompletion) {
        await this.device.queue.onSubmittedWorkDone();
      }
      return;
    }
    const useOneSweep = this.shouldUseOneSweep();
    const encoder = this.device.createCommandEncoder({ label: "LBVH Build Encoder" });
    this.recordSetupPass(encoder, this.primCount);
    if (useOneSweep) {
      this.recordOneSweepSort(encoder, this.primCount);
    } else {
      this.recordBuiltinRadixSort(encoder, this.primCount);
    }
    this.recordLBVHPass(encoder, this.primCount);
    this.device.queue.submit([encoder.finish()]);
    if (waitForGpuCompletion) {
      await this.device.queue.onSubmittedWorkDone();
    }
  }
  dispose() {
    if (this.sorter) {
      this.sorter.dispose();
      this.sorter = null;
    }
    if (this.buildBuffers) {
      const buffers = this.buildBuffers;
      for (const key of Object.keys(buffers)) {
        buffers[key].destroy();
      }
      this.buildBuffers = null;
    }
    this.pipelines = null;
    this.positionBuffer = null;
    this.indexBuffer = null;
    this.bufferCapacity = 0;
    this.sorterCapacity = 0;
    this.staticBindGroups.setupBounds = null;
    this.staticBindGroups.setupMorton = null;
    this.staticBindGroups.lbvhInitState = null;
    this.staticBindGroups.lbvhBuildTopology = null;
    this.staticBindGroups.lbvhSeedInternal = null;
    this.staticBindGroups.lbvhRefitWave0to1 = null;
    this.staticBindGroups.lbvhRefitWave1to0 = null;
    this.staticBindGroups.lbvhUpdateDispatch0to1 = null;
    this.staticBindGroups.lbvhUpdateDispatch1to0 = null;
    this.staticBindGroups.lbvhFinalize = null;
    this.staticBindGroupBuffers.buildBuffers = null;
    this.staticBindGroupBuffers.position = null;
    this.staticBindGroupBuffers.index = null;
  }
  shouldUseOneSweep() {
    if (this.requestedSorterType !== LBVHSorterType.ONESWEEP) {
      return false;
    }
    const hasSubgroups = this.device.features.has("subgroups");
    if (!hasSubgroups && !this.warnedNoSubgroups) {
      this.warnedNoSubgroups = true;
      console.warn("GPULBVHBuilder: subgroups unavailable, falling back to builtin radix sort.");
    }
    return hasSubgroups;
  }
  ensurePipelines() {
    if (this.pipelines) {
      return;
    }
    const hasSubgroups = this.device.features.has("subgroups");
    const setupBoundsShader = hasSubgroups ? setupShaders.computeBoundsSubgroup : setupShaders.computeBounds;
    const setupBoundsModule = this.device.createShaderModule({
      label: "LBVH setupBounds",
      code: setupBoundsShader
    });
    const setupMortonModule = this.device.createShaderModule({
      label: "LBVH setupMorton",
      code: setupShaders.computeMorton
    });
    const radixHistogramModule = this.device.createShaderModule({
      label: "LBVH radixHistogram",
      code: radixSortShaders.histogram
    });
    const radixWorkgroupScanModule = this.device.createShaderModule({
      label: "LBVH radixWorkgroupScan",
      code: radixSortShaders.workgroupScan
    });
    const radixScanModule = this.device.createShaderModule({
      label: "LBVH radixScan",
      code: radixSortShaders.scan
    });
    const radixScatterModule = this.device.createShaderModule({
      label: "LBVH radixScatter",
      code: radixSortShaders.scatter
    });
    const lbvhInitStateModule = this.device.createShaderModule({
      label: "LBVH initState",
      code: lbvhInitStateShader
    });
    const lbvhBuildTopologyModule = this.device.createShaderModule({
      label: "LBVH buildTopology",
      code: lbvhBuildTopologyShader
    });
    const lbvhSeedInternalModule = this.device.createShaderModule({
      label: "LBVH seedInternal",
      code: lbvhSeedInternalShader
    });
    const lbvhRefitWaveModule = this.device.createShaderModule({
      label: "LBVH refitWave",
      code: lbvhRefitWaveShader
    });
    const lbvhUpdateDispatchModule = this.device.createShaderModule({
      label: "LBVH updateDispatch",
      code: lbvhUpdateDispatchShader
    });
    const lbvhFinalizeModule = this.device.createShaderModule({
      label: "LBVH finalize",
      code: lbvhFinalizeShader
    });
    this.pipelines = {
      setupBounds: this.device.createComputePipeline({
        label: "LBVH Setup Bounds",
        layout: "auto",
        compute: { module: setupBoundsModule, entryPoint: "computeBounds" }
      }),
      setupMorton: this.device.createComputePipeline({
        label: "LBVH Setup Morton",
        layout: "auto",
        compute: { module: setupMortonModule, entryPoint: "computeMorton" }
      }),
      radixHistogram: this.device.createComputePipeline({
        label: "LBVH Radix Histogram",
        layout: "auto",
        compute: { module: radixHistogramModule, entryPoint: "computeHistogram" }
      }),
      radixWorkgroupScan: this.device.createComputePipeline({
        label: "LBVH Radix WorkgroupScan",
        layout: "auto",
        compute: { module: radixWorkgroupScanModule, entryPoint: "workgroupScan" }
      }),
      radixScan: this.device.createComputePipeline({
        label: "LBVH Radix Scan",
        layout: "auto",
        compute: { module: radixScanModule, entryPoint: "prefixScan" }
      }),
      radixScatter: this.device.createComputePipeline({
        label: "LBVH Radix Scatter",
        layout: "auto",
        compute: { module: radixScatterModule, entryPoint: "scatter" }
      }),
      lbvhInitState: this.device.createComputePipeline({
        label: "LBVH Init State",
        layout: "auto",
        compute: { module: lbvhInitStateModule, entryPoint: "initState" }
      }),
      lbvhBuildTopology: this.device.createComputePipeline({
        label: "LBVH Build Topology",
        layout: "auto",
        compute: { module: lbvhBuildTopologyModule, entryPoint: "buildTopology" }
      }),
      lbvhSeedInternal: this.device.createComputePipeline({
        label: "LBVH Seed Internal",
        layout: "auto",
        compute: { module: lbvhSeedInternalModule, entryPoint: "seedInternal" }
      }),
      lbvhRefitWave: this.device.createComputePipeline({
        label: "LBVH Refit Wave",
        layout: "auto",
        compute: { module: lbvhRefitWaveModule, entryPoint: "refitWave" }
      }),
      lbvhUpdateDispatch: this.device.createComputePipeline({
        label: "LBVH Update Dispatch",
        layout: "auto",
        compute: { module: lbvhUpdateDispatchModule, entryPoint: "updateDispatch" }
      }),
      lbvhFinalize: this.device.createComputePipeline({
        label: "LBVH Finalize",
        layout: "auto",
        compute: { module: lbvhFinalizeModule, entryPoint: "finalizeTree" }
      })
    };
  }
  async ensureSorter(primCount) {
    if (!this.shouldUseOneSweep()) {
      return;
    }
    if (!this.sorter) {
      this.sorter = new OneSweepSorter(this.device);
    }
    const targetCapacity = Math.max(primCount, 1);
    if (this.sorterInitPromise) {
      await this.sorterInitPromise;
    }
    if (this.sorterCapacity < targetCapacity) {
      this.sorterInitPromise = this.sorter.init(targetCapacity).then(() => {
        this.sorterCapacity = targetCapacity;
      }).finally(() => {
        this.sorterInitPromise = null;
      });
      await this.sorterInitPromise;
    }
  }
  allocateBuffers(primCount) {
    if (primCount <= this.bufferCapacity && this.buildBuffers) {
      return;
    }
    const newCapacity = Math.max(1024, this.nextPowerOf2(Math.max(1, primCount)));
    const workgroupCount = Math.max(1, Math.ceil(newCapacity / RADIX_WORKGROUP_SIZE));
    const maxNodes = Math.max(2, newCapacity * 2);
    if (this.buildBuffers) {
      const old = this.buildBuffers;
      for (const key of Object.keys(old)) {
        old[key].destroy();
      }
      this.staticBindGroups.setupBounds = null;
      this.staticBindGroups.setupMorton = null;
      this.staticBindGroups.lbvhInitState = null;
      this.staticBindGroups.lbvhBuildTopology = null;
      this.staticBindGroups.lbvhSeedInternal = null;
      this.staticBindGroups.lbvhRefitWave0to1 = null;
      this.staticBindGroups.lbvhRefitWave1to0 = null;
      this.staticBindGroups.lbvhUpdateDispatch0to1 = null;
      this.staticBindGroups.lbvhUpdateDispatch1to0 = null;
      this.staticBindGroups.lbvhFinalize = null;
      this.staticBindGroupBuffers.buildBuffers = null;
      this.staticBindGroupBuffers.position = null;
      this.staticBindGroupBuffers.index = null;
    }
    this.buildBuffers = {
      sceneBounds: this.device.createBuffer({
        label: "LBVH Scene Bounds",
        size: 24,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
      }),
      mortonCodes: this.device.createBuffer({
        label: "LBVH Morton",
        size: newCapacity * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
      }),
      mortonCodesAlt: this.device.createBuffer({
        label: "LBVH Morton Alt",
        size: newCapacity * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
      }),
      clusterIdx: this.device.createBuffer({
        label: "LBVH ClusterIdx",
        size: newCapacity * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
      }),
      clusterIdxAlt: this.device.createBuffer({
        label: "LBVH ClusterIdx Alt",
        size: newCapacity * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
      }),
      hplocState: this.device.createBuffer({
        label: "LBVH HplocState Scratch",
        size: newCapacity * 4 * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
      }),
      activeList: this.device.createBuffer({
        label: "LBVH ActiveList Scratch",
        size: newCapacity * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
      }),
      parentIdx: this.device.createBuffer({
        label: "LBVH ParentIdx",
        size: maxNodes * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
      }),
      refitVisitCount: this.device.createBuffer({
        label: "LBVH VisitCount",
        size: maxNodes * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
      }),
      activeCount0: this.device.createBuffer({
        label: "LBVH ActiveCount0",
        size: 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
      }),
      activeCount1: this.device.createBuffer({
        label: "LBVH ActiveCount1",
        size: 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
      }),
      indirectDispatch: this.device.createBuffer({
        label: "LBVH IndirectDispatch",
        size: 3 * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST
      }),
      bvh2Nodes: this.device.createBuffer({
        label: "LBVH Nodes",
        size: maxNodes * 32,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
      }),
      nodeCounter: this.device.createBuffer({
        label: "LBVH NodeCounter",
        size: 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
      }),
      groupCounts: this.device.createBuffer({
        label: "LBVH GroupCounts",
        size: workgroupCount * RADIX_SIZE * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
      }),
      groupPrefix: this.device.createBuffer({
        label: "LBVH GroupPrefix",
        size: workgroupCount * RADIX_SIZE * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
      }),
      globalDigitCount: this.device.createBuffer({
        label: "LBVH GlobalDigitCount",
        size: RADIX_SIZE * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
      }),
      digitOffsets: this.device.createBuffer({
        label: "LBVH DigitOffsets",
        size: RADIX_SIZE * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
      }),
      uniforms: this.device.createBuffer({
        label: "LBVH Uniforms",
        size: UNIFORM_ALIGN * UNIFORM_SLOT_COUNT,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
      })
    };
    this.bufferCapacity = newCapacity;
  }
  ensureStaticBindGroups() {
    if (!this.buildBuffers || !this.pipelines || !this.positionBuffer || !this.indexBuffer) {
      return;
    }
    const needsRebuild = this.staticBindGroupBuffers.buildBuffers !== this.buildBuffers || this.staticBindGroupBuffers.position !== this.positionBuffer || this.staticBindGroupBuffers.index !== this.indexBuffer || !this.staticBindGroups.setupBounds || !this.staticBindGroups.setupMorton || !this.staticBindGroups.lbvhInitState || !this.staticBindGroups.lbvhBuildTopology || !this.staticBindGroups.lbvhSeedInternal || !this.staticBindGroups.lbvhRefitWave0to1 || !this.staticBindGroups.lbvhRefitWave1to0 || !this.staticBindGroups.lbvhUpdateDispatch0to1 || !this.staticBindGroups.lbvhUpdateDispatch1to0 || !this.staticBindGroups.lbvhFinalize;
    if (!needsRebuild) {
      return;
    }
    const b = this.buildBuffers;
    const p = this.pipelines;
    this.staticBindGroups.setupBounds = this.device.createBindGroup({
      layout: p.setupBounds.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: b.uniforms, offset: UNIFORM_SETUP_OFFSET, size: UNIFORM_BYTES } },
        { binding: 1, resource: { buffer: this.positionBuffer } },
        { binding: 2, resource: { buffer: this.indexBuffer } },
        { binding: 3, resource: { buffer: b.bvh2Nodes } },
        { binding: 4, resource: { buffer: b.clusterIdx } },
        { binding: 5, resource: { buffer: b.sceneBounds } },
        { binding: 6, resource: { buffer: b.parentIdx } },
        { binding: 7, resource: { buffer: b.hplocState } },
        { binding: 8, resource: { buffer: b.activeList } }
      ]
    });
    this.staticBindGroups.setupMorton = this.device.createBindGroup({
      layout: p.setupMorton.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: b.uniforms, offset: UNIFORM_MORTON_OFFSET, size: UNIFORM_BYTES } },
        { binding: 1, resource: { buffer: b.bvh2Nodes } },
        { binding: 2, resource: { buffer: b.sceneBounds } },
        { binding: 3, resource: { buffer: b.mortonCodes } }
      ]
    });
    this.staticBindGroups.lbvhInitState = this.device.createBindGroup({
      layout: p.lbvhInitState.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: b.uniforms, offset: UNIFORM_LBVH_OFFSET, size: UNIFORM_BYTES } },
        { binding: 1, resource: { buffer: b.parentIdx } },
        { binding: 2, resource: { buffer: b.refitVisitCount } }
      ]
    });
    this.staticBindGroups.lbvhBuildTopology = this.device.createBindGroup({
      layout: p.lbvhBuildTopology.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: b.uniforms, offset: UNIFORM_LBVH_OFFSET, size: UNIFORM_BYTES } },
        { binding: 1, resource: { buffer: b.mortonCodes } },
        { binding: 2, resource: { buffer: b.clusterIdx } },
        { binding: 3, resource: { buffer: b.bvh2Nodes } },
        { binding: 4, resource: { buffer: b.parentIdx } }
      ]
    });
    this.staticBindGroups.lbvhSeedInternal = this.device.createBindGroup({
      layout: p.lbvhSeedInternal.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: b.uniforms, offset: UNIFORM_LBVH_OFFSET, size: UNIFORM_BYTES } },
        { binding: 1, resource: { buffer: b.clusterIdx } },
        { binding: 2, resource: { buffer: b.parentIdx } },
        { binding: 3, resource: { buffer: b.refitVisitCount } },
        { binding: 4, resource: { buffer: b.activeList } },
        { binding: 5, resource: { buffer: b.activeCount0 } }
      ]
    });
    this.staticBindGroups.lbvhRefitWave0to1 = this.device.createBindGroup({
      layout: p.lbvhRefitWave.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: b.uniforms, offset: UNIFORM_LBVH_OFFSET, size: UNIFORM_BYTES } },
        { binding: 1, resource: { buffer: b.bvh2Nodes } },
        { binding: 2, resource: { buffer: b.parentIdx } },
        { binding: 3, resource: { buffer: b.refitVisitCount } },
        { binding: 4, resource: { buffer: b.activeList } },
        { binding: 5, resource: { buffer: b.clusterIdxAlt } },
        { binding: 6, resource: { buffer: b.activeCount0 } },
        { binding: 7, resource: { buffer: b.activeCount1 } }
      ]
    });
    this.staticBindGroups.lbvhRefitWave1to0 = this.device.createBindGroup({
      layout: p.lbvhRefitWave.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: b.uniforms, offset: UNIFORM_LBVH_OFFSET, size: UNIFORM_BYTES } },
        { binding: 1, resource: { buffer: b.bvh2Nodes } },
        { binding: 2, resource: { buffer: b.parentIdx } },
        { binding: 3, resource: { buffer: b.refitVisitCount } },
        { binding: 4, resource: { buffer: b.clusterIdxAlt } },
        { binding: 5, resource: { buffer: b.activeList } },
        { binding: 6, resource: { buffer: b.activeCount1 } },
        { binding: 7, resource: { buffer: b.activeCount0 } }
      ]
    });
    this.staticBindGroups.lbvhUpdateDispatch0to1 = this.device.createBindGroup({
      layout: p.lbvhUpdateDispatch.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: b.activeCount0 } },
        { binding: 1, resource: { buffer: b.indirectDispatch } },
        { binding: 2, resource: { buffer: b.activeCount1 } }
      ]
    });
    this.staticBindGroups.lbvhUpdateDispatch1to0 = this.device.createBindGroup({
      layout: p.lbvhUpdateDispatch.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: b.activeCount1 } },
        { binding: 1, resource: { buffer: b.indirectDispatch } },
        { binding: 2, resource: { buffer: b.activeCount0 } }
      ]
    });
    this.staticBindGroups.lbvhFinalize = this.device.createBindGroup({
      layout: p.lbvhFinalize.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: b.uniforms, offset: UNIFORM_LBVH_OFFSET, size: UNIFORM_BYTES } },
        { binding: 1, resource: { buffer: b.clusterIdx } },
        { binding: 2, resource: { buffer: b.nodeCounter } }
      ]
    });
    this.staticBindGroupBuffers.buildBuffers = this.buildBuffers;
    this.staticBindGroupBuffers.position = this.positionBuffer;
    this.staticBindGroupBuffers.index = this.indexBuffer;
  }
  initBuildState() {
    if (!this.buildBuffers) {
      return;
    }
    const boundsInitU32 = new Uint32Array([
      4286578688,
      4286578688,
      4286578688,
      8388607,
      8388607,
      8388607
    ]);
    this.device.queue.writeBuffer(this.buildBuffers.sceneBounds, 0, boundsInitU32);
    this.device.queue.writeBuffer(this.buildBuffers.nodeCounter, 0, new Uint32Array([this.primCount]));
  }
  recordSetupPass(commandEncoder, primCount) {
    if (!this.buildBuffers || !this.pipelines || !this.staticBindGroups.setupBounds || !this.staticBindGroups.setupMorton) {
      return;
    }
    const workgroupCount = Math.ceil(primCount / BUILD_WORKGROUP_SIZE);
    this.device.queue.writeBuffer(this.buildBuffers.uniforms, UNIFORM_SETUP_OFFSET, new Uint32Array([
      primCount,
      workgroupCount,
      this.positionStride,
      0
    ]));
    this.device.queue.writeBuffer(this.buildBuffers.uniforms, UNIFORM_MORTON_OFFSET, new Uint32Array([
      primCount,
      workgroupCount,
      0,
      0
    ]));
    const pass = commandEncoder.beginComputePass({ label: "LBVH Setup Pass" });
    pass.setPipeline(this.pipelines.setupBounds);
    pass.setBindGroup(0, this.staticBindGroups.setupBounds);
    pass.dispatchWorkgroups(workgroupCount);
    pass.setPipeline(this.pipelines.setupMorton);
    pass.setBindGroup(0, this.staticBindGroups.setupMorton);
    pass.dispatchWorkgroups(workgroupCount);
    pass.end();
  }
  recordOneSweepSort(commandEncoder, primCount) {
    if (!this.buildBuffers || !this.sorter) {
      return;
    }
    this.sorter.sort({
      commandEncoder,
      keysIn: this.buildBuffers.mortonCodes,
      keysOut: this.buildBuffers.mortonCodesAlt,
      valsIn: this.buildBuffers.clusterIdx,
      valsOut: this.buildBuffers.clusterIdxAlt,
      count: primCount
    });
  }
  recordBuiltinRadixSort(commandEncoder, primCount) {
    if (!this.buildBuffers || !this.pipelines) {
      return;
    }
    const workgroupCount = Math.ceil(primCount / RADIX_WORKGROUP_SIZE);
    commandEncoder.clearBuffer(this.buildBuffers.groupCounts);
    commandEncoder.clearBuffer(this.buildBuffers.groupPrefix);
    commandEncoder.clearBuffer(this.buildBuffers.digitOffsets);
    let keysIn = this.buildBuffers.mortonCodes;
    let keysOut = this.buildBuffers.mortonCodesAlt;
    let valsIn = this.buildBuffers.clusterIdx;
    let valsOut = this.buildBuffers.clusterIdxAlt;
    for (let passId = 0; passId < RADIX_PASSES; passId++) {
      const passUniformOffset = UNIFORM_RADIX_BASE_OFFSET + passId * UNIFORM_ALIGN;
      this.device.queue.writeBuffer(
        this.buildBuffers.uniforms,
        passUniformOffset,
        new Uint32Array([primCount, passId * 8, workgroupCount, 0])
      );
      commandEncoder.clearBuffer(this.buildBuffers.globalDigitCount);
      {
        const pass = commandEncoder.beginComputePass({ label: `LBVH Radix Histogram ${passId}` });
        const bindGroup = this.device.createBindGroup({
          layout: this.pipelines.radixHistogram.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: this.buildBuffers.uniforms, offset: passUniformOffset, size: UNIFORM_BYTES } },
            { binding: 1, resource: { buffer: keysIn } },
            { binding: 2, resource: { buffer: this.buildBuffers.groupCounts } },
            { binding: 3, resource: { buffer: this.buildBuffers.globalDigitCount } }
          ]
        });
        pass.setPipeline(this.pipelines.radixHistogram);
        pass.setBindGroup(0, bindGroup);
        pass.dispatchWorkgroups(workgroupCount);
        pass.end();
      }
      {
        const pass = commandEncoder.beginComputePass({ label: `LBVH Radix WorkgroupScan ${passId}` });
        const bindGroup = this.device.createBindGroup({
          layout: this.pipelines.radixWorkgroupScan.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: this.buildBuffers.uniforms, offset: passUniformOffset, size: UNIFORM_BYTES } },
            { binding: 1, resource: { buffer: this.buildBuffers.groupCounts } },
            { binding: 2, resource: { buffer: this.buildBuffers.groupPrefix } }
          ]
        });
        pass.setPipeline(this.pipelines.radixWorkgroupScan);
        pass.setBindGroup(0, bindGroup);
        pass.dispatchWorkgroups(1);
        pass.end();
      }
      {
        const pass = commandEncoder.beginComputePass({ label: `LBVH Radix Scan ${passId}` });
        const bindGroup = this.device.createBindGroup({
          layout: this.pipelines.radixScan.getBindGroupLayout(0),
          entries: [
            { binding: 1, resource: { buffer: this.buildBuffers.globalDigitCount } },
            { binding: 2, resource: { buffer: this.buildBuffers.digitOffsets } }
          ]
        });
        pass.setPipeline(this.pipelines.radixScan);
        pass.setBindGroup(0, bindGroup);
        pass.dispatchWorkgroups(1);
        pass.end();
      }
      {
        const pass = commandEncoder.beginComputePass({ label: `LBVH Radix Scatter ${passId}` });
        const bindGroup = this.device.createBindGroup({
          layout: this.pipelines.radixScatter.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: this.buildBuffers.uniforms, offset: passUniformOffset, size: UNIFORM_BYTES } },
            { binding: 1, resource: { buffer: keysIn } },
            { binding: 2, resource: { buffer: keysOut } },
            { binding: 3, resource: { buffer: valsIn } },
            { binding: 4, resource: { buffer: valsOut } },
            { binding: 5, resource: { buffer: this.buildBuffers.groupPrefix } },
            { binding: 6, resource: { buffer: this.buildBuffers.digitOffsets } }
          ]
        });
        pass.setPipeline(this.pipelines.radixScatter);
        pass.setBindGroup(0, bindGroup);
        pass.dispatchWorkgroups(workgroupCount);
        pass.end();
      }
      [keysIn, keysOut] = [keysOut, keysIn];
      [valsIn, valsOut] = [valsOut, valsIn];
    }
  }
  recordLBVHPass(commandEncoder, primCount) {
    if (!this.buildBuffers || !this.pipelines || !this.staticBindGroups.lbvhInitState || !this.staticBindGroups.lbvhBuildTopology || !this.staticBindGroups.lbvhSeedInternal || !this.staticBindGroups.lbvhRefitWave0to1 || !this.staticBindGroups.lbvhRefitWave1to0 || !this.staticBindGroups.lbvhUpdateDispatch0to1 || !this.staticBindGroups.lbvhUpdateDispatch1to0 || !this.staticBindGroups.lbvhFinalize) {
      return;
    }
    this.device.queue.writeBuffer(
      this.buildBuffers.uniforms,
      UNIFORM_LBVH_OFFSET,
      new Uint32Array([primCount, 0, 0, 0])
    );
    commandEncoder.clearBuffer(this.buildBuffers.activeCount0);
    commandEncoder.clearBuffer(this.buildBuffers.activeCount1);
    const pass = commandEncoder.beginComputePass({ label: "LBVH Topology Pass" });
    pass.setPipeline(this.pipelines.lbvhInitState);
    pass.setBindGroup(0, this.staticBindGroups.lbvhInitState);
    pass.dispatchWorkgroups(Math.ceil(primCount * 2 / BUILD_WORKGROUP_SIZE));
    if (primCount > 1) {
      pass.setPipeline(this.pipelines.lbvhBuildTopology);
      pass.setBindGroup(0, this.staticBindGroups.lbvhBuildTopology);
      pass.dispatchWorkgroups(Math.ceil((primCount - 1) / BUILD_WORKGROUP_SIZE));
      pass.setPipeline(this.pipelines.lbvhSeedInternal);
      pass.setBindGroup(0, this.staticBindGroups.lbvhSeedInternal);
      pass.dispatchWorkgroups(Math.ceil(primCount / BUILD_WORKGROUP_SIZE));
      const maxIterations = this.getRefitMaxIterations(primCount);
      for (let iter = 0; iter < maxIterations; iter++) {
        const even = (iter & 1) === 0;
        pass.setPipeline(this.pipelines.lbvhUpdateDispatch);
        pass.setBindGroup(
          0,
          even ? this.staticBindGroups.lbvhUpdateDispatch0to1 : this.staticBindGroups.lbvhUpdateDispatch1to0
        );
        pass.dispatchWorkgroups(1);
        pass.setPipeline(this.pipelines.lbvhRefitWave);
        pass.setBindGroup(
          0,
          even ? this.staticBindGroups.lbvhRefitWave0to1 : this.staticBindGroups.lbvhRefitWave1to0
        );
        pass.dispatchWorkgroupsIndirect(this.buildBuffers.indirectDispatch, 0);
      }
    }
    pass.setPipeline(this.pipelines.lbvhFinalize);
    pass.setBindGroup(0, this.staticBindGroups.lbvhFinalize);
    pass.dispatchWorkgroups(1);
    pass.end();
  }
  getRefitMaxIterations(primCount) {
    if (primCount <= 1) {
      return 1;
    }
    return Math.max(1, Math.ceil(Math.log2(primCount) * LBVH_REFIT_MAX_ITERATION_FACTOR));
  }
  nextPowerOf2(value) {
    let v = Math.max(1, value | 0);
    v--;
    v |= v >> 1;
    v |= v >> 2;
    v |= v >> 4;
    v |= v >> 8;
    v |= v >> 16;
    v++;
    return v;
  }
};

// vendor/webphysics/src/physics/gpu/broadPhase.ts
var WORKGROUP_SIZE5 = 256;
var CANDIDATE_WORKGROUP_SIZE = 64;
var PAIR_STACK_SIZE = 64;
var DEBUG_COUNTER_WORDS = 8;
var BroadPhaseStage = class {
  gpuBVHs;
  enableBvhBuild;
  buildOnce;
  rebuildIntervalFrames;
  waitForGpuCompletion;
  device;
  maxBodies;
  maxPairs;
  maxPairsPerBody;
  updateAabbKernel;
  bootstrapKernel;
  positionsAttr;
  shapesAttr;
  pairActivityAttr;
  aabbPositionAttr;
  aabbSnapshotBuffer;
  aabbIndexBuffer;
  pairCandidateIndicesAttr;
  pairVisitedBitsAttr;
  candidateUniformBuffer;
  candidateCounterBuffer;
  debugCountersBuffer;
  debugReadbackBuffer;
  candidateBindGroupLayout;
  clearCounterPipeline;
  clearVisitedPipeline;
  emitPairsPipeline;
  finalizeCounterPipeline;
  candidateBindGroup = null;
  candidateBindGroupBuffers = {
    positions: null,
    aabbPosition: null,
    bvh: null,
    clusterIdx: null,
    pairCandidate: null,
    pairVisited: null,
    pairActivity: null,
    shapes: null
  };
  buildInFlight = null;
  prewarmInFlight = null;
  buildInFlightStartFrame = -1;
  activeBvhIndex = 0;
  activeBvhSnapshotFrame = -1;
  lastBuildMs = 0;
  candidatePairsEnabled = false;
  backendBuffersReady = false;
  bvhBuffersReady = false;
  storageBuffersInitialized = false;
  storageInitWarned = false;
  bootstrapDone = false;
  lastBuildFrame = -1;
  hasBuiltOnce = false;
  buildGeneration = 0;
  debugEnabled = false;
  debugReadbackInFlight = false;
  debugEveryNFrames = 30;
  lastDebugLogFrame = -1;
  getActiveBVH() {
    return this.gpuBVHs[this.activeBvhIndex];
  }
  getBuildBVH() {
    return this.gpuBVHs[1 - this.activeBvhIndex];
  }
  startBuild(aabbPositionBuffer, bodyCount, frameId) {
    if (this.buildInFlight) {
      return;
    }
    const buildStart = performance.now();
    this.lastBuildFrame = frameId;
    this.buildInFlightStartFrame = frameId;
    const buildBVHIndex = 1 - this.activeBvhIndex;
    const buildBVH = this.getBuildBVH();
    const buildGeneration = this.buildGeneration;
    const copyBytes = Math.max(4, bodyCount * 9 * 4);
    const snapshotEncoder = this.device.createCommandEncoder({ label: "Broadphase AABB Snapshot Copy" });
    snapshotEncoder.copyBufferToBuffer(aabbPositionBuffer, 0, this.aabbSnapshotBuffer, 0, copyBytes);
    this.device.queue.submit([snapshotEncoder.finish()]);
    this.buildInFlight = buildBVH.buildAsyncFromGPUBuffers({
      positionBuffer: this.aabbSnapshotBuffer,
      indexBuffer: this.aabbIndexBuffer,
      primCount: bodyCount,
      positionStride: 3,
      useFlatten: false,
      waitForGpuCompletion: this.waitForGpuCompletion
    }).then(() => {
      if (buildGeneration !== this.buildGeneration) {
        return;
      }
      this.activeBvhIndex = buildBVHIndex;
      this.activeBvhSnapshotFrame = frameId;
      this.hasBuiltOnce = true;
      this.candidateBindGroup = null;
      this.candidateBindGroupBuffers.bvh = null;
      this.candidateBindGroupBuffers.clusterIdx = null;
      this.lastBuildMs = performance.now() - buildStart;
    }).catch((error) => {
      if (buildGeneration !== this.buildGeneration) {
        return;
      }
      this.lastBuildMs = 0;
      console.warn("BroadPhaseStage BVH build failed:", error);
    }).finally(() => {
      if (buildGeneration !== this.buildGeneration) {
        return;
      }
      this.buildInFlight = null;
      this.buildInFlightStartFrame = -1;
    });
  }
  constructor(device, positions, velocities, quaternions, shapes, pairActivity, pairCandidateIndices, pairVisitedBits, maxBodies, maxPairs, maxPairsPerBody, ignorePairBitsOffset, options) {
    this.device = device;
    this.maxBodies = maxBodies;
    this.maxPairs = maxPairs;
    this.maxPairsPerBody = maxPairsPerBody;
    this.positionsAttr = positions;
    this.shapesAttr = shapes;
    this.pairActivityAttr = pairActivity;
    this.enableBvhBuild = options?.enableBvhBuild ?? true;
    this.buildOnce = options?.buildOnce ?? false;
    this.rebuildIntervalFrames = Math.max(1, Math.floor(options?.rebuildIntervalFrames ?? 1));
    this.waitForGpuCompletion = options?.waitForGpuCompletion ?? true;
    this.pairCandidateIndicesAttr = pairCandidateIndices;
    this.pairVisitedBitsAttr = pairVisitedBits;
    this.gpuBVHs = [
      new GPULBVHBuilder(device, {
        sorterType: LBVHSorterType.ONESWEEP
      }),
      new GPULBVHBuilder(device, {
        sorterType: LBVHSorterType.ONESWEEP
      })
    ];
    const prewarmCapacity = Math.max(1, this.maxBodies);
    const prewarmPromises = [];
    if (typeof this.gpuBVHs[0].prewarm === "function") {
      prewarmPromises.push(this.gpuBVHs[0].prewarm(prewarmCapacity));
    }
    if (typeof this.gpuBVHs[1].prewarm === "function") {
      prewarmPromises.push(this.gpuBVHs[1].prewarm(prewarmCapacity));
    }
    if (prewarmPromises.length > 0) {
      this.prewarmInFlight = Promise.all(prewarmPromises).then(() => void 0).catch((error) => {
        console.warn("BroadPhaseStage BVH prewarm failed:", error);
      }).finally(() => {
        this.prewarmInFlight = null;
      });
    }
    this.aabbPositionAttr = new StorageBufferAttribute3(new Float32Array(maxBodies * 9), 1);
    this.aabbSnapshotBuffer = this.device.createBuffer({
      label: "Broadphase AABB Snapshot",
      size: maxBodies * 9 * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    const indexData = new Uint32Array(maxBodies * 3);
    for (let i = 0; i < maxBodies; i++) {
      indexData[i * 3 + 0] = i * 3;
      indexData[i * 3 + 1] = i * 3 + 1;
      indexData[i * 3 + 2] = i * 3 + 2;
    }
    this.aabbIndexBuffer = this.device.createBuffer({
      size: indexData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    this.device.queue.writeBuffer(this.aabbIndexBuffer, 0, indexData);
    const updateAabbShader = wgslFn(
      /* wgsl */
      `
      fn compute(
        positions: ptr<storage, array<vec4f>, read>,
        velocities: ptr<storage, array<vec4f>, read>,
        quaternions: ptr<storage, array<vec4f>, read>,
        shapes: ptr<storage, array<vec4f>, read>,
        aabbPositions: ptr<storage, array<f32>, read_write>,
        bodyCount: u32,
        aabbMargin: f32,
        aabbVelocityHorizon: f32,
        workgroupId: vec3u,
        localId: vec3u,
      ) -> void {
        let gid = workgroupId.x * ${WORKGROUP_SIZE5}u + localId.x;
        if (gid >= bodyCount) { return; }

        let pos = positions[gid].xyz;
        let vel = velocities[gid].xyz;
        let q = quaternions[gid];
        let shape = shapes[gid];
        let half = shape.yzw;
        let shapeType = decodeShapeType(shape.x);
        let base = gid * 9u;

        // Keep BVH input finite; invalid values can poison the builder.
        if (!isFinite3(pos) || !isFinite4(q) || !isFinite3(half)) {
          let safe = vec3f(0.0, -1e6, 0.0);
          aabbPositions[base + 0u] = safe.x;
          aabbPositions[base + 1u] = safe.y;
          aabbPositions[base + 2u] = safe.z;
          aabbPositions[base + 3u] = safe.x;
          aabbPositions[base + 4u] = safe.y;
          aabbPositions[base + 5u] = safe.z;
          aabbPositions[base + 6u] = safe.x;
          aabbPositions[base + 7u] = safe.y;
          aabbPositions[base + 8u] = safe.z;
          return;
        }

        let velPad = abs(vel) * aabbVelocityHorizon;
        var e = vec3f(0.0);
        if (shapeType == SHAPE_TYPE_SPHERE) {
          e = vec3f(max(half.x, 0.0)) + vec3f(aabbMargin) + velPad;
        } else {
          let ax0 = qrot(q, vec3f(1.0, 0.0, 0.0));
          let ax1 = qrot(q, vec3f(0.0, 1.0, 0.0));
          let ax2 = qrot(q, vec3f(0.0, 0.0, 1.0));

          let ex = abs(ax0.x) * half.x + abs(ax1.x) * half.y + abs(ax2.x) * half.z;
          let ey = abs(ax0.y) * half.x + abs(ax1.y) * half.y + abs(ax2.y) * half.z;
          let ez = abs(ax0.z) * half.x + abs(ax1.z) * half.y + abs(ax2.z) * half.z;
          e = vec3f(ex, ey, ez) + vec3f(aabbMargin) + velPad;
        }

        aabbPositions[base + 0u] = pos.x - e.x;
        aabbPositions[base + 1u] = pos.y - e.y;
        aabbPositions[base + 2u] = pos.z - e.z;

        aabbPositions[base + 3u] = pos.x + e.x;
        aabbPositions[base + 4u] = pos.y + e.y;
        aabbPositions[base + 5u] = pos.z + e.z;

        aabbPositions[base + 6u] = pos.x;
        aabbPositions[base + 7u] = pos.y;
        aabbPositions[base + 8u] = pos.z;
      }

      const SHAPE_TYPE_SHIFT: u32 = 14u;
      const SHAPE_TYPE_MASK: u32 = 0x3u;
      const SHAPE_TYPE_SPHERE: u32 = 1u;

      fn decodeShapeType(shapeMeta: f32) -> u32 {
        return (bitcast<u32>(shapeMeta) >> SHAPE_TYPE_SHIFT) & SHAPE_TYPE_MASK;
      }

      fn isFinite3(v: vec3f) -> bool {
        let nonNan = all(v == v);
        let bounded = all(abs(v) <= vec3f(1e20));
        return nonNan && bounded;
      }

      fn isFinite4(v: vec4f) -> bool {
        let nonNan = all(v == v);
        let bounded = all(abs(v) <= vec4f(1e20));
        return nonNan && bounded;
      }

      fn qrot(q: vec4f, v: vec3f) -> vec3f {
        let t = 2.0 * cross(q.xyz, v);
        return v + q.w * t + cross(q.xyz, t);
      }
    `
    );
    this.updateAabbKernel = updateAabbShader({
      positions: storage(positions, "vec4f", maxBodies).toReadOnly(),
      velocities: storage(velocities, "vec4f", maxBodies).toReadOnly(),
      quaternions: storage(quaternions, "vec4f", maxBodies).toReadOnly(),
      shapes: storage(shapes, "vec4f", maxBodies).toReadOnly(),
      aabbPositions: storage(this.aabbPositionAttr, "float", maxBodies * 9),
      bodyCount: uniform(0),
      // Keep broadphase pairs alive across contact persistence/slop bands to
      // avoid frame-to-frame pair drop/re-add buzzing in resting stacks.
      aabbMargin: uniform(0.01),
      aabbVelocityHorizon: uniform(1 / 60),
      workgroupId,
      localId
    }).computeKernel([WORKGROUP_SIZE5, 1, 1]).setName("Broadphase Update AABBs");
    const bootstrapShader = wgslFn(
      /* wgsl */
      `
      fn compute(
        pairCandidateIndices: ptr<storage, array<u32>, read_write>,
        pairVisitedBits: ptr<storage, array<u32>, read_write>,
      ) -> void {
        // Force renderer-managed storage allocation for broadphase-only buffers.
        pairCandidateIndices[0] = pairCandidateIndices[0];
        pairVisitedBits[0] = pairVisitedBits[0];
      }
    `
    );
    this.bootstrapKernel = bootstrapShader({
      pairCandidateIndices: storage(pairCandidateIndices, "uint", pairCandidateIndices.count),
      pairVisitedBits: storage(pairVisitedBits, "uint", pairVisitedBits.count)
    }).computeKernel([1, 1, 1]).setName("Broadphase Bootstrap Buffers");
    this.candidateUniformBuffer = this.device.createBuffer({
      label: "Broadphase Candidate Uniforms",
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    this.candidateCounterBuffer = this.device.createBuffer({
      label: "Broadphase Candidate Counter",
      size: 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
    });
    this.debugCountersBuffer = this.device.createBuffer({
      label: "Broadphase Debug Counters",
      size: DEBUG_COUNTER_WORDS * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
    });
    this.debugReadbackBuffer = this.device.createBuffer({
      label: "Broadphase Debug Readback",
      size: DEBUG_COUNTER_WORDS * 4,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });
    this.candidateBindGroupLayout = this.device.createBindGroupLayout({
      label: "Broadphase Candidate BindGroupLayout",
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 8, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 9, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } }
      ]
    });
    const candidateShaderModule = this.device.createShaderModule({
      label: "Broadphase Candidate Shader",
      code: `
struct Uniforms {
  bodyCount: u32,
  pairCapacity: u32,
  visitedWordCount: u32,
  pairsPerBody: u32,
  bvhNodeCapacity: u32,
  useVisitedDedup: u32,
  debugEnabled: u32,
};

struct BVH2Node {
  boundsMin: vec3f,
  leftChild: u32,
  boundsMax: vec3f,
  rightChild: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> aabbPositions: array<f32>;
@group(0) @binding(2) var<storage, read> bvhNodes: array<BVH2Node>;
@group(0) @binding(3) var<storage, read> clusterIdx: array<u32>;
@group(0) @binding(4) var<storage, read_write> pairActivity: array<u32>;
@group(0) @binding(5) var<storage, read_write> pairVisitedBits: array<atomic<u32>>;
@group(0) @binding(6) var<storage, read_write> pairCounter: atomic<u32>;
@group(0) @binding(7) var<storage, read_write> debugCounters: array<atomic<u32>>;
@group(0) @binding(8) var<storage, read> positions: array<vec4f>;
@group(0) @binding(9) var<storage, read> shapes: array<vec4f>;

const INVALID_IDX: u32 = 0xFFFFFFFFu;
const INVALID_PAIR: u32 = 0xFFFFFFFFu;

fn overlaps(aMin: vec3f, aMax: vec3f, bMin: vec3f, bMax: vec3f) -> bool {
  return !(aMax.x < bMin.x || aMin.x > bMax.x ||
           aMax.y < bMin.y || aMin.y > bMax.y ||
           aMax.z < bMin.z || aMin.z > bMax.z);
}

fn pairIndex(i: u32, j: u32) -> u32 {
  return (j * (j - 1u)) / 2u + i;
}

fn isIgnoredPair(i: u32, j: u32) -> bool {
  let idx = pairIndex(i, j);
  let word = idx >> 5u;
  let bit = 1u << (idx & 31u);
  return (pairActivity[${ignorePairBitsOffset}u + word] & bit) != 0u;
}

fn decodeShapeCollisionGroup(shapeMeta: f32) -> u32 {
  return (bitcast<u32>(shapeMeta) >> 16u) & 0xffu;
}

fn decodeShapeCollisionMask(shapeMeta: f32) -> u32 {
  return (bitcast<u32>(shapeMeta) >> 24u) & 0xffu;
}

fn shapesCanCollide(shapeA: vec4f, shapeB: vec4f) -> bool {
  let groupA = decodeShapeCollisionGroup(shapeA.x);
  let groupB = decodeShapeCollisionGroup(shapeB.x);
  let maskA = decodeShapeCollisionMask(shapeA.x);
  let maskB = decodeShapeCollisionMask(shapeB.x);
  return (maskA & groupB) != 0u && (maskB & groupA) != 0u;
}

fn loadBodyMin(body: u32) -> vec3f {
  let base = body * 9u;
  return vec3f(
    aabbPositions[base + 0u],
    aabbPositions[base + 1u],
    aabbPositions[base + 2u]
  );
}

fn loadBodyMax(body: u32) -> vec3f {
  let base = body * 9u;
  return vec3f(
    aabbPositions[base + 3u],
    aabbPositions[base + 4u],
    aabbPositions[base + 5u]
  );
}

fn loadBodyCenter(body: u32) -> vec3f {
  let base = body * 9u;
  return vec3f(
    aabbPositions[base + 6u],
    aabbPositions[base + 7u],
    aabbPositions[base + 8u]
  );
}

@compute @workgroup_size(1)
fn clearCounter() {
  atomicStore(&pairCounter, 0u);
  pairActivity[0] = 0u;
  if (uniforms.debugEnabled > 0u) {
    for (var i = 0u; i < ${DEBUG_COUNTER_WORDS}u; i++) {
      atomicStore(&debugCounters[i], 0u);
    }
  }
}

@compute @workgroup_size(${CANDIDATE_WORKGROUP_SIZE})
fn clearVisited(@builtin(global_invocation_id) globalId: vec3u) {
  if (uniforms.useVisitedDedup == 0u) { return; }
  let idx = globalId.x;
  if (idx >= uniforms.visitedWordCount) { return; }
  atomicStore(&pairVisitedBits[idx], 0u);
}

@compute @workgroup_size(${CANDIDATE_WORKGROUP_SIZE})
fn emitPairs(@builtin(global_invocation_id) globalId: vec3u) {
  let body = globalId.x;
  if (body >= uniforms.bodyCount) { return; }

  let bodyBase = body * uniforms.pairsPerBody;
  if (bodyBase >= uniforms.pairCapacity) { return; }
  let maxBodySlots = min(uniforms.pairsPerBody, uniforms.pairCapacity - bodyBase);
  for (var clearIdx = 0u; clearIdx < maxBodySlots; clearIdx++) {
    pairActivity[bodyBase + clearIdx + 1u] = INVALID_PAIR;
  }

  // Static bodies do not own candidate emission. Dynamic bodies emit both
  // dynamic-dynamic and dynamic-static pairs (including static floor/terrain).
  if (positions[body].w == 0.0) {
    return;
  }

  let aabbMin = loadBodyMin(body);
  let aabbMax = loadBodyMax(body);
  let bodyCenter = loadBodyCenter(body);
  let maxNodes = uniforms.bvhNodeCapacity;

  var root = clusterIdx[0u];
  if (uniforms.bodyCount > 1u) {
    let expectedRoot = uniforms.bodyCount * 2u - 2u;
    if (expectedRoot < maxNodes) {
      if (root == INVALID_IDX || root >= maxNodes || bvhNodes[root].leftChild == INVALID_IDX) {
        root = expectedRoot;
      }
    }
  }

  var emittedForBody = 0u;
  var localPairs: array<u32, ${maxPairsPerBody}>;
  var localDist2: array<f32, ${maxPairsPerBody}>;
  var stack: array<u32, ${PAIR_STACK_SIZE}>;
  var sp = 0u;
  var visitCount = 0u;
  let visitBudget = max(128u, min(maxNodes * 4u, 4096u));

  if (root != INVALID_IDX && root < maxNodes) {
    stack[sp] = root;
    sp = 1u;
  }

  loop {
    if (sp == 0u || visitCount >= visitBudget) { break; }
    visitCount += 1u;
    sp -= 1u;

    let nodeIdx = stack[sp];
    if (nodeIdx >= maxNodes) {
      continue;
    }

    let node = bvhNodes[nodeIdx];
    if (!overlaps(aabbMin, aabbMax, node.boundsMin, node.boundsMax)) {
      continue;
    }

    if (node.leftChild == INVALID_IDX) {
      let other = node.rightChild;
      if (other == body || other >= uniforms.bodyCount) {
        continue;
      }
      let otherDynamic = positions[other].w > 0.0;
      if (otherDynamic && other <= body) {
        continue;
      }
      if (uniforms.debugEnabled > 0u) {
        atomicAdd(&debugCounters[4u], 1u);
      }

      let a = min(body, other);
      let b = max(body, other);
      if (!shapesCanCollide(shapes[a], shapes[b])) {
        continue;
      }
      if (isIgnoredPair(a, b)) {
        continue;
      }
      let pair = pairIndex(a, b);

      if (uniforms.useVisitedDedup != 0u) {
        let word = pair >> 5u;
        let bit = 1u << (pair & 31u);
        let previous = atomicOr(&pairVisitedBits[word], bit);
        if ((previous & bit) != 0u) {
          if (uniforms.debugEnabled > 0u) {
            atomicAdd(&debugCounters[1u], 1u);
          }
          continue;
        }
      }
      // Store candidates locally first so each body can emit a deterministic,
      // sorted fixed-size range in the global buffer.
      let packedPair = (a & 0xFFFFu) | ((b & 0xFFFFu) << 16u);
      let dc = loadBodyCenter(other) - bodyCenter;
      var d2 = dot(dc, dc);
      if (!otherDynamic) {
        // Keep static support contacts (e.g. floor) from being evicted by
        // dynamic neighbors in top-K pruning.
        d2 = -1.0;
      }

      if (emittedForBody < maxBodySlots) {
        localPairs[emittedForBody] = packedPair;
        localDist2[emittedForBody] = d2;
        emittedForBody += 1u;
      } else if (maxBodySlots > 0u) {
        if (uniforms.debugEnabled > 0u) {
          atomicAdd(&debugCounters[0u], 1u);
        }

        // Keep the top-K nearest neighbors for each body; this avoids
        // dropping physically relevant support contacts in dense stacks.
        var worstIdx = 0u;
        var worstD2 = localDist2[0];
        var worstPair = localPairs[0];
        for (var idx = 1u; idx < maxBodySlots; idx++) {
          let candD2 = localDist2[idx];
          let candPair = localPairs[idx];
          if (candD2 > worstD2 || (candD2 == worstD2 && candPair > worstPair)) {
            worstIdx = idx;
            worstD2 = candD2;
            worstPair = candPair;
          }
        }

        if (d2 < worstD2 || (d2 == worstD2 && packedPair < worstPair)) {
          localPairs[worstIdx] = packedPair;
          localDist2[worstIdx] = d2;
        }
      }
    } else {
      let left = node.leftChild;
      let right = node.rightChild;
      if (left == INVALID_IDX || right == INVALID_IDX || left == nodeIdx || right == nodeIdx) {
        continue;
      }
      if (sp + 2u <= ${PAIR_STACK_SIZE}u && left < maxNodes && right < maxNodes) {
        stack[sp] = left;
        sp += 1u;
        stack[sp] = right;
        sp += 1u;
      }
    }
  }

  if (uniforms.debugEnabled > 0u && visitCount >= visitBudget) {
    atomicAdd(&debugCounters[3u], 1u);
  }

  // Insertion-sort each body's local candidate list for deterministic manifold
  // indexing across frames (critical for persistent warmstart state).
  for (var sortI = 1u; sortI < emittedForBody; sortI++) {
    let key = localPairs[sortI];
    var sortJ = sortI;
    loop {
      if (sortJ == 0u) { break; }
      let prev = localPairs[sortJ - 1u];
      if (prev <= key) { break; }
      localPairs[sortJ] = prev;
      sortJ -= 1u;
    }
    localPairs[sortJ] = key;
  }

  for (var writeIdx = 0u; writeIdx < emittedForBody; writeIdx++) {
    pairActivity[bodyBase + writeIdx + 1u] = localPairs[writeIdx];
  }
  // Clear unused per-body candidate slots so contact generation does not
  // read stale pairs from previous frames.
  let invalidPacked = body | (body << 16u);
  for (var clearIdx = emittedForBody; clearIdx < uniforms.pairsPerBody; clearIdx++) {
    pairActivity[bodyBase + clearIdx + 1u] = invalidPacked;
  }

  atomicAdd(&pairCounter, emittedForBody);
  if (uniforms.debugEnabled > 0u) {
    atomicAdd(&debugCounters[2u], emittedForBody);
  }
}

@compute @workgroup_size(1)
fn finalizeCounter() {
  let rawCount = atomicLoad(&pairCounter);
  let dispatchSpan = min(uniforms.pairCapacity, uniforms.bodyCount * uniforms.pairsPerBody);
  pairActivity[0] = dispatchSpan;
  if (uniforms.debugEnabled > 0u) {
    // 5 = actual emitted candidates, 6 = dispatch span used by contact pass.
    atomicStore(&debugCounters[5u], rawCount);
    atomicStore(&debugCounters[6u], dispatchSpan);
  }
}
`
    });
    const pipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [this.candidateBindGroupLayout]
    });
    this.clearCounterPipeline = this.device.createComputePipeline({
      label: "Broadphase Clear Counter",
      layout: pipelineLayout,
      compute: { module: candidateShaderModule, entryPoint: "clearCounter" }
    });
    this.clearVisitedPipeline = this.device.createComputePipeline({
      label: "Broadphase Clear Visited",
      layout: pipelineLayout,
      compute: { module: candidateShaderModule, entryPoint: "clearVisited" }
    });
    this.emitPairsPipeline = this.device.createComputePipeline({
      label: "Broadphase Emit Pairs",
      layout: pipelineLayout,
      compute: { module: candidateShaderModule, entryPoint: "emitPairs" }
    });
    this.finalizeCounterPipeline = this.device.createComputePipeline({
      label: "Broadphase Finalize Counter",
      layout: pipelineLayout,
      compute: { module: candidateShaderModule, entryPoint: "finalizeCounter" }
    });
  }
  dispatch(renderer, bodyCount, pairCount, frameId) {
    if (bodyCount < 2 || pairCount == 0) {
      this.candidatePairsEnabled = false;
      this.backendBuffersReady = false;
      this.bvhBuffersReady = false;
      this.lastBuildMs = 0;
      this.logDebugState(frameId, bodyCount, "insufficientBodiesOrPairs");
      return;
    }
    this.updateAabbKernel.computeNode.parameters.bodyCount.value = bodyCount;
    renderer.compute(this.updateAabbKernel, [Math.ceil(bodyCount / WORKGROUP_SIZE5), 1, 1]);
    if (!this.bootstrapDone) {
      renderer.compute(this.bootstrapKernel, [1, 1, 1]);
      this.bootstrapDone = true;
    }
    const backend = renderer.backend;
    if (!this.storageBuffersInitialized && backend?.createStorageAttribute) {
      try {
        backend.createStorageAttribute(this.aabbPositionAttr);
        backend.createStorageAttribute(this.pairActivityAttr);
        backend.createStorageAttribute(this.pairVisitedBitsAttr);
        this.storageBuffersInitialized = true;
      } catch (error) {
        if (!this.storageInitWarned) {
          console.warn("BroadPhaseStage failed to initialize storage attributes:", error);
          this.storageInitWarned = true;
        }
      }
    }
    const positionsBuffer = backend?.get?.(this.positionsAttr)?.buffer;
    const shapesBuffer = backend?.get?.(this.shapesAttr)?.buffer;
    const aabbPositionBuffer = backend?.get?.(this.aabbPositionAttr)?.buffer;
    const pairActivityBuffer = backend?.get?.(this.pairActivityAttr)?.buffer;
    const pairVisitedBuffer = backend?.get?.(this.pairVisitedBitsAttr)?.buffer;
    this.backendBuffersReady = Boolean(positionsBuffer && shapesBuffer && aabbPositionBuffer && pairActivityBuffer && pairVisitedBuffer);
    if (!positionsBuffer || !shapesBuffer || !aabbPositionBuffer || !pairActivityBuffer || !pairVisitedBuffer) {
      this.candidatePairsEnabled = false;
      this.bvhBuffersReady = false;
      this.logDebugState(frameId, bodyCount, "missingBackendBuffers");
      return;
    }
    if (!this.enableBvhBuild) {
      this.candidatePairsEnabled = false;
      this.bvhBuffersReady = false;
      this.lastBuildMs = 0;
      this.logDebugState(frameId, bodyCount, "bvhDisabled");
      return;
    }
    const periodicReady = this.lastBuildFrame < 0 || frameId - this.lastBuildFrame >= this.rebuildIntervalFrames;
    const onceReady = !this.buildOnce || !this.hasBuiltOnce;
    const prewarmReady = this.prewarmInFlight === null;
    const shouldStartBuild = periodicReady && onceReady && prewarmReady;
    if (!this.hasBuiltOnce) {
      if (shouldStartBuild) {
        this.startBuild(aabbPositionBuffer, bodyCount, frameId);
      }
      this.candidatePairsEnabled = false;
      this.bvhBuffersReady = false;
      this.logDebugState(frameId, bodyCount, prewarmReady ? "waitingInitialBuild" : "waitingPrewarm", shouldStartBuild);
      return;
    }
    const activeBVH = this.getActiveBVH();
    const bvhBuffer = activeBVH.bvh2Buffer;
    const clusterIdxBuffer = activeBVH.clusterIdxBuffer;
    this.bvhBuffersReady = Boolean(bvhBuffer && clusterIdxBuffer);
    if (!bvhBuffer || !clusterIdxBuffer) {
      this.candidatePairsEnabled = false;
      if (shouldStartBuild) {
        this.startBuild(aabbPositionBuffer, bodyCount, frameId);
      }
      this.logDebugState(frameId, bodyCount, "missingBvhBuffers", shouldStartBuild);
      return;
    }
    const visitedWordCount = Math.ceil(pairCount / 32);
    const maxWorkgroupsPerDim = Math.max(1, Number(this.device.limits.maxComputeWorkgroupsPerDimension ?? 65535));
    const maxVisitedWordsPerDispatch = maxWorkgroupsPerDim * CANDIDATE_WORKGROUP_SIZE;
    const visitedWordCapacity = this.pairVisitedBitsAttr.count;
    const maxVisitedWordsUsable = Math.min(maxVisitedWordsPerDispatch, visitedWordCapacity);
    const useVisitedDedup = visitedWordCount <= maxVisitedWordsUsable ? 1 : 0;
    const clearVisitedWorkgroups = useVisitedDedup ? Math.max(1, Math.ceil(visitedWordCount / CANDIDATE_WORKGROUP_SIZE)) : 0;
    const pairCapacity = Math.min(this.maxPairs, bodyCount * this.maxPairsPerBody);
    const bvhNodeCapacity = Math.max(1, bodyCount * 2);
    const uniforms = new Uint32Array([
      bodyCount,
      pairCapacity,
      visitedWordCount,
      this.maxPairsPerBody,
      bvhNodeCapacity,
      useVisitedDedup,
      this.debugEnabled ? 1 : 0
    ]);
    this.device.queue.writeBuffer(this.candidateUniformBuffer, 0, uniforms);
    const needsBindGroupRebuild = !this.candidateBindGroup || this.candidateBindGroupBuffers.positions !== positionsBuffer || this.candidateBindGroupBuffers.aabbPosition !== aabbPositionBuffer || this.candidateBindGroupBuffers.bvh !== bvhBuffer || this.candidateBindGroupBuffers.clusterIdx !== clusterIdxBuffer || this.candidateBindGroupBuffers.pairCandidate !== pairActivityBuffer || this.candidateBindGroupBuffers.pairVisited !== pairVisitedBuffer || this.candidateBindGroupBuffers.pairActivity !== pairActivityBuffer || this.candidateBindGroupBuffers.shapes !== shapesBuffer;
    if (needsBindGroupRebuild) {
      this.candidateBindGroup = this.device.createBindGroup({
        label: "Broadphase Candidate BindGroup",
        layout: this.candidateBindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: this.candidateUniformBuffer } },
          { binding: 1, resource: { buffer: aabbPositionBuffer } },
          { binding: 2, resource: { buffer: bvhBuffer } },
          { binding: 3, resource: { buffer: clusterIdxBuffer } },
          { binding: 4, resource: { buffer: pairActivityBuffer } },
          { binding: 5, resource: { buffer: pairVisitedBuffer } },
          { binding: 6, resource: { buffer: this.candidateCounterBuffer } },
          { binding: 7, resource: { buffer: this.debugCountersBuffer } },
          { binding: 8, resource: { buffer: positionsBuffer } },
          { binding: 9, resource: { buffer: shapesBuffer } }
        ]
      });
      this.candidateBindGroupBuffers.positions = positionsBuffer;
      this.candidateBindGroupBuffers.aabbPosition = aabbPositionBuffer;
      this.candidateBindGroupBuffers.bvh = bvhBuffer;
      this.candidateBindGroupBuffers.clusterIdx = clusterIdxBuffer;
      this.candidateBindGroupBuffers.pairCandidate = pairActivityBuffer;
      this.candidateBindGroupBuffers.pairVisited = pairVisitedBuffer;
      this.candidateBindGroupBuffers.pairActivity = pairActivityBuffer;
      this.candidateBindGroupBuffers.shapes = shapesBuffer;
    }
    const commandEncoder = this.device.createCommandEncoder({ label: "Broadphase Encoder" });
    {
      const pass = commandEncoder.beginComputePass({ label: "Broadphase Candidate Pass" });
      pass.setBindGroup(0, this.candidateBindGroup);
      pass.setPipeline(this.clearCounterPipeline);
      pass.dispatchWorkgroups(1);
      if (clearVisitedWorkgroups > 0) {
        pass.setPipeline(this.clearVisitedPipeline);
        pass.dispatchWorkgroups(clearVisitedWorkgroups);
      }
      pass.setPipeline(this.emitPairsPipeline);
      pass.dispatchWorkgroups(Math.ceil(bodyCount / CANDIDATE_WORKGROUP_SIZE));
      pass.setPipeline(this.finalizeCounterPipeline);
      pass.dispatchWorkgroups(1);
      pass.end();
    }
    this.device.queue.submit([commandEncoder.finish()]);
    this.maybeReadDebugCounters(frameId, bodyCount);
    this.candidatePairsEnabled = true;
    if (shouldStartBuild) {
      this.startBuild(aabbPositionBuffer, bodyCount, frameId);
    }
    this.logDebugState(frameId, bodyCount, "ready", shouldStartBuild);
  }
  hasCandidatePairs() {
    return this.candidatePairsEnabled;
  }
  setDebugEnabled(enabled) {
    this.debugEnabled = enabled;
    this.debugReadbackInFlight = false;
    this.lastDebugLogFrame = -1;
  }
  setDebugLogInterval(intervalFrames) {
    this.debugEveryNFrames = Math.max(1, Math.floor(intervalFrames));
    this.lastDebugLogFrame = -1;
  }
  isReady() {
    return this.backendBuffersReady && this.bvhBuffersReady;
  }
  getLastBuildMs() {
    return this.lastBuildMs;
  }
  reset() {
    this.buildGeneration++;
    this.buildInFlight = null;
    this.buildInFlightStartFrame = -1;
    this.activeBvhIndex = 0;
    this.activeBvhSnapshotFrame = -1;
    this.lastBuildMs = 0;
    this.candidatePairsEnabled = false;
    this.backendBuffersReady = false;
    this.bvhBuffersReady = false;
    this.storageBuffersInitialized = false;
    this.storageInitWarned = false;
    this.bootstrapDone = false;
    this.lastBuildFrame = -1;
    this.hasBuiltOnce = false;
    this.debugReadbackInFlight = false;
    this.lastDebugLogFrame = -1;
    this.candidateBindGroup = null;
    this.candidateBindGroupBuffers.positions = null;
    this.candidateBindGroupBuffers.aabbPosition = null;
    this.candidateBindGroupBuffers.bvh = null;
    this.candidateBindGroupBuffers.clusterIdx = null;
    this.candidateBindGroupBuffers.pairCandidate = null;
    this.candidateBindGroupBuffers.pairVisited = null;
    this.candidateBindGroupBuffers.pairActivity = null;
    this.candidateBindGroupBuffers.shapes = null;
  }
  dispose() {
    this.candidateBindGroup = null;
    this.aabbSnapshotBuffer.destroy();
    this.aabbIndexBuffer.destroy();
    this.candidateUniformBuffer.destroy();
    this.candidateCounterBuffer.destroy();
    this.debugCountersBuffer.destroy();
    this.debugReadbackBuffer.destroy();
    this.gpuBVHs[0].dispose();
    this.gpuBVHs[1].dispose();
  }
  maybeReadDebugCounters(frameId, bodyCount) {
    if (!this.debugEnabled) return;
    if (this.debugReadbackInFlight) return;
    if (this.lastDebugLogFrame >= 0 && frameId - this.lastDebugLogFrame < this.debugEveryNFrames) return;
    this.debugReadbackInFlight = true;
    this.lastDebugLogFrame = frameId;
    const encoder = this.device.createCommandEncoder({ label: "Broadphase Debug Readback" });
    encoder.copyBufferToBuffer(
      this.debugCountersBuffer,
      0,
      this.debugReadbackBuffer,
      0,
      DEBUG_COUNTER_WORDS * 4
    );
    this.device.queue.submit([encoder.finish()]);
    this.debugReadbackBuffer.mapAsync(GPUMapMode.READ).then(() => {
      try {
        const mapped = this.debugReadbackBuffer.getMappedRange();
        const values = new Uint32Array(mapped.slice(0));
        const emittedCount = values[5] ?? 0;
        const dispatchSpan = values[6] ?? 0;
        const snapshot = {
          frame: frameId,
          bodies: bodyCount,
          candidates: emittedCount,
          rawCandidates: dispatchSpan,
          perBodyDrops: values[0] ?? 0,
          dedupDrops: values[1] ?? 0,
          writes: values[2] ?? 0,
          leafCandidates: values[4] ?? 0,
          visitBudgetDrops: values[3] ?? 0,
          capacityDrops: Math.max(0, emittedCount - dispatchSpan),
          pairsPerBody: this.maxPairsPerBody
        };
        console.info(
          `[Broadphase Debug] frame=${snapshot.frame} bodies=${snapshot.bodies} candidates=${snapshot.candidates} perBodyDrops=${snapshot.perBodyDrops} dedupDrops=${snapshot.dedupDrops} writes=${snapshot.writes} leafCandidates=${snapshot.leafCandidates} visitBudgetDrops=${snapshot.visitBudgetDrops} capacityDrops=${snapshot.capacityDrops} pairsPerBody=${snapshot.pairsPerBody} dispatchSpan=${snapshot.rawCandidates}`
        );
      } finally {
        this.debugReadbackBuffer.unmap();
      }
    }).catch((error) => {
      console.warn("Broadphase debug readback failed:", error);
    }).finally(() => {
      this.debugReadbackInFlight = false;
    });
  }
  logDebugState(frameId, bodyCount, reason, shouldStartBuild) {
    if (!this.debugEnabled) return;
    const activeAgeFrames = this.activeBvhSnapshotFrame >= 0 ? Math.max(0, frameId - this.activeBvhSnapshotFrame) : -1;
    const inflightAgeFrames = this.buildInFlight && this.buildInFlightStartFrame >= 0 ? Math.max(0, frameId - this.buildInFlightStartFrame) : -1;
    const shouldBuildToken = shouldStartBuild === void 0 ? "" : ` shouldStartBuild=${shouldStartBuild ? 1 : 0}`;
    console.info(
      `[Broadphase State] frame=${frameId} bodies=${bodyCount} reason=${reason} hasBuiltOnce=${this.hasBuiltOnce ? 1 : 0} buildInFlight=${this.buildInFlight ? 1 : 0} bvhBuffersReady=${this.bvhBuffersReady ? 1 : 0} activeBvhIndex=${this.activeBvhIndex} activeBvhSnapshotFrame=${this.activeBvhSnapshotFrame} activeBvhAge=${activeAgeFrames} buildInFlightStartFrame=${this.buildInFlightStartFrame} buildInFlightAge=${inflightAgeFrames} lastBuildMs=${this.lastBuildMs.toFixed(3)} prewarmInFlight=${this.prewarmInFlight ? 1 : 0} backendReady=${this.backendBuffersReady ? 1 : 0} candidatePairsEnabled=${this.candidatePairsEnabled ? 1 : 0}` + shouldBuildToken
    );
  }
};

// vendor/webphysics/src/physics/gpu/derivedInertia.ts
var WORKGROUP_SIZE6 = 256;
var DerivedInertiaStage = class {
  kernel;
  constructor(quaternions, inverseInertia, derivedInvInertia, maxBodies) {
    const shader = wgslFn(
      /* wgsl */
      `
      fn compute(
        quaternions: ptr<storage, array<vec4f>, read>,
        inverseInertia: ptr<storage, array<vec4f>, read>,
        derivedInvInertia: ptr<storage, array<vec4f>, read_write>,
        bodyCount: u32,
        workgroupId: vec3u,
        localId: vec3u,
      ) -> void {
        let gid = workgroupId.x * ${WORKGROUP_SIZE6}u + localId.x;
        if (gid >= bodyCount) { return; }

        let q = quaternions[gid];
        let inv = inverseInertia[gid];
        let invI = inv.xyz;
        let invMass = inv.w;

        let c0 = qrot(q, vec3f(1.0, 0.0, 0.0));
        let c1 = qrot(q, vec3f(0.0, 1.0, 0.0));
        let c2 = qrot(q, vec3f(0.0, 0.0, 1.0));

        let m = mat3x3f(c0 * invI.x, c1 * invI.y, c2 * invI.z) *
                transpose(mat3x3f(c0, c1, c2));

        let base = gid * 3u;
        // Pack the symmetric world inverse inertia plus the local diagonal
        // inverse inertia into the existing 3xvec4 footprint.
        derivedInvInertia[base + 0u] = vec4f(m[0].x, m[0].y, m[0].z, invMass);
        derivedInvInertia[base + 1u] = vec4f(m[1].y, m[1].z, invI.x, invI.y);
        derivedInvInertia[base + 2u] = vec4f(m[2].z, invI.z, 0.0, 0.0);
      }
    `,
      [qrot]
    );
    this.kernel = shader({
      quaternions: storage(quaternions, "vec4f", maxBodies).toReadOnly(),
      inverseInertia: storage(inverseInertia, "vec4f", maxBodies).toReadOnly(),
      derivedInvInertia: storage(derivedInvInertia, "vec4f", maxBodies * 3),
      bodyCount: uniform(0),
      workgroupId,
      localId
    }).computeKernel([WORKGROUP_SIZE6, 1, 1]).setName("Physics Derived Inertia");
  }
  dispatch(renderer, bodyCount) {
    this.kernel.computeNode.parameters.bodyCount.value = bodyCount;
    if (bodyCount > 0) {
      const workgroups = Math.ceil(bodyCount / WORKGROUP_SIZE6);
      renderer.compute(this.kernel, [workgroups, 1, 1]);
    }
  }
};

// vendor/webphysics/src/physics/gpu/playerControl.ts
import * as THREE2 from "three";
import { StorageBufferAttribute as StorageBufferAttribute4 } from "three/webgpu";
var PlayerControlStage = class {
  controlKernel;
  probeKernel;
  probeStateAttr;
  constructor(positions, velocities, angularVelocities, pairBodyContactCounts, pairBodyContactIndices, pairContacts, maxBodies, maxPairContacts, maxPairContactsPerBody) {
    this.probeStateAttr = new StorageBufferAttribute4(new Float32Array(8), 4);
    const controlShader = wgslFn(
      /* wgsl */
      `
      fn compute(
        velocities: ptr<storage, array<vec4f>, read_write>,
        angularVelocities: ptr<storage, array<vec4f>, read_write>,
        bodyCount: u32,
        bodyIndex: u32,
        targetVelocity: vec3f,
        moveGain: f32,
        jumpSpeed: f32,
        jumpRequest: u32,
        groundedHint: u32,
      ) -> void {
        if (bodyIndex >= bodyCount) { return; }

        var v = velocities[bodyIndex];
        let gain = clamp(moveGain, 0.0, 1.0);
        v.x = v.x + (targetVelocity.x - v.x) * gain;
        v.z = v.z + (targetVelocity.z - v.z) * gain;

        if (jumpRequest > 0u && groundedHint > 0u) {
          v.y = max(v.y, jumpSpeed);
        }

        velocities[bodyIndex] = vec4f(v.xyz, 0.0);
        angularVelocities[bodyIndex] = vec4f(0.0);
      }
    `
    );
    this.controlKernel = controlShader({
      velocities: storage(velocities, "vec4f", maxBodies),
      angularVelocities: storage(angularVelocities, "vec4f", maxBodies),
      bodyCount: uniform(0),
      bodyIndex: uniform(0),
      targetVelocity: uniform(new THREE2.Vector3(0, 0, 0)),
      moveGain: uniform(0.4),
      jumpSpeed: uniform(6),
      jumpRequest: uniform(0),
      groundedHint: uniform(0)
    }).computeKernel([1, 1, 1]).setName("Player Control");
    const probeShader = wgslFn(
      /* wgsl */
      `
      fn compute(
        positions: ptr<storage, array<vec4f>, read>,
        velocities: ptr<storage, array<vec4f>, read>,
        pairBodyContactCounts: ptr<storage, array<u32>, read>,
        pairBodyContactIndices: ptr<storage, array<u32>, read>,
        pairContacts: ptr<storage, array<vec4f>, read_write>,
        probeState: ptr<storage, array<vec4f>, read_write>,
        bodyCount: u32,
        bodyIndex: u32,
      ) -> void {
        if (bodyIndex >= bodyCount) {
          probeState[0u] = vec4f(0.0);
          probeState[1u] = vec4f(0.0);
          return;
        }

        let pos = positions[bodyIndex].xyz;
        let vel = velocities[bodyIndex].xyz;

        var grounded = false;
        let contactCount = min(pairBodyContactCounts[bodyIndex] & 0xFFFFu, ${maxPairContactsPerBody}u);
        let bodyBase = bodyIndex * ${maxPairContactsPerBody}u;
        for (var k = 0u; k < ${maxPairContactsPerBody}u; k++) {
          if (k >= contactCount) { break; }
          let p = pairBodyContactIndices[bodyBase + k];
          if (p >= ${maxPairContacts}u) { continue; }

          let info = pairContacts[p * ${CONTACT_RECORD_VEC4S}u + ${CONTACT_RECORD_META_OFFSET}u];
          if (info.z < 0.5) { continue; }

          let i = u32(info.x + 0.5);
          let j = u32(info.y + 0.5);
          let ny = pairContacts[p * ${CONTACT_RECORD_VEC4S}u + ${CONTACT_RECORD_NORMAL_PEN_OFFSET}u].y;
          if ((i == bodyIndex && ny < -0.35) || (j == bodyIndex && ny > 0.35)) {
            grounded = true;
            break;
          }
        }

        let groundedF = select(0.0, 1.0, grounded);
        probeState[0u] = vec4f(pos, groundedF);
        probeState[1u] = vec4f(vel, 0.0);
      }
    `
    );
    this.probeKernel = probeShader({
      positions: storage(positions, "vec4f", maxBodies).toReadOnly(),
      velocities: storage(velocities, "vec4f", maxBodies).toReadOnly(),
      pairBodyContactCounts: storage(pairBodyContactCounts, "uint", maxBodies).toReadOnly(),
      pairBodyContactIndices: storage(pairBodyContactIndices, "uint", maxBodies * maxPairContactsPerBody).toReadOnly(),
      pairContacts: storage(pairContacts, "vec4f", maxPairContacts * CONTACT_RECORD_VEC4S),
      probeState: storage(this.probeStateAttr, "vec4f", 2),
      bodyCount: uniform(0),
      bodyIndex: uniform(0)
    }).computeKernel([1, 1, 1]).setName("Player Probe");
  }
  dispatchControl(renderer, bodyCount, bodyIndex, targetVelocity, moveGain, jumpSpeed, jumpRequest, groundedHint) {
    this.controlKernel.computeNode.parameters.bodyCount.value = bodyCount;
    this.controlKernel.computeNode.parameters.bodyIndex.value = bodyIndex;
    const target = this.controlKernel.computeNode.parameters.targetVelocity.value;
    target.set(targetVelocity[0], targetVelocity[1], targetVelocity[2]);
    this.controlKernel.computeNode.parameters.moveGain.value = moveGain;
    this.controlKernel.computeNode.parameters.jumpSpeed.value = jumpSpeed;
    this.controlKernel.computeNode.parameters.jumpRequest.value = jumpRequest ? 1 : 0;
    this.controlKernel.computeNode.parameters.groundedHint.value = groundedHint ? 1 : 0;
    renderer.compute(this.controlKernel, [1, 1, 1]);
  }
  dispatchProbe(renderer, bodyCount, bodyIndex) {
    this.probeKernel.computeNode.parameters.bodyCount.value = bodyCount;
    this.probeKernel.computeNode.parameters.bodyIndex.value = bodyIndex;
    renderer.compute(this.probeKernel, [1, 1, 1]);
  }
  getProbeAttribute() {
    return this.probeStateAttr;
  }
};

// vendor/webphysics/src/physics/PhysicsEngine.ts
var CANDIDATE_LIST_HEADER_WORDS = 1;
var AVBD_K_START2 = 1;
var AVBD_REGULARIZATION_ALPHA = 0.95;
var INERTIAL_POSE_VEC4S_PER_BODY3 = 4;
var INERTIAL_POSE_FLOATS_PER_BODY = INERTIAL_POSE_VEC4S_PER_BODY3 * 4;
var WORLD_BODY_INDEX = 4294967295;
var DEFAULT_MAX_JOINTS_PER_BODY_SOLVER = 8;
var DEFAULT_MAX_SPRINGS_PER_BODY_SOLVER = 12;
function pairIndexForBodies(i, j) {
  const a = Math.min(i, j);
  const b = Math.max(i, j);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b <= a) {
    return -1;
  }
  return Math.floor(b * (b - 1) / 2 + a);
}
function normalizeQuat(q) {
  const len = Math.hypot(q[0], q[1], q[2], q[3]);
  if (len <= 1e-12) return [0, 0, 0, 1];
  return [q[0] / len, q[1] / len, q[2] / len, q[3] / len];
}
function conjugateQuat(q) {
  return [-q[0], -q[1], -q[2], q[3]];
}
function multiplyQuat(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]
  ];
}
function rotateVector(q, v) {
  const rotated = multiplyQuat(multiplyQuat(normalizeQuat(q), [v[0], v[1], v[2], 0]), conjugateQuat(normalizeQuat(q)));
  return [rotated[0], rotated[1], rotated[2]];
}
function decodePairContactViews(pairContactsRaw, maxPairContacts) {
  const pairContacts = new Float32Array(pairContactsRaw);
  const pairContactWords = new Uint32Array(pairContactsRaw);
  const meta = new Float32Array(maxPairContacts * 4);
  const metaWords = new Uint32Array(meta.buffer);
  const normalPen = new Float32Array(maxPairContacts * 4);
  const arms = new Float32Array(maxPairContacts * 8);
  const armWords = new Uint32Array(arms.buffer);
  const constraintC0 = new Float32Array(maxPairContacts * 4);
  const pairLambdas = new Float32Array(maxPairContacts * 4);
  const dual = new Float32Array(maxPairContacts * 8);
  const cacheWords = new Uint32Array(maxPairContacts);
  for (let p = 0; p < maxPairContacts; p++) {
    const metaBase = contactRecordVec4FloatIndex(p, CONTACT_RECORD_META_OFFSET);
    const normalBase = contactRecordVec4FloatIndex(p, CONTACT_RECORD_NORMAL_PEN_OFFSET);
    const armABase = contactRecordVec4FloatIndex(p, CONTACT_RECORD_ARM_A_OFFSET);
    const armBBase = contactRecordVec4FloatIndex(p, CONTACT_RECORD_ARM_B_OFFSET);
    const c0Base = contactRecordVec4FloatIndex(p, CONTACT_RECORD_CONSTRAINT_C0_OFFSET);
    const shadowBase = contactRecordVec4FloatIndex(p, CONTACT_RECORD_SHADOW_OFFSET);
    const dualBase = contactRecordVec4FloatIndex(p, CONTACT_RECORD_DUAL_OFFSET);
    const penaltyBase = contactRecordVec4FloatIndex(p, CONTACT_RECORD_PENALTY_OFFSET);
    const cacheBase = contactRecordVec4FloatIndex(p, CONTACT_RECORD_CACHE_OFFSET);
    meta.set(pairContacts.subarray(metaBase, metaBase + 4), p * 4);
    metaWords[p * 4 + 3] = pairContactWords[metaBase + 3] ?? 0;
    normalPen.set(pairContacts.subarray(normalBase, normalBase + 4), p * 4);
    arms.set(pairContacts.subarray(armABase, armABase + 4), p * 8);
    arms.set(pairContacts.subarray(armBBase, armBBase + 4), p * 8 + 4);
    armWords[p * 8 + 3] = pairContactWords[armABase + 3] ?? 0;
    armWords[p * 8 + 7] = pairContactWords[armBBase + 3] ?? 0;
    constraintC0.set(pairContacts.subarray(c0Base, c0Base + 4), p * 4);
    pairLambdas.set(pairContacts.subarray(shadowBase, shadowBase + 4), p * 4);
    dual.set(pairContacts.subarray(dualBase, dualBase + 4), p * 8);
    dual.set(pairContacts.subarray(penaltyBase, penaltyBase + 4), p * 8 + 4);
    cacheWords[p] = pairContactWords[cacheBase] ?? 0;
  }
  return {
    meta,
    metaWords,
    cacheWords,
    normalPen,
    arms,
    armWords,
    constraintC0,
    pairLambdas,
    dual,
    pairContacts,
    pairContactWords
  };
}
var PhysicsEngine = class {
  config;
  device;
  bodyCount = 0;
  accumulator = 0;
  initialized = false;
  maxPairs;
  maxCandidatePairs;
  maxPairContacts;
  pairManifoldSlots;
  maxPairsPerBodyBroadphase;
  maxContactsPerBodySolver;
  maxJoints;
  maxJointsPerBodySolver;
  maxSprings;
  maxSpringsPerBodySolver;
  maxConstraintsPerBodySolver;
  bruteForceMaxBodies;
  maxActivePairContacts;
  haltOnBroadphaseFallbackOverflow;
  maxFixedStepsPerFrame;
  enableBvhBuild;
  bvhBuildOnce;
  bvhRebuildIntervalFrames;
  bvhWaitForGpuCompletion;
  avbdPairSweeps;
  solverIterations;
  maxPairSolveColorCount;
  activePairSolveColorCount;
  avbdFrictionStatic;
  avbdDualUpdateBeta;
  avbdRegularizationAlpha;
  avbdPenaltyDecayGamma;
  avbdBodySolveMode = "colored";
  avbdPreventPenetratingNormalDropout = false;
  avbdPenaltyFloor = AVBD_K_START2;
  jointCount = 0;
  springCount = 0;
  // CPU-side body data arrays (SoA, vec4f per body)
  positionsData;
  // (x, y, z, inverseMass)
  initialPoseData;
  // [initial position vec4, initial quaternion vec4] per body
  initialLinearVelData;
  // initial linear velocity vec4 per body
  initialAngularVelData;
  // initial angular velocity vec4 per body
  inertialPoseData;
  // [inertial pose, current solve pose] as 4 vec4s per body
  velocitiesData;
  // (vx, vy, vz, 0)
  prevLinearVelData;
  // previous-step linear velocity for adaptive warmstart
  shapesData;
  // (packed friction/group/mask/type, sizeX, sizeY, sizeZ)
  shapesWordData;
  quaternionsData;
  // (qx, qy, qz, qw)
  angularVelData;
  // (wx, wy, wz, 0)
  inverseInertiaData;
  // (Ixx⁻¹, Iyy⁻¹, Izz⁻¹, 0)
  derivedInvInertiaData;
  // 3x vec4 per body: symmetric world inv inertia + local diagonal inv inertia + inverse mass
  // Packed pair contact buffer (contact + cache object in one physical store).
  pairContactsData;
  jointRecordsData;
  springRecordsData;
  pairActivityData;
  pairCandidateIndicesOffset;
  pairActiveCandidateSlotsOffset;
  pairActiveContactsOffset;
  pairIgnoredBitsOffset;
  pairActivityWordCount;
  pairCandidateIndicesData;
  // [count, packedPair0, packedPair1, ...] (a | (b << 16))
  pairVisitedBitsData;
  // bitset over pair indices
  pairBodyContactCountsData;
  // contacts per body
  pairBodyContactIndicesData;
  // flat contact list indices
  bodyConstraintCountsData;
  // generic solver constraint count per body
  bodyConstraintRefsData;
  // tagged contact/joint/spring refs per body
  pairActiveCandidateSlotsData;
  // [count, candidateSlot0, ...]
  pairActiveContactsData;
  // [count, contactIdx0, contactIdx1, ...]
  pairIgnoredBitsData;
  // pair-index bitset for collision filtering
  pairColorBodyClaimsData;
  // temporary body claims for coloring
  // GPU storage buffers
  positionsAttr;
  initialPoseAttr;
  inertialPoseAttr;
  velocitiesAttr;
  prevLinearVelAttr;
  shapesAttr;
  quaternionsAttr;
  angularVelAttr;
  inverseInertiaAttr;
  derivedInvInertiaAttr;
  pairContactsAttr;
  jointRecordsAttr;
  springRecordsAttr;
  pairActivityAttr;
  pairCandidateIndicesAttr;
  pairVisitedBitsAttr;
  pairBodyContactCountsAttr;
  pairBodyContactIndicesAttr;
  bodyConstraintCountsAttr;
  bodyConstraintRefsAttr;
  pairActiveCandidateSlotsAttr;
  pairActiveContactsAttr;
  pairColorBodyClaimsAttr;
  // Pipeline stages
  integration;
  broadPhase;
  derivedInertia;
  contactGeneration;
  avbdState;
  playerControl;
  pairDispatchTruncationWarned = false;
  waitingForInitialCandidatePairs = true;
  frameId = 0;
  debugBehaviorEnabled = false;
  debugLogEveryNFrames = 30;
  supportDebugReadbackInFlight = false;
  lastSupportDebugLogFrame = -1;
  supportDebugEveryNFrames = 30;
  prevSupportBodyCount = -1;
  prevCandidatePairsForChurn = null;
  prevFloorCandidatePairsForChurn = null;
  stats = {
    bodyCount: 0,
    frameCount: 0,
    totalMs: 0,
    integrationMs: 0,
    broadPhaseMs: 0,
    solverMs: 0,
    velocityUpdateMs: 0,
    broadPhaseReady: false,
    candidatePairsEnabled: false,
    pairDispatchTruncated: false
  };
  constructor(device, config) {
    this.device = device;
    this.config = config;
    this.solverIterations = config.solverIterations ?? 8;
    this.maxPairSolveColorCount = Math.max(1, Math.floor(config.pairSolveColorCount ?? 64));
    this.activePairSolveColorCount = Math.min(this.maxPairSolveColorCount, 8);
    this.maxPairsPerBodyBroadphase = Math.max(1, Math.floor(config.maxPairsPerBodyBroadphase ?? 64));
    this.maxContactsPerBodySolver = Math.max(1, Math.floor(config.maxContactsPerBodySolver ?? 128));
    this.maxJointsPerBodySolver = DEFAULT_MAX_JOINTS_PER_BODY_SOLVER;
    this.maxSpringsPerBodySolver = DEFAULT_MAX_SPRINGS_PER_BODY_SOLVER;
    this.maxConstraintsPerBodySolver = this.maxContactsPerBodySolver + this.maxJointsPerBodySolver + this.maxSpringsPerBodySolver;
    this.haltOnBroadphaseFallbackOverflow = config.haltOnBroadphaseFallbackOverflow ?? true;
    this.maxFixedStepsPerFrame = Math.max(1, Math.floor(config.maxFixedStepsPerFrame ?? 2));
    this.enableBvhBuild = config.enableBvhBuild ?? true;
    this.bvhBuildOnce = config.bvhBuildOnce ?? false;
    this.bvhRebuildIntervalFrames = Math.max(1, Math.floor(config.bvhRebuildIntervalFrames ?? 1));
    this.bvhWaitForGpuCompletion = config.bvhWaitForGpuCompletion ?? false;
    this.avbdPairSweeps = Math.max(1, Math.min(4, Math.floor(config.avbdPairSweeps ?? 2)));
    this.avbdFrictionStatic = Math.max(0, config.avbdFriction ?? AVBD_FRICTION_STATIC);
    this.avbdDualUpdateBeta = Math.max(0, config.avbdDualUpdateBeta ?? 1e4);
    this.avbdRegularizationAlpha = Math.max(0, Math.min(1, config.avbdRegularizationAlpha ?? AVBD_REGULARIZATION_ALPHA));
    this.avbdPenaltyDecayGamma = Math.max(0, Math.min(1, config.avbdPenaltyDecayGamma ?? 0.99));
    this.avbdBodySolveMode = config.avbdBodySolveMode ?? "colored";
    const n = config.maxBodies;
    if (n > 65536) {
      throw new Error("maxBodies > 65536 is not supported by packed candidate-pair encoding.");
    }
    this.pairManifoldSlots = Math.max(1, Math.min(8, Math.floor(config.pairManifoldSlots ?? 4)));
    const candidateWorkgroupSize = 64;
    const maxWorkgroupsPerDim = Math.max(1, Number(device.limits.maxComputeWorkgroupsPerDimension ?? 65535));
    const maxVisitedWordsPerDispatch = maxWorkgroupsPerDim * candidateWorkgroupSize;
    this.maxPairs = n * (n - 1) / 2;
    this.maxActivePairContacts = n * this.maxContactsPerBodySolver;
    const maxStoredPairSlots = n * this.maxPairsPerBodyBroadphase;
    this.maxCandidatePairs = maxStoredPairSlots;
    this.maxPairContacts = maxStoredPairSlots * this.pairManifoldSlots;
    this.maxJoints = n * this.maxJointsPerBodySolver;
    this.maxSprings = n * this.maxSpringsPerBodySolver;
    this.bruteForceMaxBodies = Math.floor((1 + Math.sqrt(1 + 8 * this.maxCandidatePairs)) * 0.5);
    const candidateListWords = this.maxCandidatePairs + CANDIDATE_LIST_HEADER_WORDS;
    const activeContactsWords = this.maxActivePairContacts + CANDIDATE_LIST_HEADER_WORDS;
    const ignoredPairWords = Math.ceil(this.maxPairs / 32);
    this.pairCandidateIndicesOffset = 0;
    this.pairActiveCandidateSlotsOffset = this.pairCandidateIndicesOffset + candidateListWords;
    this.pairActiveContactsOffset = this.pairActiveCandidateSlotsOffset + candidateListWords;
    this.pairIgnoredBitsOffset = this.pairActiveContactsOffset + activeContactsWords;
    this.pairActivityWordCount = this.pairIgnoredBitsOffset + ignoredPairWords;
    this.positionsData = new Float32Array(n * 4);
    this.initialPoseData = new Float32Array(n * 8);
    this.initialLinearVelData = new Float32Array(n * 4);
    this.initialAngularVelData = new Float32Array(n * 4);
    this.inertialPoseData = new Float32Array(n * INERTIAL_POSE_FLOATS_PER_BODY);
    this.velocitiesData = new Float32Array(n * 4);
    this.prevLinearVelData = new Float32Array(n * 4);
    this.shapesData = new Float32Array(n * 4);
    this.shapesWordData = new Uint32Array(this.shapesData.buffer);
    this.quaternionsData = new Float32Array(n * 4);
    this.angularVelData = new Float32Array(n * 4);
    this.inverseInertiaData = new Float32Array(n * 4);
    this.derivedInvInertiaData = new Float32Array(n * 12);
    this.pairContactsData = new Float32Array(this.maxPairContacts * CONTACT_RECORD_FLOATS);
    this.jointRecordsData = new Float32Array(this.maxJoints * JOINT_RECORD_FLOATS);
    this.springRecordsData = new Float32Array(this.maxSprings * SPRING_RECORD_FLOATS);
    this.pairActivityData = new Uint32Array(this.pairActivityWordCount);
    this.pairCandidateIndicesData = this.pairActivityData.subarray(
      this.pairCandidateIndicesOffset,
      this.pairCandidateIndicesOffset + candidateListWords
    );
    this.pairVisitedBitsData = new Uint32Array(
      Math.min(Math.ceil(this.maxPairs / 32), maxVisitedWordsPerDispatch)
    );
    this.pairBodyContactCountsData = new Uint32Array(n);
    this.pairBodyContactIndicesData = new Uint32Array(n * this.maxContactsPerBodySolver);
    this.bodyConstraintCountsData = new Uint32Array(n);
    this.bodyConstraintRefsData = new Uint32Array(n * this.maxConstraintsPerBodySolver);
    this.pairActiveCandidateSlotsData = this.pairActivityData.subarray(
      this.pairActiveCandidateSlotsOffset,
      this.pairActiveCandidateSlotsOffset + candidateListWords
    );
    this.pairActiveContactsData = this.pairActivityData.subarray(
      this.pairActiveContactsOffset,
      this.pairActiveContactsOffset + activeContactsWords
    );
    this.pairIgnoredBitsData = this.pairActivityData.subarray(
      this.pairIgnoredBitsOffset,
      this.pairIgnoredBitsOffset + ignoredPairWords
    );
    this.pairColorBodyClaimsData = new Uint32Array(n);
    this.initPairTable();
  }
  initPairTable() {
    this.pairContactsData.fill(0);
    this.jointRecordsData.fill(0);
    this.springRecordsData.fill(0);
  }
  addBody(desc) {
    if (this.bodyCount >= this.config.maxBodies) {
      throw new Error(`Exceeded maxBodies=${this.config.maxBodies}`);
    }
    const i = this.bodyCount++;
    const invMass = desc.mass > 0 ? 1 / desc.mass : 0;
    this.positionsData[i * 4 + 0] = desc.position[0];
    this.positionsData[i * 4 + 1] = desc.position[1];
    this.positionsData[i * 4 + 2] = desc.position[2];
    this.positionsData[i * 4 + 3] = invMass;
    this.initialPoseData[i * 8 + 0] = desc.position[0];
    this.initialPoseData[i * 8 + 1] = desc.position[1];
    this.initialPoseData[i * 8 + 2] = desc.position[2];
    this.initialPoseData[i * 8 + 3] = invMass;
    const inertialBase = i * INERTIAL_POSE_FLOATS_PER_BODY;
    this.inertialPoseData[inertialBase + 0] = desc.position[0];
    this.inertialPoseData[inertialBase + 1] = desc.position[1];
    this.inertialPoseData[inertialBase + 2] = desc.position[2];
    this.inertialPoseData[inertialBase + 3] = invMass;
    if (desc.linearVelocity) {
      this.velocitiesData[i * 4 + 0] = desc.linearVelocity[0];
      this.velocitiesData[i * 4 + 1] = desc.linearVelocity[1];
      this.velocitiesData[i * 4 + 2] = desc.linearVelocity[2];
      this.prevLinearVelData[i * 4 + 0] = desc.linearVelocity[0];
      this.prevLinearVelData[i * 4 + 1] = desc.linearVelocity[1];
      this.prevLinearVelData[i * 4 + 2] = desc.linearVelocity[2];
      this.initialLinearVelData[i * 4 + 0] = desc.linearVelocity[0];
      this.initialLinearVelData[i * 4 + 1] = desc.linearVelocity[1];
      this.initialLinearVelData[i * 4 + 2] = desc.linearVelocity[2];
    }
    const shapeType = desc.shapeType === "sphere" ? SHAPE_TYPE_SPHERE : SHAPE_TYPE_BOX;
    const halfExtents = desc.shapeType === "sphere" ? [desc.radius, desc.radius, desc.radius] : desc.halfExtents;
    this.shapesWordData[i * 4 + 0] = packShapeMetaWord(
      clampShapeFriction(desc.friction ?? 1),
      clampCollisionFilterWord(desc.collisionGroup ?? DEFAULT_COLLISION_GROUP, DEFAULT_COLLISION_GROUP),
      clampCollisionFilterWord(desc.collisionMask ?? DEFAULT_COLLISION_MASK, DEFAULT_COLLISION_MASK),
      shapeType
    );
    this.shapesData[i * 4 + 1] = halfExtents[0];
    this.shapesData[i * 4 + 2] = halfExtents[1];
    this.shapesData[i * 4 + 3] = halfExtents[2];
    const q = desc.quaternion ?? [0, 0, 0, 1];
    this.quaternionsData[i * 4 + 0] = q[0];
    this.quaternionsData[i * 4 + 1] = q[1];
    this.quaternionsData[i * 4 + 2] = q[2];
    this.quaternionsData[i * 4 + 3] = q[3];
    this.initialPoseData[i * 8 + 4] = q[0];
    this.initialPoseData[i * 8 + 5] = q[1];
    this.initialPoseData[i * 8 + 6] = q[2];
    this.initialPoseData[i * 8 + 7] = q[3];
    this.inertialPoseData[inertialBase + 4] = q[0];
    this.inertialPoseData[inertialBase + 5] = q[1];
    this.inertialPoseData[inertialBase + 6] = q[2];
    this.inertialPoseData[inertialBase + 7] = q[3];
    this.inertialPoseData[inertialBase + 8] = desc.position[0];
    this.inertialPoseData[inertialBase + 9] = desc.position[1];
    this.inertialPoseData[inertialBase + 10] = desc.position[2];
    this.inertialPoseData[inertialBase + 11] = invMass;
    this.inertialPoseData[inertialBase + 12] = q[0];
    this.inertialPoseData[inertialBase + 13] = q[1];
    this.inertialPoseData[inertialBase + 14] = q[2];
    this.inertialPoseData[inertialBase + 15] = q[3];
    if (desc.angularVelocity) {
      this.angularVelData[i * 4 + 0] = desc.angularVelocity[0];
      this.angularVelData[i * 4 + 1] = desc.angularVelocity[1];
      this.angularVelData[i * 4 + 2] = desc.angularVelocity[2];
      this.initialAngularVelData[i * 4 + 0] = desc.angularVelocity[0];
      this.initialAngularVelData[i * 4 + 1] = desc.angularVelocity[1];
      this.initialAngularVelData[i * 4 + 2] = desc.angularVelocity[2];
    }
    this.inverseInertiaData[i * 4 + 3] = invMass;
    if (desc.mass > 0) {
      if (desc.lockRotation) {
        this.inverseInertiaData[i * 4 + 0] = 0;
        this.inverseInertiaData[i * 4 + 1] = 0;
        this.inverseInertiaData[i * 4 + 2] = 0;
      } else {
        const m = desc.mass;
        let ixx = 0;
        let iyy = 0;
        let izz = 0;
        if (desc.shapeType === "sphere") {
          const sphereInertia = 0.4 * m * desc.radius * desc.radius;
          ixx = sphereInertia;
          iyy = sphereInertia;
          izz = sphereInertia;
        } else {
          const [hx, hy, hz] = desc.halfExtents;
          ixx = m / 3 * (hy * hy + hz * hz);
          iyy = m / 3 * (hx * hx + hz * hz);
          izz = m / 3 * (hx * hx + hy * hy);
        }
        this.inverseInertiaData[i * 4 + 0] = 1 / ixx;
        this.inverseInertiaData[i * 4 + 1] = 1 / iyy;
        this.inverseInertiaData[i * 4 + 2] = 1 / izz;
      }
    }
    if (this.initialized) {
      const vec4Start = i * 4;
      const vec4Count = 4;
      const initialPoseStart = i * 8;
      const initialPoseCount = 8;
      const inertialPoseStart = i * INERTIAL_POSE_FLOATS_PER_BODY;
      const inertialPoseCount = INERTIAL_POSE_FLOATS_PER_BODY;
      this.positionsAttr.addUpdateRange(vec4Start, vec4Count);
      this.initialPoseAttr.addUpdateRange(initialPoseStart, initialPoseCount);
      this.inertialPoseAttr.addUpdateRange(inertialPoseStart, inertialPoseCount);
      this.velocitiesAttr.addUpdateRange(vec4Start, vec4Count);
      this.prevLinearVelAttr.addUpdateRange(vec4Start, vec4Count);
      this.shapesAttr.addUpdateRange(vec4Start, vec4Count);
      this.quaternionsAttr.addUpdateRange(vec4Start, vec4Count);
      this.angularVelAttr.addUpdateRange(vec4Start, vec4Count);
      this.inverseInertiaAttr.addUpdateRange(vec4Start, vec4Count);
      this.positionsAttr.needsUpdate = true;
      this.initialPoseAttr.needsUpdate = true;
      this.inertialPoseAttr.needsUpdate = true;
      this.velocitiesAttr.needsUpdate = true;
      this.prevLinearVelAttr.needsUpdate = true;
      this.shapesAttr.needsUpdate = true;
      this.quaternionsAttr.needsUpdate = true;
      this.angularVelAttr.needsUpdate = true;
      this.inverseInertiaAttr.needsUpdate = true;
    }
    this.waitingForInitialCandidatePairs = this.enableBvhBuild && this.bodyCount > this.bruteForceMaxBodies;
    return i;
  }
  getBodyQuaternion(body) {
    return normalizeQuat([
      this.quaternionsData[body * 4 + 0] ?? 0,
      this.quaternionsData[body * 4 + 1] ?? 0,
      this.quaternionsData[body * 4 + 2] ?? 0,
      this.quaternionsData[body * 4 + 3] ?? 1
    ]);
  }
  getBodySize(body) {
    return [
      (this.shapesData[body * 4 + 1] ?? 0) * 2,
      (this.shapesData[body * 4 + 2] ?? 0) * 2,
      (this.shapesData[body * 4 + 3] ?? 0) * 2
    ];
  }
  getBodyPosition(body) {
    return [
      this.positionsData[body * 4 + 0] ?? 0,
      this.positionsData[body * 4 + 1] ?? 0,
      this.positionsData[body * 4 + 2] ?? 0
    ];
  }
  setBodyPose(body, position, quaternion, linearVelocity, angularVelocity) {
    if (body < 0 || body >= this.bodyCount) return;
    const bodyBase = body * 4;
    const poseBase = body * 8;
    const inertialBase = body * INERTIAL_POSE_FLOATS_PER_BODY;
    this.positionsData[bodyBase + 0] = position[0];
    this.positionsData[bodyBase + 1] = position[1];
    this.positionsData[bodyBase + 2] = position[2];
    this.initialPoseData[poseBase + 0] = position[0];
    this.initialPoseData[poseBase + 1] = position[1];
    this.initialPoseData[poseBase + 2] = position[2];
    this.inertialPoseData[inertialBase + 0] = position[0];
    this.inertialPoseData[inertialBase + 1] = position[1];
    this.inertialPoseData[inertialBase + 2] = position[2];
    this.inertialPoseData[inertialBase + 8] = position[0];
    this.inertialPoseData[inertialBase + 9] = position[1];
    this.inertialPoseData[inertialBase + 10] = position[2];
    if (quaternion) {
      const q = normalizeQuat(quaternion);
      this.quaternionsData[bodyBase + 0] = q[0];
      this.quaternionsData[bodyBase + 1] = q[1];
      this.quaternionsData[bodyBase + 2] = q[2];
      this.quaternionsData[bodyBase + 3] = q[3];
      this.initialPoseData[poseBase + 4] = q[0];
      this.initialPoseData[poseBase + 5] = q[1];
      this.initialPoseData[poseBase + 6] = q[2];
      this.initialPoseData[poseBase + 7] = q[3];
      this.inertialPoseData[inertialBase + 4] = q[0];
      this.inertialPoseData[inertialBase + 5] = q[1];
      this.inertialPoseData[inertialBase + 6] = q[2];
      this.inertialPoseData[inertialBase + 7] = q[3];
      this.inertialPoseData[inertialBase + 12] = q[0];
      this.inertialPoseData[inertialBase + 13] = q[1];
      this.inertialPoseData[inertialBase + 14] = q[2];
      this.inertialPoseData[inertialBase + 15] = q[3];
    }
    if (linearVelocity) {
      this.velocitiesData[bodyBase + 0] = linearVelocity[0];
      this.velocitiesData[bodyBase + 1] = linearVelocity[1];
      this.velocitiesData[bodyBase + 2] = linearVelocity[2];
      this.prevLinearVelData[bodyBase + 0] = linearVelocity[0];
      this.prevLinearVelData[bodyBase + 1] = linearVelocity[1];
      this.prevLinearVelData[bodyBase + 2] = linearVelocity[2];
    }
    if (angularVelocity) {
      this.angularVelData[bodyBase + 0] = angularVelocity[0];
      this.angularVelData[bodyBase + 1] = angularVelocity[1];
      this.angularVelData[bodyBase + 2] = angularVelocity[2];
    }
    if (this.initialized) {
      this.positionsAttr.addUpdateRange(bodyBase, 4);
      this.positionsAttr.needsUpdate = true;
      this.initialPoseAttr.addUpdateRange(poseBase, 8);
      this.initialPoseAttr.needsUpdate = true;
      this.inertialPoseAttr.addUpdateRange(inertialBase, INERTIAL_POSE_FLOATS_PER_BODY);
      this.inertialPoseAttr.needsUpdate = true;
      if (quaternion) {
        this.quaternionsAttr.addUpdateRange(bodyBase, 4);
        this.quaternionsAttr.needsUpdate = true;
      }
      if (linearVelocity) {
        this.velocitiesAttr.addUpdateRange(bodyBase, 4);
        this.velocitiesAttr.needsUpdate = true;
        this.prevLinearVelAttr.addUpdateRange(bodyBase, 4);
        this.prevLinearVelAttr.needsUpdate = true;
      }
      if (angularVelocity) {
        this.angularVelAttr.addUpdateRange(bodyBase, 4);
        this.angularVelAttr.needsUpdate = true;
      }
    }
  }
  appendJoint(desc) {
    if (this.jointCount >= this.maxJoints) {
      throw new Error(`Exceeded maxJoints=${this.maxJoints}`);
    }
    if (desc.bodyB < 0 || desc.bodyB >= this.bodyCount) {
      throw new Error(`Invalid joint bodyB=${desc.bodyB}`);
    }
    if (desc.bodyA !== null && (desc.bodyA < 0 || desc.bodyA >= this.bodyCount)) {
      throw new Error(`Invalid joint bodyA=${desc.bodyA}`);
    }
    const jointIndex = this.jointCount++;
    const bodyA = desc.bodyA ?? WORLD_BODY_INDEX;
    const bodyB = desc.bodyB;
    const type = desc.type === "fixed" ? 1 : 0;
    const stiffness = Math.max(desc.stiffness ?? 1e6, AVBD_K_START2);
    const bodyASize = desc.bodyA === null ? [0, 0, 0] : this.getBodySize(desc.bodyA);
    const bodyBSize = this.getBodySize(bodyB);
    const torqueArm = (bodyASize[0] + bodyBSize[0]) * (bodyASize[0] + bodyBSize[0]) + (bodyASize[1] + bodyBSize[1]) * (bodyASize[1] + bodyBSize[1]) + (bodyASize[2] + bodyBSize[2]) * (bodyASize[2] + bodyBSize[2]);
    const qA = desc.bodyA === null ? [0, 0, 0, 1] : this.getBodyQuaternion(desc.bodyA);
    const qB = this.getBodyQuaternion(bodyB);
    const restRelative = normalizeQuat(multiplyQuat(conjugateQuat(qA), qB));
    const metaBase = jointRecordVec4FloatIndex(jointIndex, JOINT_RECORD_META_OFFSET);
    const metaWords = new Uint32Array(this.jointRecordsData.buffer, metaBase * 4, 4);
    metaWords[0] = bodyA >>> 0;
    metaWords[1] = bodyB >>> 0;
    metaWords[2] = type >>> 0;
    metaWords[3] = 1;
    const anchorABase = jointRecordVec4FloatIndex(jointIndex, JOINT_RECORD_ANCHOR_A_OFFSET);
    this.jointRecordsData[anchorABase + 0] = desc.anchorA[0];
    this.jointRecordsData[anchorABase + 1] = desc.anchorA[1];
    this.jointRecordsData[anchorABase + 2] = desc.anchorA[2];
    this.jointRecordsData[anchorABase + 3] = torqueArm;
    const anchorBBase = jointRecordVec4FloatIndex(jointIndex, JOINT_RECORD_ANCHOR_B_OFFSET);
    this.jointRecordsData[anchorBBase + 0] = desc.anchorB[0];
    this.jointRecordsData[anchorBBase + 1] = desc.anchorB[1];
    this.jointRecordsData[anchorBBase + 2] = desc.anchorB[2];
    this.jointRecordsData[anchorBBase + 3] = 0;
    const restBase = jointRecordVec4FloatIndex(jointIndex, JOINT_RECORD_REST_RELATIVE_ROTATION_OFFSET);
    this.jointRecordsData[restBase + 0] = restRelative[0];
    this.jointRecordsData[restBase + 1] = restRelative[1];
    this.jointRecordsData[restBase + 2] = restRelative[2];
    this.jointRecordsData[restBase + 3] = restRelative[3];
    const stiffnessBase = jointRecordVec4FloatIndex(jointIndex, JOINT_RECORD_STIFFNESS_OFFSET);
    this.jointRecordsData[stiffnessBase + 0] = stiffness;
    this.jointRecordsData[stiffnessBase + 1] = type === 1 ? stiffness : 0;
    this.jointRecordsData[stiffnessBase + 2] = 0;
    this.jointRecordsData[stiffnessBase + 3] = 0;
    const c0LinBase = jointRecordVec4FloatIndex(jointIndex, JOINT_RECORD_C0_LIN_OFFSET);
    const c0AngBase = jointRecordVec4FloatIndex(jointIndex, JOINT_RECORD_C0_ANG_OFFSET);
    const lambdaLinBase = jointRecordVec4FloatIndex(jointIndex, JOINT_RECORD_LAMBDA_LIN_OFFSET);
    const lambdaAngBase = jointRecordVec4FloatIndex(jointIndex, JOINT_RECORD_LAMBDA_ANG_OFFSET);
    const penaltyLinBase = jointRecordVec4FloatIndex(jointIndex, JOINT_RECORD_PENALTY_LIN_OFFSET);
    const penaltyAngBase = jointRecordVec4FloatIndex(jointIndex, JOINT_RECORD_PENALTY_ANG_OFFSET);
    this.jointRecordsData.fill(0, c0LinBase, c0LinBase + 4);
    this.jointRecordsData.fill(0, c0AngBase, c0AngBase + 4);
    this.jointRecordsData.fill(0, lambdaLinBase, lambdaLinBase + 4);
    this.jointRecordsData.fill(0, lambdaAngBase, lambdaAngBase + 4);
    this.jointRecordsData.fill(0, penaltyLinBase, penaltyLinBase + 4);
    this.jointRecordsData.fill(0, penaltyAngBase, penaltyAngBase + 4);
    if (this.initialized) {
      const vec4Start = jointIndex * JOINT_RECORD_VEC4S * 4;
      const vec4Count = JOINT_RECORD_VEC4S * 4;
      this.jointRecordsAttr.addUpdateRange(vec4Start, vec4Count);
      this.jointRecordsAttr.needsUpdate = true;
    }
    if ((desc.disableCollision ?? true) && desc.bodyA !== null && desc.bodyA !== desc.bodyB) {
      this.setPairCollisionIgnored(desc.bodyA, desc.bodyB, true);
    }
    return jointIndex;
  }
  appendSpring(desc) {
    if (this.springCount >= this.maxSprings) {
      throw new Error(`Exceeded maxSprings=${this.maxSprings}`);
    }
    if (desc.bodyB < 0 || desc.bodyB >= this.bodyCount) {
      throw new Error(`Invalid spring bodyB=${desc.bodyB}`);
    }
    if (desc.bodyA !== null && (desc.bodyA < 0 || desc.bodyA >= this.bodyCount)) {
      throw new Error(`Invalid spring bodyA=${desc.bodyA}`);
    }
    const springIndex = this.springCount++;
    const bodyA = desc.bodyA ?? WORLD_BODY_INDEX;
    const bodyB = desc.bodyB;
    const stiffness = Math.max(desc.stiffness ?? 100, 0);
    const qA = desc.bodyA === null ? [0, 0, 0, 1] : this.getBodyQuaternion(desc.bodyA);
    const qB = this.getBodyQuaternion(bodyB);
    const posA = desc.bodyA === null ? desc.anchorA : this.getBodyPosition(desc.bodyA);
    const posB = this.getBodyPosition(bodyB);
    const worldAnchorA = desc.bodyA === null ? desc.anchorA : (() => {
      const offset = rotateVector(qA, desc.anchorA);
      return [
        posA[0] + offset[0],
        posA[1] + offset[1],
        posA[2] + offset[2]
      ];
    })();
    const worldAnchorB = (() => {
      const offset = rotateVector(qB, desc.anchorB);
      return [
        posB[0] + offset[0],
        posB[1] + offset[1],
        posB[2] + offset[2]
      ];
    })();
    const restLength = Math.max(
      desc.restLength ?? Math.hypot(
        worldAnchorA[0] - worldAnchorB[0],
        worldAnchorA[1] - worldAnchorB[1],
        worldAnchorA[2] - worldAnchorB[2]
      ),
      0
    );
    const metaBase = springRecordVec4FloatIndex(springIndex, SPRING_RECORD_META_OFFSET);
    const metaWords = new Uint32Array(this.springRecordsData.buffer, metaBase * 4, 4);
    metaWords[0] = bodyA >>> 0;
    metaWords[1] = bodyB >>> 0;
    metaWords[2] = 1;
    metaWords[3] = 0;
    const anchorABase = springRecordVec4FloatIndex(springIndex, SPRING_RECORD_ANCHOR_A_OFFSET);
    this.springRecordsData[anchorABase + 0] = desc.anchorA[0];
    this.springRecordsData[anchorABase + 1] = desc.anchorA[1];
    this.springRecordsData[anchorABase + 2] = desc.anchorA[2];
    this.springRecordsData[anchorABase + 3] = restLength;
    const anchorBBase = springRecordVec4FloatIndex(springIndex, SPRING_RECORD_ANCHOR_B_OFFSET);
    this.springRecordsData[anchorBBase + 0] = desc.anchorB[0];
    this.springRecordsData[anchorBBase + 1] = desc.anchorB[1];
    this.springRecordsData[anchorBBase + 2] = desc.anchorB[2];
    this.springRecordsData[anchorBBase + 3] = stiffness;
    if (this.initialized) {
      const vec4Start = springIndex * SPRING_RECORD_VEC4S * 4;
      const vec4Count = SPRING_RECORD_VEC4S * 4;
      this.springRecordsAttr.addUpdateRange(vec4Start, vec4Count);
      this.springRecordsAttr.needsUpdate = true;
    }
    if ((desc.disableCollision ?? false) && desc.bodyA !== null && desc.bodyA !== desc.bodyB) {
      this.setPairCollisionIgnored(desc.bodyA, desc.bodyB, true);
    }
    return springIndex;
  }
  setPairCollisionIgnored(bodyA, bodyB, ignored) {
    const pairIndex = pairIndexForBodies(bodyA, bodyB);
    if (pairIndex < 0 || pairIndex >= this.maxPairs) return;
    const wordIndex = pairIndex >> 5;
    const bit = 1 << (pairIndex & 31);
    if (wordIndex >= this.pairIgnoredBitsData.length) return;
    if (ignored) {
      this.pairIgnoredBitsData[wordIndex] = (this.pairIgnoredBitsData[wordIndex] ?? 0) | bit;
    } else {
      this.pairIgnoredBitsData[wordIndex] = (this.pairIgnoredBitsData[wordIndex] ?? 0) & ~bit;
    }
    if (this.initialized) {
      this.pairActivityAttr.addUpdateRange(this.pairIgnoredBitsOffset + wordIndex, 1);
      this.pairActivityAttr.needsUpdate = true;
    }
  }
  setBodyPairCollisionIgnored(bodyA, bodyB, ignored = true) {
    if (bodyA < 0 || bodyA >= this.bodyCount) return;
    if (bodyB < 0 || bodyB >= this.bodyCount) return;
    if (bodyA === bodyB) return;
    this.setPairCollisionIgnored(bodyA, bodyB, ignored);
  }
  setBodyCollisionFilter(body, collisionGroup, collisionMask) {
    if (body < 0 || body >= this.bodyCount) return;
    const base = body * 4;
    const currentMeta = this.shapesWordData[base] ?? 0;
    const currentFriction = decodeShapeFrictionWord(currentMeta);
    const currentShapeType = decodeShapeTypeWord(currentMeta);
    this.shapesWordData[base] = packShapeMetaWord(
      currentFriction,
      clampCollisionFilterWord(collisionGroup, DEFAULT_COLLISION_GROUP),
      clampCollisionFilterWord(collisionMask, DEFAULT_COLLISION_MASK),
      currentShapeType
    );
    if (this.initialized) {
      this.shapesAttr.addUpdateRange(base, 1);
      this.shapesAttr.needsUpdate = true;
    }
  }
  addSphericalJoint(bodyA, bodyB, anchorA, anchorB, stiffness = 1e6, disableCollision = true) {
    return this.appendJoint({
      type: "spherical",
      bodyA,
      bodyB,
      anchorA,
      anchorB,
      stiffness,
      disableCollision
    });
  }
  addFixedJoint(bodyA, bodyB, anchorA, anchorB, stiffness = 1e6, disableCollision = true) {
    return this.appendJoint({
      type: "fixed",
      bodyA,
      bodyB,
      anchorA,
      anchorB,
      stiffness,
      disableCollision
    });
  }
  addSpring(bodyA, bodyB, anchorA, anchorB, stiffness = 100, restLength, disableCollision = true) {
    return this.appendSpring({
      bodyA,
      bodyB,
      anchorA,
      anchorB,
      stiffness,
      restLength,
      disableCollision
    });
  }
  initGPU() {
    if (this.initialized) return;
    this.initialized = true;
    const n = this.config.maxBodies;
    this.positionsAttr = new StorageBufferAttribute5(this.positionsData, 4);
    this.initialPoseAttr = new StorageBufferAttribute5(this.initialPoseData, 4);
    this.inertialPoseAttr = new StorageBufferAttribute5(this.inertialPoseData, 4);
    this.velocitiesAttr = new StorageBufferAttribute5(this.velocitiesData, 4);
    this.prevLinearVelAttr = new StorageBufferAttribute5(this.prevLinearVelData, 4);
    this.shapesAttr = new StorageBufferAttribute5(this.shapesData, 4);
    this.quaternionsAttr = new StorageBufferAttribute5(this.quaternionsData, 4);
    this.angularVelAttr = new StorageBufferAttribute5(this.angularVelData, 4);
    this.inverseInertiaAttr = new StorageBufferAttribute5(this.inverseInertiaData, 4);
    this.derivedInvInertiaAttr = new StorageBufferAttribute5(this.derivedInvInertiaData, 4);
    this.pairContactsAttr = new StorageBufferAttribute5(this.pairContactsData, 4);
    this.jointRecordsAttr = new StorageBufferAttribute5(this.jointRecordsData, 4);
    this.springRecordsAttr = new StorageBufferAttribute5(this.springRecordsData, 4);
    this.pairActivityAttr = new StorageBufferAttribute5(this.pairActivityData, 1);
    this.pairCandidateIndicesAttr = this.pairActivityAttr;
    this.pairVisitedBitsAttr = new StorageBufferAttribute5(this.pairVisitedBitsData, 1);
    this.pairBodyContactCountsAttr = new StorageBufferAttribute5(this.pairBodyContactCountsData, 1);
    this.pairBodyContactIndicesAttr = new StorageBufferAttribute5(this.pairBodyContactIndicesData, 1);
    this.bodyConstraintCountsAttr = new StorageBufferAttribute5(this.bodyConstraintCountsData, 1);
    this.bodyConstraintRefsAttr = new StorageBufferAttribute5(this.bodyConstraintRefsData, 1);
    this.pairActiveCandidateSlotsAttr = this.pairActivityAttr;
    this.pairActiveContactsAttr = this.pairActivityAttr;
    this.pairColorBodyClaimsAttr = new StorageBufferAttribute5(this.pairColorBodyClaimsData, 1);
    this.integration = new IntegrationStage(
      this.positionsAttr,
      this.initialPoseAttr,
      this.inertialPoseAttr,
      this.velocitiesAttr,
      this.prevLinearVelAttr,
      this.quaternionsAttr,
      this.angularVelAttr,
      this.config.gravity,
      n
    );
    this.derivedInertia = new DerivedInertiaStage(
      this.quaternionsAttr,
      this.inverseInertiaAttr,
      this.derivedInvInertiaAttr,
      n
    );
    this.contactGeneration = new ContactGenerationStage(
      this.positionsAttr,
      this.quaternionsAttr,
      this.shapesAttr,
      this.pairContactsAttr,
      this.pairActivityAttr,
      this.pairBodyContactCountsAttr,
      this.pairBodyContactIndicesAttr,
      n,
      this.maxPairContacts,
      this.pairManifoldSlots,
      this.maxContactsPerBodySolver,
      this.maxActivePairContacts,
      this.pairCandidateIndicesOffset,
      this.pairActiveCandidateSlotsOffset,
      this.pairActiveContactsOffset,
      this.pairIgnoredBitsOffset,
      this.pairActivityWordCount
    );
    this.contactGeneration.setDebugEnabled(this.debugBehaviorEnabled);
    this.contactGeneration.setDebugLogInterval(this.debugLogEveryNFrames);
    this.broadPhase = new BroadPhaseStage(
      this.device,
      this.positionsAttr,
      this.velocitiesAttr,
      this.quaternionsAttr,
      this.shapesAttr,
      this.pairActivityAttr,
      this.pairCandidateIndicesAttr,
      this.pairVisitedBitsAttr,
      n,
      this.maxCandidatePairs,
      this.maxPairsPerBodyBroadphase,
      this.pairIgnoredBitsOffset,
      {
        enableBvhBuild: this.enableBvhBuild,
        buildOnce: this.bvhBuildOnce,
        rebuildIntervalFrames: this.bvhRebuildIntervalFrames,
        waitForGpuCompletion: this.bvhWaitForGpuCompletion
      }
    );
    this.broadPhase.setDebugEnabled(this.debugBehaviorEnabled);
    this.broadPhase.setDebugLogInterval(this.debugLogEveryNFrames);
    this.avbdState = new AvbdStateStage(
      this.pairContactsAttr,
      this.jointRecordsAttr,
      this.springRecordsAttr,
      this.positionsAttr,
      this.initialPoseAttr,
      this.inertialPoseAttr,
      this.quaternionsAttr,
      this.velocitiesAttr,
      this.prevLinearVelAttr,
      this.angularVelAttr,
      this.inverseInertiaAttr,
      this.derivedInvInertiaAttr,
      this.bodyConstraintCountsAttr,
      this.bodyConstraintRefsAttr,
      this.pairBodyContactCountsAttr,
      this.pairBodyContactIndicesAttr,
      this.pairColorBodyClaimsAttr,
      this.pairActivityAttr,
      n,
      this.maxPairContacts,
      this.maxJoints,
      this.maxSprings,
      this.maxActivePairContacts,
      this.maxConstraintsPerBodySolver,
      this.maxContactsPerBodySolver,
      this.pairManifoldSlots,
      this.pairActiveContactsOffset,
      this.pairActivityWordCount
    );
    this.avbdState.setDebugEnabled(this.debugBehaviorEnabled);
    this.avbdState.setDebugLogInterval(this.debugLogEveryNFrames);
    this.avbdState.setFriction(this.avbdFrictionStatic, this.avbdFrictionStatic);
    this.avbdState.setDualUpdateBeta(this.avbdDualUpdateBeta);
    this.avbdState.setPenaltyDecayGamma(this.avbdPenaltyDecayGamma);
    this.avbdState.setPenaltyFloor(this.avbdPenaltyFloor);
    this.avbdState.setPreventPenetratingNormalDropout(this.avbdPreventPenetratingNormalDropout);
    this.contactGeneration.setFriction(this.avbdFrictionStatic);
    this.playerControl = new PlayerControlStage(
      this.positionsAttr,
      this.velocitiesAttr,
      this.angularVelAttr,
      this.pairBodyContactCountsAttr,
      this.pairBodyContactIndicesAttr,
      this.pairContactsAttr,
      n,
      this.maxPairContacts,
      this.maxContactsPerBodySolver
    );
  }
  step(realDt, renderer) {
    if (this.bodyCount === 0) return;
    this.frameId++;
    this.stats.frameCount = this.frameId;
    const firstFrame = !this.initialized;
    this.initGPU();
    if (firstFrame) {
      this.positionsAttr.needsUpdate = true;
      this.initialPoseAttr.needsUpdate = true;
      this.inertialPoseAttr.needsUpdate = true;
      this.velocitiesAttr.needsUpdate = true;
      this.prevLinearVelAttr.needsUpdate = true;
      this.shapesAttr.needsUpdate = true;
      this.quaternionsAttr.needsUpdate = true;
      this.angularVelAttr.needsUpdate = true;
      this.inverseInertiaAttr.needsUpdate = true;
      this.derivedInvInertiaAttr.needsUpdate = true;
      this.pairContactsAttr.needsUpdate = true;
      this.jointRecordsAttr.needsUpdate = true;
      this.pairActivityAttr.needsUpdate = true;
      this.pairCandidateIndicesAttr.needsUpdate = true;
      this.pairVisitedBitsAttr.needsUpdate = true;
      this.pairBodyContactCountsAttr.needsUpdate = true;
      this.pairBodyContactIndicesAttr.needsUpdate = true;
      this.bodyConstraintCountsAttr.needsUpdate = true;
      this.bodyConstraintRefsAttr.needsUpdate = true;
      this.pairActiveCandidateSlotsAttr.needsUpdate = true;
      this.pairActiveContactsAttr.needsUpdate = true;
      this.pairColorBodyClaimsAttr.needsUpdate = true;
    }
    this.accumulator += Math.min(realDt, 0.05);
    const start = performance.now();
    const stepsAvailable = Math.floor(this.accumulator / this.config.deltaTime);
    const stepsToRun = Math.min(stepsAvailable, this.maxFixedStepsPerFrame);
    let advancedSimulation = false;
    if (stepsToRun > 0) {
      const pairCount = this.bodyCount * (this.bodyCount - 1) / 2;
      let pairGenerationDispatchCount = Math.min(pairCount, this.maxCandidatePairs);
      let pairManifoldDispatchCount = pairGenerationDispatchCount;
      const pairWarmStartDispatchCount = Math.min(
        pairCount * this.pairManifoldSlots,
        this.bodyCount * this.maxContactsPerBodySolver
      );
      let t0 = performance.now();
      this.broadPhase.dispatch(renderer, this.bodyCount, pairCount, this.frameId);
      this.stats.broadPhaseMs = Math.max(
        performance.now() - t0,
        this.broadPhase.getLastBuildMs()
      );
      const candidatePairsAvailable = this.broadPhase.hasCandidatePairs();
      const broadPhaseReady = this.broadPhase.isReady();
      const requiresCandidatePairs = this.enableBvhBuild && this.bodyCount > this.bruteForceMaxBodies;
      const useCandidatePairs = candidatePairsAvailable && requiresCandidatePairs;
      const pairDispatchTruncated = !useCandidatePairs && this.bodyCount > this.bruteForceMaxBodies;
      if (this.waitingForInitialCandidatePairs && requiresCandidatePairs) {
        if (!candidatePairsAvailable) {
          this.stats.broadPhaseReady = broadPhaseReady;
          this.stats.candidatePairsEnabled = useCandidatePairs;
          this.stats.pairDispatchTruncated = pairDispatchTruncated;
          this.accumulator = 0;
          this.stats.totalMs = performance.now() - start;
          this.stats.bodyCount = this.bodyCount;
          this.stats.frameCount = this.frameId;
          return;
        }
        this.waitingForInitialCandidatePairs = false;
      } else if (!requiresCandidatePairs) {
        this.waitingForInitialCandidatePairs = false;
      }
      const waitingForBroadphase = !broadPhaseReady && this.enableBvhBuild;
      if (pairDispatchTruncated && !this.pairDispatchTruncationWarned) {
        if (waitingForBroadphase) {
          console.warn(
            `Broadphase BVH is still building at bodyCount=${this.bodyCount}. Pausing physics until candidate pairs become available (brute-force safe limit=${this.bruteForceMaxBodies}).`
          );
        } else {
          console.error(
            `Broadphase candidate pairs are disabled and bodyCount (${this.bodyCount}) exceeds brute-force safe limit (${this.bruteForceMaxBodies}). Pausing physics to avoid incomplete collisions.`
          );
        }
        this.pairDispatchTruncationWarned = true;
      } else if (!pairDispatchTruncated) {
        this.pairDispatchTruncationWarned = false;
      }
      this.stats.broadPhaseReady = broadPhaseReady;
      this.stats.candidatePairsEnabled = useCandidatePairs;
      this.stats.pairDispatchTruncated = pairDispatchTruncated;
      if (pairDispatchTruncated && this.haltOnBroadphaseFallbackOverflow) {
        this.accumulator = 0;
        this.stats.totalMs = performance.now() - start;
        this.stats.bodyCount = this.bodyCount;
        this.stats.frameCount = this.frameId;
        return;
      }
      if (useCandidatePairs) {
        const candidateDispatchSpan = Math.min(
          this.maxCandidatePairs,
          this.bodyCount * this.maxPairsPerBodyBroadphase
        );
        pairGenerationDispatchCount = candidateDispatchSpan;
        pairManifoldDispatchCount = candidateDispatchSpan;
      }
      const subDt = this.config.deltaTime / this.config.substeps;
      for (let stepIndex = 0; stepIndex < stepsToRun; stepIndex++) {
        for (let s = 0; s < this.config.substeps; s++) {
          advancedSimulation = true;
          this.substep(
            subDt,
            renderer,
            pairCount,
            pairGenerationDispatchCount,
            pairManifoldDispatchCount,
            pairWarmStartDispatchCount,
            useCandidatePairs
          );
        }
        this.accumulator -= this.config.deltaTime;
      }
    }
    if (stepsAvailable > stepsToRun) {
      this.accumulator = Math.min(this.accumulator, this.config.deltaTime);
    }
    this.stats.totalMs = performance.now() - start;
    this.stats.bodyCount = this.bodyCount;
    if (advancedSimulation) {
      this.logSupportDiagnostics(renderer);
    }
  }
  substep(dt, renderer, pairCount, pairGenerationDispatchCount, pairManifoldDispatchCount, pairWarmStartDispatchCount, candidatePairsEnabled) {
    let t0;
    t0 = performance.now();
    this.integration.dispatch(renderer, this.bodyCount, dt);
    this.stats.integrationMs = performance.now() - t0;
    t0 = performance.now();
    this.contactGeneration.setFloorDebugBody(
      this.debugBehaviorEnabled ? this.findSupportFloorBody(this.positionsData, this.shapesData).body : -1
    );
    this.contactGeneration.dispatchPairKernelPhase(
      renderer,
      this.bodyCount,
      pairCount,
      pairGenerationDispatchCount,
      candidatePairsEnabled
    );
    this.contactGeneration.dispatchBodyListPhase(
      renderer,
      this.bodyCount,
      pairGenerationDispatchCount,
      this.frameId
    );
    const solveAlpha = this.avbdRegularizationAlpha;
    const mainTangentialAlpha = solveAlpha;
    const mainPairSweeps = this.avbdPairSweeps;
    const mainIterations = this.solverIterations;
    const mainSolveTuning = {
      relaxation: 1,
      maxLinearCorrection: 1e9,
      maxAngularCorrection: 1e9
    };
    const dualUpdateBeta = this.avbdDualUpdateBeta;
    const warmstartScale = solveAlpha * this.avbdPenaltyDecayGamma;
    this.avbdState.prepare(
      renderer,
      this.bodyCount,
      pairWarmStartDispatchCount,
      this.jointCount,
      this.springCount,
      this.activePairSolveColorCount,
      warmstartScale,
      dt,
      this.avbdBodySolveMode
    );
    this.avbdState.setDualUpdateBeta(dualUpdateBeta);
    this.avbdState.clearPhaseDebugCounters(renderer);
    const needsDerivedInertia = this.avbdState.usesDerivedInertiaInPrimalSolve();
    for (let i = 0; i < mainIterations; i++) {
      if (needsDerivedInertia) {
        this.derivedInertia.dispatch(renderer, this.bodyCount);
      }
      this.avbdState.primalSolveBodies(
        renderer,
        this.bodyCount,
        mainPairSweeps,
        this.activePairSolveColorCount,
        solveAlpha,
        dt,
        1,
        mainTangentialAlpha,
        mainSolveTuning,
        0,
        0,
        void 0,
        this.avbdBodySolveMode
      );
      this.avbdState.captureFromSolve(
        renderer,
        pairWarmStartDispatchCount,
        this.jointCount,
        dt,
        solveAlpha,
        i
      );
    }
    this.avbdState.finalizeVelocities(renderer, this.bodyCount, dt);
    this.avbdState.capturePhaseDebug(
      renderer,
      pairWarmStartDispatchCount,
      solveAlpha,
      0,
      1,
      mainTangentialAlpha
    );
    this.avbdState.maybeLogDebug(renderer, this.frameId, pairWarmStartDispatchCount, this.bodyCount);
    this.stats.solverMs = performance.now() - t0;
    this.stats.velocityUpdateMs = 0;
  }
  getBodyCount() {
    return this.bodyCount;
  }
  clearScene() {
    this.broadPhase?.reset?.();
    this.bodyCount = 0;
    this.jointCount = 0;
    this.springCount = 0;
    this.pairContactsData.fill(0);
    this.jointRecordsData.fill(0);
    this.springRecordsData.fill(0);
    this.pairActivityData.fill(0);
    this.pairVisitedBitsData.fill(0);
    this.pairBodyContactCountsData.fill(0);
    this.pairBodyContactIndicesData.fill(0);
    this.bodyConstraintCountsData.fill(0);
    this.bodyConstraintRefsData.fill(0);
    this.pairColorBodyClaimsData.fill(0);
    this.accumulator = 0;
    this.frameId = 0;
    this.pairDispatchTruncationWarned = false;
    this.waitingForInitialCandidatePairs = false;
    this.supportDebugReadbackInFlight = false;
    this.lastSupportDebugLogFrame = -1;
    this.prevSupportBodyCount = -1;
    this.prevCandidatePairsForChurn = null;
    this.prevFloorCandidatePairsForChurn = null;
    this.stats.bodyCount = 0;
    this.stats.frameCount = 0;
    this.stats.totalMs = 0;
    this.stats.integrationMs = 0;
    this.stats.broadPhaseMs = 0;
    this.stats.solverMs = 0;
    this.stats.velocityUpdateMs = 0;
    this.stats.broadPhaseReady = false;
    this.stats.candidatePairsEnabled = false;
    this.stats.pairDispatchTruncated = false;
    if (!this.initialized) return;
    this.pairContactsAttr.needsUpdate = true;
    this.jointRecordsAttr.needsUpdate = true;
    this.springRecordsAttr.needsUpdate = true;
    this.pairActivityAttr.needsUpdate = true;
    this.pairVisitedBitsAttr.needsUpdate = true;
    this.pairBodyContactCountsAttr.needsUpdate = true;
    this.pairBodyContactIndicesAttr.needsUpdate = true;
    this.bodyConstraintCountsAttr.needsUpdate = true;
    this.bodyConstraintRefsAttr.needsUpdate = true;
    this.pairColorBodyClaimsAttr.needsUpdate = true;
  }
  resetSimulationToInitialPose() {
    if (this.bodyCount <= 0) return;
    for (let i = 0; i < this.bodyCount; i++) {
      const bodyBase = i * 4;
      const poseBase = i * 8;
      const inertialBase = i * INERTIAL_POSE_FLOATS_PER_BODY;
      this.positionsData[bodyBase + 0] = this.initialPoseData[poseBase + 0];
      this.positionsData[bodyBase + 1] = this.initialPoseData[poseBase + 1];
      this.positionsData[bodyBase + 2] = this.initialPoseData[poseBase + 2];
      this.positionsData[bodyBase + 3] = this.initialPoseData[poseBase + 3];
      this.inertialPoseData[inertialBase + 0] = this.initialPoseData[poseBase + 0];
      this.inertialPoseData[inertialBase + 1] = this.initialPoseData[poseBase + 1];
      this.inertialPoseData[inertialBase + 2] = this.initialPoseData[poseBase + 2];
      this.inertialPoseData[inertialBase + 3] = this.initialPoseData[poseBase + 3];
      this.quaternionsData[bodyBase + 0] = this.initialPoseData[poseBase + 4];
      this.quaternionsData[bodyBase + 1] = this.initialPoseData[poseBase + 5];
      this.quaternionsData[bodyBase + 2] = this.initialPoseData[poseBase + 6];
      this.quaternionsData[bodyBase + 3] = this.initialPoseData[poseBase + 7];
      this.inertialPoseData[inertialBase + 4] = this.initialPoseData[poseBase + 4];
      this.inertialPoseData[inertialBase + 5] = this.initialPoseData[poseBase + 5];
      this.inertialPoseData[inertialBase + 6] = this.initialPoseData[poseBase + 6];
      this.inertialPoseData[inertialBase + 7] = this.initialPoseData[poseBase + 7];
      this.inertialPoseData[inertialBase + 8] = this.initialPoseData[poseBase + 0];
      this.inertialPoseData[inertialBase + 9] = this.initialPoseData[poseBase + 1];
      this.inertialPoseData[inertialBase + 10] = this.initialPoseData[poseBase + 2];
      this.inertialPoseData[inertialBase + 11] = this.initialPoseData[poseBase + 3];
      this.inertialPoseData[inertialBase + 12] = this.initialPoseData[poseBase + 4];
      this.inertialPoseData[inertialBase + 13] = this.initialPoseData[poseBase + 5];
      this.inertialPoseData[inertialBase + 14] = this.initialPoseData[poseBase + 6];
      this.inertialPoseData[inertialBase + 15] = this.initialPoseData[poseBase + 7];
      this.velocitiesData[bodyBase + 0] = this.initialLinearVelData[bodyBase + 0];
      this.velocitiesData[bodyBase + 1] = this.initialLinearVelData[bodyBase + 1];
      this.velocitiesData[bodyBase + 2] = this.initialLinearVelData[bodyBase + 2];
      this.velocitiesData[bodyBase + 3] = this.initialLinearVelData[bodyBase + 3];
      this.prevLinearVelData[bodyBase + 0] = this.initialLinearVelData[bodyBase + 0];
      this.prevLinearVelData[bodyBase + 1] = this.initialLinearVelData[bodyBase + 1];
      this.prevLinearVelData[bodyBase + 2] = this.initialLinearVelData[bodyBase + 2];
      this.prevLinearVelData[bodyBase + 3] = this.initialLinearVelData[bodyBase + 3];
      this.angularVelData[bodyBase + 0] = this.initialAngularVelData[bodyBase + 0];
      this.angularVelData[bodyBase + 1] = this.initialAngularVelData[bodyBase + 1];
      this.angularVelData[bodyBase + 2] = this.initialAngularVelData[bodyBase + 2];
      this.angularVelData[bodyBase + 3] = this.initialAngularVelData[bodyBase + 3];
    }
    this.pairContactsData.fill(0);
    for (let jointIndex = 0; jointIndex < this.jointCount; jointIndex++) {
      const c0LinBase = jointRecordVec4FloatIndex(jointIndex, JOINT_RECORD_C0_LIN_OFFSET);
      const c0AngBase = jointRecordVec4FloatIndex(jointIndex, JOINT_RECORD_C0_ANG_OFFSET);
      const lambdaLinBase = jointRecordVec4FloatIndex(jointIndex, JOINT_RECORD_LAMBDA_LIN_OFFSET);
      const lambdaAngBase = jointRecordVec4FloatIndex(jointIndex, JOINT_RECORD_LAMBDA_ANG_OFFSET);
      const penaltyLinBase = jointRecordVec4FloatIndex(jointIndex, JOINT_RECORD_PENALTY_LIN_OFFSET);
      const penaltyAngBase = jointRecordVec4FloatIndex(jointIndex, JOINT_RECORD_PENALTY_ANG_OFFSET);
      this.jointRecordsData.fill(0, c0LinBase, c0LinBase + 4);
      this.jointRecordsData.fill(0, c0AngBase, c0AngBase + 4);
      this.jointRecordsData.fill(0, lambdaLinBase, lambdaLinBase + 4);
      this.jointRecordsData.fill(0, lambdaAngBase, lambdaAngBase + 4);
      this.jointRecordsData.fill(0, penaltyLinBase, penaltyLinBase + 4);
      this.jointRecordsData.fill(0, penaltyAngBase, penaltyAngBase + 4);
    }
    this.pairCandidateIndicesData.fill(0);
    this.pairActiveCandidateSlotsData.fill(0);
    this.pairActiveContactsData.fill(0);
    this.pairVisitedBitsData.fill(0);
    this.pairBodyContactCountsData.fill(0);
    this.pairBodyContactIndicesData.fill(0);
    this.bodyConstraintCountsData.fill(0);
    this.bodyConstraintRefsData.fill(0);
    this.pairColorBodyClaimsData.fill(0);
    this.accumulator = 0;
    this.frameId = 0;
    this.pairDispatchTruncationWarned = false;
    this.waitingForInitialCandidatePairs = this.enableBvhBuild && this.bodyCount > this.bruteForceMaxBodies;
    this.supportDebugReadbackInFlight = false;
    this.lastSupportDebugLogFrame = -1;
    this.prevSupportBodyCount = -1;
    this.prevCandidatePairsForChurn = null;
    this.prevFloorCandidatePairsForChurn = null;
    this.stats.totalMs = 0;
    this.stats.frameCount = 0;
    this.stats.integrationMs = 0;
    this.stats.broadPhaseMs = 0;
    this.stats.solverMs = 0;
    this.stats.velocityUpdateMs = 0;
    this.stats.broadPhaseReady = false;
    this.stats.candidatePairsEnabled = false;
    this.stats.pairDispatchTruncated = false;
    if (!this.initialized) return;
    this.positionsAttr.needsUpdate = true;
    this.inertialPoseAttr.needsUpdate = true;
    this.velocitiesAttr.needsUpdate = true;
    this.prevLinearVelAttr.needsUpdate = true;
    this.quaternionsAttr.needsUpdate = true;
    this.angularVelAttr.needsUpdate = true;
    this.pairContactsAttr.needsUpdate = true;
    this.jointRecordsAttr.needsUpdate = true;
    this.pairActivityAttr.needsUpdate = true;
    this.pairVisitedBitsAttr.needsUpdate = true;
    this.pairBodyContactCountsAttr.needsUpdate = true;
    this.pairBodyContactIndicesAttr.needsUpdate = true;
    this.bodyConstraintCountsAttr.needsUpdate = true;
    this.bodyConstraintRefsAttr.needsUpdate = true;
    this.pairColorBodyClaimsAttr.needsUpdate = true;
  }
  setDeltaTime(deltaTime) {
    const clamped = Math.max(1 / 500, Math.min(1 / 10, deltaTime));
    this.config.deltaTime = clamped;
    this.accumulator = Math.min(this.accumulator, clamped);
  }
  setSubsteps(substeps) {
    const clamped = Math.max(1, Math.min(8, Math.floor(substeps)));
    this.config.substeps = clamped;
  }
  getSubsteps() {
    return this.config.substeps;
  }
  getPairManifoldSlots() {
    return this.pairManifoldSlots;
  }
  setAvbdPairSweeps(sweeps) {
    this.avbdPairSweeps = Math.max(1, Math.min(4, Math.floor(sweeps)));
  }
  getAvbdPairSweeps() {
    return this.avbdPairSweeps;
  }
  setPairSolveColorCount(colorCount) {
    const clamped = Math.max(1, Math.min(this.maxPairSolveColorCount, Math.floor(colorCount)));
    this.activePairSolveColorCount = clamped;
  }
  setSolverIterations(iterations) {
    const clamped = Math.max(1, Math.min(64, Math.floor(iterations)));
    this.solverIterations = clamped;
  }
  getSolverIterations() {
    return this.solverIterations;
  }
  setAvbdDualUpdateBeta(beta) {
    const clamped = Math.max(0, beta);
    this.avbdDualUpdateBeta = clamped;
    this.avbdState?.setDualUpdateBeta?.(clamped);
  }
  getAvbdDualUpdateBeta() {
    return this.avbdDualUpdateBeta;
  }
  setAvbdPreventPenetratingNormalDropout(enabled) {
    this.avbdPreventPenetratingNormalDropout = Boolean(enabled);
    this.avbdState?.setPreventPenetratingNormalDropout?.(this.avbdPreventPenetratingNormalDropout);
  }
  getAvbdPreventPenetratingNormalDropout() {
    return this.avbdPreventPenetratingNormalDropout;
  }
  setAvbdBodySolveMode(mode) {
    this.avbdBodySolveMode = mode;
  }
  getAvbdBodySolveMode() {
    return this.avbdBodySolveMode;
  }
  setAvbdPenaltyDecayGamma(gamma) {
    const clamped = Math.max(0, Math.min(1, gamma));
    this.avbdPenaltyDecayGamma = clamped;
    this.avbdState?.setPenaltyDecayGamma?.(clamped);
  }
  getAvbdPenaltyDecayGamma() {
    return this.avbdPenaltyDecayGamma;
  }
  setAvbdPenaltyFloor(kStart) {
    const clamped = Math.max(1e-6, kStart);
    this.avbdPenaltyFloor = clamped;
    this.avbdState?.setPenaltyFloor?.(clamped);
  }
  getAvbdPenaltyFloor() {
    return this.avbdPenaltyFloor;
  }
  setAvbdRegularizationAlpha(alpha) {
    this.avbdRegularizationAlpha = Math.max(0, Math.min(1, alpha));
  }
  getAvbdRegularizationAlpha() {
    return this.avbdRegularizationAlpha;
  }
  setAvbdFriction(friction) {
    const clamped = Math.max(0, Math.min(2, friction));
    this.avbdFrictionStatic = clamped;
    this.contactGeneration?.setFriction?.(clamped);
    this.avbdState?.setFriction?.(clamped, clamped);
  }
  getAvbdFriction() {
    return this.avbdFrictionStatic;
  }
  getRenderBuffers() {
    if (!this.initialized) return null;
    return {
      positions: this.positionsAttr,
      quaternions: this.quaternionsAttr
    };
  }
  getContactRenderBuffers() {
    if (!this.initialized) return null;
    return {
      positions: this.positionsAttr,
      quaternions: this.quaternionsAttr,
      pairContacts: this.pairContactsAttr,
      pairActivity: this.pairActivityAttr,
      maxPairContacts: this.maxPairContacts,
      maxActivePairContacts: this.maxActivePairContacts,
      pairActivityWordCount: this.pairActivityWordCount,
      pairActiveContactsOffset: this.pairActiveContactsOffset
    };
  }
  getSpringRenderBuffers() {
    if (!this.initialized) return null;
    return {
      positions: this.positionsAttr,
      quaternions: this.quaternionsAttr,
      springRecords: this.springRecordsAttr,
      maxSprings: this.maxSprings
    };
  }
  getMaxActiveContactDebugPoints() {
    return this.maxActivePairContacts;
  }
  setDebugBehaviorEnabled(enabled) {
    this.debugBehaviorEnabled = enabled;
    this.broadPhase?.setDebugEnabled?.(enabled);
    this.contactGeneration?.setDebugEnabled?.(enabled);
    this.avbdState?.setDebugEnabled?.(enabled);
    this.supportDebugReadbackInFlight = false;
    this.lastSupportDebugLogFrame = -1;
    this.prevSupportBodyCount = -1;
    this.prevCandidatePairsForChurn = null;
    this.prevFloorCandidatePairsForChurn = null;
  }
  setDebugEnabled(enabled) {
    this.setDebugBehaviorEnabled(enabled);
  }
  setDebugLogEveryFrame(enabled) {
    const interval = enabled ? 1 : 30;
    this.debugLogEveryNFrames = interval;
    this.supportDebugEveryNFrames = interval;
    this.lastSupportDebugLogFrame = -1;
    this.broadPhase?.setDebugLogInterval?.(interval);
    this.contactGeneration?.setDebugLogInterval?.(interval);
    this.avbdState?.setDebugLogInterval?.(interval);
  }
  applyPlayerControl(renderer, config) {
    if (!this.initialized || !this.playerControl) return;
    if (config.bodyIndex < 0 || config.bodyIndex >= this.bodyCount) return;
    this.playerControl.dispatchControl(
      renderer,
      this.bodyCount,
      config.bodyIndex,
      config.targetVelocity,
      config.moveGain ?? 0.4,
      config.jumpSpeed ?? 6,
      config.jumpRequested ?? false,
      config.groundedHint ?? false
    );
  }
  async readPlayerStateAsync(renderer, bodyIndex) {
    if (!this.initialized || !this.playerControl) return null;
    if (bodyIndex < 0 || bodyIndex >= this.bodyCount) return null;
    if (!renderer || typeof renderer.getArrayBufferAsync !== "function") return null;
    this.playerControl.dispatchProbe(renderer, this.bodyCount, bodyIndex);
    const rawBuffer = await renderer.getArrayBufferAsync(this.playerControl.getProbeAttribute());
    const values = new Float32Array(rawBuffer);
    if (values.length < 8) return null;
    return {
      position: [values[0], values[1], values[2]],
      velocity: [values[4], values[5], values[6]],
      grounded: values[3] > 0.5
    };
  }
  async readRigidBodyStatesAsync(renderer) {
    if (!this.initialized) return null;
    if (!renderer || typeof renderer.getArrayBufferAsync !== "function") return null;
    let positionsRaw;
    let quaternionsRaw;
    let velocitiesRaw;
    let angularVelocitiesRaw;
    try {
      positionsRaw = await renderer.getArrayBufferAsync(this.positionsAttr);
    } catch (error) {
      throw new Error(`positions readback failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      quaternionsRaw = await renderer.getArrayBufferAsync(this.quaternionsAttr);
    } catch (error) {
      throw new Error(`quaternions readback failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      velocitiesRaw = await renderer.getArrayBufferAsync(this.velocitiesAttr);
    } catch (error) {
      throw new Error(`velocities readback failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      angularVelocitiesRaw = await renderer.getArrayBufferAsync(this.angularVelAttr);
    } catch (error) {
      throw new Error(`angular velocities readback failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    const positions = new Float32Array(positionsRaw);
    const quaternions = new Float32Array(quaternionsRaw);
    const velocities = new Float32Array(velocitiesRaw);
    const angularVelocities = new Float32Array(angularVelocitiesRaw);
    const states = [];
    for (let body = 0; body < this.bodyCount; body++) {
      const bodyBase = body * 4;
      const poseBase = body * 8;
      states.push({
        body,
        position: [
          positions[bodyBase] ?? 0,
          positions[bodyBase + 1] ?? 0,
          positions[bodyBase + 2] ?? 0
        ],
        initialPosition: [
          this.initialPoseData[poseBase] ?? 0,
          this.initialPoseData[poseBase + 1] ?? 0,
          this.initialPoseData[poseBase + 2] ?? 0
        ],
        quaternion: [
          quaternions[bodyBase] ?? 0,
          quaternions[bodyBase + 1] ?? 0,
          quaternions[bodyBase + 2] ?? 0,
          quaternions[bodyBase + 3] ?? 1
        ],
        velocity: [
          velocities[bodyBase] ?? 0,
          velocities[bodyBase + 1] ?? 0,
          velocities[bodyBase + 2] ?? 0
        ],
        angularVelocity: [
          angularVelocities[bodyBase] ?? 0,
          angularVelocities[bodyBase + 1] ?? 0,
          angularVelocities[bodyBase + 2] ?? 0
        ],
        inverseMass: positions[bodyBase + 3] ?? 0
      });
    }
    return states;
  }
  async readJointStatesAsync(renderer, jointIndices) {
    if (!this.initialized) return null;
    if (!renderer || typeof renderer.getArrayBufferAsync !== "function") return null;
    let jointRecordsRaw;
    try {
      jointRecordsRaw = await renderer.getArrayBufferAsync(this.jointRecordsAttr);
    } catch (error) {
      throw new Error(`joint records readback failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    const jointRecords = new Float32Array(jointRecordsRaw);
    const jointWords = new Uint32Array(jointRecordsRaw);
    const requested = jointIndices ?? Array.from({ length: this.jointCount }, (_, index) => index);
    const states = [];
    for (const jointIndex of requested) {
      if (jointIndex < 0 || jointIndex >= this.jointCount) continue;
      const metaBase = jointRecordVec4FloatIndex(jointIndex, JOINT_RECORD_META_OFFSET);
      if ((jointWords[metaBase + 3] ?? 0) === 0) continue;
      const bodyAWord = jointWords[metaBase] ?? WORLD_BODY_INDEX;
      const bodyBWord = jointWords[metaBase + 1] ?? 0;
      const jointTypeWord = jointWords[metaBase + 2] ?? 0;
      const anchorABase = jointRecordVec4FloatIndex(jointIndex, JOINT_RECORD_ANCHOR_A_OFFSET);
      const anchorBBase = jointRecordVec4FloatIndex(jointIndex, JOINT_RECORD_ANCHOR_B_OFFSET);
      const restBase = jointRecordVec4FloatIndex(jointIndex, JOINT_RECORD_REST_RELATIVE_ROTATION_OFFSET);
      const stiffnessBase = jointRecordVec4FloatIndex(jointIndex, JOINT_RECORD_STIFFNESS_OFFSET);
      const c0LinBase = jointRecordVec4FloatIndex(jointIndex, JOINT_RECORD_C0_LIN_OFFSET);
      const c0AngBase = jointRecordVec4FloatIndex(jointIndex, JOINT_RECORD_C0_ANG_OFFSET);
      const lambdaLinBase = jointRecordVec4FloatIndex(jointIndex, JOINT_RECORD_LAMBDA_LIN_OFFSET);
      const lambdaAngBase = jointRecordVec4FloatIndex(jointIndex, JOINT_RECORD_LAMBDA_ANG_OFFSET);
      const penaltyLinBase = jointRecordVec4FloatIndex(jointIndex, JOINT_RECORD_PENALTY_LIN_OFFSET);
      const penaltyAngBase = jointRecordVec4FloatIndex(jointIndex, JOINT_RECORD_PENALTY_ANG_OFFSET);
      states.push({
        joint: jointIndex,
        bodyA: bodyAWord === WORLD_BODY_INDEX ? null : bodyAWord,
        bodyB: bodyBWord,
        type: jointTypeWord === 1 ? "fixed" : "spherical",
        anchorA: [
          jointRecords[anchorABase] ?? 0,
          jointRecords[anchorABase + 1] ?? 0,
          jointRecords[anchorABase + 2] ?? 0
        ],
        anchorB: [
          jointRecords[anchorBBase] ?? 0,
          jointRecords[anchorBBase + 1] ?? 0,
          jointRecords[anchorBBase + 2] ?? 0
        ],
        torqueArm: jointRecords[anchorABase + 3] ?? 0,
        restRelative: [
          jointRecords[restBase] ?? 0,
          jointRecords[restBase + 1] ?? 0,
          jointRecords[restBase + 2] ?? 0,
          jointRecords[restBase + 3] ?? 1
        ],
        stiffnessLin: jointRecords[stiffnessBase] ?? 0,
        stiffnessAng: jointRecords[stiffnessBase + 1] ?? 0,
        c0Lin: [
          jointRecords[c0LinBase] ?? 0,
          jointRecords[c0LinBase + 1] ?? 0,
          jointRecords[c0LinBase + 2] ?? 0
        ],
        c0Ang: [
          jointRecords[c0AngBase] ?? 0,
          jointRecords[c0AngBase + 1] ?? 0,
          jointRecords[c0AngBase + 2] ?? 0
        ],
        lambdaLin: [
          jointRecords[lambdaLinBase] ?? 0,
          jointRecords[lambdaLinBase + 1] ?? 0,
          jointRecords[lambdaLinBase + 2] ?? 0
        ],
        lambdaAng: [
          jointRecords[lambdaAngBase] ?? 0,
          jointRecords[lambdaAngBase + 1] ?? 0,
          jointRecords[lambdaAngBase + 2] ?? 0
        ],
        penaltyLin: [
          jointRecords[penaltyLinBase] ?? 0,
          jointRecords[penaltyLinBase + 1] ?? 0,
          jointRecords[penaltyLinBase + 2] ?? 0
        ],
        penaltyAng: [
          jointRecords[penaltyAngBase] ?? 0,
          jointRecords[penaltyAngBase + 1] ?? 0,
          jointRecords[penaltyAngBase + 2] ?? 0
        ]
      });
    }
    return states;
  }
  async readActiveContactPointsAsync(renderer) {
    if (!this.initialized) return null;
    if (!renderer || typeof renderer.getArrayBufferAsync !== "function") return null;
    const [
      activityRaw,
      pairContactsRaw,
      quaternionsRaw,
      positionsRaw
    ] = await Promise.all([
      renderer.getArrayBufferAsync(this.pairActivityAttr),
      renderer.getArrayBufferAsync(this.pairContactsAttr),
      renderer.getArrayBufferAsync(this.quaternionsAttr),
      renderer.getArrayBufferAsync(this.positionsAttr)
    ]);
    const activity = new Uint32Array(activityRaw);
    const activeContacts = activity.subarray(
      this.pairActiveContactsOffset,
      this.pairActiveContactsOffset + this.maxActivePairContacts + CANDIDATE_LIST_HEADER_WORDS
    );
    const { meta, arms } = decodePairContactViews(pairContactsRaw, this.maxPairContacts);
    const quaternions = new Float32Array(quaternionsRaw);
    const positions = new Float32Array(positionsRaw);
    const normalizeQuat2 = (x, y, z, w) => {
      const len = Math.hypot(x, y, z, w);
      if (len <= 1e-12) return [0, 0, 0, 1];
      const inv = 1 / len;
      return [x * inv, y * inv, z * inv, w * inv];
    };
    const rotateVecByQuat = (qx, qy, qz, qw, vx, vy, vz) => {
      const tx = 2 * (qy * vz - qz * vy);
      const ty = 2 * (qz * vx - qx * vz);
      const tz = 2 * (qx * vy - qy * vx);
      return [
        vx + qw * tx + (qy * tz - qz * ty),
        vy + qw * ty + (qz * tx - qx * tz),
        vz + qw * tz + (qx * ty - qy * tx)
      ];
    };
    const activeListCount = Math.min(activeContacts[0] ?? 0, this.maxActivePairContacts);
    const points = [];
    for (let k = 0; k < activeListCount; k++) {
      const p = activeContacts[k + 1] ?? this.maxPairContacts;
      if (p >= this.maxPairContacts) continue;
      const metaBase = p * 4;
      if ((meta[metaBase + 2] ?? 0) < 0.5) continue;
      const i = Math.round(meta[metaBase] ?? -1);
      const j = Math.round(meta[metaBase + 1] ?? -1);
      if (i < 0 || j < 0) continue;
      const iBase = i * 4;
      const jBase = j * 4;
      const iPosX = positions[iBase] ?? 0;
      const iPosY = positions[iBase + 1] ?? 0;
      const iPosZ = positions[iBase + 2] ?? 0;
      const jPosX = positions[jBase] ?? 0;
      const jPosY = positions[jBase + 1] ?? 0;
      const jPosZ = positions[jBase + 2] ?? 0;
      const iQuatBase = i * 4;
      const jQuatBase = j * 4;
      const [iQx, iQy, iQz, iQw] = normalizeQuat2(
        quaternions[iQuatBase] ?? 0,
        quaternions[iQuatBase + 1] ?? 0,
        quaternions[iQuatBase + 2] ?? 0,
        quaternions[iQuatBase + 3] ?? 1
      );
      const [jQx, jQy, jQz, jQw] = normalizeQuat2(
        quaternions[jQuatBase] ?? 0,
        quaternions[jQuatBase + 1] ?? 0,
        quaternions[jQuatBase + 2] ?? 0,
        quaternions[jQuatBase + 3] ?? 1
      );
      const armBase = p * 8;
      const [raX, raY, raZ] = rotateVecByQuat(
        iQx,
        iQy,
        iQz,
        iQw,
        arms[armBase] ?? 0,
        arms[armBase + 1] ?? 0,
        arms[armBase + 2] ?? 0
      );
      const [rbX, rbY, rbZ] = rotateVecByQuat(
        jQx,
        jQy,
        jQz,
        jQw,
        arms[armBase + 4] ?? 0,
        arms[armBase + 5] ?? 0,
        arms[armBase + 6] ?? 0
      );
      const pointAX = iPosX + raX;
      const pointAY = iPosY + raY;
      const pointAZ = iPosZ + raZ;
      const pointBX = jPosX + rbX;
      const pointBY = jPosY + rbY;
      const pointBZ = jPosZ + rbZ;
      points.push({
        x: 0.5 * (pointAX + pointBX),
        y: 0.5 * (pointAY + pointBY),
        z: 0.5 * (pointAZ + pointBZ)
      });
    }
    return points;
  }
  findSupportFloorBody(positions, shapes) {
    let floorBody = -1;
    let floorFootprint = -1;
    let floorCenterY = Number.POSITIVE_INFINITY;
    let floorTopY = Number.NEGATIVE_INFINITY;
    for (let body = 0; body < this.bodyCount; body++) {
      const base = body * 4;
      const inverseMass = positions[base + 3] ?? 0;
      if (inverseMass !== 0) continue;
      const centerY = positions[base + 1] ?? 0;
      const halfX = Math.max(0, shapes[base + 1] ?? 0);
      const halfY = Math.max(0, shapes[base + 2] ?? 0);
      const halfZ = Math.max(0, shapes[base + 3] ?? 0);
      const footprint = halfX * halfZ;
      const largerFootprint = footprint > floorFootprint * 1.05;
      const tieButLower = Math.abs(footprint - floorFootprint) <= 1e-6 && centerY < floorCenterY;
      if (floorBody < 0 || largerFootprint || tieButLower) {
        floorBody = body;
        floorFootprint = footprint;
        floorCenterY = centerY;
        floorTopY = centerY + halfY;
      }
    }
    return { body: floorBody, topY: floorTopY };
  }
  logSupportDiagnostics(renderer) {
    if (!this.debugBehaviorEnabled) return;
    if (!renderer || typeof renderer.getArrayBufferAsync !== "function") return;
    if (this.supportDebugReadbackInFlight) return;
    if (this.lastSupportDebugLogFrame >= 0 && this.frameId - this.lastSupportDebugLogFrame < this.supportDebugEveryNFrames) {
      return;
    }
    const sampledFrame = this.frameId;
    this.supportDebugReadbackInFlight = true;
    this.lastSupportDebugLogFrame = sampledFrame;
    Promise.all([
      renderer.getArrayBufferAsync(this.pairActivityAttr),
      renderer.getArrayBufferAsync(this.pairContactsAttr),
      renderer.getArrayBufferAsync(this.positionsAttr),
      renderer.getArrayBufferAsync(this.shapesAttr)
    ]).then(([activityRaw, pairContactsRaw, positionsRaw, shapesRaw]) => {
      const activity = new Uint32Array(activityRaw);
      const { meta } = decodePairContactViews(pairContactsRaw, this.maxPairContacts);
      const positions = new Float32Array(positionsRaw);
      const shapes = new Float32Array(shapesRaw);
      if (this.prevSupportBodyCount !== this.bodyCount) {
        this.prevSupportBodyCount = this.bodyCount;
        this.prevCandidatePairsForChurn = null;
        this.prevFloorCandidatePairsForChurn = null;
      }
      const { body: floorBody, topY: floorTopY } = this.findSupportFloorBody(positions, shapes);
      if (floorBody < 0) {
        this.prevCandidatePairsForChurn = null;
        this.prevFloorCandidatePairsForChurn = null;
        return;
      }
      const nearFloorDynamicBodies = /* @__PURE__ */ new Set();
      const nearFloorBand = 0.12;
      const lowerBand = -0.75;
      for (let body = 0; body < this.bodyCount; body++) {
        if (body === floorBody) continue;
        const base = body * 4;
        const inverseMass = positions[base + 3] ?? 0;
        if (inverseMass <= 0) continue;
        const centerY = positions[base + 1] ?? 0;
        const halfY = Math.max(0, shapes[base + 2] ?? 0);
        const bottomGap = centerY - halfY - floorTopY;
        if (bottomGap <= nearFloorBand && bottomGap >= lowerBand) {
          nearFloorDynamicBodies.add(body);
        }
      }
      const candidateSpan = Math.min(
        activity[this.pairCandidateIndicesOffset] ?? 0,
        this.maxCandidatePairs
      );
      const candidatePairs = /* @__PURE__ */ new Set();
      const floorCandidatePairs = /* @__PURE__ */ new Set();
      const floorCandidateBodies = /* @__PURE__ */ new Set();
      for (let slot = 0; slot < candidateSpan; slot++) {
        const packed = activity[this.pairCandidateIndicesOffset + 1 + slot] ?? 4294967295;
        const i = packed & 65535;
        const j = packed >>> 16;
        if (i >= j || j >= this.bodyCount) continue;
        candidatePairs.add(packed);
        if (i === floorBody || j === floorBody) {
          floorCandidatePairs.add(packed);
          floorCandidateBodies.add(i === floorBody ? j : i);
        }
      }
      const activeContactCount = Math.min(
        activity[this.pairActiveContactsOffset] ?? 0,
        this.maxActivePairContacts
      );
      const floorActiveBodies = /* @__PURE__ */ new Set();
      for (let idx = 0; idx < activeContactCount; idx++) {
        const contact = activity[this.pairActiveContactsOffset + 1 + idx] ?? this.maxPairContacts;
        if (contact >= this.maxPairContacts) continue;
        const metaBase = contact * 4;
        const i = Math.round(meta[metaBase] ?? -1);
        const j = Math.round(meta[metaBase + 1] ?? -1);
        if (i < 0 || j < 0 || i >= j || j >= this.bodyCount) continue;
        if (i === floorBody || j === floorBody) {
          floorActiveBodies.add(i === floorBody ? j : i);
        }
      }
      let candidateSupported = 0;
      let activeSupported = 0;
      for (const body of nearFloorDynamicBodies) {
        if (floorCandidateBodies.has(body)) candidateSupported++;
        if (floorActiveBodies.has(body)) activeSupported++;
      }
      const nearFloorCount = nearFloorDynamicBodies.size;
      const candidateRecall = nearFloorCount > 0 ? candidateSupported / nearFloorCount : 1;
      const activeRecall = nearFloorCount > 0 ? activeSupported / nearFloorCount : 1;
      const broadphaseLost = Math.max(0, nearFloorCount - candidateSupported);
      const contactRejected = Math.max(0, candidateSupported - activeSupported);
      const previousCandidate = this.prevCandidatePairsForChurn;
      const previousFloorCandidate = this.prevFloorCandidatePairsForChurn;
      let jaccard = 1;
      let added = 0;
      let removed = 0;
      if (previousCandidate) {
        let intersection = 0;
        for (const pair of candidatePairs) {
          if (previousCandidate.has(pair)) intersection++;
          else added++;
        }
        for (const pair of previousCandidate) {
          if (!candidatePairs.has(pair)) removed++;
        }
        const union = candidatePairs.size + previousCandidate.size - intersection;
        jaccard = union > 0 ? intersection / union : 1;
      }
      let floorJaccard = 1;
      if (previousFloorCandidate) {
        let floorIntersection = 0;
        for (const pair of floorCandidatePairs) {
          if (previousFloorCandidate.has(pair)) floorIntersection++;
        }
        const floorUnion = floorCandidatePairs.size + previousFloorCandidate.size - floorIntersection;
        floorJaccard = floorUnion > 0 ? floorIntersection / floorUnion : 1;
      }
      this.prevCandidatePairsForChurn = candidatePairs;
      this.prevFloorCandidatePairsForChurn = floorCandidatePairs;
      console.info(
        `[Support Debug] frame=${sampledFrame} floor=${floorBody} nearFloor=${nearFloorCount} candSupport=${candidateSupported}(${(100 * candidateRecall).toFixed(1)}%) activeSupport=${activeSupported}(${(100 * activeRecall).toFixed(1)}%) broadphaseLost=${broadphaseLost} contactRejected=${contactRejected} pairs=${candidatePairs.size} floorPairs=${floorCandidatePairs.size} jaccard=${jaccard.toFixed(3)} floorJaccard=${floorJaccard.toFixed(3)} added=${added} removed=${removed}`
      );
    }).catch((error) => {
      console.warn("Support debug readback failed:", error);
    }).finally(() => {
      this.supportDebugReadbackInFlight = false;
    });
  }
};

// structural-material-arch-gpu-engine.js
var ENGINE_REVISION = "96b043c88dc2a4af5367820caf1e1e9f458d5560";
var ENGINE_PATCH = "kaminos-fixed-joint-rest-relative-v1";
var ArchGpuEngine = class extends PhysicsEngine {
  getStats() {
    return { ...this.stats };
  }
  getResidentAttributes() {
    if (!this.initialized) throw new Error("GPU engine has not been initialized");
    return {
      positions: this.positionsAttr,
      quaternions: this.quaternionsAttr,
      velocities: this.velocitiesAttr,
      angularVelocities: this.angularVelAttr,
      joints: this.jointRecordsAttr,
      springs: this.springRecordsAttr
    };
  }
  setInitialJointActive(index, active) {
    if (this.initialized) throw new Error("Initial joint edits cannot overwrite resident state");
    if (!Number.isInteger(index) || index < 0 || index >= this.jointCount) throw new Error("Invalid joint index");
    new Uint32Array(this.jointRecordsData.buffer)[index * 44 + 3] = active ? 1 : 0;
  }
  setGravity(gravity) {
    if (!Array.isArray(gravity) || gravity.length !== 3 || gravity.some((value) => !Number.isFinite(value))) throw new Error("Gravity requires three finite components");
    if (this.initialized) {
      const uniform2 = this.integration?.kernel?.computeNode?.parameters?.gravity;
      if (!uniform2?.value?.isVector3) throw new Error("Pinned integration gravity uniform is unavailable");
      uniform2.value.set(...gravity);
    }
    this.config.gravity = [...gravity];
  }
  getGravity() {
    if (!this.initialized) return [...this.config.gravity];
    const uniform2 = this.integration?.kernel?.computeNode?.parameters?.gravity;
    if (!uniform2?.value?.isVector3) throw new Error("Pinned integration gravity uniform is unavailable");
    return uniform2.value.toArray();
  }
};
async function createNativeGpuRenderer(canvas) {
  const { WebGPURenderer } = await import("three/webgpu");
  if (!navigator.gpu) throw new Error("WebGPU is unavailable; no CPU fallback is permitted");
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter || (adapter.info?.isFallbackAdapter ?? adapter.isFallbackAdapter) !== false) throw new Error("A verified native WebGPU adapter is required");
  const info = adapter.info;
  const identity = Object.fromEntries(["vendor", "architecture", "device", "description", "backend", "type", "isFallbackAdapter"].map((key) => [key, info?.[key] ?? null]));
  if (/swiftshader|llvmpipe|software/i.test(JSON.stringify(identity))) throw new Error("Software adapter rejected");
  const device = await adapter.requestDevice({ requiredLimits: { maxStorageBuffersPerShaderStage: adapter.limits.maxStorageBuffersPerShaderStage } });
  const renderer = new WebGPURenderer({ canvas, device, antialias: true });
  await renderer.init();
  if (!renderer.backend.isWebGPUBackend) throw new Error("WebGL fallback rejected");
  return { renderer, device, identity: { ...identity, engineRevision: ENGINE_REVISION, enginePatch: ENGINE_PATCH, backend: "webgpu", adapterFallback: false } };
}
export {
  ArchGpuEngine,
  ENGINE_PATCH,
  ENGINE_REVISION,
  createNativeGpuRenderer
};
//# sourceMappingURL=structural-material-arch-gpu-engine.js.map
