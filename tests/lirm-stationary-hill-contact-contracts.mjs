import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import * as stationaryContactCore from '../lirm-stationary-hill-contact-core.mjs';
import {
  createSupportPlacedFittedRig,
  evaluatePublishedStationaryContactPhase,
  evaluateStationaryHillContactPhase,
  STATIONARY_CONTACT_CONSTRAINTS_SHA256,
  STATIONARY_CONTACT_RECEIPT_SHA256,
  STATIONARY_HILL_PUBLISHED_CONTACT_ROUTE,
  STATIONARY_HILL_CONTACT_ROUTE,
} from '../lirm-stationary-hill-contact-core.mjs';
import {
  decodeHillMotionAffordancePacket,
} from '../hill-motion-affordance-source.mjs';
import {
  createHillMotionSupportIdentity,
  createHillSampledSupportSurface,
} from '../hill-motion-support-adapter.js';
import {
  locateEditablePrimitive,
  normalizePositions,
  parseGlb,
  readAccessor,
} from '../lirm-smooth-fitted-proxy-rig-assay.mjs';

const root = new URL('../', import.meta.url);
const [
  sourceBytes,
  registration,
  contactAtlas,
  phaseReport,
  handshake,
  hillPacket,
  hillData,
  publishedConstraintsBytes,
  publishedReceiptBytes,
] = await Promise.all([
  readFile(new URL('artifacts/motion-ready-719024/creature.glb', root)),
  readFile(
    new URL('artifacts/lirm-719024-fitted-proxy-rig-mechanism-witness-v1/registration.json', root),
    'utf8',
  ).then(JSON.parse),
  readFile(
    new URL('artifacts/lirm-719024-smooth-fitted-phase-exercise-v0/admitted-contact-atlas.json', root),
    'utf8',
  ).then(JSON.parse),
  readFile(
    new URL('artifacts/lirm-719024-smooth-fitted-phase-exercise-v0/report.json', root),
    'utf8',
  ).then(JSON.parse),
  readFile(
    new URL('artifacts/lirm-719024-motion-contact-probe-handshake-v0/stationary-hill-request-response.json', root),
    'utf8',
  ).then(JSON.parse),
  readFile(
    new URL('artifacts/motion-ready-719024/hill/motion-affordance-packet.json', root),
    'utf8',
  ).then(JSON.parse),
  readFile(
    new URL('artifacts/motion-ready-719024/hill/motion-affordance-data.json', root),
    'utf8',
  ).then(JSON.parse),
  readFile(
    new URL('artifacts/motion-ready-719024/stationary-contact-constraints/constraints.json', root),
    'utf8',
  ),
  readFile(
    new URL('artifacts/motion-ready-719024/stationary-contact-constraints/receipt.json', root),
    'utf8',
  ),
]);

const { json, binary } = parseGlb(sourceBytes);
const primitive = locateEditablePrimitive(json);
const sourcePositions = readAccessor(
  json,
  binary,
  primitive.attributes.POSITION,
  'VEC3',
).values;
const normalization = normalizePositions(sourcePositions);
assert.deepEqual(normalization.center, handshake.normalization.center);
assert.equal(normalization.scale, handshake.normalization.scale);

const placedRig = createSupportPlacedFittedRig({
  normalizedPositions: normalization.values,
  registration,
  normalization,
  bodyScale: handshake.prepass.body.scale,
  contactAtlas,
  contactAtlasSha256: phaseReport.contactAtlas.sha256,
  sampleCount: phaseReport.effectiveConfig.curveSampleCount,
});
const hillSource = decodeHillMotionAffordancePacket({ packet: hillPacket, data: hillData });
const supportSurface = createHillSampledSupportSurface(
  hillSource,
  createHillMotionSupportIdentity(hillPacket),
);
const packet = evaluateStationaryHillContactPhase({
  placedRig,
  supportSurface,
  prepass: handshake.prepass,
  contactAtlas,
  phase: handshake.request.phase / (Math.PI * 2),
  amplitude: phaseReport.effectiveConfig.amplitude,
  contactPlaneY: handshake.request.body.scale
    ? JSON.parse(await readFile(
      new URL('artifacts/motion-ready-719024/registration.json', root),
      'utf8',
    )).contactPlaneY
    : 0,
  clearance: 0.008,
  correctionGain: 0.82,
  iterationCount: 3,
});

assert.equal(packet.schema, 'kaminos.lirm-stationary-hill-contact-packet.v0');
assert.equal(packet.effectiveRoute, STATIONARY_HILL_CONTACT_ROUTE);
assert.equal(packet.request.contactAtlas.sha256, phaseReport.contactAtlas.sha256);
assert.deepEqual(packet.request.supportSurface, handshake.request.supportSurface);
assert.deepEqual(packet.request.body, handshake.request.body);
assert.deepEqual(packet.constraints.supportSurface, handshake.request.supportSurface);
assert.equal(packet.realized.contactRealization.directVertexTranslationCount, 0);
assert.equal(packet.realized.contactRealization.patches.length, 4);

