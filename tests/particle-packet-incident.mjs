// kaminos-test: node
import assert from 'node:assert/strict';
import test from 'node:test';
import * as particle from '../volume-optical-particles.mjs';
import {opticalPacketIncidentFreshness} from '../volume-particle-packet-incident.mjs';

test('same-device packet fields describe complete Fine-local overlap lookup and refuse a wrong epoch',()=>{
 const buffer=size=>({size,usage:128});
 const identity={epoch:2,step:9,frame:14};
 const field={identity,centers:buffer(32),radiance:buffer(32),
  receiverCount:2,grid:{origin:[-1,-1,-1],dims:[2,2,2],pitch:1}};
 const bind=next=>particle.checkedOpticalPacketIncident(next,{epoch:2,step:9,frame:14},{maxStorageBufferBindingSize:1024,maxBufferSize:1024,maxComputeWorkgroupsPerDimension:64},128);
 assert.equal(bind(null),null);
 const accepted=bind(field);
 assert.equal(accepted.centers,field.centers,'GPU buffers are borrowed, not copied');
 assert.deepEqual(accepted.identity,identity);
 assert.throws(()=>bind({...field,identity:{...identity,epoch:3}}),/epoch/);
 assert.throws(()=>bind({...field,identity:{...identity,step:10}}),/future/);
 assert.throws(()=>bind({...field,identity:{...identity,frame:15}}),/future/);
 assert.throws(()=>bind({...field,centers:buffer(16)}),/centers/);
 assert.throws(()=>bind({...field,radiance:{size:32,usage:0}}),/radiance/);
 assert.throws(()=>bind({...field,grid:{...field.grid,pitch:0}}),/grid/);
 assert.equal(opticalPacketIncidentFreshness(accepted,2,9).ageSteps,0);
 assert.equal(opticalPacketIncidentFreshness(accepted,2,10).effective,'packet-incident-only');
 assert.equal(opticalPacketIncidentFreshness(accepted,2,11).effective,'legacy-light');
 assert.equal(opticalPacketIncidentFreshness(accepted,3,9).effective,'legacy-light');
 field.grid.origin[0]=3;assert.equal(accepted.grid.origin[0],-1);
});
