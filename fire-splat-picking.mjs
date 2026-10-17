import {Vector3} from './lib/three.webgpu.js';
import {HEAT_BLOCK_FLOATS} from './proxy-snapshot.mjs';

export const FIRE_SPLAT_STYLE={heatExposure:1,smokeDensity:2,sizeScale:1.15,stretch:1.5};
const smooth=(lo,hi,x)=>{const t=Math.max(0,Math.min(1,(x-lo)/(hi-lo)));return t*t*(3-2*t);};
const falloff=r=>Math.exp(-2.4*r)*(1-smooth(.7,1,r));

// The shader moves a base quad to each world-space block and faces it toward
// the camera. Intersect those same soft ellipses, not the undeformed CPU mesh.
export function pickFireSplats(snapshot,ray,cameraPosition,{fieldGeneration=snapshot?.fieldGeneration,
  near=0,maxDistance=Infinity,minOpacity=.08,style=FIRE_SPLAT_STYLE}={}) {
  if(snapshot?.kind!=='heat-blocks'||snapshot.floatsPerBlock!==HEAT_BLOCK_FLOATS||snapshot.fieldGeneration!==fieldGeneration
    ||!Number.isInteger(snapshot.count)||snapshot.count<0||!snapshot.data||snapshot.data.length<snapshot.count*HEAT_BLOCK_FLOATS)return null;
  const origin=new Vector3().fromArray(ray.origin),direction=new Vector3().fromArray(ray.direction).normalize();
  const eye=new Vector3().fromArray(cameraPosition),centre=new Vector3(),normal=new Vector3(),right=new Vector3(),up=new Vector3(),offset=new Vector3();
  const {smokeDensity,sizeScale,stretch}={...FIRE_SPLAT_STYLE,...style};
  const reference=Math.max(1e-6,snapshot.heatReference??snapshot.summary?.heatMax??1),hits=[];
  for(let i=0;i<snapshot.count;i++) {
    const at=i*HEAT_BLOCK_FLOATS,heat=snapshot.data[at+3],smoke=snapshot.data[at+4],radius=snapshot.data[at+6]*sizeScale;
    centre.fromArray(snapshot.data,at);normal.subVectors(eye,centre).normalize();
    const denominator=direction.dot(normal);
    if(!Number.isFinite(radius)||radius<=0||Math.abs(denominator)<1e-8)continue;
    const distance=offset.subVectors(centre,origin).dot(normal)/denominator;
    if(!Number.isFinite(distance)||distance<near||distance>=maxDistance)continue;
    right.crossVectors(Math.abs(normal.y)>.99?new Vector3(1,0,0):new Vector3(0,1,0),normal).normalize();
    up.crossVectors(normal,right);
    offset.copy(direction).multiplyScalar(distance).add(origin).sub(centre);
    const x=offset.dot(right)/radius,y=offset.dot(up)/(radius*stretch),radial=x*x+y*y;
    if(radial>=1)continue;
    const smokeAlpha=Math.max(0,Math.min(.85,smoke*smokeDensity))*falloff(radial);
    const glowAlpha=.4*smooth(.3,.9,heat/reference)*falloff(radial/(.95*.95));
    const opacity=1-(1-smokeAlpha)*(1-glowAlpha);
    if(opacity>0)hits.push({block:i,distance,opacity});
  }
  hits.sort((a,b)=>a.distance-b.distance);
  let opacity=0;
  for(const hit of hits){
    opacity=1-(1-opacity)*(1-hit.opacity);
    if(opacity>=minOpacity)return {...hit,opacity,point:direction.clone().multiplyScalar(hit.distance).add(origin).toArray(),writeTick:snapshot.writeTick,fieldGeneration};
  }
  return null;
}
