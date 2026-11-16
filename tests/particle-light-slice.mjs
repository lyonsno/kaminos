// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveDirectionalProfile,compareSliceSections,readOpticalAtlas,packLightSliceView} from '../particle-light-slice.mjs';

test('emitter light loses transmission downstream while local emission is attenuated only by later sections',()=>{
 const profile=resolveDirectionalProfile([0,0,0,Math.log(2), 2,0,0,0, 0,0,0,Math.log(4)],{incoming:[8,0,0],native:true});
 assert.deepEqual(profile.map(s=>[s.light[0],s.transmission]),[[4,.5],[6,.5],[1.5,.125]]);
});
test('controlled emitter ignores native light but retains extinction and detects invalid moments',()=>{
 const profile=resolveDirectionalProfile([40,10,0,Math.log(2)],{incoming:[2,4,8],native:false});
 assert.deepEqual(profile[0].light,[1,2,4]);
 assert.throws(()=>resolveDirectionalProfile([NaN,0,0,0]),/Invalid optical moments/);
});

test('an upstream fine measurement changes downstream depth without altering unselected transverse rays',()=>{
 const rays=Array.from({length:9},()=>[0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0]);
 rays[4][7]=Math.log(4);
 const r=compareSliceSections(rays,{width:3,depthStride:4,acrossStride:3,correctionStart:.25,correctionExtent:.25,sharingRadius:0});
 assert.deepEqual(r.depthMask,[false,true,false,false]);
 assert.equal(r.fine[4][3].transmission,.25);
 assert.equal(r.shared[0][3].transmission,r.coarse[0][3].transmission);
 assert.ok(r.shared[4][3].transmission<r.coarse[4][3].transmission);
 assert.ok(r.shared[4][0].transmission>r.shared[4][1].transmission);
});

test('atlas decoding honors WebGPU row padding and preserves each ray and depth',()=>{
 const buffer=new ArrayBuffer(512),u=new DataView(buffer);
 u.setUint16(6,0x3c00,true);u.setUint16(14,0x4000,true);
 u.setUint16(256+6,0x4200,true);u.setUint16(256+14,0x4400,true);
 const layout={width:2,height:1,sections:2,columns:1,atlasWidth:2,atlasHeight:2};
 assert.deepEqual(readOpticalAtlas(new Uint8Array(buffer),layout,256).map(a=>[a[3],a[7]]),[[1,3],[2,4]]);
 assert.throws(()=>readOpticalAtlas(new Uint8Array(buffer,0,400),layout,256),/Incomplete/);
 u.setUint16(14,0x7c00,true);
 assert.throws(()=>readOpticalAtlas(new Uint8Array(buffer),layout,256),/saturated/);
});

test('the display consumes ordered sections at the actual world beam converted to Fine coordinates',()=>{
 const packed=packLightSliceView({identity:{epoch:2},emitter:[8,4,8],receiver:[8,4,12],halfWidth:1,sections:2,width:1,transform:{scale:2,translate:[8,2,8]}},
  [[{light:[2,4,8]},{light:[1,2,4]}]]);
 assert.deepEqual(Array.from(packed.axis.slice(0,8)),[0,1,0,.5,0,0,1,2]);
 assert.deepEqual(Array.from(packed.values),[2,4,8,0,1,2,4,0]);
 assert.deepEqual(packed.identity,{epoch:2});
});

test('signed native RGB is retained through optical composition while negative extinction fails',()=>{
 assert.deepEqual(resolveDirectionalProfile([1,-.125,.5,0])[0].light,[1,-.125,.5]);
 assert.throws(()=>resolveDirectionalProfile([1,0,0,-.125]),/Invalid optical moments/);
 const bytes=new Uint8Array(256);
 new DataView(bytes.buffer).setUint16(2,0xb000,true);
 assert.equal(readOpticalAtlas(bytes,{width:1,height:1,sections:1,columns:1,atlasWidth:1,atlasHeight:1},256)[0][1],-.125);
});
