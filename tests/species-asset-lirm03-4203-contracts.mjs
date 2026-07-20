import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const packageRoot = new URL('../artifacts/motion-ready-lirm03-4203/', import.meta.url);
const manifestUrl = new URL(
  '../artifacts/species-asset-contract-v0/motion-ready-lirm03-4203.json',
  import.meta.url,
);

const registration = JSON.parse(await readFile(new URL('registration.json', packageRoot), 'utf8'));
const receipt = JSON.parse(await readFile(new URL('receipt.json', packageRoot), 'utf8'));
const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));

assert.equal(registration.schema, 'kaminos.axial-crawler-registration.v0');
assert.equal(registration.asset, 'creature.glb');
assert.deepEqual(registration.localForwardAxis, [0, 0, -1]);
assert.deepEqual(registration.localUpAxis, [0, 1, 0]);
assert.equal(registration.contactPlaneY, -0.15831834077835083);
assert.deepEqual(registration.headAnchor, [0, 0, -0.47]);
assert.deepEqual(registration.tailAnchor, [0, 0, 0.47]);
assert.equal(registration.spineStations.length, 7);
assert.ok(registration.spineStations.every((station, index, stations) =>
  index === 0 || station.localPosition[2] < stations[index - 1].localPosition[2]));

assert.equal(receipt.schema, 'kaminos.motion-ready-cast-receipt.v0');
assert.equal(receipt.castId, 'motion-ready-lirm03-4203');
assert.equal(receipt.sourceImage.seed, 4203);
assert.equal(receipt.effectiveRoute.generator, 'trellis2mlx');
assert.equal(receipt.effectiveRoute.seed, 42);
assert.equal(receipt.effectiveRoute.steps, 4);
assert.equal(receipt.effectiveRoute.durationSeconds, 65.6);
assert.equal(receipt.mesh.vertices, 153090);
assert.equal(receipt.mesh.postCleanupFaces, 129804);

assert.equal(manifest.schema, 'kaminos.species-asset.v0');
assert.equal(manifest.speciesId, 'lirm-crustacean-4203');
assert.equal(manifest.asset.vertices, 153090);
assert.equal(manifest.asset.faces, 129804);
assert.deepEqual(manifest.coordinates.forward, [0, 0, -1]);
assert.equal(manifest.root.kind, 'terrain-contact-root');
assert.equal(manifest.root.localPoint[1], manifest.bounds.min[1]);
assert.deepEqual(manifest.root.localToRootTranslation, manifest.root.localPoint.map(value => -value));
assert.equal(manifest.deformation.mode, 'axial-parallel-transport-wave-v1');
assert.equal(manifest.deformation.endpointResidual.mode, 'preserve-signed-axial-residual');
assert.equal(manifest.deformation.endpointResidual.verticesOutsideStationSpan, 2346);
assert.equal(manifest.deformation.stateCompatibility, 'kaminos.motion-ready-719024.axial-squirm-state.v1');
assert.ok(manifest.deformation.reuseProbe.maxZeroStateError < 2e-6);
assert.equal(manifest.deformation.reuseProbe.activeStateFinite, true);
assert.equal(manifest.runtimeGate.maxCreatureInstances, 1);
assert.ok(manifest.runtimeGate.unclaimed.includes('third-species compatibility'));

for (const [name, expected] of Object.entries(receipt.files)) {
  const bytes = await readFile(new URL(name, packageRoot));
  assert.equal(bytes.byteLength, expected.bytes, `${name} byte count`);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), expected.sha256, `${name} checksum`);
}

for (const entry of [manifest.asset, manifest.registration]) {
  const name = entry.path.split('/').at(-1);
  const bytes = await readFile(new URL(name, packageRoot));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256);
}

console.log('species-asset-lirm03-4203 contracts passed');
