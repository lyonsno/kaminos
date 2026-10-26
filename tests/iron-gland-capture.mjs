// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGestureCapture, gestureProtocol, packObservation } from '../experiments/iron-gland/capture.mjs';

const prediction = () => ({hasHand:true,handedness:'right',nativeVertices:new Float32Array(2334),nativeUV:new Float32Array(42),
  verticesMeters:new Float32Array(2334),cropUV:new Float32Array(42),cropBox:[0,0,128,128],
  captures:{'decoder3d.sampled':{shape:[21,256],data:new Float32Array(5376).fill(.25)}}});
const flush = () => new Promise(r=>setImmediate(r));
function fixture() {
  let time=100, failWrite=false;
  const files=new Map(),finishes=[],starts=[];
  class Recorder extends EventTarget {
    static isTypeSupported(type){return type==='video/webm;codecs=vp8';}
    state='inactive';mimeType='video/webm';
    start(){this.state='recording';}
    stop(){this.state='inactive';const e=new Event('dataavailable');e.data=new Blob(['real-video-fixture']);this.dispatchEvent(e);this.dispatchEvent(new Event('stop'));}
  }
  const fetch=async(url,options={})=>{
    const q=new URL(url,'http://local').searchParams,action=q.get('action');
    if(action==='start'){starts.push(JSON.parse(options.body));return {ok:true,json:async()=>({id:'unit',path:'/capture/unit'})};}
    if(action==='write'){
      if(failWrite){failWrite=false;return {ok:false,json:async()=>({error:'disk full'})};}
      files.set(q.get('name'),options.body);return {ok:true,json:async()=>({name:q.get('name')})};
    }
    if(action==='finish'){finishes.push(JSON.parse(options.body));return {ok:true,json:async()=>finishes.at(-1)};}
    throw Error(`unexpected ${url}`);
  };
  const capture=createGestureCapture({fetch,MediaRecorder:Recorder,now:()=>time,epoch:()=>12345});
  return {capture,files,finishes,starts,advance:ms=>{time+=ms;capture.tick();},failWrite:()=>{failWrite=true;},
    begin:(options={})=>capture.begin({stream:{getVideoTracks:()=>[{getSettings:()=>({width:640,height:480})}]},identity:{backend:'fixture'},faces:new Uint32Array([0,1,2]),source:{kind:'test-fixture'},...options}),
    canvas:{width:640,height:480,toBlob:fn=>fn(new Blob(['raw-png-fixture'],{type:'image/png'}))}};
}
test('protocol includes unlabeled exploration, re-entry, different pacing and partial reversals without exact targets',()=>{
  const cues=gestureProtocol('turns');
  assert.ok(cues.some(c=>c.intent==='unlabeled'));
  assert.ok(cues.some(c=>c.intent==='reacquire'));
  assert.ok(cues.some(c=>c.intent==='partial-reversal'));
  assert.ok(new Set(cues.filter(c=>c.intent==='move').map(c=>c.seconds)).size>1);
  assert.ok(cues.every(c=>!('target' in c)&&!('velocity' in c)));
});
test('neutral is the default: settling, neutral carry, and two re-entries without directional commands',()=>{
  const cues=gestureProtocol();
  assert.deepEqual(cues.map(c=>c.intent),['unlabeled','neutral','neutral-nuisance','release','reacquire','neutral','release','reacquire','neutral']);
  assert.equal(cues.reduce((seconds,c)=>seconds+c.seconds,0),60);
  assert.deepEqual(cues.map(c=>c.index),cues.map((_,i)=>i));
  assert.ok(cues.every(c=>!('direction' in c)&&!('target' in c)&&!('velocity' in c)));
  assert.throws(()=>gestureProtocol('unknown'),/capture mode/i);
});
test('selected capture mode and exact protocol survive begin, completion and a new take',async()=>{
  const f=fixture();await f.begin();
  assert.equal(f.starts[0].settings.captureMode,'neutral');
  assert.deepEqual(f.starts[0].protocol,gestureProtocol('neutral'));
  for(const cue of f.starts[0].protocol)f.advance(cue.seconds*1000);
  assert.equal(f.capture.read().protocolComplete,true);
  assert.equal(f.capture.read().status,'recording','end of instructions never discards additional observations');
  await f.capture.finish('complete');
  await f.begin({mode:'turns'});
  assert.equal(f.starts[1].settings.captureMode,'turns');
  assert.deepEqual(f.starts[1].protocol,gestureProtocol('turns'));
  assert.equal(f.capture.read().protocolComplete,false);
  await f.capture.finish('partial');
});
test('an unknown capture mode is rejected before any persistence starts',async()=>{
  const f=fixture();await assert.rejects(f.begin({mode:'typo'}),/capture mode/i);
  assert.equal(f.starts.length,0);assert.equal(f.capture.read().status,'idle');
});
test('packed observation carries exact named features and geometry, rejects absent/nonfinite data',()=>{
  const p=prediction(),packed=packObservation(p);
  const feature=packed.layout.find(x=>x.name==='decoder3d.sampled');
  assert.deepEqual(feature.shape,[21,256]);assert.equal(feature.length,5376);
  assert.equal(new Float32Array(packed.bytes)[feature.offset],.25);
  delete p.captures;assert.throws(()=>packObservation(p),/feature/i);
  const bad=prediction();bad.captures['decoder3d.sampled'].data[2]=NaN;
  assert.throws(()=>packObservation(bad),/finite/i);
  assert.deepEqual(packObservation({hasHand:false}).layout,[]);
});
test('finish drains exact input/feature writes and final video before reporting complete',async()=>{
  const f=fixture();await f.begin();let resolve;
  const observing=f.capture.observe({canvas:f.canvas,metadata:{mediaTime:2},infer:()=>new Promise(r=>{resolve=r;})});
  let done=false;const finishing=f.capture.finish('complete').then(()=>{done=true;});await flush();
  assert.equal(done,false);resolve(prediction());await observing;await finishing;
  assert.ok(f.files.has('frames/00000000.png'));assert.ok(f.files.has('frames/00000000.f32'));
  const frame=JSON.parse(f.files.get('frames/00000000.json'));
  assert.equal(frame.captureAtMs,100);assert.equal(frame.video.mediaTime,2);
  assert.ok(!('target' in frame.cue));assert.ok(f.files.has('video/00000000.webm'));
  assert.equal(f.finishes.at(-1).status,'complete');assert.equal(f.finishes.at(-1).frameCount,1);
  assert.equal(f.capture.read().status,'complete');assert.equal(f.starts[0].source.kind,'test-fixture');
});
test('cue transition time is observed, repeat retains events, missed ticks never invent completed motions',async()=>{
  const f=fixture();await f.begin();const initial=f.capture.read().cue.index;
  f.advance(100000);assert.equal(f.capture.read().cue.index,initial+1);
  f.capture.repeat();assert.equal(f.capture.read().cue.index,initial+1);
  await f.capture.finish('partial');
  const events=[...f.files].filter(([key])=>key.startsWith('events/')).map(([,x])=>JSON.parse(x));
  assert.ok(events.some(x=>x.kind==='repeat'));assert.ok(events.every(x=>Number.isFinite(x.atMs)));
});
test('inference failure keeps source pixels and failed observation; cannot finalize as complete',async()=>{
  const f=fixture();await f.begin();
  await assert.rejects(f.capture.observe({canvas:f.canvas,metadata:{},infer:async()=>{throw Error('device lost');}}),/device lost/);
  await f.capture.finish('complete');
  assert.ok(f.files.has('frames/00000000.png'));
  assert.match(JSON.parse(f.files.get('frames/00000000.json')).error,/device lost/);
  assert.equal(f.finishes.at(-1).status,'failed');
});
test('failed persistence cannot masquerade as a saved take and prior files remain',async()=>{
  const f=fixture();await f.begin();await f.capture.observe({canvas:f.canvas,metadata:{},infer:async()=>prediction()});
  await flush();f.failWrite();
  await f.capture.observe({canvas:f.canvas,metadata:{},infer:async()=>prediction()});
  await f.capture.finish('complete');
  assert.equal(f.capture.read().status,'failed');assert.match(f.capture.read().error,/disk full/);
  assert.ok(f.files.has('frames/00000000.png'));
});
