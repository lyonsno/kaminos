import {createSurfaceThermalRadiance} from './burn-thermal-radiance.mjs';
import {LIVE_LOG_HEAT_TO_FLUID_HEAT} from './live-log-heat-core.mjs';
import * as THREE from './lib/three.webgpu.js';
import {LOG_RESIDUE} from './log-consumption.mjs';

export const LOG_DEBRIS_WGSL=`
struct Cell {material:vec4<f32>,burn:vec4<f32>}
struct Particle {positionHeat:vec4<f32>,velocityAge:vec4<f32>,sizeActive:vec4<f32>,source:vec4<f32>}
struct Params {matrix:mat4x4<f32>,previous:mat4x4<f32>,lo:vec4<f32>,size:vec4<f32>,ground:vec4<f32>,time:vec4<f32>}
@group(0) @binding(0) var<storage,read> before:array<Cell>;
@group(0) @binding(1) var<storage,read> after:array<Cell>;
@group(0) @binding(2) var<storage,read_write> particles:array<Particle>;
@group(0) @binding(3) var positionOutput:texture_storage_2d<rgba32float,write>;
@group(0) @binding(4) var sizeOutput:texture_storage_2d<rgba32float,write>;
@group(0) @binding(5) var<uniform> p:Params;
@compute @workgroup_size(64)
fn advance(@builtin(global_invocation_id) gid:vec3<u32>){
 let i=gid.x;let n=u32(p.time.y);if(i>=n*n*n){return;}
 var particle=particles[i];let dt=p.time.x;
 let c=vec3<f32>(f32(i%n),f32((i/n)%n),f32(i/(n*n)));
 if(particle.sizeActive.w==0.0&&before[i].burn.y>${LOG_RESIDUE+0.000001}&&after[i].burn.y<=${LOG_RESIDUE+0.000001}){
  let local=p.lo.xyz+(c+vec3<f32>(0.5))*p.size.xyz/f32(n);
  let world=(p.matrix*vec4<f32>(local,1)).xyz;
  let previous=(p.previous*vec4<f32>(local,1)).xyz;
  let radial=(p.matrix*vec4<f32>((c+vec3<f32>(0.5))/f32(n)-vec3<f32>(0.5),0)).xyz;
  let outward=radial/max(length(radial),0.000001);
  let scale=vec3<f32>(length(p.matrix[0].xyz),length(p.matrix[1].xyz),length(p.matrix[2].xyz));
  particle.positionHeat=vec4<f32>(world,after[i].material.x);
  particle.velocityAge=vec4<f32>((world-previous)/dt+outward*0.18+vec3<f32>(0,0.12,0),0);
  particle.sizeActive=vec4<f32>(p.size.xyz*scale/f32(n)*pow(${LOG_RESIDUE},1.0/3.0),1);
  particle.source=vec4<f32>(f32(i),${LOG_RESIDUE},0,0);
 }
 if(particle.sizeActive.w>0.5){
  particle.velocityAge=vec4<f32>((particle.velocityAge.xyz+vec3<f32>(0,-9.81,0)*dt)*exp(-0.4*dt),particle.velocityAge.w+dt);
  particle.positionHeat=vec4<f32>(particle.positionHeat.xyz+particle.velocityAge.xyz*dt,particle.positionHeat.w*exp(-0.65*dt));
  let halfHeight=particle.sizeActive.y*0.5;
  if(length(particle.positionHeat.xz-p.ground.xz)<=p.ground.w&&particle.positionHeat.y-halfHeight<p.ground.y&&particle.velocityAge.y<0.0){
   particle.positionHeat.y=p.ground.y+halfHeight;
   particle.velocityAge.y=-particle.velocityAge.y*0.12;
   particle.velocityAge.x=particle.velocityAge.x*max(0.0,1.0-6.0*dt);
   particle.velocityAge.z=particle.velocityAge.z*max(0.0,1.0-6.0*dt);
   particle.source.z=1.0;
  }
 }
 particles[i]=particle;
 let pixel=vec2<i32>(vec2<u32>(i%n,i/n));textureStore(positionOutput,pixel,particle.positionHeat);textureStore(sizeOutput,pixel,particle.sizeActive);
}`;

