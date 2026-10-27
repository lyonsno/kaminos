// Match the area present on both sides of a cut. Bounds only reject candidates;
// the actual clipped surface polygons determine each cohesive connection.
const sub=(a,b)=>a.map((x,k)=>x-b[k]),dot=(a,b)=>a.reduce((s,x,k)=>s+x*b[k],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit=a=>{const n=Math.hypot(...a);return n?a.map(x=>x/n):null;};
const bounds=points=>({min:[0,1,2].map(k=>Math.min(...points.map(p=>p[k]))),max:[0,1,2].map(k=>Math.max(...points.map(p=>p[k])))});
const overlaps=(a,b)=>[0,1,2].every(k=>a.min[k]<=b.max[k]&&b.min[k]<=a.max[k]);
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
function sharedPolygon(a,b){
 const origin=a[0],e0=sub(a[1],origin),e1=sub(a[2],origin),planeNormal=cross(e0,e1),u=unit(e0),n=unit(planeNormal);if(!u||!n)return null;
 // Bound roundoff in the scalar triple product itself. Absolute world
 // coordinates must not expand the admitted separation of two represented
 // planes; Float32 rounding has already happened in the supplied vertices.
 for(const p of b){
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
 const index=tree(negative.map(t=>({t,box:bounds(t.points)})));
 for(const a of positive){const rows=[];candidates(index,bounds(a.points),rows);
  for(const {t:b}of rows){const shared=sharedPolygon(a.points,b.points);if(!shared)continue;
   const key=a.leaf.index+':'+b.leaf.index;
   if(!pairs.has(key))pairs.set(key,{a:a.leaf.index,b:b.leaf.index,area:0,moment:[0,0,0]});
   const pair=pairs.get(key);pair.area+=shared.area;for(let k=0;k<3;k++)pair.moment[k]+=shared.moment[k];
  }
 }
 return pairs;
}
