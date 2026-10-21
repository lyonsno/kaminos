// Standalone shader text: safe when the collection is the module entry point.
export const IMMERSED_COLLECTION_WGSL=/* wgsl */`
@group(0) @binding(33) var immersedSources: texture_2d_array<f32>;
struct ImmersedContributions {
 slab: f32, weight: f32, supply: f32, relaxation: f32,
 mixture: vec2<f32>, velocity: vec3<f32>,
};
fn immersedCollectionOn() -> bool {return textureLoad(immersedSources,vec2<i32>(0),0,0).x>0.5;}
fn immersedContributions(cell:vec3<f32>) -> ImmersedContributions {
 if(!immersedCollectionOn()) {
  let slab=immersedSourceWeight(cell);let w=immersedPatternedWeight(cell,slab);
  return ImmersedContributions(slab,w,min(u.immersed_source_d.y,w*u.immersed_source_d.z),min(1.0,w*u.immersed_source_d.x),u.immersed_source_c.zw,u.immersed_source_c.y*immersedDirection());
 }
 let count=u32(textureLoad(immersedSources,vec2<i32>(0),0,0).y);
 var slabUnion=0.0;var weight=0.0;var supply=0.0;var mixture=vec2<f32>(0.0);
 var remaining=1.0;var relaxSum=0.0;var velocity=vec3<f32>(0.0);
 for(var i=0u;i<count;i++) {
  let layer=i32(i+1u);
  let a=textureLoad(immersedSources,vec2<i32>(0,0),layer,0);
  if(a.x<0.5){continue;}
  let b=textureLoad(immersedSources,vec2<i32>(1,0),layer,0);
  let c=textureLoad(immersedSources,vec2<i32>(2,0),layer,0);
  let d=textureLoad(immersedSources,vec2<i32>(3,0),layer,0);
  let e=textureLoad(immersedSources,vec2<i32>(4,0),layer,0);
  let f=textureLoad(immersedSources,vec2<i32>(5,0),layer,0);
  let delta=cell-a.yzw;let along=dot(delta,b.xyz);let radial=length(delta-along*b.xyz);
  let slab=(1.0-smoothstep(c.x*0.5-0.5,c.x*0.5+0.5,abs(along)))*(1.0-smoothstep(b.w-0.5,b.w+0.5,radial));
  let e2=normalize(cross(e.xyz,b.xyz));
  let uv=vec2<i32>(clamp(i32(floor(f32(GRID)*0.5+dot(delta,e.xyz))),0,i32(GRID)-1),clamp(i32(floor(f32(GRID)*0.5+dot(delta,e2))),0,i32(GRID)-1));
  let pattern=textureLoad(immersedSources,uv+vec2<i32>(0,1),layer,0);
  let coverage=select(1.0,pattern.x,f.x>0.5);
  let w=slab*coverage*max(0.0,1.0+e.w*pattern.y);
  let q=min(d.y,w*d.z);let r=min(1.0,w*d.x);
  if(count==1u){return ImmersedContributions(slab,w,q,r,c.zw,c.y*b.xyz);}
  slabUnion=max(slabUnion,slab);weight+=w;supply+=q;mixture+=q*c.zw;
  remaining*=1.0-r;relaxSum+=r;velocity+=r*c.y*b.xyz;
 }
 // Pressure keeps the sum of local capped supply. Mixture entry is bounded by
 // the existing main-kernel clamp; relaxation is the union of local blends.
 if(supply>0.0){mixture/=supply;}
 if(relaxSum>0.0){velocity/=relaxSum;}
 return ImmersedContributions(slabUnion,weight,supply,1.0-remaining,mixture,velocity);
}
`;
