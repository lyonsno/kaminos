import {Matrix4,Vector3} from './lib/three.core.js';

// Same pointer-event reduction as fracture-resident-surface: query triangles on
// the device and return only the winning face/distance. This adapter consumes
// burn poses and remaining material, not the Stone positions/quaternions ABI.
export const BURN_PICK_WGSL=`
struct Params{origin:vec4f,direction:vec4f,lo:vec4f,size:vec4f,counts:vec4u}
@group(0) @binding(0) var<storage,read> faces:array<vec4f>;
@group(0) @binding(1) var poses:texture_2d<f32>;
@group(0) @binding(2) var material:texture_3d<f32>;
@group(0) @binding(3) var linearSampler:sampler;
@group(0) @binding(4) var<uniform> p:Params;
@group(0) @binding(5) var<storage,read_write> hit:array<atomic<u32>>;
fn intersection(i:u32)->f32{
 let aa=faces[i*3u];let bb=faces[i*3u+1u];let cc=faces[i*3u+2u];let cap=u32(bb.w);let region=i32(aa.w);
 if(cap>0u&&textureLoad(poses,vec2i(0,i32(p.counts.y+cap-1u)),0).x>=.5){return -1.0;}
 let pose=mat4x4f(textureLoad(poses,vec2i(0,region),0),textureLoad(poses,vec2i(1,region),0),textureLoad(poses,vec2i(2,region),0),textureLoad(poses,vec2i(3,region),0));
 let a=(pose*vec4f(aa.xyz,1)).xyz;let b=(pose*vec4f(bb.xyz,1)).xyz;let c=(pose*vec4f(cc.xyz,1)).xyz;
 let e=b-a;let f=c-a;let h=cross(p.direction.xyz,f);let det=dot(e,h);
 if(abs(det)<1e-12||(cc.w==0.0&&det<0.0)||(cc.w==1.0&&det>0.0)){return -1.0;}
 let s=p.origin.xyz-a;let u=dot(s,h)/det;if(u<0.0||u>1.0){return -1.0;}
 let q=cross(s,e);let v=dot(p.direction.xyz,q)/det;if(v<0.0||u+v>1.0){return -1.0;}
 let t=dot(f,q)/det;if(t<0.0){return -1.0;}
 let rest=aa.xyz+(bb.xyz-aa.xyz)*u+(cc.xyz-aa.xyz)*v;
 if(textureSampleLevel(material,linearSampler,(rest-p.lo.xyz)/p.size.xyz,0).w<=.5){return -1.0;}
 return t;
}
@compute @workgroup_size(1) fn clear(){atomicStore(&hit[0],0x7f800000u);atomicStore(&hit[1],0xffffffffu);}
@compute @workgroup_size(64) fn nearest(@builtin(global_invocation_id) id:vec3u){if(id.x>=p.counts.x){return;}let t=intersection(id.x);if(t>=0.0){atomicMin(&hit[0],bitcast<u32>(t));}}
@compute @workgroup_size(64) fn face(@builtin(global_invocation_id) id:vec3u){if(id.x>=p.counts.x){return;}let t=intersection(id.x);if(t>=0.0&&bitcast<u32>(t)==atomicLoad(&hit[0])){atomicMin(&hit[1],id.x);}}
`;

