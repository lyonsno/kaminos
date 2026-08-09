import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  bindCastToEnvelope,
  bindEnvelopeToSkeleton,
  poseCastThroughProxy,
  poseEnvelope,
} from '../proxy-rig-core.mjs';
import { parseGlbGeometry } from '../cast-registration-core.mjs';
import { parseGlbNodeGeometries, applyChain } from '../bone-containment-probe-core.mjs';

const W = new URL('../artifacts/cast-correspondence-v0/', import.meta.url);

async function realSetup() {
  const skelBytes = await readFile(new URL('frozen/skeleton-authored.glb', W));
  const bones = parseGlbNodeGeometries(skelBytes);
  const manifest = JSON.parse(await readFile(new URL('frozen/region-manifest-golden-provisional.json', W), 'utf8'));
  const frameLink = JSON.parse(await readFile(new URL('receipts/frame-link--skeleton--envelope-baseline.json', W), 'utf8'));
  const stageA = JSON.parse(await readFile(new URL('receipts/envelope-baseline--cast-sf3d-skin-baseline.json', W), 'utf8'));
  const envelope = parseGlbGeometry(await readFile(new URL('frozen/envelope-baseline.glb', W)));
  const cast = parseGlbGeometry(await readFile(new URL('frozen/cast-sf3d-skin-baseline.glb', W)));
  // Envelope into cast frame via Stage A only (envelope is Stage A's source).
  const stageATransform = stageA.registration.transform;
  const envelopeInCastFrame = {
    positions: Float64Array.from({ length: envelope.positions.length }, (_, i) => 0),
    triangles: envelope.triangles,
  };
  for (let i = 0; i < envelope.positions.length; i += 3) {
    const p = applyChain(
      [envelope.positions[i], envelope.positions[i + 1], envelope.positions[i + 2]],
      [stageATransform],
    );
    envelopeInCastFrame.positions[i] = p[0];
    envelopeInCastFrame.positions[i + 1] = p[1];
    envelopeInCastFrame.positions[i + 2] = p[2];
  }
  const chainTransforms = [{ scale: 1, ...frameLink.link.transform }, stageATransform];
  return { bones, manifest, envelope, envelopeInCastFrame, cast, chainTransforms };
}

test('identity pose reproduces the cast within binding tolerance', async () => {
  const { bones, manifest, envelopeInCastFrame, cast, chainTransforms } = await realSetup();
  const skin = bindEnvelopeToSkeleton({ envelope: envelopeInCastFrame, bones, manifest, chainTransforms });
  const castBinding = bindCastToEnvelope({ cast, envelopeInCastFrame });
  const posedEnvelope = poseEnvelope({ envelopeInCastFrame, skinBinding: skin, pose: {} });
  const posedCast = poseCastThroughProxy({ cast, posedEnvelope, castBinding });
  let maxErr = 0;
  for (let i = 0; i < cast.positions.length; i += 1) {
    maxErr = Math.max(maxErr, Math.abs(posedCast.positions[i] - cast.positions[i]));
  }
  assert.ok(maxErr < 1e-9, `identity pose must be exact reconstruction, max err ${maxErr}`);
});

test('real binding replaces the broad right hindlimb with a sourced four-control chain', async () => {
  const { bones, manifest, envelopeInCastFrame, chainTransforms } = await realSetup();
  const skin = bindEnvelopeToSkeleton({ envelope: envelopeInCastFrame, bones, manifest, chainTransforms });
  const byName = new Map(skin.groups.map(group => [group.name, group]));
  assert.equal(byName.has('hindlimb-right'), false, 'the broad right hindlimb must not survive beside its chain');
  const expected = [
    ['hindlimb-right-hip', null],
    ['hindlimb-right-stifle', 'hindlimb-right-hip'],
    ['hindlimb-right-hock', 'hindlimb-right-stifle'],
    ['hindlimb-right-paw', 'hindlimb-right-hock'],
  ];
  for (const [name, parent] of expected) {
    const group = byName.get(name);
    assert.ok(group, `${name} must be present`);
    assert.equal(group.parent, parent);
    assert.equal(group.pivot.length, 3);
    assert.ok(group.pivot.every(Number.isFinite));
    assert.ok(group.sourceBones.length > 0, `${name} must retain its source-bone receipt`);
    assert.match(group.pivotDerivation, /nearest-surface|attachment/i);
  }
  const sourceBones = expected.flatMap(([name]) => byName.get(name).sourceBones);
  assert.equal(new Set(sourceBones).size, sourceBones.length, 'a source bone must belong to one chain segment');
  assert.ok(sourceBones.includes('Cube.087'), 'the proximal authored hindlimb element must survive derivation');
  assert.ok(sourceBones.includes('Cube.088'), 'the authored hock element must survive derivation');
  assert.ok(sourceBones.includes('Cube.081'), 'the distal authored paw must survive derivation');
});

