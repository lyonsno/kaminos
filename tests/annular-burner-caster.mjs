// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {computeBoundsTree, acceleratedRaycast} from 'three-mesh-bvh';

// Many rays against a 125k-triangle burner: raycast through a BVH.
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;
import {BURNER_DEFAULTS, burnerRings, createAnnularBurner, createAnnularBurnerCaster, annularBurnerCasterKey} from '../annular-burner.mjs';

const triangles = g => (g.index ? g.index.count : g.attributes.position.count) / 3;
// The detailed burner as shown, without its bolts (the caster leaves those decorative bumps out).
const detailed = recipe => { const b = createAnnularBurner(THREE, mergeGeometries, recipe), meshes = b.group.children.slice();
  return {burner: b, meshes, withoutBolts: meshes.slice(0, -1)}; };
const casterMesh = caster => new THREE.Mesh(caster.geometry, new THREE.MeshBasicMaterial({side: THREE.DoubleSide}));
// Height of the first surface hit straight down at (x, z), or null.
const heightAt = (objects, x, z) => { for (const o of objects) if (!o.geometry.boundsTree) o.geometry.computeBoundsTree(); const ray = new THREE.Raycaster(new THREE.Vector3(x, 1, z), new THREE.Vector3(0, -1, 0));
  const hits = ray.intersectObjects(objects, false); return hits.length ? 1 - hits[0].distance : null; };

test('the default burner caster is an order of magnitude lighter than the burner', () => {
  const {burner, meshes} = detailed(BURNER_DEFAULTS), caster = createAnnularBurnerCaster(THREE, mergeGeometries, BURNER_DEFAULTS);
  assert.equal(meshes.reduce((n, m) => n + triangles(m.geometry), 0), 125472, 'baseline: the recipe as Beaming counted it');
  assert.ok(caster.triangles < 12000, `${caster.triangles} triangles`);
  assert.equal(caster.triangles, triangles(caster.geometry));
  burner.dispose();
});

test('same outline: bounds match the burner without bolts within the sagitta bound', () => {
  const {burner, withoutBolts} = detailed(BURNER_DEFAULTS), caster = createAnnularBurnerCaster(THREE, mergeGeometries, BURNER_DEFAULTS);
  const box = new THREE.Box3(); for (const m of withoutBolts) box.expandByObject(m);
  caster.geometry.computeBoundingBox(); const c = caster.geometry.boundingBox;
  for (const k of ['x', 'y', 'z']) { assert.ok(Math.abs(c.min[k] - box.min[k]) <= caster.bound.maxSagitta + 1e-6, `min ${k}`); assert.ok(Math.abs(c.max[k] - box.max[k]) <= caster.bound.maxSagitta + 1e-6, `max ${k}`); }
  burner.dispose();
});

