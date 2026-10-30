// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {createKilnBurnWindow,checkedBurnerSeconds} from '../kiln-burn-window.mjs';
test('default burner closes after five visible seconds, independently of generation',()=>{
 let now=0;const window=createKilnBurnWindow({clock:()=>now});window.start();now=4999;assert.equal(window.read().emitting,true);now=5000;assert.equal(window.read().emitting,false);now=125000;assert.equal(window.read().elapsedSeconds,5);
});
test('pausing preserves the admitted interval and does not restart it',()=>{
 let now=0;const window=createKilnBurnWindow({seconds:2,clock:()=>now});window.start();now=500;window.pause();now=10000;assert.equal(window.read().elapsedSeconds,.5);window.resume();now=11500;assert.equal(window.read().emitting,false);window.pause();window.resume();assert.equal(window.read().emitting,false);
});
test('authored duration accepts zero and finite positive values without a hidden ceiling',()=>{
 assert.equal(checkedBurnerSeconds(undefined),5);assert.equal(checkedBurnerSeconds(0),0);assert.equal(checkedBurnerSeconds(900),900);for(const bad of [-1,NaN,Infinity,'5'])assert.throws(()=>checkedBurnerSeconds(bad));
});
const {BufferGeometry,Float32BufferAttribute,Mesh,MeshStandardMaterial}=await import('../lib/three.core.js');
const {promptReliefMetadata,promptReliefRecord,restorePromptRelief}=await import('../inference-kiln-record.mjs');
test('authored burner duration round-trips with the ordinary saved lettering record',()=>{
 const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute([0,0,0,1,0,0,0,1,0],3));const object=new Mesh(geometry,new MeshStandardMaterial());object.userData.kaminosPromptRelief={...promptReliefMetadata('words','composed'),burnerSeconds:7.5};
 const record=promptReliefRecord(object),restored=restorePromptRelief(record);assert.equal(restored.userData.kaminosPromptRelief.burnerSeconds,7.5);
 delete record.promptRelief.burnerSeconds;const legacy=restorePromptRelief(record);assert.equal(legacy.userData.kaminosPromptRelief.burnerSeconds,5);
 for(const mesh of [object,restored,legacy]){mesh.geometry.dispose();mesh.material.dispose();}
});
