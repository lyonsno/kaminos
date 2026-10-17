// Browser-callable port of the accepted TRELLIS2MLX mesh finishing route
// (source 1201553 `_cleanup_and_simplify_mesh`, surface-preserving
// simplify-first mode: trellmlx/mesh_cleanup.cleanup_mesh with trimesh
// fix_normals). The source behavior depends on Python container order:
// CPython set iteration (hole tracing, BFS start face), dict insertion order,
// numpy reduction order and trimesh/networkx traversal. Those orders are
// reproduced here so the same input gives the same triangles, not a look-alike.
import {simplifyMesh} from './mesh-simplify.js';
import {loadSimplifier} from './wasm-simplify.js';
import {admitSignal,abortError,runFinishingWorker} from './finishing-worker.js';

export const MESH_POSTPROCESS_ROUTE='Trellis2MLX/surface-preserving/browser-port-of-fast-simplify-first';

// ---- CPython 3.12 set table order (setobject.c: LINEAR_PROBES 9, PERTURB_SHIFT 5).
// Keys are unique per table here, so only placement and resize matter. Hashes
// are 64-bit unsigned held as (hi, lo) uint32 halves.
class PySetOrder{
  constructor(){this.mask=7;this.keys=new Int32Array(8).fill(-1);this.hi=new Uint32Array(8);this.lo=new Uint32Array(8);this.used=0;}
  place(keys,his,los,mask,key,hi,lo){
    let i=lo&mask,pHi=hi,pLo=lo;
    for(;;){
      if(keys[i]<0){keys[i]=key;his[i]=hi;los[i]=lo;return;}
      if(i+9<=mask)for(let j=1;j<=9;j++)if(keys[i+j]<0){keys[i+j]=key;his[i+j]=hi;los[i+j]=lo;return;}
      pLo=((pLo>>>5)|((pHi&31)<<27))>>>0;pHi=pHi>>>5;
      i=(i*5+1+pLo)%(mask+1);
    }
  }
  add(key,hi,lo){
    this.place(this.keys,this.hi,this.lo,this.mask,key,hi,lo);this.used++;
    if(this.used*5>=this.mask*3)this.resize(this.used>50000?this.used*2:this.used*4);
  }
  resize(minused){
    let size=8;while(size<=minused)size*=2;
    const keys=new Int32Array(size).fill(-1),his=new Uint32Array(size),los=new Uint32Array(size);
    for(let i=0;i<=this.mask;i++)if(this.keys[i]>=0)this.place(keys,his,los,size-1,this.keys[i],this.hi[i],this.lo[i]);
    this.keys=keys;this.hi=his;this.lo=los;this.mask=size-1;
  }
  *[Symbol.iterator](){for(let i=0;i<=this.mask;i++)if(this.keys[i]>=0)yield this.keys[i];}
}
const M64=(1n<<64n)-1n,P1=11400714785074694791n,P2=14029467366897019727n,P5=2870177450012600261n;
// hash((a, b)) for non-negative ints below 2**61 (tuplehash, xxHash lanes).
function tupleHash2(a,b){
  let acc=P5;
  for(const lane of [BigInt(a),BigInt(b)]){acc=(acc+lane*P2)&M64;acc=((acc<<31n)|(acc>>33n))&M64;acc=(acc*P1)&M64;}
  acc=(acc+(2n^(P5^3527539n)))&M64;
  if(acc===M64)acc=1546275796n;
  return [Number(acc>>32n),Number(acc&0xffffffffn)];
}

// ---- numpy reduction orders (calibrated against numpy 2.5.4).
function pairwiseSum(a,start,n,r){
  if(n<8){let s=r(-0);for(let i=0;i<n;i++)s=r(s+a[start+i]);return s;}
  if(n<=128){
    const q=new Array(8);for(let j=0;j<8;j++)q[j]=a[start+j];let i=8;
    for(;i<n-(n%8);i+=8)for(let j=0;j<8;j++)q[j]=r(q[j]+a[start+i+j]);
    let s=r(r(r(q[0]+q[1])+r(q[2]+q[3]))+r(r(q[4]+q[5])+r(q[6]+q[7])));
    for(;i<n;i++)s=r(s+a[start+i]);return s;
  }
  let n2=Math.floor(n/2);n2-=n2%8;
  return r(pairwiseSum(a,start,n2,r)+pairwiseSum(a,start+n2,n-n2,r));
}
const npSum=(a,r)=>r(0+pairwiseSum(a,0,a.length,r));

