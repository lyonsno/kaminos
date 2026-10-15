// kaminos-test: node
import assert from 'node:assert/strict';
import {installCaptureProfiler,validateCaptureProfile} from '../scratch/beaming-capture-profiler.mjs';
// The live Three compute path calls beginComputePass() without a descriptor.
let received;
const device={features:new Set(['timestamp-query']),queue:{submit(){}},createQuerySet(){return {};},createCommandEncoder(){return {beginComputePass(spec){received=spec;return {};},beginRenderPass(){},finish(){return {};}};}};
installCaptureProfiler(device);
globalThis.__captureProfile.active={timestamps:true};
assert.doesNotThrow(()=>device.createCommandEncoder().beginComputePass());
assert.equal(received.timestampWrites.beginningOfPassWriteIndex,0);
delete globalThis.__captureProfile;
const frame={current:true,points:4,quality:{resolution:36,blockerSamples:4,filterSamples:2},timestamps:true,cpu:Array.from({length:4},()=>({scope:'shadow'})),gpu:[...Array.from({length:24},()=>({scope:'cube',kind:'beginRenderPass',ms:1})),{scope:'other',kind:'beginRenderPass',ms:1}]};
const row={backend:'WebGPU:apple',errors:[],points:4,requestedFrames:1,frames:[frame]};
validateCaptureProfile(row);
for(const mutate of [r=>r.backend='fallback',r=>r.errors.push('device lost'),r=>r.frames.pop(),r=>r.frames[0].current=false,r=>r.frames[0].quality.resolution=256,r=>r.frames[0].cpu.pop(),r=>r.frames[0].gpu.shift(),r=>r.frames[0].gpu.at(-1).ms=NaN,r=>r.frames[0].gpu.pop()]){const bad=structuredClone(row);mutate(bad);assert.throws(()=>validateCaptureProfile(bad));}
console.log('capture profile rejects fallback, stale, partial, wrong configuration and missing GPU evidence');
