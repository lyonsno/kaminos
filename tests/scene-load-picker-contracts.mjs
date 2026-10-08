import test from 'node:test';
import assert from 'node:assert/strict';
import { sceneMatchesFilter, sortScenesNewestFirst } from '../scene-load-picker.mjs';

test('saved scenes list newest first and filter by label or file name words', () => {
  const scenes = [
    { name: 'old.kaminos.json', label: 'Kiln study', timestamp: '2026-10-01T10:00:00Z' },
    { name: 'chair-pass.kaminos.json', label: 'Chair pass', timestamp: '2026-10-07T10:00:00Z' },
    { name: 'undated.kaminos.json', label: '' },
  ];
  assert.deepEqual(sortScenesNewestFirst(scenes).map(scene => scene.name), ['chair-pass.kaminos.json', 'old.kaminos.json', 'undated.kaminos.json']);
  assert.equal(sceneMatchesFilter(scenes[0], 'kiln STUDY'), true);
  assert.equal(sceneMatchesFilter(scenes[1], 'chair kiln'), false);
  assert.equal(sceneMatchesFilter(scenes[2], 'undated'), true);
  assert.equal(sceneMatchesFilter(scenes[2], ''), true);
});
