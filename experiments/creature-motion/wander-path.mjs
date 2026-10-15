const finitePair = value => Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);
const pair = value => [...value];
const mix = (a,b,t=.5) => a.map((v,i)=>v+(b[i]-v)*t);
const length = vector => Math.hypot(...vector);
const minus = (a,b) => a.map((v,i)=>v-b[i]);
const copy = value => structuredClone(value);
function validateArea(area) {
 if(!finitePair(area?.center)||!finitePair(area?.radii)||area.radii.some(v=>v<=0)||!Number.isFinite(area.yaw))throw Error('Wander area requires finite center, positive radii and yaw');
 return copy(area);
}
function normalized(direction) {
 if(!finitePair(direction)||!(length(direction)>0))throw Error('Wander direction must be finite and nonzero');
 const d=length(direction);return direction.map(v=>v/d);
}
function localPoint(point,area) {
 const [x,z]=minus(point,area.center),c=Math.cos(area.yaw),s=Math.sin(area.yaw);
 return [(c*x+s*z)/area.radii[0],(-s*x+c*z)/area.radii[1]];
}
function inside(point,area) {return length(localPoint(point,area))<=1+1e-12;}

// Adaptive geometric flattening gives an arc-distance lookup; it does not
// discard source motion samples or cap travelled distance/route segments.
function curveTable(points,area) {
 const table=[{t:0,d:0}];let distance=0;
 const scale=Math.max(...points.flat().map(Math.abs),...area.radii,1);
 const tolerance=Math.max(Math.min(...area.radii)*1e-5,Number.EPSILON*scale*64);
 function flatten(a,b,c,from,to,error) {
  const chord=length(minus(c,a)),polygon=length(minus(b,a))+length(minus(c,b));
  if(polygon-chord<=error) {distance+=chord;table.push({t:to,d:distance});return;}
  const ab=mix(a,b),bc=mix(b,c),mid=mix(ab,bc),t=(from+to)/2;
  flatten(a,ab,mid,from,t,error/2);flatten(mid,bc,c,t,to,error/2);
 }
 flatten(...points,0,1,tolerance);
 if(!(distance>0)||!Number.isFinite(distance))throw Error('Wander curve is collapsed or not representable');
 return {table,length:distance};
}
export function createWanderPath({area,position,direction,seed=1,snapshot}={}) {
 let rng,points,offset=0,total=0,entry=false,segments=0,lookup,fallback;
 if(snapshot!==undefined) {
  if(snapshot?.schema!=='kaminos.creature-wander-path.v1'||!Number.isInteger(snapshot.rng)||snapshot.rng<0||snapshot.rng>0xffffffff||!Array.isArray(snapshot.points)||snapshot.points.length!==3||!snapshot.points.every(finitePair)||!Number.isFinite(snapshot.offset)||snapshot.offset<0||!Number.isFinite(snapshot.distance)||snapshot.distance<0||typeof snapshot.entry!=='boolean'||!Number.isSafeInteger(snapshot.segments)||snapshot.segments<0)throw Error('Invalid wander snapshot or random state');
  area=validateArea(snapshot.area);rng=snapshot.rng;points=copy(snapshot.points);offset=snapshot.offset;total=snapshot.distance;entry=snapshot.entry;segments=snapshot.segments;fallback=normalized(snapshot.direction);
  lookup=curveTable(points,area);if(offset>lookup.length)throw Error('Wander snapshot distance exceeds current curve');
 } else {
  area=validateArea(area);if(!finitePair(position))throw Error('Wander position must be finite');
  fallback=normalized(direction);if(!Number.isInteger(seed)||seed<0||seed>0xffffffff)throw Error('Wander random seed must be an unsigned integer');rng=seed;
  initialize(position,fallback);
 }
 function random() {
  rng=(rng+0x6d2b79f5)>>>0;let t=rng;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;
 }
 function choosePoint() {
  const radius=Math.sqrt(random()),angle=random()*2*Math.PI;
  const x=radius*Math.cos(angle)*area.radii[0],z=radius*Math.sin(angle)*area.radii[1],c=Math.cos(area.yaw),s=Math.sin(area.yaw);
  return [area.center[0]+c*x-s*z,area.center[1]+s*x+c*z];
 }
 function initialize(start,heading) {
  let handle=Math.min(...area.radii)*.5;entry=!inside(start,area);
  if(!entry) {
   const p=localPoint(start,area),end=localPoint(start.map((v,i)=>v+heading[i]),area),d=minus(end,p);
   const a=d[0]**2+d[1]**2,b=2*(p[0]*d[0]+p[1]*d[1]),c=p[0]**2+p[1]**2-1;
   const room=Math.max(0,(-b+Math.sqrt(Math.max(0,b*b-4*a*c)))/(2*a));handle=Math.min(handle,room/2);
  }
  const control=start.map((v,i)=>v+heading[i]*handle),next=choosePoint();
  points=[pair(start),control,entry?next:mix(control,next)];offset=0;lookup=curveTable(points,area);fallback=pair(heading);
 }
 function sample() {
  const table=lookup.table;let lo=0,hi=table.length-1;
  while(hi-lo>1){const mid=(lo+hi)>>1;if(table[mid].d<=offset)lo=mid;else hi=mid;}
  const a=table[lo],b=table[hi],span=b.d-a.d,t=span>0?a.t+(b.t-a.t)*(offset-a.d)/span:a.t;
  const [p0,p1,p2]=points,u=1-t;
  const position=p0.map((v,i)=>u*u*v+2*u*t*p1[i]+t*t*p2[i]);
  const tangent=p0.map((v,i)=>2*u*(p1[i]-v)+2*t*(p2[i]-p1[i]));
  const direction=length(tangent)>0?normalized(tangent):pair(fallback);
  return {position,direction};
 }
 function nextCurve() {
  const end=sample();segments++;
  if(entry){initialize(points[2],end.direction);return;}
  // Adjacent midpoint quadratics share both their endpoint and tangent.
  const control=points[2].map((v,i)=>2*v-points[1][i]);
  points=[pair(points[2]),control,mix(control,choosePoint())];offset=0;fallback=end.direction;lookup=curveTable(points,area);
 }
 function read() {
  const state=sample();return {...state,area:copy(area),target:pair(points[2]),distance:total,segments,status:inside(state.position,area)?'wandering':'returning-to-area'};
 }
 function advance(distance) {
  if(!Number.isFinite(distance)||distance<0)throw Error('Wander distance must be finite and nonnegative');
  let remaining=distance;
  while(remaining>0) {
   const available=lookup.length-offset;
   if(remaining<available){offset+=remaining;remaining=0;}
   else {remaining-=available;offset=lookup.length;nextCurve();}
  }
  total+=distance;return read();
 }
 function setArea(value) {
  const next=validateArea(value),current=sample();area=next;initialize(current.position,current.direction);return read();
 }
 function save() {return {schema:'kaminos.creature-wander-path.v1',area:copy(area),points:copy(points),offset,distance:total,rng,entry,segments,direction:sample().direction};}
 return Object.freeze({read,advance,setArea,snapshot:save});
}
