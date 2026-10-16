// Polygon editing kernel. Topology is welded by exact position while every face
// corner keeps its source render vertex, so UVs and normals survive edits.
// Edges carry any number of faces: generated meshes are routinely non-manifold.
export const EDGE_BOUNDARY=1,EDGE_NONMANIFOLD=2,EDGE_SHARP=4,EDGE_UV_SEAM=8,EDGE_NORMAL_SEAM=16,EDGE_FLIPPED=32;
export const NO_EDGE=0xffffffff;

function checkedArray(values,name,width,count){
  if(!values)return null;
  const array=values instanceof Float32Array?values:Float32Array.from(values);
  if(count!==undefined&&array.length!==count*width)throw Error(`Polygon mesh ${name} must have ${width} values per vertex`);
  for(let i=0;i<array.length;i++)if(!Number.isFinite(array[i]))throw Error(`Polygon mesh ${name} must be finite`);
  return array;
}
function hash3(x,y,z){let h=Math.imul(x,0x9e3779b1)^Math.imul(y,0x85ebca77)^Math.imul(z,0xc2b2ae3d);h^=h>>>15;h=Math.imul(h,0x2c1b3c6d);return (h^h>>>12)>>>0;}

export function buildPolyMesh({positions,indices=null,normals=null,uvs=null}={}) {
  if(!positions||positions.length%3)throw Error('Polygon mesh positions must be xyz triples');
  const p=checkedArray(positions,'positions',3),renderVertexCount=p.length/3;
  const index=indices??Uint32Array.from({length:renderVertexCount},(_,i)=>i);
  if(index.length%3)throw Error('Polygon mesh index must list whole triangles');
  for(let i=0;i<index.length;i++){const v=index[i];if(!Number.isInteger(v)||v<0||v>=renderVertexCount)throw Error(`Polygon mesh index ${v} is outside ${renderVertexCount} vertices`);}
  const n=checkedArray(normals,'normals',3,renderVertexCount),uv=checkedArray(uvs,'UVs',2,renderVertexCount);
  const bits=new Uint32Array(p.buffer,p.byteOffset,p.length),bit=i=>bits[i]===0x80000000?0:bits[i];
  let capacity=1;while(capacity<renderVertexCount*2)capacity<<=1;
  const table=new Int32Array(capacity).fill(-1),renderVertexToVertex=new Uint32Array(renderVertexCount),firstRender=[];
  for(let r=0;r<renderVertexCount;r++){
    const x=bit(3*r),y=bit(3*r+1),z=bit(3*r+2);
    for(let h=hash3(x,y,z)&capacity-1;;h=h+1&capacity-1){
      const s=table[h];
      if(s<0){table[h]=r;renderVertexToVertex[r]=firstRender.length;firstRender.push(r);break;}
      if(bit(3*s)===x&&bit(3*s+1)===y&&bit(3*s+2)===z){renderVertexToVertex[r]=renderVertexToVertex[s];break;}
    }
  }
  const vertexCount=firstRender.length,vertexPositions=new Float32Array(vertexCount*3);
  firstRender.forEach((r,v)=>vertexPositions.set(p.subarray(3*r,3*r+3),3*v));
  const faceCount=index.length/3,cornerRenderVertex=Uint32Array.from(index),cornerVertex=new Uint32Array(index.length);
  for(let c=0;c<index.length;c++)cornerVertex[c]=renderVertexToVertex[index[c]];
  const faceDegenerate=new Uint8Array(faceCount),cornerEdge=new Uint32Array(index.length).fill(NO_EDGE),edgeIds=new Map(),edgePairs=[],incidence=[];
  for(let f=0;f<faceCount;f++){
    const a=cornerVertex[3*f],b=cornerVertex[3*f+1],c=cornerVertex[3*f+2];
    if(a===b||b===c||c===a){faceDegenerate[f]=1;continue;}
    for(let i=0;i<3;i++){
      const u=cornerVertex[3*f+i],v=cornerVertex[3*f+(i+1)%3],lo=Math.min(u,v),hi=Math.max(u,v),key=lo*vertexCount+hi;
      let e=edgeIds.get(key);
      if(e===undefined){e=edgePairs.length/2;edgeIds.set(key,e);edgePairs.push(lo,hi);incidence.push(0);}
      cornerEdge[3*f+i]=e;incidence[e]++;
    }
  }
  const edgeCount=incidence.length,edgeFaceOffsets=new Uint32Array(edgeCount+1);
  for(let e=0;e<edgeCount;e++)edgeFaceOffsets[e+1]=edgeFaceOffsets[e]+incidence[e];
  const edgeCorners=new Uint32Array(edgeFaceOffsets[edgeCount]),fill=edgeFaceOffsets.slice(0,edgeCount);
  for(let c=0;c<cornerEdge.length;c++)if(cornerEdge[c]!==NO_EDGE)edgeCorners[fill[cornerEdge[c]]++]=c;
  const vertexFaceOffsets=new Uint32Array(vertexCount+1),distinct=f=>{const a=cornerVertex[3*f],b=cornerVertex[3*f+1],c=cornerVertex[3*f+2];return [a,...(b!==a?[b]:[]),...(c!==a&&c!==b?[c]:[])];};
  for(let f=0;f<faceCount;f++)for(const v of distinct(f))vertexFaceOffsets[v+1]++;
  for(let v=0;v<vertexCount;v++)vertexFaceOffsets[v+1]+=vertexFaceOffsets[v];
  const vertexFaces=new Uint32Array(vertexFaceOffsets[vertexCount]),vertexFill=vertexFaceOffsets.slice(0,vertexCount);
  for(let f=0;f<faceCount;f++)for(const v of distinct(f))vertexFaces[vertexFill[v]++]=f;
  return {renderVertexCount,faceCount,vertexCount,edgeCount,positions:p,normals:n,uvs:uv,renderVertexToVertex,vertexPositions,
    cornerRenderVertex,cornerVertex,cornerEdge,faceDegenerate,edgeVertices:Uint32Array.from(edgePairs),edgeFaceOffsets,edgeCorners,vertexFaceOffsets,vertexFaces};
}

