// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Group,Mesh,BoxGeometry,MeshStandardMaterial,Texture} from '../lib/three.core.js';
import experiment from '../experiments/generated-glass.experiment.mjs';
const hash=bytes=>createHash('sha256').update(new Uint8Array(bytes)).digest('hex');
test('detail switching preserves optics and source identity; full triangles load only when requested',async()=>{
 const original=globalThis.fetch,calls=[],roots=[];
 const source=new Float32Array([0,0,0,0,0,1,1,.5,0,0,.3,.2, .01,0,0,0,0,1,0,0,1,0,.3,1]);
 const sourceMeta={ok:true,count:2,sourceCount:2,stride:12,radius:.01,gridSize:512,sourceHashes:{raw:'raw-hash',material:'material-hash'},triangles:{file:'triangles.u32',count:0},dataSHA256:hash(source.buffer)};
 const coarse=source.slice(),coarseMeta={...sourceMeta,radius:.04,reduction:{factor:4},sourceDataSHA256:sourceMeta.dataSHA256};delete coarseMeta.triangles;
 let corrupt=false;
 globalThis.fetch=async url=>{calls.push(url);const meta=url.startsWith('/raw/')?sourceMeta:coarseMeta;
  if(url.endsWith('.json'))return {ok:true,json:async()=>({...meta,...(corrupt?{sourceDataSHA256:'wrong'}:{})})};
  return {ok:true,arrayBuffer:async()=>url.endsWith('.u32')?new ArrayBuffer(0):coarse.buffer.slice(0)};
 };
 const asset=new Group();asset.add(new Mesh(new BoxGeometry(),new MeshStandardMaterial({map:new Texture()})));
 const session={loadAsset:async()=>({root:asset,id:'source'}),attach:async root=>{roots.push(root);return {root,id:String(roots.length)};},setView:v=>v,redraw(){},dispose:async()=>{}};
 let c;
 try{
  c=await experiment.create({host:{scene:{open:async()=>session}},inputs:{url:'asset.glb',surfelBase:'/raw/',surfelLevels:[{factor:4,base:'/coarse/'}],material:{ior:1.4}},record(){}});
  assert.equal(c.read().factor,4);assert.equal(c.read().rawMesh,undefined);assert.ok(!calls.includes('/raw/surfels.f32'));
  c.operations.setMaterial({ior:1.7,thickness:.03});c.operations.setReconstructionMode('off');
  await c.operations.setSurfelFactor(1);assert.equal(c.read().surfels.ior,1.7);assert.equal(c.read().surfels.thickness,.03);assert.equal(c.read().surfels.reconstruction,false);
  corrupt=true;await assert.rejects(()=>c.operations.setSurfelFactor(4),/source mismatch/);assert.equal(c.read().factor,1);corrupt=false;
  await c.operations.setSurfelFactor(4);assert.equal(c.read().factor,4);assert.equal(roots.filter(r=>r.name==='TRELLIS surfels').length,1);
  await assert.rejects(()=>c.operations.setSurfelFactor(3),/Unavailable/);assert.equal(c.read().factor,4);
 }finally{await c?.dispose();globalThis.fetch=original;asset.children[0].geometry.dispose();asset.children[0].material.dispose();}
});
