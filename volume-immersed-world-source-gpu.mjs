import {createGPUInputSlots} from './volume-inlet-perturbation-gpu.mjs';
const cachedPipelines=new WeakMap();
const CODE=/* wgsl */`
struct SourceDefinition {range:vec4<u32>,supply:vec4<f32>,velocityPuff:vec4<f32>,extra:vec4<f32>}
struct SourceCell {positionWeight:vec4<f32>,source:vec4<u32>}
struct SourceParcel {loRate:vec4<f32>,hiFuel:vec4<f32>,velocityRelax:vec4<f32>,heat:vec4<f32>}
struct SourceSupport {lo:vec4<f32>,hi:vec4<f32>,supply:vec4<f32>}
struct SourceMapping {fine:vec4<f32>,shape:vec4<f32>}
@group(0) @binding(0) var<uniform> mapping:SourceMapping;
@group(0) @binding(1) var<storage,read> definitions:array<SourceDefinition>;
@group(0) @binding(2) var<storage,read> cells:array<SourceCell>;
@group(0) @binding(3) var collection:texture_2d_array<f32>;
@group(0) @binding(4) var<storage,read_write> parcels:array<SourceParcel>;
@group(0) @binding(5) var<storage,read_write> bounds:array<atomic<u32>>;
@group(0) @binding(6) var<storage,read_write> supports:array<SourceSupport>;
@group(0) @binding(7) var<storage,read> normalization:array<vec4<f32>>;
@group(0) @binding(8) var<storage,read> counts:array<u32>;
fn ordered(value:f32)->u32{let bits=bitcast<u32>(value);return select(bits^0x80000000u,~bits,(bits&0x80000000u)!=0u);}
fn unordered(value:u32)->f32{return bitcast<f32>(select(~value,value^0x80000000u,(value&0x80000000u)!=0u));}
@compute @workgroup_size(64) fn clearSourceBounds(@builtin(global_invocation_id) gid:vec3<u32>,@builtin(num_workgroups) groups:vec3<u32>){
 let i=gid.x+gid.y*groups.x*64u;if(i>=arrayLength(&definitions)){return;}for(var a=0u;a<3u;a++){atomicStore(&bounds[i*8u+a],0xffffffffu);atomicStore(&bounds[i*8u+3u+a],0u);}atomicStore(&bounds[i*8u+6u],0u);
}
@compute @workgroup_size(64) fn updateExteriorSources(@builtin(global_invocation_id) gid:vec3<u32>,@builtin(num_workgroups) groups:vec3<u32>){
 let i=gid.x+gid.y*groups.x*64u;if(i>=counts[0]){return;}let cell=cells[i];let s=definitions[cell.source.x];var result:SourceParcel;
 result.loRate=vec4<f32>(0);result.hiFuel=vec4<f32>(0);result.velocityRelax=vec4<f32>(0);result.heat=vec4<f32>(0);
 let grid=u32(mapping.shape.x);let uv=vec2<i32>(i32(cell.source.y%grid),i32(cell.source.y/grid)+1);let layer=i32(s.range.x);
 let noise=textureLoad(collection,uv,layer,0).y;var puff=1.0;if(s.velocityPuff.w>0.0){puff=textureLoad(collection,vec2<i32>(0,1),layer,0).w;}
 let weight=cell.positionWeight.w*max(0.0,1.0+s.extra.x*noise);let rate=min(s.supply.w,weight*normalization[cell.source.x].y*puff);
 if(rate>0.0){let pitch=mapping.shape.w*mapping.fine.w;let lo=mapping.fine.xyz+(cell.positionWeight.xyz*mapping.shape.w-1.0)*mapping.fine.w;let hi=lo+pitch;
  result.loRate=vec4<f32>(lo,rate);result.hiFuel=vec4<f32>(hi,s.supply.z);result.velocityRelax=vec4<f32>(s.velocityPuff.xyz*pitch,min(1.0,weight*s.extra.y));result.heat=vec4<f32>(s.supply.y,0,0,0);
  for(var a=0u;a<3u;a++){atomicMin(&bounds[cell.source.x*8u+a],ordered(lo[a]));atomicMax(&bounds[cell.source.x*8u+3u+a],ordered(hi[a]));}atomicAdd(&bounds[cell.source.x*8u+6u],1u);
 }parcels[i]=result;
}
@compute @workgroup_size(64) fn finishSourceBounds(@builtin(global_invocation_id) gid:vec3<u32>,@builtin(num_workgroups) groups:vec3<u32>){
 let i=gid.x+gid.y*groups.x*64u;if(i>=arrayLength(&definitions)){return;}var result:SourceSupport;result.lo=vec4<f32>(0);result.hi=result.lo;result.supply=result.lo;
 if(atomicLoad(&bounds[i*8u+6u])>0u){for(var a=0u;a<3u;a++){result.lo[a]=unordered(atomicLoad(&bounds[i*8u+a]));result.hi[a]=unordered(atomicLoad(&bounds[i*8u+3u+a]));}let s=definitions[i];result.supply=vec4<f32>(s.supply.y,s.supply.z,0,0);}supports[i]=result;
}
`;
export function createGPUImmersedWorldSources(device){
 const U=GPUBufferUsage,owned=new Set();let packet=null,key=null,definitionKey=null,activeGrid=0,activeHeight=0,definitions=null,parcels=null,supports=null,bounds=null,capacity=-1,worldCount=0,sourceCount=0,inputs=null,inputGeometry=null,inputTexture=null,destroyed=false;
 const make=(label,size)=>{const b=device.createBuffer({label,size:Math.max(size,16),usage:U.STORAGE|U.COPY_DST|U.COPY_SRC});owned.add(b);return b;};
 const retire=items=>queueMicrotask(()=>{const done=()=>{for(const b of items)if(b&&owned.delete(b))b.destroy();};device.queue.onSubmittedWorkDone().then(done,done);});
 if(!cachedPipelines.has(device)){const module=device.createShaderModule({label:'GPU exterior source supply',code:CODE});cachedPipelines.set(device,Object.fromEntries(['clearSourceBounds','updateExteriorSources','finishSourceBounds'].map(entryPoint=>[entryPoint,device.createComputePipeline({label:entryPoint,layout:'auto',compute:{module,entryPoint}})])));}const pipelines=cachedPipelines.get(device);
 const dispatch=(encoder,label,pipeline,group,count,indirect)=>{const pass=encoder.beginComputePass({label});pass.setPipeline(pipeline);pass.setBindGroup(0,group);if(indirect)pass.dispatchWorkgroupsIndirect(indirect,4);else{const work=Math.ceil(count/64),x=Math.min(work,device.limits.maxComputeWorkgroupsPerDimension);pass.dispatchWorkgroups(x,Math.ceil(work/Math.max(x,1)));}pass.end();};
 let clearGroup,finishGroup;
 return{
  update(next,shape){
   if(destroyed)throw Error('GPU exterior sources disposed');const nextKey=[shape.grid,shape.gridHeight].join(':');if(packet===next&&key===nextKey)return;
   const defs=new ArrayBuffer(Math.max(1,next?.count??0)*64),df=new Float32Array(defs),du=new Uint32Array(defs);let admitted=0;
   for(const [index,source]of(next?.sources??[]).entries()){
    const e=source.config.effective;if(!source.worldSource||!e.admitted)continue;admitted++;const settings=source.config.requested?.inletDynamics??e.inletDynamics??{};
    du.set([index+1,0,0,1],index*16);df.set([0,e.temperature,e.fuel,e.capPerCell],index*16+4);df.set([...e.direction.map(v=>v*e.speed),settings.puff??0],index*16+8);df.set([settings.turbulence??0,e.momentumGain,0,0],index*16+12);
   }
   for(const bytes of[defs.byteLength,Math.max(1,next?.count??0)*48])if(bytes>device.limits.maxStorageBufferBindingSize||bytes>device.limits.maxBufferSize)throw Error('Exterior source definitions exceed GPU storage limits');
   const nextDefinitionKey=nextKey+':'+Array.from(du).join(':');if(definitionKey===nextDefinitionKey){packet=next;return;}definitionKey=nextDefinitionKey;
   packet=next;key=nextKey;activeGrid=shape.grid;activeHeight=shape.gridHeight;sourceCount=next?.count??0;worldCount=admitted;inputs?.destroy();inputs=null;
   const previous=[definitions,supports,bounds];definitions=make('GPU exterior source definitions',defs.byteLength);supports=make('GPU exterior source supports',Math.max(1,sourceCount)*48);bounds=make('GPU exterior source bound reduction',Math.max(1,sourceCount)*32);device.queue.writeBuffer(definitions,0,defs);retire(previous);
   clearGroup=device.createBindGroup({layout:pipelines.clearSourceBounds.getBindGroupLayout(0),entries:[{binding:1,resource:{buffer:definitions}},{binding:5,resource:{buffer:bounds}}]});finishGroup=device.createBindGroup({layout:pipelines.finishSourceBounds.getBindGroupLayout(0),entries:[{binding:1,resource:{buffer:definitions}},{binding:5,resource:{buffer:bounds}},{binding:6,resource:{buffer:supports}}]});
  },
  encode(encoder,{mapping,collection,step}){
   if(collection.packet!==packet||collection.encodedStep!==step)throw Error('Exterior source input does not match this source frame');const geometry=collection.geometry,maximum=geometry.activeMaxParcels;
   if(capacity<geometry.maxParcels){const bytes=Math.max(1,geometry.maxParcels)*64;if(bytes>device.limits.maxStorageBufferBindingSize||bytes>device.limits.maxBufferSize)throw Error('Exterior source parcels exceed GPU storage limits');const old=parcels;parcels=make('GPU exterior source parcels',bytes);capacity=geometry.maxParcels;retire([old]);inputs?.destroy();inputs=null;}
   if(inputGeometry!==geometry||inputTexture!==collection.texture){inputs?.destroy();inputs=null;inputGeometry=geometry;inputTexture=collection.texture;}
   if(maximum){
    inputs??=createGPUInputSlots(device,'GPU exterior source mapping',32,buffer=>device.createBindGroup({layout:pipelines.updateExteriorSources.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer}},{binding:1,resource:{buffer:definitions}},{binding:2,resource:{buffer:geometry.cells}},{binding:3,resource:collection.texture.createView({dimension:'2d-array'})},{binding:4,resource:{buffer:parcels}},{binding:5,resource:{buffer:bounds}},{binding:7,resource:{buffer:geometry.stats}},{binding:8,resource:{buffer:geometry.counts}}]}));
    const data=new Float32Array([...mapping.fineToField,activeGrid,activeHeight,activeGrid,2/activeGrid]);dispatch(encoder,'GPU exterior source bound reset',pipelines.clearSourceBounds,clearGroup,sourceCount);dispatch(encoder,'GPU exterior source parcels',pipelines.updateExteriorSources,inputs.lease(encoder,data),0,geometry.counts);dispatch(encoder,'GPU exterior source supports',pipelines.finishSourceBounds,finishGroup,sourceCount);
   }
   return{count:worldCount,gpu:{parcels,supports,parcelCount:maximum?null:0,maxParcels:maximum,counts:geometry.counts,supportCount:maximum?sourceCount:0,sourceStep:step,backend:'gpu-resident-immersed-source'},parcels:[],supports:[]};
  },
  destroy(){if(destroyed)return;destroyed=true;inputs?.destroy();retire([...owned]);},
 };
}
