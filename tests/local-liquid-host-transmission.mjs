// kaminos-test: node
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
// Execute the production shader's final transmission selection. Current main supplies a camera depth/radiance
// query for the host as well as the standalone world query. Valid exits use
// that result; absent exits retain the bound scene image.
const source=readFileSync(new URL('../finger-fluid-webgpu-core.js',import.meta.url),'utf8');
const start=source.indexOf('  let refractedRadiance = mix('),end=source.indexOf('\n  );',start)+5;
assert.ok(start>0&&end>start);
const selection=source.slice(start,end).replace('let refractedRadiance','const refractedRadiance')+'\nrefractedRadiance;';
const scene=[.8,.05,.02],query=[.02,.12,.8],robust=[.04,.2,.6];
function evaluate(host,validity,body){return Array.from(runInNewContext(selection,{
 refractedScene:{rgb:scene},transmissionQuadratureRadiance:query,robustBodyRadiance:robust,
 bodyTransportMode:body,queryValidity:validity,params:{hostFrameControls:{x:host?1:0}},
 select:(a,b,c)=>c?b:a,mix:(a,b,w)=>a.map((v,i)=>v*(1-w)+b[i]*w),
}));}
for(const host of [true,false])for(const body of [0,1]){
 assert.deepEqual(evaluate(host,0,body),scene,'missing exit retains actual scene fallback');
 assert.deepEqual(evaluate(host,1,body),body?robust:query,'valid exit selects the available optical query');
 const half=evaluate(host,.5,body),target=body?robust:query;
 half.forEach((v,i)=>assert.ok(Math.abs(v-(scene[i]+target[i])*.5)<1e-12));
}
console.log('host camera-depth radiance and standalone world queries retain exit-validity selection');
