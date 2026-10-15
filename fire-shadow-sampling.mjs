export function validateShadowSampling(value) {
  if(!['fixed','complementary'].includes(value))throw Error('shadow sampling must be fixed or complementary');
  return value;
}

// Equal-area polar strata. Every pixel samples all 16 broad strata; a 4x4
// pixel neighborhood fills their 16 complementary sub-strata. Permutations
// break radial/spoke alignment without changing support or quadrature weight.
export function complementaryDiskSample(index,phaseX,phaseY) {
  if(!Number.isInteger(index)||index<0||index>=16)throw Error('valid stratum required');
  if(![phaseX,phaseY].every(v=>Number.isInteger(v)&&v>=0&&v<4))throw Error('valid pixel phase required');
  const band=Math.floor(index/4),sector=index%4;
  const area=(band+(((phaseY+sector*3+band)%4)+.5)/4)/4;
  const angle=2*Math.PI*(sector+(((phaseX+band*3+sector)%4)+.5)/4)/4;
  return [Math.sqrt(area)*Math.cos(angle),Math.sqrt(area)*Math.sin(angle)];
}
