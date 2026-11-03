import {ALLOCATION_DEFAULTS,validateAllocation} from './volume-material-hierarchy.mjs';
// Domain coefficients shared by scene/basin persistence and both editors.
export const ADAPTIVE_MATERIAL_FIELDS=[
 ['enabled','material','Adaptive material',false],
 ['budget','budget','Extra material budget',ALLOCATION_DEFAULTS.budget],
 ['spread','spread','Spread',ALLOCATION_DEFAULTS.spread],
 ['maxDetail','max-detail','Maximum detail',ALLOCATION_DEFAULTS.maxDetail],
 ['persistence','persistence','Persistence',ALLOCATION_DEFAULTS.persistence],
 ['lookahead','lookahead','Motion lookahead',ALLOCATION_DEFAULTS.lookahead],
 ...Object.entries(ALLOCATION_DEFAULTS.weights).map(([key,value])=>['weight.'+key,key+'-weight',key[0].toUpperCase()+key.slice(1)+' priority',value]),
].map(([key,suffix,label,value])=>({key,id:'volume-adaptive-'+suffix,param:'volume_adaptive_'+suffix.replaceAll('-','_'),label,value,type:key==='enabled'?'checkbox':'number'}));
export function checkedAdaptiveMaterialSettings(state){
 if(typeof state.enabled!=='boolean')throw Error('Expected adaptive material enabled boolean');
 return {enabled:state.enabled,options:validateAllocation(state.options)};
}
export function readAdaptiveMaterialControls(controls){
 const state={enabled:false,options:{weights:{}}};
 for(const field of ADAPTIVE_MATERIAL_FIELDS){
  const entry=controls[field.id];
  if(!entry)throw Error(`Missing adaptive material control ${field.id}`);
  const value=entry.rawValue??entry.value;
  if(field.key==='enabled')state.enabled=value;
  else if(field.key.startsWith('weight.'))state.options.weights[field.key.slice(7)]=Number(value);
  else state.options[field.key]=Number(value);
 }
 return checkedAdaptiveMaterialSettings(state);
}
export function patchAdaptiveMaterialControls(controls,patch){
 const current=readAdaptiveMaterialControls(controls);
 const next=checkedAdaptiveMaterialSettings({...current,...patch,options:{...current.options,...patch.options,weights:{...current.options.weights,...patch.options?.weights}}});
 const result=structuredClone(controls);
 for(const field of ADAPTIVE_MATERIAL_FIELDS){
  const value=field.key==='enabled'?next.enabled:field.key.startsWith('weight.')?next.options.weights[field.key.slice(7)]:next.options[field.key];
  result[field.id].value=value;
  if(Object.hasOwn(result[field.id],'rawValue'))result[field.id].rawValue=String(value);
 }
 return result;
}
export function hasAuthoredAdaptiveMaterial(receipt){
 const id=ADAPTIVE_MATERIAL_FIELDS[0].id;
 return Object.hasOwn(receipt?.preset?.domControls??{},id)
  &&!receipt?.serverProjection?.defaultsApplied?.includes(id)
  &&!receipt?.retirementMigration?.addedControlIds?.includes(id);
}
