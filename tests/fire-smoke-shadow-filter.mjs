// kaminos-test: node
import assert from 'node:assert/strict';
import * as smoke from '../fire-smoke-shadow.mjs';
assert.equal(typeof smoke.filterSmokeDirectionReference,'function','direction filter needs a transmission-preserving reference');
const filter=smoke.filterSmokeDirectionReference;
for(let face=0;face<6;face++)for(const [x,y] of [[0,0],[7,7],[0,4],[4,0],[4,4]]){
  const taps=[];
  const result=filter({face,x,y,resolution:8,read:(f,a,b)=>{taps.push([f,a,b]);return 2;}});
  assert(Math.abs(result-2)<1e-12,'constant optical depth preserved including cube edges');
  assert.equal(taps.length,9);
  assert(taps.every(([f,a,b])=>f>=0&&f<6&&a>=0&&a<8&&b>=0&&b<8));
  if(x===0||y===0)assert(taps.some(([f])=>f!==face),'neighborhood crosses cube face, not atlas/light boundary');
}
assert.equal(filter({face:0,x:4,y:4,resolution:8,read:()=>0}),0,'empty smoke remains transparent');
const tau=filter({face:0,x:4,y:4,resolution:8,read:(f,x,y)=>x===4&&y===4?100:0});
assert(Math.abs(Math.exp(-tau)-.75)<1e-12,'average transmission, not average optical depth');
const low=filter({face:0,x:4,y:4,resolution:8,read:()=>1e-6});
assert(Math.abs(low-1e-6)<1e-12,'thin smoke has no cutoff');
const opaque=filter({face:0,x:4,y:4,resolution:8,read:()=>65504});
assert(Number.isFinite(opaque)&&opaque>80,'opaque endpoints stay finite and opaque');
console.log('PASS directional transmission, empty/thin/opaque identity and cube-neighbor contract');
