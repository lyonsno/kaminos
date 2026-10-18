import * as THREE from './lib/three.webgpu.js';
import {sceneLightingDomain,integrateSceneMediumSegment} from './scene-volume-source.mjs';

export function smokeShadowPlan({resolution=16,steps=16,count=4}={},limits={}){
  for(const [key,value] of Object.entries({resolution,steps,count}))
    if(!Number.isSafeInteger(value)||value<1)throw Error(`smoke shadow ${key} must be a positive integer`);
  const groups=Math.ceil(steps/4),size=[resolution*6*count,resolution*groups];
  if(size.some(n=>!Number.isSafeInteger(n)||n>(limits.maxTextureDimension2D??8192)))throw Error('smoke shadow atlas exceeds device capacity');
  return {resolution,steps,count,groups,size};
}
export function smokeCubeDirection(face,u,v){
  const x=u*2-1,y=v*2-1;
  const d=[[1,-y,-x],[-1,-y,x],[x,1,y],[x,-1,-y],[x,-y,1],[-x,-y,-1]][face];
  if(!d)throw Error('invalid smoke cube face');
  const r=Math.hypot(...d);return d.map(x=>x/r);
}
export function smokeCubeCoordinates(d){
  const [x,y,z]=d,[ax,ay,az]=d.map(Math.abs);let face,u,v;
  if(ax>=ay&&ax>=az){face=x>=0?0:1;u=(x>=0?-z:z)/ax;v=-y/ax;}
  else if(ay>=az){face=y>=0?2:3;u=x/ay;v=(y>=0?z:-z)/ay;}
  else {face=z>=0?4:5;u=(z>=0?x:-x)/az;v=-y/az;}
  return {face,uv:[(u+1)/2,(v+1)/2]};
}
export function smokeShadowPrefixReference(field,source,direction,steps){
  const {lo,hi}=sceneLightingDomain(field),far=Math.hypot(...source.map((x,a)=>Math.max(Math.abs(x-lo[a]),Math.abs(x-hi[a]))));
  const ds=far/steps,tau=[];let sum=0;
  for(let i=0;i<steps;i++){
    const a=source.map((x,k)=>x+direction[k]*i*ds),b=source.map((x,k)=>x+direction[k]*(i+1)*ds);
    sum+=integrateSceneMediumSegment(field,a,b,ds);tau.push(sum);
  }
  return {far,tau};
}
export function sampleSmokePrefix({far,tau},distance){
  const x=Math.max(0,Math.min(tau.length,distance/far*tau.length));
  const i=Math.floor(x),f=x-i;
  return (i===0?0:tau[i-1])*(1-f)+(tau[Math.min(i,tau.length-1)]??0)*f;
}

const cubeCoordinates=THREE.TSL.wgslFn(/* wgsl */`
fn smokeCubeUV(d:vec3<f32>)->vec3<f32>{
 let a=abs(d);var face=0.0;var uv=vec2<f32>(0);
 if(a.x>=a.y && a.x>=a.z){
  if(d.x>=0.0){face=0.0;uv=vec2<f32>(-d.z,-d.y)/a.x;}
  else {face=1.0;uv=vec2<f32>(d.z,-d.y)/a.x;}
 }else if(a.y>=a.z){
  if(d.y>=0.0){face=2.0;uv=vec2<f32>(d.x,d.z)/a.y;}
  else {face=3.0;uv=vec2<f32>(d.x,-d.z)/a.y;}
 }else{
  if(d.z>=0.0){face=4.0;uv=vec2<f32>(d.x,-d.y)/a.z;}
  else {face=5.0;uv=vec2<f32>(-d.x,-d.y)/a.z;}
 }
 return vec3<f32>(uv*.5+vec2<f32>(.5),face);
}`);

