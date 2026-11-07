// kaminos-test: node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {validateSceneSourceTransform} from '../scene-volume-source.mjs';

const source=fs.readFileSync(new URL('../volume-core.js',import.meta.url),'utf8');
const extract=name=>{
  const start=source.indexOf(`    ${name}(`);
  assert.notEqual(start,-1,`Retained presentation API ${name} is missing`);
  return source.slice(start,source.indexOf('\n    },',start)+6).replace(/,$/,'');
};
const method=extract('setPresentationTransform');
const {composeVolumePresentationTransform}=await import('../volume-presentation-frame.mjs');
const physical={translate:[2,-1,3],scale:2};
const context={validateSceneSourceTransform,composeVolumePresentationTransform,
  presentationTransform:{translate:[0,0,0],scale:1},productTransform:physical,
  state:{simStepCount:17,simulationPaused:true,thermalFluidAllocationId:9},
  writeLiquidFireContactParams(){},emitStatus(){},sceneVolumeSource:null,
  presentationTransformReceipt(){return {physical:structuredClone(physical),presentation:structuredClone(context.presentationTransform)};},
};
vm.createContext(context);
const runtime=vm.runInContext(`({${method}})`,context);
const frame={translate:[3,-2,7],scale:.0494};
runtime.setPresentationTransform(frame);
assert.deepEqual(structuredClone(context.presentationTransform),frame);
assert.deepEqual(physical,{translate:[2,-1,3],scale:2});
assert.deepEqual(context.state,{simStepCount:17,simulationPaused:true,thermalFluidAllocationId:9});
frame.translate[0]=500;
assert.equal(context.presentationTransform.translate[0],3,'caller cannot mutate the accepted frame');
assert.throws(()=>runtime.setPresentationTransform({translate:[0,0,0],scale:0}),/positive/);
assert.equal(context.presentationTransform.scale,.0494,'failed edit preserves the accepted transform');
const composed=composeVolumePresentationTransform(physical,context.presentationTransform);
assert.equal(composed.scale,.0988);
for(const [axis,x] of [3.0988,-2.0494,7.1482].entries())assert.ok(Math.abs(composed.translate[axis]-x)<1e-12);
assert.deepEqual(composeVolumePresentationTransform(physical),physical,'identity presentation preserves existing world behavior');
assert.notEqual(composeVolumePresentationTransform(physical).translate,physical.translate);
assert.throws(()=>composeVolumePresentationTransform(physical,{translate:[0,0,0],scale:Infinity}),/positive/);
const cachedTexture={cached:true};
context.sceneVolumeSourceRequested=true;
context.sceneVolumeSource={describe:()=>({status:'encoded',generation:4,texture:cachedTexture})};
context.state.active=false;
const sourceReader=vm.runInContext(`({${extract('sceneVolumeSourceField')}})`,context);
assert.equal(sourceReader.sceneVolumeSourceField().status,'inactive','a withdrawn volume cannot keep lighting the scene from a cached field');
assert.equal(sourceReader.sceneVolumeSourceField().generation,null);
context.state.active=true;
assert.equal(sourceReader.sceneVolumeSourceField().texture,cachedTexture,'withdrawal retains the producer allocation');
const {createKaminosVolumePrototype}=await import('../volume-core.js');
const stub=()=>new Proxy(function(){},{get(target,key){if(key===Symbol.toPrimitive)return()=>0;if(key==='then')return undefined;return target[key]??(target[key]=stub());},set(target,key,value){target[key]=value;return true;},apply(){return stub();},construct(){return stub();}});
globalThis.document=stub();globalThis.window=stub();globalThis.requestAnimationFrame=()=>0;
globalThis.ResizeObserver=class{observe(){}disconnect(){}};
const real=createKaminosVolumePrototype({THREE:stub(),viewport:stub(),camera:stub(),controls:stub(),getControls:()=>({resolution:32}),onStatus(){}});
real.setSimulationPaused(true);
const before=real.debugState();
real.setPresentationTransform({translate:[3,-2,7],scale:.0494});
const after=real.debugState();
for(const key of ['ordinaryDomainTranslation','ordinaryDomainScale','simStepCount','simulationPaused','thermalFluidAllocationId','fluidStateResetCount','simGridDimensions','controls'])assert.deepEqual(after[key],before[key],key);
assert.deepEqual(real.presentationFrame().worldTransform,{translate:[3,-2,7],scale:.0494});
for(const [axis,x] of [3.0494,-1.8518,7.0494].entries())assert.ok(Math.abs(real.fireIrradianceLightField().worldMax[axis]-x)<1e-12,'published light bounds use the presentation frame');
real.setPresentationTransform({translate:[0,0,0],scale:1});
assert.deepEqual(real.fireIrradianceLightField().worldMax,[1,3,1]);
console.log('Retained presentation leaves physical frame, allocation, time and pause unchanged');
