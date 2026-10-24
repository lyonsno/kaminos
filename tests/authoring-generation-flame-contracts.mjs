// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {installGenerationFlame} from '../authoring-generation-flame.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(createRenderer){
 const element=()=>({hidden:false,dataset:{},append(){},setAttribute(){},remove(){},getAnimations:()=>[],animate(){}});
 const document={createElement:element,getElementById:()=>({value:'keep my prompt'})};
 return installGenerationFlame({document,slot:element(),createRenderer});
}
test('ending a generation cancels flame startup while the app GPU is still unavailable',async()=>{
 let signal;
 const flame=fixture((_,options)=>{signal=options?.signal;return new Promise((resolve,reject)=>signal?.addEventListener('abort',()=>reject(signal.reason),{once:true}));});
 flame.render({status:'loading'});await tick();
 assert.ok(signal instanceof AbortSignal,'renderer startup needs cancellation');
 flame.render({status:'failed'});await tick();
 assert.equal(signal.aborted,true);assert.equal(flame.read().error,null);
 await flame.dispose();
});
test('a renderer that resolves after stop never starts and is disposed with its owner',async()=>{
 let finish,started=0,destroyed=0;
 const flame=fixture(()=>new Promise(resolve=>{finish=resolve;}));
 flame.render({status:'loading'});await tick();flame.render({status:'complete'});
 finish({setActive:async active=>{if(active)started++;},dispose(){destroyed++;},debugState:()=>({})});
 await tick();assert.equal(started,0);await flame.dispose();assert.equal(destroyed,1);
});
