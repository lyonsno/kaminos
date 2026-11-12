// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {Mesh,BoxGeometry,MeshStandardMaterial} from '../lib/three.core.js';
import {installMaterialInspector} from '../scene-material-inspector.mjs';
import {createSceneMaterials,materialDefinitions} from '../scene-material-recipes.mjs';
import {createSceneEdits} from '../scene-edit-session.mjs';

function fixture(){
 const entries=Object.fromEntries(['a','b','c','locked'].map(id=>[id,{id,label:id,object:new Mesh(new BoxGeometry(),new MeshStandardMaterial())}]));
 entries.locked.burnable={enabled:true};
 const definitions=materialDefinitions.filter(d=>d.id==='standard-surface').map(d=>({...d,create:({base,parameters})=>{
   const material=base.clone(),update=p=>{material.roughness=p.roughness;};update(parameters);
   return {material,update,dispose:()=>material.dispose()};
 }}));
 const finish=(id,roughness)=>({id,name:id,implementation:'standard-surface',version:1,parameters:{color:'#777777',metalness:.3,roughness}});
 const binding=(objectId,recipeId)=>({objectId,slot:'.:0',recipeId});
 const original={recipes:[finish('shared',.2),finish('other',.4)],bindings:[binding('a','shared'),binding('b','other'),binding('c','shared')]};
 const materials=createSceneMaterials({entries:()=>Object.values(entries),definitions});
 materials.write(original);
 const edits=createSceneEdits({read:()=>null,write:()=>{}});
 const element=tag=>Object.assign(new EventTarget(),{ownerDocument:document,tag,style:{},children:[],dataset:{},append(...args){this.children.push(...args);},replaceChildren(){this.children=[];},querySelectorAll(){return [];},setAttribute(){},add(){},classList:{add(){}}});
 const document={createElement:element,addEventListener(){},removeEventListener(){},defaultView:{addEventListener(){},removeEventListener(){},Option:class{}}};
 const selection=['a','b','light','locked','a'];
 const root=element('root');
 const inspector=installMaterialInspector({document,root,materials,definitions,edits,selected:id=>entries[id??'a'],selection:()=>({ids:selection,memberIds:selection}),assertAvailable(){},changed(){},error:assert.fail});
 return {inspector,edits,entries,original,materials,root};
}

test('selection edits common fields once, splitting recipes only when unselected slots share them',()=>{
 const {inspector,edits,entries,original,materials}=fixture();
 const info=inspector.readSelection();
 assert.equal(info.slots,2);
 assert.deepEqual(info.fields.find(f=>f.key==='roughness').mixed,true);
 assert.equal(info.skipped,2);
 assert.throws(()=>inspector.editSelection({roughness:2}),/Roughness/);
 assert.deepEqual(materials.read(),original);
 assert.equal(edits.state().undoCount,0);
 inspector.editSelection({roughness:.6});
 assert.deepEqual(['a','b','c'].map(id=>entries[id].object.material.roughness),[.6,.6,.2]);
 assert.equal(materials.read().recipes.length,3);
 assert.equal(edits.state().undoCount,1);
 edits.undo();
 assert.deepEqual(materials.read(),original);
 edits.redo();
 assert.deepEqual(['a','b','c'].map(id=>entries[id].object.material.roughness),[.6,.6,.2]);
});

test('assigning or restoring a finish affects selected mesh slots in one undo, including a previously unbound slot',()=>{
 const {inspector,edits,entries,original,materials}=fixture();
 entries.unbound={id:'unbound',object:new Mesh(new BoxGeometry(),new MeshStandardMaterial())};
 const ids=['a','b','unbound','locked','light','a'];
 inspector.assignSelection('other',ids);
 assert.deepEqual(['a','b','unbound','c','locked'].map(id=>entries[id].object.material.roughness),[.4,.4,.4,.2,1]);
 assert.equal(edits.state().undoCount,1);
 inspector.assignSelection(null,ids);
 assert.deepEqual(materials.read().bindings,[original.bindings[2]]);
 edits.undo();
 assert.equal(materials.read().bindings.length,4);
 edits.undo();
 assert.deepEqual(materials.read(),original);
});

test('bulk numeric preview reuses a single private copy, then cancels or commits as one edit',()=>{
 const {edits,entries,original,materials,root}=fixture();
 const field=()=>root.children.flatMap(x=>x.children).find(x=>x.dataset.selectionMaterialParam==='roughness');
 let input=field();
 const change=(control,value)=>{control.value=String(value);control.valueAsNumber=value;control.dispatchEvent(new Event('input'));};
 input.dispatchEvent(new Event('focusin'));change(input,.7);
 assert.deepEqual(['a','b','c'].map(id=>entries[id].object.material.roughness),[.7,.7,.2]);
 const aCopy=materials.read().bindings.find(x=>x.objectId==='a').recipeId;
 change(input,.8);assert.equal(materials.read().bindings.find(x=>x.objectId==='a').recipeId,aCopy);
 assert.equal(edits.state().undoCount,0);
 input.dispatchEvent(new Event('pointercancel'));
 assert.deepEqual(materials.read(),original);
 input=field();input.dispatchEvent(new Event('focusin'));change(input,.65);
 input.dispatchEvent(new Event('change'));assert.equal(edits.state().undoCount,1);
 edits.undo();assert.deepEqual(materials.read(),original);
});
