// kaminos-test: node
import assert from 'node:assert/strict';
import {shadowBankPlan,createFireShadowBank} from '../fire-shadow-bank.mjs';

const limits={maxTextureArrayLayers:256,maxTextureDimension2D:8192};
assert.deepEqual(shadowBankPlan({count:6,resolution:64},limits),{count:6,resolution:64,layers:36,bytes:1179648,supported:true,reason:null});
assert.equal(shadowBankPlan({count:43,resolution:64},limits).supported,false);
assert.equal(shadowBankPlan({count:6,resolution:8193},limits).supported,false);
assert.equal(shadowBankPlan({count:6,resolution:64}).supported,false);
for(const value of [0,-1,1.5,NaN,Infinity])assert.throws(()=>shadowBankPlan({count:value,resolution:64},limits),/positive/);
assert.equal(createFireShadowBank({renderer:{backend:{}},count:6,resolution:64}),null);

const allocations=[],copies=[],submissions=[],resources=new WeakMap();let disposals=0;
const device={limits,queue:{submit(commands){submissions.push(commands);}},createCommandEncoder(){const commands=[];return {
  copyTextureToTexture(source,destination,size){const row={source,destination,size};copies.push(row);commands.push(row);},finish(){return commands;},
};}};
const renderer={backend:{isWebGPUBackend:true,device,get(texture){return resources.get(texture);}},initTexture(texture){
  allocations.push({...texture.image});resources.set(texture,{texture:{width:texture.image.width,height:texture.image.height,depthOrArrayLayers:texture.image.depth,format:'rgba16float'}});
  if(allocations.length===1)texture.addEventListener('dispose',()=>disposals++);
}};
const bank=createFireShadowBank({renderer,count:6,resolution:64});
assert.equal(bank.debugState().status,'awaiting-complete-capture');
const shadows=Array.from({length:6},(_,index)=>({resource:()=>({effective:true,texture:{index,width:64,height:64,depthOrArrayLayers:6,format:'rgba16float'}})}));
assert.throws(()=>bank.copyCompleted([0],shadows),/complete initial capture/);
assert.equal(submissions.length,0);
bank.copyCompleted([0,1,2,3,4,5],shadows);
assert.deepEqual(copies.map(c=>c.destination.origin[2]),[0,6,12,18,24,30]);
assert(copies.every(c=>c.size.join(',')==='64,64,6'));
assert.equal(bank.debugState().copyBytes,1179648);
bank.copyCompleted([4],shadows);
assert.equal(copies.length,7);assert.equal(copies[6].source.texture.index,4);
assert.equal(bank.debugState().copyBytes,196608);
const submitted=submissions.length;
assert.throws(()=>bank.copyCompleted([1,1],shadows),/invalid/);
const invalid=shadows.map((s,i)=>i===3?{resource:()=>({effective:false})}:s);
assert.throws(()=>bank.copyCompleted([2,3],invalid),/matching completed/);
assert.equal(submissions.length,submitted,'validate every selected source before submitting any copy');
bank.setResolution(128);assert.equal(disposals,1);assert.equal(allocations.length,2);
assert.equal(bank.debugState().status,'awaiting-complete-capture');
assert.throws(()=>bank.copyCompleted([0],shadows),/complete initial capture/);
const resized=shadows.map((s,index)=>({resource:()=>({effective:true,texture:{index,width:128,height:128,depthOrArrayLayers:6,format:'rgba16float'}})}));
assert.throws(()=>bank.copyCompleted([0,1,2,3,4,5],shadows),/matching completed/);
bank.copyCompleted([0,1,2,3,4,5],resized);
assert.equal(bank.debugState().copyBytes,4718592);
bank.setResolution(128);assert.equal(allocations.length,2,'unchanged quality does not reallocate');
bank.dispose();bank.dispose();assert.equal(disposals,2);
assert.throws(()=>bank.copyCompleted([0],resized),/disposed/);
console.log('PASS indexed shadow bank capacity, selected copies, atomic initialization, resize and disposal');
