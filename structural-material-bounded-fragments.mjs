import {Triangle,Vector3} from 'three';
import {materialComponents} from './structural-material-solid-surface.mjs';

export const BOUNDED_FRAGMENT_ROUTE='kaminos.deformable-surface.node-associated-four-split.v0';
const pairs=[[0,1],[0,2],[0,3],[1,2],[1,3],[2,3]],faces=[[0,2,1],[0,1,3],[0,3,2],[1,2,3]];
const key=ids=>[...ids].sort((a,b)=>a-b).join(':');
const average=(ids,points)=>[0,1,2].map(k=>ids.reduce((sum,i)=>sum+points[i][k],0)/ids.length);
const subtract=(a,b)=>a.map((v,k)=>v-b[k]);
const determinant=p=>{const [a,b,c]=p.slice(1).map(v=>subtract(v,p[0]));return a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]);};
const permutations=ids=>ids.length===1?[ids]:ids.flatMap((id,i)=>permutations(ids.filter((_,j)=>j!==i)).map(tail=>[id,...tail]));
const orders=permutations([0,1,2,3]);

function sourceSampler(geometry){
 if(!geometry)return point=>[...point,0,1,0,point[0],point[1],1,0,0,1];
 if(geometry.numProp<12||!Array.isArray(geometry.properties)||geometry.properties.length%geometry.numProp||!geometry.properties.every(Number.isFinite)||!Array.isArray(geometry.indices)||geometry.indices.length%3||geometry.indices.some(i=>!Number.isInteger(i)||i<0||i>=geometry.properties.length/geometry.numProp))throw new Error('Complete attributed exterior geometry required');
 const triangles=[];
 for(let i=0;i<geometry.indices.length;i+=3){const ids=geometry.indices.slice(i,i+3),properties=ids.map(j=>geometry.properties.slice(j*geometry.numProp,j*geometry.numProp+12));triangles.push({properties,triangle:new Triangle(...properties.map(p=>new Vector3(...p.slice(0,3))))});}
 return point=>{const p=new Vector3(...point),q=new Vector3(),weights=new Vector3();let best=Infinity,chosen;
  for(const t of triangles){t.triangle.closestPointToPoint(p,q);const d=q.distanceToSquared(p);if(d<best){best=d;t.triangle.getBarycoord(q,weights);chosen={properties:t.properties,weights:weights.toArray()};}}
  if(!chosen)throw new Error('No source triangle can supply exterior attributes');
  return [...point,...Array.from({length:9},(_,k)=>chosen.properties.reduce((sum,v,i)=>sum+v[k+3]*chosen.weights[i],0))];
 };
}

export function buildBoundedFragments({positions,tetrahedra,bonds,geometry}){
 if(!Array.isArray(positions)||!positions.length||!positions.every(p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite))||!Array.isArray(tetrahedra)||!tetrahedra.length||!tetrahedra.every(ids=>ids.length===4&&new Set(ids).size===4&&ids.every(i=>Number.isInteger(i)&&i>=0&&i<positions.length)))throw new Error('Complete finite tetrahedral material required');
 const components=materialComponents(positions.length,bonds),alive=new Map();
 for(let i=0;i<bonds.length;i+=4){const k=key(bonds.slice(i,i+2));if(alive.has(k))throw new Error('Duplicate material bond identity');alive.set(k,bonds[i+2]===1);}
 const boundary=new Map();
 for(const ids of tetrahedra){if(Math.abs(determinant(ids.map(i=>positions[i])))<=1e-20)throw new Error('Degenerate tetrahedron cannot make finite cells');for(const [a,b] of pairs)if(!alive.has(key([ids[a],ids[b]])))throw new Error('Complete tetrahedral bond state required');for(const f of faces){const k=key(f.map(i=>ids[i]));boundary.set(k,(boundary.get(k)??0)+1);}}
 if([...boundary.values()].some(n=>n>2))throw new Error('Nonmanifold tetrahedral faces');
 const vertices=new Map(),remaining=new Map(),cellVolumes=Array(positions.length).fill(0);
 function vertex(subset,anchor){
  const group=new Set([anchor]);let changed=true;while(changed){changed=false;for(const a of subset)for(const b of subset)if(group.has(a)&&!group.has(b)&&alive.get(key([a,b]))){group.add(b);changed=true;}}
  const ids=[...group].sort((a,b)=>a-b),label=`${key(subset)}|${key(ids)}`;
  if(!vertices.has(label)){const rest=average(subset,positions),center=average(ids,positions);vertices.set(label,{label,subset:[...subset],ids,weights:ids.map(()=>1/ids.length),offset:subtract(rest,center),rest});}return vertices.get(label);
 }
 for(let t=0;t<tetrahedra.length;t++){
  const ids=tetrahedra[t],v=Math.abs(determinant(ids.map(i=>positions[i])))/6;for(const i of ids)cellVolumes[i]+=v/4;
  // Barycentric subdivision gives six tetrahedra per parent-owned cell.
  for(const order of orders){let entries=order.map((_,i)=>vertex(order.slice(0,i+1).map(j=>ids[j]),ids[order[0]]));if(determinant(entries.map(e=>e.rest))<0)[entries[1],entries[2]]=[entries[2],entries[1]];
   for(const face of faces){const nodes=face.map(i=>entries[i]),label=nodes.map(n=>n.label).sort().join('/'),subset=[...new Set(nodes.flatMap(n=>n.subset))],exterior=subset.length===3&&boundary.get(key(subset))===1;
    if(remaining.has(label))remaining.delete(label);else remaining.set(label,{nodes,component:components[ids[order[0]]],exterior});
   }
  }
 }
 const sample=sourceSampler(geometry),attributes=new Map(),groups=new Map();let exteriorTriangles=0,interiorTriangles=0;
 for(const face of remaining.values()){
  if(face.exterior)exteriorTriangles++;else interiorTriangles++;
  if(!groups.has(face.component))groups.set(face.component,{faces:[],entries:new Map()});const group=groups.get(face.component);group.faces.push(face);for(const e of face.nodes)group.entries.set(e.label,e);
 }
 const pieces=[...groups].map(([component,group])=>{
  const exteriorEntries=new Set(group.faces.filter(f=>f.exterior).flatMap(f=>f.nodes.map(e=>e.label)));
  const entries=[...group.entries.values()],indices=new Map(entries.map((e,i)=>[e.label,i])),properties=entries.flatMap(e=>{if(!exteriorEntries.has(e.label))return[...e.rest,0,1,0,0,0,1,0,0,1];const k=key(e.subset);if(!attributes.has(k))attributes.set(k,sample(e.rest));return attributes.get(k);}),ordered=group.faces.sort((a,b)=>Number(b.exterior)-Number(a.exterior)),nodes=positions.flatMap((_,i)=>components[i]===component?[i]:[]);
  return{id:component,component,nodes,volume:nodes.reduce((sum,i)=>sum+cellVolumes[i],0),binding:{route:BOUNDED_FRAGMENT_ROUTE,points:positions.length,component,entries:entries.map(({ids,weights,offset,rest,subset})=>({ids,weights,offset,rest,subset}))},geometry:{numProp:12,properties,indices:ordered.flatMap(f=>f.nodes.map(e=>indices.get(e.label))),exterior:ordered.map(f=>f.exterior)}};
 });
 return{route:BOUNDED_FRAGMENT_ROUTE,mechanicalPoints:positions.length,mechanicalElements:tetrahedra.length,cellCount:tetrahedra.length*4,visualVertices:vertices.size,exteriorTriangles,interiorTriangles,pieces,claim:'Centroid-based finite visual cells follow local alive-edge parent groups; no new mechanical degrees of freedom, collision or material-law authority'};
}

