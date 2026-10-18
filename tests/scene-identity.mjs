// kaminos-test: node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSceneDocument, mintSceneId, planSceneRestore, sceneIdForDocument } from '../scene-persistence-core.js';

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

// A scene saved before ids existed is named by its saved bytes, so every page
// that opens the same unchanged file agrees on its id before anyone saves it.
const older = JSON.stringify(scene({ timestamp: '2026-10-01T00:00:00.000Z' }));
const named = await sceneIdForDocument(older);
assert.match(named ?? '', /^scene-[0-9a-f]{16}$/, 'an older file gets an id of the usual shape');
assert.equal(await sceneIdForDocument(older), named, 'the same bytes, the same id, in any page');
assert.notEqual(await sceneIdForDocument(JSON.stringify(scene({ timestamp: '2026-10-02T00:00:00.000Z' }))), named, 'another document, another id');

// The page publishes a scene's id only once its load settles: from the first
// change to the open scene until then, there is no id, so nothing written
// mid-load is taken for either scene.
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const load = html.slice(html.indexOf('async function loadSceneFile('), html.indexOf('// File input handler for Load Scene'));
const blank = load.indexOf('currentSceneId = null;');
assert.ok(blank > load.indexOf('location.assign(compositionRestoreUrl('), 'the id stays while the open scene is untouched');
assert.ok(blank < load.indexOf('activeSceneComposition = restorePlan.composition;') && blank < load.indexOf('clearScene('), 'the id goes before the scene starts to change');
assert.match(load, /const documentSceneId = restorePlan\.sceneId \|\| await sceneIdForDocument\(text\);/, "an older file's id comes from its bytes");
assert.match(load, /claimLoadedSceneFile\(file, sceneFile\);\n  currentSceneId = documentSceneId;/, "the document's id is taken where the load settles");
const clear = html.slice(html.indexOf('function clearScene('), html.indexOf('function clearScene(') + 400);
assert.match(clear, /sceneLoadRequests\.invalidate\(\); currentSceneId = mintSceneId\(\);/, 'clearing outside a load starts a new scene');
// A new scene started from saved defaults is a new scene each time, never one
// shared by every page that starts from the same defaults.
const startup = html.slice(html.indexOf('startupPreferences?.sceneDefaults&&sceneDefaultsApplyToLocation('), html.indexOf("setInfo('New scene · your saved defaults')"));
assert.match(startup, /const blank=\{\.\.\.newSceneDocument\(factorySceneDocument,startupPreferences\.sceneDefaults\),sceneId:mintSceneId\(\)\};/, 'a new scene from defaults gets its own fresh id');
console.log('scene identity contracts passed');