function external(renderer,texture){
 const wrapper=new THREE.ExternalTexture(texture);wrapper.type=THREE.FloatType;wrapper.format=THREE.RGBAFormat;
 wrapper.colorSpace=THREE.NoColorSpace;wrapper.minFilter=THREE.NearestFilter;wrapper.magFilter=THREE.NearestFilter;
 return {wrapper,dispose(){delete renderer.backend.get(wrapper).texture;wrapper.dispose();}};
}

export async function createLogDebrisGpu({renderer,field,ground,onFrame=null,thermalControls=null}){
 const device=field.device,{mesh,bounds,dimensions,initial,surface}=field.residentState(),n=dimensions[0],count=n**3;
 if(!field.disintegrate||!surface)throw Error('Debris requires a filled consumable material field');
 if(!ground||![...ground.center,ground.height,ground.radius].every(Number.isFinite)||ground.radius<=0)throw Error('Debris requires a finite ground disc');
 const owned=[],wrappers=[];let disposed=false,steps=0,unsubscribe=null;
 const allocate=resource=>{owned.push(resource);return resource;};
 try{
  const module=device.createShaderModule({label:'finite consumed wood debris',code:LOG_DEBRIS_WGSL});
  const errors=(await module.getCompilationInfo()).messages.filter(m=>m.type==='error');if(errors.length)throw Error(errors.map(m=>`${m.lineNum}:${m.linePos} ${m.message}`).join('; '));
  const pipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'advance'}});
  const particles=allocate(device.createBuffer({label:'one residue fragment per material cell',size:count*64,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC}));
  const params=allocate(device.createBuffer({label:'burn residue world motion and ground',size:192,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}));
  const makeTexture=()=>allocate(device.createTexture({size:[n,n*n],format:'rgba32float',usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST}));
  const positions=makeTexture(),sizes=makeTexture();
  const pos=external(renderer,positions),scale=external(renderer,sizes);wrappers.push(pos,scale);
  const {instanceIndex,ivec2,textureLoad,positionGeometry,vertexStage,vec3}=THREE.TSL;
  const pixel=ivec2(instanceIndex.mod(n).toInt(),instanceIndex.div(n).toInt());
  const position=textureLoad(pos.wrapper,pixel),size=textureLoad(scale.wrapper,pixel);
  const material=new THREE.MeshStandardNodeMaterial({color:0x15110e,roughness:.5,metalness:0,alphaTest:.5});owned.push(material);
  material.positionNode=positionGeometry.mul(size.xyz).add(position.xyz);
  material.opacityNode=vertexStage(size.w);
  const temperature=vertexStage(position.w).sub(.4).max(0).min(1);
  material.emissiveNode=vec3(1,.055,.002).mul(temperature.pow(2).mul(3));
  const geometry=new THREE.BoxGeometry(1,1,1);owned.push(geometry);
  const debris=new THREE.InstancedMesh(geometry,material,count);debris.name='Detached char residue';debris.frustumCulled=false;
  const capMaterial=new THREE.MeshStandardNodeMaterial({color:0x19130e,roughness:.72,alphaTest:.5});owned.push(capMaterial);
  const x=instanceIndex.mod(n).toFloat(),y=instanceIndex.div(n).mod(n).toFloat(),z=instanceIndex.div(n*n).toFloat();
  const uv=vec3(x,y,z).add(.5).div(n),cellSize=bounds.getSize(new THREE.Vector3()).divideScalar(n);
  const local=vec3(...bounds.min.toArray()).add(uv.mul(vec3(...bounds.getSize(new THREE.Vector3()).toArray())));
  capMaterial.positionNode=positionGeometry.mul(vec3(...cellSize.toArray())).add(local);
  const initialTexture=new THREE.Data3DTexture(Uint16Array.from({length:count*4},(_,i)=>i%4===3&&initial[i>>2]&&!surface[i>>2]?0x3c00:0),n,n,n);
  initialTexture.format=THREE.RGBAFormat;initialTexture.type=THREE.HalfFloatType;initialTexture.minFilter=initialTexture.magFilter=THREE.NearestFilter;initialTexture.needsUpdate=true;owned.push(initialTexture);
  const live=field.sampleState(uv),inside=THREE.TSL.texture3D(initialTexture,uv).w;
  let neighbours=THREE.TSL.float(1);
  for(const offset of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]])neighbours=neighbours.mul(field.sampleState(uv.add(vec3(...offset).div(n))).w);
  capMaterial.opacityNode=vertexStage(live.w.mul(inside).mul(neighbours.oneMinus()));
  capMaterial.emissiveNode=vec3(1,.04,.001).mul(vertexStage(live.x).sub(.5).max(0).pow(2).mul(2));
  if(thermalControls){
   for(const [target,heat]of [[material,vertexStage(position.w)],[capMaterial,vertexStage(live.x)]]){
    const thermal=createSurfaceThermalRadiance(heat.mul(LIVE_LOG_HEAT_TO_FLUID_HEAT),thermalControls.kelvinPerHeat);owned.push(thermal);
    target.emissiveNode=THREE.TSL.mix(target.emissiveNode,thermal.node.mul(thermalControls.gain),thermalControls.weight);
   }
  }
  const caps=new THREE.InstancedMesh(geometry,capMaterial,count);caps.name='Exposed char interior';caps.frustumCulled=false;caps.matrixAutoUpdate=false;
  const root=new THREE.Group();root.name='Consumed wood and char residue';root.add(caps,debris);
  mesh.updateWorldMatrix(true,false);const previous=mesh.matrixWorld.clone();
  function present(){
   mesh.updateWorldMatrix(true,false);root.updateWorldMatrix(true,false);
   caps.matrix.copy(root.matrixWorld).invert().multiply(mesh.matrixWorld);caps.updateWorldMatrix(false,false);
  }
  function reset(){if(disposed)throw Error('Debris is disposed');device.queue.writeBuffer(particles,0,new Uint32Array(count*16));
   for(const texture of [positions,sizes])device.queue.writeTexture({texture},new Float32Array(count*4),{bytesPerRow:n*16},[n,n*n]);
   mesh.updateWorldMatrix(true,false);previous.copy(mesh.matrixWorld);present();steps=0;
  }
  reset();
  unsubscribe=onFrame?.(present);
  return {root,caps,particles,positions,sizes,count,
   encode(encoder,frame){
    if(disposed)throw Error('Debris is disposed');present();
    const values=new Float32Array(48);values.set(mesh.matrixWorld.elements);values.set(previous.elements,16);values.set([...bounds.min.toArray(),0],32);values.set([...bounds.getSize(new THREE.Vector3()).toArray(),0],36);
    values.set([ground.center[0],ground.height,ground.center[2],ground.radius],40);values.set([frame.dt,n,0,0],44);device.queue.writeBuffer(params,0,values);
    const states=field.residentState(),group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:states.before}},{binding:1,resource:{buffer:states.after}},{binding:2,resource:{buffer:particles}},{binding:3,resource:positions.createView()},{binding:4,resource:sizes.createView()},{binding:5,resource:{buffer:params}}]});
    const pass=encoder.beginComputePass({label:'consumed wood to finite char residue'});pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(Math.ceil(count/64));pass.end();previous.copy(mesh.matrixWorld);steps++;
   },reset,read:()=>({identity:'finite-wood-residue-v1',steps,capacity:count,initialMaterialCells:initial.reduce((a,b)=>a+b,0),residueFraction:LOG_RESIDUE,ground,runtimeReadbacks:0,sourceWorld:mesh.matrixWorld.toArray(),attachedWorld:caps.matrixWorld.toArray()}),
   async snapshot(){const source=field.residentState();const staging=device.createBuffer({size:particles.size+source.after.size,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
    try{const encoder=device.createCommandEncoder();encoder.copyBufferToBuffer(particles,0,staging,0,particles.size);encoder.copyBufferToBuffer(source.after,0,staging,particles.size,source.after.size);device.queue.submit([encoder.finish()]);await staging.mapAsync(GPUMapMode.READ);const data=new Float32Array(staging.getMappedRange());return {identity:'frozen-material-residue-snapshot-v1',particles:Array.from(data.subarray(0,count*16)),material:Array.from(data.subarray(count*16)),initial:Array.from(initial),read:this.read()};}finally{staging.unmap();staging.destroy();}},
   dispose(){if(disposed)return;disposed=true;unsubscribe?.();for(const wrapper of wrappers)wrapper.dispose();for(const resource of owned)resource.destroy?.()??resource.dispose?.();root.removeFromParent();}
  };
 }catch(error){unsubscribe?.();for(const wrapper of wrappers)wrapper.dispose();for(const resource of owned)resource.destroy?.()??resource.dispose?.();throw error;}
}
