// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import * as T from 'three';import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {exportCloneInWorld} from '../scene-export.mjs';import {checkedRepetition,createRepetitionView,withoutRepetitionCopies} from '../scene-repetition.mjs';
import {canRepeatSceneObject} from '../scene-repetition-controller.mjs';import {createSceneEdits,checkedPose} from '../scene-edit-session.mjs';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const fn=name=>{const a=html.indexOf('function '+name+'('),b=html.indexOf('\nfunction ',a+1);assert.ok(a>=0&&b>a);return html.slice(a,b);};
const pose={position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]},repetition=checkedRepetition({mode:'circle',count:6});

test('shared selection duplication carries the group relationship into interactive and direct copies',()=>{
 for(const interactive of [false,true]){
  const group={id:'ring',label:'Baffle ring',objectIds:['baffle'],transform:pose,repetition},created=[];
  const h={structuredClone,checkedRepetition,sceneSelection:{ids:['@group:ring'],activeId:'@group:ring'},sceneGroups:[group],sceneObjects:[{id:'baffle',type:'procedural-mesh'}],compoundRetentionTargets:new Map(),assertSceneConstructionAvailable(){},selectedRootIds:()=>['@group:ring'],sceneSelectionMembers:()=>['baffle'],canDuplicateObject:()=>true,checkSelectionMembership:x=>x,readSelectionMembership:()=>({groups:[group],selection:{ids:['@group:ring'],activeId:'@group:ring'}}),duplicateSceneObject:()=> 'copy',makeSceneObjectId:()=> 'ring-copy',createSceneGroupForObjects:(ids,label,options)=>created.push({...options,objectIds:ids,label}),setSceneSelection(){},detachSelectionMember(){},scenePlacementTools:{start:()=>true,edits:{discard(){},recordApplied(){}}}};
  vm.createContext(h);vm.runInContext(fn('duplicateSelectedSceneObjects'),h);h.duplicateSelectedSceneObjects({interactive});assert.equal(created.length,1);assert.equal(created[0].repetition?.count,6);assert.equal(created[0].repetition?.mode,'circle');
 }
});

test('ordinary attachment refuses an unsupported member before changing a repeated group or history',()=>{
 const groups=[{id:'ring',label:'Baffle ring',objectIds:['baffle'],transform:pose,repetition}],objects=[{id:'baffle',type:'procedural-mesh',object:new T.Mesh()},{id:'lamp',type:'light',object:new T.Group()}];
 const edits=createSceneEdits({read:()=>null,write(){}}),h={structuredClone,GROUP_TYPE:'group',sceneObjects:objects,checkedRepetition,canRepeatSceneObject,checkedGroupPose:checkedPose,assertSceneConstructionAvailable(){},serializeSceneGroups:()=>structuredClone(groups),scenePlacementTools:{edits}};
 vm.createContext(h);vm.runInContext(fn('checkedSceneGroups')+'\n'+fn('editSceneGroups')+'\n'+fn('attachSceneObject'),h);
 edits.register('@scene-groups',{read:()=>({groups:structuredClone(groups)}),check:value=>({groups:h.checkedSceneGroups(value.groups)}),write:value=>groups.splice(0,groups.length,...value.groups)});
 assert.throws(()=>h.attachSceneObject('lamp','ring'),/static mesh/);assert.deepEqual(groups[0].objectIds,['baffle']);assert.equal(groups[0].repetition.count,6);assert.equal(edits.state().undoCount,0);
 h.attachSceneObject('baffle',null);assert.equal(groups.length,0,'ordinary editing still works after refusal');edits.undo();assert.equal(groups[0].repetition.count,6);
});

globalThis.FileReader??=class{finish(result){this.result=result;this.onload?.({target:this});this.onloadend?.({target:this});}readAsArrayBuffer(blob){blob.arrayBuffer().then(x=>this.finish(x));}readAsDataURL(blob){blob.arrayBuffer().then(x=>this.finish(`data:${blob.type||'application/octet-stream'};base64,${Buffer.from(x).toString('base64')}`));}};
test('exported GLB repetitions become complete source geometry for another repetition',async()=>{
 const root=new T.Group();root.add(new T.Mesh(new T.BoxGeometry(),new T.MeshStandardMaterial()));const view=createRepetitionView(),line={mode:'line',count:3,step:[2,0,0]};view.sync(root,line,pose);
 const glb=await new GLTFExporter().parseAsync(exportCloneInWorld(root),{binary:true}),loaded=(await new GLTFLoader().parseAsync(glb,'')).scene;
 const count=object=>{let n=0;object.traverse(o=>{if(o.isMesh)n++;});return n;};assert.equal(count(loaded),3);
 let markers=0;loaded.traverse(o=>{if(o.userData.kaminosRepetitionCopy)markers++;});assert.equal(markers,0,'exported pieces have ordinary asset identity');
 view.sync(loaded,line,pose);assert.equal(count(loaded),9,'all three imported pieces appear in each new placement');
 assert.equal(withoutRepetitionCopies(loaded,()=>count(loaded)),3,'source topology includes every baked piece');assert.equal(root.children.filter(o=>o.userData.kaminosRepetitionCopy).length,2,'export leaves the live source relationship intact');
});
