import {Quaternion,Vector3} from 'three';

export const COMPONENT_TRANSPORT_ROUTE='kaminos.deformable-surface.corotated-positive-transport.v0';
const finitePoints=a=>Array.isArray(a)&&a.length>0&&a.every(p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite));
const labels=(a,n)=>Array.isArray(a)&&a.length===n&&a.every(x=>Number.isInteger(x)&&x>=0);

// Horn's unit-quaternion fit: the largest algebraic eigenvector gives a proper rotation.
function rotation(rest,current,ids,weights){
 const a=new Vector3(),b=new Vector3();ids.forEach((id,i)=>{a.addScaledVector(new Vector3(...rest[id]),weights[i]);b.addScaledVector(new Vector3(...current[id]),weights[i]);});
 const S=Array.from({length:3},()=>Array(3).fill(0));ids.forEach((id,i)=>{const x=new Vector3(...rest[id]).sub(a).toArray(),y=new Vector3(...current[id]).sub(b).toArray();for(let r=0;r<3;r++)for(let c=0;c<3;c++)S[r][c]+=weights[i]*x[r]*y[c];});
 const [[xx,xy,xz],[yx,yy,yz],[zx,zy,zz]]=S;
 const N=[[xx+yy+zz,yz-zy,zx-xz,xy-yx],[yz-zy,xx-yy-zz,xy+yx,zx+xz],[zx-xz,xy+yx,-xx+yy-zz,yz+zy],[xy-yx,zx+xz,yz+zy,-xx-yy+zz]],V=Array.from({length:4},(_,r)=>Array.from({length:4},(_,c)=>r===c?1:0));
 const scale=Math.max(...N.flat().map(Math.abs));if(!(scale>0))throw new Error('Component rotation is unresolved: collapsed point field');
 while(true){let p=0,q=1;for(let r=0;r<4;r++)for(let c=r+1;c<4;c++)if(Math.abs(N[r][c])>Math.abs(N[p][q])){p=r;q=c;}
  if(Math.abs(N[p][q])<=Number.EPSILON*32*scale)break;
  const theta=.5*Math.atan2(2*N[p][q],N[q][q]-N[p][p]),c=Math.cos(theta),s=Math.sin(theta),pp=N[p][p],qq=N[q][q],pq=N[p][q];
  for(let k=0;k<4;k++)if(k!==p&&k!==q){const kp=N[k][p],kq=N[k][q];N[k][p]=N[p][k]=c*kp-s*kq;N[k][q]=N[q][k]=s*kp+c*kq;}
  N[p][p]=c*c*pp-2*s*c*pq+s*s*qq;N[q][q]=s*s*pp+2*s*c*pq+c*c*qq;N[p][q]=N[q][p]=0;
  for(let k=0;k<4;k++){const kp=V[k][p],kq=V[k][q];V[k][p]=c*kp-s*kq;V[k][q]=s*kp+c*kq;}
 }
 const sorted=[0,1,2,3].sort((a,b)=>N[b][b]-N[a][a]);if(N[sorted[0]][sorted[0]]-N[sorted[1]][sorted[1]]<=Number.EPSILON*128*scale)throw new Error('Component rotation is unresolved: ambiguous point field');
 const i=sorted[0];return new Quaternion(V[1][i],V[2][i],V[3][i],V[0][i]).normalize();
}

