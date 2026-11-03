import {faceFrame,facePoint,faceUV,facePatch} from './crust-faces.mjs';
import {refreshBridges} from './crust-bridges.mjs';
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const keys=['water','salt','residue','hazard','births'];
export function syncFace(p){for(const key of keys)p[key]=p.regions.reduce((n,r)=>n+r[key],0);}
export function addWetRegion(s,p,entry,water=0,salt=0){
 const serial=s.nextRegion++,x=Math.sin((serial+1)*127.1+s.seed*311.7)*43758.5453;
 const r={id:serial,water,salt,residue:0,hazard:0,births:0,attempts:0,threshold:-Math.log(Math.max(1e-12,x-Math.floor(x))),lobes:[{entry:[...entry],share:1}]};
 p.regions.push(r);syncFace(p);return r;
}
// Disjoint rectangles describe the exact union for area, rendering and birth
// sampling. Their edges are a reduced film footprint, not ornamental noise.
function unionRects(rects){
 const xs=[...new Set(rects.flatMap(r=>[r.lo[0],r.hi[0]]))].sort((a,b)=>a-b),out=[];
 for(let i=1;i<xs.length;i++){
  const lo=xs[i-1],hi=xs[i];if(hi-lo<1e-14)continue;
  const intervals=rects.filter(r=>r.lo[0]<hi&&r.hi[0]>lo).map(r=>[r.lo[1],r.hi[1]]).sort((a,b)=>a[0]-b[0]);
  let current=null;
  for(const r of intervals){if(current&&r[0]<=current[1])current[1]=Math.max(current[1],r[1]);else{if(current)out.push({lo:[lo,current[0]],hi:[hi,current[1]]});current=[...r];}}
  if(current)out.push({lo:[lo,current[0]],hi:[hi,current[1]]});
 }
 return out;
}
export function regionRects(s,p,r){
 if(r.water<=0)return [];
 return unionRects(r.lobes.map(l=>facePatch(s,{...p,water:r.water*l.share,entry:l.entry})));
}
export function regionFronts(rects){
 const out=[];
 for(const r of rects)for(let axis=0;axis<2;axis++)for(const side of ['lo','hi']){
  const along=1-axis,fixed=r[side][axis];let spans=[[r.lo[along],r.hi[along]]];
  for(const q of rects){if(q===r||Math.abs(q[side==='lo'?'hi':'lo'][axis]-fixed)>1e-10)continue;
   spans=spans.flatMap(([a,b])=>{const lo=Math.max(a,q.lo[along]),hi=Math.min(b,q.hi[along]);if(hi<=lo)return [[a,b]];return [...(lo>a?[[a,lo]]:[]),...(hi<b?[[hi,b]]:[])];});
  }
  for(const [a,b]of spans){const x=[0,0],y=[0,0];x[axis]=y[axis]=fixed;x[along]=a;y[along]=b;out.push([x,y]);}
 }
 return out;
}
export function regionArea(s,p,r){const f=faceFrame(s.grains[p.grain],p.face);return regionRects(s,p,r).reduce((n,q)=>n+(q.hi[0]-q.lo[0])*(q.hi[1]-q.lo[1])*f.w*f.h,0);}
const touches=(a,b)=>a.lo.every((v,i)=>v<=b.hi[i]+1e-10&&a.hi[i]>=b.lo[i]-1e-10);
export function mergeWetRegions(s,p){
 // A previously connected film may separate as it dries. Each resulting spot
 // inherits its share of the formerly mixed water and salt, then evolves alone.
 const separated=[];
 for(const r of p.regions){
  if(r.water<=0||r.lobes.length===1){separated.push(r);continue;}
  const rects=r.lobes.map(l=>facePatch(s,{...p,water:r.water*l.share,entry:l.entry})),remaining=new Set(rects.map((_,i)=>i)),groups=[];
  while(remaining.size){const group=[remaining.values().next().value];remaining.delete(group[0]);for(let k=0;k<group.length;k++)for(const j of remaining)if(touches(rects[group[k]],rects[j])){remaining.delete(j);group.push(j);}groups.push(group);}
  if(groups.length===1){separated.push(r);continue;}
  for(const [i,group]of groups.entries()){
   const share=group.reduce((n,j)=>n+r.lobes[j].share,0),part={...r,id:i===0?r.id:s.nextRegion++,lobes:group.map(j=>({...r.lobes[j],share:r.lobes[j].share/share}))};
   for(const key of ['water','salt','residue','hazard'])part[key]=r[key]*share;
   // Event counts belong to the historical original, not fractional children.
   if(i>0){part.births=0;part.attempts=0;}
   separated.push(part);
  }
 }
 p.regions=separated;
 let again=true;
 while(again){again=false;
  outer:for(let i=0;i<p.regions.length;i++)for(let j=i+1;j<p.regions.length;j++){
   const a=p.regions[i],b=p.regions[j];if(a.water<=0||b.water<=0)continue;
   if(!regionRects(s,p,a).some(x=>regionRects(s,p,b).some(y=>touches(x,y))))continue;
   const total=a.water+b.water;
   a.lobes=[...a.lobes.map(l=>({...l,share:l.share*a.water/total})),...b.lobes.map(l=>({...l,share:l.share*b.water/total}))];
   for(const key of keys)a[key]+=b[key];a.attempts+=b.attempts;p.regions.splice(j,1);again=true;break outer;
  }
 }
 syncFace(p);
}
function contactPoint(s,p,r,uv,extent=[0,0]){for(const q of regionRects(s,p,r)){if(uv.every((v,i)=>v+extent[i]>=q.lo[i]-1e-9&&v-extent[i]<=q.hi[i]+1e-9))return uv.map((v,i)=>(Math.max(v-extent[i],q.lo[i])+Math.min(v+extent[i],q.hi[i]))/2);}return null;}
function reaches(s,p,r,uv,extent){return contactPoint(s,p,r,uv,extent)!==null;}
function at(s,p,uv){
 return p.regions.find(r=>reaches(s,p,r,uv))??p.regions.find(r=>r.water===0&&r.lobes.some(l=>l.entry.every((v,i)=>Math.abs(v-uv[i])<1e-9)))??addWetRegion(s,p,uv);
}
function edgePort(s,p,r,mid){
 for(const q of regionRects(s,p,r)){
  const fixed=Math.abs(mid[0]-.5)>.25?0:1,along=1-fixed;
  if(mid[fixed]<q.lo[fixed]-1e-9||mid[fixed]>q.hi[fixed]+1e-9)continue;
  const uv=[...mid];uv[along]=(q.lo[along]+q.hi[along])/2;return uv;
 }
 return null;
}
export function stepWetRegions(s,dt,{geometry,exchange,react,neighbors}){
 refreshBridges(s);
 for(const id of s.sources){const p=s.pools[id],v=s.settings.feed*dt/s.sources.length;p.water+=v;p.salt+=v*s.settings.salinity;s.ledger.incomingWater+=v;s.ledger.incomingSalt+=v*s.settings.salinity;}
 for(const p of s.pools)if(p.regions)mergeWetRegions(s,p);
 const original=s.pools.length,geoms=s.pools.map(p=>geometry(s,p)),requests=[],seen=new Set();
 const bridgeContacts=new Map(s.pools.filter(p=>p.kind==='bridge').map(e=>[e.id,[s.pools[e.a].regions.find(r=>reaches(s,s.pools[e.a],r,e.portA)),s.pools[e.b].regions.find(r=>reaches(s,s.pools[e.b],r,e.portB))]]));
 // Resolve all exposed contacts before any pair drains a spot. Multiple
 // disconnected arrivals on one face acquire independent retained reservoirs.
 for(const e of s.pools){
  if(e.kind!=='edge')continue;
  const a=s.pools[e.a],b=s.pools[e.b];
  for(const [from,to,portFrom,portTo,extent]of [[a,b,e.portA,e.portB,e.contactA],[b,a,e.portB,e.portA,e.contactB]]){
   for(const r of from.regions??[from]){
    if(r.water<=0)continue;
    const uv=from.regions?(e.surfaceEdge?edgePort(s,from,r,portFrom):contactPoint(s,from,r,portFrom,extent)):null;
    if(from.regions&&!uv)continue;
    const dest=from.regions&&to.regions?faceUV(s.grains[from.grain],to.face,facePoint(s.grains[from.grain],from.face,uv)).map(v=>clamp(v,0,1)):portTo;
    const other=to.regions?at(s,to,dest):to;
    const ka=from.regions?'r'+r.id:'p'+from.id,kb=to.regions?'r'+other.id:'p'+to.id,key=e.id+':'+[ka,kb].sort().join(':');
    if(seen.has(key))continue;seen.add(key);
    requests.push({e,a:r,b:other,ga:geoms[from.id],gb:geoms[to.id]});
   }
  }
 }
 if(s.tick%2)requests.reverse();
 for(const {e,a,b,ga,gb}of requests){const g=geoms[e.id],conductance=s.settings.mobility*g.width*g.aperture**3/(12*g.length);exchange(a,b,ga,gb,conductance,dt);e.connected=a.water>0&&b.water>0;}
 const bridges=s.pools.filter(p=>p.kind==='bridge');if(s.tick%2)bridges.reverse();
 for(const e of bridges){
  const g=geoms[e.id];if(g.closed){if(!e.wasClosed)s.events.closures++;e.wasClosed=true;continue;}e.wasClosed=false;
  const pa=s.pools[e.a],pb=s.pools[e.b];
  let [a,b]=bridgeContacts.get(e.id);
  if(e.water<g.capacity*(1-1e-10))e.connected=false;
  if(!a&&!b&&!e.connected)continue;
  if(!e.connected){
   e.owner=a&&(!b||a.water>=b.water)?e.a:e.b;
   const donor=e.owner===e.a?a:b,donorFace=e.owner===e.a?pa:pb;
   // An advancing meniscus has suction before the bridge is full. Treating
   // the empty gap as an ordinary filled reservoir would stall it forever.
   const front={...g,pressure:0,offset:-.24/g.aperture};
   if(donor)exchange(donor,e,geoms[donorFace.id],front,s.settings.mobility*g.conductance,dt,Math.max(0,g.capacity-e.water),true,false);
   if(e.water>=g.capacity*(1-1e-10))e.connected=true;
  }
  if(e.connected){
   a??=at(s,pa,e.portA);b??=at(s,pb,e.portB);
   // Reserve the liquid that fills the gap; flow through that filled passage
   // exchanges the two local supplies. A shrinking gap returns excess liquid.
   const excess=Math.max(0,e.water-g.capacity);
   if(excess>0){const receiver=e.owner===e.a?a:b,salt=e.salt*excess/e.water;e.water-=excess;e.salt-=salt;receiver.water+=excess;receiver.salt+=salt;}
   const ca=a.water>0?a.salt/a.water:0,cb=b.water>0?b.salt/b.water:0;
   const moved=exchange(a,b,geoms[pa.id],geoms[pb.id],s.settings.mobility*g.conductance,dt)??0,v=Math.abs(moved),concentration=moved>=0?ca:cb,receiver=moved>=0?b:a;
   // Flush the bridge's retained salt as a mixed pore volume. Direct endpoint
   // exchange already transported incoming concentration * v; add its correction.
   const correction=(e.salt-concentration*e.water)*(-Math.expm1(-v/e.water));
   e.salt-=correction;receiver.salt+=correction;e.throughput=(e.throughput??0)+v;e.lastFlux=moved;

  }
  e.maxWetFraction=Math.max(e.maxWetFraction,clamp(e.water/g.capacity,0,1));
 }
 // React each retained spot separately. Growth's half steps straddle birth so
 // neither reaction receives an unconditional first claim to all excess salt.
 for(let id=0;id<original;id++){
  const p=s.pools[id],g=geoms[id];if(p.regions){
   mergeWetRegions(s,p);
   for(const r of p.regions){
    const proxy={...p,...r,id:p.id,regionId:r.id,rects:regionRects(s,p,r)};
    proxy.fronts=regionFronts(proxy.rects);react(proxy,g,dt,neighbors,regionArea(s,p,r));
    for(const key of [...keys,'attempts','threshold'])r[key]=proxy[key];
   }
   syncFace(p);
  }else if(p.kind==='junction'||p.kind==='bridge')react(p,g,dt,neighbors,g.closed?0:g.area*clamp(p.water/g.capacity,0,1));
 }
 for(const p of s.pools)if(p.regions)syncFace(p);
 s.time+=dt;s.tick++;
}
export function validateRegions(s){
 if(!Number.isSafeInteger(s.nextRegion)||s.nextRegion<0||!Number.isFinite(s.bridgeReach)||s.bridgeReach<=0)throw Error('Invalid wet-region model settings');
 const seen=new Set();
 for(const p of s.pools.filter(p=>p.kind==='face')){
  if(!Array.isArray(p.regions))throw Error('Missing wet regions');
  for(const r of p.regions){
   if(!Number.isSafeInteger(r.id)||r.id<0||r.id>=s.nextRegion||seen.has(r.id))throw Error('Invalid wet region identity');seen.add(r.id);
   for(const key of [...keys,'threshold','attempts'])if(!Number.isFinite(r[key])||r[key]<0)throw Error('Invalid wet region '+key);
   if(!Number.isSafeInteger(r.births)||!Number.isSafeInteger(r.attempts)||r.threshold<=0)throw Error('Invalid wet region birth clock');
   if(!Array.isArray(r.lobes)||!r.lobes.length||r.lobes.some(l=>!Number.isFinite(l.share)||l.share<=0||l.entry?.length!==2||l.entry.some(v=>!Number.isFinite(v)||v<0||v>1))||Math.abs(r.lobes.reduce((n,l)=>n+l.share,0)-1)>1e-9)throw Error('Invalid wet footprint');
  }
  for(const key of keys)if(Math.abs(p[key]-p.regions.reduce((n,r)=>n+r[key],0))>1e-10*Math.max(1,p[key]))throw Error('Wet-region total disagrees with face');
 }
}
