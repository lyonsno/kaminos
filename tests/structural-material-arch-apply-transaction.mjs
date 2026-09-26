import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as sidecar from '../structural-material-arch-geometry-sidecar.js';
import { buildArchStructuralProxy } from '../structural-material-arch-core.js';

const profile = JSON.parse(readFileSync(
  'artifacts/structural-material-3d/stone-arch-source-pair-2026-09-24/arch-proxy-witness/arch-surface-depth-profile.json',
  'utf8',
));
const options = { threshold: 0.04 };
const load = {
  x: -0.05,
  y: 0.29,
  force: 0.75,
  patchRadius: 0.032,
  contactDepthMode: 'camera-facing-surface',
  contactLayer: 2,
  iterations: 600,
};

assert.equal(typeof sidecar.runArchSurfaceApply, 'function',
  'the page and witness must share an executable Apply transaction boundary');
assert.equal(typeof sidecar.acceptArchSurfaceBatch, 'function',
  'the page and witness must share the mesh/state acceptance and rollback path');
assert.equal(typeof sidecar.summarizeArchSurfaceUpdate, 'function',
  'operator receipts must use the compact result projection');

function makeView(interiorMode) {
  const base = buildArchStructuralProxy(profile, { layers: 3, depthMode: 'surface-envelope', interiorMode });
  const position = { array: new Float32Array([0, 0, 0]), needsUpdate: false };
  const geometry = {
    getAttribute: () => position,
    computeVertexNormals() {},
    computeBoundingSphere() {},
  };
  const viewer = { base, state: null, projection: null, mesh: { geometry } };
  return { viewer, entry: { viewer, profile, state: base, sourcePositions: position.array, load } };
}

function createHarness({ render = () => {}, failOnCommit = false } = {}) {
  const continuous = makeView('continuous');
  const joints = makeView('radial-voussoir-joints');
  const entries = [continuous.entry, joints.entry];
  const readouts = ['No load applied', 'No load applied'];
  let receipt = 'No load applied';
  let status = 'Ready';
  let commitCalls = 0;
  return {
    entries,
    viewers: [continuous.viewer, joints.viewer],
    readouts,
    get receipt() { return receipt; },
    get status() { return status; },
    apply(stage = sidecar.stageArchSurfaceBatch) {
      return sidecar.runArchSurfaceApply({
        prepare: () => entries.map(entry => ({
          ...entry,
          state: entry.viewer.state ?? entry.viewer.base,
        })),
        stage: current => stage(current, 1, options),
        accept: (current, updates) => sidecar.acceptArchSurfaceBatch(current, updates, {
          beforeWrite() {
            commitCalls += 1;
            if (failOnCommit && commitCalls === 2) throw new Error('injected mesh write failure');
          },
        }),
        present: updates => {
          readouts[0] = `continuous epoch ${updates[0].connectivityEpoch}`;
          readouts[1] = `joints epoch ${updates[1].connectivityEpoch}`;
          receipt = JSON.stringify({
            result: 'accepted',
            continuous: sidecar.summarizeArchSurfaceUpdate(updates[0]),
            radialJointCounterfactual: sidecar.summarizeArchSurfaceUpdate(updates[1]),
          });
          status = 'Accepted';
          render();
        },
        reportFailure: error => {
          status = `Load failed: ${error.message}`;
          receipt = `No new state accepted. ${error.message}`;
        },
        reportPresentationFailure: (error, updates) => {
          status = `State accepted; presentation failed: ${error.message}`;
          receipt = JSON.stringify({
            result: 'accepted-presentation-failed',
            error: error.message,
            continuous: sidecar.summarizeArchSurfaceUpdate(updates[0]),
            radialJointCounterfactual: sidecar.summarizeArchSurfaceUpdate(updates[1]),
          });
        },
      });
    },
  };
}

