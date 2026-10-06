import test from 'node:test';
import assert from 'node:assert/strict';
import { moveGroupMembers } from '../scene-group.mjs';
import { bindSceneHierarchyRows } from '../scene-hierarchy-interaction.mjs';

const pose = (position, rotation = [0,0,0]) => ({position,rotation,scale:[1,1,1]});
test('individual-origin selection rotation preserves each chosen origin', () => {
  const members={a:pose([0,0,0]),b:pose([2,0,0])};
  const moved=moveGroupMembers(pose([1,0,0]),pose([1,0,0],[0,0,Math.PI/2]),members,{pivot:'individual',orientation:'world'});
  assert.deepEqual(moved.a.position,members.a.position);
  assert.deepEqual(moved.b.position,members.b.position);
  assert.ok(Math.abs(moved.b.rotation[2]-Math.PI/2)<1e-9);
});
test('Shift hierarchy selection forwards extension, including an already selected row', () => {
  const row=new EventTarget(),input=new EventTarget();input.value='Mesh';input.focus=()=>{};input.select=()=>{};input.blur=()=>{};
  row.dataset={sceneObjectId:'mesh'};row.querySelector=()=>input;row.getAttribute=()=> 'true';
  let selected;
  bindSceneHierarchyRows({querySelectorAll:()=>[row]},{selectObject:(id,options)=>selected={id,options}});
  const event=new Event('click');Object.defineProperties(event,{detail:{value:1},shiftKey:{value:true}});
  row.closest=()=>null;row.dispatchEvent(event);
  assert.deepEqual(selected,{id:'mesh',options:{extend:true}});
});

const {checkedSelection,changeSelection,selectionTransformRoots,selectionFrame,mixedSelectionValue,createSelectionTransformTarget}=await import('../scene-selection.mjs');
const {createSceneEdits}=await import('../scene-edit-session.mjs');
test('selection retains a distinct active member and Shift toggles without writing poses',()=>{
 let selected=checkedSelection(['a'],'a');selected=changeSelection(selected,'b',{extend:true});assert.deepEqual(selected,{ids:['a','b'],activeId:'b'});
 selected=changeSelection(selected,'b',{extend:true});assert.deepEqual(selected,{ids:['a'],activeId:'a'});
 assert.deepEqual(changeSelection(selected,null),{ids:[],activeId:null});assert.throws(()=>checkedSelection(['a'],'b'),/Active/);
});
test('a selected group suppresses its selected children as transform roots',()=>{
 assert.deepEqual(selectionTransformRoots(['a','@group:g','b','other'],[{id:'g',objectIds:['a','b']}]),['@group:g','other']);
});
test('median and active pivots use origins; Local takes the active orientation',()=>{
 const poses={a:pose([0,0,0]),b:pose([4,0,0],[0,0,1])};
 assert.deepEqual(selectionFrame(poses,'b').position,[2,0,0]);assert.deepEqual(selectionFrame(poses,'b',{pivot:'active',orientation:'local'}),pose([4,0,0],[0,0,1]));
 assert.equal(mixedSelectionValue([1,2]).mixed,true);assert.deepEqual(mixedSelectionValue([1,1]),{mixed:false,value:1});
});
function batchFixture({reject=false,failWrite=false}={}){
 let selection={ids:['a','b'],activeId:'b'},states={a:pose([0,0,0]),b:pose([2,0,0])};const writes=[];
 const edits=createSceneEdits({read:()=>null,write(){}});
 const target=createSelectionTransformTarget({edits,selection:()=>selection,groups:()=>[],preferences:()=>({pivot:'median',orientation:'world'}),
  read:id=>structuredClone(states[id]),write:(id,value)=>{if(failWrite&&id==='b'&&value.position[0]!==2)throw Error('provider write rejected');writes.push(id);states[id]=structuredClone(value);},
  check:(id,value)=>{if(reject&&id==='b'&&value.position[0]!==2)throw Error('provider pose rejected');}});
 return {edits,target,writes,get states(){return states;},select(value){selection=value;}};
}
test('temporary selection preview cancels all roots and accepted movement is one undo entry',()=>{
 const f=batchFixture();f.target.prepare();f.edits.begin(f.target.id);f.edits.preview({position:[2,0,0]});
 assert.equal(f.states.a.position[0],1);assert.equal(f.states.b.position[0],3);f.edits.cancel();assert.equal(f.states.a.position[0],0);assert.equal(f.states.b.position[0],2);
 f.target.apply({position:[3,0,0]});assert.equal(f.edits.state().undoCount,1);f.select({ids:['a'],activeId:'a'});f.edits.undo();assert.equal(f.states.a.position[0],0);assert.equal(f.states.b.position[0],2);f.edits.redo();assert.equal(f.states.a.position[0],2);assert.equal(f.states.b.position[0],4);
});
test('provider preflight refuses a mixed transform before any root changes',()=>{
 const f=batchFixture({reject:true});assert.throws(()=>f.target.apply({position:[2,0,0]}),/provider pose rejected/);assert.equal(f.states.a.position[0],0);assert.equal(f.states.b.position[0],2);assert.equal(f.edits.state().active,null);assert.equal(f.edits.state().undoCount,0);
});
test('a provider write failure restores every selected root',()=>{
 const f=batchFixture({failWrite:true});assert.throws(()=>f.target.apply({position:[2,0,0]}),/provider write rejected/);assert.equal(f.states.a.position[0],0);assert.equal(f.states.b.position[0],2);assert.equal(f.edits.state().active,null);
});

const {readFileSync}=await import('node:fs');const vm=await import('node:vm');
const {checkedPose}=await import('../scene-edit-session.mjs');const {checkedGroupPose}=await import('../scene-group.mjs');
const {createLocalLiquidEmitterSceneRecord}=await import('../local-liquid-scene-object.mjs');
const {normalizeLocalLiquidEmitter,LOCAL_LIQUID_EMITTER_TYPE}=await import('../local-liquid-setup.mjs');
test('actual water provider rejects a nonuniform batch before its mesh sibling moves',()=>{
 const record=createLocalLiquidEmitterSceneRecord({id:'water',transform:pose([2,0,0]),createdAt:'2026-10-06T00:00:00Z'}),states={mesh:pose([0,0,0]),water:record.transform},writes=[];
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');const a=html.indexOf('function checkSelectionRoot('),b=html.indexOf('function selectionTransformProxy(',a);
 const context=vm.createContext({sceneObjects:[{id:'mesh',type:'glb'},record],sceneGroups:[],checkedGroupPose,LOCAL_LIQUID_EMITTER_TYPE,FLAME_EMITTER_TYPE:'flame-emitter',normalizeLocalLiquidEmitter});vm.runInContext(html.slice(a,b),context);
 const edits=createSceneEdits({read:()=>null,write(){}}),target=createSelectionTransformTarget({edits,selection:()=>({ids:['mesh','water'],activeId:'water'}),groups:()=>[],preferences:()=>({pivot:'median',orientation:'world'}),read:id=>structuredClone(states[id]),write:(id,value)=>{writes.push(id);states[id]=value;},check:context.checkSelectionRoot});
 assert.throws(()=>target.apply({scale:[2,1,1]}),/positive uniform scale/);assert.deepEqual(states.mesh.position,[0,0,0]);assert.deepEqual(states.water.scale,[1,1,1]);assert.equal(edits.state().active,null);assert.equal(edits.state().undoCount,0);
});
