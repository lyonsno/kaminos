import {FLAME_PROPERTY_GROUPS} from './flame-authoring.mjs';

export const CUE_TUNE_GROUPS = FLAME_PROPERTY_GROUPS.filter(group=>group.name!=='Simulation');
const blendable = new Set(CUE_TUNE_GROUPS.flatMap(group=>group.fields.map(([id])=>id)));
export const CUE_CONTINUOUS_FIELDS = blendable;
export const KILN_FLOW_RANGE = Object.freeze({min:0,max:4});
export function captureCueControlRanges(document) {
  const ranges={};
  for(const id of CUE_CONTINUOUS_FIELDS) {
    const control=document.getElementById(id);
    if(control?.type==='range')ranges[id]={min:control.min,max:control.max,step:control.step};
  }
  return ranges;
}

export function restoreCueControlRanges(document,ranges) {
  for(const [id,range] of Object.entries(ranges || {})) {
    const control=document.getElementById(id);
    if(control)for(const key of ['min','max','step'])control[key]=range[key];
  }
}
export const CUE_DOMAIN_FIELDS = ['volume-resolution','volume-pressure-solver','volume-pressure-solver-iterations',
  'volume-advection-scheme','volume-confinement','volume-time-step','volume-common-gas-transport'];

export function cueTuneValuesEqual(left,right) {
  for(const axis of ['domControls','rendererControls','presentationControls']) {
    const a=left[axis]||{},b=right[axis]||{};
    if(Object.keys(a).length!==Object.keys(b).length)return false;
    for(const [id,control] of Object.entries(a)) {
      if(!Object.hasOwn(b,id))return false;
      const x=control.rawValue??control.value,y=b[id].rawValue??b[id].value;
      if(x===y)continue;
      const numeric=value=>(typeof value==='number'||(typeof value==='string'&&value.trim()!==''))&&Number.isFinite(Number(value));
      if(!numeric(x)||!numeric(y))return false;
      if(Math.abs(Number(x)-Number(y))>Number.EPSILON*8*Math.max(1,Math.abs(Number(x)),Math.abs(Number(y))))return false;
    }
  }
  return true;
}

export function normalizeCueTune(state) {
  if (!state || typeof state!=='object') throw Error('Flame tune required');
  for (const axis of ['domControls','rendererControls','presentationControls']) {
    const controls=state[axis];
    if (!controls || typeof controls!=='object' || Array.isArray(controls)) throw Error(`Incomplete flame tune ${axis}`);
    for(const [id,control] of Object.entries(controls)) {
      if (!control || !['string','number','boolean'].includes(typeof control.value)
        || (typeof control.value==='number' && !Number.isFinite(control.value))) throw Error(`Invalid flame tune ${id}`);
    }
  }
  return structuredClone(state);
}

export function setCueTuneValue(state,id,value) {
  const next=structuredClone(state);
  const control=next.domControls[id] || next.rendererControls[id] || next.presentationControls[id];
  if(!control)throw Error(`Unknown flame tune control ${id}`);
  control.value=value;
  if(Object.hasOwn(control,'rawValue'))control.rawValue=String(value);
  return next;
}

export function tuneForCue(key,baseline) {
  let state=normalizeCueTune(key.tune || baseline);
  for(const [id,value] of [['volume-input-radius',key.radius],['volume-flow-rate',key.flow]]) {
    if(state.domControls[id])state=setCueTuneValue(state,id,value);
  }
  return state;
}

export function checkCueDomain(tune,baseline) {
  for(const id of CUE_DOMAIN_FIELDS) {
    const a=tune.domControls[id],b=baseline.domControls[id];
    if(a && b && String(a.rawValue??a.value)!==String(b.rawValue??b.value)) {
      throw Error(`${id.replace(/^volume-/,'')} belongs to the scene simulation; keep it unchanged between cues`);
    }
  }
  if(tune.domControls['emitter-assay-family']?.value==='cluster')throw Error('Cluster is not a placeable cue source');
  return tune;
}

export function blendCueTunes(a,b,t) {
  const next=normalizeCueTune(t>=1?b:a);
  if(t<=0 || t>=1)return next;
  for(const axis of ['domControls','rendererControls'])for(const [id,control] of Object.entries(next[axis])) {
    if(!blendable.has(id))continue;
    const left=a[axis]?.[id],right=b[axis]?.[id];
    if(!left || !right || typeof left.value==='boolean' || typeof right.value==='boolean')continue;
    const x=Number(left.rawValue??left.value),y=Number(right.rawValue??right.value);
    if(!Number.isFinite(x)||!Number.isFinite(y)||String(left.value).startsWith('#'))continue;
    const value=x+(y-x)*t;
    control.value=typeof left.value==='string'?String(value):value;
    if(Object.hasOwn(control,'rawValue'))control.rawValue=String(value);
  }
  return next;
}
