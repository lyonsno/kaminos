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
  materialBounds: vec3<f32>,
};

// Raw-field bounds, not shaded corner values: nonlinear sub-cell flame is retained.
fn raymarchMaterialBounds(m: vec4<f32>, f: vec4<f32>, d: vec4<f32>, front: f32) -> vec3<f32> {
  return vec3<f32>(max(m.x, 0.0) + max(d.x, 0.0) + max(m.w, 0.0),
    max(m.z, 0.0), max(front, 0.0) + 0.5 * max(f.w, 0.0) + 0.08 * max(d.z, 0.0));
}

fn raymarchMaterialEmpty(smoke: f32, fuel: f32, front: f32) -> bool {
  return smoke <= 0.0 && (fuel <= 0.008 || front <= 0.001);
}

fn raymarchCellOriginAxis(q: f32, direction: f32, count: f32) -> f32 {
  let bounded = clamp(q, 0.0, count - 1.001);
  return max(0.0, floor(bounded) - select(0.0, 1.0, direction < 0.0 && bounded == floor(bounded)));
}

fn raymarchMaterialExitAxis(q: f32, dqdt: f32, count: f32) -> f32 {
  if (dqdt == 0.0 || (dqdt < 0.0 && q <= 0.0) || (dqdt > 0.0 && q >= count - 1.001)) { return 1.0e6; }
  let c = raymarchCellOriginAxis(q, dqdt, count);
  let face = select(c, c + 1.0, dqdt > 0.0);
  return max(0.0, (face - q) / dqdt);
}

fn raymarchMaterialCellExit(p: vec3<f32>, rd: vec3<f32>) -> f32 {
  let q = worldToCell(p) - vec3<f32>(0.5);
  let dqdt = rd * (0.5 * f32(GRID));
  return min(raymarchMaterialExitAxis(q.x, dqdt.x, f32(GRID)),
    min(raymarchMaterialExitAxis(q.y, dqdt.y, f32(GRID_Y)), raymarchMaterialExitAxis(q.z, dqdt.z, f32(GRID))));
}

fn materialEmptyAdvance(dtBase: f32, cellExit: f32, occupancySkipStrength: f32) -> f32 {
  return min(cellExit, mix(dtBase, max(dtBase, cellExit), occupancySkipStrength));
}

fn sampleRaymarchNeighborhoodDirected(p: vec3<f32>, direction: vec3<f32>) -> RaymarchNeighborhood {
  let q = clamp(worldToCell(p) - vec3<f32>(0.5), vec3<f32>(0.0), vec3<f32>(f32(GRID) - 1.001, f32(GRID_Y) - 1.001, f32(GRID) - 1.001));
  let c = vec3<i32>(vec3<f32>(raymarchCellOriginAxis(q.x, direction.x, f32(GRID)), raymarchCellOriginAxis(q.y, direction.y, f32(GRID_Y)), raymarchCellOriginAxis(q.z, direction.z, f32(GRID))));
  let f = q - vec3<f32>(c);
  ${Array.from({length: 8}, (_, k) => `let idx${k} = index3(clampCell(c + vec3<i32>(${k & 1}, ${(k >> 1) & 1}, ${k >> 2})));
  let velocityDensity${k} = fluidSrc[idx${k} * SLOTS_PER_CELL];
  let material${k} = fluidSrc[idx${k} * SLOTS_PER_CELL + 1u];
  let fireLayer${k} = fluidSrc[idx${k} * SLOTS_PER_CELL + 2u];
  let microLayer${k} = fluidSrc[idx${k} * SLOTS_PER_CELL + 3u];
  let frontTopology${k} = frontSrc[idx${k}];
  let support${k} = directCellOpticalSupportFromSlots(velocityDensity${k}, material${k}, fireLayer${k}, microLayer${k}, frontTopology${k});
  let bounds${k} = raymarchMaterialBounds(material${k}, fireLayer${k}, microLayer${k}, frontTopology${k});`).join('\n  ')}
  var result: RaymarchNeighborhood;
  let z0 = max(max(support0, support1), max(support2, support3));
  let z1 = max(max(support4, support5), max(support6, support7));
  result.support = max(z0, z1);
  result.materialBounds = max(max(max(bounds0, bounds1), max(bounds2, bounds3)), max(max(bounds4, bounds5), max(bounds6, bounds7)));
  ${fields.map(field => `result.sample.${field} = mix(
    mix(mix(${field}0, ${field}1, f.x), mix(${field}2, ${field}3, f.x), f.y),
    mix(mix(${field}4, ${field}5, f.x), mix(${field}6, ${field}7, f.x), f.y), f.z);`).join('\n  ')}
  result.sample.kernelTangentRadius = vec4<f32>(0.0);
  return result;
}

fn sampleRaymarchNeighborhood(p: vec3<f32>) -> RaymarchNeighborhood {
  return sampleRaymarchNeighborhoodDirected(p, vec3<f32>(0.0));
}

fn raymarchNeighborhoodSupport(n: RaymarchNeighborhood) -> f32 {
  return n.support;
}

fn reconstructRaymarchNeighborhood(n: RaymarchNeighborhood) -> FlowReconstructionSample {
  return n.sample;
}
`;
