// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {patchLayout} from '../ash/gpu-plan.mjs';
import {cellIndex,cellCoord,tileIndex,seededTiles,referenceTileStep,exposedFaces} from '../ash/tile-plan.mjs';
test('tile storage covers partial boundary bricks without changing physical bounds',()=>{
 const p=patchLayout({cellSize:.1,bounds:{min:[0,0,0],max:[1,.5,.9]},tileSize:4});
 assert.deepEqual(p.tiles?.dims,[3,2,3]);
 assert.equal(p.tiles.count,18);
 assert.equal(p.tiles.cellsPerTile,64);
 assert.equal(p.tiles.phaseHalo,2);
 assert.deepEqual(p.dims,[10,5,9]);
});
test('partitioned global parity matches monolithic exchange across odd bricks and boundaries',()=>{
 for(const width of [2,3,4,8]){
  const p=patchLayout({cellSize:.1,bounds:{min:[0,0,0],max:[1.1,.7,.9]},tileSize:width}),solid=new Uint8Array(p.count);
  let values=new Float32Array(p.count);for(let i=0;i<p.count;i++){const c=cellCoord(p,i);if(c[0]===4&&c[1]<3)solid[i]=1;else if(i%7===0)values[i]=.75;}
  let pending=seededTiles(p,values),expected=values.slice();
  for(let step=0;step<15;step++){
   const contact=step<7?[.2+step*.09,.3,.4,.15]:null;
   const a=referenceTileStep(p,{values,solid,pending,contact,previous:step?[.2+(step-1)*.09,.3,.4,.15]:null}),b=referenceTileStep(p,{values:expected,solid,all:true,contact,previous:step?[.2+(step-1)*.09,.3,.4,.15]:null});
   assert.deepEqual(a.values,b.values);values=a.values;expected=b.values;pending=a.pending;
  }
 }
});
test('settled bed sleeps and swept contact wakes distant tiles without erasing settled history',()=>{
 const p=patchLayout({cellSize:.1,bounds:{min:[0,0,0],max:[6.4,.8,6.4]},tileSize:8});
 const values=new Float32Array(p.count);for(let z=0;z<64;z++)for(let x=0;x<64;x++)values[cellIndex(p,[x,0,z])]=1;
 const sleep=referenceTileStep(p,{values,pending:seededTiles(p,values)});assert.equal(sleep.pending.size,0);
 const quiet=referenceTileStep(p,{values:sleep.values,pending:sleep.pending});assert.equal(quiet.active.size,0);assert.deepEqual(quiet.values,values);
 const contact=[4,.02,3.2,.18],previous=[2,.02,3.2,.18];
 const wake=referenceTileStep(p,{values:quiet.values,pending:quiet.pending,contact,previous});
 assert.ok(wake.active.size>0&&wake.active.size<p.tiles.count);assert.notDeepEqual(wake.values,values);
 assert.ok(wake.active.has(tileIndex(p,[20,0,32]))&&wake.active.has(tileIndex(p,[40,0,32])));
 assert.ok(Math.abs(wake.values.reduce((a,b)=>a+b,0)-4096)<1e-4);
});
test('cached face contract removes internal faces and retains fractional side strips across a brick seam',()=>{
 const p=patchLayout({cellSize:1,bounds:{min:[0,0,0],max:[2,1,1]},tileSize:1});
 const faces=exposedFaces(p,new Float32Array([1,.25]));assert.equal(faces.length,11);
 assert.ok(faces.some(f=>f.cell===0&&f.face===1&&f.low===.25&&f.high===1));
 assert.ok(!faces.some(f=>f.cell===1&&f.face===0));
 assert.equal(exposedFaces(p,new Float32Array([1,1])).length,10);
});
