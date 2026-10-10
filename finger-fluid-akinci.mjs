import {cubicSplineKernel} from './finger-fluid-ipbf-reference.mjs';

// Akinci et al., TOG 2013, equations (1)-(5). Primary PDF:
// https://cg.informatik.uni-freiburg.de/publications/2013_SIGGRAPHASIA_surfaceTensionAdhesion.pdf
// Equal-volume, single-phase component. Gamma is the published MODEL
// coefficient; a mapping to SI sigma requires an independent droplet response.
// The source combines unlike dimensional scalings; do not relabel gamma N/m.
export const AKINCI_REFERENCE_DENSITY = 1000;
const positive=(x,n)=>{if(!Number.isFinite(x)||x<=0)throw new RangeError(n+' must be positive and finite');};
export function akinciCohesionKernel(distance,h) {
  positive(h,'Surface support radius');
  if(!Number.isFinite(distance)||distance<0)throw new RangeError('Distance must be finite and nonnegative');
  const q=distance/h;
  if(q>=1)return 0;
  const b=((1-q)*q)**3;
  return 32/(Math.PI*h**3)*(q<=.5?2*b-1/64:b);
}
export function evaluateAkinciSurface({positions,volume,coefficient,h=2*Math.cbrt(volume),referenceDensity=AKINCI_REFERENCE_DENSITY,phases=positions?.map(()=>0)}) {
  positive(volume,'Equal particle volume');positive(h,'Surface support radius');positive(referenceDensity,'Reference density');
  if(!Number.isFinite(coefficient)||coefficient<0)throw new RangeError('Surface coefficient must be finite and nonnegative');
  if(!Array.isArray(positions)||!positions.length||positions.some(p=>!Array.isArray(p)||p.length!==3||!p.every(Number.isFinite)))throw new TypeError('Finite positions required');
  if(!Array.isArray(phases)||phases.length!==positions.length||!phases.every(Number.isFinite))throw new TypeError('Matching phase identities required');
  const same=(i,j)=>phases[i]===phases[j];
  const offsets=positions.map(a=>positions.map(b=>a.map((x,k)=>x-b[k])));
  const densityRatios=positions.map((_,i)=>positions.reduce((s,__,j)=>s+(same(i,j)?volume*cubicSplineKernel(offsets[i][j],h).value:0),0));
  const normals=positions.map((_,i)=>positions.reduce((sum,__,j)=>{
    if(same(i,j))cubicSplineKernel(offsets[i][j],h).gradient.forEach((x,k)=>{sum[k]+=h*volume/densityRatios[j]*x;});
    return sum;
  },[0,0,0]));
  const accelerations=positions.map((_,i)=>positions.reduce((sum,__,j)=>{
    const offset=offsets[i][j],r=Math.hypot(...offset);
    if(i!==j&&same(i,j)&&r>0&&r<h){
      const pairCorrection=2/(densityRatios[i]+densityRatios[j]);
      const central=referenceDensity*volume*akinciCohesionKernel(r,h);
      sum.forEach((__,k)=>{sum[k]-=coefficient*pairCorrection*(central*offset[k]/r+normals[i][k]-normals[j][k]);});
    }
    return sum;
  },[0,0,0]));
  return {h,volume,coefficient,referenceDensity,densityRatios,normals,accelerations,
    centerOfMassAcceleration:[0,1,2].map(k=>accelerations.reduce((s,a)=>s+a[k],0)/positions.length)};
}

/** Production component uses its own density and normal fields at the current
 * committed positions, before predictor and pressure. No stale pressure density,
 * per-particle normalization, interface activity gate, or force cap is inherited.
 * Existing support/contact/speed handling still applies in the predictor.
 */
