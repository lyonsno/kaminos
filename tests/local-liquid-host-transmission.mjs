// kaminos-test: node
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
// Execute the production shader's final transmission selection. The shared
// host supplies the actual scene image; its disabled private scene query can
// only return an environment sample and must not replace that image.
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
for(const validity of [0,.5,1])for(const body of [0,1])assert.deepEqual(evaluate(true,validity,body),scene,'host bowl color must survive valid water exit without a scene-ray query');
for(const body of [0,1]){
 assert.deepEqual(evaluate(false,0,body),scene,'standalone missing exit retains scene fallback');
 assert.deepEqual(evaluate(false,1,body),body?robust:query,'standalone world query remains authoritative when available');
}
console.log('host scene transmission survives disabled private world query');
