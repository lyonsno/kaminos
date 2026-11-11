// Expected proposal assignments; domains can overlap and hit/birth counts differ.
export function particleProposalShares(s){
 if(!s.acquisitionMode)return {mode:'camera-stratified',source:null,fine:null,broad:null,unassigned:null};
 const total=s.fineCoverage+s.coarseCoverage,remainder=1-s.sourceBias;
 return {mode:'independent-batch',source:s.sourceBias,fine:total?remainder*s.fineCoverage/total:0,broad:total?remainder*s.coarseCoverage/total:0,unassigned:total?0:remainder};
}
import {particleDepthLayout} from './volume-particle-depth.mjs';
// Camera-relative acquisition policy; the retained pool is a separate resource.
export function particleBatch(samples,aspect,limit){
 if(!Number.isSafeInteger(samples)||samples<1||samples>0xffffffff)throw Error('Fresh particle samples must be a positive u32 count');
 if(!(aspect>0&&Number.isFinite(aspect)))throw Error('Particle acquisition requires a positive aspect ratio');
 if(samples>limit*limit)throw Error('Particle acquisition exceeds device texture dimensions');
 const width=Math.min(limit,samples,Math.max(1,Math.ceil(samples/limit),Math.ceil(Math.sqrt(samples*aspect))));
 const height=Math.ceil(samples/width);if(height>limit)throw Error('Particle acquisition exceeds device texture dimensions');
 return {width,height,samples,pixels:width*height};
}
export function particleSourceEnvelope({sources=[],fallback,pitch,backtrace=1,history=4,margin=1}){
 const boxes=[];
 for(const config of sources){const e=config?.effective;if(!e?.admitted)continue;
  const center=e.centreCells.map(v=>v*pitch-1),direction=e.direction;
  const radial=direction.map(v=>e.radiusCells*pitch*Math.sqrt(Math.max(0,1-v*v)));
  const travel=direction.map(v=>v*e.speed*pitch*backtrace*history);
  const radius=radial.map((v,a)=>v+Math.abs(direction[a])*e.thickness*pitch*.5+margin*pitch);
  boxes.push({lo:center.map((v,a)=>v-radius[a]+Math.min(0,travel[a])),hi:center.map((v,a)=>v+radius[a]+Math.max(0,travel[a]))});
 }
 if(!boxes.length&&fallback?.active){const lo=fallback.cellMin.map(v=>v*pitch-1-margin*pitch),hi=fallback.cellMin.map((v,a)=>(v+fallback.cellExtent[a])*pitch-1+margin*pitch);boxes.push({lo,hi});}
 if(!boxes.length)return null;
 return {lo:[0,1,2].map(a=>Math.min(...boxes.map(b=>b.lo[a]))),hi:[0,1,2].map(a=>Math.max(...boxes.map(b=>b.hi[a]))),emitters:boxes.length,authority:'admitted emitter support plus inlet travel and explicit margin; conservative union box, not measured turbulent support'};
}
export function particleProjectedRect(box,vp){
 if(!box)return [0,0,0,0];let lo=[1,1],hi=[0,0];
 for(let i=0;i<8;i++){const p=[0,1,2].map(a=>(i&(1<<a))?box.hi[a]:box.lo[a]);const q=[0,1,3].map(a=>vp[a]*p[0]+vp[4+a]*p[1]+vp[8+a]*p[2]+vp[12+a]);
  // A near-plane crossing gets a conservative full film rectangle. Ray-box
  // clipping still limits every material observation to the selected volume.
  if(q[2]<=1e-5)return [0,0,1,1];
  for(let a=0;a<2;a++){const v=q[a]/q[2]*.5+.5;lo[a]=Math.min(lo[a],v);hi[a]=Math.max(hi[a],v);}
 }return [...lo.map(v=>Math.max(0,Math.min(1,v))),...hi.map(v=>Math.max(0,Math.min(1,v)))];
}
export function particleAcquisitionData({settings,batch,phase,vp,fine,coarse,source}){
 const data=new ArrayBuffer(112),f=new Float32Array(data),u=new Uint32Array(data);
 f.set(particleProjectedRect(fine,vp));f.set(particleProjectedRect(coarse??fine,vp),4);f.set(particleProjectedRect(source,vp),8);
 f.set([...(source?.lo??[0,0,0]),source?1:0],12);f.set([...(source?.hi??[0,0,0]),0],16);
 const total=settings.fineCoverage+settings.coarseCoverage;
 f.set([settings.acquisitionMode,settings.filmJitter,settings.sourceBias,total?settings.coarseCoverage/total:-1],20);
 u.set([batch.width,batch.height,phase,batch.samples],24);return data;
}
export const PARTICLE_ACQUISITION_MATH_WGSL=/* wgsl */`
struct ParticleAcquisition {fineRect:vec4<f32>,coarseRect:vec4<f32>,sourceRect:vec4<f32>,sourceLo:vec4<f32>,sourceHi:vec4<f32>,policy:vec4<f32>,counts:vec4<u32>}
fn acquisitionIndex(pixel:vec2<f32>,outputWidth:u32,a:ParticleAcquisition)->u32{return u32(pixel.x)+u32(pixel.y)*select(outputWidth,a.counts.x,a.policy.x>.5);}
fn acquisitionHash(x:u32)->u32{var h=x;h=(h^(h>>16u))*0x7feb352du;h=(h^(h>>15u))*0x846ca68bu;return h^(h>>16u);}
fn acquisitionRandom(pixel:vec2<f32>,a:ParticleAcquisition,salt:u32)->f32{return f32(acquisitionHash(u32(pixel.x)+u32(pixel.y)*a.counts.x+a.counts.z*747796405u+salt))/4294967296.0;}
fn acquisitionComponent(pixel:vec2<f32>,a:ParticleAcquisition)->u32{
 if(acquisitionRandom(pixel,a,0u)<a.policy.z){return 2u;}
 if(a.policy.w<0){return 3u;}return select(0u,1u,acquisitionRandom(pixel,a,91u)<a.policy.w);
}
fn acquisitionFilm(pixel:vec2<f32>,a:ParticleAcquisition)->vec2<f32>{
 let component=acquisitionComponent(pixel,a);var rect=a.fineRect;if(component==1u){rect=a.coarseRect;}if(component==2u){rect=a.sourceRect;}
 let jitter=vec2<f32>(acquisitionRandom(pixel,a,171u),acquisitionRandom(pixel,a,279u))-.5;
 let uv=(floor(pixel)+.5+jitter*a.policy.y)/vec2<f32>(a.counts.xy);return mix(rect.xy,rect.zw,uv);
}
fn acquisitionBox(ro:vec3<f32>,rd:vec3<f32>,lo:vec3<f32>,hi:vec3<f32>)->vec2<f32>{
 var near=-1e30;var far=1e30;
 for(var a=0u;a<3u;a++){if(abs(rd[a])<1e-12){if(ro[a]<lo[a]||ro[a]>hi[a]){return vec2<f32>(1,-1);}}else{let x=(lo[a]-ro[a])/rd[a];let y=(hi[a]-ro[a])/rd[a];near=max(near,min(x,y));far=min(far,max(x,y));}}
 return vec2<f32>(near,far);
}
fn acquisitionInterval(pixel:vec2<f32>,ro:vec3<f32>,rd:vec3<f32>,fine:vec2<f32>,coarse:vec2<f32>,a:ParticleAcquisition)->vec2<f32>{
 let component=acquisitionComponent(pixel,a);var rect=a.fineRect;if(component==1u){rect=a.coarseRect;}if(component==2u){rect=a.sourceRect;}if(any(rect.zw<=rect.xy)){return vec2<f32>(1,-1);}if(component==0u){return fine;}if(component==1u){return coarse;}
 if(component!=2u||a.sourceLo.w<.5){return vec2<f32>(1,-1);}let source=acquisitionBox(ro,rd,a.sourceLo.xyz,a.sourceHi.xyz);return vec2<f32>(max(source.x,coarse.x),min(source.y,coarse.y));
}
`;
export const PARTICLE_ACQUISITION_WGSL=/* wgsl */`${PARTICLE_ACQUISITION_MATH_WGSL}
@group(3) @binding(1) var<uniform> particleAcquisition:ParticleAcquisition;
fn splitAcquisitionIndex(pixel:vec2<f32>,outputWidth:u32)->u32{return acquisitionIndex(pixel,outputWidth,particleAcquisition);}
fn splitAcquisitionEnabled()->bool{return particleAcquisition.policy.x>.5;}
fn splitFollowTarget(pixel:vec2<f32>)->vec4<f32>{
 if(!splitAcquisitionEnabled()||splitOptions.policy.x<2.5||acquisitionIndex(pixel,splitOptions.size.x,particleAcquisition)>=particleAcquisition.counts.w){return vec4<f32>(0);}
 return splitArena[4u*acquisitionIndex(pixel,splitOptions.size.x,particleAcquisition)+1u];
}
fn splitAcquisitionUv(uv:vec2<f32>,pixel:vec2<f32>)->vec2<f32>{if(!splitAcquisitionEnabled()){return uv;}let tracked=splitFollowTarget(pixel);if(tracked.w<0){let clip=splitOptions.viewProj*vec4<f32>(tracked.xyz,1);return clip.xy/clip.w*.5+vec2<f32>(.5);}return acquisitionFilm(pixel,particleAcquisition);}
fn splitAcquisitionHit(pixel:vec2<f32>,ro:vec3<f32>,rd:vec3<f32>,fine:vec2<f32>,coarse:vec2<f32>,sceneEnd:f32)->vec2<f32>{
 if(!splitAcquisitionEnabled()){return coarse;}
 if(u32(pixel.x)+u32(pixel.y)*particleAcquisition.counts.x>=particleAcquisition.counts.w){return vec2<f32>(1,-1);}
 let tracked=splitFollowTarget(pixel);if(tracked.w<0){let t=dot(tracked.xyz-ro,rd);if(t<max(0.0,fine.x)||t>min(sceneEnd,fine.y)){return vec2<f32>(1,-1);}return fine;}
 return acquisitionInterval(pixel,ro,rd,fine,coarse,particleAcquisition);
}
`;

