import {pairTransfer} from './gpu-plan.mjs';
export const tileIndex=(p,c)=>{const t=p.tiles;return Math.floor(c[0]/t.width)+t.dims[0]*(Math.floor(c[1]/t.width)+t.dims[1]*Math.floor(c[2]/t.width));};
export const cellCoord=(p,i)=>[i%p.dims[0],Math.floor(i/p.dims[0])%p.dims[1],Math.floor(i/(p.dims[0]*p.dims[1]))];
export const cellIndex=(p,c)=>c[0]+p.dims[0]*(c[1]+p.dims[1]*c[2]);
export function seededTiles(p,values,previous=new Float32Array(p.count)){
 const changed=new Set();for(let i=0;i<p.count;i++)if(values[i]!==previous[i])changed.add(tileIndex(p,cellCoord(p,i)));return changed;
}
export function admittedTiles(p,pending,contact=null,previous=null){
 const t=p.tiles,active=new Set(),h=t.phaseHalo;
 for(const tile of pending){const c=[tile%t.dims[0],Math.floor(tile/t.dims[0])%t.dims[1],Math.floor(tile/(t.dims[0]*t.dims[1]))];
  for(let z=Math.max(0,c[2]-h);z<=Math.min(t.dims[2]-1,c[2]+h);z++)for(let y=Math.max(0,c[1]-h);y<=Math.min(t.dims[1]-1,c[1]+h);y++)for(let x=Math.max(0,c[0]-h);x<=Math.min(t.dims[0]-1,c[0]+h);x++)active.add(x+t.dims[0]*(y+t.dims[1]*z));
 }
 if((contact||previous)&&JSON.stringify(contact)!==JSON.stringify(previous)){
  const current=contact??previous,old=previous??current,r=Math.max(current[3],old[3])+6*p.cellSize;
  for(let tile=0;tile<t.count;tile++){
   const c=[tile%t.dims[0],Math.floor(tile/t.dims[0])%t.dims[1],Math.floor(tile/(t.dims[0]*t.dims[1]))];
   if(c.every((n,k)=>p.origin[k]+n*t.width*p.cellSize<=Math.max(current[k],old[k])+r&&p.origin[k]+Math.min((n+1)*t.width,p.dims[k])*p.cellSize>=Math.min(current[k],old[k])-r))active.add(tile);
  }
 }
 return active;
}
// Small deterministic reference, not a serving-path CPU solver.
export function referenceTileStep(p,{values,solid=new Uint8Array(p.count),pending=new Set(),contact=null,previous=null,all=false}){
 const out=Float32Array.from(values),active=all?new Set(Array.from({length:p.tiles.count},(_,i)=>i)):admittedTiles(p,pending,contact,previous),next=new Set(),dirty=new Set();
 const pen=c=>{if(!contact)return 0;const w=c.map((n,k)=>p.origin[k]+(n+.5)*p.cellSize),old=previous??contact,d=contact.slice(0,3).map((v,k)=>v-old[k]),dot=d.reduce((s,v,k)=>s+(w[k]-old[k])*v,0),len=d.reduce((s,v)=>s+v*v,0),s=Math.max(0,Math.min(1,dot/Math.max(len,1e-12)));return Math.max(0,contact[3]-Math.hypot(...w.map((v,k)=>v-old[k]-s*d[k])))/p.cellSize;};
 for(const axis of [1,0,2])for(let phase=0;phase<2;phase++)for(let i=0;i<p.count;i++){
  const c=cellCoord(p,i);if(!active.has(tileIndex(p,c))||c[axis]%2!==phase||c[axis]+1>=p.dims[axis])continue;
  const q=[...c];q[axis]++;const j=cellIndex(p,q),a=out[i],b=out[j];
  const v=pairTransfer({a,b,axis,solidA:solid[i],solidB:solid[j],penetrationA:pen(c),penetrationB:pen(q)}),na=Math.fround(a-v),nb=Math.fround(b+v);
  if(na!==a&&nb!==b){out[i]=na;out[j]=nb;for(const k of [i,j]){const t=tileIndex(p,cellCoord(p,k));next.add(t);dirty.add(t);}}
 }
 return {values:out,active,pending:next,dirty};
}
// Side strips preserve partial-cell heights. Faces use -X,+X,-Y,+Y,-Z,+Z.
export function exposedFaces(p,values,solid=new Uint8Array(p.count)){
 const fill=c=>c.some((v,k)=>v<0||v>=p.dims[k])?0:solid[cellIndex(p,c)]?1:values[cellIndex(p,c)],faces=[];
 for(let i=0;i<p.count;i++)if(values[i]>0){const c=cellCoord(p,i),a=values[i];for(let f=0;f<6;f++){
  const axis=Math.floor(f/2),q=[...c];q[axis]+=f%2?1:-1;const b=fill(q);
  if(axis===1?(f===2?b<1:a<1||b<=0):a>b)faces.push({cell:i,face:f,low:axis===1?0:b,high:a});
 }}return faces;
}
