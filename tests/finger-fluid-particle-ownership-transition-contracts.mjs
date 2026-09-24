import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as fingerFluidCore from '../finger-fluid-webgpu-core.js';
import {
  KAMINOS_FINGER_FLUID_PARTICLE_OWNERSHIP_CONTACT_THRESHOLD,
  KAMINOS_FINGER_FLUID_PARTICLE_OWNERSHIP_CONTRACT,
  KAMINOS_FINGER_FLUID_PARTICLE_OWNERSHIP_PACKING,
  KAMINOS_FINGER_FLUID_PARTICLE_OWNERSHIP_STATES,
  advanceFingerFluidParticleOwnershipState,
} from '../finger-fluid-webgpu-core.js';

const source = readFileSync(new URL('../finger-fluid-webgpu-core.js', import.meta.url), 'utf8');

assert.equal(
  KAMINOS_FINGER_FLUID_PARTICLE_OWNERSHIP_CONTRACT,
  'gpu-spatial-first-support-contact-ownership-v0',
);
assert.equal(
  KAMINOS_FINGER_FLUID_PARTICLE_OWNERSHIP_PACKING,
  'material-tracer-vec4-index-4-phase-source-generation-transition-frame-support-contact-v0',
);
assert.deepEqual(KAMINOS_FINGER_FLUID_PARTICLE_OWNERSHIP_STATES, {
  dormant: 0,
  preImpact: 1,
  postImpact: 2,
});
assert.equal(KAMINOS_FINGER_FLUID_PARTICLE_OWNERSHIP_CONTACT_THRESHOLD, 0.5);
assert.equal(
  typeof fingerFluidCore.createFingerFluidInitialParticleOwnershipState,
  'function',
  'frame-zero ownership must be governed by a pure semantic initializer',
);
assert.deepEqual(
  fingerFluidCore.createFingerFluidInitialParticleOwnershipState({
    active: true,
    sourceOwned: true,
    sourceGeneration: 7,
  }),
  {
    phase: KAMINOS_FINGER_FLUID_PARTICLE_OWNERSHIP_STATES.preImpact,
    sourceGeneration: 7,
    transitionFrame: 0,
    supportContact: 0,
  },
  'carrier-backed particles must begin pre-impact',
);
assert.deepEqual(
  fingerFluidCore.createFingerFluidInitialParticleOwnershipState({
    active: true,
    sourceOwned: false,
    sourceGeneration: 0,
  }),
  {
    phase: KAMINOS_FINGER_FLUID_PARTICLE_OWNERSHIP_STATES.postImpact,
    sourceGeneration: 0,
    transitionFrame: 0,
    supportContact: KAMINOS_FINGER_FLUID_PARTICLE_OWNERSHIP_CONTACT_THRESHOLD,
  },
  'particle-owned synthetic snapshots must carry an explicit frame-zero contact receipt',
);
assert.deepEqual(
  fingerFluidCore.createFingerFluidInitialParticleOwnershipState({
    active: false,
    sourceOwned: true,
    sourceGeneration: 7,
  }),
  {
    phase: KAMINOS_FINGER_FLUID_PARTICLE_OWNERSHIP_STATES.dormant,
    sourceGeneration: 7,
    transitionFrame: 0,
    supportContact: 0,
  },
  'inactive inventory must initialize dormant without stale contact',
);

