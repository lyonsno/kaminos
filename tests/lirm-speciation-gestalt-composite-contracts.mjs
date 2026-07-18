import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const {
  createLirmGestaltEnvelopeFromLatentGeneration,
  createLirmSpeciationArmatureGestaltCompositeBundle,
  createLirmSpeciationArmatureImplicitBodyBundle,
  createLirmSpeciationArmatureWitness,
  decodeBinaryPgmMask,
  writeLirmSpeciationArmatureGestaltCompositeWitness,
} = await import('../lirm-speciation-armature-core.js');

function gestaltMask(width = 64, height = 64) {
  const data = Array(width * height).fill(0);
  for (let y = 7; y < height - 7; y += 1) {
    const normalizedY = (y - height / 2) / (height / 2);
    const halfWidth = Math.round(11 + 13 * Math.abs(normalizedY) + (normalizedY < -0.25 ? 5 : 0));
    for (let x = width / 2 - halfWidth; x <= width / 2 + halfWidth; x += 1) {
      data[y * width + x] = 1;
    }
  }
  return { width, height, data };
}

function sourceMaskHash(mask) {
  return `sha256:${createHash('sha256').update(Buffer.from(mask.data.map(value => value ? 1 : 0))).digest('hex')}`;
}

const witness = createLirmSpeciationArmatureWitness({
  seed: 'molten-lirm-seed-0707',
  candidateCount: 25,
  columns: 5,
});
const decodedFixture = decodeBinaryPgmMask(Buffer.concat([
  Buffer.from('P5\n# source fixture\n8 8\n255\n', 'ascii'),
  Buffer.from(Array.from({ length: 64 }, (_, index) => index % 3 === 0 ? 255 : 0)),
]));
assert.equal(decodedFixture.width, 8);
assert.equal(decodedFixture.height, 8);
assert.equal(decodedFixture.data.filter(Boolean).length, 22);
assert.throws(() => decodeBinaryPgmMask(Buffer.from('P2\n8 8\n255\n')), /binary P5/);
const candidateId = 'lirm-armature-22';
const baseline = createLirmSpeciationArmatureImplicitBodyBundle({ witness, candidateId });
const envelope = {
  id: 'basin-10-s3p00-n00',
  mask: gestaltMask(),
  pressure: 0.46,
  depthRadius: 0.22,
  lineage: {
    route: 'mlx-sdf-vae-posterior-basin-perturbation-v0',
    sourceBasinIndex: 10,
    posteriorStrength: 3,
    parentShapeIds: ['sha256:source-shape-a'],
  },
};
const verifiedReceipt = {
  schema: 'kaminos.lirm-silhouette-basin-latent.v0',
  routeIdentity: {
    requestedRoute: 'kaminos/lirm-speciation-armature/silhouette-basin-latent-v0',
    effectiveRoute: 'mlx-sdf-vae-posterior-basin-perturbation-v0',
  },
  generations: [{
    generationId: envelope.id,
    sourceBasinIndex: 10,
    sourceShapeId: 'sha256:source-shape-a',
    strength: 3,
    maskHash: sourceMaskHash(envelope.mask),
    maskPath: `generated/${envelope.id}.pgm`,
    acceptedForDownstream: true,
  }],
};
const normalizedEnvelope = createLirmGestaltEnvelopeFromLatentGeneration({
  shapeSpaceReceipt: verifiedReceipt,
  generationId: envelope.id,
  mask: envelope.mask,
  pressure: envelope.pressure,
  depthRadius: envelope.depthRadius,
});
assert.equal(normalizedEnvelope.id, envelope.id);
assert.equal(normalizedEnvelope.lineage.effectiveRoute, 'mlx-sdf-vae-posterior-basin-perturbation-v0');
assert.equal(normalizedEnvelope.lineage.sourceBasinIndex, 10);
assert.equal(normalizedEnvelope.lineage.posteriorStrength, 3);
assert.equal(normalizedEnvelope.lineage.sourceMaskHash, sourceMaskHash(envelope.mask));
assert.throws(
  () => createLirmGestaltEnvelopeFromLatentGeneration({
    shapeSpaceReceipt: {
      ...verifiedReceipt,
      routeIdentity: { ...verifiedReceipt.routeIdentity, effectiveRoute: 'fallback-route' },
    },
    generationId: envelope.id,
    mask: envelope.mask,
    pressure: envelope.pressure,
  }),
  /unexpected effective route/,
);
assert.throws(
  () => createLirmGestaltEnvelopeFromLatentGeneration({
    shapeSpaceReceipt: {
      ...verifiedReceipt,
      generations: [{ ...verifiedReceipt.generations[0], maskHash: 'sha256:wrong' }],
    },
    generationId: envelope.id,
    mask: envelope.mask,
    pressure: envelope.pressure,
  }),
  /mask hash mismatch/,
);
const composite = createLirmSpeciationArmatureGestaltCompositeBundle({ witness, candidateId, gestaltEnvelope: envelope });

