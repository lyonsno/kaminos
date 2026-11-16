// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {residentVolumeSweeps,directionalGridIndex,residentVolumeSettings,volumeRefreshDue} from '../particle-resident-volume.mjs';

test('each of six sweeps describes the same rectangular Fine domain with a distinct direction',()=>{
 const sweeps=residentVolumeSweeps([18,27,18]);
 assert.equal(sweeps.length,6);
 assert.deepEqual(sweeps.map(x=>x.direction),['+X','-X','+Y','-Y','+Z','-Z']);
 for(const s of sweeps){
  const corners=[s.emitter,s.receiver].flatMap(p=>[-1,1].flatMap(x=>[-1,1].map(y=>p.map((v,i)=>v+x*s.right[i]*s.halfWidth+y*s.up[i]*s.halfHeight))));
  assert.deepEqual([0,1,2].map(i=>Math.min(...corners.map(p=>p[i]))),[-1,-1,-1],s.direction);
  assert.deepEqual([0,1,2].map(i=>Math.max(...corners.map(p=>p[i]))),[1,2,1],s.direction);
 }
});
test('directional lattice remapping is bijective and antipodal depth reverses at the same receiver',()=>{
 const sweeps=residentVolumeSweeps([18,18,18]),n=3;
 for(const s of sweeps){
  const inputs=new Set();
  for(let z=0;z<n;z++)for(let y=0;y<n;y++)for(let x=0;x<n;x++)inputs.add(directionalGridIndex([x,y,z],n,s.map));
  assert.equal(inputs.size,27,s.direction);
 }
 const front=directionalGridIndex([0,2,0],n,sweeps[4].map),back=directionalGridIndex([0,2,0],n,sweeps[5].map);
 assert.equal(front,0);assert.equal(back%3,2);
});
test('every other actual material update skips the entire shared fresh atlas, including across a stepped frame',()=>{
 assert.deepEqual(Array.from({length:6},(_,i)=>volumeRefreshDue(i+1,2)),[true,false,true,false,true,false]);
 assert.equal(volumeRefreshDue(7,0),false);
 assert.equal(residentVolumeSettings({}).refreshEvery,2);
 assert.throws(()=>residentVolumeSettings({width:11}),/divisible/);
});
