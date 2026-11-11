// Geometric-reference adapter for the published outward direction-pair domain.
// Unlike the older XY-only teacher API, this retains Z near the horizon.
export function validateAppearanceDirections(queries){
 if(!(queries instanceof Float32Array)||!queries.length||queries.length%8||!queries.every(Number.isFinite))throw Error('Finite UV/viewXYZ/lightXYZ rows required');
 for(let i=0;i<queries.length;i+=8)for(const at of [i+2,i+5])if(queries[at+2]<=0||Math.abs(Math.hypot(...queries.subarray(at,at+3))-1)>1e-5)throw Error('Unit outward upper hemisphere directions required');
 return queries;
}
export function createAppearanceDirectionCapture(teacher,commonWGSL){
 const device=teacher.device;let pipeline;
 const code=commonWGSL+/* wgsl */`
struct AppearanceDirectionQuery {a:vec4<f32>,b:vec4<f32>}
struct AppearanceCapture {extent:vec4<f32>,offset:vec4<u32>}
@group(0) @binding(5) var<storage,read> appearanceQueries:array<AppearanceDirectionQuery>;
@group(0) @binding(6) var<storage,read_write> appearanceAnswers:array<f32>;
@group(0) @binding(7) var<uniform> appearanceCapture:AppearanceCapture;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3<u32>){
 if(id.x>=arrayLength(&appearanceQueries)){return;}let q=appearanceQueries[id.x];
 let wi=vec3<f32>(q.a.zw,q.b.x);let wo=q.b.yzw;
 let v=vec3<f32>(-wi.x,-wi.z,-wi.y);let l=vec3<f32>(wo.x,wo.z,wo.y);
 var state=(id.x+appearanceCapture.offset.x)*747796405u+(params.extent.z+1u)*2891336453u;var sum=vec3<f32>(0.0);
 for(var s=0u;s<u32(appearanceCapture.extent.w);s++){
  let uv=q.a.xy+(vec2<f32>(random(&state),random(&state))-.5)/appearanceCapture.extent.z;
  let origin=vec3<f32>((uv.x-.5)*appearanceCapture.extent.x,appearanceCapture.extent.y,(uv.y-.5)*appearanceCapture.extent.x);
  sum+=pathTraceIncident(origin,v,&state,l,true);
 }
 let projected=sum/appearanceCapture.extent.w;
 appearanceAnswers[id.x*3u]=projected.r;appearanceAnswers[id.x*3u+1u]=projected.g;appearanceAnswers[id.x*3u+2u]=projected.b;
}`;
 return {async evaluate(queries,{tileSize,referenceHeight,resolution,samples,seed=0}={}){
  validateAppearanceDirections(queries);
  if(teacher.disposed||teacher.environment!==0)throw Error('Live zero-environment source teacher required');
  if(!Number.isFinite(tileSize)||tileSize<=0||!Number.isFinite(referenceHeight)||!Number.isSafeInteger(resolution)||resolution<1||!Number.isSafeInteger(samples)||samples<1||!Number.isSafeInteger(seed)||seed<0)throw Error('Valid directional capture configuration required');
  pipeline??=device.createComputePipeline({label:'appearance explicit XYZ reference',layout:'auto',compute:{module:device.createShaderModule({code}),entryPoint:'main'}});
  const capacity=Math.min(device.limits.maxComputeWorkgroupsPerDimension*64,Math.floor(device.limits.maxStorageBufferBindingSize/32),Math.floor(device.limits.maxBufferSize/32));
  if(capacity<1)throw Error('Active device cannot hold one directional query');
  const count=queries.length/8,result=new Float32Array(count*3);teacher.writeParams({frame:seed});
  for(let offset=0;offset<count;offset+=capacity){const rows=Math.min(capacity,count-offset),buffers=[];let read;
   const buffer=(label,bytes,usage)=>{const b=device.createBuffer({label,size:Math.max(16,bytes.byteLength),usage:usage|GPUBufferUsage.COPY_DST});buffers.push(b);device.queue.writeBuffer(b,0,bytes);return b;};
   try{
    const input=buffer('outward XYZ queries',queries.subarray(offset*8,(offset+rows)*8),GPUBufferUsage.STORAGE),output=buffer('projected source response',new Float32Array(rows*3),GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC);
    const settings=new Float32Array(8);settings.set([tileSize,referenceHeight,resolution,samples]);new Uint32Array(settings.buffer)[4]=offset;const config=buffer('direction capture configuration',settings,GPUBufferUsage.UNIFORM);
    read=device.createBuffer({size:rows*12,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});
    const encoder=device.createCommandEncoder(),pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,teacher.group(pipeline,[...teacher.common(),input,output,config]));pass.dispatchWorkgroups(Math.ceil(rows/64));pass.end();encoder.copyBufferToBuffer(output,0,read,0,rows*12);device.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);
    const rgb=new Float32Array(read.getMappedRange().slice(0));if(!rgb.every(x=>Number.isFinite(x)&&x>=0))throw Error('Invalid projected source response');result.set(rgb,offset*3);
   }finally{read?.destroy();for(const b of buffers)b.destroy();}
  }
  return result;
 }};
}
