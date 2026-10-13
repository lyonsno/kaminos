import test from 'node:test';import assert from 'node:assert/strict';
import experiment from '../experiments/paper-fluid/paired-pressure.experiment.mjs';
function fixture(){
 let generation=0,release,fail=false;
 const host={
  controls:{document:{defaultView:{}}},
  scene:{open:async()=>({readView:()=>({}),dispose(){}})},
  fluid:{async openPair(setups){
   generation++;
   if(generation>1){await new Promise(resolve=>{release=resolve;});if(fail)throw Error('replacement startup failed');}
   let closed=false;
   return {
    dt:1/60,
    read(){if(closed)throw Error('disposed host');return setups.map((s,i)=>({id:'arm'+i,generation,step:0,dt:1/60,settings:{compliance:s.solver.ipbfCompliance}}));},
    capture:()=>[{step:0},{step:0}],show(){},onFrame:()=>()=>{},state:()=>({}),dispose(){closed=true;},
   };
  }},
 };
 return {host,get release(){return release;},set fail(value){fail=value;}};
}
test('reset read explicitly retains the prior observation while replacement is being created',async()=>{
 const f=fixture(),e=await experiment.create({host:f.host,record:()=>{}}),reset=e.operations.reset({compliance:3});
 await new Promise(resolve=>setImmediate(resolve));const during=e.read();assert.equal(during.status,'resetting');assert.equal(during.readAuthority,'retained-before-reset');assert.equal(during.busy,true);
 f.release();await reset;assert.equal(e.read().candidateCompliance,3);assert.equal(e.read().arms[1].settings.compliance,3);await e.dispose();
});
test('failed replacement cannot present the disposed prior water as live',async()=>{
 const f=fixture(),e=await experiment.create({host:f.host,record:()=>{}});f.fail=true;const reset=e.operations.reset({compliance:3});
 await new Promise(resolve=>setImmediate(resolve));f.release();await assert.rejects(reset,/replacement startup failed/);assert.equal(e.read().status,'failed-reset');assert.equal(e.read().failure,'replacement startup failed');await e.dispose();
});
