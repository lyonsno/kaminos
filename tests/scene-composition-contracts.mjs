import assert from 'node:assert/strict';
import { buildSceneDocument, planSceneRestore, sceneDocumentIsLoadable } from '../scene-persistence-core.js';

const composition = {
  schema: 'kaminos.stationary-flame-composition.v1',
  flame: { presetId: 'vsp-' + 'a'.repeat(64), label: 'Blue kiln', stationary: true },
  route: { volume_light_field: '1', volume_light_field_scene_depth: '1' },
  lightGainStops: 1.25,
};
const capture = {
  label: 'Kiln three-quarter', capturedAt: '2026-09-17T10:00:00Z',
  image: 'data:image/png;base64,iVBORw0KGgo=', width: 800, height: 600,
  simulation: { frameCount: 153, simStepCount: 153 },
};
const scene = buildSceneDocument({ composition, capture });
assert.deepEqual(scene.composition.flame,composition.flame,'scene save retains the live basin');
assert.equal(scene.composition.lightGainStops,composition.lightGainStops);
for(const [key,value] of Object.entries(composition.route))assert.equal(scene.composition.route[key],value,'explicit lighting configuration survives');
assert.equal(scene.composition.route.volume_light_field_hybrid,'1','old ordinary routes acquire current scene lighting');
assert.deepEqual(scene.capture, capture, 'capture and its exact scene state travel together');
assert.equal(sceneDocumentIsLoadable(scene), true, 'a stationary flame alone is an authored scene');
assert.deepEqual(planSceneRestore(scene).composition,scene.composition,'saving and restoring retain effective lighting');
composition.lightGainStops = -1;
assert.equal(scene.composition.lightGainStops, 1.25, 'saved data must not alias live controls');
assert.equal(buildSceneDocument({}).composition, null, 'legacy mesh scenes have no implied flame');
assert.throws(() => buildSceneDocument({ composition: { ...composition, flame: { presetId: 'missing' } } }), /preset/i);
assert.throws(() => planSceneRestore({ ...scene, composition: { ...composition, schema: 'unknown' } }), /composition/i);
assert.throws(() => buildSceneDocument({ composition: { ...composition, flame: { ...composition.flame, stationary: false } } }), /stationary/i);
assert.throws(() => buildSceneDocument({ composition: { ...composition, lightGainStops: NaN } }), /gain/i);
assert.throws(() => buildSceneDocument({ composition: { ...composition, route: {} } }), /light-field/i);
assert.throws(() => buildSceneDocument({ capture: { ...capture, image: 'data:text/html;base64,abc' } }), /PNG/i);
console.log('scene composition contracts passed');
