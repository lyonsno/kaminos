import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildSceneDocument} from '../scene-persistence-core.js';

const host = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const server = readFileSync(new URL('../serve.py', import.meta.url), 'utf8');
const witness = readFileSync(new URL('../sf3d-kiln-save-reopen-witness.mjs', import.meta.url), 'utf8');
assert.match(host, /async presentGlb\(glb, \{runId, sha256\}\)/,
  'the current host must durably persist an inference GLB before registering it as an editable scene object');
assert.match(host, /\/api\/ingest-mesh/);
assert.match(host, /const GR_OUTPUT_ROOTS = \['pixal3d', 'trellis2mlx', 'generated-meshes'\]/,
  'the cockpit importer must expose the content-addressed generated-mesh library');
assert.match(host, /window\._kaminosDirty\?\.\(\)/,
  'new generated objects must mark the authored scene dirty for Save As');
assert.match(server, /parsed\.path == "\/api\/ingest-mesh"/);
assert.match(server, /def handle_ingest_mesh\(/);
assert.match(server, /hashlib\.sha256\(content\)\.hexdigest\(\)/,
  'persisted generated meshes must be content-addressed from bytes');
assert.match(server, /os\.link\(temporary, target\)/,
  'content-addressed mesh persistence must not silently replace an existing artifact');
assert.equal((witness.match(/loadAuthoredScene\(page,/g) || []).length, 3,
  'the original kiln and Save As result must both reopen through Kaminos’ supported scene loader');
assert.match(witness, /getElementById\('info-bar'\)\?\.textContent/,
  'reopen evidence must use Kaminos’ real scene-load receipt');
assert.match(witness, /__kaminosVolumePrototype\?\.debugState\?\.\(\)\.active\s*===\s*true/,
  'the persistence witness must wait for the initialized ordinary renderer before dispatching a scene load');
assert.match(witness, /inferenceReport|prior\.errors/,
  'the durability witness must validate and preserve its source inference evidence');
const saved = buildSceneDocument({
  composition: {flame: {presetId: 'vsp-authored-basin'}},
});
assert.equal(saved.composition?.flame?.presetId, 'vsp-authored-basin',
  'Save As must retain the authored flame basin identity');
assert.match(host, /composition: window\.__kaminosVolumeSettingsPresetReceipt\?\.presetId[\s\S]*?flame: \{ presetId:/,
  'the browser Save As builder must source basin identity from the loaded effective preset receipt');
console.log('current-main generated-mesh persistence contracts passed');
