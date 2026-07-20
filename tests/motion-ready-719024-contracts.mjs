import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const root = new URL('../artifacts/motion-ready-719024/', import.meta.url);
const registration = JSON.parse(await readFile(new URL('registration.json', root), 'utf8'));
const receipt = JSON.parse(await readFile(new URL('receipt.json', root), 'utf8'));

assert.equal(registration.schema, 'kaminos.axial-crawler-registration.v0');
assert.deepEqual(registration.localForwardAxis, [0, 0, -1]);
assert.deepEqual(registration.localUpAxis, [0, 1, 0]);
assert.equal(registration.contactPlaneY, -0.2068822681903839);
assert.equal(registration.spineStations.length, 7);
assert.deepEqual(registration.spineStations.map(station => station.id), [
  'tail', 'caudal', 'rear-trunk', 'mid-trunk', 'front-trunk', 'neck', 'head',
]);
assert.ok(registration.spineStations.every((station, index, stations) =>
  index === 0 || station.localPosition[2] < stations[index - 1].localPosition[2]));

for (const [name, expected] of Object.entries(receipt.files)) {
  const bytes = await readFile(new URL(name, root));
  assert.equal(bytes.byteLength, expected.bytes, `${name} byte count`);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), expected.sha256, `${name} checksum`);
}

assert.equal(receipt.effectiveRoute.generator, 'trellis2mlx');
assert.equal(receipt.effectiveRoute.steps, 6);
assert.equal(receipt.effectiveRoute.cascade, false);
assert.equal(receipt.effectiveRoute.durationSeconds, 58.8);
assert.equal(receipt.mesh.postCleanupFaces, 188385);

console.log('motion-ready-719024 contracts passed');