function precision(vertices){
  if(vertices instanceof Float64Array)return {r:x=>x,Array:Float64Array};
  if(vertices instanceof Float32Array)return {r:Math.fround,Array:Float32Array};
  throw TypeError('F32 or F64 vertices required');
}

// _reindex_mesh: keep referenced vertices in ascending index order.
function reindex(vertices,faces){
  const nv=vertices.length/3,map=new Int32Array(nv).fill(-1);
  for(let i=0;i<faces.length;i++)map[faces[i]]=0;
  let n=0;for(let v=0;v<nv;v++)if(map[v]===0)map[v]=n++;
  const out=new vertices.constructor(n*3);
  for(let v=0;v<nv;v++)if(map[v]>=0){out[map[v]*3]=vertices[v*3];out[map[v]*3+1]=vertices[v*3+1];out[map[v]*3+2]=vertices[v*3+2];}
  const f=new Int32Array(faces.length);for(let i=0;i<faces.length;i++)f[i]=map[faces[i]];
  return {vertices:out,faces:f};
}

function faceKey(a,b,c){if(a>b)[a,b]=[b,a];if(b>c)[b,c]=[c,b];if(a>b)[a,b]=[b,a];return a+','+b+','+c;}

export function removeDuplicateFaces(vertices,faces){
  if(!faces.length)return {vertices,faces};
  const seen=new Set(),keep=[];
  for(let i=0;i<faces.length/3;i++){const k=faceKey(faces[i*3],faces[i*3+1],faces[i*3+2]);if(!seen.has(k)){seen.add(k);keep.push(i);}}
  if(keep.length===faces.length/3)return reindex(vertices,faces);
  const kept=new Int32Array(keep.length*3);keep.forEach((f,j)=>{kept[j*3]=faces[f*3];kept[j*3+1]=faces[f*3+1];kept[j*3+2]=faces[f*3+2];});
  return reindex(vertices,kept);
}

function find(parent,x){while(parent[x]!==x){parent[x]=parent[parent[x]];x=parent[x];}return x;}
function unionMin(parent,a,b){a=find(parent,a);b=find(parent,b);if(a!==b){if(a<b)parent[b]=a;else parent[a]=b;}}
// Exact integer edge keys: min*2**26+max stays below 2**53, and orders like
// the (max, min) row packing trimesh sorts by only after the explicit compare.
const KEY_BASE=67108864;
const edgeKey=(a,b)=>a<b?a*KEY_BASE+b:b*KEY_BASE+a;
function admitIndexRange(vertices){if(vertices.length/3>=KEY_BASE)throw RangeError('mesh exceeds 2**26 vertices');}
// V8 caps a Map at 2**24 entries and a multi-million-face surface has more
// edges than that, so edge-keyed maps are split by key across shards sized from
// the face count. Membership and values are unchanged; where order matters the
// caller keeps a first-seen sequence.
let mapShard=1<<23,shardsUsed=0;
export function setEdgeMapShardForTests(size){mapShard=size;shardsUsed=0;}
export function edgeMapShardsUsedForTests(){return shardsUsed;}
function shardedMap(expected){
  const n=Math.max(1,Math.ceil(expected/mapShard)),shards=Array.from({length:n},()=>new Map());
  shardsUsed=Math.max(shardsUsed,n);
  const of=k=>shards[n===1?0:k%n];
  return {get:k=>of(k).get(k),set:(k,v)=>of(k).set(k,v),*values(){for(const m of shards)yield* m.values();},
    *entries(){for(const m of shards)yield* m.entries();},get size(){let t=0;for(const m of shards)t+=m.size;return t;}};
}

// Components over every shared edge, labelled in order of their lowest face
// (scipy connected_components numbering).
function faceComponents(faces){
  const n=faces.length/3,parent=new Int32Array(n);for(let i=0;i<n;i++)parent[i]=i;
  const first=shardedMap(faces.length);
  for(let f=0;f<n;f++)for(let i=0;i<3;i++){
    const k=edgeKey(faces[f*3+i],faces[f*3+(i+1)%3]),g=first.get(k);
    if(g===undefined)first.set(k,f);else unionMin(parent,g,f);
  }
  const labels=new Int32Array(n),ids=new Map();
  for(let f=0;f<n;f++){const root=find(parent,f);let id=ids.get(root);if(id===undefined){id=ids.size;ids.set(root,id);}labels[f]=id;}
  return {count:ids.size,labels};
}

