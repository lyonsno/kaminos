// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {patchLayout,pairTransfer} from '../ash/gpu-plan.mjs';
import {referenceTileStep,cellIndex,exposedFaces} from '../ash/tile-plan.mjs';
test('newly occupied cells evacuate material without admitting ash into empty solids',()=>{
 const pair={a:.8,b:.1,axis:0,penetrationA:0,penetrationB:0};
 assert.equal(pairTransfer({...pair,solidA:2,solidB:0}),.8);
 assert.equal(pairTransfer({...pair,solidA:0,solidB:2}),-.1);
 assert.ok(Math.abs(pairTransfer({...pair,solidA:2,solidB:2})-.35)<1e-12);
 assert.equal(pairTransfer({...pair,a:0,solidA:2,solidB:0}),0);
 assert.equal(pairTransfer({...pair,solidA:1,solidB:2}),0);
});
test('inserting then removing actual occupied cells conserves material and releases support',()=>{
 const p=patchLayout({cellSize:1,bounds:{min:[0,0,0],max:[12,6,8]},tileSize:3});
 let values=new Float32Array(p.count);const solid=new Uint8Array(p.count);
 for(let z=1;z<7;z++)for(let x=1;x<11;x++)values[cellIndex(p,[x,0,z])]=.8;
 const sum=a=>a.reduce((s,v)=>s+v,0),initial=sum(values);
 for(let z=2;z<6;z++)for(let y=0;y<3;y++)for(let x=4;x<7;x++)solid[cellIndex(p,[x,y,z])]=2;
 for(let n=0;n<100;n++)values=referenceTileStep(p,{values,solid,all:true}).values;
 assert.ok(sum(values.filter((v,i)=>solid[i]))<.001,'object clears its occupied volume');
 assert.ok(Math.abs(sum(values)-initial)<.0001,'insertion retains mass');
 solid.fill(0);
 for(let n=0;n<100;n++)values=referenceTileStep(p,{values,solid,all:true}).values;
 assert.ok(Math.abs(sum(values)-initial)<.0001,'removal retains mass');
 assert.ok(values[cellIndex(p,[5,0,3])]>.1,'released footprint receives ash');
});
test('closed capacity retains overlapped ash instead of silently discarding it',()=>{
 const p=patchLayout({cellSize:1,bounds:{min:[0,0,0],max:[4,4,4]},tileSize:2});
 const values=new Float32Array(p.count).fill(1),solid=new Uint8Array(p.count).fill(2);
 const result=referenceTileStep(p,{values,solid,all:true});
 assert.deepEqual(result.values,values);
});

test('sub-cell evacuation residue retains mass without rendering a full-width cap',()=>{
 const p=patchLayout({cellSize:.04,bounds:{min:[0,0,0],max:[.08,.08,.08]},tileSize:2});
 const values=new Float32Array(p.count);values[0]=1e-7;
 assert.equal(exposedFaces(p,values).length,0);
 assert.ok(values[0]>0,'rendering does not erase retained material');
 values[0]=.01;assert.ok(exposedFaces(p,values).length>0);
});