export function faceNormals(mesh) {
  const out=new Float64Array(mesh.faceCount*3),q=mesh.vertexPositions,cv=mesh.cornerVertex;
  for(let f=0;f<mesh.faceCount;f++){
    const a=3*cv[3*f],b=3*cv[3*f+1],c=3*cv[3*f+2];
    const ux=q[b]-q[a],uy=q[b+1]-q[a+1],uz=q[b+2]-q[a+2],vx=q[c]-q[a],vy=q[c+1]-q[a+1],vz=q[c+2]-q[a+2];
    const x=uy*vz-uz*vy,y=uz*vx-ux*vz,z=ux*vy-uy*vx,l=Math.hypot(x,y,z);
    if(l>0){out[3*f]=x/l;out[3*f+1]=y/l;out[3*f+2]=z/l;}
  }
  return out;
}

export function classifyEdges(mesh,{sharpAngle=30}={}) {
  if(!Number.isFinite(sharpAngle)||sharpAngle<0||sharpAngle>180)throw Error('Sharp angle must be between 0 and 180 degrees');
  const flags=new Uint8Array(mesh.edgeCount),normal=faceNormals(mesh),limit=Math.cos(sharpAngle*Math.PI/180);
  const {edgeFaceOffsets:offsets,edgeCorners,edgeVertices,cornerVertex,cornerRenderVertex,uvs,normals}=mesh;
  const next=c=>c-c%3+(c%3+1)%3;
  const same=(values,width,r,s)=>{if(r===s)return true;for(let i=0;i<width;i++)if(values[width*r+i]!==values[width*s+i])return false;return true;};
  // Render vertices at the edge's low and high welded endpoints, as one incident face sees them.
  const ends=(c,e)=>cornerVertex[c]===edgeVertices[2*e]?[cornerRenderVertex[c],cornerRenderVertex[next(c)]]:[cornerRenderVertex[next(c)],cornerRenderVertex[c]];
  for(let e=0;e<mesh.edgeCount;e++){
    const k=offsets[e+1]-offsets[e];
    if(k===1){flags[e]=EDGE_BOUNDARY;continue;}
    let flag=k>2?EDGE_NONMANIFOLD:0;
    const [a1,b1]=ends(edgeCorners[offsets[e]],e);
    for(let i=offsets[e]+1;i<offsets[e+1];i++){
      const [a2,b2]=ends(edgeCorners[i],e);
      if(uvs&&!(same(uvs,2,a1,a2)&&same(uvs,2,b1,b2)))flag|=EDGE_UV_SEAM;
      if(normals&&!(same(normals,3,a1,a2)&&same(normals,3,b1,b2)))flag|=EDGE_NORMAL_SEAM;
    }
    if(k===2){
      const c1=edgeCorners[offsets[e]],c2=edgeCorners[offsets[e]+1],f1=c1/3|0,f2=c2/3|0;
      const flipped=(cornerVertex[c1]===edgeVertices[2*e])===(cornerVertex[c2]===edgeVertices[2*e]);
      if(flipped)flag|=EDGE_FLIPPED;
      const d=(normal[3*f1]*normal[3*f2]+normal[3*f1+1]*normal[3*f2+1]+normal[3*f1+2]*normal[3*f2+2])*(flipped?-1:1);
      const valid=normal[3*f1]||normal[3*f1+1]||normal[3*f1+2],validOther=normal[3*f2]||normal[3*f2+1]||normal[3*f2+2];
      if(valid&&validOther&&d<limit)flag|=EDGE_SHARP;
    }
    flags[e]=flag;
  }
  return flags;
}

