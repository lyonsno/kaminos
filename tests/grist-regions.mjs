// kaminos-test: node
import assert from 'node:assert/strict';
import test from 'node:test';
import {makeRegionState,regionSummary,retainRegionState} from '../earth-gpu/regions.mjs';
test('two material lattices own the same total mass before and after particulate composition',()=>{
 const s=makeRegionState({samplesPerRegion:24,gritCount:2});
 assert.equal(s.regionCount,2);
 assert.equal(s.sampleCount,48);
 assert.ok(s.connections.length>1);
 assert.equal(new Set(s.material.tets.map(t=>t.group)).size,2);
 const r=regionSummary(s);
 assert.ok(Math.abs(r.matrixMass-s.referenceMatrixMass)<s.referenceMatrixMass*1e-6);
 for(const a of s.attachments){assert.ok(Math.abs(a.weights.reduce((a,b)=>a+b,0)-1)<1e-12);assert.ok(a.nodeIds.every(i=>i>=s.grainCount));}
});
test('a retained specimen reconstructs the live bodies and irreversible connection state',()=>{
 const s=makeRegionState({samplesPerRegion:12,gritCount:1});
 assert.ok(s.linkWords.length>0);
 assert.equal(s.linkWords.length,(s.attachments.length+s.connections.length+s.grips.length)*16);
 assert.ok(s.floats.every(Number.isFinite));
 assert.ok(s.material.tets.every(t=>t.rest>0));
 const a=s.attachments[0],o=a.body*24;
 const target=[0,1,2].map(k=>a.nodeIds.reduce((v,id,j)=>v+s.floats[id*24+k]*a.weights[j],0));
 assert.ok(Math.hypot(...target.map((x,k)=>x-s.floats[o+k]))<1e-8);
});

test('captured packed and structured plastic history agree after yielding',()=>{
 const s=makeRegionState({samplesPerRegion:12,gritCount:1}),plastic=s.tets.slice(),links=s.linkWords.slice();plastic[8]*=1.25;links[(s.attachments.length)*16+14]=.7;
 const captured=retainRegionState(s,s.floats.slice(),plastic,links);
 assert.equal(captured.tets[8],captured.material.tets[0].plastic[0]);
 assert.equal(captured.linkWords[s.attachments.length*16+14],links[s.attachments.length*16+14]);
});