const preImpact = {
  phase: KAMINOS_FINGER_FLUID_PARTICLE_OWNERSHIP_STATES.preImpact,
  sourceGeneration: 7,
  transitionFrame: 0,
  supportContact: 0,
};
assert.deepEqual(
  advanceFingerFluidParticleOwnershipState(preImpact, {
    active: true,
    supportContact: 0.49,
    frameIndex: 91,
  }),
  preImpact,
  'particle age and elapsed frames cannot impersonate spatial support contact',
);
assert.deepEqual(
  advanceFingerFluidParticleOwnershipState(preImpact, {
    active: true,
    supportContact: 0.5,
    frameIndex: 92,
  }),
  {
    phase: KAMINOS_FINGER_FLUID_PARTICLE_OWNERSHIP_STATES.postImpact,
    sourceGeneration: 7,
    transitionFrame: 92,
    supportContact: 0.5,
  },
  'the first canonical support contact must transfer optical ownership to particles',
);
assert.deepEqual(
  advanceFingerFluidParticleOwnershipState({
    phase: KAMINOS_FINGER_FLUID_PARTICLE_OWNERSHIP_STATES.postImpact,
    sourceGeneration: 7,
    transitionFrame: 92,
    supportContact: 0.5,
  }, {
    active: true,
    supportContact: 0.1,
    frameIndex: 108,
  }),
  {
    phase: KAMINOS_FINGER_FLUID_PARTICLE_OWNERSHIP_STATES.postImpact,
    sourceGeneration: 7,
    transitionFrame: 92,
    supportContact: 0.5,
  },
  'post-impact ownership must remain monotonic after a particle leaves support',
);
assert.deepEqual(
  advanceFingerFluidParticleOwnershipState(preImpact, {
    active: false,
    supportContact: 1,
    frameIndex: 93,
  }),
  {
    phase: KAMINOS_FINGER_FLUID_PARTICLE_OWNERSHIP_STATES.dormant,
    sourceGeneration: 7,
    transitionFrame: 0,
    supportContact: 0,
  },
  'recycled inventory must not retain a stale post-impact transition',
);

assert.match(
  source,
  /const MATERIAL_TRACER_FLOATS = 20;/,
  'the shared tracer allocation must include one ownership-transition vec4',
);
const tracerStructs = [...source.matchAll(/struct MaterialTracerState \{([\s\S]*?)\n\}/g)];
assert.equal(tracerStructs.length, 3, 'compute and both renderer ABIs must share one tracer stride');
for (const [, tracerStruct] of tracerStructs) {
  assert.match(
    tracerStruct,
    /ownershipTransitionState:\s*vec4<f32>/,
    'every material-tracer ABI must expose per-particle ownership',
  );
}

const predictStart = source.indexOf('fn predict_positions(');
const predictEnd = source.indexOf('\n@compute', predictStart + 1);
const predictSource = source.slice(predictStart, predictEnd);
assert.match(
  predictSource,
  /reset_particle_ownership_for_release\(index,\s*liveInletScene\)/,
  'each physical source release must begin a fresh pre-impact ownership epoch',
);
assert.match(
  predictSource,
  /mark_particle_ownership_dormant\(index\)/,
  'recycled particles must leave no stale particle-owned optical state',
);
const playgroundRecycleStart = predictSource.indexOf('if (recyclePlaygroundSource) {');
const playgroundRecycleEnd = predictSource.indexOf('\n  var velocity = particle.velocity.xyz;', playgroundRecycleStart);
assert.notEqual(playgroundRecycleStart, -1, 'the playground source recycle branch must remain explicit');
assert.notEqual(playgroundRecycleEnd, -1, 'the playground source recycle branch must have a bounded source slice');
const playgroundRecycleSource = predictSource.slice(playgroundRecycleStart, playgroundRecycleEnd);
assert.match(
  playgroundRecycleSource,
  /reset_particle_ownership_for_release\(index,\s*false\)/,
  'playground source recirculation must establish a fresh pre-impact ownership epoch',
);

const velocityStart = source.indexOf('fn compute_velocity_viscosity(');
const velocityEnd = source.indexOf('\n@compute', velocityStart + 1);
const velocitySource = source.slice(velocityStart, velocityEnd);
assert.match(
  velocitySource,
  /transition_particle_ownership_on_support_contact\(index,\s*supportContact\)/,
  'the post-projection support-contact pass must author the ownership transition',
);
assert.doesNotMatch(
  velocitySource,
  /liveInletAgeState|liveAge/,
  'support ownership must remain independent of live-inlet residence age',
);

