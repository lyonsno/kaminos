// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import {createAppGpuHost} from '../app-gpu-host.mjs';
import {createWebGpuForegroundService} from '../webgpu-inference-kit/src/core.js';

function fixture(){
 const submissions=[],device={queue:{submit:b=>submissions.push(b),onSubmittedWorkDone:async()=>{}}},adapter={info:{description:'test-adapter'}};
 const sessions=[];const kit={createWebGpuForegroundService,createWebGpuInferenceSession:async options=>{sessions.push(options);return {device:options.device,queue:options.device.queue,close:async()=>{}};}};
 const installs=[];const owner={setForegroundOpportunityRequester:r=>installs.push(r),foregroundGpuContext:()=>({renderer:'kaminos-app',productFrameOwner:'app',device,queue:device.queue})};
 const host={device,setForegroundServiceActive(){},runForegroundFrame:run=>run()};
 return {device,adapter,kit,sessions,installs,owner,host,submissions};
}

test('one borrowed session and one app foreground service for the page',async()=>{
 const f=fixture();const app=createAppGpuHost({sharedGpu:{adapter:f.adapter,device:f.device,queue:f.device.queue},host:f.host,kit:f.kit,frameOwner:()=>f.owner});
 const a=await app.session(),b=await app.session();
 assert.equal(a,b,'the session is created once');assert.equal(f.sessions.length,1);
 assert.equal(f.sessions[0].deviceOwnership,'borrowed');assert.equal(f.sessions[0].device,f.device);
 assert.equal(app.device,f.device);assert.equal(app.queue,f.device.queue);
});

test('a model run is identified by its route and frames go through the one service',async()=>{
 const f=fixture();const app=createAppGpuHost({sharedGpu:{adapter:f.adapter,device:f.device,queue:f.device.queue},host:f.host,kit:f.kit,frameOwner:()=>f.owner});
 const run=await app.beginRun('klein:1',{routeId:'flux2-klein'});
 assert.equal(run.routeId,'flux2-klein');assert.equal(typeof run.withForeground,'function');
 assert.equal(f.installs.length,1,'the frame owner gets the app requester');
 await assert.rejects(app.beginRun('sam:1',{routeId:'sam3'}),/already has an active run/,'one model run at a time');
 await run.finish();
 const next=await app.beginRun('sam:1',{routeId:'sam3'});assert.equal(next.routeId,'sam3');await next.finish();
 assert.equal(f.installs.length,1,'the requester is installed once, not per run');
});

test('without a shared device there is no app host',()=>{
 const f=fixture();
 assert.throws(()=>createAppGpuHost({sharedGpu:null,host:f.host,kit:f.kit,frameOwner:()=>f.owner}),/shared GPU device/);
});
