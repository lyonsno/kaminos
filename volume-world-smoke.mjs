import {TRANSFER_GEOMETRY_WGSL} from './volume-grid-transfer.mjs';
import { THERMAL_MOMENTS_WGSL } from './volume-thermal-moments.mjs';
import { REACTANT_COMBUSTION_WGSL, reactantCombustionUniformValues } from './volume-reactant-combustion.mjs';
import { SOOT_BURNOUT_WGSL, physicsAppearanceUniformValues } from './volume-physics-appearance.mjs';
// An independently allocated world field. Fine pressure is never read or written.
export function worldSmokePlan({flow=16,material=32,pressure=flow,extent=3,fineHeightRatio=2}={}) {
  if(!Number.isInteger(flow)||flow<2||!Number.isInteger(material)||material<2||!Number.isFinite(extent)||extent<=1||!Number.isFinite(fineHeightRatio)||fineHeightRatio<=0)throw Error('Invalid world smoke dimensions');
  if(!Number.isSafeInteger(pressure)||pressure<2)throw Error('Invalid world pressure dimensions: use an integral subdivision of velocity');
  // Preserve cubic cells and the default field, while retaining at least one
  // extent of headroom above every admitted fine outlet.
  const height=Math.max(2,Math.ceil((2*fineHeightRatio-1+2*extent)/(2*extent)));
  return {flowDims:[flow,height*flow,flow],materialDims:[material,height*material,material],pressureDims:[pressure,height*pressure,pressure],flowCells:height*flow**3,materialCells:height*material**3,pressureCells:height*pressure**3,flowPitch:2*extent/flow,materialPitch:2*extent/material,pressurePitch:2*extent/pressure,min:[-extent,-extent,-extent],max:[extent,(2*height-1)*extent,extent],fineFeedback:false};
}
export function worldSmokeMapping(plan,anchor,fine){
  for(const t of [anchor,fine])if(!t.translate?.every(Number.isFinite)||!(t.scale>0))throw Error('Invalid world smoke transform');
  const offset=fine.translate.map((v,i)=>(v-anchor.translate[i])/anchor.scale),scale=fine.scale/anchor.scale;
  return {fineToField:[...offset,scale],renderMin:plan.min.map((v,i)=>(v-offset[i])/scale),renderMax:plan.max.map((v,i)=>(v-offset[i])/scale),renderPitch:plan.materialPitch/scale};
}
// Express the physical donor box on the receiver's doubled face lattice.
// A component face is exactly 2*c + 1 + axis(component). Compute membership
// before f32 world-position reconstruction: e.g. the aligned y=3 outlet can
// otherwise reconstruct as 3.000000238 and lose its incoming momentum.
function momentumBounds(plan,mapping,fineDims){
  const snap=n=>{const r=Math.round(n);return Math.abs(n-r)<=8*Number.EPSILON*Math.max(1,Math.abs(n))?r:n;};
  const bound=(q,i)=>snap(2*(mapping[i]+q*mapping[3]-plan.min[i])/plan.flowPitch);
  // Clip to the receiver lattice before storing exact small integers as f32.
  const clip=(n,i)=>Math.max(0,Math.min(2*plan.flowDims[i]+1,n));
  return {lo:[-1,-1,-1].map((q,i)=>clip(Math.ceil(bound(q,i)),i)),
    hi:[1,2*fineDims[1]/fineDims[0]-1,1].map((q,i)=>Math.max(-1,Math.min(2*plan.flowDims[i],Math.floor(bound(q,i)))))};
}
// A dense padded velocity envelope, not a sparse shell. All gas is borrowed
// from the existing world material field. Coordinates use the world anchor.
export function intermediateFlowPlan(world,fineDims,padding=4) {
  if(fineDims.length!==3||fineDims.some(n=>!Number.isInteger(n)||n<2)||fineDims[0]!==fineDims[2]||!Number.isInteger(padding)||padding<2)throw Error('Invalid intermediate flow dimensions');
  const pitch=4/fineDims[0],dims=fineDims.map(n=>Math.ceil(n/2)+2*padding);
  const min=[-1-padding*pitch,-1-padding*pitch,-1-padding*pitch];
  const max=dims.map((n,i)=>min[i]+n*pitch);
  if(min.some((n,i)=>n<world.min[i])||max.some((n,i)=>n>world.max[i]))throw Error('Intermediate flow exceeds world bounds');
  return {...world,flowDims:dims,flowCells:dims.reduce((a,b)=>a*b,1),flowPitch:pitch,pressureDims:[...dims],pressureCells:dims.reduce((a,b)=>a*b,1),pressurePitch:pitch,min,max,materialMin:[...world.min],extraMaterialCells:0};
}
export function intermediateFlowWeight(p,plan) {
  const d=Math.min(...p.flatMap((v,i)=>[v-plan.min[i],plan.max[i]-v]));
  const t=Math.max(0,Math.min(1,d/(2*plan.flowPitch)));
  return t*t*(3-2*t);
}
// Independent field counts over fixed physical coverage. The vertical padding
// equals the horizontal padding; the fine outlet remains inside the envelope.
export function intermediateSmokePlan(world,{flow=24,material=48,pressure=flow,extent=1.5,fineHeightRatio=2}={}) {
  const height=(fineHeightRatio+extent-1)/extent;
  if(!Number.isFinite(extent)||extent<=1||!Number.isFinite(fineHeightRatio)||fineHeightRatio<=0)throw Error('Invalid intermediate coverage');
  const min=[-extent,-extent,-extent],max=[extent,2*fineHeightRatio-2+extent,extent];
  if(min.some((v,i)=>v<world.min[i])||max.some((v,i)=>v>world.max[i]))throw Error('Intermediate field exceeds world bounds');
  for(const n of [flow,material,pressure])if(!Number.isInteger(n)||n<2||Math.abs(n*height-Math.round(n*height))>1e-8)throw Error('Intermediate dimensions must tile the requested coverage with cubic cells');

  const dims=n=>[n,Math.round(n*height),n],cells=n=>n*n*Math.round(n*height);
  return {flowDims:dims(flow),materialDims:dims(material),pressureDims:dims(pressure),
    flowCells:cells(flow),materialCells:cells(material),pressureCells:cells(pressure),
    flowPitch:2*extent/flow,materialPitch:2*extent/material,pressurePitch:2*extent/pressure,
    min,max,extraMaterialCells:cells(material),fineFeedback:false};
}
// Reference geometry for the optional momentum collar. Material is not copied
// into the collar: it must actually advect out of the donor.
export function worldTransitionSample(p,{fineDims,mapping,flowPitch,cells}){
 const margin=2/fineDims[0],lo=[-1+margin,-1+margin,-1+margin],hi=[1-margin,2*fineDims[1]/fineDims[0]-1-margin,1-margin];
 const q=p.map((v,i)=>(v-mapping[i])/mapping[3]),sample=q.map((v,i)=>Math.min(hi[i],Math.max(lo[i],v)));
 const delta=q.map((v,i)=>v-sample[i]),distance=Math.hypot(...delta)*mapping[3];
 const t=cells>0?Math.min(1,distance/(cells*flowPitch)):1;
 return {sample:sample.map((v,i)=>v*mapping[3]+mapping[i]),normal:delta.map(v=>distance>0?v*mapping[3]/distance:0),weight:distance>0?1-t*t*(3-2*t):0};
}

