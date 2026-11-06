// Optional third physical level. Requests come from cached collider occupancy;
// projection orders their admission. Occupied material and balancing parents pin.
export function detailTopologyWGSL(p,a){
 const d=a.detail,pool=p.detailPool;
 return `
fn dp_load(i:u32)->u32{return atomicLoad(&arena[i]);}
fn dp_parent(q:vec3<u32>)->u32{
 let c=q/AP_SCALE;let page=ap_index(c/AP_WIDTH);let slot=dp_load(${a.map}u+page);
 if(slot==0u){return 0xffffffffu;}let local=c%AP_WIDTH;return AP_OFFSET+(slot-1u)*AP_CELLS+local.x+AP_WIDTH*(local.y+AP_WIDTH*local.z);
}
fn dp_balanced(page:u32)->bool{
 let low=vec3<i32>(dp_coords(page)*DP_WIDTH);
 for(var z=-1;z<=1;z++){for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){
  let q=low+vec3<i32>((x+1)*4,(y+1)*4,(z+1)*4)-vec3<i32>(select(0,1,x==-1),select(0,1,y==-1),select(0,1,z==-1));
  if(any(q<vec3<i32>(0))||any(q>=vec3<i32>(ASH_FINE_DIMS))){continue;}
  if(dp_parent(vec3<u32>(q))==0xffffffffu){return false;}
 }}}
 return true;
}
fn dp_supports_middle(page:u32)->bool{
 let low=vec3<i32>(ap_coords(page)*2u);
 // A finest page touching a middle page needs that page for 2:1 balance.
 for(var z=-1;z<=2;z++){for(var y=-1;y<=2;y++){for(var x=-1;x<=2;x++){
  let q=low+vec3<i32>(x,y,z);if(any(q<vec3<i32>(0))||any(q>=vec3<i32>(DP_DIMS))){continue;}
  if(dp_load(${d.map}u+dp_index(vec3<u32>(q)))!=0u){return true;}
 }}}
 return false;
}
fn dp_score(page:u32)->u32{
 if(dp_load(${d.demand}u+page)==0u){return 0u;}
 if(params.view.w==0.0){return 2u;}
 let point=O+(vec3<f32>(dp_coords(page)*DP_WIDTH)+vec3<f32>(4.0))*H;
 let clip=params.fieldClip*vec4<f32>(point,1.0);
 if(clip.w<=0.0){return 0u;}
 var pixels=0.0;
 for(var axis=0u;axis<3u;axis++){
  var delta=vec3<f32>(0.0);delta[axis]=H*f32(AP_SCALE);
  let end=params.fieldClip*vec4<f32>(point+delta,1.0);
  pixels=max(pixels,length((end.xy/max(end.w,1e-6)-clip.xy/clip.w)*params.view.xy*.5));
 }
 let padding=pixels*4.0/max(min(params.view.x,params.view.y),1.0)*2.0;
 if(any(abs(clip.xy/clip.w)>vec2<f32>(1.0+padding))||clip.z< -clip.w||clip.z>clip.w){return 0u;}
 let ratio=pixels/max(params.view.z,1e-6);
 if(ratio<1.0){return 0u;}if(ratio>=4.0){return 3u;}if(ratio>=2.0){return 2u;}return 1u;
}
fn dp_dirty(page:u32){
 atomicStore(&arena[${a.state+8}u],1u);
 let low=vec3<i32>(dp_coords(page)*DP_WIDTH);
 for(var z=-1;z<=1;z++){for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){
  let q=low+vec3<i32>((x+1)*4,(y+1)*4,(z+1)*4)-vec3<i32>(select(0,1,x==-1),select(0,1,y==-1),select(0,1,z==-1));
  let i=ash_locate(q);if(i!=0xffffffffu){let tile=ash_cell(i).tile;atomicStore(&headers[tile*8u],1u);atomicStore(&headers[tile*8u+2u],1u);}
 }}}
}
@compute @workgroup_size(1) fn detail_reset(){
 let enabled=params.clock.y!=0u||params.clock.z!=0u||dp_load(${a.state+6}u)>0u||dp_load(${d.state+8}u)!=0u;
 if(enabled){for(var n=0u;n<16u;n++){atomicStore(&arena[${d.state}u+n],0u);}}
 atomicStore(&arena[${d.state+8}u],0u);atomicStore(&arena[${d.state+6}u],0u);atomicStore(&arena[${d.state+7}u],select(0u,1u,enabled));
}
@compute @workgroup_size(64) fn detail_release(@builtin(global_invocation_id) id:vec3<u32>){
 let slot=id.x;if(slot>=${pool.capacity}u||dp_load(${d.state+7}u)==0u){return;}let page=dp_load(${d.slots}u+slot);
 if(page!=0u){let occupied=atomicLoad(&headers[(DP_TILES+slot)*8u+6u])>0u;
  if(occupied){atomicAnd(&arena[${d.flags}u+slot],0xfffffffbu);atomicAdd(&arena[${d.state+5}u],1u);return;}
  atomicOr(&arena[${d.flags}u+slot],4u);if(dp_score(page-1u)>0u){return;}
  atomicStore(&arena[${d.map}u+page-1u],0u);atomicStore(&arena[${d.slots}u+slot],0u);atomicStore(&arena[${d.flags}u+slot],0u);
  atomicStore(&headers[(DP_TILES+slot)*8u+3u],0u);dp_dirty(page-1u);atomicAdd(&arena[${d.state+3}u],1u);
 }
 let rank=atomicAdd(&arena[${d.state}u],1u);atomicStore(&arena[${d.free}u+rank],slot);
}
@compute @workgroup_size(64) fn detail_max_priority(@builtin(global_invocation_id) id:vec3<u32>){
 let page=id.x;if(dp_load(${d.state+7}u)==0u||page>=${pool.pages}u||dp_load(${d.map}u+page)!=0u){return;}
 let score=dp_score(page);if(score>0u&&dp_balanced(page)){atomicMax(&arena[${d.state+11}u],score);}
}
@compute @workgroup_size(64) fn detail_count_priority(@builtin(global_invocation_id) id:vec3<u32>){
 let page=id.x;if(dp_load(${d.state+7}u)==0u||page>=${pool.pages}u||dp_load(${d.map}u+page)!=0u){return;}
 let priority=dp_load(${d.state+11}u);if(priority>0u&&dp_score(page)==priority&&dp_balanced(page)){atomicAdd(&arena[${d.state+9}u],1u);}
}
@compute @workgroup_size(64) fn detail_reclaim_lower(@builtin(global_invocation_id) id:vec3<u32>){
 let slot=id.x;if(dp_load(${d.state+7}u)==0u||slot>=${pool.capacity}u||(dp_load(${d.flags}u+slot)&4u)==0u){return;}
 let page=dp_load(${d.slots}u+slot);if(page==0u||dp_score(page-1u)>=dp_load(${d.state+11}u)){return;}
 loop{let free=dp_load(${d.state}u);if(free>=dp_load(${d.state+9}u)){return;}let r=atomicCompareExchangeWeak(&arena[${d.state}u],free,free+1u);
  if(r.exchanged){atomicStore(&arena[${d.map}u+page-1u],0u);atomicStore(&arena[${d.slots}u+slot],0u);atomicStore(&arena[${d.flags}u+slot],0u);atomicStore(&headers[(DP_TILES+slot)*8u+3u],0u);atomicStore(&arena[${d.free}u+free],slot);atomicAdd(&arena[${d.state+3}u],1u);dp_dirty(page-1u);return;}
 }
}
fn dp_take()->u32{loop{let n=dp_load(${d.state}u);if(n==0u){return 0xffffffffu;}let r=atomicCompareExchangeWeak(&arena[${d.state}u],n,n-1u);if(r.exchanged){return dp_load(${d.free}u+n-1u);}}}
fn dp_allocate(page:u32,priority:u32){
 if(dp_load(${d.state+7}u)==0u||page>=${pool.pages}u||dp_load(${d.map}u+page)!=0u||dp_score(page)!=priority){return;}
 atomicAdd(&arena[${d.state+1}u],1u);
 if(!dp_balanced(page)){atomicAdd(&arena[${d.state+10}u],1u);atomicAdd(&arena[${d.state+4}u],1u);return;}
 let slot=dp_take();if(slot==0xffffffffu){atomicAdd(&arena[${d.state+4}u],1u);return;}
 atomicStore(&arena[${d.slots}u+slot],page+1u);atomicStore(&arena[${d.map}u+page],slot+1u);atomicStore(&arena[${d.flags}u+slot],3u);atomicAdd(&arena[${d.state+2}u],1u);
}
@compute @workgroup_size(64) fn detail_allocate_high(@builtin(global_invocation_id) id:vec3<u32>){dp_allocate(id.x,3u);}
@compute @workgroup_size(64) fn detail_allocate_medium(@builtin(global_invocation_id) id:vec3<u32>){dp_allocate(id.x,2u);}
@compute @workgroup_size(64) fn detail_allocate_low(@builtin(global_invocation_id) id:vec3<u32>){dp_allocate(id.x,1u);}
@compute @workgroup_size(64) fn detail_prolong(@builtin(global_invocation_id) id:vec3<u32>){
 let slot=id.x;if(slot>=${pool.capacity}u||(dp_load(${d.flags}u+slot)&1u)==0u){return;}
 let page=dp_load(${d.slots}u+slot)-1u;let low=dp_coords(page)*DP_WIDTH;
 for(var z=0u;z<DP_WIDTH;z+=2u){for(var y=0u;y<DP_WIDTH;y+=2u){for(var x=0u;x<DP_WIDTH;x+=2u){
  let q=low+vec3<u32>(x,y,z);if(any(q>=ASH_FINE_DIMS)){continue;}let i=dp_parent(q);let volume=mass[i];mass[i]=0.0;
  for(var dz=0u;dz<2u;dz++){for(var dy=0u;dy<2u;dy++){for(var dx=0u;dx<2u;dx++){
   let local=vec3<u32>(x+dx,y+dy,z+dz);let j=DP_OFFSET+slot*DP_CELLS+local.x+DP_WIDTH*(local.y+DP_WIDTH*local.z);mass[j]=clamp(volume*.25-f32(dy),0.0,1.0);
  }}}
 }}}
 atomicAnd(&arena[${d.flags}u+slot],0xfffffffeu);dp_dirty(page);
}
@compute @workgroup_size(64) fn detail_collision_list(@builtin(global_invocation_id) id:vec3<u32>){
 let slot=id.x;if(slot>=${pool.capacity}u||dp_load(${d.slots}u+slot)==0u||(dp_load(${d.flags}u+slot)&2u)==0u){return;}
 let rank=atomicAdd(&arena[${d.state+6}u],1u);atomicStore(&arena[${d.collision}u+rank],slot);
}
@compute @workgroup_size(1) fn detail_collision_args(){let n=dp_load(${d.state+6}u)*G;atomicStore(&arena[${d.args}u],min(n,ROW));atomicStore(&arena[${d.args+1}u],max(1u,(n+ROW-1u)/ROW));atomicStore(&arena[${d.args+2}u],1u);}
@compute @workgroup_size(64) fn detail_recount(@builtin(global_invocation_id) id:vec3<u32>){let page=id.x;if(page<${pool.pages}u&&dp_load(${d.map}u+page)==0u&&dp_score(page)>0u){atomicAdd(&arena[${d.state+4}u],1u);}}
`;
}