// Rays straight down over the disc, including right beside every wall: the caster is never lower
// than the burner anywhere (it may block more, never less). Away from walls it is the same surface.
function compareHeights(recipe, rays) {
  const {burner, withoutBolts} = detailed(recipe), caster = createAnnularBurnerCaster(THREE, mergeGeometries, recipe), mesh = casterMesh(caster);
  const s = caster.bound.maxSagitta, rings = burnerRings(recipe), sectorAngle = Math.PI * 2 / recipe.sectorCount;
  const walls = [recipe.innerRadius, recipe.outerRadius, recipe.outerRadius + 0.045, ...rings.flatMap(r => [r.radius - r.width / 2, r.radius + r.width / 2])];
  const seamHalf = Math.min(0.012, Math.PI / recipe.sectorCount * 0.06) / 2;
  const out = {compared: 0, grooves: 0, seams: 0};
  for (const [r, a] of rays) {
    const x = Math.sin(a) * r, z = Math.cos(a) * r, h0 = heightAt(withoutBolts, x, z), h1 = heightAt([mesh], x, z);
    if (h0 === null) continue;
    assert.ok(h1 !== null && h1 >= h0 - 1e-4, `never lower: r=${r} a=${a} caster ${h1} burner ${h0}`);
    out.compared++;
    const inSector = ((a % sectorAngle) + sectorAngle) % sectorAngle, nearSeam = Math.min(inSector, sectorAngle - inSector);
    if (h0 < -recipe.grooveDepth / 2) { out.grooves++; if (nearSeam < seamHalf) out.seams++; }
    // Beside a wall the caster may stand a land higher (its walls enclose the burner's); elsewhere only
    // by what was dropped: a land's bevel (at most a quarter of the groove depth) or the 1 mm floor offset.
    if (walls.some(w => Math.abs(r - w) < s + 1e-4) || Math.abs(nearSeam - seamHalf) * r < 1e-4) continue;
    assert.ok(h1 - h0 <= Math.max(recipe.grooveDepth * 0.25, 0.001, r > recipe.outerRadius ? 0.0082 : 0) + 1e-4, `same surface: r=${r} ${h1} vs ${h0}`);
  }
  burner.dispose();
  return out;
}
const spiral = (count, extent) => Array.from({length: count}, (_, i) => [extent * Math.sqrt((i * 0.6180339887) % 1), i * 2.399963]);

test('the caster is never lower than the burner, grooves, lands, seams and rim included', () => {
  for (const recipe of [BURNER_DEFAULTS, {...BURNER_DEFAULTS, ringCount: 7, sectorCount: 5, outerRadius: 0.5, grooveFraction: 0.5}]) {
    // Rays beside every wall as well as spread over the disc.
    const rings = burnerRings(recipe), walls = [recipe.innerRadius, recipe.outerRadius, recipe.outerRadius + 0.045, ...rings.flatMap(r => [r.radius - r.width / 2, r.radius + r.width / 2])];
    const beside = walls.flatMap(w => [-3e-4, -1e-4, 1e-4, 3e-4].flatMap(d => [0.13, 1.1, 2.7, 4.4, 5.9].map(a => [w + d, a])));
    const {compared, grooves, seams} = compareHeights(recipe, [...spiral(1200, recipe.outerRadius + 0.06), ...beside]);
    assert.ok(compared > 400 && grooves > 40 && seams > 0, `compared ${compared}, grooves ${grooves}, seams ${seams}`);
  }
});

test('review AB-01: the two reported rays', () => {
  // Beside the first land's outer wall on the default burner: the caster must still block there.
  compareHeights(BURNER_DEFAULTS, [[0.035714583333333334, Math.PI / 12]]);
  // At a narrow groove's centre the caster shows the groove, not a land.
  const narrow = {...BURNER_DEFAULTS, ringCount: 128, grooveFraction: 0.1}, caster = createAnnularBurnerCaster(THREE, mergeGeometries, narrow), mesh = casterMesh(caster);
  for (const ring of burnerRings(narrow).filter((_, i) => i % 9 === 0)) for (const a of [0.06994984694978736, 1.3, 3.9]) {
    const h = heightAt([mesh], Math.sin(a) * ring.radius, Math.cos(a) * ring.radius);
    assert.ok(h < -narrow.grooveDepth / 2, `groove at r=${ring.radius} a=${a} stands at ${h}`);
  }
});

