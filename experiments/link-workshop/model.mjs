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
 if(m.castingCarrier!==undefined){const c=m.castingCarrier;if(!c||typeof c.moldId!=='string'||!c.moldId||!Number.isInteger(c.joint)||!m.nodes[c.joint])throw Error('Casting carrier needs a mold ID and existing delivery joint');}
 const pairs=new Set();for(const p of m.pistons){
  if(![p.a,p.b].every(i=>Number.isInteger(i)&&i>=0&&i<m.nodes.length)||p.a===p.b)throw Error('Piston needs distinct existing joints');
  if(p.aOffset!==undefined&&!point(p.aOffset))throw Error('Finite piston aOffset required');
  if(p.bOffset!==undefined&&!point(p.bOffset))throw Error('Finite piston bOffset required');
  const key=[p.a,p.b].sort((a,b)=>a-b).join(':');if(pairs.has(key))throw Error('Piston already connected');pairs.add(key);
 }
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
// Evaluate a piston mount in world XY given body-local offset [ox, oy].
// For an anchor body, origin is f[id].point at angle 0.
// For a link body, origin is f[n.parent].point at angle f[id].angle.
export function pistonMountPoint(m,f,id,offset){
 const n=m.nodes[id];if(!n)throw Error('Unknown piston mount joint');
 if(!offset)return [...f[id].point];
 const origin=n.parent===null?f[id].point:f[n.parent].point,angle=n.parent===null?0:f[id].angle;
 const c=Math.cos(angle),s=Math.sin(angle);
 return [origin[0]+c*offset[0]-s*offset[1],origin[1]+s*offset[0]+c*offset[1]];
}

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
// Split link `id` into `count` equal collinear sections while preserving downstream topology.
export function sectionLink(value,id,count=2,spanLength=null){
 const m=checkedMechanism(value),target=m.nodes[id];
 if(!target||target.parent===null)throw Error('Choose a movable link to section');
 if(!Number.isInteger(count)||count<2||count>12)throw Error('Section count must be an integer between 2 and 12');
 const total=Number.isFinite(spanLength)&&spanLength>target.length?spanLength:target.length;
 const extra=count-1,segLength=Number((total/count).toFixed(6)),nodes=[];
 const mapIndex=idx=>idx>id?idx+extra:idx;
 m.nodes.forEach((n,i)=>{
  if(i<id)nodes.push(copy(n));
  else if(i===id){
   nodes.push({parent:n.parent,length:segLength,angles:[...n.angles]});
   for(let k=1;k<count;k++)nodes.push({parent:id+k-1,length:segLength,angles:[0,0]});
  }else{
   const parent=n.parent===id?id+extra:n.parent!==null?mapIndex(n.parent):null;
   nodes.push({...copy(n),parent});
  }
 });
 const pistons=m.pistons.map(p=>({...copy(p),a:mapIndex(p.a),b:mapIndex(p.b)}));
 const endIndex=idx=>idx===id?id+extra:mapIndex(idx);
 const mounts=m.mounts?.map(v=>({...v,owner:v.owner.joint===undefined?v.owner:{joint:endIndex(v.owner.joint)}}));
 const attachments=m.attachments?.map(v=>v.targetMount?v:{...v,joint:endIndex(v.joint)});
 return checkedMechanism({...m,nodes,pistons,...(m.castingCarrier?{castingCarrier:{...m.castingCarrier,joint:endIndex(m.castingCarrier.joint)}}:{}),...(mounts?{mounts}:{}),...(attachments?{attachments}:{})});
}

function segmentPenetration(a,b,obstacles,margin=0){
 let pen=0;
 for(const box of obstacles??[]){
  const minX=box.min[0]+margin,maxX=box.max[0]-margin,minY=box.min[1]+margin,maxY=box.max[1]-margin;
  if(minX>=maxX||minY>=maxY)continue;
  for(let s=0;s<=8;s++){
   const u=s/8,x=a[0]+(b[0]-a[0])*u,y=a[1]+(b[1]-a[1])*u;
   if(x>minX&&x<maxX&&y>minY&&y<maxY){
    const d=Math.min(x-minX,maxX-x,y-minY,maxY-y);
    pen+=d+0.05;
   }
  }
 }
 return pen;
}

