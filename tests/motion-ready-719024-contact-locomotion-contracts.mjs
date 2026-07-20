#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as creatureCore from '../motion-ready-719024-core.js';

const root = new URL('../', import.meta.url);
const CAST_HASH = '8fed20d958ef48797c14ad1d3846a50eae05d43e6ae67f8805060b02f1abde8e';
const REGISTRATION_HASH = 'cb519913ad863441e88555b3d9fbd588ffef03650475de07c29ee1c71f500ff6';

for (const exportName of [
  'deriveCrawlerContactAtlas',
  'validateCrawlerContactAtlas',
  'createCrawlerContactKinematics',
  'applyCrawlerContactPatchDeformation',
  'sampleCrawlerContactPatches',
  'createCrawlerContactLocomotionState',
  'stepCrawlerContactLocomotion',
]) {
  assert.equal(typeof creatureCore[exportName], 'function', `${exportName} must be exported`);
}

function readGlbPositionAccessor(bytes) {
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8').replace(/\0+$/, ''));
  let binaryOffset = 20 + jsonLength;
  while (binaryOffset % 4) binaryOffset++;
  const binaryLength = bytes.readUInt32LE(binaryOffset);
  const binary = bytes.subarray(binaryOffset + 8, binaryOffset + 8 + binaryLength);
  const primitive = json.meshes[0].primitives[0];
  const accessor = json.accessors[primitive.attributes.POSITION];
  const view = json.bufferViews[accessor.bufferView];
  const stride = view.byteStride || 12;
  const start = (view.byteOffset || 0) + (accessor.byteOffset || 0);
  const positions = new Float32Array(accessor.count * 3);
  for (let vertex = 0; vertex < accessor.count; vertex++) {
    const source = start + vertex * stride;
    positions[vertex * 3] = binary.readFloatLE(source);
    positions[vertex * 3 + 1] = binary.readFloatLE(source + 4);
    positions[vertex * 3 + 2] = binary.readFloatLE(source + 8);
  }
  return positions;
}

const registration = creatureCore.validateAxialCrawlerRegistration(JSON.parse(
  await readFile(new URL('artifacts/motion-ready-719024/registration.json', root), 'utf8'),
));
const originalPositions = readGlbPositionAccessor(
  await readFile(new URL('artifacts/motion-ready-719024/creature.glb', root)),
);
const sourceIdentity = {
  castId: creatureCore.MOTION_READY_719024_CAST_ID,
  castHash: CAST_HASH,
  registrationHash: REGISTRATION_HASH,
};
const derived = creatureCore.deriveCrawlerContactAtlas(originalPositions, registration, sourceIdentity);
assert.equal(derived.schema, 'kaminos.creature-contact-atlas.v0');
assert.equal(derived.motionClass, 'elongated-crawler');
assert.deepEqual(derived.patches.map(patch => patch.id), [
  'front-left',
  'front-right',
  'rear-left',
  'rear-right',
]);
assert.ok(derived.patches.every(patch => patch.vertexIndices.length >= 120));
assert.ok(derived.patches.every(patch => patch.vertexIndices.length === patch.weights.length));
assert.ok(derived.patches.every(patch => Math.abs(patch.weights.reduce((sum, value) => sum + value, 0) - 1) < 1e-6));
for (const patch of derived.patches) {
  assert.equal(Math.sign(patch.restCentroid[0]), patch.side === 'left' ? 1 : -1);
  assert.equal(Math.sign(patch.restCentroid[2]), patch.axialRegion === 'front' ? -1 : 1);
  assert.ok(patch.restCentroid[1] < registration.contactPlaneY + 0.02);
}

const persisted = JSON.parse(await readFile(
  new URL('artifacts/motion-ready-719024/contact-atlas.json', root),
  'utf8',
));
const atlas = creatureCore.validateCrawlerContactAtlas(persisted, {
  ...sourceIdentity,
  vertexCount: originalPositions.length / 3,
});
assert.deepEqual(atlas.patches.map(patch => patch.restCentroid), derived.patches.map(patch => patch.restCentroid));
assert.throws(
  () => creatureCore.validateCrawlerContactAtlas(atlas, { ...sourceIdentity, castHash: 'tampered', vertexCount: originalPositions.length / 3 }),
  /cast hash mismatch/,
);
assert.throws(
  () => creatureCore.validateCrawlerContactAtlas(atlas, { ...sourceIdentity, registrationHash: 'tampered', vertexCount: originalPositions.length / 3 }),
  /registration hash mismatch/,
);
const mutableValidatedAtlas = creatureCore.validateCrawlerContactAtlas(structuredClone(persisted), {
  ...sourceIdentity,
  vertexCount: originalPositions.length / 3,
});
assert.throws(
  () => { mutableValidatedAtlas.patches[0].id = 'wrong-patch'; },
  /read only|Cannot assign/,
  'validated atlas structure must not become mutable trusted state',
);
assert.equal(
  creatureCore.validateCrawlerContactAtlas(mutableValidatedAtlas, {
    ...sourceIdentity,
    vertexCount: originalPositions.length / 3,
  }),
  mutableValidatedAtlas,
);

