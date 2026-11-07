export function hierarchyOffsets(p,start){
 const nodes=start,children=nodes+p.tiles.count*8,demand=children+p.tiles.count*8,flags=demand+p.tiles.count*8,free=flags+p.tiles.count,collision=free+p.hierarchy.capacity,state=collision+p.tiles.count,args=state+16;
 return {nodes,children,demand,flags,free,collision,state,args,end:args+4};
}
export function hierarchyAddressWGSL(p,{load=i=>`atomicLoad(&arena[${i}])`,parameter=''}={}){
 const a=p.hierarchyArena,base=p.regions[0].layout,h=p.hierarchy;
 const arg=parameter?',ashMap:ptr<storage,array<u32>,read>':'',pass=parameter?',ashMap':'';
 const get=i=>load(i);
 return `
const ASH_FINE_DIMS=vec3<u32>(${p.dims.map(n=>n+'u')});const ASH_CELL_COUNT:u32=${p.count}u;const ASH_TILE_COUNT:u32=${p.tiles.count}u;
const HT_ROOTS:u32=${h.roots}u;const HT_BASE:u32=${base.count}u;const HT_CAP:u32=${h.capacity}u;const HT_DEPTH:u32=${h.depth}u;
const HT_DIMS=vec3<u32>(${base.dims.map(n=>n+'u')});const HT_TD=vec3<u32>(${base.tiles.dims.map(n=>n+'u')});
struct AshCell {lower:vec3<i32>,size:u32,tile:u32,owned:bool}
fn ht_node(t:u32${arg})->vec4<u32>{let k=${a.nodes}u+t*8u;return vec4<u32>(${[0,1,2,3].map(n=>get(`k+${n}u`))});}
fn ht_live(t:u32${arg})->u32{return ${get(`${a.nodes}u+t*8u+7u`)};}
fn ht_child(t:u32,q:vec3<i32>${arg})->u32{let n=ht_node(t${pass});let c=vec3<u32>(q-vec3<i32>(n.xyz))/(n.w*4u);return c.x+2u*(c.y+2u*c.z);}
fn ash_locate(q:vec3<i32>${arg})->u32{
 if(any(q<vec3<i32>(0))||any(q>=vec3<i32>(ASH_FINE_DIMS))){return 0xffffffffu;}
 let coarse=vec3<u32>(q)/${p.regions[0].scale}u;let root=coarse/8u;var t=root.x+HT_TD.x*(root.y+HT_TD.y*root.z);
 for(var depth=0u;depth<=HT_DEPTH;depth++){
  let n=ht_node(t${pass});let octant=ht_child(t,q${pass});let child=${get(`${a.children}u+t*8u+octant`)};
  if(child>0u&&child<=HT_CAP){let next=HT_ROOTS+child-1u;if(ht_live(next${pass})==1u){t=next;continue;}}
  if(t<HT_ROOTS){return coarse.x+HT_DIMS.x*(coarse.y+HT_DIMS.y*coarse.z);}
  let c=vec3<u32>(q-vec3<i32>(n.xyz))/n.w;return HT_BASE+(t-HT_ROOTS)*512u+c.x+8u*(c.y+8u*c.z);
 }
 return 0xffffffffu;
}
fn index(c:vec3<u32>${arg})->u32{return ash_locate(vec3<i32>(c)${pass});}
fn ash_cell(i:u32${arg})->AshCell{
 if(i>=ASH_CELL_COUNT){return AshCell(vec3<i32>(0),0u,0u,false);}
 var q=vec3<u32>(0);var size=${p.regions[0].scale}u;var t=0u;
 if(i<HT_BASE){let c=vec3<u32>(i%HT_DIMS.x,(i/HT_DIMS.x)%HT_DIMS.y,i/(HT_DIMS.x*HT_DIMS.y));q=c*size;let r=c/8u;t=r.x+HT_TD.x*(r.y+HT_TD.y*r.z);}
 else{t=HT_ROOTS+(i-HT_BASE)/512u;if(ht_live(t${pass})==0u){return AshCell(vec3<i32>(0),0u,t,false);}let n=ht_node(t${pass});let j=(i-HT_BASE)%512u;size=n.w;q=n.xyz+vec3<u32>(j%8u,(j/8u)%8u,j/64u)*size;}
 return AshCell(vec3<i32>(q),size,t,ash_locate(vec3<i32>(q)${pass})==i);
}
fn ash_capacity(i:u32${arg})->f32{let s=f32(ash_cell(i${pass}).size);return s*s*s;}
fn ash_tile_cell(t:u32,local:u32${arg})->u32{
 if(t>=ASH_TILE_COUNT||ht_live(t${pass})!=1u){return 0xffffffffu;}
 if(t>=HT_ROOTS){return HT_BASE+(t-HT_ROOTS)*512u+local;}
 let n=ht_node(t${pass});let c=n.xyz/${p.regions[0].scale}u+vec3<u32>(local%8u,(local/8u)%8u,local/64u);
 if(any(c>=HT_DIMS)){return 0xffffffffu;}return c.x+HT_DIMS.x*(c.y+HT_DIMS.y*c.z);
}
fn ash_face_shape(i:u32,face:u32${arg})->vec2<u32>{let c=ash_cell(i${pass});if(c.size==1u){return vec2<u32>(1u);}if(face==3u){return vec2<u32>(2u);}var q=c.lower;q[face/2u]+=select(-1,i32(c.size),face%2u==1u);let j=ash_locate(q${pass});var height=1u;if(j!=0xffffffffu&&ash_cell(j${pass}).size<c.size){height=2u;}return vec2<u32>(2u,height);}
`;
}

