// kaminos-test: node
import assert from 'node:assert/strict';
import {smokeSupportWeight} from '../scene-smoke-reconstruction.mjs';
// Positive compact tents: a donor cannot influence a point outside its certified
// clear box. At its boundary the contribution approaches zero continuously.
for(const radius of [.1,.5,1]){
 assert.equal(smokeSupportWeight([radius+.000001,0,0],radius),0);
 assert(smokeSupportWeight([radius-.000001,0,0],radius)<.00002);
 assert.equal(smokeSupportWeight([0,0,0],radius),1);
}
assert.equal(smokeSupportWeight([0,0,0],0),0);
// Unobstructed lookup remains ordinary trilinear interpolation, including
// constant preservation and an affine field. No extra spatial blur in free air.
for(const p of [[.1,.2,.3],[.5,.5,.5],[.99,.01,.7]]){
 let weight=0,value=0;
 for(let z=0;z<2;z++)for(let y=0;y<2;y++)for(let x=0;x<2;x++){
  const w=smokeSupportWeight([p[0]-x,p[1]-y,p[2]-z],1);weight+=w;value+=w*(1+x+2*y+3*z);
 }
 assert(Math.abs(weight-1)<1e-12);assert(Math.abs(value-(1+p[0]+2*p[1]+3*p[2]))<1e-12);
}
console.log('PASS compact smoke support: continuous boundary, no support escape, unchanged clear-space interpolation');
