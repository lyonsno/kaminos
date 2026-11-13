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
 // Coefficients and coverage are packed once on the material lattice. The
 // velocity kernel may run at a lower resolution while sharing this texture.
 let materialGrid=textureLoad(immersedSources,vec2<i32>(0),0,0).z;
 let materialPerCell=materialGrid/f32(GRID);
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
  let delta=cell-a.yzw/materialPerCell;let along=dot(delta,b.xyz);let radial=length(delta-along*b.xyz);
  let thickness=max(1.0,c.x/materialPerCell);let radius=b.w/materialPerCell;
  let slab=(1.0-smoothstep(thickness*0.5-0.5,thickness*0.5+0.5,abs(along)))*(1.0-smoothstep(radius-0.5,radius+0.5,radial));
  let e2=normalize(cross(e.xyz,b.xyz));
  let uv=vec2<i32>(clamp(i32(floor(materialGrid*0.5+dot(delta,e.xyz)*materialPerCell)),0,i32(materialGrid)-1),clamp(i32(floor(materialGrid*0.5+dot(delta,e2)*materialPerCell)),0,i32(materialGrid)-1));
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

// Shared single-source support law, using the caller's simulation lattice and inlet bindings.
export const IMMERSED_SINGLE_SOURCE_WGSL=/* wgsl */`
fn immersedDirection() -> vec3<f32> {
  return u.immersed_source_b.xyz;
}

// Weight of a cell in the immersed source's slab: an antialiased indicator of
// |along| ≤ t/2 and radial ≤ r in cell units (cell centres at integer + 0.5).
// The CPU mirror immersedSourceWeights computes the same number.
fn immersedSourceWeight(cellCenter: vec3<f32>) -> f32 {
  if (u.immersed_source_a.x < 0.5) { return 0.0; }
  let d = cellCenter - u.immersed_source_a.yzw;
  let n = immersedDirection();
  let along = dot(d, n);
  let radial = length(d - along * n);
  let halfThickness = max(0.5, 0.5 * u.immersed_source_c.x);
  let radius = u.immersed_source_b.w;
  // Edges ascend: Metal leaves smoothstep with reversed edges undefined.
  return (1.0 - smoothstep(halfThickness - 0.5, halfThickness + 0.5, abs(along))) * (1.0 - smoothstep(radius - 0.5, radius + 0.5, radial));
}

// The slab's pattern and inlet turbulence (slab inlet dynamics, report §33):
// the slab-local cell (u, v) of the disc plane indexes the floor coverage map
// (built for the slab's pattern, centred at GRID/2) and the inlet turbulence
// lattice, exactly as the CPU mirror indexes them. slabWeight is the plain
// disc indicator; the pattern can only remove, the turbulence modulates.
fn immersedPatternedWeight(cellCenter: vec3<f32>, slabWeight: f32) -> f32 {
  if (slabWeight <= 0.0) { return 0.0; }
  let d = cellCenter - u.immersed_source_a.yzw;
  let n = immersedDirection();
  let e1 = u.immersed_source_e.xyz;
  let e2 = normalize(cross(e1, n));
  let materialPerVelocity = max(1e-8, u.immersed_source_f.y);
  let patternWidth = i32(round(f32(GRID) * materialPerVelocity));
  let patternCentre = f32(patternWidth) * 0.5;
  let slabCell = vec2<i32>(clamp(i32(floor(patternCentre + dot(d, e1) * materialPerVelocity)), 0, patternWidth - 1), clamp(i32(floor(patternCentre + dot(d, e2) * materialPerVelocity)), 0, patternWidth - 1));
  var coverage = 1.0;
  if (u.immersed_source_f.x > 0.5) { coverage = textureLoad(inflowCoverage, slabCell, 0).x; }
  var perturbation = 0.0;
  if (u.immersed_source_e.w > 0.0) { perturbation = textureLoad(inflowPerturbation, slabCell, 0).x; }
  return slabWeight * coverage * max(0.0, 1.0 + u.immersed_source_e.w * perturbation);
}
`;
