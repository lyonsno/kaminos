// Reused from Burning Demon 439e5c1f7; mechanics remain with that owner.
import {bisectFaces,extractFaces,capPlanarOpenings,sectionSegments,sectionLoops,sectionCap} from './poly-mesh-edit.mjs';
import {ShapeUtils,Vector2} from './lib/three.core.js';
import {matchMaterialSections} from './fracture-material-sections.mjs';

export const WHOLE_FRACTURE_ROUTE='kaminos.fracture.whole-object-coarse-material.v1';
const sub=(a,b)=>a.map((v,k)=>v-b[k]),dot=(a,b)=>a.reduce((s,v,k)=>s+v*b[k],0);
const unit=a=>{const l=Math.hypot(...a);return l?a.map(v=>v/l):[0,1,0];};
const point=(a,id)=>Array.from(a.positions.subarray(id*3,id*3+3));
function triangle(a,f){return Array.from(a.indices.subarray(f*3,f*3+3),i=>point(a,i));}
function areaOf(p){const u=sub(p[1],p[0]),v=sub(p[2],p[0]);return Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])/2;}
export function materialMeasure(a,filter=null){
 const P=a.positions,I=a.indices,n=I.length/3;
 let min0=Infinity,min1=Infinity,min2=Infinity,max0=-Infinity,max1=-Infinity,max2=-Infinity;
 let m0=0,m1=0,m2=0,area=0,volume=0;
 const o0=I.length?P[I[0]*3]:0,o1=I.length?P[I[0]*3+1]:0,o2=I.length?P[I[0]*3+2]:0;
 for(let f=0;f<n;f++){
  if(filter&&!filter(f))continue;
  const i0=I[f*3]*3,i1=I[f*3+1]*3,i2=I[f*3+2]*3;
  const ax=P[i0],ay=P[i0+1],az=P[i0+2],bx=P[i1],by=P[i1+1],bz=P[i1+2],cx=P[i2],cy=P[i2+1],cz=P[i2+2];
  const ux=bx-ax,uy=by-ay,uz=bz-az,vx=cx-ax,vy=cy-ay,vz=cz-az;
  const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx,w=Math.hypot(nx,ny,nz)*.5;
  area+=w;
  m0+=w*(ax+bx+cx)/3;m1+=w*(ay+by+cy)/3;m2+=w*(az+bz+cz)/3;
  if(ax<min0)min0=ax;if(bx<min0)min0=bx;if(cx<min0)min0=cx;
  if(ay<min1)min1=ay;if(by<min1)min1=by;if(cy<min1)min1=cy;
  if(az<min2)min2=az;if(bz<min2)min2=bz;if(cz<min2)min2=cz;
  if(ax>max0)max0=ax;if(bx>max0)max0=bx;if(cx>max0)max0=cx;
  if(ay>max1)max1=ay;if(by>max1)max1=by;if(cy>max1)max1=cy;
  if(az>max2)max2=az;if(bz>max2)max2=bz;if(cz>max2)max2=cz;
  const x0=ax-o0,y0=ay-o1,z0=az-o2,x1=bx-o0,y1=by-o1,z1=bz-o2,x2=cx-o0,y2=cy-o1,z2=cz-o2;
  volume+=(x0*(y1*z2-z1*y2)+y0*(z1*x2-x1*z2)+z0*(x1*y2-y1*x2))/6;
 }
 const inv=1/(area||1);
 return {area,min:[min0,min1,min2],max:[max0,max1,max2],center:[m0*inv,m1*inv,m2*inv],volume:Math.abs(volume)};
}
function select(a,owners,mask,planes=null){const out=extractFaces(a,mask).part;return {arrays:out,faceInterfaces:Int32Array.from(owners.filter((_,i)=>mask[i])),faceSectionPlanes:planes?planes.filter((_,i)=>mask[i]):new Array(out.indices.length/3).fill(null)};}
function insideDistance(p,leaf){return Math.hypot(...p.map((v,k)=>Math.max(leaf.bounds.min[k]-v,0,v-leaf.bounds.max[k])));}
function closest(p,leaves){let winner=null,best=Infinity;for(const l of leaves){const distance=insideDistance(p,l);const score=distance+Math.hypot(...sub(p,l.center))*1e-8;if(score<best){best=score;winner=l;}}return winner;}

