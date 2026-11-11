// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.core.js';
import {registerAuthoredSceneObject,restoreAuthoredSceneRecord} from '../scene-authored-runtime.mjs';
import {createWorkingScene} from '../working-scene.mjs';
import {createSceneMembershipOperations} from '../scene-membership-operations.mjs';

test('shared page/worker registrar retains explicit splat pose, metadata, grouping and activation',()=>{
 const scene=createWorkingScene(),calls=[],object=new THREE.Group();
 const membership=createSceneMembershipOperations({scene,records:{},roots:{},createGroup:(ids,label,metadata)=>calls.push({ids,label,metadata})});
 const pose={position:[1,2,3],rotation:[.1,.2,.3],scale:[1,1,1]},metadata={id:'known',type:'splat',source:'/api/saved.ply',sceneTransform:pose,groupLabel:'Authored',generation:{model:'retained'}};
 const entry=registerAuthoredSceneObject(object,metadata,{membership:()=>membership,copyTransform:structuredClone,
  readTransform(){throw Error('explicit pose must win');},createId(){throw Error('explicit id must win');},changed:()=>calls.push('changed')},{activate:true});
 assert.equal(scene.find('known'),entry);assert.equal(entry.object,object);assert.equal(scene.activeObjectId,'known');
 assert.deepEqual(entry.sceneTransform,pose);assert.notEqual(entry.sceneTransform,pose);assert.deepEqual(entry.generation,metadata.generation);
 assert.equal(calls[0].label,'Authored');assert.deepEqual(calls[0].ids,['known']);assert.equal(calls[1],'changed');
});

test('shared restoration preserves special pose owners and ordinary material/stand-in/group order',()=>{
 for(const type of ['glb','splat','flame-emitter']){
  const calls=[],entry={id:'asset',type,object:{}},pose={position:[1,0,0]},splatPose={position:[2,0,0]};
  const services=Object.fromEntries(['transform','splatPose','splatCorrection','flamePose','materials','removeStandIn','group'].map(name=>[name,(...args)=>calls.push({name,args})]));
  restoreAuthoredSceneRecord(entry,{id:'asset',transform:pose,sceneTransform:splatPose,materials:{opacity:.6},groupId:'group'},services);
  const expected=type==='splat'?['splatPose','splatCorrection']:type==='flame-emitter'?['flamePose']:['transform'];
  assert.deepEqual(calls.map(c=>c.name),[...expected,'materials','removeStandIn','group']);
  assert.equal(calls[0].args[1],type==='splat'?splatPose:pose);
 }
});