test('hierarchical envelope posing composes parent motion through descendants', () => {
  const envelopeInCastFrame = {
    positions: Float64Array.from([
      0, 1, 0,
      2, 0, 0,
      3, 0, 0,
      4, 0, 0,
    ]),
    triangles: Uint32Array.from([]),
  };
  const skinBinding = {
    groups: [
      { name: 'hip', pivot: [0, 0, 0], parent: null },
      { name: 'stifle', pivot: [1, 0, 0], parent: 'hip' },
      { name: 'hock', pivot: [2, 0, 0], parent: 'stifle' },
      { name: 'paw', pivot: [3, 0, 0], parent: 'hock' },
    ],
    neighbors: 1,
    weightGroups: Int16Array.from([0, 1, 2, 3]),
    weightValues: Float64Array.from([1, 1, 1, 1]),
  };
  const parentPose = poseEnvelope({
    envelopeInCastFrame,
    skinBinding,
    pose: { hip: { axis: [0, 0, 1], angleDeg: 90 } },
  });
  assert.deepEqual(Array.from(parentPose.positions).map(value => Math.round(value * 1e12) / 1e12), [
    -1, 0, 0,
    0, 2, 0,
    0, 3, 0,
    0, 4, 0,
  ]);

  const childPose = poseEnvelope({
    envelopeInCastFrame,
    skinBinding,
    pose: { stifle: { axis: [0, 0, 1], angleDeg: 90 } },
  });
  assert.deepEqual(Array.from(childPose.positions).map(value => Math.round(value * 1e12) / 1e12), [
    0, 1, 0,
    1, 1, 0,
    1, 2, 0,
    1, 3, 0,
  ]);
});

test('real hock rotation is descendant-heavy and does not drag the opposite hindlimb', async () => {
  const { bones, manifest, envelopeInCastFrame, chainTransforms } = await realSetup();
  const skin = bindEnvelopeToSkeleton({ envelope: envelopeInCastFrame, bones, manifest, chainTransforms });
  const posed = poseEnvelope({
    envelopeInCastFrame,
    skinBinding: skin,
    pose: { 'hindlimb-right-hock': { axis: [0, 0, 1], angleDeg: 25 } },
  });
  const names = skin.groups.map(group => group.name);
  const totals = new Map(names.map(name => [name, { count: 0, displacement: 0 }]));
  for (let vertex = 0; vertex < envelopeInCastFrame.positions.length / 3; vertex += 1) {
    let dominantGroup = -1;
    let dominantWeight = -1;
    for (let neighbor = 0; neighbor < skin.neighbors; neighbor += 1) {
      const index = vertex * skin.neighbors + neighbor;
      if (skin.weightValues[index] > dominantWeight) {
        dominantWeight = skin.weightValues[index];
        dominantGroup = skin.weightGroups[index];
      }
    }
    const total = totals.get(names[dominantGroup]);
    total.count += 1;
    total.displacement += Math.hypot(
      posed.positions[vertex * 3] - envelopeInCastFrame.positions[vertex * 3],
      posed.positions[vertex * 3 + 1] - envelopeInCastFrame.positions[vertex * 3 + 1],
      posed.positions[vertex * 3 + 2] - envelopeInCastFrame.positions[vertex * 3 + 2],
    );
  }
  const mean = name => totals.get(name).displacement / totals.get(name).count;
  assert.ok(mean('hindlimb-right-hip') < 1e-12, 'hock rotation must leave dominant hip vertices fixed');
  assert.ok(
    mean('hindlimb-right-paw') > mean('hindlimb-right-hock') * 2,
    'hock rotation must carry the descendant paw farther than the hock segment',
  );
  assert.ok(
    mean('hindlimb-left') < mean('hindlimb-right-paw') * 0.1,
    'opposite-side mean leakage must stay below ten percent of paw motion',
  );
});

