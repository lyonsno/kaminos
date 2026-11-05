import {adaptiveAddressWGSL} from './adaptive-wgsl.mjs';
// Cached local occupancy is shared with coarse stamping. Only GPU-selected dirty
// fine bricks are cleared/stamped; unchanged static contacts do no fine work.
export function createAdaptiveCollision({device,p,arena,collision,headers,shapes}){
 const a=p.adaptiveArena,owned=[],groups=new WeakMap();
 const args=device.createBuffer({label:'ash adaptive collision dispatch',size:16,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.INDIRECT});owned.push(args);
 const dummy=device.createTexture({size:[1,1,1],dimension:'3d',format:'r32uint',usage:GPUTextureUsage.TEXTURE_BINDING});
 const blank=device.createBuffer({size:128,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});owned.push(blank);
 const code=`${adaptiveAddressWGSL(p,a)}
 const ROW:u32=${device.limits.maxComputeWorkgroupsPerDimension}u;
 const O=vec3<f32>(${p.origin.join(',')});const H:f32=${p.cellSize};
 struct Pose {inverse:mat4x4<f32>,local:vec4<f32>,tiles:vec4<u32>,burner0:vec4<f32>,burner1:vec4<f32>}
 @group(0) @binding(0) var<storage,read_write> solid:array<u32>;
 @group(0) @binding(1) var<storage,read_write> headers:array<atomic<u32>>;
 @group(0) @binding(2) var<storage,read_write> arena:array<atomic<u32>>;
 @group(0) @binding(3) var shape:texture_3d<u32>;
 @group(0) @binding(4) var<uniform> pose:Pose;
 ${shapes.burnerWGSL}
 fn fine_index(w:vec3<u32>,lane:u32)->u32{let g=w.x+w.y*ROW;let rank=g/8u;if(rank>=atomicLoad(&arena[${a.state+6}u])){return 0xffffffffu;}let slot=atomicLoad(&arena[${a.collision}u+rank]);return AP_OFFSET+slot*AP_CELLS+(g%8u)*64u+lane;}
 @compute @workgroup_size(64) fn clear_fine(@builtin(workgroup_id) w:vec3<u32>,@builtin(local_invocation_id) l:vec3<u32>){
  let i=fine_index(w,l.x);if(i==0xffffffffu){return;}solid[i]=0u;let slot=(i-AP_OFFSET)/AP_CELLS;if((i-AP_OFFSET)%AP_CELLS==0u){atomicAnd(&arena[${a.flags}u+slot],0xfffffffdu);let t=AP_TILES+slot;atomicStore(&headers[t*8u],1u);atomicStore(&headers[t*8u+2u],1u);}
 }
 @compute @workgroup_size(64) fn stamp_fine(@builtin(workgroup_id) w:vec3<u32>,@builtin(local_invocation_id) l:vec3<u32>){
  let i=fine_index(w,l.x);if(i==0xffffffffu){return;}let c=ash_cell(i);if(!c.owned){return;}
  let point=(pose.inverse*vec4<f32>(O+(vec3<f32>(c.lower)+vec3<f32>(.5))*H,1)).xyz;
  if(pose.tiles.z==1u){if(burner_solid(point,pose.local.w,pose.burner0,pose.burner1)){solid[i]=2u;}return;}
  let q=vec3<i32>(floor((point-pose.local.xyz)/pose.local.w));if(any(q<vec3<i32>(0))||any(q>=vec3<i32>(textureDimensions(shape)))){return;}
  if(textureLoad(shape,q,0).x!=0u){solid[i]=2u;}
 }`;
 const module=device.createShaderModule({code,label:'adaptive ash fine collision'});
 const layout=device.createBindGroupLayout({entries:[0,1,2].map(binding=>({binding,visibility:GPUShaderStage.COMPUTE,buffer:{type:'storage'}})).concat([{binding:3,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:'uint',viewDimension:'3d'}},{binding:4,visibility:GPUShaderStage.COMPUTE,buffer:{type:'uniform'}}])});
 const pl=device.createPipelineLayout({bindGroupLayouts:[layout]});
 const pipelines=Object.fromEntries(['clear_fine','stamp_fine'].map(entryPoint=>[entryPoint,device.createComputePipeline({layout:pl,compute:{module,entryPoint}})]));
 const group=(texture,uniform)=>device.createBindGroup({layout,entries:[collision,headers,arena].map((buffer,binding)=>({binding,resource:{buffer}})).concat([{binding:3,resource:texture.createView()},{binding:4,resource:{buffer:uniform}}])});
 const clear=group(dummy,blank);
 return {encode(encoder){
  encoder.copyBufferToBuffer(arena,a.args*4,args,0,12);
  const dispatch=(name,g)=>{const pass=encoder.beginComputePass({label:'adaptive ash '+name});pass.setPipeline(pipelines[name]);pass.setBindGroup(0,g);pass.dispatchWorkgroupsIndirect(args,0);pass.end();};
  dispatch('clear_fine',clear);
  for(const shape of shapes.members()){
   let g=groups.get(shape);if(!g){g=group(shape.texture??dummy,shape.uniform);groups.set(shape,g);}dispatch('stamp_fine',g);
  }
 },read:()=>({allocatedBytes:args.size+blank.size+4}),dispose(){dummy.destroy();for(const b of owned)b.destroy();}};
}
