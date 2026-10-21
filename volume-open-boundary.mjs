// One-way fine domain: ambient pressure outside, extrapolated predictor flux.
// The three missing lower MAC planes are genuine projected faces, not walls.
export const OPEN_BOUNDARY_WGSL = /* wgsl */`
struct Params { dims:vec4<u32>, controls:vec4<f32> };
@group(0) @binding(0) var<uniform> u:Params;
@group(0) @binding(1) var<storage,read> fluid:array<vec4<f32>>;
@group(0) @binding(2) var<storage,read> pressure:array<vec4<f32>>;
@group(0) @binding(3) var solid:texture_3d<u32>;
@group(0) @binding(4) var lower:texture_storage_2d_array<r32float,write>;
override PROJECT:bool=false;
@compute @workgroup_size(8,8,1)
fn faces(@builtin(global_invocation_id) gid:vec3<u32>) {
  let axis=gid.z; if(axis>=3u){return;}
  let b=(axis+1u)%3u; let d=(axis+2u)%3u;
  if(gid.x>=u.dims[b] || gid.y>=u.dims[d]){return;}
  var c=vec3<u32>(0); c[b]=gid.x;c[d]=gid.y;
  let i=c.x+u.dims.x*(c.y+u.dims.y*c.z);
  var v=fluid[i*4u][axis];
  if(PROJECT){v-=pressure[i].y*u.controls.x;}
  if(textureDimensions(solid).x==u.dims.x && textureLoad(solid,vec3<i32>(c),0).x!=0u){v=0.0;}
  textureStore(lower,vec2<i32>(gid.xy),i32(axis),vec4<f32>(v));
}
`;

export function createOpenBoundary(device,dims,texture) {
  const params=device.createBuffer({label:'open fine boundary parameters',size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
  const layout=device.createBindGroupLayout({entries:[
    {binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:'uniform'}},
    {binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:'read-only-storage'}},
    {binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:'read-only-storage'}},
    {binding:3,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:'uint',viewDimension:'3d'}},
    {binding:4,visibility:GPUShaderStage.COMPUTE,storageTexture:{access:'write-only',format:'r32float',viewDimension:'2d-array'}},
  ]});
  const module=device.createShaderModule({label:'open fine boundary flux',code:OPEN_BOUNDARY_WGSL});
  const pipelineLayout=device.createPipelineLayout({bindGroupLayouts:[layout]});
  const pipelines=[false,true].map(project=>device.createComputePipeline({label:project?'project open lower faces':'predict open lower faces',layout:pipelineLayout,compute:{module,entryPoint:'faces',constants:{PROJECT:project}}}));
  let group,prior=[];
  function prepare({fluid,pressure,solid,gain}) {
    const data=new ArrayBuffer(32);new Uint32Array(data).set([...dims,0]);new Float32Array(data)[4]=gain;
    device.queue.writeBuffer(params,0,data);
    const current=[fluid,pressure,solid];if(group&&current.every((v,i)=>v===prior[i]))return;
    prior=current;
    group=device.createBindGroup({layout,entries:[{binding:0,resource:{buffer:params}},{binding:1,resource:{buffer:fluid}},{binding:2,resource:{buffer:pressure}},{binding:3,resource:solid.createView()},{binding:4,resource:texture.createView({dimension:'2d-array'})}]});
  }
  function encode(encoder,project=false){
    if(!group)throw Error('Open boundary not prepared');
    const pass=encoder.beginComputePass({label:project?'open lower-face projection':'open lower-face predictor'});
    pass.setPipeline(pipelines[project?1:0]);pass.setBindGroup(0,group);
    const n=Math.ceil(Math.max(...dims)/8);pass.dispatchWorkgroups(n,n,3);pass.end();
  }
  return {prepare,encode,destroy(){params.destroy();}};
}
