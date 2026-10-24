// kaminos-test: node
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import definition from '../experiments/brazier-lighting.experiment.mjs';
const data=new Float32Array([0,0,0,0,1,0,.5,.5,.5,0,.8,1]),fp=new Float32Array([1,0,0,.01,0,0,1,.01]);
const positions=new Float32Array([0,0,0,1,0,0,0,0,1]),indices=new Uint32Array([0,1,2]);
const hash=a=>createHash('sha256').update(Buffer.from(a.buffer)).digest('hex');
const originalFetch=globalThis.fetch;
globalThis.fetch=async url=>({ok:true,json:async()=>String(url).includes('/shadow/')?{ok:true,vertices:3,triangles:1,files:{'positions.f32':hash(positions),'triangles.u32':hash(indices)}}:{ok:true,stride:12,count:1,radius:.01,dataSHA256:hash(data),footprints:{stride:8,file:'footprints.f32',sha256:hash(fp)}},arrayBuffer:async()=>String(url).endsWith('positions.f32')?positions.buffer:String(url).endsWith('triangles.u32')?indices.buffer:String(url).endsWith('surfels.f32')?data.buffer:fp.buffer});
// Native assay-entry-013 observed selection removal rejecting the unretained experiment room.
let sources=[],selected,fail=false,sequence=0,roomMounted=false;
globalThis.kaminosSceneAuthoring={read:()=>({objects:sources}),setFireSettings(id,axis,patch){sources.find(s=>s.id===id).emissionEnabled=patch.enabled;}};
globalThis.kaminosSelection={remove(){if(roomMounted)throw Error('Scene member has no retained source');sources=sources.filter(s=>s.id!==selected);}};
globalThis.kaminosFlameDomain={set(){}};
globalThis.kaminosFlameAuthoring={async apply(){if(fail)throw Error('injected settings failure');}};
const runtime={setSimulationPaused(){},debugState:()=>({})};
const host={controls:{document:{location:{href:'http://test/'}}},scene:{open:async()=>({attach:async()=>{roomMounted=true;return {id:'room'};},setView(){},dispose:async()=>{roomMounted=false;}}),select:id=>selected=id,setTransform(){}},fire:{async add(){const row={id:'source-'+sequence++,type:'flame-emitter',emissionEnabled:sources[0]?.emissionEnabled??true};sources.push(row);return row.id;},settings:()=>({domControls:{}})},volume:{get:()=>runtime},rendering:{gi(){},readGI:()=>({})}};
const open=()=>definition.create({host,inputs:{base:'/fields/',shadow:'/shadow/',presetId:'fixture'},record(){}});
try{
 let e=await open();assert.equal(sources.length,2);await e.dispose();assert.equal(sources.length,0,'closing must remove owned sources');
 e=await open();assert.equal(sources.length,2);assert(sources.every(s=>s.emissionEnabled));await e.dispose();
 fail=true;await assert.rejects(open(),/injected settings failure/);assert.equal(sources.length,0,'failed creation must remove its source');
}finally{globalThis.fetch=originalFetch;}
console.log('brazier source lifecycle: close/reopen and failed creation clean up owned records');
