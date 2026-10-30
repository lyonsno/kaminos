// World coefficients of the existing linear pressure and viscous stress laws.
// These do not include transfer damping, boundary effects, or surface tension.
export function normalizeMlsMaterial(value) {
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('MLS material requires pressure wave speed and kinematic viscosity');
  for(const key of ['pressureWaveSpeed','kinematicViscosity'])
    if(!Number.isFinite(value[key])||value[key]<0)throw Error(`MLS material ${key} must be finite and nonnegative`);
  return {pressureWaveSpeed:value.pressureWaveSpeed,kinematicViscosity:value.kinematicViscosity};
}
export function resolveMlsMaterial({cell,modelSecondsPerSecond,restDensity=3,viscosity,mlsMaterial}) {
  const speedUnit=cell*modelSecondsPerSecond,diffusionUnit=cell*cell*modelSecondsPerSecond;
  if(mlsMaterial!=null&&viscosity!==undefined)throw Error('Ambiguous MLS material: choose world material or legacy grid viscosity');
  const requested=mlsMaterial==null?null:normalizeMlsMaterial(mlsMaterial);
  const stiffness=requested?restDensity*(requested.pressureWaveSpeed/speedUnit)**2:50;
  const dynamicViscosity=requested?restDensity*requested.kinematicViscosity/diffusionUnit:(viscosity??.1);
  if(!Number.isFinite(dynamicViscosity)||dynamicViscosity<0)throw Error('Invalid MLS viscosity');
  if(requested&&((requested.pressureWaveSpeed>0&&stiffness===0)||(requested.kinematicViscosity>0&&dynamicViscosity===0)))throw Error('MLS material coefficient is outside GPU f32 capacity at this resolution');
  for(const coefficient of [stiffness,dynamicViscosity])
    if(!Number.isFinite(Math.fround(coefficient))||(coefficient>0&&Math.fround(coefficient)===0))throw Error('MLS material coefficient is outside GPU f32 capacity at this resolution');
  return {stiffness,viscosity:dynamicViscosity,materialUnits:{
    parameterization:requested?'world':'legacy_grid',
    pressureWaveSpeed:Math.sqrt(stiffness/restDensity)*speedUnit,
    kinematicViscosity:dynamicViscosity/restDensity*diffusionUnit,
    lengthUnit:'metre',timeUnit:'second',authority:'constitutive_coefficients_not_measured_effective_response',
  }};
}
