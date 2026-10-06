import {PROCEDURAL_MESH_TYPE,PROCEDURAL_MESH_SOURCE,checkedProceduralMesh} from '../scene-geometry.mjs';
import {GROUP_TYPE,checkedGroupPose} from '../scene-group.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createSceneEdits} from '../scene-edit-session.mjs';
import {checkedBurnerBed,checkedAssemblyPose,BURNER_ASSEMBLY_TYPE,BURNER_BED_TYPE,BURNER_BED_SOURCE} from '../burner-assembly.mjs';
import {normalizeBurner,BURNER_DEFAULTS} from '../annular-burner.mjs';
import {normalizeFlameEmitterPose,normalizeFlameDomainTranslation,FLAME_EMITTER_ID,FLAME_EMITTER_TYPE,FLAME_EMITTER_SOURCE} from '../scene-flame-emitter.mjs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const extract=(from,to)=>html.slice(html.indexOf(from),html.indexOf(to,html.indexOf(from)));
const pose={position:[0,-.76,0],rotation:[0,0,0],scale:[1,1,1]};
const source={id:FLAME_EMITTER_ID,type:FLAME_EMITTER_TYPE,source:FLAME_EMITTER_SOURCE,transform:pose};
function harness({family='ring',objects=[source],groups=[]}={}){
 let state={objects:structuredClone(objects),groups:structuredClone(groups),domain:[0,0,0]},serial=0,failure=null;
 const edits=createSceneEdits({read:()=>null,write:()=>{throw Error('wrong target');}});
 const context={structuredClone,normalizeBurner,BURNER_DEFAULTS,checkedBurnerBed,checkedAssemblyPose,normalizeFlameEmitterPose,normalizeFlameDomainTranslation,BURNER_ASSEMBLY_TYPE,BURNER_BED_TYPE,BURNER_BED_SOURCE,FLAME_EMITTER_ID,FLAME_EMITTER_TYPE,FLAME_EMITTER_SOURCE,
  PROCEDURAL_MESH_TYPE,PROCEDURAL_MESH_SOURCE,checkedProceduralMesh,GROUP_TYPE,checkedGroupPose,groupPivotPose:()=>structuredClone(pose),RIM_LIGHT_ID:'@rim-light',authoringBusy:false,scenePlacementTools:{edits},flameEmitterPose:pose,isFireLightFieldRoute:()=>true,applyFlameEmitterPose(){},setActiveSceneGroup(){},setActiveSceneObject(){},setInfo(){},sceneGroupDisplayLabel:g=>g.label,bedPoseBelowSource:()=>structuredClone(pose),makeSceneObjectId:prefix=>`${prefix}-${++serial}`,
  get authoredFlamePresent(){return state.objects.some(o=>o.id===FLAME_EMITTER_ID);},get sceneGroups(){return state.groups;},get sceneObjects(){return [...state.objects,{id:'kiln',type:'glb'}];},
  editSceneGroups(change){const groups=structuredClone(state.groups);change(groups);edits.apply('@scene-groups',{groups},'Group objects');},readBurnerGraph:()=>structuredClone(state),window:{__kaminosVolumeEmitterReceipt:{effective:{family}}}};
 vm.createContext(context);vm.runInContext(extract('function checkBurnerGraph(value)','function writeBurnerGraphUnchecked')+extract('function burnerEdit(change,label)','function bedPoseBelowSource')+extract('function addBurnerObject(kind)','function migrateLegacyBurner')+extract('window.createSceneGroupFromAllObjects = function','window.kaminosSceneObjectDebugState = function')+'\nthis.add=addBurnerObject;',context);
 edits.register('@scene-groups',{read:()=>({groups:structuredClone(state.groups)}),check:v=>v,write:v=>{state.groups=structuredClone(v.groups);}});
 edits.register('@burner-graph',{read:()=>structuredClone(state),check:context.checkBurnerGraph,write:next=>{if(failure){const error=failure;failure=null;throw error;}state=structuredClone(next);}});
 return{context,edits,read:()=>structuredClone(state),failOnce:()=>{failure=Error('runtime rejected write');}};
}
test('assembly creation transfers a grouped source and undo preserves its old siblings',()=>{
 const h=harness();h.context.window.createSceneGroupFromAllObjects('Loose');const grouped=h.read();
 const id=h.context.add('burner-assembly');const created=h.read();
 assert.deepEqual(Array.from(created.groups.find(g=>g.label==='Loose').objectIds),['kiln']);
 assert.ok(created.groups.find(g=>g.id===id).objectIds.includes(FLAME_EMITTER_ID));
 assert.equal(h.edits.state().undoCount,2);h.edits.undo();assert.deepEqual(h.read(),grouped);
 h.edits.undo();assert.equal(h.read().groups.length,0);assert.equal(h.read().objects.length,1);
});
test('failed burner write clears its owned transaction and accepts a subsequent edit',()=>{
 const h=harness();const before=h.read();h.failOnce();
 assert.throws(()=>h.context.add('burner-bed'),/runtime rejected/);
 assert.deepEqual(h.read(),before);assert.equal(h.edits.state().active,null);assert.equal(h.edits.state().undoCount,0);
 assert.ok(h.context.add('burner-bed'));assert.equal(h.edits.state().undoCount,1);
});
test('cluster rejects analytic assembly creation before acquiring history',()=>{
 const h=harness({family:'cluster',objects:[]});
 assert.throws(()=>h.context.add('burner-assembly'),/analytic/i);
 assert.equal(h.edits.state().active,null);assert.equal(h.edits.state().undoCount,0);assert.equal(h.read().objects.length,0);
});
