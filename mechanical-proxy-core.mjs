export const PROXY_ROUTE='kaminos.mechanical-proxy.wildmeshing.v1';
export const tetFaces=[[0,2,1],[0,1,3],[0,3,2],[1,2,3]];
export const tetEdges=[[0,1],[0,2],[0,3],[1,2],[1,3],[2,3]];
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export const signedTet=(p)=>sub(p[1],p[0]).reduce((s,v,i)=>s+v*cross(sub(p[2],p[0]),sub(p[3],p[0]))[i],0)/6;
export function proxySettings(input){
 const out={};for(const key of ['envelope','spacing','budgetSeconds']){const v=input?.[key];if(typeof v!=='number'||!Number.isFinite(v)||v<=0)throw Error(`${key} must be finite and positive`);out[key]=v;}return out;
}
export function admitProxy(mesh){
 if(mesh?.status!=='passed')throw Error('A complete mechanical proxy is required');
 if(mesh.route!==PROXY_ROUTE)throw Error('Mechanical proxy route differs');
 if(!Array.isArray(mesh.positions)||!mesh.positions.length||!mesh.positions.every(p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite)))throw Error('Finite proxy positions required');
 if(!Array.isArray(mesh.tetrahedra)||!mesh.tetrahedra.length)throw Error('Complete tetrahedra required');
 for(const t of mesh.tetrahedra){if(!Array.isArray(t)||t.length!==4||!t.every(i=>Number.isInteger(i)&&i>=0&&i<mesh.positions.length))throw Error('Valid tetrahedral indices required');if(new Set(t).size!==4||!Number.isFinite(signedTet(t.map(i=>mesh.positions[i])))||signedTet(t.map(i=>mesh.positions[i]))===0)throw Error('Nondegenerate tetrahedra required');}
 return mesh;
}
export function proxyBoundary(mesh){
 admitProxy(mesh);const faces=new Map();
 mesh.tetrahedra.forEach((t,tet)=>{for(const f of tetFaces){const ids=f.map(i=>t[i]);if(signedTet(t.map(i=>mesh.positions[i]))<0)ids.reverse();const key=[...ids].sort((a,b)=>a-b).join(':');const old=faces.get(key);if(old)old.count++;else faces.set(key,{ids,tet,count:1});}});
 if([...faces.values()].some(f=>f.count>2))throw Error('Non-manifold tetrahedral incidence');
 return [...faces.values()].filter(f=>f.count===1);
}
function plane(axis,offset){if(!Number.isInteger(axis)||axis<0||axis>2||!Number.isFinite(offset))throw Error('Finite section plane required');}
export function proxySlab(mesh,axis,offset,width){
 plane(axis,offset);if(!Number.isFinite(width)||width<0)throw Error('Finite nonnegative slab width required');
 return mesh.tetrahedra.flatMap((t,i)=>{const x=t.map(n=>mesh.positions[n][axis]);return Math.min(...x)<=offset+width/2&&Math.max(...x)>=offset-width/2?[i]:[];});
}
export function proxySection(mesh,axis,offset){
 plane(axis,offset);const result=[];
 for(const tet of proxySlab(mesh,axis,offset,0)){
  const p=mesh.tetrahedra[tet].map(i=>mesh.positions[i]),points=[];
  const add=v=>{if(!points.some(q=>q.every((x,i)=>Math.abs(x-v[i])<1e-10)))points.push(v);};
  for(const [a,b]of tetEdges){const da=p[a][axis]-offset,db=p[b][axis]-offset;if(da===0)add([...p[a]]);if(db===0)add([...p[b]]);if(da*db<0){const u=da/(da-db);add(p[a].map((v,i)=>i===axis?offset:v+u*(p[b][i]-v)));}}
  if(points.length<3)continue;const axes=[0,1,2].filter(a=>a!==axis),center=axes.map(a=>points.reduce((s,p)=>s+p[a],0)/points.length);
  points.sort((a,b)=>Math.atan2(a[axes[1]]-center[1],a[axes[0]]-center[0])-Math.atan2(b[axes[1]]-center[1],b[axes[0]]-center[0]));
  result.push({tet,points});
 }
 return result;
}
