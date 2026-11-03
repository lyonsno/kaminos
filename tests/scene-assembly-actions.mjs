// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {changeSelection} from '../scene-selection.mjs';
import * as assembly from '../scene-assembly.mjs';
import {restoreSceneObjectGroups} from '../scene-membership-history.mjs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const grab=name=>{const start=html.indexOf('function '+name+'(');return start<0?'':html.slice(start,html.indexOf('\n}',start)+2);};
const group={id:'burner',objectIds:['body','outlet','support'],assembly:{kind:'burner',roles:{body:'body',outlet:'outlet',support:'collision'}}};
test('a hidden support exposed in assembly Edit Mode keeps the native gizmo',()=>{
 const target={},c={window:{kaminosSceneVisibility:{}},readSceneSelection:()=>({ids:['support']}),isSceneItemVisible:()=>false,
  assemblyEditing:{scope:()=>group},workingScene:{selection:{ids:['support']}},selectedSceneObjectEntry:()=>({type:'procedural-mesh'}),FLAME_EMITTER_TYPE:'flame-emitter',sceneComponents:{target:()=>null},selectionTransforms:null,viewportGizmosVisible:true,
  transformControls:{object:null,detach(){this.object=null;},attach(object){this.object=object;},getHelper:()=>({})}};
 vm.runInNewContext(grab('isSceneItemEditable')+grab('attachViewportGizmo'),c);c.attachViewportGizmo(target);assert.equal(c.transformControls.object,target);
 c.assemblyEditing.scope=()=>null;c.attachViewportGizmo(target);assert.equal(c.transformControls.object,null,'ordinary hidden objects stay hidden from the gizmo');
});
test('native Delete reaches assembly parts but still yields to joint editing',()=>{
 const c={polyEdit:{active:()=>false},sceneComponents:{active:()=>true,ownsTransforms:()=>false},greenroomPreviewIsActive:()=>false,splatCorrectionMode:null,workingScene:{selection:{ids:['support']}}};
 vm.runInNewContext(grab('shouldIgnoreSceneObjectDeleteShortcut'),c);const event={key:'Delete',target:{tagName:'DIV'}};
 assert.equal(c.shouldIgnoreSceneObjectDeleteShortcut(event),false);c.sceneComponents.ownsTransforms=()=>true;assert.equal(c.shouldIgnoreSceneObjectDeleteShortcut(event),true);
});
test('the viewport selection entry toggles an assembly before selection arithmetic',()=>{
 const c={window:{},changeSelection,assemblySelection:assembly.assemblySelection,assemblyEditing:null,workingScene:{selection:{ids:['@group:burner'],activeId:'@group:burner'},groups:[group]},currentMesh:null,
  sceneSelectionHistory:{set(ids,activeId){c.result={ids,activeId};}}};
 const start=html.indexOf('window.selectSceneObject = function');vm.runInNewContext(html.slice(start,html.indexOf('\n};',start)+3),c);
 c.window.selectSceneObject('body',{extend:true});assert.deepEqual(Array.from(c.result.ids),[]);
});
test('individual restoration recovers the removed role while retaining current roles',()=>{
 const saved=structuredClone({...group,groupIndex:0});const current=structuredClone(group);current.objectIds=['body','outlet'];delete current.assembly.roles.support;current.assembly.roles.body='collision';
 const [restored]=restoreSceneObjectGroups([current],[saved],'support',group.objectIds);
 assert.equal(restored.assembly.roles.support,'collision');assert.equal(restored.assembly.roles.body,'collision');
});
test('explicit Make assembly recognizes hidden collision supports without names or parent visibility',()=>{
 const records=[{id:'body',type:'glb'},{id:'outlet',type:'flame-emitter'},{id:'support',type:'procedural-mesh',geometry:{kind:'box'}},{id:'disabled',type:'procedural-mesh',geometry:{kind:'box'},waterCollision:false},{id:'visible-box',type:'procedural-mesh',geometry:{kind:'box'}}];
 const owner={id:'old',objectIds:records.map(o=>o.id)},button={};
 const c={...assembly,document:{getElementById:()=>button},selectedSceneGroupEntry:()=>owner,workingScene:{find:id=>records.find(o=>o.id===id)},viewportDisplay:{hiddenIds:['support','disabled','@group:old']},FLAME_EMITTER_TYPE:'flame-emitter',setSceneAssembly:(_id,value)=>c.result=value,setInfo(message){throw Error(message);}};
 const start=html.indexOf("document.getElementById('group-make-assembly').onclick=");vm.runInNewContext(html.slice(start,html.indexOf('\n',start)),c);button.onclick();
 assert.deepEqual({...c.result.roles},{body:'body',outlet:'outlet',support:'collision',disabled:'body','visible-box':'body'});
});
test('subtract marquee does not swallow the next outliner click',()=>{
 const listeners={},c={window:{kaminosSelection:{},addEventListener(){}},document:{createElement:()=>({style:{}}),getElementById:()=>({append(){}}),addEventListener:(type,callback)=>listeners[type]=callback},
  vantageCaptureHeld:false,scenePlacementTools:{edits:{state:()=>({})}},controls:{enabled:true},setInfo(){},viewportEventHitsInteractiveOverlay:()=>false,viewportEventIsInsideCanvas:()=>true,
  workingScene:{objects:[],groups:[],selection:{ids:[]}},camera:{},renderer:{domElement:{getBoundingClientRect:()=>({})}},objectsInScreenBox:()=>[],assemblySelection:assembly.assemblySelection,assemblyEditing:null,sceneSelectionHistory:{set(){}}};
 vm.runInNewContext(grab('installSelectionInput'),c);c.installSelectionInput();c.window.kaminosSelection.box();
 const event={button:1,clientX:0,clientY:0,target:{closest:()=>false},preventDefault(){},stopImmediatePropagation(){}};
 listeners.pointerdown(event);listeners.pointerup(event);let swallowed=false;listeners.click({...event,stopImmediatePropagation(){swallowed=true;}});assert.equal(swallowed,false);
});
