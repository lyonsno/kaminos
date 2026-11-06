// kaminos-test: node
import assert from 'node:assert/strict';
import {emissionRegionPlan} from '../scene-emission-cells.mjs';
import {sceneTransportDomain} from '../scene-volume-source.mjs';
const field={status:'encoded',texture:{},dimensions:[4,8,4],localMin:[-1,-1,-1],localMax:[1,3,1],generation:2,frame:9};
const region={status:'encoded',texture:{},emissionTexture:{},dimensions:[4,8,4],localMin:[-3,-3,-3],localMax:[3,9,3],generation:2,frame:9};
assert.equal(emissionRegionPlan(field).count,128);
field.exterior={...region};let plan=emissionRegionPlan(field);
assert.equal(plan.count,256);assert.equal(plan.bytes,8192);
assert.deepEqual(plan.regions.map(r=>r.offset),[0,128]);assert.deepEqual(plan.lo,[-3,-3,-3]);assert.deepEqual(plan.hi,[3,9,3]);
assert.deepEqual(sceneTransportDomain(field).hi,[3,9,3]);
field.exterior.middle={...region,localMin:[-4,-4,-4],localMax:[4,12,4]};plan=emissionRegionPlan(field);
assert.equal(plan.count,384);assert.deepEqual(plan.hi,[3,9,3],'Middle refines World without extending its ownership');
assert.throws(()=>emissionRegionPlan(field,{maxStorageBufferBindingSize:8192}),/capacity/);
field.exterior.middle.frame=8;assert.throws(()=>emissionRegionPlan(field),/current/);
field.exterior.frame=8;assert.throws(()=>sceneTransportDomain(field),/current/);
console.log('PASS all-region source capacity, physical support and current-frame admission');
