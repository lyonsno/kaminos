// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import * as THREE from '../lib/three.core.js';
import {createFireUnitObject} from '../fire-unit-runtime.mjs';
import {FINE_COVERAGE_FIELDS} from '../volume-fine-coverage-controls.mjs';
const pose=()=>({position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]});
function fixture(fireUnit={}){
 const original={document:globalThis.document,window:globalThis.window,cancelAnimationFrame:globalThis.cancelAnimationFrame};
 globalThis.document={createElement:()=>({dataset:{},style:{},classList:{add(){},remove(){}},remove(){}})};globalThis.window={devicePixelRatio:1};globalThis.cancelAnimationFrame=()=>{};
 const controls={pressureSolver:'converged',emitterSourceLaw:'immersed-source',resolution:16,gridHeightRatio:1,fineVelocity:16,finePressure:16,worldSmoke:'on',worldSmokeExtent:3,worldSmokeFlow:8,worldSmokeMaterial:8,worldSmokePressure:8,worldSmokeIterations:12,worldSmokeIntermediate:'off'};
 const owner=createFireUnitObject({THREE,camera:new THREE.PerspectiveCamera(50,1.5,.1,100),viewport:{appendChild(){},clientWidth:600,clientHeight:400},controls:null,
  record:{id:'fire-a',type:'fire-unit',source:'kaminos:fire-unit',transform:pose(),fireUnit:{controls,moveEmitterWithGrid:true,emitter:{...pose(),position:[0,-.76,0]},...fireUnit}}});
 return {owner,restore:()=>Object.assign(globalThis,original)};
}
test('a new unit shows its outer World grid and Fine grid before GPU initialization',()=>{
 const {owner,restore}=fixture();try{assert.deepEqual(owner.root.children[1].box.min.toArray(),[-3,-3,-3]);assert.deepEqual(owner.root.children[0].box.min.toArray(),[-1,-1,-1]);assert.equal(owner.runtime.canvasElement().style.background,'transparent');}finally{restore();}
});
test('a rigidly scaled unit represents the source once in world space',()=>{
 const {owner,restore}=fixture();try{owner.root.scale.setScalar(2);owner.syncPose();owner.root.updateMatrixWorld(true);assert.deepEqual(owner.emitter.getWorldScale(new THREE.Vector3()).toArray(),[2,2,2]);}finally{restore();}
});
test('steady frames do not poll or analyze a static unit transform',()=>{
 const {owner,restore}=fixture();try{let reads=0;const read=owner.root.position.toArray.bind(owner.root.position);owner.root.position.toArray=()=>{reads++;return read();};for(let i=0;i<3;i++)owner.sync({visible:false,helpers:true,paused:true});assert.equal(reads,0);}finally{restore();}
});
test('a refused native grid rotation restores the last accepted root pose',()=>{
 const {owner,restore}=fixture();try{owner.root.rotation.y=.3;assert.throws(()=>owner.syncPose(),/aligned/);assert.equal(owner.root.rotation.y,0);assert.equal(owner.capture().moveEmitterWithGrid,true);}finally{restore();}
});
test('each unit disables the prototype floor/cluster injector',()=>{
 const {owner,restore}=fixture();try{assert.equal(owner.runtime.debugState().coreEmitterSourceMode,'analytic-only');}finally{restore();}
});

test('a restored Fine offset leaves World at the unit origin and moves rigidly with the unit',()=>{
 const {owner,restore}=fixture({fineOffset:[1,.25,0],worldReferenceDims:[16,16,16]});try{
 assert.deepEqual(owner.runtime.debugState().ordinaryDomainTranslation,[1,.25,0]);
 assert.deepEqual(owner.runtime.worldFrame(),{translate:[0,0,0],scale:1,referenceDims:[16,16,16]});
 assert.deepEqual(owner.root.children[0].box.min.toArray(),[0,-.75,-1]);
 owner.setPose({...pose(),position:[4,2,0],scale:[2,2,2]});
 assert.deepEqual(owner.runtime.debugState().ordinaryDomainTranslation,[6,2.5,0]);
 assert.deepEqual(owner.runtime.worldFrame(),{translate:[4,2,0],scale:2,referenceDims:[16,16,16]});
 assert.deepEqual(owner.capture().fineOffset,[1,.25,0]);
 }finally{restore();}
});
test('per-unit field overlay reaches the existing renderer and remains view-only',()=>{
 const {owner,restore}=fixture();try{const before=owner.capture();owner.setWorldOverlay('contributions');assert.equal(owner.runtime.debugState().worldSmokeOverlay,'contributions');assert.equal(owner.worldOverlay().mode,'contributions');assert.deepEqual(owner.capture(),before);assert.throws(()=>owner.setWorldOverlay('bogus'),/Unknown/);}finally{restore();}
});

