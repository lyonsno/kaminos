export const DEFAULT_SHADOW_QUALITY=Object.freeze({resolution:256,blockerSamples:9,filterSamples:16});
export function positiveSampleCount(value,name='sample count'){
  if(!Number.isSafeInteger(value)||value<=0)throw Error(`${name} must be a positive integer`);
  return value;
}
export function validateShadowQuality(value,{maxTextureDimension2D=Infinity}={}){
  for(const [key,count] of Object.entries(value)){
    if(!Object.hasOwn(DEFAULT_SHADOW_QUALITY,key))throw Error(`unknown shadow quality: ${key}`);
    positiveSampleCount(count,key);
  }
  if(value.resolution>maxTextureDimension2D)throw Error('shadow resolution exceeds device texture dimension');
  return {...value};
}
// The live shader uses signed 32-bit loop counters, not expanded JS arrays.
export function validateRuntimeShadowQuality(value,limits){
  const result=validateShadowQuality(value,limits);
  for(const key of ['blockerSamples','filterSamples'])if(result[key]>0x7fffffff)throw Error(`${key} exceeds signed GPU loop counter capacity`);
  return result;
}
// Integer factorization preserves equal-area polar strata at every budget.
// Sixteen retains the original four radial bands by four angular sectors.
export function shadowStrata(count){
  positiveSampleCount(count);
  let bands=Math.floor(Math.sqrt(count));
  while(count%bands)bands--;
  return {bands,sectors:count/bands};
}
