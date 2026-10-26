import {sceneContext,runInSceneContext} from './helpers/scene-context.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const code=html.slice(html.indexOf('window.createSceneGroupFromAllObjects = function'),html.indexOf('window.kaminosSceneObjectDebugState = function'));
test('grouping loose objects preserves burner assemblies and records one reversible change',()=>{
 const original={id:'burner',type:'burner-assembly',objectIds:['bed','flame']};
 let groups=[structuredClone(original)],history=[];
 const context={window:{},sceneObjects:[{id:'bed'},{id:'flame'},{id:'kiln'},{id:'@rim-light'}],RIM_LIGHT_ID:'@rim-light',GROUP_TYPE:'group',groupPivotPose:()=>({position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]}),
  get sceneGroups(){return groups;},makeSceneObjectId:()=> 'loose',setInfo(){},sceneGroupDisplayLabel:g=>g.label,setActiveSceneGroup(){},
  editSceneGroups(change){history.push(structuredClone(groups));const next=structuredClone(groups);change(next);groups=next;},
  createSceneGroupForObjects(ids,label){groups=groups.map(g=>({...g,objectIds:g.objectIds.filter(id=>!ids.includes(id))}));const group={id:'loose',label,objectIds:ids};groups.push(group);return group;}};
 sceneContext(context);vm.runInContext(code,context);
 context.window.createSceneGroupFromAllObjects('Loose');
 assert.deepEqual(groups.find(g=>g.id==='burner'),original,'grouping must preserve the placement unit');
 assert.deepEqual(Array.from(groups.find(g=>g.id==='loose').objectIds),['kiln','@rim-light']);
 assert.equal(history.length,1);groups=history.pop();assert.deepEqual(groups,[original]);
});


import {createWorkingScene} from '../working-scene.mjs';
import {createSceneMembershipBatch} from '../scene-membership-batch.mjs';
import {createSceneMembershipOperations} from '../scene-membership-operations.mjs';
import {createSceneEdits} from '../scene-edit-session.mjs';
import {defaultBurnerRecipe,compileBurnerSources,burnerMembers,remapBurnerBindings,burnerBodyFor,synchronizeBurnerSources} from '../burner-recipe.mjs';
const identity={position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]};
function splitBurnerFixture(){
 const state=createWorkingScene(),edits=createSceneEdits({read:()=>null,write(){}});let serial=0,complete;
 const serialize=({object,...entry})=>structuredClone(entry);
 const apply=(entry,{id,...record})=>Object.assign(entry,structuredClone(record));
 const membership=createSceneMembershipOperations({scene:state,records:{serialize,reloadable:()=>true,load:record=>state.put({...structuredClone(record),object:{}})},roots:{attach(){},restore:apply,detach(){},dispose(){}},domains:{glb:{retainRoot:true},'flame-emitter':{retainRoot:true}}});membership.attachHistory(edits);
 const group=(ids,label,options)=>{const prior=state.groups.map(g=>({...g,objectIds:g.objectIds.filter(id=>!ids.includes(id))})).filter(g=>g.objectIds.length);state.setGroups([...prior,{...options,label,objectIds:[...ids]}]);state.select(['@group:'+options.id]);};
 const h=vm.createContext({structuredClone,workingScene:state,burnerMembers,burnerBodyFor,assertSceneConstructionAvailable(){},scenePlacementTools:{edits,start:(_mode,done)=>{complete=done;return true;}}});
 const copyObject=id=>{const copy={...serialize(state.find(id)),id:'copy-'+(++serial),groupId:null,object:{}};state.put(copy);return copy.id;};
 h.sceneMembershipBatch=createSceneMembershipBatch({scene:state,membership,records:{serialize,reloadable:()=>true,apply},groups:{serialize:()=>structuredClone(state.groups),create:group},duplicate:{supported:()=>true,object:copyObject,groupId:()=> 'group-'+(++serial),remap:copies=>remapBurnerBindings(state,copies)}});h.sceneMembershipBatch.attachHistory(edits);
 for(const name of ['duplicateSceneObject','duplicateSceneGroup']){const a=html.indexOf('function '+name+'('),b=html.indexOf('\n}',a)+2;vm.runInContext(html.slice(a,b),h);}
 const body={id:'body',object:{},type:'glb',source:'burner.glb',label:'Crown',transform:structuredClone(identity),burner:defaultBurnerRecipe('crown-ring')};state.put(body);
 compileBurnerSources(body.burner,identity,body.id).forEach((port,i)=>state.put({...port,id:'port-'+i,object:{},type:'flame-emitter',source:'kaminos:analytic-flame',label:'Port'}));
 group(state.objects.filter(o=>o.id!=='body').map(o=>o.id),'Outlets',{id:'outlets',transform:identity});group(['body'],'Body only',{id:'body-only',transform:identity});
 return {state,edits,h,finish:commit=>complete({commit})};
}
for(const route of ['body','group'])test('split burner duplicates all bound outlets through '+route+' route with reversible topology',async()=>{
 const f=splitBurnerFixture(),before=structuredClone(f.state.objects),oldGroups=structuredClone(f.state.groups);
 const duplicate=interactive=>route==='body'?f.h.duplicateSceneObject('body',{interactive}):f.h.duplicateSceneGroup('body-only',{interactive});
 const result=duplicate(true);assert.equal(typeof result,'string');
 let body=f.state.objects.find(o=>o.burner&&o.id!=='body');assert.ok(body);const copyId=body.id;
 assert.equal(burnerMembers(f.state,copyId).length,13,'duplicated body must retain all twelve independently bound outlets');
 assert.deepEqual(Array.from(f.state.groups.find(g=>g.id===result).objectIds),[copyId],'the copied display group stays body-only');
 assert.deepEqual(f.state.groups.find(g=>g.id==='outlets').objectIds,oldGroups.find(g=>g.id==='outlets').objectIds,'copied outlets must not enter the original display group');
 f.finish(false);assert.equal(f.state.objects.length,13);assert.deepEqual(f.state.groups,oldGroups);assert.equal(f.edits.state().undoCount,0);
 duplicate(true);f.finish(true);body=f.state.objects.find(o=>o.burner&&o.id!=='body');const finalId=body.id;assert.equal(f.edits.state().undoCount,1);
 await f.edits.undo();assert.equal(f.state.objects.length,13);assert.deepEqual(f.state.groups,oldGroups);await f.edits.redo();assert.equal(burnerMembers(f.state,finalId).length,13);
 body=f.state.find(finalId);body.burner.on=false;
 synchronizeBurnerSources(f.state,{pose:e=>e.transform,write:(e,p)=>Object.assign(e,structuredClone(p))});
 assert.ok(f.state.objects.filter(o=>o.emission?.burnerPort?.bodyId===finalId).every(o=>!o.emissionEnabled));
 assert.ok(f.state.objects.filter(o=>o.emission?.burnerPort?.bodyId==='body').every(o=>o.emissionEnabled));
 const snapshot=f.h.sceneMembershipBatch.capture();assert.equal(snapshot.objects.filter(o=>o.emission?.burnerPort?.bodyId===finalId).length,12);
 assert.deepEqual(f.state.objects.filter(o=>before.some(old=>old.id===o.id)).map(o=>o.burner).filter(Boolean),before.map(o=>o.burner).filter(Boolean));
});
