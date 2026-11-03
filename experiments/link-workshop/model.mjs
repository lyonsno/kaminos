// Planar rooted forests. Each edge is a rigid link; angles are relative to its parent.
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
 const pairs=new Set();for(const p of m.pistons){if(![p.a,p.b].every(i=>Number.isInteger(i)&&i>=0&&i<m.nodes.length)||p.a===p.b)throw Error('Piston needs distinct existing joints');const key=[p.a,p.b].sort((a,b)=>a-b).join(':');if(pairs.has(key))throw Error('Piston already connected');pairs.add(key);}
 if(m.phase!==undefined&&!Number.isFinite(m.phase))throw Error('Finite cycle phase required');
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
  if(a.offset.scale.some(x=>x===0))throw Error('Attachment scale must be nonzero');ids.add(a.objectId);
 }
 return copy(m);
}
export function frames(m,t=0){
 if(!Number.isFinite(t)||t<0||t>1)throw Error('Pose fraction must be between zero and one');
 const out=[];for(const n of m.nodes){if(n.parent===null)out.push({point:[...n.point],angle:0});else{const p=out[n.parent],angle=p.angle+n.angles[0]+(n.angles[1]-n.angles[0])*t;out.push({angle,point:[p.point[0]+Math.cos(angle)*n.length,p.point[1]+Math.sin(angle)*n.length]});}}return out;
}
export const evaluate=(m,t=0)=>frames(m,t).map(f=>f.point);
export function appendJoint(value,parent,p){
 const m=checkedMechanism(value);if(!point(p))throw Error('Finite construction point required');
 if(parent===null)m.nodes.push({parent:null,point:[...p]});else{
  if(!m.nodes[parent])throw Error('Unknown parent');const f=frames(m)[parent],dx=p[0]-f.point[0],dy=p[1]-f.point[1],length=Math.hypot(dx,dy);if(length<=1e-6)throw Error('Link needs nonzero length');const angle=Math.atan2(dy,dx)-f.angle;m.nodes.push({parent,length,angles:[angle,angle]});
 }return m;
}
export function moveJoint(value,id,p,mode){
 const m=checkedMechanism(value),n=m.nodes[id];if(!n||!point(p)||!['build','A','B'].includes(mode))throw Error('Joint, finite point and edit mode required');
 if(n.parent===null){if(mode!=='build')throw Error('Anchor is fixed; move it in Build');n.point=[...p];return m;}
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
 m.pistons=m.pistons.filter(p=>!removed.has(p.a)&&!removed.has(p.b)).map(p=>({a:ids.get(p.a),b:ids.get(p.b)}));
 if(m.mounts)m.mounts=m.mounts.filter(v=>!removed.has(v.owner.joint)).map(v=>({...v,owner:v.owner.joint===undefined?v.owner:{joint:ids.get(v.owner.joint)}}));
 const mounts=new Set((m.mounts??[]).map(v=>v.id));
 if(m.mountPistons)m.mountPistons=m.mountPistons.filter(p=>mounts.has(p.a)&&mounts.has(p.b));
 if(m.attachments)m.attachments=m.attachments.filter(a=>a.targetMount?mounts.has(a.targetMount)&&mounts.has(a.sourceMount):!removed.has(a.joint)).map(a=>a.targetMount?a:({...a,joint:ids.get(a.joint)}));return m;
}
