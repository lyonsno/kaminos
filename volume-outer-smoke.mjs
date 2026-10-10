// One-way coarse atmosphere. All positions are in the detailed domain's local
// metric; velocities are local distance per reference transport tick, not cells.
import {PASSIVE_MATERIAL_LAW, PASSIVE_MATERIAL_WGSL} from './volume-passive-material.mjs';
export function outerSmokeConfig({grid=32, extent=4, pressureIterations=24, nearHeightRatio=2}={}) {
  if (![1,2].includes(nearHeightRatio)) throw new Error('near height ratio must be 1 or 2');
  if (!Number.isInteger(grid) || grid<2) throw new Error('outer grid must be an integer >= 2');
  if (!Number.isFinite(extent) || extent<=1) throw new Error('outer extent must exceed the near domain');
  if (!Number.isInteger(pressureIterations) || pressureIterations<1) throw new Error('outer pressure iterations must be positive');
  return {grid,extent,pressureIterations,nearHeightRatio,shape:[grid,2*grid,grid],min:[-extent,-extent,-extent],
    max:[extent,3*extent,extent],cellWidth:2*extent/grid};
}
export const outerCellCenter=(c,xyz)=>xyz.map((v,a)=>c.min[a]+(v+.5)*c.cellWidth);
export const nearVelocityToLocal=(v,grid)=>v.map(x=>x*2/grid);
// Consumer approximation beyond the existing incident lattice: continue the
// boundary radiance with attenuation only. Ambient already participates in the
// incident lattice; adding it again outside invents unoccluded illumination.
// Extinction uses local smoke as a segment estimate, with heuristic geometric
// dilution; this is not an exterior or environment lighting solve.
export function continueOuterSmokeRadiance(incident,distance,extinction) {
  const d=Math.max(0,distance),w=Math.exp(-Math.max(0,extinction)*d)/(1+d*d);
  return incident.map(v=>v*w);
}
export const OUTER_SMOKE_OPTICS_WGSL=/* wgsl */`
fn continueOuterSmokeRadiance(incident:vec3<f32>,distance:f32,extinction:f32)->vec3<f32>{
  let d=max(0.0,distance);let w=exp(-max(0.0,extinction)*d)/(1.0+d*d);
  return incident*w;
}
`;
// The outer domain evolves through the fine grid's sacrificial edge band.
// Do not continuously overwrite it with the fine solver's wall-damped state.
export function outerDonorBounds(c) {
  const inset=Math.max(.25,c.cellWidth);
  if(inset>=1)throw new Error('outer cells must resolve an interior donor region (cell width < 1)');
  return {min:[-1+inset,-1+inset,-1+inset],max:[1-inset,2*(c.nearHeightRatio??2)-1-inset,1-inset]};
}
export function validateOuterSmokeDevice(c,limits) {
  const donor=outerDonorBounds(c);
  // A continuous overlap can fall entirely between the coarse sample lattices.
  // Use emitted f32 constants and require interior support away from rounding
  // of LO + (i + .5) * H and the subsequent face subtraction. Eight f32 epsilons
  // of the operand scale cover these operations, including fused/unfused forms;
  // this rejects boundary-only support without changing the shader's donor box.
  const emitted=x=>Math.fround(Number(x.toFixed(9)));
  const h=emitted(c.cellWidth);
  const samples=(a,offset,hi)=>{
    const lo=emitted(c.min[a]);
    const margin=8*2**-23*Math.max(1,Math.abs(lo)+(hi+1)*Math.abs(h));
    const first=Math.max(0,Math.floor((emitted(donor.min[a])+margin-lo)/h-offset)+1);
    const last=Math.min(hi,Math.ceil((emitted(donor.max[a])-margin-lo)/h-offset)-1);
    return Math.max(0,last-first+1);
  };
  if(c.shape.some((n,a)=>samples(a,.5,n-1)===0 || samples(a,0,n)===0)) {
    throw new Error('outer donor has no support on the chosen sample lattice; increase grid resolution or reduce extent');
  }
  const count=(c.grid+1)*(2*c.grid+1)*(c.grid+1);
  if(Math.max(...c.shape)>limits.maxTextureDimension3D)throw new Error('outer smoke texture exceeds device capacity');
  if(count*32>Math.min(limits.maxBufferSize,limits.maxStorageBufferBindingSize))throw new Error('outer smoke state exceeds device buffer capacity');
  if(Math.ceil((2*c.grid+1)/4)>limits.maxComputeWorkgroupsPerDimension)throw new Error('outer smoke dispatch exceeds device capacity');
}
export function nearCellRange(c,xyz,grid) {
  const lo=xyz.map((v,a)=>c.min[a]+v*c.cellWidth);
  const min=lo.map((v,a)=>Math.max(0,Math.floor((v+1)*grid/2)));
  const max=lo.map((v,a)=>Math.min(a===1?(c.nearHeightRatio??2)*grid:grid,Math.ceil((v+c.cellWidth+1)*grid/2)));
  return min.some((v,a)=>v>=max[a])?null:{min,max};
}
export function outerBlend(p,width,nearHeightRatio=2) {
  const d=Math.min(1-Math.abs(p[0]),p[1]+1,2*nearHeightRatio-1-p[1],1-Math.abs(p[2]));
  const t=Math.max(0,Math.min(1,d/width));
  return 1-t*t*(3-2*t);
}
// Blend through a complete pair of coarse interpolation cells. A one-cell
// transition exposes the receiving grid's averaged shape as a narrow shelf.
export const outerSmokeOverlapWidth=c=>Math.min(1,Math.max(.25,2*c.cellWidth));

