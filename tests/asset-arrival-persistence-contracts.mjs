import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSceneDocument, planSceneRestore } from '../scene-persistence-core.js';

const leveling = { storedQuaternion: [0.0858, 0, 0, 0.9963], leveledQuaternion: [0, 0, 0, 1], tiltDeg: 9.85 };
const glb = (extra = {}) => ({
  id: 'glb-1', type: 'glb', source: '/api/read?root=generated-meshes&path=chair.glb', fileName: 'chair.glb',
  transform: { position: [0, -0.1, 0], rotation: [0, 0, 0], scale: [1.68, 1.68, 1.68] }, ...extra,
});

test('a saved scene keeps an object\'s arrival leveling through save and restore planning', () => {
  const document = buildSceneDocument({ objects: [glb({ arrivalLeveling: leveling })] });
  assert.deepEqual(document.objects[0].arrivalLeveling, leveling);
  const restored = planSceneRestore(JSON.parse(JSON.stringify(document)));
  const record = (restored.objects || restored.records || []).find(item => item.id === 'glb-1');
  assert.deepEqual(record?.arrivalLeveling, leveling);
});

test('objects without arrival leveling save without the field', () => {
  const document = buildSceneDocument({ objects: [glb()] });
  assert.equal('arrivalLeveling' in document.objects[0], false);
});
