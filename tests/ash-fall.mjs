// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {fallingLayout,sourceSettings,retainedVolume,fallingGroupState} from '../ash/fall-plan.mjs';
import {patchLayout} from '../ash/gpu-plan.mjs';
const patch=patchLayout({cellSize:.03,bounds:{min:[-.9,0,.1],max:[.9,.6,1.9]}});
test('transport size follows ground area and sample volume follows detail',()=>{
 const v=fallingLayout(patch);assert.equal(v.capacity,3600);assert.equal(v.parcelUnits,8);assert.equal(v.parcelVolume,.06**3);
 assert.equal(v.bytes,v.capacity*32);assert.throws(()=>fallingLayout({...patch,dims:[0,20,60]}),/layout/);
});
test('airborne scheduling is reconstructed from live mass including lane31 and a partial last group',()=>{
 const particles=new Float32Array(130*8);for(const i of [0,31,32,63,129])particles[i*8+3]=8;
 const result=fallingGroupState(particles,130);assert.deepEqual(Array.from(result.visible),[0,31,32,63,129]);
 assert.deepEqual(Array.from(result.packed.slice(0,6)),[0x80000001,0x80000001,0,0,2,0]);
 assert.equal(fallingGroupState(new Float32Array(130*8),130).visible.length,0);
 particles[3]=-1;assert.throws(()=>fallingGroupState(particles,130),/mass/);
});
test('source controls preserve requested rates and reject invalid input before mutation',()=>{
 const v=sourceSettings({rate:.006,spread:.2,position:[0,1,1]});assert.deepEqual(v,{rate:.006,spread:.2,position:[0,1,1]});
 for(const input of [{rate:-1},{spread:-1},{position:[0,NaN,1]}])assert.throws(()=>sourceSettings({...v,...input}),/source/);
 assert.equal(v.rate,.006);
});
test('mass includes airborne parcels and pending source rather than deleting blocked material',()=>{
 const cells=[1,.5],parcels=[0,0,0,2,0,0,0,0,0,0,0,.5,0,0,0,0];
 assert.ok(Math.abs(retainedVolume({density:cells,parcels,pendingUnits:3,cellSize:.1})-.007)<1e-15);
 assert.throws(()=>retainedVolume({density:cells,parcels,pendingUnits:-1,cellSize:.1}),/mass/);
});
