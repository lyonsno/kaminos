import assert from 'node:assert/strict';
import test from 'node:test';
import * as grains from '../structural-material-stone-grains.mjs';

const positions=Array.from({length:12},(_,i)=>[i*.1,0,0]);
const bonds=positions.slice(1).map((_,i)=>[i,i+1]);
test('grain partition is complete, connected, deterministic and not a fragment cap',()=>{
 assert.equal(typeof grains.buildStoneGrains,'function');
 const input={positions,bonds,scale:.31,interiorStrength:8};
 const a=grains.buildStoneGrains(input),b=grains.buildStoneGrains(input);
 assert.deepEqual(a,b);assert.equal(a.nodeGrains.length,12);
 assert.equal(a.groups.flat().length,12);assert.equal(new Set(a.groups.flat()).size,12);
 assert.ok(a.groups.some(g=>g.length>1));assert.ok(a.groups.length>1);
 for(const group of a.groups){const ids=new Set(group),seen=new Set([group[0]]);let changed=true;while(changed){changed=false;for(const [x,y] of bonds)if(ids.has(x)&&ids.has(y)&&(seen.has(x)||seen.has(y))&&(!seen.has(x)||!seen.has(y))){seen.add(x);seen.add(y);changed=true;}}assert.equal(seen.size,group.length);}
 assert.ok(a.bondStrengths.includes(1));assert.ok(a.bondStrengths.includes(8));
 const finer=grains.buildStoneGrains({...input,scale:.09});assert.equal(finer.groups.length,12);
});
test('disconnected nearby material is never one grain; malformed controls fail',()=>{
 const a=grains.buildStoneGrains({positions:[[0,0,0],[.01,0,0]],bonds:[],scale:1});
 assert.equal(a.groups.length,2);
 for(const scale of [0,-1,NaN,Infinity])assert.throws(()=>grains.buildStoneGrains({positions,bonds,scale}));
 assert.throws(()=>grains.buildStoneGrains({positions,bonds:[[0,99]],scale:.3}));
});
