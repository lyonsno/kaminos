// kaminos-test: node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {packMicroField,decodeMicroField,assertMicroFieldSource,loadMicroField,microstructureFileURL} from '../neural-microstructure-field.mjs';
import {fieldFixture} from './fixtures/microstructure-field.mjs';
const {meta,arrays}=fieldFixture(),model=packMicroField(meta,arrays);
for(const [position,raw]of [[[0,0,0],0],[[1,1,1],1],[[.5,.5,.5],.5],[[1,0,0],4/7]]){
  const values=decodeMicroField(model,0,position);assert.ok(Math.abs(values[0]-Math.log1p(Math.exp(raw)))<1e-6);assert.deepEqual(values.slice(1,4),[0,0,1]);
}
assert.throws(()=>decodeMicroField(model,1,[0,0,0]),/carrier/);
assert.throws(()=>packMicroField({...meta,gridOrder:'unknown'},arrays),/layout/);
assert.throws(()=>packMicroField({...meta,output:['wrong',...meta.output.slice(1)]},arrays),/layout/);
assert.throws(()=>packMicroField(meta,{...arrays,grid:new Float32Array(1)}),/grid/);
const source={sourceSHA256:'original',carrierCount:1,radius:.1,files:Object.fromEntries(['rows.f32','carriers.f32','source-ids.u32'].map(name=>[name,{sha256:name}]))};
const matching={...source,sourceFiles:source.files};assertMicroFieldSource(source,matching);
assert.throws(()=>assertMicroFieldSource(source,{...matching,sourceFiles:{...source.files,'carriers.f32':{sha256:'wrong-crop'}}}),/carriers.f32/,'A common original source must not excuse a different crop');
assert.throws(()=>assertMicroFieldSource(source,{...matching,radius:.2}),/source/);
assert.equal(microstructureFileURL('http://localhost/api/read?root=generated-meshes&path=model%2F','grid.f32').searchParams.get('path'),'model/grid.f32');
for(const [name,array]of Object.entries(arrays))meta.files[name].sha256=crypto.createHash('sha256').update(new Uint8Array(array.buffer)).digest('hex');
const fetcher=async url=>url.pathname.endsWith('model.json')?{ok:true,json:async()=>meta}:{ok:true,arrayBuffer:async()=>arrays[Object.keys(arrays).find(name=>meta.files[name].file===url.pathname.split('/').at(-1))].buffer.slice(0)};
assert.equal((await loadMicroField('http://localhost/model/',{fetcher})).grid.length,8);
meta.files.grid.sha256='wrong';await assert.rejects(loadMicroField('http://localhost/model/',{fetcher}),/hash/);
console.log('microstructure field: trilinear decode, channel layout, crop identity and corrupted model refusal passed');
