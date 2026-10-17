export const MOVING_VOLUME_WGSL=`
struct Params {dims:vec4<u32>,shift:vec4<i32>,ambient:vec4<f32>}
@group(0) @binding(0) var<storage,read> before:array<vec4<f32>>;
@group(0) @binding(1) var<storage,read_write> after:array<vec4<f32>>;
@group(0) @binding(2) var<storage,read> frontBefore:array<f32>;
@group(0) @binding(3) var<storage,read_write> frontAfter:array<f32>;
@group(0) @binding(4) var<storage,read> quenchBefore:array<u32>;
@group(0) @binding(5) var<storage,read_write> quenchAfter:array<u32>;
@group(0) @binding(6) var reactantBefore:texture_3d<f32>;
@group(0) @binding(7) var reactantAfter:texture_storage_3d<rg32float,write>;
@group(0) @binding(8) var<uniform> p:Params;
fn index(c:vec3<u32>)->u32{return c.x+p.dims.x*(c.y+p.dims.y*c.z);}
@compute @workgroup_size(4,4,4)
fn shiftDomain(@builtin(global_invocation_id) c:vec3<u32>){
 if(any(c>=p.dims.xyz)){return;}let i=index(c);let q=vec3<i32>(c)+p.shift.xyz;
 let inside=all(q>=vec3<i32>(0))&&all(q<vec3<i32>(p.dims.xyz));
 for(var slot=0u;slot<4u;slot++){
  var value=vec4<f32>(0.0);if(inside){value=before[index(vec3<u32>(q))*4u+slot];}after[i*4u+slot]=value;
 }
 var front=0.0;var quench=0u;var reactant=vec4<f32>(p.ambient.x,0.0,0.0,0.0);
 if(inside){let j=index(vec3<u32>(q));front=frontBefore[j];quench=quenchBefore[j];if(p.dims.w!=0u){reactant=textureLoad(reactantBefore,q,0);}}
 frontAfter[i]=front;quenchAfter[i]=quench;
 if(p.dims.w!=0u){textureStore(reactantAfter,vec3<i32>(c),reactant);}
}`;

export async function createMovingVolumeGpu(device){
 const module=device.createShaderModule({label:'world-aligned retained domain shift',code:MOVING_VOLUME_WGSL});
 const errors=(await module.getCompilationInfo()).messages.filter(m=>m.type==='error');
 if(errors.length)throw Error('Moving domain WGSL: '+errors.map(m=>m.message).join('; '));
 const pipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'shiftDomain'}});
 const params=device.createBuffer({label:'moving volume cell shift',size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
 return {encode(encoder,{dimensions,shift,fluid,front,quench,reactant,reactantFull,ambientOxidizer}){
  const bytes=new ArrayBuffer(48);new Uint32Array(bytes).set([...dimensions,reactantFull?1:0]);new Int32Array(bytes).set([...shift,0],4);new Float32Array(bytes)[8]=ambientOxidizer;
  device.queue.writeBuffer(params,0,bytes);
  const entries=[...fluid.map((buffer,i)=>({binding:i,resource:{buffer}})),...front.map((buffer,i)=>({binding:2+i,resource:{buffer}})),...quench.map((buffer,i)=>({binding:4+i,resource:{buffer}})),
   {binding:6,resource:reactant[0].createView()},{binding:7,resource:reactant[1].createView()},{binding:8,resource:{buffer:params}}];
  // The trailing quench words belong to the source, not spatial cells.
  const cellBytes=dimensions.reduce((a,b)=>a*b,1)*4;
  if(quench[0].size>cellBytes)encoder.copyBufferToBuffer(quench[0],cellBytes,quench[1],cellBytes,quench[0].size-cellBytes);
  const pass=encoder.beginComputePass({label:'world-aligned retained gas remap'});pass.setPipeline(pipeline);pass.setBindGroup(0,device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries}));
  pass.dispatchWorkgroups(...dimensions.map(n=>Math.ceil(n/4)));pass.end();
 },dispose(){params.destroy();}};
}
