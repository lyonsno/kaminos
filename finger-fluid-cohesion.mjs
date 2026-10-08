/** Experimental authoring profile beside IPBF; not a term from the IPBF paper. */
export function resolveFingerFluidCohesionModel({pressureSolver='ipbf',cohesionModel='legacy'}={}) {
  if(!['legacy','ipbf_free_surface'].includes(cohesionModel))throw new RangeError(`Unknown cohesion model: ${cohesionModel}`);
  if(cohesionModel==='ipbf_free_surface'&&pressureSolver!=='ipbf')throw new RangeError('Recovered cohesion requires IPBF pressure');
  return cohesionModel;
}
export function resolveFingerFluidCohesionStrength(value,cohesionModel='legacy',gravity=9.2) {
  resolveFingerFluidCohesionModel({cohesionModel});
  if(!Number.isFinite(value)||value<0)throw new RangeError('Cohesion strength must be finite and nonnegative');
  if(cohesionModel==='legacy'&&value>2)throw new RangeError('Legacy cohesion must be within [0, 2]');
  if(cohesionModel==='ipbf_free_surface'&&(!Number.isFinite(Math.fround(value))||!Number.isFinite(Math.fround(Math.fround(value)*Math.fround(gravity)))))throw new RangeError('Cohesion force cannot be represented in WebGPU f32');
  return value;
}
const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
export function evaluateFingerFluidCohesionPairWeight({q,surfaceFactor,neighborSurface,densityRatio,neighborDensityRatio,cohesionModel='legacy'}) {
  resolveFingerFluidCohesionModel({cohesionModel});
  if(![q,surfaceFactor,neighborSurface,densityRatio,neighborDensityRatio].every(Number.isFinite)||q<0)throw new RangeError('Cohesion pair inputs must be finite with nonnegative distance');
  const surface=Math.max(0,Math.min(1,(surfaceFactor+neighborSurface)/2));
  const confidence=cohesionModel==='legacy'?smooth(.48,.90,Math.min(densityRatio,neighborDensityRatio)):1;
  return smooth(.28,.58,q)*(1-smooth(.82,1,q))*(.15+.85*surface)*confidence;
}
export function evaluateFingerFluidCohesionAcceleration({weightedDirection,totalWeight,strength,activity=1,gravity=9.2,cohesionModel='legacy'}) {
  resolveFingerFluidCohesionModel({cohesionModel});
  if(!Array.isArray(weightedDirection)||weightedDirection.length!==3||!weightedDirection.every(Number.isFinite)
    ||![totalWeight,strength,activity,gravity].every(Number.isFinite)||totalWeight<0||activity<0||activity>1||gravity<0)throw new RangeError('Cohesion acceleration inputs are invalid');
  resolveFingerFluidCohesionStrength(strength,cohesionModel,gravity);
  if(cohesionModel==='ipbf_free_surface')return totalWeight>0?weightedDirection.map(x=>x/Math.max(1,totalWeight)*gravity*strength*activity):[0,0,0];
  const raw=weightedDirection.map(x=>x*.12*strength*activity),length=Math.hypot(...raw);
  return length>.42?raw.map(x=>x*.42/length):raw;
}
/** Change only the existing cohesion body. Legacy shader bytes remain intact. */
export function applyFingerFluidCohesionProfile(source,{pressureSolver='ipbf',cohesionModel='legacy'}={}) {
  const model=resolveFingerFluidCohesionModel({pressureSolver,cohesionModel});
  if(model==='legacy')return source;
  const replacements=[
    ['let pairSupportConfidence = smoothstep(0.48, 0.90, min(densityRatio, neighborDensityRatio));','let pairSupportConfidence = 1.0; // Sparse-water attraction stays active.'],
    ['var attraction = vec3<f32>(0.0);','var attraction = vec3<f32>(0.0);\n  var attractionWeight = 0.0;'],
    ['attraction = attraction + (offset / distance) * weight;','attraction = attraction + (offset / distance) * weight;\n              attractionWeight = attractionWeight + weight;'],
    ['var cohesionAcceleration = attraction * (0.12 * params.chemistry.y) * cohesionActivity;\n  let cohesionLength = length(cohesionAcceleration);\n  if (cohesionLength > 0.42) { cohesionAcceleration = cohesionAcceleration * (0.42 / cohesionLength); }',
     'var cohesionAcceleration = vec3<f32>(0.0);\n  if (attractionWeight > 0.0) {\n    cohesionAcceleration = (attraction / max(1.0, attractionWeight)) * (abs(params.forces.x) * params.chemistry.y * cohesionActivity);\n  }'],
  ];
  let result=source;
  for(const [from,to] of replacements){
    if(result.split(from).length!==2)throw new Error('Recovered cohesion shader anchor missing or ambiguous');
    result=result.replace(from,to);
  }
  return result;
}
