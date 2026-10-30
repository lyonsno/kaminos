import {createGrainIndex} from './crust-spatial.mjs';
// Restricted, dimensionless capillary slots and surface-film strips. This is a
// material sketch, not a calibrated pore-network or nucleation model.
export const CRUST_MODEL = 'capillary-crust-strips-v1';
const PI=Math.PI, EPS=1e-12;
const DEFAULTS={feed:.012,salinity:1.8,evaporation:.003,mobility:12,growth:.008,nucleation:45,barrier:1.35};
const random=(seed,key)=>{let x=(Math.imul(seed^key,1597334677)^3812015801)>>>0;x=Math.imul(x^(x>>>16),2246822507);return ((x^(x>>>13))>>>0)/4294967296;};
const positive=(x,name)=>{if(!Number.isFinite(x)||x<0)throw Error('Invalid '+name);return x;};
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const reservoir=p=>p.kind==='face'||p.kind==='junction';
export function grainDimensions(g){return [g.faces[0]-g.faces[1],g.faces[4]-g.faces[5],g.faces[2]-g.faces[3]];}
export function grainVolume(g){return grainDimensions(g).reduce((a,b)=>a*b,1);}
export function grainCenter(g){const c=Math.cos(g.angle),sn=Math.sin(g.angle),x=(g.faces[0]+g.faces[1])/2,z=(g.faces[2]+g.faces[3])/2;return [g.x+c*x-sn*z,(g.faces[4]+g.faces[5])/2,g.z+sn*x+c*z];}
function radius(g,dx,dz){const c=Math.cos(g.angle),sn=Math.sin(g.angle),x=c*dx+sn*dz,z=-sn*dx+c*dz;const [w,,d]=grainDimensions(g);return Math.min(Math.abs(x)>EPS?w/2/Math.abs(x):Infinity,Math.abs(z)>EPS?d/2/Math.abs(z):Infinity);}
function addPool(s,grain,face){const p={id:s.pools.length,kind:'face',grain,face,water:0,salt:0,residue:0,hazard:0,births:0,threshold:-Math.log(Math.max(EPS,random(s.seed,s.pools.length+507)))};s.pools.push(p);return p.id;}
function addTrack(s,a,b,kind,carrier=null){const p={id:s.pools.length,kind,a,b,carrier,water:0,salt:0,residue:0,hazard:0,births:0,threshold:-Math.log(Math.max(EPS,random(s.seed,s.pools.length+507))),owner:a,connected:false,maxWetFraction:0,anchor:null};s.pools.push(p);return p.id;}
function addGrain(s,x,z,y,size,angle,authored,parent=null){const g={id:s.grains.length,x,z,angle,faces:[size[0]/2,-size[0]/2,size[2]/2,-size[2]/2,y+size[1],y],authored,parent,born:s.time,basePool:null,topPool:null};s.grains.push(g);return g;}
export function createCrust({rows=4,seed=31,settings={}}={}){
 if(!Number.isInteger(rows)||rows<1||!Number.isSafeInteger(seed))throw Error('Invalid crust setup');
 const s={model:CRUST_MODEL,seed,rows,time:0,tick:0,settings:{...DEFAULTS},grains:[],pools:[],sources:[],ledger:{initialWater:0,initialSalt:0,incomingWater:0,incomingSalt:0,evaporated:0,deposited:0},events:{nucleations:0,dryouts:0,closures:0}};
 for(let z=0;z<rows;z++)for(let x=0;x<rows;x++){
  const key=z*rows+x,w=.56+.21*random(seed,key+100),d=.52+.24*random(seed,key+200),h=.18+.28*random(seed,key+300);
  const g=addGrain(s,(x-(rows-1)/2)*1.05+(random(seed,key+400)-.5)*.1,(z-(rows-1)/2)*1.05+(random(seed,key+450)-.5)*.1,0,[w,h,d],(random(seed,key+500)-.5)*.35,true);
 }
 const count=Math.max(1,rows-1),junctions=[];
 for(let z=0;z<count;z++)for(let x=0;x<count;x++){
  const around=rows===1?[0]:[z*rows+x,z*rows+x+1,(z+1)*rows+x,(z+1)*rows+x+1],cx=around.reduce((a,id)=>a+s.grains[id].x,0)/around.length,cz=around.reduce((a,id)=>a+s.grains[id].z,0)/around.length;
  const id=addPool(s,null,'base');Object.assign(s.pools[id],{kind:'junction',walls:around,x:rows===1?cx-.6:cx,z:cz});junctions.push(id);if(x===0)s.sources.push(id);
 }
 for(let z=0;z<count;z++)for(let x=0;x<count;x++){
  const a=junctions[z*count+x];
  if(x+1<count){const id=addTrack(s,a,junctions[z*count+x+1],'gap');s.pools[id].walls=[z*rows+x+1,(z+1)*rows+x+1];}
  if(z+1<count){const id=addTrack(s,a,junctions[(z+1)*count+x],'gap');s.pools[id].walls=[(z+1)*rows+x,(z+1)*rows+x+1];}
 }
 for(const g of s.grains){
  g.basePool=junctions.reduce((best,id)=>Math.hypot(s.pools[id].x-g.x,s.pools[id].z-g.z)<Math.hypot(s.pools[best].x-g.x,s.pools[best].z-g.z)?id:best,junctions[0]);
  g.topPool=addPool(s,g.id,'top');addTrack(s,g.basePool,g.topPool,'film',g.id);
 }
 for(const id of s.sources){const p=s.pools[id];p.water=.012;p.salt=p.water*.92;}
 s.ledger.initialWater=s.pools.reduce((a,p)=>a+p.water,0);s.ledger.initialSalt=s.pools.reduce((a,p)=>a+p.salt,0);
 setCrustConditions(s,settings);return s;
}
export function setCrustConditions(s,patch){const next={...s.settings};for(const [k,v]of Object.entries(patch)){if(!(k in DEFAULTS))throw Error('Unknown crust condition '+k);next[k]=positive(v,k);}if(next.barrier<1)throw Error('Nucleation barrier must be at least saturation');if(!Number.isFinite(next.feed*next.salinity))throw Error('Incoming salt rate overflows the numeric representation');s.settings=next;return {...next};}
function poolPoint(s,p){if(p.kind==='junction')return [p.x,.018,p.z];if(p.kind==='face'){const g=s.grains[p.grain],c=grainCenter(g);if(p.face==='top')return [c[0],g.faces[4]+.002,c[2]];return [c[0],.018,c[2]];}if(p.anchor)return [...p.anchor];return trackGeometry(s,p).endpoints[0];}
function slotProfile(s,p,a,b,gap,depth){
 const length=Math.hypot(b[0]-a[0],b[2]-a[2]);if(gap<=0||length<=0)return {segments:[],volume:0,aperture:0};
 const tx=(b[0]-a[0])/length,tz=(b[2]-a[2])/length,nx=-tz,nz=tx,obstacles=[],cuts=[0,length];
 for(const grain of s.grains){
  if(grain.authored||grain.faces[5]>=depth||grain.faces[4]<=0)continue;
  const c=grainCenter(grain),d=grainDimensions(grain),co=Math.cos(grain.angle),sn=Math.sin(grain.angle),x=c[0]-a[0],z=c[2]-a[2],along=x*tx+z*tz,across=x*nx+z*nz;
  const support=(u,v)=>Math.abs(co*u+sn*v)*d[0]/2+Math.abs(-sn*u+co*v)*d[2]/2;
  const rt=support(tx,tz),rn=support(nx,nz)*clamp((grain.faces[4]-Math.max(0,grain.faces[5]))/depth,0,1),lo=clamp(along-rt,0,length),hi=clamp(along+rt,0,length);
  if(hi<=lo||across+rn<=-gap/2||across-rn>=gap/2)continue;
  obstacles.push({lo,hi,a:Math.max(-gap/2,across-rn),b:Math.min(gap/2,across+rn)});cuts.push(lo,hi);
 }
 cuts.sort((x,y)=>x-y);const segments=[];let volume=0,resistance=0;
 for(let i=1;i<cuts.length;i++){
  const lo=cuts[i-1],hi=cuts[i];if(hi<=lo)continue;const mid=(lo+hi)/2,blocked=obstacles.filter(o=>o.lo<=mid&&mid<=o.hi).sort((x,y)=>x.a-y.a),open=[];let at=-gap/2;
  for(const o of blocked){if(o.a>at)open.push([at,o.a]);at=Math.max(at,o.b);}if(at<gap/2)open.push([at,gap/2]);
  const widths=open.map(([x,y])=>y-x),moment=widths.reduce((n,w)=>n+w**3,0);volume+=(hi-lo)*depth*widths.reduce((n,w)=>n+w,0);resistance+=moment>0?(hi-lo)/moment:Infinity;segments.push({lo,hi,open});
 }
 return {segments,volume,aperture:Number.isFinite(resistance)?Math.cbrt(length/resistance):0,axis:[tx,tz],normal:[nx,nz]};
}
export function trackGeometry(s,p){
 if(typeof p==='number')p=s.pools[p];
 if(p.kind==='junction')return {capacity:.028,area:.16,pressure:.14,point:poolPoint(s,p),gap:null,length:0,aperture:.03};
 if(p.kind==='face'){
  const g=s.grains[p.grain],[w,,d]=grainDimensions(g),area=w*d,capacity=area*(p.face==='base'?.06:.016);
  return {capacity,area,pressure:p.face==='base'?.14:2.2,point:poolPoint(s,p),gap:null,length:0,aperture:.016};
 }
 let a=poolPoint(s,s.pools[p.a]),b=poolPoint(s,s.pools[p.b]),gap=.016,width=.075,points,profile=null;
 if(p.kind==='gap'){
  const ga=s.grains[p.walls[0]],gb=s.grains[p.walls[1]],ca=grainCenter(ga),cb=grainCenter(gb),dist=Math.hypot(cb[0]-ca[0],cb[2]-ca[2]),nx=(cb[0]-ca[0])/dist,nz=(cb[2]-ca[2])/dist,ra=radius(ga,nx,nz),rb=radius(gb,-nx,-nz);
  gap=dist-ra-rb;width=.035;points=[a,b];profile=slotProfile(s,p,a,b,gap,width);
 }else if(p.kind==='film'||p.kind==='branch'){
  a=p.anchor??a;
  const g=s.grains[p.carrier],c=grainCenter(g),[w,,d]=grainDimensions(g),dx=Math.cos(g.angle),dz=Math.sin(g.angle),toward=a[0]-c[0],towardZ=a[2]-c[2],sign=dx*toward+dz*towardZ>=0?1:-1;
  const foot=[c[0]+dx*w/2*sign,g.faces[5]+.005,c[2]+dz*w/2*sign];b=[c[0],g.faces[4]+.003,c[2]];points=[a,foot,[foot[0],g.faces[4]+.003,foot[2]],b];width=Math.min(w,d)*.19;
 }else{a=p.anchor??a;points=[a,b];width=Math.min(.07,grainDimensions(s.grains[s.pools[p.b].grain])[0]*.35);}
 const length=points.slice(1).reduce((n,x,i)=>n+Math.hypot(...x.map((v,j)=>v-points[i][j])),0),aperture=profile?profile.aperture:.016;
 return {capacity:Math.max(EPS,profile?profile.volume:Math.max(0,gap)*width*Math.max(EPS,length)),area:profile?profile.volume/width:width*length,pressure:p.kind==='gap'?(aperture>0?.24/aperture:0):2.4,length,aperture,width,gap,endpoints:[a,b],points,profile,closed:p.kind==='gap'&&aperture<=0};
}
export function trackPoint(s,p,fraction,g=trackGeometry(s,p)){const points=g.points;let at=clamp(fraction,0,1)*g.length;for(let i=1;i<points.length;i++){const d=Math.hypot(...points[i].map((v,j)=>v-points[i-1][j]));if(at<=d||i===points.length-1){const f=d>0?clamp(at/d,0,1):0;return points[i].map((v,j)=>points[i-1][j]+(v-points[i-1][j])*f);}at-=d;}return points.at(-1);}
export function interfaceState(s,p){if(typeof p==='number')p=s.pools[p];const g=trackGeometry(s,p),fraction=clamp(p.water/g.capacity,0,1);return {pool:p.id,kind:p.kind,fraction,water:p.water,concentration:p.water>0?p.salt/p.water:null,connected:p.connected??true,mode:g.closed?'closed':p.water<=0?'dry':p.connected&&fraction<1?'corner-film':fraction>=1?'filled':'advancing',...(reservoir(p)?{point:g.point}:{gap:g.gap,length:g.length,curvature:g.pressure/.12,point:trackPoint(s,p,p.owner===p.a?fraction:1-fraction,g),endpoints:g.endpoints})};}
// Exact relaxation for a pair of linearized capillary storage laws
// p=k(V/C-1). Stable for stiff thin films; carries salt with transferred liquid.
// This is an overdamped pair-split approximation, not global capillary equilibrium.
function exchange(a,b,ga,gb,conductance,dt,limit=Infinity){
 const total=a.water+b.water;if(total<=0||conductance<=0)return;
 const aa=ga.pressure/ga.capacity,bb=gb.pressure/gb.capacity;
 const equilibrium=clamp((ga.pressure-gb.pressure+bb*total)/(aa+bb),0,total);
 let moved=(a.water-equilibrium)*(-Math.expm1(-conductance*(aa+bb)*dt));
 if(moved>0)moved=Math.min(moved,a.water,limit);else moved=-Math.min(-moved,b.water);
 const donor=moved>=0?a:b,receiver=moved>=0?b:a,v=Math.abs(moved),salt=donor.water>0?donor.salt*(v/donor.water):0;
 donor.water=Math.max(0,donor.water-v);receiver.water+=v;donor.salt=Math.max(0,donor.salt-salt);receiver.salt+=salt;
}
function overlaps(a,b){
 if(a.faces[4]<=b.faces[5]+1e-10||b.faces[4]<=a.faces[5]+1e-10)return false;
 const ca=grainCenter(a),cb=grainCenter(b),da=grainDimensions(a),db=grainDimensions(b);
 for(const angle of [a.angle,a.angle+PI/2,b.angle,b.angle+PI/2]){
  const nx=Math.cos(angle),nz=Math.sin(angle);
  const support=(g,d)=>Math.abs(Math.cos(g.angle-angle))*d[0]/2+Math.abs(Math.sin(g.angle-angle))*d[2]/2;
  if(Math.abs((cb[0]-ca[0])*nx+(cb[2]-ca[2])*nz)>=support(a,da)+support(b,db)-1e-10)return false;
 }return true;
}
function spatial(s){const index=createGrainIndex(s.grains),query=g=>index.query(g);query.add=g=>index.update(g);return query;}
function growFace(s,g,volume,face,neighbors){
 if(volume<=0)return 0;const d=grainDimensions(g),area=face<2?d[1]*d[2]:face<4?d[0]*d[1]:d[0]*d[2],sign=face%2===0?1:-1,old=g.faces[face],delta=volume/area;
 g.faces[face]=old+sign*delta;
 const candidates=neighbors(g);let fraction=1;
 if([...candidates].some(other=>overlaps(g,other))){
  let lo=0,hi=1;while(hi-lo>1e-8){const f=(lo+hi)/2;g.faces[face]=old+sign*delta*f;if([...candidates].some(other=>overlaps(g,other)))hi=f;else lo=f;}fraction=lo;
 }
 g.faces[face]=old+sign*delta*fraction;neighbors.add(g);return volume*fraction;
}
function growFromPool(s,p,mass,neighbors){
 let targets=[];
 if(p.kind==='junction'){
  for(const id of p.walls){const g=s.grains[id],c=grainCenter(g),angle=Math.atan2(p.z-c[2],p.x-c[0])-g.angle;targets.push([id,Math.cos(angle)>0?0:1],[id,Math.sin(angle)>0?2:3]);}
 }else if(p.kind==='face')targets=p.face==='top'?[[p.grain,4]]:[0,1,2,3].map(f=>[p.grain,f]);
 else if(p.kind==='film'||p.kind==='branch'){
  const geom=trackGeometry(s,p),f=clamp(p.water/geom.capacity,0,1),wetLo=p.owner===p.a?0:1-f,wetHi=p.owner===p.a?f:1,points=geom.points;
  let at=0;for(let i=1;i<points.length;i++){const length=Math.hypot(...points[i].map((v,j)=>v-points[i-1][j])),lo=at/geom.length,hi=(at+length)/geom.length;at+=length;if(Math.min(wetHi,hi)<=Math.max(wetLo,lo))continue;
   if(i===2){const g=s.grains[p.carrier],c=grainCenter(g),from=points[1],sign=Math.cos(g.angle)*(from[0]-c[0])+Math.sin(g.angle)*(from[2]-c[2])>=0;targets.push([g.id,sign?0:1]);}else if(i===3)targets.push([p.carrier,4]);
  }
 }
 else if(p.kind==='gap'){
  const geom=trackGeometry(s,p),to=trackPoint(s,p,.5,geom);
  for(const id of p.walls){
   const g=s.grains[id],c=grainCenter(g),angle=Math.atan2(to[2]-c[2],to[0]-c[0])-g.angle;
   targets.push([g.id,Math.abs(Math.cos(angle))>=Math.abs(Math.sin(angle))?(Math.cos(angle)>0?0:1):(Math.sin(angle)>0?2:3)]);
  }
 }else{const q=s.pools[p.b];if(q.kind==='face')targets=[[q.grain,4],[q.grain,0],[q.grain,2]];}
 let consumed=0;for(let i=0;i<targets.length;i++){const [id,face]=targets[i],amount=(mass-consumed)/(targets.length-i);consumed+=growFace(s,s.grains[id],amount/8,face,neighbors)*8;}return consumed;
}
function birthSite(s,p,size){
 const key=p.id*19001+p.births*73+(p.attempts??0)*131,angle=2*PI*random(s.seed,key+71);let point,carrier=null,normal=[0,1,0],orientation=angle;
 if(p.kind==='junction'){
  const g=trackGeometry(s,p),r=Math.sqrt(g.area/PI)*Math.sqrt(clamp(p.water/g.capacity,0,1));point=[p.x+Math.cos(angle)*r,0,p.z+Math.sin(angle)*r];
 }else if(p.kind==='face'){
  const g=s.grains[p.grain],c=grainCenter(g),[w,,d]=grainDimensions(g),co=Math.cos(g.angle),sn=Math.sin(g.angle),sat=clamp(p.water/trackGeometry(s,p).capacity,0,1);
  if(p.face==='top'){const x=Math.cos(angle)*w*.42*Math.sqrt(sat),z=Math.sin(angle)*d*.42*Math.sqrt(sat);point=[c[0]+co*x-sn*z,g.faces[4],c[2]+sn*x+co*z];carrier=g.id;}
  else{const x=Math.cos(angle)*(w/2+size*.6),z=Math.sin(angle)*(d/2+size*.6);point=[c[0]+co*x-sn*z,0,c[2]+sn*x+co*z];}
 }else{
  const geom=trackGeometry(s,p),f=clamp(p.water/geom.capacity,0,1);point=trackPoint(s,p,p.owner===p.a?f:1-f,geom);
  if(p.kind==='film'||p.kind==='branch'){
   const g=s.grains[p.carrier];carrier=g.id;orientation=g.angle;const top=g.faces[4];
   const approach=Math.hypot(...geom.points[1].map((v,j)=>v-geom.points[0][j]));
   const at=(p.owner===p.a?f:1-f)*geom.length;
   if(at<approach){if(p.kind==='branch'&&point[1]>.03)return null;carrier=null;point[1]=0;}
   else if(point[1]<top-.002){const c=grainCenter(g),sign=Math.cos(g.angle)*(point[0]-c[0])+Math.sin(g.angle)*(point[2]-c[2])>=0?1:-1;normal=[Math.cos(g.angle)*sign,0,Math.sin(g.angle)*sign];point[0]+=normal[0]*(size/2+1e-9);point[2]+=normal[2]*(size/2+1e-9);point[1]=Math.max(size/2,point[1]);}
   else point[1]=top;
  }else{point[1]=0;}
 }
 const base=normal[1]===1?point[1]:point[1]-size/2;
 return {x:point[0],z:point[2],y:Math.max(0,base),angle:orientation,carrier,point};
}
function nucleate(s,p,geom,dt,neighbors){
 if(p.water<=0||geom.closed||s.settings.nucleation===0)return;
 const concentration=p.salt/p.water,excess=Math.log(concentration/s.settings.barrier);if(excess<=0)return;
 const exposed=geom.area*Math.min(1,p.water/geom.capacity);
 p.hazard+=s.settings.nucleation*exposed*excess*excess*dt;
 while(p.hazard>=p.threshold){
  // Critical nucleus length shrinks with chemical driving force. The constant
  // and cubic nucleus shape are explicitly phenomenological in model units.
  const current=p.salt/p.water;if(current<=s.settings.barrier)break;
  const size=.016/Math.log(current),mass=8*size**3;if(mass>Math.max(0,p.salt-p.water))break;
  const site=birthSite(s,p,size);if(!site)break;const candidate={id:s.grains.length,x:site.x,z:site.z,angle:site.angle,faces:[size/2,-size/2,size/2,-size/2,site.y+size,site.y]};
  p.hazard-=p.threshold;p.attempts=(p.attempts??0)+1;p.threshold=-Math.log(Math.max(EPS,random(s.seed,p.id*101+(p.attempts??0)*997+720)));
  if([...neighbors(candidate)].some(other=>overlaps(candidate,other)))continue;
  const child=addGrain(s,site.x,site.z,site.y,[size,size,size],site.angle,false,site.carrier);child.topPool=addPool(s,child.id,'top');child.basePool=child.topPool;
  const branch=addTrack(s,p.id,child.topPool,'branch',child.id);s.pools[branch].anchor=[...site.point];
  neighbors.add(child);p.salt-=mass;p.births++;s.events.nucleations++;s.ledger.deposited+=mass;
 }
}
function step(s,dt){
 const original=s.pools.length,geoms=s.pools.map(p=>trackGeometry(s,p));
 for(const id of s.sources){const volume=s.settings.feed*dt/s.sources.length;s.pools[id].water+=volume;s.pools[id].salt+=volume*s.settings.salinity;s.ledger.incomingWater+=volume;s.ledger.incomingSalt+=volume*s.settings.salinity;}
 // Alternating sweep reduces directional splitting bias. No flow is discarded.
 const ids=Array.from({length:original},(_,i)=>i);if(s.tick%2)ids.reverse();
 for(const id of ids){
  const e=s.pools[id];if(reservoir(e))continue;const g=geoms[id];
  if(g.closed){if(!e.wasClosed)s.events.closures++;e.wasClosed=true;continue;}e.wasClosed=false;
  const a=s.pools[e.a],b=s.pools[e.b];
  if(e.water===0&&!e.connected)e.owner=a.water>=b.water?e.a:e.b;
  const fraction=clamp(e.water/g.capacity,0,1),history=Math.max(fraction,e.maxWetFraction),wetLength=Math.max(g.aperture,g.length*history),retained=history>0?Math.min(1,fraction/history):1,conductance=s.settings.mobility*g.width*g.aperture**3/(12*wetLength)*retained**3;
  const owner=s.pools[e.owner],other=s.pools[e.owner===e.a?e.b:e.a];
  exchange(owner,e,geoms[owner.id],g,conductance,dt,e.connected?Infinity:Math.max(0,g.capacity-e.water));
  if(e.water>=g.capacity*(1-1e-10))e.connected=true;e.maxWetFraction=Math.max(e.maxWetFraction,Math.min(1,e.water/g.capacity));
  if(e.connected&&e.water>0)exchange(e,other,g,geoms[other.id],conductance,dt);
  if(e.water===0){e.connected=false;e.maxWetFraction=0;}
 }
 const neighbors=spatial(s);
 for(let id=0;id<original;id++){
  const p=s.pools[id],g=geoms[id];if(p.water<=0)continue;
  const dissolved=Math.min(p.residue,Math.max(0,p.water-p.salt));p.residue-=dissolved;p.salt+=dissolved;
  const area=g.area*clamp(p.water/g.capacity,0,1),evap=Math.min(p.water,s.settings.evaporation*area*dt);p.water-=evap;s.ledger.evaporated+=evap;
  if(p.water>0){
   nucleate(s,p,g,dt,neighbors);
   const concentration=p.salt/p.water,excess=Math.max(0,p.salt-p.water),requested=Math.min(excess,s.settings.growth*area*Math.max(0,concentration-1)*dt);
   const consumed=growFromPool(s,p,requested,neighbors);p.salt-=consumed;s.ledger.deposited+=consumed;
  }else{
   const consumed=growFromPool(s,p,p.salt,neighbors);p.salt-=consumed;s.ledger.deposited+=consumed;p.residue+=p.salt;p.salt=0;s.events.dryouts++;
  }
 }
 s.time+=dt;s.tick++;
}
export function advanceCrust(s,seconds){positive(seconds,'duration');const target=s.time+seconds;if(!Number.isFinite(target))throw Error('Model time overflows the numeric representation');const whole=Math.floor((seconds+1e-12)/.1);if(!Number.isSafeInteger(whole)||!Number.isSafeInteger(s.tick+whole))throw Error('Requested evolution exceeds exact step indexing');for(let i=0;i<whole;i++)step(s,.1);const remainder=seconds-whole*.1;if(remainder>1e-12)step(s,remainder);return readCrust(s);}
export function saveCrust(s){return structuredClone(s);}
export function restoreCrust(value){
 const s=structuredClone(value);if(s?.model!==CRUST_MODEL)throw Error('Unknown crust model');
 if(!Array.isArray(s.grains)||!Array.isArray(s.pools)||!Array.isArray(s.sources)||!s.sources.length)throw Error('Invalid crust arrays');
 positive(s.time,'time');if(!Number.isSafeInteger(s.tick)||s.tick<0||!Number.isSafeInteger(s.rows)||s.rows<1||!Number.isSafeInteger(s.seed))throw Error('Invalid crust clock or setup');
 if(!s.settings||Object.keys(s.settings).length!==Object.keys(DEFAULTS).length||Object.keys(DEFAULTS).some(k=>!(k in s.settings)))throw Error('Incomplete crust conditions');setCrustConditions(s,s.settings);
 for(const k of ['initialWater','initialSalt','incomingWater','incomingSalt','evaporated','deposited'])positive(s.ledger?.[k],'ledger '+k);
 for(const k of ['nucleations','dryouts','closures'])if(!Number.isSafeInteger(s.events?.[k])||s.events[k]<0)throw Error('Invalid event counter');
 for(const [i,g]of s.grains.entries())if(g.id!==i||g.faces?.length!==6||![g.x,g.z,g.angle,...g.faces].every(Number.isFinite)||grainDimensions(g).some(x=>x<=0)||typeof g.authored!=='boolean'||g.parent!=null&&(!s.grains[g.parent]||g.parent>=i))throw Error('Invalid grain');
 for(const [i,p]of s.pools.entries()){
  if(p.id!==i||!['face','junction','gap','film','branch'].includes(p.kind))throw Error('Invalid pool');for(const k of ['water','salt','residue','hazard','births','threshold'])positive(p[k],k);if(p.threshold===0||!Number.isSafeInteger(p.births))throw Error('Invalid nucleation clock');
  if(p.anchor!=null&&(!Array.isArray(p.anchor)||p.anchor.length!==3||!p.anchor.every(Number.isFinite)))throw Error('Invalid film anchor');
  if(p.kind==='junction'){if(![p.x,p.z].every(Number.isFinite)||!Array.isArray(p.walls)||p.walls.some(id=>!Number.isSafeInteger(id)||!s.grains[id]))throw Error('Invalid junction');}
  else if(p.kind==='face'){if(!s.grains[p.grain]||!['base','top'].includes(p.face))throw Error('Invalid face');}
  else{if(!Number.isSafeInteger(p.a)||!Number.isSafeInteger(p.b)||!s.pools[p.a]||!s.pools[p.b]||p.a>=i||p.b>=i||p.a===p.b||![p.a,p.b].includes(p.owner)||typeof p.connected!=='boolean'||!Number.isFinite(p.maxWetFraction)||p.maxWetFraction<0||p.maxWetFraction>1)throw Error('Invalid track endpoints or wetting history');}
  if(p.kind==='gap'&&(!Array.isArray(p.walls)||p.walls.length!==2||p.walls.some(id=>!s.grains[id])))throw Error('Invalid gap walls');if((p.kind==='film'||p.kind==='branch')&&!s.grains[p.carrier])throw Error('Invalid film carrier');
 }
 if(s.sources.some(id=>!Number.isSafeInteger(id)||s.pools[id]?.kind!=='junction'))throw Error('Invalid brine source');
 for(const g of s.grains)if(s.pools[g.topPool]?.grain!==g.id||s.pools[g.topPool]?.kind!=='face')throw Error('Missing crystal liquid state');
 return s;
}
export function readCrust(s){const water=s.pools.reduce((a,p)=>a+p.water,0),solute=s.pools.reduce((a,p)=>a+p.salt,0),residue=s.pools.reduce((a,p)=>a+p.residue,0);return {model:s.model,time:s.time,tick:s.tick,settings:{...s.settings},grains:s.grains.length,authored:s.grains.filter(g=>g.authored).length,nuclei:s.events.nucleations,tracks:s.pools.filter(p=>!reservoir(p)).length,wet:s.pools.filter(p=>p.water>0).length,connected:s.pools.filter(p=>p.connected).length,water,solute,unresolvedDrySalt:residue,deposited:s.ledger.deposited,waterError:water+s.ledger.evaporated-s.ledger.initialWater-s.ledger.incomingWater,saltError:solute+residue+s.ledger.deposited-s.ledger.initialSalt-s.ledger.incomingSalt,events:{...s.events},provenance:'Authored seed grains; reduced capillary slots and one-sided surface-film strips; phenomenological interfacial nucleation; dimensionless, uncalibrated'};}
