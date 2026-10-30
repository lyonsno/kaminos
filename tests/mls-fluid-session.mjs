// kaminos-test: node
import assert from 'node:assert/strict';
import {openLiveFluidSession} from '../owner-live-fluid-session.mjs';

let mounted=null,legacyCalls=0,mlsCalls=0;
const candidate=route=>({state:()=>({route}),setLiveInletPacket:p=>p,setPaused:p=>p,dispose(){}});
const host={getHost:()=>mounted,setHost:h=>mounted=h,getGeneration:()=>1,
  createHost:async()=>{legacyCalls++;return candidate('legacy');},
  createMlsHost:async()=>{mlsCalls++;return candidate('mls-mpm');}};
const session=await openLiveFluidSession(host,{backend:'mls-mpm',setup:{particleCount:32},packet:{}});
assert.equal(session.read().route,'mls-mpm','requested MLS route must not silently open incumbent water');
assert.equal(legacyCalls,0);
assert.equal(mlsCalls,1);
session.dispose();
assert.equal(mounted,null);
await assert.rejects(openLiveFluidSession(host,{backend:'unknown',setup:{},packet:{}}),/Unsupported fluid backend/);
const original=await openLiveFluidSession(host,{setup:{},packet:{}});
assert.equal(original.read().route,'legacy','existing callers retain their fluid backend');
original.dispose();
await assert.rejects(openLiveFluidSession({...host,createMlsHost:undefined},{backend:'mls-mpm',setup:{},packet:{}}),/MLS fluid backend unavailable/);
assert.equal(mounted,null);
console.log('MLS route identity and lifecycle OK');
