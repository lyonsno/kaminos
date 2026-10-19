import {Euler,Vector3} from './lib/three.core.js';
import {createFingerFluidBoxReference} from './finger-fluid-box-fixtures.mjs';
const clone=value=>structuredClone(value);
const DEFAULT_BOUNDS={min:[-2,-1,-2],max:[2,3,2]};
export function normalizeAuthoredWaterDrop(value={}) {
 const width=value.width??.5,samplesPerUnit=value.samplesPerUnit??48;
 if(!Number.isFinite(width)||width<=0)throw Error('Drop width must be positive and finite');
 if(!Number.isFinite(samplesPerUnit)||samplesPerUnit<=0)throw Error('Drop samples per unit must be positive and finite');
 const n=width*samplesPerUnit;
 if(!Number.isFinite(n)||!Number.isSafeInteger(Math.max(1,Math.round(n))))throw Error('Drop sample count is not representable');
 const container=value.container===null?null:clone(value.container??DEFAULT_BOUNDS);
 const bounds=container??clone(value.worldBounds??DEFAULT_BOUNDS);
 for(const key of ['min','max'])if(!Array.isArray(bounds[key])||bounds[key].length!==3||!bounds[key].every(Number.isFinite))throw Error('Drop world bounds require finite min and max vectors');
 if(bounds.min.some((v,k)=>v>=bounds.max[k]))throw Error('Drop world bounds must have positive extents');
 return {width,samplesPerUnit,container,...(container===null?{worldBounds:bounds}:{})};
}
export function normalizeAuthoredWaterSampling(value){
 if(!value||!Number.isFinite(value.spacing)||value.spacing<=0)throw Error('Water particle spacing must be positive and finite');
 if(value.particleTarget!==undefined&&(!Number.isFinite(value.particleTarget)||value.particleTarget<1||value.particleTarget>Number.MAX_SAFE_INTEGER))throw Error('Water particle target must be a finite count of at least one');
 const checked=normalizeAuthoredWaterDrop({container:value.container===null?null:value.container,worldBounds:value.worldBounds});
 return {spacing:value.spacing,...(value.particleTarget!==undefined?{particleTarget:value.particleTarget}:{}),container:checked.container,...(checked.container===null?{worldBounds:checked.worldBounds}:{})};
}
export function resolveAuthoredWaterSampling(records,setup={}){
 const finite=records.filter(r=>r.localLiquidEmitter?.mode==='finite_drop');
 let sampling;
 if(setup.waterSampling)sampling=normalizeAuthoredWaterSampling(setup.waterSampling);
 else if(finite.length){const d=describeAuthoredWaterDrop(finite[0].localLiquidEmitter.drop,finite[0].transform);sampling=normalizeAuthoredWaterSampling({spacing:d.spacing,container:d.containerEnabled?d.bounds:null,...(!d.containerEnabled?{worldBounds:d.bounds}:{})});}
 else sampling=normalizeAuthoredWaterSampling({spacing:1/48,particleTarget:13824,container:DEFAULT_BOUNDS});
 const volume=finite.reduce((sum,r)=>{
  const drop=normalizeAuthoredWaterDrop(r.localLiquidEmitter.drop),scale=r.transform.scale[0];
  if(!Number.isFinite(scale)||scale<=0||r.transform.scale.some(v=>v!==scale))throw Error('Drop requires positive uniform source scale');
  return sum+(drop.width*scale)**3;
 },0);
 if(!Number.isFinite(volume))throw Error('Requested water volume is not representable');
 // Legacy spacing seeds its equivalent target without changing that resolution.
 // Once saved, spacing is a derived cache; the target and current volume govern.
 if(sampling.particleTarget===undefined)return {...sampling,particleTarget:volume?Math.max(1,volume/sampling.spacing**3):13824};
 return {...sampling,spacing:volume?Math.cbrt(volume/sampling.particleTarget):sampling.spacing};
}
export function describeAuthoredWaterDrop(drop,pose,sampling=null) {
 const settings=normalizeAuthoredWaterDrop(drop),scale=pose.scale[0],width=settings.width*scale;
 if(!Number.isFinite(scale)||scale<=0||pose.scale.some(v=>v!==scale))throw Error('Drop requires positive uniform source scale');
 const shared=sampling?normalizeAuthoredWaterSampling(sampling):null;
 const n=Math.max(1,Math.round(shared?width/shared.spacing:settings.width*settings.samplesPerUnit)),count=n**3;
 if(!Number.isSafeInteger(count)||count*16>0xffffffff)throw Error('Drop population exceeds typed-array capacity');
 const spacing=shared?.spacing??width/n,representedWidth=n*spacing,volume=spacing**3,baseVolume=(64*Math.PI/315)*.185**3/24.3;
 const requestedVolume=width**3,worldVolume=count*volume;
 return {settings,samplesAcross:n,particleCount:count,width,representedWidth,requestedVolume,relativeVolumeError:worldVolume/requestedVolume-1,spacing,particleVolume:volume,worldVolume,particleVolumeScale:volume/baseVolume,supportRadius:.185*Math.cbrt(volume/baseVolume),collisionRadius:.5*spacing,bounds:clone(shared?(shared.container??shared.worldBounds):(settings.container??settings.worldBounds)),containerEnabled:shared?shared.container!==null:settings.container!==null};
}
export function createAuthoredWaterDrop(drop,pose,sampling=null) {
 const d=describeAuthoredWaterDrop(drop,pose,sampling);
 // Owner's lattice and packing; transform both initial and predicted positions.
 const fixture=createFingerFluidBoxReference({resolution:d.samplesAcross,blockWidth:1}),population=fixture.population,data=population.particleData;
 const rotation=new Euler(...pose.rotation),position=new Vector3(),origin=new Vector3(...pose.position);
 for(let i=0;i<d.particleCount;i++){
  const o=i*16;position.set(data[o],data[o+1]-.9,data[o+2]).multiplyScalar(d.representedWidth).applyEuler(rotation).add(origin);
  for(let k=0;k<3;k++)if(d.containerEnabled&&(position.getComponent(k)<d.bounds.min[k]+d.collisionRadius||position.getComponent(k)>d.bounds.max[k]-d.collisionRadius))throw Error('Initial water must fit the enabled container bounds');
  data.set(position.toArray(),o);data.set(position.toArray(),o+4);
 }
 const planes=[];for(let k=0;k<3;k++)for(const side of ['min','max']){const normal=[0,0,0];normal[k]=side==='min'?1:-1;planes.push({normal,offset:normal[k]*d.bounds[side][k]});}
 return {...d,population:{...population,particleVolumeScale:d.particleVolumeScale,worldVolume:d.worldVolume,representedVolume:d.particleCount*d.particleVolumeScale,fixture:'authored_drop',source:'authored_scene_pose_regular_finite_lattice_no_recycling'},box:{schema:'kaminos.fluid-reference-box.v1',bounds:d.bounds,planes,collisionRadius:d.collisionRadius,collisions:d.containerEnabled}};
}


