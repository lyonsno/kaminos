// kaminos-test: node
import {createWorkingScene} from '../working-scene.mjs';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const begin=source.indexOf('async function releaseAuthoredWater('),end=source.indexOf('window.kaminosWaterSources=',begin);
const actual=source.slice(begin,end).replace("await import('./authored-water-host.mjs')",'await loadHostModule()');
function fixture(){
 let host={name:'prior',dispose(){this.disposed=true;}};const pending=[];
 const context={isSceneItemVisible:()=>true,Error,structuredClone,localLiquidGeneration:1,authoredWaterReleaseRequest:0,workingScene:createWorkingScene(),LOCAL_LIQUID_EMITTER_TYPE:'water',renderer:{},scene:{},camera:{},renderPipeline:{},sharedGpu:{device:{}},localLiquidSetup:{},getLocalLiquidDisplayPolicy:()=>({}),selectionFeedback:{output:x=>x},localLiquidHost:host,localLiquidPaused:false,authoredWaterControls:null,sharedWorkbench:null,refreshLocalLiquidPerformance(){},window:{_kaminosDirty(){}},assertSceneConstructionAvailable(){},localLiquidEmitterRecords:()=>[{id:'A'}],setAuthoredWaterPreviewVisible(){},updateAuthoringPropertySelection(){},authoredWaterState:()=>({}),loadHostModule:async()=>({createAuthoredWaterHost:options=>new Promise(resolve=>pending.push({resolve,options}))})};
 context.workingScene.put({id:'A',type:'water',object:{}});vm.createContext(context);vm.runInContext(actual,context);
 const candidate=name=>({name,disposed:false,dispose(){this.disposed=true;},setPaused(){}});
 return {context,pending,candidate,call:()=>context.releaseAuthoredWater('A')};
}
const flush=async()=>{for(let i=0;i<4;i++)await Promise.resolve();};
{
 const f=fixture(),a=f.call();await flush();const b=f.call();await flush();const A=f.candidate('older'),B=f.candidate('newer');f.pending[1].resolve(B);await b;f.pending[0].resolve(A);
 await assert.rejects(a,/changed|superseded|obsolete/i);assert.equal(f.context.localLiquidHost,B,'Newest completed release must retain ownership');assert.equal(A.disposed,true);assert.equal(B.disposed,false);
}
{
 const f=fixture(),a=f.call();await flush();f.context.localLiquidGeneration++;const current=f.candidate('loaded-scene');f.context.localLiquidHost=current;f.pending[0].resolve(null);
 await assert.rejects(a,/changed|superseded|obsolete/i);assert.equal(f.context.localLiquidHost,current);assert.equal(current.disposed,false);
}
{
 const f=fixture(),a=f.call();await flush();const bad=f.candidate('start-failure');bad.setPaused=()=>{throw Error('start refused');};f.pending[0].resolve(bad);await assert.rejects(a,/start refused/);assert.equal(f.context.localLiquidHost.name,'prior');assert.equal(f.context.localLiquidHost.disposed,undefined);assert.equal(bad.disposed,true);
}
console.log('Release publication preserves newest request, newer scene and usable prior water on failure');

{
 const f=fixture(),a=f.call();await flush();const accepted=f.candidate('accepted');f.pending[0].resolve(accepted);await a;const b=f.call();await flush();assert.equal(f.pending[0].options.isCurrent(),true,'Pending replacement must leave admitted prior lifetime usable');const bad=f.candidate('bad');bad.setPaused=()=>{throw Error('start refused');};f.pending[1].resolve(bad);await assert.rejects(b,/start refused/);assert.equal(f.context.localLiquidHost,accepted);assert.equal(f.pending[0].options.isCurrent(),true);
}

{
 const f=fixture();assert.equal(typeof f.context.resetAuthoredWater,'function','Reset must expose the initial-preview transition');
 const pending=f.call();await flush();const prior=f.context.localLiquidHost;
 f.context.resetAuthoredWater();assert.equal(prior.disposed,true);assert.equal(f.context.localLiquidHost,null);assert.equal(f.context.localLiquidPaused,true);
 const stale=f.candidate('late');f.pending[0].resolve(stale);await assert.rejects(pending,/changed|superseded/i);assert.equal(stale.disposed,true,'An older Replay cannot publish after Reset');assert.equal(f.context.localLiquidHost,null);
}

{
 const f=fixture(),pending=f.call();await flush();
 const read=f.pending[0].options.readColliders;
 assert.deepEqual(read().map(row=>row.id),['A'],'Release reads the current working-scene owner');
 const floor={id:'floor',type:'procedural-mesh',object:{}};f.context.workingScene.put(floor);
 assert.deepEqual(read().map(row=>row.id),['A','floor'],'Contact reader follows later membership rather than a captured array');
 f.context.workingScene.forget('floor');assert.deepEqual(read().map(row=>row.id),['A']);
 f.pending[0].resolve(f.candidate('owner-backed'));await pending;
}
