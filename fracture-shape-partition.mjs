// Geometry-only draft. Every source triangle keeps its identity and geometry.
export const SHAPE_PARTITION_ROUTE = 'kaminos.fracture.concave-surface-regions.v1';
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const key=(a,b)=>a<b?`${a}:${b}`:`${b}:${a}`;
function forest(n,areas){
 const parent=Int32Array.from({length:n},(_,i)=>i),area=Float64Array.from(areas);
 const root=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
 const join=(a,b)=>{a=root(a);b=root(b);if(a===b)return a;if(area[a]<area[b]||area[a]===area[b]&&a>b)[a,b]=[b,a];parent[b]=a;area[a]+=area[b];return a;};
 return {root,join,area};
}
export function buildShapeGraph({positions,indices}) {
 if(!positions?.length||positions.length%3||!Array.from(positions).every(Number.isFinite))throw Error('Finite complete positions required');
 if(!indices?.length||indices.length%3||!Array.from(indices).every(i=>Number.isInteger(i)&&i>=0&&i<positions.length/3))throw Error('Complete valid triangle indices required');
 // Exact welding reconnects attribute seams without bridging nearby walls.
 const vertices=[],weld=new Map(),remap=new Uint32Array(positions.length/3);
 for(let i=0;i<remap.length;i++){
  const p=Array.from(positions.slice(i*3,i*3+3)),label=p.join(':');
  if(!weld.has(label)){weld.set(label,vertices.length);vertices.push(p);}remap[i]=weld.get(label);
 }
 const triangles=[],edges=new Map(),faceKeys=new Map(),duplicates=[],diagnostics={duplicateTriangles:0,degenerateTriangles:0,openEdges:0,nonManifoldEdges:0,inconsistentEdges:0};
 for(let i=0;i<indices.length;i+=3){
  const ids=[remap[indices[i]],remap[indices[i+1]],remap[indices[i+2]]],p=ids.map(j=>vertices[j]);
  const normal=cross(sub(p[1],p[0]),sub(p[2],p[0])),length=Math.hypot(...normal),face=triangles.length;
  triangles.push({ids,area:length/2,normal:length?normal.map(x=>x/length):[0,0,0],center:[0,1,2].map(k=>(p[0][k]+p[1][k]+p[2][k])/3)});
  if(!length){diagnostics.degenerateTriangles++;continue;}
  const faceKey=[...ids].sort((a,b)=>a-b).join(':');
  if(faceKeys.has(faceKey)){duplicates.push([face,faceKeys.get(faceKey)]);diagnostics.duplicateTriangles++;continue;}
  faceKeys.set(faceKey,face);
  for(let j=0;j<3;j++){
   const a=ids[j],b=ids[(j+1)%3],k=key(a,b);
   if(!edges.has(k))edges.set(k,{a,b,faces:[]});edges.get(k).faces.push({face,a,b});
  }
 }
 const links=[],source=forest(triangles.length,triangles.map(t=>t.area));
 for(const edge of edges.values()){
  if(edge.faces.length===1){diagnostics.openEdges++;continue;}
  const ambiguous=edge.faces.length!==2;
  if(ambiguous)diagnostics.nonManifoldEdges++;
  // A shared edge remains graph connectivity even when it has several sheets.
  // Its convex/concave side is ambiguous, so it supplies a neutral analysis link.
  // This is grouping only: no manifoldness or mechanical attachment is inferred.
  const a=edge.faces[0];
  for(const b of edge.faces.slice(1)){
   const inconsistent=a.a!==b.b||a.b!==b.a;if(inconsistent)diagnostics.inconsistentEdges++;
   const direction=sub(vertices[a.b],vertices[a.a]),length=Math.hypot(...direction),n=triangles[a.face].normal,m=triangles[b.face].normal;
   const fold=Math.atan2(dot(cross(n,m),direction.map(v=>v/length)),Math.max(-1,Math.min(1,dot(n,m))))*180/Math.PI;
   links.push({a:edge.a,b:edge.b,faces:[a.face,b.face],length,concavity:ambiguous||inconsistent?0:Math.max(0,-fold),ambiguous:ambiguous||inconsistent});
   source.join(a.face,b.face);
  }
 }
 for(const pair of duplicates)source.join(...pair);
 const totalArea=triangles.reduce((s,t)=>s+t.area,0);
 if(!(totalArea>0))throw Error('Source has no positive-area surface');
 return {route:SHAPE_PARTITION_ROUTE,vertices,triangles,links,duplicates,totalArea,sourceComponents:new Set(triangles.map((_,i)=>source.root(i))).size,diagnostics};
}
export function partitionShape(graph,{concavityDegrees=20,minAreaFraction=.001}={}){
 if(!Number.isFinite(concavityDegrees)||concavityDegrees<0||concavityDegrees>180)throw Error('Finite concavity angle between 0 and 180 required');
 if(!Number.isFinite(minAreaFraction)||minAreaFraction<0||minAreaFraction>1)throw Error('Finite small-region area fraction between 0 and 1 required');
 if(graph?.route!==SHAPE_PARTITION_ROUTE)throw Error('Source shape graph required');
 const {triangles,vertices,links,totalArea}=graph,f=forest(triangles.length,triangles.map(t=>t.area));
 for(const pair of graph.duplicates)f.join(...pair);
 for(const link of links)if(link.concavity<=concavityDegrees)f.join(...link.faces);
 // Merge sub-threshold regions across their least concave available boundary.
 // No triangles are discarded, and disconnected surfaces never get joined.
 const ordered=[...links].sort((a,b)=>a.concavity-b.concavity||a.faces[0]-b.faces[0]);
 for(const link of ordered){const [a,b]=link.faces.map(f.root);if(a!==b&&(f.area[a]<totalArea*minAreaFraction||f.area[b]<totalArea*minAreaFraction))f.join(a,b);}
 const groups=new Map();
 triangles.forEach((t,i)=>{const r=f.root(i);if(!groups.has(r))groups.set(r,{root:r,area:0,faces:[]});const g=groups.get(r);g.area+=t.area;g.faces.push(i);});
 const sorted=[...groups.values()].sort((a,b)=>b.area-a.area||a.root-b.root),labels=new Uint32Array(triangles.length);
 const parts=sorted.map((g,id)=>{
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity],center=[0,0,0];
  for(const face of g.faces){labels[face]=id;const t=triangles[face];for(let k=0;k<3;k++){center[k]+=t.center[k]*t.area;for(const j of t.ids){min[k]=Math.min(min[k],vertices[j][k]);max[k]=Math.max(max[k],vertices[j][k]);}}}
  return {id,triangles:g.faces.length,area:g.area,areaFraction:g.area/totalArea,center:g.area?center.map(x=>x/g.area):triangles[g.faces[0]].center,bounds:{min,max}};
 });
 const boundaries=[],interfaces=new Map();
 for(const link of links){const [a,b]=link.faces.map(i=>labels[i]);if(a===b)continue;
  boundaries.push({vertices:[link.a,link.b],points:[vertices[link.a],vertices[link.b]],parts:[a,b],concavity:link.concavity});const k=key(a,b);
  if(!interfaces.has(k))interfaces.set(k,{parts:[Math.min(a,b),Math.max(a,b)],edgeCount:0,length:0,center:[0,0,0]});
  const item=interfaces.get(k);item.edgeCount++;item.length+=link.length;for(let i=0;i<3;i++)item.center[i]+=(vertices[link.a][i]+vertices[link.b][i])/2*link.length;
 }
 const attachments=[...interfaces.values()].map(x=>({...x,center:x.center.map(v=>v/x.length)}));
 return {route:SHAPE_PARTITION_ROUTE,settings:{concavityDegrees,minAreaFraction},triangleCount:triangles.length,sourceComponents:graph.sourceComponents,diagnostics:{...graph.diagnostics},labels,parts,boundaries,attachments,claim:'Concavity-guided candidate surface regions and shared cut edges; no semantic part labels, mechanical bonds or fracture simulation'};
}

