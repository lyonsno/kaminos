// Exterior continuation of the existing transported material law, not a
// second compositing layer. Blend per-length coefficients before integration.
export const JOINED_OPTICS_WGSL = /* wgsl */`
struct JoinedRender { loPitch:vec4<f32>, hiEnabled:vec4<f32> }
@group(0) @binding(20) var joinedOptical:texture_3d<f32>;
@group(0) @binding(21) var<uniform> joinedRender:JoinedRender;
fn joinedRenderOn()->bool{return joinedRender.hiEnabled.w>0.5;}
fn joinedInsideFine(p:vec3<f32>)->bool{
  return all(p>=vec3<f32>(-1.0))&&all(p<=vec3<f32>(1.0,2.0*f32(GRID_Y)/f32(GRID)-1.0,1.0));
}
fn joinedOuterSample(p:vec3<f32>)->vec4<f32>{
  let dims=vec3<i32>(textureDimensions(joinedOptical));
  let q=(p-joinedRender.loPitch.xyz)/joinedRender.loPitch.w-.5;
  let base=vec3<i32>(floor(q));let f=fract(q);var result=vec4<f32>(0.0);
  for(var z=0;z<2;z++){for(var y=0;y<2;y++){for(var x=0;x<2;x++){
    let c=base+vec3<i32>(x,y,z);if(any(c<vec3<i32>(0))||any(c>=dims)){continue;}
    let w=select(1.0-f,f,vec3<bool>(x==1,y==1,z==1));
    result+=textureLoad(joinedOptical,c,0)*w.x*w.y*w.z;
  }}}return result;
}
fn joinedPassiveMaterial(p:vec3<f32>,smokeVisible:f32,fireVisible:f32)->EmissiveMaterial{
  var r:FlowReconstructionSample;
  r.material=vec4<f32>(joinedOuterSample(p).xy,0.0,0.0);
  return emissiveMaterial(r,select(0.0,fireVisible,u.emissive_material.w>0.5),smokeVisible);
}
fn joinedBlendMaterial(p:vec3<f32>,fine:EmissiveMaterial,smokeVisible:f32,fireVisible:f32)->EmissiveMaterial{
  if(!joinedRenderOn()){return fine;}
  let top=2.0*f32(GRID_Y)/f32(GRID)-1.0;
  let d=min(min(1.0-abs(p.x),1.0-abs(p.z)),min(p.y+1.0,top-p.y));
  let w=1.0-smoothstep(0.0,min(1.0,max(.25,2.0*joinedRender.loPitch.w)),d);
  let coarse=joinedPassiveMaterial(p,smokeVisible,fireVisible);
  return EmissiveMaterial(mix(fine.emission,coarse.emission,w),mix(fine.absorption,coarse.absorption,w),mix(fine.scattering,coarse.scattering,w));
}
// Existing lighting grid is [-1,1]^3. Continue its boundary light with local
// attenuation and dilution; no unoccluded ambient is added outside the grid.
fn joinedIncidentAt(p:vec3<f32>,sigma:f32)->vec3<f32>{
  if(!joinedRenderOn()){return incidentAt(p);}
  let inset=1.0/f32(LIGHT_GRID);let q=clamp(p,vec3<f32>(-1.0+inset),vec3<f32>(1.0-inset));
  let d=length(p-q);return incidentAt(q)*exp(-max(0.0,sigma)*d)/(1.0+d*d);
}
`;
