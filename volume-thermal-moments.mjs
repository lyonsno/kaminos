// Soot-weighted heat moments travel with the material, before nonlinear
// blackbody classification. Two-node Gaussian quadrature retains four moments
// (including soot mass). It is exact for a two-temperature population, an
// approximation for wider distributions, and does not invent spatial detail.
export function sootHeatMoments(soot, heat) {
  return [soot * heat, soot * heat ** 2, soot * heat ** 3];
}
export function evolveThermalMoments(m, soot, { heatAdded = 0, cooling = 1, sootSurvival = 1 } = {}) {
  const d = heatAdded;
  return [m[0] + soot*d, m[1] + 2*d*m[0] + soot*d*d,
    m[2] + 3*d*m[1] + 3*d*d*m[0] + soot*d*d*d]
    .map((v,i) => v * cooling ** (i+1) * sootSurvival);
}
export function thermalQuadrature(soot, m) {
  if (soot <= 0) return [];
  const mean = m[0]/soot, second = m[1]/soot, variance = Math.max(0, second-mean*mean);
  if (variance <= 1e-6*Math.max(second,1e-12)) return [[soot,mean]];
  const skew = m[2]/soot-3*mean*second+2*mean**3;
  const other = mean+skew/variance, half = (mean+other)/2;
  const radius = Math.sqrt((mean-other)**2/4+variance);
  const low = Math.max(0,half-radius), high = Math.max(low,half+radius);
  const hot = Math.max(0,Math.min(1,(mean-low)/(high-low)));
  return [[soot*(1-hot),low],[soot*hot,high]];
}

export const THERMAL_MOMENTS_WGSL = /* wgsl */`
fn thermalMoments(soot:f32, heat:f32)->vec3<f32>{
  return soot*vec3<f32>(heat,heat*heat,heat*heat*heat);
}
fn shiftThermalMoments(m:vec3<f32>,soot:f32,d:f32,cooling:f32)->vec3<f32>{
  return vec3<f32>(m.x+soot*d,m.y+2.0*d*m.x+soot*d*d,
    m.z+3.0*d*m.y+3.0*d*d*m.x+soot*d*d*d)
    *vec3<f32>(cooling,cooling*cooling,cooling*cooling*cooling);
}
// Returns cold heat, hot heat and hot soot fraction. Relative variance avoids
// cancellation turning a uniform population into an enormous spurious hot tail.
fn thermalQuadrature(soot:f32,m:vec3<f32>)->vec3<f32>{
  if(soot<=0.0){return vec3<f32>(0);}
  let mean=m.x/soot;let second=m.y/soot;let variance=max(0.0,second-mean*mean);
  if(variance<=1e-6*max(second,1e-12)){return vec3<f32>(mean,mean,0);}
  let skew=m.z/soot-3.0*mean*second+2.0*mean*mean*mean;
  let other=mean+skew/variance;let half=(mean+other)*.5;
  let radius=sqrt((mean-other)*(mean-other)*.25+variance);
  let lo=max(0.0,half-radius);let hi=max(lo,half+radius);
  return vec3<f32>(lo,hi,clamp((mean-lo)/max(hi-lo,1e-12),0.0,1.0));
}
`;
