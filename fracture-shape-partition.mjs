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
export function geodesicNeckPartition(graph,{minReachFraction=.04,maxCutRatio=4,minAreaFraction=.0005,cleanupAreaFraction=.001}={}){
 if(graph?.route!==SHAPE_PARTITION_ROUTE)throw Error('Source shape graph required');
 if(![minReachFraction,maxCutRatio,minAreaFraction,cleanupAreaFraction].every(Number.isFinite)||minReachFraction<0||minReachFraction>1||maxCutRatio<=0||minAreaFraction<0||minAreaFraction>1||cleanupAreaFraction<0||cleanupAreaFraction>1)throw Error('Finite positive neck criteria required');
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
 const roots=[...new Set(order.map(i=>f.root(i)))].map(r=>tree[r]);
 const concave=partitionShape(graph,{concavityDegrees:20,minAreaFraction:cleanupAreaFraction});
 const hierarchy=buildBranchHierarchy(graph,{children,roots,candidates,patchLabels:concave.labels});
 const fine=summarizeOwners(graph,hierarchy.faceOwners);
 const base={route:'kaminos.fracture.geodesic-neck-hierarchy.v1',settings:{minReachFraction,maxCutRatio,minAreaFraction,cleanupAreaFraction},triangleCount:n,sourceComponents:seeds.size,diagnostics:graph.diagnostics,...fine,hierarchy,candidateBranches:candidates.map(({node,...c})=>c),claim:'Nested surface branch and patch proposals; no inferred solid volume or fracture physics'};
 return base;
}

function summarizeOwners(graph,owners){
 const groups=new Map();for(let i=0;i<owners.length;i++){const id=owners[i];if(!groups.has(id))groups.set(id,[]);groups.get(id).push(i);}
 const parts=[...groups].map(([nodeId,faces])=>{
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity],center=[0,0,0];let area=0;
  for(const i of faces){const t=graph.triangles[i];area+=t.area;for(let k=0;k<3;k++){center[k]+=t.center[k]*t.area;for(const j of t.ids){min[k]=Math.min(min[k],graph.vertices[j][k]);max[k]=Math.max(max[k],graph.vertices[j][k]);}}}
  return{nodeId,faces,triangles:faces.length,area,areaFraction:area/graph.totalArea,center:area?center.map(v=>v/area):graph.triangles[faces[0]].center,bounds:{min,max}};
 }).sort((a,b)=>b.area-a.area||a.nodeId-b.nodeId);
 const labels=new Uint32Array(owners.length);parts.forEach((p,id)=>{p.id=id;for(const face of p.faces)labels[face]=id;delete p.faces;});
 const boundaries=[];for(const e of graph.links){const pair=e.faces.map(i=>labels[i]);if(pair[0]!==pair[1])boundaries.push({vertices:[e.a,e.b],points:[graph.vertices[e.a],graph.vertices[e.b]],parts:pair,concavity:e.concavity});}
 return{labels,parts,boundaries,attachments:summarizeInterfaces(boundaries)};
}
function summarizeInterfaces(boundaries){
 const map=new Map();for(const b of boundaries){const [a,c]=b.parts,k=key(a,c);if(!map.has(k))map.set(k,{parts:[Math.min(a,c),Math.max(a,c)],edgeCount:0,length:0});const item=map.get(k);item.edgeCount++;item.length+=Math.hypot(...sub(b.points[0],b.points[1]));}return [...map.values()];
}

export function buildBranchHierarchy(graph,{children,roots,candidates,patchLabels}){
 const n=graph.triangles.length,nodes=[],faceOwners=new Uint32Array(n),candidateMap=new Map(candidates.map(c=>[c.node,c]));
 const add=(parent,kind,metadata={})=>{const id=nodes.length;nodes.push({id,parent,kind,depth:parent===null?0:nodes[parent].depth+1,children:[],ownTriangles:0,triangles:0,area:0,...metadata});if(parent!==null)nodes[parent].children.push(id);return id;};
 for(const root of roots){
  const component=add(null,'component'),stack=[[root,component]];
  while(stack.length){let [node,owner]=stack.pop();if(candidateMap.has(node)){const {reach,cutRatio}=candidateMap.get(node);owner=add(owner,'branch',{reach,cutRatio});}
   if(node<n)faceOwners[node]=owner;else for(const child of children[node-n])stack.push([child,owner]);
  }
 }
 // Concavity cleanup refines the remaining surface owned by each branch; it
 // never changes which branch proposals were admitted or their parent relation.
 const patches=new Map();for(let i=0;i<n;i++){const owner=faceOwners[i];if(!patches.has(owner))patches.set(owner,new Map());const groups=patches.get(owner),p=patchLabels[i];if(!groups.has(p))groups.set(p,[]);groups.get(p).push(i);}
 for(const [owner,groups]of patches)if(groups.size>1)for(const faces of groups.values()){const patch=add(owner,'patch');for(const i of faces)faceOwners[i]=patch;}
 for(let i=0;i<n;i++){const node=nodes[faceOwners[i]];node.ownTriangles++;node.triangles++;node.area+=graph.triangles[i].area;}
 for(let i=nodes.length-1;i>=0;i--){const node=nodes[i];if(node.parent!==null){nodes[node.parent].triangles+=node.triangles;nodes[node.parent].area+=node.area;}}
 const maxDepth=nodes.reduce((m,n)=>Math.max(m,n.depth),0);
 return{schema:'kaminos.fracture.part-hierarchy.v1',nodes,faceOwners,maxDepth};
}

export function shapeHierarchyView(result,detailLevel){
 const h=result.hierarchy;
 if(!h||!Number.isInteger(detailLevel)||detailLevel<0||detailLevel>h.maxDepth)throw Error('Choose an existing hierarchy detail level');
 const visibleOwner=id=>{while(h.nodes[id].depth>detailLevel)id=h.nodes[id].parent;return id;},groups=new Map();
 for(const p of result.parts){const owner=visibleOwner(p.nodeId);if(!groups.has(owner))groups.set(owner,{nodeId:owner,triangles:0,area:0,center:[0,0,0],bounds:{min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]}});const g=groups.get(owner);g.triangles+=p.triangles;g.area+=p.area;for(let k=0;k<3;k++){g.center[k]+=p.center[k]*p.area;g.bounds.min[k]=Math.min(g.bounds.min[k],p.bounds.min[k]);g.bounds.max[k]=Math.max(g.bounds.max[k],p.bounds.max[k]);}}
 const totalArea=result.parts.reduce((s,q)=>s+q.area,0),parts=[...groups.values()].sort((a,b)=>b.area-a.area||a.nodeId-b.nodeId),ids=new Map();parts.forEach((p,id)=>{p.id=id;ids.set(p.nodeId,id);p.center=p.area?p.center.map(v=>v/p.area):result.parts.find(q=>visibleOwner(q.nodeId)===p.nodeId).center;p.areaFraction=p.area/totalArea;});
 const map=result.parts.map(p=>ids.get(visibleOwner(p.nodeId))),labels=Uint32Array.from(result.labels,id=>map[id]),boundaries=[];
 for(const b of result.boundaries){const pair=b.parts.map(id=>map[id]);if(pair[0]!==pair[1])boundaries.push({...b,parts:pair});}
 return{detailLevel,labels,parts,boundaries,attachments:summarizeInterfaces(boundaries)};
}
