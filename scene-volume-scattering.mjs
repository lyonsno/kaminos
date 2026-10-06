// One medium scattering event. Incident RGB already carries transported-light
// gain; apply that gain to primary emission only, then gather with unit gain.
export function composeScatteredSource(primary,sigma,incident,gain=1){
  if(primary.length!==4||incident.length!==3||![...primary,...incident,sigma,gain].every(Number.isFinite)||sigma<0||gain<0)
    throw new Error('finite source, incident and nonnegative scattering/gain required');
  return [...incident.map((j,c)=>primary[c]*gain+sigma*j),primary[3]];
}
export function createScatteredSource(device,{dimensions,primary,scattering,incident}){
  const output=device.createTexture({label:'primary plus once-scattered smoke emission',dimension:'3d',size:dimensions,format:'rgba32float',
    usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC});
  const params=device.createBuffer({label:'scattered source primary gain',size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
  const pipeline=device.createComputePipeline({label:'form same-frame smoke scattered source',layout:'auto',compute:{module:device.createShaderModule({code:SCATTERED_SOURCE_WGSL}),entryPoint:'buildScatteredSource'}});
  const group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[
    {binding:0,resource:primary.createView()},{binding:1,resource:scattering.createView()},{binding:2,resource:incident.createView()},
    {binding:3,resource:output.createView()},{binding:4,resource:{buffer:params}}]});
  return {texture:output,encode(encoder,gain){device.queue.writeBuffer(params,0,new Float32Array([gain,0,0,0]));
    const pass=encoder.beginComputePass({label:'same-frame smoke to surface source'});pass.setPipeline(pipeline);pass.setBindGroup(0,group);
    pass.dispatchWorkgroups(...dimensions.map(n=>Math.ceil(n/4)));pass.end();},destroy(){output.destroy();params.destroy();}};
}
export const SCATTERED_SOURCE_WGSL=`
@group(0) @binding(0) var primary:texture_3d<f32>;
@group(0) @binding(1) var scattering:texture_3d<f32>;
@group(0) @binding(2) var incident:texture_3d<f32>;
@group(0) @binding(3) var output:texture_storage_3d<rgba32float,write>;
@group(0) @binding(4) var<uniform> params:vec4<f32>;
@compute @workgroup_size(4,4,4)
fn buildScatteredSource(@builtin(global_invocation_id) c:vec3<u32>){
  let dims=textureDimensions(primary);if(any(c>=dims)){return;}
  let p=(vec3<f32>(c)+vec3<f32>(0.5))/vec3<f32>(dims);
  let idims=textureDimensions(incident);
  let at=clamp(vec3<i32>(floor(p*vec3<f32>(idims))),vec3<i32>(0),vec3<i32>(idims)-vec3<i32>(1));
  let m=textureLoad(primary,vec3<i32>(c),0);let sigma=textureLoad(scattering,vec3<i32>(c),0).r;
  let j=textureLoad(incident,at,0).rgb;
  textureStore(output,vec3<i32>(c),vec4<f32>(m.rgb*params.x+sigma*j,m.a));
}`;