export function bindComponentTransport(rest,vertices,{components,component,volumes,radius}={}){
 if(!finitePoints(rest)||!finitePoints(vertices)||!labels(components,rest.length)||!Number.isInteger(component)||!Array.isArray(volumes)||volumes.length!==rest.length||!volumes.every(x=>Number.isFinite(x)&&x>0)||!(Number.isFinite(radius)&&radius>0))throw new Error('Explicit component, positive volumes and support radius required');
 const ids=rest.flatMap((_,i)=>components[i]===component?[i]:[]);if(ids.length<4)throw new Error('Complete component frame requires at least four material points');
 const total=ids.reduce((s,i)=>s+volumes[i],0),frameWeights=ids.map(i=>volumes[i]/total);
 const entries=vertices.map(point=>{
  const distances=ids.map(id=>({id,distance:Math.hypot(...rest[id].map((x,k)=>x-point[k]))})).sort((a,b)=>a.distance-b.distance);
  // Surface-only support expansion makes sparse cut boundaries explicit; it adds no material nodes or stiffness.
  const effectiveRadius=Math.max(radius,distances[3].distance*(1+Math.sqrt(Number.EPSILON))),samples=distances.filter(s=>s.distance<effectiveRadius),raw=samples.map(s=>volumes[s.id]*(1-(s.distance/effectiveRadius)**2)**2),sum=raw.reduce((a,b)=>a+b,0),weights=raw.map(w=>w/sum),center=[0,0,0];
  samples.forEach((s,i)=>rest[s.id].forEach((x,k)=>center[k]+=weights[i]*x));
  return{ids:samples.map(s=>s.id),weights,point:[...point],offset:point.map((x,k)=>x-center[k]),effectiveRadius,nearestDistance:distances[0].distance,weightL1:1};
 });
 return{route:COMPONENT_TRANSPORT_ROUTE,points:rest.length,component,radius,frame:{ids,weights:frameWeights,rest:ids.map(i=>[...rest[i]])},entries,claim:'Component rotation plus positive material-position blend and transported rest offset; no affine-strain reproduction, added mechanics or displacement clipping'};
}

export function componentTransportQuaternion(binding,current,{components}={}){
 if(binding?.route!==COMPONENT_TRANSPORT_ROUTE||!finitePoints(current)||current.length!==binding.points||!labels(components,current.length))throw new Error('Matching current component transport required');
 const valid=(ids,weights)=>Array.isArray(ids)&&ids.length&&new Set(ids).size===ids.length&&ids.every(id=>Number.isInteger(id)&&id>=0&&id<current.length&&components[id]===binding.component)&&Array.isArray(weights)&&weights.length===ids.length&&weights.every(w=>Number.isFinite(w)&&w>0)&&Math.abs(weights.reduce((a,b)=>a+b,0)-1)<1e-10;
 if(!valid(binding.frame?.ids,binding.frame?.weights)||binding.frame.ids.length!==components.filter(c=>c===binding.component).length||!finitePoints(binding.frame.rest)||binding.frame.rest.length!==binding.frame.ids.length)throw new Error('Complete positive component frame required');
 const rest=Array(current.length);binding.frame.ids.forEach((id,i)=>rest[id]=binding.frame.rest[i]);return rotation(rest,current,binding.frame.ids,binding.frame.weights);
}

export function applyComponentTransport(binding,current,{components}={}){
 const q=componentTransportQuaternion(binding,current,{components}),rest=Array(current.length);binding.frame.ids.forEach((id,i)=>rest[id]=binding.frame.rest[i]);
 const valid=(ids,weights)=>Array.isArray(ids)&&ids.length&&new Set(ids).size===ids.length&&ids.every(id=>Number.isInteger(id)&&id>=0&&id<current.length&&components[id]===binding.component)&&Array.isArray(weights)&&weights.length===ids.length&&weights.every(w=>Number.isFinite(w)&&w>0)&&Math.abs(weights.reduce((a,b)=>a+b,0)-1)<1e-10;
 return binding.entries.map(entry=>{
  if(!valid(entry.ids,entry.weights)||!finitePoints([entry.offset,entry.point]))throw new Error('Positive component-owned surface support required');
  const center=[0,0,0];entry.ids.forEach((id,i)=>rest[id].forEach((x,k)=>center[k]+=entry.weights[i]*x));if(entry.offset.some((x,k)=>Math.abs(x-(entry.point[k]-center[k]))>1e-10*Math.max(1,Math.abs(entry.point[k]),Math.abs(center[k]))))throw new Error('Transported rest offset differs from component correspondence');
  const result=new Vector3(...entry.offset).applyQuaternion(q);entry.ids.forEach((id,i)=>result.addScaledVector(new Vector3(...current[id]),entry.weights[i]));if(!result.toArray().every(Number.isFinite))throw new Error('Nonfinite transported surface');return result.toArray();
 });
}
