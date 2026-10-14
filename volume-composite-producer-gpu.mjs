// Read the actual binding-19 producer format without texture-copy/readback or
// adding TEXTURE_BINDING to that resource. Encode before shared projection on
// the SAME encoder, after fine forces/injection. Passive coarse target is zero.
import {assertCompositeSolidRevisions} from './volume-composite-producer.mjs';
export function createCompositeProducerGPU(device,layout){
  const n=layout.grid.cells.length;
  if(n===0)throw new Error('composite intake requires fluid leaves');
  const coords=device.createBuffer({label:'composite fine target coordinates',size:layout.targetCoordinates.byteLength,
    usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
  const targetBuffer=device.createBuffer({label:'composite leaf divergence target',size:4*n,
    usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});
  device.queue.writeBuffer(coords,0,layout.targetCoordinates);
  const shader=device.createShaderModule({label:'composite producer target intake',code:/* wgsl */`
@group(0) @binding(0) var<storage,read> coordinates:array<vec4<u32>>;
@group(0) @binding(1) var source:texture_storage_3d<r32float,read>;
@group(0) @binding(2) var<storage,read_write> leafTarget:array<f32>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3<u32>){
  let i=id.x;if(i>=${n}u){return;}
  let c=coordinates[i];var value=0.0;
  if(c.w!=0u){value=textureLoad(source,vec3<i32>(c.xyz)).x;}
  // Producer already publishes divergence rate, not burned mass. No h/dt
  // multiplier and no sanitize-to-zero that could disguise corrupt input.
  leafTarget[i]=value;
}`});
  const pipeline=device.createComputePipeline({layout:'auto',compute:{module:shader,entryPoint:'main'}});
  let destroyed=false;
  return {targetBuffer,shader,
    encode(encoder,{targetTexture,solidRevisions}={}){
      if(destroyed)throw new Error('composite producer intake destroyed');
      assertCompositeSolidRevisions(layout,solidRevisions);
      if(targetTexture?.dimension!=='3d'||targetTexture.format!=='r32float')throw new Error('fine target requires a 3d r32float texture');
      const shape=[targetTexture.width,targetTexture.height,targetTexture.depthOrArrayLayers];
      if(shape.some((v,a)=>v!==layout.fineShape[a]))throw new Error('fine target texture shape mismatch');
      if(!(targetTexture.usage&GPUTextureUsage.STORAGE_BINDING))throw new Error('fine target requires STORAGE_BINDING');
      const group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[
        {binding:0,resource:{buffer:coords}},{binding:1,resource:targetTexture.createView()},
        {binding:2,resource:{buffer:targetBuffer}}]});
      const pass=encoder.beginComputePass({label:'composite target from fine producer'});
      pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(Math.ceil(n/64));pass.end();
    },
    destroy(){if(destroyed)return;destroyed=true;coords.destroy();targetBuffer.destroy();},
  };
}
