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

export function smokeAngularFilterFootprint({direction,angleDegrees,tapsPerAxis=3}){
  if(!Array.isArray(direction)||direction.length!==3||direction.some(v=>!Number.isFinite(v))||Math.abs(Math.hypot(...direction)-1)>1e-6)throw Error('unit filter direction required');
  if(!Number.isFinite(angleDegrees)||angleDegrees<0||angleDegrees>=90)throw Error('smoke filter angle must be in [0,90) degrees');
  if(!Number.isSafeInteger(tapsPerAxis)||tapsPerAxis<1||tapsPerAxis%2!==1||tapsPerAxis*tapsPerAxis>0xffffffff)throw Error('odd positive smoke filter taps per axis required');
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],normalize=a=>{const n=Math.hypot(...a);return a.map(v=>v/n);};
  const tangent=normalize(cross(Math.abs(direction[1])<.9?[0,1,0]:[1,0,0],direction)),bitangent=cross(direction,tangent);
  const half=(tapsPerAxis-1)/2,radius=Math.tan(angleDegrees*Math.PI/180),normalization=(half+1)**4,result=[];
  for(let y=-half;y<=half;y++)for(let x=-half;x<=half;x++)result.push({direction:normalize(direction.map((v,a)=>v+radius*(tangent[a]*x+bitangent[a]*y)/Math.max(1,half))),weight:(half+1-Math.abs(x))*(half+1-Math.abs(y))/normalization});
  return result;
}
export function smokeShadowWork({resolution=16,steps=16,count=4,filter=false,angleDegrees=null,tapsPerAxis=3}={}){
  const plan=smokeShadowPlan({resolution,steps:Math.max(1,steps),count},{maxTextureDimension2D:Infinity});
  if(angleDegrees!==null)smokeAngularFilterFootprint({direction:[1,0,0],angleDegrees,tapsPerAxis});
  const integrationRays=steps?6*count*resolution*resolution:0,filterOutputs=filter?integrationRays*plan.groups:0;
  const filterDirectionsPerPrefix=angleDegrees===null?9:tapsPerAxis*tapsPerAxis,prefixReadsPerOutput=angleDegrees===null?9:4*filterDirectionsPerPrefix;
  return {integrationRays,maximumMediumReads:integrationRays*steps,prefixGroups:plan.groups,filterOutputs,filterDirectionsPerPrefix:filter?filterDirectionsPerPrefix:0,prefixReadsPerOutput:filter?prefixReadsPerOutput:0,prefixReads:filterOutputs*prefixReadsPerOutput};
}
function angularFilterReference({face,x,y,resolution,read,angleDegrees,tapsPerAxis=3}){
  const center=smokeCubeDirection(face,(x+.5)/resolution,(y+.5)/resolution),values=[];
  for(const tap of smokeAngularFilterFootprint({direction:center,angleDegrees,tapsPerAxis})){
    const p=smokeCubeCoordinates(tap.direction),q=p.uv.map(v=>v*resolution-.5),base=q.map(Math.floor),f=q.map((v,a)=>v-base[a]);
    for(let j=0;j<2;j++)for(let i=0;i<2;i++){
      const neighbor=smokeCubeCoordinates(smokeCubeDirection(p.face,(base[0]+i+.5)/resolution,(base[1]+j+.5)/resolution));
      const cell=neighbor.uv.map(v=>Math.max(0,Math.min(resolution-1,Math.floor(v*resolution))));
      values.push({tau:read(neighbor.face,...cell),weight:tap.weight*(i?f[0]:1-f[0])*(j?f[1]:1-f[1])});
    }
  }
  const used=values.filter(v=>v.weight>0),minimum=Math.min(...used.map(v=>v.tau));return minimum-Math.log(used.reduce((sum,v)=>sum+v.weight*Math.exp(minimum-v.tau),0));
}

