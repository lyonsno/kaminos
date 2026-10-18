// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {BURNER_DEFAULTS, burnerRings, createAnnularBurner, createAnnularBurnerCaster, annularBurnerCasterKey} from '../annular-burner.mjs';

const triangles = g => (g.index ? g.index.count : g.attributes.position.count) / 3;
// The detailed burner as shown, without its bolts (the caster leaves those decorative bumps out).
const detailed = recipe => { const b = createAnnularBurner(THREE, mergeGeometries, recipe), meshes = b.group.children.slice();
  return {burner: b, meshes, withoutBolts: meshes.slice(0, -1)}; };
const casterMesh = caster => new THREE.Mesh(caster.geometry, new THREE.MeshBasicMaterial({side: THREE.DoubleSide}));
// Height of the first surface hit straight down at (x, z), or null.
const heightAt = (objects, x, z) => { const ray = new THREE.Raycaster(new THREE.Vector3(x, 1, z), new THREE.Vector3(0, -1, 0));
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

test('ring grooves, lands, sector seams and rim stand where they stand on the burner, never lower', () => {
  for (const recipe of [BURNER_DEFAULTS, {...BURNER_DEFAULTS, ringCount: 7, sectorCount: 5, outerRadius: 0.5, grooveFraction: 0.5}]) {
    const {burner, withoutBolts} = detailed(recipe), caster = createAnnularBurnerCaster(THREE, mergeGeometries, recipe), mesh = casterMesh(caster);
    const s = caster.bound.maxSagitta, rings = burnerRings(recipe), sectorAngle = Math.PI * 2 / recipe.sectorCount;
    const walls = [recipe.innerRadius, recipe.outerRadius, recipe.outerRadius + 0.045, ...rings.flatMap(r => [r.radius - r.width / 2, r.radius + r.width / 2])];
    let compared = 0, grooves = 0, seams = 0;
    for (let i = 0; i < 1500; i++) {
      const r = (recipe.outerRadius + 0.06) * Math.sqrt((i * 0.6180339887) % 1), a = i * 2.399963;
      if (walls.some(w => Math.abs(r - w) < s + 1e-3)) continue; // a wall's exact place depends on tessellation
      const inSector = ((a % sectorAngle) + sectorAngle) % sectorAngle, seamHalf = Math.min(0.012, Math.PI / recipe.sectorCount * 0.06) / 2;
      const nearSeam = Math.min(inSector, sectorAngle - inSector) * r;
      if (Math.abs(nearSeam - seamHalf * r) < 2e-4) continue; // seam ends sit at exact angles on both
      const x = Math.sin(a) * r, z = Math.cos(a) * r, h0 = heightAt(withoutBolts, x, z), h1 = heightAt([mesh], x, z);
      assert.equal(h1 === null, h0 === null, `coverage at r=${r.toFixed(4)}`);
      if (h0 === null) continue;
      compared++;
      // Never lower, except that a chord across the rim's 45-degree chamfer may sag by the sagitta bound.
      assert.ok(h1 >= h0 - (r > recipe.outerRadius ? s : 1e-4), `never lower: r=${r.toFixed(4)} a=${a.toFixed(3)} ${h1} < ${h0}`);
      // Higher only by what was dropped: a land's bevel (at most a quarter of the groove depth) or the 1 mm floor offset.
      assert.ok(h1 - h0 <= Math.max(recipe.grooveDepth * 0.25, 0.001) + 1e-4, `same surface: r=${r.toFixed(4)} ${h1} vs ${h0}`);
      if (h0 < -recipe.grooveDepth / 2) { grooves++; if (nearSeam < seamHalf * r) seams++; }
    }
    assert.ok(compared > 400 && grooves > 40 && seams > 0, `compared ${compared}, grooves ${grooves}, seams ${seams}`);
    burner.dispose();
  }
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
  for (const surface of [{bedColor: '#000000'}, {glow: 9}, {coolingSeconds: 2}, {subdivisions: 48}, {enabled: false}])
    assert.equal(annularBurnerCasterKey({...BURNER_DEFAULTS, ...surface}), key, JSON.stringify(surface));
  for (const shape of [{ringCount: 12}, {sectorCount: 6}, {outerRadius: 0.9}, {grooveDepth: 0.02}, {rimHeight: 0.03}, {thickness: 0.07}, {innerRadius: 0.03}, {grooveFraction: 0.5}])
    assert.notEqual(annularBurnerCasterKey({...BURNER_DEFAULTS, ...shape}), key, JSON.stringify(shape));
  assert.notEqual(annularBurnerCasterKey(BURNER_DEFAULTS, {maxSagitta: 0.001}), key);
  assert.throws(() => annularBurnerCasterKey({...BURNER_DEFAULTS, ringCount: 0}), /ringCount/);
});
