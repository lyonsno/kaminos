// kaminos-test: node
import assert from 'node:assert/strict';
import {test} from 'node:test';
const module=await import('../owner-live-fluid-session.mjs').catch(e=>{if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;return {};});
test('live inlet capability owns only its mounted host and rejects stale publication',async()=>{
 assert.equal(typeof module.openLiveFluidSession,'function','live inlet capability missing');
 let current=null,generation=1,disposed=0,packet=null;
 const host={state:()=>({frameCount:3}),setLiveInletPacket:p=>packet=p,setPaused:()=>{},dispose:()=>disposed++};
 const hooks={getHost:()=>current,setHost:v=>current=v,getGeneration:()=>generation,createHost:async()=>host};
 const live=await module.openLiveFluidSession(hooks,{setup:{},packet:{}});
 assert.equal(current,host);live.setPacket({id:2});assert.deepEqual(packet,{id:2});
 await assert.rejects(()=>module.openLiveFluidSession(hooks,{}),/already/);
 generation++;assert.throws(()=>live.setPacket({id:3}),/expired/);
 const other={};current=other;await live.dispose();await live.dispose();
 assert.equal(disposed,1);assert.equal(current,other);
});
test('late initialization cannot take over another scene or leak its candidate',async()=>{
 assert.equal(typeof module.openLiveFluidSession,'function');
 let current=null,generation=1,finish,disposed=0;
 const task=module.openLiveFluidSession({getHost:()=>current,setHost:v=>current=v,getGeneration:()=>generation,
   createHost:()=>new Promise(r=>finish=r)},{setup:{},packet:{}});
 await Promise.resolve();generation++;finish({dispose:()=>disposed++});
 await assert.rejects(task,/expired/);assert.equal(current,null);assert.equal(disposed,1);
});
