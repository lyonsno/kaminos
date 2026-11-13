// kaminos-test: node
import assert from 'node:assert/strict';
import {neuralAppearanceProgram as program} from '../neural-appearance-program.mjs';
const source={url:'/api/read?root=image-inbox&path=nvidia-appearance-models%2Fpainted-steel%2Fmodel.json',sha256:'a'.repeat(64)};
assert.equal(typeof program.defaults,'function','native Create material needs actual checkpoint defaults');
assert.equal(program.resourceKey({source}),program.resourceKey({source:{sha256:source.sha256,url:source.url}}),'checkpoint identity is independent of property insertion order');
const original=globalThis.fetch;
try{
 globalThis.fetch=async()=>new Response(JSON.stringify({schema:'kaminos.neural-appearance.catalog.v1',materials:{'Painted steel':{filename:'painted-steel/model.json',sha256:source.sha256}}}));
 const items=await program.sources();assert.equal(items.length,1);assert.deepEqual(items[0],{label:'Painted steel',source});
 const parameters=await program.defaults();assert.deepEqual(parameters,{source,uvScale:1,gain:1});
 assert.equal(program.check(parameters).reflectionRoughness,.24);
 assert.equal(program.check({...parameters,reflectionColor:"#abc123"}).reflectionColor,"#abc123");
 assert.throws(()=>program.check({...parameters,reflectionRoughness:1.1}),/Reflection roughness/);
 globalThis.fetch=async()=>new Response(JSON.stringify({schema:'kaminos.neural-appearance.catalog.v1',materials:{}}));
 await assert.rejects(program.defaults(),/No trained NVIDIA/);
 globalThis.fetch=async()=>new Response(JSON.stringify({schema:'wrong',materials:{}}));
 await assert.rejects(program.sources(),/Invalid NVIDIA/);
 globalThis.fetch=async()=>new Response('',{status:404});
 await assert.rejects(program.sources(),/Install.*NVIDIA/);
}finally{globalThis.fetch=original;}
console.log('Native NVIDIA material source selection and canonical checkpoint identity passed');
