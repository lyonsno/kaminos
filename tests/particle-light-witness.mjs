// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validateCarrierCapture} from '../tools/particle-light-witness.mjs';
const raw=Buffer.from(new Float32Array([0,0,0,1,0,0,0,0,1,2,3,1,0,0,0,0,.1,0,0,.1,1,1,.2,1]).buffer),sha=createHash('sha256').update(raw).digest('hex');
const capture={status:'passed',expectedCommit:'abc'},metadata={available:true,records:{bytes:96,sha256:sha},effective:{effective:'world-optical-particles',slots:1,recordFloats:24,settings:{materialStateVersion:1}},frame:{ok:true},state:{simStepCount:4}};
test('recorded route, exact complete population, digest and current composition are required',()=>{
 assert.equal(validateCarrierCapture(raw,metadata,capture,'abc').slots,1);
 for(const m of [{...metadata,available:false},{...metadata,effective:{...metadata.effective,effective:'raymarch'}},{...metadata,effective:{...metadata.effective,slots:2}},{...metadata,records:{...metadata.records,sha256:'wrong'}},{...metadata,frame:{ok:false}},{...metadata,effective:{...metadata.effective,settings:{materialStateVersion:0}}}])assert.throws(()=>validateCarrierCapture(raw,m,capture,'abc'));
 assert.throws(()=>validateCarrierCapture(raw,metadata,capture,'other'));
 assert.throws(()=>validateCarrierCapture(raw,metadata,{...capture,status:'failed'},'abc'));
 for(const mutate of [a=>a.fill(0),a=>a[8]=NaN]){const a=new Float32Array(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength));mutate(a);const b=Buffer.from(a.buffer),m={...metadata,records:{bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')}};assert.throws(()=>validateCarrierCapture(b,m,capture,'abc'));}
});
