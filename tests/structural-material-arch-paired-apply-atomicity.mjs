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
const acceptedBeforeFailure = accepted.map(state => ({
  state,
  connectivityEpoch: state.connectivityEpoch,
  brokenBondCount: state.bonds.filter(bond => !bond.alive).length,
}));
assert.throws(
  () => stageArchSurfaceBatch(accepted.map(state => ({
    profile,
    state,
    sourcePositions,
    load,
  })), 1, { threshold: 0.04 }),
  /did not converge/,
);
for (let index = 0; index < accepted.length; index += 1) {
  assert.strictEqual(accepted[index], acceptedBeforeFailure[index].state,
    'failed staging must not replace an accepted state');
  assert.equal(accepted[index].connectivityEpoch, acceptedBeforeFailure[index].connectivityEpoch);
  assert.equal(accepted[index].bonds.filter(bond => !bond.alive).length, acceptedBeforeFailure[index].brokenBondCount);
}

const page = readFileSync('structural-material-arch-geometry.html', 'utf8');
const applyStart = page.indexOf('function applyPair(force, label,');
const applyEnd = page.indexOf("document.getElementById('damage-history').addEventListener('click'");
assert.ok(applyStart >= 0 && applyEnd > applyStart, 'Apply handler must remain locatable');
const applyHandler = page.slice(applyStart, applyEnd);
assert.match(applyHandler, /runArchSurfaceApply\(/,
  'the live Apply handler must use the exercised shared transaction boundary');
assert.match(applyHandler, /prepareView\(viewers\.intact, force, startingIntact\)[\s\S]*prepareView\(viewers\.damaged, force, startingDamaged\)/,
  'the intact and damaged histories must stage as one paired transaction');
assert.match(page, /accept: acceptArchSurfaceBatch/,
  'the page must route staged candidates through the tested atomic mesh acceptance');

const historyHandlerStart = page.indexOf("document.getElementById('damage-history').addEventListener('click'");
const applyButtonStart = page.indexOf("document.getElementById('apply').addEventListener('click'");
const historyHandler = page.slice(historyHandlerStart, applyButtonStart);
assert.match(historyHandler, /const candidateHistory = buildArchDamageHistory\(viewers\.damaged\.base\)/,
  'history construction must remain a proposed candidate until paired presentation accepts');
assert.match(historyHandler, /applyPair\(0,[\s\S]*damagedState: candidateHistory\.state[\s\S]*transaction\.status === 'accepted'[\s\S]*damageHistory = candidateHistory/,
  'the first paired mesh presentation must stage the candidate and commit its identity only after acceptance');
assert.doesNotMatch(historyHandler, /viewers\.damaged\.state\s*=\s*candidateHistory\.state/,
  'a rejected first presentation must not leave hidden damaged solver state behind');
assert.match(page, /acceptedLoadPath/,
  'later slider loads must retain an explicit identity for the evolving comparison history');
assert.match(page, /recordLoad = true/,
  'accepted zero-force operations must be retained as part of the causal load path');
assert.match(page, /label: label\.startsWith\('Unloaded'\) \? 'Unload' : 'Load'/,
  'the causal path must distinguish an unload from a zero-force load');
assert.match(page, /load path:/,
  'the current accepted load path must be visible beside the paired result');

console.log('structural arch paired apply atomicity contracts passed');
