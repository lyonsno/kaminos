// kaminos-test: node
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {evalWgslBatch,extractWgslFunction,withKaminosGpu} from '../tools/shader-herder.mjs';

const source=readFileSync(new URL('../volume-core.js',import.meta.url),'utf8');
const predictor=extractWgslFunction(source,'csTransportPredict').replace('@builtin(global_invocation_id) ','');
function evaluation(noActivity, materialOnly=false, kernel=predictor) {
  return {argTypes:['u32'],returnType:'vec4<f32>',inputs:[[0],[1]],
    preamble:`const GRID=1u; const GRID_Y=1u; const SLOTS_PER_CELL=4u;
      const SHRED_ONLY=true; const NO_ACTIVITY=${noActivity}; const MATERIAL_ONLY=${materialOnly}; const VELOCITY_ONLY=false;
      struct Controls { fire_smoke_curl_speed:vec4<f32>, scene_controls:vec4<f32>, emissive_physics:vec4<f32>, reactant_combustion_c:vec4<f32>, transport_controls:vec4<f32> }
      var<private> u:Controls;
      var<private> fluidSrc:array<vec4<f32>,4>;
      var<private> fluidPredict:array<vec4<f32>,4>;
      var<private> calls:vec4<f32>;
      fn seatGridShape() {}
      fn index3(c:vec3<u32>)->u32{return 0u;}
      fn sceneSolidAt(c:vec3<i32>)->bool{return false;}
      fn centreVelocityAt(c:vec3<i32>)->vec3<f32>{return vec3<f32>(0);}
      fn materialTransportVelocity(c:vec3<f32>,v:vec3<f32>)->vec3<f32>{return v;}
      fn dynamicsBacktraceScale()->f32{return 1.0;}
      fn sceneClipCharacteristic(a:vec3<f32>,b:vec3<f32>)->vec3<f32>{return b;}
      fn sampleFluidSlotInflow(c:vec3<f32>,slot:u32)->vec4<f32>{calls[slot]+=1.0;return vec4<f32>(2,3,4,5);}
      fn sampleFluidSlotInflowWith(c:vec3<f32>,slot:u32,stored:bool)->vec4<f32>{return sampleFluidSlotInflow(c,slot);}
      fn compactAppearanceOn()->bool{return false;}
      fn fastBypassOn()->bool{return false;}
      fn reactantLawOn()->bool{return true;}
      fn sampleReactantOxidizer(c:vec3<f32>)->f32{return 1.0;}
      ${kernel}`,
    body:`u.transport_controls.x=3.0;calls=vec4<f32>(0);fluidPredict[3]=vec4<f32>(99);
      csTransportPredict(vec3<u32>(0));
      return vec4<f32>(calls.x,calls.y,calls.w,select(fluidPredict[3].y,fluidPredict[0].w,arg0==1u));`};
}
test('production predictor skips activity sampling and clears stale activity in no-activity mode',async()=>{
  await withKaminosGpu(async ctx=>{
    assert.deepEqual(await evalWgslBatch(ctx,evaluation(false)),[[1,1,1,3],[1,1,1,1]]);
    assert.deepEqual(await evalWgslBatch(ctx,evaluation(true)),[[1,1,0,0],[1,1,0,1]]);
    assert.deepEqual(await evalWgslBatch(ctx,evaluation(false,true)),[[0,1,1,3],[0,1,1,1]]);
    assert.deepEqual(await evalWgslBatch(ctx,evaluation(true,true)),[[0,1,0,0],[0,1,0,1]]);
    // Valid WGSL fault: accidentally executing the retained Shred path must fail numerically.
    const wrong=await evalWgslBatch(ctx,evaluation(false));
    assert.throws(()=>assert.deepEqual(wrong,[[1,1,0,0],[1,1,0,1]]));
  });
});
