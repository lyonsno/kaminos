import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { COMPOSITION_SCHEMA, compositionRestoreUrl, forwardCompositionHash, captureComposedCanvases } from '../scene-authoring.mjs';
const presetId = `vsp-${'a'.repeat(64)}`;
const state = { schema: COMPOSITION_SCHEMA, flame: { presetId, stationary: true }, lightGainStops: 1,
  route: { volume_light_field: '1', volume_light_field_scene_depth: '1', composition_module_url: './consumer.mjs' } };
const target = new URL(compositionRestoreUrl(state, 'test.kaminos.json', 'http://localhost:8106'));
assert.equal(target.searchParams.get('preset'), presetId);
const forwarded = new URL(forwardCompositionHash('http://localhost:8106/?settings_preset=exact', target.hash));
assert.equal(forwarded.searchParams.get('settings_preset'), 'exact');
assert.equal(new URLSearchParams(forwarded.hash.slice(1)).get('scene'), 'test.kaminos.json');
assert.equal(new URLSearchParams(forwarded.hash.slice(1)).get('composition_module_url'), './consumer.mjs');
const collisionTarget = new URL(forwardCompositionHash('http://localhost:8106/?settings_preset=exact',
  '#scene=test.kaminos.json&volume_collision=kiln'));
assert.equal(new URLSearchParams(collisionTarget.hash.slice(1)).get('volume_collision'), 'kiln',
  'the saved-preset launcher must retain the opt-in authored-kiln collision route');
const lightingHash = new URL(forwardCompositionHash('http://localhost:8106/', '#scene=test.kaminos.json&rendering_source_xyz=0%2C0%2C0&rendering_source_gain=5'));
const guidedHash=new URLSearchParams(new URL(forwardCompositionHash('http://localhost:8106/','#rendering_angular_pattern=guided&rendering_directions=12&rendering_match_camera=1')).hash.slice(1));
assert.equal(guidedHash.get('rendering_angular_pattern'),'guided','basin restore must not silently replace requested sampling law');
assert.equal(guidedHash.get('rendering_directions'),'12');assert.equal(guidedHash.get('rendering_match_camera'),'1');
assert.equal(new URLSearchParams(lightingHash.hash.slice(1)).get('rendering_source_xyz'), '0,0,0');
assert.equal(new URLSearchParams(lightingHash.hash.slice(1)).get('rendering_source_gain'), '5');
const surfaceHash=new URL(forwardCompositionHash('http://localhost:8106/','#rendering_surface_gain=2&rendering_surface_scattering=0'));
assert.equal(new URLSearchParams(surfaceHash.hash.slice(1)).get('rendering_surface_gain'),'2');
assert.equal(new URLSearchParams(surfaceHash.hash.slice(1)).get('rendering_surface_scattering'),'0');
const receiverHash=new URL(forwardCompositionHash('http://localhost:8106/','#rendering_receiver_spacing=0.08'));
assert.equal(new URLSearchParams(receiverHash.hash.slice(1)).get('rendering_receiver_spacing'),'0.08','receiver quality request survives saved-basin launch forwarding');
assert.throws(() => compositionRestoreUrl(state, '../wrong.json', target.origin));
const calls = [];
const host = { width: 800, height: 600, getBoundingClientRect: () => ({ left: 50, top: 20, width: 400, height: 300 }) };
const volume = { width: 200, height: 150, getBoundingClientRect: host.getBoundingClientRect };
const document = { createElement: () => ({ getContext: () => ({ drawImage: (...args) => calls.push(args) }), toDataURL: () => 'data:image/png;base64,aGVsbG8=' }) };
const shot = captureComposedCanvases({ host, volume, document, label: 'A' });
assert.deepEqual(calls, [[host, 0, 0], [volume, 0, 0, 800, 600]]);
assert.deepEqual(shot.layers, ['mesh', 'ordinary-emissive-volume']);
assert.throws(() => captureComposedCanvases({ host, volume: { ...volume, width: 0 }, document, label: 'A' }), /Flame canvas/);
assert.throws(() => captureComposedCanvases({ host: null, document, label: 'A' }), /Host canvas/);
assert.throws(() => captureComposedCanvases({ host, document, label: '' }), /label/);
const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
assert.match(index, /id="composition-ground-visible"/, 'author can remove the inspection floor that clips a lowered kiln');
assert.match(index, /if \(hasVolumePrimitiveScene \|\| activeSceneComposition \|\| new URLSearchParams\(location.search\).get\('kaminos_volume_smoke'\) === '1'\)/,
  'a geometry-only authored scene must preserve an explicitly requested live volume route');
console.log('scene authoring contracts passed');