// Solve multi-section chain angles in Pose A or B so `id` reaches `targetPoint`
// while wrapping outside `obstacles` across the continuous [0, 1] interpolation.
export function foldChainToPoint(value,id,targetPoint,mode='B',{obstacles=[],clearance=0.06}={}){
 const m=checkedMechanism(value);
 if(!m.nodes[id]||m.nodes[id].parent===null||!point(targetPoint)||!['A','B'].includes(mode))
  throw Error('Movable link joint, finite target point and pose mode A or B required');
 const chain=[];let curr=id;
 while(curr!==null&&m.nodes[curr].parent!==null){chain.unshift(curr);curr=m.nodes[curr].parent;}
 const rootId=curr,poseIdx=mode==='B'?1:0,otherIdx=1-poseIdx;
 const fOther=frames(m,otherIdx),rootPt=fOther[rootId].point,k=chain.length;
 const lengths=chain.map(idx=>m.nodes[idx].length),totalLength=lengths.reduce((a,b)=>a+b,0);

 // Evaluate candidate relative angles rel[0..k-1] across t in [0, 1]
 const scoreCandidate=rel=>{
  const trial=copy(m);
  chain.forEach((nodeId,j)=>{trial.nodes[nodeId].angles[poseIdx]=rel[j];});
  const fEnd=frames(trial,poseIdx),tip=fEnd[id].point;
  const dist=Math.hypot(tip[0]-targetPoint[0],tip[1]-targetPoint[1]);
  let obsCost=0,smoothCost=0;
  for(let j=1;j<k;j++){
   smoothCost+=0.08*(rel[j]-rel[1])**2+0.04*rel[j]**2;
  }
  if(obstacles.length){
   for(const t of [0.15,0.3,0.45,0.6,0.75,0.9,1.0]){
    const ft=frames(trial,poseIdx===1?t:1-t);
    for(const nodeId of chain){
     const p=ft[trial.nodes[nodeId].parent].point,q=ft[nodeId].point;
     obsCost+=segmentPenetration(p,q,obstacles,-clearance)*40;
     obsCost+=segmentPenetration(p,q,obstacles,0.04)*200;
    }
   }
  }
  return dist*4 + smoothCost + obsCost;
 };

 // Construct initial seeds: direct shortest branch, counter-clockwise wrap (+), and clockwise wrap (-)
 const rawDir=Math.atan2(targetPoint[1]-rootPt[1],targetPoint[0]-rootPt[0])-fOther[rootId].angle;
 const a0Other=m.nodes[chain[0]].angles[otherIdx];
 const deltaShort=Math.atan2(Math.sin(rawDir-a0Other),Math.cos(rawDir-a0Other));
 const seeds=[];
 for(const baseShift of [deltaShort, deltaShort>0?deltaShort:deltaShort+Math.PI*2, deltaShort<0?deltaShort:deltaShort-Math.PI*2]){
  for(const curl of [-1.2,-0.6,-0.25,0,0.25,0.6,1.2,1.6]){
   const rel=chain.map((nodeId,j)=>j===0?a0Other+baseShift-curl*(k-1)*0.45:m.nodes[nodeId].angles[otherIdx]+curl);
   seeds.push(rel);
  }
 }
 let bestRel=seeds[0],bestScore=Infinity;
 for(const rel of seeds){const s=scoreCandidate(rel);if(s<bestScore){bestScore=s;bestRel=[...rel];}}

 // Coordinate pattern refinement (fast, deterministic, derivative-free)
 for(let step=0.45;step>=0.008;step*=0.55){
  for(let iter=0;iter<6;iter++){
   let improved=false;
   for(let j=0;j<k;j++){
    for(const dir of [-1,1]){
     const cand=[...bestRel];cand[j]+=dir*step;
     const s=scoreCandidate(cand);
     if(s+1e-9<bestScore){bestScore=s;bestRel=cand;improved=true;}
    }
   }
   if(!improved)break;
  }
 }
 chain.forEach((nodeId,j)=>{m.nodes[nodeId].angles[poseIdx]=Number(bestRel[j].toFixed(6));});
 return resyncPistonClevises(m,{obstacles});
}

