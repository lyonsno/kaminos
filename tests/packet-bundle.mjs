// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {finitePacketBundle,packetBundlePlan,packPacketBundles} from '../volume-packet-bundle.mjs';
const limits={maxTextureDimension2D:256,maxBufferSize:1e8,maxStorageBufferBindingSize:1e8,maxComputeWorkgroupsPerDimension:65535};
test('finite bundles carry axial distances independent of perspective clip W',()=>{
 const b=finitePacketBundle({origin:[2,3,4],target:[2,3,9],halfSize:[1,2],near:.25,far:7,weight:.125,receiver:2,source:3});
 assert.deepEqual(b.forward,[0,0,1]);
 assert.equal(b.near,.25);assert.equal(b.far,7);
 assert.ok(Math.abs(b.right.reduce((s,v,i)=>s+v*b.up[i],0))<1e-12);
 assert.equal(b.right.reduce((s,v)=>s+v*v,0),1);
 const data=packPacketBundles([b]);assert.equal(data.byteLength,96);
 const f=new Float32Array(data),u=new Uint32Array(data);
 assert.deepEqual([...f.slice(0,8)],[2,3,4,.25,0,0,1,7]);
 assert.equal(f[16],.125);assert.deepEqual([...u.slice(20,22)],[2,3]);
 assert.throws(()=>finitePacketBundle({origin:[0,0,0],target:[0,0,0],halfSize:[1,1],far:1,weight:1}),/direction/);
 assert.throws(()=>finitePacketBundle({origin:[0,0,0],target:[0,0,1],halfSize:[1,1],near:2,far:1,weight:1}),/endpoints/);
});
test('layout accounts for every bundle and depth section without silently lowering quality',()=>{
 const p=packetBundlePlan(limits,{width:8,height:4,sections:5,bundles:7,slots:90,receivers:3});
 assert.equal(p.tiles,35);assert.ok(p.columns*p.rows>=35);
 assert.equal(p.rays,224);assert.equal(p.instances,630);
 assert.equal(p.receiverBytes,48);assert.equal(p.bundleBytes,672);
 assert.throws(()=>packetBundlePlan({...limits,maxTextureDimension2D:8},{width:8,height:8,sections:5,bundles:7,slots:90,receivers:3}),/texture/);
 assert.throws(()=>packetBundlePlan(limits,{width:0,height:4,sections:5,bundles:7,slots:90,receivers:3}),/width/);
});
