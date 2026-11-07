// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {embedSurfaceSplats} from '../surface-splat-glb.mjs';
import {SURFACE_SPLAT_EXTENSION,surfaceSplatsGLTFPlugin} from '../surface-splat-object.mjs';
import {Mesh,BoxGeometry,MeshStandardMaterial} from '../lib/three.core.js';

function source(){
 const json=new TextEncoder().encode(JSON.stringify({asset:{version:'2.0'},buffers:[{byteLength:4}],bufferViews:[],nodes:[{mesh:0}],meshes:[{primitives:[]}]})),n=(json.length+3)&~3,bytes=new Uint8Array(32+n),v=new DataView(bytes.buffer);
 for(const [o,value]of [[0,0x46546c67],[4,2],[8,bytes.length],[12,n],[16,0x4e4f534a],[20+n,4],[24+n,0x004e4942]])v.setUint32(o,value,true);
 bytes.fill(32,20,20+n);bytes.set(json,20);bytes.set([4,3,2,1],28+n);return bytes;
}
const payload=()=>({data:new Float32Array([0,0,0,0,0,1,.8,.3,.1,0,.5,1]),meta:{count:1,stride:12,radius:.03},footprints:new Float32Array([1,0,0,.06,0,1,0,.06])});
function read(bytes){const v=new DataView(bytes),n=v.getUint32(12,true);return {doc:JSON.parse(new TextDecoder().decode(new Uint8Array(bytes,20,n))),bin:bytes.slice(28+n)};}
test('portable GLB fallback and all surface fields survive packaging and loader plugin',async()=>{
 const bytes=embedSurfaceSplats(source(),payload()),{doc,bin}=read(bytes),ext=doc.nodes[0].extensions[SURFACE_SPLAT_EXTENSION];
 assert.deepEqual([...new Uint8Array(bin,0,4)],[4,3,2,1]);
 assert.ok(doc.extensionsUsed.includes(SURFACE_SPLAT_EXTENSION));assert.ok(!doc.extensionsRequired);
 const plugin=surfaceSplatsGLTFPlugin({json:doc,getDependency(type,i){if(type==='mesh')return Promise.resolve(new Mesh(new BoxGeometry(),new MeshStandardMaterial()));const v=doc.bufferViews[i];return Promise.resolve(bin.slice(v.byteOffset,v.byteOffset+v.byteLength));}});
 const object=await plugin.createNodeMesh(0);assert.deepEqual(object.payload.data,payload().data);assert.deepEqual(object.payload.footprints,payload().footprints);assert.equal(ext.count,1);object.dispose();
});
test('partial fields, malformed GLB, and adaptive input without tolerance fail before export',()=>{
 assert.throws(()=>embedSurfaceSplats(new ArrayBuffer(20),payload()),/GLB/);
 assert.throws(()=>embedSurfaceSplats(source(),{...payload(),footprints:new Float32Array(1)}),/field/);
 const p=payload();p.meta.adaptive={schema:'static-connected-splats.v1'};assert.throws(()=>embedSurfaceSplats(source(),p),/tolerance/);
});
test('invalid authored optics fail at packaging, before producing an unusable asset',()=>{
 assert.throws(()=>embedSurfaceSplats(source(),payload(),{optics:{mode:'glass',ior:NaN,thickness:.06}}),/optics/);
});
