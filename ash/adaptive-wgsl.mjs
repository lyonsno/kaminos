// The topology is GPU state. All consumers use these same owner addresses.
export function adaptiveOffsets(p,start){
 const map=start,slots=map+p.pool.pages,demand=slots+p.pool.capacity,flags=demand+p.pool.pages,free=flags+p.pool.capacity,collision=free+p.pool.capacity,state=collision+p.pool.capacity,args=state+16;
 const result={map,slots,demand,flags,free,collision,state,args,end:args+4};
 if(p.detailPool){result.detail=adaptiveOffsets({pool:p.detailPool},result.end);result.end=result.detail.end;}
 return result;
}
const u3=a=>`vec3<u32>(${a.map(n=>n+'u')})`;
export function adaptiveAddressWGSL(p,a,{load=i=>`atomicLoad(&arena[${i}])`,parameter=''}={}){
 const {pool}=p,base=p.regions[0].layout;
 const arg=parameter?',ashMap:ptr<storage,array<u32>,read>':'',pass=parameter?',ashMap':'';
 const levels=[['AP',pool,a],...(p.detailPool?[['DP',p.detailPool,a.detail]]:[])];
 const read=(at,field,i)=>load(`${at[field]}u+${i}`);
 return `
const ASH_FINE_DIMS=${u3(p.dims)};const ASH_CELL_COUNT:u32=${p.count}u;const ASH_TILE_COUNT:u32=${p.tiles.count}u;
${levels.map(([n,pool])=>`const ${n}_DIMS=${u3(pool.pageDims)};const ${n}_WIDTH:u32=${pool.width}u;const ${n}_CELLS:u32=${pool.cells}u;const ${n}_OFFSET:u32=${pool.offset}u;const ${n}_TILES:u32=${pool.tileOffset}u;const ${n}_SCALE:u32=${pool.scale??1}u;`).join('\n')}
const AC_DIMS=${u3(base.dims)};const AC_TD=${u3(base.tiles.dims)};const AC_SCALE:u32=${p.regions[0].scale}u;
struct AshCell {lower:vec3<i32>,size:u32,tile:u32,owned:bool}
${levels.map(([n])=>`fn ${n.toLowerCase()}_coords(i:u32)->vec3<u32>{return vec3<u32>(i%${n}_DIMS.x,(i/${n}_DIMS.x)%${n}_DIMS.y,i/(${n}_DIMS.x*${n}_DIMS.y));}
fn ${n.toLowerCase()}_index(q:vec3<u32>)->u32{return q.x+${n}_DIMS.x*(q.y+${n}_DIMS.y*q.z);}`).join('\n')}
fn ash_locate(q:vec3<i32>${arg})->u32{
 if(any(q<vec3<i32>(0))||any(q>=vec3<i32>(ASH_FINE_DIMS))){return 0xffffffffu;}
 ${[...levels].reverse().map(([n,pool,at])=>`{
 let c=vec3<u32>(q)/${n}_SCALE;let page=${n.toLowerCase()}_index(c/${n}_WIDTH);let slot=${read(at,'map','page')};
 if(slot!=0u){let local=c%${n}_WIDTH;return ${n}_OFFSET+(slot-1u)*${n}_CELLS+local.x+${n}_WIDTH*(local.y+${n}_WIDTH*local.z);}
 }`).join('\n')}
 let coarse=vec3<u32>(q)/AC_SCALE;return coarse.x+AC_DIMS.x*(coarse.y+AC_DIMS.y*coarse.z);
}
fn index(c:vec3<u32>${arg})->u32{return ash_locate(vec3<i32>(c)${pass});}
fn ash_cell(i:u32${arg})->AshCell{
 if(i<${base.count}u){let c=vec3<u32>(i%AC_DIMS.x,(i/AC_DIMS.x)%AC_DIMS.y,i/(AC_DIMS.x*AC_DIMS.y));let q=vec3<i32>(c*AC_SCALE);let t=c/${p.tiles.width}u;return AshCell(q,AC_SCALE,t.x+AC_TD.x*(t.y+AC_TD.y*t.z),ash_locate(q${pass})==i);}
 ${[...levels].reverse().map(([n,pool,at])=>`if(i>=${n}_OFFSET&&i<${pool.offset+pool.capacity*pool.cells}u){let k=i-${n}_OFFSET;let slot=k/${n}_CELLS;let page=${read(at,'slots','slot')};
 if(page!=0u){let j=k%${n}_CELLS;let c=vec3<u32>(j%${n}_WIDTH,(j/${n}_WIDTH)%${n}_WIDTH,j/(${n}_WIDTH*${n}_WIDTH));let q=vec3<i32>((${n.toLowerCase()}_coords(page-1u)*${n}_WIDTH+c)*${n}_SCALE);return AshCell(q,${n}_SCALE,${n}_TILES+slot,ash_locate(q${pass})==i);}
 }`).join('\n')}
 return AshCell(vec3<i32>(0),0u,0u,false);
}
fn ash_capacity(i:u32${arg})->f32{let s=ash_cell(i${pass}).size;return f32(s*s*s);}
fn ash_tile_cell(t:u32,local:u32${arg})->u32{
 ${[...levels].reverse().map(([n,pool,at])=>`if(t>=${n}_TILES){let slot=t-${n}_TILES;if(slot>=${pool.capacity}u||${read(at,'slots','slot')}==0u){return 0xffffffffu;}return ${n}_OFFSET+slot*${n}_CELLS+local;}`).join('\n')}
 let tc=vec3<u32>(t%AC_TD.x,(t/AC_TD.x)%AC_TD.y,t/(AC_TD.x*AC_TD.y));
 let c=tc*${p.tiles.width}u+vec3<u32>(local%${p.tiles.width}u,(local/${p.tiles.width}u)%${p.tiles.width}u,local/${p.tiles.width**2}u);
 if(any(c>=AC_DIMS)){return 0xffffffffu;}return c.x+AC_DIMS.x*(c.y+AC_DIMS.y*c.z);
}
fn ash_face_shape(i:u32,face:u32${arg})->vec2<u32>{let c=ash_cell(i${pass});if(c.size==1u){return vec2<u32>(1u);}if(face==3u){return vec2<u32>(2u);}
 var q=c.lower;q[face/2u]+=select(-1,i32(c.size),face%2u==1u);let j=ash_locate(q${pass});var height=1u;if(j!=0xffffffffu&&ash_cell(j${pass}).size<c.size){height=2u;}return vec2<u32>(2u,height);
}`;
}

