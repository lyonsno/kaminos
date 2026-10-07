import {SOURCE_LO,SOURCE_HI,SOURCE_VOLUME,progressiveSourcePoint,SOURCE_AWARE_BODY_WGSL} from './scene-source-aware.mjs';

export function normalizeSourceGuide(guide){
  if(!guide||!['lo','hi'].every(k=>Array.isArray(guide[k])&&guide[k].length===3&&guide[k].every(Number.isFinite)))throw new Error('finite source-guide bounds required');
  const lo=guide.lo.map(Math.fround),hi=guide.hi.map(Math.fround);
  if(lo.some((x,a)=>x<SOURCE_LO[a]||hi[a]>SOURCE_HI[a]||hi[a]<=x))throw new Error('source guide must have positive extent inside the full volume');
  return {lo,hi,effective:guide.effective||'emitter-envelope',reason:guide.reason||null};
}
export function deriveSourceGuide({position,radius,height,depth},transform={translate:[0,0,0],scale:1}){
  if(!Array.isArray(position)||position.length!==3||!position.every(Number.isFinite)||![radius,height,depth,transform.scale].every(Number.isFinite)||radius<=0||height<=0||depth<0||transform.scale<=0||!Array.isArray(transform.translate)||transform.translate.length!==3||!transform.translate.every(Number.isFinite))throw new Error('finite authored emitter and source frame required');
  const p=position.map((x,a)=>(x-transform.translate[a])/transform.scale);
  // Inlet dimensions are already volume-local controls. The radial envelope is
  // a proposal heuristic, not an emission/support cut: full-volume rays remain.
  const lower=[p[0]-2*radius,p[1]-depth,p[2]-2*radius],upper=[p[0]+2*radius,p[1]+height,p[2]+2*radius];
  const lo=lower.map((x,a)=>Math.max(SOURCE_LO[a],x)),hi=upper.map((x,a)=>Math.min(SOURCE_HI[a],x));
  if(lo.some((x,a)=>hi[a]<=x))return normalizeSourceGuide({lo:SOURCE_LO,hi:SOURCE_HI,effective:'full-volume',reason:'emitter-envelope-outside-volume'});
  return normalizeSourceGuide({lo,hi});
}
export function sourceGuideFraction(count){
  if(!Number.isSafeInteger(count)||count<2||count%2)throw new Error('even source-guide direction count required');
  return (count-Math.ceil(count/4))/count;
}
export function sourceGuidePoint(index,guide,rotation=0){
  normalizeSourceGuide(guide);
  if(!Number.isSafeInteger(index)||index<0)throw new Error('nonnegative source-guide index required');
  const component=index%4,ordinal=component?Math.floor(index/4)*3+component-1:Math.floor(index/4);
  const point=progressiveSourcePoint(ordinal,rotation);
  if(!component)return point;
  return point.map((x,a)=>guide.lo[a]+(guide.hi[a]-guide.lo[a])*(x-SOURCE_LO[a])/(SOURCE_HI[a]-SOURCE_LO[a]));
}
function boxPdf(p,d,lo,hi){
  let near=0,far=Infinity;
  for(let a=0;a<3;a++){
    if(d[a]===0){if(p[a]<lo[a]||p[a]>hi[a])return 0;}
    else {const x=(lo[a]-p[a])/d[a],y=(hi[a]-p[a])/d[a];near=Math.max(near,Math.min(x,y));far=Math.min(far,Math.max(x,y));}
  }
  if(far<=near)return 0;
  const volume=hi.reduce((v,x,a)=>v*(x-lo[a]),1);
  return (far-near)*(far*far+far*near+near*near)/(3*volume);
}
export function sourceGuidePdf(p,d,guide,count){
  normalizeSourceGuide(guide);
  if(![p,d].every(v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite))||Math.abs(Math.hypot(...d)-1)>1e-6)throw new Error('finite receiver and unit direction required');
  const fraction=sourceGuideFraction(count);
  // Probability integrates every point that can select this direction, before
  // solid clipping. A selected-point density is not the whole-chord density.
  return (1-fraction)*boxPdf(p,d,SOURCE_LO,SOURCE_HI)+fraction*boxPdf(p,d,guide.lo,guide.hi);
}
export function sourceGuideRaySample(p,index,guide,count,rotation=0){
  const point=sourceGuidePoint(index,guide,rotation),v=point.map((x,a)=>x-p[a]),length=Math.hypot(...v),direction=length?v.map(x=>x/length):[0,1,0];
  return {point,direction,pdf:sourceGuidePdf(p,direction,guide,count)};
}
export const SOURCE_GUIDE_WGSL=SOURCE_AWARE_BODY_WGSL+`
struct SourceGuide {lo:vec4<f32>,hi:vec4<f32>};
@group(0) @binding(10) var<uniform> sourceGuide:SourceGuide;
fn sourcePdf(p:vec3<f32>,d:vec3<f32>)->f32 {
  let span=interval(p,d,sourceGuide.lo.xyz,sourceGuide.hi.xyz,1e30);
  var focused=0.0;
  if(span.y>span.x){let extent=sourceGuide.hi.xyz-sourceGuide.lo.xyz;
    focused=(span.y-span.x)*(span.y*span.y+span.y*span.x+span.x*span.x)/(3.0*extent.x*extent.y*extent.z);}
  let fraction=(settings.w-ceil(settings.w/4.0))/settings.w;
  return (1.0-fraction)*uniformSourcePdf(p,d)+fraction*focused;
}
`;
