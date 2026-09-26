import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildArchStructuralProxy,
} from '../structural-material-arch-core.js';
import {
  advanceArchSurfaceState,
  stageArchSurfaceBatch,
} from '../structural-material-arch-geometry-sidecar.js';

const profile = JSON.parse(readFileSync(
  'artifacts/structural-material-3d/stone-arch-source-pair-2026-09-24/arch-proxy-witness/arch-surface-depth-profile.json',
  'utf8',
));
const options = { layers: 3, depthMode: 'surface-envelope' };
const continuousBase = buildArchStructuralProxy(profile, {
  ...options,
  interiorMode: 'continuous',
});
const jointsBase = buildArchStructuralProxy(profile, {
  ...options,
  interiorMode: 'radial-voussoir-joints',
});
const load = {
  x: -0.05,
  y: 0.29,
  force: 0.75,
  patchRadius: 0.032,
  contactDepthMode: 'camera-facing-surface',
  contactLayer: 2,
  iterations: 600,
};

let sequentialContinuous = continuousBase;
let sequentialJoints = jointsBase;
for (let click = 0; click < 3; click += 1) {
  sequentialContinuous = advanceArchSurfaceState(sequentialContinuous, load, { threshold: 0.04 });
  sequentialJoints = advanceArchSurfaceState(sequentialJoints, load, { threshold: 0.04 });
}
const oneSidedCandidate = advanceArchSurfaceState(sequentialContinuous, load, { threshold: 0.04 });
assert.throws(
  () => advanceArchSurfaceState(sequentialJoints, load, { threshold: 0.04 }),
  /did not converge/,
  'the fourth paired Apply must reproduce the reviewed radial-joint failure',
);
assert.equal(sequentialContinuous.connectivityEpoch, 3);
assert.equal(oneSidedCandidate.connectivityEpoch, 4,
  'the first sequential solve succeeds and would advance before the paired solve fails');
assert.equal(sequentialJoints.connectivityEpoch, 3);

let accepted = [continuousBase, jointsBase];
const sourcePositions = new Float32Array([0, 0, 0]);
for (let click = 0; click < 3; click += 1) {
  accepted = stageArchSurfaceBatch(accepted.map(state => ({
    profile,
    state,
    sourcePositions,
    load,
  })), 1, { threshold: 0.04 }).map(update => update.state);
}
const acceptedBeforeFailure = accepted;
assert.throws(
  () => stageArchSurfaceBatch(accepted.map(state => ({
    profile,
    state,
    sourcePositions,
    load,
  })), 1, { threshold: 0.04 }),
  /did not converge/,
);
assert.strictEqual(accepted, acceptedBeforeFailure,
  'a failed second-view solve must return no partially accepted batch');
assert.equal(accepted[0].connectivityEpoch, 3);
assert.equal(accepted[1].connectivityEpoch, 3);

const page = readFileSync('structural-material-arch-geometry.html', 'utf8');
const applyStart = page.indexOf("document.getElementById('apply').addEventListener('click'");
const applyEnd = page.indexOf("document.getElementById('reset').addEventListener('click'");
assert.ok(applyStart >= 0 && applyEnd > applyStart, 'Apply handler must remain locatable');
const applyHandler = page.slice(applyStart, applyEnd);
assert.match(applyHandler, /stageArchSurfaceBatch\([\s\S]*acceptStagedArchSurfaceBatch\(/,
  'Apply must stage both solver and projected-mesh candidates before accepting either');
assert.doesNotMatch(applyHandler, /applyState\(viewers\.continuous, force\)[\s\S]*applyState\(viewers\.joints, force\)/,
  'Apply must not commit the continuous mesh before the radial-joint solve succeeds');
assert.match(applyHandler, /acceptStagedArchSurfaceBatch\(/,
  'paired geometry updates must cross one explicit acceptance boundary after staging');

console.log('structural arch paired apply atomicity contracts passed');
