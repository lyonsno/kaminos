export const SOURCE_BASIS_CAPTURE_SCHEMA = 'kaminos.volume.nonridge-source-setting-captures.v0';
export const SOURCE_BASIS_CAPTURE_AUTHORITY = 'integration-positive-nonridge-randomized-source-captures-v0';
export const SOURCE_BASIS_CAPTURE_SEED = 7162026;
export const SOURCE_BASIS_SETTING_COUNT = 17;
export const SOURCE_BASIS_GPU_ROW_FLOATS = 29;

export const CURRENT16_ORDER = Object.freeze([
  'sidecar.support', 'sidecar.coverage', 'sidecar.ridge', 'sidecar.footprint',
  'material.density', 'material.heat', 'material.fuel', 'material.detail',
  'fire.energy', 'fire.temperature', 'fire.emission', 'fire.detail',
  'micro.x', 'micro.y', 'micro.z', 'micro.w',
]);

export const SOURCE_BASIS_ORDER = Object.freeze([
  'front.topology',
  'velocity.x',
  'velocity.y',
  'velocity.z',
  'support.reaction',
  'support.interface',
  'flow.curlMagnitude',
  'flow.divergence',
]);

export const TARGET_ORDER = Object.freeze([
  'candidate.nonRidgeMembership',
  'nonRidge.emission.r',
  'nonRidge.emission.g',
  'nonRidge.emission.b',
  'nonRidge.extinction',
]);

export const CAUSAL_CONTROL_FIELDS = Object.freeze([
  { name: 'support.thermal', key: 'reactionBoundarySupportThermal', nested: ['reactionBoundaryControls', 'supportThermal'], min: 0, max: 2 },
  { name: 'support.reaction', key: 'reactionBoundarySupportReaction', nested: ['reactionBoundaryControls', 'supportReaction'], min: 0, max: 2 },
  { name: 'support.front', key: 'reactionBoundarySupportFront', nested: ['reactionBoundaryControls', 'supportFront'], min: 0, max: 2 },
  { name: 'support.interface', key: 'reactionBoundarySupportInterface', nested: ['reactionBoundaryControls', 'supportInterface'], min: 0, max: 2 },
  { name: 'boundary.gradientGain', key: 'reactionBoundaryGradient', nested: ['reactionBoundaryControls', 'gradientGain'], min: 0, max: 4 },
  { name: 'boundary.cut', key: 'reactionBoundaryCut', nested: ['reactionBoundaryControls', 'cut'], min: 0, max: 0.55 },
  { name: 'boundary.softness', key: 'reactionBoundarySoftness', nested: ['reactionBoundaryControls', 'softness'], min: 0.005, max: 0.45 },
  { name: 'boundary.coreRejection', key: 'reactionBoundaryCoreReject', nested: ['reactionBoundaryControls', 'coreReject'], min: 0, max: 1 },
  { name: 'topology.gain', key: 'reactionBoundaryTopology', nested: ['reactionBoundaryControls', 'topologyGain'], min: 0, max: 2.5 },
  { name: 'curl.gain', key: 'reactionBoundaryCurl', nested: ['reactionBoundaryControls', 'curlGain'], min: 0, max: 2 },
  { name: 'divergence.gain', key: 'reactionBoundaryDivergence', nested: ['reactionBoundaryControls', 'divergenceGain'], min: 0, max: 1 },
  { name: 'ridge.gain', key: 'reactionBoundaryFireRidge', nested: ['reactionBoundaryFireControls', 'ridgeGain'], min: 0, max: 2 },
  { name: 'ridge.cut', key: 'reactionBoundaryFireRidgeCut', nested: ['reactionBoundaryFireControls', 'ridgeCut'], min: 0, max: 0.55 },
  { name: 'tip.breakup', key: 'reactionBoundaryFireTip', nested: ['reactionBoundaryFireControls', 'tipBreakup'], min: 0, max: 2 },
  { name: 'topology.erosion', key: 'reactionBoundaryFireErosion', nested: ['reactionBoundaryFireControls', 'topologyErosion'], min: 0, max: 1 },
]);

export const CAUSAL_CONTROL_ORDER = Object.freeze(CAUSAL_CONTROL_FIELDS.map(field => field.name));
export const CAUSAL_CONTROL_RANGES = Object.freeze(Object.fromEntries(
  CAUSAL_CONTROL_FIELDS.map(field => [field.name, Object.freeze([field.min, field.max])]),
));

function xorshift32(value) {
  let state = value >>> 0;
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  return state >>> 0;
}

export function buildVivisectorControlDesign({
  seed = SOURCE_BASIS_CAPTURE_SEED,
  settingCount = SOURCE_BASIS_SETTING_COUNT,
  controlRanges = CAUSAL_CONTROL_RANGES,
} = {}) {
  if (!Number.isInteger(seed) || seed < 0) throw new Error('source-basis design seed must be a nonnegative integer');
  if (!Number.isInteger(settingCount) || settingCount < CAUSAL_CONTROL_ORDER.length + 1) {
    throw new Error(`source-basis design requires at least ${CAUSAL_CONTROL_ORDER.length + 1} settings`);
  }
  const columns = CAUSAL_CONTROL_ORDER.map((name, controlIndex) => {
    const range = controlRanges[name];
    if (!Array.isArray(range) || range.length !== 2 || !range.every(Number.isFinite) || range[0] >= range[1]) {
      throw new Error(`invalid source-basis control range for ${name}`);
    }
    const permutation = Array.from({ length: settingCount }, (_, index) => index);
    let state = (seed ^ Math.imul(controlIndex + 1, 0x9e3779b9)) >>> 0;
    if (state === 0) state = 0x6d2b79f5;
    for (let index = settingCount - 1; index > 0; index -= 1) {
      state = xorshift32(state);
      const swapIndex = state % (index + 1);
      [permutation[index], permutation[swapIndex]] = [permutation[swapIndex], permutation[index]];
    }
    const [minimum, maximum] = range;
    return permutation.map(level => minimum + (maximum - minimum) * level / (settingCount - 1));
  });
  return Array.from({ length: settingCount }, (_, settingIndex) => Object.fromEntries(
    CAUSAL_CONTROL_ORDER.map((name, controlIndex) => [name, columns[controlIndex][settingIndex]]),
  ));
}

export function buildFullGridWorldPositions({ shape, origin, spacing }) {
  if (!Array.isArray(shape) || shape.length !== 3 || shape.some(size => !Number.isInteger(size) || size <= 0)) {
    throw new Error('full-grid shape must contain three positive integers');
  }
  if (!Array.isArray(origin) || origin.length !== 3 || !origin.every(Number.isFinite)) {
    throw new Error('full-grid origin must contain three finite numbers');
  }
  if (!Array.isArray(spacing) || spacing.length !== 3 || !spacing.every(value => Number.isFinite(value) && value > 0)) {
    throw new Error('full-grid spacing must contain three positive finite numbers');
  }
  const [nx, ny, nz] = shape;
  const values = new Float32Array(nx * ny * nz * 3);
  let offset = 0;
  for (let z = 0; z < nz; z += 1) {
    for (let y = 0; y < ny; y += 1) {
      for (let x = 0; x < nx; x += 1) {
        values[offset++] = origin[0] + (x + 0.5) * spacing[0];
        values[offset++] = origin[1] + (y + 0.5) * spacing[1];
        values[offset++] = origin[2] + (z + 0.5) * spacing[2];
      }
    }
  }
  return values;
}
