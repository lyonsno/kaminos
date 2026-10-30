// Geometry for the explicit reduced face-film experiment. Coordinates are
// normalized to each retained face; no material texture or shape noise.
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export function faceFrame(g,face){
 const f=g.faces,c=Math.cos(g.angle),s=Math.sin(g.angle),x=[c,0,s],z=[-s,0,c],y=[0,1,0],world=(a,b,h)=>[g.x+c*a-s*b,h,g.z+s*a+c*b];
 if(face<2)return {origin:world(f[face],f[3],f[5]),u:z,v:y,w:f[2]-f[3],h:f[4]-f[5],normal:x.map(a=>a*(face===0?1:-1))};
 if(face<4)return {origin:world(f[1],f[face],f[5]),u:x,v:y,w:f[0]-f[1],h:f[4]-f[5],normal:z.map(a=>a*(face===2?1:-1))};
 return {origin:world(f[1],f[3],f[face]),u:x,v:z,w:f[0]-f[1],h:f[2]-f[3],normal:y.map(v=>v*(face===4?1:-1))};
}
export function facePoint(g,face,uv,offset=0){const f=faceFrame(g,face);return f.origin.map((a,i)=>a+f.u[i]*uv[0]*f.w+f.v[i]*uv[1]*f.h+f.normal[i]*offset);}
export function faceUV(g,face,point){const f=faceFrame(g,face),d=point.map((a,i)=>a-f.origin[i]);return [d.reduce((n,a,i)=>n+a*f.u[i],0)/f.w,d.reduce((n,a,i)=>n+a*f.v[i],0)/f.h];}
export function facePatch(s,p){
 const f=faceFrame(s.grains[p.grain],p.face),fraction=clamp(p.water/(f.w*f.h*.016),0,1),extent=Math.sqrt(fraction),anchor=p.entry??[.5,0];
 const lo=anchor.map(a=>clamp(a-extent/2,0,1-extent));return {fraction,lo,hi:lo.map(a=>a+extent),area:f.w*f.h*fraction};
}
export function patchContains(s,p,uv,extent=[0,0]){const r=facePatch(s,p);return p.water>0&&uv.every((v,i)=>v+extent[i]>=r.lo[i]-1e-9&&v-extent[i]<=r.hi[i]+1e-9);}
export function edgePorts(g,a,b){
 const ca=facePoint(g,a,[.5,.5]),cb=facePoint(g,b,[.5,.5]),point=ca.map((v,i)=>(v+cb[i])/2),f=g.faces;
 // Intersection of the two orthogonal planes, midpoint along their shared edge.
 const c=Math.cos(g.angle),sn=Math.sin(g.angle),local=[c*(point[0]-g.x)+sn*(point[2]-g.z),point[1],-sn*(point[0]-g.x)+c*(point[2]-g.z)];
 for(const face of [a,b])local[face<2?0:face<4?2:1]=f[face];
 const at=[g.x+c*local[0]-sn*local[2],local[1],g.z+sn*local[0]+c*local[2]];
 return [faceUV(g,a,at),faceUV(g,b,at)].map(uv=>uv.map(v=>clamp(v,0,1)));
}
