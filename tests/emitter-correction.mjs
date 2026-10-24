// kaminos-test: node
import {sceneContext,runInSceneContext} from './helpers/scene-context.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.core.js';
import {immersedRadiusBounds,immersedControlsForFlamePose} from '../scene-flame-emitter.mjs';
import {flameSourceInputs} from '../scene-fire-domain.mjs';
import {visibleSceneIntersections} from '../scene-visible-picking.mjs';
import {styleHelperLines} from '../scene-helper-lines.mjs';
const pose={position:[0,-.5,0],rotation:[0,0,0],scale:[.2,.2,.2]};
test('zero authored radius remains zero and stops supply; positive scaling has no upper cap',()=>{
 assert.deepEqual(immersedRadiusBounds(pose),{min:0,max:null});
 const zero=immersedControlsForFlamePose({immersedRadius:0},pose);
 assert.equal(zero.immersedSourceEnabled,false); // The current engine retains a positive numerical aperture while supply is off.
 assert.equal(immersedControlsForFlamePose({immersedRadius:50},pose).immersedRadius,10);
 assert.equal(immersedControlsForFlamePose({immersedRadius:-1},pose).immersedSourceEnabled,false);
 assert.equal(immersedControlsForFlamePose({immersedRadius:.4},{...pose,scale:[0,0,0]}).immersedSourceEnabled,false);
});
const record=id=>({id,type:'flame-emitter',source:'kaminos:analytic-flame',transform:pose,emissionEnabled:true,emission:{domainId:'flame-field',settings:{'volume-immersed-radius':{value:.3,type:'range'}}}});
test('hiding one source stops its contribution independently of Emit gas and leaves document data intact',()=>{
 const records=[record('a'),record('b')],before=structuredClone(records);
 const inputs=flameSourceInputs(records,{visible:id=>id!=='a'});
 assert.deepEqual(inputs.map(x=>x.controls.immersedSourceEnabled),[false,true]);assert.deepEqual(records,before);
 assert.deepEqual(flameSourceInputs(records,{visible:()=>false}).map(x=>x.controls.immersedSourceEnabled),[false,false]);
});
test('the drawn wide emitter ring has a screen-sized picking aperture',()=>{
 const camera=new THREE.PerspectiveCamera(40,1,.01,100);camera.position.z=10;camera.updateMatrixWorld();
 const ring=new THREE.Mesh(new THREE.TorusGeometry(1,.0025,4,32),new THREE.MeshBasicMaterial({wireframe:true}));const group=new THREE.Group();group.userData.kaminosEditorHelper=true;group.add(ring);styleHelperLines(group,{width:8,opacity:1});group.updateMatrixWorld(true);
 const point=new THREE.Vector3(1,0,0).project(camera);point.x+=6/1000; // three pixels outside the centreline
 const raycaster=new THREE.Raycaster();raycaster.setFromCamera(new THREE.Vector2(point.x,point.y),camera);
 const hits=visibleSceneIntersections({raycaster,roots:[group],camera,viewport:{width:1000,height:1000}});
 assert.ok(hits.some(h=>h.object===ring),'a visible ring pixel must retain emitter identity before smoke picking');
 ring.visible=false;assert.equal(visibleSceneIntersections({raycaster,roots:[group],camera,viewport:{width:1000,height:1000}}).length,0);
});
test('hidden simulation cancels pending activation and showing reuses its runtime',async()=>{
 const module=await import('../scene-simulation-activity.mjs').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});
 assert.equal(typeof module.createSceneSimulationActivity,'function','visibility needs one idempotent runtime activation adapter');
 let active=false,resolveBoot;const calls=[],prototype={isActive:()=>active,setActive:async value=>{calls.push(value);if(value)await new Promise(r=>resolveBoot=r);active=value;}};
 let visible=true;const sync=module.createSceneSimulationActivity({prototype:()=>prototype,wanted:()=>visible});
 const showing=sync();visible=false;await sync();resolveBoot();await showing;assert.equal(active,false,'late GPU boot must not revive a hidden field');
 assert.deepEqual(calls,[true,false,false]);await sync();assert.deepEqual(calls,[true,false,false],'unchanged hidden state has no activation work');
 visible=true;const resumed=sync();resolveBoot();await resumed;assert.equal(active,true);assert.equal(calls.length,4);
});