// Superlevel components of surface geodesic distance expose branches at saddles.
// Boundary length / area distinguishes a narrow attachment from a broad wall cut.
export function geodesicNeckPartition(graph,{minReachFraction=.04,maxCutRatio=4,minAreaFraction=.0005}={}){
 if(graph?.route!==SHAPE_PARTITION_ROUTE)throw Error('Source shape graph required');
 if(![minReachFraction,maxCutRatio,minAreaFraction].every(Number.isFinite)||minReachFraction<0||maxCutRatio<=0||minAreaFraction<0)throw Error('Finite positive neck criteria required');
 const {triangles,links,totalArea}=graph,n=triangles.length,neighbors=Array.from({length:n},()=>[]);
 for(const e of links){const [a,b]=e.faces,w=Math.hypot(...sub(triangles[a].center,triangles[b].center));neighbors[a].push([b,w,e.length]);neighbors[b].push([a,w,e.length]);}
 for(const [a,b]of graph.duplicates){neighbors[a].push([b,0,0]);neighbors[b].push([a,0,0]);}
 const center=[0,1,2].map(k=>triangles.reduce((s,t)=>s+t.center[k]*t.area,0)/totalArea),lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
 for(const p of graph.vertices)for(let k=0;k<3;k++){lo[k]=Math.min(lo[k],p[k]);hi[k]=Math.max(hi[k],p[k]);}
 const diagonal=Math.hypot(...sub(hi,lo)),distance=new Float64Array(n).fill(Infinity),heap=[];
 const push=(i,d)=>{const item=[i,d];let k=heap.length;heap.push(item);while(k){const p=(k-1)>>1;if(heap[p][1]<=d)break;heap[k]=heap[p];k=p;}heap[k]=item;};
 const pop=()=>{const out=heap[0],last=heap.pop();if(heap.length){let k=0;while(k*2+1<heap.length){let c=k*2+1;if(c+1<heap.length&&heap[c+1][1]<heap[c][1])c++;if(heap[c][1]>=last[1])break;heap[k]=heap[c];k=c;}heap[k]=last;}return out;};
 // One nearest-to-centroid seed per connected surface component.
 const connectivity=forest(n,triangles.map(t=>t.area));for(const e of links)connectivity.join(...e.faces);for(const p of graph.duplicates)connectivity.join(...p);
 const seeds=new Map();for(let i=0;i<n;i++){const r=connectivity.root(i),d=Math.hypot(...sub(triangles[i].center,center)),old=seeds.get(r);if(!old||d<old[1])seeds.set(r,[i,d]);}
 for(const [i]of seeds.values()){distance[i]=0;push(i,0);}
 while(heap.length){const [i,d]=pop();if(d!==distance[i])continue;for(const [j,w]of neighbors[i]){const next=d+w;if(next<distance[j]){distance[j]=next;push(j,next);}}}
 const order=Array.from({length:n},(_,i)=>i).sort((a,b)=>distance[b]-distance[a]||a-b),active=new Uint8Array(n),f=forest(n,triangles.map(t=>t.area)),boundary=new Float64Array(n),peak=Float64Array.from(distance),tree=Int32Array.from({length:n},(_,i)=>i),children=[],candidates=[];
 const join=(a,b,interfaceLength)=>{a=f.root(a);b=f.root(b);if(a===b){boundary[a]-=interfaceLength*2;return a;}const area=f.area[a]+f.area[b],edge=boundary[a]+boundary[b]-2*interfaceLength,node=n+children.length;children.push([tree[a],tree[b]]);const p=Math.max(peak[a],peak[b]),r=f.join(a,b);f.area[r]=area;boundary[r]=edge;peak[r]=p;tree[r]=node;return r;};
 for(const i of order){
  active[i]=1;boundary[i]=neighbors[i].reduce((s,x)=>s+x[2],0);
  const roots=new Map();for(const [j,,length]of neighbors[i])if(active[j]){const r=f.root(j);roots.set(r,(roots.get(r)||0)+length);}
  const groups=[...roots.keys()].sort((a,b)=>f.area[b]-f.area[a]);
  if(groups.length>1)for(const r of groups.slice(1)){
   const reach=peak[r]-distance[i],cutRatio=boundary[r]**2/Math.max(f.area[r],Number.MIN_VALUE);
   if(reach>=diagonal*minReachFraction&&f.area[r]>=totalArea*minAreaFraction&&cutRatio<=maxCutRatio)candidates.push({node:tree[r],area:f.area[r],reach,cutRatio,level:distance[i]});
  }
  for(const [r,length]of roots)join(i,r,length);
 }
 const labels=new Uint32Array(n),selected=[],collect=node=>{const stack=[node],faces=[];while(stack.length){const p=stack.pop();if(p<n)faces.push(p);else stack.push(...children[p-n]);}return faces;};
 // Larger surviving branch proposals win overlapping hierarchy selections.
 for(const c of candidates.sort((a,b)=>b.area-a.area||a.node-b.node)){
  const faces=collect(c.node);if(faces.some(i=>labels[i]))continue;
  const id=selected.length+1;for(const i of faces)labels[i]=id;selected.push({...c,id,faces});
 }
 // Keep source-disconnected components explicit rather than calling them joints.
 const componentLabels=new Map();for(let i=0;i<n;i++)if(!labels[i]){const r=connectivity.root(i);if(!componentLabels.has(r))componentLabels.set(r,selected.length+componentLabels.size+1);labels[i]=componentLabels.get(r);}
 // Sharp concave shoulders complement geodesic saddles on sparse triangulations.
 const concave=partitionShape(graph,{concavityDegrees:20,minAreaFraction}),pairs=new Map();
 for(let i=0;i<n;i++){const k=`${labels[i]}:${concave.labels[i]}`;if(!pairs.has(k))pairs.set(k,pairs.size);labels[i]=pairs.get(k);}
 const byLabel=new Map();for(let i=0;i<n;i++){const label=labels[i];if(!byLabel.has(label))byLabel.set(label,[]);byLabel.get(label).push(i);}
 const groups=[...byLabel.values()].map(faces=>({faces,area:faces.reduce((s,i)=>s+triangles[i].area,0)})).sort((a,b)=>b.area-a.area);
 const parts=groups.map((g,id)=>{const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity],c=[0,0,0];for(const i of g.faces){labels[i]=id;for(let k=0;k<3;k++){c[k]+=triangles[i].center[k]*triangles[i].area;for(const j of triangles[i].ids){min[k]=Math.min(min[k],graph.vertices[j][k]);max[k]=Math.max(max[k],graph.vertices[j][k]);}}}return{id,triangles:g.faces.length,area:g.area,areaFraction:g.area/totalArea,center:g.area?c.map(v=>v/g.area):triangles[g.faces[0]].center,bounds:{min,max}};});
 const boundaries=[],interfaces=new Map();for(const e of links){const [a,b]=e.faces.map(i=>labels[i]);if(a===b)continue;boundaries.push({vertices:[e.a,e.b],points:[graph.vertices[e.a],graph.vertices[e.b]],parts:[a,b],concavity:e.concavity});const k=key(a,b);if(!interfaces.has(k))interfaces.set(k,{parts:[Math.min(a,b),Math.max(a,b)],edgeCount:0,length:0});const edge=interfaces.get(k);edge.edgeCount++;edge.length+=e.length;}
 return{route:'kaminos.fracture.geodesic-neck-regions.v1',settings:{minReachFraction,maxCutRatio,minAreaFraction},triangleCount:n,sourceComponents:seeds.size,diagnostics:graph.diagnostics,labels,parts,boundaries,attachments:[...interfaces.values()],candidateBranches:candidates.map(({node,...c})=>c),claim:'Surface-geodesic branch proposals with concave-shoulder boundaries; no inferred solid volume or fracture physics'};
}
