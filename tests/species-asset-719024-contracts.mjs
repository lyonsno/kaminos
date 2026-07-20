import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const manifestUrl = new URL('../artifacts/species-asset-contract-v0/motion-ready-719024.json', import.meta.url);
const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));
const packageRoot = new URL('../artifacts/motion-ready-719024/', import.meta.url);

assert.equal(manifest.schema, 'kaminos.species-asset.v0');
assert.equal(manifest.asset.format, 'glTF-2.0-GLB');
assert.deepEqual(manifest.coordinates.up, [0, 1, 0]);
assert.deepEqual(manifest.coordinates.forward, [0, 0, -1]);
assert.equal(manifest.coordinates.unit, 'meter');
assert.equal(manifest.root.kind, 'terrain-contact-root');
assert.equal(manifest.root.localPoint[1], manifest.bounds.min[1]);
assert.deepEqual(manifest.root.localToRootTranslation, manifest.root.localPoint.map(value => -value));

assert.equal(manifest.material.workflow, 'glTF-metallic-roughness');
assert.equal(manifest.material.baseColor.colorSpace, 'sRGB');
assert.equal(manifest.material.metallicRoughness.colorSpace, 'linear');
assert.equal(manifest.material.metallicRoughness.channels.roughness, 'G');
assert.equal(manifest.material.metallicRoughness.channels.metallic, 'B');

assert.equal(manifest.deformation.mode, 'axial-parallel-transport-wave-v1');
assert.equal(manifest.deformation.space, 'asset-local-before-root-transform');
assert.equal(manifest.deformation.zeroState, 'identity-within-floating-point-error');
assert.equal(manifest.deformation.frame.rightRule, 'normalize(cross(tangentHeadward, upReference))');
assert.equal(manifest.deformation.frame.upRule, 'normalize(cross(right, tangentHeadward))');
assert.deepEqual(manifest.deformation.frame.upReference, [0, 1, 0]);
assert.equal(manifest.deformation.endpointResidual.mode, 'preserve-signed-axial-residual');
assert.equal(manifest.deformation.endpointResidual.verticesOutsideStationSpan, 1984);
assert.equal(manifest.deformation.endpointResidual.vertexFraction, 0.0134);
assert.deepEqual(manifest.motionClass, {
  id: 'axial-squirm-class',
  bodyPlan: 'elongated-crawler',
  compatibility: [{
    deformationMode: 'axial-parallel-transport-wave-v1',
    mechanical: 'pass',
    perceptual: 'pass',
    promotion: 'allowed',
    evidenceRef: 'livingworld:cc/green-thumbsucker-foliage-spine-0720@2313132',
  }],
  handoffGate: {
    requiredWitness: 'world-like-moving',
    status: 'passed',
  },
});
assert.deepEqual(manifest.instance.scale, [1.14, 1.14, 1.14]);
assert.equal(manifest.instance.terrainContactOffsetWorld, 0.23584578573703763);
assert.match(manifest.root.applicationOrder, /instance scale/);
assert.equal(manifest.runtimeGate.maxCreatureInstances, 1);
assert.equal(manifest.runtimeGate.currentMotionPromotion, 'allowed');
assert.equal(
  manifest.motionClass.compatibility[0].promotion,
  manifest.runtimeGate.currentMotionPromotion,
);
assert.equal(manifest.lods.length, 1);

for (const entry of [manifest.asset, manifest.registration]) {
  const bytes = await readFile(new URL(entry.path.replace('artifacts/motion-ready-719024/', ''), packageRoot));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256);
}

console.log('species-asset-719024 contracts passed');
