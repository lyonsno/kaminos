import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isReloadableSceneObjectRecord } from '../scene-persistence-core.js';

const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const gitignore = fs.readFileSync(new URL('../.gitignore', import.meta.url), 'utf8');
const compositionUrl = new URL('../scenes/crucible-promoted-bench.kaminos.json', import.meta.url);
const composition = JSON.parse(fs.readFileSync(compositionUrl, 'utf8'));

assert.equal(composition.schema, 'kaminos.scene.v1');
assert.equal(composition.version, 4);
assert.equal(composition.composition?.schema, 'kaminos.crucible-bench-composition.v0');
assert.equal(composition.composition?.id, 'promoted-bench-2026-07-15');
assert.equal(composition.postprocessing?.ao?.enabled, false, 'Titan Hammer composition must disable AO');

const expectedObjects = new Map([
  ['stone-receiver', 'artifacts/stone-receiver-fixture-2026-07-13/promoted/matte-stone-corner-receiver.glb'],
  ['specimen-tray', 'artifacts/specimen-tray-sourcegen-2026-07-14/promoted/specimen-tray-trellis2mlx-fast-72014.glb'],
  ['titan-hammer', 'artifacts/titan-hammer-realistic-sourcegen-2026-07-13/promoted/titan-hammer-trellis2mlx-fast-61014.glb'],
]);

assert.equal(composition.objects.length, expectedObjects.size);
for (const object of composition.objects) {
  assert.equal(object.source, expectedObjects.get(object.id), `${object.id} must retain its promoted source`);
  assert.equal(object.groupId, 'crucible-promoted-bench');
  assert.equal(object.type, 'glb');
  assert.equal(isReloadableSceneObjectRecord(object), true, `${object.id} must reload from its repo artifact source`);
  assert.ok(object.provenance?.commit, `${object.id} must retain its promotion commit`);
  assert.ok(Array.isArray(object.transform?.position));
  assert.ok(Array.isArray(object.transform?.rotation));
  assert.ok(Array.isArray(object.transform?.scale));
}
assert.deepEqual(
  composition.groups.find(group => group.id === 'crucible-promoted-bench')?.objectIds,
  [...expectedObjects.keys()],
);
assert.ok(
  composition.composition.deferredAssets.some(asset => asset.id === 'surface-board-sharp' && asset.role === 'bench-dressing-only'),
  'The partial-view surface board must remain an explicit deferred dressing asset',
);

for (const source of expectedObjects.values()) {
  const asset = new URL(`../${source}`, import.meta.url);
  assert.ok(fs.statSync(asset).size > 0, `${source} must be present and non-empty`);
}

assert.match(index, /id="crucible-viewport-stage-assets-button"/);
assert.match(index, /async function loadKaminosCrucibleComposition\(/);
assert.match(index, /params\.get\('composition'\)/);
assert.match(index, /window\.kaminosCrucibleCompositionDebugState/);
assert.match(index, /requestedCompositionId/);
assert.match(index, /effectiveCompositionId/);
assert.match(index, /registeredObjectIds/);
assert.match(index, /function applyKaminosCrucibleCompositionFraming\(/);
assert.match(index, /Math\.max\(1,\s*0\.5\s*\/\s*viewportAspect\)/);
assert.match(index, /viewportFraming/);
assert.match(index, /@media\s*\(max-width:\s*720px\)[\s\S]*#sidebar\s*\{[^}]*width:\s*42vw;/);
assert.match(index, /#viewport\s*\{[^}]*min-width:\s*0;/);
assert.match(gitignore, /!scenes\/crucible-promoted-bench\.kaminos\.json/);

console.log('crucible asset composition contracts passed');
