// kaminos-test: node
// Actual contribution, owned Three root and byte-source substitution. The
// scene loader below is a policy fixture; native GLTF conformance is separate.
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.core.js';
import definition from '../experiments/creature-motion/retained.experiment.mjs';
import {bytes} from './creature-body-fixture.mjs';
import {reopenVerifiedCreature} from '../experiments/creature-motion/body-source.mjs';
const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
const nativeFetch=globalThis.fetch;globalThis.fetch=async()=>new Response(bytes);
let loads=0;const scene=new THREE.Scene(),unrelated=new THREE.Group();scene.add(unrelated);
const source={source_sha256:'a'.repeat(64),frames:60,fps:30,retargeted:false};
const transform={position:[3,2,1],quaternion:new THREE.Quaternion().setFromEuler(new THREE.Euler(.2,.5,-.1)).toArray(),scale:[1.5,.8,2]};
const root=new THREE.Group(),bone=new THREE.Object3D();bone.name='pelvis';root.add(bone);root.userData.native_motion=source;
const clip=new THREE.AnimationClip('trot',59/30,[new THREE.VectorKeyframeTrack('pelvis.position',[0,59/30],[0,0,0,0,0,1])]);
const session={loadAsset:async options=>{loads++;assert.ok(options.url.startsWith('blob:'));assert.equal(options.metadata.source,'/body.glb');
 const loaded=await nativeFetch(options.url);assert.deepEqual(new Uint8Array(await loaded.arrayBuffer()),bytes,'loader consumes verified bytes, not another mutable source fetch');
 scene.add(root);return {id:'body',root,clips:[clip],source:options.metadata.source};},onFrame:()=>()=>{},redraw:()=>{},readView:()=>({}),setView:()=>{},dispose:async()=>scene.remove(root)};
const inputs={asset:'/body.glb',source_sha256:source.source_sha256,body_sha256:sha,frame:30,transform};
try {
 const owner=await definition.create({host:{scene:{open:()=>session}},inputs});
 try {
  assert.equal(owner.read().asset.bodySha256,sha,'read must carry observed body digest');
  assert.deepEqual(root.position.toArray(),transform.position,'captured placement must survive reconstruction');
  assert.deepEqual(root.quaternion.toArray(),transform.quaternion);assert.deepEqual(root.scale.toArray(),transform.scale);
  assert.deepEqual(owner.operations.hold().inputs.transform,transform);
  assert.equal(unrelated.parent,scene);
 }finally{await owner.dispose();}
 const prior=loads;
 await assert.rejects(definition.create({host:{scene:{open:()=>session}},inputs:{...inputs,body_sha256:'b'.repeat(64)}}),/body.*(content|digest|identity)/i);
 assert.equal(loads,prior,'wrong byte identity must reject before scene registration');
 let opens=0;
 const recipe={id:'marionette/retained-creature',inputs};
 const entry={async open(id,next){opens++;globalThis.fetch=async()=>new Response(new Uint8Array([9,9,9,9]));
  const owner=await definition.create({host:{scene:{open:()=>session}},inputs:next});try{return owner.read();}finally{await owner.dispose();}}};
 const reconstructed=await reopenVerifiedCreature(entry,recipe);assert.equal(opens,1);assert.equal(reconstructed.asset.bodySha256,sha);
 await assert.rejects(reopenVerifiedCreature(entry,recipe),/body content digest/);assert.equal(opens,1,'changed source must reject before closing the current owner');
 assert.equal(unrelated.parent,scene);
}finally{globalThis.fetch=nativeFetch;}
console.log('Actual creature byte admission, transformed reconstruction and pre-replacement rejection pass; immutable Blob defeats source-fetch race');
