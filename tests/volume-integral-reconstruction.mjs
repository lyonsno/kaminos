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
