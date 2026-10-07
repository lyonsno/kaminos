// Same-frame diffusion on authored triangle connectivity. No history, screen
// neighborhood, proximity welding, or front/back mixing. Split vertices stay
// split: a texture seam can therefore also be a reconstruction seam.
export function validateSurfaceReconstruction(value) {
  if(!Number.isSafeInteger(value)||value<0||value%2)throw new Error('surface reconstruction needs a nonnegative even integer');
  return value;
}
export function surfaceGraph(receivers,triangles) {
  const count=receivers.length;
  if(!Number.isSafeInteger(count*count))throw new Error('surface graph index exceeds exact integer capacity');
  const codes=new Float64Array(triangles.length*2);let used=0;
  for(let i=0;i<triangles.length;i+=3)for(let e=0;e<3;e++) {
    const a=triangles[i+e],b=triangles[i+(e+1)%3];
    if(!Number.isInteger(a)||!Number.isInteger(b)||a<0||b<0||a>=count||b>=count)throw new Error('surface topology receiver index out of range');
    if(a===b)continue;
    const na=receivers[a].normal,nb=receivers[b].normal;
    if(na.reduce((s,v,c)=>s+v*nb[c],0)<.8)continue;
    codes[used++]=a*count+b;codes[used++]=b*count+a;
  }
  const sorted=codes.subarray(0,used).sort();let unique=0;
  for(let i=0;i<used;i++)if(i===0||sorted[i]!==sorted[i-1])unique++;
  const offsets=new Uint32Array(count+1),neighbors=new Uint32Array(unique);
  let edge=0;
  for(let i=0;i<used;i++)if(i===0||sorted[i]!==sorted[i-1]) {
    const a=Math.floor(sorted[i]/count);neighbors[edge++]=sorted[i]-a*count;offsets[a+1]++;
  }
  for(let i=1;i<=count;i++)offsets[i]+=offsets[i-1];
  return {offsets,neighbors,count,normalCosine:.8};
}
export function reconstructSurfaceCPU(values,graph,passes) {
  validateSurfaceReconstruction(passes);
  let input=Float32Array.from(values);
  for(let p=0;p<passes;p++) {
    const output=new Float32Array(input.length);
    for(let i=0;i<graph.count;i++)for(let c=0;c<4;c++) {
      const begin=graph.offsets[i],end=graph.offsets[i+1];let sum=0;
      for(let e=begin;e<end;e++)sum+=input[graph.neighbors[e]*4+c];
      output[i*4+c]=end===begin?input[i*4+c]:.5*(input[i*4+c]+sum/(end-begin));
    }
    input=output;
  }
  return input;
}
export function createSurfaceReconstruction(device,{graph,front,back,dimensions}) {
  const resources=[];
  for(const data of [graph.offsets,graph.neighbors])if(Math.max(16,data.byteLength)>device.limits.maxStorageBufferBindingSize)throw new Error('surface adjacency exceeds device storage capacity');
  const groups=Math.ceil(graph.count/64),limit=device.limits.maxComputeWorkgroupsPerDimension;
  if(groups>limit*limit)throw new Error('surface reconstruction exceeds device dispatch capacity');
  try {
    const buffers=[graph.offsets,graph.neighbors].map(data=>{
      const b=device.createBuffer({label:'surface reconstruction adjacency',size:Math.max(16,data.byteLength),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
      resources.push(b);device.queue.writeBuffer(b,0,data);return b;
    });
    const scratch=[0,1].map(()=>{const t=device.createTexture({label:'same-frame surface reconstruction scratch',size:dimensions,format:'rgba32float',usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING});resources.push(t);return t;});
    const module=device.createShaderModule({label:'topology-local current-frame surface reconstruction',code:`const COUNT:u32=${graph.count}u;const WIDTH:u32=${dimensions[0]}u;const DISPATCH_WIDTH:u32=${limit*64}u;`+SURFACE_RECONSTRUCTION_WGSL});
    const pipeline=device.createComputePipeline({layout:'auto',compute:{module,entryPoint:'reconstruct'}});
    const bindings=[[front,back,...scratch],[...scratch,front,back]].map(textures=>device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[...buffers.map((buffer,binding)=>({binding,resource:{buffer}})),...textures.map((t,i)=>({binding:i+2,resource:t.createView()}))]}));
    const metadata={identity:'current-frame-topology-diffusion-v1',history:false,vertices:graph.count,directedEdges:graph.neighbors.length,normalCosine:graph.normalCosine,bytes:graph.offsets.byteLength+graph.neighbors.byteLength+dimensions[0]*dimensions[1]*32};
    return {metadata,encode(encoder,passes){
      validateSurfaceReconstruction(passes);
      for(let i=0;i<passes;i++) {
        const p=encoder.beginComputePass({label:'current-frame surface reconstruction'});p.setPipeline(pipeline);p.setBindGroup(0,bindings[i%2]);p.dispatchWorkgroups(Math.min(groups,limit),Math.ceil(groups/limit));p.end();
      }
    },destroy(){for(const r of resources)r.destroy();}};
  }catch(error){for(const r of resources)r.destroy();throw error;}
}
export const SURFACE_RECONSTRUCTION_WGSL=`
@group(0) @binding(0) var<storage,read> offsets:array<u32>;
@group(0) @binding(1) var<storage,read> neighbors:array<u32>;
@group(0) @binding(2) var front:texture_2d<f32>;
@group(0) @binding(3) var back:texture_2d<f32>;
@group(0) @binding(4) var frontOut:texture_storage_2d<rgba32float,write>;
@group(0) @binding(5) var backOut:texture_storage_2d<rgba32float,write>;
fn pixel(i:u32)->vec2<i32>{return vec2<i32>(i32(i%WIDTH),i32(i/WIDTH));}
@compute @workgroup_size(64)
fn reconstruct(@builtin(global_invocation_id) global:vec3<u32>) {
  let i=global.x+global.y*DISPATCH_WIDTH;if(i>=COUNT){return;}
  let xy=pixel(i);let f=textureLoad(front,xy,0);let b=textureLoad(back,xy,0);
  let begin=offsets[i];let end=offsets[i+1];var fs=vec4<f32>(0.0);var bs=vec4<f32>(0.0);
  for(var e=begin;e<end;e++){let q=pixel(neighbors[e]);fs+=textureLoad(front,q,0);bs+=textureLoad(back,q,0);}
  let n=f32(max(1u,end-begin));
  textureStore(frontOut,xy,select(f,.5*(f+fs/n),end>begin));
  textureStore(backOut,xy,select(b,.5*(b+bs/n),end>begin));
}
`;
