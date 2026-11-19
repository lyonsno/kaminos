// kaminos-test: node
import assert from 'node:assert/strict';
import test from 'node:test';
import { makeRegionState, regionSummary } from '../earth-gpu/regions.mjs';

test('a corner-notch slab stays connected through both axes, and grips address opposite edges', () => {
  const slab = makeRegionState({ slabSize: 3, samplesPerRegion: 24, gritCount: 9 });
  assert.equal(slab.regionCount, 9);
  assert.equal(slab.sampleCount, 216);
  assert.equal(slab.material.tets.length, 648);
  assert.equal(slab.bands.length, 11);
  assert.ok(Math.abs(regionSummary(slab).matrixMass / slab.referenceMatrixMass - 1) < 1e-6);
  const reached = new Set([0]);
  for (let pass = 0; pass < slab.regionCount; pass++) {
    for (const { a, b } of slab.bands) {
      if (reached.has(a) || reached.has(b)) { reached.add(a); reached.add(b); }
    }
  }
  assert.equal(reached.size, 9);
  assert.ok(slab.bands.some(({a,b}) => b-a === 1));
  assert.ok(slab.bands.some(({a,b}) => b-a === 3));
  assert.ok(slab.grips.filter(g => g.region === 0).length > 3);
  assert.ok(slab.grips.filter(g => g.region === 1).every(g => slab.material.nodes[g.node-slab.grainCount].region === 2));
  for (const { a, b, first, count } of slab.bands) {
    assert.ok(count > 0);
    for (const link of slab.connections.slice(first, first + count)) {
      assert.ok(link.rest > 0);
      assert.equal(slab.material.nodes[link.a-slab.grainCount].region, a);
      assert.equal(slab.material.nodes[link.b-slab.grainCount].region, b);
    }
  }
  const exposure = slab.faceBands;
  assert.equal(exposure.length, slab.faceCount);
  for (let i = 0; i < slab.bands.length; i++) {
    let first = 0, second = 0;
    for (const [face, band] of exposure.entries()) {
      if (band !== i) continue;
      const region = slab.material.nodes[slab.triangles[face*4]-slab.grainCount].region;
      if (region === slab.bands[i].a) first++;
      else { assert.equal(region, slab.bands[i].b); second++; }
    }
    assert.ok(first > 0);
    assert.equal(first, second);
  }
});