export function adaptiveTopologyWGSL(p,a){
 const {pool}=p;
 let code=`
fn ap_load(i:u32)->u32{return atomicLoad(&arena[i]);}
fn ap_demand(page:u32)->u32{
 let c=ap_coords(page);var score=0u;
 // One brick of headroom; gather rather than scatter keeps invalidation exact.
 for(var z=-1;z<=1;z++){for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){
  let q=vec3<i32>(c)+vec3<i32>(x,y,z);if(any(q<vec3<i32>(0))||any(q>=vec3<i32>(AP_DIMS))){continue;}
  let raw=ap_load(${a.demand}u+ap_index(vec3<u32>(q)));score=max(score,select(min(raw,1u),raw,x==0&&y==0&&z==0));
 }}}
 return score;
}
fn ap_probe(k:u32,mid:i32)->i32{if(k==0u){return -1;}if(k==1u){return mid;}return i32(AP_WIDTH*AP_SCALE);}
fn ap_dirty(page:u32){
 let low=vec3<i32>(ap_coords(page)*AP_WIDTH*AP_SCALE);
 // Include face/edge neighbors and valid interior coordinates in shallow
 // fields; corner-only probes miss those tiles entirely.
 let mid=min(vec3<i32>(i32(AP_WIDTH*AP_SCALE/2u)),vec3<i32>(ASH_FINE_DIMS)-low-vec3<i32>(1));
 for(var z=0u;z<3u;z++){for(var y=0u;y<3u;y++){for(var x=0u;x<3u;x++){
  let q=low+vec3<i32>(ap_probe(x,mid.x),ap_probe(y,mid.y),ap_probe(z,mid.z));let i=ash_locate(q);if(i!=0xffffffffu){let t=ash_cell(i).tile;atomicStore(&headers[t*8u],1u);atomicStore(&headers[t*8u+2u],1u);}
 }}}
 let coarse=(vec3<u32>(low)/AC_SCALE)/B;let t=coarse.x+AC_TD.x*(coarse.y+AC_TD.y*coarse.z);atomicStore(&headers[t*8u],1u);atomicStore(&headers[t*8u+2u],1u);
 let slot=ap_load(${a.map}u+page);if(slot!=0u){let t=AP_TILES+slot-1u;atomicStore(&headers[t*8u],1u);atomicStore(&headers[t*8u+2u],1u);}
}
@compute @workgroup_size(1) fn adaptive_reset(){
 let enabled=params.clock.y!=0u||(ap_load(${a.state+4}u)>0u&&ap_load(${a.state+8}u)!=0u);
 if(enabled){for(var n=0u;n<16u;n++){atomicStore(&arena[${a.state}u+n],0u);}}
 atomicStore(&arena[${a.state+8}u],0u);atomicStore(&arena[${a.state+6}u],0u);atomicStore(&arena[${a.state+7}u],select(0u,1u,enabled));
}
@compute @workgroup_size(64) fn adaptive_release(@builtin(global_invocation_id) id:vec3<u32>){
 let slot=id.x;if(slot>=${pool.capacity}u||ap_load(${a.state+7}u)==0u){return;}let page=ap_load(${a.slots}u+slot);
 if(page!=0u){var occupied=false;for(var j=0u;j<AP_CELLS;j++){if(mass[AP_OFFSET+slot*AP_CELLS+j]>0.0){occupied=true;break;}}
  ${p.detailPool?'if(dp_supports_middle(page-1u)){occupied=true;}':''}
  if(occupied){atomicAnd(&arena[${a.flags}u+slot],0xfffffffbu);atomicAdd(&arena[${a.state+5}u],1u);return;}
  atomicOr(&arena[${a.flags}u+slot],4u);if(ap_demand(page-1u)>0u){return;}
  atomicStore(&arena[${a.map}u+page-1u],0u);atomicStore(&arena[${a.slots}u+slot],0u);atomicStore(&arena[${a.flags}u+slot],0u);
  atomicStore(&headers[(AP_TILES+slot)*8u+3u],0u);ap_dirty(page-1u);atomicAdd(&arena[${a.state+3}u],1u);
 }
 let index=atomicAdd(&arena[${a.state}u],1u);atomicStore(&arena[${a.free}u+index],slot);
}
@compute @workgroup_size(64) fn adaptive_count_direct(@builtin(global_invocation_id) id:vec3<u32>){
 let page=id.x;if(ap_load(${a.state+7}u)!=0u&&page<${pool.pages}u&&ap_load(${a.map}u+page)==0u&&ap_demand(page)==2u){atomicAdd(&arena[${a.state+9}u],1u);}
}
@compute @workgroup_size(64) fn adaptive_reclaim_halo(@builtin(global_invocation_id) id:vec3<u32>){
 let slot=id.x;if(ap_load(${a.state+7}u)==0u||slot>=${pool.capacity}u||(ap_load(${a.flags}u+slot)&4u)==0u){return;}
 let page=ap_load(${a.slots}u+slot);if(page==0u||ap_demand(page-1u)!=1u){return;}
 loop{let free=ap_load(${a.state}u);if(free>=ap_load(${a.state+9}u)){return;}let r=atomicCompareExchangeWeak(&arena[${a.state}u],free,free+1u);
  if(r.exchanged){atomicStore(&arena[${a.map}u+page-1u],0u);atomicStore(&arena[${a.slots}u+slot],0u);atomicStore(&arena[${a.flags}u+slot],0u);atomicStore(&headers[(AP_TILES+slot)*8u+3u],0u);atomicStore(&arena[${a.free}u+free],slot);atomicAdd(&arena[${a.state+3}u],1u);ap_dirty(page-1u);return;}
 }
}
fn ap_take()->u32{loop{let n=ap_load(${a.state}u);if(n==0u){return 0xffffffffu;}let r=atomicCompareExchangeWeak(&arena[${a.state}u],n,n-1u);if(r.exchanged){return ap_load(${a.free}u+n-1u);}}}
fn ap_allocate(page:u32,priority:u32){
 if(ap_load(${a.state+7}u)==0u||page>=${pool.pages}u||ap_load(${a.map}u+page)!=0u){return;}let score=ap_demand(page);
 if(score!=priority){return;}atomicAdd(&arena[${a.state+1}u],1u);let slot=ap_take();
 if(slot==0xffffffffu){atomicAdd(&arena[${a.state+4}u],1u);return;}
 atomicStore(&arena[${a.slots}u+slot],page+1u);atomicStore(&arena[${a.map}u+page],slot+1u);atomicStore(&arena[${a.flags}u+slot],3u);atomicAdd(&arena[${a.state+2}u],1u);
}
@compute @workgroup_size(64) fn adaptive_allocate_detail(@builtin(global_invocation_id) id:vec3<u32>){ap_allocate(id.x,2u);}
@compute @workgroup_size(64) fn adaptive_allocate_halo(@builtin(global_invocation_id) id:vec3<u32>){ap_allocate(id.x,1u);}
@compute @workgroup_size(64) fn adaptive_prolong(@builtin(global_invocation_id) id:vec3<u32>){
 let slot=id.x;if(slot>=${pool.capacity}u||(ap_load(${a.flags}u+slot)&1u)==0u){return;}
 let page=ap_load(${a.slots}u+slot)-1u;let low=ap_coords(page)*AP_WIDTH*AP_SCALE;
 for(var z=0u;z<AP_WIDTH;z+=2u){for(var y=0u;y<AP_WIDTH;y+=2u){for(var x=0u;x<AP_WIDTH;x+=2u){
  let q=low+vec3<u32>(x,y,z)*AP_SCALE;if(any(q>=ASH_FINE_DIMS)){continue;}let c=q/AC_SCALE;let i=c.x+AC_DIMS.x*(c.y+AC_DIMS.y*c.z);let volume=mass[i];mass[i]=0.0;
  for(var dz=0u;dz<2u;dz++){for(var dy=0u;dy<2u;dy++){for(var dx=0u;dx<2u;dx++){
   let local=vec3<u32>(x+dx,y+dy,z+dz);let j=AP_OFFSET+slot*AP_CELLS+local.x+AP_WIDTH*(local.y+AP_WIDTH*local.z);
   mass[j]=clamp(volume*.25-f32(dy*AP_SCALE*AP_SCALE*AP_SCALE),0.0,f32(AP_SCALE*AP_SCALE*AP_SCALE));
  }}}
 }}}
 atomicAnd(&arena[${a.flags}u+slot],0xfffffffeu);ap_dirty(page);
}
@compute @workgroup_size(64) fn adaptive_collision_list(@builtin(global_invocation_id) id:vec3<u32>){
 let slot=id.x;if(slot>=${pool.capacity}u||ap_load(${a.slots}u+slot)==0u||(ap_load(${a.flags}u+slot)&2u)==0u){return;}
 let rank=atomicAdd(&arena[${a.state+6}u],1u);atomicStore(&arena[${a.collision}u+rank],slot);
}
@compute @workgroup_size(64) fn adaptive_recount(@builtin(global_invocation_id) id:vec3<u32>){let page=id.x;if(page<${pool.pages}u&&ap_load(${a.map}u+page)==0u&&ap_demand(page)>0u){atomicAdd(&arena[${a.state+4}u],1u);}}
@compute @workgroup_size(1) fn adaptive_collision_args(){let n=ap_load(${a.state+6}u)*G;atomicStore(&arena[${a.args}u],min(n,ROW));atomicStore(&arena[${a.args+1}u],max(1u,(n+ROW-1u)/ROW));atomicStore(&arena[${a.args+2}u],1u);}
`;
 if(p.detailPool)code=code.replace('var occupied=false;for(var j=0u;j<AP_CELLS;j++){if(mass[AP_OFFSET+slot*AP_CELLS+j]>0.0){occupied=true;break;}}','var occupied=atomicLoad(&headers[(AP_TILES+slot)*8u+6u])>0u;');
 return code;
}
