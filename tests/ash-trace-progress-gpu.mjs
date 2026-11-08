// kaminos-test: node
import assert from 'node:assert/strict';
import {withKaminosGpu,runInstrumentedCompute} from '../tools/shader-herder.mjs';
import {hierarchyTraceWGSL} from '../ash/hierarchy-trace.mjs';

// A finest-cell sampler isolates f32 boundary arithmetic without allocating a
// dense 256³ field. The production traversal still controls every cell visit.
const code=`
struct Params {dims:vec4<u32>,origin:vec4<f32>}
const p=Params(vec4<u32>(256),vec4<f32>(0,0,0,1));
struct AshCell {lower:vec3<i32>,size:u32}
var<private> query:vec3<i32>;
fn index(q:vec3<u32>)->u32 {query=vec3<i32>(q);return 0u;}
fn ash_cell(j:u32)->AshCell {return AshCell(query,1u);}
@group(0) @binding(0) var<storage,read_write> output:array<vec4<i32>>;
@group(0) @binding(1) var<storage,read_write> density:array<atomic<u32>>;
@group(0) @binding(2) var<storage,read> solid:array<u32>;
${hierarchyTraceWGSL}
@compute @workgroup_size(1) fn main(){
 let start=vec3<f32>(128.02499389648438,128.39991760253906,10.5);
 let end=start+vec3<f32>(-.05000000074505806,-.800000011920929,0);
 output[0]=ash_trace_segment(start,end);
 output[1]=vec4<i32>(i32(ash_trace_visits),0,0,0);
}`;
await withKaminosGpu(async ctx=>{
 const {device,GPUBufferUsage:U}=ctx,owned=[];
 const make=size=>{const b=device.createBuffer({size,usage:U.STORAGE|U.COPY_SRC|U.COPY_DST});owned.push(b);return b;};
 try{
  const buffers=[make(32),make(4),make(4)];
  // This segment crosses only one X and one Y boundary (three cells). The
  // tripwire catches revisiting, and fails rather than accepting cut-off work.
  const result=await runInstrumentedCompute(ctx,{code,entryPoint:'main',workgroups:[1,1,1],maxLoopIterations:8,maxThreadIterations:64,outputBuffer:buffers[0],outputBufferSize:32,bindings:buffers.map((buffer,binding)=>({binding,resource:{buffer}}))});
  const values=Array.from(new Int32Array(result.outputBuffer));
  assert.deepEqual(values.slice(0,4),[0,0,0,0]);assert.equal(values[4],3,'a nearly coincident corner crossing visits each cell once');
  console.log(JSON.stringify({roundingCorner:values,telemetry:result.telemetry}));
 }finally{for(const b of owned)b.destroy();}
});
