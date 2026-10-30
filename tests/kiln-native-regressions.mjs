// kaminos-test: node
import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';
import * as THREE from '../lib/three.webgpu.js';
import experiment from '../experiments/inference-kiln-material.experiment.mjs';
import {createSceneEdits} from '../scene-edit-session.mjs';
import {checkedPromptRelief,promptReliefRecord,restorePromptRelief} from '../inference-kiln-record.mjs';
import {createSceneFlameHDR} from '../scene-flame-hdr.mjs';
import {createSceneBloom,checkedSceneBloom} from '../scene-bloom.mjs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const section=(start,end)=>html.slice(html.indexOf(start),html.indexOf(end,html.indexOf(start)));

test('explicit fresh setup waits for volume initialization before admitting fire',async()=>{
 let release,active=false,finished=false,domains=0;const ready=new Promise(r=>release=r),objects=[{id:'existing',type:'procedural-mesh',object:{userData:{}}}],fire=[];
 const app={addPrompt:async()=>{objects.push({id:'prompt',object:{userData:{kaminosPromptRelief:{prompt:'A'}}}});},burningState:()=>({})};
 const host={
  volume:{ready},
  controls:{document:{defaultView:{location:{search:'',hash:''},kaminosSelection:{read:()=>({activeId:null})},kaminosSceneAuthoring:app}}},
  scene:{open:async()=>({onFrame:()=>()=>{},dispose:async()=>{}}),objects:()=>objects},
  flame:{open:async()=>({read:()=>({active,scene:{objects:fire}}),saveBasin:async()=>({effective:{presetId:'retained'}})})},
  fire:{add:async()=>{domains++;fire.push({id:'flame-field'});}},
 };
 const pending=experiment.create({host,inputs:{setup:true,prompt:'A'},record(){}}).then(x=>{finished=true;return x;});await new Promise(r=>setImmediate(r));const completedEarly=finished;active=true;release();const tool=await pending;
 assert.equal(completedEarly,false,'setup must not succeed before its volume initialization boundary');assert.equal(domains,1);await tool.dispose();
});

test('prompt history resolves the current reconstructed object under the same ID',async()=>{
 const base={schema:'kaminos.prompt-relief.v1',prompt:'A',appearance:'incineration',geometry:new THREE.BufferGeometry().copy(new THREE.BoxGeometry(1,1,.1)).toJSON()};
 const make=prompt=>restorePromptRelief({promptRelief:{...base,prompt}}),initial={id:'text',object:make('A'),burnable:{appearance:{profile:'incineration'}}},rows=[initial];
 const edits=createSceneEdits({read(){},write(){}}),context={assertSceneConstructionAvailable(){},workingScene:{get objects(){return rows;},retained:()=>null},scenePlacementTools:{edits},promptReliefRecord,checkedPromptRelief,restorePromptRelief,createPromptLettering:(_doc,prompt)=>make(prompt),document:{},sceneBurning:{forget(){},sync:async()=>{}},window:{}};
 vm.createContext(context);vm.runInContext(section('const promptEditTargets=new Set();','function addSceneSpotLight('),context);
 context.setPromptLettering('text','B');rows[0]={...initial,object:make('B')};const replacement=rows[0].object;
 context.setPromptLettering('text','C');assert.equal(replacement.userData.kaminosPromptRelief.prompt,'C','new edits must reach the current live root');await edits.undo();assert.equal(replacement.userData.kaminosPromptRelief.prompt,'B');await edits.undo();assert.equal(replacement.userData.kaminosPromptRelief.prompt,'A','older history must also reach the replacement');
});

