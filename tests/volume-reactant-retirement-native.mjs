// kaminos-test: node
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {evalWgslBatch,extractWgslFunction,withKaminosGpu} from '../tools/shader-herder.mjs';

const source=readFileSync(new URL('../volume-core.js',import.meta.url),'utf8');
const predictor=extractWgslFunction(source,'csTransportPredict').replace('@builtin(global_invocation_id) ','');
await withKaminosGpu(async ctx=>{
 for(const materialOnly of [false,true]){
  const result=await evalWgslBatch(ctx,{
   argTypes:['u32'],returnType:'vec4<f32>',inputs:[[0],[1]],
   preamble:`const GRID=1u;const GRID_Y=1u;const SLOTS_PER_CELL=4u;
    const MATERIAL_ONLY=${materialOnly};const VELOCITY_ONLY=false;
    struct Controls{transport_controls:vec4<f32>}
    var<private> u:Controls;var<private> fluidPredict:array<vec4<f32>,4>;
    var<private> calls:vec4<f32>;
    fn seatGridShape(){}
    fn index3(c:vec3<u32>)->u32{return 0u;}
    fn sceneSolidAt(c:vec3<i32>)->bool{return false;}
    fn centreVelocityAt(c:vec3<i32>)->vec3<f32>{return vec3<f32>(0);}
    fn materialTransportVelocity(c:vec3<f32>,v:vec3<f32>)->vec3<f32>{return v;}
    fn dynamicsBacktraceScale()->f32{return 1.0;}
    fn sceneClipCharacteristic(a:vec3<f32>,b:vec3<f32>)->vec3<f32>{return b;}
    fn reactantLawOn()->bool{return true;}
    fn sampleReactantOxidizer(c:vec3<f32>)->f32{return 0.75;}
    fn sampleFluidSlotInflow(c:vec3<f32>,slot:u32)->vec4<f32>{calls[slot]+=1.0;return vec4<f32>(2,3,4,5);}
    ${predictor}`,
   body:`calls=vec4<f32>(0);u.transport_controls.x=3.0;fluidPredict[2]=vec4<f32>(99);
    csTransportPredict(vec3<u32>(0));
    if(arg0==0u){return calls;}
    return vec4<f32>(fluidPredict[0].w,fluidPredict[1].x,fluidPredict[2].x,fluidPredict[3].y);`,
  });
  assert.deepEqual(result,[[materialOnly?0:1,1,0,1],[0.75,2,0,3]]);
 }
});