export function outerSmokeShader(c,nearGrid) {
  const donor=outerDonorBounds(c);
  return /* wgsl */`
const N=vec3<i32>(${c.grid},${2*c.grid},${c.grid});
const STORAGE=N+vec3<i32>(1);
const H:f32=${c.cellWidth.toFixed(9)};
const LO=vec3<f32>(${(-c.extent).toFixed(9)});
const NEAR:i32=${nearGrid};
const NEAR_HEIGHT:i32=${nearGrid*(c.nearHeightRatio??2)};
const MATERIAL_HEAT_SURVIVAL:f32=${PASSIVE_MATERIAL_LAW.heatSurvivalPerStep};
const MATERIAL_SMOKE_SURVIVAL:f32=${PASSIVE_MATERIAL_LAW.smokeSurvivalPerStep};
${PASSIVE_MATERIAL_WGSL}
struct Cell { velocity:vec4<f32>, material:vec4<f32> }
struct Params { stepScale:f32, transportScale:f32, buoyancy:f32, padding:f32 }
@group(0) @binding(0) var<uniform> params:Params;
@group(0) @binding(1) var<storage,read> near:array<vec4<f32>>;
@group(0) @binding(2) var<storage,read> src:array<Cell>;
@group(0) @binding(3) var<storage,read_write> dst:array<Cell>;
@group(0) @binding(4) var<storage,read> pressureIn:array<vec2<f32>>;
@group(0) @binding(5) var<storage,read_write> pressureOut:array<vec2<f32>>;
@group(0) @binding(6) var solids:texture_3d<u32>;
@group(0) @binding(7) var optical:texture_storage_3d<rgba16float,write>;
@group(0) @binding(8) var<storage,read_write> pressureStats:array<atomic<u32>>;
fn index(c:vec3<i32>)->u32{return u32(c.x+STORAGE.x*(c.y+STORAGE.y*c.z));}
fn inside(c:vec3<i32>)->bool{return all(c>=vec3<i32>(0)) && all(c<N);}
fn solid(c:vec3<i32>)->bool{
  if(!inside(c)){return false;}
  return textureLoad(solids,c,0).x!=0u;
}
fn point(c:vec3<i32>)->vec3<f32>{return LO+(vec3<f32>(c)+.5)*H;}
fn nearPoint(p:vec3<f32>)->bool{return all(p>vec3<f32>(${donor.min.map(x=>x.toFixed(9)).join(',')})) && all(p<vec3<f32>(${donor.max.map(x=>x.toFixed(9)).join(',')}));}
fn unit(axis:i32)->vec3<i32>{var e=vec3<i32>(0);e[axis]=1;return e;}
fn facePoint(c:vec3<i32>,a:i32)->vec3<f32>{return point(c)-vec3<f32>(unit(a))*.5*H;}
fn validFace(c:vec3<i32>,a:i32)->bool {
  var hi=N;hi[a]+=1;return all(c>=vec3<i32>(0))&&all(c<hi);
}
fn blocked(c:vec3<i32>,a:i32)->bool{return solid(c)||solid(c-unit(a));}
fn nearFace(c:vec3<i32>,a:i32)->bool{return nearPoint(facePoint(c,a));}
fn nearIndex(c:vec3<i32>)->u32{
  let q=clamp(c,vec3<i32>(0),vec3<i32>(NEAR-1,NEAR_HEIGHT-1,NEAR-1));
  return u32(q.x+NEAR*(q.y+NEAR_HEIGHT*q.z))*4u;
}
fn nearSample(p:vec3<f32>,slot:u32)->vec4<f32>{
  let q=(p+1.0)*f32(NEAR)*.5-.5;let base=vec3<i32>(floor(q));let f=fract(q);
  var v=vec4<f32>(0.0);
  for(var z=0;z<2;z++){for(var y=0;y<2;y++){for(var x=0;x<2;x++){
    let w=select(1.0-f,f,vec3<bool>(x==1,y==1,z==1));
    v+=near[nearIndex(base+vec3<i32>(x,y,z))+slot]*w.x*w.y*w.z;
  }}}return v;
}
fn prescribedFace(c:vec3<i32>,a:i32)->f32{
  // Restrict flux over the whole face. A point sample can miss a fine jet even
  // while the volume-averaged smoke enters this cell. Fine velocities store
  // upper faces: interpolate only along the face normal, area-average the two
  // transverse cell footprints, then convert fine-cell velocity to local units.
  let p=facePoint(c,a);let h=2.0/f32(NEAR);
  let lo=p-vec3<f32>(H*.5);let hi=p+vec3<f32>(H*.5);
  let first=max(vec3<i32>(0),vec3<i32>(floor((lo+1.0)/h)));
  let last=min(vec3<i32>(NEAR,NEAR_HEIGHT,NEAR),vec3<i32>(ceil((hi+1.0)/h)));
  let b=(a+1)%3;let d=(a+2)%3;
  let normal=(p[a]+1.0)/h-1.0;let n=i32(floor(normal));let f=fract(normal);
  var sum=0.0;var area=0.0;
  for(var j=first[d];j<last[d];j++){for(var i=first[b];i<last[b];i++){
    var q=vec3<i32>(0);q[b]=i;q[d]=j;q[a]=n;
    let cellLo=vec3<f32>(q)*h-1.0;
    let overlap=max(vec3<f32>(0.0),min(hi,cellLo+h)-max(lo,cellLo));
    let w=overlap[b]*overlap[d];
    let value=mix(near[nearIndex(q)].xyz[a],near[nearIndex(q+unit(a))].xyz[a],f);
    sum+=value*w;area+=w;
  }}return sum/max(area,1e-20)*h;
}
fn nearMaterial(c:vec3<i32>)->vec4<f32>{
  let lo=point(c)-.5*H;let hi=lo+H;
  let first=max(vec3<i32>(0),vec3<i32>(floor((lo+1.0)*f32(NEAR)*.5)));
  let last=min(vec3<i32>(NEAR,NEAR_HEIGHT,NEAR),vec3<i32>(ceil((hi+1.0)*f32(NEAR)*.5)));
  let h=2.0/f32(NEAR);var sum=vec4<f32>(0.0);var weight=0.0;
  for(var z=first.z;z<last.z;z++){for(var y=first.y;y<last.y;y++){for(var x=first.x;x<last.x;x++){
    let q=vec3<i32>(x,y,z);let cellLo=vec3<f32>(q)*h-1.0;
    let overlap=max(vec3<f32>(0.0),min(hi,cellLo+h)-max(lo,cellLo));
    let w=overlap.x*overlap.y*overlap.z;let base=nearIndex(q);
    let m=near[base+1u];let micro=near[base+3u];
    sum+=vec4<f32>(m.x+micro.x*.5+m.w*.08,m.y,0.0,0.0)*w;weight+=w;
  }}}return sum/max(weight,1e-20);
}
fn sampleLinearChannel(p:vec3<f32>,channel:i32)->f32{
  var q=(p-LO)/H-.5;
  if(channel<3){q[channel]+=.5;}
  let b=vec3<i32>(floor(q));let f=fract(q);var value=0.0;var weight=0.0;
  for(var z=0;z<2;z++){for(var y=0;y<2;y++){for(var x=0;x<2;x++){
    let cell=b+vec3<i32>(x,y,z);let w3=select(1.0-f,f,vec3<bool>(x==1,y==1,z==1));
    let w=w3.x*w3.y*w3.z;
    if(channel<3){
      let clamped=clamp(cell,vec3<i32>(0),N);
      if(validFace(clamped,channel)&&!blocked(clamped,channel)){value+=w*src[index(clamped)].velocity[channel];weight+=w;}
    }else{
      if(!inside(cell)){weight+=w;continue;} // ambient inflow has no smoke/heat
      if(!solid(cell)){value+=w*src[index(cell)].material[channel-3];weight+=w;}
    }
  }}}return value/max(weight,1e-12);
}
fn cubicChannel(a:f32,b:f32,c:f32,d:f32,t:f32)->f32{
  let value=-a*t*(t-1.0)*(t-2.0)/6.0+b*(t+1.0)*(t-1.0)*(t-2.0)/2.0
    -c*(t+1.0)*t*(t-2.0)/2.0+d*(t+1.0)*t*(t-1.0)/6.0;
  return clamp(value,min(b,c),max(b,c));
}
fn sampleChannel(p:vec3<f32>,channel:i32)->f32{
  var q=(p-LO)/H-.5;if(channel<3){q[channel]+=.5;}
  let base=vec3<i32>(floor(q));let f=fract(q);var rows:array<f32,16>;
  // A cubic stencil reaches farther than trilinear. Use the original masked
  // interpolation near any solid or domain boundary, so wider reconstruction
  // cannot reach through a thin wall or import undefined ghost state.
  for(var z=0;z<4;z++){for(var y=0;y<4;y++){var row:array<f32,4>;
    for(var x=0;x<4;x++){
      let c=base+vec3<i32>(x-1,y-1,z-1);
      if(channel<3){
        if(!validFace(c,channel)||blocked(c,channel)){return sampleLinearChannel(p,channel);}
        row[u32(x)]=src[index(c)].velocity[channel];
      }else{
        if(!inside(c)||solid(c)){return sampleLinearChannel(p,channel);}
        row[u32(x)]=src[index(c)].material[channel-3];
      }
    }rows[u32(z*4+y)]=cubicChannel(row[0],row[1],row[2],row[3],f.x);
  }}
  var planes:array<f32,4>;
  for(var z=0;z<4;z++){let i=u32(z*4);planes[u32(z)]=cubicChannel(rows[i],rows[i+1],rows[i+2],rows[i+3],f.y);}
  return cubicChannel(planes[0],planes[1],planes[2],planes[3],f.z);
}
fn velocity(p:vec3<f32>)->vec3<f32>{return vec3<f32>(sampleLinearChannel(p,0),sampleLinearChannel(p,1),sampleLinearChannel(p,2));}
fn clipCharacteristic(start:vec3<f32>,end:vec3<f32>)->vec3<f32>{
  // Exact grid traversal, including arbitrarily long characteristics (no step cap).
  let a=(start-LO)/H;let b=(end-LO)/H;let d=b-a;var c=vec3<i32>(floor(a));
  var tMax=vec3<f32>(1e30);var tDelta=vec3<f32>(1e30);let direction=vec3<i32>(sign(d));
  for(var k=0;k<3;k++){if(abs(d[k])>1e-12){
    let edge=f32(c[k])+select(0.0,1.0,d[k]>0.0);tMax[k]=max(0.0,(edge-a[k])/d[k]);tDelta[k]=abs(1.0/d[k]);
  }}
  loop{let t=min(tMax.x,min(tMax.y,tMax.z));if(t>=1.0){break;}
    for(var k=0;k<3;k++){if(tMax[k]<=t+1e-7){
      c[k]+=direction[k];tMax[k]+=tDelta[k];if(solid(c)){return mix(start,end,max(0.0,t-1e-5));}
    }}if(!inside(c)){break;}
  }return end;
}
@compute @workgroup_size(4,4,4)
fn advect(@builtin(global_invocation_id) id:vec3<u32>){
  let c=vec3<i32>(id);if(any(c>=STORAGE)){return;}var result:Cell;
  if(inside(c)&&!solid(c)){
    let p=point(c);let end=clipCharacteristic(p,p-velocity(p)*params.transportScale);
    // p is already in the fine kernel's normalised metric (-1 at its floor).
    // Cool the transported heat before conversion, as in the fine kernel.
    // There is no outer fuel, source birth, reaction or fine wall sponge.
    let heat=sampleChannel(end,4)*pow(MATERIAL_HEAT_SURVIVAL,params.stepScale);
    let smoke=sampleChannel(end,3)*pow(MATERIAL_SMOKE_SURVIVAL,params.stepScale)
      +passiveHeatToSmokeRate(heat,p.y)*params.stepScale;
    result.material=vec4<f32>(smoke,heat,0.0,0.0);
    // Donors carry this tick's already-evolved fine material; do not age twice.
    if(nearPoint(p)){result.material=nearMaterial(c);}
  }
  for(var a=0;a<3;a++){
    if(!validFace(c,a)||blocked(c,a)){continue;}
    let p=facePoint(c,a);let end=clipCharacteristic(p,p-velocity(p)*params.transportScale);
    result.velocity[a]=sampleChannel(end,a);
    if(a==1){result.velocity[a]+=sampleChannel(p,4)*params.buoyancy*params.stepScale;}
    if(nearFace(c,a)){result.velocity[a]=prescribedFace(c,a);}
  }dst[index(c)]=result;
}
fn face(c:vec3<i32>,a:i32)->f32{
  if(!validFace(c,a)||blocked(c,a)){return 0.0;}return src[index(c)].velocity[a];
}
@compute @workgroup_size(4,4,4)
fn divergence(@builtin(global_invocation_id) id:vec3<u32>){
  let c=vec3<i32>(id);if(!inside(c)){return;}var div=0.0;
  if(all(id==vec3<u32>(0))){atomicStore(&pressureStats[0],0u);atomicStore(&pressureStats[1],1u);atomicStore(&pressureStats[2],0u);}
  if(!solid(c)){for(var a=0;a<3;a++){div+=(face(c+unit(a),a)-face(c,a))/H;}}
  pressureOut[index(c)]=vec2<f32>(pressureIn[index(c)].x,div);
}
fn pressure(c:vec3<i32>)->f32{if(!inside(c)){return 0.0;}return pressureIn[index(c)].x;}
@compute @workgroup_size(4,4,4)
fn jacobi(@builtin(global_invocation_id) id:vec3<u32>){
  let c=vec3<i32>(id);if(!inside(c)){return;}
  var sum=0.0;var degree=0.0;let rhs=pressureIn[index(c)].y;
  if(!solid(c)){
    for(var a=0;a<3;a++){for(var side=0;side<2;side++){
      let faceCell=c+unit(a)*side;let neighbor=c+unit(a)*(side*2-1);
      if(blocked(faceCell,a)||nearFace(faceCell,a)){continue;}
      sum+=pressure(neighbor);degree+=1.0;
    }}
  }
  pressureOut[index(c)]=vec2<f32>(select(0.0,(sum-rhs*H*H)/max(degree,1.0),degree>0.0),rhs);
}
fn inPlacePressure(c:vec3<i32>)->f32{if(!inside(c)){return 0.0;}return pressureOut[index(c)].x;}
fn pressureSweep(id:vec3<u32>,parity:u32){
  let c=vec3<i32>(id);if(!inside(c)||atomicLoad(&pressureStats[1])==0u){return;}
  if(((id.x+id.y+id.z)&1u)!=parity){return;}
  if(all(id==vec3<u32>(0))){atomicAdd(&pressureStats[2],1u);}
  var sum=0.0;var degree=0.0;let cell=pressureOut[index(c)];
  if(!solid(c)){
    for(var a=0;a<3;a++){for(var side=0;side<2;side++){
      let faceCell=c+unit(a)*side;let neighbor=c+unit(a)*(side*2-1);
      if(blocked(faceCell,a)||nearFace(faceCell,a)){continue;}
      sum+=inPlacePressure(neighbor);degree+=1.0;
    }}
  }
  let solution=(sum-cell.y*H*H)/max(degree,1.0);
  pressureOut[index(c)]=vec2<f32>(select(0.0,cell.x+(solution-cell.x)*1.9,degree>0.0),cell.y);
}
@compute @workgroup_size(4,4,4)
fn pressureEven(@builtin(global_invocation_id) id:vec3<u32>){pressureSweep(id,0u);}
@compute @workgroup_size(4,4,4)
fn pressureOdd(@builtin(global_invocation_id) id:vec3<u32>){pressureSweep(id,1u);}
fn projectedFace(c:vec3<i32>,a:i32)->f32{
  if(!validFace(c,a)||blocked(c,a)){return 0.0;}
  var v=face(c,a);if(!nearFace(c,a)){v-=(pressure(c)-pressure(c-unit(a)))/H;}return v;
}
@compute @workgroup_size(1)
fn pressureErrorReset(){if(atomicLoad(&pressureStats[1])!=0u){atomicStore(&pressureStats[0],0u);}}
@compute @workgroup_size(4,4,4)
fn pressureError(@builtin(global_invocation_id) id:vec3<u32>){
  let c=vec3<i32>(id);if(!inside(c)||solid(c)||atomicLoad(&pressureStats[1])==0u){return;}
  var error=0.0;var freeFaces=0u;
  for(var a=0;a<3;a++){
    error+=(projectedFace(c+unit(a),a)-projectedFace(c,a))/H;
    for(var side=0;side<2;side++){let f=c+unit(a)*side;if(!blocked(f,a)&&!nearFace(f,a)){freeFaces+=1u;}}
  }
  // Fully prescribed fine donors can contain combustion expansion. Only the
  // free exterior equations target zero; no fine expansion is projected away.
  if(freeFaces>0u){atomicMax(&pressureStats[0],select(0x7f800000u,bitcast<u32>(abs(error)),abs(error)<=1e30));}
}
@compute @workgroup_size(1)
fn pressureErrorFinish(){
  if(atomicLoad(&pressureStats[1])!=0u && bitcast<f32>(atomicLoad(&pressureStats[0]))<=0.001){atomicStore(&pressureStats[1],0u);}
}
@compute @workgroup_size(4,4,4)
fn project(@builtin(global_invocation_id) id:vec3<u32>){
  let c=vec3<i32>(id);if(any(c>=STORAGE)){return;}var cell=src[index(c)];
  for(var a=0;a<3;a++){
    if(!validFace(c,a)||blocked(c,a)){cell.velocity[a]=0.0;continue;}
    if(!nearFace(c,a)){cell.velocity[a]-=(pressure(c)-pressure(c-unit(a)))/H;}
  }dst[index(c)]=cell;
}
@compute @workgroup_size(4,4,4)
fn publish(@builtin(global_invocation_id) id:vec3<u32>){
  let c=vec3<i32>(id);if(!inside(c)){return;}
  textureStore(optical,c,src[index(c)].material);
}
`;
}

