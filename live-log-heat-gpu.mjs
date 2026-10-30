import * as THREE from './lib/three.webgpu.js';
import {LIVE_LOG_GRID,LIVE_LOG_HEAT_IDENTITY,LIVE_LOG_THERMAL_MODEL,LIVE_LOG_BURN_RATE,LIVE_LOG_GAS_EXPANSION_RATIO,LIVE_LOG_CELL_WGSL,logEvolutionWGSL,checkLiveLogFrame} from './live-log-heat-core.mjs';
import {createLogSurfaceMask} from './live-log-surface-mask.mjs';
import {LOG_DISINTEGRATION_RATE,LOG_CONSUMPTION_WGSL} from './log-consumption.mjs';

export function liveLogHeatWGSL(disintegrate=false){return `
struct Params { gridDt:vec4<f32>, lo:vec4<f32>, size:vec4<f32>, localToVolume:mat4x4<f32>, normalToVolume:mat4x4<f32>, gas:vec4<f32> }
struct Surface { point:vec4<f32>, normal:vec4<f32> }
${logEvolutionWGSL(disintegrate?LOG_DISINTEGRATION_RATE:LIVE_LOG_BURN_RATE)}
${disintegrate?LOG_CONSUMPTION_WGSL:''}
@group(0) @binding(0) var<storage,read> fluid:array<vec4<f32>>;
@group(0) @binding(1) var<storage,read> before:array<LogCell>;
@group(0) @binding(2) var<storage,read_write> after:array<LogCell>;
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
  return max(0.0,fluid[base+1u].y);
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
  return before[q.x+N*(q.y+N*q.z)].material.x;
}
${disintegrate?`
const directions=array<vec3<i32>,6>(vec3<i32>(1,0,0),vec3<i32>(-1,0,0),vec3<i32>(0,1,0),vec3<i32>(0,-1,0),vec3<i32>(0,0,1),vec3<i32>(0,0,-1));
fn hasMaterial(c:vec3<i32>)->bool{
 if(any(c<vec3<i32>(0))||any(c>=vec3<i32>(i32(N)))){return false;}
 return materialPresent(before[u32(c.x)+N*(u32(c.y)+N*u32(c.z))].burn.y);
}
fn exposedCount(c:vec3<i32>)->u32{var count=0u;for(var j=0u;j<6u;j++){if(!hasMaterial(c+directions[j])){count++;}}return count;}
fn gasHasMaterial(c:vec3<i32>)->bool{
 if(any(c<vec3<i32>(0))||any(c>=vec3<i32>(i32(N)))){return false;}
 return materialPresent(after[u32(c.x)+N*(u32(c.y)+N*u32(c.z))].burn.y);
}
fn faceSample(c:vec3<u32>,j:u32)->Surface{
 let point=params.lo.xyz+(vec3<f32>(c)+vec3<f32>(0.5)+vec3<f32>(directions[j])*0.5)*params.size.xyz/f32(N);
 return Surface(vec4<f32>(point,1),vec4<f32>(vec3<f32>(directions[j]),0));
}
fn volumeHeat(c:vec3<u32>)->f32{
 var heat=0.0;var count=0.0;for(var j=0u;j<6u;j++){if(!hasMaterial(vec3<i32>(c)+directions[j])){heat+=surfaceHeat(faceSample(c,j));count+=1.0;}}
 return heat/max(count,1.0);
}`:''}
@compute @workgroup_size(4,4,4)
fn advance(@builtin(global_invocation_id) c:vec3<u32>) {
  if(any(c>=vec3<u32>(N))){return;}
  let index=c.x+N*(c.y+N*c.z);
  let exposure=${disintegrate?'volumeHeat(c)':'surfaceHeat(surfaces[index])'};
  let old=before[index];let dt=params.gridDt.w;
  let q=vec3<i32>(c);
  let mean=(localHeat(q+vec3<i32>(1,0,0))+localHeat(q-vec3<i32>(1,0,0))+localHeat(q+vec3<i32>(0,1,0))+localHeat(q-vec3<i32>(0,1,0))+localHeat(q+vec3<i32>(0,0,1))+localHeat(q-vec3<i32>(0,0,1)))/6.0;
  let conducted=mix(old.material.x,mean,1.0-exp(-2.4*dt));
  ${disintegrate?`var next=finiteConsumption(old,evolveLog(old,exposure,conducted,dt,hasMaterial(q)&&exposedCount(q)>0u));
  next.material.z=next.burn.z/(materialRate*dt);`:'let next=evolveLog(old,exposure,conducted,dt,surfaces[index].point.w>0.0);'}
  after[index]=next;
  textureStore(stateTexture,vec3<i32>(c),vec4<f32>(next.material.xyz,${disintegrate?'select(0.0,1.0,materialPresent(next.burn.y))':'next.material.w'}));
}
@group(0) @binding(7) var<storage,read_write> gasSums:array<atomic<u32>>;
fn addGasFloat(i:u32,value:f32){
  var old=atomicLoad(&gasSums[i]);
  loop{
    let next=bitcast<u32>(bitcast<f32>(old)+value);
    let result=atomicCompareExchangeWeak(&gasSums[i],old,next);
    if(result.exchanged){break;}old=result.old_value;
  }
}
fn depositGas(c:vec3<i32>,amount:f32,temperature:f32){
  let i=u32(c.x+i32(params.gridDt.x)*(c.y+i32(params.gridDt.y)*c.z))*2u;
  addGasFloat(i,amount);addGasFloat(i+1u,amount*temperature);
}
fn releaseGas(s:Surface,state:LogCell,rate:f32){
  let temperature=state.material.x*0.35;
  let p=(params.localToVolume*vec4<f32>(s.point.xyz,1.0)).xyz;
  let cell=vec3<i32>(floor(p*params.gridDt.x));
  if(!inside(cell)){return;}
  if(!solid(cell)){depositGas(cell,rate,temperature);return;}
  let normal=normalize((params.normalToVolume*vec4<f32>(s.normal.xyz,0.0)).xyz);
  let directions=array<vec3<i32>,6>(vec3<i32>(1,0,0),vec3<i32>(-1,0,0),vec3<i32>(0,1,0),vec3<i32>(0,-1,0),vec3<i32>(0,0,1),vec3<i32>(0,0,-1));
  var total=0.0;
  for(var j=0u;j<6u;j++){let q=cell+directions[j];if(inside(q)&&!solid(q)){total+=max(0.0,dot(normal,vec3<f32>(directions[j])));}}
  if(total==0.0){return;}
  for(var j=0u;j<6u;j++){
    let q=cell+directions[j];let weight=max(0.0,dot(normal,vec3<f32>(directions[j])));
    if(weight>0.0&&inside(q)&&!solid(q)){depositGas(q,rate*weight/total,temperature);}
  }
}
@compute @workgroup_size(4,4,4)
fn emitFuel(@builtin(global_invocation_id) c:vec3<u32>){
 if(any(c>=vec3<u32>(N))){return;}
 let i=c.x+N*(c.y+N*c.z);let state=after[i];if(state.material.z<=0.0){return;}
 let rate=state.material.z*${disintegrate?LOG_DISINTEGRATION_RATE:LIVE_LOG_BURN_RATE}/60.0*params.gas.x;
 ${disintegrate?`var count=0u;for(var j=0u;j<6u;j++){if(!gasHasMaterial(vec3<i32>(c)+directions[j])){count++;}}if(count==0u){return;}
 for(var j=0u;j<6u;j++){if(!gasHasMaterial(vec3<i32>(c)+directions[j])){releaseGas(faceSample(c,j),state,rate/f32(count));}}`:
 'if(surfaces[i].point.w>0.0){releaseGas(surfaces[i],state,rate);}'}
}`;}
export const LIVE_LOG_HEAT_WGSL=liveLogHeatWGSL();

