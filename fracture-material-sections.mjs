// Match the area present on both sides of a cut. Bounds only reject candidates;
// the actual clipped surface polygons determine each cohesive connection.
const sub=(a,b)=>a.map((x,k)=>x-b[k]),dot=(a,b)=>a.reduce((s,x,k)=>s+x*b[k],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit=a=>{const n=Math.hypot(...a);return n?a.map(x=>x/n):null;};
const bounds=points=>{
 let min0=Infinity,min1=Infinity,min2=Infinity,max0=-Infinity,max1=-Infinity,max2=-Infinity;
 for(let i=0;i<points.length;i++){
  const p=points[i],x=p[0],y=p[1],z=p[2];
  if(x<min0)min0=x;if(x>max0)max0=x;
  if(y<min1)min1=y;if(y>max1)max1=y;
  if(z<min2)min2=z;if(z>max2)max2=z;
 }
 return{min:[min0,min1,min2],max:[max0,max1,max2]};
};
const overlaps=(a,b)=>a.min[0]<=b.max[0]&&b.min[0]<=a.max[0]&&a.min[1]<=b.max[1]&&b.min[1]<=a.max[1]&&a.min[2]<=b.max[2]&&b.min[2]<=a.max[2];
function tree(rows){
 const box={min:[0,1,2].map(k=>Math.min(...rows.map(r=>r.box.min[k]))),max:[0,1,2].map(k=>Math.max(...rows.map(r=>r.box.max[k])))};
 if(rows.length<=8)return{box,rows};
 const axis=[0,1,2].sort((a,b)=>(box.max[b]-box.min[b])-(box.max[a]-box.min[a]))[0];
 rows.sort((a,b)=>(a.box.min[axis]+a.box.max[axis])-(b.box.min[axis]+b.box.max[axis]));
 const middle=rows.length>>1;return{box,left:tree(rows.slice(0,middle)),right:tree(rows.slice(middle))};
}
function candidates(node,box,out){if(!overlaps(node.box,box))return;if(node.rows){for(const row of node.rows)if(overlaps(row.box,box))out.push(row);}else{candidates(node.left,box,out);candidates(node.right,box,out);}}
const turn=(a,b,p)=>(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);
function intersect(subject,clip){
 const sign=Math.sign(turn(clip[0],clip[1],clip[2]));if(!sign)return[];
 let result=subject;
 for(let edge=0;edge<3&&result.length;edge++){
  const a=clip[edge],b=clip[(edge+1)%3],input=result;result=[];
  for(let i=0;i<input.length;i++){
   const p=input[i],q=input[(i+1)%input.length],dp=sign*turn(a,b,p),dq=sign*turn(a,b,q);
   if(dp>=0)result.push(p);
   if((dp<0&&dq>0)||(dp>0&&dq<0)){const t=dp/(dp-dq);result.push(p.map((x,k)=>x+t*(q[k]-x)));}
  }
 }
 return result;
}
function sharedPolygon(a,b,sourcePlane){
 const frame=sourcePlane?.points??a,origin=frame[0],e0=sub(frame[1],origin),e1=sub(frame[2],origin),planeNormal=cross(e0,e1),u=unit(e0),n=unit(planeNormal);if(!u||!n)return null;
 // Descendants of the same producer-owned cap triangle are projected into
 // its original plane. This restores interpolation roundoff without assigning
 // shared identity to independent surfaces. Otherwise use a strict bound.
 // Bound roundoff in the scalar triple product itself. Absolute world
 // coordinates must not expand the admitted separation of two represented
 // planes; Float32 rounding has already happened in the supplied vertices.
 if(!sourcePlane)for(const p of b){
  const d=sub(p,origin),det=dot(d,planeNormal);
  const permanent=Math.abs(d[0])*(Math.abs(e0[1]*e1[2])+Math.abs(e0[2]*e1[1]))+Math.abs(d[1])*(Math.abs(e0[2]*e1[0])+Math.abs(e0[0]*e1[2]))+Math.abs(d[2])*(Math.abs(e0[0]*e1[1])+Math.abs(e0[1]*e1[0]));
  if(Math.abs(det)>16*Number.EPSILON*permanent)return null;
 }
 const v=cross(n,u),project=p=>{const d=sub(p,origin);return[dot(d,u),dot(d,v)];};
 const polygon=intersect(a.map(project),b.map(project));if(polygon.length<3)return null;
 let area=0,moment=[0,0];
 for(let i=1;i+1<polygon.length;i++){
  const tri=[polygon[0],polygon[i],polygon[i+1]],weight=Math.abs(turn(...tri))/2;area+=weight;
  for(let k=0;k<2;k++)moment[k]+=weight*(tri[0][k]+tri[1][k]+tri[2][k])/3;
 }
 if(!(area>0))return null;
 return{area,moment:origin.map((x,k)=>x*area+u[k]*moment[0]+v[k]*moment[1])};
}
export function matchMaterialSections(positive,negative){
 const pairs=new Map();if(!positive.length||!negative.length)return pairs;
 const addPair=(a,b,sourcePlane)=>{
  const shared=sharedPolygon(a.points,b.points,sourcePlane);if(!shared)return;
  const key=a.leaf.index+':'+b.leaf.index;
  if(!pairs.has(key))pairs.set(key,{a:a.leaf.index,b:b.leaf.index,area:0,moment:[0,0,0]});
  const pair=pairs.get(key);pair.area+=shared.area;for(let k=0;k<3;k++)pair.moment[k]+=shared.moment[k];
 };
 if(positive.every(t=>t.sourcePlane)&&negative.every(t=>t.sourcePlane)){
  const byPlane=new Map();
  for(const b of negative){let list=byPlane.get(b.sourcePlane);if(!list){list=[];byPlane.set(b.sourcePlane,list);}list.push({t:b,box:bounds(b.points)});}
  for(const a of positive){
   const list=byPlane.get(a.sourcePlane);if(!list)continue;
   const boxA=bounds(a.points);
   for(const {t:b,box:boxB}of list)if(overlaps(boxA,boxB))addPair(a,b,a.sourcePlane);
  }
  return pairs;
 }
 const index=tree(negative.map(t=>({t,box:bounds(t.points)})));
 for(const a of positive){const rows=[];candidates(index,bounds(a.points),rows);
  for(const {t:b}of rows){
   if(a.sourcePlane&&b.sourcePlane&&a.sourcePlane!==b.sourcePlane)continue;
   addPair(a,b,a.sourcePlane&&a.sourcePlane===b.sourcePlane?a.sourcePlane:null);
  }
 }
 return pairs;
}
