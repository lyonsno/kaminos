export const DEFAULT_EFFECTS = Object.freeze({
  glowIntensity:1, glowThreshold:.05, emissionReflection:0,
  bloom:true, bloomIntensity:.5, bloomRadius:.4, bloomThreshold:.2, exposure:1,
});

export function validateEffects(value) {
  const result={};
  for(const [key,defaultValue] of Object.entries(DEFAULT_EFFECTS)) {
    const next=value[key];
    if(typeof defaultValue==='boolean') {
      if(typeof next!=='boolean')throw Error(`Invalid effect ${key}`);
    } else if(!Number.isFinite(next)||next<0||
      (['bloomRadius','emissionReflection'].includes(key)&&next>1))throw Error(`Invalid effect ${key}`);
    result[key]=next;
  }
  return result;
}
