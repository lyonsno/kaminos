// kaminos-test: node
import assert from 'node:assert/strict';
import {encodeGlb,parseGlb,readTrianglePrimitives} from '../poly-glb-io.mjs';

// One interleaved, strided primitive with 16-bit indices and a node matrix,
// the layout details a reader most easily gets wrong.
const positions=[0,0,0, 1,0,0, 0,1,0, 1,1,0],normals=[0,0,1, 0,0,1, 0,0,1, 0,0,1],uvs=[0,0, 1,0, 0,1, 1,1];
const stride=32,interleaved=new DataView(new ArrayBuffer(4*stride));
for(let v=0;v<4;v++){
  for(let i=0;i<3;i++)interleaved.setFloat32(v*stride+4*i,positions[3*v+i],true);
  for(let i=0;i<3;i++)interleaved.setFloat32(v*stride+12+4*i,normals[3*v+i],true);
  for(let i=0;i<2;i++)interleaved.setFloat32(v*stride+24+4*i,uvs[2*v+i],true);
}
const indices=new Uint16Array([0,1,2,2,1,3]),bin=new Uint8Array(4*stride+12);
bin.set(new Uint8Array(interleaved.buffer),0);bin.set(new Uint8Array(indices.buffer),4*stride);
const json={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0,matrix:[1,0,0,0, 0,0,-1,0, 0,1,0,0, 0,0,0,1]}],
  meshes:[{primitives:[{attributes:{POSITION:0,NORMAL:1,TEXCOORD_0:2},indices:3,material:0}]}],materials:[{name:'atlas'}],
  buffers:[{byteLength:bin.length}],bufferViews:[{buffer:0,byteOffset:0,byteLength:4*stride,byteStride:stride},{buffer:0,byteOffset:4*stride,byteLength:12}],
  accessors:[{bufferView:0,byteOffset:0,componentType:5126,count:4,type:'VEC3'},{bufferView:0,byteOffset:12,componentType:5126,count:4,type:'VEC3'},
    {bufferView:0,byteOffset:24,componentType:5126,count:4,type:'VEC2'},{bufferView:1,componentType:5123,count:6,type:'SCALAR'}]};
const glb=encodeGlb(json,bin);
assert.equal(glb.length%4,0,'chunks are padded to four bytes');
assert.equal(new TextDecoder().decode(glb.subarray(0,4)),'glTF');
assert.equal(new DataView(glb.buffer,glb.byteOffset).getUint32(8,true),glb.length,'header length matches the file');
const parsed=parseGlb(glb);
assert.deepEqual(parsed.json.materials,[{name:'atlas'}]);
assert.deepEqual([...parsed.bin.subarray(0,bin.length)],[...bin]);

const [primitive,...rest]=readTrianglePrimitives(glb);
assert.equal(rest.length,0);
assert.deepEqual([...primitive.positions],positions,'strided positions are de-interleaved');
assert.deepEqual([...primitive.normals],normals);
assert.deepEqual([...primitive.uvs],uvs);
assert.ok(primitive.indices instanceof Uint32Array);
assert.deepEqual([...primitive.indices],[0,1,2,2,1,3],'16-bit indices widen without loss');
assert.deepEqual({mesh:primitive.mesh,primitive:primitive.primitive,material:primitive.material,nodes:primitive.nodes},{mesh:0,primitive:0,material:0,nodes:[0]});
assert.deepEqual(primitive.worldMatrices,[[1,0,0,0, 0,0,-1,0, 0,1,0,0, 0,0,0,1]],'the node placement travels with the geometry');

assert.throws(()=>parseGlb(new Uint8Array(12)),/glTF/);
const sparse=structuredClone(json);sparse.accessors[0].sparse={count:1};
assert.throws(()=>readTrianglePrimitives(encodeGlb(sparse,bin)),/sparse/i);
const strip=structuredClone(json);strip.meshes[0].primitives[0].mode=5;
assert.deepEqual(readTrianglePrimitives(encodeGlb(strip,bin)),[],'non-triangle primitives are not presented as triangles');