export function keepLargestComponent(vertices,faces){
  if(!faces.length)return {vertices,faces};
  const {count,labels}=faceComponents(faces);if(count<=1)return {vertices,faces};
  const sizes=new Int32Array(count);for(const l of labels)sizes[l]++;
  let best=0;for(let i=1;i<count;i++)if(sizes[i]>sizes[best])best=i;
  const kept=[];for(let f=0;f<labels.length;f++)if(labels[f]===best)kept.push(faces[f*3],faces[f*3+1],faces[f*3+2]);
  return reindex(vertices,Int32Array.from(kept));
}

export function removeSmallComponents(vertices,faces,minArea=1e-5){
  if(!faces.length)return {vertices,faces};
  const {count,labels}=faceComponents(faces);if(count<=1)return {vertices,faces};
  const {r}=precision(vertices),areas=new Float64Array(count);
  for(let f=0;f<labels.length;f++){
    const a=faces[f*3]*3,b=faces[f*3+1]*3,c=faces[f*3+2]*3,V=vertices;
    const ux=r(V[b]-V[a]),uy=r(V[b+1]-V[a+1]),uz=r(V[b+2]-V[a+2]),vx=r(V[c]-V[a]),vy=r(V[c+1]-V[a+1]),vz=r(V[c+2]-V[a+2]);
    const cx=r(r(uy*vz)-r(uz*vy)),cy=r(r(uz*vx)-r(ux*vz)),cz=r(r(ux*vy)-r(uy*vx));
    const area=r(0.5*r(Math.sqrt(r(r(r(cx*cx)+r(cy*cy))+r(cz*cz)))));
    areas[labels[f]]+=area;
  }
  const kept=[];for(let f=0;f<labels.length;f++)if(areas[labels[f]]>=minArea)kept.push(faces[f*3],faces[f*3+1],faces[f*3+2]);
  return reindex(vertices,Int32Array.from(kept));
}

// Split corners across edges that are not shared by exactly two faces.
export function repairNonManifoldEdges(vertices,faces){
  if(!faces.length)return {vertices,faces};
  const n=faces.length/3,groups=shardedMap(faces.length);
  for(let f=0;f<n;f++)for(const [la,lb] of [[0,1],[1,2],[2,0]]){
    const va=faces[f*3+la],vb=faces[f*3+lb],k=edgeKey(va,vb),first=va<=vb?la:lb,second=va<=vb?lb:la;
    let g=groups.get(k);if(!g)groups.set(k,g=[]);g.push(f*3+first,f*3+second);
  }
  let manifold=0;for(const g of groups.values())if(g.length===4)manifold++;
  if(manifold===0||manifold===groups.size)return {vertices,faces};
  const parent=new Int32Array(n*3);for(let i=0;i<n*3;i++)parent[i]=i;
  for(const g of groups.values())if(g.length===4){unionMin(parent,g[0],g[2]);unionMin(parent,g[1],g[3]);}
  const roots=new Int32Array(n*3);for(let i=0;i<n*3;i++)roots[i]=find(parent,i);
  const rank=new Int32Array(n*3).fill(-1);let count=0;
  for(let i=0;i<n*3;i++)if(roots[i]===i)rank[i]=count++;
  const out=new vertices.constructor(count*3),f=new Int32Array(n*3);
  for(let i=0;i<n*3;i++){
    const id=rank[roots[i]];f[i]=id;
    if(roots[i]===i){const v=faces[i]*3;out[id*3]=vertices[v];out[id*3+1]=vertices[v+1];out[id*3+2]=vertices[v+2];}
  }
  return {vertices:out,faces:f};
}