export function createAkinciSurfaceShader({volume,referenceDensity=AKINCI_REFERENCE_DENSITY,supportRadius=2*Math.cbrt(volume)}) {
  positive(volume,'Equal particle volume');positive(referenceDensity,'Reference density');
  positive(supportRadius,'Surface support radius');
  const h=supportRadius;
  for(const v of [volume,h,referenceDensity,32/(Math.PI*h**3),8/(Math.PI*h**3)]){
    if(!(Math.fround(v)>0)||!Number.isFinite(Math.fround(v)))throw new RangeError('Surface kernel exceeds f32 capacity');
  }
  return `
struct SurfaceField { normal: vec4<f32>, density: vec4<f32>, }
@group(2) @binding(0) var<storage, read_write> surfaceField: array<SurfaceField>;
const surfaceRadius: f32 = ${h};
const surfaceVolume: f32 = ${volume};
const surfaceReferenceDensity: f32 = ${referenceDensity};
fn surface_active(i: u32) -> bool {
  return particles[i].velocity.w >= 0.0 && adaptive_volume_scale(i) > 0.0;
}
fn surface_kernel(r: f32) -> f32 {
  let q=r/surfaceRadius;
  if(q>=1.0){return 0.0;}
  let f=select(2.0*pow(1.0-q,3.0),1.0-6.0*q*q+6.0*q*q*q,q<0.5);
  return 8.0/(3.141592653589793*surfaceRadius*surfaceRadius*surfaceRadius)*f;
}
fn surface_gradient(offset: vec3<f32>) -> vec3<f32> {
  let r=length(offset);let q=r/surfaceRadius;
  if(r==0.0 || q>=1.0){return vec3<f32>(0.0);}
  let first=select(-6.0*(1.0-q)*(1.0-q),-12.0*q+18.0*q*q,q<0.5);
  return offset/r*(8.0/(3.141592653589793*pow(surfaceRadius,4.0))*first);
}
fn surface_cohesion_kernel(r: f32) -> f32 {
  let q=r/surfaceRadius;
  if(q>=1.0){return 0.0;}
  let b=pow((1.0-q)*q,3.0);
  return 32.0/(3.141592653589793*pow(surfaceRadius,3.0))*select(b,2.0*b-1.0/64.0,q<=0.5);
}
fn surface_cell_reach() -> vec3<i32> {
  let cellWidth=(params.boundsMax.xyz-params.boundsMin.xyz)/vec3<f32>(params.gridDims.xyz);
  return vec3<i32>(ceil(vec3<f32>(surfaceRadius)/cellWidth));
}
@compute @workgroup_size(64)
fn surface_build_grid(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i=gid.x;if(i>=params.particleCount){return;}
  if(!surface_active(i)){particleNext[i]=-1;return;}
  let cell=cellIndex(gridCoord(particles[i].position.xyz));
  particleNext[i]=atomicExchange(&cellHeads[cell],i32(i));
}
@compute @workgroup_size(64)
fn surface_density(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i=gid.x;if(i>=params.particleCount){return;}
  if(!surface_active(i)){surfaceField[i].density=vec4<f32>(0.0);return;}
  let p=particles[i].position.xyz;let cell=gridCoord(p);let reach=surface_cell_reach();
  var rho=0.0;
  for(var z=-reach.z;z<=reach.z;z=z+1){for(var y=-reach.y;y<=reach.y;y=y+1){for(var x=-reach.x;x<=reach.x;x=x+1){
    let nc=cell+vec3<i32>(x,y,z);
    if(any(nc<vec3<i32>(0))||any(nc>=vec3<i32>(params.gridDims.xyz))){continue;}
    var j=atomicLoad(&cellHeads[cellIndex(nc)]);
    while(j>=0){let k=u32(j);
      if(surface_active(k)){
        rho=rho+surfaceVolume*surface_kernel(length(p-particles[k].position.xyz));
      }
      j=particleNext[k];
    }
  }}}
  surfaceField[i].density=vec4<f32>(rho,particles[i].velocity.w,0.0,0.0);
}
@compute @workgroup_size(64)
fn surface_normals(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i=gid.x;if(i>=params.particleCount){return;}
  var normal=vec3<f32>(0.0);
  if(surface_active(i)){
    let p=particles[i].position.xyz;let cell=gridCoord(p);let reach=surface_cell_reach();
    for(var z=-reach.z;z<=reach.z;z=z+1){for(var y=-reach.y;y<=reach.y;y=y+1){for(var x=-reach.x;x<=reach.x;x=x+1){
      let nc=cell+vec3<i32>(x,y,z);
      if(any(nc<vec3<i32>(0))||any(nc>=vec3<i32>(params.gridDims.xyz))){continue;}
      var j=atomicLoad(&cellHeads[cellIndex(nc)]);
      while(j>=0){let k=u32(j);
        if(surface_active(k)){
          normal=normal+surfaceRadius*surfaceVolume/surfaceField[k].density.x*surface_gradient(p-particles[k].position.xyz);
        }
        j=particleNext[k];
      }
    }}}
  }
  surfaceField[i].normal=vec4<f32>(normal,0.0);
}
@compute @workgroup_size(64)
fn surface_force(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i=gid.x;if(i>=params.particleCount){return;}
  if(surfaceField[i].density.x<=0.0){return;}
  let p=particles[i].position.xyz;let cell=gridCoord(p);let reach=surface_cell_reach();
  var acceleration=vec3<f32>(0.0);
  for(var z=-reach.z;z<=reach.z;z=z+1){for(var y=-reach.y;y<=reach.y;y=y+1){for(var x=-reach.x;x<=reach.x;x=x+1){
    let nc=cell+vec3<i32>(x,y,z);
    if(any(nc<vec3<i32>(0))||any(nc>=vec3<i32>(params.gridDims.xyz))){continue;}
    var j=atomicLoad(&cellHeads[cellIndex(nc)]);
    while(j>=0){let k=u32(j);let offset=p-particles[k].position.xyz;let r=length(offset);
      if(k!=i&&surfaceField[k].density.x>0.0&&r>0.0&&r<surfaceRadius){
        let pairCorrection=2.0/(surfaceField[i].density.x+surfaceField[k].density.x);
        let central=surfaceReferenceDensity*surfaceVolume*surface_cohesion_kernel(r)*offset/r;
        acceleration=acceleration-params.chemistry.y*pairCorrection*(central+surfaceField[i].normal.xyz-surfaceField[k].normal.xyz);
      }
      j=particleNext[k];
    }
  }}}
  particles[i].velocity=vec4<f32>(particles[i].velocity.xyz+params.dt*acceleration,particles[i].velocity.w);
}
`;
}