function checkedDelimit(mesh,delimit,flags){
  if(!delimit)return null;
  if(!flags||flags.length!==mesh.edgeCount)throw Error('Delimiting needs edge flags classified for this mesh');
  return flags;
}
// Seams separate pairs of faces, not whole edges: on a non-manifold edge two faces
// can share a chart while a third leaves it. Group an edge's incidences by the
// delimited attributes at both endpoints; only same-group faces are linked.
const PAIRWISE=EDGE_UV_SEAM|EDGE_NORMAL_SEAM;
function incidenceGroups(mesh,e,mask){
  const {edgeFaceOffsets:offsets,edgeCorners,cornerVertex,cornerRenderVertex,edgeVertices,uvs,normals}=mesh,groups=new Map(),out=[];
  for(let i=offsets[e];i<offsets[e+1];i++){
    const c=edgeCorners[i],n=c-c%3+(c%3+1)%3,[a,b]=cornerVertex[c]===edgeVertices[2*e]?[cornerRenderVertex[c],cornerRenderVertex[n]]:[cornerRenderVertex[n],cornerRenderVertex[c]];
    const key=[...(mask&EDGE_UV_SEAM&&uvs?[...uvs.subarray(2*a,2*a+2),...uvs.subarray(2*b,2*b+2)]:[]),...(mask&EDGE_NORMAL_SEAM&&normals?[...normals.subarray(3*a,3*a+3),...normals.subarray(3*b,3*b+3)]:[])].join(',');
    if(!groups.has(key))groups.set(key,groups.size);out.push(groups.get(key));
  }
  return out;
}
// Calls visit(i,j) for incidences i,j of edge e that stay linked under the delimit mask.
function forEachLinkedPair(mesh,e,delimit,flags,from,visit){
  const o=mesh.edgeFaceOffsets[e],k=mesh.edgeFaceOffsets[e+1]-o,hit=flags?flags[e]&delimit:0;
  if(hit&~PAIRWISE)return;
  const groups=hit?incidenceGroups(mesh,e,hit):null;
  for(let j=0;j<k;j++)if(j!==from&&(!groups||groups[j]===groups[from]))visit(o+from,o+j);
}
function checkedMask(mesh,mask){
  if(!mask||mask.length!==mesh.faceCount)throw Error('Face selection must have one entry per face');
  return mask;
}
function unionFind(count){
  const parent=Uint32Array.from({length:count},(_,i)=>i);
  const find=x=>{while(parent[x]!==x){parent[x]=parent[parent[x]];x=parent[x];}return x;};
  return {find,union:(a,b)=>{a=find(a);b=find(b);if(a!==b)parent[Math.max(a,b)]=Math.min(a,b);}};
}
function components(count,find,members){
  const labels=new Uint32Array(count),ids=new Map(),sizes=[];
  for(const i of members){const r=find(i);let id=ids.get(r);if(id===undefined){id=sizes.length;ids.set(r,id);sizes.push(0);}labels[i]=id;sizes[id]++;}
  return {count:sizes.length,labels,sizes};
}

export function faceComponents(mesh,{delimit=0,flags=null}={}) {
  flags=checkedDelimit(mesh,delimit,flags);
  const {find,union}=unionFind(mesh.faceCount),{edgeFaceOffsets:offsets,edgeCorners}=mesh;
  for(let e=0;e<mesh.edgeCount;e++)for(let i=0;i<offsets[e+1]-offsets[e];i++)
    forEachLinkedPair(mesh,e,delimit,flags,i,(a,b)=>union(edgeCorners[a]/3|0,edgeCorners[b]/3|0));
  return components(mesh.faceCount,find,Array.from({length:mesh.faceCount},(_,f)=>f));
}

export function selectLinkedFaces(mesh,seeds,{delimit=0,flags=null,barrier=null}={}) {
  flags=checkedDelimit(mesh,delimit,flags);
  if(barrier&&barrier.length!==mesh.edgeCount)throw Error('Select Linked barrier must have one entry per edge');
  const mask=new Uint8Array(mesh.faceCount),stack=[];
  for(const f of seeds){if(!Number.isInteger(f)||f<0||f>=mesh.faceCount)throw Error(`Face ${f} is not in this mesh`);if(!mask[f]){mask[f]=1;stack.push(f);}}
  const {edgeFaceOffsets:offsets,edgeCorners,cornerEdge}=mesh;
  while(stack.length){
    const f=stack.pop();
    for(let c=3*f;c<3*f+3;c++){
      const e=cornerEdge[c];if(e===NO_EDGE||barrier?.[e])continue;
      const from=edgeCorners.subarray(offsets[e],offsets[e+1]).indexOf(c);
      forEachLinkedPair(mesh,e,delimit,flags,from,(_,j)=>{const g=edgeCorners[j]/3|0;if(!mask[g]){mask[g]=1;stack.push(g);}});
    }
  }
  return mask;
}

