// Authored construction intent, separate from solved hinge angles. This is a
// geometric editing solve; body inertia and hydraulics remain the mechanics owner.
import * as T from '../../lib/three.core.js';
import {copyMechanism} from './recipe-state.mjs';
import {frameMatrix,matrixFrame,previewMountMatrix,hingeWorldFrame,jointMatrix} from './mounts.mjs';
import {rigidFrame} from './held-pose.mjs';
const point=m=>new T.Vector3().setFromMatrixPosition(m);
const quaternion=m=>{const q=new T.Quaternion();m.decompose(new T.Vector3(),q,new T.Vector3());return q.normalize();};
export function constructionBodyMatrix(root,m,id,t,entries){
 const a=m.attachments?.find(a=>a.objectId===id),entry=entries.find(e=>e.id===id);if(!entry)throw Error('Missing construction part: '+id);
 if(a?.sourceMount){const source=m.mounts.find(s=>s.id===a.sourceMount);return previewMountMatrix(root,m,a.sourceMount,t,entries).multiply(frameMatrix({...source,position:source.position.map((v,i)=>v*a.offset.scale[i]),scale:[1,1,1]}).invert());}
 if(a)return jointMatrix(root,m,a.joint,t).multiply(frameMatrix({...a.offset,scale:[1,1,1]}));
 entry.object.updateWorldMatrix(true,false);return new T.Matrix4().compose(entry.object.getWorldPosition(new T.Vector3()),entry.object.getWorldQuaternion(new T.Quaternion()),new T.Vector3(1,1,1));
}
export function constructionSelection(m,ids,{branch=false}={}){
 const found=new Set(ids);if(branch){let changed=true;while(changed){changed=false;for(const a of m.attachments??[]){const parent=m.mounts?.find(s=>s.id===a.targetMount)?.owner.objectId;if(found.has(parent)&&!found.has(a.objectId)){found.add(a.objectId);changed=true;}}}}return [...found];
}
export function anchorConstruction(root,model,ids,pose,entries,{branch=false}={}){
 const next=copyMechanism(model),selection=constructionSelection(next,ids,{branch}),t=pose==='B'?1:0;
 if(!['A','B'].includes(pose))throw Error('Choose Pose A or B to anchor construction');
 const context=next.construction??{schema:'kaminos.construction.v1',anchors:[]};
 for(const objectId of selection){const target=rigidFrame(constructionBodyMatrix(root,next,objectId,t,entries));if(!context.anchors.some(a=>a.objectId===objectId&&a.pose===pose))context.anchors.push({objectId,pose,target});}
 next.construction=context;return next;
}
export function freeConstruction(model,ids,pose,{branch=false}={}){const next=copyMechanism(model),selection=new Set(constructionSelection(next,ids,{branch}));if(next.construction)next.construction.anchors=next.construction.anchors.filter(a=>a.pose!==pose||!selection.has(a.objectId));return next;}
function error(current,target){const desired=frameMatrix(target),p=point(desired).sub(point(current)),q=quaternion(desired).multiply(quaternion(current).invert());if(q.w<0)q.set(-q.x,-q.y,-q.z,-q.w);const length=Math.hypot(q.x,q.y,q.z),angle=2*Math.atan2(length,q.w),r=length>1e-14?[q.x,q.y,q.z].map(x=>x*angle/length):[0,0,0];return [...p.toArray(),...r];}
function goalError(current,goal){const r=error(current,goal.target);if(goal.kind==='position')r.fill(0,3);if(goal.kind==='orientation')r.fill(0,0,3);return r;}
function ancestors(m,id){const objects=new Set(),nodes=new Set(),seen=new Set();while(id){if(seen.has(id))throw Error('Construction attachment cycle');seen.add(id);const a=m.attachments?.find(a=>a.objectId===id);if(!a)break;objects.add(id);const owner=m.mounts?.find(s=>s.id===a.targetMount)?.owner;if(owner?.objectId){id=owner.objectId;continue;}let joint=owner?.joint??a.joint;while(Number.isInteger(joint)&&m.nodes[joint]){if(m.nodes[joint].parent!==null)nodes.add(joint);joint=m.nodes[joint].parent;}break;}return {objects,nodes};}
function linearSolve(matrix,rhs){const rows=matrix.map((row,i)=>[...row,rhs[i]]),n=rhs.length;for(let k=0;k<n;k++){let pivot=k;for(let i=k+1;i<n;i++)if(Math.abs(rows[i][k])>Math.abs(rows[pivot][k]))pivot=i;if(Math.abs(rows[pivot][k])<1e-24)return null;[rows[k],rows[pivot]]=[rows[pivot],rows[k]];const v=rows[k][k];for(let j=k;j<=n;j++)rows[k][j]/=v;for(let i=0;i<n;i++)if(i!==k){const f=rows[i][k];for(let j=k;j<=n;j++)rows[i][j]-=f*rows[k][j];}}return rows.map(row=>row[n]);}
export function constructionState(root,m,t,entries,requested=[]){
 const anchors=(m.construction?.anchors??[]).filter(a=>t===(a.pose==='B'?1:0));
 const state=a=>{try{const actual=constructionBodyMatrix(root,m,a.objectId,t,entries),r=goalError(actual,a),positionError=Math.hypot(...r.slice(0,3)),angleError=Math.hypot(...r.slice(3));return {...a,actual:rigidFrame(actual),positionError,angleError,status:positionError<1e-5&&angleError<1e-5?'held':'residual'};}catch(e){return {...a,status:'missing',reason:e.message};}};
 return {pose:t===1?'B':'A',anchors:anchors.map(state),requested:requested.map(state),method:'geometric revolute accommodation; fixed bases; best effort when constraints conflict'};
}
export function solveConstruction(root,model,t,entries,requested=[]){
 const next=copyMechanism(model),anchors=(next.construction?.anchors??[]).filter(a=>t===(a.pose==='B'?1:0)),goals=[...anchors,...requested].filter(g=>{try{constructionBodyMatrix(root,next,g.objectId,t,entries);return true;}catch{return false;}});
 if(t!==0&&t!==1)throw Error('Construction editing requires Pose A or B');
 if(!goals.length)return {recipe:next,...constructionState(root,next,t,entries,requested)};
 const paths=goals.map(g=>ancestors(next,g.objectId)),objects=new Set(paths.flatMap(p=>[...p.objects])),nodes=new Set(paths.flatMap(p=>[...p.nodes]));
 const variables=[...(next.attachments??[]).filter(a=>objects.has(a.objectId)&&a.hinge).map(a=>({objectId:a.objectId,get:()=>a.hinge[t],set:v=>a.hinge[t]=v,frame:()=>hingeWorldFrame(root,next,a,t,entries)})),...[...nodes].map(id=>({joint:id,get:()=>next.nodes[id].angles[t],set:v=>next.nodes[id].angles[t]=v,frame:()=>{const f=jointMatrix(root,next,next.nodes[id].parent,t);return f;}}))];
 const residual=()=>goals.flatMap(g=>goalError(constructionBodyMatrix(root,next,g.objectId,t,entries),g));
 const cost=r=>r.reduce((s,x)=>s+x*x,0);let r=residual(),score=cost(r),damping=1e-4,iterations=0;
 // Levenberg-Marquardt terminates on residual, step or progress tolerance.
 // No target is dropped and no per-part iteration or input-count cap is used.
 while(variables.length&&score>1e-16){
  const worlds=goals.map(g=>constructionBodyMatrix(root,next,g.objectId,t,entries)),columns=variables.map(v=>{const f=v.frame(),axis=new T.Vector3(0,0,1).transformDirection(f),origin=point(f);return goals.flatMap((g,i)=>{const path=paths[i];if(!(v.objectId?path.objects.has(v.objectId):path.nodes.has(v.joint)))return [0,0,0,0,0,0];return [...(g.kind==='orientation'?[0,0,0]:axis.clone().cross(point(worlds[i]).sub(origin)).toArray()),...(g.kind==='position'?[0,0,0]:axis.toArray())];});});
  const matrix=variables.map((_,i)=>variables.map((_,j)=>columns[i].reduce((sum,x,k)=>sum+x*columns[j][k],i===j?damping:0))),rhs=columns.map(c=>c.reduce((sum,x,k)=>sum+x*r[k],0)),step=linearSolve(matrix,rhs);if(!step||step.some(x=>!Number.isFinite(x)))break;
  const norm=Math.hypot(...step);if(norm<1e-11)break;const trust=Math.min(1,.5/norm),before=variables.map(v=>v.get());variables.forEach((v,i)=>v.set(before[i]+step[i]*trust));const trial=residual(),nextScore=cost(trial);iterations++;
  if(nextScore<score){const progress=score-nextScore;r=trial;score=nextScore;damping=Math.max(1e-12,damping/3);if(progress<1e-15*Math.max(1,score))break;}
  else{variables.forEach((v,i)=>v.set(before[i]));damping*=10;if(damping>1e12)break;}
 }
 return {recipe:next,...constructionState(root,next,t,entries,requested),iterations};
}