// The caller supplies the already-resolved gust for this simulation step.
// Fine authored acceleration is in material-cell units; outer flow is in
// anchor-local distance units. The material and height coupling stay in WGSL.
export function worldWindAcceleration({strength=0,angle=0,height=0,speed=1,fineWidth,scale=1}){
 const gain=strength*(.020+speed*.004)*2/fineWidth*scale;
 return [Math.cos(angle)*gain,0,Math.sin(angle)*gain,height];
}

export const WORLD_SMOKE_WGSL=/* wgsl */`
struct Params {
 flow:vec4<f32>, material:vec4<f32>, near:vec4<f32>, mapping:vec4<f32>,
 lo:vec4<f32>, time:vec4<f32>,
 reactant_combustion_a:vec4<f32>, reactant_combustion_b:vec4<f32>,
 reactant_combustion_c:vec4<f32>, reactant_combustion_d:vec4<f32>, emissive_physics:vec4<f32>,
 materialLo:vec4<f32>, bridgeLo:vec4<f32>, bridgeDims:vec4<f32>,
 pressureGrid:vec4<f32>, pressureControl:vec4<f32>, bridgeMaterial:vec4<f32>, wind:vec4<f32>,
 momentumLo:vec4<f32>, momentumHi:vec4<f32>
}
struct Gas { a:vec4<f32>, b:vec4<f32> } // soot,heat,fuel,oxygen; fresh burn, soot-weighted heat moments 1..3
@group(0) @binding(0) var<uniform> u:Params;
@group(0) @binding(1) var<storage,read> fine:array<vec4<f32>>;
@group(0) @binding(2) var<storage,read> vin:array<vec4<f32>>;
@group(0) @binding(3) var<storage,read_write> vout:array<vec4<f32>>;
@group(0) @binding(4) var<storage,read> gin:array<Gas>;
@group(0) @binding(5) var<storage,read_write> gout:array<Gas>;
@group(0) @binding(6) var<storage,read> pin:array<f32>;
@group(0) @binding(7) var<storage,read_write> pout:array<f32>;
@group(0) @binding(8) var fineReaction:texture_3d<f32>;
@group(0) @binding(9) var solids:texture_3d<u32>;
@group(0) @binding(10) var optical:texture_storage_3d<rgba32float,write>;
@group(0) @binding(11) var bridge:texture_3d<f32>;
@group(0) @binding(12) var exportedFlow:texture_storage_3d<rgba32float,write>;
@group(0) @binding(13) var<storage,read_write> pressureRhs:array<vec2<f32>>;
@group(0) @binding(14) var bridgeGas:texture_3d<f32>;
@group(0) @binding(15) var bridgeOptical:texture_3d<f32>;
@group(0) @binding(16) var exportedGas:texture_storage_3d<rgba32float,write>;
${REACTANT_COMBUSTION_WGSL}
${SOOT_BURNOUT_WGSL}
${THERMAL_MOMENTS_WGSL}
${TRANSFER_GEOMETRY_WGSL}
fn idx(c:vec3<i32>,d:vec3<f32>)->u32{return u32(c.x)+u32(d.x)*(u32(c.y)+u32(d.y)*u32(c.z));}
fn inside(c:vec3<i32>,d:vec3<f32>)->bool{return all(c>=vec3<i32>(0))&&all(c<vec3<i32>(d));}
fn blocked(c:vec3<i32>)->bool{if(u.time.w<.5){return false;}return inside(c,u.flow.xyz)&&textureLoad(solids,c,0).x!=0u;}
fn finePoint(p:vec3<f32>)->vec3<f32>{return (p-u.mapping.xyz)/u.mapping.w;}
fn donor(p:vec3<f32>)->bool{let q=finePoint(p);let margin=2.0/u.near.x;return all(q>=vec3<f32>(-1.0+margin))&&all(q<=vec3<f32>(1.0-margin,2.0*u.near.y/u.near.x-1.0-margin,1.0-margin));}
fn momentumDonor(c:vec3<i32>,a:u32)->bool{
 let face=2*c+vec3<i32>(1)+axis(a);
 return all(face>=vec3<i32>(u.momentumLo.xyz))&&all(face<=vec3<i32>(u.momentumHi.xyz));
}
// u.lo.w is the collar width in coarse flow cells. Only outward donor momentum
// is continued; no radial force is invented. The usual whole-world pressure
// projection follows, so this is not an independent shell pressure solve.
fn collarVelocity(p:vec3<f32>,advected:f32,a:u32)->f32{
 if(u.lo.w<=0.0){return advected;}
 let margin=2.0/u.near.x;
 let q=finePoint(p);let edge=clamp(q,vec3<f32>(-1.0+margin),vec3<f32>(1.0-margin,2.0*u.near.y/u.near.x-1.0-margin,1.0-margin));
 let delta=q-edge;let distance=length(delta)*u.mapping.w;
 let width=u.lo.w*u.flow.w;if(distance<=0.0||distance>=width){return advected;}
 let sample=edge*u.mapping.w+u.mapping.xyz;
 // Do not extend momentum through an intervening coarse obstacle.
 if(length(clipped(p,sample)-sample)>1e-5){return advected;}
 var source=vec3<f32>(0);
 for(var k=0u;k<3u;k++){var offset=vec3<f32>(.5);if(u.near.w>.5){offset[k]=1.0;}source[k]=fineSlot(sample,0u,offset)[k]*2.0/u.near.x*u.mapping.w;}
 if(dot(source,delta)<=0.0){return advected;}
 let weight=1.0-smoothstep(0.0,width,distance);
 let relaxation=1.0-pow(1.0-weight,max(u.time.x,0.0));
 return mix(advected,source[a],relaxation);
}
fn fineSlot(p:vec3<f32>,slot:u32,offset:vec3<f32>)->vec4<f32>{
 let q=(finePoint(p)+vec3<f32>(1))*u.near.x*.5-offset;let base=vec3<i32>(floor(q));let f=fract(q);var value=vec4<f32>(0);
 for(var z=0;z<2;z++){for(var y=0;y<2;y++){for(var x=0;x<2;x++){
 let c=clamp(base+vec3<i32>(x,y,z),vec3<i32>(0),vec3<i32>(u.near.xyz)-1);let w=select(1.0-f,f,vec3<bool>(x==1,y==1,z==1));value+=fine[4u*idx(c,u.near.xyz)+slot]*w.x*w.y*w.z;
 }}}return value;
}
fn fineBurn(p:vec3<f32>)->vec2<f32>{
 let d=vec3<i32>(textureDimensions(fineReaction));let q=(finePoint(p)+vec3<f32>(1))*u.near.x*.5-.5;let base=vec3<i32>(floor(q));let f=fract(q);var value=vec2<f32>(0);
 for(var z=0;z<2;z++){for(var y=0;y<2;y++){for(var x=0;x<2;x++){
 let c=clamp(base+vec3<i32>(x,y,z),vec3<i32>(0),d-1);let w=select(1.0-f,f,vec3<bool>(x==1,y==1,z==1));value+=textureLoad(fineReaction,c,0).xy*w.x*w.y*w.z;
 }}}return value;
}
// Integrate each donor cell's actual Fine samples before classifying heat.
// Cell-overlap weights handle unequal/non-integral material pitches without
// point sampling away hot pockets. This remains an interior overwrite.
fn fineGas(p:vec3<f32>)->Gas{
 let center=(finePoint(p)+vec3<f32>(1))*u.near.x*.5;
 let radius=.5*u.material.w/u.mapping.w*u.near.x*.5;
 let lo=max(vec3<f32>(0),center-vec3<f32>(radius));
 let hi=min(u.near.xyz,center+vec3<f32>(radius));
 var a=vec4<f32>(0);var b=vec4<f32>(0);var total=0.0;
 for(var z=i32(floor(lo.z));z<i32(ceil(hi.z));z++){
 for(var y=i32(floor(lo.y));y<i32(ceil(hi.y));y++){
 for(var x=i32(floor(lo.x));x<i32(ceil(hi.x));x++){
  let c=vec3<i32>(x,y,z);let f=vec3<f32>(c);
  let overlap=max(vec3<f32>(0),min(f+1.0,hi)-max(f,lo));let w=overlap.x*overlap.y*overlap.z;
  let m=max(fine[4u*idx(c,u.near.xyz)+1u].xyz,vec3<f32>(0));
  let chemical=textureLoad(fineReaction,c,0).xy;
  a+=vec4<f32>(m,chemical.x)*w;b+=vec4<f32>(chemical.y,thermalMoments(m.x,m.y))*w;total+=w;
 }}}
 return Gas(a/max(total,1e-12),b/max(total,1e-12));
}
fn axis(a:u32)->vec3<i32>{var v=vec3<i32>(0);v[a]=1;return v;}
fn face(c:vec3<i32>,a:u32)->f32{
 if(blocked(c)||blocked(c+axis(a))){return 0.0;}
 return vin[idx(clamp(c,vec3<i32>(0),vec3<i32>(u.flow.xyz)-1),u.flow.xyz)][a];
}
fn ownVelocity(p:vec3<f32>)->vec3<f32>{
 var result=vec3<f32>(0);
 for(var a=0u;a<3u;a++){
 var offset=vec3<f32>(.5);offset[a]=1.0;let q=(p-u.lo.xyz)/u.flow.w-offset;let base=vec3<i32>(floor(q));let f=fract(q);
 for(var z=0;z<2;z++){for(var y=0;y<2;y++){for(var x=0;x<2;x++){
 let w=select(1.0-f,f,vec3<bool>(x==1,y==1,z==1));result[a]+=face(base+vec3<i32>(x,y,z),a)*w.x*w.y*w.z;
 }}}
 }return result;
}
fn velocity(p:vec3<f32>)->vec3<f32>{
 let own=ownVelocity(p);
 if(u.bridgeDims.w<=0.0){return own;}
 let hi=u.bridgeLo.xyz+u.bridgeDims.xyz*u.bridgeLo.w;
 let edge=min(p-u.bridgeLo.xyz,hi-p);
 let weight=smoothstep(0.0,2.0*u.bridgeLo.w,min(edge.x,min(edge.y,edge.z)));
 if(weight<=0.0){return own;}
 var value=vec3<f32>(0);
 for(var a=0u;a<3u;a++){
   var offset=vec3<f32>(.5);offset[a]=1.0;
   let q=(p-u.bridgeLo.xyz)/u.bridgeLo.w-offset;let base=vec3<i32>(floor(q));let f=fract(q);
   for(var z=0;z<2;z++){for(var y=0;y<2;y++){for(var x=0;x<2;x++){
     let c=clamp(base+vec3<i32>(x,y,z),vec3<i32>(0),vec3<i32>(u.bridgeDims.xyz)-1);
     let w=select(1.0-f,f,vec3<bool>(x==1,y==1,z==1));
     value[a]+=textureLoad(bridge,c,0)[a]*w.x*w.y*w.z;
   }}}
 }
 return mix(own,value,weight);
}
fn gasCell(c:vec3<i32>)->Gas{
 if(!inside(c,u.material.xyz)){return Gas(vec4<f32>(0,0,0,u.reactant_combustion_c.z),vec4<f32>(0));}
 let p=u.materialLo.xyz+(vec3<f32>(c)+.5)*u.material.w;
 if(blocked(vec3<i32>(floor((p-u.lo.xyz)/u.flow.w)))){return Gas(vec4<f32>(0),vec4<f32>(0));}
 return gin[idx(c,u.material.xyz)];
}
fn gas(p:vec3<f32>)->Gas{
 let q=(p-u.materialLo.xyz)/u.material.w-.5;let base=vec3<i32>(floor(q));let f=fract(q);var a=vec4<f32>(0);var b=vec4<f32>(0);
 for(var z=0;z<2;z++){for(var y=0;y<2;y++){for(var x=0;x<2;x++){
 let w=select(1.0-f,f,vec3<bool>(x==1,y==1,z==1));let v=gasCell(base+vec3<i32>(x,y,z));a+=v.a*w.x*w.y*w.z;b+=v.b*w.x*w.y*w.z;
 }}}return Gas(a,b);
}
fn bridgeWeight(p:vec3<f32>)->f32{
 if(u.bridgeDims.w<=0.0){return 0.0;}
 let edge=min(p-u.bridgeLo.xyz,u.bridgeLo.xyz+u.bridgeDims.xyz*u.bridgeLo.w-p);
 return smoothstep(0.0,2.0*max(u.bridgeLo.w,u.bridgeMaterial.w),min(edge.x,min(edge.y,edge.z)));
}
fn bridgeMaterialSample(p:vec3<f32>)->Gas{
 let q=(p-u.bridgeLo.xyz)/u.bridgeMaterial.w-.5;
 let base=vec3<i32>(floor(q));let f=fract(q);var a=vec4<f32>(0);var b=vec4<f32>(0);
 for(var z=0;z<2;z++){for(var y=0;y<2;y++){for(var x=0;x<2;x++){
   let c=clamp(base+vec3<i32>(x,y,z),vec3<i32>(0),vec3<i32>(u.bridgeMaterial.xyz)-1);
   let w=select(1.0-f,f,vec3<bool>(x==1,y==1,z==1));let weight=w.x*w.y*w.z;
   a+=textureLoad(bridgeGas,c,0)*weight;
   b+=vec4<f32>(textureLoad(bridgeOptical,c,0).w,textureLoad(bridgeOptical,c+vec3<i32>(0,0,i32(u.bridgeMaterial.z)),0).xyz)*weight;
 }}}
 return Gas(a,b);
}
// Voxel traversal stops characteristics at coarse solid boundaries, rather than
// allowing a long backtrace to tunnel through an obstacle.
fn clipped(p:vec3<f32>,q:vec3<f32>)->vec3<f32>{
 if(u.time.w<.5){return q;}
 let a=(p-u.lo.xyz)/u.flow.w;let b=(q-u.lo.xyz)/u.flow.w;let delta=b-a;let direction=sign(delta);var c=vec3<i32>(floor(a));
 let inv=1.0/max(abs(delta),vec3<f32>(1e-12));var tmax=select(a-floor(a),floor(a)+1.0-a,delta>vec3<f32>(0))*inv;
 loop{var k=0u;if(tmax.y<tmax[k]){k=1u;}if(tmax.z<tmax[k]){k=2u;}let t=tmax[k];if(t>=1.0){break;}c[k]+=i32(direction[k]);if(blocked(c)){return mix(p,q,max(0.0,t-1e-5));}tmax[k]+=inv[k];}
 return q;
}
@compute @workgroup_size(4,4,4) fn transportFlow(@builtin(global_invocation_id) gid:vec3<u32>){
 let c=vec3<i32>(gid);if(!inside(c,u.flow.xyz)){return;}let center=u.lo.xyz+(vec3<f32>(c)+.5)*u.flow.w;var v=vec3<f32>(0);
 for(var a=0u;a<3u;a++){
 let p=center+vec3<f32>(axis(a))*.5*u.flow.w;let back=clipped(p,p-velocity(p)*u.time.y);v[a]=velocity(back)[a];
 let material=gas(p).a;
 if(a==1u){v[a]+=material.y*u.time.z*u.time.x;}
 let coupling=clamp(material.x*.54+material.y*.30,0.0,1.6);
 let height=smoothstep(u.wind.w-.32,u.wind.w+.52,finePoint(p).y);
 v[a]+=u.wind[a]*coupling*height*u.time.x;
 if(momentumDonor(c,a)){var o=vec3<f32>(.5);if(u.near.w>.5){o[a]=1;}v[a]=fineSlot(p,0u,o)[a]*2.0/u.near.x*u.mapping.w;}
 else{v[a]=collarVelocity(p,v[a],a);}
 if(blocked(c)||blocked(c+axis(a))){v[a]=0;}
 }vout[idx(c,u.flow.xyz)]=vec4<f32>(v,0);
}
fn divergence(c:vec3<i32>)->f32{var d=0.0;for(var a=0u;a<3u;a++){d+=face(c,a)-face(c-axis(a),a);}return d/u.flow.w;}
// Volume restriction telescopes to the area-averaged boundary flux. The
// pressure solve has its own lattice; fine velocity is never downsampled away.
@compute @workgroup_size(4,4,4) fn restrictPressure(@builtin(global_invocation_id) gid:vec3<u32>){
 let c=vec3<i32>(gid);if(!inside(c,u.pressureGrid.xyz)){return;}
 let ratio=u.pressureControl.y;var rhs=0.0;var solid=0.0;
 if(ratio==floor(ratio)){
  let r=i32(ratio);
  for(var z=0;z<r;z++){for(var y=0;y<r;y++){for(var x=0;x<r;x++){
   let q=c*r+vec3<i32>(x,y,z);if(blocked(q)){solid=1.0;}else{rhs+=divergence(q);}
  }}}rhs/=ratio*ratio*ratio;
 }else{
  let src=vec3<u32>(u.flow.xyz);let dst=vec3<u32>(u.pressureGrid.xyz);let lo=transferLo(gid,src,dst);let hi=transferHi(gid,src,dst);let begin=transferBegin(gid,src,dst);let end=transferEnd(gid,src,dst);
  for(var z=begin.z;z<end.z;z++){for(var y=begin.y;y<end.y;y++){for(var x=begin.x;x<end.x;x++){
   let q=vec3<i32>(x,y,z);let o=transferOverlap(q,lo,hi);let w=o.x*o.y*o.z/(ratio*ratio*ratio);if(w<=0.0){continue;}
   if(blocked(q)){solid=1.0;}else{rhs+=divergence(q)*w;}
  }}}
 }
 pressureRhs[idx(c,u.pressureGrid.xyz)]=vec2<f32>(rhs,solid);
}
fn pressureBlocked(c:vec3<i32>)->bool{
 if(!inside(c,u.pressureGrid.xyz)){return false;}
 return pressureRhs[idx(c,u.pressureGrid.xyz)].y>.5;
}
fn pressureAt(c:vec3<i32>)->f32{
 if(!inside(c,u.pressureGrid.xyz)||pressureBlocked(c)){return 0.0;}
 return pin[idx(c,u.pressureGrid.xyz)];
}
fn pressureGradient(c:vec3<i32>,a:u32)->f32{
 if(pressureBlocked(c)||pressureBlocked(c+axis(a))){return 0.0;}
 return (pressureAt(c+axis(a))-pressureAt(c))/u.pressureGrid.w;
}
fn finePressureGradient(c:vec3<i32>,a:u32)->f32{
 if(u.pressureControl.x<=0.0){return 0.0;}
 if(u.pressureControl.y==1.0){return pressureGradient(c,a);}
 var offset=vec3<f32>(.5);offset[a]=1.0;
 let q=(vec3<f32>(c)+offset)/u.pressureControl.y-offset;
 let base=vec3<i32>(floor(q));let f=fract(q);var result=0.0;
 for(var z=0;z<2;z++){for(var y=0;y<2;y++){for(var x=0;x<2;x++){
   // Tangential extension is constant; the normal lower face is at -1.
   var lower=vec3<i32>(0);lower[a]=-1;
   let n=clamp(base+vec3<i32>(x,y,z),lower,vec3<i32>(u.pressureGrid.xyz)-1);
   let w=select(1.0-f,f,vec3<bool>(x==1,y==1,z==1));
   result+=pressureGradient(n,a)*w.x*w.y*w.z;
 }}}
 return result;
}
@compute @workgroup_size(4,4,4) fn pressure(@builtin(global_invocation_id) gid:vec3<u32>){
 let c=vec3<i32>(gid);if(!inside(c,u.pressureGrid.xyz)){return;}let i=idx(c,u.pressureGrid.xyz);if(pressureBlocked(c)){pout[i]=0;return;}
 var sum=0.0;var count=0.0;
 for(var a=0u;a<3u;a++){for(var s=-1;s<=1;s+=2){let n=c+axis(a)*s;if(pressureBlocked(n)){continue;}count+=1;sum+=pressureAt(n);}}
 pout[i]=(sum-pressureRhs[i].x*u.pressureGrid.w*u.pressureGrid.w)/max(count,1.0);
}
@compute @workgroup_size(4,4,4) fn project(@builtin(global_invocation_id) gid:vec3<u32>){
 let c=vec3<i32>(gid);if(!inside(c,u.flow.xyz)){return;}let i=idx(c,u.flow.xyz);var v=vin[i].xyz;
 for(var a=0u;a<3u;a++){let n=c+axis(a);v[a]-=finePressureGradient(c,a);if(blocked(c)||blocked(n)){v[a]=0;}}
 vout[i]=vec4<f32>(v,0);
 if(u.materialLo.w>.5){textureStore(exportedFlow,c,vec4<f32>(v,0));}
}
fn storeMaterial(c:vec3<i32>,i:u32,p:vec3<f32>,value:Gas){
 var r=value;
 if(u.bridgeMaterial.w>0.0){
   let weight=bridgeWeight(p);
   if(weight>0.0){let upstream=bridgeMaterialSample(p);r=Gas(mix(r.a,upstream.a,weight),mix(r.b,upstream.b,weight));}
 }
 if(blocked(vec3<i32>(floor((p-u.lo.xyz)/u.flow.w)))){r=Gas(vec4<f32>(0),vec4<f32>(0));}
 gout[i]=r;textureStore(optical,c,vec4<f32>(r.a.xyz,r.b.x));
 textureStore(optical,c+vec3<i32>(0,0,i32(u.material.z)),vec4<f32>(r.b.yzw,0));
 if(u.pressureControl.z>.5){textureStore(exportedGas,c,r.a);}
}
@compute @workgroup_size(4,4,4) fn transportMaterial(@builtin(global_invocation_id) gid:vec3<u32>){
 let c=vec3<i32>(gid);if(!inside(c,u.material.xyz)){return;}let i=idx(c,u.material.xyz);let p=u.lo.xyz+(vec3<f32>(c)+.5)*u.material.w;
 if(donor(p)){
   let r=fineGas(p);
   storeMaterial(c,i,p,r);return;
 }
 var r=gas(clipped(p,p-velocity(p)*u.time.y));
 if(reactantLawOn()){
   let dt=u.time.x;let w=reactantExchangeWeightFor(dt);var neighbors=vec4<f32>(0);var momentNeighbors=vec3<f32>(0);
   for(var a=0u;a<3u;a++){
     let off=vec3<f32>(axis(a))*u.material.w;
     let plus=gas(clipped(p,p+off));let minus=gas(clipped(p,p-off));
     neighbors+=plus.a+minus.a;momentNeighbors+=plus.b.yzw+minus.b.yzw;
   }
   r.a=max(vec4<f32>(0),r.a*(1.0-6.0*w)+neighbors*w);
   r.b=vec4<f32>(r.b.x,max(vec3<f32>(0),r.b.yzw*(1.0-6.0*w)+momentNeighbors*w));
   let burned=reactantBurn(r.a.z,r.a.w,r.a.y,dt);
   let cooling=reactantCoolingSurvival(dt);let sootSurvival=reactantSootSurvival(dt);
   let moments=(shiftThermalMoments(r.b.yzw,r.a.x,burned.z-r.a.y,cooling)
     +thermalMoments(burned.w*u.reactant_combustion_b.z,burned.z*cooling))*sootSurvival;
   r.b=vec4<f32>(r.b.x,moments);r.a=vec4<f32>((r.a.x+burned.w*u.reactant_combustion_b.z)*reactantSootSurvival(dt),burned.z*reactantCoolingSurvival(dt),burned.x,burned.y);
   let burnout=sootBurnoutSurvival(r.a.y,r.a.w,dt);r.a.x*=burnout;r.b=vec4<f32>(r.b.x,r.b.yzw*burnout);r.b.x=burned.w/max(dt,1e-6);
 }else{let cooling=pow(.982,u.time.x);let survival=pow(.990,u.time.x);r.b=vec4<f32>(0,shiftThermalMoments(r.b.yzw,r.a.x,0,cooling)*survival);r.a.x*=survival;r.a.y*=cooling;}
 storeMaterial(c,i,p,r);
}
`;