const closeSpacing=(a,b)=>Math.abs(a-b)<=1e-9*Math.max(Math.abs(a),Math.abs(b));
const finiteSources=records=>records.filter(r=>r.localLiquidEmitter?.mode==='finite_drop');
const sourceName=r=>r.label??r.id;
function checkedPlacement(record,description){
 if(!description.containerEnabled)return;
 const {samplesAcross:n,spacing,bounds,collisionRadius}=description;
 const half=(n-1)*spacing/2,rotation=new Euler(...record.transform.rotation),origin=new Vector3(...record.transform.position);
 for(const x of [-half,half])for(const y of [-half,half])for(const z of [-half,half]){
  const p=new Vector3(x,y,z).applyEuler(rotation).add(origin);
  for(let k=0;k<3;k++)if(p.getComponent(k)<bounds.min[k]+collisionRadius-1e-12||p.getComponent(k)>bounds.max[k]-collisionRadius+1e-12)throw Error(`${sourceName(record)}: initial particles must fit the enabled container bounds. Move the drop, enlarge the container, or disable its walls.`);
 }
}
export function inspectAuthoredWaterCompatibility(records,sampling=null){
 const sources=finiteSources(records);
 if(!sources.length)return {compatible:true,sourceCount:0,message:''};
 try{
  const first=describeAuthoredWaterDrop(sources[0].localLiquidEmitter.drop,sources[0].transform,sampling),conflicts=[];
  for(const r of sources){
   const d=describeAuthoredWaterDrop(r.localLiquidEmitter.drop,r.transform,sampling),reasons=[];
   if(!closeSpacing(d.spacing,first.spacing))reasons.push(`particle spacing ${d.spacing.toPrecision(5)} differs from ${sourceName(sources[0])} (${first.spacing.toPrecision(5)})`);
   if(d.containerEnabled!==first.containerEnabled||(d.containerEnabled&&JSON.stringify(d.bounds)!==JSON.stringify(first.bounds)))reasons.push('container bounds or walls differ');
   if(reasons.length)conflicts.push(`${sourceName(r)}: ${reasons.join('; ')}`);
   checkedPlacement(r,d);
  }
  return {compatible:conflicts.length===0,sourceCount:sources.length,spacing:first.spacing,message:conflicts.join('. ')};
 }catch(e){return {compatible:false,sourceCount:sources.length,message:e.message};}
}
export function planAuthoredWaterMatch(records,referenceId){
 const sources=finiteSources(records),reference=sources.find(r=>r.id===referenceId);
 if(!reference)throw Error('Select a finite water drop to use as the shared setup.');
 const d=describeAuthoredWaterDrop(reference.localLiquidEmitter.drop,reference.transform),changes=[];
 checkedPlacement(reference,d);
 for(const r of sources){
  const old=describeAuthoredWaterDrop(r.localLiquidEmitter.drop,r.transform),scale=r.transform.scale[0];
  const n=Math.max(1,Math.round(old.width/d.spacing)),width=n*d.spacing/scale;
  const drop={width,samplesPerUnit:scale/d.spacing,container:d.containerEnabled?clone(d.bounds):null,...(!d.containerEnabled?{worldBounds:clone(d.bounds)}:{})};
  const settings={...clone(r.localLiquidEmitter),drop:normalizeAuthoredWaterDrop(drop)},next=describeAuthoredWaterDrop(settings.drop,r.transform);
  checkedPlacement(r,next);
  // Equivalent floating representations need no mutation, especially the reference.
  if(closeSpacing(old.spacing,d.spacing)&&JSON.stringify(old.bounds)===JSON.stringify(d.bounds)&&old.containerEnabled===d.containerEnabled)continue;
  changes.push({id:r.id,label:sourceName(r),settings,previousWorldWidth:old.width,worldWidth:next.width,previousParticleCount:old.particleCount,particleCount:next.particleCount});
 }
 const count=sources.reduce((sum,r)=>sum+(changes.find(c=>c.id===r.id)?.particleCount??describeAuthoredWaterDrop(r.localLiquidEmitter.drop,r.transform).particleCount),0);
 if(!Number.isSafeInteger(count)||count*16>0xffffffff)throw Error('Combined water population exceeds typed-array capacity');
 return {referenceId,referenceLabel:sourceName(reference),spacing:d.spacing,bounds:clone(d.bounds),containerEnabled:d.containerEnabled,changes,particleCount:count};
}

