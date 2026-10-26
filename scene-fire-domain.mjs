import {checkedRectangularAperture} from './volume-rectangular-aperture.mjs';
// Authored fire records. The single-domain engine consumes these through an
// adapter; its buffers, bricks and evolving gas are not document identity.
import {validatePresetSchema} from './volume-settings-preset-contract.mjs';
import {transferRetiredForceSwitches} from './volume-retired-control-migration.mjs';
import {checkedPose} from './scene-edit-session.mjs';
import {normalizeFlameDomainTranslation,normalizeFlameDomainScale,flamePoseToDomain,flamePoseInDomain,immersedControlsForFlamePose,flameEmitterFrame,normalizeFlameEmitterPose,FLAME_EMITTER_TYPE,FLAME_EMITTER_SOURCE} from './scene-flame-emitter.mjs';
export const FIRE_DOMAIN_ID='flame-field';
export const FIRE_DOMAIN_TYPE='simulation-domain';
export const FIRE_DOMAIN_SOURCE='kaminos:fire-domain';
const clone=value=>structuredClone(value);
const sourceIds=new Set(['emitter-assay-family','volume-input-radius','volume-flow-rate','volume-fixed-source-dephase']);
const materialIds=new Set(['volume-exposure','volume-density','volume-fire','volume-radiance','volume-absorption','volume-glow','volume-smoke','volume-fire-scale','volume-detail-scale','volume-microdetail','volume-interface-shred','volume-fire-licks']);
const sceneIds=new Set(['volume-steps','volume-adaptive-rays','volume-occupancy-skip','volume-render-scale',
 'volume-grid-overlay','volume-flow-debug','volume-pyro-compare','volume-shell-inspect-mode',
 'volume-reaction-live-view','volume-boundary-sidecar-view','volume-pyro-carrier-view','volume-pressure-tier-overlay']);
