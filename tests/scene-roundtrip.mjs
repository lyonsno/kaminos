import assert from 'node:assert/strict';

import {
  SCENE_SCHEMA,
  buildSceneDocument,
  getSceneObjectRecords,
  isReloadableSceneObjectRecord,
  planSceneRestore,
  sceneDocumentIsLoadable,
  sceneObjectToLegacyModel,
} from '../scene-persistence-core.js';

const volumePrimitives = {
  schema: 'kaminos.volume-primitives.v0',
  selectedVolumePrimitiveId: 'fixture-fire-smoke-sphere',
  primitives: [
    {
      id: 'fixture-fire-smoke-sphere',
      kind: 'fire_smoke',
      shape: 'sphere',
      transform: {
        position: [0, -0.74, 0],
        rotation: [0, 0, 0],
        scale: [0.12, 0.12, 0.12],
      },
      simulation: {
        sourceRadius: 0.12,
        flowRate: 0.15,
        vorticity: 2.65,
      },
    },
  ],
};

const objectA = {
  id: 'object-a',
  source: 'demos/supermat-ring/model.glb',
  type: 'glb',
  fileName: 'ring.glb',
  label: 'Ring',
  createdAt: '2026-06-13T22:00:00.000Z',
  transform: {
    position: [-1.25, 0.1, 0.5],
    rotation: [0.1, 0.2, 0.3],
    scale: [0.9, 0.9, 0.9],
  },
  materials: {
    side: 2,
    transparent: true,
    opacity: 0.74,
  },
};

const objectB = {
  id: 'object-b',
  source: '/api/job-output?job=demo&file=mesh.glb',
  type: 'glb',
  fileName: 'mesh.glb',
  label: 'Mesh',
  createdAt: '2026-06-13T22:01:00.000Z',
  transform: {
    position: [1.5, 0.4, -0.25],
    rotation: [0, 0.5, 0],
    scale: [1.2, 0.8, 1.1],
  },
  materials: {
    side: 1,
    transparent: false,
    opacity: 1,
  },
};

const document = buildSceneDocument({
  timestamp: '2026-06-13T22:02:00.000Z',
  objects: [objectA, objectB],
  activeObjectId: objectB.id,
  volumePrimitives,
  provenance: { source: objectB.source, kind: 'api-job-output' },
  camera: {
    position: [3, 2, 5],
    target: [0, 0.5, 0],
    fov: 45,
  },
  environment: {
    name: 'studio',
    exposure: 1.2,
    intensity: 0.85,
    rotation: 0.4,
    showBackground: true,
    backgroundBlur: 0.15,
  },
  postprocessing: {
    ao: { enabled: true, radius: 0.4, intensity: 1.1, farBlend: 0.25 },
    dof: { enabled: false, focus: 8, aperture: 0.0001, maxblur: 0.01 },
  },
  backdrop: true,
  backdropBrightness: 0.55,
});

const saved = JSON.parse(JSON.stringify(document));
const restorePlan = planSceneRestore(saved);

assert.equal(saved.schema, SCENE_SCHEMA, 'round-trip scene document uses the v1 multi-object schema');
assert.equal(saved.version, 3, 'round-trip scene document keeps the current scene version');
assert.equal(saved.objects.length, 2, 'round-trip scene document saves both authored objects');
assert.equal(saved.activeObjectId, 'object-b', 'round-trip scene document preserves active object identity');
assert.equal(saved.model.source, objectB.source, 'legacy model field mirrors the active object source');
assert.equal(saved.model.fileName, objectB.fileName, 'legacy model field mirrors the active object filename');
assert.deepEqual(saved.volumePrimitives, volumePrimitives, 'round-trip scene document preserves volume primitive state');
assert.deepEqual(getSceneObjectRecords(saved).map(obj => obj.id), ['object-a', 'object-b'], 'scene loader sees both object records in order');
assert.equal(sceneDocumentIsLoadable(saved), true, 'two-object scene with volume primitives is loadable');
assert.equal(restorePlan.activeObjectId, 'object-b', 'restore plan keeps active object selection');
assert.deepEqual(restorePlan.volumePrimitives, volumePrimitives, 'restore plan carries volume primitive state');
assert.deepEqual(restorePlan.objects.map(obj => obj.transform.position), [[-1.25, 0.1, 0.5], [1.5, 0.4, -0.25]], 'restore plan keeps independent object transforms');
assert.deepEqual(restorePlan.objects.map(obj => obj.materials.opacity), [0.74, 1], 'restore plan keeps independent material state');
assert.equal(isReloadableSceneObjectRecord(objectA), true, 'demo GLB object is reloadable');
assert.equal(isReloadableSceneObjectRecord(objectB), true, 'API GLB object is reloadable');
assert.equal(isReloadableSceneObjectRecord({
  id: 'pbr-demo',
  source: 'demos/supermat-ring/',
  type: 'pbr',
  fileName: 'SuperMat Ring',
}), true, 'demo PBR material preview object is reloadable');
assert.equal(isReloadableSceneObjectRecord({
  id: 'pbr-local',
  source: 'material-preview',
  type: 'pbr',
  fileName: 'pbr-material-preview',
}), false, 'local PBR material preview without demo source is not silently reloadable');
assert.equal(isReloadableSceneObjectRecord({ ...objectA, source: 'local-drop.glb' }), false, 'local dropped source is not silently reloadable');

const legacy = {
  version: 2,
  model: { source: 'demos/legacy/model.glb', type: 'glb', fileName: 'legacy.glb' },
  transform: objectA.transform,
  materials: objectA.materials,
};
assert.deepEqual(sceneObjectToLegacyModel(legacy), {
  id: 'legacy-model',
  source: 'demos/legacy/model.glb',
  type: 'glb',
  fileName: 'legacy.glb',
  label: 'legacy.glb',
  transform: objectA.transform,
  materials: objectA.materials,
}, 'legacy single-model scenes still convert into one scene object');

assert.equal(sceneDocumentIsLoadable({
  version: 3,
  volumePrimitives,
}), true, 'volume-only scene documents remain loadable');

assert.equal(sceneDocumentIsLoadable({
  version: 3,
  objects: [],
  volumePrimitives: { schema: 'kaminos.volume-primitives.v0', primitives: [] },
}), false, 'empty object and empty volume scenes fail loud instead of looking saved');

assert.equal(sceneDocumentIsLoadable({}), false, 'versionless scene document is not loadable');
assert.equal(sceneDocumentIsLoadable(null), false, 'null scene document is not loadable');
assert.equal(sceneDocumentIsLoadable({ objects: [objectA] }), false, 'object scene without version is not loadable');

const staleActivePlan = planSceneRestore({
  ...saved,
  activeObjectId: 'deleted-object',
});
assert.equal(staleActivePlan.activeObjectId, 'object-b', 'stale active object ids fall back to the last restored object');
