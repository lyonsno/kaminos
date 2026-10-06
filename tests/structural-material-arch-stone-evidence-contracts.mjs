import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { STONE_ASSETS, inspectStoneVisual, stoneAssetsForDetail } from '../structural-material-arch-stones.js';
assert.ok(inspectStoneVisual({ visual: { route: 'box-baseline' } }).length, 'box fallback cannot prove a stone consumer');
const assets = STONE_ASSETS.map(asset => {
  const bytes = fs.readFileSync(new URL(`../${asset.url}`, import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256);
  const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)));
  return { ...asset, bytes: bytes.length, triangles: json.accessors[json.meshes[0].primitives[0].indices].count / 3 };
});
const witness = { visual: { route: 'handy-weathered-stone-v1', assets, bodies: assets.map((asset, index) => ({ index, asset: asset.id })), triangles: assets.reduce((n, a) => n + a.triangles, 0) }, state: { bodies: assets.map((_, index) => ({ index })) } };
assert.deepEqual(inspectStoneVisual(witness), []);
const substituted = structuredClone(witness); substituted.visual.detail = '5k';
assert.ok(inspectStoneVisual(substituted).length, 'original geometry cannot prove the requested 5k route');
for (const mutate of [w => w.visual.assets.pop(), w => w.visual.assets[0].sha256 = 'stale', w => w.visual.bodies[0].asset = null, w => w.visual.bodies.pop(), w => w.visual.triangles = 0]) {
  const bad = structuredClone(witness); mutate(bad); assert.ok(inspectStoneVisual(bad).length);
}
for (const detail of ['5k', '10k']) {
  const [entry] = stoneAssetsForDetail(detail), bytes = fs.readFileSync(new URL(`../${entry.url}`, import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256);
  const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)));
  const triangles = json.accessors[json.meshes[0].primitives[0].indices].count / 3;
  assert.equal(triangles, entry.triangles);
  const displayed = { ...entry, bytes: bytes.length, triangles };
  const low = { visual: { route: 'handy-weathered-stone-v1', detail, assets: [displayed], bodies: [{ index: 0, asset: entry.id }], triangles }, state: { bodies: [{ index: 0 }] } };
  assert.deepEqual(inspectStoneVisual(low, detail), []);
  assert.ok(inspectStoneVisual(low, detail === '5k' ? '10k' : '5k').length);
  low.visual.assets[0].triangles++; low.visual.triangles++;
  assert.ok(inspectStoneVisual(low, detail).length);
}
assert.throws(() => stoneAssetsForDetail('unknown'), /Unknown stone detail/);
assert.throws(() => stoneAssetsForDetail('constructor'), /Unknown stone detail/);
console.log('Stone source hashes and false-closure evidence contracts pass');
