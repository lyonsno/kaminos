export const REFLECTION_BUDGET_MODES=Object.freeze(['full','single','adaptive']);

export function resolveReflectionBudget({mode='full',fresnelCutoff=.04}={}) {
  if(!REFLECTION_BUDGET_MODES.includes(mode))throw new RangeError(`Unknown reflection budget: ${mode}`);
  if(typeof fresnelCutoff!=='number'||!Number.isFinite(fresnelCutoff)||fresnelCutoff<0||fresnelCutoff>1)throw new RangeError('Reflection Fresnel cutoff must be between 0 and 1');
  return {mode,fresnelCutoff};
}
export function reflectionSceneRayCount(fresnel,policy,fullCount=5) {
  const {mode,fresnelCutoff}=resolveReflectionBudget(policy);
  if(!Number.isFinite(fresnel)||fresnel<0||fresnel>1)throw new RangeError('Fresnel weight must be between 0 and 1');
  if(![5,9].includes(fullCount))throw new RangeError('Full reflection footprint uses five or nine samples');
  return mode==='single'?1:mode==='adaptive'&&fresnel<=fresnelCutoff?0:fullCount;
}
export function createReflectionComparison({apply,candidate={mode:'adaptive',fresnelCutoff:.04}}={}) {
  if(typeof apply!=='function')throw new TypeError('Reflection comparison needs its consumer apply operation');
  let selected='A',b=resolveReflectionBudget(candidate),effective=null;
  function select(side) {
    if(!['A','B'].includes(side))throw new RangeError('Choose A or B');
    const policy=side==='A'?resolveReflectionBudget({mode:'full',fresnelCutoff:b.fresnelCutoff}):b;
    const receipt=apply({...policy});selected=side;effective=receipt;return read();
  }
  function configureB(patch) {
    const next=resolveReflectionBudget({...b,...patch});
    if(selected==='B'){const receipt=apply({...next});b=next;effective=receipt;}else b=next;
    return read();
  }
  function read(){return {selected,candidate:{...b},effective:structuredClone(effective)};}
  function reset(){selected='A';effective=null;return read();}
  return {select,configureB,read,reset};
}
