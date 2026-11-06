import {validateRemeshSurface} from './original-remesh-bvh.js';

// CuMesh get_edges + vertex/face and vertex/edge adjacency. A numeric key is
// exact up to 2^53; reject a larger address space instead of aliasing vertices.
// Face incidence is ascending here; native atomics do not promise that order.
export function reducerTopology(vertices,triangles){
  validateRemeshSurface(vertices,triangles);
  const V=vertices.length/3,F=triangles.length/3;
  if(!Number.isSafeInteger(V*V))throw RangeError('CuMesh reducer edge keys exceed exact integer capacity');
  const keys=new Float64Array(triangles.length),faceOffsets=new Uint32Array(V+1);
  for(let f=0;f<F;f++)for(let k=0;k<3;k++){
    const a=triangles[f*3+k],b=triangles[f*3+(k+1)%3];
    keys[f*3+k]=Math.min(a,b)*V+Math.max(a,b);faceOffsets[a+1]++;
  }
  keys.sort();let E=0;
  for(let i=0;i<keys.length;i++)if(i===0||keys[i]!==keys[i-1])E++;
  const edges=new Uint32Array(E*2),edgeOffsets=new Uint32Array(V+1),boundary=new Uint32Array(V);
  for(let i=0,e=0;i<keys.length;e++){
    const key=keys[i],a=Math.floor(key/V),b=key-a*V;let end=i+1;
    while(end<keys.length&&keys[end]===key)end++;
    edges[e*2]=a;edges[e*2+1]=b;edgeOffsets[a+1]++;edgeOffsets[b+1]++;
    if(end-i===1){boundary[a]=1;boundary[b]=1;}i=end;
  }
  for(let i=1;i<=V;i++){faceOffsets[i]+=faceOffsets[i-1];edgeOffsets[i]+=edgeOffsets[i-1];}
  const faceIds=new Uint32Array(triangles.length),edgeIds=new Uint32Array(E*2),cursor=new Uint32Array(V);
  for(let f=0;f<F;f++)for(let k=0;k<3;k++){const v=triangles[f*3+k];faceIds[faceOffsets[v]+cursor[v]++]=f;}
  cursor.fill(0);
  for(let e=0;e<E;e++)for(let k=0;k<2;k++){const v=edges[e*2+k];edgeIds[edgeOffsets[v]+cursor[v]++]=e;}
  const offsets={},packed=new Uint32Array(faceOffsets.length+faceIds.length+edgeOffsets.length+edgeIds.length+boundary.length);
  let at=0;
  for(const [key,data] of Object.entries({faceOffsets,faceIds,edgeOffsets,edgeIds,boundary})){offsets[key]=at;packed.set(data,at);at+=data.length;}
  return {packed,edges,offsets,V,F,E};
}

// CuMesh's exclusive-prefix compaction preserves vertex and face order. All
// removed vertex rows still have a prefix mapping, as in the native source.
export function compactReduction(vertices,triangles,flags){
  const V=vertices.length/3,F=triangles.length/3;
  if(flags.length<V+F)throw Error('incomplete CuMesh reduction flags');
  const map=new Uint32Array(V);let nv=0,nf=0;
  for(let i=0;i<V+F;i++)if(flags[i]>1)throw Error('invalid CuMesh keep flag');
  for(let i=0;i<V;i++){map[i]=nv;nv+=flags[i];}
  for(let f=0;f<F;f++)nf+=flags[V+f];
  const v=new Float32Array(nv*3),t=new Uint32Array(nf*3);
  for(let i=0;i<V;i++)if(flags[i])v.set(vertices.subarray(i*3,i*3+3),map[i]*3);
  for(let f=0,j=0;f<F;f++)if(flags[V+f]){for(let k=0;k<3;k++){
    const i=triangles[f*3+k];if(i>=V)throw Error('CuMesh reduced face index out of range');t[j++]=map[i];
  }}
  validateRemeshSurface(v,t);return {vertices:v,triangles:t};
}
