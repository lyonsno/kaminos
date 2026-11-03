import {faceFrame,facePoint,faceUV} from './crust-faces.mjs';
import {dot,grainLocal,frameBounds} from './crust-frame.mjs';
import {createGrainIndex} from './crust-spatial.mjs';
const sub=(a,b)=>a.map((x,i)=>x-b[i]);
const clamp=x=>Math.max(0,Math.min(1,x));
// Convex projected face overlap. These are short liquid bridges between
// opposed faces, not a reconstruction of every corner meniscus in the solid.
function clip(poly,axis,bound,sign){
 const out=[];
 for(let i=0;i<poly.length;i++){
  const a=poly[i],b=poly[(i+1)%poly.length],da=(a[axis]-bound)*sign,db=(b[axis]-bound)*sign;
  if(da>=0)out.push(a);
  if((da>=0)!==(db>=0)){const t=da/(da-db);out.push(a.map((v,j)=>v+t*(b[j]-v)));}
 }
 return out;
}
function footprint(a,fa,b,fb){
 const A=faceFrame(a,fa),B=faceFrame(b,fb);
 if(dot(A.normal,B.normal)>-.5)return null;
 let poly=[[0,0],[1,0],[1,1],[0,1]].map(uv=>faceUV(a,fa,facePoint(b,fb,uv)));
 for(const [axis,bound,sign]of [[0,0,1],[0,1,-1],[1,0,1],[1,1,-1]])poly=clip(poly,axis,bound,sign);
 if(poly.length<3)return null;
 const area=Math.abs(poly.reduce((n,p,i)=>{const q=poly[(i+1)%poly.length];return n+p[0]*q[1]-q[0]*p[1];},0))/2*A.w*A.h;
 if(area<=1e-14)return null;
 const uv=poly.reduce((n,p)=>n.map((v,i)=>v+p[i]/poly.length),[0,0]),point=facePoint(a,fa,uv);
 const distance=dot(sub(B.origin,point),B.normal)/dot(A.normal,B.normal);
 const q=point.map((v,i)=>v+A.normal[i]*distance),portB=faceUV(b,fb,q);
 if(portB.some(v=>v< -1e-7||v>1+1e-7))return null;
 return {portA:uv.map(clamp),portB:portB.map(clamp),area,distance};
}
export function bridgeGeometry(s,e){
 const pa=s.pools[e.a],pb=s.pools[e.b],a=s.grains[pa.grain],b=s.grains[pb.grain];
 const A=faceFrame(a,pa.face),B=faceFrame(b,pb.face),p=facePoint(a,pa.face,e.portA),q=facePoint(b,pb.face,e.portB);
 const gap=Math.min(dot(sub(q,p),A.normal),dot(sub(p,q),B.normal));
 const overlap=footprint(a,pa.face,b,pb.face),width=overlap?Math.sqrt(overlap.area):0,length=Math.max(.016,Math.hypot(...sub(q,p)));
 const closed=!overlap||gap<=1e-8||gap>s.bridgeReach||e.blocked===true;
 const aperture=Math.max(0,gap),capacity=Math.max(1e-12,width*width*aperture);
 return {capacity,area:closed?0:width*length,pressure:closed?0:.035/aperture,aperture,width,length,gap,closed,endpoints:[p,q],points:[p,q],conductance:closed?0:width*aperture**3/(12*length)};
}
function obstructs(g,p,q){
 const a=grainLocal(g,p),b=grainLocal(g,q),f=g.faces,lo=[f[1],f[5],f[3]],hi=[f[0],f[4],f[2]];
 let enter=1e-7,leave=1-1e-7;
 for(let i=0;i<3;i++){const d=b[i]-a[i];if(Math.abs(d)<1e-12){if(a[i]<=lo[i]+1e-9||a[i]>=hi[i]-1e-9)return false;}else{const x=(lo[i]-a[i])/d,y=(hi[i]-a[i])/d;enter=Math.max(enter,Math.min(x,y));leave=Math.min(leave,Math.max(x,y));}}
 return leave>enter;
}
function boundsProxy(id,b,pad=0){return {id,x:(b[0]+b[1])/2,z:(b[4]+b[5])/2,angle:0,faces:[(b[1]-b[0])/2+pad,-(b[1]-b[0])/2-pad,(b[5]-b[4])/2+pad,-(b[5]-b[4])/2-pad,b[3]+pad,b[2]-pad]};}
export function refreshBridges(s){
 const index=createGrainIndex(s.grains),existing=new Map(s.pools.filter(p=>p.kind==='bridge').map(p=>[p.a+':'+p.b,p]));
 for(const a of s.grains)for(const b of index.query(boundsProxy(a.id,frameBounds(a),s.bridgeReach))){
  if(b.id<=a.id||a.parent===b.id||b.parent===a.id)continue;
  for(const ai of a.facePools.filter(id=>id!==null))for(const bi of b.facePools.filter(id=>id!==null)){
   const pa=s.pools[ai],pb=s.pools[bi],overlap=footprint(a,pa.face,b,pb.face);
   if(!overlap||overlap.distance<=1e-8||overlap.distance>s.bridgeReach)continue;
   const key=ai+':'+bi;if(existing.has(key))continue;
   const e={id:s.pools.length,kind:'bridge',a:ai,b:bi,portA:overlap.portA,portB:overlap.portB,water:0,salt:0,residue:0,hazard:0,births:0,threshold:1,owner:ai,connected:false,maxWetFraction:0};
   s.pools.push(e);existing.set(key,e);
  }
 }
 for(const e of existing.values()){
  e.blocked=false;const g=bridgeGeometry(s,e);if(g.closed)continue;
  const [p,q]=g.endpoints,b=[Math.min(p[0],q[0]),Math.max(p[0],q[0]),Math.min(p[1],q[1]),Math.max(p[1],q[1]),Math.min(p[2],q[2]),Math.max(p[2],q[2])];
  // Slight padding avoids zero-width spatial-index cells for axis-aligned links.
  for(const other of index.query(boundsProxy(-1,b,1e-8)))if(other.id!==s.pools[e.a].grain&&other.id!==s.pools[e.b].grain&&obstructs(other,p,q)){e.blocked=true;break;}
 }
}
