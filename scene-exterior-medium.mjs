// Coarse midpoint transport. The fine integral owns its interval exactly once.
export function exteriorSegments(p,d,limit,lo,hi,fineHi=[1,3,1]){
  const clip=(lo,hi)=>{
    let near=0,far=limit;
    for(let a=0;a<3;a++){
      if(Math.abs(d[a])<1e-20){if(p[a]<lo[a]||p[a]>hi[a])return [1,-1];}
      else {const x=(lo[a]-p[a])/d[a],y=(hi[a]-p[a])/d[a];near=Math.max(near,Math.min(x,y));far=Math.min(far,Math.max(x,y));}
    }return [near,far];
  };
  const outer=clip(lo,hi),fine=clip([-1,-1,-1],fineHi);
  if(outer[1]<=outer[0])return [];
  if(fine[1]<=fine[0])return [outer];
  return [[outer[0],Math.min(outer[1],fine[0])],[Math.max(outer[0],fine[1]),outer[1]]].filter(([a,b])=>b>a);
}
export const NO_EXTERIOR_MEDIUM_WGSL=`
fn lightingSourceLo()->vec3<f32>{return vec3<f32>(-1);}
fn lightingSourceHi()->vec3<f32>{return sourceDomainHi();}
fn exteriorCompose(p:vec3<f32>,d:vec3<f32>,limit:f32,fine:vec4<f32>)->vec4<f32>{return fine;}
fn exteriorTransmission(p:vec3<f32>,d:vec3<f32>,limit:f32)->f32{return 1.0;}
fn exteriorSourceTransmission(p:vec3<f32>,d:vec3<f32>,limit:f32)->f32{return 1.0;}
`;
export const EXTERIOR_MEDIUM_WGSL=`
@group(0) @binding(22) var exteriorExtinction:texture_3d<f32>;
struct ExteriorMedium {loStep:vec4<f32>,hi:vec4<f32>,middleLoStep:vec4<f32>,middleHiBlend:vec4<f32>}
@group(0) @binding(23) var<uniform> exteriorMedium:ExteriorMedium;
@group(0) @binding(24) var middleExtinction:texture_3d<f32>;
@group(0) @binding(25) var exteriorEmission:texture_3d<f32>;
@group(0) @binding(26) var middleEmission:texture_3d<f32>;
fn lightingSourceLo()->vec3<f32>{return select(vec3<f32>(-1),min(vec3<f32>(-1),exteriorMedium.loStep.xyz),exteriorMedium.hi.w>1.5);}
fn lightingSourceHi()->vec3<f32>{return select(sourceDomainHi(),max(sourceDomainHi(),exteriorMedium.hi.xyz),exteriorMedium.hi.w>1.5);}
fn regionEmission(field:texture_3d<f32>,p:vec3<f32>,lo:vec3<f32>,hi:vec3<f32>)->vec3<f32>{
 let dims=textureDimensions(field);let q=(p-lo)/(hi-lo)*vec3<f32>(dims)-.5;let base=vec3<i32>(floor(q));let f=fract(q);var value=vec3<f32>(0);
 for(var k=0u;k<8u;k++){let off=vec3<u32>(k&1u,(k>>1u)&1u,(k>>2u)&1u);let c=base+vec3<i32>(off);if(any(c<vec3<i32>(0))||any(c>=vec3<i32>(dims))){continue;}let w=select(1.0-f,f,off==vec3<u32>(1));value+=max(textureLoad(field,c,0).rgb,vec3<f32>(0))*w.x*w.y*w.z;}return value;
}
fn exteriorRadianceSource(p:vec3<f32>)->vec3<f32>{
 var value=regionEmission(exteriorEmission,p,exteriorMedium.loStep.xyz,exteriorMedium.hi.xyz);
 if(exteriorMedium.middleHiBlend.w>0.0){let edge=min(p-exteriorMedium.middleLoStep.xyz,exteriorMedium.middleHiBlend.xyz-p);let weight=smoothstep(0.0,exteriorMedium.middleHiBlend.w,min(edge.x,min(edge.y,edge.z)));if(weight>0.0){value=mix(value,regionEmission(middleEmission,p,exteriorMedium.middleLoStep.xyz,exteriorMedium.middleHiBlend.xyz),weight);}}return value;
}
fn exteriorTransfer(p:vec3<f32>,d:vec3<f32>,start:f32,end:f32,step:f32)->vec4<f32>{
 if(end<=start){return vec4<f32>(0,0,0,1);}let count=u32(ceil((end-start)/step));let ds=(end-start)/f32(count);var color=vec3<f32>(0);var trans=1.0;
 for(var i=0u;i<count;i++){let q=p+d*(start+(f32(i)+.5)*ds);let sigma=exteriorSigma(q);let tau=sigma*ds;var weight=ds*(1.0-tau*.5+tau*tau/6.0);if(tau>=.001){weight=(1.0-exp(-tau))/sigma;}color+=trans*exteriorRadianceSource(q)*weight;trans*=exp(-tau);}return vec4<f32>(color,trans);
}
fn composeTransfer(a:vec4<f32>,b:vec4<f32>)->vec4<f32>{return vec4<f32>(a.rgb+a.a*b.rgb,a.a*b.a);}
fn exteriorRegionTransfer(p:vec3<f32>,d:vec3<f32>,start:f32,end:f32)->vec4<f32>{
 if(end<=start){return vec4<f32>(0,0,0,1);}let step=exteriorMedium.loStep.w;
 if(exteriorMedium.middleHiBlend.w<=0.0){return exteriorTransfer(p,d,start,end,step);}
 let middle=interval(p,d,exteriorMedium.middleLoStep.xyz,exteriorMedium.middleHiBlend.xyz,end);let a=max(start,middle.x);let b=min(end,middle.y);
 if(b<=a){return exteriorTransfer(p,d,start,end,step);}return composeTransfer(composeTransfer(exteriorTransfer(p,d,start,a,step),exteriorTransfer(p,d,a,b,min(step,exteriorMedium.middleLoStep.w))),exteriorTransfer(p,d,b,end,step));
}
fn exteriorCompose(p:vec3<f32>,d:vec3<f32>,limit:f32,fine:vec4<f32>)->vec4<f32>{
 if(exteriorMedium.hi.w<.5){return fine;}let outer=interval(p,d,exteriorMedium.loStep.xyz,exteriorMedium.hi.xyz,limit);if(outer.y<=outer.x){return fine;}let near=interval(p,d,vec3<f32>(-1),sourceDomainHi(),limit);
 if(near.y<=near.x){return exteriorRegionTransfer(p,d,outer.x,outer.y);}let before=exteriorRegionTransfer(p,d,outer.x,min(outer.y,near.x));let after=exteriorRegionTransfer(p,d,max(outer.x,near.y),outer.y);return composeTransfer(composeTransfer(before,fine),after);
}
fn regionSigma(field:texture_3d<f32>,p:vec3<f32>,lo:vec3<f32>,hi:vec3<f32>)->f32{
  let dims=textureDimensions(field);
  let q=(p-lo)/(hi-lo)*vec3<f32>(dims)-.5;
  let base=vec3<i32>(floor(q));let w=fract(q);var sum=0.0;
  for(var k=0u;k<8u;k++){
    let off=vec3<u32>(k&1u,(k>>1u)&1u,(k>>2u)&1u);
    let c=base+vec3<i32>(off);if(any(c<vec3<i32>(0))||any(c>=vec3<i32>(dims))){continue;}
    let weight=select(vec3<f32>(1)-w,w,off==vec3<u32>(1));sum+=max(0.0,textureLoad(field,c,0).r)*weight.x*weight.y*weight.z;
  }return sum;
}
fn exteriorSigma(p:vec3<f32>)->f32{
  let far=regionSigma(exteriorExtinction,p,exteriorMedium.loStep.xyz,exteriorMedium.hi.xyz);
  if(exteriorMedium.middleHiBlend.w<=0.0){return far;}
  let edge=min(p-exteriorMedium.middleLoStep.xyz,exteriorMedium.middleHiBlend.xyz-p);
  let weight=smoothstep(0.0,exteriorMedium.middleHiBlend.w,min(edge.x,min(edge.y,edge.z)));
  if(weight<=0.0){return far;}
  return mix(far,regionSigma(middleExtinction,p,exteriorMedium.middleLoStep.xyz,exteriorMedium.middleHiBlend.xyz),weight);
}
fn regionTau(p:vec3<f32>,d:vec3<f32>,start:f32,end:f32,step:f32)->f32{
  if(end<=start){return 0.0;}
  let count=u32(ceil((end-start)/step));let ds=(end-start)/f32(count);var tau=0.0;
  for(var i=0u;i<count;i++){tau+=exteriorSigma(p+d*(start+(f32(i)+.5)*ds))*ds;}
  return tau;
}
fn exteriorTau(p:vec3<f32>,d:vec3<f32>,start:f32,end:f32)->f32{
  if(end<=start){return 0.0;}
  let step=exteriorMedium.loStep.w;
  if(exteriorMedium.middleHiBlend.w<=0.0){return regionTau(p,d,start,end,step);}
  let middle=interval(p,d,exteriorMedium.middleLoStep.xyz,exteriorMedium.middleHiBlend.xyz,end);
  let a=max(start,middle.x);let b=min(end,middle.y);
  if(b<=a){return regionTau(p,d,start,end,step);}
  return regionTau(p,d,start,a,step)+regionTau(p,d,a,b,min(step,exteriorMedium.middleLoStep.w))+regionTau(p,d,b,end,step);
}
fn exteriorOpticalDepth(p:vec3<f32>,d:vec3<f32>,limit:f32)->f32{
  if(exteriorMedium.hi.w<0.5){return 0.0;}
  let outer=interval(p,d,exteriorMedium.loStep.xyz,exteriorMedium.hi.xyz,limit);
  if(outer.y<=outer.x){return 0.0;}
  let fine=interval(p,d,vec3<f32>(-1),sourceDomainHi(),limit);
  if(fine.y<=fine.x){return exteriorTau(p,d,outer.x,outer.y);}
  return exteriorTau(p,d,outer.x,min(outer.y,fine.x))+exteriorTau(p,d,max(outer.x,fine.y),outer.y);
}
fn exteriorTransmission(p:vec3<f32>,d:vec3<f32>,limit:f32)->f32{return exp(-exteriorOpticalDepth(p,d,limit));}
fn exteriorSourceTransmission(p:vec3<f32>,d:vec3<f32>,limit:f32)->f32{
  let fine=interval(p,d,vec3<f32>(-1),sourceDomainHi(),limit);
  if(fine.y<=fine.x){return 1.0;}
  return exteriorTransmission(p,d,fine.x);
}
`;
