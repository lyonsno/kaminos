import {refinementVertexWGSL} from './refinement-surface.mjs';
// Four corner directions/coverage occupy the existing 96 bits of flux scratch
// per finest cell after a step. Coarser cells keep the reference reconstruction.
import {ashCornerPackingWGSL} from './corner-packing.mjs';
export async function createAshLightingCache({device,p,arena,mass,solid,faces,work,headers,next,limits}){
 const code=refinementVertexWGSL(p,arena)+ashCornerPackingWGSL+`
 @group(0) @binding(0) var<storage,read> density:array<f32>;
 @group(0) @binding(1) var<storage,read> collision:array<u32>;
 @group(0) @binding(2) var<storage,read> faceData:array<u32>;
 @group(0) @binding(3) var<storage,read> tree:array<u32>;
 @group(0) @binding(4) var<storage,read> tileState:array<u32>;
 @group(0) @binding(5) var<storage,read_write> scratch:array<u32>;
 @group(0) @binding(6) var<storage,read_write> pairs:array<u32>;
 @compute @workgroup_size(64) fn cache_lighting(@builtin(workgroup_id) w:vec3<u32>,@builtin(local_invocation_id) lane:vec3<u32>){
  let group=w.x+w.y*65535u;let rank=group/8u;if(rank>=tree[${arena.stats+1}u]){return;}
  let tile=tree[${arena.surface}u+rank];let i=ash_tile_cell(tile,(group%8u)*64u+lane.x,&tree);if(i==0xffffffffu){return;}
  let c=ash_cell(i,&tree);if(!c.owned||c.size!=1u||density[i]<=0.0){return;}
  let top=f32(c.lower.y)+density[i];let above=ash_locate(c.lower+vec3<i32>(0,1,0),&tree);
  var capped=false;if(above!=0xffffffffu){capped=collision[above]!=0u||density[above]>0.0001;}
  var packed:array<u32,4>;
  for(var n=0u;n<4u;n++){
   var value=vec4<f32>(top,1.0,0.0,0.0);
   if(!capped){value=ash_refined_corner(c.lower.xz+vec2<i32>(i32(n&1u),i32(n>>1u)),top,&density,&collision,&tree);}
   packed[n]=ash_pack_corner(value);
  }
  scratch[i]=packed[0]|(packed[1]<<24u);pairs[i*2u]=(packed[1]>>8u)|(packed[2]<<16u);pairs[i*2u+1u]=(packed[2]>>16u)|(packed[3]<<8u);
 }`;
 const module=device.createShaderModule({code,label:'ash changed finest corner lighting'});
 const errors=(await module.getCompilationInfo()).messages.filter(m=>m.type==='error');if(errors.length)throw Error(errors.map(m=>m.message).join('; '));
 const layout=device.createBindGroupLayout({entries:[mass,solid,faces,work,headers,next,limits].map((_,binding)=>({binding,visibility:GPUShaderStage.COMPUTE,buffer:{type:binding>=5?'storage':'read-only-storage'}}))});
 const pipeline=await device.createComputePipelineAsync({layout:device.createPipelineLayout({bindGroupLayouts:[layout]}),compute:{module,entryPoint:'cache_lighting'}});
 const group=device.createBindGroup({layout,entries:[mass,solid,faces,work,headers,next,limits].map((buffer,binding)=>({binding,resource:{buffer}}))});
 return {encode(encoder,args){const pass=encoder.beginComputePass({label:'ash changed finest lighting'});pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroupsIndirect(args,0);pass.end();}};
}
