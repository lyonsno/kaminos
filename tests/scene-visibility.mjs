// kaminos-test: node
import {sceneContext,runInSceneContext} from './helpers/scene-context.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {checkedViewportDisplay} from '../viewport-display-settings.mjs';
import {createFireProxySync} from '../fire-proxy-sync.mjs';
import {createProxySnapshotRegistry} from '../proxy-snapshot.mjs';
import {localLiquidPresentationPlan} from '../local-liquid-presentation.mjs';

test('saved viewport visibility rejects malformed target identity rather than accepting untracked hidden state',()=>{
 for(const hiddenIds of [false,{},[null],[17],['']])assert.throws(()=>checkedViewportDisplay({hiddenIds}),/hidden/i);
 assert.deepEqual(checkedViewportDisplay({hiddenIds:['mesh','flame-field','mesh']}).hiddenIds,['mesh','flame-field']);
});
test('hiding a full fire field suppresses its canvas without disabling the solver or lighting consumers',()=>{
 let suppressed=false;
 const prototype={isActive:()=>true,setCanvasPresentationSuppressed:value=>(suppressed=value),setProxyPacing(){}};
 const sync=createFireProxySync({registry:createProxySnapshotRegistry(),createLayer:()=>{throw Error('hidden viewport created an unnecessary proxy');},readDomain:()=>null});
 const canvas={style:{visibility:''}},bridge={mesh:{visible:true}},camera={layers:{enable(){throw Error('hidden viewport enabled proxies');},disable(){}}};
 sync.sync({prototype,visible:false,display:false,required:false,camera,layerId:4,canvas,bridge});
 assert.equal(suppressed,true);assert.equal(canvas.style.visibility,'hidden');assert.equal(bridge.mesh.visible,false);
 sync.sync({prototype,visible:true,display:false,required:false,camera,layerId:4,canvas,bridge});
 assert.equal(suppressed,false);assert.equal(canvas.style.visibility,'');
});
test('hidden water keeps stepping while omitting the water depth/environment/composite passes',()=>{
 assert.deepEqual(localLiquidPresentationPlan('hidden'),{step:true,sceneColor:true,sceneDepth:false,environment:false,liquidComposite:false});
});