/** Explicit recovery: expand the physical container around initial water without
 * changing authored poses, resolution, wall mode, or already larger extents. */
export function planAuthoredWaterBounds(records,sampling){
 const checked=normalizeAuthoredWaterSampling(sampling),bounds=clone(checked.container??checked.worldBounds);
 if(checked.container===null)return {changed:false,bounds,sampling:checked};
 for(const r of finiteSources(records)){
  const d=describeAuthoredWaterDrop(r.localLiquidEmitter.drop,r.transform,checked),half=(d.samplesAcross-1)*d.spacing/2,rotation=new Euler(...r.transform.rotation),origin=new Vector3(...r.transform.position);
  for(const x of [-half,half])for(const y of [-half,half])for(const z of [-half,half]){
   const p=new Vector3(x,y,z).applyEuler(rotation).add(origin);
   for(let k=0;k<3;k++){const min=p.getComponent(k)-d.collisionRadius,max=p.getComponent(k)+d.collisionRadius;
    if(min<bounds.min[k])bounds.min[k]=min-d.spacing;
    if(max>bounds.max[k])bounds.max[k]=max+d.spacing;
   }
  }
 }
 const changed=JSON.stringify(bounds)!==JSON.stringify(checked.container??checked.worldBounds);
 return {changed,bounds,sampling:{...checked,...(checked.container===null?{worldBounds:bounds}:{container:bounds})}};
}
