import * as THREE from './lib/three.webgpu.js';
import {FUSE_SAMPLES,FUSE_IDENTITY,FUSE_EVOLUTION_WGSL,coldFuse} from './fuse-core.mjs';
import {checkLiveLogFrame} from './live-log-heat-core.mjs';

export const FUSE_GPU_WGSL=`
${FUSE_EVOLUTION_WGSL}
struct Params { gridDt:vec4<f32>, localToVolume:mat4x4<f32>, material:vec4<f32> }
@group(0) @binding(0) var<storage,read> fluid:array<vec4<f32>>;
@group(0) @binding(1) var<storage,read> before:array<FuseCell>;
@group(0) @binding(2) var<storage,read_write> after:array<FuseCell>;
@group(0) @binding(3) var stateTexture:texture_storage_2d<rgba16float,write>;
@group(0) @binding(4) var<uniform> p:Params;
@group(0) @binding(5) var<storage,read> points:array<vec4<f32>>;
@group(0) @binding(6) var solids:texture_3d<u32>;
const N:u32=${FUSE_SAMPLES}u;
fn inside(c:vec3<i32>)->bool{return all(c>=vec3<i32>(0))&&all(c<vec3<i32>(p.gridDt.xyz));}
fn solid(c:vec3<i32>)->bool{return textureLoad(solids,c,0).x!=0u;}
fn heat(c:vec3<i32>)->f32{let i=u32(c.x+i32(p.gridDt.x)*(c.y+i32(p.gridDt.y)*c.z))*4u;return max(0.0,fluid[i+1u].y)+.2*max(0.0,fluid[i+2u].x);}
fn volumeCell(i:u32)->vec3<i32>{return vec3<i32>(floor((p.localToVolume*vec4<f32>(points[i].xyz,1.0)).xyz*p.gridDt.x));}
const directions=array<vec3<i32>,6>(vec3<i32>(1,0,0),vec3<i32>(-1,0,0),vec3<i32>(0,1,0),vec3<i32>(0,-1,0),vec3<i32>(0,0,1),vec3<i32>(0,0,-1));
@compute @workgroup_size(64)
fn advance(@builtin(global_invocation_id) id:vec3<u32>){
 let i=id.x;if(i>=N){return;}let c=volumeCell(i);var exposure=0.0;
 if(inside(c)){
  if(!solid(c)){exposure=heat(c);}else{
   var weight=0.0;for(var j=0u;j<6u;j++){let q=c+directions[j];if(inside(q)&&!solid(q)){exposure+=heat(q);weight+=1.0;}}
   if(weight>0.0){exposure/=weight;}
  }
 }
 let mean=(before[select(i-1u,i,i==0u)].material.x+before[min(i+1u,N-1u)].material.x)*.5;
 let next=evolveFuse(before[i],exposure,mean,p.gridDt.w,p.material.x);
 after[i]=next;textureStore(stateTexture,vec2<i32>(i32(i),0),next.material);
}
@group(0) @binding(7) var<storage,read_write> gas:array<atomic<u32>>;
fn add(i:u32,v:f32){var old=atomicLoad(&gas[i]);loop{let r=atomicCompareExchangeWeak(&gas[i],old,bitcast<u32>(bitcast<f32>(old)+v));if(r.exchanged){break;}old=r.old_value;}}
fn deposit(c:vec3<i32>,amount:f32,t:f32){let i=u32(c.x+i32(p.gridDt.x)*(c.y+i32(p.gridDt.y)*c.z))*2u;add(i,amount);add(i+1u,amount*t);}
@compute @workgroup_size(64)
fn emitFuel(@builtin(global_invocation_id) id:vec3<u32>){
 let i=id.x;if(i>=N){return;}let s=after[i];if(s.material.z<=0.0){return;}
 let c=volumeCell(i);if(!inside(c)){return;}let amount=s.material.z/60.0*p.material.y;
 if(!solid(c)){deposit(c,amount,s.material.x*.35);return;}
 var open=0.0;for(var j=0u;j<6u;j++){let q=c+directions[j];if(inside(q)&&!solid(q)){open+=1.0;}}
 if(open>0.0){for(var j=0u;j<6u;j++){let q=c+directions[j];if(inside(q)&&!solid(q)){deposit(q,amount/open,s.material.x*.35);}}}
}
@group(0) @binding(8) var summary:texture_storage_2d<rgba16float,write>;
@compute @workgroup_size(1)
fn summarize(){var peak=vec4<f32>(0.0);for(var i=0u;i<N;i++){peak=max(peak,after[i].material);}textureStore(summary,vec2<i32>(0),peak);}
`;

