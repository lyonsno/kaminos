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
  corners: array<FlowReconstructionSample, 8>,
  fraction: vec3<f32>,
};

fn sampleRaymarchNeighborhood(p: vec3<f32>) -> RaymarchNeighborhood {
  let q = clamp(worldToCell(p) - vec3<f32>(0.5), vec3<f32>(0.0), vec3<f32>(f32(GRID) - 1.001, f32(GRID_Y) - 1.001, f32(GRID) - 1.001));
  let c = vec3<i32>(floor(q));
  var result: RaymarchNeighborhood;
  result.fraction = fract(q);
  ${Array.from({length: 8}, (_, k) => `let idx${k} = index3(clampCell(c + vec3<i32>(${k & 1}, ${(k >> 1) & 1}, ${k >> 2})));
  result.corners[${k}].velocityDensity = fluidSrc[idx${k} * SLOTS_PER_CELL];
  result.corners[${k}].material = fluidSrc[idx${k} * SLOTS_PER_CELL + 1u];
  result.corners[${k}].fireLayer = fluidSrc[idx${k} * SLOTS_PER_CELL + 2u];
  result.corners[${k}].microLayer = fluidSrc[idx${k} * SLOTS_PER_CELL + 3u];
  result.corners[${k}].frontTopology = frontSrc[idx${k}];`).join('\n  ')}
  return result;
}

fn raymarchNeighborhoodSupport(n: RaymarchNeighborhood) -> f32 {
  var support: array<f32, 8>;
  ${Array.from({length: 8}, (_, k) => `support[${k}] = directCellOpticalSupportFromSlots(n.corners[${k}].velocityDensity, n.corners[${k}].material, n.corners[${k}].fireLayer, n.corners[${k}].microLayer, n.corners[${k}].frontTopology);`).join('\n  ')}
  let z0 = max(max(support[0], support[1]), max(support[2], support[3]));
  let z1 = max(max(support[4], support[5]), max(support[6], support[7]));
  return max(z0, z1);
}

fn reconstructRaymarchNeighborhood(n: RaymarchNeighborhood) -> FlowReconstructionSample {
  let f = n.fraction;
  var result: FlowReconstructionSample;
  ${fields.map(field => `result.${field} = mix(
    mix(mix(n.corners[0].${field}, n.corners[1].${field}, f.x), mix(n.corners[2].${field}, n.corners[3].${field}, f.x), f.y),
    mix(mix(n.corners[4].${field}, n.corners[5].${field}, f.x), mix(n.corners[6].${field}, n.corners[7].${field}, f.x), f.y), f.z);`).join('\n  ')}
  result.kernelTangentRadius = vec4<f32>(0.0);
  return result;
}
`;