test('confirmation review AB-01: rays just inside the rim, between differently spaced vertices, still hit the stand-in', () => {
  const second = {...BURNER_DEFAULTS, ringCount: 7, sectorCount: 5, outerRadius: 0.5, grooveFraction: 0.5};
  compareHeights(second, [[0.49995, 48 * Math.PI / 37 + 0.00001]]);
  const coarse = (recipe, rays) => { const {burner, withoutBolts} = detailed(recipe), mesh = casterMesh(createAnnularBurnerCaster(THREE, mergeGeometries, recipe, {maxSagitta: 0.004}));
    for (const [r, a] of rays) { const x = Math.sin(a) * r, z = Math.cos(a) * r, h0 = heightAt(withoutBolts, x, z), h1 = heightAt([mesh], x, z);
      if (h0 !== null) assert.ok(h1 !== null && h1 >= h0 - 1e-4, `r=${r} a=${a} caster ${h1} burner ${h0}`); }
    burner.dispose(); };
  coarse(BURNER_DEFAULTS, [[0.86995, 48 * Math.PI / 37 + 0.00001]]);
  // A dense angular sweep 50 um either side of every wall, so no vertex spacing can hide a strip.
  for (const recipe of [BURNER_DEFAULTS, second]) {
    const rings = burnerRings(recipe), walls = [recipe.innerRadius, recipe.outerRadius, recipe.outerRadius + 0.045, ...rings.flatMap(r => [r.radius - r.width / 2, r.radius + r.width / 2])];
    compareHeights(recipe, walls.flatMap(w => [-5e-5, 5e-5].flatMap(d => Array.from({length: 720}, (_, i) => [w + d, i * Math.PI / 360 + 0.0003]))));
  }
});

test('review AB-02: a tolerance too fine to represent is refused before any geometry is built', () => {
  assert.throws(() => createAnnularBurnerCaster(THREE, mergeGeometries, BURNER_DEFAULTS, {maxSagitta: 1e-20}), /finer than the burner/);
  // Confirmation review AB-03: no fixed budget; the boundary is the burner's own tessellation.
  assert.throws(() => createAnnularBurnerCaster(THREE, mergeGeometries, BURNER_DEFAULTS, {maxSagitta: 1e-5}), /finer than the burner/);
  assert.ok(createAnnularBurnerCaster(THREE, mergeGeometries, {...BURNER_DEFAULTS, subdivisions: 4096}, {maxSagitta: 1e-5}).triangles > 0);
});

test('a tighter sagitta buys more triangles; the bound is reported', () => {
  const coarse = createAnnularBurnerCaster(THREE, mergeGeometries, BURNER_DEFAULTS, {maxSagitta: 0.004});
  const fine = createAnnularBurnerCaster(THREE, mergeGeometries, BURNER_DEFAULTS, {maxSagitta: 0.0005});
  assert.ok(fine.triangles > coarse.triangles);
  assert.equal(fine.bound.maxSagitta, 0.0005);
  assert.deepEqual(coarse.omitted, ['bolts', 'channel-floors', 'bevels']);
  assert.throws(() => createAnnularBurnerCaster(THREE, mergeGeometries, BURNER_DEFAULTS, {maxSagitta: 0}), /maxSagitta/);
});

test('the key follows the geometry a caster depends on and nothing else', () => {
  const key = annularBurnerCasterKey(BURNER_DEFAULTS);
  assert.match(key, /^kaminos\.annular-burner-caster\.v1:/);
  assert.equal(createAnnularBurnerCaster(THREE, mergeGeometries, BURNER_DEFAULTS).key, key);
  for (const surface of [{bedColor: '#000000'}, {glow: 9}, {coolingSeconds: 2}, {enabled: false}])
    assert.equal(annularBurnerCasterKey({...BURNER_DEFAULTS, ...surface}), key, JSON.stringify(surface));
  for (const shape of [{subdivisions: 96}, {ringCount: 12}, {sectorCount: 6}, {outerRadius: 0.9}, {grooveDepth: 0.02}, {rimHeight: 0.03}, {thickness: 0.07}, {innerRadius: 0.03}, {grooveFraction: 0.5}])
    assert.notEqual(annularBurnerCasterKey({...BURNER_DEFAULTS, ...shape}), key, JSON.stringify(shape));
  assert.notEqual(annularBurnerCasterKey(BURNER_DEFAULTS, {maxSagitta: 0.001}), key);
  assert.throws(() => annularBurnerCasterKey({...BURNER_DEFAULTS, ringCount: 0}), /ringCount/);
});
