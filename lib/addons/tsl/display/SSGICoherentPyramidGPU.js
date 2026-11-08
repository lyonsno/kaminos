// This kernel is also executed directly by the native numerical fixture.
export const SSGI_COHERENT_PYRAMID_WGSL = /* wgsl */`
struct Params { projection: vec4f, settings: vec4f, flags: vec4f }
@group(0) @binding(0) var inputDepth: texture_2d<f32>;
@group(0) @binding(1) var inputLight: texture_2d<f32>;
@group(0) @binding(2) var inputNormal: texture_2d<f32>;
@group(0) @binding(3) var outputDepth: texture_storage_2d<rgba32float, write>;
@group(0) @binding(4) var outputLight: texture_storage_2d<rgba16float, write>;
@group(0) @binding(5) var outputNormal: texture_storage_2d<rgba16float, write>;
@group(0) @binding(6) var<uniform> params: Params;

fn viewDistance(depth: f32) -> f32 {
 if (params.flags.x > 0.5) { return params.settings.x * exp(depth * log(params.settings.y / params.settings.x)); }
 return abs(-params.projection.x / (depth * params.projection.z + params.projection.w + params.projection.y));
}
fn compatible(a: vec4f, b: vec4f, za: f32, zb: f32, na: vec3f, nb: vec3f) -> bool {
 if (a.x >= 1.0 || b.x >= 1.0) { return a.x >= 1.0 && b.x >= 1.0; }
 return abs(za-zb) <= params.settings.z * max(min(za,zb),params.settings.x)
     && dot(na,na) > 0.0 && dot(nb,nb) > 0.0 && dot(na,nb) >= params.settings.w;
}
@compute @workgroup_size(8,8)
fn initialize(@builtin(global_invocation_id) id: vec3u) {
 let size=textureDimensions(outputDepth); if(any(id.xy>=size)){return;}
 let p=vec2i(id.xy); let uv=(vec2f(id.xy)+0.5)/vec2f(size);
 textureStore(outputDepth,p,vec4f(textureLoad(inputDepth,p,0).x,uv,1.0));
 textureStore(outputLight,p,textureLoad(inputLight,p,0));
 textureStore(outputNormal,p,textureLoad(inputNormal,p,0));
}
@compute @workgroup_size(8,8)
fn reduce(@builtin(global_invocation_id) id: vec3u) {
 let size=textureDimensions(outputDepth); if(any(id.xy>=size)){return;}
 let sourceSize=textureDimensions(inputDepth);
 let start=vec2f(id.xy)*vec2f(sourceSize)/vec2f(size);
 let end=vec2f(id.xy+vec2u(1))*vec2f(sourceSize)/vec2f(size);
 let first=vec2i(floor(start));
 // A floor-halved mip spans at most three source cells on either axis.
 // Area weights include the last row/column of odd and one-pixel extents.
 var points: array<vec4f,9>; var normals: array<vec4f,9>;
 var lights: array<vec4f,9>; var weights: array<f32,9>; var distances: array<f32,9>;
 for(var y=0u;y<3u;y++){for(var x=0u;x<3u;x++){
  let k=y*3u+x; let cell=first+vec2i(i32(x),i32(y));
  let p=clamp(cell,vec2i(0),vec2i(sourceSize)-vec2i(1));
  let overlap=max(vec2f(0),min(vec2f(cell)+1.0,end)-max(vec2f(cell),start));
  points[k]=textureLoad(inputDepth,p,0); normals[k]=textureLoad(inputNormal,p,0);
  normals[k]=vec4f(normals[k].xyz/max(length(normals[k].xyz),1e-20),normals[k].w);distances[k]=viewDistance(points[k].x);
  lights[k]=textureLoad(inputLight,p,0); weights[k]=overlap.x*overlap.y*points[k].w;
 }}
 var winner=0u; var support=-1.0;
 for(var i=0u;i<9u;i++){
  if(weights[i]<=0.0){continue;}
  var score=0.0;
  for(var j=0u;j<9u;j++){if(compatible(points[i],points[j],distances[i],distances[j],normals[i].xyz,normals[j].xyz)){score+=weights[j];}}
  if(score>support || (score==support && points[i].x>points[winner].x)){support=score;winner=i;}
 }
 var total=0.0; var radiance=vec3f(0); var representative=winner; var largest=-1.0;
 for(var j=0u;j<9u;j++){
  if(weights[j]>0.0 && compatible(points[winner],points[j],distances[winner],distances[j],normals[winner].xyz,normals[j].xyz)){
   total+=weights[j]; radiance+=lights[j].xyz*weights[j];
   if(weights[j]>largest || (weights[j]==largest && points[j].x>points[representative].x)){largest=weights[j];representative=j;}
  }
 }
 let p=vec2i(id.xy);
 if(total<=0.0){
  textureStore(outputDepth,p,vec4f(1.0,(vec2f(id.xy)+0.5)/vec2f(size),0.0));
  textureStore(outputLight,p,vec4f(0));textureStore(outputNormal,p,vec4f(0));return;
 }
 let area=(end.x-start.x)*(end.y-start.y);
 textureStore(outputDepth,p,vec4f(points[representative].xyz,total/area));
 textureStore(outputLight,p,vec4f(radiance/total,1.0));
 textureStore(outputNormal,p,normals[representative]);
}
`;

export function createCoherentPyramidGPU(device) {
 const module=device.createShaderModule({label:'SSGI compatible surface pyramid',code:SSGI_COHERENT_PYRAMID_WGSL});
 const layout=device.createBindGroupLayout({entries:[
  ...[0,1,2].map(binding=>({binding,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:'unfilterable-float'}})),
  ...['rgba32float','rgba16float','rgba16float'].map((format,i)=>({binding:i+3,visibility:GPUShaderStage.COMPUTE,storageTexture:{access:'write-only',format}})),
  {binding:6,visibility:GPUShaderStage.COMPUTE,buffer:{type:'uniform'}}
 ]});
 const pipelineLayout=device.createPipelineLayout({bindGroupLayouts:[layout]});
 const pipelines=Object.fromEntries(['initialize','reduce'].map(entryPoint=>[entryPoint,device.createComputePipeline({label:'SSGI pyramid '+entryPoint,layout:pipelineLayout,compute:{module,entryPoint}})]));
 const params=device.createBuffer({size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
 return {
  run(inputs,outputs,values){
   device.queue.writeBuffer(params,0,values);const encoder=device.createCommandEncoder({label:'SSGI compatible mip construction'});
   for(let level=0;level<outputs[0].mipLevelCount;level++){
    const source=level===0?inputs:outputs,sourceLevel=level===0?0:level-1;
    const group=device.createBindGroup({layout,entries:[
     ...source.map((texture,binding)=>({binding,resource:texture.createView({baseMipLevel:sourceLevel,mipLevelCount:1})})),
     ...outputs.map((texture,i)=>({binding:i+3,resource:texture.createView({baseMipLevel:level,mipLevelCount:1})})),
     {binding:6,resource:{buffer:params}}
    ]});
    const pass=encoder.beginComputePass({label:'SSGI compatible mip '+level});pass.setPipeline(pipelines[level===0?'initialize':'reduce']);pass.setBindGroup(0,group);
    pass.dispatchWorkgroups(Math.ceil(Math.max(1,outputs[0].width>>level)/8),Math.ceil(Math.max(1,outputs[0].height>>level)/8));pass.end();
   }
   device.queue.submit([encoder.finish()]);
  },dispose(){params.destroy();}
 };
}