export function fillSmallHoles(vertices,faces,maxHolePerimeter=3e-2){
  if(!faces.length||maxHolePerimeter<=0)return {vertices,faces};
  // value = first-seen sequence*4 + min(count,3): boundary edges come out in
  // first-appearance order, as one insertion-ordered map would give them.
  const counts=shardedMap(faces.length);let seq=0;
  for(let f=0;f<faces.length/3;f++)for(let i=0;i<3;i++){
    const k=edgeKey(faces[f*3+i],faces[f*3+(i+1)%3]),v=counts.get(k);
    counts.set(k,v===undefined?(seq++)*4+1:v%4===3?v:v+1);
  }
  const once=[];
  for(const [k,v] of counts.entries())if(v%4===1)once.push([Math.floor(v/4),k]);
  once.sort((a,b)=>a[0]-b[0]);
  const edges=once.map(e=>e[1]);
  if(!edges.length)return {vertices,faces};
  const lo=k=>k%KEY_BASE,hi=k=>Math.floor(k/KEY_BASE);
  const boundary=new PySetOrder();
  edges.forEach((k,id)=>{const [h,l]=tupleHash2(hi(k),lo(k));boundary.add(id,h,l);});
  const order=[...boundary].map(id=>edges[id]),adj=new Map();
  for(const k of order){
    const a=hi(k),b=lo(k);
    if(!adj.has(a))adj.set(a,[]);adj.get(a).push(b);
    if(!adj.has(b))adj.set(b,[]);adj.get(b).push(a);
  }
  const visited=new Set(),loops=[];
  for(const start of order){
    if(visited.has(start))continue;
    const loop=[hi(start),lo(start)];visited.add(start);
    for(;;){
      const current=loop[loop.length-1];let found=false;
      for(const n of adj.get(current)??[]){
        const e=edgeKey(current,n);
        if(!visited.has(e)&&n!==loop[loop.length-2]){
          visited.add(e);
          if(n===loop[0]&&loop.length>=3){loops.push(loop);found=true;break;}
          loop.push(n);found=true;break;
        }
      }
      if(!found)break;
    }
  }
  if(!loops.length)return {vertices,faces};
  const {r,Array:T}=precision(vertices),added=[],newFaces=Array.from(faces);let nv=vertices.length/3;
  for(const loop of loops){
    const L=loop.length,lengths=new T(L);
    for(let i=0;i<L;i++){
      const a=loop[i]*3,b=loop[(i+1)%L]*3;let s=r(-0);
      for(let ax=0;ax<3;ax++){const d=r(vertices[b+ax]-vertices[a+ax]);s=r(s+r(d*d));}
      lengths[i]=r(Math.sqrt(s));
    }
    if(npSum(lengths,r)>maxHolePerimeter)continue;
    for(let ax=0;ax<3;ax++){let s=vertices[loop[0]*3+ax];for(let i=1;i<L;i++)s=r(s+vertices[loop[i]*3+ax]);added.push(r(s/L));}
    const centroid=nv++;
    const loopEdges=[];for(let i=0;i<L;i++){const a=loop[i],b=loop[(i+1)%L];loopEdges.push(a<b?[a,b]:[b,a]);}
    loopEdges.sort((x,y)=>x[0]-y[0]||x[1]-y[1]);
    for(const [v0,v1] of loopEdges)newFaces.push(v1,v0,centroid);
  }
  const out=new T(vertices.length+added.length);out.set(vertices);out.set(added,vertices.length);
  return {vertices:out,faces:Int32Array.from(newFaces)};
}

