export const INTERIOR_CUT_ROUTE='kaminos.conservative-interior-plane-cut.v0';
const sub=(a,b)=>a.map((v,k)=>v-b[k]),dot=(a,b)=>a.reduce((s,v,k)=>s+v*b[k],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const signedVolume=(a,b,c,d)=>dot(sub(b,a),cross(sub(c,a),sub(d,a)))/6;
const faces=[[0,1,2],[0,3,1],[0,2,3],[1,3,2]],edges=[[0,1],[0,2],[0,3],[1,2],[1,3],[2,3]];
const vectors=(v,n)=>Array.isArray(v)&&v.length===n&&v.every(p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite));
export function transferContactPatch(patch,cut){
 const anchor=patch.reduce((a,b)=>a.weight>b.weight?a:b),mapped=cut.oldToNew[anchor.index];if(!mapped?.length)throw new Error('Contact has no material descendant');const domain=mapped[0].domain;
 const next=patch.flatMap(p=>{const child=cut.oldToNew[p.index]?.find(c=>c.domain===domain);return child?[{index:child.index,weight:p.weight}]:[];}),sum=next.reduce((s,p)=>s+p.weight,0);
 if(!(sum>0))throw new Error('Contact has no supported descendant');return next.map(p=>({...p,weight:p.weight/sum}));
}
function combine(entries){const weights=new Map();for(const [basis,factor]of entries)for(const p of basis)weights.set(p.index,(weights.get(p.index)??0)+p.weight*factor);return [...weights].filter(([,w])=>w!==0).sort((a,b)=>a[0]-b[0]).map(([index,weight])=>({index,weight}));}

