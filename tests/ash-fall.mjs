// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {fallingLayout,sourceSettings,retainedVolume} from '../ash/fall-plan.mjs';
import {patchLayout} from '../ash/gpu-plan.mjs';
const patch=patchLayout({cellSize:.03,bounds:{min:[-.9,0,.1],max:[.9,.6,1.9]}});
test('transport size follows ground area and sample volume follows detail',()=>{
 const v=fallingLayout(patch);assert.equal(v.capacity,3600);assert.equal(v.parcelUnits,8);assert.equal(v.parcelVolume,.06**3);
 assert.equal(v.bytes,v.capacity*32);assert.throws(()=>fallingLayout({...patch,dims:[0,20,60]}),/layout/);
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
