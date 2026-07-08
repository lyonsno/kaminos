import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const {
  createLirmSpeciationArmatureProxyRenderBundle,
  createLirmSpeciationArmatureWitness,
  writeLirmSpeciationArmatureProxyRenderWitness,
} = await import('../lirm-speciation-armature-core.js');

const witness = createLirmSpeciationArmatureWitness({
  seed: 'molten-lirm-seed-0707',
  candidateCount: 25,
  columns: 5,
});
const bundle = createLirmSpeciationArmatureProxyRenderBundle({
  witness,
  candidateId: 'lirm-armature-22',
});

assert.equal(bundle.schema, 'kaminos.lirm-speciation-armature-proxy-render-bundle.v0');
assert.equal(bundle.route, 'kaminos/lirm-speciation-armature/proxy-render-v0');
assert.equal(bundle.sourceWitnessId, witness.witnessId);
assert.equal(bundle.candidateId, 'lirm-armature-22');
assert.equal(bundle.camera.projection, 'orthographic');
assert.equal(bundle.camera.view, 'front-three-quarter');
assert.equal(bundle.proxyPrimitiveCount > 12, true, 'proxy render needs enough primitives to express body mass');
assert.equal(bundle.falseClosureGuards.finishedCreatureClaim, 'forbidden');
assert.equal(bundle.falseClosureGuards.generatorFiringClaim, 'not_yet_fired');
assert.equal(bundle.falseClosureGuards.proxyRenderClaim, 'depth_normal_conditioning_witness_only');
assert.equal(bundle.renderMaps.length, 5);
for (const kind of ['clay', 'depth', 'normal', 'mask', 'semantic']) {
  const map = bundle.renderMaps.find(item => item.kind === kind);
  assert.ok(map, `missing ${kind} render map`);
  assert.match(map.svg, /^<svg[\s\S]*<\/svg>$/);
  assert.match(map.path, new RegExp(`${kind}-control\\.svg$`));
  assert.match(map.svg, new RegExp(`data-proxy-render="${kind}"`));
}
assert.match(bundle.renderMaps.find(item => item.kind === 'depth').svg, /data-depth-range=/);
assert.match(bundle.renderMaps.find(item => item.kind === 'normal').svg, /data-normal-encoding="rgb-object-space"/);
assert.match(bundle.renderMaps.find(item => item.kind === 'mask').svg, /data-mask-mode="silhouette"/);
assert.match(bundle.renderMaps.find(item => item.kind === 'clay').svg, /terminal mouth/);

const outDir = await mkdtemp(join(tmpdir(), 'kaminos-lirm-proxy-render-contract-'));
const writeResult = await writeLirmSpeciationArmatureProxyRenderWitness({
  outDir,
  seed: 'molten-lirm-seed-0707',
  candidateIds: ['lirm-armature-08', 'lirm-armature-11', 'lirm-armature-22'],
});

assert.equal(writeResult.schema, 'kaminos.lirm-speciation-armature-proxy-render-write-result.v0');
assert.equal(writeResult.bundleCount, 3);
assert.equal(writeResult.route, 'kaminos/lirm-speciation-armature/proxy-render-v0');
assert.ok(existsSync(join(outDir, 'receipt.json')), 'proxy render writer must emit receipt');
assert.ok(existsSync(join(outDir, 'lirm-armature-22', 'clay-control.svg')), 'writer must emit clay SVG');
assert.ok(existsSync(join(outDir, 'lirm-armature-22', 'depth-control.svg')), 'writer must emit depth SVG');
assert.ok(existsSync(join(outDir, 'lirm-armature-22', 'normal-control.svg')), 'writer must emit normal SVG');
assert.ok(existsSync(join(outDir, 'lirm-armature-22', 'mask-control.svg')), 'writer must emit mask SVG');
assert.ok(existsSync(join(outDir, 'lirm-armature-22', 'semantic-control.svg')), 'writer must emit semantic SVG');

const receipt = JSON.parse(readFileSync(join(outDir, 'receipt.json'), 'utf8'));
assert.equal(receipt.schema, 'kaminos.lirm-speciation-armature-proxy-render-witness.v0');
assert.equal(receipt.route, 'kaminos/lirm-speciation-armature/proxy-render-v0');
assert.equal(receipt.bundles.length, 3);
assert.equal(receipt.falseClosureGuards.generatorFiringClaim, 'not_yet_fired');
assert.equal(receipt.outputInventory.bundles[2].candidateId, 'lirm-armature-22');
assert.deepEqual(
  receipt.outputInventory.bundles[2].maps.map(item => item.kind),
  ['clay', 'depth', 'normal', 'mask', 'semantic'],
);