export function createBurnFracturePicker({field,dynamics,mesh,arrays,owners,caps,regions}){
 const device=field.device,resources=[],{bounds}=field.residentState();let disposed=false,compiled=null,tail=Promise.resolve(),queries=0;
 const allocate=(label,data,usage)=>{const buffer=device.createBuffer({label,size:data.byteLength,usage:usage|GPUBufferUsage.COPY_DST});device.queue.writeBuffer(buffer,0,data);resources.push(buffer);return buffer;};
 async function compile(){
  const count=arrays.positions.length/9,data=new Float32Array(count*12),materials=Array.isArray(mesh.material)?mesh.material:[mesh.material];
  for(let i=0;i<count;i++){for(let v=0;v<3;v++)data.set(arrays.positions.subarray(i*9+v*3,i*9+v*3+3),i*12+v*4);data[i*12+3]=owners[i*3];data[i*12+7]=caps[i*3];data[i*12+11]=materials[arrays.faceMaterial[i]]?.side??0;}
  const faces=allocate('Burn posed selection triangles',data,GPUBufferUsage.STORAGE),params=allocate('Burn pointer ray and material bounds',new Uint8Array(80),GPUBufferUsage.UNIFORM),hit=allocate('Burn nearest visible face',new Uint32Array(2),GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC);
  const module=device.createShaderModule({code:BURN_PICK_WGSL}),info=await module.getCompilationInfo();if(info.messages.some(m=>m.type==='error'))throw Error(info.messages.map(m=>m.message).join('\n'));
  const layout=device.createBindGroupLayout({entries:[
   {binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:'read-only-storage'}},
   {binding:1,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:'unfilterable-float'}},
   {binding:2,visibility:GPUShaderStage.COMPUTE,texture:{viewDimension:'3d'}},
   {binding:3,visibility:GPUShaderStage.COMPUTE,sampler:{type:'filtering'}},
   {binding:4,visibility:GPUShaderStage.COMPUTE,buffer:{type:'uniform'}},
   {binding:5,visibility:GPUShaderStage.COMPUTE,buffer:{type:'storage'}},
  ]}),pipelineLayout=device.createPipelineLayout({bindGroupLayouts:[layout]}),pipelines={};
  for(const entryPoint of ['clear','nearest','face'])pipelines[entryPoint]=await device.createComputePipelineAsync({layout:pipelineLayout,compute:{module,entryPoint}});
  if(disposed)return null;
  const group=device.createBindGroup({layout,entries:[{binding:0,resource:{buffer:faces}},{binding:1,resource:dynamics.texture.createView()},{binding:2,resource:field.texture.createView()},{binding:3,resource:device.createSampler({minFilter:'linear',magFilter:'linear'})},{binding:4,resource:{buffer:params}},{binding:5,resource:{buffer:hit}}]});
  return {count,params,hit,group,pipelines};
 }
 async function query(ray){
  if(disposed)return null;const state=await(compiled??=compile());if(disposed)return null;
  mesh.updateWorldMatrix(true,false);const world=mesh.matrixWorld.clone(),local=ray.clone().applyMatrix4(new Matrix4().copy(world).invert());
  const bytes=new ArrayBuffer(80);new Float32Array(bytes).set([...local.origin,0,...local.direction,0,...bounds.min,0,...bounds.getSize(new Vector3()),0]);new Uint32Array(bytes).set([state.count,regions,0,0],16);
  const read=device.createBuffer({label:'Burn pointer result only',size:8,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  try{
   device.queue.writeBuffer(state.params,0,bytes);const encoder=device.createCommandEncoder();
   for(const name of ['clear','nearest','face']){const pass=encoder.beginComputePass();pass.setPipeline(state.pipelines[name]);pass.setBindGroup(0,state.group);pass.dispatchWorkgroups(name==='clear'?1:Math.ceil(state.count/64));pass.end();}
   encoder.copyBufferToBuffer(state.hit,0,read,0,8);device.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);queries++;
   const data=read.getMappedRange(),faceIndex=new Uint32Array(data)[1],distance=new Float32Array(data)[0];mesh.updateWorldMatrix(true,false);
   if(disposed||faceIndex===0xffffffff||!mesh.matrixWorld.equals(world))return null;
   const point=local.at(distance,new Vector3()).applyMatrix4(world);return {point,distance:point.distanceTo(ray.origin),faceIndex,face:{materialIndex:arrays.faceMaterial[faceIndex]}};
  }finally{read.destroy();}
 }
 return {pick(ray){const captured=ray.clone(),task=tail.then(()=>query(captured));tail=task.catch(()=>{});return task;},read:()=>({queries,readbackBytes:queries*8,ordinaryStateReadbacks:0}),dispose(){if(disposed)return;disposed=true;void tail.finally(()=>{for(const resource of resources)resource.destroy();});}};
}
