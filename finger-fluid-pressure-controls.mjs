const editable = new Set(['pressureRadiusScale', 'beta', 'densityIterations', 'capillaryStrength']);

function positive(value, label) {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${label} must be finite and positive`);
  return value;
}

export function ipbfBetaForRadius({radius, previousRadius, beta, linked}) {
  positive(radius, 'Pressure radius'); positive(previousRadius, 'Previous pressure radius'); positive(beta, 'Damping beta');
  return linked ? beta * previousRadius / radius : beta;
}

export function ipbfPressureReplayURL(url, values, linked) {
  const next=new URL(url);
  for(const [key,value] of Object.entries({
    finger_fluid_pressure_solver:'ipbf',
    finger_fluid_pressure_cockpit:1,finger_fluid_pressure_cockpit_linked:linked?1:0,
    finger_fluid_ipbf_pressure_radius_scale:values.pressureRadiusScale,
    finger_fluid_ipbf_beta:values.beta,finger_fluid_density_iterations:values.densityIterations,
    finger_fluid_capillary_strength:values.capillaryStrength,
  }))next.searchParams.set(key,String(value));
  return next.href;
}

export function createIPBFPressureControlState({baseRadius, ...initial}) {
  positive(baseRadius, 'Base pressure radius');
  function validate(values) {
    for (const key of Object.keys(values)) if (!editable.has(key)) throw new RangeError(`Unsupported live pressure control: ${key}`);
    const pressureRadiusScale=positive(values.pressureRadiusScale, 'Pressure radius scale');
    const beta=positive(values.beta, 'Damping beta');
    const radius=baseRadius*pressureRadiusScale;
    // These are the actual f32 kernel/parameter capacities, not a tuning range.
    if (![radius,beta,8/(Math.PI*radius**3)].every(v=>Number.isFinite(Math.fround(v))&&Math.fround(v)>0)) throw new RangeError('Live pressure kernel cannot be represented in WebGPU f32');
    if (!Number.isSafeInteger(values.densityIterations)||values.densityIterations<1) throw new RangeError('Pressure passes must be a positive safe integer');
    if (!Number.isFinite(values.capillaryStrength)||values.capillaryStrength<0||values.capillaryStrength>2) throw new RangeError('Cohesion must be within the existing [0,2] contract');
    return {...values, radius};
  }
  let requested=validate(initial), effective={...requested};
  let generation=0, effectiveGeneration=0, submittedStep=0;
  const read=()=>({requested:{...requested},effective:{...effective},generation,effectiveGeneration,submittedStep});
  return {
    read,
    request(patch) {
      if(!patch||typeof patch!=='object'||Array.isArray(patch))throw new TypeError('Pressure controls require an object');
      const {radius, ...values}=requested;
      const next=validate({...values,...patch});
      if (Object.keys(next).some(key=>next[key]!==requested[key])) {requested=next;generation+=1;}
      return read();
    },
    submit(step) {
      if (!Number.isSafeInteger(step)||step<submittedStep) throw new RangeError('Control submission step must not regress');
      effective={...requested};effectiveGeneration=generation;submittedStep=step;
      return new Float32Array([effective.radius,effective.beta,0,0]);
    },
  };
}
