// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {createEarthDynamics,createEarthDynamicsKernel} from '../earth-dynamics.mjs';
import {EarthSpecimen} from '../earth-specimen.mjs';

test('swept tool applies solver-sized trajectory samples including contact velocity',()=>{
 const kernel=createEarthDynamicsKernel(),initial=kernel.apply({kind:'init',config:{columns:3,layers:2,grains:0}});
 const before=initial.snapshot,from={position:[-.09,.12,0],radius:.07},to={position:[.09,.05,0],radius:.07};
 const out=kernel.apply({kind:'sweep',seconds:.04,from,to});
 assert.ok(Math.abs(out.state.time-.04)<1e-12);assert.equal(out.state.steps,8);
 assert.ok(out.snapshot.particles.some((p,i)=>Math.abs(p.position[0]-before.particles[i].position[0])>.0001));
 assert.deepEqual(initial.snapshot,before,'returned snapshots remain detached');kernel.dispose();
});
test('persistent worker returns physical state and rejects pending work on disposal',async()=>{
 let instance;
 class Worker{constructor(){instance=this;this.kernel=createEarthDynamicsKernel();this.sent=[];}postMessage(data){this.sent.push(data);queueMicrotask(()=>{if(this.dead)return;try{this.onmessage({data:{id:data.id,result:this.kernel.apply(data)}});}catch(e){this.onmessage({data:{id:data.id,error:e.message}});}});}terminate(){this.dead=true;this.kernel.dispose();}}
 const app=await createEarthDynamics({config:{columns:3,layers:2,grains:0},WorkerType:Worker});
 await app.advance(.01);await app.setMaterial({friction:.3});assert.equal(app.config.friction,.3);assert.equal(instance.sent.filter(s=>s.kind==='init').length,1);assert.ok(app.state().time>.009);
 const pending=app.advance(.02);app.dispose();await assert.rejects(pending,/disposed/);assert.equal(instance.dead,true);
});


test('a swept physical chunk summarizes only its final state and preserves every solver step',()=>{
 const kernel=createEarthDynamicsKernel(),initial=kernel.apply({kind:'init',config:{columns:3,layers:2,grains:0}}),reference=EarthSpecimen.fromSnapshot(initial.snapshot),from={position:[-.06,.12,0],radius:.07},to={position:[.06,.04,0],radius:.07},seconds=.04,count=Math.ceil(seconds/reference.config.dt);
 const original=EarthSpecimen.prototype.state;let calls=0;EarthSpecimen.prototype.state=function(){calls++;return original.call(this);};
 try{const actual=kernel.apply({kind:'sweep',seconds,from,to});assert.equal(calls,1,'discarded per-substep state summaries must not be rebuilt');
 EarthSpecimen.prototype.state=original;for(let i=0;i<count;i++){const t=i/count;reference.advance(seconds/count,{tool:{position:from.position.map((v,k)=>v+(to.position[k]-v)*t),radius:from.radius+(to.radius-from.radius)*t,velocity:to.position.map((v,k)=>(v-from.position[k])/seconds)}});}assert.deepEqual(actual.snapshot,reference.snapshot());
 }finally{EarthSpecimen.prototype.state=original;reference.dispose();kernel.dispose();}
});
