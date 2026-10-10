export function leanEmissiveRaymarchAdmission({
  physicalColorMode = 0,
  presentationMode = 'beauty',
  appearanceDecompositionActive = false,
  supervisionFireOnlyTarget = false,
  nonRidgeOpticalCaptureActive = false,
  nonRidgeSourceBasisCaptureActive = false,
  liveCompleteFlameOpticalCoefficientsEnabled = false,
} = {}) {
  const refusalReasons = [];
  if (physicalColorMode !== 2) refusalReasons.push('not-emissive-material');
  if (presentationMode !== 'beauty') refusalReasons.push('presentation-mode-not-beauty');
  if (appearanceDecompositionActive) refusalReasons.push('appearance-decomposition-active');
  if (supervisionFireOnlyTarget) refusalReasons.push('fire-supervision-active');
  if (nonRidgeOpticalCaptureActive) refusalReasons.push('nonridge-optical-capture-active');
  if (nonRidgeSourceBasisCaptureActive) refusalReasons.push('nonridge-source-basis-capture-active');
  if (liveCompleteFlameOpticalCoefficientsEnabled) refusalReasons.push('live-complete-flame-coefficients-active');
  return { eligible: refusalReasons.length === 0, refusalReasons };
}

const fields = ['velocityDensity', 'material', 'fireLayer', 'microLayer', 'frontTopology'];
export const RAYMARCH_NEIGHBORHOOD_WGSL = /* wgsl */`
struct RaymarchNeighborhood {
  sample: FlowReconstructionSample,
  support: f32,
};

fn sampleRaymarchNeighborhood(p: vec3<f32>) -> RaymarchNeighborhood {
  let q = clamp(worldToCell(p) - vec3<f32>(0.5), vec3<f32>(0.0), vec3<f32>(f32(GRID) - 1.001, f32(GRID_Y) - 1.001, f32(GRID) - 1.001));
  let c = vec3<i32>(floor(q));
  let f = fract(q);
  ${Array.from({length: 8}, (_, k) => `let idx${k} = index3(clampCell(c + vec3<i32>(${k & 1}, ${(k >> 1) & 1}, ${k >> 2})));
  let velocityDensity${k} = fluidSrc[idx${k} * SLOTS_PER_CELL];
  let material${k} = fluidSrc[idx${k} * SLOTS_PER_CELL + 1u];
  let fireLayer${k} = fluidSrc[idx${k} * SLOTS_PER_CELL + 2u];
  let microLayer${k} = fluidSrc[idx${k} * SLOTS_PER_CELL + 3u];
  let frontTopology${k} = frontSrc[idx${k}];
  let support${k} = directCellOpticalSupportFromSlots(velocityDensity${k}, material${k}, fireLayer${k}, microLayer${k}, frontTopology${k});`).join('\n  ')}
  var result: RaymarchNeighborhood;
  let z0 = max(max(support0, support1), max(support2, support3));
  let z1 = max(max(support4, support5), max(support6, support7));
  result.support = max(z0, z1);
  ${fields.map(field => `result.sample.${field} = mix(
    mix(mix(${field}0, ${field}1, f.x), mix(${field}2, ${field}3, f.x), f.y),
    mix(mix(${field}4, ${field}5, f.x), mix(${field}6, ${field}7, f.x), f.y), f.z);`).join('\n  ')}
  result.sample.kernelTangentRadius = vec4<f32>(0.0);
  return result;
}

fn raymarchNeighborhoodSupport(n: RaymarchNeighborhood) -> f32 {
  return n.support;
}

fn reconstructRaymarchNeighborhood(n: RaymarchNeighborhood) -> FlowReconstructionSample {
  return n.sample;
}
`;
