// Camera reference: exact traversal of the common piecewise-constant voxels.
// The incident field is the angular MEAN, so isotropic first scattering is
// sigma_s * mean(L), with sigma_s = authored albedo * sigma_t.
export const PARTICLE_LIGHT_VIEW_WGSL=/*wgsl*/`
fn particleLightCamera(medium:texture_3d<f32>,incident:texture_3d<f32>,eye:vec3<f32>,surface:vec3<f32>,lo:vec3<f32>,extent:vec3<f32>,albedo:f32,mode:u32,exposure:f32)->vec4<f32>{
 let ray=normalize(surface-eye);let hi=lo+extent;let dims=textureDimensions(medium);let cell=extent/vec3<f32>(dims);
 var near=-1e30;var far=1e30;
 for(var axis=0;axis<3;axis++){
  if(abs(ray[axis])<1e-10){if(eye[axis]<lo[axis]||eye[axis]>hi[axis]){return vec4<f32>(0);}}
  else{let a=(lo[axis]-eye[axis])/ray[axis];let b=(hi[axis]-eye[axis])/ray[axis];near=max(near,min(a,b));far=min(far,max(a,b));}
 }
 var t=max(0.0,near);if(far<=t){return vec4<f32>(0);}
 let start=eye+ray*t;let q=(start-lo)/cell;
 var voxel=clamp(vec3<i32>(floor(q)),vec3<i32>(0),vec3<i32>(dims)-vec3<i32>(1));
 // On an internal boundary, a negative-going ray enters the lower voxel.
 for(var axis=0;axis<3;axis++){if(ray[axis]<0&&abs(q[axis]-round(q[axis]))<1e-5&&q[axis]>0){voxel[axis]=i32(round(q[axis]))-1;}}
 var trans=1.0;var color=vec3<f32>(0);
 loop{
  if(any(voxel<vec3<i32>(0))||any(voxel>=vec3<i32>(dims))||t>=far){break;}
  var next=vec3<f32>(1e30);
  for(var axis=0;axis<3;axis++){if(abs(ray[axis])>=1e-10){let edge=lo[axis]+(f32(voxel[axis])+select(0.0,1.0,ray[axis]>0))*cell[axis];next[axis]=(edge-eye[axis])/ray[axis];}}
  let end=min(far,min(next.x,min(next.y,next.z)));let length=max(0.0,end-t);
  let m=textureLoad(medium,voxel,0);let incoming=textureLoad(incident,voxel,0).xyz;
  let source=select(vec3<f32>(0),m.xyz,mode!=1u)+select(vec3<f32>(0),max(incoming,vec3<f32>(0))*m.w*albedo,mode!=0u);
  let tau=m.w*length;let T=exp(-tau);var phi=1.0-tau*.5+tau*tau/6.0;if(tau>.01){phi=(1.0-T)/tau;}
  color+=trans*source*length*phi;trans*=T;t=end;
  if(end>=far){break;}
  for(var axis=0;axis<3;axis++){if(next[axis]<=end+1e-6*max(1.0,abs(end))){voxel[axis]+=select(-1,1,ray[axis]>0);}}
 }
 let alpha=1.0-trans;let display=vec3<f32>(1)-exp(-max(color,vec3<f32>(0))*exp2(exposure));
 return vec4<f32>(display,alpha);
}
`;
export function validateParticleLightView({albedo=.5,mode=2,exposure=-5}={}){
 if(!Number.isFinite(albedo)||albedo<0||albedo>1||![0,1,2].includes(mode)||!Number.isFinite(exposure))throw Error('Invalid particle lighting view');
 return {albedo,mode,exposure};
}
