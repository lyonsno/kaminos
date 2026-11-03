// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {patchLayout} from '../ash/gpu-plan.mjs';
import {referenceTileStep,seededTiles,cellIndex} from '../ash/tile-plan.mjs';
test('spatial resistance changes conservative lateral settling without waking untouched tiles',()=>{
 const p=patchLayout({cellSize:.04,bounds:{min:[0,0,0],max:[1.28,.16,1.28]},tileSize:4});
 const values=new Float32Array(p.count);for(let z=8;z<24;z++)for(let x=8;x<24;x++)values[cellIndex(p,[x,0,z])]=.8;
 const pending=seededTiles(p,values),ordinary=referenceTileStep(p,{values,pending}),varied=referenceTileStep(p,{values,pending,sliding:{variation:1,scale:.24}});
 assert.notDeepEqual(varied.values,ordinary.values);
 assert.deepEqual(varied.active,ordinary.active);
 assert.ok(Math.abs(varied.values.reduce((a,b)=>a+b,0)-values.reduce((a,b)=>a+b,0))<1e-4);
 assert.ok(varied.values.every(v=>v>=0&&v<=1));
});
import {checkedSliding,slidingThreshold} from '../ash/sliding.mjs';
test('resistance is stable, bounded, continuous and independent of height',()=>{
 assert.throws(()=>checkedSliding({variation:2}),/variation/);assert.throws(()=>checkedSliding({scale:0}),/scale/);
 const samples=[];for(let x=-12;x<12;x++)for(let z=-12;z<12;z++){
  const p=[x*.037,0,z*.037],a=slidingThreshold(p,{variation:1,scale:.24});samples.push(a);
  assert.ok(a>=.15&&a<=.85);assert.equal(a,slidingThreshold([p[0],20,p[2]],{variation:1,scale:.24}));
  assert.ok(Math.abs(a-slidingThreshold([p[0]+1e-6,0,p[2]],{variation:1,scale:.24}))<1e-4);
  assert.equal(slidingThreshold(p,{variation:0}),.5);
 }assert.ok(Math.max(...samples)-Math.min(...samples)>.4);
});
test('variable resistance preserves partition parity and eventually sleeps after a finite deposit',()=>{
 for(const tileSize of [3,4]){
  const p=patchLayout({cellSize:.04,bounds:{min:[-.32,0,-.32],max:[.32,.16,.32]},tileSize});
  let values=new Float32Array(p.count);for(let z=5;z<11;z++)for(let x=5;x<11;x++)for(let y=0;y<3;y++)values[cellIndex(p,[x,y,z])]=1;
  let pending=seededTiles(p,values),steps=0;const sliding={variation:1,scale:.24};
  while(pending.size&&steps<1000){
   const next=referenceTileStep(p,{values,pending,sliding}),full=referenceTileStep(p,{values,all:true,sliding});
   assert.deepEqual(next.values,full.values);values=next.values;pending=next.pending;steps++;
  }
  assert.equal(pending.size,0);assert.ok(Math.abs(values.reduce((a,b)=>a+b,0)-108)<1e-4);
  const quiet=referenceTileStep(p,{values,pending,sliding});assert.equal(quiet.active.size,0);assert.deepEqual(quiet.values,values);
 }
});
import {pairTransfer} from '../ash/gpu-plan.mjs';
test('non-dyadic repose stops sub-precision creep without dropping retained mass',()=>{
 const input={a:.7000001,b:.2,axis:0,solidA:0,solidB:0,penetrationA:0,penetrationB:0,threshold:.5,tolerance:1e-6};
 assert.equal(pairTransfer(input),0);
 assert.ok(pairTransfer({...input,a:.71})>0);
});
test('slide release moves farther only after yielding, with bounded conservative transfer',()=>{
 const p={a:.8,b:.1,axis:0,solidA:0,solidB:0,penetrationA:0,penetrationB:0,threshold:.5};
 assert.ok(pairTransfer({...p,release:.5})>pairTransfer(p));
 assert.equal(pairTransfer({...p,a:.55,release:1}),0);
 for(const release of [0,.5,1]){const v=pairTransfer({...p,release});assert.ok(p.a-v>=0&&p.b+v<=1);assert.ok(Math.abs((p.a-v)+(p.b+v)-(p.a+p.b))<1e-15);}
 assert.throws(()=>checkedSliding({release:2}),/release/);
});
