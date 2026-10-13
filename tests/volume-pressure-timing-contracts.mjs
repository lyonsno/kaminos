// node:test
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
const url=new URL('./helpers/volume-pressure-timing.mjs',import.meta.url);
test('single-pass pressure timing cannot silently use wall time or an empty query',async()=>{
  assert.ok(existsSync(url),'missing explicit GPU timing scope');
  const {pressureTimestampScope,decodePressureTimestamps}=await import(url);
  assert.throws(()=>pressureTimestampScope({features:new Set()},{}),/timestamp-query/);
  assert.throws(()=>decodePressureTimestamps(new BigUint64Array([0n,0n])),/positive/);
  assert.throws(()=>decodePressureTimestamps(new BigUint64Array([10n,5n])),/positive/);
  assert.throws(()=>decodePressureTimestamps(new BigUint64Array([10n])),/two/);
  assert.deepEqual(decodePressureTimestamps(new BigUint64Array([1000n,2501000n])),{gpuMs:2.5,timestampNs:['1000','2501000']});
  globalThis.GPUBufferUsage={QUERY_RESOLVE:1,COPY_SRC:2,COPY_DST:4,MAP_READ:8};
  const descriptors=[],buffers=[],query={destroy(){}};
  const device={features:new Set(['timestamp-query']),createQuerySet:()=>query,createBuffer:()=>{const b={destroy(){}};buffers.push(b);return b;}};
  const encoder={beginComputePass(d){descriptors.push(d);return {dispatchWorkgroups(){},end(){}};},clearBuffer(){},resolveQuerySet(){},copyBufferToBuffer(){}};
  const absent=pressureTimestampScope(device,encoder);assert.throws(()=>absent.resolve(),/exactly one/);absent.destroy();
  const scope=pressureTimestampScope(device,encoder);
  const pass=scope.encoder.beginComputePass({label:'actual pressure'});pass.dispatchWorkgroups(7);pass.end();scope.resolve();
  assert.equal(scope.dispatches,1);assert.equal(descriptors[0].timestampWrites.querySet,query);
  assert.equal(descriptors[0].timestampWrites.beginningOfPassWriteIndex,0);assert.equal(descriptors[0].timestampWrites.endOfPassWriteIndex,1);
  assert.throws(()=>scope.encoder.beginComputePass({}),/exactly one/);scope.destroy();
});
