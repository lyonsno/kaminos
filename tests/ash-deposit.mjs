// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {AshDeposit} from '../ash/deposit.mjs';
const settle=d=>{let n=0;while(d.read().activeCells && n++<500)d.step();assert.equal(d.read().activeCells,0,'material settles to sleep');};
test('falling material stops at support, conserves amount, then costs no cell visits',()=>{
 const d=new AshDeposit();d.add([0,4,0],1);settle(d);
 assert.ok(d.snapshot().cells.every(c=>c[1]===0));assert.equal(d.read().mass,1);
 assert.equal(d.step().visited,0);
});
test('local disturbance work is independent of distant sleeping deposits',()=>{
 const small=new AshDeposit(),large=new AshDeposit();
 for(let x=20;x<120;x++)large.add([x,0,0],.2);settle(large);
 for(const d of [small,large])d.add([0,2,0],.2);
 assert.equal(small.step().visited,large.step().visited);
});
test('separate upper and lower deposits and support removal',()=>{
 let ledge=true;const d=new AshDeposit({solid:([x,y,z])=>y<0||(ledge&&y===2&&Math.abs(x)<2&&Math.abs(z)<2)});
 d.add([0,0,0],.2);d.add([0,3,0],.2);settle(d);
 assert.equal(d.amount([0,3,0]),.2);assert.equal(d.amount([0,0,0]),.2);
 ledge=false;d.wakeBox([-2,2,-2],[2,4,2]);settle(d);
 assert.equal(d.amount([0,3,0]),0);assert.ok(Math.abs(d.read().mass-.4)<1e-10);
});
test('contact displaces material without deleting it and snapshot continues exactly',()=>{
 const d=new AshDeposit();for(let x=-3;x<=3;x++)for(let z=-3;z<=3;z++)d.add([x,0,z],.5);settle(d);
 const mass=d.read().mass;d.press([0,0,0],1.5);assert.equal(d.amount([0,0,0]),0);
 assert.ok(Math.abs(d.read().mass-mass)<1e-9);
 const copy=AshDeposit.restore(JSON.parse(JSON.stringify(d.snapshot())));
 assert.deepEqual(copy.snapshot(),d.snapshot());d.step();copy.step();assert.deepEqual(copy.snapshot(),d.snapshot());
});
test('surface dirtiness drains, no unrelated chunks rebuild, invalid restore fails',()=>{
 const d=new AshDeposit();d.add([0,0,0],.2);d.add([80,0,0],.2);settle(d);d.takeDirtyBlocks();
 assert.deepEqual(d.takeDirtyBlocks(),[]);d.add([0,0,0],.1);
 assert.ok(d.takeDirtyBlocks().every(k=>Number(k.split(',')[0])<2));
 const bad=d.snapshot();bad.cells[0][3]=-1;assert.throws(()=>AshDeposit.restore(bad),/amount/);
});