const ownershipTransitionStart = source.indexOf('fn transition_particle_ownership_on_support_contact(');
const ownershipTransitionEnd = source.indexOf('\n}', ownershipTransitionStart) + 2;
const ownershipTransitionSource = source.slice(ownershipTransitionStart, ownershipTransitionEnd);
assert.match(
  ownershipTransitionSource,
  /supportContact >= 0\.5/,
  'the GPU transition must use the published support-contact threshold',
);
assert.match(
  ownershipTransitionSource,
  /ownershipTransitionState\.x == 1\.0/,
  'only a pre-impact particle may author a first-contact transition',
);
assert.doesNotMatch(
  ownershipTransitionSource,
  /liveInletAgeState|liveAge/,
  'the ownership transition helper cannot regress to age-based visibility',
);

const adaptiveStart = source.indexOf('fn adaptive_refine_or_merge(');
const adaptiveEnd = source.indexOf('\n@compute', adaptiveStart + 1);
const adaptiveSource = source.slice(adaptiveStart, adaptiveEnd);
assert.match(
  adaptiveSource,
  /materialTracers\[childIndex\] = materialTracers\[index\]/,
  'adaptive split children must inherit the exact ownership epoch',
);
assert.match(
  adaptiveSource,
  /merge_particle_ownership_state\(/,
  'adaptive merge must preserve monotonic post-impact ownership',
);
assert.match(
  adaptiveSource,
  /materialTracers\[childIndex\]\.ownershipTransitionState = vec4<f32>\(0\.0\)/,
  'merged dormant children must clear stale ownership',
);
assert.equal(
  typeof fingerFluidCore.mergeFingerFluidParticleOwnershipStates,
  'function',
  'adaptive ownership merge must expose a semantic host oracle',
);
assert.deepEqual(
  fingerFluidCore.mergeFingerFluidParticleOwnershipStates(
    {
      phase: KAMINOS_FINGER_FLUID_PARTICLE_OWNERSHIP_STATES.postImpact,
      sourceGeneration: 7,
      transitionFrame: 0,
      supportContact: 0.5,
    },
    {
      phase: KAMINOS_FINGER_FLUID_PARTICLE_OWNERSHIP_STATES.postImpact,
      sourceGeneration: 7,
      transitionFrame: 9,
      supportContact: 0.7,
    },
  ),
  {
    phase: KAMINOS_FINGER_FLUID_PARTICLE_OWNERSHIP_STATES.postImpact,
    sourceGeneration: 7,
    transitionFrame: 0,
    supportContact: 0.5,
  },
  'adaptive merge must preserve a lawful frame-zero first contact',
);
assert.deepEqual(
  fingerFluidCore.mergeFingerFluidParticleOwnershipStates(
    {
      phase: KAMINOS_FINGER_FLUID_PARTICLE_OWNERSHIP_STATES.postImpact,
      sourceGeneration: 7,
      transitionFrame: 0,
      supportContact: 0.5,
    },
    {
      phase: KAMINOS_FINGER_FLUID_PARTICLE_OWNERSHIP_STATES.postImpact,
      sourceGeneration: 8,
      transitionFrame: 9,
      supportContact: 0.7,
    },
  ),
  {
    phase: KAMINOS_FINGER_FLUID_PARTICLE_OWNERSHIP_STATES.postImpact,
    sourceGeneration: 7,
    transitionFrame: 0,
    supportContact: 0.5,
  },
  'a later source generation cannot erase an earlier lawful first-contact frame during merge',
);

assert.match(
  source,
  /particleOwnership:\s*\{\s*contract:\s*KAMINOS_FINGER_FLUID_PARTICLE_OWNERSHIP_CONTRACT/,
  'diagnostics must publish the effective ownership contract and population counts',
);
assert.match(
  source,
  /function getParticleOwnershipDescriptor\(\)/,
  'the solver must provide optics an explicit GPU buffer descriptor instead of requiring ABI inference',
);
assert.match(
  source,
  /ownershipOffsetBytes:\s*16 \* Float32Array\.BYTES_PER_ELEMENT/,
  'the descriptor must publish the exact ownership vec4 offset within each tracer record',
);
assert.match(
  source,
  /getParticleOwnershipDescriptor,/,
  'the public solver API must expose the ownership descriptor to its optical consumer',
);
assert.equal(
  typeof fingerFluidCore.classifyFingerFluidParticleOwnershipRecord,
  'function',
  'diagnostics must expose a pure ownership-record validity oracle',
);
const validOwnershipRecords = [
  {
    active: false,
    state: { phase: 0, sourceGeneration: 7, transitionFrame: 0, supportContact: 0 },
  },
  {
    active: true,
    state: { phase: 1, sourceGeneration: 7, transitionFrame: 0, supportContact: 0 },
  },
  {
    active: true,
    state: { phase: 2, sourceGeneration: 7, transitionFrame: 0, supportContact: 0.5 },
  },
];
for (const record of validOwnershipRecords) {
  assert.deepEqual(
    fingerFluidCore.classifyFingerFluidParticleOwnershipRecord(record.state, {
      active: record.active,
    }),
    { valid: true, phase: record.state.phase, reason: null },
  );
}
const invalidOwnershipRecords = [
  { active: false, state: { phase: null, sourceGeneration: 7, transitionFrame: 0, supportContact: 0 } },
  { active: false, state: { phase: 0, sourceGeneration: null, transitionFrame: 0, supportContact: 0 } },
  { active: false, state: { phase: 0, sourceGeneration: 7, transitionFrame: null, supportContact: 0 } },
  { active: false, state: { phase: 0, sourceGeneration: 7, transitionFrame: 0, supportContact: null } },
  { active: false, state: { phase: -0.4, sourceGeneration: 7, transitionFrame: 0, supportContact: 0 } },
  { active: false, state: { phase: 0.49, sourceGeneration: 7, transitionFrame: 0, supportContact: 0 } },
  { active: true, state: { phase: 1.49, sourceGeneration: 7, transitionFrame: 0, supportContact: 0 } },
  { active: true, state: { phase: 2.49, sourceGeneration: 7, transitionFrame: 0, supportContact: 0.5 } },
  { active: true, state: { phase: 1, sourceGeneration: -1, transitionFrame: 0, supportContact: 0 } },
  { active: true, state: { phase: 1, sourceGeneration: 1.5, transitionFrame: 0, supportContact: 0 } },
  { active: true, state: { phase: 1, sourceGeneration: 7, transitionFrame: -1, supportContact: 0 } },
  { active: true, state: { phase: 1, sourceGeneration: 7, transitionFrame: 1.5, supportContact: 0 } },
  { active: true, state: { phase: 1, sourceGeneration: 7, transitionFrame: 0, supportContact: -0.1 } },
  { active: true, state: { phase: 1, sourceGeneration: 7, transitionFrame: 0, supportContact: 1.1 } },
  { active: true, state: { phase: 0, sourceGeneration: 7, transitionFrame: 0, supportContact: 0 } },
  { active: false, state: { phase: 1, sourceGeneration: 7, transitionFrame: 0, supportContact: 0 } },
  { active: false, state: { phase: 2, sourceGeneration: 7, transitionFrame: 9, supportContact: 0.5 } },
  { active: false, state: { phase: 0, sourceGeneration: 7, transitionFrame: 9, supportContact: 0.5 } },
  { active: true, state: { phase: 1, sourceGeneration: 7, transitionFrame: 9, supportContact: 0.5 } },
  { active: true, state: { phase: 2, sourceGeneration: 7, transitionFrame: 9, supportContact: 0.49 } },
];
for (const record of invalidOwnershipRecords) {
  assert.equal(
    fingerFluidCore.classifyFingerFluidParticleOwnershipRecord(record.state, {
      active: record.active,
    }).valid,
    false,
    `malformed ownership record must fail loud: ${JSON.stringify(record)}`,
  );
}
