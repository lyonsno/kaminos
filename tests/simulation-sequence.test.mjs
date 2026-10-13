// kaminos-test: node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
// Absence is a feature-contract failure, not an import-error witness.
assert.ok(await fs.stat(new URL('../simulation-sequence.mjs',import.meta.url)).catch(()=>null),
 'Shared fixed-time sequence runner is absent');
const {renderSequence}=await import('../simulation-sequence.mjs');
const {createDirectorySequenceSink,readSequence}=await import('../sequence-directory.mjs');
const {deflateSync}=await import('node:zlib');
// Independent, valid two-color 2x1 PNG fixture (same pixels at all times is allowed).
const crc=bytes=>{let c=0xffffffff;for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;};
const chunk=(type,body)=>{const t=Buffer.from(type),head=Buffer.alloc(4),tail=Buffer.alloc(4);head.writeUInt32BE(body.length);tail.writeUInt32BE(crc(Buffer.concat([t,body])));return Buffer.concat([head,t,body,tail]);};
const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(2,0);ihdr.writeUInt32BE(1,4);ihdr[8]=8;ihdr[9]=2;
const png=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(Buffer.from([0,255,0,0,0,255,0]))),chunk('IEND',Buffer.alloc(0))]);
function fixture({rate=1,drift=false,missing=false,failAt=null}={}){
 let step=0,paused=false,runId='run-a',active=0,max=0;
 const read=async()=>({clock:{runId,step,dt:1/240,paused,backend:'fixture',renderer:'fixture'},source:{revision:'fixture'},conditions:{rate},view:{camera:[0,0,1]}});
 return {adapter:{read,hold:async()=>{paused=true;},advanceToStep:async n=>{step=n;},render:async()=>({step}),capture:async()=>{
  active++;max=Math.max(max,active);await Promise.resolve();active--;
  if(step===failAt)throw Error('capture broke');if(drift)runId='other';
  return missing?new Uint8Array():png;
 }},read,peak:()=>max};
}
const base=await fs.mkdtemp(path.join(os.tmpdir(),'sequence-contract-'));
const out=name=>path.join(base,name);
for(const rate of [.25,2]){
 const f=fixture({rate});let writes=0;
 const sink=await createDirectorySequenceSink(out('rate-'+rate));
 const write=sink.frame;sink.frame=async frame=>{writes++;await write(frame);};
 await renderSequence({adapter:f.adapter,sink,request:{startSeconds:0,endSeconds:.1,fps:30}});
 const r=await readSequence(out('rate-'+rate));
 assert.equal(r.status,'complete');assert.equal(r.frames.length,4);assert.equal(writes,4);
 assert.deepEqual(r.frames.map(x=>x.step),[0,8,16,24]);assert.equal((await f.read()).clock.paused,true);assert.equal(f.peak(),1);
}
{
 const f=fixture(),sink=await createDirectorySequenceSink(out('quantized'));
 await renderSequence({adapter:f.adapter,sink,request:{startSeconds:0,endSeconds:.12,fps:25}});
 const r=await readSequence(out('quantized'));assert.deepEqual(r.frames.map(x=>x.step),[0,10,19,29]);
 assert.deepEqual(r.frames.map(x=>x.targetSeconds),[0,.04,.08,.12]);
 assert.deepEqual(r.frames.map(x=>x.timeSeconds),[0,10/240,19/240,29/240]);
}
for(const [name,opts,error]of [['drift',{drift:true},/changed/],['blank',{missing:true},/PNG|empty|uniform/],['failure',{failAt:8},/capture broke/]]){
 const f=fixture(opts),sink=await createDirectorySequenceSink(out(name));
 await assert.rejects(renderSequence({adapter:f.adapter,sink,request:{startSeconds:0,endSeconds:.1,fps:30}}),error);
 const r=await readSequence(out(name),{verify:false});assert.equal(r.status,'failed');assert.equal(r.complete,false);assert.ok(r.failurePhase);
 if(name==='failure'){assert.equal(r.completedFrames,1);assert.equal(r.lastTrustworthyFrame,0);assert.equal(r.frames.length,1);}
}
{
 const f=fixture(),sink=await createDirectorySequenceSink(out('early'));
 await assert.rejects(renderSequence({adapter:f.adapter,sink,request:{fps:0,startSeconds:0,endSeconds:1}}),/fps/);
 const r=await readSequence(out('early'),{verify:false});assert.equal(r.status,'failed');assert.equal(r.failurePhase,'validate');assert.equal(r.completedFrames,0);
}
{
 const f=fixture(),sink=await createDirectorySequenceSink(out('cancelled')),abort=new AbortController();
 const frame=sink.frame;sink.frame=async value=>{await frame(value);abort.abort();};
 await renderSequence({adapter:f.adapter,sink,signal:abort.signal,request:{startSeconds:0,endSeconds:.1,fps:30}});
 const r=await readSequence(out('cancelled'));assert.equal(r.status,'cancelled');assert.equal(r.completedFrames,1);assert.equal(r.complete,false);
}
{
 const f=fixture(),sink=await createDirectorySequenceSink(out('corrupt'));
 await renderSequence({adapter:f.adapter,sink,request:{startSeconds:0,endSeconds:0,fps:30}});
 await fs.writeFile(path.join(out('corrupt'),'frame-00000000.png'),png.subarray(0,10));
 await assert.rejects(readSequence(out('corrupt')),/checksum|size/);
 await assert.rejects(createDirectorySequenceSink(out('corrupt')),/exist/);
}
console.log('Fixed-step cadence, streaming, drift/blank/failure/cancel retention and corrupt-output rejection pass:',base);