export function fireControlOwner(id){
 if(sceneIds.has(id)||id.startsWith('volume-residual-'))return 'scene';
 if(sourceIds.has(id)||id.startsWith('volume-immersed-')||id.startsWith('volume-emitter-'))return 'source';
 if(materialIds.has(id)||/^volume-(physical-|reaction-|boundary-|shell-|pyro-)/.test(id)&&!['volume-pyro-detail','volume-pyro-compare'].includes(id))return 'material';
 return 'domain';
}
function controls(value,name){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error(`Missing fire ${name}`);
 for(const [id,entry] of Object.entries(value))if(!entry||typeof entry!=='object'||!Object.hasOwn(entry,'value'))throw Error(`Invalid fire ${name} control ${id}`);
 return clone(value);
}
export function fireRenderingSettings(settings){
 return {domControls:Object.fromEntries(Object.entries(controls(settings.domControls,'settings')).filter(([id])=>fireControlOwner(id)==='scene')),
 rendererControls:controls(settings.rendererControls,'renderer settings'),presentationControls:controls(settings.presentationControls,'presentation settings')};
}
export function createFireDomainRecord({settings,translation=[0,0,0],scale=1,followSource=true,label='Fire & smoke',collision=false}){
 const buckets={source:{},domain:{},material:{},scene:{}};
 for(const [id,value] of Object.entries(controls(settings.domControls,'settings')))buckets[fireControlOwner(id)][id]=value;
 const t=normalizeFlameDomainTranslation(translation),s=normalizeFlameDomainScale(scale);
 return checkedFireDomainRecord({id:FIRE_DOMAIN_ID,type:FIRE_DOMAIN_TYPE,source:FIRE_DOMAIN_SOURCE,label,fileName:'Fire simulation',
 transform:{position:[t[0],t[1]+s,t[2]],rotation:[0,0,0],scale:[s,s,s]},
 simulation:{kind:'fire',followSource,collision,settings:buckets.domain,sourceTemplate:buckets.source},
 volumeMaterial:{kind:'fire-volume',settings:buckets.material}});
}
export function checkedFireDomainRecord(record){
 if(record?.id!==FIRE_DOMAIN_ID||record?.type!==FIRE_DOMAIN_TYPE||record?.source!==FIRE_DOMAIN_SOURCE)throw Error('Unsupported fire domain identity');
 const r=clone(record),pose=checkedPose(r.transform),s=normalizeFlameDomainScale(pose.scale[0]);
 if(pose.scale.some(v=>v!==s)||pose.rotation.some(v=>v!==0))throw Error('Fire domain requires world-aligned uniform scale');
 if(r.simulation?.kind!=='fire'||typeof r.simulation.followSource!=='boolean'||typeof r.simulation.collision!=='boolean')throw Error('Invalid fire domain simulation');
 if(r.volumeMaterial?.kind!=='fire-volume')throw Error('Invalid fire volume material');
 r.simulation.settings=controls(r.simulation.settings,'domain settings');
 r.simulation.sourceTemplate=controls(r.simulation.sourceTemplate,'source template');
 r.volumeMaterial.settings=controls(r.volumeMaterial.settings,'material settings');
 for(const [owner,values] of [['domain',r.simulation.settings],['source',r.simulation.sourceTemplate],['material',r.volumeMaterial.settings]])for(const id of Object.keys(values))if(fireControlOwner(id)!==owner)throw Error(`Fire control ${id} conflicts with its ${owner} owner`);
 r.transform=pose;return r;
}
export function fireDomainFrame(record){const r=checkedFireDomainRecord(record),s=r.transform.scale[0];return {translation:[r.transform.position[0],r.transform.position[1]-s,r.transform.position[2]],scale:s,followSource:r.simulation.followSource};}
// Source-owned descriptors retain the cockpit schema; only this adapter maps
// them to solver control names. Pose is authoritative for centre/aim/scale.
export function flameSourceInputs(records,{controls:shared={},translation=[0,0,0],scale=1,visible=()=>true}={}){
 const ids=new Set();
 return records.map(raw=>{
  const record=checkedFireSourceRecord(raw);if(ids.has(record.id))throw Error('Duplicate flame source identity');ids.add(record.id);
  const controls={...shared};
  for(const [id,descriptor] of Object.entries(record.emission?.settings??{})){
   const param=descriptor.param??(id==='emitter-assay-family'?'volume_emitter_family':id.replaceAll('-','_'));
   if(typeof param!=='string'||fireControlOwner(param.replaceAll('_','-'))!=='source')throw Error(`Fire source parameter ${id} conflicts with source owner`);
   const key=param.replace(/^volume_/,'').replace(/_([a-z])/g,(_,letter)=>letter.toUpperCase());
   const value=descriptor.rawValue??descriptor.value;
   const numeric=descriptor.type==='range'||descriptor.type==='number';
   controls[key]=descriptor.type==='checkbox'||typeof descriptor.value==='boolean' ? value===true||value==='true'||value==='1':descriptor.type==='select-one'||!numeric&&typeof descriptor.value==='string'&&!Number.isFinite(Number(value))?String(value):Number(value);
   if(typeof controls[key]==='number'&&!Number.isFinite(controls[key]))throw Error(`Fire source value ${id} must be finite`);
  }
  const pose=flamePoseToDomain(record.transform,translation,scale);
  if(record.emission?.aperture){const aperture=checkedRectangularAperture(record.emission.aperture),axis=flameEmitterFrame(pose).supportAxis;
   controls.emitterApertureHalfLength=aperture.halfLength;controls.emitterApertureHalfWidth=aperture.halfWidth;
   for(let i=0;i<3;i++)controls['emitterApertureAxis'+'XYZ'[i]]=axis[i];
  }
  const inside=flamePoseInDomain(record.transform,translation,scale,shared);
  const mapped=immersedControlsForFlamePose(controls,pose,inside&&record.emissionEnabled!==false&&visible(record.id),shared);
  // Keep the physical supply area when a circular burner port is smaller than
  // the solver's minimum footprint. Feed velocity stays the authored velocity.
  if(record.emission?.burnerPort&&!record.emission.aperture){const radius=Number(controls.immersedRadius??.2)*pose.scale[0];mapped.emitterFluxAreaFraction=Math.min(1,(Math.max(0,radius)/mapped.immersedRadius)**2);}
  return {id:record.id,controls:mapped};
 });
}
export function checkedFireSourceRecord(record){
 if(record?.type!==FLAME_EMITTER_TYPE||record.source!==FLAME_EMITTER_SOURCE||typeof record.id!=='string'||!record.id.trim()||record.id===FIRE_DOMAIN_ID)throw Error('Unsupported flame source identity');
 if(record.emissionEnabled!==undefined&&typeof record.emissionEnabled!=='boolean')throw Error('Flame emission enabled must be a boolean');
 const result={...clone(record),transform:normalizeFlameEmitterPose(record.transform),emissionEnabled:record.emissionEnabled!==false};
 if(record.emission!==undefined){
  if(record.emission?.domainId!==FIRE_DOMAIN_ID)throw Error('Invalid fire source domain reference');
  if(record.emission.aperture)checkedRectangularAperture(record.emission.aperture);
  if(record.emission.burnerPort){const b=record.emission.burnerPort,count=b.designId==='crown-ring'?12:b.designId==='seam-rail'?1:0;if(!Number.isInteger(b.index)||b.index<0||b.index>=count||b.bodyId!==undefined&&(typeof b.bodyId!=='string'||!b.bodyId))throw Error('Invalid burner outlet binding');}
  const settings=controls(record.emission.settings,'source settings');
  for(const id of Object.keys(settings))if(fireControlOwner(id)!=='source')throw Error(`Fire control ${id} conflicts with source owner`);
  result.emission={...clone(record.emission),domainId:FIRE_DOMAIN_ID,settings};
 }
 return result;
}
export function authorFireObjects(objects,settings,frame){
 const domain=createFireDomainRecord({...frame,settings});
 const result=objects.filter(o=>o.type!==FIRE_DOMAIN_TYPE).map(o=>o.type==='flame-emitter'?checkedFireSourceRecord({...o,emission:o.emission??{domainId:domain.id,settings:clone(domain.simulation.sourceTemplate)}}):clone(o));
 // A template is retained only when the source is absent, so a source record is
 // the sole owner of active supply data. Re-add explicitly consumes the template.
 if(result.some(o=>o.type==='flame-emitter'))domain.simulation.sourceTemplate={};
 result.push(domain);return result;
}
export function readFireObjects(objects,renderSettings){
 const domains=objects.filter(o=>o.type===FIRE_DOMAIN_TYPE);
 if(domains.length!==1)throw Error('Current runtime requires one fire domain');
 const domain=checkedFireDomainRecord(domains[0]);
 const sources=objects.filter(o=>o.type==='flame-emitter');
 const ids=new Set();for(const source of sources){checkedFireSourceRecord(source);if(ids.has(source.id))throw Error('Duplicate flame source identity');ids.add(source.id);}
 if(sources.some(o=>o.emission?.domainId!==domain.id))throw Error('Invalid fire source domain reference');
 const primary=sources.find(o=>o.id==='flame-emitter')??sources[0];
 const supply=primary?controls(primary.emission.settings,'source settings'):domain.simulation.sourceTemplate;
 if(sources.length&&Object.keys(domain.simulation.sourceTemplate).length)throw Error('Active source has conflicting template authority');
 for(const id of Object.keys(supply))if(fireControlOwner(id)!=='source')throw Error(`Fire control ${id} conflicts with source owner`);
 const rendering=controls(renderSettings?.domControls??{},'scene rendering settings');
 for(const id of Object.keys(rendering))if(fireControlOwner(id)!=='scene')throw Error(`Fire control ${id} conflicts with scene rendering owner`);
 return {domain,sources:clone(sources),frame:fireDomainFrame(domain),settings:{domControls:{...rendering,...clone(domain.simulation.settings),...clone(domain.volumeMaterial.settings),...clone(supply)},rendererControls:controls(renderSettings?.rendererControls,'renderer settings'),presentationControls:controls(renderSettings?.presentationControls,'presentation settings')}};
}