// Each child covers a 4³ block of parent cells with 8³ receiving cells.
// Staged links become visible only after prolongation has completed.
export function hierarchyTopologyWGSL(p){
 const a=p.hierarchyArena;
 return `
fn ht_load(i:u32)->u32{return atomicLoad(&arena[i]);}
fn ht_at(t:u32,local:vec3<u32>)->u32{if(t>=HT_ROOTS){return HT_BASE+(t-HT_ROOTS)*512u+local.x+8u*(local.y+8u*local.z);}let n=ht_node(t);let q=n.xyz/${p.regions[0].scale}u+local;if(any(q>=HT_DIMS)){return 0xffffffffu;}return q.x+HT_DIMS.x*(q.y+HT_DIMS.y*q.z);}
fn ht_low(candidate:u32)->vec4<u32>{let t=candidate/8u;let o=candidate%8u;let n=ht_node(t);return vec4<u32>(n.xyz+vec3<u32>(o%2u,(o/2u)%2u,o/4u)*n.w*4u,n.w/2u);}
fn ht_score(candidate:u32)->u32{
 let t=candidate/8u;if(ht_live(t)!=1u||ht_node(t).w<=1u){return 0u;}
 let demand=ht_load(${a.demand}u+candidate);if(demand==0u){return 0u;}if(demand==4u||params.view.w==0.0){return demand;}
 let n=ht_low(candidate);let point=O+(vec3<f32>(n.xyz)+vec3<f32>(f32(n.w)*4.0))*H;let clip=params.fieldClip*vec4<f32>(point,1.0);if(clip.w<=0.0){return 0u;}
 var pixels=0.0;for(var axis=0u;axis<3u;axis++){var delta=vec3<f32>(0);delta[axis]=H*f32(n.w*2u);let end=params.fieldClip*vec4<f32>(point+delta,1.0);pixels=max(pixels,length((end.xy/max(end.w,1e-6)-clip.xy/clip.w)*params.view.xy*.5));}
 let padding=pixels*4.0/max(min(params.view.x,params.view.y),1.0)*2.0;
 if(any(abs(clip.xy/clip.w)>vec2<f32>(1.0+padding))||clip.z< -clip.w||clip.z>clip.w||pixels<params.view.z){return 0u;}
 return demand;
}
fn ht_mark(t:u32){atomicStore(&headers[t*8u],1u);atomicStore(&headers[t*8u+2u],1u);}
fn ht_neighbors(n:vec4<u32>){
 for(var z=-1;z<=1;z++){for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){
  let q=vec3<i32>(n.xyz)+vec3<i32>(select((x+1)*i32(n.w)*4,-1,x==-1),select((y+1)*i32(n.w)*4,-1,y==-1),select((z+1)*i32(n.w)*4,-1,z==-1));
  let i=ash_locate(q);if(i!=0xffffffffu){ht_mark(ash_cell(i).tile);}
 }}}
}
@compute @workgroup_size(1) fn hierarchy_reset(){
 let enabled=params.clock.y!=0u||params.clock.z!=0u||ht_load(${a.state+8}u)!=0u;
 if(enabled){for(var n=0u;n<16u;n++){atomicStore(&arena[${a.state}u+n],0u);}}
 atomicStore(&arena[${a.state+7}u],select(0u,1u,enabled));atomicStore(&arena[${a.state+8}u],0u);
}
@compute @workgroup_size(64) fn hierarchy_dirty(@builtin(global_invocation_id) id:vec3<u32>){let t=id.x;if(t>=ASH_TILE_COUNT||ht_live(t)!=1u){return;}if(params.clock.y!=0u){atomicOr(&arena[${a.flags}u+t],2u);}}
fn ht_supports_finer(t:u32)->bool{
 let n=ht_node(t);
 for(var z=-1;z<=2;z++){for(var y=-1;y<=2;y++){for(var x=-1;x<=2;x++){
  let coord=vec3<i32>(x,y,z);var q=vec3<i32>(n.xyz);
  for(var axis=0u;axis<3u;axis++){let v=coord[axis];q[axis]+=select(select((v*4+2)*i32(n.w),i32(n.w)*8,v==2),-1,v==-1);}
  let i=ash_locate(q);if(i!=0xffffffffu&&ash_cell(i).size<n.w){return true;}
 }}}return false;
}
@compute @workgroup_size(1) fn hierarchy_release_begin(){atomicStore(&arena[${a.state}u],0u);atomicStore(&arena[${a.state+9}u],HT_DEPTH);atomicStore(&arena[${a.state+12}u],0u);}
@compute @workgroup_size(1) fn hierarchy_release_next(){let d=ht_load(${a.state+9}u);atomicStore(&arena[${a.state+9}u],select(0u,d-1u,d>0u));}
@compute @workgroup_size(1) fn hierarchy_pressure_reset(){atomicStore(&arena[${a.state+11}u],0u);}
@compute @workgroup_size(64) fn hierarchy_pressure(@builtin(global_invocation_id) id:vec3<u32>){let c=id.x;if(c<ASH_TILE_COUNT*8u&&ht_load(${a.state+7}u)!=0u&&ht_score(c)>=3u&&ht_load(${a.children}u+c)==0u){atomicStore(&arena[${a.state+11}u],1u);}}
${[1,2].map(priority=>`@compute @workgroup_size(1) fn hierarchy_reclaim_${priority}(){atomicStore(&arena[${a.state}u],0u);atomicStore(&arena[${a.state+9}u],HT_DEPTH);atomicStore(&arena[${a.state+12}u],${priority}u);}`).join('\n')}
@compute @workgroup_size(64) fn hierarchy_release(@builtin(global_invocation_id) id:vec3<u32>){
 let slot=id.x;if(slot>=HT_CAP||ht_load(${a.state+7}u)==0u){return;}let t=HT_ROOTS+slot;
 if(ht_live(t)!=1u||ht_load(${a.nodes}u+t*8u+4u)!=ht_load(${a.state+9}u)){return;}
 let cutoff=ht_load(${a.state+12}u);if(cutoff>0u&&ht_load(${a.state+11}u)==0u){return;}
 var children=false;for(var o=0u;o<8u;o++){children=children||ht_load(${a.children}u+t*8u+o)!=0u;}
 if(atomicLoad(&headers[t*8u+6u])>0u||children||ht_supports_finer(t)){atomicAdd(&arena[${a.state+5}u],1u);return;}
 let parent=ht_load(${a.nodes}u+t*8u+5u)-1u;let octant=ht_load(${a.nodes}u+t*8u+6u);
 if(ht_score(parent*8u+octant)>cutoff){return;}
 let n=ht_node(t);atomicStore(&arena[${a.children}u+parent*8u+octant],0u);atomicStore(&arena[${a.nodes}u+t*8u+7u],0u);atomicStore(&headers[t*8u+3u],0u);ht_mark(parent);ht_neighbors(n);atomicAdd(&arena[${a.state+3}u],1u);
}
@compute @workgroup_size(64) fn hierarchy_free(@builtin(global_invocation_id) id:vec3<u32>){let slot=id.x;if(slot>=HT_CAP||ht_load(${a.state+7}u)==0u||ht_live(HT_ROOTS+slot)!=0u){return;}let rank=atomicAdd(&arena[${a.state}u],1u);atomicStore(&arena[${a.free}u+rank],slot);}
fn ht_balanced(candidate:u32,request:bool)->bool{
 let n=ht_low(candidate);var balanced=true;
 for(var z=-1;z<=1;z++){for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){
  let q=vec3<i32>(n.xyz)+vec3<i32>(select((x+1)*i32(n.w)*4,-1,x==-1),select((y+1)*i32(n.w)*4,-1,y==-1),select((z+1)*i32(n.w)*4,-1,z==-1));
  let i=ash_locate(q);if(i==0xffffffffu){continue;}let c=ash_cell(i);
  if(c.size>n.w*2u){balanced=false;if(request){let o=ht_child(c.tile,q);atomicMax(&arena[${a.demand}u+c.tile*8u+o],4u);}}
 }}}
 return balanced;
}
@compute @workgroup_size(64) fn hierarchy_balance(@builtin(global_invocation_id) id:vec3<u32>){let candidate=id.x;if(candidate>=ASH_TILE_COUNT*8u||ht_load(${a.state+7}u)==0u||ht_score(candidate)<2u){return;}_=ht_balanced(candidate,true);}
fn ht_take()->u32{loop{let n=ht_load(${a.state}u);if(n==0u){return 0xffffffffu;}let r=atomicCompareExchangeWeak(&arena[${a.state}u],n,n-1u);if(r.exchanged){return ht_load(${a.free}u+n-1u);}}}
fn ht_allocate(candidate:u32,score:u32){
 if(candidate>=ASH_TILE_COUNT*8u||ht_load(${a.state+7}u)==0u||ht_score(candidate)!=score||ht_load(${a.children}u+candidate)!=0u){return;}
 atomicAdd(&arena[${a.state+1}u],1u);if(!ht_balanced(candidate,false)){atomicAdd(&arena[${a.state+10}u],1u);return;}
 let claim=atomicCompareExchangeWeak(&arena[${a.children}u+candidate],0u,0xffffffffu);if(!claim.exchanged){return;}
 let slot=ht_take();if(slot==0xffffffffu){atomicStore(&arena[${a.children}u+candidate],0u);atomicAdd(&arena[${a.state+4}u],1u);return;}
 let t=HT_ROOTS+slot;let n=ht_low(candidate);let parent=candidate/8u;
 atomicStore(&arena[${a.nodes}u+t*8u],n.x);atomicStore(&arena[${a.nodes}u+t*8u+1u],n.y);atomicStore(&arena[${a.nodes}u+t*8u+2u],n.z);atomicStore(&arena[${a.nodes}u+t*8u+3u],n.w);
 atomicStore(&arena[${a.nodes}u+t*8u+4u],ht_load(${a.nodes}u+parent*8u+4u)+1u);atomicStore(&arena[${a.nodes}u+t*8u+5u],parent+1u);atomicStore(&arena[${a.nodes}u+t*8u+6u],candidate%8u);atomicStore(&arena[${a.nodes}u+t*8u+7u],2u);
 for(var o=0u;o<8u;o++){atomicStore(&arena[${a.children}u+t*8u+o],0u);atomicStore(&arena[${a.demand}u+t*8u+o],0u);}
 atomicStore(&headers[t*8u+6u],0u);atomicStore(&arena[${a.children}u+candidate],slot+1u);atomicAdd(&arena[${a.state+2}u],1u);atomicStore(&arena[${a.state+8}u],1u);
}
${[4,3,2,1].map(n=>`@compute @workgroup_size(64) fn hierarchy_allocate_${n}(@builtin(global_invocation_id) id:vec3<u32>){ht_allocate(id.x,${n}u);}`).join('\n')}
@compute @workgroup_size(64) fn hierarchy_prolong(@builtin(workgroup_id) w:vec3<u32>,@builtin(local_invocation_id) l:vec3<u32>){
 let group=w.x+w.y*ROW;let slot=group/8u;if(slot>=HT_CAP){return;}let t=HT_ROOTS+slot;if(ht_live(t)!=2u){return;}
 let j=(group%8u)*64u+l.x;let local=vec3<u32>(j%8u,(j/8u)%8u,j/64u);let parent=ht_load(${a.nodes}u+t*8u+5u)-1u;let o=ht_load(${a.nodes}u+t*8u+6u);let c=local/2u+vec3<u32>(o%2u,(o/2u)%2u,o/4u)*4u;let i=ht_at(parent,c);
 let n=ht_node(t);let side=f32(n.w);let cap=side*side*side;var value=0.0;if(i!=0xffffffffu){value=clamp(mass[i]*.25-f32(local.y%2u)*cap,0.0,cap);}let destination=HT_BASE+slot*512u+j;mass[destination]=value;
 if(value>0.0){atomicAdd(&headers[t*8u+6u],1u);}
}
@compute @workgroup_size(64) fn hierarchy_activate(@builtin(global_invocation_id) id:vec3<u32>){
 let slot=id.x;if(slot>=HT_CAP){return;}let t=HT_ROOTS+slot;if(ht_live(t)!=2u){return;}
 let parent=ht_load(${a.nodes}u+t*8u+5u)-1u;let o=ht_load(${a.nodes}u+t*8u+6u);let offset=vec3<u32>(o%2u,(o/2u)%2u,o/4u)*4u;
 for(var z=0u;z<4u;z++){for(var y=0u;y<4u;y++){for(var x=0u;x<4u;x++){let i=ht_at(parent,offset+vec3<u32>(x,y,z));if(i!=0xffffffffu){mass[i]=0.0;}}}}
 atomicStore(&arena[${a.nodes}u+t*8u+7u],1u);atomicStore(&arena[${a.flags}u+t],2u);ht_mark(t);ht_mark(parent);ht_neighbors(ht_node(t));
}
@compute @workgroup_size(1) fn hierarchy_collision_reset(){atomicStore(&arena[${a.state+6}u],0u);}
@compute @workgroup_size(64) fn hierarchy_collision_list(@builtin(global_invocation_id) id:vec3<u32>){let t=id.x;if(t>=ASH_TILE_COUNT||ht_live(t)!=1u||(ht_load(${a.flags}u+t)&2u)==0u){return;}let n=atomicAdd(&arena[${a.state+6}u],1u);atomicStore(&arena[${a.collision}u+n],t);}
@compute @workgroup_size(1) fn hierarchy_collision_args(){let groups=ht_load(${a.state+6}u)*8u;atomicStore(&arena[${a.args}u],min(groups,ROW));atomicStore(&arena[${a.args+1}u],max(1u,(groups+ROW-1u)/ROW));atomicStore(&arena[${a.args+2}u],1u);}
`;
}
