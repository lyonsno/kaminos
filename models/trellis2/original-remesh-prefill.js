// Upstream CuMesh MIT notice: vendor/original-remesh/LICENSE.
// MtlMesh::fill_holes: fill short boundary components with a vertex at the
// mean of edge midpoints, then append one fan triangle per boundary edge.
// This is prefill only; no component removal, welding or normal repair.
export function prefillRemeshHoles(vertices,triangles,maxPerimeter=.03){
  const nv=vertices.length/3,edges=new Float64Array(triangles.length);
  if(!Number.isSafeInteger(nv*nv))throw RangeError('original remesh edge keys exceed exact integer capacity');
  const key=(a,b)=>Math.min(a,b)*nv+Math.max(a,b);let p=0;
  for(let i=0;i<triangles.length;i+=3){const [a,b,c]=triangles.subarray(i,i+3);edges[p++]=key(a,b);edges[p++]=key(b,c);edges[p++]=key(c,a);}
  edges.sort();const boundary=[],adjacent=new Map();
  for(let i=0;i<edges.length;){let j=i+1;while(j<edges.length&&edges[j]===edges[i])j++;
    if(j-i===1){const a=Math.floor(edges[i]/nv),b=edges[i]%nv,index=boundary.length;boundary.push([a,b]);
      for(const v of [a,b]){if(!adjacent.has(v))adjacent.set(v,[]);adjacent.get(v).push(index);}}
    i=j;
  }
  // Native components join boundary edges only through degree-two vertices.
  // Two closed loops may touch at a higher-degree vertex without becoming one
  // component. At each endpoint a loop needs another edge in its own component.
  const parent=Uint32Array.from({length:boundary.length},(_,i)=>i);
  const root=id=>{while(parent[id]!==id){parent[id]=parent[parent[id]];id=parent[id];}return id;};
  for(const around of adjacent.values())if(around.length===2){
    const a=root(around[0]),b=root(around[1]);parent[Math.max(a,b)]=Math.min(a,b);
  }
  const components=new Map(),loops=[];let ambiguous=0;
  for(let id=0;id<boundary.length;id++){
    const component=root(id);if(!components.has(component))components.set(component,[]);components.get(component).push(id);
  }
  for(const [component,ids] of components){
    let closed=true,perimeter=0;
    for(const id of ids){const [a,b]=boundary[id];
      perimeter+=Math.hypot(vertices[a*3]-vertices[b*3],vertices[a*3+1]-vertices[b*3+1],vertices[a*3+2]-vertices[b*3+2]);
      for(const v of [a,b])if(!adjacent.get(v).some(e=>e!==id&&root(e)===component))closed=false;
    }
    if(!closed){ambiguous++;continue;}if(perimeter<=maxPerimeter)loops.push(ids);
  }
  const outV=new Float32Array(vertices.length+loops.length*3),outF=new Uint32Array(triangles.length+loops.reduce((n,l)=>n+l.length*3,0));
  outV.set(vertices);outF.set(triangles);p=triangles.length;
  loops.forEach((loop,i)=>{
    const center=[0,0,0];for(const e of loop){const [a,b]=boundary[e];for(let axis=0;axis<3;axis++)center[axis]=Math.fround(center[axis]+Math.fround(Math.fround(vertices[a*3+axis]+vertices[b*3+axis])*.5));}
    for(let axis=0;axis<3;axis++)outV[(nv+i)*3+axis]=center[axis]/loop.length;
    for(const e of loop){const [a,b]=boundary[e];outF.set([b,a,nv+i],p);p+=3;}
  });
  return {vertices:outV,triangles:outF,receipt:{maxPerimeter,filledLoops:loops.length,boundaryEdges:boundary.length,ambiguousComponents:ambiguous,
    route:'boundary midpoint fan; manifold-connected closed loops; ascending edge order',
    sourceLimit:'Native perimeter arithmetic near the threshold is not asserted bit-identical'}};
}