test('posing one limb moves that limb region and leaves the far side nearly still', async () => {
  const { bones, manifest, envelopeInCastFrame, cast, chainTransforms } = await realSetup();
  const skin = bindEnvelopeToSkeleton({ envelope: envelopeInCastFrame, bones, manifest, chainTransforms });
  const castBinding = bindCastToEnvelope({ cast, envelopeInCastFrame });
  const pose = { 'forelimb-right': { axis: [1, 0, 0], angleDeg: 20 } };
  const posedEnvelope = poseEnvelope({ envelopeInCastFrame, skinBinding: skin, pose });
  const posedCast = poseCastThroughProxy({ cast, posedEnvelope, castBinding });
  // Displacement statistics.
  const disp = [];
  for (let v = 0; v < cast.positions.length / 3; v += 1) {
    disp.push(Math.hypot(
      posedCast.positions[v * 3] - cast.positions[v * 3],
      posedCast.positions[v * 3 + 1] - cast.positions[v * 3 + 1],
      posedCast.positions[v * 3 + 2] - cast.positions[v * 3 + 2],
    ));
  }
  const sorted = disp.slice().sort((a, b) => a - b);
  const q10 = sorted[Math.floor(sorted.length * 0.1)];
  const max = sorted[sorted.length - 1];
  assert.ok(max > 0.01, `posed limb must move materially, max disp ${max}`);
  assert.ok(q10 < max * 0.05,
    `far-body vertices must stay nearly still: q10 ${q10} vs max ${max}`);
});

test('displacement smoothing kills a spike outlier while preserving the pose and identity', async () => {
  const { smoothDisplacementField, buildCastAdjacency } = await import('../proxy-rig-core.mjs');
  const { bones, manifest, envelopeInCastFrame, cast, chainTransforms } = await realSetup();
  const skin = bindEnvelopeToSkeleton({ envelope: envelopeInCastFrame, bones, manifest, chainTransforms });
  const castBinding = bindCastToEnvelope({ cast, envelopeInCastFrame });
  const adjacency = buildCastAdjacency(cast);
  // Identity + smoothing stays exact (zero displacement smooths to zero).
  const idEnvelope = poseEnvelope({ envelopeInCastFrame, skinBinding: skin, pose: {} });
  const idCast = poseCastThroughProxy({ cast, posedEnvelope: idEnvelope, castBinding });
  const idSmoothed = smoothDisplacementField({ cast, posedPositions: idCast.positions, adjacency });
  let idErr = 0;
  for (let i = 0; i < cast.positions.length; i += 1) {
    idErr = Math.max(idErr, Math.abs(idSmoothed[i] - cast.positions[i]));
  }
  assert.ok(idErr < 1e-9, `identity must survive smoothing exactly, got ${idErr}`);
  // Pose, then inject one artificial spike (a corrupted correspondence).
  const pose = { 'forelimb-right': { axis: [1, 0, 0], angleDeg: 25 } };
  const posedEnvelope = poseEnvelope({ envelopeInCastFrame, skinBinding: skin, pose });
  const posedCast = poseCastThroughProxy({ cast, posedEnvelope, castBinding });
  const spiked = posedCast.positions.slice();
  const spikeVertex = 1234;
  spiked[spikeVertex * 3] += 0.15; // gross outlier, way beyond any lawful motion
  const smoothed = smoothDisplacementField({ cast, posedPositions: spiked, adjacency });
  const spikeBefore = Math.abs(spiked[spikeVertex * 3] - posedCast.positions[spikeVertex * 3]);
  const spikeAfter = Math.abs(smoothed[spikeVertex * 3] - posedCast.positions[spikeVertex * 3]);
  assert.ok(spikeAfter < spikeBefore / 5,
    `spike must shrink >5x: ${spikeBefore} -> ${spikeAfter}`);
  // The intended limb motion must survive smoothing.
  const disp = [];
  for (let v = 0; v < cast.positions.length / 3; v += 1) {
    disp.push(Math.hypot(
      smoothed[v * 3] - cast.positions[v * 3],
      smoothed[v * 3 + 1] - cast.positions[v * 3 + 1],
      smoothed[v * 3 + 2] - cast.positions[v * 3 + 2],
    ));
  }
  const maxDisp = Math.max(...disp);
  assert.ok(maxDisp > 0.01, `limb motion must survive smoothing, max disp ${maxDisp}`);
});

test('bindings are deterministic', async () => {
  const { bones, manifest, envelopeInCastFrame, cast, chainTransforms } = await realSetup();
  const a = bindEnvelopeToSkeleton({ envelope: envelopeInCastFrame, bones, manifest, chainTransforms });
  const b = bindEnvelopeToSkeleton({ envelope: envelopeInCastFrame, bones, manifest, chainTransforms });
  assert.deepEqual(Array.from(a.weightGroups), Array.from(b.weightGroups));
  assert.deepEqual(Array.from(a.weightValues), Array.from(b.weightValues));
  const ca = bindCastToEnvelope({ cast, envelopeInCastFrame });
  const cb = bindCastToEnvelope({ cast, envelopeInCastFrame });
  assert.deepEqual(Array.from(ca.triangle), Array.from(cb.triangle));
});
