// kaminos-test: node
// A note link reopens the thread even when a saved flame scene has to pass
// through its preset page first (review F2).
import test from 'node:test';
import assert from 'node:assert/strict';
import {noteLink, parseRef} from '../notes-core.mjs';
import {COMPOSITION_SCHEMA, compositionRestoreUrl, forwardCompositionHash} from '../scene-authoring.mjs';

const NOTE = 'kn-aaaaaaaaaaaa';
const presetId = `vsp-${'a'.repeat(64)}`;
const composition = {schema: COMPOSITION_SCHEMA, flame: {presetId, stationary: true}, lightGainStops: 1,
  route: {volume_light_field: '1', volume_light_field_scene_depth: '1'}};
const hashOf = url => new URLSearchParams(new URL(url).hash.slice(1));

test('a note link names the saved scene and the note in the address hash', () => {
  const link = noteLink({id: NOTE, subject: {scene: 'kiln.kaminos.json', source: {origin: 'http://127.0.0.1:8090'}}});
  assert.equal(hashOf(link).get('scene'), 'kiln.kaminos.json');
  assert.equal(hashOf(link).get('note'), NOTE);
  assert.equal(parseRef(link), NOTE);
});

test('the saved-composition redirect and the preset page both keep the note', () => {
  const redirect = compositionRestoreUrl(composition, 'kiln.kaminos.json', 'http://127.0.0.1:8090', null, null, {note: NOTE});
  assert.equal(new URL(redirect).searchParams.get('preset'), presetId);
  assert.equal(hashOf(redirect).get('note'), NOTE);
  assert.equal(hashOf(redirect).get('scene'), 'kiln.kaminos.json');
  const back = forwardCompositionHash('http://127.0.0.1:8090/index.html?settings_preset=exact', new URL(redirect).hash);
  assert.equal(hashOf(back).get('note'), NOTE);
  assert.equal(hashOf(back).get('scene'), 'kiln.kaminos.json');
  const plain = compositionRestoreUrl(composition, 'kiln.kaminos.json', 'http://127.0.0.1:8090');
  assert.equal(hashOf(plain).get('note'), null, 'no note is invented');
});
