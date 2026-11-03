import { THERMAL_MOMENTS_WGSL } from './volume-thermal-moments.mjs';
// Geometry comes from the dispatched field, never pending inspector choices.
export function worldSmokeOverlayGeometry(s) {
 if(s?.effective!=='one-way-world-field'||!s.min||!s.max||!s.anchor||!s.fineTransform||!s.fineDims)return null;
 const worldMin=s.min.map((v,i)=>s.anchor.translate[i]+v*s.anchor.scale),worldMax=s.max.map((v,i)=>s.anchor.translate[i]+v*s.anchor.scale);
 const f=s.fineTransform,fineMin=f.translate.map(v=>v-f.scale),fineMax=f.translate.map((v,i)=>v+f.scale*(i===1?2*s.fineDims[1]/s.fineDims[0]-1:1));
 const volume=(lo,hi)=>hi.reduce((p,v,i)=>p*(v-lo[i]),1);
 const m=s.intermediate,hasMiddle=['two-fine-cell-flow','independent-material-and-flow'].includes(m?.effective)&&m.min&&m.max;
 return {worldMin,worldMax,fineMin,fineMax,finePitch:2*f.scale/s.fineDims[0],materialPitch:(worldMax[0]-worldMin[0])/s.materialDims[0],flowPitch:(worldMax[0]-worldMin[0])/s.flowDims[0],volumeRatio:volume(worldMin,worldMax)/volume(fineMin,fineMax),
  middleMin:hasMiddle?m.min.map((v,i)=>s.anchor.translate[i]+v*s.anchor.scale):null,
  middleMax:hasMiddle?m.max.map((v,i)=>s.anchor.translate[i]+v*s.anchor.scale):null,
  middleFlowPitch:hasMiddle?m.flowPitch*s.anchor.scale:null,middleMaterialPitch:hasMiddle?m.materialPitch*s.anchor.scale:null,middlePressurePitch:hasMiddle?m.pressurePitch*s.anchor.scale:null};
}

export function fineOpticalEnvelope(p,top=3){
 const spanY=Math.max(top+1,2);
 const rx=Math.max(0,Math.min(1,(Math.abs(p[0])-0.58)/0.40));
 const rz=Math.max(0,Math.min(1,(Math.abs(p[2])-0.58)/0.40));
 const ry=Math.max(0,Math.min(1,(p[1]-(-1+0.72*spanY))/(0.26*spanY)));
 const r=Math.min(1,Math.hypot(rx,ry,rz));
 return 1-r*r*(3-2*r);
}

function fract1(x){return x-Math.floor(x);}
function worldHash31(x,y,z){
 let qx=fract1(x*0.1031),qy=fract1(y*0.1030),qz=fract1(z*0.0973);
 const d=qx*(qy+33.33)+qy*(qx+33.33)+qz*(qz+33.33);
 qx+=d;qy+=d;qz+=d;
 return fract1((qx+qy)*qz);
}
function subgridNoise3(q){
 const ix=Math.floor(q[0]),iy=Math.floor(q[1]),iz=Math.floor(q[2]);
 const fx=q[0]-ix,fy=q[1]-iy,fz=q[2]-iz;
 const ux=fx*fx*(3-2*fx),uy=fy*fy*(3-2*fy),uz=fz*fz*(3-2*fz);
 const lerp=(a,b,t)=>a+(b-a)*t;
 const n000=worldHash31(ix,iy,iz),n100=worldHash31(ix+1,iy,iz);
 const n010=worldHash31(ix,iy+1,iz),n110=worldHash31(ix+1,iy+1,iz);
 const n001=worldHash31(ix,iy,iz+1),n101=worldHash31(ix+1,iy,iz+1);
 const n011=worldHash31(ix,iy+1,iz+1),n111=worldHash31(ix+1,iy+1,iz+1);
 const nx00=lerp(n000,n100,ux),nx10=lerp(n010,n110,ux);
 const nx01=lerp(n001,n101,ux),nx11=lerp(n011,n111,ux);
 const nxy0=lerp(nx00,nx10,uy),nxy1=lerp(nx01,nx11,uy);
 return lerp(nxy0,nxy1,uz);
}

