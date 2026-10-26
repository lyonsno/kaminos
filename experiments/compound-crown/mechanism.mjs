const TAU=2*Math.PI;
export const CROWN_DEFAULTS=Object.freeze({opening:.45,swirl:0,vaneCount:12,irisCount:10,rate:.12,playing:false});
export const rotate=([x,z],a)=>[x*Math.cos(a)-z*Math.sin(a),x*Math.sin(a)+z*Math.cos(a)];
const add=(a,b)=>a.map((x,i)=>x+b[i]);
export function crownRecipe(input={}){
 const r={...CROWN_DEFAULTS,...input};
 for(const k of ['opening','swirl','rate','vaneCount','irisCount'])if(!Number.isFinite(r[k]))throw Error(k+' must be finite');
 if(r.opening<0||r.opening>1||r.swirl< -1||r.swirl>1)throw Error('opening is 0–1; vane drive is -1–1');
 for(const k of ['vaneCount','irisCount'])if(!Number.isSafeInteger(r[k])||r[k]<3)throw Error(k+' must be an integer of at least three');
 if(r.rate<0)throw Error('rate must be nonnegative');
 if(typeof r.playing!=='boolean')throw Error('playing must be boolean');
 return r;
}
export function leafDefinition(count){
 const a=-1.3*TAU/count;
 return {pivot:[1.05,0],polygon:[[0,0],[-1.05,0],[1.05*Math.cos(a)-1.05,1.05*Math.sin(a)]],follower:[-.22,-.08]};
}
export function irisCamPoint(opening,count){
 const leaf=leafDefinition(count),world=add(leaf.pivot,rotate(leaf.follower,opening*.8));
 return rotate(world,-opening*.3);
}
function segmentDistance(a,b){
 const d=[b[0]-a[0],b[1]-a[1]],t=Math.max(0,Math.min(1,-(a[0]*d[0]+a[1]*d[1])/(d[0]*d[0]+d[1]*d[1])));
 return Math.hypot(a[0]+t*d[0],a[1]+t*d[1]);
}
function triangleClearRadius(p){
 const cross=(a,b)=>a[0]*b[1]-a[1]*b[0];
 const sides=p.map((a,i)=>cross([p[(i+1)%3][0]-a[0],p[(i+1)%3][1]-a[1]],[-a[0],-a[1]]));
 if(sides.every(x=>x>=-1e-12)||sides.every(x=>x<=1e-12))return 0;
 return Math.min(...p.map((a,i)=>segmentDistance(a,p[(i+1)%3])));
}
export function evaluateCrown(input={}){
 const recipe=crownRecipe(input),{opening,swirl,vaneCount,irisCount}=recipe;
 const pivotRadius=1.3,ringRadius=1.65,crankLength=.28,rodLength=.48,ringAngle=.22+.14*swirl;
 const P=[pivotRadius,0],B=rotate([ringRadius,0],ringAngle),delta=[B[0]-P[0],B[1]-P[1]],d=Math.hypot(...delta);
 const cosine=(crankLength**2+d*d-rodLength**2)/(2*crankLength*d);
 if(Math.abs(cosine)>1+1e-10)throw Error('vane linkage cannot close at this drive pose');
 const e=delta.map(x=>x/d),along=crankLength*Math.max(-1,Math.min(1,cosine)),side=crankLength*Math.sqrt(Math.max(0,1-cosine*cosine));
 const A=[P[0]+along*e[0]-side*e[1],P[1]+along*e[1]+side*e[0]],angle=Math.atan2(A[1]-P[1],A[0]-P[0]);
 const vanes=Array.from({length:vaneCount},(_,i)=>{const alpha=i*TAU/vaneCount;return{id:'vane-'+i,alpha,angle:angle+alpha,pivot:rotate(P,alpha),crankEnd:rotate(A,alpha),ringEnd:rotate(B,alpha)};});
 const leaf=leafDefinition(irisCount),leaves=Array.from({length:irisCount},(_,i)=>{
  const alpha=i*TAU/irisCount,localAngle=opening*.8;
  return{id:'iris-leaf-'+i,alpha,angle:alpha+localAngle,pivot:rotate(leaf.pivot,alpha),
   follower:rotate(add(leaf.pivot,rotate(leaf.follower,localAngle)),alpha),
   slotAtDrive:rotate(irisCamPoint(opening,irisCount),alpha+opening*.3),
   polygon:leaf.polygon.map(p=>rotate(add(leaf.pivot,rotate(p,localAngle)),alpha))};
 });
 return{recipe,pivotRadius,ringRadius,crankLength,rodLength,ringAngle,irisRingAngle:opening*.3,vanes,leaves,
  clearRadius:Math.min(...leaves.map(l=>triangleClearRadius(l.polygon))),
  coupling:{aperture:'geometric clear radius; no flame-source law installed',vaneAngle:angle}};
}
