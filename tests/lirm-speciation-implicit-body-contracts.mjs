import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const {
  createLirmSpeciationArmatureImplicitBodyBundle,
  createLirmSpeciationArmatureWitness,
  writeLirmSpeciationArmatureImplicitBodyWitness,
} = await import('../lirm-speciation-armature-core.js');

const witness = createLirmSpeciationArmatureWitness({
  seed: 'molten-lirm-seed-0707',
  candidateCount: 25,
  columns: 5,
});

const bundle = createLirmSpeciationArmatureImplicitBodyBundle({
  witness,
  candidateId: 'lirm-armature-22',
});

assert.equal(bundle.schema, 'kaminos.lirm-speciation-armature-implicit-body-bundle.v0');
assert.equal(bundle.route, 'kaminos/lirm-speciation-armature/implicit-body-v0');
assert.equal(bundle.sourceWitnessId, witness.witnessId);
assert.equal(bundle.candidateId, 'lirm-armature-22');
assert.equal(bundle.renderMode, 'raymarched-implicit-field');
assert.equal(bundle.fieldModel.kind, 'smooth-sdf-metaball');
assert.equal(bundle.fieldModel.surfaceThreshold > 0, true, 'implicit body must name a positive surface threshold');
assert.equal(bundle.implicitPrimitiveCount > 12, true, 'implicit body needs enough 3D primitives to carry body structure');
assert.equal(bundle.camera.projection, 'orthographic');
assert.equal(bundle.camera.coordinateFrame, 'normalized-implicit-body');
assert.equal(bundle.falseClosureGuards.finishedCreatureClaim, 'forbidden');
assert.equal(bundle.falseClosureGuards.generatorFiringClaim, 'not_yet_fired');
assert.equal(bundle.falseClosureGuards.implicitBodyClaim, 'raymarched_control_surface_only');
assert.equal(bundle.falseClosureGuards.projectionProxyClaim, 'superseded_by_implicit_surface');
assert.equal(bundle.renderMaps.length, 5);
assert.deepEqual(bundle.renderMaps.map(item => item.kind), ['clay', 'depth', 'normal', 'mask', 'semantic']);

for (const kind of ['clay', 'depth', 'normal', 'mask', 'semantic']) {
  const map = bundle.renderMaps.find(item => item.kind === kind);
  assert.ok(map, `missing ${kind} implicit map`);
  assert.match(map.svg, /^<svg[\s\S]*<\/svg>$/);
  assert.match(map.path, new RegExp(`${kind}-implicit\\.svg$`));
  assert.match(map.svg, new RegExp(`data-implicit-render="${kind}"`));
  assert.match(map.svg, /data-render-mode="raymarched-implicit-field"/);
  assert.match(map.svg, /data-field-kind="smooth-sdf-metaball"/);
}
assert.match(bundle.renderMaps.find(item => item.kind === 'depth').svg, /data-depth-source="ray-surface-hit"/);
assert.match(bundle.renderMaps.find(item => item.kind === 'normal').svg, /data-normal-source="field-gradient"/);
assert.match(bundle.renderMaps.find(item => item.kind === 'mask').svg, /data-mask-mode="surface-hit-silhouette"/);
assert.match(bundle.renderMaps.find(item => item.kind === 'clay').svg, /terminal mouth/);

const outDir = await mkdtemp(join(tmpdir(), 'kaminos-lirm-implicit-body-contract-'));
const writeResult = await writeLirmSpeciationArmatureImplicitBodyWitness({
  outDir,
  seed: 'molten-lirm-seed-0707',
  candidateIds: ['lirm-armature-08', 'lirm-armature-22'],
});

assert.equal(writeResult.schema, 'kaminos.lirm-speciation-armature-implicit-body-write-result.v0');
assert.equal(writeResult.bundleCount, 2);
assert.equal(writeResult.route, 'kaminos/lirm-speciation-armature/implicit-body-v0');
assert.ok(existsSync(join(outDir, 'receipt.json')), 'implicit writer must emit receipt');
for (const kind of ['clay', 'depth', 'normal', 'mask', 'semantic']) {
  assert.ok(existsSync(join(outDir, 'lirm-armature-22', `${kind}-implicit.svg`)), `writer must emit ${kind} SVG`);
  assert.ok(existsSync(join(outDir, 'lirm-armature-22', `${kind}-implicit.png`)), `writer must emit ${kind} PNG`);
}

const receipt = JSON.parse(readFileSync(join(outDir, 'receipt.json'), 'utf8'));
assert.equal(receipt.schema, 'kaminos.lirm-speciation-armature-implicit-body-witness.v0');
assert.equal(receipt.route, 'kaminos/lirm-speciation-armature/implicit-body-v0');
assert.equal(receipt.bundles.length, 2);
assert.equal(receipt.falseClosureGuards.generatorFiringClaim, 'not_yet_fired');
assert.equal(receipt.falseClosureGuards.implicitBodyClaim, 'raymarched_control_surface_only');
assert.equal(receipt.outputInventory.bundles[1].candidateId, 'lirm-armature-22');
assert.deepEqual(
  receipt.outputInventory.bundles[1].maps.map(item => item.kind),
  ['clay', 'depth', 'normal', 'mask', 'semantic'],
);
