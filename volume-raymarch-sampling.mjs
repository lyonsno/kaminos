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
export const FLAME_GUIDANCE_WGSL = /* wgsl */`
fn flameGuideAt(p: vec3<f32>) -> f32 {
  return flameGuideAtPadded(p, 0);
}
fn flameGuideAtPadded(p: vec3<f32>, padding: i32) -> f32 {
  let corner = vec3<i32>(floor(worldToCell(p) - vec3<f32>(0.5)));
  var support = 0.0;
  // Max over the reconstruction footprint broadens thin support without
  // interpolating emission or treating the guide as an emptiness certificate.
  for (var z = -padding; z < 2 + padding; z++) { for (var y = -padding; y < 2 + padding; y++) { for (var x = -padding; x < 2 + padding; x++) {
    let cell = clampCell(corner + vec3<i32>(x, y, z));
    let index = index3(cell);
    var cue = boundarySidecar[index].y;
    if (u.emissive_physics.x > 0.5) {
      let material = max(fluidSrc[index * SLOTS_PER_CELL + 1u], vec4<f32>(0.0));
      let thermal = smoothstep(800.0, 1800.0, physicsSootKelvin(material.y, u.emissive_physics.y))
        * smoothstep(0.0, 0.02, material.x);
      var burn = 0.0;
      if (reactantLawOn()) { burn = reactionLightFromBurn(textureLoad(reactantSrc, vec3<i32>(cell), 0).y, u.reactant_combustion_d.x); }
      cue = max(cue, max(thermal, burn));
    }
    support = max(support, cue);
  } } }
  return smoothstep(0.01, 0.20, support);
}
fn flameGuideSegment(p: vec3<f32>, direction: vec3<f32>, length: f32) -> vec2<f32> {
  return flameGuideSegmentPadded(p, direction, length, 0);
}
fn flameGuideSegmentPadded(p: vec3<f32>, direction: vec3<f32>, length: f32, padding: i32) -> vec2<f32> {
  var distance = 0.0;
  loop {
    let point = p + direction * distance;
    let support = flameGuideAtPadded(point, padding);
    if (support > 0.0 || distance >= length) { return vec2<f32>(distance, support); }
    // Walk crossed cells rather than sampling a few evenly spaced locations
    // that can jump over the very support this guide is meant to protect.
    distance = min(length, distance + max(0.0001, directCellExitDistance(point, direction) + 0.0001));
  }
}
`;
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
  result.sample.freshBurn = sampleWorldReactantBurn(p);
  return result;
}

fn raymarchNeighborhoodSupport(n: RaymarchNeighborhood) -> f32 {
  return n.support;
}

fn reconstructRaymarchNeighborhood(n: RaymarchNeighborhood) -> FlowReconstructionSample {
  return n.sample;
}
`;
