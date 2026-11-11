import {checkedMechanism,frames,pistonMountPoint} from './model.mjs';
import {bodyLayout} from './bodies.mjs';
const clamp=x=>Math.max(0,Math.min(1,x)),sub=(a,b)=>a.map((x,i)=>x-b[i]),add=(a,b)=>a.map((x,i)=>x+b[i]),mul=(a,s)=>a.map(x=>x*s),dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0),norm=a=>Math.hypot(...a);
export function segmentDistance(p,q,r,s){
 const u=sub(q,p),v=sub(s,r),w=sub(p,r),a=dot(u,u),b=dot(u,v),c=dot(v,v),d=dot(u,w),e=dot(v,w);let x=0,y=0;
 if(a<1e-24)y=c<1e-24?0:clamp(e/c);else if(c<1e-24)x=clamp(-d/a);else{const den=a*c-b*b;x=den>1e-24?clamp((b*e-c*d)/den):0;y=(b*x+e)/c;if(y<0){y=0;x=clamp(-d/a);}else if(y>1){y=1;x=clamp((b-d)/a);}}
 const pa=add(p,mul(u,x)),pb=add(r,mul(v,y));return {distance:norm(sub(pa,pb)),a:pa,b:pb,parameters:[x,y]};
}
export function constructionKey(value){return JSON.stringify(checkedMechanism(value));}
function speeds(m){const out=[];m.nodes.forEach(n=>{if(n.parent===null)out.push({v:0,w:0});else{const p=out[n.parent],w=p.w+Math.abs(n.angles[1]-n.angles[0]);out.push({v:p.v+n.length*w,w});}});return out;}
function definitions(m,layout=bodyLayout(m)){const speed=speeds(m),defs=[];for(const [i,p]of m.pistons.entries()){
 if(!p.mechanics)throw Error('Encounter analysis needs captured cylinder hardware');const s=p.mechanics;
 const endpointSpeed=(id,offset)=>!offset?speed[id].v:m.nodes[id].parent===null?0:speed[m.nodes[id].parent].v+norm(offset)*speed[id].w;
 const av=endpointSpeed(p.a,p.aOffset),bv=endpointSpeed(p.b,p.bOffset),lower=(()=>{let min=Infinity;for(let k=0;k<=128;k++){const f=frames(m,k/128);min=Math.min(min,norm(sub(pistonMountPoint(m,f,p.a,p.aOffset),pistonMountPoint(m,f,p.b,p.bOffset))));}return min-(av+bv)/256;})(),turn=lower>0?(av+bv)/lower:Infinity;
 defs.push({id:`piston:${i}:barrel`,piston:i,kind:'barrel',radius:.11,speed:av+(av+bv)/3+Math.max(.12,s.barrelLength)*turn});defs.push({id:`piston:${i}:rod`,piston:i,kind:'rod',radius:.045,speed:av+(s.barrelLength+s.rodLength)*turn+bv});
 }m.nodes.forEach((n,i)=>{if(n.parent!==null)defs.push({id:`link:${i}`,joint:i,kind:'rail',radius:.15,speed:Math.max(speed[i].v,speed[n.parent].v)});});return defs;}
