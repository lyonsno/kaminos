import {hierarchyAddressWGSL} from './hierarchy-wgsl.mjs';
export function createHierarchyCollision({device,p,arena,collision,headers,shapes}){
 const a=p.hierarchyArena,owned=[],groups=new WeakMap();
 const make=(size,usage)=>{const b=device.createBuffer({size,usage});owned.push(b);return b;};
 const args=make(16,GPUBufferUsage.COPY_DST|GPUBufferUsage.INDIRECT),blank=make(128,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
 const dummy=device.createTexture({size:[1,1,1],dimension:'3d',format:'r32uint',usage:GPUTextureUsage.TEXTURE_BINDING});
 const code=`${hierarchyAddressWGSL(p)}
 const ROW:u32=${device.limits.maxComputeWorkgroupsPerDimension}u;const H:f32=${p.cellSize};const O=vec3<f32>(${p.origin.join(',')});
 struct Pose {inverse:mat4x4<f32>,local:vec4<f32>,tiles:vec4<u32>,burner0:vec4<f32>,burner1:vec4<f32>}
 @group(0) @binding(0) var<storage,read_write> solid:array<u32>;
 @group(0) @binding(1) var<storage,read_write> headers:array<atomic<u32>>;
 @group(0) @binding(2) var<storage,read_write> arena:array<atomic<u32>>;
 @group(0) @binding(3) var shape:texture_3d<u32>;
 @group(0) @binding(4) var<uniform> pose:Pose;
 ${shapes.burnerWGSL}
 fn job(w:vec3<u32>,lane:u32)->vec2<u32>{let g=w.x+w.y*ROW;let rank=g/8u;if(rank>=atomicLoad(&arena[${a.state+6}u])){return vec2<u32>(0xffffffffu);}let tile=atomicLoad(&arena[${a.collision}u+rank]);let local=(g%8u)*64u+lane;return vec2<u32>(ash_tile_cell(tile,local),local);}
 fn occupied(world:vec3<f32>)->bool{let point=(pose.inverse*vec4<f32>(world,1.0)).xyz;if(pose.tiles.z==1u){return burner_solid(point,pose.local.w,pose.burner0,pose.burner1);}let q=vec3<i32>(floor((point-pose.local.xyz)/pose.local.w));if(any(q<vec3<i32>(0))||any(q>=vec3<i32>(textureDimensions(shape)))){return false;}return textureLoad(shape,q,0).x!=0u;}
 fn occupancy_bounds(world:vec3<f32>,side:f32)->u32{
  if(pose.tiles.z==1u){var covered=occupied(world);var full=true;for(var z=0u;z<2u;z++){for(var y=0u;y<2u;y++){for(var x=0u;x<2u;x++){let v=occupied(world+(vec3<f32>(f32(x),f32(y),f32(z))-.5)*side);covered=covered||v;full=full&&v;}}}return select(0u,1u,covered)|select(0u,2u,full);}
  let center=(pose.inverse*vec4<f32>(world,1.0)).xyz;let halfSide=side*.5;
  let extent=(abs(pose.inverse[0].xyz)+abs(pose.inverse[1].xyz)+abs(pose.inverse[2].xyz))*halfSide;
  let low=vec3<i32>(floor((center-extent-pose.local.xyz)/pose.local.w));let high=vec3<i32>(floor((center+extent-pose.local.xyz)/pose.local.w));let dims=vec3<i32>(textureDimensions(shape));
  if(any(high<vec3<i32>(0))||any(low>=dims)){return 0u;}
  let span=max(1.0,max(max(f32(high.x-low.x+1),f32(high.y-low.y+1)),f32(high.z-low.z+1)));
  let lod=min(u32(floor(log2(span))),textureNumLevels(shape)-1u);let d=vec3<i32>(textureDimensions(shape,i32(lod)));let divisor=i32(1u<<lod);
  let lo=clamp(max(low,vec3<i32>(0))/divisor,vec3<i32>(0),d-1);let hi=clamp(max(high,vec3<i32>(0))/divisor,vec3<i32>(0),d-1);
  var anyOccupied=false;var full=all(low>=vec3<i32>(0))&&all(high<dims);for(var z=lo.z;z<=hi.z;z++){for(var y=lo.y;y<=hi.y;y++){for(var x=lo.x;x<=hi.x;x++){let v=textureLoad(shape,vec3<i32>(x,y,z),i32(lod)).x;anyOccupied=anyOccupied||v!=0u;full=full&&select(v!=0u,(v&0x80000000u)!=0u,lod>0u);}}}return select(0u,1u,anyOccupied)|select(0u,2u,full);
 }
 @compute @workgroup_size(64) fn clear_hierarchy(@builtin(workgroup_id) w:vec3<u32>,@builtin(local_invocation_id) l:vec3<u32>){
  let j=job(w,l.x);if(j.x==0xffffffffu){return;}let c=ash_cell(j.x);solid[j.x]=0u;
  if(j.y<8u){atomicStore(&arena[${a.demand}u+c.tile*8u+j.y],0u);}if(j.y==0u){atomicAnd(&arena[${a.flags}u+c.tile],0xfffffffdu);atomicStore(&headers[c.tile*8u],1u);atomicStore(&headers[c.tile*8u+2u],1u);}
 }
 @compute @workgroup_size(64) fn stamp_hierarchy(@builtin(workgroup_id) w:vec3<u32>,@builtin(local_invocation_id) l:vec3<u32>){
  let j=job(w,l.x);if(j.x==0xffffffffu){return;}let c=ash_cell(j.x);if(c.size==0u){return;}let side=f32(c.size);let center=occupied(O+(vec3<f32>(c.lower)+vec3<f32>(side*.5))*H);var mask=0u;var fullMask=0u;
  for(var z=0u;z<2u;z++){for(var y=0u;y<2u;y++){for(var x=0u;x<2u;x++){let bounds=occupancy_bounds(O+(vec3<f32>(c.lower)+(vec3<f32>(f32(x),f32(y),f32(z))+.5)*side*.5)*H,side*.5*H);let bit=1u<<(x+2u*y+4u*z);if((bounds&1u)!=0u){mask|=bit;}if((bounds&2u)!=0u){fullMask|=bit;}}}}
  if(mask!=0u||center){solid[j.x]=2u;}if(c.size<=1u){return;}let column=mask&5u;var differs=false;
  for(var z=0u;z<2u;z++){for(var x=0u;x<2u;x++){if(((mask>>(x+4u*z))&5u)!=column){differs=true;}}}if(!differs&&!(mask!=0u&&(!center||fullMask!=255u))){return;}
  let octant=ht_child(c.tile,c.lower);atomicMax(&arena[${a.demand}u+c.tile*8u+octant],3u);
  let node=ht_node(c.tile);let low=node.xyz+vec3<u32>(octant%2u,(octant/2u)%2u,octant/4u)*node.w*4u;
  for(var z=-1;z<=1;z++){for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){
   let q=vec3<i32>(low)+vec3<i32>(2+x*4,2+y*4,2+z*4)*i32(node.w);let i=ash_locate(q);if(i==0xffffffffu){continue;}let n=ash_cell(i);var owner=n.tile;
   loop{let at=ht_node(owner);if(at.w>=node.w||owner<HT_ROOTS){break;}owner=atomicLoad(&arena[${a.nodes}u+owner*8u+5u])-1u;}
   atomicMax(&arena[${a.demand}u+owner*8u+ht_child(owner,q)],select(1u,2u,x==0&&y==1&&z==0));
  }}}
 }`;
 const module=device.createShaderModule({code,label:'hierarchical ash cached collider detail'});
 const layout=device.createBindGroupLayout({entries:[0,1,2].map(binding=>({binding,visibility:GPUShaderStage.COMPUTE,buffer:{type:'storage'}})).concat([{binding:3,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:'uint',viewDimension:'3d'}},{binding:4,visibility:GPUShaderStage.COMPUTE,buffer:{type:'uniform'}}])});
 const pl=device.createPipelineLayout({bindGroupLayouts:[layout]}),pipelines=Object.fromEntries(['clear_hierarchy','stamp_hierarchy'].map(entryPoint=>[entryPoint,device.createComputePipeline({layout:pl,compute:{module,entryPoint}})]));
 const group=(texture,uniform)=>device.createBindGroup({layout,entries:[collision,headers,arena].map((buffer,binding)=>({binding,resource:{buffer}})).concat([{binding:3,resource:texture.createView()},{binding:4,resource:{buffer:uniform}}])}),clear=group(dummy,blank);
 return {encode(encoder){encoder.copyBufferToBuffer(arena,a.args*4,args,0,12);const dispatch=(name,g)=>{const pass=encoder.beginComputePass({label:'hierarchy '+name});pass.setPipeline(pipelines[name]);pass.setBindGroup(0,g);pass.dispatchWorkgroupsIndirect(args,0);pass.end();};dispatch('clear_hierarchy',clear);for(const shape of shapes.members()){let g=groups.get(shape);if(!g){g=group(shape.texture??dummy,shape.uniform);groups.set(shape,g);}dispatch('stamp_hierarchy',g);}},read:()=>({allocatedBytes:148}),dispose(){dummy.destroy();for(const b of owned)b.destroy();}};
}
