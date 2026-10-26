// kaminos-test: node
import {test} from 'node:test';import assert from 'node:assert/strict';
import * as THREE from '../lib/three.core.js';
import experiment from '../experiments/inference-kiln-material.experiment.mjs';
import {createSceneBurning} from '../scene-burning.mjs';

test('surface comparison preserves the resident body, evolved state and playback in both directions',async()=>{
 let created=0,disposed=0,steps=0,paused=false,profile='incineration',flameActive=true;const objects=[];
 const emitter={id:'flame-emitter',type:'flame-emitter',object:new THREE.Object3D()};objects.push(emitter,{id:'flame-field'});
 const runtime={debugState:()=>({active:flameActive,simulationPaused:paused}),setActive:async v=>{flameActive=v;},setSimulationPaused:v=>paused=v,resetThermalExperimentFluid(){},
  borrowThermalGpuContext:async()=>({device:{}}),bindGpuThermalConsumer:()=>()=>{}};
 const burning=createSceneBurning({objects:()=>objects.filter(x=>x.object),runtime:()=>runtime,
  createGas:async()=>({descriptor:{},dispose(){}}),createBody:async()=>{
   created++;steps=0;return {setMounted(){},setAppearance(value){profile=value.profile??profile;},dispose(){disposed++;},read:()=>({fields:[{steps,referenceSeconds:steps/40}],profile})};
  }});
 const app={setBurnable(id,enabled){objects.find(x=>x.id===id).burnable={enabled};},settleCombustion:()=>burning.sync(),burningState:id=>burning.read(id),setBurnAppearance:(id,value)=>burning.setAppearance(id,value)};
 const canvas={width:0,height:0};const ctx={measureText:s=>({width:s.length*30}),clearRect(){},fillText(){},getImageData(){
  const data=new Uint8ClampedArray(canvas.width*canvas.height*4);for(let y=20;y<70;y++)for(let x=20;x<170;x++)data[(y*canvas.width+x)*4+3]=255;return {data,width:canvas.width,height:canvas.height};}};canvas.getContext=()=>ctx;
 const ground={checked:true,onchange(){}},settings={'volume-flow-rate':.8,'volume-immersed-fuel':.7,'volume-ray-start-noise':true,'volume-ray-noise-animated':true};
 let bloom={enabled:false,strength:.25,radius:.1,threshold:1.1};const document={createElement:()=>canvas,getElementById:()=>ground,defaultView:{kaminosSceneVisibility:{set(id,value){assert.equal(id,'flame-field');flameActive=value;}},kaminosSceneAuthoring:app,kaminosSceneBloom:{read:()=>({settings:{...bloom}}),set:v=>Object.assign(bloom,v)}}};
 const session={async attach(object,options){if(options.presentation)return {id:'stage',root:object};const row={id:'prompt',object,burnable:{enabled:false}};objects.push(row);return {id:row.id,root:object};},setView(){},onFrame:()=>()=>{},redraw(){},async dispose(){}};
 const host={controls:{document},scene:{open:async()=>session,objects:()=>objects,select(){},setTransform(id,pose){objects.find(x=>x.id===id).object.position.fromArray(pose.position);}},volume:{ready:Promise.resolve(),get:()=>runtime},flame:{open:async()=>({read:()=>({active:flameActive,scene:{objects},settings:{domControls:Object.fromEntries(Object.entries(settings).map(([k,value])=>[k,{value}]))},clock:{}}),setControls:values=>{if(!flameActive)throw Error('Flame runtime is not active');Object.assign(settings,values);}})}};
 const study=await experiment.create({host,inputs:{},record(){}});steps=200;runtime.setSimulationPaused(false);
 await study.operations.setAppearance('crust');assert.equal(study.read().combustion.state.fields[0].steps,200,'a display choice must retain the evolved field');assert.equal(created,1);assert.equal(disposed,0);assert.equal(paused,false);
 await study.operations.setAppearance('incineration');await study.operations.setAppearance('incineration');assert.equal(steps,200);assert.equal(created,1);assert.equal(disposed,0);assert.equal(paused,false);assert.equal(profile,'incineration');
 flameActive=false;await study.operations.reset();assert.equal(flameActive,true);assert.equal(study.read().combustion.state.fields[0].steps,0);
 flameActive=false;await study.dispose();await burning.dispose();assert.equal(flameActive,true);assert.equal(disposed,2);
});
