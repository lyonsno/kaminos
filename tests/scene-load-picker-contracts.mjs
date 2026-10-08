import test from 'node:test';
import assert from 'node:assert/strict';
import { collapseIdenticalScenes, mergeForeignTwins, sceneMatchesFilter, sortScenesNewestFirst } from '../scene-load-picker.mjs';

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

test('scenes from other servers list after this server and match their server name', () => {
  const scenes = [
    { name: 'tuned.kaminos.json', label: 'Unified lighting', timestamp: '2026-10-08T17:37:04Z', store: { id: 'a1', label: 'beaming-scene-source-0927' } },
    { name: 'mine.kaminos.json', label: 'Mine', timestamp: '2026-10-01T00:00:00Z' },
  ];
  assert.deepEqual(sortScenesNewestFirst(scenes).map(scene => scene.name), ['mine.kaminos.json', 'tuned.kaminos.json']);
  assert.equal(sceneMatchesFilter(scenes[0], 'beaming lighting'), true);
});

test('identical scenes on this server list once with a count of the copies', () => {
  const scenes = collapseIdenticalScenes([
    { name: 'kiln_a.kaminos.json', contentKey: 'k1', timestamp: '2026-10-08T10:00:00Z' },
    { name: 'kiln_b.kaminos.json', contentKey: 'k1', timestamp: '2026-10-08T10:00:00Z' },
    { name: 'kiln_c.kaminos.json', contentKey: 'k1', timestamp: '2026-10-08T10:00:00Z' },
    { name: 'other.kaminos.json', contentKey: 'k2' },
    { name: 'unread.kaminos.json' },
  ]);
  assert.deepEqual(scenes.map(scene => [scene.name, scene.copies || 0]), [['kiln_a.kaminos.json', 2], ['other.kaminos.json', 0], ['unread.kaminos.json', 0]]);
});

test('a scene here and on another server shows once, keeping that server as its mesh source', () => {
  const local = [{ name: 'kiln.kaminos.json', label: 'Kiln' }, { name: 'mine.kaminos.json', label: 'Mine' }];
  const foreign = [
    { name: 'kiln_copy.kaminos.json', alsoHere: 'kiln.kaminos.json', store: { id: 's1', label: 'beaming' } },
    { name: 'tuned.kaminos.json', store: { id: 's1', label: 'beaming' } },
  ];
  const { local: merged, foreign: rest } = mergeForeignTwins(local, foreign);
  assert.deepEqual(merged[0].recoverFrom, { store: { id: 's1', label: 'beaming' }, name: 'kiln_copy.kaminos.json' });
  assert.equal(merged[1].recoverFrom, undefined);
  assert.deepEqual(rest.map(scene => scene.name), ['tuned.kaminos.json']);
  const orphan = mergeForeignTwins([], [{ name: 'x.kaminos.json', alsoHere: 'gone.kaminos.json', store: { id: 's2' } }]);
  assert.deepEqual(orphan.foreign.map(scene => scene.name), ['x.kaminos.json'], 'a twin whose local scene is not listed stays visible');
});
