// A worked material is retained on material points, with per-tetrahedron plastic metrics.
const edges=[[0,1],[0,2],[0,3],[1,2],[1,3],[2,3]];
export function tetVolume(a,b,c,d){const u=b.map((x,i)=>x-a[i]),v=c.map((x,i)=>x-a[i]),w=d.map((x,i)=>x-a[i]);return (u[0]*(v[1]*w[2]-v[2]*w[1])-u[1]*(v[0]*w[2]-v[2]*w[0])+u[2]*(v[0]*w[1]-v[1]*w[0]))/6;}
const distance=(a,b)=>Math.hypot(...a.map((x,i)=>x-b[i]));
export function metric(points){return edges.map(([a,b])=>distance(points[a],points[b]));}
function restPoints(l){
 const x=l[0],cx=(x*x+l[1]**2-l[3]**2)/(2*x),cy=Math.sqrt(Math.max(1e-30,l[1]**2-cx*cx));
 const dx=(x*x+l[2]**2-l[4]**2)/(2*x),dy=(l[1]**2+l[2]**2-l[5]**2-2*cx*dx)/(2*cy),dz=Math.sqrt(Math.max(1e-30,l[2]**2-dx*dx-dy*dy));
 return [[0,0,0],[x,0,0],[cx,cy,0],[dx,dy,dz]];
}
export function materialFaces(material){
 const faces=new Map();
 for(const [tet,t]of material.tets.entries())if(!t.damage)for(let opposite=0;opposite<4;opposite++){
  if(t.surface&&!t.surface[opposite])continue;let ids=t.ids.filter((_,i)=>i!==opposite);const [a,b,c]=ids.map(i=>material.nodes[i].p),d=material.nodes[t.ids[opposite]].p;
  if(tetVolume(a,b,c,d)>0)[ids[1],ids[2]]=[ids[2],ids[1]];
  const key=ids.slice().sort((a,b)=>a-b).join(':');if(faces.has(key))faces.delete(key);else faces.set(key,{ids,tet,opposite,group:t.group});
 }return [...faces.values()];
}
export function materialMasses(material){const m=new Float64Array(material.nodes.length);for(const t of material.tets)for(const i of t.ids)m[i]+=Math.abs(t.rest)*material.density/4;return m;}
export function refineMaterial(material,selected=new Set(material.tets.map((_,i)=>i))){
 if(!(selected instanceof Set)||[...selected].some(i=>!Number.isInteger(i)||i<0||i>=material.tets.length))throw Error('Refinement selects actual retained tetrahedra');
 const out=structuredClone(material),midpoints=new Map(),oldTets=material.tets,surfaceFlags=oldTets.map(()=>[false,false,false,false]);for(const f of materialFaces(material))surfaceFlags[f.tet][f.opposite]=true;out.tets=[];
 const midpoint=(a,b)=>{const key=[a,b].sort((x,y)=>x-y).join(':');if(midpoints.has(key))return midpoints.get(key);const na=material.nodes[a],nb=material.nodes[b],node={};for(const field of ['p','v','reference'])node[field]=na[field].map((v,k)=>(v+nb[field][k])/2);node.parents=[a,b];const id=out.nodes.push(node)-1;midpoints.set(key,id);return id;};
 for(const [ti,t]of oldTets.entries()){
  if(!selected.has(ti)){out.tets.push({...structuredClone(t),surface:surfaceFlags[ti]});continue;}
  const [a,b,c,d]=t.ids,ab=midpoint(a,b),ac=midpoint(a,c),ad=midpoint(a,d),bc=midpoint(b,c),bd=midpoint(b,d),cd=midpoint(c,d);
  const child=[[a,ab,ac,ad],[ab,b,bc,bd],[ac,bc,c,cd],[ad,bd,cd,d],[ab,ac,ad,cd],[ab,ac,bc,cd],[ab,ad,bd,cd],[ab,bc,bd,cd]];
  const r=restPoints(t.plastic??metric(t.ids.map(i=>material.nodes[i].reference))),coordinates=new Map(t.ids.map((id,i)=>[id,r[i]]));
  for(const [id,i,j]of [[ab,0,1],[ac,0,2],[ad,0,3],[bc,1,2],[bd,1,3],[cd,2,3]])coordinates.set(id,r[i].map((x,k)=>(x+r[j][k])/2));
  const ancestry=new Map(t.ids.map((id,i)=>[id,1<<i]));for(const [id,i,j]of [[ab,0,1],[ac,0,2],[ad,0,3],[bc,1,2],[bd,1,3],[cd,2,3]])ancestry.set(id,(1<<i)|(1<<j));
  for(let ids of child){if(tetVolume(...ids.map(i=>out.nodes[i].reference))<0)[ids[1],ids[2]]=[ids[2],ids[1]];out.tets.push({...structuredClone(t),ids,rest:Math.abs(t.rest)/8,plastic:metric(ids.map(i=>coordinates.get(i))),level:(t.level??0)+1,parent:ti,surface:ids.map((_,opposite)=>{const mask=ids.filter((_,i)=>i!==opposite).reduce((m,id)=>m|ancestry.get(id),0);return surfaceFlags[ti].some((outer,k)=>outer&&(mask&(1<<k))===0);})});}
 }
 // A midpoint on a remaining coarse face stays on its coarse edge. These
 // reciprocal constraints are the transition, not fixed artificial walls.
 const ties=new Map((material.ties??[]).map(t=>[t.ids[0],structuredClone(t)]));
 for(const [key,id]of midpoints){const endpoints=key.split(':').map(Number);if(oldTets.some((t,i)=>!selected.has(i)&&endpoints.every(x=>t.ids.includes(x))))ties.set(id,{ids:[id,...endpoints]});}
 for(const [id,t]of ties)if(!out.tets.some(tet=>tet.ids.includes(t.ids[1])&&tet.ids.includes(t.ids[2])))ties.delete(id);
 out.ties=[...ties.values()];out.generation=(material.generation??0)+1;return out;
}
export function seedMaterial({width=.024,depth=.018,clods=4,density=1600}={}){
 const nodes=[],tets=[];const side=Math.ceil(Math.sqrt(clods)),size=width/(side*2.8),height=size*.65;
 for(let group=0;group<clods;group++){
  const x=((group%side+.5)/side-.5)*width*.75,z=((Math.floor(group/side)+.5)/side-.5)*depth*.75;
  const base=nodes.length;
  for(const [dx,dy,dz]of [[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]]){const p=[x+(dx-.5)*size,.00004+dy*height,z+(dz-.5)*size];nodes.push({p,v:[0,0,0],reference:[...p]});}
  for(const local of [[0,5,1,6],[0,1,2,6],[0,2,3,6],[0,3,7,6],[0,7,4,6],[0,4,5,6]]){const ids=local.map(i=>i+base);if(tetVolume(...ids.map(i=>nodes[i].p))<0)[ids[1],ids[2]]=[ids[2],ids[1]];const p=ids.map(i=>nodes[i].p);tets.push({ids,rest:tetVolume(...p),plastic:metric(p),damage:0,group,level:0});}
 }return {nodes,tets,density,ties:[],generation:0};
}
export const BODY_WORDS=24;
export function makeEarthState({count=16384,radius=.00011,width=.024,depth=.018,clods=4,seed=41,materialLevels=1}={}){
 for(const [k,v]of Object.entries({count,clods,seed,materialLevels}))if(!Number.isSafeInteger(v)||v<0)throw Error('Invalid '+k);
 if(count<1||![radius,width,depth].every(v=>v>0&&Number.isFinite(v)))throw Error('Finite positive grain and specimen sizes required');
 let material=seedMaterial({width,depth,clods});for(let i=0;i<materialLevels;i++)material=refineMaterial(material);
 const floats=new Float32Array((count+material.nodes.length)*BODY_WORDS);let rng=seed>>>0;const random=()=>{rng=(Math.imul(rng,1664525)+1013904223)>>>0;return rng/4294967296;};
 const massScale=2600*4*Math.PI/3*radius**3*1.7,spacing=radius*3.6,nx=Math.floor(width/spacing),nz=Math.floor(depth/spacing);if(nx<2||nz<2)throw Error('Grains do not fit in specimen');
 const bounds=new Map();for(const t of material.tets){let b=bounds.get(t.group);if(!b)bounds.set(t.group,b={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]});for(const i of t.ids)for(let k=0;k<3;k++){b.min[k]=Math.min(b.min[k],material.nodes[i].p[k]);b.max[k]=Math.max(b.max[k],material.nodes[i].p[k]);}}
 let slot=0;
 for(let i=0;i<count;i++){
  const r=radius*(.85+.3*random()),rb=r*(.85+.15*random()),separation=r*.65,volume=4*Math.PI/3*(r**3+rb**3)-Math.PI*(r+rb-separation)**2*(separation**2+2*separation*(r+rb)-3*(r-rb)**2)/(12*separation),mass=volume*2600;
  let p;for(;;slot++){p=[(slot%nx+.5)*spacing-width/2,r+Math.floor(slot/(nx*nz))*spacing,(Math.floor(slot/nx)%nz+.5)*spacing-depth/2];if(![...bounds.values()].some(b=>p.every((v,k)=>v>b.min[k]-r*2&&v<b.max[k]+r*2)))break;}slot++;
  const q=[random()-.5,random()-.5,random()-.5,random()-.5],n=Math.hypot(...q),fraction=rb**3/(r**3+rb**3),inverseMass=massScale/mass,axial=.4*(r**5+rb**5)/(r**3+rb**3),radial=axial+fraction*(1-fraction)*separation**2;
  floats.set([...p,inverseMass,...q.map(v=>v/n),0,0,0,r,0,0,0,rb,-separation*fraction,separation*(1-fraction),0,random(),inverseMass/axial,inverseMass/radial,inverseMass/radial,mass],i*BODY_WORDS);
 }
 return packMaterial({floats,grainCount:count,material,massScale,width,depth,radius,seed});
}
export function packMaterial(state){
 const {material,grainCount,massScale}=state,masses=materialMasses(material),bodies=new Float32Array((grainCount+material.nodes.length)*BODY_WORDS);bodies.set(state.floats.subarray(0,grainCount*BODY_WORDS));
 for(const [i,n]of material.nodes.entries()){const mass=masses[i];if(!(mass>0))throw Error('Material point has no represented mass');bodies.set([...n.p,massScale/mass,0,0,0,1,...n.v,0,0,0,0,0,0,0,1,0,0,0,0,mass],(grainCount+i)*BODY_WORDS);}
 const degrees=new Uint32Array(material.nodes.length);for(const t of material.tets)for(const i of t.ids)degrees[i]++;for(let i=0;i<degrees.length;i++)bodies[(grainCount+i)*24+23]=Math.max(1,degrees[i]);
 const tets=new Float32Array(Math.max(1,material.tets.length)*20),u=new Uint32Array(tets.buffer);
 for(const [i,t]of material.tets.entries()){u.set(t.ids.map(x=>x+grainCount),i*20);tets.set([t.rest,.12,6,t.damage],i*20+4);tets.set(t.plastic,i*20+8);u[i*20+16]=t.group;u[i*20+17]=t.level??0;}
 const faces=materialFaces(material),triangles=new Uint32Array(Math.max(1,faces.length)*4);for(const [i,t]of faces.entries())triangles.set([...t.ids.map(x=>x+grainCount),t.tet],i*4);
 const ties=new Uint32Array(Math.max(1,material.ties?.length??0)*4);for(const [i,t]of (material.ties??[]).entries())ties.set([...t.ids.map(x=>x+grainCount),0],i*4);
 return {...state,floats:bodies,tets,triangles,ties,faceCount:faces.length,tieCount:material.ties?.length??0};
}
export function retainMaterial(state,floats,tetFloats){
 if(floats.length!==state.floats.length||tetFloats.length!==state.tets.length)throw Error('Complete live GPU material state required');
 const out={...state,floats,material:structuredClone(state.material)};
 out.material.nodes.forEach((n,i)=>{n.p=Array.from(floats.subarray((state.grainCount+i)*24,(state.grainCount+i)*24+3));n.v=Array.from(floats.subarray((state.grainCount+i)*24+8,(state.grainCount+i)*24+11));});
 out.material.tets.forEach((t,i)=>{t.plastic=Array.from(tetFloats.subarray(i*20+8,i*20+14));t.damage=tetFloats[i*20+7];});return out;
}