const deformed = new Float32Array(originalPositions);
const kinematics = creatureCore.createCrawlerContactKinematics(atlas, Math.PI * 0.76, {
  coupling: 1,
  scale: 1.14,
});
assert.ok(kinematics.patches.some(patch => patch.state === 'stance'));
assert.ok(kinematics.patches.some(patch => patch.state === 'swing'));
assert.ok(kinematics.patches.some(patch => patch.localOffset[1] > 0.01), 'swing must clear terrain');
creatureCore.applyCrawlerContactPatchDeformation(atlas, kinematics, deformed);
assert.ok(deformed.some((value, index) => Math.abs(value - originalPositions[index]) > 1e-5));

const flatTerrain = {
  grid: { columns: 9, rows: 9 },
  worldBounds: { x: { min: -2, max: 2 }, z: { min: -2, max: 2 } },
  channels: { height: { values: new Array(81).fill(0) } },
};
const rootPosition = [0, -registration.contactPlaneY * 1.14, 0];
const sampled = creatureCore.sampleCrawlerContactPatches(atlas, deformed, flatTerrain, {
  rootPosition,
  scale: 1.14,
  locomotionFrame: { forward: [0, 0, -1], right: [1, 0, 0], up: [0, 1, 0] },
});
assert.equal(sampled.schema, 'kaminos.crawler-contact-samples.v0');
assert.equal(sampled.patches.length, 4);
assert.ok(sampled.patches.every(patch => patch.worldPosition.every(Number.isFinite)));
assert.ok(sampled.patches.every(patch => patch.terrainNormal.every(Number.isFinite)));
assert.ok(sampled.patches.some(patch => patch.terrainDistance > 0.01), 'swing sample must leave terrain');

let crossSlopeSupport = creatureCore.createCrawlerContactLocomotionState(atlas);
for (let step = 0; step < 8; step++) {
  const priorSupportOffsets = new Map(crossSlopeSupport.patches.map(patch => [patch.id, patch.supportOffset]));
  crossSlopeSupport = creatureCore.stepCrawlerContactLocomotion(crossSlopeSupport, {
    deltaSeconds: 1 / 60,
    desiredDistance: 0,
    desiredSpeed: 0,
    railLength: 1,
    locomotorPhase: 0,
    locomotionFrame: { forward: [0, 0, -1], right: [1, 0, 0], up: [0, 1, 0] },
    contactSamples: {
      schema: 'kaminos.crawler-contact-samples.v0',
      patches: atlas.patches.map(patch => ({
        id: patch.id,
        worldPosition: [
          patch.restCentroid[0],
          patch.restCentroid[1] + priorSupportOffsets.get(patch.id) * 1.14,
          patch.restCentroid[2],
        ],
        terrainPosition: [patch.restCentroid[0], patch.restCentroid[1] - 0.055, patch.restCentroid[2]],
        terrainNormal: [0, 1, 0],
        terrainDistance: 0.055 + priorSupportOffsets.get(patch.id) * 1.14,
        inBounds: true,
      })),
    },
    scale: 1.14,
    coupling: 1,
  });
}
const supportedFrontLeft = crossSlopeSupport.patches.find(patch => patch.id === 'front-left');
assert.ok(supportedFrontLeft.supportOffset < -0.015, 'cross-slope stance must extend toward terrain');
assert.equal(supportedFrontLeft.state, 'stance', 'bounded support extension must permit a high-side patch to plant');
assert.ok(supportedFrontLeft.metrics.plantCount >= 1, 'per-patch plant evidence must survive aggregation');
const uncoupledTransition = creatureCore.stepCrawlerContactLocomotion(crossSlopeSupport, {
  deltaSeconds: 1 / 60,
  desiredDistance: 0,
  desiredSpeed: 0,
  railLength: 1,
  locomotorPhase: 0,
  locomotionFrame: { forward: [0, 0, -1], right: [1, 0, 0], up: [0, 1, 0] },
  contactSamples: {
    schema: 'kaminos.crawler-contact-samples.v0',
    patches: atlas.patches.map(patch => ({
      id: patch.id,
      worldPosition: [...patch.restCentroid],
      terrainPosition: [patch.restCentroid[0], patch.restCentroid[1] - 0.055, patch.restCentroid[2]],
      terrainNormal: [0, 1, 0],
      terrainDistance: 0.055,
      inBounds: true,
    })),
  },
  scale: 1.14,
  coupling: 0,
});
assert.ok(uncoupledTransition.patches.every(patch => patch.supportOffset === 0));
assert.ok(uncoupledTransition.patches.every(patch => patch.supportTarget === 0));
const uncoupledTransitionKinematics = creatureCore.createCrawlerContactKinematics(atlas, 0, {
  coupling: 0,
  scale: 1.14,
  supportOffsets: new Map(uncoupledTransition.patches.map(patch => [patch.id, patch.supportOffset])),
});
assert.ok(uncoupledTransitionKinematics.patches.every(patch => patch.localOffset.every(offset => offset === 0)));

