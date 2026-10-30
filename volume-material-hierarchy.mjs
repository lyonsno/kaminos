// CPU topology/policy; material never comes back to the CPU in the live route.
export const ALLOCATION_DEFAULTS=Object.freeze({budget:1,spread:1,maxDetail:2,persistence:.2,lookahead:1,weights:Object.freeze({reaction:1,mixing:1,thermal:.5,smoke:.25})});
export function validateAllocation(input={}){
 const o={...ALLOCATION_DEFAULTS,...input,weights:{...ALLOCATION_DEFAULTS.weights,...input.weights}};
 for(const k of ['budget','spread','persistence','lookahead'])if(!Number.isFinite(o[k])||o[k]<0)throw Error(`Invalid allocation ${k}`);
 if(!Number.isSafeInteger(o.maxDetail)||o.maxDetail<0)throw Error('Invalid allocation maxDetail');
 for(const [k,v] of Object.entries(o.weights))if(!['reaction','mixing','thermal','smoke'].includes(k)||!Number.isFinite(v)||v<0)throw Error(`Invalid allocation weight ${k}`);
 return o;
}
export function detailUtility(depth,spread){return spread===0?depth:-Math.expm1(-spread*depth)/spread;}
export function materialImportance(signal={},weights=ALLOCATION_DEFAULTS.weights){
 let sum=0;
 for(const [k,w] of Object.entries(weights)){
  const value=signal[k]??0;
  if(!Number.isFinite(value))throw Error(`Material demand ${k} must be finite`);
  sum+=w*Math.max(0,value);
 }
 if(!Number.isFinite(sum))throw Error('Material importance must be finite');
 return sum;
}
const key=(level,c)=>`${level}:${c.join(':')}`;
export class MaterialHierarchy{
 constructor({dims,brick=4,options={}}){
  if(brick!==4||dims.length!==3||dims.some(n=>!Number.isSafeInteger(n)||n<2))throw Error('Hierarchy base dimensions must be positive integer cell counts');
  this.dims=dims;this.brick=brick;this.options=validateAllocation(options);this.roots=[];
  const d=dims.map(n=>Math.ceil(n/brick));
  for(let z=0;z<d[2];z++)for(let y=0;y<d[1];y++)for(let x=0;x<d[0];x++)this.roots.push({key:key(0,[x,y,z]),level:0,c:[x,y,z],slot:this.roots.length});
  this.nodes=this.roots.map(n=>({...n}));this.signals=new Map();
 }
 get capacity(){return this.roots.length+8*Math.floor(this.roots.length*this.options.budget/8);}
 configure(patch){this.options=validateAllocation({...this.options,...patch,weights:{...this.options.weights,...patch.weights}});return this.allocate(this.signals);}
 allocate(signals=new Map()){
  this.signals=signals;
  const old=new Map(this.nodes.map(n=>[n.key,n])),nodes=this.roots.map(n=>({...n,children:null}));
  const heap=[];
  const put=n=>{heap.push(n);let i=heap.length-1;while(i){const p=(i-1)>>1;if(heap[p].priority>=n.priority)break;heap[i]=heap[p];i=p;}heap[i]=n;};
  const take=()=>{const top=heap[0],last=heap.pop();if(heap.length){let i=0;while(i*2+1<heap.length){let c=i*2+1;if(c+1<heap.length&&heap[c+1].priority>heap[c].priority)c++;if(heap[c].priority<=last.priority)break;heap[i]=heap[c];i=c;}heap[i]=last;}return top;};
  const offer=(n,inherited={})=>{
   n.signal=signals.get(n.key)??inherited;
   if(n.level>=this.options.maxDetail)return;
   const gain=detailUtility(n.level+1,this.options.spread)-detailUtility(n.level,this.options.spread);
   const importance=materialImportance(n.signal,this.options.weights);
   const volume=n.c.reduce((v,c,a)=>v*Math.max(0,Math.min(4/2**n.level,this.dims[a]-c*4/2**n.level)),1)/64;
   n.priority=volume*importance*gain*(old.get(n.key)?.children?1+this.options.persistence:1)/8;
   if(n.priority>0)put(n);
  };
  for(const n of nodes)offer(n);
  while(heap.length&&nodes.length+8<=this.capacity){
   const n=take();n.children=[];
   for(let oct=0;oct<8;oct++){
    const c=n.c.map((v,a)=>2*v+((oct>>a)&1)),child={key:key(n.level+1,c),level:n.level+1,c,parent:n.key,oct,children:null};
    nodes.push(child);n.children.push(child.key);offer(child,n.signal);
   }
  }
  // Root identities never move. Remaining surviving nodes keep their slots
  // while capacity permits; reducing capacity migrates via explicit old slots.
  const occupied=new Set(),created=[],moves=[];
  for(const n of nodes){const prior=old.get(n.key);if(prior&&prior.slot<this.capacity){n.slot=prior.slot;occupied.add(n.slot);}}
  let free=0;
  for(const n of nodes){if(n.slot===undefined){while(occupied.has(free))free++;n.slot=free;occupied.add(free);}const prior=old.get(n.key);if(!prior)created.push(n);else if(prior.slot!==n.slot)moves.push({from:prior.slot,to:n.slot,key:n.key});}
  const byKey=new Map(nodes.map(n=>[n.key,n]));
  for(const n of nodes){n.childSlots=n.children?.map(k=>byKey.get(k).slot)??null;n.parentSlot=n.parent?byKey.get(n.parent).slot:0xffffffff;}
  this.nodes=nodes;
  return {nodes,leaves:nodes.filter(n=>!n.children),created,moves,retired:[...old.values()].filter(n=>!byKey.has(n.key)),cost:nodes.length*64,capacity:this.capacity};
 }
}
export function prolongBrick(parent,b=4,channels=8){
 return Array.from({length:8},(_,oct)=>{
  const out=new Float32Array(b**3*channels),offset=[oct%2,(oct>>1)%2,oct>>2].map(v=>v*b);
  for(let z=0;z<b;z++)for(let y=0;y<b;y++)for(let x=0;x<b;x++){
   const c=[x,y,z].map((v,i)=>Math.floor((v+offset[i])/2)),src=(c[0]+b*(c[1]+b*c[2]))*channels,dst=(x+b*(y+b*z))*channels;
   out.set(parent.subarray(src,src+channels),dst);
  }return out;
 });
}
export function restrictBrick(children,b=4,channels=8){
 const out=new Float32Array(b**3*channels);
 for(let z=0;z<b;z++)for(let y=0;y<b;y++)for(let x=0;x<b;x++)for(let ch=0;ch<channels;ch++){
  let v=0;for(let dz=0;dz<2;dz++)for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){
   const c=[2*x+dx,2*y+dy,2*z+dz],o=c.map(v=>Math.floor(v/b)),local=c.map(v=>v%b);
   v+=children[o[0]+2*(o[1]+2*o[2])][(local[0]+b*(local[1]+b*local[2]))*channels+ch]/8;
  }out[(x+b*(y+b*z))*channels+ch]=v;
 }return out;
}
// Transport guard: expand measured leaf support by its interpolation footprint
// and observed motion over the asynchronous feedback interval. This spends the
// same pool budget; it predicts demand, never creates material or velocity.
export function predictDemand(nodes,signals,{dims,basePitch,horizon}){
 const fields=['reaction','mixing','thermal','smoke'];
 const result=new Map(nodes.map(n=>[n.key,{...signals.get(n.key)}]));
 const byKey=new Map(nodes.map(n=>[n.key,n]));
 const roots=dims.map(n=>Math.ceil(n/4));
 const box=n=>{const width=4/2**n.level;return {lo:n.c.map(c=>c*width),hi:n.c.map((c,a)=>Math.min((c+1)*width,dims[a]))};};
 for(const source of nodes.filter(n=>!n.children)){
  const signal=signals.get(source.key);if(!signal||!fields.some(k=>signal[k]>0))continue;
  const b=box(source),reach=(signal.motion??[0,0,0]).map(v=>Math.abs(v)*horizon/basePitch+1/2**source.level);
  const lo=b.lo.map((v,a)=>v-reach[a]),hi=b.hi.map((v,a)=>v+reach[a]);
  const visit=n=>{
   const nb=box(n);if(nb.lo.some((v,a)=>v>=hi[a]||nb.hi[a]<=lo[a]))return;
   if(n.children){for(const child of n.children)visit(byKey.get(child));return;}
   const dst=result.get(n.key);for(const k of fields)dst[k]=Math.max(dst[k]??0,signal[k]??0);
  };
  const first=lo.map(v=>Math.max(0,Math.floor(v/4))),last=hi.map((v,a)=>Math.min(roots[a]-1,Math.floor(v/4)));
  for(let z=first[2];z<=last[2];z++)for(let y=first[1];y<=last[1];y++)for(let x=first[0];x<=last[0];x++)visit(byKey.get(key(0,[x,y,z])));
 }
 // Parents describe average demand over their volume, not the strongest child.
 for(const n of [...nodes].sort((a,b)=>b.level-a.level))if(n.children){
  const dst=result.get(n.key);for(const k of fields)dst[k]=n.children.reduce((sum,c)=>sum+(result.get(c)[k]??0),0)/8;
 }
 return result;
}
