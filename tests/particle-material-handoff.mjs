// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import * as particle from '../volume-optical-particles.mjs';

test('material queries borrow the live buffers, refuse a stale step, and replace the generation on reset',()=>{
 const submitted=[],finish={},device={createCommandEncoder:()=>({finish:()=>finish}),queue:{submit:commands=>submitted.push(commands)}};
 const handoff=particle.createParticleMaterialHandoff(device);
 const particles={label:'actual particles'},options={},fine={},sourceOptions={};
 const transform={scale:2,translate:[1,3,5]};
 const frame={step:18,frame:23,slots:130,dims:[4,5,4],transform,particles,options,fine,sourceOptions,acquisitionMode:1};
 assert.equal(handoff.submit(18,()=>assert.fail('absent frame')).available,false);
 handoff.publish(frame);
 transform.translate[0]=99;
 assert.equal(handoff.submit(19,()=>assert.fail('stale frame')).available,false);
 assert.deepEqual(submitted,[]);
 const first=handoff.submit(18,(encoder,input)=>{
  assert.equal(input.particles,particles);
  assert.equal(input.options,options);
  assert.equal(input.fine,fine);
  assert.equal(input.sourceOptions,sourceOptions);
  assert.deepEqual(input.domain,{origin:[-1,-1,-1],pitch:.5,dims:[4,5,4],worldFromFine:{scale:2,translate:[1,3,5]}});
  assert.equal(input.coverage.kind,'camera-acquired');
  assert.equal(input.coverage.unsampled,'unknown');
  assert.equal(input.identity.step,18);
 });
 assert.equal(first.available,true);
 assert.deepEqual(submitted,[[finish]]);
 assert.throws(()=>handoff.submit(18,async()=>{}),/synchronous/);
 assert.equal(submitted.length,1);
 handoff.publish({...frame,step:19,frame:24});
 assert.equal(handoff.submit(19,()=>{}).identity.epoch,first.identity.epoch);
 const pending=handoff.invalidate();
 handoff.reset();
 handoff.publish({...frame,step:19},pending);
 assert.equal(handoff.submit(19,()=>assert.fail('reset frame')).available,false);
 handoff.publish({...frame,acquisitionMode:2});
 const next=handoff.submit(18,(_,input)=>assert.equal(input.coverage.kind,'emitter-born'));
 assert.notEqual(next.identity.epoch,first.identity.epoch);
});