// Solve body-local stand-off clevis lugs [ax, ay] and [bx, by] for a piston between `a` and `b`
// so that across t in [0, 1] the stroke is monotonic, has positive moment arm even when panels
// are 180-deg flat, clears obstacles, and satisfies single-stage telescoping (rod <= min).
export function solvePistonClevis(value,a,b,{obstacles=[],clevis=false}={}){
 const m=checkedMechanism(value);
 if(![a,b].every(i=>Number.isInteger(i)&&m.nodes[i])||a===b)throw Error('Piston needs distinct existing joints');
 const nA=m.nodes[a],nB=m.nodes[b],adjacent=(nA.parent===b||nB.parent===a);
 if(!adjacent&&!clevis)return {a,b};
 const samples=[0,0.125,0.25,0.375,0.5,0.625,0.75,0.875,1].map(t=>frames(m,t));
 const evalOffsets=(aOff,bOff)=>{
  const d=samples.map(f=>{
   const pa=pistonMountPoint(m,f,a,aOff),pb=pistonMountPoint(m,f,b,bOff);
   return Math.hypot(pb[0]-pa[0],pb[1]-pa[1]);
  });
  const min=Math.min(...d),max=Math.max(...d),stroke=max-min;
  const barrel=Math.max(0.04,min*0.85),rod=Math.max(0.04,max-barrel+0.08);
  const retracts=rod<=min-1e-3;
  let diffs=0;
  for(let i=1;i<d.length;i++)diffs+=Math.sign(d[i]-d[i-1]);
  const monotonic=Math.abs(diffs)>=d.length-3;
  let pen=0;
  if(obstacles.length){
   for(const f of [samples[0],samples[4],samples[8]]){
    const pa=pistonMountPoint(m,f,a,aOff),pb=pistonMountPoint(m,f,b,bOff);
    pen+=segmentPenetration(pa,pb,obstacles,0.02);
   }
  }
  return {min,max,stroke,barrel,rod,retracts,monotonic,pen};
 };

 // Search compact asymmetric clevis lug candidates in body-local coordinates
 const candidatesA=[],candidatesB=[];
 const buildCandidates=(id,out)=>{
  const n=m.nodes[id];
  if(n.parent===null){
   for(const ox of [-0.55,-0.38,-0.24,0.24,0.38,0.55])
    for(const oy of [-0.45,-0.28,-0.16,0.16,0.28,0.45])out.push([ox,oy]);
  }else{
   const L=n.length;
   for(const frac of [0.10,0.18,0.28,0.42,0.62,0.78,0.88])
    for(const h of [-0.28,-0.20,-0.12,0.12,0.20,0.28])
     out.push([Number((L*frac).toFixed(4)),h]);
  }
 };
 buildCandidates(a,candidatesA);buildCandidates(b,candidatesB);
 let best=null,bestScore=Infinity;
 for(const aOff of candidatesA){
  for(const bOff of candidatesB){
   const r=evalOffsets(aOff,bOff);
   if(!r.retracts||r.stroke<0.065)continue;
   const ratio=r.max/Math.max(1e-4,r.min);
   const mag=Math.hypot(...aOff)+Math.hypot(...bOff);
   const score=(r.monotonic?0:25)+r.pen*100+Math.abs(ratio-1.42)*3+mag*0.35-Math.min(r.stroke,0.35)*2;
   if(score<bestScore){bestScore=score;best={a,b,aOffset:aOff,bOffset:bOff};}
  }
 }
 if(!best){
  // Fallback stand-off clevis if fold is zero in current pose
  const aOff=nA.parent===null?[0.32,0.24]:[Number((nA.length*0.72).toFixed(4)),0.18];
  const bOff=nB.parent===null?[0.32,0.24]:[Number((nB.length*0.28).toFixed(4)),0.18];
  best={a,b,aOffset:aOff,bOffset:bOff};
 }
 return best;
}

export function resyncPistonClevises(value,{obstacles=[]}={}){
 const m=checkedMechanism(value);
 m.pistons=m.pistons.map(p=>(p.aOffset||p.bOffset||m.nodes[p.a].parent===p.b||m.nodes[p.b].parent===p.a)?solvePistonClevis(m,p.a,p.b,{obstacles}):p);
 return checkedMechanism(m);
}

export function connectPiston(value,a,b,options={}){
 const m=checkedMechanism(value);
 const entry=solvePistonClevis(m,a,b,options);
 m.pistons.push(entry);
 return checkedMechanism(m);
}


export function removeBranch(value,id){
 const m=checkedMechanism(value);if(!m.nodes[id])throw Error('Unknown joint');
 const removed=new Set([id]);m.nodes.forEach((n,i)=>{if(removed.has(n.parent))removed.add(i);});
 const ids=new Map();m.nodes.forEach((n,i)=>{if(!removed.has(i))ids.set(i,ids.size);});
 m.nodes=m.nodes.filter((_,i)=>!removed.has(i)).map(n=>({...n,parent:n.parent===null?null:ids.get(n.parent)}));
 m.pistons=m.pistons.filter(p=>!removed.has(p.a)&&!removed.has(p.b)).map(p=>({...p,a:ids.get(p.a),b:ids.get(p.b)}));
 if(m.mounts)m.mounts=m.mounts.filter(v=>!removed.has(v.owner.joint)).map(v=>({...v,owner:v.owner.joint===undefined?v.owner:{joint:ids.get(v.owner.joint)}}));
 const mounts=new Set((m.mounts??[]).map(v=>v.id));
 if(m.mountPistons)m.mountPistons=m.mountPistons.filter(p=>mounts.has(p.a)&&mounts.has(p.b));
 if(m.castingCarrier){if(removed.has(m.castingCarrier.joint))delete m.castingCarrier;else m.castingCarrier.joint=ids.get(m.castingCarrier.joint);}
 if(m.attachments)m.attachments=m.attachments.filter(a=>a.targetMount?mounts.has(a.targetMount)&&mounts.has(a.sourceMount):!removed.has(a.joint)).map(a=>a.targetMount?a:({...a,joint:ids.get(a.joint)}));return m;
}
