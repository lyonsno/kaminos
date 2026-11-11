// Planar rooted forests. Each edge is a rigid link; angles are relative to its parent.
export {createMechanicalSystem,freezeMechanicalHardware,pistonDifferential} from './mechanics.mjs';
export {createBodyDynamics,createBodyInertia} from './body-dynamics.mjs';
const copy=x=>structuredClone(x),point=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite);
export function emptyMechanism(){return {schema:'kaminos.links.v1',nodes:[],pistons:[],period:3};}
export function checkedMechanism(m){
 if(m?.schema!=='kaminos.links.v1'||!Array.isArray(m.nodes)||!Array.isArray(m.pistons))throw Error('Choose a saved link workshop');
 if(!Number.isFinite(m.period)||m.period<=0)throw Error('Positive cycle period required');
 for(const [i,n]of m.nodes.entries()){
  if(n.parent===null){if(!point(n.point))throw Error('Anchor needs a finite point');}
  else if(!Number.isInteger(n.parent)||n.parent<0||n.parent>=i)throw Error('Joint parent must precede child');
  else if(!Number.isFinite(n.length)||n.length<=1e-6||!point(n.angles))throw Error('Positive link length and finite angles required');
 }
 for(const n of m.nodes)if(n.layer!==undefined&&!Number.isFinite(n.layer))throw Error('Finite body layer required');
 for(const p of m.pistons){if(p.hinge!==undefined&&(typeof p.hinge!=='boolean'||p.hinge&&(!p.aOffset||!p.bOffset||m.nodes[p.b]?.parent!==p.a)))throw Error('Hinge cylinder needs adjacent bodies and two local mounts');for(const k of ['aSeat','bSeat'])if(p[k]!==undefined&&(!Array.isArray(p[k])||p[k].length!==3||!p[k].every(Number.isFinite)))throw Error('Finite mounting patch required');for(const k of ['aBaseZ','bBaseZ'])if(p[k]!==undefined&&!Number.isFinite(p[k]))throw Error('Finite actuator seating required');for(const k of ['aOffset','bOffset'])if(p[k]!==undefined&&!point(p[k]))throw Error('Finite body-local piston offset required');if(p.z!==undefined&&!Number.isFinite(p.z))throw Error('Finite piston layer required');}
 const pairs=new Set();for(const p of m.pistons){if(![p.a,p.b].every(i=>Number.isInteger(i)&&i>=0&&i<m.nodes.length)||p.a===p.b)throw Error('Piston needs distinct existing joints');const key=[p.a,p.b].sort((a,b)=>a-b).join(':');if(pairs.has(key))throw Error('Piston already connected');pairs.add(key);}
 if(m.phase!==undefined&&!Number.isFinite(m.phase))throw Error('Finite cycle phase required');
 for(const n of m.nodes)if(n.inertia!==undefined&&(!Number.isFinite(n.inertia)||n.inertia<=0))throw Error('Positive finite mechanical hinge inertia required');
 for(const n of m.nodes)if(n.bodyDynamics!==undefined){const b=n.bodyDynamics;if(!b||typeof b!=='object'||Array.isArray(b))throw Error('Body dynamics requires physical properties');for(const k of ['mass','inertia'])if(b[k]!==undefined&&(!Number.isFinite(b[k])||b[k]<=0))throw Error(`Positive finite body ${k} required`);if(b.center!==undefined&&!point(b.center))throw Error('Finite body center required');}
 if(m.mechanics!==undefined){if(typeof m.mechanics!=='object'||m.mechanics===null||typeof m.mechanics.enabled!=='boolean')throw Error('Mechanical response needs an enabled state');for(const k of ['handStiffness','handDamping','jointDamping'])if(m.mechanics[k]!==undefined&&(!Number.isFinite(m.mechanics[k])||m.mechanics[k]<0))throw Error('Finite nonnegative mechanical response required');}
 if(m.mechanics){const s=m.mechanics;if(s.model!==undefined&&!['hinge-springs','bodies'].includes(s.model))throw Error('Unknown mechanical model');if(s.gravity!==undefined&&!point(s.gravity))throw Error('Finite planar gravity required');if(s.hydraulicsEnabled!==undefined&&typeof s.hydraulicsEnabled!=='boolean')throw Error('Hydraulic enabled state must be boolean');if(s.settleAfterRelease!==undefined&&typeof s.settleAfterRelease!=='boolean')throw Error('Settling enabled state must be boolean');for(const k of ['grabStiffness','grabDamping','cylinderDrag','endStopStiffness'])if(s[k]!==undefined&&(!Number.isFinite(s[k])||s[k]<0))throw Error('Finite nonnegative body response required');if(s.stepSeconds!==undefined&&(!Number.isFinite(s.stepSeconds)||s.stepSeconds<=0))throw Error('Positive body timestep required');}
 for(const p of m.pistons)if(p.hydraulics!==undefined){const s=p.hydraulics;if(!s||typeof s!=='object'||Array.isArray(s))throw Error('Hydraulic properties required');for(const k of ['areaA','areaB','bulkModulus','deadVolume'])if(s[k]!==undefined&&(!Number.isFinite(s[k])||s[k]<=0))throw Error('Positive finite hydraulic dimensions/compliance required');for(const k of ['conductance','reliefConductance'])if(s[k]!==undefined&&(!Number.isFinite(s[k])||s[k]<0))throw Error('Finite nonnegative hydraulic conductance required');for(const k of ['minPressure','maxPressure'])if(s[k]!==undefined&&!Number.isFinite(s[k]))throw Error('Finite hydraulic pressure thresholds required');if(s.minPressure!==undefined&&s.minPressure< -101325||(s.minPressure??-90000)>=(s.maxPressure??2e6))throw Error('Hydraulic gauge pressure range must preserve positive absolute pressure');if(s.valve!==undefined&&!['metered','free','closed'].includes(s.valve))throw Error('Unknown hydraulic valve state');}
 for(const p of m.pistons)if(p.mechanics!==undefined){const s=p.mechanics;if(!s||!['hold','free','drive'].includes(s.mode))throw Error('Mechanical cylinder needs hold, free or drive mode');for(const k of ['barrelLength','rodLength','minLength','maxLength','stopStiffness'])if(!Number.isFinite(s[k])||s[k]<=0)throw Error('Positive finite mechanical cylinder dimensions and stops required');for(const k of ['stiffness','damping'])if(!Number.isFinite(s[k])||s[k]<0)throw Error('Finite nonnegative mechanical cylinder response required');if(s.minLength>s.maxLength||!Number.isFinite(s.restLength)||s.restLength<s.minLength||s.restLength>s.maxLength||s.targetLength!==undefined&&(!Number.isFinite(s.targetLength)||s.targetLength<s.minLength||s.targetLength>s.maxLength))throw Error('Mechanical cylinder target must lie in its fixed stroke');if(s.minLength<Math.max(s.barrelLength,s.rodLength)||s.maxLength>s.barrelLength+s.rodLength)throw Error('Mechanical stroke exceeds fixed barrel/rod hardware');}
 if(m.mechanics?.enabled&&m.mechanics.model==='bodies'&&m.pistons.some(p=>p.mechanics?.mode==='drive'))throw Error('Body posing currently uses passive valves; release stored cylinder drives first');
 if(m.mechanics?.enabled&&(m.pistons.some(p=>!p.mechanics)||m.mountPistons?.length))throw Error('Mechanical response needs fixed hardware on every planar-body cylinder');
 const mounts=new Map();for(const mount of m.mounts??[]){
  if(typeof mount.id!=='string'||!mount.id||mounts.has(mount.id))throw Error('Unique mount ID required');
  const o=mount.owner;if(!o||(o.joint!==undefined)===(o.objectId!==undefined))throw Error('Mount needs one owner');
  if(o.joint!==undefined&&(!Number.isInteger(o.joint)||!m.nodes[o.joint]))throw Error('Mount needs an existing joint');
  if(o.objectId!==undefined&&(typeof o.objectId!=='string'||!o.objectId))throw Error('Mount needs an object ID');
  for(const k of ['position','rotation'])if(!Array.isArray(mount[k])||mount[k].length!==3||!mount[k].every(Number.isFinite))throw Error('Finite mount frame required');mounts.set(mount.id,mount);
 }
 for(const p of m.mountPistons??[])if(!mounts.has(p.a)||!mounts.has(p.b)||p.a===p.b||(p.barrelLength!==undefined&&(!Number.isFinite(p.barrelLength)||p.barrelLength<=0)))throw Error('Piston needs two different mounts');
 const ids=new Set();for(const a of m.attachments??[]){
  if(typeof a.objectId!=='string'||!a.objectId||ids.has(a.objectId)||(a.targetMount?(!mounts.has(a.targetMount)||mounts.get(a.sourceMount)?.owner.objectId!==a.objectId):(!Number.isInteger(a.joint)||!m.nodes[a.joint])))throw Error('Attachment requires a unique object and existing joint');
  for(const key of ['position','rotation','scale'])if(!Array.isArray(a.offset?.[key])||a.offset[key].length!==3||!a.offset[key].every(Number.isFinite))throw Error('Attachment requires a finite frame');
  if(a.offset.scale.some(x=>x===0))throw Error('Attachment scale must be nonzero');
  if(a.hinge!==undefined&&(!a.targetMount||!point(a.hinge)))throw Error('Hinged attachment requires two mounts and finite Pose A/B angles');
  ids.add(a.objectId);
 }
 return copy(m);
}
export function frames(m,t=0){
 if(!Number.isFinite(t)||t<0||t>1)throw Error('Pose fraction must be between zero and one');
 const out=[];for(const n of m.nodes){if(n.parent===null)out.push({point:[...n.point],angle:0});else{const p=out[n.parent],angle=p.angle+n.angles[0]+(n.angles[1]-n.angles[0])*t;out.push({angle,point:[p.point[0]+Math.cos(angle)*n.length,p.point[1]+Math.sin(angle)*n.length]});}}return out;
}
export function pistonMountPoint(m,f,id,offset){if(!offset)return f[id].point;const n=m.nodes[id],origin=n.parent===null?f[id].point:f[n.parent].point,angle=n.parent===null?0:f[id].angle;return [origin[0]+Math.cos(angle)*offset[0]-Math.sin(angle)*offset[1],origin[1]+Math.sin(angle)*offset[0]+Math.cos(angle)*offset[1]];}
export const evaluate=(m,t=0)=>frames(m,t).map(f=>f.point);
export function appendJoint(value,parent,p){
 const m=checkedMechanism(value);if(!point(p))throw Error('Finite construction point required');
 if(parent===null)m.nodes.push({parent:null,point:[...p]});else{
  if(!m.nodes[parent])throw Error('Unknown parent');const f=frames(m)[parent],dx=p[0]-f.point[0],dy=p[1]-f.point[1],length=Math.hypot(dx,dy);if(length<=1e-6)throw Error('Link needs nonzero length');const angle=Math.atan2(dy,dx)-f.angle;m.nodes.push({parent,length,angles:[angle,angle]});
 }return m;
}
// Reach an endpoint by constructing feasible triangles from tip to anchor.
// Each prefix can reach an annulus: max(0, 2*longest - sum) .. sum.
// Intersect that annulus with the last link's circle, preferring the old elbow.
// This is finite O(chain length), including straight/fully folded singularities.
function reachChain(m,id,p,mode){
 const pose=mode==='B'?1:0,f=frames(m,pose),chain=[];let root=id;
 if(p.every((x,k)=>x===f[id].point[k]))return m;
 while(m.nodes[root].parent!==null){chain.push(root);root=m.nodes[root].parent;}chain.reverse();
 const origin=f[root].point,old=[[0,0],...chain.map(i=>f[i].point.map((x,k)=>x-origin[k]))],sums=[0],longest=[0];
 for(const i of chain){sums.push(sums.at(-1)+m.nodes[i].length);longest.push(Math.max(longest.at(-1),m.nodes[i].length));}
 const count=chain.length,total=sums[count],minimum=Math.max(0,2*longest[count]-total),wanted=p.map((x,k)=>x-origin[k]),distance=Math.hypot(...wanted);
 if(!Number.isFinite(total)||!Number.isFinite(distance))throw Error('Chain extent exceeds numeric reach range');
 const radius=Math.max(minimum,Math.min(total,distance)),fallback=old[count],fallbackLength=Math.hypot(...fallback),direction=distance?wanted.map(x=>x/distance):fallbackLength?fallback.map(x=>x/fallbackLength):[1,0];
 const solved=Array(count+1);solved[0]=[0,0];solved[count]=direction.map(x=>x*radius);
 for(let j=count;j>1;j--){
  const end=solved[j],length=m.nodes[chain[j-1]].length,prior=old[j-1],back=prior.map((x,k)=>x-end[k]),backLength=Math.hypot(...back),oldBack=old[j-1].map((x,k)=>x-old[j][k]),oldBackLength=Math.hypot(...oldBack);
  const unit=backLength?back.map(x=>x/backLength):oldBack.map(x=>x/oldBackLength);
  let elbow=end.map((x,k)=>x+unit[k]*length);const r=Math.hypot(...elbow),lo=Math.max(0,2*longest[j-1]-sums[j-1]),hi=sums[j-1];
  if(r<lo||r>hi){
   const prefix=Math.max(lo,Math.min(hi,r)),d=Math.hypot(...end);
   if(d===0)elbow=unit.map(x=>x*length);
   else{
    const u=end.map(x=>x/d),scale=Math.max(prefix,d,length),r=prefix/scale,l=length/scale,dn=d/scale;
    // Normalize before squaring; an underflowed separation is coincident at
    // this circle's representable scale, so retain its old radial direction.
    if(dn===0){solved[j-1]=unit.map(x=>x*length);continue;}
    const xn=(r*r+dn*dn-l*l)/(2*dn),x=xn*scale,h=Math.sqrt(Math.max(0,(r-xn)*(r+xn)))*scale,a=[u[0]*x-u[1]*h,u[1]*x+u[0]*h],b=[u[0]*x+u[1]*h,u[1]*x-u[0]*h];
    elbow=Math.hypot(a[0]-prior[0],a[1]-prior[1])<=Math.hypot(b[0]-prior[0],b[1]-prior[1])?a:b;
   }
  }
  solved[j-1]=elbow;
 }
 let parentAngle=0;
 for(let j=1;j<=count;j++){
  const n=m.nodes[chain[j-1]],world=Math.atan2(solved[j][1]-solved[j-1][1],solved[j][0]-solved[j-1][0]),raw=world-parentAngle,oldAngle=n.angles[pose],delta=Math.atan2(Math.sin(raw-oldAngle),Math.cos(raw-oldAngle));
  if(mode==='build')n.angles=n.angles.map(a=>a+delta);else n.angles[pose]=oldAngle+delta;
  if(!n.angles.every(Number.isFinite))throw Error('Chain exceeds numeric reach range');
  parentAngle=world;
 }
 return m;
}
export function moveJoint(value,id,p,mode,{reach=false}={}){
 const m=checkedMechanism(value),n=m.nodes[id];if(!n||!point(p)||!['build','A','B'].includes(mode))throw Error('Joint, finite point and edit mode required');
 if(n.parent===null){if(mode!=='build')throw Error('Anchor is fixed; move it in Build');n.point=[...p];return m;}
 if(reach)return reachChain(m,id,p,mode);
 const index=mode==='B'?1:0,f=frames(m,index)[n.parent],dx=p[0]-f.point[0],dy=p[1]-f.point[1];if(Math.hypot(dx,dy)<=1e-6)throw Error('Link needs nonzero length');
 const raw=Math.atan2(dy,dx)-f.angle,old=n.angles[index],angle=old+Math.atan2(Math.sin(raw-old),Math.cos(raw-old));
 if(mode==='build'){const delta=angle-n.angles[0];n.angles=n.angles.map(a=>a+delta);n.length=Math.hypot(dx,dy);}else n.angles[index]=angle;
 return m;
}
export function connectPiston(value,a,b){const m=checkedMechanism(value);m.pistons.push({a,b});return checkedMechanism(m);}

