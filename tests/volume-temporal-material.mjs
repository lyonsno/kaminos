// kaminos-test: node
import assert from 'node:assert/strict';
import {validateOpticalFrame,restrictOptical,reconstructOpticalFrame} from '../volume-temporal-material.mjs';

function moving(time,accelerating=false){
 const dimensions=[32,8,4],bounds=[[-1,-.25,-.125],[1,.25,.125]],optical=new Float32Array(32*8*4*4),velocity=new Float32Array(32*8*4*3);
 for(let z=0;z<4;z++)for(let y=0;y<8;y++)for(let x=0;x<32;x++){
  const i=x+32*(y+8*z),px=-1+(x+.5)/16,py=-.25+(y+.5)/16;
  const displacement=accelerating?.083*Math.max(0,time)**2:time*.083;
  const light=Math.exp(-(((px-.137-displacement-py*.6)/.065)**2))*Math.exp(-((py/.18)**2));
  optical.set([light,light*.4,light*.1,light*.7],i*4);velocity.set([accelerating?.166*Math.max(0,time):.083,0,0],i*3);
 }
 return {dimensions,bounds,optical,velocity,time};
}
const native=Array.from({length:5},(_,i)=>moving(i-2)),coarse=native.map(f=>restrictOptical(f,[8,2,1]));
const single=reconstructOpticalFrame(coarse,2,{dimensions:[32,8,4],mode:'single'});
const future=reconstructOpticalFrame(coarse,2,{dimensions:[32,8,4],mode:'future',iterations:20,relaxation:.2});
const error=f=>f.optical.reduce((sum,x,i)=>sum+(x-native[2].optical[i])**2,0)/f.optical.length;
assert.ok(error(future)<error(single)*.85,`Known future observations must recover translating subcell shape: ${error(future)} vs ${error(single)}`);
assert.ok(future.optical.every(x=>Number.isFinite(x)&&x>=0));
const reduced=restrictOptical(future,[8,2,1]);
for(let i=0;i<reduced.optical.length;i++)assert.ok(Math.abs(reduced.optical[i]-coarse[2].optical[i])<2e-6,'Current coarse optical totals must be retained');
const past=reconstructOpticalFrame(coarse,2,{dimensions:[32,8,4],mode:'forward'});
const altered=coarse.map((f,i)=>i>2?{...f,optical:f.optical.map(x=>x*7)}:f);
assert.deepEqual(reconstructOpticalFrame(altered,2,{dimensions:[32,8,4],mode:'forward'}).optical,past.optical,'Forward-only must not read future observations');
const dark=coarse.map(f=>({...f,optical:f.optical.map(()=>0)}));dark[3]=coarse[3];dark[4]=coarse[4];
assert.equal(reconstructOpticalFrame(dark,2,{dimensions:[32,8,4]}).optical.reduce((a,x)=>a+x,0),0,'Future light cannot appear in a currently dark cell');
assert.throws(()=>validateOpticalFrame({...coarse[0],optical:new Float32Array(4)}),/Complete/);
assert.throws(()=>validateOpticalFrame({...coarse[0],velocity:new Float32Array(3)}),/Complete/);
// Past stationary observations repeat the same coarse-cell phase; the known
// future acceleration supplies new spatial measurements. Both modes receive
// precisely the same previous reconstruction, isolating future information.
const accelerationNative=Array.from({length:5},(_,i)=>moving(i-2,true)),accelerationCoarse=accelerationNative.map(f=>restrictOptical(f,[8,2,1]));
const previous=reconstructOpticalFrame(accelerationCoarse,1,{dimensions:[32,8,4],mode:'single'});
const variants=Object.fromEntries(['forward','future'].map(mode=>[mode,reconstructOpticalFrame(accelerationCoarse,2,{dimensions:[32,8,4],mode,previous,iterations:20,relaxation:.2})]));
const accelerationError=f=>f.optical.reduce((s,x,i)=>s+(x-accelerationNative[2].optical[i])**2,0)/f.optical.length;
assert.ok(accelerationError(variants.future)<accelerationError(variants.forward)*.95,`Future phase measurements must improve the same carried seed: ${accelerationError(variants.future)} vs ${accelerationError(variants.forward)}`);
assert.throws(()=>reconstructOpticalFrame(coarse,2,{dimensions:[0,8,4]}),/dimensions/);
console.log('Optical temporal reconstruction, current totals and source-time isolation passed');