export function worldSubgridClump(p,sigma,{lo=[-3,-3,-3],pitch=0.25}={}){
 if(!(sigma>0))return 1;
 const step=Math.max(pitch,0.125);
 const gx=(p[0]-lo[0])/step,gy=(p[1]-lo[1])/step,gz=(p[2]-lo[2])/step;
 const q=[gx*1.05,gy*0.78,gz*1.05];
 const n1=subgridNoise3(q);
 const n2=subgridNoise3([q[0]*2.15+1.7,q[1]*2.05-0.9,q[2]*2.15+2.3]);
 const billow=Math.min(1,Math.max(0,(0.62*n1+0.38*n2-0.18)/(0.84-0.18)));
 const shaped=billow*billow*(3-2*billow);
 const strength=Math.min(1,Math.max(0,(sigma-0.02)/(0.85-0.02)));
 const s=strength*strength*(3-2*strength);
 return 1+s*(0.45+0.95*shaped-1);
}

// One ray integral for the fine flame and world material. No alpha-overlay seam.
export const WORLD_SMOKE_OPTICS_WGSL=/* wgsl */`
${THERMAL_MOMENTS_WGSL}
struct WorldSmokeRender { loPitch:vec4<f32>, hiEnabled:vec4<f32>, overlayControls:vec4<f32>, middleLoPitch:vec4<f32>, middleHiEnabled:vec4<f32>, atlas:vec4<f32> }
@group(0) @binding(20) var worldOptical:texture_3d<f32>;
@group(0) @binding(21) var<uniform> worldRender:WorldSmokeRender;
@group(0) @binding(35) var middleOptical:texture_3d<f32>;
fn worldSmokeOn()->bool{return worldRender.hiEnabled.w>0.5;}
fn fineOpticalEnvelope(p:vec3<f32>,top:f32)->f32{
 let spanY=max(top+1.0,2.0);
 let rx=clamp((abs(p.x)-0.58)/0.40,0.0,1.0);
 let rz=clamp((abs(p.z)-0.58)/0.40,0.0,1.0);
 let ry=clamp((p.y-(-1.0+0.72*spanY))/(0.26*spanY),0.0,1.0);
 let r=clamp(length(vec3<f32>(rx,ry,rz)),0.0,1.0);
 return 1.0-r*r*(3.0-2.0*r);
}
fn worldHash31(p:vec3<f32>)->f32{
 var q=fract(p*vec3<f32>(0.1031,0.1030,0.0973));
 q+=dot(q,q.yxz+vec3<f32>(33.33));
 return fract((q.x+q.y)*q.z);
}
fn worldSubgridNoise(q:vec3<f32>)->f32{
 let i=floor(q);
 let f=fract(q);
 let u=f*f*(vec3<f32>(3.0)-2.0*f);
 let n000=worldHash31(i+vec3<f32>(0,0,0));
 let n100=worldHash31(i+vec3<f32>(1,0,0));
 let n010=worldHash31(i+vec3<f32>(0,1,0));
 let n110=worldHash31(i+vec3<f32>(1,1,0));
 let n001=worldHash31(i+vec3<f32>(0,0,1));
 let n101=worldHash31(i+vec3<f32>(1,0,1));
 let n011=worldHash31(i+vec3<f32>(0,1,1));
 let n111=worldHash31(i+vec3<f32>(1,1,1));
 let nx00=mix(n000,n100,u.x);
 let nx10=mix(n010,n110,u.x);
 let nx01=mix(n001,n101,u.x);
 let nx11=mix(n011,n111,u.x);
 let nxy0=mix(nx00,nx10,u.y);
 let nxy1=mix(nx01,nx11,u.y);
 return mix(nxy0,nxy1,u.z);
}
fn worldGridPoint(p:vec3<f32>)->vec3<f32>{
 let pitch=max(worldRender.loPitch.w,0.125);
 return (p-worldRender.loPitch.xyz)/pitch;
}
fn worldSubgridWarp(p:vec3<f32>,pitch:f32)->vec3<f32>{
 let step=clamp(pitch,0.125,0.75);
 let g=worldGridPoint(p);
 let q=vec3<f32>(g.x*0.85,g.y*0.65,g.z*0.85);
 let w1=vec3<f32>(
  worldSubgridNoise(q+vec3<f32>(1.3,2.7,4.1))-0.5,
  worldSubgridNoise(q+vec3<f32>(5.9,1.1,7.3))-0.5,
  worldSubgridNoise(q+vec3<f32>(3.7,8.3,2.9))-0.5
 );
 let q2=q*2.15+vec3<f32>(2.1,-1.4,3.3);
 let w2=vec3<f32>(
  worldSubgridNoise(q2+vec3<f32>(4.3,1.9,6.7))-0.5,
  worldSubgridNoise(q2+vec3<f32>(2.9,7.1,1.3))-0.5,
  worldSubgridNoise(q2+vec3<f32>(8.1,3.3,5.1))-0.5
 );
 return (0.65*w1+0.35*w2)*step*0.65;
}
fn worldSubgridClump(p:vec3<f32>,sigma:f32)->f32{
 if(u.reactant_combustion_a.x<0.5||sigma<=0.0){return 1.0;}
 let g=worldGridPoint(p);
 let q=vec3<f32>(g.x*1.05,g.y*0.78,g.z*1.05);
 let n1=worldSubgridNoise(q);
 let n2=worldSubgridNoise(q*vec3<f32>(2.15,2.05,2.15)+vec3<f32>(1.7,-0.9,2.3));
 let billow=smoothstep(0.18,0.84,0.62*n1+0.38*n2);
 let strength=smoothstep(0.02,0.85,sigma);
 return mix(1.0,0.45+0.95*billow,strength);
}
fn worldSmokeDiagnostic(m:EmissiveMaterial,coarse:bool)->EmissiveMaterial{
 if(worldRender.overlayControls.x<.5||!worldSmokeOn()){return m;}
 let sigma=m.absorption+m.scattering;
 let color=select(vec3<f32>(1,.24,.015),vec3<f32>(.015,.65,1),coarse);
 // False-color optical support, not physical emission or a radiance percentage.
 return EmissiveMaterial(color*(sigma+dot(m.emission,vec3<f32>(.2126,.7152,.0722))),sigma,0.0);
}
fn worldInsideFine(p:vec3<f32>)->bool{return all(p>=vec3<f32>(-1))&&all(p<=vec3<f32>(1,2.0*f32(GRID_Y)/f32(GRID)-1.0,1));}
fn regionSmokeSample(field:texture_3d<f32>,p:vec3<f32>,loPitch:vec4<f32>,layer:i32)->vec4<f32>{
 let atlas=vec3<i32>(textureDimensions(field));let dims=vec3<i32>(atlas.xy,atlas.z/2);let q=(p-loPitch.xyz)/loPitch.w-.5;
 let base=vec3<i32>(floor(q));let f=fract(q);var value=vec4<f32>(0);
 for(var z=0;z<2;z++){for(var y=0;y<2;y++){for(var x=0;x<2;x++){
 let c=base+vec3<i32>(x,y,z);if(any(c<vec3<i32>(0))||any(c>=dims)){continue;}
 let w=select(1.0-f,f,vec3<bool>(x==1,y==1,z==1));value+=textureLoad(field,c+vec3<i32>(0,0,layer*dims.z),0)*w.x*w.y*w.z;
 }}}return value;
}
fn worldSmokeSample(p:vec3<f32>)->vec4<f32>{return regionSmokeSample(worldOptical,p,worldRender.loPitch,0);}
fn regionSmokeMaterial(raw:vec4<f32>,moments:vec3<f32>,smokeVisible:f32,fireVisible:f32)->EmissiveMaterial{
 var r:FlowReconstructionSample;r.material=vec4<f32>(raw.xyz,0);r.freshBurn=raw.w;
 var medium=emissiveMaterial(r,fireVisible,smokeVisible);
 if(u.emissive_physics.x>.5&&raw.x>1e-4){
   let rawQ=thermalQuadrature(max(raw.x,0.0),moments);
   let maxHeat=max(raw.y*2.2,1.6);
   let q=vec3<f32>(min(rawQ.x,maxHeat),min(rawQ.y,maxHeat),rawQ.z);
   let mixture=mix(thermalRadiance(physicsSootKelvin(q.x,u.emissive_physics.y)),thermalRadiance(physicsSootKelvin(q.y,u.emissive_physics.y)),q.z);
   let absorbing=max(raw.x,0.0)*max(u.viewport_steps_density.w,0.0)*u.emissive_material.x*(1.0-clamp(u.emissive_material.y,0.0,1.0));
   medium.emission+=absorbing*(mixture-thermalRadiance(physicsSootKelvin(max(raw.y,0.0),u.emissive_physics.y)))*u.physical_fire.w;
 }
 medium.emission=max(medium.emission,vec3<f32>(0))*fireVisible;return medium;
}
fn middleSmokeWeight(p:vec3<f32>)->f32{
 if(worldRender.middleHiEnabled.w<.5){return 0.0;}
 let d=min(p-worldRender.middleLoPitch.xyz,worldRender.middleHiEnabled.xyz-p);
 return smoothstep(0.0,2.0*worldRender.middleLoPitch.w,min(d.x,min(d.y,d.z)));
}
fn worldMinimumMaterialPitch()->f32{
 if(worldRender.middleHiEnabled.w>.5){return min(worldRender.loPitch.w,worldRender.middleLoPitch.w);}
 return worldRender.loPitch.w;
}
fn worldSmokeMaterial(p:vec3<f32>,smokeVisible:f32,fireVisible:f32)->EmissiveMaterial{
 let pw=select(p,p+worldSubgridWarp(p,worldMinimumMaterialPitch()),u.reactant_combustion_a.x>0.5);
 var far:EmissiveMaterial;
 if(worldRender.atlas.x>.5){far=worldResidentMaterial(pw,smokeVisible,fireVisible);}
 else{far=regionSmokeMaterial(worldSmokeSample(pw),regionSmokeSample(worldOptical,pw,worldRender.loPitch,1).xyz,smokeVisible,fireVisible);}
 let weight=middleSmokeWeight(pw);
 var out=far;
 if(weight>0.0){
  let middle=regionSmokeMaterial(regionSmokeSample(middleOptical,pw,worldRender.middleLoPitch,0),regionSmokeSample(middleOptical,pw,worldRender.middleLoPitch,1).xyz,smokeVisible,fireVisible);
  out=EmissiveMaterial(mix(far.emission,middle.emission,weight),mix(far.absorption,middle.absorption,weight),mix(far.scattering,middle.scattering,weight));
 }
 let clump=worldSubgridClump(p,out.absorption+out.scattering);
 out.absorption*=clump;out.scattering*=clump;
 return out;
}
fn worldSmokeBlend(p:vec3<f32>,fine:EmissiveMaterial,smokeVisible:f32,fireVisible:f32)->EmissiveMaterial{
 let top=2.0*f32(GRID_Y)/f32(GRID)-1.0;
 let near=worldSmokeDiagnostic(fine,false);
 if(!worldSmokeOn()||any(p<worldRender.loPitch.xyz)||any(p>worldRender.hiEnabled.xyz)){return near;}
 let weight=select(
  1.0-smoothstep(0.0,min(.5,worldRender.loPitch.w),min(min(1.0-abs(p.x),1.0-abs(p.z)),min(p.y+1.0,top-p.y))),
  1.0-fineOpticalEnvelope(p,top),
  u.reactant_combustion_a.x>0.5
 );
 let coarse=worldSmokeDiagnostic(worldSmokeMaterial(p,smokeVisible,fireVisible),true);
 return EmissiveMaterial(mix(near.emission,coarse.emission,weight),mix(near.absorption,coarse.absorption,weight),mix(near.scattering,coarse.scattering,weight));
}
`;