const accepted = createHarness();
let lastAccepted;
for (let index = 0; index < 3; index += 1) lastAccepted = accepted.apply();
const acceptedBeforeFailure = accepted.viewers.map(viewer => ({
  state: viewer.state,
  positions: viewer.mesh.geometry.getAttribute('position').array.slice(),
}));
const readoutsBeforeFailure = [...accepted.readouts];
const receiptBeforeFailure = accepted.receipt;
const fourth = accepted.apply();
assert.equal(fourth.status, 'rejected');
for (let index = 0; index < accepted.viewers.length; index += 1) {
  assert.strictEqual(accepted.viewers[index].state, acceptedBeforeFailure[index].state);
  assert.deepEqual(accepted.viewers[index].mesh.geometry.getAttribute('position').array, acceptedBeforeFailure[index].positions);
}
assert.deepEqual(accepted.readouts, readoutsBeforeFailure);
assert.notEqual(accepted.receipt, receiptBeforeFailure);
assert.match(accepted.receipt, /^No new state accepted\./);

const projectionFailure = createHarness();
const projectionResult = projectionFailure.apply((entries, gain, fractureOptions) => {
  sidecar.stageArchSurfaceBatch(entries.slice(0, 1), gain, fractureOptions);
  throw new Error('injected second-view projection failure');
});
assert.equal(projectionResult.status, 'rejected');
assert.ok(projectionFailure.viewers.every(viewer => viewer.state === null));
assert.deepEqual(projectionFailure.viewers.map(viewer => [...viewer.mesh.geometry.getAttribute('position').array]), [[0, 0, 0], [0, 0, 0]]);
assert.deepEqual(projectionFailure.readouts, ['No load applied', 'No load applied']);
assert.match(projectionFailure.receipt, /^No new state accepted\./);

const meshFailure = createHarness({ failOnCommit: true });
const meshFailureResult = meshFailure.apply();
assert.equal(meshFailureResult.status, 'rejected');
assert.ok(meshFailure.viewers.every(viewer => viewer.state === null));
assert.deepEqual(meshFailure.viewers.map(viewer => [...viewer.mesh.geometry.getAttribute('position').array]), [[0, 0, 0], [0, 0, 0]]);
assert.deepEqual(meshFailure.readouts, ['No load applied', 'No load applied']);
assert.match(meshFailure.receipt, /^No new state accepted\./);

const renderFailure = createHarness({ render: () => { throw new Error('injected render failure'); } });
const renderFailureResult = renderFailure.apply();
assert.equal(renderFailureResult.status, 'accepted-presentation-failed');
assert.ok(renderFailure.viewers.every(viewer => viewer.state?.connectivityEpoch === 1));
assert.match(renderFailure.status, /State accepted; presentation failed/);
assert.match(renderFailure.receipt, /accepted-presentation-failed/);
assert.doesNotMatch(renderFailure.receipt, /No new state accepted/);

const summary = sidecar.summarizeArchSurfaceUpdate(lastAccepted.updates[0]);
assert.ok(summary.connectivityEpoch >= 1);
assert.equal(JSON.stringify(summary).includes('nodes'), false);
assert.equal(JSON.stringify(summary).includes('bonds'), false);
assert.ok(Buffer.byteLength(JSON.stringify(summary)) < 2048);
assert.ok(Buffer.byteLength(JSON.stringify({
  continuous: summary,
  radialJointCounterfactual: sidecar.summarizeArchSurfaceUpdate(lastAccepted.updates[1]),
})) < 4096);

const page = readFileSync('structural-material-arch-geometry.html', 'utf8');
assert.match(page, /runArchSurfaceApply\(/, 'the live page must invoke the tested Apply transaction');
assert.match(page, /summarizeArchSurfaceUpdate\(/, 'the visible receipt must serialize compact summaries');
assert.doesNotMatch(page, /No new state accepted\.[\s\S]{0,80}render\(\)/,
  'post-commit render failure must not be reported as rejected state');

console.log('structural arch Apply transaction contracts passed');