// ---- trimesh.repair.fix_normals(multibody=False) through networkx 3.7.
// trimesh hashable_rows packs (min,max) with max in the high word: order by max, then min.
const rowKey=(lo,hi)=>hi*KEY_BASE+lo;
function edgeGroups(faces){
  const m=faces.length,keys=new Float64Array(m);
  for(let f=0;f<m/3;f++)for(let i=0;i<3;i++){
    const a=faces[f*3+i],b=faces[f*3+(i+1)%3];keys[f*3+i]=a<b?rowKey(a,b):rowKey(b,a);
  }
  const order=Array.from({length:m},(_,i)=>i).sort((x,y)=>keys[x]-keys[y]||x-y),pairs=[];
  for(let s=0;s<m;){let e=s+1;while(e<m&&keys[order[e]]===keys[order[s]])e++;if(e-s===2)pairs.push(order[s],order[s+1]);s=e;}
  return pairs;
}
function windingState(faces){
  const pairs=edgeGroups(faces),edge=(i,k)=>faces[Math.floor(i/3)*3+(i%3+k)%3];
  let consistent=true;
  for(let g=0;g<pairs.length;g+=2)if(edge(pairs[g],1)!==edge(pairs[g+1],0)){consistent=false;break;}
  return {watertight:pairs.length===faces.length,consistent,pairs};
}
function fixWinding(faces){
  const {consistent,pairs}=windingState(faces);
  if(consistent)return faces;
  const adj=new Map();const node=v=>{let a=adj.get(v);if(!a)adj.set(v,a=new Map());return a;};
  for(let g=0;g<pairs.length;g+=2){
    let u=Math.floor(pairs[g]/3),v=Math.floor(pairs[g+1]/3);if(u===v)continue;if(u>v)[u,v]=[v,u];
    const au=node(u),av=node(v);au.set(v,true);av.set(u,true);
  }
  const out=faces.slice(),nodes=[...adj.keys()],total=nodes.length,seen=new Set();let flipped=0;
  for(const v of nodes){
    if(seen.has(v))continue;
    // _plain_bfs set, then Graph.subgraph(show_nodes(set(iterate it))).
    const comp=new PySetOrder(),members=[v];comp.add(v,0,v);seen.add(v);
    for(let level=[v];level.length;){
      const next=[];
      for(const x of level)for(const w of adj.get(x).keys())if(!seen.has(w)){seen.add(w);comp.add(w,0,w);members.push(w);next.push(w);}
      level=next;
    }
    const shown=new PySetOrder();for(const x of comp)shown.add(x,0,x);
    const inComp=new Set(members);
    let start;
    if(2*members.length<total)start=shown[Symbol.iterator]().next().value;
    else for(const x of nodes)if(inComp.has(x)){start=x;break;}
    const bfsSeen=new Set([start]);
    for(let level=[start];level.length;){
      const next=[];
      for(const parent of level)for(const child of adj.get(parent).keys()){
        if(bfsSeen.has(child))continue;bfsSeen.add(child);next.push(child);
        const rows=[];for(const f of [parent,child])for(let i=0;i<3;i++)rows.push([out[f*3+i],out[f*3+(i+1)%3]]);
        const keys=rows.map(([a,b])=>a<b?rowKey(a,b):rowKey(b,a)),order=[0,1,2,3,4,5].sort((x,y)=>keys[x]-keys[y]||x-y);
        let pair=null;
        for(let s=0;s<6;){let e=s+1;while(e<6&&keys[order[e]]===keys[order[s]])e++;if(e-s===2){pair=[order[s],order[s+1]];break;}s=e;}
        if(!pair)continue;
        if(rows[pair[0]][0]===rows[pair[1]][0]){flipped++;const a=out[child*3];out[child*3]=out[child*3+2];out[child*3+2]=a;}
      }
      level=next;
    }
  }
  return flipped?out:faces;
}
function signedVolume(vertices,faces){
  const n=faces.length/3,terms=new Float64Array(n);
  for(let f=0;f<n;f++){
    const p=[faces[f*3],faces[f*3+1],faces[f*3+2]].map(v=>[vertices[v*3],vertices[v*3+1],vertices[v*3+2]]);
    const a=[0,1,2].map(i=>p[1][i]-p[0][i]),b=[0,1,2].map(i=>p[2][i]-p[1][i]);
    terms[f]=(a[1]*b[2]-a[2]*b[1])*((p[0][0]+p[1][0])+p[2][0]);
  }
  return npSum(terms,x=>x)/6;
}
export function fixNormals(vertices,faces){
  if(!faces.length)return {vertices,faces};
  const wound=fixWinding(faces);
  if(windingState(wound).watertight&&signedVolume(vertices,wound)<0){
    const inv=wound.slice();for(let f=0;f<inv.length/3;f++){const a=inv[f*3];inv[f*3]=inv[f*3+2];inv[f*3+2]=a;}
    return {vertices,faces:inv};
  }
  return {vertices,faces:wound};
}

// trellmlx.mesh_cleanup.cleanup_mesh with source defaults.
export function cleanupMesh(vertices,faces,{maxHolePerimeter=3e-2,keepLargest=false,minComponentArea=1e-5,
  preserveSurfaceParts=true,fixNormals:doFixNormals=true,onStep=()=>{}}={}){
  admitIndexRange(vertices);
  onStep('remove_duplicate_faces',faces.length/3);
  let m=removeDuplicateFaces(vertices,faces);
  const filter=x=>{
    if(!keepLargest&&!(minComponentArea>0))return x;
    onStep(keepLargest?'keep_largest_component':'remove_small_components',x.faces.length/3);
    return keepLargest?keepLargestComponent(x.vertices,x.faces):removeSmallComponents(x.vertices,x.faces,minComponentArea);
  };
  if(preserveSurfaceParts)m=filter(m);
  onStep('repair_non_manifold_edges',m.faces.length/3);
  m=repairNonManifoldEdges(m.vertices,m.faces);
  if(!preserveSurfaceParts)m=filter(m);
  onStep('fill_small_holes',m.faces.length/3);
  m=fillSmallHoles(m.vertices,m.faces,maxHolePerimeter);
  if(doFixNormals){onStep('fix_normals',m.faces.length/3);m=fixNormals(m.vertices,m.faces);}
  return m;
}

