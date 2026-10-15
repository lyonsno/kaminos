// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import {createAppFrameSource} from '../app-frame-source.mjs';
import {connectSf3dForeground} from '../sf3d-host-device.mjs';
const device={queue:{submit(){}}};
const manualRaf=()=>{const q=[];return {raf:f=>q.push(f),step(){const f=q.shift();f?.(performance.now());return !!f;},pending:()=>q.length};};

test('an ordinary scene is a frame owner the models can borrow, with its own identity',()=>{
 const r=manualRaf(),source=createAppFrameSource({device,queue:device.queue,requestAnimationFrame:r.raf});
 const context=source.foregroundGpuContext();
 assert.deepEqual({renderer:context.renderer,productFrameOwner:context.productFrameOwner},{renderer:'kaminos-app',productFrameOwner:'app'});
 assert.equal(context.device,device);assert.equal(context.queue,device.queue);
 assert.equal(r.pending(),0,'no frames are requested until a model installs a requester');
});

test('while a model holds the requester, every animation frame goes through it, one at a time',async()=>{
 const r=manualRaf(),source=createAppFrameSource({device,queue:device.queue,requestAnimationFrame:r.raf});
 const requests=[];let release;
 source.setForegroundOpportunityRequester(request=>{requests.push(request);const completion=new Promise(res=>{release=res;});return {requestId:request.requestId,completion};});
 r.step();assert.equal(requests.length,1);
 r.step();assert.equal(requests.length,1,'no second frame while the first is pending');
 const out=requests[0].run({device,queue:device.queue,submit(){}});assert.equal(out.status,'submitted');
 release({status:'completed'});await new Promise(res=>setTimeout(res,0));
 assert.equal(r.pending(),1,'the next frame is scheduled after the receipt');r.step();assert.equal(requests.length,2);
 assert.equal(source.debugState().completedFrames,1);
});

test('swapping or clearing the requester mid-frame is refused like the volume prototype does',async()=>{
 const r=manualRaf(),source=createAppFrameSource({device,queue:device.queue,requestAnimationFrame:r.raf});
 let release;source.setForegroundOpportunityRequester(request=>({requestId:request.requestId,completion:new Promise(res=>{release=res;})}));r.step();
 assert.throws(()=>source.setForegroundOpportunityRequester(null),/still pending/);
 release({status:'completed'});await new Promise(res=>setTimeout(res,0));
 source.setForegroundOpportunityRequester(null);assert.equal(r.step(),true);assert.equal(r.pending(),0,'no frames once released');
});

test('a frame from the wrong device is rejected',()=>{
 const r=manualRaf(),source=createAppFrameSource({device,queue:device.queue,requestAnimationFrame:r.raf});let request;
 source.setForegroundOpportunityRequester(req=>{request=req;return {completion:new Promise(()=>{})};});r.step();
 assert.throws(()=>request.run({device:{},queue:{},submit(){}}),/device/);
});

test('SF3D connects to the app frame owner as well as to the volume prototype',()=>{
 const r=manualRaf(),source=createAppFrameSource({device,queue:device.queue,requestAnimationFrame:r.raf});
 const producer={device,requestForegroundOpportunity:req=>({completion:Promise.resolve({status:'completed'})})};
 let active=false;const host={device,setForegroundServiceActive:v=>{active=v;},runForegroundFrame:run=>run()};
 connectSf3dForeground(producer,source,host);assert.equal(active,true);
 assert.throws(()=>connectSf3dForeground(producer,{foregroundGpuContext:()=>({renderer:'other',productFrameOwner:'x',device,queue:device.queue}),setForegroundOpportunityRequester(){}},host),/renderer/);
});
