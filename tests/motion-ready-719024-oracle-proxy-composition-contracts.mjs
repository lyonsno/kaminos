#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import * as creatureCore from '../motion-ready-719024-core.js';
import {
  deriveOracleStencilBinding,
  validateOracleStencilDocument,
} from '../motion-ready-719024-stencil.js';

const root = new URL('../', import.meta.url);
const identity = Object.freeze({
  castId: 'motion-ready-719024',
  castHash: '8fed20d958ef48797c14ad1d3846a50eae05d43e6ae67f8805060b02f1abde8e',
  registrationHash: 'cb519913ad863441e88555b3d9fbd588ffef03650475de07c29ee1c71f500ff6',
});
const reviewedProxyIdentity = Object.freeze({
  donorSha256: 'sha256:8fed20d958ef48797c14ad1d3846a50eae05d43e6ae67f8805060b02f1abde8e',
  sourcePacketSha256: 'sha256:438dc7cdd1839d1f1d993312fbe5e41976329d1f96542d9eb3e097e743e63d8f',
  armatureProgramId: 'kaminos.lirm-preserved-proxy-armature.lirm-armature-03.v0',
});

for (const exportName of [
  'createOracleMotionControlPlan',
  'validateFittedProxyRigRegistration',
  'createFittedProxyRigGeometryBinding',
  'createFittedProxyRigPoseFromAxialState',
  'deformFittedProxyRigGeometryBinding',
  'applyOracleBodyPreservationEnvelope',
  'createOracleCrawlerContactAtlas',
  'applyOracleContactDeformation',
]) {
  assert.equal(typeof creatureCore[exportName], 'function', `${exportName} must be exported`);
}

const stencil = validateOracleStencilDocument(JSON.parse(await readFile(
  new URL('artifacts/motion-ready-719024/oracle-stencil-noah-0722.json', root),
  'utf8',
)), identity);
assert.equal(stencil.authoring.status, 'draft', 'consumer must preserve operator-authored draft status');

const plan = creatureCore.createOracleMotionControlPlan(stencil, identity);
assert.equal(plan.schema, 'kaminos.motion-ready-719024.oracle-motion-control-plan.v0');
assert.equal(plan.stencilStatus, 'draft');
assert.equal(plan.preservation.authority, 'consumer-inferred-from-operator-body-axis');
assert.equal(plan.preservation.sourceRegionId, 'body-axis');
assert.deepEqual(Object.keys(plan.contacts), ['front-left', 'front-right', 'rear-left', 'rear-right']);
assert.deepEqual(
  Object.values(plan.contacts).map(contact => contact.phaseOffset),
  [0, 0.5, 0.5, 0],
  'canonical foot ordering must preserve the proven diagonal gait phase',
);
assert.equal(new Set(Object.values(plan.contacts).map(contact => contact.appendageRegionId)).size, 4);
assert.equal(new Set(Object.values(plan.contacts).map(contact => contact.contactRegionId)).size, 4);

const mislabeled = structuredClone(stencil);
mislabeled.regions.find(region => region.id === plan.contacts['rear-left'].appendageRegionId).label = 'mystery limb';
assert.throws(
  () => creatureCore.createOracleMotionControlPlan(mislabeled, identity),
  /cannot resolve appendage label mystery limb/,
  'ambiguous operator semantics must fail loudly instead of falling back to geometry',
);

const proxyRegistration = creatureCore.validateFittedProxyRigRegistration(JSON.parse(await readFile(
  new URL('artifacts/motion-ready-719024/fitted-proxy-rig-registration.json', root),
  'utf8',
)), reviewedProxyIdentity);
assert.equal(proxyRegistration.stationCount, 13);
assert.equal(proxyRegistration.manualControlCount, 0);
assert.equal(proxyRegistration.headDirection, '-Z');

const axialRegistration = creatureCore.validateAxialCrawlerRegistration(JSON.parse(await readFile(
  new URL('artifacts/motion-ready-719024/registration.json', root),
  'utf8',
)));
const restPositions = new Float32Array([
  0.12, 0.03, 0.42,
  -0.11, -0.06, 0.08,
  0.08, 0.02, -0.34,
]);
const restNormals = new Float32Array([
  1, 0, 0,
  0, 1, 0,
  0, 0, 1,
]);
const proxyBinding = creatureCore.createFittedProxyRigGeometryBinding(
  restPositions,
  restNormals,
  proxyRegistration,
);
const zeroPose = creatureCore.createFittedProxyRigPoseFromAxialState(
  proxyRegistration,
  axialRegistration,
  creatureCore.createAxialSquirmState(),
);
const zeroPositions = new Float32Array(restPositions.length);
const zeroNormals = new Float32Array(restNormals.length);
creatureCore.deformFittedProxyRigGeometryBinding(proxyBinding, zeroPose, zeroPositions, zeroNormals);
for (let index = 0; index < restPositions.length; index++) {
  assert.ok(Math.abs(zeroPositions[index] - restPositions[index]) < 1e-6, `zero proxy pose drifted component ${index}`);
  assert.ok(Math.abs(zeroNormals[index] - restNormals[index]) < 1e-6, `zero proxy pose drifted normal ${index}`);
}