// _cleanup_and_simplify_mesh(simplify_first=True, reference_cleanup=False,
// qem_simplify=False): up to three fast-simplification passes, then one cleanup.
// Same admission as postprocess-retained-mesh.py: finite, complete, indexed.
function admitSurface(vertices,faces){
  if(!(vertices instanceof Float32Array)||!vertices.length||vertices.length%3||!vertices.every(Number.isFinite))
    throw TypeError('finite F32 xyz vertices required');
  if(!(faces instanceof Uint32Array)||!faces.length||faces.length%3)throw TypeError('U32 triangle indices required');
  for(let i=0,n=vertices.length/3;i<faces.length;i++)if(faces[i]>=n)throw RangeError('triangle index outside vertices');
}

// onProgress, if given, sees {kind,...,elapsedSeconds} as the work happens:
// entered, simplify-iteration, cleanup-step, and pass (each receipt trace row).
// simplifier: an engine from wasm-simplify.js loadSimplifier, or undefined for the JS port.
export function cleanupAndSimplifyPreservingSurface(vertices,faces,{targetFaces,keepLargest=false,onProgress,simplifier}={}){
  if(!Number.isSafeInteger(targetFaces)||targetFaces<1)throw RangeError('positive targetFaces required');
  admitSurface(vertices,faces);
  const started=performance.now(),emit=onProgress?e=>onProgress({...e,elapsedSeconds:(performance.now()-started)/1000}):()=>{};
  const onPass=row=>emit({kind:'pass',...row});
  const onStep=operation=>(step,faces)=>emit({kind:'cleanup-step',operation,step,faces});
  const onIteration=operation=>(iteration,faces)=>emit({kind:'simplify-iteration',operation,iteration,faces});
  emit({kind:'entered',inputVertices:vertices.length/3,inputFaces:faces.length/3});
  let v=vertices,f=faces;const trace=[];
  if(f.length/3<=targetFaces){
    // Source falls through to its general path: cleanup without winding
    // repair, then decisions on the resulting count (hole filling can lift it
    // over the target). Every later cleanup keeps the already-filtered parts.
    const count=m=>m.faces.length/3,later={keepLargest:false,minComponentArea:0};
    const step=(operation,input,m)=>{trace.push({operation,inputFaces:input,outputFaces:count(m)});onPass(trace.at(-1));return m;};
    const simplify=(m,reduction,operation)=>{const r=simplifyMesh(m.vertices,m.faces,{targetReduction:reduction,onIteration:onIteration(operation),engine:simplifier});
      return step(operation,count(m),{vertices:r.points,faces:r.triangles});};
    let m=step('cleanup',f.length/3,cleanupMesh(v,f,{keepLargest,fixNormals:false,onStep:onStep('cleanup')}));
    const finish=m=>{const clean=step('cleanup_final',count(m),cleanupMesh(m.vertices,m.faces,{...later,onStep:onStep('cleanup_final')}));
      return {vertices:Float32Array.from(clean.vertices),faces:Uint32Array.from(clean.faces),trace};};
    if(count(m)<=targetFaces)return finish(m);
    const coarse=targetFaces*3;
    if(count(m)>coarse){
      m=simplify(m,1.0-coarse/count(m),'simplify_coarse');
      m=step('cleanup',count(m),cleanupMesh(m.vertices,m.faces,{...later,fixNormals:false,onStep:onStep('cleanup')}));
    }
    if(count(m)<=targetFaces)return finish(m);
    let simplified=false;
    for(let attempt=0;attempt<3;attempt++){
      if(count(m)<=targetFaces)break;
      const reduction=1.0-targetFaces/count(m);if(reduction<=0)break;
      m=simplify(m,reduction,'simplify_final');simplified=true;
      if(count(m)<=targetFaces*1.1)break;
    }
    if(simplified)return finish(m);
    return {vertices:Float32Array.from(m.vertices),faces:Uint32Array.from(m.faces),trace};
  }
  for(let pass=0;pass<3;pass++){
    const ratio=targetFaces/(f.length/3);if(ratio>=1)break;
    const input=f.length/3;({points:v,triangles:f}=simplifyMesh(v,f,{targetReduction:1.0-ratio,onIteration:onIteration('simplify_first'),engine:simplifier}));
    trace.push({operation:'simplify_first',inputFaces:input,outputFaces:f.length/3});onPass(trace.at(-1));
    if(f.length/3<=targetFaces*1.1)break;
  }
  const input=f.length/3,clean=cleanupMesh(v,f,{keepLargest,onStep:onStep('cleanup')});
  trace.push({operation:'cleanup',inputFaces:input,outputFaces:clean.faces.length/3});onPass(trace.at(-1));
  return {vertices:Float32Array.from(clean.vertices),faces:Uint32Array.from(clean.faces),trace};
}

