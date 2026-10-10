import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';

test('presented-frame pixels distinguish real content from blank capture', async () => {
  const { pixelSummary } = await import('./photo-contracts.js');
  assert.equal(typeof pixelSummary, 'function', 'Presented-frame pixel admission is missing');
  assert.equal(pixelSummary(new Uint8Array(16), 2, 2).nonBackground, 0);
  const live = pixelSummary(new Uint8Array([0,0,0,255, 200,50,30,255]), 2, 1);
  assert.equal(live.range, 200);
  assert.equal(live.nonBackground, 1);
  assert.throws(() => pixelSummary(new Uint8Array(4), 2, 2), /dimensions/);
});

test('material photograph exposes aligned map and selection contracts', async () => {
  const url = new URL('./photo-contracts.js', import.meta.url);
  assert.ok(existsSync(url), 'The material photograph has no map alignment or selection lifecycle contract');
  const { texturePixels, createPhotoRunState } = await import(url);
  const map = { width: 2, height: 2, data: new Uint8Array([
    1,2,3,255, 4,5,6,255, 7,8,9,255, 10,11,12,255,
  ]) };
  const color = texturePixels(map, 'albedo');
  assert.deepEqual(Array.from(color.data), [7,8,9,255,10,11,12,255,1,2,3,255,4,5,6,255]);
  assert.equal(color.color, true);
  assert.equal(texturePixels(map, 'orm').color, false);
  assert.equal(texturePixels(map, 'roughness').color, false);
  assert.equal(texturePixels(map, 'metallic').color, false);
  assert.throws(() => texturePixels({ ...map, data: map.data.slice(4) }, 'albedo'), /dimensions/);
  assert.throws(() => texturePixels(map, 'surprise'), /role/);
  assert.equal(map.data[0], 1, 'renderer preparation must not mutate the model output');

  const state = createPhotoRunState();
  const a = state.select('celebration');
  state.publish(a, 'geometry', { depth: true });
  assert.equal(state.snapshot().geometry.depth, true);
  const b = state.select('bag');
  assert.equal(state.snapshot().geometry, null);
  assert.equal(state.snapshot().materials, null);
  assert.throws(() => state.publish(a, 'materials', { old: true }), /superseded/);
  assert.throws(() => state.publish(b, 'materials', { maps: true }), /geometry/);
  state.publish(b, 'geometry', { depth: true });
  state.publish(b, 'materials', { maps: true });
  assert.equal(state.snapshot().materials.maps, true);
});
