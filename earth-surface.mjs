import {checkedEarthSnapshot,EARTH_MATERIALS,GRIT_VERTICES,GRIT_FACES} from './earth-specimen.mjs';
const sub=(a,b)=>a.map((v,k)=>v-b[k]);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const dot=(a,b)=>a.reduce((s,v,k)=>s+v*b[k],0);
const norm=a=>{const l=Math.hypot(...a);return a.map(v=>v/(l||1));};
const key=(x,y,z)=>`${x},${y},${z}`;
export function createEarthField(input){
 const snapshot=checkedEarthSnapshot(input),spacing=snapshot.config.width/snapshot.config.columns,h=spacing*1.32,half=snapshot.config.width/2;
 const bins=new Map();
 for(const p of snapshot.particles){const k=key(...p.position.map(v=>Math.floor(v/h)));if(!bins.has(k))bins.set(k,[]);bins.get(k).push(p);}
 const value=(x,y,z)=>{
  const ix=Math.floor(x/h),iy=Math.floor(y/h),iz=Math.floor(z/h);let density=0;
  for(let dz=-1;dz<=1;dz++)for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
   for(const p of bins.get(key(ix+dx,iy+dy,iz+dz))??[]){const q=1-((x-p.position[0])**2+(y-p.position[1])**2+(z-p.position[2])**2)/(h*h);if(q>0)density+=q*q*q;}
  }
  return Math.min(density-.72,y/spacing,(half-Math.abs(x))/spacing,(half-Math.abs(z))/spacing);
 };
 const normal=(x,y,z)=>{const e=spacing*.012;return norm([value(x-e,y,z)-value(x+e,y,z),value(x,y-e,z)-value(x,y+e,z),value(x,y,z-e)-value(x,y,z+e)]);};
 return {value,normal,spacing,snapshot,bounds:{min:[-half-spacing,-spacing,-half-spacing],max:[half+spacing,Math.max(...snapshot.particles.map(p=>p.position[1]))+h+spacing,half+spacing]}};
}
// Six consistent tetrahedra per voxel. Extraction is a display/capture operation:
// changing resolution never modifies the retained physical specimen.
export function meshEarthMatrix(field,resolution=28){
 if(!Number.isSafeInteger(resolution)||resolution<2)throw Error('Invalid surface resolution');
 const {min,max}=field.bounds,cell=(max[0]-min[0])/resolution;
 const dims=[resolution,Math.ceil((max[1]-min[1])/cell),resolution],ny=dims[1],nx=dims[0],nz=dims[2];
 const values=new Float32Array((nx+1)*(ny+1)*(nz+1));
 const at=(x,y,z)=>(z*(ny+1)+y)*(nx+1)+x;
 const point=(x,y,z)=>[min[0]+x*cell,min[1]+y*cell,min[2]+z*cell];
 for(let z=0;z<=nz;z++)for(let y=0;y<=ny;y++)for(let x=0;x<=nx;x++)values[at(x,y,z)]=field.value(...point(x,y,z));
 const corners=[[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]];
 const tetra=[[0,5,1,6],[0,1,2,6],[0,2,3,6],[0,3,7,6],[0,7,4,6],[0,4,5,6]],edges=[[0,1],[0,2],[0,3],[1,2],[1,3],[2,3]];
 const triangles=[];
 for(let z=0;z<nz;z++)for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
  const positions=corners.map(([dx,dy,dz])=>point(x+dx,y+dy,z+dz)),v=corners.map(([dx,dy,dz])=>values[at(x+dx,y+dy,z+dz)]);
  if(v.every(v=>v<=0)||v.every(v=>v>0))continue;
  for(const tet of tetra){
   const polygon=[];
   for(const [a,b]of edges){const i=tet[a],j=tet[b];if((v[i]>0)===(v[j]>0))continue;const t=v[i]/(v[i]-v[j]),p=positions[i].map((p,k)=>p+(positions[j][k]-p)*t);if(!polygon.some(q=>Math.hypot(...sub(q,p))<1e-12))polygon.push(p);}
   if(polygon.length<3)continue;
   const center=[0,1,2].map(k=>polygon.reduce((s,p)=>s+p[k],0)/polygon.length),normal=field.normal(...center),axis=norm(sub(polygon[0],center)),other=cross(normal,axis);
   polygon.sort((a,b)=>Math.atan2(dot(sub(a,center),other),dot(sub(a,center),axis))-Math.atan2(dot(sub(b,center),other),dot(sub(b,center),axis)));
   for(let i=1;i<polygon.length-1;i++){let[a,b,c]=[polygon[0],polygon[i],polygon[i+1]];const n=cross(sub(b,a),sub(c,a));if(Math.hypot(...n)<1e-14)continue;if(dot(n,normal)<0)[b,c]=[c,b];triangles.push({a,b,c,materialIndex:0,kind:'matrix',identity:`matrix-${x}-${y}-${z}-${triangles.length}`});}
  }
 }
 return triangles;
}
export function transformGritPoint(p,grain){
 const v=p.map((x,k)=>x*grain.radii[k]),[x,y,z,w]=grain.quaternion;
 const uv=cross([x,y,z],v),uuv=cross([x,y,z],uv);
 return v.map((q,k)=>q+2*w*uv[k]+2*uuv[k]+grain.position[k]);
}
export function createEarthTeacherSource({snapshot,resolution=40,halo=0}={}){
 if(!Number.isSafeInteger(halo)||halo<0)throw Error('Invalid source halo');
 const field=createEarthField(snapshot),triangles=meshEarthMatrix(field,resolution);
 for(const [i,g]of field.snapshot.grit.entries()){
  const vertices=GRIT_VERTICES.map(p=>transformGritPoint(p,g));
  for(const [a,b,c]of GRIT_FACES)triangles.push({a:vertices[a],b:vertices[b],c:vertices[c],materialIndex:g.materialIndex,kind:'grit',identity:`grit-${i}`});
 }
 const central=triangles.slice(),width=field.snapshot.config.width;
 let projected=0,heightMoment=0;for(const t of central)if(t.materialIndex===0){const n=cross(sub(t.b,t.a),sub(t.c,t.a));if(n[1]>0){projected+=n[1];heightMoment+=n[1]*(t.a[1]+t.b[1]+t.c[1])/3;}}
 const samplingPlaneHeight=projected?heightMoment/projected:0;
 for(let z=-halo;z<=halo;z++)for(let x=-halo;x<=halo;x++)if(x||z)for(const t of central){const shift=p=>[p[0]+width*x,p[1],p[2]+width*z];triangles.push({...t,a:shift(t.a),b:shift(t.b),c:shift(t.c),identity:`${t.identity}@${x},${z}`});}
 return {schema:'kaminos.earth-teacher.v1',config:{kind:'earth-specimen',tileSize:width,resolution,halo,snapshot:field.snapshot},samplingPlaneHeight,materials:structuredClone(EARTH_MATERIALS),triangles,referenceHeight:Math.max(...central.flatMap(t=>[t.a[1],t.b[1],t.c[1]]))+.002,
  boundary:'Bounded formed specimen; finite repeated halo when requested. Seamless periodic material is not established.',reconstruction:{kind:'compact particle density isosurface, marching tetrahedra',resolution,matrixTriangles:central.filter(t=>t.materialIndex===0).length},unit:'metres'};
}
