// The live-uniform requested/effective pattern follows the existing IPBF
// pressure cockpit. These are PBF material controls, not pressure-radius edits.
export const PBF_REPULSION_COEFFICIENT = -0.0012;
export const MATERIAL_QUERY_KEYS = Object.freeze({
  particleRepulsionStrength:'finger_fluid_repulsion_strength',
  densityIterations:'finger_fluid_density_iterations',
  capillaryStrength:'finger_fluid_capillary_strength',
  freeFlightViscosityBoost:'finger_fluid_free_flight_viscosity_boost',
});

export function validateMaterialControls(values) {
  for(const key of Object.keys(values)) if(!Object.hasOwn(MATERIAL_QUERY_KEYS,key)) throw new RangeError(`Unsupported material control: ${key}`);
  const {particleRepulsionStrength,densityIterations,capillaryStrength,freeFlightViscosityBoost}=values;
  const coefficient=Math.fround(PBF_REPULSION_COEFFICIENT*particleRepulsionStrength);
  if(!Number.isFinite(particleRepulsionStrength)||particleRepulsionStrength<0||!Number.isFinite(coefficient)||(particleRepulsionStrength>0&&coefficient===0))throw new RangeError('Particle repulsion strength must be nonnegative and representable in WebGPU f32');
  if(!Number.isSafeInteger(densityIterations)||densityIterations<1)throw new RangeError('Density passes must be a positive safe integer');
  if(!Number.isFinite(capillaryStrength)||capillaryStrength<0||capillaryStrength>2)throw new RangeError('Cohesion must follow the existing [0,2] solver contract');
  if(!Number.isFinite(freeFlightViscosityBoost)||freeFlightViscosityBoost<0||freeFlightViscosityBoost>0.3)throw new RangeError('Free-flight viscosity must follow the existing [0,0.3] solver contract');
  return {particleRepulsionStrength,densityIterations,capillaryStrength,freeFlightViscosityBoost};
}

export function readMaterialControlsURL(url, defaults) {
  const params=new URL(url).searchParams, values={...defaults};
  if(params.has('finger_fluid_artificial_pressure')&&!params.has(MATERIAL_QUERY_KEYS.particleRepulsionStrength)){
    const mode=params.get('finger_fluid_artificial_pressure');
    if(!['off','standard'].includes(mode))throw new RangeError('Unknown legacy artificial pressure mode');
    values.particleRepulsionStrength=mode==='off'?0:1;
  }
  for(const [key,query] of Object.entries(MATERIAL_QUERY_KEYS)) if(params.has(query)) {
    if(!params.get(query).trim())throw new RangeError(`Empty material control: ${key}`);
    values[key]=Number(params.get(query));
  }
  return validateMaterialControls(values);
}

export function materialControlsURL(url, values) {
  const next=new URL(url);validateMaterialControls(values);
  next.searchParams.delete('finger_fluid_artificial_pressure');
  for(const [key,query] of Object.entries(MATERIAL_QUERY_KEYS))next.searchParams.set(query,String(values[key]));
  return next.href;
}

export function createMaterialControlState(initial) {
  let requested=validateMaterialControls(initial), effective=null;
  let generation=0,effectiveGeneration=null,submittedStep=null;
  const read=()=>({requested:{...requested},effective:effective?{...effective}:null,generation,effectiveGeneration,submittedStep});
  return {read,
    request(patch){
      if(!patch||typeof patch!=='object'||Array.isArray(patch))throw new TypeError('Material controls require an object');
      const next=validateMaterialControls({...requested,...patch});
      if(Object.keys(next).some(key=>next[key]!==requested[key])){requested=next;generation++;}
      return read();
    },
    submit(step){
      if(!Number.isSafeInteger(step)||step<0||(submittedStep!==null&&step<submittedStep))throw new RangeError('Material submission step must not regress');
      effective={...requested};effectiveGeneration=generation;submittedStep=step;return read();
    },
  };
}

export function decodeMaterialInputs(words) {
  if(!Array.isArray(words)||words.length!==56||!words.every(v=>Number.isInteger(v)&&v>=0&&v<=0xffffffff))throw new Error('Material GPU inputs require all 224 raw bytes');
  const data=new Uint32Array(words),view=new DataView(data.buffer);
  const result={particleCount:view.getUint32(4,true),frameIndex:view.getUint32(8,true),repulsionCoefficient:view.getFloat32(200,true),capillaryStrength:view.getFloat32(116,true),freeFlightViscosityBoost:view.getFloat32(124,true)};
  if(!Object.values(result).every(Number.isFinite))throw new Error('Nonfinite material GPU input');
  return result;
}
