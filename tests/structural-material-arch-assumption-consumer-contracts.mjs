import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { buildArchProfileFromGlb } from '../structural-material-arch-profile.mjs';
import {
  buildArchAssumptionComparison,
  verifyArchAssumptionProfileAndGlb,
} from '../structural-material-arch-assumption-consumer.mjs';
import { runArchSurfaceApply } from '../structural-material-arch-geometry-sidecar.js';

const source = 'artifacts/structural-material-3d/stone-arch-source-pair-2026-09-24/trellis-intact/output.glb';
const profile = buildArchProfileFromGlb(source, 48, 36, {
  min: [-0.5, -0.39],
  max: [0.5, 0.39],
});
const positions = new Float32Array([
  0.35, 0.2, 0,
  0.34, 0.2, 0.03,
  0.36, 0.19, -0.02,
]);
const comparison = buildArchAssumptionComparison(profile, positions, { force: 0.15 });

assert.equal(comparison.schema, 'kaminos.structural-material.arch-assumption-mesh-consumer.v0');
assert.equal(comparison.cases.length, 4);
assert.deepEqual(comparison.cases.map(item => [item.interiorMode, item.contact.contactDepthMode]), [
  ['continuous', 'through-thickness'],
  ['continuous', 'camera-facing-surface'],
  ['radial-voussoir-joints', 'through-thickness'],
  ['radial-voussoir-joints', 'camera-facing-surface'],
]);
for (const item of comparison.cases) {
  assert.equal(item.force, 0.15);
  assert.equal(item.contact.column, comparison.contactCell.column);
  assert.equal(item.contact.row, comparison.contactCell.row);
  assert.equal(item.surfaceVertexCount, 3);
  assert.equal(item.unmappedVertexCount, 0);
  assert.equal(item.brokenBondCount, 0, 'moderate comparison load must not silently become a fracture showcase');
  assert.ok(item.maxRawVertexDisplacement > 0);
}
assert.ok(comparison.cases[0].loadedNodeCount > comparison.cases[1].loadedNodeCount);
assert.equal(comparison.cases[0].loadedNodeCount, comparison.cases[2].loadedNodeCount);
assert.equal(comparison.cases[1].loadedNodeCount, comparison.cases[3].loadedNodeCount);
assert.ok(comparison.adjudication.contactChangesProjection);
assert.ok(comparison.adjudication.interiorChangesProjection);
assert.equal(comparison.claimCeiling.includes('the radial-joint case is a counterfactual, not source-truth construction'), true);

const profileBytes = readFileSync('artifacts/structural-material-3d/stone-arch-source-pair-2026-09-24/arch-proxy-witness/arch-history-surface-depth-profile.json');
const glbBytes = readFileSync(source);
const profileDigest = bytes => createHash('sha256').update(bytes).digest('hex');
const verified = await verifyArchAssumptionProfileAndGlb(profileBytes, glbBytes);
assert.equal(verified.profile.source.sha256, profileDigest(glbBytes));
assert.equal(verified.profileSha256, profileDigest(profileBytes));
const changedProfile = JSON.parse(profileBytes.toString('utf8'));
changedProfile.bounds.max[0] += 0.01;
await assert.rejects(
  verifyArchAssumptionProfileAndGlb(Buffer.from(JSON.stringify(changedProfile)), glbBytes, profileDigest(profileBytes)),
  /profile payload SHA-256 mismatch/,
  'profile edits with a retained embedded GLB digest must fail exact-profile verification',
);
await assert.rejects(
  verifyArchAssumptionProfileAndGlb(profileBytes, Buffer.from('not the pinned source mesh')),
  /embedded GLB source SHA-256 mismatch/,
  'the pinned profile must reject a different GLB even when profile bytes are unchanged',
);

let committed = false;
let visibleReceipt = '';
const presentationFailure = runArchSurfaceApply({
  prepare: () => [{}],
  stage: () => [{ state: { epoch: 1 } }],
  accept: () => { committed = true; },
  present: () => { throw new Error('injected render failure'); },
  reportFailure: () => { visibleReceipt = 'rejected'; },
  reportPresentationFailure: error => { visibleReceipt = `accepted-presentation-failed:${error.message}`; },
});
assert.equal(presentationFailure.status, 'accepted-presentation-failed');
assert.equal(committed, true);
assert.equal(visibleReceipt, 'accepted-presentation-failed:injected render failure');
assert.match(readFileSync('structural-material-arch-assumptions.html', 'utf8'), /runArchSurfaceApply/,
  'the browser must use the same accepted-versus-presentation-failed transaction boundary');

console.log('structural arch assumption mesh consumer contracts passed');