const handshakeById = new Map(handshake.response.patches.map(patch => [patch.id, patch]));
for (const probe of packet.baseline.probes) {
  const expected = handshakeById.get(probe.id).worldPosition;
  const delta = Math.hypot(...probe.worldPosition.map((value, axis) => value - expected[axis]));
  assert.ok(delta < 1e-10, `${probe.id} support placement diverged from handshake by ${delta}`);
}

const baselineDistances = new Map(
  packet.constraints.patches.map(patch => [patch.id, Math.abs(patch.signedDistance - 0.008)]),
);
for (const patch of packet.realized.contactRealization.patches) {
  if (patch.contactState !== 'stance') continue;
  assert.ok(
    Math.abs(patch.residual) < baselineDistances.get(patch.id) * 0.55,
    `${patch.id} stance residual did not converge on the exact Hill`,
  );
}

const publishedConstraints = JSON.parse(publishedConstraintsBytes);
const publishedReceipt = JSON.parse(publishedReceiptBytes);
assert.equal(
  typeof stationaryContactCore.verifyPublishedStationaryContactArtifacts,
  'function',
  'stationary contact core must expose an exact-byte publication verifier',
);
const publication = await stationaryContactCore.verifyPublishedStationaryContactArtifacts({
  constraintsBytes: publishedConstraintsBytes,
  receiptBytes: publishedReceiptBytes,
});
const published = evaluatePublishedStationaryContactPhase({
  placedRig,
  prepass: handshake.prepass,
  publication,
  bodyPhase: publishedConstraints.phase / (Math.PI * 2),
  amplitude: phaseReport.effectiveConfig.amplitude,
  contactPlaneY: JSON.parse(await readFile(
    new URL('artifacts/motion-ready-719024/registration.json', root),
    'utf8',
  )).contactPlaneY,
  includeBaseline: false,
});
assert.equal(published.effectiveRoute, STATIONARY_HILL_PUBLISHED_CONTACT_ROUTE);
assert.equal(published.baseline, null);
assert.equal(published.publication.receiptSha256, STATIONARY_CONTACT_RECEIPT_SHA256);
assert.equal(published.publication.constraintsSha256, STATIONARY_CONTACT_CONSTRAINTS_SHA256);
assert.deepEqual(published.constraints, publishedConstraints);
assert.deepEqual(
  published.constraints.patches.map(({ id, signedDistance }) => ({ id, signedDistance })),
  publishedConstraints.patches.map(({ id, signedDistance }) => ({ id, signedDistance })),
  'published signed distances and ordering must survive application exactly',
);
assert.equal(published.realized.contactRealization.directVertexTranslationCount, 0);
assert.throws(
  () => evaluatePublishedStationaryContactPhase({
    placedRig: {
      ...placedRig,
      probeBinding: {
        ...placedRig.probeBinding,
        contactAtlasSha256: `sha256:${'0'.repeat(64)}`,
      },
    },
    prepass: handshake.prepass,
    publication,
    bodyPhase: publishedConstraints.phase / (Math.PI * 2),
    amplitude: phaseReport.effectiveConfig.amplitude,
    contactPlaneY: 0,
  }),
  /stationary contact atlas identity mismatch/,
  'published constraints must reject a same-cast atlas with divergent influence-region bytes',
);

assert.throws(
  () => evaluatePublishedStationaryContactPhase({
    placedRig,
    prepass: handshake.prepass,
    publication: {
      constraints: structuredClone(publishedConstraints),
      constraintsSha256: STATIONARY_CONTACT_CONSTRAINTS_SHA256,
      receipt: structuredClone(publishedReceipt),
      receiptSha256: STATIONARY_CONTACT_RECEIPT_SHA256,
    },
    bodyPhase: 0,
    amplitude: phaseReport.effectiveConfig.amplitude,
    contactPlaneY: 0,
  }),
  /verified publication bytes/,
  'caller-crafted parsed publication objects must fail before fitted-body application',
);

const forgedConstraintBytes = Buffer.from(
  publishedConstraintsBytes.replace('0.19032828738339705', '9.19032828738339705'),
);
await assert.rejects(
  () => stationaryContactCore.verifyPublishedStationaryContactArtifacts({
    constraintsBytes: forgedConstraintBytes,
    receiptBytes: publishedReceiptBytes,
  }),
  /constraints hash mismatch/,
  'mutated constraint bytes must not inherit the reviewed claimed hash',
);

process.stdout.write('lirm stationary Hill contact contracts passed\n');
