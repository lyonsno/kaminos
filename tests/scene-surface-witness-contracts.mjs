import assert from 'node:assert/strict';
import {assertSurfaceView,floatEvidenceBytes} from '../scratch/beaming-surface-evidence.mjs';
const row=(count,passes,surface,back=surface,smoke=[1,2,3,1])=>({
  lighting:{previewStale:false,geometryBuilds:1,frame:{directions:count,angularPattern:'spatial',generation:7,surfaceReceivers:1,surfaceReconstruction:{passes,history:false,directedEdges:6}}},
  volume:{error:null},source:{generation:7,values:[1,2,3,4]},surface,back,smoke});
const raw16=row(16,0,[1,2,3,1]),raw12=row(12,0,[4,5,6,1]);
const disconnected=row(12,8,raw12.surface);
assert.throws(()=>assertSurfaceView(disconnected,{baseline:raw12,raw16,count:12,pattern:'spatial',passes:8}),/front reconstruction unchanged/,'enabled-but-disconnected12 must fail against raw12');
const options={baseline:raw12,count:12,pattern:'spatial',passes:8};
const good=row(12,8,[3,4,5,1],[6,7,8,1]);assertSurfaceView(good,options);
assert.throws(()=>assertSurfaceView({...good,back:raw12.back},options),/back reconstruction unchanged/);
assert.throws(()=>assertSurfaceView({...good,smoke:[0,0,0,1]},options),/changed smoke/);
assert.throws(()=>assertSurfaceView(good,{...options,baseline:raw16}),/baseline angular count mismatch/);
assert.throws(()=>assertSurfaceView({...good,surface:[]},options),/nonempty finite/);
assert.throws(()=>assertSurfaceView({...good,source:{...good.source,generation:6}},options));
assertSurfaceView(raw12,{...options,passes:0});
const bytes=floatEvidenceBytes([-0,0,Math.fround(.1)]);
assert.ok(Object.is(new Float32Array(bytes.buffer,bytes.byteOffset,3)[0],-0),'binary retains signed zero lost by JSON');
assert.notDeepEqual(bytes,floatEvidenceBytes(JSON.parse(JSON.stringify([-0,0,Math.fround(.1)]))));
assert.throws(()=>floatEvidenceBytes([null]),/nonempty finite/);
console.log('surface witness rejects disconnected12');