assert.equal(composite.schema, 'kaminos.lirm-speciation-armature-gestalt-composite-bundle.v0');
assert.equal(composite.route, 'kaminos/lirm-speciation-armature/gestalt-composite-v0');
assert.equal(composite.candidateId, candidateId);
assert.equal(composite.fieldModel.kind, 'smooth-sdf-metaball-silhouette-morph');
assert.equal(composite.fieldModel.actual3dStructure, true);
assert.equal(composite.fieldModel.gestaltPressure, 0.46);
assert.equal(composite.gestaltEnvelope.id, envelope.id);
assert.equal(composite.gestaltEnvelope.lineage.sourceBasinIndex, 10);
assert.deepEqual(composite.dualLineage.armature, {
  witnessId: witness.witnessId,
  candidateId,
  candidateSeed: witness.candidates.find(item => item.id === candidateId).seed,
});
assert.equal(composite.dualLineage.silhouette.maskHash, composite.gestaltEnvelope.maskHash);
assert.match(composite.gestaltEnvelope.maskHash, /^sha256:/);
assert.notEqual(
  composite.renderMaps.find(item => item.kind === 'mask').svg,
  baseline.renderMaps.find(item => item.kind === 'mask').svg,
  'gestalt pressure must materially change the rendered body silhouette',
);
for (const kind of ['clay', 'depth', 'normal', 'mask', 'semantic']) {
  const map = composite.renderMaps.find(item => item.kind === kind);
  assert.ok(map, `missing ${kind} composite map`);
  assert.match(map.svg, /data-field-kind="smooth-sdf-metaball-silhouette-morph"/);
  assert.match(map.svg, /data-gestalt-envelope-id="basin-10-s3p00-n00"/);
}
assert.match(composite.trellisSource.svg, /data-field-kind="smooth-sdf-metaball-silhouette-morph"/);
assert.equal(composite.falseClosureGuards.flatExtrusionClaim, 'forbidden');
assert.equal(composite.falseClosureGuards.dualLineageVerified, true);

assert.throws(
  () => createLirmSpeciationArmatureGestaltCompositeBundle({
    witness,
    candidateId,
    gestaltEnvelope: { ...envelope, pressure: 0 },
  }),
  /pressure must be greater than zero/,
);

const outDir = await mkdtemp(join(tmpdir(), 'kaminos-lirm-gestalt-composite-contract-'));
const writeResult = await writeLirmSpeciationArmatureGestaltCompositeWitness({
  outDir,
  witness,
  compositions: [{ candidateId, gestaltEnvelope: envelope }],
});
assert.equal(writeResult.schema, 'kaminos.lirm-speciation-armature-gestalt-composite-write-result.v0');
assert.equal(writeResult.bundleCount, 1);
assert.ok(existsSync(join(outDir, 'receipt.json')));
assert.ok(existsSync(join(outDir, `${candidateId}__${envelope.id}`, 'gestalt-mask.pgm')));
assert.ok(existsSync(join(outDir, `${candidateId}__${envelope.id}`, 'clay-composite.png')));
assert.ok(existsSync(join(outDir, `${candidateId}__${envelope.id}`, 'depth-composite.png')));
assert.ok(existsSync(join(outDir, `${candidateId}__${envelope.id}`, 'normal-composite.png')));
assert.ok(existsSync(join(outDir, `${candidateId}__${envelope.id}`, 'trellis-source.png')));

const receipt = JSON.parse(readFileSync(join(outDir, 'receipt.json'), 'utf8'));
assert.equal(receipt.schema, 'kaminos.lirm-speciation-armature-gestalt-composite-witness.v0');
assert.equal(receipt.status, 'complete');
assert.equal(receipt.bundles.length, 1);
assert.equal(receipt.bundles[0].dualLineage.silhouette.maskHash, composite.gestaltEnvelope.maskHash);
assert.equal(receipt.falseClosureGuards.dualLineageVerifiedCount, 1);
assert.equal(receipt.outputInventory.bundles[0].gestaltMask, `${candidateId}__${envelope.id}/gestalt-mask.pgm`);
assert.ok(Array.isArray(receipt.outputEvidence));
assert.ok(receipt.outputEvidence.length >= 14, 'receipt must hash every bundle, mask, vector, and raster output');
for (const evidence of receipt.outputEvidence) {
  assert.match(evidence.path, /^[^/].+/);
  assert.match(evidence.sha256, /^sha256:[0-9a-f]{64}$/);
  assert.ok(evidence.byteSize > 0, `expected nonempty evidence output ${evidence.path}`);
}
assert.ok(receipt.outputEvidence.some(item => item.path.endsWith('/gestalt-mask.pgm')));
assert.ok(receipt.outputEvidence.some(item => item.path.endsWith('/trellis-source.png')));

console.log('LIRM speciation gestalt composite contracts passed');