export function createOuterSmoke(device, config, nearGrid, nearBuffers) {
  const c=outerSmokeConfig(config), count=(c.grid+1)*(2*c.grid+1)*(c.grid+1);
  validateOuterSmokeDevice(c,device.limits);
  const owned=[];
  const buffer=(label,size)=>{const b=device.createBuffer({label,size,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST});owned.push(b);return b;};
  const states=[buffer('outer smoke state A',count*32),buffer('outer smoke state B',count*32)];
  const pressures=[buffer('outer pressure A',count*8),buffer('outer pressure B',count*8)];
  const pressureStats=buffer('outer pressure completion',16);
  const pressureBudget=Math.max(c.pressureIterations,Math.ceil(c.pressureIterations*4*(c.grid/32)**2));
  const params=device.createBuffer({label:'outer smoke step',size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});owned.push(params);
  const optical=device.createTexture({label:'outer smoke optical material',size:c.shape,dimension:'3d',format:'rgba16float',usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING});owned.push(optical);
  const solids=device.createTexture({label:'outer authored solid',size:c.shape,dimension:'3d',format:'r8uint',usage:GPUTextureUsage.COPY_DST|GPUTextureUsage.TEXTURE_BINDING});owned.push(solids);
  const layout=device.createBindGroupLayout({entries:[
    {binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:'uniform'}},
    ...[1,2,4].map(binding=>({binding,visibility:GPUShaderStage.COMPUTE,buffer:{type:'read-only-storage'}})),
    ...[3,5].map(binding=>({binding,visibility:GPUShaderStage.COMPUTE,buffer:{type:'storage'}})),
    {binding:8,visibility:GPUShaderStage.COMPUTE,buffer:{type:'storage'}},
    {binding:6,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:'uint',viewDimension:'3d'}},
    {binding:7,visibility:GPUShaderStage.COMPUTE,storageTexture:{access:'write-only',format:'rgba16float',viewDimension:'3d'}},
  ]});
  const shader=device.createShaderModule({label:'coarse surrounding smoke',code:outerSmokeShader(c,nearGrid)});
  const pipelineLayout=device.createPipelineLayout({bindGroupLayouts:[layout]});
  const pipelines=Object.fromEntries(['advect','divergence','jacobi','pressureEven','pressureOdd','pressureErrorReset','pressureError','pressureErrorFinish','project','publish'].map(entryPoint=>[entryPoint,
    device.createComputePipeline({label:`outer ${entryPoint}`,layout:pipelineLayout,compute:{module:shader,entryPoint}})]));
  const groups=new Map();
  const group=(nearIndex,s,p)=>{
    const key=`${nearIndex}/${s}/${p}`;if(groups.has(key))return groups.get(key);
    const bindings=[params,nearBuffers[nearIndex],states[s],states[1-s],pressures[p],pressures[1-p]];
    const g=device.createBindGroup({layout,entries:[...bindings.map((b,binding)=>({binding,resource:{buffer:b}})),
      {binding:6,resource:solids.createView()},{binding:7,resource:optical.createView()},{binding:8,resource:{buffer:pressureStats}}]});groups.set(key,g);return g;
  };
  let current=0,pressureCurrent=0,steps=0,solidRevision=null,pressureCompletion=null;
  const clearSolids=()=>{
    const bytesPerRow=Math.ceil(c.grid/256)*256;
    device.queue.writeTexture({texture:solids},new Uint8Array(bytesPerRow*2*c.grid*c.grid),
      {bytesPerRow,rowsPerImage:2*c.grid},c.shape);solidRevision=null;
  };
  return {
    config:c,optical,solids,shader,clearSolids,
    setSolids(packed,revision){device.queue.writeTexture({texture:solids},packed.data,{bytesPerRow:packed.bytesPerRow,rowsPerImage:packed.rowsPerImage},c.shape);solidRevision=revision;},
    encode(encoder,nearIndex,{dtScale,backtraceScale},buoyancy=.002){
      device.queue.writeBuffer(params,0,new Float32Array([dtScale,backtraceScale,buoyancy,0]));
      const dispatch=(name,s,p)=>{const pass=encoder.beginComputePass({label:`outer smoke ${name}`});pass.setPipeline(pipelines[name]);pass.setBindGroup(0,group(nearIndex,s,p));
        if(name==='pressureErrorReset'||name==='pressureErrorFinish'){pass.dispatchWorkgroups(1);}
        else{pass.dispatchWorkgroups(Math.ceil((c.grid+1)/4),Math.ceil((2*c.grid+1)/4),Math.ceil((c.grid+1)/4));}pass.end();};
      dispatch('advect',current,0);current=1-current;
      dispatch('divergence',current,pressureCurrent);let p=1-pressureCurrent;
      for(let i=0;i<pressureBudget;i++){
        dispatch('pressureEven',current,1-p);dispatch('pressureOdd',current,1-p);
        if((i+1)%8===0 || i+1===pressureBudget){dispatch('pressureErrorReset',current,p);dispatch('pressureError',current,p);dispatch('pressureErrorFinish',current,p);}
      }
      pressureCurrent=p;
      dispatch('project',current,p);current=1-current;
      dispatch('publish',current,p);steps++;
    },
    receipt(){return {requested:true,effective:'one-way-coarse-pressure-smoke-v0',shape:c.shape,bounds:{min:c.min,max:c.max},cellWidth:c.cellWidth,
      passiveMaterial:{identity:PASSIVE_MATERIAL_LAW.identity,heatSurvivalPerStep:PASSIVE_MATERIAL_LAW.heatSurvivalPerStep,smokeSurvivalPerStep:PASSIVE_MATERIAL_LAW.smokeSurvivalPerStep,conversion:'cooled-heat-fuel-free',heightFrame:PASSIVE_MATERIAL_LAW.heightFrame,donorAging:'already-evolved-fine-overwrite'},
      pressureIterations:c.pressureIterations,pressureBudget,pressureWarmStart:true,pressureScheme:'red-black-sor',pressureTarget:.001,pressureCompletion,steps,solidRevision,stateAndPressureBytes:count*80+16,advection:'bounded-cubic-velocity-smoke-heat-v0',wallInterpolation:'masked-trilinear-near-solids-and-exterior',donorBounds:outerDonorBounds(c),innerFeedback:false,scalarTransfer:'interior-overlap-volume-average-dirichlet-not-conservative-flux',outerBoundary:'ambient-zero-pressure'};},
    async readState(){const measuredStep=steps,b=device.createBuffer({size:count*32+16,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
      try{const e=device.createCommandEncoder();e.copyBufferToBuffer(states[current],0,b,0,count*32);e.copyBufferToBuffer(pressureStats,0,b,count*32,16);device.queue.submit([e.finish()]);await b.mapAsync(GPUMapMode.READ);
        const raw=b.getMappedRange(),words=new Uint32Array(raw,count*32,4),peak=new Float32Array(raw,count*32,1)[0];
        if(measuredStep>0 && words[2]===0)throw new Error('outer-pressure-execution-unverified:no-completed-sweeps');
        pressureCompletion={measuredStep,target:.001,maxError:peak,verified:measuredStep>0&&words[2]>0,satisfied:measuredStep>0&&words[2]>0&&words[1]===0,sweeps:words[2],budgetExhausted:words[1]!==0,criterion:'max-free-exterior-divergence'};
        return new Float32Array(raw.slice(0,count*32));}finally{b.destroy();}},
    destroy(){for(const x of owned)x.destroy();},
  };
}
