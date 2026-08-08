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
