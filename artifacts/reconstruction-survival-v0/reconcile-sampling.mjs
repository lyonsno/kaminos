import { readFileSync } from 'node:fs';
import { detectAnatomicalFrame } from '/private/tmp/kaminos-plateforge/detect-anatomical-frame.mjs';

function readGlbMesh(path){
  const b=readFileSync(path); const jl=b.readUInt32LE(12);
  const j=JSON.parse(b.slice(20,20+jl).toString('utf8')); const bin=b.slice(20+jl+8);
  const positions=[]; const triangles=[];
  for(const m of j.meshes??[]) for(const p of m.primitives??[]){
    const base=positions.length;
    const a=j.accessors[p.attributes.POSITION]; const v=j.bufferViews[a.bufferView];
    const o0=(v.byteOffset??0)+(a.byteOffset??0); const st=v.byteStride??12;
    for(let i=0;i<a.count;i++){const o=o0+i*st;positions.push([bin.readFloatLE(o),bin.readFloatLE(o+4),bin.readFloatLE(o+8)]);}
    const ia=j.accessors[p.indices]; const iv=j.bufferViews[ia.bufferView];
    const io=(iv.byteOffset??0)+(ia.byteOffset??0);
    const read = ia.componentType===5123 ? (k)=>bin.readUInt16LE(io+k*2) : (k)=>bin.readUInt32LE(io+k*4);
    for(let i=0;i<ia.count;i+=3) triangles.push([base+read(i),base+read(i+1),base+read(i+2)]);
  }
  return {positions,triangles};
}
const tri=(a,b,c)=>{const u=[b[0]-a[0],b[1]-a[1],b[2]-a[2]],v=[c[0]-a[0],c[1]-a[1],c[2]-a[2]];
 const x=u[1]*v[2]-u[2]*v[1],y=u[2]*v[0]-u[0]*v[2],z=u[0]*v[1]-u[1]*v[0];return 0.5*Math.hypot(x,y,z);};

function depth(mesh, f, sliceCount, mode){
  const ap=f.anteriorPosterior, ml=f.medioLateral, dv=f.dorsoVentral;
  const apv=mesh.positions.map(p=>p[ap]);
  const lo=Math.min(...apv), hi=Math.max(...apv), span=hi-lo;
  const S=Array.from({length:sliceCount},()=>({area:0,dvMin:Infinity,dvMax:-Infinity,mlMin:Infinity,mlMax:-Infinity}));
  if(mode==='triangle'){
    for(const t of mesh.triangles){
      const a=mesh.positions[t[0]],b=mesh.positions[t[1]],c=mesh.positions[t[2]];
      const area=tri(a,b,c); if(!(area>0))continue;
      const cx=(a[ap]+b[ap]+c[ap])/3;
      const idx=Math.min(sliceCount-1,Math.max(0,Math.floor((cx-lo)/span*sliceCount)));
      const s=S[idx]; s.area+=area;
      for(const p of [a,b,c]){ s.dvMin=Math.min(s.dvMin,p[dv]); s.dvMax=Math.max(s.dvMax,p[dv]);
                               s.mlMin=Math.min(s.mlMin,p[ml]); s.mlMax=Math.max(s.mlMax,p[ml]); }
    }
  } else {
    for(const p of mesh.positions){
      const idx=Math.min(sliceCount-1,Math.max(0,Math.floor((p[ap]-lo)/span*sliceCount)));
      const s=S[idx]; s.area+=1;
      s.dvMin=Math.min(s.dvMin,p[dv]); s.dvMax=Math.max(s.dvMax,p[dv]);
      s.mlMin=Math.min(s.mlMin,p[ml]); s.mlMax=Math.max(s.mlMax,p[ml]);
    }
  }
  const use=S.filter(s=>s.area>0 && s.dvMax>s.dvMin);
  const asp=use.map(s=>(s.mlMax-s.mlMin)/(s.dvMax-s.dvMin));
  const mean=asp.reduce((x,y)=>x+y,0)/asp.length;
  const sd=Math.sqrt(asp.reduce((x,y)=>x+(y-mean)**2,0)/asp.length);
  const tot=use.reduce((x,s)=>x+s.area,0);
  const w=use.reduce((x,s)=>x+(s.mlMax-s.mlMin)*s.area,0)/tot;
  return {mean,sd,w:w/span,slices:use.length};
}
for(const [label,path] of [
 ['envelope','/private/tmp/kaminos-plateforge/artifacts/reconstruction-survival-v0/inputs/authored_cat_envelope.glb'],
 ['sf3d-skin','/private/tmp/kaminos-prometheus-envelope-relations-0805/artifacts/authored-envelope-v0/recon-sf3d-skin/output.glb'],
]){
  const mesh=readGlbMesh(path);
  const f=detectAnatomicalFrame(mesh.positions);
  console.log(`\n${label}  tris=${mesh.triangles.length}`);
  for(const mode of ['triangle','vertex'])
    for(const n of [48]){
      const r=depth(mesh,f,n,mode);
      console.log(`  ${mode.padEnd(9)} n=${n}: aspect ${r.mean.toFixed(3)} spread ${r.sd.toFixed(3)} w/axial ${r.w.toFixed(3)} (${r.slices} slices)`);
    }
}
