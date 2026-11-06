// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {createKaminosVolumePrototype} from '../volume-core.js';

function prototype(initial) {
  const stub=()=>new Proxy(function(){},{get(t,p){if(p===Symbol.toPrimitive)return()=>0;if(p==='then')return undefined;return t[p]??(t[p]=stub());},set(t,p,v){t[p]=v;return true;},apply(){return stub();},construct(){return stub();}});
  globalThis.document=stub();globalThis.window=stub();globalThis.requestAnimationFrame=()=>0;globalThis.cancelAnimationFrame=()=>{};globalThis.ResizeObserver=class{observe(){}disconnect(){}};
  return createKaminosVolumePrototype({THREE:stub(),viewport:stub(),camera:stub(),controls:stub(),getControls:()=>({resolution:32,...initial}),onStatus(){}});
}
test('reconstruction configuration rejects invalid values at initial admission and atomically on updates',()=>{
  for(const bad of [{integralReconstruction:'unknown'},{reconstructionSpatial:-1},{reconstructionRadius:Infinity},{reconstructionWindow:0},{reconstructionResponse:NaN},{reconstructionEdge:-1}]) {
    let p;
    assert.throws(()=>{p=prototype(bad);},/Reconstruction/);
    p?.dispose();
  }
  const p=prototype({raymarchMode:'history'});
  try {
    p.configureAdaptiveMaterial({budget:1,maxDetail:2});
    const before=p.adaptiveMaterialState().requested;
    assert.throws(()=>p.setControls({adaptiveMaterial:null,reconstructionWindow:0}),/Reconstruction/);
    assert.deepEqual(p.adaptiveMaterialState().requested,before);
  }finally{p.dispose();}
});

test('actual select-one DOM inventory is admitted by the additive renderer schema',async()=>{
  const {readFileSync}=await import('node:fs');
  const {validateVolumeCockpitControlInventory}=await import('../volume-cockpit-layout.mjs');
  const schema=JSON.parse(readFileSync(new URL('../volume-settings-preset-schema-v2.json',import.meta.url)));
  const records=[...schema.controls,...schema.rendererControls].map(c=>({id:c.key,tagName:c.tagName,type:c.key==='volume-integral-reconstruction'?'select-one':c.type,rootId:'volume-primary-control-root'}));
  assert.doesNotThrow(()=>validateVolumeCockpitControlInventory({schema,controlRecords:records}));
  const mode=schema.rendererControls.find(c=>c.key==='volume-integral-reconstruction');
  assert.deepEqual(mode.allowedValues,['off','spatial','temporal','combined']);
});

test('same-step primitive replacement invalidates the actual core integral source',()=>{
  const p=prototype({integralReconstruction:'combined'});
  try{
    const before=p.debugState();p.setVolumePrimitives([]);const after=p.debugState();
    assert.equal(after.simStepCount,before.simStepCount);
    assert.ok(after.integralSourceGeneration>before.integralSourceGeneration);
    assert.equal(after.integralReconstruction.effective,'off');
  }finally{p.dispose();}
});
test('initial unsupported presentation and same-step bypass transitions publish the actual request',()=>{
  const p=prototype({integralReconstruction:'combined'});
  try{
    const before=p.debugState();assert.equal(before.integralReconstruction?.requested,'combined');
    p.setCanvasPresentationSuppressed(true);
    assert.equal(p.debugState().integralReconstruction.effective,'off');
    assert.match(p.debugState().integralReconstruction.reason,/suppressed/);
    p.setCanvasPresentationSuppressed(false);
    assert.equal(p.debugState().simStepCount,before.simStepCount);
    assert.equal(p.debugState().integralReconstruction.frames,0);
  }finally{p.dispose();}
});

test('same-plan World restoration invalidates the actual source without a Fine or step change',()=>{
  const p=prototype({integralReconstruction:'combined'});
  try{
    const frame={translate:[0,0,0],scale:1,referenceDims:[32,64,32]};
    p.restoreWorldFrame(frame);const before=p.debugState();
    p.restoreWorldFrame(frame);const restored=p.debugState();
    assert.equal(restored.simStepCount,before.simStepCount);
    assert.equal(restored.thermalFluidAllocationId,before.thermalFluidAllocationId);
    assert.ok(restored.integralSourceGeneration>before.integralSourceGeneration);
    assert.equal(restored.integralReconstruction.frames,0);
    assert.equal(restored.integralReconstruction.reason,'world-frame-restored');
    const generation=restored.integralSourceGeneration;
    assert.throws(()=>p.restoreWorldFrame({translate:[],scale:0,referenceDims:[]}));
    assert.equal(p.debugState().integralSourceGeneration,generation,'invalid frame rejects before changing history');
  }finally{p.dispose();}
});

test('presentation and domain changes invalidate image history before another draw can be pinned',()=>{
  const p=prototype({integralReconstruction:'combined'});
  try {
    let generation=p.debugState().integralSourceGeneration;
    p.setVolumePresentationMode('intrinsic');assert.ok(p.debugState().integralSourceGeneration>generation);assert.equal(p.debugState().integralReconstruction.frames,0);
    generation=p.debugState().integralSourceGeneration;
    p.relocateOrdinaryDomain([.1,0,0]);assert.ok(p.debugState().integralSourceGeneration>generation);assert.equal(p.debugState().integralReconstruction.frames,0);
    generation=p.debugState().integralSourceGeneration;
    assert.equal(p.relocateOrdinaryDomain([.1,0,0]),false);assert.equal(p.debugState().integralSourceGeneration,generation);
    assert.throws(()=>p.relocateOrdinaryDomain([NaN,0,0]));assert.equal(p.debugState().integralSourceGeneration,generation);
  }finally{p.dispose();}
});

test('direct smoke and diagnostic presentation changes retire old integral sources',()=>{
  const p=prototype({integralReconstruction:'combined'});
  try {
    for(const [method,mode] of [['setRaymarchSmokePresentationMode','off'],['setAppearanceDecompositionMode','structural-a'],['setBoundarySplatPresentationMode','matched-presentation-v0']]) {
      const before=p.debugState().integralSourceGeneration;
      p[method](mode);assert.ok(p.debugState().integralSourceGeneration>before,method+' must retire old source');
      const after=p.debugState().integralSourceGeneration;p[method](mode);assert.equal(p.debugState().integralSourceGeneration,after,'same effective presentation keeps its source');
    }
  }finally{p.dispose();}
});

test('an effective source control edit invalidates old history before immediate admission',()=>{
 const p=prototype({integralReconstruction:'combined',raySteps:2});try{
  const before=p.debugState().integralSourceGeneration;p.setControls({raySteps:3});assert.ok(p.debugState().integralSourceGeneration>before);
  const source=p.debugState().integralSourceGeneration;p.setControls({reconstructionRadius:2});assert.equal(p.debugState().integralSourceGeneration,source);
 }finally{p.dispose();}
});
