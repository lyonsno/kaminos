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