import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const grab=name=>{const start=html.indexOf(`function ${name}(`);assert.ok(start>=0);return html.slice(start,html.indexOf('\n}',start)+2);};
test('continuous water runtime receives visible sources without deleting hidden document objects',()=>{
 const objects=['a','b'].map(id=>({id,type:'local-liquid-emitter',object:{},localLiquidEmitter:{rate:10}}));
 const context={sceneObjects:objects,localLiquidSetup:{},isSceneItemVisible:id=>id!=='a',sceneObjectTransformState:()=>pose,localLiquidRuntimeSourceState:doc=>({emitters:doc.objects})};
 sceneContext(context);vm.runInContext(grab('localLiquidEmitterState'),context);
 assert.deepEqual(Array.from(context.localLiquidEmitterState().emitters,x=>x.id),['b']);assert.equal(objects.length,2);
});
test('a hidden water field submits neither solver nor water rendering work while ordinary scene keeps drawing',()=>{
 const start=html.indexOf('    if (localLiquidHost) {',html.indexOf('  function renderSceneFrame()')),end=html.indexOf('    }));',start),arm=html.slice(start,end);
 let water=0,scene=0;const context={localLiquidHost:{render:()=>water++,state:()=>({clock:{paused:false,step:0,timeSeconds:0}})},isSceneItemVisible:()=>false,outputCaptureExtent:null,recordingFrameSink:null,ordinarySceneTransportFrame:null,
  authoredWaterControls:null,sharedWorkbench:null,console,localLiquidFailure:null,refreshLocalLiquidPerformance(){},setInfo(){},applySceneEmissiveCamera(){},renderPipeline:{render:()=>scene++},outlinedSceneOutput:{},outlinedCameraOutput:{},matchedCameraEffective:false};
 sceneContext(context);vm.runInContext(arm,context);assert.equal(water,0);assert.equal(scene,1);
});

test('screen-space ring picking survives an emitter scaled through its parent',()=>{
 const camera=new THREE.PerspectiveCamera(40,1,.01,100);camera.position.z=2;camera.updateMatrixWorld();
 const root=new THREE.Group();root.scale.setScalar(.22);root.userData.kaminosEditorHelper=true;
 const ring=new THREE.Mesh(new THREE.TorusGeometry(.5,.0025,4,32),new THREE.MeshBasicMaterial());root.add(ring);styleHelperLines(root,{width:8,opacity:1});root.updateMatrixWorld(true);
 const point=new THREE.Vector3(.11,0,0).project(camera);point.x+=6/1000;
 const raycaster=new THREE.Raycaster();raycaster.setFromCamera(new THREE.Vector2(point.x,point.y),camera);
 assert.ok(visibleSceneIntersections({raycaster,roots:[root],camera,viewport:{width:1000,height:1000}}).some(h=>h.object===ring),'parent scale must not shrink the screen pixel aperture');
});

test('removing the field while its show is pending cannot revive the retired runtime',async()=>{
 const {createSceneSimulationActivity}=await import('../scene-simulation-activity.mjs');
 let current,resolveBoot,active=false;const runtime={isActive:()=>active,setActive:async value=>{if(value)await new Promise(r=>resolveBoot=r);active=value;}};current=runtime;
 const sync=createSceneSimulationActivity({prototype:()=>current,wanted:()=>Boolean(current)});
 const pending=sync();current=null;await runtime.setActive(false);await sync();resolveBoot();await pending;
 assert.equal(active,false);
});

test('saved field visibility governs restore even when the hidden set did not change',async()=>{
 const {createSceneSimulationActivity}=await import('../scene-simulation-activity.mjs');
 const start=html.indexOf("  if (hasVolumePrimitiveScene || activeSceneComposition || new URLSearchParams(location.search).get('kaminos_volume_smoke') === '1')",html.indexOf('async function loadSceneFile(')),end=html.indexOf('  syncRimAuthoringHandle();',start);assert.ok(start>0&&end>start);
 for(const initiallyActive of [true,false])for(const visible of [true,false]){
  let active=initiallyActive;const runtime={isActive:()=>active,setActive:async value=>{active=value;}};
  const context={hasVolumePrimitiveScene:false,activeSceneComposition:{},URLSearchParams,location:{search:''},volumePrototype:runtime,isSceneItemVisible:()=>visible,setActiveTab(){},loadRequestId:1,sceneLoadRequests:{isCurrent:()=>true}};
  context.syncAuthoredFireActivity=createSceneSimulationActivity({prototype:()=>runtime,wanted:()=>visible});
  sceneContext(context);await vm.runInContext('(async()=>{'+html.slice(start,end)+'})()',context);assert.equal(active,visible,'restore must finish with the saved visibility, independently of prior runtime activity');
 }
});

test('saving a deliberately hidden retained field does not require its computation to run',async()=>{
 const start=html.indexOf('async function collectSceneComposition() {'),end=html.indexOf("  if (!isFireLightFieldRoute()) throw",start);assert.ok(start>0&&end>start);
 for(const [hidden,debug,accept]of [[true,{active:false,error:null},true],[false,{active:false,error:null},false],[true,null,false],[true,{active:false,error:'device-lost'},false]]){
  const context={volumePrototype:debug?{debugState:()=>debug}:null,activeSceneComposition:{},isFireLightFieldRoute:()=>true,isSceneItemVisible:()=>!hidden};sceneContext(context);vm.runInContext(html.slice(start,end)+'return true;}',context);
  if(accept)assert.equal(await context.collectSceneComposition(),true);else await assert.rejects(context.collectSceneComposition(),/not active|device-lost/);
 }
});
