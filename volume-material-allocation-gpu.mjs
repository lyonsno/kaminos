// GPU-only refinement policy. Capacity is the authored budget, not a hidden cap.
// Header/list offsets are aligned so the same lists bind to simulation and camera.
export function allocationLayout(capacity,maxDetail){
 const align=n=>Math.ceil(n/64)*64,all=align(32+4*(maxDetail+1)),stride=align(capacity),leaves=all+stride,levels=leaves+stride,heap=levels+stride*(maxDetail+1),occupied=heap+stride;
 return {all,leaves,levels,stride,heap,occupied,words:occupied+stride};
}
export function allocationWGSL(maxDetail){return /* wgsl */`
struct AllocBrick {loPitch:vec4<f32>,kids0:vec4<u32>,kids1:vec4<u32>,info:vec4<u32>}
struct AllocParams {dims:vec4<u32>,originPitch:vec4<f32>,policy:vec4<f32>,weights:vec4<f32>,counts:vec4<u32>,listLayout:vec4<u32>,extra:vec4<u32>}
struct AllocTmp {cLevel:vec4<u32>,kids0:vec4<u32>,kids1:vec4<u32>,relation:vec4<u32>,measured:vec4<f32>,priority:vec4<f32>}
struct AllocSupport {lo:vec4<f32>,hi:vec4<f32>,supply:vec4<f32>}
@group(0) @binding(0) var<uniform> ap:AllocParams;
@group(0) @binding(1) var<storage,read> oldBricks:array<AllocBrick>;
@group(0) @binding(2) var<storage,read> oldState:array<u32>;
@group(0) @binding(3) var<storage,read> measured:array<vec4<f32>>;
@group(0) @binding(4) var<storage,read_write> prediction:array<atomic<u32>>;
@group(0) @binding(5) var<storage,read_write> nextBricks:array<AllocBrick>;
@group(0) @binding(6) var<storage,read_write> nextState:array<u32>;
@group(0) @binding(7) var<storage,read_write> temp:array<AllocTmp>;
@group(0) @binding(8) var<storage,read> supports:array<AllocSupport>;
const NONE:u32=0xffffffffu;
fn oldChild(n:AllocBrick,i:u32)->u32{if(i<4u){return n.kids0[i];}return n.kids1[i-4u];}
fn predicted(slot:u32)->vec4<f32>{return vec4<f32>(bitcast<f32>(atomicLoad(&prediction[slot*4u])),bitcast<f32>(atomicLoad(&prediction[slot*4u+1u])),bitcast<f32>(atomicLoad(&prediction[slot*4u+2u])),bitcast<f32>(atomicLoad(&prediction[slot*4u+3u])));}
fn predictMax(slot:u32,value:vec4<f32>){for(var k=0u;k<4u;k++){atomicMax(&prediction[slot*4u+k],bitcast<u32>(max(0.0,value[k])));}}
@compute @workgroup_size(64) fn predictAllocation(@builtin(global_invocation_id) gid:vec3<u32>,@builtin(num_workgroups) groups:vec3<u32>){
 let i=gid.x+gid.y*groups.x*64u;if(oldState[6]==0u||i>=oldState[1]){return;}
 let source=oldState[oldState[9]+i];let s=oldBricks[source];let value=measured[source*3u];predictMax(source,value);
 if(!any(value>vec4<f32>(0))){return;}
 let lo=max(vec3<f32>(0),(s.loPitch.xyz-ap.originPitch.xyz)/ap.originPitch.w);let hi=min(vec3<f32>(ap.dims.xyz),lo+4.0*s.loPitch.w/ap.originPitch.w);
 let halo=s.loPitch.w/ap.originPitch.w;let motionScale=ap.policy.z*ap.policy.w/ap.originPitch.w;
 let sweptLo=lo+min(vec3<f32>(0),measured[source*3u+1u].xyz)*motionScale-halo;
 let sweptHi=hi+max(vec3<f32>(0),measured[source*3u+2u].xyz)*motionScale+halo;
 let roots=(ap.dims.xyz+vec3<u32>(3))/4u;
 let first=max(vec3<i32>(0),vec3<i32>(floor(sweptLo/4.0)));let last=min(vec3<i32>(roots)-1,vec3<i32>(floor(sweptHi/4.0)));
 var stack:array<u32,${Math.max(1,7*maxDetail+1)}>;
 for(var z=first.z;z<=last.z;z++){for(var y=first.y;y<=last.y;y++){for(var x=first.x;x<=last.x;x++){
  var count=1u;stack[0]=u32(x)+roots.x*(u32(y)+roots.y*u32(z));
  loop{if(count==0u){break;}count--;let slot=stack[count];let n=oldBricks[slot];
   let a=max(vec3<f32>(0),(n.loPitch.xyz-ap.originPitch.xyz)/ap.originPitch.w);let b=min(vec3<f32>(ap.dims.xyz),a+4.0*n.loPitch.w/ap.originPitch.w);
   if(any(a>=b)||any(a>=sweptHi)||any(b<=sweptLo)){continue;}
   if(n.kids0.x!=NONE){for(var j=0u;j<8u;j++){stack[count]=oldChild(n,j);count++;}continue;}
   let overlap=max(vec3<f32>(0),min(b,sweptHi)-max(a,sweptLo))/(b-a);predictMax(slot,value*overlap.x*overlap.y*overlap.z);
  }
 }}}
}
@compute @workgroup_size(1) fn reduceAllocationPrediction(){
 if(oldState[6]==0u){return;}
 for(var i=oldState[0];i>0u;i--){let slot=oldState[oldState[8]+i-1u];let n=oldBricks[slot];if(n.kids0.x==NONE){continue;}
  var value=vec4<f32>(0);for(var j=0u;j<8u;j++){value+=predicted(oldChild(n,j))*.125;}
  for(var k=0u;k<4u;k++){atomicStore(&prediction[slot*4u+k],bitcast<u32>(value[k]));}
 }
}
fn oldAncestor(c:vec3<u32>,level:u32)->u32{
 if(oldState[6]==0u){return NONE;}let roots=(ap.dims.xyz+vec3<u32>(3))/4u;let root=c>>vec3<u32>(level);var slot=root.x+roots.x*(root.y+roots.y*root.z);
 for(var d=0u;d<level;d++){let n=oldBricks[slot];if(n.kids0.x==NONE){break;}let q=(c>>vec3<u32>(level-d-1u))&vec3<u32>(1);slot=oldChild(n,q.x+2u*q.y+4u*q.z);}
 return slot;
}
var<private> heapSize:u32;
var<private> nodeCount:u32;
fn heapGet(i:u32)->u32{return nextState[ap.extra.x+i];}
fn heapSet(i:u32,n:u32){nextState[ap.extra.x+i]=n;}
fn put(id:u32){var i=heapSize;heapSize++;let priority=temp[id].priority.x;loop{if(i==0u){break;}let parent=(i-1u)/2u;let other=heapGet(parent);if(temp[other].priority.x>=priority){break;}heapSet(i,other);i=parent;}heapSet(i,id);}
fn take()->u32{let top=heapGet(0);heapSize--;let last=heapGet(heapSize);if(heapSize>0u){var i=0u;loop{var child=2u*i+1u;if(child>=heapSize){break;}if(child+1u<heapSize&&temp[heapGet(child+1u)].priority.x>temp[heapGet(child)].priority.x){child++;}if(temp[heapGet(child)].priority.x<=temp[last].priority.x){break;}heapSet(i,heapGet(child));i=child;}heapSet(i,last);}return top;}
fn offer(id:u32,c:vec3<u32>,level:u32,parent:u32,inherited:vec4<f32>){
 let ancestor=oldAncestor(c,level);var exact=NONE;var signal=inherited;
 if(ancestor!=NONE&&oldBricks[ancestor].info.y==level){exact=ancestor;signal=predicted(exact);}
 temp[id].cLevel=vec4<u32>(c,level);temp[id].kids0=vec4<u32>(NONE);temp[id].kids1=vec4<u32>(NONE);temp[id].relation=vec4<u32>(parent,NONE,exact,ancestor);temp[id].measured=signal;
 if(level>=ap.counts.w){temp[id].priority=vec4<f32>(0);return;}
 let width=4.0*exp2(-f32(level));let physicalWidth=width*ap.originPitch.w;let lo=ap.originPitch.xyz+vec3<f32>(c)*physicalWidth;var birth=vec4<f32>(0);
 for(var i=0u;i<ap.counts.z;i++){let s=supports[i];let overlap=max(vec3<f32>(0),min(lo+physicalWidth,s.hi.xyz)-max(lo,s.lo.xyz))/physicalWidth;let fraction=overlap.x*overlap.y*overlap.z;birth.y+=fraction*s.supply.y;birth.z+=fraction*s.supply.x;}
 let spread=ap.policy.x;var gain=1.0;
 if(spread>0.0){var factor=(1.0-exp(-spread))/spread;if(spread<.001){factor=1.0-spread*.5+spread*spread/6.0-spread*spread*spread/24.0;}gain=exp(-spread*f32(level))*factor;}
 let size=max(vec3<f32>(0),min(vec3<f32>(width),vec3<f32>(ap.dims.xyz)-vec3<f32>(c)*width));let volume=size.x*size.y*size.z/64.0;
 var persistence=1.0;if(exact!=NONE&&oldBricks[exact].kids0.x!=NONE){persistence+=ap.policy.y;}
 let priority=volume*dot(max(signal,birth),ap.weights)*gain*persistence/8.0;temp[id].priority=vec4<f32>(priority,0,0,0);if(priority>0.0){put(id);}
}
fn tmpChild(id:u32,j:u32)->u32{if(j<4u){return temp[id].kids0[j];}return temp[id].kids1[j-4u];}
fn indirect(offset:u32,count:u32){let x=min(count,ap.extra.z);nextState[offset]=x;nextState[offset+1u]=select(0u,(count+x-1u)/max(x,1u),count>0u);nextState[offset+2u]=1u;nextState[offset+3u]=count;}
@compute @workgroup_size(1) fn planAllocation(){
 heapSize=0u;nodeCount=ap.dims.w;let roots=(ap.dims.xyz+vec3<u32>(3))/4u;
 for(var i=0u;i<ap.counts.x;i++){nextState[ap.extra.y+i]=0u;}
 for(var level=0u;level<=ap.counts.w;level++){nextState[32u+4u*level+3u]=0u;}
 for(var i=0u;i<nodeCount;i++){let c=vec3<u32>(i%roots.x,(i/roots.x)%roots.y,i/(roots.x*roots.y));offer(i,c,0u,NONE,vec4<f32>(0));}
 loop{if(heapSize==0u||nodeCount+8u>ap.counts.x){break;}let parent=take();let p=temp[parent];
  for(var j=0u;j<8u;j++){let id=nodeCount;nodeCount++;let c=p.cLevel.xyz*2u+vec3<u32>(j&1u,(j>>1u)&1u,(j>>2u)&1u);if(j<4u){temp[parent].kids0[j]=id;}else{temp[parent].kids1[j-4u]=id;}offer(id,c,p.cLevel.w+1u,parent,p.measured);}
 }
 for(var i=0u;i<nodeCount;i++){let prior=temp[i].relation.z;if(prior!=NONE&&prior<ap.counts.x){temp[i].relation.y=prior;nextState[ap.extra.y+prior]=1u;}}
 var free=0u;
 for(var i=0u;i<nodeCount;i++){if(temp[i].relation.y==NONE){loop{if(nextState[ap.extra.y+free]==0u){break;}free++;}temp[i].relation.y=free;nextState[ap.extra.y+free]=1u;}}
 var changed=oldState[6]==0u||oldState[0]!=nodeCount||oldState[7]!=ap.counts.x;var leafCount=0u;var maxLevel=0u;
 for(var i=0u;i<nodeCount;i++){let t=temp[i];let slot=t.relation.y;let level=t.cLevel.w;let pitch=ap.originPitch.w*exp2(-f32(level));var n:AllocBrick;
  n.loPitch=vec4<f32>(ap.originPitch.xyz+vec3<f32>(t.cLevel.xyz)*4.0*pitch,pitch);n.kids0=vec4<u32>(NONE);n.kids1=n.kids0;
  if(t.kids0.x!=NONE){for(var j=0u;j<8u;j++){let child=temp[tmpChild(i,j)].relation.y;if(j<4u){n.kids0[j]=child;}else{n.kids1[j-4u]=child;}}
   let offset=32u+4u*level;let index=nextState[offset+3u];nextState[ap.listLayout.z+level*ap.listLayout.w+index]=slot;nextState[offset+3u]=index+1u;
  }else{nextState[ap.listLayout.y+leafCount]=slot;leafCount++;}
  var parent=NONE;if(t.relation.x!=NONE){parent=temp[t.relation.x].relation.y;}n.info=vec4<u32>(parent,level,select(0u,1u,t.kids0.x==NONE),t.relation.w+1u);
  nextBricks[slot]=n;nextState[ap.listLayout.x+i]=slot;maxLevel=max(maxLevel,level);
  if(!changed){let prior=t.relation.z;if(prior!=slot){changed=true;}else{let old=oldBricks[slot];if(any(old.kids0!=n.kids0)||any(old.kids1!=n.kids1)||old.info.y!=level){changed=true;}}}
 }
 nextState[0]=nodeCount;nextState[1]=leafCount;nextState[2]=oldState[2]+select(0u,1u,changed);nextState[3]=select(0u,1u,changed);nextState[4]=maxLevel;nextState[5]=ap.dims.w;nextState[6]=1u;nextState[7]=ap.counts.x;nextState[8]=ap.listLayout.x;nextState[9]=ap.listLayout.y;nextState[10]=ap.listLayout.z;nextState[11]=ap.listLayout.w;
 indirect(16u,nodeCount);indirect(20u,leafCount);indirect(24u,select(0u,nodeCount,changed));
 for(var level=0u;level<=ap.counts.w;level++){let offset=32u+4u*level;indirect(offset,nextState[offset+3u]);}
}
`;}