let uncoupled = creatureCore.createCrawlerContactLocomotionState(atlas);
let coupled = creatureCore.createCrawlerContactLocomotionState(atlas);
const seenStates = new Map(atlas.patches.map(patch => [patch.id, new Set()]));
const stepSeconds = 1 / 60;
for (let step = 0; step < 360; step++) {
  const desiredDistance = step * 0.006;
  const phase = step / 360 * Math.PI * 8;
  const frame = { forward: [0, 0, -1], right: [1, 0, 0], up: [0, 1, 0] };
  const contactSamplesFor = coupling => {
    const contactKinematics = creatureCore.createCrawlerContactKinematics(atlas, phase, { coupling });
    return {
      schema: 'kaminos.crawler-contact-samples.v0',
      patches: atlas.patches.map((patch, index) => ({
        id: patch.id,
        worldPosition: [
          patch.restCentroid[0],
          contactKinematics.patches[index].localOffset[1],
          patch.restCentroid[2] - desiredDistance * (1 + index * 0.015)
            + contactKinematics.patches[index].localOffset[2],
        ],
        terrainPosition: [patch.restCentroid[0], 0, patch.restCentroid[2] - desiredDistance * (1 + index * 0.015)],
        terrainNormal: [0, 1, 0],
        terrainDistance: contactKinematics.patches[index].localOffset[1] + 0.004,
        inBounds: true,
      })),
    };
  };
  uncoupled = creatureCore.stepCrawlerContactLocomotion(uncoupled, {
    deltaSeconds: stepSeconds,
    desiredDistance,
    desiredSpeed: 0.36,
    railLength: 3,
    locomotorPhase: phase,
    locomotionFrame: frame,
    contactSamples: contactSamplesFor(0),
    coupling: 0,
  });
  coupled = creatureCore.stepCrawlerContactLocomotion(coupled, {
    deltaSeconds: stepSeconds,
    desiredDistance,
    desiredSpeed: 0.36,
    railLength: 3,
    locomotorPhase: phase,
    locomotionFrame: frame,
    contactSamples: contactSamplesFor(1),
    coupling: 1,
  });
  for (const patch of coupled.patches) seenStates.get(patch.id).add(patch.state);
}
assert.ok(coupled.routeDistance > 0.5, 'traction-governed locomotion must make material progress');
assert.ok(coupled.routeDistance <= 3);
assert.ok(Math.abs(coupled.routeSpeed) <= coupled.limits.maximumSpeed + 1e-8);
assert.ok(Math.abs(coupled.acceleration) <= coupled.limits.maximumAcceleration + 1e-8);
assert.ok(Math.abs(coupled.jerk) <= coupled.limits.maximumJerk + 1e-8);
assert.ok(coupled.metrics.plantCount >= 4);
assert.ok(coupled.metrics.releaseCount >= 4);
assert.ok(coupled.metrics.maximumSwingClearance > 0.01);
assert.ok(
  coupled.metrics.meanStanceSlip < uncoupled.metrics.meanStanceSlip * 0.8,
  `coupling must materially reduce stance slip (${coupled.metrics.meanStanceSlip} vs ${uncoupled.metrics.meanStanceSlip})`,
);
for (const [id, states] of seenStates) {
  assert.ok(states.has('stance'), `${id} never planted`);
  assert.ok(states.has('release'), `${id} never released`);
  assert.ok(states.has('swing'), `${id} never swung`);
}

console.log('motion-ready-719024 contact locomotion contracts passed');
