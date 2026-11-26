// kaminos-test: node
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {makeRegionState, retainRegionState} from '../earth-gpu/regions.mjs';
import {packMaterial, materialMasses} from '../earth-gpu/material.mjs';

test('compaction starts from one continuous porous specimen with dynamic inclusions', () => {
  const state = makeRegionState({compaction:true,samplesPerRegion:96,gritCount:6});
  assert.equal(state.regionCount,1);
  assert.equal(state.bands.length,0);
  assert.equal(state.grips.length,0);
  assert.equal(state.mineralCount,6);
  assert.ok(state.material.tets.length>144);
  assert.ok(state.material.tets.every(tet=>tet.packing===1));
  assert.equal(state.packetTets.length,state.sampleCount);
  state.packetTets.forEach((tet,i)=>{
    assert.deepEqual(state.material.tets[tet].ids.map(id=>id+state.grainCount),state.attachments[i].nodeIds);
  });
  const connected = new Set([0]);
  for (let remaining; remaining!==connected.size;) {
    remaining=connected.size;
    for (const tet of state.material.tets) {
      if (tet.ids.some(id=>connected.has(id))) for (const id of tet.ids) connected.add(id);
    }
  }
  assert.equal(connected.size,state.material.nodes.length);
});

test('packing survives a capture and pack round trip without changing mass or virgin volume', () => {
  const state = makeRegionState({compaction:true,samplesPerRegion:96,gritCount:6});
  const packed = state.tets.slice();
  packed[14]=.75;
  const retained = retainRegionState(state,state.floats.slice(),packed,state.linkWords);
  assert.equal(retained.material.tets[0].packing,.75);
  const rebuilt=packMaterial(retained);
  assert.equal(rebuilt.tets[14],.75);
  assert.equal(rebuilt.tets[34],1);
  for(let i=3;i<rebuilt.floats.length;i+=24) assert.equal(rebuilt.floats[i],state.floats[i]);
  assert.equal(retained.material.tets[0].rest,state.material.tets[0].rest);
  assert.deepEqual(materialMasses(retained.material),materialMasses(state.material));
});
