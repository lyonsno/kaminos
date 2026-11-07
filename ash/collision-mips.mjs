const pipelines=new WeakMap();
export function occupancyMipLevels(grid){return Math.floor(Math.log2(grid))+1;}
export function occupancyMipBytes(grid){let bytes=0;for(let n=0;n<occupancyMipLevels(grid);n++)bytes+=Math.max(1,grid>>n)**3*4;return bytes;}
// Maximum occupancy preserves narrow features between coarse point samples.
// Odd edge texels belong to the last parent rather than falling out of the tree.
export function encodeOccupancyMips(device,encoder,texture,grid){
 let resources=pipelines.get(device);
 if(!resources){
  const module=device.createShaderModule({label:'ash collider maximum mip',code:`
   @group(0) @binding(0) var source:texture_3d<u32>;
   @group(0) @binding(1) var targetMip:texture_storage_3d<r32uint,write>;
   @compute @workgroup_size(4,4,4) fn reduce(@builtin(global_invocation_id) c:vec3<u32>){
    let dims=textureDimensions(targetMip);if(any(c>=dims)){return;}let sourceDims=textureDimensions(source);let low=c*2u;var high=min(low+2u,sourceDims);
    for(var axis=0u;axis<3u;axis++){if(c[axis]+1u==dims[axis]){high[axis]=sourceDims[axis];}}
    var occupied=0u;for(var z=low.z;z<high.z;z++){for(var y=low.y;y<high.y;y++){for(var x=low.x;x<high.x;x++){occupied=max(occupied,textureLoad(source,vec3<i32>(i32(x),i32(y),i32(z)),0).x);}}}
    textureStore(targetMip,vec3<i32>(c),vec4<u32>(occupied));
   }`});
  const layout=device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:'uint',viewDimension:'3d'}},{binding:1,visibility:GPUShaderStage.COMPUTE,storageTexture:{access:'write-only',format:'r32uint',viewDimension:'3d'}}]});
  const pipeline=device.createComputePipeline({layout:device.createPipelineLayout({bindGroupLayouts:[layout]}),compute:{module,entryPoint:'reduce'}});resources={layout,pipeline};pipelines.set(device,resources);
 }
 for(let level=1;level<occupancyMipLevels(grid);level++){
  const group=device.createBindGroup({layout:resources.layout,entries:[{binding:0,resource:texture.createView({baseMipLevel:level-1,mipLevelCount:1})},{binding:1,resource:texture.createView({baseMipLevel:level,mipLevelCount:1})}]});
  const pass=encoder.beginComputePass({label:'ash cached collider mip '+level});pass.setPipeline(resources.pipeline);pass.setBindGroup(0,group);const groups=Math.ceil(Math.max(1,grid>>level)/4);pass.dispatchWorkgroups(groups,groups,groups);pass.end();
 }
}
