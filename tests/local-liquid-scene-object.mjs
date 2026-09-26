import test from 'node:test';
import * as localLiquidSceneObjectModule from '../local-liquid-scene-object.mjs';
import assert from 'node:assert/strict';
import {
  createLocalLiquidEmitterObject,
  createLocalLiquidEmitterSceneRecord,
  localLiquidRuntimeSourceState,
} from '../local-liquid-scene-object.mjs';
import { defaultLocalLiquidSetup } from '../local-liquid-setup.mjs';

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

test('removing the final emitter emits an empty inlet update while retaining the scene domain', () => {
  const state = localLiquidRuntimeSourceState({
    objects: [],
    localLiquid: defaultLocalLiquidSetup(),
  }, 7);
  assert.equal(state.participation, 'authored-domain-present');
  assert.deepEqual(state.domain, defaultLocalLiquidSetup());
  assert.equal(state.inletPacket.packet_id, 'kaminos-authored-liquid-7');
  assert.deepEqual(state.inletPacket.emitters, []);
});

test('partial authored transform patches merge into the accepted pose before aperture validation', () => {
  const mergeAndValidate = localLiquidSceneObjectModule.mergeAndValidateLocalLiquidEmitterPose;
  assert.equal(typeof mergeAndValidate, 'function', 'scene transforms must validate the merged pose, not an incomplete patch');
  const current = { position: [0, 0.45, -1.3], rotation: [0.24, 0, 0], scale: [1, 1, 1] };
  assert.deepEqual(mergeAndValidate({ schema: 'kaminos.local-liquid-emitter.v1', baseRadius: 0.08, strength: 1.15, rate: 1200 }, current, {
    position: [0.2, 0.45, -1.3],
  }), { position: [0.2, 0.45, -1.3], rotation: [0.24, 0, 0], scale: [1, 1, 1] });
  assert.throws(() => mergeAndValidate({ schema: 'kaminos.local-liquid-emitter.v1', baseRadius: 0.08, strength: 1.15, rate: 1200 }, current, {
    scale: [3, 3, 3],
  }), /aperture must stay between/);
});
