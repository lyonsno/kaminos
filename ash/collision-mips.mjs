const pipelines=new WeakMap();
export function occupancyMipLevels(grid){return Math.floor(Math.log2(grid))+1;}
export function occupancyMipBytes(grid){let bytes=0;for(let n=0;n<occupancyMipLevels(grid);n++)bytes+=Math.max(1,grid>>n)**3*4;return bytes;}
// Any/full occupancy preserves thin features without mistaking bounds for solid interiors.
// Odd edge texels belong to the last parent rather than falling out of the tree.
export function encodeOccupancyMips(device,encoder,texture,grid){
 let resources=pipelines.get(device);
 if(!resources){
  const module=device.createShaderModule({label:'ash collider maximum mip',code:`
   @group(0) @binding(0) var source:texture_3d<u32>;
   @group(0) @binding(1) var targetMip:texture_storage_3d<r32uint,write>;
   fn aggregate(c:vec3<u32>,first:bool){
    let dims=textureDimensions(targetMip);if(any(c>=dims)){return;}let sourceDims=textureDimensions(source);let low=c*2u;var high=min(low+2u,sourceDims);
    for(var axis=0u;axis<3u;axis++){if(c[axis]+1u==dims[axis]){high[axis]=sourceDims[axis];}}
    var occupied=0u;var full=true;for(var z=low.z;z<high.z;z++){for(var y=low.y;y<high.y;y++){for(var x=low.x;x<high.x;x++){let v=textureLoad(source,vec3<i32>(i32(x),i32(y),i32(z)),0).x;occupied|=select(0u,1u,v!=0u);full=full&&select((v&0x80000000u)!=0u,v!=0u,first);}}}
    textureStore(targetMip,vec3<i32>(c),vec4<u32>(occupied|select(0u,0x80000000u,full)));
   }
   @compute @workgroup_size(4,4,4) fn reduce_first(@builtin(global_invocation_id) c:vec3<u32>){aggregate(c,true);}
   @compute @workgroup_size(4,4,4) fn reduce(@builtin(global_invocation_id) c:vec3<u32>){aggregate(c,false);}`});
  const layout=device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:'uint',viewDimension:'3d'}},{binding:1,visibility:GPUShaderStage.COMPUTE,storageTexture:{access:'write-only',format:'r32uint',viewDimension:'3d'}}]});
  const pipelineLayout=device.createPipelineLayout({bindGroupLayouts:[layout]});const variants=Object.fromEntries(['reduce_first','reduce'].map(entryPoint=>[entryPoint,device.createComputePipeline({layout:pipelineLayout,compute:{module,entryPoint}})]));resources={layout,variants};pipelines.set(device,resources);
 }
 for(let level=1;level<occupancyMipLevels(grid);level++){
  const group=device.createBindGroup({layout:resources.layout,entries:[{binding:0,resource:texture.createView({baseMipLevel:level-1,mipLevelCount:1})},{binding:1,resource:texture.createView({baseMipLevel:level,mipLevelCount:1})}]});
  const pass=encoder.beginComputePass({label:'ash cached collider mip '+level});pass.setPipeline(resources.variants[level===1?'reduce_first':'reduce']);pass.setBindGroup(0,group);const groups=Math.ceil(Math.max(1,grid>>level)/4);pass.dispatchWorkgroups(groups,groups,groups);pass.end();
 }
}
