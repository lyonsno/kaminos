// Shared retained grain frame for solver, contacts, collision and presentation.
export const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
export const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export function grainBasis(g){const c=Math.cos(g.angle),s=Math.sin(g.angle);return g.basis??[[c,0,s],[0,1,0],[-s,0,c]];}
export function grainPoint(g,p){const axes=grainBasis(g),o=g.origin??[g.x,0,g.z];return o.map((v,i)=>v+axes.reduce((n,a,j)=>n+a[i]*p[j],0));}
export function grainLocal(g,p){const o=g.origin??[g.x,0,g.z],d=p.map((v,i)=>v-o[i]);return grainBasis(g).map(a=>dot(a,d));}
export const localCenter=g=>[(g.faces[0]+g.faces[1])/2,(g.faces[4]+g.faces[5])/2,(g.faces[2]+g.faces[3])/2];
export const frameCenter=g=>grainPoint(g,localCenter(g));
export const halfSize=g=>[(g.faces[0]-g.faces[1])/2,(g.faces[4]-g.faces[5])/2,(g.faces[2]-g.faces[3])/2];
export function frameBounds(g){const c=frameCenter(g),h=halfSize(g),axes=grainBasis(g);return c.flatMap((v,i)=>{const r=axes.reduce((n,a,j)=>n+Math.abs(a[i])*h[j],0);return [v-r-1e-10,v+r+1e-10];});}
export function frameOverlap(a,b){const aa=grainBasis(a),bb=grainBasis(b),ca=frameCenter(a),cb=frameCenter(b),delta=cb.map((v,i)=>v-ca[i]),ha=halfSize(a),hb=halfSize(b);
 for(const axis of [...aa,...bb,...aa.flatMap(x=>bb.map(y=>cross(x,y)))]){const length=Math.hypot(...axis);if(length<1e-10)continue;const n=axis.map(v=>v/length),ra=aa.reduce((v,x,i)=>v+Math.abs(dot(n,x))*ha[i],0),rb=bb.reduce((v,x,i)=>v+Math.abs(dot(n,x))*hb[i],0);if(Math.abs(dot(delta,n))>=ra+rb-1e-10)return false;}return true;
}
export function seedBasis(yaw,tilt){const c=Math.cos(yaw),s=Math.sin(yaw),ct=Math.cos(tilt),st=Math.sin(tilt);return [[c,0,s],[-s*st,ct,c*st],[-s*ct,-st,c*ct]];}