// Per-light radial optical-depth prefixes, not an opaque first-hit depth.
// Four prefix endpoints per RGBA texel keep angular filtering to two reads.
// All coordinates and extinction lengths stay volume-local; world scale is
// applied only when transforming the receiver into that same coefficient space.
export function createFireSmokeShadow(device,{points,resolution=16,steps=16,count=4}={}){
  const plan=smokeShadowPlan({resolution,steps,count},device.limits);
  const gpu=device.createTexture({label:'live smoke radial optical-depth prefixes',size:plan.size,format:'rgba16float',
    usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.COPY_SRC});
  const params=device.createBuffer({label:'smoke shadow atlas layout',size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
  device.queue.writeBuffer(params,0,new Uint32Array([resolution,steps,count,plan.groups]));
  const pipeline=device.createComputePipeline({label:'smoke optical-depth prefix rays',layout:'auto',compute:{module:device.createShaderModule({code:FIRE_SMOKE_SHADOW_WGSL}),entryPoint:'integrate'}});
  const external=new THREE.ExternalTexture(gpu);external.image={width:plan.size[0],height:plan.size[1]};
  external.type=THREE.HalfFloatType;external.format=THREE.RGBAFormat;external.colorSpace=THREE.NoColorSpace;
  external.minFilter=external.magFilter=THREE.LinearFilter;external.generateMipmaps=false;external.flipY=false;
  const {uniform,vec2,float,int,texture,Fn,If,mix}=THREE.TSL;
  const lo=uniform(new THREE.Vector3(-1,-1,-1)),hi=uniform(new THREE.Vector3(1,3,1));
  let bound=null,group=null,metadata=null,disposed=false;
  return {
    external,
    visibility(source,receiver,index){return Fn(()=>{
      const delta=receiver.sub(source),distance=delta.length();
      const far=source.sub(lo).abs().max(source.sub(hi).abs()).length();
      const cube=cubeCoordinates(delta.div(distance.max(1e-20)));
      const uv=cube.xy.clamp(.5/resolution,1-.5/resolution);
      const x=distance.div(far).mul(steps).clamp(0,steps),base=x.floor();
      const read=endpoint=>{
        const n=endpoint.sub(1).max(0).min(steps-1);
        const coord=vec2(cube.z.add(index*6).add(uv.x).div(6*count),n.div(4).floor().add(uv.y).div(plan.groups));
        return texture(external,coord).level(0).element(int(n.mod(4)));
      };
      const before=float(0).toVar();If(base.greaterThan(0),()=>before.assign(read(base)));
      const tau=mix(before,read(base.add(1)),x.sub(base));
      return tau.negate().exp();
    })();},
    encode(field,reduction){
      metadata=null;
      if(disposed||field.status!=='encoded'||!field.texture||reduction?.generation!==field.generation||reduction?.frame!==field.frame||reduction.count!==count)
        throw Error('smoke shadow requires matching current field and point reduction');
      const domain=sceneLightingDomain(field);lo.value.set(...domain.lo);hi.value.set(...domain.hi);
      if(bound!==field.texture){
        const next=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[
          {binding:0,resource:field.texture.createView()},{binding:1,resource:points.createView()},
          {binding:2,resource:gpu.createView()},{binding:3,resource:{buffer:params}}]});
        group=next;bound=field.texture;
      }
      const encoder=device.createCommandEncoder({label:'current smoke shadow prefixes'}),pass=encoder.beginComputePass({label:'live smoke shadow prefix integration'});
      pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(Math.ceil(resolution/8),Math.ceil(resolution/8),count*6);pass.end();
      device.queue.submit([encoder.finish()]);
      metadata={identity:'gpu-radial-smoke-optical-depth-v1',generation:field.generation,frame:field.frame,...plan,
        coefficientSource:'raw-live-emission-extinction-alpha',sampling:'clipped-radial-midpoint',receiverSampling:'angular-bilinear-radial-linear',lengthSpace:'volume-local'};
      return {...metadata};
    },
    debugState(){return metadata?{...metadata}:null;},
    dispose(renderer){disposed=true;metadata=null;if(renderer)delete renderer.backend.get(external).texture;external.dispose();gpu.destroy();params.destroy();},
  };
}

export const FIRE_SMOKE_SHADOW_WGSL=/* wgsl */`
@group(0) @binding(0) var coefficients:texture_3d<f32>;
@group(0) @binding(1) var points:texture_2d<f32>;
@group(0) @binding(2) var output:texture_storage_2d<rgba16float,write>;
@group(0) @binding(3) var<uniform> atlas:vec4<u32>;
fn direction(face:u32,uv:vec2<f32>)->vec3<f32>{
 let q=uv*2.0-vec2<f32>(1);var d=vec3<f32>(1,-q.y,-q.x);
 switch(face){
  case 1u:{d=vec3<f32>(-1,-q.y,q.x);}
  case 2u:{d=vec3<f32>(q.x,1,q.y);}
  case 3u:{d=vec3<f32>(q.x,-1,-q.y);}
  case 4u:{d=vec3<f32>(q.x,-q.y,1);}
  case 5u:{d=vec3<f32>(-q.x,-q.y,-1);}
  default:{}
 }
 return normalize(d);
}
@compute @workgroup_size(8,8,1)
fn integrate(@builtin(global_invocation_id) id:vec3<u32>){
 let resolution=atlas.x;let steps=atlas.y;
 if(id.x>=resolution||id.y>=resolution||id.z>=atlas.z*6u){return;}
 let source=textureLoad(points,vec2<i32>(i32(id.z/6u),0),0).xyz;
 let dims=textureDimensions(coefficients);let pitch=2.0/f32(dims.x);
 let lo=vec3<f32>(-1);let hi=lo+vec3<f32>(dims)*pitch;
 let far=length(max(abs(source-lo),abs(source-hi)));
 let ray=direction(id.z%6u,(vec2<f32>(id.xy)+vec2<f32>(.5))/f32(resolution));
 var start=0.0;var end=far;
 for(var axis=0u;axis<3u;axis++){
  if(abs(ray[axis])<1e-20){if(source[axis]<lo[axis]||source[axis]>hi[axis]){end=-1.0;}}
  else {let a=(lo[axis]-source[axis])/ray[axis];let b=(hi[axis]-source[axis])/ray[axis];start=max(start,min(a,b));end=min(end,max(a,b));}
 }
 let ds=far/f32(steps);var tau=0.0;var packed=vec4<f32>(0);
 for(var i=0u;i<atlas.w*4u;i++){
  if(i<steps){
   let a=max(start,f32(i)*ds);let b=min(end,f32(i+1u)*ds);
   if(b>a){
    let p=source+ray*(a+b)*.5;
    let cell=clamp(vec3<i32>(floor((p-lo)/pitch)),vec3<i32>(0),vec3<i32>(dims)-vec3<i32>(1));
    tau+=max(0.0,textureLoad(coefficients,cell,0).a)*(b-a);
   }
  }
  // The half-float cache saturates only at its representable opaque endpoint,
  // avoiding infinity interpolation (inf * 0) at an exact prefix boundary.
  packed[i%4u]=min(tau,65504.0);
  if(i%4u==3u){textureStore(output,vec2<i32>(i32(id.z*resolution+id.x),i32((i/4u)*resolution+id.y)),packed);}
 }
}`;
