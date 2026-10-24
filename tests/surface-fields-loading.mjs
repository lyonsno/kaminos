// kaminos-test: node
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {loadSurfaceFields} from '../experiments/surface-fields.experiment.mjs';
const data=new Float32Array([1,2,3,0,1,0,.5,.4,.3,0,.8,1]);
const fp=new Float32Array([1,0,0,.01,0,0,1,.01]);
const hash=a=>createHash('sha256').update(Buffer.from(a.buffer)).digest('hex');
const meta={ok:true,stride:12,count:1,dataSHA256:hash(data),footprints:{stride:8,file:'footprints.f32',sha256:hash(fp)}};
const fetcher=(patch={},corrupt=false)=>async url=>({ok:true,json:async()=>({...meta,...patch}),arrayBuffer:async()=>url.pathname.endsWith('surfels.f32')?(corrupt?new Float32Array(12).buffer:data.buffer):fp.buffer});
await assert.rejects(loadSurfaceFields('http://test/',fetcher({ok:false})),/Incomplete/);
await assert.rejects(loadSurfaceFields('http://test/',fetcher({},true)),/hash mismatch/);
await assert.rejects(loadSurfaceFields('http://test/',fetcher({count:2})),/count mismatch/);
await assert.rejects(loadSurfaceFields('http://test/',async()=>({ok:false,status:404})),/unavailable/);
const result=await loadSurfaceFields('http://test/',fetcher());assert.deepEqual(result.bounds,[[1,2,3],[1,2,3]]);assert.equal(result.meta.count,1);
console.log('surface fields: missing, failed, corrupt and mismatched inputs rejected; valid data preserved');

// A caller changing appearance through the operation must update the visible control.
const definition=(await import('../experiments/surface-fields.experiment.mjs')).default;
const oldFetch=globalThis.fetch;globalThis.fetch=fetcher({radius:.01});
const elements=[];
const document={location:{href:'http://test/'},createElement(tag){const element={tag,value:'',children:[],append(...nodes){this.children.push(...nodes);},setAttribute(){},addEventListener(){}};elements.push(element);return element;}};
const session={attach:async()=>({id:'surface-test'}),setView:v=>v,redraw(){},dispose:async()=>{}};
let experiment;
try{
 experiment=await definition.create({host:{controls:{document},scene:{open:async()=>session}},inputs:{base:'/'},record(){}});
 experiment.mount({root:{append(){}},document,invoke:(name,arg)=>experiment.operations[name](arg)});
 const select=elements.find(e=>e.tag==='select');
 for(const mode of ['normals','plain','opaque']){experiment.operations.setMode(mode);assert.equal(select.value,experiment.read().mode,'appearance selector must show effective mode');}
}finally{await experiment?.dispose();globalThis.fetch=oldFetch;}
