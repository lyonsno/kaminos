export function resolveSourceFootprint(value={}) {
  const next={mode:'legacy',level:4,detailBias:3.15,allFields:false,...value};
  if(!['legacy','fixed','distance'].includes(next.mode))throw Error('Unknown source footprint policy');
  if(!Number.isSafeInteger(next.level)||next.level<0)throw Error('Source mip level must be a nonnegative integer');
  if(!Number.isFinite(next.detailBias))throw Error('Source detail bias must be finite');
  if(typeof next.allFields!=='boolean')throw Error('Source field selection must be boolean');
  return Object.fromEntries(['mode','level','detailBias','allFields'].map(key=>[key,next[key]]));
}

// A disposable owner override; ordinary estimator settings remain authoritative
// after release, including changes made while the experiment was mounted.
export function createSourceFootprintControl(effect,reset) {
  let owner=null,value=resolveSourceFootprint(),ordinaryMipSampling=false;
  const apply=()=>{
    effect.sourceMipMode.value=['legacy','fixed','distance'].indexOf(value.mode);
    effect.sourceMipLevel.value=value.level;effect.sourceMipDetailBias.value=value.detailBias;
    effect.sourceMipAllFields.value=value.allFields;
    effect.useMipSampling.value=owner!==null||ordinaryMipSampling;
  };
  return {
    ordinary(value){ordinaryMipSampling=value;apply();},
    open(){
      if(owner!==null)throw Error('A source footprint comparison is already open');
      const token={};owner=token;apply();reset('source-footprint-open');
      const current=()=>{if(owner!==token)throw Error('Source footprint comparison is closed');};
      return {
        read(){current();return {...value,optimizations:effect.getOptimizationState()};},
        set(patch){current();const next=resolveSourceFootprint({...value,...patch});value=next;apply();reset('source-footprint-policy');return this.read();},
        dispose(){if(owner!==token)return;owner=null;value=resolveSourceFootprint();apply();reset('source-footprint-close');}
      };
    }
  };
}