export function removeBranch(value,id){
 const m=checkedMechanism(value);if(!m.nodes[id])throw Error('Unknown joint');
 const removed=new Set([id]);m.nodes.forEach((n,i)=>{if(removed.has(n.parent))removed.add(i);});
 const ids=new Map();m.nodes.forEach((n,i)=>{if(!removed.has(i))ids.set(i,ids.size);});
 m.nodes=m.nodes.filter((_,i)=>!removed.has(i)).map(n=>({...n,parent:n.parent===null?null:ids.get(n.parent)}));
 m.pistons=m.pistons.filter(p=>!removed.has(p.a)&&!removed.has(p.b)).map(p=>({...p,a:ids.get(p.a),b:ids.get(p.b)}));
 if(m.mounts)m.mounts=m.mounts.filter(v=>!removed.has(v.owner.joint)).map(v=>({...v,owner:v.owner.joint===undefined?v.owner:{joint:ids.get(v.owner.joint)}}));
 const mounts=new Set((m.mounts??[]).map(v=>v.id));
 if(m.mountPistons)m.mountPistons=m.mountPistons.filter(p=>mounts.has(p.a)&&mounts.has(p.b));
 if(m.attachments)m.attachments=m.attachments.filter(a=>a.targetMount?mounts.has(a.targetMount)&&mounts.has(a.sourceMount):!removed.has(a.joint)).map(a=>a.targetMount?a:({...a,joint:ids.get(a.joint)}));return m;
}
