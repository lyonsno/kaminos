import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createLocalLiquidEmitterObject,
  createLocalLiquidEmitterSceneRecord,
} from '../local-liquid-scene-object.mjs';

class Vec3 {
  fromArray(values) { this.values = [...values]; }
  set(...values) { this.values = values; }
}

class Group {
  position = new Vec3();
  rotation = new Vec3();
  scale = new Vec3();
  userData = {};
  add(...children) { this.children = children; }
}

class Mesh {
  position = new Vec3();
  rotation = new Vec3();
  constructor(geometry, material) { this.geometry = geometry; this.material = material; }
}

const THREE = {
  Group,
  Mesh,
  CylinderGeometry: class {},
  MeshStandardMaterial: class {},
};

test('a saved water emitter rehydrates with its authored settings and stable ID', () => {
  const saved = createLocalLiquidEmitterSceneRecord({
    id: 'water-saved-1',
    transform: { position: [0.2, 0.8, -0.1], rotation: [0.1, 0.2, 0.3], scale: [1, 1, 1] },
    settings: { schema: 'kaminos.local-liquid-emitter.v1', baseRadius: 0.11, strength: 1.7, rate: 740 },
    label: 'Saved source',
    fileName: 'water-source.custom',
    groupId: 'collection-study',
    createdAt: '2026-09-26T00:00:00Z',
  });
  saved.fileName = 'water-source.custom';
  saved.groupId = 'collection-study';
  const { object, record } = createLocalLiquidEmitterObject(THREE, saved);
  assert.equal(record.id, saved.id);
  assert.deepEqual(record.transform, saved.transform);
  assert.deepEqual(record.localLiquidEmitter, saved.localLiquidEmitter);
  assert.equal(record.fileName, saved.fileName);
  assert.equal(record.groupId, saved.groupId);
  assert.deepEqual(object.userData.kaminosSceneObject.localLiquidEmitter, saved.localLiquidEmitter);
  assert.equal(object.userData.kaminosSceneObject.groupId, saved.groupId);
});

test('a saved water emitter without settings cannot rehydrate as a default source', () => {
  const saved = createLocalLiquidEmitterSceneRecord({
    id: 'water-missing-settings',
    transform: { position: [0, 1, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
  });
  delete saved.localLiquidEmitter;
  assert.throws(() => createLocalLiquidEmitterObject(THREE, saved), /missing its saved settings/i);
});
