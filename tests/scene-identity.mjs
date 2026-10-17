import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSceneDocument, mintSceneId, planSceneRestore } from '../scene-persistence-core.js';

const composition = {
  schema: 'kaminos.stationary-flame-composition.v1',
  flame: { presetId: 'vsp-' + 'a'.repeat(64), label: 'Blue kiln', stationary: true },
  route: { volume_light_field: '1', volume_light_field_scene_depth: '1' },
  lightGainStops: 1.25,
};
const scene = fields => buildSceneDocument({ composition, ...fields });

// A scene carries its own identity through save and load, so anything written
// about it (a note on a point of an object) can tell whether it is open again.
const saved = scene({ sceneId: 'scene-0123456789abcdef' });
assert.equal(saved.sceneId, 'scene-0123456789abcdef', 'the saved document keeps the scene id');
assert.equal(planSceneRestore(saved).sceneId, 'scene-0123456789abcdef', 'loading the document returns its id');

assert.equal(Object.hasOwn(scene({}), 'sceneId'), false, 'no id given, none written');
assert.equal(planSceneRestore(scene({})).sceneId, null, 'an older scene has no id');
for (const bad of [42, '', 'has space', 'x'.repeat(129), ['scene-a']]) {
  assert.equal(planSceneRestore({ ...saved, sceneId: bad }).sceneId, null, `an unusable id (${JSON.stringify(bad)}) is no id`);
  assert.throws(() => scene({ sceneId: bad }), /scene id/i, `saving an unusable id (${JSON.stringify(bad)}) is refused`);
}

const minted = new Set(Array.from({ length: 64 }, () => mintSceneId()));
assert.equal(minted.size, 64, 'minted ids differ');
for (const id of minted) {
  assert.match(id, /^scene-[0-9a-f]{16}$/);
  assert.equal(planSceneRestore(scene({ sceneId: id })).sceneId, id, 'a minted id survives save and load');
}

// The page publishes a scene's id only once its load settles: from the first
// change to the open scene until then, there is no id, so nothing written
// mid-load is taken for either scene.
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const load = html.slice(html.indexOf('async function loadSceneFile('), html.indexOf('// File input handler for Load Scene'));
const blank = load.indexOf('currentSceneId = null;');
assert.ok(blank > load.indexOf('location.assign(compositionRestoreUrl('), 'the id stays while the open scene is untouched');
assert.ok(blank < load.indexOf('activeSceneComposition = restorePlan.composition;') && blank < load.indexOf('clearScene('), 'the id goes before the scene starts to change');
assert.match(load, /claimLoadedSceneFile\(file, sceneFile\);\n  currentSceneId = restorePlan\.sceneId \|\| mintSceneId\(\);/, 'the loaded id (or a new one for an older file) is taken where the load settles');
const clear = html.slice(html.indexOf('function clearScene('), html.indexOf('function clearScene(') + 400);
assert.match(clear, /sceneLoadRequests\.invalidate\(\); currentSceneId = mintSceneId\(\);/, 'clearing outside a load starts a new scene');
console.log('scene identity contracts passed');
