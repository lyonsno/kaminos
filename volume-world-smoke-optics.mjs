// Geometry comes from the dispatched field, never pending inspector choices.
export function worldSmokeOverlayGeometry(s) {
 if(s?.effective!=='one-way-world-field'||!s.min||!s.max||!s.anchor||!s.fineTransform||!s.fineDims)return null;
 const worldMin=s.min.map((v,i)=>s.anchor.translate[i]+v*s.anchor.scale),worldMax=s.max.map((v,i)=>s.anchor.translate[i]+v*s.anchor.scale);
 const f=s.fineTransform,fineMin=f.translate.map(v=>v-f.scale),fineMax=f.translate.map((v,i)=>v+f.scale*(i===1?2*s.fineDims[1]/s.fineDims[0]-1:1));
 const volume=(lo,hi)=>hi.reduce((p,v,i)=>p*(v-lo[i]),1);
 return {worldMin,worldMax,fineMin,fineMax,finePitch:2*f.scale/s.fineDims[0],materialPitch:(worldMax[0]-worldMin[0])/s.materialDims[0],flowPitch:(worldMax[0]-worldMin[0])/s.flowDims[0],volumeRatio:volume(worldMin,worldMax)/volume(fineMin,fineMax)};
}
// One ray integral for the fine flame and world material. No alpha-overlay seam.
export const WORLD_SMOKE_OPTICS_WGSL=/* wgsl */`
struct WorldSmokeRender { loPitch:vec4<f32>, hiEnabled:vec4<f32>, overlayControls:vec4<f32> }
@group(0) @binding(20) var worldOptical:texture_3d<f32>;
@group(0) @binding(21) var<uniform> worldRender:WorldSmokeRender;
fn worldSmokeOn()->bool{return worldRender.hiEnabled.w>0.5;}
fn worldSmokeDiagnostic(m:EmissiveMaterial,coarse:bool)->EmissiveMaterial{
 if(worldRender.overlayControls.x<.5||!worldSmokeOn()){return m;}
 let sigma=m.absorption+m.scattering;
 let color=select(vec3<f32>(1,.24,.015),vec3<f32>(.015,.65,1),coarse);
 // False-color optical support, not physical emission or a radiance percentage.
 return EmissiveMaterial(color*(sigma+dot(m.emission,vec3<f32>(.2126,.7152,.0722))),sigma,0.0);
}
fn worldInsideFine(p:vec3<f32>)->bool{return all(p>=vec3<f32>(-1))&&all(p<=vec3<f32>(1,2.0*f32(GRID_Y)/f32(GRID)-1.0,1));}
fn worldSmokeSample(p:vec3<f32>)->vec4<f32>{
 let dims=vec3<i32>(textureDimensions(worldOptical));let q=(p-worldRender.loPitch.xyz)/worldRender.loPitch.w-.5;
 let base=vec3<i32>(floor(q));let f=fract(q);var value=vec4<f32>(0);
 for(var z=0;z<2;z++){for(var y=0;y<2;y++){for(var x=0;x<2;x++){
 let c=base+vec3<i32>(x,y,z);if(any(c<vec3<i32>(0))||any(c>=dims)){continue;}
 let w=select(1.0-f,f,vec3<bool>(x==1,y==1,z==1));value+=textureLoad(worldOptical,c,0)*w.x*w.y*w.z;
 }}}return value;
}
fn worldSmokeMaterial(p:vec3<f32>,smokeVisible:f32,fireVisible:f32)->EmissiveMaterial{
 let raw=worldSmokeSample(p);var r:FlowReconstructionSample;r.material=vec4<f32>(raw.xyz,0);r.freshBurn=raw.w;
 var medium=emissiveMaterial(r,fireVisible,smokeVisible);medium.emission*=fireVisible;return medium;
}
fn worldSmokeBlend(p:vec3<f32>,fine:EmissiveMaterial,smokeVisible:f32,fireVisible:f32)->EmissiveMaterial{
 let near=worldSmokeDiagnostic(fine,false);
 if(!worldSmokeOn()||any(p<worldRender.loPitch.xyz)||any(p>worldRender.hiEnabled.xyz)){return near;}
 let top=2.0*f32(GRID_Y)/f32(GRID)-1.0;
 let d=min(min(1.0-abs(p.x),1.0-abs(p.z)),min(p.y+1.0,top-p.y));
 let weight=1.0-smoothstep(0.0,min(.5,worldRender.loPitch.w),d);
 let coarse=worldSmokeDiagnostic(worldSmokeMaterial(p,smokeVisible,fireVisible),true);
 return EmissiveMaterial(mix(near.emission,coarse.emission,weight),mix(near.absorption,coarse.absorption,weight),mix(near.scattering,coarse.scattering,weight));
}
`;
