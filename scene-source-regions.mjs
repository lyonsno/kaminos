// Stable source proposals change ray placement, never the emission field.
import {progressiveSourcePoint,SOURCE_AWARE_BODY_WGSL} from './scene-source-aware.mjs';
import {sceneSourceDomain,validateSceneSourceTransform} from './scene-volume-source.mjs';
import {flameSourceInputs} from './scene-fire-domain.mjs';
import {flameEmitterFrame,flamePoseToDomain} from './scene-flame-emitter.mjs';
const DEFAULT=sceneSourceDomain(),UNIT=sceneSourceDomain([1,1,1]);
export function normalizeSourceRegions(input,domain=DEFAULT){
 if(!Array.isArray(input))throw Error('source regions must be an array');
 const ids=new Set(),result=input.map(g=>{
  if(typeof g?.id!=='string'||!g.id||ids.has(g.id))throw Error('unique source region identity required');ids.add(g.id);
  if(!['lo','hi'].every(k=>Array.isArray(g[k])&&g[k].length===3&&g[k].every(Number.isFinite)))throw Error('finite region bounds required');
  const lo=g.lo.map(Math.fround),hi=g.hi.map(Math.fround);
  if(lo.some((x,a)=>x<Math.fround(domain.lo[a])||hi[a]>Math.fround(domain.hi[a])||hi[a]<=x))throw Error('source region must have positive extent inside the volume');
  return {id:g.id,lo,hi};
 }).sort((a,b)=>a.id.localeCompare(b.id));
 return result.length?result:[{id:'@volume',lo:[...domain.lo],hi:[...domain.hi]}];
}
export function authoredSourceRegions(records,{transform=validateSceneSourceTransform(),domain=DEFAULT,controls={}}={}){
 transform=validateSceneSourceTransform(transform);
 const shared={emitterSourceLaw:'immersed-source',immersedRadius:.2,emitterSourceDepth:.1,plumeHeight:2.2,...controls};
 const sources=flameSourceInputs(records,{controls:shared,translation:transform.translate,scale:transform.scale}),result=[];
 records.forEach((record,i)=>{
  const c=sources[i].controls;if(!c.immersedSourceEnabled)return;
  const frame=flameEmitterFrame(flamePoseToDomain(record.transform,transform.translate,transform.scale));
  const p=frame.origin,axis=frame.direction,radius=2*c.immersedRadius,height=Number(c.plumeHeight),depth=Number(c.emitterSourceDepth??.1);
  if(![radius,height,depth].every(Number.isFinite)||radius<=0||height<=0||depth<0)throw Error('finite positive emitter envelope required');
  const a=p.map((v,k)=>v-axis[k]*depth),b=p.map((v,k)=>v+axis[k]*height),radial=axis.map(v=>radius*Math.sqrt(Math.max(0,1-v*v)));
  const lo=a.map((v,k)=>Math.max(domain.lo[k],Math.min(v,b[k])-radial[k])),hi=a.map((v,k)=>Math.min(domain.hi[k],Math.max(v,b[k])+radial[k]));
  if(lo.every((v,k)=>hi[k]>v))result.push({id:record.id,lo,hi});
 });
 return result.sort((a,b)=>a.id.localeCompare(b.id));
}
export function regionPlan(input,count,domain=DEFAULT){
 if(!Number.isSafeInteger(count)||count<2||count%2)throw Error('even region direction count required');
 const regions=normalizeSourceRegions(input,domain),broad=Math.ceil(count/4),focused=count-broad;
 const counts=[broad,...regions.map((_,i)=>i<focused?1+Math.floor((focused-1-i)/regions.length):0)];
 return {regions,counts};
}
export function regionSample(index,input,rotation=0,domain=DEFAULT){
 const regions=normalizeSourceRegions(input,domain);if(!Number.isSafeInteger(index)||index<0)throw Error('nonnegative region sample index required');
 const slot=index%4,j=Math.floor(index/4)*3+slot-1,component=slot?1+j%regions.length:0,ordinal=slot?Math.floor(j/regions.length):Math.floor(index/4);
 const unit=progressiveSourcePoint(ordinal,rotation,UNIT).map(v=>(v+1)*.5);
 return {unit,component};
}
const hash=value=>{let n=value>>>0;n=Math.imul(n^(n>>>16),2246822519);n=Math.imul(n^(n>>>13),3266489917);return (n^(n>>>16))>>>0;};
export function receiverPhase(p,grid){
 if(!Number.isSafeInteger(grid)||grid<1||!Array.isArray(p)||p.length!==3||!p.every(Number.isFinite))throw Error('valid receiver and grid required');
 const cell=p.map(v=>Math.floor((v+1)*grid/2)),block=cell.map(v=>Math.floor(v/2)),rank=(cell[0]&1)+2*(cell[1]&1)+4*(cell[2]&1);
 const seed=Math.imul(block[0],1597334677)^Math.imul(block[1],3812015801)^Math.imul(block[2],2798796415);
 return [1,3,5].map((stride,a)=>((hash(seed^Math.imul(a+1,1013904223))&0xffffff)/16777216+rank*stride/8)%1);
}
function boxPdf(p,d,lo,hi){
 let near=0,far=Infinity;for(let a=0;a<3;a++){if(d[a]===0){if(p[a]<lo[a]||p[a]>hi[a])return 0;}else{const x=(lo[a]-p[a])/d[a],y=(hi[a]-p[a])/d[a];near=Math.max(near,Math.min(x,y));far=Math.min(far,Math.max(x,y));}}
 if(far<=near)return 0;return (far-near)*(far*far+far*near+near*near)/(3*hi.reduce((v,x,a)=>v*(x-lo[a]),1));
}
export function regionPdf(p,d,input,count,domain=DEFAULT){
 if(![p,d].every(v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite))||Math.abs(Math.hypot(...d)-1)>1e-6)throw Error('finite receiver and unit direction required');
 const {regions,counts}=regionPlan(input,count,domain);
 return (counts[0]*boxPdf(p,d,domain.lo,domain.hi)+regions.reduce((sum,g,i)=>sum+counts[i+1]*boxPdf(p,d,g.lo,g.hi),0))/count;
}
export function regionRaySample(p,index,input,count,{domain=DEFAULT,grid=16,rotation=0}={}){
 const regions=normalizeSourceRegions(input,domain),sample=regionSample(index,regions,rotation,domain),shift=receiverPhase(p,grid),unit=sample.unit.map((v,a)=>(v+shift[a])%1),box=sample.component?regions[sample.component-1]:domain;
 const point=unit.map((v,a)=>box.lo[a]+v*(box.hi[a]-box.lo[a])),v=point.map((v,a)=>v-p[a]),length=Math.hypot(...v),direction=length?v.map(v=>v/length):[0,1,0];
 return {unit,point,direction,pdf:regionPdf(p,direction,regions,count,domain),component:sample.component};
}
export const REGION_SOURCE_WGSL=SOURCE_AWARE_BODY_WGSL.replace('fn sourceDirection(','fn legacySourceDirection(')+`
struct SourceRegion {lo:vec4<f32>,hi:vec4<f32>};
@group(0) @binding(10) var<storage,read> sourceRegions:array<SourceRegion>;
fn regionHash(value:u32)->u32 {var n=value;n=(n^(n>>16u))*2246822519u;n=(n^(n>>13u))*3266489917u;return n^(n>>16u);}
fn regionReceiverPhase(p:vec3<f32>)->vec3<f32>{
 let cell=vec3<i32>(floor((p+vec3<f32>(1))*f32(VOLUME_GRID)*0.5));let block=vec3<i32>(floor(vec3<f32>(cell)*0.5));
 let rank=(u32(cell.x)&1u)+2u*(u32(cell.y)&1u)+4u*(u32(cell.z)&1u);
 let seed=(u32(block.x)*1597334677u)^(u32(block.y)*3812015801u)^(u32(block.z)*2798796415u);
 let base=vec3<f32>(f32(regionHash(seed^1013904223u)&0xffffffu),f32(regionHash(seed^(2u*1013904223u))&0xffffffu),f32(regionHash(seed^(3u*1013904223u))&0xffffffu))/16777216.0;
 return fract(base+f32(rank)*vec3<f32>(1,3,5)/8.0);
}
fn sourceDirection(p:vec3<f32>,a:u32)->vec3<f32>{
 let sample=directions[a];let component=bitcast<u32>(sample.w)-0x40000000u;let unit=fract(sample.xyz+regionReceiverPhase(p));var lo=vec3<f32>(-1);var hi=vec3<f32>(1.0,-1.0+2.0*f32(VOLUME_HEIGHT)/f32(VOLUME_GRID),1.0);
 if(component>0u){lo=sourceRegions[component-1u].lo.xyz;hi=sourceRegions[component-1u].hi.xyz;}
 let v=lo+unit*(hi-lo)-p;if(dot(v,v)==0.0){return vec3<f32>(0,1,0);}return normalize(v);
}
fn sourcePdf(p:vec3<f32>,d:vec3<f32>)->f32{
 let broad=ceil(settings.w/4.0);var pdf=broad*uniformSourcePdf(p,d);let focused=u32(settings.w-broad);let count=arrayLength(&sourceRegions);
 for(var i=0u;i<count;i++){if(i>=focused){continue;}let samples=1u+(focused-1u-i)/count;let box=sourceRegions[i];let span=interval(p,d,box.lo.xyz,box.hi.xyz,1e30);
  if(span.y>span.x){let extent=box.hi.xyz-box.lo.xyz;pdf+=f32(samples)*(span.y-span.x)*(span.y*span.y+span.y*span.x+span.x*span.x)/(3.0*extent.x*extent.y*extent.z);}}
 return pdf/settings.w;
}
`;
