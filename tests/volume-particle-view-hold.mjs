// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {opticalParticleSettings} from '../volume-optical-particles.mjs';

test('optical view locking is an independent validated observation control',()=>{
 assert.equal(opticalParticleSettings().lockIntegrationView,false);
 const s=opticalParticleSettings({lockIntegrationView:true,updateEnabled:true});
 assert.equal(s.lockIntegrationView,true);
 assert.equal(s.updateEnabled,true,'view locking must not silently stop material updates');
 assert.throws(()=>opticalParticleSettings({lockIntegrationView:1}),/boolean/);
});

import {createParticleViewFrame} from '../volume-particle-view.mjs';
const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const frame=(x=0)=>({viewProj:identity.map((v,i)=>i===12?x:v),inverse:identity.map((v,i)=>i===12?-x:v),size:[320,240]});
test('view locking pins the last evaluated frame while the viewing camera keeps changing',()=>{
 const owner=createParticleViewFrame();const a=owner.select(frame(0));
 const b=owner.select(frame(2),true);assert.deepEqual(b.viewProj,a.viewProj);assert.equal(b.locked,true);
 const c=owner.select(frame(4),true);assert.deepEqual(c.viewProj,a.viewProj);
 const d=owner.select(frame(4),false);assert.deepEqual(d.viewProj,frame(4).viewProj);assert.equal(d.locked,false);
 assert.deepEqual(owner.select(frame(6),true).viewProj,d.viewProj,'relocking uses the last live optical frame');
});
test('optical frame owns its coordinates and only a reset admits a different source while locked',()=>{
 const owner=createParticleViewFrame(),input=frame(1);owner.select(input);input.viewProj[12]=99;
 assert.equal(owner.select(frame(2),true).viewProj[12],1);
 owner.reset();assert.equal(owner.select(frame(3),true).viewProj[12],3);
 assert.throws(()=>owner.select({...frame(),inverse:[1]},false),/inverse/);
});

test('a manually moved common optical frame overrides the viewer without changing the lock preference',()=>{
 const owner=createParticleViewFrame();owner.select(frame(0));const manual=frame(7);
 const a=owner.select(frame(2),false,manual);
 assert.deepEqual(a.viewProj,manual.viewProj,'the common manual frame must drive all optical projections');
 assert.equal(a.locked,true);assert.equal(a.manual,true);
 assert.deepEqual(owner.select(frame(9),false,manual).viewProj,manual.viewProj,'viewer movement is independent');
 assert.deepEqual(owner.select(frame(9),false).viewProj,frame(9).viewProj,'leaving manual control resumes the viewer');
});
