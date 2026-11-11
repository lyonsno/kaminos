// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import * as image from '../models/flux3-klein/reference-image.js';
test('reference preprocessing preserves its own rectangle and crops only the 16 pixel grid',()=>{
 assert.equal(typeof image.referenceImageGeometry,'function');
 assert.deepEqual(image.referenceImageGeometry(259,145),{sourceWidth:259,sourceHeight:145,resizedWidth:259,resizedHeight:145,left:1,top:0,width:256,height:144});
 assert.equal(image.referenceImageGeometry(8192,4096).resizedWidth,5792);
 assert.throws(()=>image.referenceImageGeometry(15,128),/16/);
});
test('RGB normalization keeps row/channel order and declared white alpha background',()=>{
 assert.equal(typeof image.referenceRgb,'function');
 const rgb=image.referenceRgb(new Uint8ClampedArray([255,0,128,255,0,128,255,0]));
 assert.deepEqual([...rgb],[1,-1,Math.fround(128/127.5-1),1,1,1]);
});
const pixels=()=>Uint8ClampedArray.from({length:7*5*4},(_,i)=>(i*47+13)%256);
test('cooperative conversion preserves every Float32 channel while yielding between rows',async()=>{
 const rgba=pixels(),original=rgba.slice();let clock=0,yields=0;
 const rgb=await image.referenceRgbCooperative(rgba,{width:7,targetDutyMs:12,now:()=>{clock+=13;return clock;},yieldToBrowser:async()=>{yields++;}});
 assert.deepEqual(rgb,image.referenceRgb(rgba));assert.deepEqual(rgba,original);
 assert.equal(yields,4);assert.equal(rgb.length,7*5*3);
});
test('cooperative conversion cancellation is checked before work and after task yielding',async()=>{
 const controller=new AbortController();controller.abort();let yields=0;
 await assert.rejects(image.referenceRgbCooperative(pixels(),{width:7,signal:controller.signal,yieldToBrowser:async()=>{yields++;}}),{name:'AbortError'});
 assert.equal(yields,0);
 const active=new AbortController();let clock=0;
 await assert.rejects(image.referenceRgbCooperative(pixels(),{width:7,signal:active.signal,targetDutyMs:12,now:()=>clock+=13,yieldToBrowser:async()=>{yields++;active.abort();}}),{name:'AbortError'});
 assert.equal(yields,1);
});
test('cooperative conversion yields real tasks by default and does not yield below budget',async()=>{
 let taskRan=false;const timer=setTimeout(()=>{taskRan=true;},0);let clock=0;
 try{
  const rgb=await image.referenceRgbCooperative(pixels(),{width:7,now:()=>clock+=13});
  assert.equal(taskRan,true);assert.deepEqual(rgb,image.referenceRgb(pixels()));
 }finally{clearTimeout(timer);}
 let yields=0;
 await image.referenceRgbCooperative(pixels(),{width:7,now:()=>0,yieldToBrowser:async()=>{yields++;}});
 assert.equal(yields,0);
 await assert.rejects(image.referenceRgbCooperative(pixels(),{width:6}),/complete RGBA rows/);
 await assert.rejects(image.referenceRgbCooperative(pixels(),{width:7,targetDutyMs:0}),/targetDutyMs/);
});
test('production reference reader uses cooperative conversion and closes the bitmap on cancellation',async(t)=>{
 const original={fetch:globalThis.fetch,createImageBitmap:globalThis.createImageBitmap,OffscreenCanvas:globalThis.OffscreenCanvas};
 t.after(()=>Object.assign(globalThis,original));
 const controller=new AbortController();let closed=0,yields=0,clock=0;
 globalThis.fetch=async()=>({ok:true,blob:async()=>new Blob(['reference-fixture'])});
 globalThis.createImageBitmap=async()=>({width:16,height:16,close(){closed++;}});
 globalThis.OffscreenCanvas=class{getContext(){return {fillRect(){},drawImage(){},getImageData(){return {data:new Uint8ClampedArray(16*16*4)};}};}};
 await assert.rejects(image.readReferenceImage({kind:'image',source:'fixture:reference'},{signal:controller.signal,now:()=>clock+=13,yieldToBrowser:async()=>{yields++;controller.abort();}}),{name:'AbortError'});
 assert.equal(closed,1);assert.equal(yields,1);
});
