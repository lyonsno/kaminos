// A source's geometric change as seen from one observer. This is a bounding
// sphere estimate, not a retinal image or an occlusion measurement.
const finitePoint=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);
const sub=(a,b)=>a.map((x,i)=>x-b[i]);
function projection(shape,eye){
 const v=sub(shape.center,eye),distance=Math.hypot(...v),angle=Math.atan2(shape.radius,distance);
 return {v,distance,angle,area:2*Math.PI*(1-Math.cos(angle))};
}
export function createVisualDisturbance(){
 let previous=null,peak=0;
 function reset(){previous=null;peak=0;}
 function update({time,eye,visual,active=true,observed=true}){
  if(!Number.isFinite(time)||!finitePoint(eye))throw Error('Visual disturbance requires finite time and observer position');
  if(!observed||!visual||!finitePoint(visual.center)||!Number.isFinite(visual.radius)||visual.radius<0){reset();return null;}
  const shape={center:[...visual.center],radius:active?visual.radius:0},now=projection(shape,eye);
  const before=previous;
  const activationChanged=Boolean(before&&before.active!==active);
  const observedTime=activationChanged?time:(visual.sampleTime??time);
  previous={...shape,time:observedTime,seenAt:time,active,provenance:visual.provenance};
  if(!before||before.provenance!==visual.provenance)return null;
  const dt=observedTime-(activationChanged?before.seenAt:before.time);if(dt<=0){previous={...before,seenAt:time};return null;}
  // Reproject the old source at the CURRENT eye. Observer travel and head
  // rotation therefore cannot impersonate an independently changing source.
  const old=projection(before,eye),denom=old.distance*now.distance;
  const sweep=denom>0?Math.acos(Math.max(-1,Math.min(1,old.v.reduce((n,x,i)=>n+x*now.v[i],0)/denom))):0;
  const areaChange=Math.abs(now.area-old.area),sweptArea=2*Math.min(old.angle,now.angle)*sweep;
  const rate=(areaChange+sweptArea)/dt,strength=1-Math.exp(-rate/1.5);
  if(strength<.08)peak=0;
  const triggered=strength>.15&&strength>peak+.08;
  if(triggered)peak=strength;
  return {kind:'visual-change',provenance:visual.provenance??'unspecified-geometry',angularRadius:now.angle,angularArea:now.area,areaChange,sweep,rate,strength,triggered,dt};
 }
 return {update,reset};
}