const activePose = creatureCore.createFittedProxyRigPoseFromAxialState(
  proxyRegistration,
  axialRegistration,
  creatureCore.createAxialSquirmState({ phase: 0.31, amplitude: 0.055, verticalAmplitude: 0.012 }),
);
const activePositions = new Float32Array(restPositions.length);
const activeNormals = new Float32Array(restNormals.length);
const bodyEvidence = creatureCore.deformFittedProxyRigGeometryBinding(
  proxyBinding,
  activePose,
  activePositions,
  activeNormals,
);
assert.equal(bodyEvidence.schema, 'kaminos.motion-ready-719024.fitted-proxy-rig-deformation.v0');
assert.ok(activePositions.some((value, index) => Math.abs(value - restPositions[index]) > 1e-4));

const envelopePositions = new Float32Array(activePositions);
const envelopeNormals = new Float32Array(activeNormals);
const preservationEvidence = creatureCore.applyOracleBodyPreservationEnvelope(
  plan,
  {
    schema: 'kaminos.oracle-mechanical-stencil-binding.v0',
    vertexCount: restPositions.length / 3,
    regions: [{ id: 'body-axis', kind: 'body-axis', vertexIndices: [0], weights: [1] }],
  },
  proxyBinding,
  envelopePositions,
  envelopeNormals,
);
assert.equal(preservationEvidence.authority, 'consumer-inferred-from-operator-body-axis');
assert.ok(Math.abs(envelopePositions[0] - activePositions[0]) < 1e-6, 'body-axis vertex keeps fitted proxy deformation');
for (let index = 3; index < envelopePositions.length; index++) {
  assert.ok(Math.abs(envelopePositions[index] - restPositions[index]) < 1e-6, 'unpainted limb vertex returns to rest before contact motion');
}

const semanticBinding = await deriveOracleStencilBinding(stencil, new Float32Array([
  ...stencil.regions.find(region => region.id === plan.contacts['front-left'].appendageRegionId).points[0],
  ...stencil.regions.find(region => region.id === plan.contacts['front-left'].appendageRegionId).points[2],
  ...stencil.regions.find(region => region.id === 'body-axis').points[0],
]), identity);
const atlasPositions = new Float32Array(8 * 3);
const atlasRegions = [];
Object.values(plan.contacts).forEach((contact, contactIndex) => {
  const appendageRegion = stencil.regions.find(region => region.id === contact.appendageRegionId);
  const contactRegion = stencil.regions.find(region => region.id === contact.contactRegionId);
  atlasPositions.set(appendageRegion.points[0], contactIndex * 6);
  atlasPositions.set(contactRegion.points[0], contactIndex * 6 + 3);
  atlasRegions.push(
    { id: contact.appendageRegionId, vertexIndices: [contactIndex * 2], weights: [1] },
    { id: contact.contactRegionId, vertexIndices: [contactIndex * 2 + 1], weights: [1] },
  );
});
const semanticAtlas = creatureCore.createOracleCrawlerContactAtlas(
  plan,
  {
    schema: 'kaminos.oracle-mechanical-stencil-binding.v0',
    stencilHash: 'operator-stencil-test-hash',
    vertexCount: 8,
    regions: atlasRegions,
  },
  atlasPositions,
);
assert.equal(semanticAtlas.authority, 'derived-from-operator-semantic-stencil');
assert.ok(Number.isFinite(semanticAtlas.contactPlaneY), 'operator contacts define an active support plane');
assert.deepEqual(semanticAtlas.patches.map(patch => patch.id), ['front-left', 'front-right', 'rear-left', 'rear-right']);
assert.equal(semanticAtlas.patches[0].operatorContactRegionId, plan.contacts['front-left'].contactRegionId);
const semanticPositions = new Float32Array(9);
const semanticEvidence = creatureCore.applyOracleContactDeformation(
  plan,
  semanticBinding,
  {
    schema: 'kaminos.crawler-contact-kinematics.v0',
    coupling: 1,
    patches: Object.keys(plan.contacts).map(id => ({
      id,
      localOffset: id === 'front-left' ? [0.02, 0.06, -0.01] : [0, 0, 0],
    })),
  },
  semanticPositions,
);
assert.equal(semanticEvidence.schema, 'kaminos.motion-ready-719024.oracle-contact-deformation.v0');
assert.ok(Math.hypot(...semanticPositions.slice(3, 6)) > 0.02, 'front-left distal appendage must receive semantic contact motion');
assert.ok(Math.hypot(...semanticPositions.slice(6, 9)) < 1e-7, 'body-axis-only vertex must remain protected');

console.log('motion-ready-719024 oracle proxy composition contracts passed');
