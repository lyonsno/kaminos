// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.webgpu.js';
import {createBurnMaterial} from '../burn-table-material.mjs';
import {cloneSceneRadianceMaterial} from '../scene-radiance.mjs';
import {originalBurnMaterial} from '../scene-burn-body.mjs';
import {canRepeatSceneObject} from '../scene-repetition-controller.mjs';
import {checkedBurnable} from '../scene-burning-settings.mjs';
const library=new THREE.StandardNodeLibrary();
function fixture(){
 const original=new THREE.MeshStandardMaterial({color:'#92979c',roughness:.55,metalness:.05});
 const binding=createBurnMaterial({renderer:{library},original,bounds:new THREE.Box3(new THREE.Vector3(-1,-1,-1),new THREE.Vector3(1,1,1)),settings:{heat:0,char:0,reaction:0},presenceNode:THREE.TSL.float(1)});
 return {original,binding,lit:cloneSceneRadianceMaterial(library,binding.material)};
}
test('lit burn material duplicates from its authored source, without another body cutout',()=>{
 const {original,binding,lit}=fixture();
 assert.ok(originalBurnMaterial(lit)===original,'Lighting preserves authored source recovery');
 const copy=originalBurnMaterial(lit).clone();assert.equal(copy.opacityNode,undefined);assert.equal(copy.alphaTest,0);
 binding.dispose();lit.dispose();original.dispose();copy.dispose();
});
test('source edits reach both burn and outer lighting materials without replacing the burn graph',()=>{
 const {original,binding,lit}=fixture(),node=lit.colorNode,opacity=lit.opacityNode;
 original.color.set('#ff0000');original.roughness=.2;original.metalness=.8;
 binding.update(12,lit);
 for(const m of [binding.material,lit]){assert.equal(m.color.getHexString(),'ff0000');assert.equal(m.roughness,.2);assert.equal(m.metalness,.8);}
 assert.equal(lit.colorNode,node);assert.equal(lit.opacityNode,opacity);assert.equal(lit.alphaTest,.5);
 original.color.set('#92979c');binding.update(12,lit);assert.equal(lit.color.getHexString(),'92979c');
 binding.dispose();lit.dispose();original.dispose();
});
test('burnables reject linked repeated placements but can always be disabled',()=>{
 const entry={id:'a',type:'procedural-mesh',object:new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial()),burnable:{enabled:true,material:'wood'}};
 assert.equal(canRepeatSceneObject(entry),false);
 const repeated={...entry,repetition:{mode:'line',count:2}};
 assert.throws(()=>checkedBurnable(repeated),/independent objects/);
 assert.deepEqual(checkedBurnable(repeated,{enabled:false,material:'wood'}),{enabled:false,material:'wood'});
 entry.burnable.enabled=false;assert.equal(canRepeatSceneObject(entry),true);
});