// Binomial 3x3 directional footprint, reprojecting off-face taps onto their
// actual cube face. Average transmission, then store equivalent optical depth.
// Subtracting the minimum avoids underflow even for fully opaque neighborhoods.
export function filterSmokeDirectionReference({face,x,y,resolution,read,angleDegrees=null,tapsPerAxis=3}){
  if(angleDegrees!==null)return angularFilterReference({face,x,y,resolution,read,angleDegrees,tapsPerAxis});
  const taps=[];
  for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
    const p=smokeCubeCoordinates(smokeCubeDirection(face,(x+.5+dx)/resolution,(y+.5+dy)/resolution));
    taps.push({tau:read(p.face,...p.uv.map(v=>Math.max(0,Math.min(resolution-1,Math.floor(v*resolution))))),weight:(dx===0?2:1)*(dy===0?2:1)/16});
  }
  const minimum=Math.min(...taps.map(t=>t.tau));
  return minimum-Math.log(taps.reduce((sum,t)=>sum+t.weight*Math.exp(minimum-t.tau),0));
}

const CUBE_COORDINATES_WGSL=/* wgsl */`
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
}`;
const cubeCoordinates=THREE.TSL.wgslFn(CUBE_COORDINATES_WGSL);

// Per-light radial optical-depth prefixes, not an opaque first-hit depth.
// Four prefix endpoints per RGBA texel keep angular filtering to two reads.
// All coordinates and extinction lengths stay volume-local; world scale is
// applied only when transforming the receiver into that same coefficient space.
export function createFireSmokeShadow(device,{points,resolution=16,steps=16,count=4,filter=false,angleDegrees=null,tapsPerAxis=3,renderer=null}={}){
  const managed=typeof renderer?.initTexture==='function';
  const validate=q=>{
    if(typeof q.filter!=='boolean')throw Error('smoke shadow filter must be boolean');
    if(!Number.isSafeInteger(q.steps)||q.steps<0)throw Error('smoke shadow steps must be nonnegative integer');
    const plan=smokeShadowPlan({resolution:q.resolution,steps:Math.max(1,q.steps),count},device.limits);
    if(q.angleDegrees!==null)smokeAngularFilterFootprint({direction:[1,0,0],angleDegrees:q.angleDegrees,tapsPerAxis:q.tapsPerAxis});
    return plan;
  };
  let quality={resolution,steps,filter,angleDegrees,tapsPerAxis},plan=validate(quality),gpu=null;
  const params=device.createBuffer({label:'smoke shadow atlas layout',size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
  const filterParams=device.createBuffer({label:'smoke shadow angular filter quality',size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
  const pipeline=device.createComputePipeline({label:'smoke optical-depth prefix rays',layout:'auto',compute:{module:device.createShaderModule({code:FIRE_SMOKE_SHADOW_WGSL}),entryPoint:'integrate'}});
  const filterPipeline=device.createComputePipeline({label:'smoke neighboring-direction transmission filter',layout:'auto',compute:{module:device.createShaderModule({code:FIRE_SMOKE_FILTER_WGSL}),entryPoint:'filterDirections'}});
  let outputGpu=null;
  const external=managed?new THREE.StorageTexture(...plan.size):new THREE.ExternalTexture();
  external.image={width:plan.size[0],height:plan.size[1]};external.type=THREE.HalfFloatType;external.format=THREE.RGBAFormat;external.colorSpace=THREE.NoColorSpace;
  external.minFilter=external.magFilter=THREE.LinearFilter;external.generateMipmaps=false;external.flipY=false;
  const {uniform,vec2,vec3,float,int,texture,Fn,If,mix}=THREE.TSL;
  const layout=uniform(new THREE.Vector4()),enabled=uniform(steps>0,'bool');
  const lo=uniform(new THREE.Vector3(-1,-1,-1)),hi=uniform(new THREE.Vector3(1,3,1));
  let bound=null,group=null,filterGroup=null,metadata=null,disposed=false;
  function configure(next){
    const nextPlan=validate(next),resize=!gpu||nextPlan.size.some((n,a)=>n!==plan.size[a]);
    if(resize){
      const oldGpu=gpu,oldOutput=outputGpu;
      gpu=device.createTexture({label:'live smoke radial optical-depth prefixes',size:nextPlan.size,format:'rgba16float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.COPY_SRC});
      if(managed){external.setSize(...nextPlan.size);external.needsUpdate=true;renderer.initTexture(external);outputGpu=renderer.backend.get(external).texture;}
      else {outputGpu=device.createTexture({label:'smoke shadow receiving prefixes',size:nextPlan.size,format:'rgba16float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.COPY_SRC});external.sourceTexture=outputGpu;external.image={width:nextPlan.size[0],height:nextPlan.size[1]};external.needsUpdate=true;}
      oldGpu?.destroy();if(!managed)oldOutput?.destroy();
    }
    quality=next;plan=nextPlan;layout.value.set(next.resolution,Math.max(1,next.steps),count,plan.groups);enabled.value=next.steps>0;
    device.queue.writeBuffer(params,0,new Uint32Array([next.resolution,Math.max(1,next.steps),count,plan.groups]));
    device.queue.writeBuffer(filterParams,0,new Float32Array([Math.tan((next.angleDegrees??0)*Math.PI/180),next.tapsPerAxis,next.angleDegrees===null?-1:1,0]));
    bound=null;metadata=null;group=null;
    filterGroup=device.createBindGroup({layout:filterPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:gpu.createView()},{binding:1,resource:outputGpu.createView()},{binding:2,resource:{buffer:params}},{binding:3,resource:{buffer:filterParams}}]});
  }
  configure(quality);
  return {
    external,supportsLiveQuality:managed,
    setQuality(value){if(disposed)throw Error('smoke shadow disposed');configure({...quality,...value});},
    visibility(source,receiver,index){return Fn(()=>{
      const result=float(1).toVar();If(enabled,()=>{
        const delta=receiver.sub(source),distance=delta.length(),far=source.sub(lo).abs().max(source.sub(hi).abs()).length();
        const ray=distance.greaterThan(0).select(delta.div(distance.max(1e-20)),vec3(1,0,0)),cube=cubeCoordinates(ray);
        const uv=cube.xy.clamp(float(.5).div(layout.x),float(1).sub(float(.5).div(layout.x)));
        const x=distance.div(far).mul(layout.y).clamp(0,layout.y),base=x.floor();
        const read=endpoint=>{const n=endpoint.sub(1).max(0).min(layout.y.sub(1)),coord=vec2(cube.z.add(index*6).add(uv.x).div(layout.z.mul(6)),n.div(4).floor().add(uv.y).div(layout.w));return texture(external,coord).level(0).element(int(n.mod(4)));};
        const before=float(0).toVar();If(base.greaterThan(0),()=>before.assign(read(base)));result.assign(mix(before,read(base.add(1)),x.sub(base)).negate().exp());
      });return result;
    })();},
    encode(field,reduction){
      metadata=null;if(!quality.steps)return null;
      if(disposed||field.status!=='encoded'||!field.texture||reduction?.generation!==field.generation||reduction?.frame!==field.frame||reduction.count!==count)throw Error('smoke shadow requires matching current field and point reduction');
      const domain=sceneLightingDomain(field);lo.value.set(...domain.lo);hi.value.set(...domain.hi);
      if(bound!==field.texture){group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:field.texture.createView()},{binding:1,resource:points.createView()},{binding:2,resource:(quality.filter?gpu:outputGpu).createView()},{binding:3,resource:{buffer:params}}]});bound=field.texture;}
      const encoder=device.createCommandEncoder({label:'current smoke shadow prefixes'}),pass=encoder.beginComputePass({label:'live smoke shadow prefix integration'});
      pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(Math.ceil(quality.resolution/8),Math.ceil(quality.resolution/8),count*6);pass.end();
      if(quality.filter){const pass=encoder.beginComputePass({label:'current smoke directional filter'});pass.setPipeline(filterPipeline);pass.setBindGroup(0,filterGroup);pass.dispatchWorkgroups(Math.ceil(quality.resolution/8),Math.ceil(quality.resolution/8),count*6*plan.groups);pass.end();}
      device.queue.submit([encoder.finish()]);
      metadata={identity:'gpu-radial-smoke-optical-depth-v1',generation:field.generation,frame:field.frame,...plan,coefficientSource:'raw-live-emission-extinction-alpha',sampling:'clipped-radial-midpoint',receiverSampling:'angular-bilinear-radial-linear',directionFilter:quality.filter?(quality.angleDegrees===null?'binomial-3x3-transmission':'angular-tent-transmission'):'off',angleDegrees:quality.angleDegrees,tapsPerAxis:quality.tapsPerAxis,work:smokeShadowWork({...quality,count}),lengthSpace:'volume-local'};return {...metadata};
    },
    debugState(){return metadata?{...metadata}:null;},
    dispose(owner=renderer){disposed=true;metadata=null;if(!managed&&owner)delete owner.backend.get(external).texture;external.dispose();gpu.destroy();if(!managed)outputGpu.destroy();params.destroy();filterParams.destroy();},
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

export const FIRE_SMOKE_FILTER_WGSL=/* wgsl */`
@group(0) @binding(0) var prefixes:texture_2d<f32>;
@group(0) @binding(1) var output:texture_storage_2d<rgba16float,write>;
@group(0) @binding(2) var<uniform> atlas:vec4<u32>;
@group(0) @binding(3) var<uniform> filterQuality:vec4<f32>;
${CUBE_COORDINATES_WGSL}
${FIRE_SMOKE_SHADOW_WGSL.slice(FIRE_SMOKE_SHADOW_WGSL.indexOf('fn direction('),FIRE_SMOKE_SHADOW_WGSL.indexOf('@compute'))}
@compute @workgroup_size(8,8,1)
fn filterDirections(@builtin(global_invocation_id) id:vec3<u32>){
 let resolution=atlas.x;let faces=atlas.z*6u;
 if(id.x>=resolution||id.y>=resolution||id.z>=faces*atlas.w){return;}
 let group=id.z/faces;let face=id.z%6u;let light=(id.z%faces)/6u;
 if(filterQuality.z>=0.0){
  let ray=direction(face,(vec2<f32>(id.xy)+vec2<f32>(.5))/f32(resolution));
  let axis=select(vec3<f32>(1,0,0),vec3<f32>(0,1,0),abs(ray.y)<.9);let tangent=normalize(cross(axis,ray));let bitangent=cross(ray,tangent);
  let half=i32(filterQuality.y-1.0)/2;let width=filterQuality.x/f32(max(1,half));
  var minimum=vec4<f32>(65504);var transmission=vec4<f32>(0);var total=0.0;
  for(var y=-half;y<=half;y++){for(var x=-half;x<=half;x++){
   let sampleRay=normalize(ray+width*(f32(x)*tangent+f32(y)*bitangent));let p=smokeCubeUV(sampleRay);let pixel=p.xy*f32(resolution)-vec2<f32>(.5);let base=floor(pixel);let f=fract(pixel);
   let tent=f32(half+1-abs(x))*f32(half+1-abs(y));
   for(var j=0u;j<2u;j++){for(var i=0u;i<2u;i++){
    let neighbor=smokeCubeUV(direction(u32(p.z),(base+vec2<f32>(f32(i),f32(j))+vec2<f32>(.5))/f32(resolution)));
    let cell=clamp(vec2<u32>(floor(neighbor.xy*f32(resolution))),vec2<u32>(0),vec2<u32>(resolution-1u));
    let coord=vec2<i32>(i32((light*6u+u32(neighbor.z))*resolution+cell.x),i32(group*resolution+cell.y));
    let tau=textureLoad(prefixes,coord,0);let weight=tent*select(1.0-f.x,f.x,i==1u)*select(1.0-f.y,f.y,j==1u);
    if(weight>0.0){let next=min(minimum,tau);transmission=transmission*exp(next-minimum)+weight*exp(next-tau);minimum=next;total+=weight;}
   }}
  }}
  let tau=minimum-log(transmission/max(total,1e-30));textureStore(output,vec2<i32>(i32((light*6u+face)*resolution+id.x),i32(group*resolution+id.y)),tau);return;
 }
 var values:array<vec4<f32>,9>;var weights:array<f32,9>;
 var minimum=vec4<f32>(65504);var i=0u;
 for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){
  let uv=(vec2<f32>(id.xy)+vec2<f32>(.5)+vec2<f32>(f32(x),f32(y)))/f32(resolution);
  let neighbor=smokeCubeUV(direction(face,uv));
  let cell=clamp(vec2<u32>(floor(neighbor.xy*f32(resolution))),vec2<u32>(0),vec2<u32>(resolution-1u));
  let coord=vec2<i32>(i32((light*6u+u32(neighbor.z))*resolution+cell.x),i32(group*resolution+cell.y));
  values[i]=textureLoad(prefixes,coord,0);minimum=min(minimum,values[i]);
  weights[i]=select(1.0,2.0,x==0)*select(1.0,2.0,y==0)/16.0;i++;
 }}
 var transmission=vec4<f32>(0);
 for(var j=0u;j<9u;j++){transmission+=weights[j]*exp(minimum-values[j]);}
 let tau=minimum-log(transmission);
 textureStore(output,vec2<i32>(i32((light*6u+face)*resolution+id.x),i32(group*resolution+id.y)),tau);
}`;
