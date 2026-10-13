// kaminos-test: node
import assert from 'node:assert/strict';
import './creature-body-fixture.mjs';
import * as THREE from '../lib/three.core.js';
import definition from '../experiments/creature-motion/retained.experiment.mjs';
const root=new THREE.Group();
root.userData.native_motion={frames:31,fps:30,source_sha256:'a'.repeat(64),retargeted:false};
const clip=new THREE.AnimationClip('retained',1,[new THREE.VectorKeyframeTrack('.position',[0,1],[0,0,0,0,0,1])]);
const asset={id:'observed-shared-registration',root,clips:[clip],source:'/retained.glb'},calls=[],subscribers=new Set();
const session={loadAsset:async()=>asset,onFrame:callback=>(subscribers.add(callback),()=>subscribers.delete(callback)),redraw(){},readView:()=>({}),setView(){},dispose(){}};
const host={scene:{open:async()=>session,refreshPresentation(receipt){assert.equal(receipt,asset);calls.push({position:root.position.toArray(),quaternion:root.quaternion.toArray(),scale:root.scale.toArray()});}}};
const transform={position:[3,2,1],quaternion:[0,0,0,1],scale:[1.5,.8,2]};
const experiment=await definition.create({host,inputs:{asset:'/retained.glb',source_sha256:'a'.repeat(64),frame:15,transform}});
assert.deepEqual(calls,[transform],'source-owned root restoration must explicitly refresh its actual shared presentation once');
experiment.operations.resume();for(const callback of [...subscribers])callback({deltaSeconds:.1});
assert.equal(calls.length,1,'ordinary playback must not refresh the inspector per frame');
await experiment.dispose();
console.log('Actual shared presentation receipt follows restored PRS once; playback stays redraw-only');
