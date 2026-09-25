import assert from 'node:assert/strict';
import * as hostApi from '../sf3d-host-device.mjs';
assert.equal(typeof hostApi.connectSf3dForeground, 'function');
const device = {queue:{}};
let requester, active = false;
const events = [];
const prototype = {
  foregroundGpuContext: () => ({device,queue:device.queue,renderer:'ordinary-volume',productFrameOwner:'prototype'}),
  setForegroundOpportunityRequester: fn => {requester=fn;},
};
const host = {device, setForegroundServiceActive: value=>{active=value;}, runForegroundFrame: run=>{events.push('scene');return run();}};
const producer = {device, requestForegroundOpportunity: request=>({completion:Promise.resolve().then(()=>request.run({device,queue:device.queue})).then(result=>({status:'completed',result}))})};
hostApi.connectSf3dForeground(producer, prototype, host);
assert.equal(active,true);
const receipt = await requester({requestId:'f1',run:service=>{assert.equal(service.device,device);events.push('volume');return {status:'submitted'};}}).completion;
assert.equal(receipt.status,'completed');
assert.deepEqual(events,['scene','volume']);
assert.throws(()=>hostApi.connectSf3dForeground(producer, prototype, {...host,device:{}}), /device/);
assert.throws(()=>hostApi.connectSf3dForeground(producer, {...prototype,foregroundGpuContext:()=>({device,queue:device.queue,renderer:'smoke-raymarch-under-splats'})}, host), /ordinary/);
console.log('SF3D host foreground identity and ordering contracts passed');
