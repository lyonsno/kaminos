// Ring geometry is the admitted analytic descriptor in volume-local metres.
// Other analytic families have no source-wetting claim until their footprint is
// admitted; local cell heat/flame exchange remains available independently.
export function authoredFlameContactGeometry(d) {
  if(!d || d.family!=='ring' || !(d.strength>0))return {mode:2,center:[0,0,0],axis:[0,1,0],radius:0,extent:0,halfDepth:0,shallow:false,authority:'analytic-source-wetting-unavailable'};
  const vector=(v)=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);
  if(d.coordinateSpace!=='volume-local'||!vector(d.origin)||!vector(d.axis)||!Number.isFinite(d.radius)||d.radius<=0||!Number.isFinite(d.extent)||d.extent<=0)throw Error('Invalid analytic ring contact geometry');
  const length=Math.hypot(...d.axis);if(length<=0)throw Error('Invalid analytic ring contact axis');
  const shallow=d.sourceLaw==='shallow-primary';
  if(shallow&&(!Number.isFinite(d.sourceDepth)||d.sourceDepth<=0))throw Error('Invalid analytic ring depth');
  return {mode:1,center:[...d.origin],axis:d.axis.map(v=>v/length),radius:d.radius,extent:d.extent,
    halfDepth:shallow?d.sourceDepth*.5:0,shallow,authority:'authored-analytic-ring-footprint-v1'};
}
export function pointTouchesAuthoredFlame(point,g,waterRadius=0) {
  if(g.mode!==1)return false;
  const delta=point.map((v,i)=>v-g.center[i]);const axial=delta.reduce((n,v,i)=>n+v*g.axis[i],0);
  const radial=Math.sqrt(Math.max(0,delta.reduce((n,v)=>n+v*v,0)-axial*axial));
  return g.shallow?Math.abs(radial-g.extent)<=g.radius+waterRadius&&Math.abs(axial)<=g.halfDepth+waterRadius
    :Math.hypot(radial-g.extent,axial)<=g.radius+waterRadius;
}
