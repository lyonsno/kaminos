import {reduceSurfelRows} from './surfel-field-reduction.mjs';
import {fitSurfaceFootprints} from './surface-splat-footprints.mjs';

// Static 4 -> 2 -> original hierarchy. Connectivity is a hard constraint;
// geometry/material residuals rank the optional refinements within the budget.
export function adaptSurfaceSplats(source,meta,triangles,{targetCount}={}){
 if(!Number.isSafeInteger(targetCount)||targetCount<1)throw Error('Positive integer targetCount required');
 if(!(triangles instanceof Uint32Array)||triangles.length%3||!triangles.every(i=>i<meta.count))throw Error('Invalid source triangles');
 const coarse=reduceSurfelRows(source,meta,4),fine=reduceSurfelRows(source,meta,2),n=meta.count;
 const roots=new Uint32Array(n),children=new Uint32Array(n);
 for(let i=0;i<n;i++)roots[i]=children[i]=i;
 const find=(parent,i)=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
 const join=(parent,a,b)=>{a=find(parent,a);b=find(parent,b);if(a!==b)parent[Math.max(a,b)]=Math.min(a,b);};
 const edge=(a,b)=>{if(coarse.parent[a]!==coarse.parent[b])return;join(roots,a,b);if(fine.parent[a]===fine.parent[b])join(children,a,b);};
 for(let t=0;t<triangles.length;t+=3){edge(triangles[t],triangles[t+1]);edge(triangles[t+1],triangles[t+2]);edge(triangles[t+2],triangles[t]);}
 const groups=new Map();
 for(let i=0;i<n;i++){const id=find(roots,i);children[i]=find(children,i);let ids=groups.get(id);if(!ids){ids=[];groups.set(id,ids);}ids.push(i);}
 const radius=meta.radius,heap=[],leaves=new Set();
 const higher=(a,b)=>a.error>b.error||(a.error===b.error&&a.ids[0]<b.ids[0]);
 function push(node){let i=heap.length;heap.push(node);while(i){const p=(i-1)>>1;if(!higher(node,heap[p]))break;heap[i]=heap[p];i=p;}heap[i]=node;}
 function pop(){const top=heap[0],last=heap.pop();if(heap.length){let i=0;while(i*2+1<heap.length){let c=i*2+1;if(c+1<heap.length&&higher(heap[c+1],heap[c]))c++;if(!higher(heap[c],last))break;heap[i]=heap[c];i=c;}heap[i]=last;}return top;}
 function make(ids,factor){
  const mean=new Float64Array(12);let row=mean;for(const id of ids)for(let a=0;a<12;a++)row[a]+=source[id*12+a]/ids.length;
  if(ids.length===1)row.set(source.subarray(ids[0]*12,ids[0]*12+12));
  else {const len=Math.hypot(row[3],row[4],row[5]);for(let a=3;a<6;a++)row[a]/=len;}
  let plane=0,normal=0,material=0;
  for(const id of ids){const k=id*12,dx=source[k]-row[0],dy=source[k+1]-row[1],dz=source[k+2]-row[2];plane=Math.max(plane,Math.abs(dx*row[3]+dy*row[4]+dz*row[5]));
   const len=Math.hypot(source[k+3],source[k+4],source[k+5]);normal=Math.max(normal,1-(source[k+3]*row[3]+source[k+4]*row[4]+source[k+5]*row[5])/len);
   for(let a=6;a<12;a++)material=Math.max(material,Math.abs(source[k+a]-row[a]));
  }
  // A few interior support probes detect holes/concavity missed by normal agreement.
  // This is a ranking heuristic, not a bound on rendered image error.
  let gap=0;
  if(ids.length>1){
   const local=new Float32Array(ids.length*12);ids.forEach((id,i)=>local.set(source.subarray(id*12,id*12+12),i*12));
   const f=fitSurfaceFootprints(local,new Float32Array(row),new Uint32Array(ids.length),radius);
   for(const [u,v]of [[0,0],[1,0],[-1,0],[0,1],[0,-1],[.707,.707],[-.707,.707],[.707,-.707],[-.707,-.707]]){
    const point=[0,1,2].map(a=>row[a]+u*f[a]*f[3]+v*f[a+4]*f[7]);let distance=Infinity;
    for(const id of ids){const k=id*12;distance=Math.min(distance,Math.hypot(source[k]-point[0],source[k+1]-point[1],source[k+2]-point[2]));}
    gap=Math.max(gap,Math.max(0,distance-radius));
   }
  }
  return {ids,factor,row:new Float32Array(row),error:ids.length===1?0:Math.max(plane/radius,normal/.15,material/.15,gap/radius),plane};
 }
 for(const ids of groups.values()){const node=make(ids,4);leaves.add(node);if(ids.length>1)push(node);}
 const minimumCount=leaves.size;let splits=0;
 while(heap.length&&leaves.size<targetCount){
  const node=pop(),sub=new Map();
  for(const id of node.ids){const key=node.factor===4?children[id]:id;let ids=sub.get(key);if(!ids){ids=[];sub.set(key,ids);}ids.push(id);}
  if(leaves.size+sub.size-1>targetCount)continue;
  leaves.delete(node);splits++;
  for(const ids of sub.values()){const next=make(ids,node.factor/2);leaves.add(next);if(ids.length>1)push(next);}
 }
 const ordered=[...leaves].sort((a,b)=>a.ids[0]-b.ids[0]),data=new Float32Array(ordered.length*12),parent=new Uint32Array(n),factors=new Uint8Array(ordered.length),depthTolerance=new Float32Array(ordered.length),histogram={};
 for(let j=0;j<ordered.length;j++){const node=ordered[j];data.set(node.row,j*12);for(const id of node.ids)parent[id]=j;factors[j]=node.ids.length===1?1:node.factor;histogram[factors[j]]=(histogram[factors[j]]??0)+1;
  // Fit residual, not the largest cell in the asset, sets local wall tolerance.
  depthTolerance[j]=radius*1.5+node.plane*2;
 }
 const {triangles:ignoredTriangles,dataSHA256:ignoredHash,reduction:ignoredReduction,...base}=meta;
 return {data,parent,factors,depthTolerance,footprints:fitSurfaceFootprints(source,data,parent,radius),meta:{...base,count:ordered.length,sourceCount:n,radius,adaptive:{schema:'static-connected-splats.v1',targetCount,minimumCount,targetExceeded:ordered.length>targetCount,unusedBudget:Math.max(0,targetCount-ordered.length),splits,histogram,maxRemainingError:ordered.reduce((m,v)=>Math.max(m,v.error),0),score:'max(plane/radius, normal-departure/.15, material-departure/.15, unsupported-probe-distance/radius)',connectivity:'source triangle edges within each cell and normal/opacity group'}}};
}