test('native HDR follows zero/positive width and gain transitions without toggling enabled',()=>{
 const oldPipeline=THREE.RenderPipeline.prototype.render,oldQuad=THREE.QuadMesh.prototype.render,outputs=[];THREE.RenderPipeline.prototype.render=function(){outputs.push(this.outputNode);};THREE.QuadMesh.prototype.render=function(){};
 const oldUsage=globalThis.GPUTextureUsage;globalThis.GPUTextureUsage={TEXTURE_BINDING:1,COPY_DST:2};
 try{for(const key of ['radius','strength']){
 let allocations=0;const bloom=createSceneBloom({initial:{enabled:true,[key]:0},bloom:()=>{allocations++;return {rgb:THREE.TSL.vec3(1),strength:{},radius:{},threshold:{},dispose(){}};},convertToTexture:x=>x,vec4:THREE.TSL.vec4,rebuild(){},redraw(){}});
 const renderer={backend:{get:()=>({texture:{createView:()=>({})}})},getDrawingBufferSize:v=>v.set(4,4),getRenderTarget:()=>null,setRenderTarget(){}},device={createTexture:()=>({createView:()=>({}),destroy(){}}),queue:{writeTexture(){},submit(){}},createCommandEncoder:()=>({finish:()=>({})})},camera=new THREE.PerspectiveCamera(),hdr=createSceneFlameHDR({renderer,camera,device,bloom}),t=new THREE.Texture(),input=THREE.TSL.texture(t),emissionInput=THREE.TSL.texture(t),depthInput=THREE.TSL.texture(t);
 const render=()=>{hdr.render({frame:{device,camera,encode:()=>({})},input,emissionInput,depthInput,matched:false,physical:{}});return outputs.at(-1);};
 const off=render();assert.equal(allocations,0);bloom.set({[key]:.2});const on=render();assert.equal(allocations,1,'positive '+key+' must allocate bloom without an enabled toggle');assert.notEqual(on,off);bloom.set({[key]:0});assert.equal(render(),off,'zero '+key+' must remove the bloom display graph');hdr.dispose();bloom.dispose();
 }}finally{THREE.RenderPipeline.prototype.render=oldPipeline;THREE.QuadMesh.prototype.render=oldQuad;if(oldUsage===undefined)delete globalThis.GPUTextureUsage;else globalThis.GPUTextureUsage=oldUsage;}
});

test('production scene save and restore retain authored Bloom and default old documents',()=>{
 const authored=checkedSceneBloom({enabled:true,composeFlame:true,strength:.15,radius:.8}),element={value:'1',checked:false},v={toArray:()=>[0,0,0]};let restored;
 const context={readFireRendering:()=>({}),restoreFireRendering(){},workingScene:{objects:[],selection:{ids:[]}},serializeSceneObject:x=>x,serializeSceneGroups:()=>[],provenanceForSource:()=>null,modelSourceUrl:null,buildSceneDocument:x=>x,activeSceneComposition:null,localLiquidSetup:null,cameraViews:null,sceneCameras:null,viewportDisplay:{},camera:{position:v,up:v},controls:{target:v},sceneEnvironment:{document:()=>({})},groundPlane:{visible:true,position:{y:0},material:{color:{getHexString:()=>''},roughness:1}},getVolumePrimitiveState:()=>[],flameDomainTranslation:[0,0,0],flameDomainScale:1,flameDomainFollowSource:false,sceneGISettings:{},sceneAO:{document:()=>({})},sceneBloom:{read:()=>({settings:authored}),set:value=>restored=checkedSceneBloom(value)},checkedSceneBloom,bloomControls:{sync(){}},backdropMesh:null,document:{getElementById:()=>element},setSceneGIControls(){}};
 vm.createContext(context);vm.runInContext(section('function buildSceneData(', 'function isCompositionAuthoring()'),context);const saved=context.buildSceneData();assert.deepEqual(structuredClone(saved.postprocessing.bloom),authored);
 const apply=section('  // Apply postprocessing','  if (data.postprocessing)');for(const data of [saved,{}]){context.data=data;vm.runInContext(apply,context);assert.deepEqual(restored,data===saved?authored:checkedSceneBloom({}));}
});
