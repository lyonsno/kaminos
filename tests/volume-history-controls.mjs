// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import * as history from '../volume-history-allocation.mjs';
import {FLAME_PROPERTY_GROUPS} from '../flame-authoring.mjs';
import {readFileSync} from 'node:fs';
import {createKaminosVolumePrototype} from '../volume-core.js';

function makePrototype(initial){
 const stub=()=>new Proxy(function(){},{get(t,p){if(p===Symbol.toPrimitive)return()=>0;if(p==='then')return undefined;return t[p]??(t[p]=stub());},set(t,p,v){t[p]=v;return true;},apply(){return stub();},construct(){return stub();}});
 globalThis.document=stub();globalThis.window=stub();globalThis.requestAnimationFrame=()=>0;globalThis.cancelAnimationFrame=()=>{};globalThis.ResizeObserver=class{observe(){}disconnect(){}};
 return createKaminosVolumePrototype({THREE:stub(),viewport:stub(),camera:stub(),controls:stub(),getControls:()=>({resolution:32,...initial}),onStatus(){}});
}

test('history settings preserve the accepted defaults and validate GPU-representable input',()=>{
 assert.equal(typeof history.rayHistorySettings,'function','history authoring needs a validated settings contract');
 assert.deepEqual(history.rayHistorySettings(),{influence:1,window:1,retention:0});
 assert.equal(history.rayHistorySettings({influence:0,window:8}).influence,0);
 assert.ok(history.rayHistorySettings({window:8}).retention>0);
 for(const influence of [-1,Infinity,NaN,1e100,1e-100])assert.throws(()=>history.rayHistorySettings({influence}));
 for(const window of [0,-1,1.5,Infinity,1e100])assert.throws(()=>history.rayHistorySettings({window}));
});
test('both knobs belong to the contextual ray marcher and additive saved renderer state',()=>{
 const fields=FLAME_PROPERTY_GROUPS.find(g=>g.name==='Ray marching').fields.map(([id])=>id);
 const schema=JSON.parse(readFileSync(new URL('../volume-settings-preset-schema-v2.json',import.meta.url)));
 for(const key of ['volume-history-influence','volume-history-window']){
  assert.equal(fields.filter(id=>id===key).length,1,key);
  assert.equal(schema.rendererControls.find(c=>c.key===key)?.additiveDefault,1,key+' default');
 }
});

test('actual core rejects invalid initial history settings in every marcher before creating a renderer',()=>{
 for(const raymarchMode of ['history','numerical'])for(const bad of [{historyWindow:0},{historyWindow:1.5},{historyInfluence:-1}])
  assert.throws(()=>makePrototype({raymarchMode,...bad}),/History/);
 const p=makePrototype({raymarchMode:'history'});
 try{assert.equal(p.debugState().controls.historyInfluence,1);assert.equal(p.debugState().controls.historyWindow,1);}finally{p.dispose();}
});

test('actual combined setter rejects history values without changing allocation or effective marcher',()=>{
 const p=makePrototype({raymarchMode:'history',historyInfluence:1,historyWindow:1});
 try{
  p.configureAdaptiveMaterial({budget:1,maxDetail:2});
  const beforeAllocation=structuredClone(p.adaptiveMaterialState().requested);
  const before=p.debugState();
  assert.throws(()=>p.setControls({adaptiveMaterial:null,raymarchMode:'fixed',historyWindow:1.5}),/History/);
  assert.deepEqual(p.adaptiveMaterialState().requested,beforeAllocation);
  p.setControls({historyWindow:1});const after=p.debugState();
  assert.equal(after.controls.raymarchMode,before.controls.raymarchMode);
  assert.equal(after.adaptiveRaymarch,before.adaptiveRaymarch);
  assert.equal(after.controls.historyWindow,1);
 }finally{p.dispose();}
});
