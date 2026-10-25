import {bisectFaces,extractFaces,sectionCap} from './poly-mesh-edit.mjs';
export const COARSE_PREPARATION_ROUTE='kaminos.fracture.preserved-surface-two-chunks.v1';
const dot=(a,b)=>a.reduce((s,v,k)=>s+v*b[k],0);
function measure(a,material=null){
 let area=0,center=[0,0,0];const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
 for(let f=0;f<a.indices.length/3;f++){
  if(material!==null&&a.faceMaterial[f]!==material)continue;
  const p=Array.from(a.indices.subarray(f*3,f*3+3),id=>Array.from(a.positions.subarray(id*3,id*3+3))),u=p[1].map((v,k)=>v-p[0][k]),v=p[2].map((v,k)=>v-p[0][k]);
  const w=Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])/2;area+=w;
  for(let k=0;k<3;k++){center[k]+=w*(p[0][k]+p[1][k]+p[2][k])/3;for(const q of p){min[k]=Math.min(min[k],q[k]);max[k]=Math.max(max[k],q[k]);}}
 }
 return {area,center:center.map(v=>v/area),min,max};
}
export function prepareCoarseFracture(source,faces,{normal,offset=0}={}){
 if(!faces?.length||new Set(faces).size!==faces.length||faces.some(f=>!Number.isInteger(f)||f<0||f>=source.indices.length/3))throw Error('Unique valid source faces required');
 if(!Number.isFinite(offset))throw Error('Finite cut offset required');
 const mask=new Uint8Array(source.indices.length/3);for(const f of faces)mask[f]=1;
 const {part,rest}=extractFaces(source,mask),bounds=measure(part),span=bounds.max.map((v,k)=>v-bounds.min[k]);
 if(!normal){normal=[0,0,0];normal[span.indexOf(Math.max(...span))]=1;}
 if(normal.length!==3||!normal.every(Number.isFinite)||!(Math.hypot(...normal)>0))throw Error('Finite nonzero cut normal required');
 const length=Math.hypot(...normal),n=normal.map(v=>v/length),point=bounds.center.map((v,k)=>v+n[k]*offset),plane={point,normal:n};
 const all=new Uint8Array(part.indices.length/3).fill(1),cut=bisectFaces(part,all,plane),capMaterial=(source.faceMaterial??[]).reduce((a,b)=>Math.max(a,b),0)+1;
 const negative=Uint8Array.from(cut.side,s=>Number(s<0)),split=extractFaces(cut.arrays,negative);
 if(!split.part.indices.length||!split.rest.indices.length)throw Error('Cut must intersect the selected piece');
 const pieces=[split.part,split.rest].map((arrays,i)=>{
  const side=i===0?-1:1,capped=sectionCap(arrays,part,all,plane,{side,material:capMaterial,fill:'winding'}),section=measure(capped.arrays,capMaterial),body=measure(capped.arrays);
  if(!(section.area>0)||!capped.capFaces)throw Error('The selected cut has no enclosed material section; choose another piece or cut');
  const halfExtents=body.max.map((v,k)=>(v-body.min[k])/2),center=body.min.map((v,k)=>(v+body.max[k])/2),extent=dot(halfExtents,n.map(Math.abs))*2;
  return {side,arrays:capped.arrays,capFaces:capped.capFaces,section,center,halfExtents,volume:section.area*extent};
 });
 const area=(pieces[0].section.area+pieces[1].section.area)/2,center=pieces[0].section.center;
 if(Math.abs(pieces[0].section.area-pieces[1].section.area)>area*1e-5)throw Error('Opposed material sections disagree');
 const exteriorAreaBefore=bounds.area,exteriorAreaAfter=pieces.reduce((s,p)=>s+measure(p.arrays).area-p.section.area,0);
 if(Math.abs(exteriorAreaAfter-exteriorAreaBefore)>exteriorAreaBefore*1e-5)throw Error('Cut changed the retained exterior area');
 return {route:COARSE_PREPARATION_ROUTE,rest,pieces,capMaterial,plane,interface:{area,center,normal:n},receipt:{sourceFaces:faces,sourceTriangles:source.indices.length/3,exteriorAreaBefore,exteriorAreaAfter,capMaterial,sectionFill:'oriented-surface-winding',massModel:'section-area-times-axial-span',claim:'Detailed exterior clipped at one coarse cohesive interface; approximate mass and box collision, no inferred calibrated material or global solid repair'}};
}
