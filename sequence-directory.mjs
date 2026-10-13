import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {decodeScreenshotPngRgb} from './screenshot-png-rgb.mjs';
import {sequenceSchedule} from './simulation-sequence.mjs';
import {assertCapturePixels} from './capture-pixels.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>JSON.stringify(value,null,2);
export async function createDirectorySequenceSink(out){
 out=path.resolve(out);await fs.mkdir(out,{recursive:true});
 // Reserve the canonical output identity. Existing exports are never overwritten.
 const handle=await fs.open(path.join(out,'sequence.json'),'wx');await handle.close();
 let manifest={schema:'kaminos.simulation-sequence.v1',status:'preparing',complete:false,completedFrames:0,lastTrustworthyFrame:null,startedAt:new Date().toISOString(),framesFile:'frames.jsonl'};
 const write=async()=>{await fs.writeFile(path.join(out,'sequence.json.next'),json(manifest));await fs.rename(path.join(out,'sequence.json.next'),path.join(out,'sequence.json'));};
 await write();await fs.writeFile(path.join(out,'frames.jsonl'),'',{flag:'wx'});
 let dimensions=null,bytesWritten=0;
 return {
  async begin(meta){manifest={...manifest,...meta,status:'running',phase:meta.phase??'begin'};await write();},
  async initial(meta){await fs.writeFile(path.join(out,'initial.json'),json(meta),{flag:'wx'});manifest={...manifest,initialFile:'initial.json',initialSha256:sha(await fs.readFile(path.join(out,'initial.json'))),requestedFrames:meta.schedule.count};await write();},
  async frame({image,...frame}){
   const bytes=Buffer.from(image),file=`frame-${String(frame.index).padStart(8,'0')}.png`;
   assert.ok(Number.isSafeInteger(frame.index)&&frame.index>=0,'Invalid sequence frame index');
   await fs.writeFile(path.join(out,file),bytes,{flag:'wx'});
   const entry={...frame,file,bytes:bytes.length,sha256:sha(bytes),status:'unverified'};
   try{
    const decoded=decodeScreenshotPngRgb(bytes),actual={width:decoded.width,height:decoded.height};
    assertCapturePixels(decoded,actual);
    if(dimensions)assert.deepEqual(actual,dimensions,'Export dimensions changed during sequence');else dimensions=actual;
    Object.assign(entry,actual,{status:'verified'});
   }catch(error){entry.failure=String(error);await fs.appendFile(path.join(out,'frames.jsonl'),JSON.stringify(entry)+'\n');throw error;}
   await fs.appendFile(path.join(out,'frames.jsonl'),JSON.stringify(entry)+'\n');
   bytesWritten+=bytes.length;
   manifest={...manifest,status:'running',phase:'frame-written',completedFrames:frame.index+1,lastTrustworthyFrame:frame.index,dimensions,bytesWritten};await write();
  },
  async finish(result){manifest={...manifest,...result,finishedAt:new Date().toISOString()};await write();},
 };
}
export async function readSequence(out,{verify=true}={}){
 out=path.resolve(out);
 const manifest=JSON.parse(await fs.readFile(path.join(out,'sequence.json'),'utf8'));
 assert.equal(manifest.schema,'kaminos.simulation-sequence.v1','Unsupported sequence schema');
 const lines=(await fs.readFile(path.join(out,'frames.jsonl'),'utf8')).trim();
 const frames=lines?lines.split('\n').map(line=>JSON.parse(line)):[];
 if(verify){
  assert.equal(manifest.framesFile,'frames.jsonl','Unexpected frame ledger');
  assert.equal(manifest.complete,manifest.status==='complete','Completion status conflicts');
  let initial,plan;
  if(manifest.initialFile){
   assert.equal(manifest.initialFile,'initial.json','Unexpected initial record');
   const b=await fs.readFile(path.join(out,'initial.json'));assert.equal(sha(b),manifest.initialSha256,'Initial state checksum differs');initial=JSON.parse(b);
   plan=sequenceSchedule(initial.schedule,initial.initial.clock.dt);
   assert.equal(initial.schedule.dt,plan.dt,'Initial schedule timestep differs');
   assert.equal(initial.schedule.count,plan.count,'Initial schedule count differs');
   assert.equal(initial.schedule.sampling,'nearest-fixed-step','Unsupported sampling semantics');
   assert.ok(typeof initial.initial.clock.runId==='string'&&initial.initial.clock.runId,'Initial run missing');
   assert.equal(plan.count,manifest.requestedFrames,'Requested schedule count differs');
   for(const key of ['startSeconds','endSeconds','fps'])assert.equal(plan[key],manifest.request[key],'Requested schedule differs');
  }else assert.ok(manifest.status!=='complete'&&frames.length===0,'Initial schedule missing');
  const expected=plan?.frames();let verified=0,index=0;

  for(const frame of frames){
   assert.equal(frame.index,index++,'Frame index is missing, duplicated or out of order');
   const sample=expected.next();assert.equal(sample.done,false,'Frame exceeds schedule');
   assert.equal(frame.runId,initial.initial.clock.runId,'Frame run differs');
   for(const key of ['targetSeconds','step','timeSeconds'])assert.equal(frame[key],sample.value[key],'Frame '+key+' differs from schedule');
   assert.equal(frame.file,`frame-${String(frame.index).padStart(8,'0')}.png`,'Invalid sequence file reference');
   const bytes=await fs.readFile(path.join(out,frame.file));
   assert.equal(bytes.length,frame.bytes,'Frame size differs');assert.equal(sha(bytes),frame.sha256,'Frame checksum differs');
   if(frame.status==='verified')verified++;
  }
  assert.equal(manifest.lastTrustworthyFrame,verified?verified-1:null,'Last trustworthy frame differs');
  assert.equal(verified,manifest.completedFrames,'Frame ledger differs from completed count');
  if(manifest.status==='complete'){assert.equal(manifest.complete,true);assert.equal(verified,manifest.requestedFrames,'Sequence is partial');}
 }
 return {...manifest,frames};
}
