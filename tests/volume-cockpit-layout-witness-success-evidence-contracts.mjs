import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import * as witnessContract from '../volume-cockpit-layout-witness-contract.mjs';

const root = join(import.meta.dirname, '..');
const witness = readFileSync(join(root, 'volume-cockpit-layout-witness.mjs'), 'utf8');

assert.equal(
  typeof witnessContract.buildSuccessfulGestureEvidence,
  'function',
  'the successful witness contract must expose a checked gesture-evidence builder',
);

const dragProbe = {
  fromSelector: '[data-volume-cockpit-control-id="volume-density"] > .volume-layout-control-grip',
  toSelector: '[data-volume-cockpit-control-id="volume-vorticity"]',
  viewport: { width: 1720, height: 1080 },
  editing: true,
  from: {
    rect: { x: 20, y: 120, width: 18, height: 18 },
    center: { x: 29, y: 129 },
    intersectsViewport: true,
    hit: { controlId: 'volume-density', groupId: 'group-a' },
    scrollHost: { id: 'sidebar', scrollTop: 120, scrollHeight: 2200, clientHeight: 1080 },
  },
  to: {
    rect: { x: 20, y: 240, width: 280, height: 22 },
    center: { x: 160, y: 251 },
    intersectsViewport: true,
    hit: { controlId: 'volume-vorticity', groupId: 'group-b' },
    scrollHost: { id: 'sidebar', scrollTop: 120, scrollHeight: 2200, clientHeight: 1080 },
  },
};
const authored = {
  layoutId: 'layout-witness',
  movedControlId: 'volume-density',
  sourceGroupId: 'group-a',
  targetGroupId: 'group-b',
};
const gesture = witnessContract.buildSuccessfulGestureEvidence({ authored, dragProbe });
assert.deepEqual(gesture.dragProbe, dragProbe, 'successful gesture evidence discarded or rewrote its drag probe');
assert.equal(gesture.movedControlId, 'volume-density');
assert.throws(
  () => witnessContract.buildSuccessfulGestureEvidence({
    authored,
    dragProbe: { ...dragProbe, to: { ...dragProbe.to, hit: null } },
  }),
  /destination hit target/,
  'a successful gesture must not admit missing destination hit-target identity',
);
assert.match(
  witness,
  /gesture:\s*buildSuccessfulGestureEvidence\(\{[\s\S]*authored:\s*lastTrustworthyEvidence\.authored,[\s\S]*dragProbe:\s*lastTrustworthyEvidence\.dragProbe/,
  'the success report must serialize the checked drag probe beside authored post-gesture state',
);

assert.equal(
  typeof witnessContract.buildPhaseQualifiedBackendEvidence,
  'function',
  'the successful witness contract must expose a phase-qualified backend builder',
);
const backendByPhase = witnessContract.buildPhaseQualifiedBackendEvidence({
  initialAdmission: 'WebGPU:apple',
  postReloadAdmission: 'WebGPU:apple',
  outageAdmission: 'WebGPU:apple',
  final: 'WebGPU:apple',
});
assert.deepEqual(Object.keys(backendByPhase), [
  'initialAdmission',
  'postReloadAdmission',
  'outageAdmission',
  'final',
]);
assert.throws(
  () => witnessContract.buildPhaseQualifiedBackendEvidence({
    ...backendByPhase,
    postReloadAdmission: 'inactive',
  }),
  /postReloadAdmission backend is not WebGPU-qualified/,
  'a stale post-reload backend must not enter effective evidence',
);
assert.match(
  witness,
  /authored layout did not survive page reload[\s\S]*\^WebGPU:/,
  'post-reload layout restoration must wait for a renderer-qualified state',
);
assert.match(
  witness,
  /const backendByPhase\s*=\s*buildPhaseQualifiedBackendEvidence[\s\S]*backend:\s*backendByPhase\.final,[\s\S]*backendByPhase,/,
  'effective evidence must expose both the current backend and phase-qualified backend observations',
);

console.log('volume cockpit layout witness success evidence contracts passed');
