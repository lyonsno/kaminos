#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as creatureCore from '../motion-ready-719024-core.js';

const root = new URL('../', import.meta.url);
const CAST_HASH = '8fed20d958ef48797c14ad1d3846a50eae05d43e6ae67f8805060b02f1abde8e';
const REGISTRATION_HASH = 'cb519913ad863441e88555b3d9fbd588ffef03650475de07c29ee1c71f500ff6';

for (const exportName of [
  'deriveCrawlerContactCarriers',
  'validateCrawlerContactCarriers',
  'applyCrawlerContactCarrierDeformation',
]) {
  assert.equal(typeof creatureCore[exportName], 'function', `${exportName} must be exported`);
}

function readAccessor(json, binary, accessorIndex) {
  const accessor = json.accessors[accessorIndex];
  const view = json.bufferViews[accessor.bufferView];
  const componentBytes = accessor.componentType === 5125 ? 4 : accessor.componentType === 5123 ? 2 : 4;
  const components = accessor.type === 'VEC3' ? 3 : 1;
  const stride = view.byteStride || componentBytes * components;
  const start = (view.byteOffset || 0) + (accessor.byteOffset || 0);
  const values = new (accessor.componentType === 5125 ? Uint32Array : accessor.componentType === 5123 ? Uint16Array : Float32Array)(accessor.count * components);
  for (let item = 0; item < accessor.count; item++) {
    for (let component = 0; component < components; component++) {
      const source = start + item * stride + component * componentBytes;
      values[item * components + component] = accessor.componentType === 5125
        ? binary.readUInt32LE(source)
        : accessor.componentType === 5123
          ? binary.readUInt16LE(source)
          : binary.readFloatLE(source);
    }
  }
  return values;
}

function readGlbMesh(bytes) {
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8').replace(/\0+$/, ''));
  let binaryOffset = 20 + jsonLength;
  while (binaryOffset % 4) binaryOffset++;
  const binaryLength = bytes.readUInt32LE(binaryOffset);
  const binary = bytes.subarray(binaryOffset + 8, binaryOffset + 8 + binaryLength);
  const primitive = json.meshes[0].primitives[0];
  return {
    positions: readAccessor(json, binary, primitive.attributes.POSITION),
    triangleIndices: readAccessor(json, binary, primitive.indices),
  };
}

function maxInternalEdgeStrain(original, deformed, vertexIndices, triangleIndices) {
  const included = new Set(vertexIndices);
  let maximum = 0;
  let edgeCount = 0;
  for (let index = 0; index < triangleIndices.length; index += 3) {
    const triangle = [triangleIndices[index], triangleIndices[index + 1], triangleIndices[index + 2]];
    for (const [a, b] of [[triangle[0], triangle[1]], [triangle[1], triangle[2]], [triangle[2], triangle[0]]]) {
      if (!included.has(a) || !included.has(b)) continue;
      const originalLength = Math.hypot(
        original[a * 3] - original[b * 3],
        original[a * 3 + 1] - original[b * 3 + 1],
        original[a * 3 + 2] - original[b * 3 + 2],
      );
      const deformedLength = Math.hypot(
        deformed[a * 3] - deformed[b * 3],
        deformed[a * 3 + 1] - deformed[b * 3 + 1],
        deformed[a * 3 + 2] - deformed[b * 3 + 2],
      );
      maximum = Math.max(maximum, Math.abs(deformedLength - originalLength) / Math.max(originalLength, 1e-8));
      edgeCount++;
    }
  }
  assert.ok(edgeCount > 0, 'carrier must contain connected triangle edges');
  return maximum;
}

const { positions, triangleIndices } = readGlbMesh(
  await readFile(new URL('artifacts/motion-ready-719024/creature.glb', root)),
);
const sourceIdentity = {
  castId: creatureCore.MOTION_READY_719024_CAST_ID,
  castHash: CAST_HASH,
  registrationHash: REGISTRATION_HASH,
};
const atlas = creatureCore.validateCrawlerContactAtlas(JSON.parse(await readFile(
  new URL('artifacts/motion-ready-719024/contact-atlas.json', root),
  'utf8',
)), { ...sourceIdentity, vertexCount: positions.length / 3 });
const derived = creatureCore.deriveCrawlerContactCarriers(positions, triangleIndices, atlas, sourceIdentity);
assert.equal(derived.schema, 'kaminos.creature-contact-carriers.v0');
assert.equal(derived.authority, 'exact-cast-consumer-derived-topology-v0');
assert.equal(derived.patches.length, 4);
assert.ok(derived.patches.every(patch => patch.carrierVertexIndices.length >= patch.vertexIndices.length));
assert.ok(derived.patches.every(patch => patch.collarVertexIndices.length === patch.collarWeights.length));
assert.ok(derived.patches.every(patch => patch.carrierComponentCount > 0));

const persisted = creatureCore.validateCrawlerContactCarriers(JSON.parse(await readFile(
  new URL('artifacts/motion-ready-719024/contact-carriers.json', root),
  'utf8',
)), {
  ...sourceIdentity,
  atlasHash: 'e3007a55f930d709ac8a7bf684ff32ad862e7d55186343220edb3e2ad3635b78',
  vertexCount: positions.length / 3,
});
assert.deepEqual(
  persisted.patches.map(patch => patch.carrierVertexIndices),
  derived.patches.map(patch => patch.carrierVertexIndices),
  'persisted topology binding must equal deterministic derivation',
);
assert.throws(
  () => creatureCore.validateCrawlerContactCarriers(persisted, { ...sourceIdentity, atlasHash: 'tampered', vertexCount: positions.length / 3 }),
  /atlas hash mismatch/,
);

const kinematics = creatureCore.createCrawlerContactKinematics(atlas, Math.PI * 0.76, {
  coupling: 1,
  scale: 1.14,
});
const baseline = new Float32Array(positions);
creatureCore.applyCrawlerContactPatchDeformation(atlas, kinematics, baseline);
const carrierDeformed = new Float32Array(positions);
const evidence = creatureCore.applyCrawlerContactCarrierDeformation(atlas, persisted, kinematics, carrierDeformed);
assert.equal(evidence.schema, 'kaminos.crawler-contact-carrier-deformation.v0');
assert.equal(evidence.patchCount, 4);
assert.ok(evidence.carrierVertexCount > 4000);
assert.ok(carrierDeformed.some((value, index) => Math.abs(value - positions[index]) > 1e-5));

let baselineMaximum = 0;
let carrierMaximum = 0;
for (const patch of persisted.patches) {
  baselineMaximum = Math.max(
    baselineMaximum,
    maxInternalEdgeStrain(positions, baseline, patch.carrierVertexIndices, triangleIndices),
  );
  carrierMaximum = Math.max(
    carrierMaximum,
    maxInternalEdgeStrain(positions, carrierDeformed, patch.carrierVertexIndices, triangleIndices),
  );
}
assert.ok(baselineMaximum > 0.02, `baseline must expose the profile distortion (${baselineMaximum})`);
assert.ok(carrierMaximum < 2e-5, `carrier topology must preserve internal edge lengths to the Float32 floor (${carrierMaximum})`);
assert.ok(carrierMaximum < baselineMaximum * 0.001);

console.log(JSON.stringify({
  schema: 'kaminos.motion-ready-719024-contact-carrier-contracts.v0',
  carrierVertexCount: evidence.carrierVertexCount,
  collarVertexCount: evidence.collarVertexCount,
  baselineMaximum,
  carrierMaximum,
}, null, 2));
