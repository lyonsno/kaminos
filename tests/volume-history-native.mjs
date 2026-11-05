// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {HISTORY_ALLOCATION_WGSL,createRayAllocationHistory} from '../volume-history-allocation.mjs';
import {withKaminosGpu,evalWgslBatch,extractWgslFunction} from '../tools/shader-herder.mjs';

// Execute the production weighting function with controlled geometric/support
// inputs. No source-wording assertion can establish its numerical behavior.
const weightSource=extractWgslFunction(HISTORY_ALLOCATION_WGSL,'guidanceWeight');
const preamble=`
override OPTICAL_STEP_MODE:u32=6u;
struct HistoryGeometry {loPitch:vec4<f32>,dimsCells:vec4<u32>,controls:vec4<f32>}
var<private> rayGuidance:HistoryGeometry;
struct World {atlas:vec4<f32>}; var<private> worldRender:World;
var<private> score:f32;
fn worldInsideFine(p:vec3<f32>)->bool{return p.x>0.;}
fn worldResidentLeafBounds(p:vec3<f32>,n:ptr<function,vec4<f32>>)->vec4<f32>{return vec4<f32>(0);}
fn joinProposal(p:vec3<f32>)->f32{return 0.;}
fn previousGuidance(p:vec3<f32>)->f32{return score;}
${weightSource}`;

test('production history weight responds to influence, zero matches joins, and one preserves prior weight',async()=>{
 const options={preamble,argTypes:['f32','f32','f32'],returnType:'f32',
  body:'rayGuidance.controls=vec4<f32>(arg0,0.,1.,0.);score=arg1;return guidanceWeight(vec3<f32>(arg2,0.,0.));',
  inputs:[[0,.5,1],[1,.5,1],[2,.5,1],[0,.5,-1],[1,0,1],[1,1,1]]};
 await withKaminosGpu(async ctx=>{
  const actual=await evalWgslBatch(ctx,options);
  const expected=[2,18.65,36.65,.25,.65,36.65];
  actual.forEach((v,i)=>assert.ok(Math.abs(v-expected[i])<1e-4,`${i}: ${v} != ${expected[i]}`));
  const broken=preamble.replace('36.0*rayGuidance.controls.x*hist','36.0*hist');
  assert.notEqual(broken,preamble,'negative control must change the executed production expression');
  const wrong=await evalWgslBatch(ctx,{...options,preamble:broken});
  assert.notDeepEqual(wrong,actual);
 },{wgslSources:[{code:preamble+'\n@compute @workgroup_size(1) fn main(){_=guidanceWeight(vec3<f32>(0));}',entryPoint:'main'}]});
});

test('actual history banks carry decayed importance only for a longer window, with fixed storage',async()=>{
 await withKaminosGpu(async ctx=>{
  const h=createRayAllocationHistory(ctx.device);
  const box={min:[0,0,0],max:[1,1,1],dims:[1,1,1]};
  const draw=options=>{const e=ctx.device.createCommandEncoder();const state=h.prepare(e,box,'same',1,options);ctx.device.queue.submit([e.finish()]);return state;};
  try{
   draw({window:1});ctx.device.queue.writeBuffer(h.buffer,h.read().observationsOffset,new Uint32Array([50000]));
   draw({window:8});const carried=await h.sample();
   assert.equal(carried.previous[0],50000);
   assert.ok(carried.observations[0]>40000&&carried.observations[0]<50000,'longer memory carries a decayed peak');
   const bytes=h.buffer.size;
   draw({window:8});const older=await h.sample();assert.ok(older.observations[0]<carried.observations[0]);
   const frozen=draw({window:8,freeze:true});const held=await h.sample();assert.deepEqual(held.observations,older.observations);assert.equal(frozen.frozen,true);
   draw({window:1});assert.equal((await h.sample()).observations[0],0,'one frame restores previous-draw-only behavior');
   assert.equal(h.buffer.size,bytes,'window length does not allocate history slices');
   h.reset();draw({window:8});assert.equal((await h.sample()).observations[0],0,'reset never resurrects stale history');
  }finally{h.dispose();}
 });
});