// The original surface boundary supplies the cap. Projection only triangulates
// that boundary: rendered exterior positions and texture coordinates are untouched.
function attachmentCaps(edges,normal){
 const key=p=>p.join(','),points=new Map(),adj=new Map();
 for(const [p,q]of edges){const a=key(p),b=key(q);points.set(a,p);points.set(b,q);if(!adj.has(a))adj.set(a,[]);if(!adj.has(b))adj.set(b,[]);adj.get(a).push(b);adj.get(b).push(a);}
 const visited=new Set(),loops=[];let openEdges=0;
 const ek=(a,b)=>a<b?a+'|'+b:b+'|'+a;
 for(const [a,neighbors]of adj)for(const b of neighbors){if(visited.has(ek(a,b)))continue;const path=[a];let prev=a,current=b;visited.add(ek(a,b));
  while(current!==a){path.push(current);const next=(adj.get(current)||[]).find(n=>n!==prev&&!visited.has(ek(current,n)));if(next===undefined)break;visited.add(ek(current,next));prev=current;current=next;}
  if(current===a&&path.length>=3)loops.push(path.map(k=>points.get(k)));else openEdges+=path.length-1;
 }
 const n=unit(normal),u=unit(Math.abs(n[0])<.9?[0,-n[2],n[1]]:[n[2],0,-n[0]]),v=[n[1]*u[2]-n[2]*u[1],n[2]*u[0]-n[0]*u[2],n[0]*u[1]-n[1]*u[0]];
 const rings=loops.map(p=>({p,q:p.map(x=>new Vector2(dot(x,u),dot(x,v)))}));
 const contains=(ring,p)=>{let yes=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++)if((ring[i].y>p.y)!==(ring[j].y>p.y)&&p.x<(ring[j].x-ring[i].x)*(p.y-ring[i].y)/(ring[j].y-ring[i].y)+ring[i].x)yes=!yes;return yes;};
 const depth=rings.map(r=>rings.filter(o=>o!==r&&Math.abs(ShapeUtils.area(o.q))>Math.abs(ShapeUtils.area(r.q))&&contains(o.q,r.q[0])).length),triangles=[];
 for(let i=0;i<rings.length;i++){if(depth[i]%2)continue;const r=rings[i],holes=rings.filter((o,j)=>depth[j]===depth[i]+1&&contains(r.q,o.q[0])),all=[r,...holes],p=all.flatMap(r=>r.p),q=all.flatMap(r=>r.q);
  for(let ids of ShapeUtils.triangulateShape(r.q.map(p=>p.clone()),holes.map(h=>h.q.map(p=>p.clone())))){
   const [a,b,c]=ids,turn=(q[b].x-q[a].x)*(q[c].y-q[a].y)-(q[b].y-q[a].y)*(q[c].x-q[a].x);if(turn<0)ids=[a,c,b];const tri=ids.map(i=>p[i]);if(areaOf(tri)>0)triangles.push(tri);
  }
 }
 return {triangles,openEdges,loops:loops.length};
}
function addCaps(leaf,triangles,id,normal,material,planes){
 const a=leaf.arrays,v0=a.positions.length/3,f0=a.indices.length/3,tc=triangles.length;
 const P=new Float32Array((v0+tc*3)*3);P.set(a.positions);
 const N=new Float32Array((v0+tc*3)*3);if(a.normals)N.set(a.normals);
 const U=new Float32Array((v0+tc*3)*2);if(a.uvs)U.set(a.uvs);
 const I=new Uint32Array((f0+tc)*3);I.set(a.indices);
 const M=new Uint8Array(f0+tc);if(a.faceMaterial)M.set(a.faceMaterial);
 const O=new Int32Array(f0+tc);O.set(leaf.faceInterfaces);
 const S=leaf.faceSectionPlanes.slice();
 for(let ti=0;ti<tc;ti++){
  const t=triangles[ti],start=v0+ti*3;
  for(let k=0;k<3;k++){const p=t[k],vo=(start+k)*3,uo=(start+k)*2;P[vo]=p[0];P[vo+1]=p[1];P[vo+2]=p[2];N[vo]=normal[0];N[vo+1]=normal[1];N[vo+2]=normal[2];U[uo]=p[0];U[uo+1]=p[1];}
  const io=(f0+ti)*3;I[io]=start;I[io+1]=start+1;I[io+2]=start+2;M[f0+ti]=material;O[f0+ti]=id;S.push(planes[ti]);
 }
 leaf.arrays={positions:P,normals:N,uvs:U,indices:I,faceMaterial:M};leaf.faceInterfaces=O;leaf.faceSectionPlanes=S;
}

