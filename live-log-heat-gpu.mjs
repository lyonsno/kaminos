import * as THREE from './lib/three.webgpu.js';
import {LIVE_LOG_GRID,LIVE_LOG_HEAT_IDENTITY,LIVE_LOG_THERMAL_MODEL,checkLiveLogFrame} from './live-log-heat-core.mjs';
import {createLogSurfaceMask} from './live-log-surface-mask.mjs';

export const LIVE_LOG_HEAT_WGSL=`
struct Params { gridDt:vec4<f32>, lo:vec4<f32>, size:vec4<f32>, localToVolume:mat4x4<f32>, normalToVolume:mat4x4<f32> }
struct Surface { point:vec4<f32>, normal:vec4<f32> }
@group(0) @binding(0) var<storage,read> fluid:array<vec4<f32>>;
@group(0) @binding(1) var<storage,read> before:array<vec4<f32>>;
@group(0) @binding(2) var<storage,read_write> after:array<vec4<f32>>;
@group(0) @binding(3) var stateTexture:texture_storage_3d<rgba16float,write>;
@group(0) @binding(4) var<uniform> params:Params;
@group(0) @binding(5) var<storage,read> surfaces:array<Surface>;
@group(0) @binding(6) var solids:texture_3d<u32>;
const N:u32=${LIVE_LOG_GRID}u;
fn inside(c:vec3<i32>)->bool{return all(c>=vec3<i32>(0))&&all(c<vec3<i32>(params.gridDt.xyz));}
fn solid(c:vec3<i32>)->bool{
  if(any(textureDimensions(solids)!=vec3<u32>(params.gridDt.xyz))){return false;}
  return textureLoad(solids,c,0).x!=0u;
}
fn fluidHeat(c:vec3<i32>)->f32{
  let base=u32(c.x+i32(params.gridDt.x)*(c.y+i32(params.gridDt.y)*c.z))*4u;
  return max(0.0,fluid[base+1u].y)+0.20*max(0.0,fluid[base+2u].x);
}
fn surfaceHeat(s:Surface)->f32{
  if(s.point.w==0.0){return 0.0;}
  let p=(params.localToVolume*vec4<f32>(s.point.xyz,1.0)).xyz;
  let c=vec3<i32>(floor(p*params.gridDt.x));
  if(!inside(c)){return 0.0;}
  if(!solid(c)){return fluidHeat(c);}
  let normal=normalize((params.normalToVolume*vec4<f32>(s.normal.xyz,0.0)).xyz);
  let directions=array<vec3<i32>,6>(vec3<i32>(1,0,0),vec3<i32>(-1,0,0),vec3<i32>(0,1,0),vec3<i32>(0,-1,0),vec3<i32>(0,0,1),vec3<i32>(0,0,-1));
  var heat=0.0;var weight=0.0;
  // Only open, outward faces touch the fluid. Never search through another solid.
  for(var i=0u;i<6u;i++){
    let q=c+directions[i];let w=max(0.0,dot(normal,vec3<f32>(directions[i])));
    if(w>0.0&&inside(q)&&!solid(q)){heat+=w*fluidHeat(q);weight+=w;}
  }
  if(weight>0.0){return heat/weight;}
  return 0.0;
}
fn localHeat(c:vec3<i32>)->f32{
  let q=vec3<u32>(clamp(c,vec3<i32>(0),vec3<i32>(i32(N)-1)));
  return before[q.x+N*(q.y+N*q.z)].x;
}
@compute @workgroup_size(4,4,4)
fn advance(@builtin(global_invocation_id) c:vec3<u32>) {
  if(any(c>=vec3<u32>(N))){return;}
  let index=c.x+N*(c.y+N*c.z);
  let exposure=surfaceHeat(surfaces[index]);
  let old=before[index];let dt=params.gridDt.w;
  let q=vec3<i32>(c);
  let mean=(localHeat(q+vec3<i32>(1,0,0))+localHeat(q-vec3<i32>(1,0,0))+localHeat(q+vec3<i32>(0,1,0))+localHeat(q-vec3<i32>(0,1,0))+localHeat(q+vec3<i32>(0,0,1))+localHeat(q-vec3<i32>(0,0,1)))/6.0;
  let conducted=mix(old.x,mean,1.0-exp(-2.4*dt));
  let temperature=max(0.0,conducted+(exposure*1.6-conducted*0.35)*dt);
  let consumed=min(1.0-old.y,(1.0-old.y)*smoothstep(0.45,0.95,temperature)*0.18*dt);
  let reaction=consumed/(0.18*dt);let damage=old.y+consumed;
  after[index]=vec4<f32>(temperature,damage,reaction,exposure);
  textureStore(stateTexture,vec3<i32>(c),vec4<f32>(clamp(temperature,0.0,1.0),damage,reaction,exposure));
}`;

