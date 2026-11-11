// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {angularBasis,fitFilteredSurface,evaluateFilteredSurface} from '../filtered-surface-lod.mjs';
test('joint angular fit preserves known directional response on withheld directions',()=>{
 const angles=Array.from({length:128},(_,i)=>{const a=i*2.39996323,b=i*1.7320508;return [.8*Math.cos(a),.3*Math.sin(a),.7*Math.cos(b),.4*Math.sin(b)];});
 const truth=([vx,vy,lx,ly])=>[.15+.07*lx+.03*vx*ly,.12+.04*ly,.08+.02*vx];
 const labels=new Float32Array(2*2*128*3);for(let p=0;p<4;p++)angles.forEach((a,i)=>labels.set(truth(a),(p*128+i)*3));
 const model=fitFilteredSurface({width:2,height:2,angles,labels,ridge:1e-8});
 for(const a of [[.1,.2,.3,.4],[-.2,.6,-.3,.1]]){const rgb=evaluateFilteredSurface(model,[.4,.3],a);truth(a).forEach((v,i)=>assert.ok(Math.abs(rgb[i]-v)<1e-5));}
 assert.equal(model.coefficients.length,4*16*3);assert.equal(angularBasis([0,0,0,0]).length,16);
});
test('constant fields remain constant across spatial wrapping and angular queries',()=>{
 const angles=Array.from({length:40},(_,i)=>[.6*Math.sin(i),.3*Math.cos(i),.7*Math.sin(i*1.7),.4*Math.cos(i*1.7)]);
 const labels=new Float32Array(4*40*3).fill(.2),model=fitFilteredSurface({width:2,height:2,angles,labels});
 for(const uv of [[0,0],[1,1],[-.2,3.4]])for(const v of evaluateFilteredSurface(model,uv,[.2,.2,.3,.1]))assert.ok(Math.abs(v-.2)<1e-4);
});
test('malformed or non-finite teacher labels cannot produce a model',()=>{
 assert.throws(()=>fitFilteredSurface({width:2,height:2,angles:[],labels:new Float32Array()}));
 assert.throws(()=>angularBasis([1.1,0,0,0]));
});