export function prepareWholeFracture(source,view,{cellExtent,strength=3000000,gravity=9.81,elasticModulus=1e10}={}){
 const faceCount=source.indices.length/3;
 if(!view?.labels||view.labels.length!==faceCount)throw Error('Every original triangle requires a detected part owner');
 const total=materialMeasure(source),extent=Math.max(...sub(total.max,total.min));cellExtent??=extent/4;
 if(!(cellExtent>0&&Number.isFinite(cellExtent)))throw Error('Positive finite coarse cell extent required');
 const capMaterial=Math.max(0,...new Set(source.faceMaterial??[0]))+1;
 if(capMaterial>255)throw Error('No material slot available for fracture interiors');
 const parts=new Map(),interfaces=new Map(),diagnostics={uncappedAttachments:[],unsplitRegions:[],inferredAttachments:[],stitchedSections:[],windingSections:[],sectionCoverage:[]};let nextInterface=1;
 const sourceLabels=[...new Set(view.labels)].sort((a,b)=>a-b);
 for(const part of sourceLabels){
  const leaf=sourceLabels.length===1?{arrays:{positions:Float32Array.from(source.positions),normals:source.normals?Float32Array.from(source.normals):null,uvs:source.uvs?Float32Array.from(source.uvs):null,indices:Uint32Array.from(source.indices),faceMaterial:source.faceMaterial?Uint8Array.from(source.faceMaterial):new Uint8Array(faceCount)},faceInterfaces:new Int32Array(faceCount),faceSectionPlanes:new Array(faceCount).fill(null)}:select(source,new Int32Array(faceCount),Uint8Array.from(view.labels,x=>Number(x===part)));
  leaf.part=part;leaf.bounds=sourceLabels.length===1?total:materialMeasure(leaf.arrays);parts.set(part,leaf);
 }
 const grouped=new Map();for(const boundary of view.boundaries??[]){const [a,b]=boundary.parts;if(a===b)continue;const ids=a<b?[a,b]:[b,a],key=ids.join(':');if(!grouped.has(key))grouped.set(key,{parts:ids,edges:[]});grouped.get(key).edges.push(boundary.points);}
 for(const {parts:[a,b],edges}of grouped.values()){
  const normal=unit(sub(parts.get(b).bounds.center,parts.get(a).bounds.center)),id=nextInterface++,cap=attachmentCaps(edges,normal);
  interfaces.set(id,{id,normal,kind:'attachment',parts:[a,b],edges});
  const capPlanes=cap.triangles.map(points=>({points}));
  addCaps(parts.get(a),cap.triangles,id,normal,capMaterial,capPlanes);addCaps(parts.get(b),cap.triangles.map(t=>[t[0],t[2],t[1]]),-id,normal.map(v=>-v),capMaterial,capPlanes);
  if(cap.openEdges||!cap.triangles.length)diagnostics.uncappedAttachments.push({id,openEdges:cap.openEdges,capTriangles:cap.triangles.length});
 }
 const leaves=[];
 function pushLeaf(leaf){
  const nFaces=leaf.arrays.indices.length/3,P=leaf.arrays.positions,I=leaf.arrays.indices;
  if(nFaces>1)for(const axis of [0,1,2]){
   const intervals=new Array(nFaces);
   for(let f=0;f<nFaces;f++){
    const a=P[I[f*3]*3+axis],b=P[I[f*3+1]*3+axis],c=P[I[f*3+2]*3+axis];
    intervals[f]={f,min:a<b?(a<c?a:c):(b<c?b:c),max:a>b?(a>c?a:c):(b>c?b:c)};
   }
   intervals.sort((a,b)=>a.min-b.min);
   let reach=intervals[0].max,splitAt=-1;
   for(let i=1;i<nFaces;i++){if(intervals[i].min>reach+cellExtent*.05){splitAt=i;break;}reach=Math.max(reach,intervals[i].max);}
   if(splitAt>0){
    const mask0=new Uint8Array(nFaces),mask1=new Uint8Array(nFaces);
    for(let i=0;i<splitAt;i++)mask0[intervals[i].f]=1;
    for(let i=splitAt;i<nFaces;i++)mask1[intervals[i].f]=1;
    const children=[mask0,mask1].map(m=>({...select(leaf.arrays,leaf.faceInterfaces,m,leaf.faceSectionPlanes),part:leaf.part}));
    if(children.every(c=>materialMeasure(c.arrays).area>=total.area*.005)){children.forEach(c=>{c.bounds=materialMeasure(c.arrays);pushLeaf(c);});return;}
   }
  }
  leaves.push(leaf);
 }
 function subdivide(leaf){
  const bounds=materialMeasure(leaf.arrays),spans=sub(bounds.max,bounds.min),axes=[0,1,2].sort((a,b)=>spans[b]-spans[a]);leaf.bounds=bounds;
  if(spans[axes[0]]<=cellExtent*(1+1e-6)){pushLeaf(leaf);return;}
  for(const axis of axes){if(spans[axis]<=cellExtent*(1+1e-6))continue;
   const normal=[0,0,0];normal[axis]=1;const center=bounds.min.map((v,k)=>(v+bounds.max[k])/2),plane={point:center,normal},mask=new Uint8Array(leaf.arrays.indices.length/3).fill(1),cut=bisectFaces(leaf.arrays,mask,plane);
   const extracted=extractFaces(cut.arrays,Uint8Array.from(cut.side,x=>Number(x<0)));
   const mapFaces=faces=>{const fi=new Int32Array(faces.length),fp=new Array(faces.length);for(let i=0;i<faces.length;i++){const sf=cut.sourceFace[faces[i]];fi[i]=leaf.faceInterfaces[sf];fp[i]=leaf.faceSectionPlanes[sf];}return {fi,fp};};
   const m0=mapFaces(extracted.partFaces),m1=mapFaces(extracted.restFaces);
   const raw=[{arrays:extracted.part,faceInterfaces:m0.fi,faceSectionPlanes:m0.fp},{arrays:extracted.rest,faceInterfaces:m1.fi,faceSectionPlanes:m1.fp}];
   if(raw.some(child=>!child.arrays.indices.length))continue;
   const segments=sectionSegments(leaf.arrays,mask,plane),linked=sectionLoops(segments.segments);
   const noCrossings=!segments.segments.length;
   let shared=[];
   if(!noCrossings&&!linked.openChains&&!linked.bridged){
    const caps=raw.map(child=>{try{return capPlanarOpenings(child.arrays,plane,{material:capMaterial});}catch{return null;}});
    const areas=caps.map((cap,i)=>cap?materialMeasure(cap.arrays,f=>f>=raw[i].arrays.indices.length/3).area:0);
    if(caps.every(cap=>cap?.capFaces&&!cap.anomalies)&&Math.abs(areas[0]-areas[1])<=Math.max(...areas)*1e-6){
     shared=Array.from({length:caps[0].capFaces},(_,i)=>triangle(caps[0].arrays,raw[0].arrays.indices.length/3+i));
    }
   }
   if(!shared.length&&!noCrossings){
    // A cut has one material section, before the two child boundary repairs
    // diverge. Reconstruct it once and give both sides the same opposed faces.
    diagnostics.stitchedSections.push({part:leaf.part,axis,bridged:linked.bridged,remainingOpenChains:linked.openChains});
    if(!linked.openChains){
     const edges=linked.loops.flatMap(loop=>loop.map((p,i)=>[segments.toWorld(new Vector2(...p)),segments.toWorld(new Vector2(...loop[(i+1)%loop.length]))]));
     shared=attachmentCaps(edges,normal).triangles;
    }
    if(linked.openChains||!shared.length){
     const empty={positions:new Float32Array(),normals:new Float32Array(),uvs:new Float32Array(),indices:new Uint32Array(),faceMaterial:new Uint8Array()};
     const complete=sectionCap(empty,leaf.arrays,mask,plane,{side:-1,material:capMaterial,absoluteWinding:true,budget:1e5,section:segments});
     const recovered=Array.from({length:complete.arrays.indices.length/3},(_,f)=>triangle(complete.arrays,f));
     if(recovered.length)shared=recovered;
     else{
      const edges=linked.loops.flatMap(loop=>loop.map((p,i)=>[segments.toWorld(new Vector2(...p)),segments.toWorld(new Vector2(...loop[(i+1)%loop.length]))]));
      shared=attachmentCaps(edges,normal).triangles;
     }
     diagnostics.windingSections.push({part:leaf.part,axis,grid:complete.grid});
    }
   }
   if(!shared.length){if(noCrossings){raw.forEach(child=>subdivide({...child,part:leaf.part}));return;}continue;}
   const sharedPlanes=shared.map(points=>({points}));
   const children=raw.map((child,i)=>{const side=i===0?-1:1;
    addCaps(child,side===-1?shared:shared.map(t=>[t[0],t[2],t[1]]),side===-1?nextInterface:-nextInterface,normal.map(v=>-side*v),capMaterial,sharedPlanes);
    return {...child,part:leaf.part};
   });
   interfaces.set(nextInterface,{id:nextInterface,normal,kind:'internal',parts:[leaf.part,leaf.part]});nextInterface++;
   children.forEach(subdivide);return;
  }
  diagnostics.unsplitRegions.push({part:leaf.part,spans,reason:'No closed material section on the candidate coarse planes'});pushLeaf(leaf);
 }
 for(const leaf of parts.values())subdivide(leaf);
 // Keep imported topology winding while constructing successive cuts. Orient
 // only the final rendered interiors, after their remaining cuts are complete.
 for(const leaf of leaves)for(let f=0;f<leaf.faceInterfaces.length;f++){
  const owner=leaf.faceInterfaces[f];if(!owner)continue;const n=interfaces.get(Math.abs(owner)).normal.map(v=>v*Math.sign(owner)),a=leaf.arrays,p=triangle(a,f),u=sub(p[1],p[0]),v=sub(p[2],p[0]),cross=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
  if(dot(cross,n)<0)[a.indices[f*3+1],a.indices[f*3+2]]=[a.indices[f*3+2],a.indices[f*3+1]];
  for(const id of a.indices.subarray(f*3,f*3+3))if(a.normals)a.normals.set(n,id*3);
 }
 leaves.forEach((leaf,index)=>{const m=materialMeasure(leaf.arrays),spans=sub(m.max,m.min);leaf.index=index;leaf.center=m.min.map((v,k)=>(v+m.max[k])/2);leaf.halfExtents=spans.map(v=>Math.max(v/2,extent*1e-6));leaf.bounds=m;leaf.volume=Math.max(m.volume,m.area*Math.min(...leaf.halfExtents)/3,extent**3*1e-12);});
 const sections=new Map();for(const leaf of leaves)for(let f=0;f<leaf.faceInterfaces.length;f++){
  const id=leaf.faceInterfaces[f];if(!id)continue;const key=Math.abs(id);if(!sections.has(key))sections.set(key,{positive:[],negative:[]});const p=triangle(leaf.arrays,f),area=areaOf(p),center=[0,1,2].map(k=>(p[0][k]+p[1][k]+p[2][k])/3);sections.get(key)[id>0?'positive':'negative'].push({leaf,area,center,points:p,sourcePlane:leaf.faceSectionPlanes[f]});
 }
 const bonds=[];
 for(const [id,interface_]of interfaces){
  const section=sections.get(id),pairs=new Map();
  if(section?.positive.length&&section.negative.length){
   for(const [key,pair]of matchMaterialSections(section.positive,section.negative))pairs.set(key,pair);
   diagnostics.sectionCoverage.push({interfaceId:id,positiveArea:section.positive.reduce((sum,t)=>sum+t.area,0),negativeArea:section.negative.reduce((sum,t)=>sum+t.area,0),sharedArea:[...pairs.values()].reduce((sum,pair)=>sum+pair.area,0)});
  }else if(interface_.kind==='attachment'){
   const [a,b]=interface_.parts,as=leaves.filter(l=>l.part===a),bs=leaves.filter(l=>l.part===b),edges=interface_.edges;
   let length=0,center=[0,0,0];for(const [p,q]of edges){const w=Math.hypot(...sub(p,q));length+=w;for(let k=0;k<3;k++)center[k]+=(p[k]+q[k])/2*w;}if(!length)continue;center=center.map(v=>v/length);
   const l=closest(center,as),r=closest(center,bs),area=length*length/(4*Math.PI);pairs.set('open',{a:l.index,b:r.index,area,moment:center.map(v=>v*area)});
  }
  for(const pair of pairs.values())if(pair.area>0){const center=pair.moment.map(v=>v/pair.area);bonds.push({id:'material:'+bonds.length,interfaceId:id,kind:interface_.kind,a:pair.a,b:pair.b,area:pair.area,normal:interface_.normal,anchorA:sub(center,leaves[pair.a].center),anchorB:sub(center,leaves[pair.b].center)});}
 }
 // Small gaps between separate source components are explicit inferred seams,
 // rather than leaving a visually attached fitting outside the material graph.
 const connected=leaves.map((_,i)=>i),root=i=>{while(connected[i]!==i)i=connected[i];return i;},join=(a,b)=>{connected[root(a)]=root(b);};bonds.forEach(b=>join(b.a,b.b));
 const candidates=[];for(let a=0;a<leaves.length;a++)for(let b=a+1;b<leaves.length;b++)if(root(a)!==root(b)){
  const x=leaves[a],y=leaves[b],gap=Math.hypot(...[0,1,2].map(k=>Math.max(x.bounds.min[k]-y.bounds.max[k],y.bounds.min[k]-x.bounds.max[k],0)));
  if(gap<=extent*.005)candidates.push({a,b,gap,distance:Math.hypot(...sub(x.center,y.center))});
 }
 candidates.sort((a,b)=>a.gap-b.gap||a.distance-b.distance);
 for(const {a,b,gap}of candidates){if(root(a)===root(b))continue;const x=leaves[a],y=leaves[b],center=x.center.map((v,k)=>(Math.max(x.bounds.min[k],y.bounds.min[k])+Math.min(x.bounds.max[k],y.bounds.max[k]))/2),normal=unit(sub(y.center,x.center)),area=Math.min(...[x,y].map(l=>Math.max(l.bounds.area/12,extent**2*1e-10)));
  const id='material:'+bonds.length;bonds.push({id,interfaceId:null,kind:'inferred-gap',a,b,area,normal,anchorA:sub(center,x.center),anchorB:sub(center,y.center)});diagnostics.inferredAttachments.push({id,a,b,gap});join(a,b);
 }
 // A cap triangle follows the actual connection at that location, so one
 // released sub-interface is visible without waiting for a whole parent cut.
 const bondsByInterface=new Map();
 bonds.forEach((b,index)=>{if(b.interfaceId==null)return;let list=bondsByInterface.get(b.interfaceId);if(!list){list=[];bondsByInterface.set(b.interfaceId,list);}list.push({b,index});});
 for(const leaf of leaves){leaf.faceBonds=new Int32Array(leaf.faceInterfaces.length).fill(-1);for(let f=0;f<leaf.faceInterfaces.length;f++){
  const id=Math.abs(leaf.faceInterfaces[f]);if(!id)continue;const list=bondsByInterface.get(id);if(!list)continue;
  const candidates=list.filter(({b})=>b.a===leaf.index||b.b===leaf.index);if(!candidates.length)continue;
  if(candidates.length===1){leaf.faceBonds[f]=candidates[0].index;continue;}
  const p=triangle(leaf.arrays,f),center=[0,1,2].map(k=>(p[0][k]+p[1][k]+p[2][k])/3);candidates.sort((x,y)=>insideDistance(center,leaves[x.b.a===leaf.index?x.b.b:x.b.a])-insideDistance(center,leaves[y.b.a===leaf.index?y.b.b:y.b.a]));leaf.faceBonds[f]=candidates[0].index;
 }}
 const maxVolume=Math.max(...leaves.map(l=>l.volume)),substantial=leaves.filter(l=>l.volume>=maxVolume*.1),support=substantial.reduce((a,b)=>a.bounds.min[1]<b.bounds.min[1]?a:b);
 const cells=leaves.map(l=>({index:l.index,id:'cell:'+l.index,part:l.part,pinned:l===support,position:l.center,halfExtents:l.halfExtents,mass:l===support?0:l.volume,volume:l.volume,column:0,row:0,layer:0}));
 for(const bond of bonds){const length=Math.max(Math.hypot(...sub(cells[bond.a].position,cells[bond.b].position)),extent*Number.EPSILON);bond.materialLength=length;bond.linearStiffness=elasticModulus*bond.area/length;bond.rotationalStiffness=elasticModulus*bond.area*bond.area/(4*Math.PI*length);}
 const exteriorAreaAfter=leaves.reduce((sum,l)=>sum+materialMeasure(l.arrays,f=>l.faceInterfaces[f]===0).area,0);
 if(Math.abs(exteriorAreaAfter-total.area)>total.area*1e-5)throw Error('Whole-object partition lost original exterior area');
 return {route:WHOLE_FRACTURE_ROUTE,pieces:leaves,bonds,cells,capMaterial,dimensions:{dx:cellExtent,dy:cellExtent,dz:cellExtent},floorY:total.min[1]-extent*.02,
  config:{elasticModulus,gravity,timeStep:1/60,substeps:1,solverIterations:8,stiffness:10000,strength,friction:.5,gripStiffness:100000,gripRadius:0,initialJointPenalty:10000,gravityRampSeconds:0,preventPenetratingNormalDropout:true,collisions:'floor-only'},
  receipt:{sourceTriangles:faceCount,sourceParts:sourceLabels.length,sourceCoverage:sourceLabels.map(part=>({part,triangles:Array.from(view.labels).filter(x=>x===part).length,cells:leaves.filter(l=>l.part===part).length})),exteriorAreaBefore:total.area,exteriorAreaAfter,cellExtent,supportCell:support.index,massModel:'local-origin-surface-integral-with-area-thickness-floor',sectionMatching:'shared-cap-lineage-polygon-intersection',diagnostics,claim:'All detected surface parts have live coarse material; clipped textured exterior, approximate box inertia and inferred near-component attachments; floor collisions'}};
}
