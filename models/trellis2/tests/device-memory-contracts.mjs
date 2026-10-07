import assert from 'node:assert/strict';
let api;try{api=await import('../device-memory.js');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
assert.equal(typeof api?.observeDeviceMemory,'function','owned WebGPU allocations need a live/high-water observer, not cumulative loaded bytes');
const device={createBuffer(d){return{size:d.size,destroy(){this.destroyCalls=(this.destroyCalls??0)+1;}};},destroy(){this.destroyed=true;}},
  original=device.createBuffer,tracker=api.observeDeviceMemory(device);
tracker.setPhase('weights');const a=device.createBuffer({size:256,label:'weight'}),alias=a,
  b=device.createBuffer({size:512,label:'scratch'});
assert.equal(tracker.snapshot().liveBytes,768);assert.equal(tracker.snapshot().peakLiveBytes,768);
assert.equal(tracker.snapshot().liveBufferCount,2,'aliasing an existing buffer is not a second allocation');
alias.destroy();assert.equal(tracker.snapshot().liveBytes,512);a.destroy();assert.equal(tracker.snapshot().liveBytes,512);
tracker.setPhase('next-role');const c=device.createBuffer({size:1024});
assert.equal(tracker.snapshot().peakLiveBytes,1536);assert.equal(tracker.snapshot().peakPhase,'next-role');
device.destroy();assert.equal(tracker.snapshot().liveBytes,0);assert.equal(tracker.snapshot().peakLiveBytes,1536);
assert.equal(tracker.snapshot().physicalMemoryMeasured,false);assert.equal(tracker.events.filter(e=>e.kind==='allocated').length,3);
tracker.restore();assert.strictEqual(device.createBuffer,original);
assert.throws(()=>api.observeDeviceMemory({}),/createBuffer/);
const failing={createBuffer(){throw Error('allocation refused');},destroy(){}},f=api.observeDeviceMemory(failing);
assert.throws(()=>failing.createBuffer({size:42}),/allocation refused/);assert.equal(f.snapshot().peakLiveBytes,0);f.restore();
const failedDestroy={createBuffer(d){return{size:d.size,destroy(){throw Error('destroy refused');}};},destroy(){}},q=api.observeDeviceMemory(failedDestroy);
assert.throws(()=>failedDestroy.createBuffer({size:128}).destroy(),/destroy refused/);assert.equal(q.snapshot().liveBytes,128);q.restore();
console.log('Live/peak bytes follow real buffer lifetime once per allocation; failures and aliasing cannot invent measured physical memory.');