import {sceneItemVisible,visibilityShortcut,withViewportVisibility,installSceneVisibility} from '../scene-visibility.mjs';
import {createSceneEdits} from '../scene-edit-session.mjs';
const context={fields:[{id:'flame-field'},{id:'water-field'}],objects:[{id:'mesh',type:'glb'},{id:'fire',type:'flame-emitter'},{id:'water',type:'local-liquid-emitter'}],groups:[{id:'group',objectIds:['mesh','fire']}]};
test('object, group and field visibility share stable identity while preserving independent emitter settings',()=>{
 assert.equal(sceneItemVisible('fire',['flame-field'],context),false);
 assert.equal(sceneItemVisible('water',['flame-field'],context),true);
 assert.equal(sceneItemVisible('mesh',['@group:group'],context),false);
 assert.equal(sceneItemVisible('flame-field',['fire'],context),true);
});
test('viewport drawing restores authored visibility even if drawing throws',()=>{
 const objects=[{id:'mesh',object:{visible:true}},{id:'absent',object:{visible:false}}];
 assert.throws(()=>withViewportVisibility(objects,()=>false,()=>{assert.equal(objects[0].object.visible,false);throw Error('GPU failure');}),/GPU failure/);
 assert.equal(objects[0].object.visible,true);assert.equal(objects[1].object.visible,false);
});
function service(){
 let hidden=[],selected={ids:['mesh'],activeId:'mesh'};const document=new EventTarget();document.body={};document.activeElement=document.body;
 const edits=createSceneEdits({read(){},write(){}}),viewport={contains:()=>false,ownerDocument:document};
 const api=installSceneVisibility({document,viewport,edits,scene:()=>context,readHidden:()=>hidden,writeHidden:value=>{hidden=value;},selection:()=>selected,setSelection:(ids,activeId)=>{selected={ids,activeId};}});
 return {api,edits,select:value=>{selected=value;}};
}
test('Hide, Reveal, isolate and per-row eyes use the shared history including selection restoration',()=>{
 const {api,edits,select}=service();api.hideSelected();assert.equal(api.visible('mesh'),false);assert.deepEqual(api.read().selection.ids,[]);
 edits.undo();assert.equal(api.visible('mesh'),true);assert.deepEqual(api.read().selection.ids,['mesh']);edits.redo();assert.equal(api.visible('mesh'),false);
 api.showAll();assert.equal(api.visible('mesh'),true);edits.undo();assert.equal(api.visible('mesh'),false);
 api.set('@group:group',false);assert.equal(api.visible('fire'),false);api.set('fire',true);assert.equal(api.visible('fire'),true);
 select({ids:['fire'],activeId:'fire'});api.hideUnselected();assert.equal(api.visible('fire'),true);assert.equal(api.visible('flame-field'),true);assert.equal(api.visible('water-field'),false);assert.equal(api.visible('mesh'),false);
});
test('visibility shortcuts yield to typing, modifiers, consumed events and outside focus',()=>{
 const document={body:{}},viewport={ownerDocument:document,contains:node=>node===inside},inside={},text={closest:()=>true};
 const state={viewport,activeElement:document.body,hover:true};
 assert.equal(visibilityShortcut({code:'KeyH'},state),'hideSelected');assert.equal(visibilityShortcut({code:'KeyH',shiftKey:true},state),'hideUnselected');assert.equal(visibilityShortcut({code:'KeyH',altKey:true},state),'showAll');
 for(const event of [{code:'KeyH',repeat:true},{code:'KeyH',ctrlKey:true},{code:'KeyH',defaultPrevented:true},{code:'KeyH',target:text},{code:'KeyH',altKey:true,shiftKey:true}])assert.equal(visibilityShortcut(event,state),null);
 assert.equal(visibilityShortcut({code:'KeyH'},{...state,hover:false}),null);
 assert.equal(visibilityShortcut({code:'KeyH'},{...state,activeElement:inside,hover:false}),'hideSelected');
});
import {buildSceneDocument,planSceneRestore} from '../scene-persistence-core.js';
test('hide state survives ordinary scene serialization while physical sources retain their authored settings',()=>{
 const document=buildSceneDocument({objects:[{id:'mesh',type:'glb',source:'/mesh.glb'}],editorDisplay:{hiddenIds:['mesh','water-field','flame-field']}});
 assert.deepEqual(planSceneRestore(document).editorDisplay.hiddenIds,['mesh','water-field','flame-field']);
});
import fs from 'node:fs';
import vm from 'node:vm';
test('visibility-owned selection cannot cancel its own shared edit and releases the guard after failure',()=>{
 const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8'),a=html.indexOf('function restoreVisibilitySelection('),b=html.indexOf('\n}',a)+2;
 const c={burnerGraphWriting:false,setSceneSelection(ids){assert.equal(c.burnerGraphWriting,true,'selection change must retain the visibility transaction');if(!ids.length)throw Error('selection failure');return ids;}};
 sceneContext(c);vm.runInContext(html.slice(a,b),c);assert.deepEqual(c.restoreVisibilitySelection(['mesh'],'mesh'),['mesh']);assert.equal(c.burnerGraphWriting,false);assert.throws(()=>c.restoreVisibilitySelection([],null),/selection failure/);assert.equal(c.burnerGraphWriting,false);
});
import * as THREE from '../lib/three.core.js';
import {checkedSceneLightRecord} from '../scene-spot-light.mjs';
test('actual viewport submission masks mounted light and group illumination while preserving authored settings',()=>{
 const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const grab=name=>{const a=html.indexOf(`function ${name}(`);return a<0?'':html.slice(a,html.indexOf('\n}',a)+2);};
 const c={THREE,checkedSceneLightRecord,sceneLightingPreparation:null,scene:new THREE.Scene(),sceneObjects:[],sceneSpotLights:new Map(),viewportHelpersVisible:true,window:{},applySceneObjectTransformState(root,pose){root.position.fromArray(pose.position);root.rotation.fromArray(pose.rotation);root.scale.fromArray(pose.scale);}};
 sceneContext(c);vm.runInContext(grab('mountSceneSpotLight')+grab('viewportVisibilityObjects'),c);
 const record={id:'spot',type:'light',source:'kaminos:scene-spot-light',transform:{position:[2,3,2],rotation:[-.6,.7,0],scale:[1,1,1]},light:{kind:'spot',enabled:true,color:'#ffffff',intensity:120,angle:30,penumbra:.3,aimDistance:3}};
 const entry=c.mountSceneSpotLight(record),{light}=c.sceneSpotLights.get('spot');
 // Evaluate the runtime collection actually supplied at the render call site.
 const expression=/const shadingReceipt = withViewportVisibility\((.*?),isSceneItemVisible/.exec(html)[1];
 const objects=vm.runInContext(expression,c),scene={objects:c.sceneObjects,groups:[{id:'lights',objectIds:['spot']}]};
 for(const hidden of [['spot'],['@group:lights']]){
  assert.throws(()=>withViewportVisibility(objects,id=>sceneItemVisible(id,hidden,scene),()=>{assert.equal(entry.object.visible,false);assert.equal(light.visible,false,'hidden authored light must be absent from viewport lighting');throw Error('render failed');}),/render failed/);
  assert.equal(light.visible,true);assert.equal(light.intensity,120);assert.equal(entry.light.enabled,true);
 }
});