function primitive(m,f,d,layout){if(d.joint!==undefined){const n=m.nodes[d.joint],z=layout.layers[d.joint];return {a:[...f[n.parent].point,z],b:[...f[d.joint].point,z]};}const p=m.pistons[d.piston],a=pistonMountPoint(m,f,p.a,p.aOffset),b=pistonMountPoint(m,f,p.b,p.bOffset),delta=sub(b,a),length=norm(delta);if(length<1e-12)throw Error('Cylinder direction is undefined at coincident mounts');const u=mul(delta,1/length),z=layout.pistonLayers[d.piston],barrelEnd=add(a,mul(u,p.mechanics.barrelLength));return d.kind==='barrel'?{a:[...add(a,mul(u,Math.min(.12,length/3))),z],b:[...barrelEnd,z]}:{a:[...barrelEnd,z],b:[...add(a,mul(u,Math.max(p.mechanics.barrelLength,length-.1))),z]};}
function connected(m,a,b){if(a.piston!==undefined&&b.piston!==undefined)return a.piston===b.piston;if(a.joint!==undefined&&b.joint!==undefined)return m.nodes[a.joint].parent===b.joint||m.nodes[b.joint].parent===a.joint;const rail=a.joint!==undefined?a:b,tube=a.piston!==undefined?a:b,p=m.pistons[tube.piston];return p.a===rail.joint||p.b===rail.joint;}
// A confirmed sample proves an encounter. A Lipschitz-separated interval proves
// these coarse shapes clear there. Unresolved intervals remain visible amber;
// phase tolerance never turns uncertainty into a clearance verdict.
export function scanInteractions(value,{clearance=.025,phaseTolerance=1/256}={}){
 const m=checkedMechanism(value);if(!Number.isFinite(clearance)||clearance<0||!Number.isFinite(phaseTolerance)||phaseTolerance<=0||phaseTolerance>1)throw Error('Finite nonnegative clearance and phase tolerance in (0,1] required');const layout=bodyLayout(m),defs=definitions(m,layout),cache=new Map(),pose=t=>{if(!cache.has(t))cache.set(t,frames(m,t));return cache.get(t);},encounters=[];let checkedPairs=0,clearPairs=0;
 for(let i=0;i<defs.length;i++)for(let j=i+1;j<defs.length;j++){const a=defs[i],b=defs[j];if(connected(m,a,b))continue;checkedPairs++;const required=a.radius+b.radius+clearance,pending=[[0,1]],unresolved=[];let found=null;
  while(pending.length){const [lo,hi]=pending.pop(),mid=(lo+hi)/2,f=pose(mid),pa=primitive(m,f,a,layout),pb=primitive(m,f,b,layout),near=segmentDistance(pa.a,pa.b,pb.a,pb.b),gap=near.distance-required;
   if(gap<0){found={status:'contact',a,b,fraction:mid,interval:[lo,hi],...near,a,b,closest:[near.a,near.b],requiredDistance:required,penetration:-gap,segments:[pa,pb]};break;}
   if(gap>(a.speed+b.speed)*(hi-lo)/2)continue;
   if(hi-lo<=phaseTolerance){unresolved.push({status:'unresolved',a,b,fraction:mid,interval:[lo,hi],...near,a,b,closest:[near.a,near.b],requiredDistance:required,penetration:0,segments:[pa,pb]});continue;}
   pending.push([mid,hi],[lo,mid]);
  }if(found)encounters.push({...found,sourceKey:constructionKey(m),unresolvedIntervals:unresolved.map(x=>x.interval)});else if(unresolved.length)encounters.push({...unresolved[0],sourceKey:constructionKey(m),unresolvedIntervals:unresolved.map(x=>x.interval)});else clearPairs++;
 }
 return {schema:'kaminos.interference.v1',sourceKey:constructionKey(m),method:'same-phase cylinder-tube and link-rail capsules; conservative interval separation',clearance,phaseTolerance,checkedPairs,clearPairs,encounters,coverage:'Tube/rail envelopes only; cylinder eyes, mounting supports, panel skins and mesh contact are not tested.'};
}
function fixedHardware(m,index){
 const p=m.pistons[index],old=p.mechanics;let min=Infinity,max=0;
 // This is manufacturing of a new candidate, not mutation of working hardware
 // during posing. The proposed hardware is explicitly sampled, not CCD proof.
 for(let k=0;k<=128;k++){const f=frames(m,k/128),a=pistonMountPoint(m,f,p.a,p.aOffset),b=pistonMountPoint(m,f,p.b,p.bOffset),d=norm(sub(b,a));min=Math.min(min,d);max=Math.max(max,d);}
 const barrel=min*.9,rod=Math.max(min*.8,max-barrel+.03);if(min<=.03||rod>min)throw Error('This carrier needs a different mounting arrangement to fit a fixed cylinder');p.mechanics={...old,barrelLength:barrel,rodLength:rod,minLength:Math.max(barrel,rod),maxLength:barrel+rod,restLength:Math.max(Math.max(barrel,rod),Math.min(barrel+rod,old.restLength)),mode:'free'};
}
function ensureIntent(m){if(m.elaboration){const e=m.elaboration;if(e.schema!=='kaminos.elaboration.v1'||!Array.isArray(e.intent?.nodes)||!Array.isArray(e.steps))throw Error('Invalid retained elaboration intent');return;}const {elaboration,...base}=structuredClone(m);m.elaboration={schema:'kaminos.elaboration.v1',intent:{nodes:base.nodes,pistons:base.pistons},steps:[]};}
export function proposeElaboration(value,encounter,{kind,piston,length,angles,z}={}){
 const source=checkedMechanism(value),m=checkedMechanism(value);if(encounter&&encounter.sourceKey&&encounter.sourceKey!==constructionKey(source))throw Error('Encounter source changed');
 const index=piston??encounter?.b?.piston??encounter?.a?.piston;if(!Number.isInteger(index)||!m.pistons[index])throw Error('Choose a cylinder from the encounter');const p=m.pistons[index];if(m.nodes[p.b].parent===null)throw Error('This refinement needs a moving cylinder end');ensureIntent(m);const layout=bodyLayout(m);m.nodes.forEach((n,i)=>{if(n.parent!==null)n.layer=layout.layers[i];});m.pistons.forEach((p,i)=>p.z=layout.pistonLayers[i]);const parent=p.b,base=m.nodes[parent];let guide;
 if(kind==='outboard'){
  const other=definitions(m).filter(d=>d.piston!==index),upper=Math.max(0,...other.map(d=>(d.piston!==undefined?m.pistons[d.piston].z:m.nodes[d.joint].layer)+d.radius));p.z=z??upper+.11+.06;if(!Number.isFinite(p.z))throw Error('Finite outboard layer required');guide={kind,z:p.z};
 }else if(kind==='carrier'){
  if(p.bOffset&&norm(sub(p.bOffset,[base.length,0]))>1e-6)throw Error('The first carrier operation attaches at a moving body endpoint; choose an endpoint-mounted cylinder');
  const L=length??Math.max(base.length*.22,.25),q=angles??[-Math.PI/2,-3*Math.PI/2];if(!Number.isFinite(L)||L<=1e-6||!Array.isArray(q)||q.length!==2||!q.every(Number.isFinite))throw Error('Positive carrier length and two finite hinge angles required');const joint=m.nodes.length;
  m.nodes.push({parent,length:L,angles:[...q],layer:p.z,label:'Articulated cylinder carrier',bodyDynamics:{mass:.35},elaborationCarrier:true});p.b=joint;delete p.bOffset;p.hinge=false;fixedHardware(m,index);guide={kind,length:L,angles:[...q],joint,parent};
 }else throw Error('Choose outboard or carrier refinement');
 return {schema:'kaminos.elaboration-proposal.v1',sourceKey:constructionKey(source),kind,piston:index,recipe:checkedMechanism(m),guide,encounter:encounter?structuredClone(encounter):null,limits:'Preserves the existing body motion; tests coarse envelopes. Carrier hardware sizing uses129 poses; force-driven cycle and mesh clearance are unverified.'};
}
export function adoptElaboration(value,proposal){if(proposal?.schema!=='kaminos.elaboration-proposal.v1'||constructionKey(value)!==proposal.sourceKey)throw Error('Construction changed; inspect and propose again');const expected=proposeElaboration(value,proposal.encounter,{...proposal.guide,kind:proposal.kind,piston:proposal.piston});if(constructionKey(expected.recipe)!==constructionKey(proposal.recipe))throw Error('Proposal changed; preserve the requested action and regenerate');const m=checkedMechanism(proposal.recipe);ensureIntent(m);const references=structuredClone(m.elaboration.draft?.guides??[]);delete m.elaboration.draft;m.elaboration.steps.push({references,index:m.elaboration.steps.length,kind:proposal.kind,piston:proposal.piston,guide:proposal.guide,encounter:proposal.encounter?{a:proposal.encounter.a.id,b:proposal.encounter.b.id,fraction:proposal.encounter.fraction,status:proposal.encounter.status}:null});return checkedMechanism(m);}
export function elaborationFixture(){return checkedMechanism({schema:'kaminos.links.v1',period:5,nodes:[{parent:null,point:[0,1.8],label:'Panel hinge'},{parent:0,length:1.5,angles:[-Math.PI/2,-Math.PI/12],layer:0,label:'Requested opening panel'},{parent:null,point:[-1,.65],label:'Lower cylinder mount'},{parent:null,point:[-1.1,2],label:'Upper cylinder mount'}],pistons:[{a:2,b:1,bOffset:[.65,0],z:.38,mechanics:{mode:'free',barrelLength:.95,rodLength:.92,minLength:.95,maxLength:1.86,restLength:1.3,stiffness:0,damping:2,stopStiffness:1e6}},{a:3,b:1,z:.38,mechanics:{mode:'free',barrelLength:1.65,rodLength:1.45,minLength:1.65,maxLength:3.09,restLength:2.3,stiffness:0,damping:2,stopStiffness:1e6}}],mechanics:{enabled:false,model:'bodies',hydraulicsEnabled:true,settleAfterRelease:true}});}
