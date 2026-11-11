// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {createSceneWorkerImageController} from '../scene-worker-image-controller.mjs';
const gate=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function fixture(){
 const done=gate(),calls=[];let progress,failRead=false,canceled=0;
 const entry={source:'/assets/result.png',name:'result.png'},state={status:'complete',outputs:[{id:'run-1',status:'complete',entry,preview:{width:8,height:8,kind:'final'}}],preview:{width:8,height:8,kind:'final'},canStop:false,canDecode:false};
 const page={request(operation,payload,options){calls.push({operation,payload});if(operation==='image.read')return {completion:failRead?Promise.reject(Error('status unavailable')):Promise.resolve({output:{state}})};
  progress=options.onProgress;return {completion:done.promise,cancel:()=>{canceled++;return true;},control:action=>{calls.push({action});return {completion:Promise.resolve({output:{accepted:true}})};}};}};
 const controller=createSceneWorkerImageController({page});return {controller,done,calls,entry,state,progress:value=>progress({value}),failRead:()=>failRead=true,canceled:()=>canceled};
}
test('persisted image success survives a later status-read failure',async()=>{
 const f=fixture(),run=f.controller.run({prompt:'a basin'});f.failRead();
 f.done.resolve({output:{entry:f.entry,runId:'run-1',origin:{requestId:'generate-1',epoch:{scene:0}}}});
 assert.deepEqual(await run,f.entry);assert.equal(f.controller.busy(),false);
 assert.equal(f.controller.read().status,'complete');assert.equal(f.controller.read().statusError,'status unavailable');
 assert.equal(f.controller.read().outputs[0].entry.source,f.entry.source);
});
test('metadata-only final preview never masquerades as actual pixel data',async()=>{
 const f=fixture();await f.controller.refresh();const state=f.controller.read();
 assert.equal(state.preview,null);assert.deepEqual(state.previewMetadata,{width:8,height:8,kind:'final'});
 assert.equal(state.outputs[0].preview,null);assert.equal(state.outputs[0].previewMetadata.width,8);
 assert.equal(state.outputs[0].entry.source,f.entry.source);
});
test('Stop and Decode now target the actual active worker operation, and saving disables Stop',async()=>{
 const f=fixture(),run=f.controller.run({prompt:'basin'});
 f.progress({status:'generating',outputId:'run-1',canStop:true,canDecode:true,preview:{rgba:new Uint8ClampedArray(4),width:1,height:1,kind:'partial'}});
 assert.equal(await f.controller.decodeNow(),true);assert.equal(f.controller.read().preview.rgba.length,4);
 f.progress({status:'saving',outputId:'run-1',canStop:false,canDecode:false});assert.equal(f.controller.stop(),false);assert.equal(f.canceled(),0);
 f.progress({status:'generating',outputId:'run-1',canStop:true,canDecode:false});assert.equal(f.controller.stop(),true);assert.equal(f.canceled(),1);
 const error=Object.assign(Error('stopped after settlement'),{name:'AbortError'});f.done.reject(error);await assert.rejects(run,error);
 assert.equal(f.controller.read().status,'stopped');assert.equal(f.controller.busy(),false);
});
