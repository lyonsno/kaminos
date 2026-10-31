// kaminos-test: node
import assert from 'node:assert/strict';
import {createAuthoredWaterFeature} from '../authored-water-feature.mjs';
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
function fixture(){
 const pending=[];
 const feature=createAuthoredWaterFeature({services:()=>({}),emitters:()=>[{id:'A'}],
  loadHost:async()=>({createAuthoredWaterHost:options=>new Promise((resolve,reject)=>pending.push({resolve,reject,options}))})});
 feature.setup={};
 const candidate=name=>({name,disposed:0,dispose(){this.disposed++;},setPaused(value){this.paused=value;},state:()=>({}),setEmitters(){}});
 return {feature,pending,candidate,call:()=>feature.release()};
}
{
 const f=fixture(),a=f.call();await flush();const b=f.call();await flush();const A=f.candidate('older'),B=f.candidate('newer');f.pending[1].resolve(B);await b;f.pending[0].resolve(A);
 await assert.rejects(a,/changed|superseded/i);assert.equal(f.feature.host,B);assert.equal(A.disposed,1);assert.equal(B.disposed,0);
}
{
 const f=fixture(),a=f.call();await flush();f.feature.clear();f.pending[0].resolve(null);
 await assert.rejects(a,/changed|superseded/i);assert.equal(f.feature.host,null);
}
{
 const f=fixture(),a=f.call();await flush();const accepted=f.candidate('accepted');f.pending[0].resolve(accepted);await a;
 const b=f.call();await flush();assert.equal(f.pending[0].options.isCurrent(),true,'Pending replacement leaves admitted prior lifetime usable');
 const bad=f.candidate('bad');bad.setPaused=()=>{throw Error('start refused');};f.pending[1].resolve(bad);await assert.rejects(b,/start refused/);
 assert.equal(f.feature.host,accepted);assert.equal(accepted.disposed,0);assert.equal(bad.disposed,1);assert.equal(f.pending[0].options.isCurrent(),true);
}
{
 const f=fixture(),a=f.call();await flush();const A=f.candidate('first');f.pending[0].resolve(A);await a;
 const b=f.call();await flush();const B=f.candidate('replacement');f.pending[1].resolve(B);await b;
 assert.equal(A.disposed,1);assert.equal(f.pending[0].options.isCurrent(),false,'A replaced runtime loses its lifetime authority');assert.equal(f.pending[1].options.isCurrent(),true);
 const c=f.call();await flush();f.feature.reset();assert.equal(B.disposed,1);assert.equal(f.feature.host,null);assert.equal(f.feature.paused,true);
 const C=f.candidate('late');f.pending[2].resolve(C);await assert.rejects(c,/changed|superseded/i);assert.equal(C.disposed,1);
}
{
 const f=fixture(),mount=f.feature.restore();await flush();const release=f.call();await flush();
 const released=f.candidate('release');f.pending[1].resolve(released);await release;
 const obsolete=f.candidate('restore');f.pending[0].resolve(obsolete);assert.equal(await mount,false);
 assert.equal(f.feature.host,released);assert.equal(obsolete.disposed,1);assert.equal(f.feature.failure,null);
}
console.log('Water feature owns mount/release/reset/clear publication and preserves viable prior runtime on failed replacement');