export async function createFuseGpu({renderer,mesh,points,length,radius}){
  const device=renderer.backend.device;if(!device)throw Error('Fuse requires the scene WebGPU device');
  if(points.length!==FUSE_SAMPLES||![length,radius].every(v=>Number.isFinite(v)&&v>0))throw Error('Invalid fuse centreline');
  const owned=[],wrappers=[];let disposed=false;
  const buffer=(label,size,usage)=>{const b=device.createBuffer({label,size,usage});owned.push(b);return b;};
  const texture=(label,size)=>{const t=device.createTexture({label,size,format:'rgba16float',usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});owned.push(t);return t;};
  try{
    const module=device.createShaderModule({label:'fuse resident material chain',code:FUSE_GPU_WGSL});
    const errors=(await module.getCompilationInfo()).messages.filter(m=>m.type==='error');
    if(errors.length)throw Error('Fuse WGSL: '+errors.map(m=>`${m.lineNum}:${m.linePos} ${m.message}`).join('; '));
    const pipelines={};for(const entryPoint of ['advance','emitFuel','summarize'])pipelines[entryPoint]=await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint}});
    const buffers=[0,1].map(i=>buffer('fuse resident state '+i,FUSE_SAMPLES*32,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC));
    const sampleBuffer=buffer('fuse material positions',FUSE_SAMPLES*16,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST);
    const positions=new Float32Array(FUSE_SAMPLES*4);points.forEach((v,i)=>positions.set([...v.toArray(),1],i*4));device.queue.writeBuffer(sampleBuffer,0,positions);
    const params=buffer('fuse material frame',96,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
    const stateTexture=texture('fuse local heat char reaction',[FUSE_SAMPLES,1]),summaryTexture=texture('fuse burn summary',[1,1]);
    const wrap=t=>{const w=new THREE.ExternalTexture(t);w.type=THREE.HalfFloatType;w.format=THREE.RGBAFormat;w.colorSpace=THREE.NoColorSpace;w.minFilter=THREE.LinearFilter;w.magFilter=THREE.LinearFilter;w.generateMipmaps=false;wrappers.push(w);return w;};
    const stateNode=THREE.TSL.texture(wrap(stateTexture),THREE.TSL.vec2(THREE.TSL.uv().x,.5));
    const summaryNode=THREE.TSL.texture(wrap(summaryTexture),THREE.TSL.vec2(.5,.5));
    let index=0,steps=0,generation=0;let cache=new WeakMap();
    const summaryGroups=buffers.map(b=>device.createBindGroup({layout:pipelines.summarize.getBindGroupLayout(0),entries:[{binding:2,resource:{buffer:b}},{binding:8,resource:summaryTexture.createView()}]}));
    function frame(source){
      checkLiveLogFrame(source,device);if(disposed)throw Error('Fuse disposed');mesh.updateWorldMatrix(true,false);
      if(Math.abs(mesh.matrixWorld.determinant())<1e-12)throw Error('Singular fuse transform');
      const scale=source.transform.scale,matrix=new THREE.Matrix4().makeScale(.5/scale,.5/scale,.5/scale);
      matrix.setPosition(...source.transform.translate.map(v=>.5-v*.5/scale));matrix.multiply(mesh.matrixWorld);
      const worldScale=mesh.getWorldScale(new THREE.Vector3());
      // The cord's material metric follows its authored length and current longitudinal scale.
      const spacing=length/(FUSE_SAMPLES-1)*Math.max(Math.abs(worldScale.x),Math.abs(worldScale.y),Math.abs(worldScale.z));
      const values=new Float32Array(24);values.set([...source.dimensions,source.dt]);values.set(matrix.elements,4);
      values.set([spacing,400*Math.PI*radius*radius*length/FUSE_SAMPLES*Math.abs(mesh.matrixWorld.determinant())/(2*scale/source.dimensions[0])**3,0,0],20);
      if(!values.every(Number.isFinite))throw Error('Invalid fuse frame');device.queue.writeBuffer(params,0,values);
    }
    function reset(){const initial=coldFuse();for(const b of buffers)device.queue.writeBuffer(b,0,initial);
      device.queue.writeTexture({texture:stateTexture},new Uint16Array(FUSE_SAMPLES*4),{bytesPerRow:FUSE_SAMPLES*8},[FUSE_SAMPLES,1]);
      device.queue.writeTexture({texture:summaryTexture},new Uint16Array(4),{bytesPerRow:8},[1,1]);index=0;steps=0;generation++;}
    reset();
    return {device,stateNode,summaryNode,summaryTexture,reset,
      encode(encoder,source){frame(source);let cached=cache.get(source.fluid);
        if(!cached||cached.collision!==source.collision){cached={collision:source.collision,groups:buffers.map((b,i)=>device.createBindGroup({layout:pipelines.advance.getBindGroupLayout(0),entries:[
          {binding:0,resource:{buffer:source.fluid}},{binding:1,resource:{buffer:b}},{binding:2,resource:{buffer:buffers[1-i]}},{binding:3,resource:stateTexture.createView()},{binding:4,resource:{buffer:params}},{binding:5,resource:{buffer:sampleBuffer}},{binding:6,resource:source.collision.createView()}]}))};cache.set(source.fluid,cached);}
        let p=encoder.beginComputePass({label:'fuse heat ignition and finite fuel'});p.setPipeline(pipelines.advance);p.setBindGroup(0,cached.groups[index]);p.dispatchWorkgroups(Math.ceil(FUSE_SAMPLES/64));p.end();index=1-index;steps++;
        p=encoder.beginComputePass({label:'fuse local burn status'});p.setPipeline(pipelines.summarize);p.setBindGroup(0,summaryGroups[index]);p.dispatchWorkgroups(1);p.end();
      },
      encodeGasSource(encoder,source,target){frame(source);if(!target.enabled)return;
        const group=device.createBindGroup({layout:pipelines.emitFuel.getBindGroupLayout(0),entries:[{binding:2,resource:{buffer:buffers[index]}},{binding:4,resource:{buffer:params}},{binding:5,resource:{buffer:sampleBuffer}},{binding:6,resource:source.collision.createView()},{binding:7,resource:{buffer:target.accumulation}}]});
        const p=encoder.beginComputePass({label:'fuse fuel to shared fluid'});p.setPipeline(pipelines.emitFuel);p.setBindGroup(0,group);p.dispatchWorkgroups(Math.ceil(FUSE_SAMPLES/64));p.end();},
      async sample(){const b=buffer('explicit fuse diagnostic',FUSE_SAMPLES*32,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ);try{const e=device.createCommandEncoder();e.copyBufferToBuffer(buffers[index],0,b,0,b.size);device.queue.submit([e.finish()]);await b.mapAsync(GPUMapMode.READ);return Array.from(new Float32Array(b.getMappedRange()));}finally{b.unmap();b.destroy();owned.splice(owned.indexOf(b),1);}},
      read:()=>({identity:FUSE_IDENTITY,status:disposed?'disposed':'resident',samples:FUSE_SAMPLES,steps,generation,representation:'arc-length-material-chain',calibration:'provisional-energetic-cord',runtimeReadbacks:0}),
      dispose(){if(disposed)return;disposed=true;for(const w of wrappers){delete renderer.backend.get(w).texture;w.dispose();}for(const r of owned)r.destroy();cache=new WeakMap();}
    };
  }catch(error){for(const r of owned)r.destroy();throw error;}
}
