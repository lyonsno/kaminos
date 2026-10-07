export const SOLID_KERNEL_ROUTE='kaminos.material-energy-gradient.webgpu.v0';
export const graphMaterialWgsl=`
@group(0) @binding(0) var<storage,read> positions:array<vec4f>;
@group(0) @binding(1) var<storage,read> indices:array<vec4u>;
@group(0) @binding(2) var<storage,read> gradients:array<vec4f>;
@group(0) @binding(3) var<storage,read> coefficients:array<f32>;
@group(0) @binding(4) var<storage,read_write> output:array<vec4f>;
fn outer(a:vec3f,b:vec3f)->mat3x3f{return mat3x3f(a*b.x,a*b.y,a*b.z);}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=arrayLength(&indices)){return;}
 let base=i*12u;var live=false;
 for(var k=0u;k<36u;k++){live=live||(coefficients[i*36u+k]!=0.0);}
 if(!live){for(var k=0u;k<12u;k++){output[base+k]=vec4f(0.0);}return;}
 let ids=indices[i];var F=mat3x3f(vec3f(0.0),vec3f(0.0),vec3f(0.0));
 for(var k=0u;k<4u;k++){F+=outer(positions[ids[k]].xyz,gradients[i*4u+k].xyz);}
 let C=transpose(F)*F;
 var e=array<f32,6>((C[0][0]-1.0)*0.5,(C[1][1]-1.0)*0.5,(C[2][2]-1.0)*0.5,C[1][0],C[2][0],C[2][1]);
 var s=array<f32,6>();var energy=0.0;
 for(var row=0u;row<6u;row++){for(var col=0u;col<6u;col++){s[row]+=coefficients[i*36u+row*6u+col]*e[col];}energy+=e[row]*s[row];}
 let S=mat3x3f(vec3f(s[0],s[3],s[4]),vec3f(s[3],s[1],s[5]),vec3f(s[4],s[5],s[2]));
 let P=F*S;let J=dot(F[0],cross(F[1],F[2]));let volume=gradients[i*4u].w;
 output[base]=vec4f(energy*volume*0.5,J,1.0,select(1.0,0.0,J>0.0));
 for(var k=0u;k<4u;k++){output[base+1u+k]=vec4f(-volume*(P*gradients[i*4u+k].xyz),0.0);}
 let sigma=P*transpose(F)/J;
 for(var k=0u;k<3u;k++){output[base+5u+k]=vec4f(sigma[k],0.0);output[base+8u+k]=vec4f(F[k],0.0);}
 output[base+11u]=vec4f(0.0);
}`;

export const microelasticMaterialWgsl=`
@group(0) @binding(0) var<storage,read> positions:array<vec4f>;
@group(0) @binding(1) var<storage,read> indices:array<vec4u>;
@group(0) @binding(2) var<storage,read> parameters:array<vec4f>;
@group(0) @binding(3) var<storage,read_write> output:array<vec4f>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=arrayLength(&indices)){return;}
 let ids=indices[i];let data=parameters[i];let base=i*2u;
 if(ids.z==0u){output[base]=vec4f(0.0);output[base+1u]=vec4f(0.0);return;}
 let delta=positions[ids.y].xyz-positions[ids.x].xyz;let r=length(delta);let extension=r-data.x;
 if(r<=0.0){output[base]=vec4f(0.0,0.0,1.0,1.0);output[base+1u]=vec4f(0.0);return;}
 output[base]=vec4f(0.5*data.y*extension*extension,extension/data.x,1.0,0.0);
 output[base+1u]=vec4f(data.y*extension*delta/r,0.0);
}`;

export async function evaluateSolidMaterial(device,{kind,positions,indices,parameters,coefficients}){
  if(!['graph','pmb'].includes(kind))throw new Error('Unknown material kernel route');
  if(!Array.isArray(positions)||!positions.length||!positions.every(p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite)))throw new Error('Finite 3D material positions required');
  if(!Array.isArray(indices)||!indices.length||!indices.every(row=>Array.isArray(row)&&row.length===4&&row.every(v=>Number.isInteger(v)&&v>=0&&v<=0xffffffff)))throw new Error('Four unsigned integer material indices required');
  if(kind==='pmb'&&!indices.every(row=>row[2]===0||row[2]===1))throw new Error('Boolean microelastic bond state required');
  const points=Float32Array.from(positions.flatMap(p=>[...p,0])),ids=Uint32Array.from(indices.flat());
  if(!points.length||!ids.length||points.length%4||ids.length%4||!points.every(Number.isFinite))throw new Error('Complete finite material positions and padded indices required');
  for(let i=0;i<ids.length;i++)if(i%4< (kind==='graph'?4:2)&&ids[i]>=points.length/4)throw new Error('Material index out of range');
  const count=ids.length/4,stride=kind==='graph'?48:8,outputBytes=count*stride*4;
  const data=Float32Array.from(parameters.flat()),matrix=kind==='graph'?Float32Array.from(coefficients.flat(2)):null;
  if(data.length!==count*(kind==='graph'?16:4)||!data.every(Number.isFinite)||matrix&& (matrix.length!==count*36||!matrix.every(Number.isFinite)))throw new Error('Material coefficient or gradient shape mismatch');
  if(kind==='pmb'&&!indices.every((_,i)=>data[i*4]>0&&data[i*4+1]>0))throw new Error('Positive microelastic rest length and stiffness required');
  const arrays=kind==='graph'?[points,ids,data,matrix]:[points,ids,data];
  for(const bytes of [...arrays.map(a=>a.byteLength),outputBytes])if(bytes>device.limits.maxStorageBufferBindingSize)throw new Error('Material buffer exceeds effective GPU storage capacity');
  const owned=[];
  const buffer=(size,usage,label)=>{const b=device.createBuffer({size,usage,label});owned.push(b);return b;};
  try{
    const inputs=arrays.map((a,i)=>{const b=buffer(a.byteLength,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST,`Material input ${i}`);device.queue.writeBuffer(b,0,a);return b;});
    const output=buffer(outputBytes,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC,'Material energy/force output');
    const staging=buffer(outputBytes,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ,'Material conformance readback');
    const shader=device.createShaderModule({label:kind==='graph'?'Graph elastic damage':'PMB microelastic',code:kind==='graph'?graphMaterialWgsl:microelasticMaterialWgsl});
    const info=await shader.getCompilationInfo();const errors=info.messages.filter(m=>m.type==='error');if(errors.length)throw new Error(JSON.stringify(errors.map(m=>({message:m.message,line:m.lineNum}))));
    const pipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module:shader,entryPoint:'main'}});
    const group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[...inputs,output].map((b,binding)=>({binding,resource:{buffer:b}}))});
    const encoder=device.createCommandEncoder(),pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(Math.ceil(count/64));pass.end();encoder.copyBufferToBuffer(output,0,staging,0,outputBytes);device.queue.submit([encoder.finish()]);
    await staging.mapAsync(GPUMapMode.READ);const values=Array.from(new Float32Array(staging.getMappedRange()));
    if(!values.every(Number.isFinite))throw new Error('Nonfinite material output');
    for(let i=0;i<count;i++)if(values[i*stride+3]!==0)throw new Error(`Material element ${i} is outside the valid deformation domain`);
    return{route:SOLID_KERNEL_ROUTE,kind,count,stride,values,claim:'Material energy/gradient GPU evaluation only; not dynamic integration or fracture-surface proof'};
  }finally{for(const b of owned)b.destroy();}
}