function forEachNeighbor(mesh,f,faceStep,visit){
  if(faceStep){
    for(let c=3*f;c<3*f+3;c++){const v=mesh.cornerVertex[c];for(let i=mesh.vertexFaceOffsets[v];i<mesh.vertexFaceOffsets[v+1];i++)visit(mesh.vertexFaces[i]);}
    return;
  }
  for(let c=3*f;c<3*f+3;c++){const e=mesh.cornerEdge[c];if(e===NO_EDGE)continue;for(let i=mesh.edgeFaceOffsets[e];i<mesh.edgeFaceOffsets[e+1];i++)visit(mesh.edgeCorners[i]/3|0);}
}
export function growFaceSelection(mesh,mask,{faceStep=true}={}) {
  checkedMask(mesh,mask);
  const out=Uint8Array.from(mask);
  for(let f=0;f<mesh.faceCount;f++)if(mask[f])forEachNeighbor(mesh,f,faceStep,g=>{out[g]=1;});
  return out;
}
export function shrinkFaceSelection(mesh,mask,{faceStep=true}={}) {
  checkedMask(mesh,mask);
  const out=Uint8Array.from(mask);
  for(let f=0;f<mesh.faceCount;f++)if(mask[f])forEachNeighbor(mesh,f,faceStep,g=>{if(!mask[g])out[f]=0;});
  return out;
}

export function polyMeshCensus(mesh,{sharpAngle=30}={}) {
  const flags=classifyEdges(mesh,{sharpAngle}),histogram={};
  let boundaryEdges=0,manifoldEdges=0,nonManifoldEdges=0,sharpEdges=0,uvSeamEdges=0,normalSeamEdges=0,flippedEdges=0;
  for(let e=0;e<mesh.edgeCount;e++){
    const k=mesh.edgeFaceOffsets[e+1]-mesh.edgeFaceOffsets[e];histogram[k]=(histogram[k]??0)+1;
    if(k===1)boundaryEdges++;else if(k===2)manifoldEdges++;else nonManifoldEdges++;
    sharpEdges+=!!(flags[e]&EDGE_SHARP);uvSeamEdges+=!!(flags[e]&EDGE_UV_SEAM);normalSeamEdges+=!!(flags[e]&EDGE_NORMAL_SEAM);flippedEdges+=!!(flags[e]&EDGE_FLIPPED);
  }
  const edgeConnected=faceComponents(mesh),live=[];
  let degenerateFaces=0;for(let f=0;f<mesh.faceCount;f++)if(mesh.faceDegenerate[f])degenerateFaces++;else live.push(f);
  const vertices=unionFind(mesh.vertexCount),used=new Set();
  for(const f of live){const [a,b,c]=mesh.cornerVertex.subarray(3*f,3*f+3);vertices.union(a,b);vertices.union(a,c);used.add(a).add(b).add(c);}
  const vertexConnected=components(mesh.vertexCount,vertices.find,[...used]);
  const vertexFaces=new Map();for(const f of live){const r=vertices.find(mesh.cornerVertex[3*f]);vertexFaces.set(r,(vertexFaces.get(r)??0)+1);}
  const render=unionFind(mesh.renderVertexCount),renderUsed=new Set(),index=mesh.cornerRenderVertex;
  for(let f=0;f<mesh.faceCount;f++){render.union(index[3*f],index[3*f+1]);render.union(index[3*f],index[3*f+2]);renderUsed.add(index[3*f]).add(index[3*f+1]).add(index[3*f+2]);}
  const renderFaces=new Map();for(let f=0;f<mesh.faceCount;f++){const r=render.find(index[3*f]);renderFaces.set(r,(renderFaces.get(r)??0)+1);}
  const descending=values=>[...values].sort((a,b)=>b-a);
  return {renderVertices:mesh.renderVertexCount,faces:mesh.faceCount,vertices:mesh.vertexCount,degenerateFaces,edges:mesh.edgeCount,
    boundaryEdges,manifoldEdges,nonManifoldEdges,edgeFaceHistogram:histogram,sharpAngle,sharpEdges,uvSeamEdges,normalSeamEdges,flippedEdges,
    components:edgeConnected.count,largestComponentFaces:descending(edgeConnected.sizes).slice(0,8),
    vertexConnectedComponents:vertexConnected.count,vertexConnectedLargestFaces:descending(vertexFaces.values()).slice(0,8),
    renderIndexComponents:components(mesh.renderVertexCount,render.find,[...renderUsed]).count,
    renderIndexSingleTriangleComponents:[...renderFaces.values()].filter(n=>n===1).length,renderIndexLargestComponentFaces:descending(renderFaces.values()).slice(0,8)};
}