export function splitMaterialInterior(mesh,fields,{targetDomain,normal,offset,children}={}){
 const rest=mesh?.positions,tets=mesh?.tetrahedra,domains=mesh?.domains,n=rest?.length;
 if(!vectors(rest,n)||!n||!Array.isArray(tets)||!tets.length||!tets.every(ids=>Array.isArray(ids)&&ids.length===4&&new Set(ids).size===4&&ids.every(i=>Number.isInteger(i)&&i>=0&&i<n))||!Array.isArray(domains)||domains.length!==tets.length||!domains.every(Number.isInteger))throw new Error('Complete material interior required');
 if(!vectors(fields?.positions,n)||!vectors(fields?.velocities,n)||!Array.isArray(fields?.pinned)||fields.pinned.length!==n||!fields.pinned.every(v=>typeof v==='boolean'))throw new Error('Complete current position, velocity and support fields required');
 if(!Array.isArray(normal)||normal.length!==3||!normal.every(Number.isFinite)||Math.abs(Math.hypot(...normal)-1)>1e-6||!Number.isFinite(offset))throw new Error('Explicit unit cut plane required');
 if(!domains.includes(targetDomain)||!Array.isArray(children)||children.length!==2||new Set(children).size!==2||!children.every(v=>Number.isInteger(v)&&!domains.includes(v)))throw new Error('Existing target and two new domain identities required');
 const originalOwners=rest.map(()=>new Set());let volumeBefore=0;
 tets.forEach((ids,t)=>{const v=Math.abs(signedVolume(...ids.map(i=>rest[i])));if(!(v>0))throw new Error('Positive input tetrahedra required');volumeBefore+=v;ids.forEach(i=>originalOwners[i].add(domains[t]));});
 if(originalOwners.some(s=>s.size!==1))throw new Error('Every input point needs exactly one supported material domain');
 const output={positions:[],tetrahedra:[],domains:[]},parents=[],nodeDomains=[],map=new Map(),oldToNew=rest.map(()=>[]),childVolumes=[0,0];
 const value=(basis,field)=>[0,1,2].map(k=>basis.reduce((s,p)=>s+p.weight*field[p.index][k],0));
 const vertex=i=>({key:`v:${i}`,p:rest[i],basis:[{index:i,weight:1}],distance:dot(normal,rest[i])-offset});
 const node=(v,domain)=>{const key=`${domain}/${v.key}`;if(map.has(key))return map.get(key);const i=output.positions.length;map.set(key,i);output.positions.push([...v.p]);parents.push(v.basis);nodeDomains.push(domain);if(v.basis.length===1&&v.basis[0].weight===1)oldToNew[v.basis[0].index].push({index:i,domain});return i;};
 const emit=(vertices,domain)=>{let ids=vertices.map(v=>node(v,domain)),v=signedVolume(...vertices.map(v=>v.p));if(v===0)return;if(v<0)[ids[2],ids[3]]=[ids[3],ids[2]];output.tetrahedra.push(ids);output.domains.push(domain);const side=children.indexOf(domain);if(side>=0)childVolumes[side]+=Math.abs(v);};
 const intersection=(a,b)=>{if(a.distance===0)return a;if(b.distance===0)return b;if(a.key>b.key)[a,b]=[b,a];const t=a.distance/(a.distance-b.distance);return{key:`e:${a.key}/${b.key}`,p:a.p.map((v,k)=>v+(b.p[k]-v)*t),basis:combine([[a.basis,1-t],[b.basis,t]]),distance:0};};
 const clippedFace=(polygon,side)=>{const result=[];for(let i=0;i<polygon.length;i++){const a=polygon[i],b=polygon[(i+1)%polygon.length],insideA=a.distance*side>=0,insideB=b.distance*side>=0;if(insideA)result.push(a);if(insideA!==insideB)result.push(intersection(a,b));}return result.filter((v,i)=>v.key!==result[(i+result.length-1)%result.length]?.key);};
 tets.forEach((ids,t)=>{
  const verts=ids.map(vertex),domain=domains[t];if(domain!==targetDomain){emit(verts,domain);return;}
  if(verts.every(v=>v.distance>=0)){emit(verts,children[0]);return;}if(verts.every(v=>v.distance<=0)){emit(verts,children[1]);return;}
  const cap=new Map();verts.filter(v=>v.distance===0).forEach(v=>cap.set(v.key,v));for(const [a,b]of edges)if(verts[a].distance*verts[b].distance<0){const v=intersection(verts[a],verts[b]);cap.set(v.key,v);}
  const ring=[...cap.values()],center=ring[0].p.map((_,k)=>ring.reduce((s,v)=>s+v.p[k]/ring.length,0)),axis=[0,0,0];axis[normal.map(Math.abs).indexOf(Math.min(...normal.map(Math.abs)))]=1;const u=cross(normal,axis),length=Math.hypot(...u),unit=u.map(v=>v/length),v=cross(normal,unit);
  ring.sort((a,b)=>Math.atan2(dot(sub(a.p,center),v),dot(sub(a.p,center),unit))-Math.atan2(dot(sub(b.p,center),v),dot(sub(b.p,center),unit)));
  for(const [side,child]of [[1,children[0]],[-1,children[1]]]){
   const polygons=[...faces.map(f=>clippedFace(f.map(i=>verts[i]),side)).filter(f=>f.length>=3),ring],unique=[...new Map(polygons.flat().map(p=>[p.key,p])).values()];
   const centerVertex={key:`c:${t}:${side}`,p:[0,1,2].map(k=>unique.reduce((s,p)=>s+p.p[k]/unique.length,0)),basis:combine(unique.map(p=>[p.basis,1/unique.length])),distance:0};
   // A canonical face fan keeps adjacent clipped tetrahedra conforming.
   for(const polygon of polygons){let start=0;polygon.forEach((p,i)=>{if(p.key<polygon[start].key)start=i;});const ordered=polygon.map((_,i)=>polygon[(i+start)%polygon.length]);for(let i=1;i<ordered.length-1;i++)emit([centerVertex,ordered[0],ordered[i],ordered[i+1]],child);}
  }
 });
 if(!childVolumes.every(v=>v>0))throw new Error('Cut does not intersect the target interior');
 // Remove any vertex introduced solely by an exactly degenerate face triangle.
 const used=new Set(output.tetrahedra.flat()),compact=new Map([...used].sort((a,b)=>a-b).map((i,k)=>[i,k])),kept=[...compact.keys()];
 output.positions=kept.map(i=>output.positions[i]);output.tetrahedra=output.tetrahedra.map(ids=>ids.map(i=>compact.get(i)));const lineage=kept.map(i=>parents[i]),owners=kept.map(i=>nodeDomains[i]);
 const nextFields={positions:lineage.map(p=>value(p,fields.positions)),velocities:lineage.map(p=>value(p,fields.velocities)),pinned:lineage.map(p=>p.every(e=>fields.pinned[e.index]))},volumeAfter=output.tetrahedra.reduce((s,ids)=>s+Math.abs(signedVolume(...ids.map(i=>output.positions[i]))),0);
 if(Math.abs(volumeAfter-volumeBefore)>volumeBefore*1e-8)throw new Error('Interior cut failed volume conservation');
 output.volume=volumeAfter;output.route=INTERIOR_CUT_ROUTE;output.status='passed';
 return{mesh:output,fields:nextFields,parents:lineage,nodeDomains:owners,oldToNew:oldToNew.map(list=>list.filter(p=>compact.has(p.index)).map(p=>({...p,index:compact.get(p.index)}))),receipt:{route:INTERIOR_CUT_ROUTE,targetDomain,children:[...children],normal:[...normal],offset,volumeBefore,volumeAfter,childVolumes,pointsBefore:n,pointsAfter:output.positions.length,elementsBefore:tets.length,elementsAfter:output.tetrahedra.length,claim:'Conservative plane subdivision and piecewise-affine pose/velocity transfer; no propagation law or compression repair'}};
}