export function createWorldSmoke(device,plan,anchor,{solidTexture,borrowMaterial=null,exportFields=false}={}){
  const flowOnly=!!borrowMaterial;
  const b=(label,size)=>device.createBuffer({label,size,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC});
  for(const [dims,bytes] of [[plan.flowDims,plan.flowCells*16],[plan.materialDims,plan.materialCells*32],[plan.pressureDims,plan.pressureCells*8]]){
    if(dims.some(n=>n>device.limits.maxTextureDimension3D)||bytes>device.limits.maxStorageBufferBindingSize||bytes>device.limits.maxBufferSize)throw Error('World smoke dimensions exceed device limits');
  }
  const flows=[0,1].map(i=>b('world smoke flow '+i,plan.flowCells*16)),materials=borrowMaterial?.buffers??[0,1].map(i=>b('world smoke material '+i,plan.materialCells*32)),pressures=[0,1].map(i=>b('world smoke pressure '+i,plan.pressureCells*4));
  const pressureRhs=b('world smoke pressure rhs and occupancy',plan.pressureCells*8);
  if(!flowOnly){const initial=new Float32Array(plan.materialCells*8);for(let i=3;i<initial.length;i+=8)initial[i]=1;for(const m of materials)device.queue.writeBuffer(m,0,initial);}
  const opticalDims=plan.materialDims.map((n,i)=>i===2?n*2:n);
  if(!flowOnly&&opticalDims.some(n=>n>device.limits.maxTextureDimension3D))throw Error('World optical moment atlas exceeds device texture limits');
  const optical=borrowMaterial?.optical??device.createTexture({label:'world smoke optical state and thermal moments',size:opticalDims,dimension:'3d',format:'rgba32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.COPY_SRC});
  const flowTexture=device.createTexture({label:flowOnly?'intermediate velocity':'disabled velocity export',size:(flowOnly||exportFields)?plan.flowDims:[1,1,1],dimension:'3d',format:'rgba32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.COPY_SRC});
  const gasTexture=device.createTexture({label:'world smoke gas export',size:exportFields?plan.materialDims:[1,1,1],dimension:'3d',format:'rgba32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.STORAGE_BINDING});
  const bridgeFallback=device.createTexture({label:'disabled intermediate velocity',size:[1,1,1],dimension:'3d',format:'rgba32float',usage:GPUTextureUsage.TEXTURE_BINDING});
  const fallback=solidTexture?null:device.createTexture({label:'world smoke empty solids',size:plan.flowDims,dimension:'3d',format:'r32uint',usage:GPUTextureUsage.TEXTURE_BINDING});
  const uniform=device.createBuffer({label:'world smoke uniforms',size:320,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
  const module=device.createShaderModule({label:'world smoke separate flow and material',code:WORLD_SMOKE_WGSL});
  const layout=device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:'uniform'}},...[1,2,3,4,5,6,7,13].map(binding=>({binding,visibility:GPUShaderStage.COMPUTE,buffer:{type:[3,5,7,13].includes(binding)?'storage':'read-only-storage'}})),{binding:8,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:'unfilterable-float',viewDimension:'3d'}},{binding:9,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:'uint',viewDimension:'3d'}},...[10,12,16].map(binding=>({binding,visibility:GPUShaderStage.COMPUTE,storageTexture:{access:'write-only',format:'rgba32float',viewDimension:'3d'}})),...[11,14,15].map(binding=>({binding,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:'unfilterable-float',viewDimension:'3d'}}))]});
  const pipelineLayout=device.createPipelineLayout({bindGroupLayouts:[layout]});
  const pipelines=Object.fromEntries(['transportFlow','restrictPressure','pressure','project','transportMaterial'].map(entryPoint=>[entryPoint,device.createComputePipeline({label:'world smoke '+entryPoint,layout:pipelineLayout,compute:{module,entryPoint}})]));
  let v=0,m=0,p=0,steps=0;const groups=new Map();let lastFine,lastReaction,lastSolid,lastBridge,lastBridgeGas,lastBridgeOptical;
  const values=new Float32Array(80);
  return {optical,flowTexture,gasTexture,exportFields,plan,anchor,
    materialResources(){return {buffers:materials,optical,index:m};},
    encode(encoder,{fineBuffer,reactionTexture,fineDims,fineVelocityMode='collocated',transform,time,reactant,physics,iterations=16,buoyancy=.002,transitionCells=0,solids=solidTexture??fallback,collisionSource=null,timing=null,intermediate=null,materialIndex=0,wind={}}){
      if(flowOnly)m=materialIndex;
      if(!Number.isInteger(iterations)||iterations<0)throw Error('Invalid world pressure iterations');
      if(!Number.isFinite(transitionCells)||transitionCells<0)throw Error('Invalid world transition collar');
      if(!['collocated','staggered'].includes(fineVelocityMode))throw Error('Unknown fine velocity convention');
      const mapping=worldSmokeMapping(plan,anchor,transform);
      values.set([...plan.flowDims,plan.flowPitch,...plan.materialDims,plan.materialPitch,...fineDims,fineVelocityMode==='staggered'?1:0,...mapping.fineToField,...plan.min,transitionCells,time.dtScale,time.backtraceScale,buoyancy,solids===fallback?0:1]);
      values.set(reactantCombustionUniformValues(reactant),24);
      // Diffusivity is in fine-local length units; scale to the anchored field.
      if(reactant?.effective?.admitted)values[27]=reactant.effective.model.exchangeDiffusivity*mapping.fineToField[3]**2/plan.materialPitch**2;
      if(physics)values.set(physicsAppearanceUniformValues(physics),40);
      values.set([...(plan.materialMin??plan.min),(flowOnly||exportFields)?1:0],44);
      values.set(intermediate?[...intermediate.plan.min,intermediate.plan.flowPitch,...intermediate.plan.flowDims,1]:[0,0,0,1,1,1,1,0],48);
      values.set([...plan.pressureDims,plan.pressurePitch,iterations,plan.flowDims[0]/plan.pressureDims[0],exportFields?1:0,0],56);
      values.set(intermediate?.exportFields?[...intermediate.plan.materialDims,intermediate.plan.materialPitch]:[1,1,1,0],64);
      values.set(worldWindAcceleration({...wind,fineWidth:fineDims[0],scale:mapping.fineToField[3]}),68);
      const momentum=momentumBounds(plan,mapping.fineToField,fineDims);
      values.set([...momentum.lo,0,...momentum.hi,0],72);
      device.queue.writeBuffer(uniform,0,values);
      const bridge=intermediate?.flowTexture??bridgeFallback;
      const bridgeGas=intermediate?.exportFields?intermediate.gasTexture:bridgeFallback,bridgeOptical=intermediate?.exportFields?intermediate.optical:bridgeFallback;
      if(lastFine!==fineBuffer||lastReaction!==reactionTexture||lastSolid!==solids||lastBridge!==bridge||lastBridgeGas!==bridgeGas||lastBridgeOptical!==bridgeOptical){groups.clear();lastFine=fineBuffer;lastReaction=reactionTexture;lastSolid=solids;lastBridge=bridge;lastBridgeGas=bridgeGas;lastBridgeOptical=bridgeOptical;}
      const group=()=>{const key=`${v}:${m}:${p}`;if(!groups.has(key))groups.set(key,device.createBindGroup({layout,entries:[{binding:0,resource:{buffer:uniform}},...[fineBuffer,flows[v],flows[1-v],materials[m],materials[1-m],pressures[p],pressures[1-p]].map((buffer,i)=>({binding:i+1,resource:{buffer}})),{binding:8,resource:reactionTexture.createView()},{binding:9,resource:solids.createView()},{binding:10,resource:optical.createView()},{binding:11,resource:bridge.createView()},{binding:12,resource:flowTexture.createView()},{binding:13,resource:{buffer:pressureRhs}},{binding:14,resource:bridgeGas.createView()},{binding:15,resource:bridgeOptical.createView()},{binding:16,resource:gasTexture.createView()}]}));return groups.get(key);};
      const run=(name,dims)=>{const timestampWrites=timing?{querySet:timing.querySet,...(name==='transportFlow'?{beginningOfPassWriteIndex:timing.flowStart}:name==='project'?{endOfPassWriteIndex:timing.flowEnd}:name==='transportMaterial'?{beginningOfPassWriteIndex:timing.materialStart,endOfPassWriteIndex:timing.materialEnd}:{})}:null;const pass=encoder.beginComputePass({label:'world smoke '+name,...(timestampWrites&&['transportFlow','project','transportMaterial'].includes(name)?{timestampWrites}:{})});pass.setPipeline(pipelines[name]);pass.setBindGroup(0,group());pass.dispatchWorkgroups(...dims.map(n=>Math.ceil(n/4)));pass.end();};
      run('transportFlow',plan.flowDims);v=1-v;
      if(iterations>0)run('restrictPressure',plan.pressureDims);
      for(let i=0;i<iterations;i++){run('pressure',plan.pressureDims);p=1-p;}
      run('project',plan.flowDims);v=1-v;
      if(!flowOnly){run('transportMaterial',plan.materialDims);m=1-m;}steps++;
      return {identity:'world-smoke-one-way-v0',steps,flowDims:plan.flowDims,materialDims:plan.materialDims,pressureDims:plan.pressureDims,pressurePitch:plan.pressurePitch,pressureCells:plan.pressureCells,anchor,pressureIterations:iterations,transitionCells,transitionLaw:transitionCells?'outward-momentum-collar-before-projection':'none',fineVelocityMode,momentumHandoff:'physical-component-faces',fineFeedback:false,materialLaw:reactant?.effective?.admitted?'reactant-v0':'passive-authored',windLaw:'resolved-gust-soot-heat-coupled',thermalRepresentation:'soot-heat-moments-two-node-v1',handoff:'volume-restricted-interior-overwrite-not-conservative-flux',collision:solids===fallback?'empty-fallback':'coarse-resident-mask',collisionSource:solids===fallback?null:collisionSource,collisionVerification:solids===fallback?'empty-by-construction':'submitted-unverified',worldAnchored:true};
    },
    destroy(){for(const x of [...flows,...(flowOnly?[]:materials),...pressures,pressureRhs,uniform,...(flowOnly?[]:[optical]),fallback,flowTexture,bridgeFallback,gasTexture])x?.destroy();groups.clear();}
  };
}
