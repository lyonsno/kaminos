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
