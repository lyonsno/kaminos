// kaminos-test: node
import assert from 'node:assert/strict';
import {createAuthoredWaterFeature} from '../authored-water-feature.mjs';
const sources=[{id:'A',localLiquidEmitter:{mode:'finite_drop',drop:{width:.5,samplesPerUnit:16}}}];let factories=[],refreshes=0;
const f=createAuthoredWaterFeature({services:()=>({}),emitters:()=>sources,refresh:()=>refreshes++,loadHost:async()=>({createAuthoredWaterHost:options=>new Promise(resolve=>factories.push({options,resolve}))})});
f.setup={particleCount:64};const first=f.release();await new Promise(resolve=>setImmediate(resolve));
assert.equal(f.isLoading(),true);assert.equal(typeof f.cancelPreparation,'function','Preparation needs an interruptible operation');
const host=()=>({disposed:false,paused:false,setPaused(v){this.paused=v;},dispose(){this.disposed=true;},setEmitters(){},setSetup(){},state:()=>({pendingSourceChanges:true})});
f.cancelPreparation();const obsolete=host();factories[0].resolve(obsolete);await assert.rejects(first,/superseded/);assert.equal(obsolete.disposed,true);assert.equal(f.host,null);
const second=f.release({paused:true});await new Promise(resolve=>setImmediate(resolve));const current=host();factories[1].resolve(current);await second;assert.equal(f.paused,true,'Paused rebuilding must remain paused');
const replacing=f.release();await new Promise(resolve=>setImmediate(resolve));f.setup={particleCount:128};f.sync();const stale=host();factories[2].resolve(stale);await assert.rejects(replacing,/superseded/);assert.equal(stale.disposed,true);assert.equal(f.host,current,'Edits while preparing must preserve the current water and reject the obsolete replacement');
assert(refreshes>0,'Preparation changes must notify presentation');
f.reset();
console.log('Water preparation is cancellable, rejects edited inputs, and preserves paused replacement');