export const LIVE_LOG_SUMMARY_WGSL=`
@group(0) @binding(0) var<storage,read> cells:array<vec4<f32>>;
@group(0) @binding(1) var summary:texture_storage_2d<rgba16float,write>;
@group(0) @binding(2) var<storage,read> surface:array<u32>;
@compute @workgroup_size(1)
fn summarize() {
  var peak=vec4<f32>(0.0);
  for(var i=0u;i<${LIVE_LOG_GRID**3}u;i++){if(surface[i]!=0u){peak=max(peak,cells[i]);}}
  textureStore(summary,vec2<i32>(0),peak);
}`;

export async function createLiveLogHeatGpu({renderer,mesh,bounds}) {
  const device=renderer.backend.device;
  if(!device?.createComputePipelineAsync)throw Error('Live log requires WebGPU');
  const size=bounds.getSize(new THREE.Vector3());
  if(Math.min(size.x,size.y,size.z)<=0)throw Error('Live log requires volumetric mesh bounds');
  const surfaceMask=createLogSurfaceMask(mesh.geometry,bounds,LIVE_LOG_GRID);
  const summaryCellCount=surfaceMask.reduce((a,b)=>a+b,0);
  const owned=[];let disposed=false;
  try {
    const module=device.createShaderModule({label:'live log local heat',code:LIVE_LOG_HEAT_WGSL});
    const info=await module.getCompilationInfo();
    const errors=info.messages.filter(m=>m.type==='error');
    if(errors.length)throw Error('Live log WGSL: '+errors.map(m=>`${m.lineNum}:${m.linePos} ${m.message}`).join('; '));
    const pipeline=await device.createComputePipelineAsync({label:'live log thermal evolution',layout:'auto',compute:{module,entryPoint:'advance'}});
    const summaryModule=device.createShaderModule({label:'live log burn summary',code:LIVE_LOG_SUMMARY_WGSL});
    const summaryInfo=await summaryModule.getCompilationInfo();
    if(summaryInfo.messages.some(m=>m.type==='error'))throw Error('Live log summary WGSL: '+summaryInfo.messages.filter(m=>m.type==='error').map(m=>m.message).join('; '));
    const summaryPipeline=await device.createComputePipelineAsync({label:'live log burn status',layout:'auto',compute:{module:summaryModule,entryPoint:'summarize'}});
    const buffers=[0,1].map(i=>{const b=device.createBuffer({label:'live log resident state '+i,size:LIVE_LOG_GRID**3*16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});owned.push(b);return b;});
    const surface=device.createBuffer({label:'live log mesh-intersecting cells',size:surfaceMask.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});owned.push(surface);device.queue.writeBuffer(surface,0,surfaceMask);
    const samples=device.createBuffer({label:'live log surface points and normals',size:surfaceMask.samples.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});owned.push(samples);device.queue.writeBuffer(samples,0,surfaceMask.samples);
    const params=device.createBuffer({label:'live log local-to-volume transform',size:176,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});owned.push(params);
    const texture=device.createTexture({label:'live log thermal material',dimension:'3d',size:[LIVE_LOG_GRID,LIVE_LOG_GRID,LIVE_LOG_GRID],format:'rgba16float',usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});owned.push(texture);
    const summaryTexture=device.createTexture({label:'live log burn status texture',size:[1,1],format:'rgba16float',usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});owned.push(summaryTexture);
    const summaryWrapper=new THREE.ExternalTexture(summaryTexture);summaryWrapper.type=THREE.HalfFloatType;summaryWrapper.format=THREE.RGBAFormat;summaryWrapper.colorSpace=THREE.NoColorSpace;
    const summaryNode=THREE.TSL.texture(summaryWrapper,THREE.TSL.vec2(.5,.5));
    const summaryGroups=buffers.map(buffer=>device.createBindGroup({layout:summaryPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer}},{binding:1,resource:summaryTexture.createView()},{binding:2,resource:{buffer:surface}}]}));
    const wrapper=new THREE.ExternalTexture(texture);wrapper.is3DTexture=true;wrapper.image={width:LIVE_LOG_GRID,height:LIVE_LOG_GRID,depth:LIVE_LOG_GRID};
    wrapper.type=THREE.HalfFloatType;wrapper.format=THREE.RGBAFormat;wrapper.colorSpace=THREE.NoColorSpace;wrapper.minFilter=THREE.LinearFilter;wrapper.magFilter=THREE.LinearFilter;wrapper.generateMipmaps=false;
    const p=THREE.TSL.positionLocal.sub(THREE.TSL.vec3(...bounds.min.toArray())).div(THREE.TSL.vec3(...size.toArray()));
    const stateNode=THREE.TSL.texture3D(wrapper,p);
    let index=0,steps=0,seconds=0,lastSource=null,generation=1;let cache=new WeakMap();
    function reset(){
      if(disposed)throw Error('Live log is disposed');
      for(const buffer of buffers)device.queue.writeBuffer(buffer,0,new Float32Array(LIVE_LOG_GRID**3*4));
      device.queue.writeTexture({texture},new Uint16Array(LIVE_LOG_GRID**3*4),{bytesPerRow:LIVE_LOG_GRID*8,rowsPerImage:LIVE_LOG_GRID},[LIVE_LOG_GRID,LIVE_LOG_GRID,LIVE_LOG_GRID]);
      device.queue.writeTexture({texture:summaryTexture},new Uint16Array(4),{bytesPerRow:8},[1,1]);
      index=0;steps=0;seconds=0;lastSource=null;generation++;
    }
    reset();
    return {device,stateNode,texture,summaryNode,summaryTexture,
      encode(encoder,source){
        if(disposed)throw Error('Live log is disposed');checkLiveLogFrame(source,device);
        mesh.updateWorldMatrix(true,false);
        if(Math.abs(mesh.matrixWorld.determinant())<1e-12)throw Error('Live log transform is singular');
        const s=source.transform.scale;const worldToVolume=new THREE.Matrix4().makeScale(.5/s,.5/s,.5/s);
        worldToVolume.setPosition(...source.transform.translate.map(x=>.5-x*.5/s));
        const matrix=worldToVolume.multiply(mesh.matrixWorld);
        const normalMatrix=matrix.clone().invert().transpose();
        const values=new Float32Array(44);values.set([...source.dimensions,source.dt]);values.set(bounds.min.toArray(),4);values.set(size.toArray(),8);values.set(matrix.elements,12);values.set(normalMatrix.elements,28);
        device.queue.writeBuffer(params,0,values);
        let cached=cache.get(source.fluid);
        if(!cached||cached.collision!==source.collision){const groups=buffers.map((buffer,i)=>device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[
          {binding:0,resource:{buffer:source.fluid}},{binding:1,resource:{buffer}},{binding:2,resource:{buffer:buffers[1-i]}},
          {binding:3,resource:texture.createView()},{binding:4,resource:{buffer:params}},{binding:5,resource:{buffer:samples}},{binding:6,resource:source.collision.createView()}]}));cached={collision:source.collision,groups};cache.set(source.fluid,cached);}
        const pass=encoder.beginComputePass({label:'live log heat and scar'});pass.setPipeline(pipeline);pass.setBindGroup(0,cached.groups[index]);pass.dispatchWorkgroups(LIVE_LOG_GRID/4,LIVE_LOG_GRID/4,LIVE_LOG_GRID/4);pass.end();
        index=1-index;
        const summaryPass=encoder.beginComputePass({label:'live log GPU burn summary'});summaryPass.setPipeline(summaryPipeline);summaryPass.setBindGroup(0,summaryGroups[index]);summaryPass.dispatchWorkgroups(1);summaryPass.end();
        steps++;seconds+=source.dt;lastSource={allocationId:source.allocationId,simStepCount:source.simStepCount,dimensions:[...source.dimensions],transform:structuredClone(source.transform),localToVolume:matrix.toArray()};
      },reset,
      read:()=>({identity:LIVE_LOG_HEAT_IDENTITY,model:LIVE_LOG_THERMAL_MODEL,status:disposed?'disposed':'resident',grid:LIVE_LOG_GRID,generation,steps,referenceSeconds:seconds,lastSource,runtimeReadbacks:0,selfEmission:false,summaryDomain:'mesh-intersecting-voxels',summaryCellCount,heatExchange:'outward-open-fluid-faces',conduction:'six-neighbour-local-grid'}),
      dispose(){if(disposed)return;disposed=true;for(const wrapped of [wrapper,summaryWrapper]){delete renderer.backend.get(wrapped).texture;wrapped.dispose();}for(const resource of owned)resource.destroy();cache=new WeakMap();},
    };
  }catch(error){for(const resource of owned)resource.destroy();throw error;}
}