// finishTrellisMesh postprocessMesh provider: the accepted surface-preserving
// finisher in the page, with the same receipt shape the server finisher emits.
// With WorkerClass it runs in mesh-cleanup-worker.js; without, on the caller's
// thread. Either way the input arrays are copied, never detached from the caller.
// simplifier: 'auto' (Wasm where relaxed-SIMD multiply-adds fuse, else the JS
// port) or 'js'; the receipt records which one ran.
export function createBrowserMeshPostprocess({targetFaces,keepLargest=false,WorkerClass,signal,onProgress,simplifier='auto'}={}){
  if(!Number.isSafeInteger(targetFaces)||targetFaces<1)throw RangeError('positive caller-selected targetFaces required');
  if(onProgress!==undefined&&typeof onProgress!=='function')throw TypeError('onProgress must be a function');
  if(simplifier!=='auto'&&simplifier!=='js')throw TypeError("simplifier must be 'auto' or 'js'");
  // An observer that throws is the caller's problem, never the finisher's.
  const observe=onProgress&&(e=>{try{onProgress(e);}catch{}});
  if(WorkerClass!==undefined&&typeof WorkerClass!=='function')throw TypeError('WorkerClass must be a Worker constructor');
  admitSignal(signal);
  const run=WorkerClass?async mesh=>{
    admitSurface(mesh.vertices,mesh.triangles); // before copying, so nothing is coerced
    const vertices=Float32Array.from(mesh.vertices),triangles=Uint32Array.from(mesh.triangles);
    const data=await runFinishingWorker({WorkerClass,url:new URL('./mesh-cleanup-worker.js',import.meta.url),signal,label:'mesh finisher',
      message:{vertices:vertices.buffer,triangles:triangles.buffer,targetFaces,keepLargest,progress:!!observe,simplifier},transfer:[vertices.buffer,triangles.buffer],onProgress:observe});
    return {vertices:new Float32Array(data.vertices),faces:new Uint32Array(data.triangles),trace:data.trace,simplifier:data.simplifier};
  }:async mesh=>{
    // Synchronous on this thread: Stop is honoured before and after, not mid-call.
    if(signal?.aborted)throw abortError(signal);
    const {engine,route,reason}=await loadSimplifier({prefer:simplifier});
    if(signal?.aborted)throw abortError(signal);
    const result=cleanupAndSimplifyPreservingSurface(mesh.vertices,mesh.triangles,{targetFaces,keepLargest,onProgress:observe,simplifier:engine??undefined});
    if(signal?.aborted)throw abortError(signal);
    return {...result,simplifier:reason?{route,reason}:{route}};
  };
  return async mesh=>{
    const started=performance.now(),inputVertices=mesh.vertices.length/3,inputFaces=mesh.triangles.length/3;
    const result=await run(mesh);
    return {...mesh,vertices:result.vertices,triangles:result.faces,metadata:{...mesh.metadata,postprocess:{
      schema:'trellis2.mesh-postprocess.v0',status:'succeeded',requestedMode:'mlx-surface-preserving',
      effectiveRoute:MESH_POSTPROCESS_ROUTE,execution:WorkerClass?'module-worker':'caller-thread',
      parityReference:'TRELLIS2MLX 1201553 postprocess-retained-mesh.py mlx-surface-preserving',
      modelCalls:0,targetFaces,keepLargest,inputVertices,inputFaces,outputVertices:result.vertices.length/3,
      outputFaces:result.faces.length/3,operationTrace:result.trace,simplifier:result.simplifier,elapsedSeconds:(performance.now()-started)/1000}}};
  };
}
