// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
const module=await import('../scene-worker-mesh-controller.mjs').catch(error=>{if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;return {};});
function fixture(){
 assert.equal(typeof module.createSceneWorkerMeshController,'function','worker mesh status, progress and Stop need a page presentation adapter');
 let resolve,reject,progress,canceled=0,failRead=false;
 const completion=new Promise((a,b)=>{resolve=a;reject=b;}),calls=[];
 const state={status:'idle',pending:null,results:[],canStop:false};
 const page={request(operation,input,options){calls.push({operation,input});if(operation==='mesh.read')return {completion:failRead?Promise.reject(Error('status unavailable')):Promise.resolve({output:{model:'trellis-page',preparesInput:true,state}})};progress=options.onProgress;return {completion,cancel(){canceled++;return true;}};}};
 return {controller:module.createSceneWorkerMeshController({page}),resolve,reject,state,calls,progress:value=>progress({value}),failRead:()=>failRead=true,canceled:()=>canceled};
}
test('saved worker mesh remains usable when the subsequent status read fails',async()=>{
 const f=fixture(),run=f.controller.run({source:'/api/read?root=image-inbox&path=source.png'});f.failRead();
 const entry={kind:'mesh',name:'saved.glb',source:'/api/read?root=generated-meshes&path=saved.glb',generation:{runId:'mesh-1'}};
 f.resolve({output:{entry,runId:'mesh-1',origin:{requestId:'generate-1',epoch:{scene:0}}}});assert.deepEqual(await run,entry);
 assert.equal(f.controller.read().status,'complete');assert.equal(f.controller.read().results[0].source,entry.source);assert.equal(f.controller.read().statusError,'status unavailable');assert.equal(f.controller.busy(),false);
});
test('Stop retains the pending command until it settles and sends no unrelated control',async()=>{
 const f=fixture(),run=f.controller.run({source:'/source.png'});
 f.progress({status:'running',canStop:true,inputPreview:{input:'/source.png',source:'/cutout.png'}});assert.equal(f.controller.read().inputPreview.input,'/source.png');
 assert.equal(f.controller.stop(),true);assert.equal(f.canceled(),1);assert.equal(f.controller.busy(),true);assert.equal(f.controller.read().status,'stopping');
 const error=Object.assign(Error('stopped after settlement'),{name:'AbortError'});f.reject(error);await assert.rejects(run,error);assert.equal(f.controller.read().status,'stopped');assert.equal(f.controller.busy(),false);
});
test('persistence failure retains retry state and retry addresses mesh.retrySave without inference replay',async()=>{
 const f=fixture(),run=f.controller.retryPersistence();f.progress({status:'failed',pending:{label:'retained'},error:'disk unavailable',canStop:false});
 f.reject(Error('disk unavailable'));await assert.rejects(run,/disk unavailable/);assert.equal(f.controller.read().pending.label,'retained');assert.equal(f.controller.stop(),false);assert.equal(f.calls[0].operation,'mesh.retrySave');
});
