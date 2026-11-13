import {stoneWindowDisplayPositions} from './stone-material-window.mjs';

// Section faces are presentation geometry only. Teacher triangles stay intact.
export function createCausewayDisplay(source,{cutaway=false}={}){
 const byMaterial=source.materials.map(()=>[]),sections=[],cuts=new Map(),domain=source.captureDomain;
 const faces=[[0,-domain.width/2],[0,domain.width/2],[2,-domain.depth/2],[2,domain.depth/2]];
 for(const t of source.triangles){
  const p=stoneWindowDisplayPositions([t],domain);byMaterial[t.materialIndex].push(...p);
  if(!cutaway||t.column<0)continue;
  for(let i=0;i<faces.length;i++){const [axis,bound]=faces[i],key=[i,t.column,...t.tile].join(':');
   for(let k=0;k<p.length;k+=3)if(Math.abs(p[k+axis]-bound)<1e-9){let points=cuts.get(key);if(!points){points=new Map();cuts.set(key,points);}const a=p.slice(k,k+3);points.set(a.map(x=>x.toFixed(9)).join(','),a);}
  }
 }
 for(const [key,points]of cuts){
  const list=[...points.values()];if(list.length<3)continue;const [axis]=faces[Number(key.split(':')[0])],horizontal=axis===0?2:0;
  const center=[...list[0]];center[horizontal]=(Math.min(...list.map(p=>p[horizontal]))+Math.max(...list.map(p=>p[horizontal])))/2;center[1]=(Math.min(...list.map(p=>p[1]))+Math.max(...list.map(p=>p[1])))/2;
  list.sort((a,b)=>Math.atan2(a[1]-center[1],a[horizontal]-center[horizontal])-Math.atan2(b[1]-center[1],b[horizontal]-center[horizontal]));
  for(let i=0;i<list.length;i++)sections.push(...center,...list[i],...list[(i+1)%list.length]);
 }
 if(cutaway){
  const floor=-source.config.sheetGap-source.config.relief*3,bottom=floor-Math.max(.001,source.config.relief*.2);
  for(const [axis,bound]of faces){const other=axis===0?2:0,half=axis===0?domain.depth/2:domain.width/2;
   const p=(h,y)=>{const v=[0,y,0];v[axis]=bound;v[other]=h;return v;},a=p(-half,floor),b=p(half,floor),c=p(half,bottom),d=p(-half,bottom);sections.push(...a,...b,...c,...a,...c,...d);
  }
 }
 return {byMaterial,sections,cutaway,teacherTrianglesChanged:false};
}
