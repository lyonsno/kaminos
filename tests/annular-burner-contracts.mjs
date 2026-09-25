import assert from 'node:assert/strict';
import { normalizeComposition } from '../scene-authoring.mjs';
import { buildSceneDocument, planSceneRestore } from '../scene-persistence-core.js';
import { BURNER_DEFAULTS, normalizeBurner, burnerRings, burnerSource, burnerActivation, coolBurner } from '../annular-burner.mjs';
import { compileVolumeEmitterFamily } from '../volume-emitter-basis.mjs';

const composition = {
  schema: 'kaminos.stationary-flame-composition.v1',
  flame: { presetId: 'vsp-' + 'a'.repeat(64), stationary: true },
  route: { volume_light_field: '1' }, lightGainStops: 0,
};
assert.throws(() => normalizeComposition({ ...composition, burner: {
  schema: 'kaminos.annular-burner.v1', innerRadius: 0.8, outerRadius: 0.2,
} }), /radius/i, 'a reversed burner bed must not silently reopen as valid');
const recipe = normalizeBurner({ ...BURNER_DEFAULTS, ringCount: 31, sectorCount: 9, subdivisions: 201, futureField: true });
const doc = buildSceneDocument({ composition: { ...composition, burner: recipe } });
assert.deepEqual(planSceneRestore(doc).composition.burner, recipe);
recipe.ringCount = 4;
assert.equal(doc.composition.burner.ringCount, 31);
assert.equal(normalizeComposition(composition).burner, undefined);
assert.equal(normalizeBurner(null), null);
for (const patch of [{ ringCount: 0 }, { ringCount: 2.5 }, { ringCount: Infinity }, { thickness: -1 },
  { grooveDepth: 0 }, { grooveDepth: 1 }, { grooveFraction: 1 }, { outerRadius: NaN },
  { bedColor: 'white' }, { subdivisions: 4 }, { coolingSeconds: -1 }, { schema: 'unknown' }]) {
  assert.throws(() => normalizeBurner({ ...BURNER_DEFAULTS, ...patch }));
}
for (const count of [1, 8, 24, 63]) {
  const rings = burnerRings({ ...BURNER_DEFAULTS, ringCount: count });
  assert.equal(rings.length, count);
  assert.ok(rings.every(r => r.radius - r.width / 2 >= BURNER_DEFAULTS.innerRadius));
  assert.ok(rings.every(r => r.radius + r.width / 2 <= BURNER_DEFAULTS.outerRadius));
}
// Replay the actual compiler contract, including the current basin's support law.
const compiled = compileVolumeEmitterFamily({ family: 'ring', ringRadius: 0.52, radius: 0.104,
  sourceLaw: 'shallow-primary', sourceDepth: 0.0069421094369548, strength: 2.5 });
const receipt = { fallbackUsed: false, effective: { family: 'ring' }, compilerReceipt: compiled };
const source = burnerSource(receipt);
assert.deepEqual(source.origin, [0, -0.76, 0]);
assert.equal(source.radius, 0.52);
assert.equal(source.width, 0.104);
assert.equal(source.sourceLaw, 'shallow-primary');
assert.equal(source.axialHalfExtent, compiled.descriptor.sourceDepth / 2);
for (const sourceLaw of ['legacy-volume', 'shallow-primary']) {
  for (const sourceDepth of [0.0069421094369548, 0.24, 0.36]) {
    const actual = compileVolumeEmitterFamily({ family: 'ring', ringRadius: 0.08, radius: 0.016, sourceLaw, sourceDepth });
    const support = burnerSource({ ...receipt, compilerReceipt: actual });
    assert.equal(support.axialHalfExtent, sourceLaw === 'legacy-volume' ? 0.016 : Math.min(0.016, sourceDepth / 2),
      'bed placement must follow the torus/slab intersection, not depth alone');
  }
}
assert.equal(burnerSource({ ...receipt, compilerReceipt: { ...compiled, descriptor: { ...compiled.descriptor, sourceLaw: 'future-law' } } }), null);
assert.equal(burnerSource({ ...receipt, fallbackUsed: true }), null);
assert.equal(burnerSource({ ...receipt, effective: { family: 'cluster' } }), null);
assert.equal(burnerSource(null), null);
assert.equal(burnerActivation(0.52, source), 2.5 / 3.5);
assert.equal(burnerActivation(0.8, source), 0);
assert.equal(burnerActivation(0.52, { ...source, strength: 0 }), 0);
assert.ok(Math.abs(burnerActivation(0.5, source) - burnerActivation(0.5, { ...source, radius: 0.520001 })) < 0.0001);
assert.equal(coolBurner(0, 0.7, 0.1, 1), 0.7);
assert.equal(coolBurner(0.7, 0, 1, 0), 0);
assert.ok(Math.abs(coolBurner(coolBurner(1, 0, 0.5, 1), 0, 0.5, 1) - coolBurner(1, 0, 1, 1)) < 1e-12);
console.log('annular burner contracts passed');
