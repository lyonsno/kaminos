// kaminos-test: node
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const runtimeSource=readFileSync(new URL('../volume-core.js',import.meta.url),'utf8');
const fluidLayout=runtimeSource.split("label: 'kaminos fluid bind group layout',")[1].split("state.gpuInitStage = 'fluid-layout-created'")[0];
const fluidBindings=[...fluidLayout.matchAll(/binding:\s*(\d+)/g)].map(m=>Number(m[1]));
assert.equal(new Set(fluidBindings).size,fluidBindings.length,'Composed fluid layout assigns a unique binding to every resource');
import {pressureResidualProbeDisposition} from '../volume-core.js';
import {flamePropertyApplies} from '../flame-authoring.mjs';
assert.equal(pressureResidualProbeDisposition({independentVelocity:true}),'unavailable','Shared-grid residual is unavailable during independent velocity');
assert.equal(pressureResidualProbeDisposition({independentVelocity:true,mapPending:true}),'unavailable','Pending old map cannot restore a shared-grid residual');
for(const mode of ['off','on'])assert.equal(flamePropertyApplies('volume-intermediate-material',{intermediateMode:mode}),false,'Inactive material controls must not imply a live effect');
assert.equal(flamePropertyApplies('volume-intermediate-material',{intermediateMode:'fields'}),true);

// Exercise the real constructor, with only browser/Three host objects stubbed.
// No GPU is initialized: this catches setup failures before native scene tests.
const stub=()=>new Proxy(function(){},{
 get(target,key){if(key===Symbol.toPrimitive)return()=>0;if(key==='then')return undefined;return target[key]??(target[key]=stub());},
 set(target,key,value){target[key]=value;return true;},apply(){return stub();},construct(){return stub();},
});
const saved=Object.fromEntries(['document','window','requestAnimationFrame','cancelAnimationFrame','ResizeObserver'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
try {
 globalThis.document=stub();globalThis.window=stub();globalThis.requestAnimationFrame=()=>0;globalThis.cancelAnimationFrame=()=>{};
 globalThis.ResizeObserver=class{observe(){}disconnect(){}};
 const {createKaminosVolumePrototype}=await import('../volume-core.js');
 for(const fineVelocity of [0,16]){
  const sim=createKaminosVolumePrototype({THREE:stub(),viewport:stub(),camera:stub(),controls:stub(),getControls:()=>({resolution:32,fineVelocity}),onStatus(){}});
  try {
   assert.throws(()=>sim.setControls({fineVelocity:7}),/Fine velocity/, 'Invalid subdivision is rejected synchronously before changing runtime controls');
   assert.equal(sim.debugState().controls.fineVelocity,fineVelocity,'Rejected input retains prior controls');
   assert.throws(()=>sim.setControls({worldSmoke:'on',worldSmokePressure:7}),/pressure/);
   assert.equal(sim.debugState().error,null,'Dimension rejection does not poison frame state');
   const s=sim.debugState();
   assert.equal(s.pressureSolver.residual,null);
   assert.equal(s.pressureSolver.residualProbe.available,false,'No effective grid exists before initialization');
   assert.equal(s.pressureSolver.residualProbe.reason,'fine-grid-not-seated');
  } finally {sim.dispose();}
 }
} finally {
 for(const [k,d] of Object.entries(saved))if(d)Object.defineProperty(globalThis,k,d);else delete globalThis[k];
}
