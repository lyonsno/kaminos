/** Opt-in diagnosis of the assembled solver; never selected by ordinary routes. */
export function resolveFingerFluidDiagnosticDynamics(profile='assembled') {
  if(!['assembled','pressure_surface'].includes(profile))throw new RangeError('Unknown diagnostic dynamics profile: '+profile);
  return profile;
}
export function applyFingerFluidDiagnosticDynamics(source,profile='assembled') {
  resolveFingerFluidDiagnosticDynamics(profile);
  if(profile==='assembled')return source;
  const start=source.indexOf('  var neighborVelocity = vec3<f32>(0.0);');
  const end=source.indexOf('  let radius = params.fluid.x * 0.22;',start);
  if(start<0||end<0||!source.slice(start,end).includes('velocity = mix(velocity, neighborVelocity'))throw new Error('Reduced dynamics smoothing anchor missing');
  if(!source.includes('if (relaxedSpeed > solverMaximumSpeed)'))throw new Error('Reduced dynamics speed anchor missing');
  return (source.slice(0,start)+'  // Diagnostic core: paper velocity, with support response retained below.\n  restStates[index].z = 0.0;\n'+source.slice(end))
    .replaceAll('if (relaxedSpeed > solverMaximumSpeed)','if (false && relaxedSpeed > solverMaximumSpeed)')
    .replaceAll('if (speed > solverMaximumSpeed)','if (false && speed > solverMaximumSpeed)');
}
export function validateFingerFluidDiagnosticPopulation(p,count=p?.particleCount) {
  if(p?.schema!=='kaminos.fluid-discriminator-population.v1')throw new TypeError('Diagnostic population schema mismatch');
  if(!Number.isSafeInteger(count)||count<1||p.particleCount!==count)throw new RangeError('Diagnostic population count mismatch');
  if(!(p.particleData instanceof Float32Array)||p.particleData.length!==count*16)throw new RangeError('Diagnostic population length mismatch');
  if(!p.particleData.every(Number.isFinite))throw new RangeError('Diagnostic population must be finite');
  if(!Number.isFinite(p.particleVolumeScale)||p.particleVolumeScale<=0)throw new RangeError('Diagnostic population volume must be positive');
  for(let i=0;i<count;i++)if(p.particleData[16*i+11]<.15)throw new RangeError('Finite diagnostic population must disable source recycling');
  return p;
}
export function subdivideDiagnosticPopulation(base,refinement=1) {
  validateFingerFluidDiagnosticPopulation(base);
  if(![1,2].includes(refinement))throw new RangeError('This discriminator defines coarse and twofold spatial refinement');
  if(refinement===1)return base;
  const volume=(64*Math.PI/315)*.185**3/24.3*base.particleVolumeScale;
  const offset=Math.cbrt(volume)/4,data=new Float32Array(base.particleCount*8*16);
  for(let i=0;i<base.particleCount;i++)for(let j=0;j<8;j++){
    const o=(i*8+j)*16;data.set(base.particleData.subarray(i*16,i*16+16),o);
    for(let k=0;k<3;k++){const d=((j>>k)&1)?offset:-offset;data[o+k]+=d;data[o+4+k]+=d;}
  }
  return {...base,particleData:data,particleCount:base.particleCount*8,particleVolumeScale:base.particleVolumeScale/8,refinement};
}
