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

test('when decode.coordinates is present, the runner requests x4, x8, x16 surfel levels and transfers the coordinate buffer',async()=>{
  FakeWorker.prototype.reply=function(m){this.emit('message',{kind:'done',report:{phase:'done',surfelFactors:m.surfelFactors}});};
  const inp=inputs();inp.decode.coordinates=new Int32Array(9);
  const report=await runGenerationLevels({...inp,source:'c'.repeat(64),WorkerClass:FakeWorker});
  assert.deepEqual(report.surfelFactors,[4,8,16]);
  assert.ok(FakeWorker.last.transfer.includes(inp.decode.coordinates.buffer));
});

test('the runner also runs for an arbitrary stored GLB without decode or materialFields, transferring heroGLB when given',async()=>{
  FakeWorker.prototype.reply=function(m){this.emit('message',{kind:'done',report:{phase:'done',source:m.source,tiers:[{faces:1000}]}});};
  const heroGLB=new Uint8Array([1,2,3,4]).buffer;
  const report=await runGenerationLevels({source:'d'.repeat(64),heroGLB,input:'imported.glb',WorkerClass:FakeWorker});
  assert.equal(report.phase,'done');
  assert.equal(FakeWorker.last.message.decode,undefined);
  assert.equal(FakeWorker.last.message.materialFields,undefined);
  assert.ok(FakeWorker.last.transfer.includes(heroGLB));
});


test('automatic surfel levels preserve the 512 format boundary; explicit requests are not silently changed',async()=>{
  FakeWorker.prototype.reply=function(m){this.emit('message',{kind:'done',report:{phase:'done',surfelFactors:m.surfelFactors}});};
  const make=resolution=>{const x=inputs();x.decode.coordinates=new Int32Array(9);x.materialFields.resolution=resolution;return {...x,source:'c'.repeat(64),WorkerClass:FakeWorker};};
  assert.deepEqual((await runGenerationLevels(make(512))).surfelFactors,[4,8,16]);
  const unsupported=await runGenerationLevels(make(1024));
  assert.deepEqual(unsupported.surfelFactors,[]);assert.equal(unsupported.surfels.reason,'unsupported-resolution');
  const explicit=await runGenerationLevels({...make(1024),surfelFactors:[4]});
  assert.deepEqual(explicit.surfelFactors,[4]);assert.equal(explicit.surfels,undefined);
});