export function buildFixedCellShell(input){
 const dead=input.bonds.map((v,i)=>i%4===2?0:v),split=buildBoundedFragments({...input,bonds:dead}),properties=[],entries=[],triangles=[],bondIds=new Map();
 for(let i=0;i<input.bonds.length;i+=4)bondIds.set(key(input.bonds.slice(i,i+2)),i/4);
 for(const piece of split.pieces){const base=entries.length;properties.push(...piece.geometry.properties);for(const e of piece.binding.entries){const subset=[...e.subset].sort((a,b)=>a-b);entries.push({...e,subset,anchor:e.ids[0],edgeIds:pairs.map(([a,b])=>a<subset.length&&b<subset.length?bondIds.get(key([subset[a],subset[b]])):0xffffffff)});}for(let i=0;i<piece.geometry.indices.length;i+=3)triangles.push({indices:piece.geometry.indices.slice(i,i+3).map(j=>j+base),exterior:piece.geometry.exterior[i/3]});}
 triangles.sort((a,b)=>Number(b.exterior)-Number(a.exterior));
 return{id:0,component:0,nodes:input.positions.map((_,i)=>i),volume:split.pieces.reduce((s,p)=>s+p.volume,0),binding:{route:BOUNDED_FRAGMENT_ROUTE,fixedCellShell:true,points:input.positions.length,rest:input.positions,entries},geometry:{numProp:12,properties,indices:triangles.flatMap(t=>t.indices),exterior:triangles.map(t=>t.exterior)},cellCount:split.cellCount};
}

export function applyFixedCellShell(binding,current,bonds){
 if(!binding?.fixedCellShell||current.length!==binding.points||!current.every(p=>p.length===3&&p.every(Number.isFinite))||!Array.isArray(bonds)||bonds.length%4)throw new Error('Complete fixed shell material pose and bonds required');
 return binding.entries.map(e=>{const reached=new Set([e.anchor]);let changed=true;while(changed){changed=false;for(let k=0;k<6;k++){const [a,b]=pairs[k],edge=e.edgeIds[k];if(edge===0xffffffff)continue;const x=e.subset[a],y=e.subset[b];if(bonds[edge*4+2]===1&&(reached.has(x)||reached.has(y))&&(!reached.has(x)||!reached.has(y))){reached.add(x);reached.add(y);changed=true;}}}const ids=[...reached];return e.rest.map((v,k)=>v+ids.reduce((sum,i)=>sum+current[i][k]-binding.rest[i][k],0)/ids.length);});
}

export function applyBoundedFragmentBinding(binding,current){
 if(binding?.route!==BOUNDED_FRAGMENT_ROUTE||!Array.isArray(current)||current.length!==binding.points||!current.every(p=>p.length===3&&p.every(Number.isFinite)))throw new Error('Matching finite material positions required');
 return binding.entries.map(e=>e.offset.map((v,k)=>v+e.ids.reduce((sum,id,i)=>sum+current[id][k]*e.weights[i],0)));
}
