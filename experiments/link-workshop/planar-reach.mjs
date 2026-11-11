// Finite construction consumed from Hostile bc62cd8b0 (model.mjs).
import {frames} from './model.mjs';
// Reach an endpoint by constructing feasible triangles from tip to anchor.
// Each prefix can reach an annulus: max(0, 2*longest - sum) .. sum.
// Intersect that annulus with the last link's circle, preferring the old elbow.
// This is finite O(chain length), including straight/fully folded singularities.
export function reachChain(m,id,p,mode){
 const pose=mode==='B'?1:0,f=frames(m,pose),chain=[];let root=id;
 if(p.every((x,k)=>x===f[id].point[k]))return m;
 while(m.nodes[root].parent!==null){chain.push(root);root=m.nodes[root].parent;}chain.reverse();
 const origin=f[root].point,old=[[0,0],...chain.map(i=>f[i].point.map((x,k)=>x-origin[k]))],sums=[0],longest=[0];
 for(const i of chain){sums.push(sums.at(-1)+m.nodes[i].length);longest.push(Math.max(longest.at(-1),m.nodes[i].length));}
 const count=chain.length,total=sums[count],minimum=Math.max(0,2*longest[count]-total),wanted=p.map((x,k)=>x-origin[k]),distance=Math.hypot(...wanted);
 if(!Number.isFinite(total)||!Number.isFinite(distance))throw Error('Chain extent exceeds numeric reach range');
 const radius=Math.max(minimum,Math.min(total,distance)),fallback=old[count],fallbackLength=Math.hypot(...fallback),direction=distance?wanted.map(x=>x/distance):fallbackLength?fallback.map(x=>x/fallbackLength):[1,0];
 const solved=Array(count+1);solved[0]=[0,0];solved[count]=direction.map(x=>x*radius);
 for(let j=count;j>1;j--){
  const end=solved[j],length=m.nodes[chain[j-1]].length,prior=old[j-1],back=prior.map((x,k)=>x-end[k]),backLength=Math.hypot(...back),oldBack=old[j-1].map((x,k)=>x-old[j][k]),oldBackLength=Math.hypot(...oldBack);
  const unit=backLength?back.map(x=>x/backLength):oldBack.map(x=>x/oldBackLength);
  let elbow=end.map((x,k)=>x+unit[k]*length);const r=Math.hypot(...elbow),lo=Math.max(0,2*longest[j-1]-sums[j-1]),hi=sums[j-1];
  if(r<lo||r>hi){
   const prefix=Math.max(lo,Math.min(hi,r)),d=Math.hypot(...end);
   if(d===0)elbow=unit.map(x=>x*length);
   else{
    const u=end.map(x=>x/d),scale=Math.max(prefix,d,length),r=prefix/scale,l=length/scale,dn=d/scale;
    // Normalize before squaring; an underflowed separation is coincident at
    // this circle's representable scale, so retain its old radial direction.
    if(dn===0){solved[j-1]=unit.map(x=>x*length);continue;}
    const xn=(r*r+dn*dn-l*l)/(2*dn),x=xn*scale,h=Math.sqrt(Math.max(0,(r-xn)*(r+xn)))*scale,a=[u[0]*x-u[1]*h,u[1]*x+u[0]*h],b=[u[0]*x+u[1]*h,u[1]*x-u[0]*h];
    elbow=Math.hypot(a[0]-prior[0],a[1]-prior[1])<=Math.hypot(b[0]-prior[0],b[1]-prior[1])?a:b;
   }
  }
  solved[j-1]=elbow;
 }
 let parentAngle=0;
 for(let j=1;j<=count;j++){
  const n=m.nodes[chain[j-1]],world=Math.atan2(solved[j][1]-solved[j-1][1],solved[j][0]-solved[j-1][0]),raw=world-parentAngle,oldAngle=n.angles[pose],delta=Math.atan2(Math.sin(raw-oldAngle),Math.cos(raw-oldAngle));
  if(mode==='build')n.angles=n.angles.map(a=>a+delta);else n.angles[pose]=oldAngle+delta;
  if(!n.angles.every(Number.isFinite))throw Error('Chain exceeds numeric reach range');
  parentAngle=world;
 }
 return m;
}
