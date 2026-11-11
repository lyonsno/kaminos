// kaminos-test: node
import assert from 'node:assert/strict';
import {readNeumipModel} from '../neumip-model.mjs';

// Author's Cereal PortableBinary archive schema, cpputils/storage_model.h.
function fixture() {
  const bytes=[];
  const put=(format,value)=>{const b=new ArrayBuffer(format==='q'?8:4),v=new DataView(b);if(format==='q')v.setBigUint64(0,BigInt(value),true);else if(format==='f')v.setFloat32(0,value,true);else v.setInt32(0,value,true);bytes.push(...new Uint8Array(b));};
  const str=s=>{put('q',s.length);bytes.push(...new TextEncoder().encode(s));};
  const floats=a=>{put('q',a.length);for(const n of a)put('f',n);};
  const texture=(size,channels)=>{put('i',size);put('i',size);put('i',channels);floats(Array(size*size*channels).fill(.25));};
  bytes.push(1);texture(2,6);str('');put('q',1);texture(2,8);
  const layers=[['main',[12,24,24,24,6]],['offset_network',[8,24,24,24,1]]];put('q',8);
  for(const [name,widths] of layers)for(let i=0;i<4;i++){
    str(`${name}.mpl${i}`);put('i',widths[i]);put('i',widths[i+1]);put('i',1);put('i',i<3?1:0);
    floats(Array(widths[i]*widths[i+1]).fill(0));floats(Array(widths[i+1]).fill(i===3?.1:0));
  }
  return new Uint8Array(bytes);
}
const bytes=fixture(),model=readNeumipModel(bytes);
assert.equal(model.offset.channels,6);assert.equal(model.mips[0].channels,8);
assert.deepEqual(model.layers.map(x=>[x.input,x.output]),[[12,24],[24,24],[24,24],[24,6],[8,24],[24,24],[24,24],[24,1]]);
assert.equal(model.byteLength,bytes.length);
assert.throws(()=>readNeumipModel(bytes.subarray(0,bytes.length-3)),/truncated/);
const endian=bytes.slice();endian[0]=0;assert.throws(()=>readNeumipModel(endian),/little-endian/);
const trailing=new Uint8Array(bytes.length+1);trailing.set(bytes);assert.throws(()=>readNeumipModel(trailing),/trailing/);
const shape=bytes.slice();new DataView(shape.buffer).setInt32(9,7,true);assert.throws(()=>readNeumipModel(shape),/shape/);
const nonfinite=bytes.slice();new DataView(nonfinite.buffer).setFloat32(21,NaN,true);assert.throws(()=>readNeumipModel(nonfinite),/non-finite/);
console.log('NeuMIP archive: shape, endianness, truncation, trailing bytes and finite values passed');

const {createNeumipMaterial}=await import('../neumip-material.mjs');
const {sceneGIReceives}=await import('../scene-gi-settings.mjs');
const native=createNeumipMaterial(model);
try{assert.equal(sceneGIReceives(native.material),false,'learned directional radiance must bypass the ordinary diffuse transport/receiver wrapper');}
finally{native.material.dispose();}

// Custom lighting graphs live in closures. Separate material instances must not
// borrow a compiled graph (or its uniforms/textures) from a sibling.
const first=createNeumipMaterial(model,{uvScale:2,gain:1});
const second=createNeumipMaterial(model,{uvScale:5,gain:2});
const changed=structuredClone(model);changed.layers.find(l=>l.name==='main.mpl3').biases[0]+=.5;
const third=createNeumipMaterial(changed);
try{
 const key=first.material.customProgramCacheKey();
 assert.notEqual(key,second.material.customProgramCacheKey(),'separate slots own separate lighting graphs and uniforms');
 assert.notEqual(key,third.material.customProgramCacheKey(),'different learned weights own distinct shader programs');
 first.settings.gain.value=3;first.settings.scale.value=4;
 assert.equal(first.material.customProgramCacheKey(),key,'uniform edits preserve program identity');
}finally{first.material.dispose();second.material.dispose();third.material.dispose();}
