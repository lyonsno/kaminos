// kaminos-test: node — GI proxy tiers for a stored TRELLIS hero run off the page's main thread
import test from 'node:test';import assert from 'node:assert/strict';
import {runGenerationLevels} from '../generation-levels-runner.mjs';

class FakeWorker{
  static last=null;constructor(url,options){this.url=String(url);this.options=options;this.listeners={};FakeWorker.last=this;this.terminated=false;}
  addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);}
  postMessage(message,transfer){this.message=message;this.transfer=transfer;queueMicrotask(()=>this.reply(message));}
  emit(type,data){for(const fn of this.listeners[type]??[])fn({data});}
  terminate(){this.terminated=true;}
}
const inputs=()=>({decode:{vertices:new Float32Array(9),triangles:new Uint32Array([0,1,2])},
  materialFields:{features:new Float32Array(6),coordinates:new Int32Array(3),resolution:8}});

test('the runner sends the decode, fields and hero to a module worker, relays progress and returns the report',async()=>{
  FakeWorker.prototype.reply=function(m){this.emit('message',{kind:'phase',phase:'tiers'});this.emit('message',{kind:'done',report:{phase:'done',tiers:[{faces:5000}],source:m.source}});};
  const phases=[];const report=await runGenerationLevels({...inputs(),source:'a'.repeat(64),input:'TRELLIS page run r',route:'trellis',WorkerClass:FakeWorker,onPhase:p=>phases.push(p.phase)});
  assert.equal(report.phase,'done');assert.equal(report.source,'a'.repeat(64));assert.deepEqual(phases,['tiers']);
  const w=FakeWorker.last;assert.equal(w.options.type,'module');assert.match(w.url,/generation-levels-worker\.mjs$/);
  assert.equal(w.message.input,'TRELLIS page run r');assert.ok(w.transfer.includes(w.message.decode.vertices.buffer),'buffers are transferred, not copied');
  assert.equal(w.terminated,true);
});

test('a worker failure comes back as a failed report naming the phase; it never throws',async()=>{
  FakeWorker.prototype.reply=function(){this.emit('error',{message:'remesh blew up'});};
  const report=await runGenerationLevels({...inputs(),source:'b'.repeat(64),WorkerClass:FakeWorker});
  assert.equal(report.phase,'worker');assert.match(report.error,/remesh blew up/);assert.equal(FakeWorker.last.terminated,true);
});

test('no hero, no tiers: a surfels-only run is skipped with a reason',async()=>{
  const report=await runGenerationLevels({...inputs(),source:null,WorkerClass:FakeWorker});
  assert.equal(report.phase,'skipped');assert.match(report.reason,/no stored hero mesh/);
});
