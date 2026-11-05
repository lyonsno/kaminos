import {refinementAddressWGSL} from './refinement-wgsl.mjs';
import {slidingWGSL} from './sliding.mjs';

export function refinementArena(p) {
  const meta = 0;
  const neighbors = p.tiles.count * 8;
  const active = neighbors + p.tileNeighbors.length;
  const surface = active + p.tiles.count;
  const stats = surface + p.tiles.count;
  const prefix = stats + 16;
  const words = new Uint32Array(prefix + p.tiles.count + 1);
  for (const [tile, record] of p.tileRecords.entries()) {
    const c = record.coord ?? [0, 0, 0];
    words.set([record.region < 0 ? 0xffffffff : record.region, ...c, record.faceOffset,
      record.faceCapacity, record.neighborOffset ?? 0, record.neighbors.length], tile * 8);
  }
  words.set(p.tileNeighbors, neighbors);
  return {meta, neighbors, active, surface, stats, prefix, words};
}

export function refinementShader(p, arena, row = 65535) {
  const origin = `vec3<f32>(${p.origin.map(n => n.toFixed(12)).join(',')})`;
  return `${refinementAddressWGSL(p)}
${slidingWGSL}
const B:u32=${p.tiles.width}u;
const V:u32=${p.tiles.cellsPerTile}u;
const G:u32=${p.tiles.groupsPerTile}u;
const ROW:u32=${row}u;
const O=${origin};
const H:f32=${p.cellSize.toFixed(12)};
const ACTIVE:u32=${arena.active}u;
const SURFACE:u32=${arena.surface}u;
const STATS:u32=${arena.stats}u;
const PREFIX:u32=${arena.prefix}u;
const NEIGHBORS:u32=${arena.neighbors}u;
struct Params {contact:vec4<f32>,previous:vec4<f32>,sliding:vec4<f32>,clock:vec4<u32>}
@group(0) @binding(0) var<storage,read_write> mass:array<f32>;
@group(0) @binding(1) var<storage,read_write> nextMass:array<f32>;
@group(0) @binding(2) var<storage,read> solid:array<u32>;
@group(0) @binding(3) var<storage,read_write> limits:array<vec2<f32>>;
@group(0) @binding(4) var<storage,read_write> headers:array<atomic<u32>>;
@group(0) @binding(5) var<storage,read_write> arena:array<atomic<u32>>;
@group(0) @binding(6) var<storage,read_write> faces:array<u32>;
@group(0) @binding(7) var<uniform> params:Params;
fn word(i:u32)->u32 {return atomicLoad(&arena[i]);}
fn neighbor_count(tile:u32)->u32 {return word(tile*8u+7u);}
fn neighbor_at(tile:u32,n:u32)->u32 {return word(NEIGHBORS+word(tile*8u+6u)+n);}
fn mark_cell(i:u32) {
 let tile=ash_cell(i).tile;
 atomicStore(&headers[tile*8u],1u);
 for(var n=0u;n<neighbor_count(tile);n++) {atomicStore(&headers[neighbor_at(tile,n)*8u+2u],1u);}
}
fn pressure(c:AshCell)->f32 {
 if(params.contact.w<=0.0){return 0.0;}
 let point=O+(vec3<f32>(c.lower)+vec3<f32>(f32(c.size)*0.5))*H;
 let delta=params.contact.xyz-params.previous.xyz;
 let t=clamp(dot(point-params.previous.xyz,delta)/max(dot(delta,delta),1e-12),0.0,1.0);
 return max(0.0,params.contact.w-distance(point,params.previous.xyz+t*delta))/H;
}
// Positive means i -> j. Both endpoints evaluate exactly this same offer,
// including face area, before applying their shared capacity limit.
fn offer(i:u32,j:u32,axis:u32,area:f32)->f32 {
 let a=ash_cell(i);let b=ash_cell(j);
 let va=f32(a.size*a.size*a.size);let vb=f32(b.size*b.size*b.size);
 let ma=mass[i];let mb=mass[j];
 let pa=pressure(a);let pb=pressure(b);
 if(solid[i]!=0u||solid[j]!=0u||pa>0.0||pb>0.0){
  if(solid[i]==1u||solid[j]==1u){return 0.0;}
  if(solid[i]==2u&&solid[j]==2u){
   let amount=0.5*area*(ma/va-mb/vb);
   if(amount>=0.0){return min(amount,min(ma,vb-mb));}
   return -min(-amount,min(mb,va-ma));
  }
  if(solid[i]!=0u||pa>pb+1e-5){return min(ma*area/f32(a.size*a.size),(vb-mb)*area/f32(b.size*b.size));}
  if(solid[j]!=0u||pb>pa+1e-5){return -min(mb*area/f32(b.size*b.size),(va-ma)*area/f32(a.size*a.size));}
  return 0.0;
 }
 if(axis==1u){
  if(a.lower.y>b.lower.y){return min(ma*area/f32(a.size*a.size),(vb-mb)*area/f32(b.size*b.size));}
  return -min(mb*area/f32(b.size*b.size),(va-ma)*area/f32(a.size*a.size));
 }
 let midpoint=O+(vec3<f32>(a.lower+b.lower)+vec3<f32>(f32(a.size+b.size)*0.5))*H*0.5;
 let threshold=ash_sliding_threshold(midpoint,params.sliding.xy)*f32(a.size+b.size)*0.5;
 let headA=f32(a.lower.y)+ma/va*f32(a.size);
 let headB=f32(b.lower.y)+mb/vb*f32(b.size);
 let lower=f32(max(a.lower.y,b.lower.y));
 let difference=max(headA,lower)-max(headB,lower);
 if(abs(difference)<=threshold+1e-6){return 0.0;}
 let amount=0.5*area*(abs(difference)-threshold*(1.0-params.sliding.z));
 if(difference>0.0){return min(min(amount,ma),min(vb-mb,max(0.0,headA-lower)*f32(a.size*a.size)));}
 return -min(min(amount,mb),min(va-ma,max(0.0,headB-lower)*f32(b.size*b.size)));
}
fn exchange_sum(i:u32,apply:bool)->vec2<f32> {
 let c=ash_cell(i);var outgoing=0.0;var incoming=0.0;
 for(var face=0u;face<6u;face++) {
  let axis=face/2u;var q=c.lower;
  q[axis]+=select(-1,i32(c.size),face%2u==1u);
  let first=ash_locate(q);if(first==0xffffffffu){continue;}
  let neighbor=ash_cell(first);let finer=neighbor.size<c.size;
  let count=select(1u,c.size,finer);
  let tangent0=select(0u,1u,axis==0u);let tangent1=select(2u,1u,axis==2u);
  for(var v=0u;v<count;v++){for(var u=0u;u<count;u++){
   var point=q;point[tangent0]+=i32(u);point[tangent1]+=i32(v);
   let j=ash_locate(point);if(j==0xffffffffu){continue;}
   if(atomicLoad(&headers[ash_cell(j).tile*8u+1u])==0u){continue;}
   let side=min(c.size,ash_cell(j).size);let area=select(f32(side*side),1.0,finer);
   var amount=offer(i,j,axis,area);
   if(apply){
    if(amount>0.0){amount*=min(limits[i].x,limits[j].y);}else{amount*=min(limits[i].y,limits[j].x);}
   }
   outgoing+=max(amount,0.0);incoming+=max(-amount,0.0);
  }}
 }
 return vec2<f32>(outgoing,incoming);
}
fn active_cell(w:vec3<u32>,lane:u32)->u32 {
 let group=w.x+w.y*ROW;let rank=group/G;
 if(rank>=word(STATS)){return 0xffffffffu;}
 let local=(group%G)*64u+lane;if(local>=V){return 0xffffffffu;}
 return ash_tile_cell(word(ACTIVE+rank),local);
}
@compute @workgroup_size(1) fn reset(){
 for(var n=0u;n<16u;n++){atomicStore(&arena[STATS+n],0u);}
}
@compute @workgroup_size(64) fn admit(@builtin(global_invocation_id) id:vec3<u32>){
 let tile=id.x;if(tile>=ASH_TILE_COUNT||word(tile*8u)==0xffffffffu){return;}
 var awake=atomicLoad(&headers[tile*8u])!=0u;
 for(var n=0u;n<neighbor_count(tile)&&!awake;n++){awake=atomicLoad(&headers[neighbor_at(tile,n)*8u])!=0u;}
 if(params.clock.x!=0u&&params.contact.w>0.0){
  let first=ash_tile_cell(tile,0u);let c=ash_cell(first);
  let low=O+vec3<f32>(c.lower)*H;
  let high=low+vec3<f32>(f32(B*c.size)*H);
  let r=max(params.contact.w,params.previous.w)+4.0*H;
  if(all(low<=max(params.contact.xyz,params.previous.xyz)+vec3<f32>(r))&&all(high>=min(params.contact.xyz,params.previous.xyz)-vec3<f32>(r))){awake=true;}
 }
 atomicStore(&headers[tile*8u+1u],select(0u,1u,awake));
 if(awake){let rank=atomicAdd(&arena[STATS],1u);atomicStore(&arena[ACTIVE+rank],tile);}
}
@compute @workgroup_size(64) fn clear_wake(@builtin(global_invocation_id) id:vec3<u32>){
 if(id.x<ASH_TILE_COUNT){atomicStore(&headers[id.x*8u],0u);}
}
@compute @workgroup_size(1) fn pack_dispatch(){
 let activeGroups=word(STATS)*G;let surfaceGroups=word(STATS+1u)*G;
 atomicStore(&arena[STATS+8u],min(activeGroups,ROW));atomicStore(&arena[STATS+9u],max(1u,(activeGroups+ROW-1u)/ROW));atomicStore(&arena[STATS+10u],1u);
 atomicStore(&arena[STATS+12u],min(surfaceGroups,ROW));atomicStore(&arena[STATS+13u],max(1u,(surfaceGroups+ROW-1u)/ROW));atomicStore(&arena[STATS+14u],1u);
}
@compute @workgroup_size(64) fn limit_flux(@builtin(workgroup_id) w:vec3<u32>,@builtin(local_invocation_id) l:vec3<u32>){
 let i=active_cell(w,l.x);if(i==0xffffffffu||!ash_cell(i).owned){return;}
 let totals=exchange_sum(i,false);
 limits[i]=vec2<f32>(select(1.0,min(1.0,mass[i]/totals.x),totals.x>0.0),select(1.0,min(1.0,(ash_capacity(i)-mass[i])/totals.y),totals.y>0.0));
}
@compute @workgroup_size(64) fn gather_flux(@builtin(workgroup_id) w:vec3<u32>,@builtin(local_invocation_id) l:vec3<u32>){
 let i=active_cell(w,l.x);if(i==0xffffffffu||!ash_cell(i).owned){return;}
 let totals=exchange_sum(i,true);nextMass[i]=clamp(mass[i]-totals.x+totals.y,0.0,ash_capacity(i));
 if(nextMass[i]!=mass[i]){mark_cell(i);atomicAdd(&arena[STATS+2u],1u);}
 atomicAdd(&arena[STATS+3u],1u);
}
@compute @workgroup_size(64) fn commit_mass(@builtin(workgroup_id) w:vec3<u32>,@builtin(local_invocation_id) l:vec3<u32>){
 let i=active_cell(w,l.x);if(i!=0xffffffffu&&ash_cell(i).owned){mass[i]=nextMass[i];}
}
@compute @workgroup_size(64) fn admit_surface(@builtin(global_invocation_id) id:vec3<u32>){
 let tile=id.x;if(tile>=ASH_TILE_COUNT||word(tile*8u)==0xffffffffu){return;}
 if(atomicLoad(&headers[tile*8u+2u])!=0u){
  let rank=atomicAdd(&arena[STATS+1u],1u);atomicStore(&arena[SURFACE+rank],tile);atomicStore(&headers[tile*8u+3u],0u);
 }
}
fn face_band(i:u32,face:u32,sub:u32,shape:vec2<u32>)->vec2<f32> {
 let c=ash_cell(i);let size=f32(c.size);let fill=mass[i]/ash_capacity(i);let top=f32(c.lower.y)+fill*size;
 if(solid[i]!=0u||fill<0.0001||face==2u){return vec2<f32>(-1.0);}
 let axis=face/2u;let width=c.size/shape.x;let height=c.size/shape.y;var q=c.lower;
 q[axis]+=select(-1,i32(c.size),face%2u==1u);
 let u=sub%shape.x;let v=sub/shape.x;
 if(axis==1u){
  q.x+=i32(u*width);q.z+=i32(v*height);
  let j=ash_locate(q);
  if(j!=0xffffffffu&&(mass[j]>0.0001||(solid[j]!=0u&&fill>=0.9999))){return vec2<f32>(-1.0);}
  return vec2<f32>(top,top);
 }
 let tangent=select(0u,2u,axis==0u);q[tangent]+=i32(u*width);q.y+=i32(v*height);
 let j=ash_locate(q);var other=f32(c.lower.y);
 if(j!=0xffffffffu){
  let n=ash_cell(j);
  if(solid[j]!=0u){other=f32(n.lower.y)+f32(n.size);}else{other=f32(n.lower.y)+mass[j]/ash_capacity(j)*f32(n.size);}
 }
 let low=max(f32(c.lower.y+ i32(v*height)),other);let high=min(top,f32(c.lower.y+i32((v+1u)*height)));
 if(high<=low+1e-6){return vec2<f32>(-1.0);}
 return vec2<f32>(low,high);
}
@compute @workgroup_size(64) fn build_surface(@builtin(workgroup_id) w:vec3<u32>,@builtin(local_invocation_id) l:vec3<u32>){
 let group=w.x+w.y*ROW;let rank=group/G;if(rank>=word(STATS+1u)){return;}
 let local=(group%G)*64u+l.x;if(local>=V){return;}
 let tile=word(SURFACE+rank);let i=ash_tile_cell(tile,local);
 if(i!=0xffffffffu&&ash_cell(i).owned){
  let c=ash_cell(i);
  for(var face=0u;face<6u;face++){
   let shape=ash_face_shape(i,face);
   for(var sub=0u;sub<shape.x*shape.y;sub++){
    let band=face_band(i,face,sub,shape);if(band.x<0.0){continue;}
    let slot=atomicAdd(&headers[tile*8u+3u],1u);
    if(slot>=word(tile*8u+5u)){atomicStore(&arena[STATS+5u],1u);continue;}
    faces[word(tile*8u+4u)+slot]=local*24u+face*4u+sub;
   }
  }
 }
 // Clearing occurs in a separate pass after all dependency reads have finished.
}
@compute @workgroup_size(64) fn finish_surface(@builtin(global_invocation_id) id:vec3<u32>){
 if(id.x<ASH_TILE_COUNT){atomicStore(&headers[id.x*8u+2u],0u);}
}
@compute @workgroup_size(1) fn draw_prefix(){
 var total=0u;atomicStore(&arena[PREFIX],0u);
 for(var t=0u;t<ASH_TILE_COUNT;t++){
  total+=atomicLoad(&headers[t*8u+3u]);atomicStore(&arena[PREFIX+t+1u],total);
 }
 atomicStore(&arena[STATS+4u],total);
}
@compute @workgroup_size(64) fn wake_all(@builtin(global_invocation_id) id:vec3<u32>){
 if(id.x<ASH_TILE_COUNT){atomicStore(&headers[id.x*8u],1u);}
}
`;
}
