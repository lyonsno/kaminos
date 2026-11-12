// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import experiment from '../experiments/shoulder-strip.experiment.mjs';import {createShoulderStripSource} from '../shoulder-strip-source.mjs';
test('marked shoulder retains live footprint settings in the shared registered scene',async()=>{
 const previous=globalThis.fetch,source=createShoulderStripSource({cellsX:32,cellsY:16});globalThis.fetch=async()=>({ok:true,json:async()=>source});
 let attached,disposed=false,persisted;const session={readView:()=>({}),setView:()=>{},redraw:()=>{},attach:async root=>{attached=root;return{id:'shoulder-fixture'};},dispose:async()=>{disposed=true;}};
 try{const instance=await experiment.create({host:{scene:{open:async()=>session}},inputs:{sourceURL:'retained-source'},record(){},updateInputs:v=>persisted=v});
  assert.equal(instance.read().objectId,'shoulder-fixture');assert.ok(attached.children[0].children.length>1);assert.equal(instance.operations.setLOD(3).footprintMM,2.5);assert.equal(persisted.lod,3);assert.equal(instance.operations.setAutomatic(true).footprintMM,null);assert.throws(()=>instance.operations.setMode('ordinary'),/unavailable/);assert.throws(()=>instance.operations.setLOD(-2),/Nonnegative/);await instance.dispose();assert.equal(disposed,true);
 }finally{globalThis.fetch=previous;}
});
