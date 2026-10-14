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
test('partial mount failure releases only this comparison presentation and restores prior transport',async()=>{
 const f=fixture(),e=await experiment.create({host:f.host,record:()=>{}}),classes=new Set(),peer={name:'peer'},head={children:[peer],append(n){this.children.push(n);}},viewport={children:[],append(n){this.children.push(n);}};
 const makeNode=tag=>({tag,children:[],nodes:new Map(),className:'',value:'',remove(){this.removed=true;},append(...nodes){this.children.push(...nodes);},querySelector(s){if(!this.nodes.has(s))this.nodes.set(s,makeNode(s));return this.nodes.get(s);}});
 const doc={head,defaultView:{},body:{classList:{add(...names){names.forEach(n=>classes.add(n));},remove(...names){names.forEach(n=>classes.delete(n));},contains:n=>classes.has(n)}},createElement:makeNode,getElementById:()=>viewport};
 let transport=peer,releases=0;f.host.controls.mountTransport=node=>{transport=node;return()=>{transport=peer;releases++;};};f.host.controls.installNumberDrag=()=>{throw Error('affordance failed');};
 await assert.rejects(e.mount({root:makeNode('root'),document:doc,invoke:async()=>{}}),/affordance failed/);await e.dispose();
 assert.equal(releases,1);assert.equal(transport,peer);assert.deepEqual(head.children.filter(n=>!n.removed),[peer]);assert.equal(viewport.children.filter(n=>!n.removed).length,0);assert.equal(classes.has('paired-fluid-comparison'),false);
});
