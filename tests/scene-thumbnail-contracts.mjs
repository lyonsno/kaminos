import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSceneDocument } from '../scene-persistence-core.js';
import { composeSceneThumbnail, sceneThumbnailSize } from '../scene-authoring.mjs';

const jpeg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';

test('saved scenes keep a small image of the view', () => {
  assert.equal(buildSceneDocument({ thumbnail: jpeg }).thumbnail, jpeg);
  assert.equal('thumbnail' in buildSceneDocument({}), false, 'scenes saved without one stay as they were');
  assert.throws(() => buildSceneDocument({ thumbnail: 'javascript:alert(1)' }), /thumbnail/i);
});

test('thumbnails are about 320 px wide whatever the viewport', () => {
  assert.deepEqual(sceneThumbnailSize(2176, 1550), { width: 320, height: 228 });
  assert.deepEqual(sceneThumbnailSize(1000, 2000), { width: 160, height: 320 });
  assert.deepEqual(sceneThumbnailSize(200, 100), { width: 200, height: 100 });
});

test('the thumbnail composes the flame canvas over the scene canvas at its on-screen place', () => {
  const draws = [];
  const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: (...args) => draws.push(args) }), toDataURL: (type, quality) => `data:${type};base64,AAAA` };
  const document = { createElement: () => canvas };
  const host = { width: 2000, height: 1000, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 500 }) };
  const volume = { width: 400, height: 400, getBoundingClientRect: () => ({ left: 250, top: 125, width: 500, height: 250 }) };
  const image = composeSceneThumbnail({ host, volume, document });
  assert.equal(image, 'data:image/jpeg;base64,AAAA');
  assert.deepEqual([canvas.width, canvas.height], [320, 160]);
  assert.deepEqual(draws[0], [host, 0, 0, 320, 160]);
  assert.deepEqual(draws[1], [volume, 80, 40, 160, 80]);
  assert.equal(composeSceneThumbnail({ host: { width: 0, height: 0 }, document }), null, 'no visible canvas, no thumbnail');
});