export function particleResourceBudget(s,{limit,renderScale,displayWidth,displayHeight,flowCells=0}){
    const outputWidth=Math.max(1,Math.floor(displayWidth*renderScale)),outputHeight=Math.max(1,Math.floor(displayHeight*renderScale));
    const batch=s.acquisitionMode?particleBatch(s.acquisitionSamples,outputWidth/outputHeight,limit.maxTextureDimension2D):{width:outputWidth,height:outputHeight,samples:outputWidth*outputHeight,pixels:outputWidth*outputHeight};
    const slots=s.capacity||(s.populationWidth||Math.ceil(batch.width/s.spacing))*(s.populationHeight||Math.ceil(batch.height/s.spacing));
    const maxTargetScale=Math.min(limit.maxTextureDimension2D/outputWidth,limit.maxTextureDimension2D/outputHeight);
    if(s.targetScale>maxTargetScale)throw Error(`Particle target scale ${s.targetScale.toFixed(3)} exceeds device maximum ${maxTargetScale.toFixed(3)} at ${outputWidth} × ${outputHeight}; previous target preserved`);
    if(Math.max(outputWidth,outputHeight)>limit.maxTextureDimension2D)throw Error('Source output exceeds device texture dimensions; previous source preserved');
    if(!Number.isSafeInteger(slots)||slots>0xffffffff||slots*96>Math.min(limit.maxBufferSize,limit.maxStorageBufferBindingSize)||Math.ceil(slots/64)>limit.maxComputeWorkgroupsPerDimension)throw Error('Particle capacity exceeds effective device storage or dispatch limit; previous population preserved');
    const sourceBytes=batch.pixels*64+flowCells*16;
    if(sourceBytes>Math.min(limit.maxBufferSize,limit.maxStorageBufferBindingSize)||Math.ceil(batch.samples/64)>limit.maxComputeWorkgroupsPerDimension)throw Error('Fresh source batch including coarse flow exceeds effective device storage binding or dispatch limit; previous source preserved');
    const depthField=particleDepthLayout(s,{width:Math.ceil(outputWidth*s.targetScale),height:Math.ceil(outputHeight*s.targetScale),limit});
    return {depthField,batch,slots,sourceBytes,outputWidth,outputHeight,maxTargetScale,maxCapacity:Math.min(0xffffffff,Math.floor(Math.min(limit.maxBufferSize,limit.maxStorageBufferBindingSize)/96),limit.maxComputeWorkgroupsPerDimension*64)};
}
