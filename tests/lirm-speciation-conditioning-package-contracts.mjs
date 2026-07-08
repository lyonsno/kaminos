import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const {
  createLirmSpeciationArmatureConditioningPackage,
  createLirmSpeciationArmatureWitness,
  writeLirmSpeciationArmatureConditioningPackages,
} = await import('../lirm-speciation-armature-core.js');

const witness = createLirmSpeciationArmatureWitness({
  seed: 'molten-lirm-seed-0707',
  candidateCount: 25,
  columns: 5,
});

const pkg = createLirmSpeciationArmatureConditioningPackage({
  witness,
  candidateId: 'lirm-armature-22',
});

assert.equal(pkg.schema, 'kaminos.lirm-speciation-armature-conditioning-package.v0');
assert.equal(pkg.route, 'kaminos/lirm-speciation-armature/conditioning-package-v0');
assert.equal(pkg.candidateId, 'lirm-armature-22');
assert.equal(pkg.sourceProxyRender.route, 'kaminos/lirm-speciation-armature/proxy-render-v0');
assert.equal(pkg.sourceImages.length, 5);
assert.deepEqual(pkg.sourceImages.map(item => item.kind), ['clay', 'depth', 'normal', 'mask', 'semantic']);
assert.ok(pkg.sourceImages.every(item => item.requiredFor.includes('imagegen_conditioning')), 'source maps should be useful to image conditioning routes');
assert.ok(pkg.sourceImages.every(item => item.path.endsWith('.svg')), 'source image path should keep SVG control source');
assert.ok(pkg.sourceImages.every(item => item.rasterPath.endsWith('.png')), 'source images need PNG raster path for ML routes');
assert.match(pkg.prompt.positive, /small crawling hoard-thief creature/);
assert.match(pkg.prompt.positive, /terminal front mouth/);
assert.match(pkg.prompt.negative, /centered eye/);
assert.match(pkg.conditioningPanel.svg, /data-conditioning-panel="lirm-speciation-armature"/);
assert.match(pkg.conditioningPanel.svg, /data-source-kind="normal"/);
assert.equal(pkg.routeCandidates[0].route, 'imagegen_img2img_depth_normal');
assert.equal(pkg.routeCandidates[1].route, 'trellis2mlx_fast_clay_probe');
assert.equal(pkg.falseClosureGuards.generatorFiringClaim, 'not_yet_fired');
assert.equal(pkg.falseClosureGuards.conditioningClaim, 'source_package_only');
assert.equal(pkg.falseClosureGuards.greenroomClaim, 'gpu_routes_require_greenroom_receipt');

const outDir = await mkdtemp(join(tmpdir(), 'kaminos-lirm-conditioning-package-contract-'));
const writeResult = await writeLirmSpeciationArmatureConditioningPackages({
  outDir,
  seed: 'molten-lirm-seed-0707',
  candidateIds: ['lirm-armature-08', 'lirm-armature-22'],
});

assert.equal(writeResult.schema, 'kaminos.lirm-speciation-armature-conditioning-package-write-result.v0');
assert.equal(writeResult.packageCount, 2);
assert.ok(existsSync(join(outDir, 'receipt.json')), 'writer must emit a package receipt');
assert.ok(existsSync(join(outDir, 'lirm-armature-22', 'conditioning-package.json')), 'writer must emit package JSON');
assert.ok(existsSync(join(outDir, 'lirm-armature-22', 'conditioning-panel.svg')), 'writer must emit composite conditioning panel');
for (const kind of ['clay', 'depth', 'normal', 'mask', 'semantic']) {
  assert.ok(existsSync(join(outDir, 'lirm-armature-22', 'source-maps', `${kind}-control.svg`)), `writer must emit ${kind} source map`);
  assert.ok(existsSync(join(outDir, 'lirm-armature-22', 'source-maps', `${kind}-control.png`)), `writer must emit ${kind} PNG source map`);
}

const receipt = JSON.parse(readFileSync(join(outDir, 'receipt.json'), 'utf8'));
assert.equal(receipt.schema, 'kaminos.lirm-speciation-armature-conditioning-package-witness.v0');
assert.equal(receipt.falseClosureGuards.generatorFiringClaim, 'not_yet_fired');
assert.equal(receipt.outputInventory.packages[1].candidateId, 'lirm-armature-22');
assert.equal(receipt.outputInventory.packages[1].panel, 'lirm-armature-22/conditioning-panel.svg');