// A saved fire record owns every existing value. Schema growth may only add
// declared defaults introduced after that record's complete control inventory.
export function projectFireSettingsToSchema(settings,rawSchema){
 const schema=validatePresetSchema(rawSchema),result=clone(settings);
 const saved=controls(result.domControls,'settings'),count=Object.keys(saved).length;
 const inventory=new Set(schema.controls.map(entry=>entry.key));
 // A retired control is stripped from the record but still counts toward the inventory size its additive history is numbered by.
 const retired=new Set((schema.retiredControls||[]).filter(entry=>entry.axis==='domControls').map(entry=>entry.key));
 const retiredSwitches={};for(const id of Object.keys(saved))if(retired.has(id)){retiredSwitches[id]=saved[id]?.value;delete saved[id];}
 for(const id of Object.keys(saved))if(!inventory.has(id))throw Error(`Unsupported authored fire control ${id}`);
 // A record that still carries a control introduced later cannot be missing one introduced earlier: a hole, not history.
 const latestPresent=Math.max(0,...schema.controls.filter(entry=>Number.isSafeInteger(entry.additiveSinceControlCount)&&Object.hasOwn(saved,entry.key)).map(entry=>entry.additiveSinceControlCount));
 for(const entry of schema.controls){
  if(Object.hasOwn(saved,entry.key))continue;
  if(!Object.hasOwn(entry,'additiveDefault')||!Number.isSafeInteger(entry.additiveSinceControlCount)||entry.additiveSinceControlCount<=count||entry.additiveSinceControlCount<latestPresent)throw Error(`Missing authored fire control ${entry.key}`);
  saved[entry.key]={id:entry.key,param:entry.param,tagName:entry.tagName,type:entry.type,value:clone(entry.additiveDefault)};
 }
 transferRetiredForceSwitches(retiredSwitches,saved);
 result.domControls=saved;
 for(const [axis,entries]of [['rendererControls',schema.rendererControls||[]],['presentationControls',schema.presentationControls||[]]]){
  const values=controls(result[axis],axis),known=new Set(entries.map(entry=>entry.key));
  for(const id of Object.keys(values))if(!known.has(id))throw Error(`Unsupported authored fire control ${id}`);
  for(const entry of entries)if(!Object.hasOwn(values,entry.key)){
   if(!Object.hasOwn(entry,'additiveDefault'))throw Error(`Missing authored fire control ${entry.key}`);
   values[entry.key]={id:entry.key,param:entry.param,tagName:entry.tagName,type:entry.type,value:clone(entry.additiveDefault)};
  }
  result[axis]=values;
 }
 return result;
}