export const LIVE_LOG_SUMMARY_WGSL=`
${LIVE_LOG_CELL_WGSL}
@group(0) @binding(0) var<storage,read> cells:array<LogCell>;
@group(0) @binding(1) var summary:texture_storage_2d<rgba16float,write>;
@group(0) @binding(2) var<storage,read> surface:array<u32>;
@compute @workgroup_size(1)
fn summarize() {
  var peak=vec4<f32>(0.0);
  for(var i=0u;i<${LIVE_LOG_GRID**3}u;i++){if(surface[i]!=0u){peak=max(peak,cells[i].material);}}
  textureStore(summary,vec2<i32>(0),peak);
}`;

export async function createLiveLogHeatGpu({renderer,mesh,bounds,disintegrate=false,surfaceMask:preparedMask=null}) {
  const device=renderer.backend.device;
  if(!device?.createComputePipelineAsync)throw Error('Live log requires WebGPU');
  const size=bounds.getSize(new THREE.Vector3());
  if(Math.min(size.x,size.y,size.z)<=0)throw Error('Live log requires volumetric mesh bounds');
  const surfaceMask=preparedMask??createLogSurfaceMask(mesh.geometry,bounds,LIVE_LOG_GRID,{filled:disintegrate});
  const summaryCellCount=surfaceMask.reduce((a,b)=>a+b,0);
  const owned=[];let disposed=false;
  try {
    const module=device.createShaderModule({label:'live log local heat',code:liveLogHeatWGSL(disintegrate)});
    const info=await module.getCompilationInfo();
    const errors=info.messages.filter(m=>m.type==='error');
    if(errors.length)throw Error('Live log WGSL: '+errors.map(m=>`${m.lineNum}:${m.linePos} ${m.message}`).join('; '));
    const pipeline=await device.createComputePipelineAsync({label:'live log thermal evolution',layout:'auto',compute:{module,entryPoint:'advance'}});
    const gasPipeline=await device.createComputePipelineAsync({label:'live log fuel release',layout:'auto',compute:{module,entryPoint:'emitFuel'}});
    const summaryModule=device.createShaderModule({label:'live log burn summary',code:LIVE_LOG_SUMMARY_WGSL});
    const summaryInfo=await summaryModule.getCompilationInfo();
    if(summaryInfo.messages.some(m=>m.type==='error'))throw Error('Live log summary WGSL: '+summaryInfo.messages.filter(m=>m.type==='error').map(m=>m.message).join('; '));
    const summaryPipeline=await device.createComputePipelineAsync({label:'live log burn status',layout:'auto',compute:{module:summaryModule,entryPoint:'summarize'}});
    const buffers=[0,1].map(i=>{const b=device.createBuffer({label:'live log resident state '+i,size:LIVE_LOG_GRID**3*32,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC});owned.push(b);return b;});
    const surface=device.createBuffer({label:'live log mesh-intersecting cells',size:surfaceMask.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});owned.push(surface);device.queue.writeBuffer(surface,0,surfaceMask);
    const samples=device.createBuffer({label:'live log surface points and normals',size:surfaceMask.samples.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});owned.push(samples);device.queue.writeBuffer(samples,0,surfaceMask.samples);
    const params=device.createBuffer({label:'live log local-to-volume transform',size:192,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});owned.push(params);
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
    function writeParams(source){
      if(disposed)throw Error('Live log is disposed');checkLiveLogFrame(source,device);
      mesh.updateWorldMatrix(true,false);
      if(Math.abs(mesh.matrixWorld.determinant())<1e-12)throw Error('Live log transform is singular');
      const s=source.transform.scale,worldToVolume=new THREE.Matrix4().makeScale(.5/s,.5/s,.5/s);
      worldToVolume.setPosition(...source.transform.translate.map(x=>.5-x*.5/s));
      const matrix=worldToVolume.multiply(mesh.matrixWorld),normalMatrix=matrix.clone().invert().transpose();
      const values=new Float32Array(48);values.set([...source.dimensions,source.dt]);values.set(bounds.min.toArray(),4);values.set(size.toArray(),8);values.set(matrix.elements,12);values.set(normalMatrix.elements,28);
      values[44]=LIVE_LOG_GAS_EXPANSION_RATIO*size.x*size.y*size.z*Math.abs(mesh.matrixWorld.determinant())/LIVE_LOG_GRID**3/(2*s/source.dimensions[0])**3;
      if(!values.every(Number.isFinite))throw Error('Nonfinite log source transform or cell mass');
      device.queue.writeBuffer(params,0,values);return matrix;
    }
    function reset(){
      if(disposed)throw Error('Live log is disposed');
      const initial=new Float32Array(LIVE_LOG_GRID**3*8);for(let i=0;i<LIVE_LOG_GRID**3;i++)initial[i*8+5]=disintegrate?surfaceMask[i]:1;
      for(const buffer of buffers)device.queue.writeBuffer(buffer,0,initial);
      const pixels=new Uint16Array(LIVE_LOG_GRID**3*4);if(disintegrate)for(let i=0;i<surfaceMask.length;i++)pixels[i*4+3]=surfaceMask[i]?0x3c00:0;
      device.queue.writeTexture({texture},pixels,{bytesPerRow:LIVE_LOG_GRID*8,rowsPerImage:LIVE_LOG_GRID},[LIVE_LOG_GRID,LIVE_LOG_GRID,LIVE_LOG_GRID]);
      device.queue.writeTexture({texture:summaryTexture},new Uint16Array(4),{bytesPerRow:8},[1,1]);
      index=0;steps=0;seconds=0;lastSource=null;generation++;
    }
    reset();
    return {device,stateNode,texture,summaryNode,summaryTexture,disintegrate,sampleState:coordinates=>THREE.TSL.texture3D(wrapper,coordinates),
      residentState:()=>({before:buffers[1-index],after:buffers[index],samples,initial:surfaceMask,surface:surfaceMask.surface,dimensions:[LIVE_LOG_GRID,LIVE_LOG_GRID,LIVE_LOG_GRID],bounds,mesh}),
      materialMask(objectId){mesh.updateWorldMatrix(true,false);const matrix=new THREE.Matrix4().makeScale(1/size.x,1/size.y,1/size.z);matrix.setPosition(-bounds.min.x/size.x,-bounds.min.y/size.y,-bounds.min.z/size.z);matrix.multiply(mesh.matrixWorld.clone().invert());return {objectId,device,texture,matrix:matrix.toArray(),revision:generation+':'+steps};},
      encode(encoder,source){
        const matrix=writeParams(source);
        let cached=cache.get(source.fluid);
        if(!cached||cached.collision!==source.collision){const groups=buffers.map((buffer,i)=>device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[
          {binding:0,resource:{buffer:source.fluid}},{binding:1,resource:{buffer}},{binding:2,resource:{buffer:buffers[1-i]}},
          {binding:3,resource:texture.createView()},{binding:4,resource:{buffer:params}},...(!disintegrate?[{binding:5,resource:{buffer:samples}}]:[]),{binding:6,resource:source.collision.createView()}]}));cached={collision:source.collision,groups};cache.set(source.fluid,cached);}
        const pass=encoder.beginComputePass({label:'live log heat and scar'});pass.setPipeline(pipeline);pass.setBindGroup(0,cached.groups[index]);pass.dispatchWorkgroups(LIVE_LOG_GRID/4,LIVE_LOG_GRID/4,LIVE_LOG_GRID/4);pass.end();
        index=1-index;
        const summaryPass=encoder.beginComputePass({label:'live log GPU burn summary'});summaryPass.setPipeline(summaryPipeline);summaryPass.setBindGroup(0,summaryGroups[index]);summaryPass.dispatchWorkgroups(1);summaryPass.end();
        steps++;seconds+=source.dt;lastSource={allocationId:source.allocationId,simStepCount:source.simStepCount,dimensions:[...source.dimensions],transform:structuredClone(source.transform),localToVolume:matrix.toArray()};
      },reset,
      encodeGasSource(encoder,source,target){
        writeParams(source);if(!target.enabled)return;
        const group=device.createBindGroup({layout:gasPipeline.getBindGroupLayout(0),entries:[{binding:2,resource:{buffer:buffers[index]}},{binding:4,resource:{buffer:params}},...(!disintegrate?[{binding:5,resource:{buffer:samples}}]:[]),{binding:6,resource:source.collision.createView()},{binding:7,resource:{buffer:target.accumulation}}]});
        const pass=encoder.beginComputePass({label:'wood fuel to exterior fluid'});pass.setPipeline(gasPipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(LIVE_LOG_GRID/4,LIVE_LOG_GRID/4,LIVE_LOG_GRID/4);pass.end();
      },
      read:()=>({identity:LIVE_LOG_HEAT_IDENTITY,model:disintegrate?'filled-material-finite-residue-v1':LIVE_LOG_THERMAL_MODEL,status:disposed?'disposed':'resident',grid:LIVE_LOG_GRID,generation,steps,referenceSeconds:seconds,lastSource,runtimeReadbacks:0,selfEmission:true,summaryDomain:disintegrate?'occupied-material-voxels':'mesh-intersecting-voxels',summaryCellCount,heatExchange:'outward-open-fluid-faces',conduction:'six-neighbour-local-grid',ignition:'local-temperature-dose',fuel:disintegrate?'finite-volume-gas-plus-residue':'finite-surface-cell-reserve'}),
      dispose(){if(disposed)return;disposed=true;for(const wrapped of [wrapper,summaryWrapper]){delete renderer.backend.get(wrapped).texture;wrapped.dispose();}for(const resource of owned)resource.destroy();cache=new WeakMap();},
    };
  }catch(error){for(const resource of owned)resource.destroy();throw error;}
}