test('each unit reuses source following on its own fixed World, with cached policy and interval',()=>{
 const domControls=Object.fromEntries(FINE_COVERAGE_FIELDS.map(f=>[f.id,{value:f.key==='mode'?'sources':f.value}]));
 const {owner,restore}=fixture({settings:{domControls}});try{
 let reads=0;owner.runtime.fineCoverageInputs=()=>{reads++;const frame=owner.runtime.debugState();return {status:'active',frame:{translate:frame.ordinaryDomainTranslation,scale:frame.ordinaryDomainScale},dims:[16,16,16],world:{lo:[-3,-3,-3],hi:[3,3,3]},sources:[{id:'source',lo:[2.2,-.8,-.1],hi:[2.6,-.6,.1],weight:1}],demand:[]};};
 owner.updateFineCoverage(1);assert.ok(owner.capture().fineOffset[0]>1);assert.deepEqual(owner.runtime.worldFrame().translate,[0,0,0]);
 owner.updateFineCoverage(1.1);assert.equal(reads,1,'interval avoids another source observation');
 owner.updateFineCoverage(1.3,{editing:true});assert.equal(reads,1,'active authoring owns the frame');
 const next=owner.capture();next.settings.domControls['volume-coverage-headroom'].value=.4;owner.setData(next);owner.updateFineCoverage(1.4);assert.equal(reads,2);assert.equal(owner.read().fineCoverage.options.headroom,.4);
 }finally{restore();}
});

test('retired six-direction diagnostics report retirement without allocating or profiling GPU work',async()=>{
 const {owner,restore}=fixture();try{
  assert.deepEqual(await owner.runtime.sampleEmissiveLightProfile(),{ok:false,reason:'six-direction-lighting-retired'});
  assert.equal((await owner.runtime.sampleEmissiveSeedCoefficients()).reason,'six-direction-lighting-retired');
 }finally{restore();}
});

test('manual Fine placement changes its native frame while World and emitter keep their poses',()=>{
 const {owner,restore}=fixture();try{
  const before=owner.capture(),world=owner.runtime.worldFrame();
  assert.equal(typeof owner.finePose,'function','Fine must expose a native transform target');
  owner.setFinePose({position:[.5,.25,0],rotation:[0,0,0],scale:[.75,.75,.75]});
  assert.deepEqual(owner.finePose(),{position:[.5,.25,0],rotation:[0,0,0],scale:[.75,.75,.75]});
  assert.deepEqual(owner.runtime.worldFrame(),world);assert.deepEqual(owner.capture().emitter,before.emitter);assert.equal(owner.capture().fineManualHold,true,'manual placement must survive duplication and reopening');
  assert.deepEqual(owner.runtime.debugState().ordinaryDomainTranslation,[.5,.25,0]);
  assert.equal(owner.runtime.debugState().ordinaryDomainScale,.75);
  assert.throws(()=>owner.setFinePose({position:[0,0,0],rotation:[0,.2,0],scale:[1,1,1]}),/aligned/);
 }finally{restore();}
});

test('whole-unit movement preserves a manually placed Fine hold against source following',()=>{
 const domControls=Object.fromEntries(FINE_COVERAGE_FIELDS.map(f=>[f.id,{value:f.key==='mode'?'sources':f.value}]));const {owner,restore}=fixture({settings:{domControls}});try{
  owner.setFinePose({position:[.5,.25,0],rotation:[0,0,0],scale:[.75,.75,.75]});owner.setPose({...pose(),position:[2,0,0]});const before=owner.finePose();
  owner.runtime.fineCoverageInputs=()=>({status:'active',frame:{translate:before.position,scale:before.scale[0]},dims:[16,16,16],world:{lo:[-1,-3,-3],hi:[5,3,3]},sources:[{id:'source',lo:[1.9,-.86,-.1],hi:[2.1,-.66,.1],weight:1}],demand:[]});
  owner.updateFineCoverage(1);assert.equal(owner.read().fineCoverage.status,'manual-hold');assert.deepEqual(owner.finePose(),before);assert.equal(owner.capture().fineManualHold,true);
 }finally{restore();}
});

test('a rejected manual Fine move restores automatic following instead of leaving a hidden hold',()=>{
 const domControls=Object.fromEntries(FINE_COVERAGE_FIELDS.map(f=>[f.id,{value:f.key==='mode'?'sources':f.value}]));const {owner,restore}=fixture({settings:{domControls}});try{
  const original=owner.runtime.setImmersedSources;let refuse=true;owner.runtime.setImmersedSources=(...args)=>{if(refuse){refuse=false;throw Error('refused supply');}return original(...args);};
  assert.throws(()=>owner.setFinePose({...pose(),position:[.5,0,0]}),/refused supply/);const before=owner.finePose();
  owner.runtime.fineCoverageInputs=()=>({status:'active',frame:{translate:before.position,scale:1},dims:[16,16,16],world:{lo:[-3,-3,-3],hi:[3,3,3]},sources:[{id:'source',lo:[2,-.8,-.1],hi:[2.2,-.6,.1],weight:1}],demand:[]});
  owner.updateFineCoverage(1);assert.notEqual(owner.read().fineCoverage.status,'manual-hold');assert.notEqual(owner.capture().fineManualHold,true);
 }finally{restore();}
});
