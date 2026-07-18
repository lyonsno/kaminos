import {
  SELECTIVE_HEAD_LIVE_MODEL as SELECTIVE_HEAD_LIVE_MODEL_160_TO_128,
  SELECTIVE_HEAD_LIVE_MODEL_URL as SELECTIVE_HEAD_LIVE_MODEL_URL_160_TO_128,
} from './models/selective-head-live/exact-basin-160-to-128-v0/model.generated.js';
import {
  SELECTIVE_HEAD_LIVE_MODEL as SELECTIVE_HEAD_LIVE_MODEL_160_TO_96,
  SELECTIVE_HEAD_LIVE_MODEL_URL as SELECTIVE_HEAD_LIVE_MODEL_URL_160_TO_96,
} from './models/selective-head-live/exact-basin-160-to-96-v0/model.generated.js';
import {
  SELECTIVE_HEAD_LIVE_MODEL as NATIVE96_EXACT_FRONT_TEACHER_MODEL,
  SELECTIVE_HEAD_LIVE_MODEL_URL as NATIVE96_EXACT_FRONT_TEACHER_MODEL_URL,
} from './models/selective-head-live/latest-happy-bowl-front-only-160-to-96-step96-v0/model.generated.js';
import {
  VIVISECTOR_WIDTH32_RECEIVER_EVAL_EMBEDDING,
  VIVISECTOR_WIDTH32_RECEIVER_EVAL_WGSL,
} from './models/native-low-vivisector-candidate-head-128-160-v0/weights.generated.js';

export const SELECTIVE_HEAD_LIVE_MODEL = SELECTIVE_HEAD_LIVE_MODEL_160_TO_128;
export const SELECTIVE_HEAD_LIVE_MODEL_URL = SELECTIVE_HEAD_LIVE_MODEL_URL_160_TO_128;

export const NATIVE_LOW_SELECTIVE_LIVE_ROUTE = 'native-low-live-browser-webgpu-inference-v0';
export const NATIVE_LOW_SHARED_DEVICE_ROUTE = 'native-low-shared-device-buffer-inference-v0';
export const NATIVE_LOW_INPUT_AUTHORITY = 'native-low-simulator-state-no-synthetic-downsample-v0';
export const NATIVE_LOW_FEATURE_AUTHORITY = 'full-low-field-plus-spatial-rbf-features-v0';
export const NATIVE_LOW_TRANSPORT_MODE = 'shared-device-gpu-buffers-no-readback-import-v0';
export const NATIVE_LOW_SUPPORT_POSITIVE_RESIDUAL_DISPATCH = 'native-low-support-positive-residual-dispatch-v0';
export const NATIVE_LOW_SUPPORT_POSITIVE_INDIRECT_RESIDUAL_DISPATCH = 'native-low-support-positive-indirect-residual-dispatch-v0';
export const NATIVE_LOW_FIXED_SOURCE_DELTA_ADMISSION = 'native-low-fixed-source-delta-admission-v0';
export const NATIVE_LOW_SOURCE_PROXIMAL_TILE_CANDIDATE = 'native-low-source-proximal-tile-candidate-v0';
export const NATIVE_LOW_CANDIDATE_HEAD_COST_MICROBENCHMARK = 'native-low-candidate-head-cost-microbenchmark-v0';
export const NATIVE_LOW_VIVISECTOR_WIDTH32_LIVE_RECEIVER = 'native-low-vivisector-width32-live-receiver-v0';
export const NATIVE_LOW_RESIDENT_CUE_BUFFER_LIFECYCLE_STRESS = 'native-low-resident-cue-buffer-lifecycle-stress-v0';
export const NATIVE_LOW_COARSE_SOURCE_HISTORY_SUPPORT_FRONT_REPLACEMENT = 'native-low-coarse-source-history-support-front-replacement-v0';
export const NATIVE96_SPARSE_FRONT_CONTINUITY = 'native96-sparse-front-continuity-v0';
export const NATIVE96_F16_FRONT_TEACHER_CANDIDATES = 'native96-f16-front-teacher-candidates-v0';
export const NATIVE96_FRONT_AUTHORITY_GATED_F32_FRONT_TEACHER_CANDIDATES = 'native96-front-authority-gated-f32-front-teacher-candidates-v0';
export const NATIVE_LOW_RUNTIME_BUILD_IDENTITY = 'native-low-live-research-cockpit-v1';
export const NATIVE_LOW_TRAINED_PACKAGE_ROUTE_REGISTRY_IDENTITY = 'native-low-trained-package-route-registry-v0';
export const NATIVE_LOW_TRANSFER_160_TO_128_ZERO_SHOT_ROUTE = 'native-low-transfer-160-to-128-zero-shot-v0';
export const NATIVE_LOW_TRANSFER_160_TO_96_DEPLOYMENT_GRID_ROUTE = 'native-low-transfer-160-to-96-deployment-grid-v0';
export const NATIVE_LOW_TRANSFER_160_TO_128_MODEL_IDENTITY = 'exact-basin-selective-carrier-heads-160-to-128-v0';
export const NATIVE_LOW_TRANSFER_160_TO_128_MODEL_SHA256 = 'dc1886384f87c4e51015f6ffd5ac8c0a48ac6f32b6f02a238ac5e3c3bd883dc9';
export const NATIVE_LOW_TRANSFER_160_TO_96_MODEL_IDENTITY = 'exact-basin-selective-carrier-heads-160-to-96-v0';
export const NATIVE_LOW_TRANSFER_160_TO_96_MODEL_SHA256 = 'baa54236f04c28eab278cf60e4a60745cd3c0160a985a9adbb1e06db7958f6e8';

export const NATIVE_LOW_TRAINED_PACKAGE_ROUTES = Object.freeze({
  [NATIVE_LOW_TRANSFER_160_TO_128_ZERO_SHOT_ROUTE]: Object.freeze({
    routeId: NATIVE_LOW_TRANSFER_160_TO_128_ZERO_SHOT_ROUTE,
    label: '160->128 zero-shot',
    model: SELECTIVE_HEAD_LIVE_MODEL_160_TO_128,
    modelUrl: SELECTIVE_HEAD_LIVE_MODEL_URL_160_TO_128,
    packageIdentity: NATIVE_LOW_TRANSFER_160_TO_128_MODEL_IDENTITY,
    modelIdentity: NATIVE_LOW_TRANSFER_160_TO_128_MODEL_IDENTITY,
    packageSha256: NATIVE_LOW_TRANSFER_160_TO_128_MODEL_SHA256,
    modelSha256: NATIVE_LOW_TRANSFER_160_TO_128_MODEL_SHA256,
    trainedLowGrid: 128,
    trainedHighGrid: 160,
    effectiveSourceGrid: 'native-96-or-native-128-runtime-selected-v0',
    promotionRole: 'existing-zero-shot-product-candidate',
    dispatchIdentity: NATIVE_LOW_SUPPORT_POSITIVE_INDIRECT_RESIDUAL_DISPATCH,
    sourceHistoryDispatchIdentity: 'sourceHistoryDispatchArgs',
    rankingClaim: false,
  }),
  [NATIVE_LOW_TRANSFER_160_TO_96_DEPLOYMENT_GRID_ROUTE]: Object.freeze({
    routeId: NATIVE_LOW_TRANSFER_160_TO_96_DEPLOYMENT_GRID_ROUTE,
    label: '160->96 deployment-grid',
    model: SELECTIVE_HEAD_LIVE_MODEL_160_TO_96,
    modelUrl: SELECTIVE_HEAD_LIVE_MODEL_URL_160_TO_96,
    packageIdentity: NATIVE_LOW_TRANSFER_160_TO_96_MODEL_IDENTITY,
    modelIdentity: NATIVE_LOW_TRANSFER_160_TO_96_MODEL_IDENTITY,
    packageSha256: NATIVE_LOW_TRANSFER_160_TO_96_MODEL_SHA256,
    modelSha256: NATIVE_LOW_TRANSFER_160_TO_96_MODEL_SHA256,
    trainedLowGrid: 96,
    trainedHighGrid: 160,
    effectiveSourceGrid: 'native-96-or-native-128-runtime-selected-v0',
    promotionRole: 'deployment-grid-product-candidate',
    trainingInputAuthority: SELECTIVE_HEAD_LIVE_MODEL_160_TO_96.source.trainingInputAuthority,
    trainingInputSyntheticDownsample: SELECTIVE_HEAD_LIVE_MODEL_160_TO_96.source.trainingInputSyntheticDownsample,
    nativeDeploymentInputSeenDuringTraining: false,
    dispatchIdentity: NATIVE_LOW_SUPPORT_POSITIVE_INDIRECT_RESIDUAL_DISPATCH,
    sourceHistoryDispatchIdentity: 'sourceHistoryDispatchArgs',
    rankingClaim: false,
  }),
});

const LOW_GRID = 128;
const HIGH_GRID = 160;
const SLOTS_PER_CELL = 4;
const FEATURE_COUNT = 185;
const HIDDEN_WIDTH = 48;
const STATS_BYTES = 16;
const SOURCE_HISTORY_STATS_BYTES = 8 * Uint32Array.BYTES_PER_ELEMENT;
const INDIRECT_ARGS_BYTES = 16;
const RESIDUAL_WORKGROUP_SIZE = 64;
const CANDIDATE_HEAD_BENCHMARK_WIDTHS = Object.freeze([16, 24, 32]);
const CANDIDATE_HEAD_INPUT_COUNT = 48;
const CANDIDATE_HEAD_OUTPUT_COUNT = 8;
const CANDIDATE_CUE_RECORD_STRIDE_BYTES = 32;
const CANDIDATE_CUE_LIFECYCLE_STATS_BYTES = 8 * Uint32Array.BYTES_PER_ELEMENT;
const CANDIDATE_CUE_LIFECYCLE_PARAMS_BYTES = 4 * Uint32Array.BYTES_PER_ELEMENT;
const NATIVE96_EXACT_FRONT_TEACHER_PARENT_COMMIT = 'cf15a42d847cb727d5aad4fc4ef212cf6f40c5ce';
const NATIVE96_EXACT_FRONT_TEACHER_MODEL_SHA256 = '2eb3d311d8964d21ba471bba973b38ac1f32ee25b0a73926a6ee7b43ca78e95b';
const NATIVE96_EXACT_FRONT_TEACHER_SOURCE_PACKED_SHA256 = '97e25caa711395f26e8b39f22c506e38e772bfc1a12cf518d5e048511d2bee08';
const NATIVE96_F16_FRONT_TEACHER_IDENTITY = 'native96-front-student-width48-f16-v0';
const NATIVE96_F16_FRONT_TEACHER_URL = new URL('./models/native96-front-student-width48-f16-v0/front-student-width48.f16', import.meta.url).href;
const NATIVE96_F16_FRONT_TEACHER_SHA256 = '8650b2231cf4fd0d8e1a6414ff25a4aeee1ca143f3cb70905299e74c5942b4be';
const NATIVE96_F16_FRONT_TEACHER_BYTE_LENGTH = 18698;
const VIVISECTOR_WIDTH32_WEIGHT_FLOAT_COUNT = 1944;
const VIVISECTOR_WIDTH32_WEIGHT_BYTES = VIVISECTOR_WIDTH32_WEIGHT_FLOAT_COUNT * Float32Array.BYTES_PER_ELEMENT;
const VIVISECTOR_FEATURE_MEAN_OFFSET = 0;
const VIVISECTOR_FEATURE_STD_OFFSET = 48;
const VIVISECTOR_TARGET_MEAN_OFFSET = 96;
const VIVISECTOR_TARGET_STD_OFFSET = 104;
const VIVISECTOR_W1_OFFSET = 112;
const VIVISECTOR_B1_OFFSET = 1648;
const VIVISECTOR_W2_OFFSET = 1680;
const VIVISECTOR_B2_OFFSET = 1936;
const SOURCE_DELTA_THRESHOLD = 0.5457155704;
const SOURCE_DELTA_CALIBRATION_SHA256 = 'c1b0c1ada36317ee634f198cd90e1ce9be5fb38a421c7e500af3f465834c16d3';
const SOURCE_DELTA_SCALES = Object.freeze([
  0.27549979090690613,
  0.16067561507225037,
  0.2599555552005768,
  0.22482779622077942,
  0.08425257354974747,
  0.20089389383792877,
  0.02505391277372837,
  0.2557207942008972,
  0.36345410346984863,
  0.2309359312057495,
  0.27264925837516785,
  0.10435938835144043,
  0.06293082237243652,
  0.4255056381225586,
  0.23969438672065735,
  0.24967649579048157,
  0.03789634257555008,
]);
const SOURCE_DELTA_SCALE_WGSL = SOURCE_DELTA_SCALES.map((value, index) => `  if (channel == ${index}u) { return ${value}; }`).join('\n');

export function resolveNativeLowTrainedPackageRoute(routeId = NATIVE_LOW_TRANSFER_160_TO_128_ZERO_SHOT_ROUTE) {
  const normalized = String(routeId || NATIVE_LOW_TRANSFER_160_TO_128_ZERO_SHOT_ROUTE).trim();
  const route = NATIVE_LOW_TRAINED_PACKAGE_ROUTES[normalized];
  if (!route) {
    throw new Error(`unknownTransferRouteId:${normalized}`);
  }
  return route;
}

export function nativeLowTrainedPackageRouteRegistry() {
  return {
    identity: NATIVE_LOW_TRAINED_PACKAGE_ROUTE_REGISTRY_IDENTITY,
    defaultRouteId: NATIVE_LOW_TRANSFER_160_TO_128_ZERO_SHOT_ROUTE,
    routes: Object.values(NATIVE_LOW_TRAINED_PACKAGE_ROUTES).map(route => ({
      routeId: route.routeId,
      label: route.label,
      packageIdentity: route.packageIdentity,
      modelIdentity: route.modelIdentity,
      packageSha256: route.packageSha256,
      modelSha256: route.modelSha256,
      trainedLowGrid: route.trainedLowGrid,
      trainedHighGrid: route.trainedHighGrid,
      effectiveSourceGrid: route.effectiveSourceGrid,
      promotionRole: route.promotionRole,
      trainingInputAuthority: route.trainingInputAuthority || null,
      trainingInputSyntheticDownsample: route.trainingInputSyntheticDownsample ?? null,
      nativeDeploymentInputSeenDuringTraining: route.nativeDeploymentInputSeenDuringTraining ?? null,
      dispatchIdentity: route.dispatchIdentity,
      sourceHistoryDispatchIdentity: route.sourceHistoryDispatchIdentity,
      rankingClaim: false,
    })),
  };
}

function output(channel) {
  const found = SELECTIVE_HEAD_LIVE_MODEL.outputs.find(item => item.channel === channel);
  if (!found) throw new Error(`native-low selective model omitted ${channel}`);
  return found;
}

function wgslOffsets(channel) {
  const offsets = output(channel).offsets;
  return [offsets.w1, offsets.b1, offsets.w2, offsets.b2, offsets.targetMean, offsets.targetStd].map(value => `${value}u`).join(', ');
}

function specializeLowGridWgsl(code, lowGrid) {
  return String(code).replaceAll(`const LOW_GRID: u32 = ${LOW_GRID}u;`, `const LOW_GRID: u32 = ${lowGrid}u;`);
}

const WGSL = `
const LOW_GRID: u32 = ${LOW_GRID}u;
const HIGH_GRID: u32 = ${HIGH_GRID}u;
const SLOTS_PER_CELL: u32 = ${SLOTS_PER_CELL}u;
const FEATURE_COUNT: u32 = ${FEATURE_COUNT}u;
const HIDDEN_WIDTH: u32 = ${HIDDEN_WIDTH}u;
const RESIDUAL_WORKGROUP_SIZE: u32 = ${RESIDUAL_WORKGROUP_SIZE}u;
const SUPPORT_THRESHOLD: f32 = ${SELECTIVE_HEAD_LIVE_MODEL.composition.supportThreshold};

@group(0) @binding(0) var<storage, read> lowFluid: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> lowFront: array<f32>;
@group(0) @binding(2) var<storage, read_write> predictedFluid: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> predictedFront: array<f32>;
@group(0) @binding(4) var<storage, read> model: array<f32>;
@group(0) @binding(5) var<storage, read_write> stats: array<atomic<u32>>;
@group(0) @binding(6) var<storage, read_write> lowSnapshotFluid: array<vec4<f32>>;
@group(0) @binding(7) var<storage, read_write> lowSnapshotFrontAndSupport: array<u32>;

struct FeatureBundle {
  features: array<f32, ${FEATURE_COUNT}>,
  frontValue: f32,
};

fn index3(cell: vec3<u32>, grid: u32) -> u32 {
  return cell.x + cell.y * grid + cell.z * grid * grid;
}

fn standardize(raw: f32, featureIndex: u32) -> f32 {
  return (raw - model[featureIndex]) / model[${SELECTIVE_HEAD_LIVE_MODEL.normalization.featureStd.offset}u + featureIndex];
}

fn inferHead(
  features: array<f32, ${FEATURE_COUNT}>,
  w1Offset: u32,
  b1Offset: u32,
  w2Offset: u32,
  b2Offset: u32,
  targetMeanOffset: u32,
  targetStdOffset: u32,
) -> f32 {
  var hidden: array<f32, ${HIDDEN_WIDTH}>;
  for (var hiddenIndex = 0u; hiddenIndex < HIDDEN_WIDTH; hiddenIndex += 1u) {
    var value = model[b1Offset + hiddenIndex];
    for (var featureIndex = 0u; featureIndex < FEATURE_COUNT; featureIndex += 1u) {
      value += features[featureIndex] * model[w1Offset + featureIndex * HIDDEN_WIDTH + hiddenIndex];
    }
    hidden[hiddenIndex] = tanh(value);
  }
  var result = model[b2Offset];
  for (var hiddenIndex = 0u; hiddenIndex < HIDDEN_WIDTH; hiddenIndex += 1u) {
    result += hidden[hiddenIndex] * model[w2Offset + hiddenIndex];
  }
  return result * model[targetStdOffset] + model[targetMeanOffset];
}

fn makeFeatureBundle(gid: vec3<u32>, writeBase: bool) -> FeatureBundle {
  let lowCell = min(vec3<u32>(LOW_GRID - 1u), vec3<u32>(floor(vec3<f32>(gid) * f32(LOW_GRID) / f32(HIGH_GRID))));
  let lowIndex = index3(lowCell, LOW_GRID);
  let highIndex = index3(gid, HIGH_GRID);
  if (writeBase && highIndex < LOW_GRID * LOW_GRID * LOW_GRID) {
    for (var slot = 0u; slot < SLOTS_PER_CELL; slot += 1u) {
      lowSnapshotFluid[highIndex * SLOTS_PER_CELL + slot] = lowFluid[highIndex * SLOTS_PER_CELL + slot];
    }
    lowSnapshotFrontAndSupport[highIndex] = bitcast<u32>(lowFront[highIndex]);
  }
  var lowValues: array<f32, 17>;
  for (var slot = 0u; slot < SLOTS_PER_CELL; slot += 1u) {
    let value = lowFluid[lowIndex * SLOTS_PER_CELL + slot];
    lowValues[slot * 4u + 0u] = value.x;
    lowValues[slot * 4u + 1u] = value.y;
    lowValues[slot * 4u + 2u] = value.z;
    lowValues[slot * 4u + 3u] = value.w;
    if (writeBase) {
      predictedFluid[highIndex * SLOTS_PER_CELL + slot] = value;
    }
  }
  lowValues[16] = lowFront[lowIndex];
  var features: array<f32, ${FEATURE_COUNT}>;
  for (var i = 0u; i < 17u; i += 1u) {
    features[i] = standardize(lowValues[i], i);
    features[17u + i] = standardize(lowValues[i] * lowValues[i], 17u + i);
  }
  let normalized = vec3<f32>(gid) / f32(HIGH_GRID - 1u) * 2.0 - vec3<f32>(1.0);
  let radial = length(normalized.xz);
  let positionFeatures = array<f32, 5>(normalized.x, normalized.y, normalized.z, radial, normalized.y * radial);
  for (var i = 0u; i < 5u; i += 1u) {
    features[34u + i] = standardize(positionFeatures[i], 34u + i);
  }
  var featureIndex = 39u;
  for (var frequencyIndex = 0u; frequencyIndex < 3u; frequencyIndex += 1u) {
    let frequency = select(select(1.0, 2.0, frequencyIndex == 1u), 4.0, frequencyIndex == 2u);
    for (var axis = 0u; axis < 3u; axis += 1u) {
      let phase = 3.141592653589793 * frequency * normalized[axis];
      features[featureIndex] = standardize(sin(phase), featureIndex);
      featureIndex += 1u;
      features[featureIndex] = standardize(cos(phase), featureIndex);
      featureIndex += 1u;
    }
  }
  for (var cyIndex = 0u; cyIndex < 8u; cyIndex += 1u) {
    let cy = -0.95 + f32(cyIndex) * (1.8 / 7.0);
    for (var czIndex = 0u; czIndex < 4u; czIndex += 1u) {
      let cz = -0.75 + f32(czIndex) * 0.5;
      for (var cxIndex = 0u; cxIndex < 4u; cxIndex += 1u) {
        let cx = -0.75 + f32(cxIndex) * 0.5;
        let delta = normalized - vec3<f32>(cx, cy, cz);
        let rbf = exp(-dot(delta, delta) / (2.0 * 0.30 * 0.30));
        features[featureIndex] = standardize(rbf, featureIndex);
        featureIndex += 1u;
      }
    }
  }
  return FeatureBundle(features, lowValues[16]);
}

@compute @workgroup_size(4, 4, 4)
fn reconstructSupportAndFront(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (any(gid >= vec3<u32>(HIGH_GRID))) { return; }
  let highIndex = index3(gid, HIGH_GRID);
  let bundle = makeFeatureBundle(gid, true);
  let classifierLogit = inferHead(bundle.features, ${wgslOffsets('supportProbability')});
  let probability = 1.0 / (1.0 + exp(-clamp(classifierLogit, -30.0, 30.0)));
  let hardSupport = select(0.0, 1.0, probability >= SUPPORT_THRESHOLD);
  if (hardSupport > 0.5) {
    let compactIndex = atomicAdd(&stats[0], 1u);
    lowSnapshotFrontAndSupport[LOW_GRID * LOW_GRID * LOW_GRID + compactIndex] = highIndex;
  }
  predictedFront[highIndex] = bundle.frontValue + inferHead(bundle.features, ${wgslOffsets('frontTopology')});
}

@compute @workgroup_size(${RESIDUAL_WORKGROUP_SIZE})
fn reconstructSupportResiduals(@builtin(global_invocation_id) gid: vec3<u32>) {
  let supportCount = atomicLoad(&stats[0]);
  let compactIndex = gid.x;
  if (compactIndex >= supportCount) { return; }
  let highIndex = lowSnapshotFrontAndSupport[LOW_GRID * LOW_GRID * LOW_GRID + compactIndex];
  let z = highIndex / (HIGH_GRID * HIGH_GRID);
  let y = (highIndex - z * HIGH_GRID * HIGH_GRID) / HIGH_GRID;
  let x = highIndex - z * HIGH_GRID * HIGH_GRID - y * HIGH_GRID;
  let highCell = vec3<u32>(x, y, z);
  let bundle = makeFeatureBundle(highCell, false);
  var material = predictedFluid[highIndex * SLOTS_PER_CELL + 1u];
  var fire = predictedFluid[highIndex * SLOTS_PER_CELL + 2u];
  var micro = predictedFluid[highIndex * SLOTS_PER_CELL + 3u];
  material.z += inferHead(bundle.features, ${wgslOffsets('fuel')});
  fire.z += inferHead(bundle.features, ${wgslOffsets('visibleFireCarrier')});
  micro.z += inferHead(bundle.features, ${wgslOffsets('fireLick')});
  predictedFluid[highIndex * SLOTS_PER_CELL + 1u] = material;
  predictedFluid[highIndex * SLOTS_PER_CELL + 2u] = fire;
  predictedFluid[highIndex * SLOTS_PER_CELL + 3u] = micro;
}
`;

const FRONT_UPSAMPLE_WGSL = `
const LOW_GRID: u32 = ${LOW_GRID}u;
const HIGH_GRID: u32 = ${HIGH_GRID}u;

@group(0) @binding(0) var<storage, read> lowFront: array<f32>;
@group(0) @binding(1) var<storage, read_write> nativeUpsampleFront: array<f32>;

fn index3(cell: vec3<u32>, grid: u32) -> u32 {
  return cell.x + cell.y * grid + cell.z * grid * grid;
}

@compute @workgroup_size(4, 4, 4)
fn upsampleNativeFront(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (any(gid >= vec3<u32>(HIGH_GRID))) { return; }
  let lowCell = min(vec3<u32>(LOW_GRID - 1u), vec3<u32>(floor(vec3<f32>(gid) * f32(LOW_GRID) / f32(HIGH_GRID))));
  nativeUpsampleFront[index3(gid, HIGH_GRID)] = lowFront[index3(lowCell, LOW_GRID)];
}
`;

const DETERMINISTIC_NATIVE_UPSAMPLE_WGSL = `
const LOW_GRID: u32 = ${LOW_GRID}u;
const HIGH_GRID: u32 = ${HIGH_GRID}u;
const SLOTS_PER_CELL: u32 = ${SLOTS_PER_CELL}u;

@group(0) @binding(0) var<storage, read> lowFluid: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> lowFront: array<f32>;
@group(0) @binding(2) var<storage, read_write> highFluid: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> highFront: array<f32>;

fn index3(cell: vec3<u32>, grid: u32) -> u32 {
  return cell.x + cell.y * grid + cell.z * grid * grid;
}

@compute @workgroup_size(4, 4, 4)
fn upsampleNativeState(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (any(gid >= vec3<u32>(HIGH_GRID))) { return; }
  let lowCell = min(vec3<u32>(LOW_GRID - 1u), vec3<u32>(floor(vec3<f32>(gid) * f32(LOW_GRID) / f32(HIGH_GRID))));
  let lowIndex = index3(lowCell, LOW_GRID);
  let highIndex = index3(gid, HIGH_GRID);
  for (var slot = 0u; slot < SLOTS_PER_CELL; slot += 1u) {
    highFluid[highIndex * SLOTS_PER_CELL + slot] = lowFluid[lowIndex * SLOTS_PER_CELL + slot];
  }
  highFront[highIndex] = lowFront[lowIndex];
}
`;

const SOURCE_HISTORY_ADMISSION_WGSL = `
const LOW_GRID: u32 = ${LOW_GRID}u;
const HIGH_GRID: u32 = ${HIGH_GRID}u;
const SLOTS_PER_CELL: u32 = ${SLOTS_PER_CELL}u;
const SOURCE_DELTA_THRESHOLD: f32 = ${SOURCE_DELTA_THRESHOLD};

@group(0) @binding(0) var<storage, read> lowFluid: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> lowFront: array<f32>;
@group(0) @binding(2) var<storage, read> priorLowFluid: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> priorLowFrontAndSupport: array<u32>;
@group(0) @binding(4) var<storage, read_write> sourceHistoryCandidates: array<u32>;
@group(0) @binding(5) var<storage, read_write> sourceHistoryStats: array<atomic<u32>>;

fn index3(cell: vec3<u32>, grid: u32) -> u32 {
  return cell.x + cell.y * grid + cell.z * grid * grid;
}

fn divCeil(value: u32, divisor: u32) -> u32 {
  return (value + divisor - 1u) / divisor;
}

fn sourceDeltaScale(channel: u32) -> f32 {
${SOURCE_DELTA_SCALE_WGSL}
  return 1.0;
}

fn deltaScore(channel: u32, current: f32, prior: f32) -> f32 {
  return abs(current - prior) / max(sourceDeltaScale(channel), 0.000001);
}

@compute @workgroup_size(4, 4, 4)
fn admitFixedSourceDelta(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (any(gid >= vec3<u32>(LOW_GRID))) { return; }
  if (atomicLoad(&sourceHistoryStats[3]) == 0u) { return; }
  let lowIndex = index3(gid, LOW_GRID);
  var score = 0.0;
  for (var slot = 0u; slot < SLOTS_PER_CELL; slot += 1u) {
    let current = lowFluid[lowIndex * SLOTS_PER_CELL + slot];
    let prior = priorLowFluid[lowIndex * SLOTS_PER_CELL + slot];
    score = max(score, deltaScore(slot * 4u + 0u, current.x, prior.x));
    score = max(score, deltaScore(slot * 4u + 1u, current.y, prior.y));
    score = max(score, deltaScore(slot * 4u + 2u, current.z, prior.z));
    score = max(score, deltaScore(slot * 4u + 3u, current.w, prior.w));
  }
  let currentFront = lowFront[lowIndex];
  let priorFront = bitcast<f32>(priorLowFrontAndSupport[lowIndex]);
  score = max(score, deltaScore(16u, currentFront, priorFront));
  if (score < SOURCE_DELTA_THRESHOLD) { return; }
  atomicAdd(&sourceHistoryStats[0], 1u);
  let hx0 = divCeil(gid.x * HIGH_GRID, LOW_GRID);
  let hx1 = divCeil((gid.x + 1u) * HIGH_GRID, LOW_GRID);
  let hy0 = divCeil(gid.y * HIGH_GRID, LOW_GRID);
  let hy1 = divCeil((gid.y + 1u) * HIGH_GRID, LOW_GRID);
  let hz0 = divCeil(gid.z * HIGH_GRID, LOW_GRID);
  let hz1 = divCeil((gid.z + 1u) * HIGH_GRID, LOW_GRID);
  for (var hz = hz0; hz < hz1; hz += 1u) {
    for (var hy = hy0; hy < hy1; hy += 1u) {
      for (var hx = hx0; hx < hx1; hx += 1u) {
        let writeIndex = atomicAdd(&sourceHistoryStats[1], 1u);
        sourceHistoryCandidates[writeIndex] = index3(vec3<u32>(hx, hy, hz), HIGH_GRID);
      }
    }
  }
}
`;

const FINALIZE_RESIDUAL_DISPATCH_WGSL = `
const RESIDUAL_WORKGROUP_SIZE: u32 = ${RESIDUAL_WORKGROUP_SIZE}u;

@group(0) @binding(0) var<storage, read_write> stats: array<atomic<u32>>;
@group(0) @binding(1) var<storage, read_write> residualDispatchArgs: array<u32>;

@compute @workgroup_size(1)
fn finalizeResidualDispatchArgs() {
  let supportCount = atomicLoad(&stats[0]);
  let workgroups = (supportCount + RESIDUAL_WORKGROUP_SIZE - 1u) / RESIDUAL_WORKGROUP_SIZE;
  residualDispatchArgs[0] = workgroups;
  residualDispatchArgs[1] = 1u;
  residualDispatchArgs[2] = 1u;
  residualDispatchArgs[3] = supportCount;
}
`;

const FINALIZE_SOURCE_HISTORY_DISPATCH_WGSL = `
const RESIDUAL_WORKGROUP_SIZE: u32 = ${RESIDUAL_WORKGROUP_SIZE}u;

@group(0) @binding(0) var<storage, read_write> sourceHistoryStats: array<atomic<u32>>;
@group(0) @binding(1) var<storage, read_write> sourceHistoryDispatchArgs: array<u32>;

@compute @workgroup_size(1)
fn finalizeSourceHistoryDispatchArgs() {
  let candidateCount = atomicLoad(&sourceHistoryStats[1]);
  let workgroups = (candidateCount + RESIDUAL_WORKGROUP_SIZE - 1u) / RESIDUAL_WORKGROUP_SIZE;
  sourceHistoryDispatchArgs[0] = workgroups;
  sourceHistoryDispatchArgs[1] = 1u;
  sourceHistoryDispatchArgs[2] = 1u;
  sourceHistoryDispatchArgs[3] = candidateCount;
}
`;

function candidateHeadBenchmarkWgsl(width) {
  return `
const LOW_GRID: u32 = ${LOW_GRID}u;
const HIGH_GRID: u32 = ${HIGH_GRID}u;
const SLOTS_PER_CELL: u32 = ${SLOTS_PER_CELL}u;
const RESIDUAL_WORKGROUP_SIZE: u32 = ${RESIDUAL_WORKGROUP_SIZE}u;
const BENCHMARK_WIDTH: u32 = ${width}u;
const INPUT_COUNT: u32 = ${CANDIDATE_HEAD_INPUT_COUNT}u;

@group(0) @binding(0) var<storage, read> lowFluid: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> lowFront: array<f32>;
@group(0) @binding(2) var<storage, read> priorLowFluid: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> priorLowFrontAndSupport: array<u32>;
@group(0) @binding(4) var<storage, read> sourceHistoryCandidates: array<u32>;
@group(0) @binding(5) var<storage, read> sourceHistoryDispatchArgs: array<u32>;
@group(0) @binding(6) var<storage, read_write> candidateCueRecords: array<vec4<f32>>;
@group(0) @binding(7) var<storage, read> candidateCueLifecycleParams: array<u32>;

fn index3(cell: vec3<u32>, grid: u32) -> u32 {
  return cell.x + cell.y * grid + cell.z * grid * grid;
}

fn syntheticWeight(a: u32, b: u32, salt: f32) -> f32 {
  return (fract(sin(f32(a * 131u + b * 17u + 11u)) * 43758.5453 + salt) - 0.5) * 0.125;
}

@compute @workgroup_size(${RESIDUAL_WORKGROUP_SIZE})
fn benchmarkCandidateHead(@builtin(global_invocation_id) gid: vec3<u32>) {
  let compactIndex = gid.x;
  let candidateCount = sourceHistoryDispatchArgs[3];
  if (compactIndex >= candidateCount) { return; }
  let highIndex = sourceHistoryCandidates[compactIndex];
  let z = highIndex / (HIGH_GRID * HIGH_GRID);
  let y = (highIndex - z * HIGH_GRID * HIGH_GRID) / HIGH_GRID;
  let x = highIndex - z * HIGH_GRID * HIGH_GRID - y * HIGH_GRID;
  let highCell = vec3<u32>(x, y, z);
  let lowCell = min(vec3<u32>(LOW_GRID - 1u), vec3<u32>(floor(vec3<f32>(highCell) * f32(LOW_GRID) / f32(HIGH_GRID))));
  let lowIndex = index3(lowCell, LOW_GRID);
  var inputs: array<f32, ${CANDIDATE_HEAD_INPUT_COUNT}>;
  for (var slot = 0u; slot < SLOTS_PER_CELL; slot += 1u) {
    let current = lowFluid[lowIndex * SLOTS_PER_CELL + slot];
    let prior = priorLowFluid[lowIndex * SLOTS_PER_CELL + slot];
    inputs[slot * 4u + 0u] = current.x;
    inputs[slot * 4u + 1u] = current.y;
    inputs[slot * 4u + 2u] = current.z;
    inputs[slot * 4u + 3u] = current.w;
    inputs[17u + slot * 4u + 0u] = current.x - prior.x;
    inputs[17u + slot * 4u + 1u] = current.y - prior.y;
    inputs[17u + slot * 4u + 2u] = current.z - prior.z;
    inputs[17u + slot * 4u + 3u] = current.w - prior.w;
  }
  let currentFront = lowFront[lowIndex];
  let priorFront = bitcast<f32>(priorLowFrontAndSupport[lowIndex]);
  inputs[16u] = currentFront;
  inputs[33u] = currentFront - priorFront;
  let normalized = vec3<f32>(highCell) / f32(HIGH_GRID - 1u);
  let lowCellFloat = vec3<f32>(highCell) * f32(LOW_GRID) / f32(HIGH_GRID);
  let subcell = fract(lowCellFloat);
  inputs[34u] = normalized.x;
  inputs[35u] = normalized.y;
  inputs[36u] = normalized.z;
  inputs[37u] = subcell.x;
  inputs[38u] = subcell.y;
  inputs[39u] = subcell.z;
  let centered = normalized * 2.0 - vec3<f32>(1.0);
  inputs[40u] = sin(centered.x * 3.14159265);
  inputs[41u] = cos(centered.x * 3.14159265);
  inputs[42u] = sin(centered.y * 3.14159265);
  inputs[43u] = cos(centered.y * 3.14159265);
  inputs[44u] = sin(centered.z * 3.14159265);
  inputs[45u] = cos(centered.z * 3.14159265);
  inputs[46u] = length(centered.xz);
  inputs[47u] = centered.y * inputs[46u];

  var hidden: array<f32, ${width}>;
  for (var h = 0u; h < BENCHMARK_WIDTH; h += 1u) {
    var value = syntheticWeight(999u, h, 0.03125);
    for (var i = 0u; i < INPUT_COUNT; i += 1u) {
      value += inputs[i] * syntheticWeight(i, h, 0.0625);
    }
    hidden[h] = tanh(value);
  }
  var outputs: array<f32, ${CANDIDATE_HEAD_OUTPUT_COUNT}>;
  for (var o = 0u; o < ${CANDIDATE_HEAD_OUTPUT_COUNT}u; o += 1u) {
    var value = syntheticWeight(777u, o, 0.09375);
    for (var h = 0u; h < BENCHMARK_WIDTH; h += 1u) {
      value += hidden[h] * syntheticWeight(h, o + 101u, 0.125);
    }
    outputs[o] = value;
  }
  let outBase = compactIndex * 2u;
  let lifecycleEnabled = candidateCueLifecycleParams[3] != 0u;
  let lifecycleToken = candidateCueLifecycleParams[0];
  let diagnosticW = select(outputs[4], bitcast<f32>(lifecycleToken), lifecycleEnabled);
  candidateCueRecords[outBase] = vec4<f32>(normalized, outputs[0]);
  candidateCueRecords[outBase + 1u] = vec4<f32>(outputs[1], outputs[2], outputs[3], diagnosticW);
}
`;
}

const NATIVE96_SPARSE_FRONT_CONTINUITY_WGSL = `
const LOW_GRID: u32 = ${LOW_GRID}u;
const HIGH_GRID: u32 = ${HIGH_GRID}u;
const SLOTS_PER_CELL: u32 = ${SLOTS_PER_CELL}u;
const FEATURE_COUNT: u32 = ${FEATURE_COUNT}u;
const HIDDEN_WIDTH: u32 = ${HIDDEN_WIDTH}u;
const RESIDUAL_WORKGROUP_SIZE: u32 = ${RESIDUAL_WORKGROUP_SIZE}u;
const FRONT_W1_OFFSET: u32 = 370u;
const FRONT_B1_OFFSET: u32 = 9250u;
const FRONT_W2_OFFSET: u32 = 9298u;
const FRONT_B2_OFFSET: u32 = 9346u;
const FRONT_TARGET_MEAN_OFFSET: u32 = 9347u;
const FRONT_TARGET_STD_OFFSET: u32 = 9348u;

@group(0) @binding(0) var<storage, read> lowFluid: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> lowFront: array<f32>;
@group(0) @binding(2) var<storage, read> sourceHistoryCandidates: array<u32>;
@group(0) @binding(3) var<storage, read> sourceHistoryDispatchArgs: array<u32>;
@group(0) @binding(4) var<storage, read> exactFrontTeacherModel: array<f32>;
@group(0) @binding(5) var<storage, read_write> predictedFluid: array<vec4<f32>>;
@group(0) @binding(6) var<storage, read_write> sparseFrontResidual: array<f32>;
@group(0) @binding(7) var<storage, read_write> sparseFrontContinuityFront: array<f32>;

struct FeatureBundle {
  features: array<f32, ${FEATURE_COUNT}>,
  frontValue: f32,
};

fn index3(cell: vec3<u32>, grid: u32) -> u32 {
  return cell.x + cell.y * grid + cell.z * grid * grid;
}

fn standardize(raw: f32, featureIndex: u32) -> f32 {
  return (raw - exactFrontTeacherModel[featureIndex]) / exactFrontTeacherModel[${NATIVE96_EXACT_FRONT_TEACHER_MODEL.normalization.featureStd.offset}u + featureIndex];
}

fn inferFrontTeacher(features: array<f32, ${FEATURE_COUNT}>) -> f32 {
  var hidden: array<f32, ${HIDDEN_WIDTH}>;
  for (var hiddenIndex = 0u; hiddenIndex < HIDDEN_WIDTH; hiddenIndex += 1u) {
    var value = exactFrontTeacherModel[FRONT_B1_OFFSET + hiddenIndex];
    for (var featureIndex = 0u; featureIndex < FEATURE_COUNT; featureIndex += 1u) {
      value += features[featureIndex] * exactFrontTeacherModel[FRONT_W1_OFFSET + featureIndex * HIDDEN_WIDTH + hiddenIndex];
    }
    hidden[hiddenIndex] = tanh(value);
  }
  var result = exactFrontTeacherModel[FRONT_B2_OFFSET];
  for (var hiddenIndex = 0u; hiddenIndex < HIDDEN_WIDTH; hiddenIndex += 1u) {
    result += hidden[hiddenIndex] * exactFrontTeacherModel[FRONT_W2_OFFSET + hiddenIndex];
  }
  return result * exactFrontTeacherModel[FRONT_TARGET_STD_OFFSET] + exactFrontTeacherModel[FRONT_TARGET_MEAN_OFFSET];
}

fn makeFeatureBundle(gid: vec3<u32>) -> FeatureBundle {
  let lowCell = min(vec3<u32>(LOW_GRID - 1u), vec3<u32>(floor(vec3<f32>(gid) * f32(LOW_GRID) / f32(HIGH_GRID))));
  let lowIndex = index3(lowCell, LOW_GRID);
  var lowValues: array<f32, 17>;
  for (var slot = 0u; slot < SLOTS_PER_CELL; slot += 1u) {
    let value = lowFluid[lowIndex * SLOTS_PER_CELL + slot];
    lowValues[slot * 4u + 0u] = value.x;
    lowValues[slot * 4u + 1u] = value.y;
    lowValues[slot * 4u + 2u] = value.z;
    lowValues[slot * 4u + 3u] = value.w;
  }
  lowValues[16] = lowFront[lowIndex];
  var features: array<f32, ${FEATURE_COUNT}>;
  for (var i = 0u; i < 17u; i += 1u) {
    features[i] = standardize(lowValues[i], i);
    features[17u + i] = standardize(lowValues[i] * lowValues[i], 17u + i);
  }
  let normalized = vec3<f32>(gid) / f32(HIGH_GRID - 1u) * 2.0 - vec3<f32>(1.0);
  let radial = length(normalized.xz);
  let positionFeatures = array<f32, 5>(normalized.x, normalized.y, normalized.z, radial, normalized.y * radial);
  for (var i = 0u; i < 5u; i += 1u) {
    features[34u + i] = standardize(positionFeatures[i], 34u + i);
  }
  var featureIndex = 39u;
  for (var frequencyIndex = 0u; frequencyIndex < 3u; frequencyIndex += 1u) {
    let frequency = select(select(1.0, 2.0, frequencyIndex == 1u), 4.0, frequencyIndex == 2u);
    for (var axis = 0u; axis < 3u; axis += 1u) {
      let phase = 3.141592653589793 * frequency * normalized[axis];
      features[featureIndex] = standardize(sin(phase), featureIndex);
      featureIndex += 1u;
      features[featureIndex] = standardize(cos(phase), featureIndex);
      featureIndex += 1u;
    }
  }
  for (var cyIndex = 0u; cyIndex < 8u; cyIndex += 1u) {
    let cy = -0.95 + f32(cyIndex) * (1.8 / 7.0);
    for (var czIndex = 0u; czIndex < 4u; czIndex += 1u) {
      let cz = -0.75 + f32(czIndex) * 0.5;
      for (var cxIndex = 0u; cxIndex < 4u; cxIndex += 1u) {
        let cx = -0.75 + f32(cxIndex) * 0.5;
        let delta = normalized - vec3<f32>(cx, cy, cz);
        let rbf = exp(-dot(delta, delta) / (2.0 * 0.30 * 0.30));
        features[featureIndex] = standardize(rbf, featureIndex);
        featureIndex += 1u;
      }
    }
  }
  return FeatureBundle(features, lowValues[16]);
}

@compute @workgroup_size(4, 4, 4)
fn initializeNative96SparseFrontContinuity(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (any(gid >= vec3<u32>(HIGH_GRID))) { return; }
  let highIndex = index3(gid, HIGH_GRID);
  let lowCell = min(vec3<u32>(LOW_GRID - 1u), vec3<u32>(floor(vec3<f32>(gid) * f32(LOW_GRID) / f32(HIGH_GRID))));
  let lowIndex = index3(lowCell, LOW_GRID);
  for (var slot = 0u; slot < SLOTS_PER_CELL; slot += 1u) {
    predictedFluid[highIndex * SLOTS_PER_CELL + slot] = lowFluid[lowIndex * SLOTS_PER_CELL + slot];
  }
  sparseFrontResidual[highIndex] = 0.0;
  sparseFrontContinuityFront[highIndex] = lowFront[lowIndex];
}

@compute @workgroup_size(${RESIDUAL_WORKGROUP_SIZE})
fn evalNative96ExactFrontTeacherCandidates(@builtin(global_invocation_id) gid: vec3<u32>) {
  let compactIndex = gid.x;
  let candidateCount = sourceHistoryDispatchArgs[3];
  if (compactIndex >= candidateCount) { return; }
  let highIndex = sourceHistoryCandidates[compactIndex];
  let z = highIndex / (HIGH_GRID * HIGH_GRID);
  let y = (highIndex - z * HIGH_GRID * HIGH_GRID) / HIGH_GRID;
  let x = highIndex - z * HIGH_GRID * HIGH_GRID - y * HIGH_GRID;
  let highCell = vec3<u32>(x, y, z);
  let bundle = makeFeatureBundle(highCell);
  sparseFrontResidual[highIndex] = inferFrontTeacher(bundle.features);
}

fn clampedIndex(ix: i32, iy: i32, iz: i32) -> u32 {
  let x = u32(clamp(ix, 0, i32(HIGH_GRID) - 1));
  let y = u32(clamp(iy, 0, i32(HIGH_GRID) - 1));
  let z = u32(clamp(iz, 0, i32(HIGH_GRID) - 1));
  return index3(vec3<u32>(x, y, z), HIGH_GRID);
}

@compute @workgroup_size(4, 4, 4)
fn featherNative96SparseFrontContinuity(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (any(gid >= vec3<u32>(HIGH_GRID))) { return; }
  let highIndex = index3(gid, HIGH_GRID);
  let baseFront = sparseFrontContinuityFront[highIndex];
  var weightedResidual = 0.0;
  var weightSum = 0.0;
  let c = vec3<i32>(i32(gid.x), i32(gid.y), i32(gid.z));
  for (var dz = -2; dz <= 2; dz += 1) {
    for (var dy = -2; dy <= 2; dy += 1) {
      for (var dx = -2; dx <= 2; dx += 1) {
        let dist2 = f32(dx * dx + dy * dy + dz * dz);
        let neighbor = clampedIndex(c.x + dx, c.y + dy, c.z + dz);
        let residual = sparseFrontResidual[neighbor];
        let present = step(0.000001, abs(residual));
        let weight = exp(-dist2 / 5.50) * present;
        weightedResidual += residual * weight;
        weightSum += weight;
      }
    }
  }
  let ownResidual = sparseFrontResidual[highIndex];
  let reconstructedResidual = select(weightedResidual / max(weightSum, 0.000001), ownResidual, abs(ownResidual) > 0.000001);
  let featherConfidence = smoothstep(0.0, 0.18, weightSum);
  sparseFrontContinuityFront[highIndex] = max(0.0, baseFront + reconstructedResidual * featherConfidence);
}
`;

const NATIVE96_F16_SPARSE_FRONT_CONTINUITY_WGSL = NATIVE96_SPARSE_FRONT_CONTINUITY_WGSL
  .replace(/^/, 'enable f16;\n')
  .replace('var<storage, read> exactFrontTeacherModel: array<f32>;', 'var<storage, read> exactFrontTeacherModel: array<f16>;')
  .replace('features: array<f32, 185>,', 'features: array<f16, 185>,')
  .replace(
    'fn standardize(raw: f32, featureIndex: u32) -> f32 {\n  return (raw - exactFrontTeacherModel[featureIndex]) / exactFrontTeacherModel[185u + featureIndex];\n}',
    'fn standardize(raw: f32, featureIndex: u32) -> f16 {\n  return (f16(raw) - exactFrontTeacherModel[featureIndex]) / exactFrontTeacherModel[185u + featureIndex];\n}',
  )
  .replace('fn inferFrontTeacher(features: array<f32, 185>) -> f32 {', 'fn inferFrontTeacher(features: array<f16, 185>) -> f32 {')
  .replace('var hidden: array<f32, 48>;', 'var hidden: array<f16, 48>;')
  .replace(
    'return result * exactFrontTeacherModel[FRONT_TARGET_STD_OFFSET] + exactFrontTeacherModel[FRONT_TARGET_MEAN_OFFSET];',
    'return f32(result * exactFrontTeacherModel[FRONT_TARGET_STD_OFFSET] + exactFrontTeacherModel[FRONT_TARGET_MEAN_OFFSET]);',
  )
  .replace('var features: array<f32, 185>;', 'var features: array<f16, 185>;');

const NATIVE96_FRONT_AUTHORITY_GATED_SPARSE_FRONT_CONTINUITY_WGSL = NATIVE96_SPARSE_FRONT_CONTINUITY_WGSL
  .replace(
    '@group(0) @binding(7) var<storage, read_write> sparseFrontContinuityFront: array<f32>;',
    '@group(0) @binding(7) var<storage, read_write> sparseFrontContinuityFront: array<f32>;\n@group(0) @binding(8) var<storage, read_write> sourceHistoryStats: array<atomic<u32>>;',
  )
  .replace(
    'let highIndex = sourceHistoryCandidates[compactIndex];\n  let z = highIndex / (HIGH_GRID * HIGH_GRID);',
    'let highIndex = sourceHistoryCandidates[compactIndex];\n  let frontAuthorityThreshold = bitcast<f32>(atomicLoad(&sourceHistoryStats[4]));\n  if (sparseFrontContinuityFront[highIndex] <= frontAuthorityThreshold) { return; }\n  atomicAdd(&sourceHistoryStats[2], 1u);\n  let z = highIndex / (HIGH_GRID * HIGH_GRID);',
  );

const VIVISECTOR_WIDTH32_RECEIVER_WGSL = `
const LOW_GRID: u32 = ${LOW_GRID}u;
const HIGH_GRID: u32 = ${HIGH_GRID}u;
const SLOTS_PER_CELL: u32 = ${SLOTS_PER_CELL}u;
const RESIDUAL_WORKGROUP_SIZE: u32 = ${RESIDUAL_WORKGROUP_SIZE}u;
const INPUT_COUNT: u32 = ${CANDIDATE_HEAD_INPUT_COUNT}u;
const HIDDEN_WIDTH: u32 = 32u;
const OUTPUT_COUNT: u32 = ${CANDIDATE_HEAD_OUTPUT_COUNT}u;
const FEATURE_MEAN_OFFSET: u32 = ${VIVISECTOR_FEATURE_MEAN_OFFSET}u;
const FEATURE_STD_OFFSET: u32 = ${VIVISECTOR_FEATURE_STD_OFFSET}u;
const TARGET_MEAN_OFFSET: u32 = ${VIVISECTOR_TARGET_MEAN_OFFSET}u;
const TARGET_STD_OFFSET: u32 = ${VIVISECTOR_TARGET_STD_OFFSET}u;
const W1_OFFSET: u32 = ${VIVISECTOR_W1_OFFSET}u;
const B1_OFFSET: u32 = ${VIVISECTOR_B1_OFFSET}u;
const W2_OFFSET: u32 = ${VIVISECTOR_W2_OFFSET}u;
const B2_OFFSET: u32 = ${VIVISECTOR_B2_OFFSET}u;

@group(0) @binding(0) var<storage, read> lowFluid: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> priorLowFluid: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> sourceHistoryCandidates: array<u32>;
@group(0) @binding(3) var<storage, read> sourceHistoryDispatchArgs: array<u32>;
@group(0) @binding(4) var<storage, read_write> candidateCueRecords: array<vec4<f32>>;

fn index3(cell: vec3<u32>, grid: u32) -> u32 {
  return cell.x + cell.y * grid + cell.z * grid * grid;
}

@compute @workgroup_size(${RESIDUAL_WORKGROUP_SIZE})
fn runVivisectorWidth32Receiver(@builtin(global_invocation_id) gid: vec3<u32>) {
  let compactIndex = gid.x;
  let candidateCount = sourceHistoryDispatchArgs[3];
  if (compactIndex >= candidateCount) { return; }
  let highIndex = sourceHistoryCandidates[compactIndex];
  let z = highIndex / (HIGH_GRID * HIGH_GRID);
  let y = (highIndex - z * HIGH_GRID * HIGH_GRID) / HIGH_GRID;
  let x = highIndex - z * HIGH_GRID * HIGH_GRID - y * HIGH_GRID;
  let highCell = vec3<u32>(x, y, z);
  let lowCell = min(vec3<u32>(LOW_GRID - 1u), vec3<u32>(floor(vec3<f32>(highCell) * f32(LOW_GRID) / f32(HIGH_GRID))));
  let lowIndex = index3(lowCell, LOW_GRID);
  var inputs: array<f32, ${CANDIDATE_HEAD_INPUT_COUNT}>;
  for (var slot = 0u; slot < SLOTS_PER_CELL; slot += 1u) {
    let current = lowFluid[lowIndex * SLOTS_PER_CELL + slot];
    let prior = priorLowFluid[lowIndex * SLOTS_PER_CELL + slot];
    inputs[slot * 4u + 0u] = current.x;
    inputs[slot * 4u + 1u] = current.y;
    inputs[slot * 4u + 2u] = current.z;
    inputs[slot * 4u + 3u] = current.w;
    inputs[17u + slot * 4u + 0u] = current.x - prior.x;
    inputs[17u + slot * 4u + 1u] = current.y - prior.y;
    inputs[17u + slot * 4u + 2u] = current.z - prior.z;
    inputs[17u + slot * 4u + 3u] = current.w - prior.w;
  }
  let normalized = vec3<f32>(highCell) / f32(HIGH_GRID - 1u);
  let lowCellFloat = vec3<f32>(highCell) * f32(LOW_GRID) / f32(HIGH_GRID);
  let subcell = fract(lowCellFloat);
  inputs[34u] = normalized.x;
  inputs[35u] = normalized.y;
  inputs[36u] = normalized.z;
  inputs[37u] = subcell.x;
  inputs[38u] = subcell.y;
  inputs[39u] = subcell.z;
  for (var i = 40u; i < INPUT_COUNT; i += 1u) {
    inputs[i] = 0.0;
  }
${VIVISECTOR_WIDTH32_RECEIVER_EVAL_WGSL}
  let outBase = compactIndex * 2u;
  candidateCueRecords[outBase] = vec4<f32>(normalized, output0);
  candidateCueRecords[outBase + 1u] = vec4<f32>(output1, output2, output3, output4);
}
`;

const CANDIDATE_CUE_LIFECYCLE_WGSL = `
const RESIDUAL_WORKGROUP_SIZE: u32 = ${RESIDUAL_WORKGROUP_SIZE}u;

@group(0) @binding(0) var<storage, read_write> candidateCueRecords: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> sourceHistoryDispatchArgs: array<u32>;
@group(0) @binding(2) var<storage, read_write> lifecycleStats: array<atomic<u32>>;
@group(0) @binding(3) var<storage, read> lifecycleParams: array<u32>;

@compute @workgroup_size(${RESIDUAL_WORKGROUP_SIZE})
fn clearAndCheckCandidateCueLifecycle(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  let currentCount = sourceHistoryDispatchArgs[3];
  let previousCount = lifecycleParams[1];
  let capacity = lifecycleParams[2];
  let token = lifecycleParams[0];
  if (index == 0u) {
    atomicStore(&lifecycleStats[4], currentCount);
    atomicStore(&lifecycleStats[5], previousCount);
    atomicStore(&lifecycleStats[6], token);
    atomicStore(&lifecycleStats[7], capacity);
  }
  if (index >= capacity) { return; }
  if (index < currentCount) {
    atomicAdd(&lifecycleStats[0], 1u);
    let observed = bitcast<u32>(candidateCueRecords[index * 2u + 1u].w);
    if (observed != token) {
      atomicAdd(&lifecycleStats[1], 1u);
    }
    return;
  }
  if (index < previousCount) {
    atomicAdd(&lifecycleStats[2], 1u);
    candidateCueRecords[index * 2u + 1u].w = bitcast<f32>(0u);
    let observed = bitcast<u32>(candidateCueRecords[index * 2u + 1u].w);
    if (observed != 0u) {
      atomicAdd(&lifecycleStats[3], 1u);
    }
  }
}
`;

async function sha256Hex(bytes) {
  const buffer = bytes instanceof ArrayBuffer ? bytes : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
}

async function readU32Buffer(device, source, byteLength, label) {
  const readback = device.createBuffer({
    label,
    size: byteLength,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const encoder = device.createCommandEncoder({ label: `${label} encoder` });
  encoder.copyBufferToBuffer(source, 0, readback, 0, byteLength);
  device.queue.submit([encoder.finish()]);
  await readback.mapAsync(GPUMapMode.READ);
  const values = new Uint32Array(readback.getMappedRange()).slice();
  readback.unmap();
  readback.destroy();
  return values;
}

async function readU32BufferRange(device, source, sourceOffset, byteLength, label) {
  if (byteLength <= 0) return new Uint32Array(0);
  const readback = device.createBuffer({
    label,
    size: byteLength,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const encoder = device.createCommandEncoder({ label: `${label} encoder` });
  encoder.copyBufferToBuffer(source, sourceOffset, readback, 0, byteLength);
  device.queue.submit([encoder.finish()]);
  await readback.mapAsync(GPUMapMode.READ);
  const values = new Uint32Array(readback.getMappedRange()).slice();
  readback.unmap();
  readback.destroy();
  return values;
}

export async function createNativeLowSelectiveSharedDeviceRuntime({ device, transferRouteId = NATIVE_LOW_TRANSFER_160_TO_128_ZERO_SHOT_ROUTE, sourceGrid = LOW_GRID } = {}) {
  if (!device) throw new Error('shared-device native-low runtime requires the renderer WebGPU device');
  const route = resolveNativeLowTrainedPackageRoute(transferRouteId);
  const selectedModel = route.model;
  const selectedModelUrl = route.modelUrl;
  const lowGrid = Number(sourceGrid);
  if (![96, 128].includes(lowGrid)) throw new Error(`unsupportedEffectiveSourceGrid:${sourceGrid}`);
  const response = await fetch(selectedModelUrl, { cache: 'no-store' });
  if (!response.ok) throw new Error(`modelFetchFailed:${response.status}`);
  const modelBytes = await response.arrayBuffer();
  const modelSha256 = await sha256Hex(modelBytes);
  if (modelBytes.byteLength !== selectedModel.packed.byteLength || modelSha256 !== selectedModel.packed.sha256) {
    throw new Error(`modelChecksumMismatch:${modelSha256}`);
  }
  const exactFrontTeacherResponse = await fetch(NATIVE96_EXACT_FRONT_TEACHER_MODEL_URL, { cache: 'no-store' });
  if (!exactFrontTeacherResponse.ok) throw new Error(`native96ExactFrontTeacherFetchFailed:${exactFrontTeacherResponse.status}`);
  const exactFrontTeacherBytes = await exactFrontTeacherResponse.arrayBuffer();
  const exactFrontTeacherSha256 = await sha256Hex(exactFrontTeacherBytes);
  if (
    exactFrontTeacherBytes.byteLength !== NATIVE96_EXACT_FRONT_TEACHER_MODEL.packed.byteLength
    || exactFrontTeacherSha256 !== NATIVE96_EXACT_FRONT_TEACHER_MODEL_SHA256
  ) {
    throw new Error(`native96ExactFrontTeacherChecksumMismatch:${exactFrontTeacherSha256}`);
  }
  const f16FrontTeacherResponse = await fetch(NATIVE96_F16_FRONT_TEACHER_URL, { cache: 'no-store' });
  if (!f16FrontTeacherResponse.ok) throw new Error(`native96F16FrontTeacherFetchFailed:${f16FrontTeacherResponse.status}`);
  const f16FrontTeacherBytes = await f16FrontTeacherResponse.arrayBuffer();
  const f16FrontTeacherSha256 = await sha256Hex(f16FrontTeacherBytes);
  if (
    f16FrontTeacherBytes.byteLength !== NATIVE96_F16_FRONT_TEACHER_BYTE_LENGTH
    || f16FrontTeacherSha256 !== NATIVE96_F16_FRONT_TEACHER_SHA256
  ) {
    throw new Error(`native96F16FrontTeacherChecksumMismatch:${f16FrontTeacherSha256}`);
  }
  const lowCells = lowGrid ** 3;
  const highCells = HIGH_GRID ** 3;
  const lowFluidBytes = lowCells * SLOTS_PER_CELL * 4 * Float32Array.BYTES_PER_ELEMENT;
  const lowFrontBytes = lowCells * Float32Array.BYTES_PER_ELEMENT;
  const lowFrontSnapshotAndSupportBytes = lowFrontBytes + highCells * Uint32Array.BYTES_PER_ELEMENT;
  const highFluidBytes = highCells * SLOTS_PER_CELL * 4 * Float32Array.BYTES_PER_ELEMENT;
  const highFrontBytes = highCells * Float32Array.BYTES_PER_ELEMENT;
  const makeBuffer = (label, size, usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST) => device.createBuffer({ label, size, usage });
  const lowSnapshotFluid = makeBuffer(`native-low shared-device low snapshot fluid ${lowGrid}^3`, lowFluidBytes);
  const lowSnapshotFront = makeBuffer(`native-low shared-device low snapshot front ${lowGrid}^3 plus support indices`, lowFrontSnapshotAndSupportBytes);
  const predictedFluid = makeBuffer('native-low shared-device predicted fluid 160^3', highFluidBytes);
  const predictedFront = makeBuffer('native-low shared-device predicted front 160^3', highFrontBytes);
  const nativeUpsampleFront = makeBuffer('native-low shared-device native-upsample front 160^3', highFrontBytes);
  const stats = makeBuffer('native-low shared-device support stats', STATS_BYTES);
  const sourceHistoryCandidates = makeBuffer('native-low fixed source-delta high-cell candidates', highCells * Uint32Array.BYTES_PER_ELEMENT);
  const sourceHistoryStats = makeBuffer('native-low fixed source-delta stats', SOURCE_HISTORY_STATS_BYTES);
  const candidateCueRecords = makeBuffer('native-low candidate-head benchmark compact cue records', highCells * CANDIDATE_CUE_RECORD_STRIDE_BYTES);
  const candidateCueLifecycleStats = makeBuffer('native-low candidate-head cue buffer lifecycle stats', CANDIDATE_CUE_LIFECYCLE_STATS_BYTES);
  const candidateCueLifecycleParams = makeBuffer('native-low candidate-head cue buffer lifecycle params', CANDIDATE_CUE_LIFECYCLE_PARAMS_BYTES);
  const residualDispatchArgs = makeBuffer(
    'native-low shared-device finalized residual dispatch args',
    INDIRECT_ARGS_BYTES,
    GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  );
  const sourceHistoryDispatchArgs = makeBuffer(
    'native-low fixed source-delta dispatch args',
    INDIRECT_ARGS_BYTES,
    GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  );
  const model = makeBuffer(`native-low shared-device model ${selectedModel.identity}`, modelBytes.byteLength, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
  device.queue.writeBuffer(model, 0, modelBytes);
  const native96ExactFrontTeacherModel = makeBuffer(
    `native-low shared-device exact native96 front teacher ${NATIVE96_EXACT_FRONT_TEACHER_MODEL.identity}`,
    exactFrontTeacherBytes.byteLength,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  );
  device.queue.writeBuffer(native96ExactFrontTeacherModel, 0, exactFrontTeacherBytes);
  const native96F16FrontTeacherModel = makeBuffer(
    `native-low shared-device f16 native96 front teacher ${NATIVE96_F16_FRONT_TEACHER_IDENTITY}`,
    Math.ceil(f16FrontTeacherBytes.byteLength / 4) * 4,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  );
  const paddedF16FrontTeacherBytes = new Uint8Array(Math.ceil(f16FrontTeacherBytes.byteLength / 4) * 4);
  paddedF16FrontTeacherBytes.set(new Uint8Array(f16FrontTeacherBytes));
  device.queue.writeBuffer(native96F16FrontTeacherModel, 0, paddedF16FrontTeacherBytes);
  const shader = device.createShaderModule({ label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} WGSL`, code: specializeLowGridWgsl(WGSL, lowGrid) });
  const compilation = await shader.getCompilationInfo();
  const errors = compilation.messages.filter(message => message.type === 'error');
  if (errors.length) throw new Error(`native-low shared-device WGSL failed:${errors.map(error => `${error.lineNum}:${error.linePos} ${error.message}`).join('; ')}`);
  const layout = device.createBindGroupLayout({
    label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} layout`,
    entries: Array.from({ length: 8 }, (_, binding) => ({
      binding,
      visibility: GPUShaderStage.COMPUTE,
      buffer: { type: binding === 0 || binding === 1 || binding === 4 ? 'read-only-storage' : 'storage' },
    })),
  });
  const pipelineLayout = device.createPipelineLayout({ label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} pipeline layout`, bindGroupLayouts: [layout] });
  const supportPipeline = device.createComputePipeline({
    label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} support+front`,
    layout: pipelineLayout,
    compute: { module: shader, entryPoint: 'reconstructSupportAndFront' },
  });
  const residualPipeline = device.createComputePipeline({
    label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} support-positive residuals`,
    layout: pipelineLayout,
    compute: { module: shader, entryPoint: 'reconstructSupportResiduals' },
  });
  const frontUpsampleShader = device.createShaderModule({ label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} native front upsample WGSL`, code: specializeLowGridWgsl(FRONT_UPSAMPLE_WGSL, lowGrid) });
  const frontUpsampleLayout = device.createBindGroupLayout({
    label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} native front upsample layout`,
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ],
  });
  const frontUpsamplePipeline = device.createComputePipeline({
    label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} native front upsample`,
    layout: device.createPipelineLayout({ label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} native front upsample pipeline layout`, bindGroupLayouts: [frontUpsampleLayout] }),
    compute: { module: frontUpsampleShader, entryPoint: 'upsampleNativeFront' },
  });
  const deterministicNativeUpsampleShader = device.createShaderModule({
    label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} deterministic native state upsample WGSL`,
    code: specializeLowGridWgsl(DETERMINISTIC_NATIVE_UPSAMPLE_WGSL, lowGrid),
  });
  const deterministicNativeUpsampleLayout = device.createBindGroupLayout({
    label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} deterministic native state upsample layout`,
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ],
  });
  const deterministicNativeUpsamplePipeline = device.createComputePipeline({
    label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} deterministic native state upsample`,
    layout: device.createPipelineLayout({
      label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} deterministic native state upsample pipeline layout`,
      bindGroupLayouts: [deterministicNativeUpsampleLayout],
    }),
    compute: { module: deterministicNativeUpsampleShader, entryPoint: 'upsampleNativeState' },
  });
  const sourceHistoryAdmissionShader = device.createShaderModule({
    label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} fixed source-delta admission WGSL`,
    code: specializeLowGridWgsl(SOURCE_HISTORY_ADMISSION_WGSL, lowGrid),
  });
  const sourceHistoryAdmissionLayout = device.createBindGroupLayout({
    label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} fixed source-delta admission layout`,
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ],
  });
  const sourceHistoryAdmissionPipeline = device.createComputePipeline({
    label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} fixed source-delta admission`,
    layout: device.createPipelineLayout({
      label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} fixed source-delta admission pipeline layout`,
      bindGroupLayouts: [sourceHistoryAdmissionLayout],
    }),
    compute: { module: sourceHistoryAdmissionShader, entryPoint: 'admitFixedSourceDelta' },
  });
  const finalizeResidualDispatchShader = device.createShaderModule({
    label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} finalize residual dispatch args WGSL`,
    code: FINALIZE_RESIDUAL_DISPATCH_WGSL,
  });
  const finalizeResidualDispatchLayout = device.createBindGroupLayout({
    label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} finalize residual dispatch args layout`,
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ],
  });
  const finalizeResidualDispatchPipeline = device.createComputePipeline({
    label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} finalize residual dispatch args`,
    layout: device.createPipelineLayout({
      label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} finalize residual dispatch args pipeline layout`,
      bindGroupLayouts: [finalizeResidualDispatchLayout],
    }),
    compute: { module: finalizeResidualDispatchShader, entryPoint: 'finalizeResidualDispatchArgs' },
  });
  const finalizeSourceHistoryDispatchShader = device.createShaderModule({
    label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} finalize source-delta dispatch args WGSL`,
    code: FINALIZE_SOURCE_HISTORY_DISPATCH_WGSL,
  });
  const finalizeSourceHistoryDispatchLayout = device.createBindGroupLayout({
    label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} finalize source-delta dispatch args layout`,
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ],
  });
  const finalizeSourceHistoryDispatchPipeline = device.createComputePipeline({
    label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} finalize source-delta dispatch args`,
    layout: device.createPipelineLayout({
      label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} finalize source-delta dispatch args pipeline layout`,
      bindGroupLayouts: [finalizeSourceHistoryDispatchLayout],
    }),
    compute: { module: finalizeSourceHistoryDispatchShader, entryPoint: 'finalizeSourceHistoryDispatchArgs' },
  });
  const candidateHeadBenchmarkLayout = device.createBindGroupLayout({
    label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} candidate-head benchmark layout`,
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
    ],
  });
  const candidateHeadBenchmarkPipelineLayout = device.createPipelineLayout({
    label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} candidate-head benchmark pipeline layout`,
    bindGroupLayouts: [candidateHeadBenchmarkLayout],
  });
  const candidateHeadBenchmarkPipelines = new Map();
  for (const width of CANDIDATE_HEAD_BENCHMARK_WIDTHS) {
    const module = device.createShaderModule({
      label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} candidate-head benchmark width ${width} WGSL`,
      code: specializeLowGridWgsl(candidateHeadBenchmarkWgsl(width), lowGrid),
    });
    candidateHeadBenchmarkPipelines.set(width, device.createComputePipeline({
      label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} candidate-head benchmark width ${width}`,
      layout: candidateHeadBenchmarkPipelineLayout,
      compute: { module, entryPoint: 'benchmarkCandidateHead' },
    }));
  }
  const vivisectorWidth32ReceiverLayout = device.createBindGroupLayout({
    label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} Vivisector width-32 live receiver layout`,
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ],
  });
  const vivisectorWidth32ReceiverShader = device.createShaderModule({
    label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} Vivisector width-32 live receiver WGSL`,
    code: specializeLowGridWgsl(VIVISECTOR_WIDTH32_RECEIVER_WGSL, lowGrid),
  });
  vivisectorWidth32ReceiverShader.getCompilationInfo?.().then(info => {
    if (info?.messages?.length) {
      console.error('vivisector-width32-live-receiver-wgsl-compilation', info.messages.map(message => ({
        type: message.type,
        lineNum: message.lineNum,
        linePos: message.linePos,
        message: message.message,
      })));
    }
  });
  const vivisectorWidth32ReceiverPipeline = device.createComputePipeline({
    label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} Vivisector width-32 live receiver`,
    layout: device.createPipelineLayout({
      label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} Vivisector width-32 live receiver pipeline layout`,
      bindGroupLayouts: [vivisectorWidth32ReceiverLayout],
    }),
    compute: {
      module: vivisectorWidth32ReceiverShader,
      entryPoint: 'runVivisectorWidth32Receiver',
    },
  });
  const candidateCueLifecycleShader = device.createShaderModule({
    label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} candidate cue lifecycle WGSL`,
    code: CANDIDATE_CUE_LIFECYCLE_WGSL,
  });
  const candidateCueLifecycleLayout = device.createBindGroupLayout({
    label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} candidate cue lifecycle layout`,
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
    ],
  });
  const candidateCueLifecyclePipeline = device.createComputePipeline({
    label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} candidate cue lifecycle clear/check`,
    layout: device.createPipelineLayout({
      label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} candidate cue lifecycle pipeline layout`,
      bindGroupLayouts: [candidateCueLifecycleLayout],
    }),
    compute: { module: candidateCueLifecycleShader, entryPoint: 'clearAndCheckCandidateCueLifecycle' },
  });
  const native96SparseFrontContinuityShader = device.createShaderModule({
    label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} native96 sparse-front continuity WGSL`,
    code: specializeLowGridWgsl(NATIVE96_SPARSE_FRONT_CONTINUITY_WGSL, lowGrid),
  });
  const native96SparseFrontContinuityLayout = device.createBindGroupLayout({
    label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} native96 sparse-front continuity layout`,
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 8, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ],
  });
  const native96SparseFrontContinuityPipelineLayout = device.createPipelineLayout({
    label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} native96 sparse-front continuity pipeline layout`,
    bindGroupLayouts: [native96SparseFrontContinuityLayout],
  });
  const native96SparseFrontInitializePipeline = device.createComputePipeline({
    label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} native96 sparse-front initialize`,
    layout: native96SparseFrontContinuityPipelineLayout,
    compute: { module: native96SparseFrontContinuityShader, entryPoint: 'initializeNative96SparseFrontContinuity' },
  });
  const native96ExactFrontTeacherCandidatePipeline = device.createComputePipeline({
    label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} native96 exact front teacher candidates`,
    layout: native96SparseFrontContinuityPipelineLayout,
    compute: { module: native96SparseFrontContinuityShader, entryPoint: 'evalNative96ExactFrontTeacherCandidates' },
  });
  const native96FrontAuthorityGateShader = device.createShaderModule({
    label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} native96 front-authority-gated f32 teacher WGSL`,
    code: specializeLowGridWgsl(NATIVE96_FRONT_AUTHORITY_GATED_SPARSE_FRONT_CONTINUITY_WGSL, lowGrid),
  });
  const frontAuthorityGateCompilation = await native96FrontAuthorityGateShader.getCompilationInfo();
  const frontAuthorityGateErrors = frontAuthorityGateCompilation.messages.filter(message => message.type === 'error');
  if (frontAuthorityGateErrors.length) {
    throw new Error(`native96 front-authority gate WGSL failed:${frontAuthorityGateErrors.map(error => `${error.lineNum}:${error.linePos} ${error.message}`).join('; ')}`);
  }
  const native96FrontAuthorityGateCandidatePipeline = device.createComputePipeline({
    label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} native96 front-authority-gated f32 teacher candidates`,
    layout: native96SparseFrontContinuityPipelineLayout,
    compute: { module: native96FrontAuthorityGateShader, entryPoint: 'evalNative96ExactFrontTeacherCandidates' },
  });
  const shaderF16Available = device.features?.has?.('shader-f16') === true;
  let native96F16FrontTeacherCandidatePipeline = null;
  if (shaderF16Available) {
    const native96F16FrontTeacherShader = device.createShaderModule({
      label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} native96 f16 front teacher WGSL`,
      code: specializeLowGridWgsl(NATIVE96_F16_SPARSE_FRONT_CONTINUITY_WGSL, lowGrid),
    });
    const f16Compilation = await native96F16FrontTeacherShader.getCompilationInfo();
    const f16Errors = f16Compilation.messages.filter(message => message.type === 'error');
    if (f16Errors.length) {
      throw new Error(`native96 f16 front WGSL failed:${f16Errors.map(error => `${error.lineNum}:${error.linePos} ${error.message}`).join('; ')}`);
    }
    native96F16FrontTeacherCandidatePipeline = device.createComputePipeline({
      label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} native96 f16 front teacher candidates`,
      layout: native96SparseFrontContinuityPipelineLayout,
      compute: { module: native96F16FrontTeacherShader, entryPoint: 'evalNative96ExactFrontTeacherCandidates' },
    });
  }
  const native96SparseFrontFeatherPipeline = device.createComputePipeline({
    label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} native96 sparse-front feather`,
    layout: native96SparseFrontContinuityPipelineLayout,
    compute: { module: native96SparseFrontContinuityShader, entryPoint: 'featherNative96SparseFrontContinuity' },
  });
  let encodedFrameCount = 0;
  let lastHistoryEpochIdentity = null;
  let lastSourceHistoryEpochReceipt = {
    historyEpochIdentity: null,
    priorHistoryEpochIdentity: null,
    currentHistoryEpochIdentity: null,
    historyEpochChanged: false,
    historyEpochValidForAdmission: false,
    sourceHistoryResetReason: 'first-frame-no-prior-history',
  };
  let lastStats = {
    supportPositiveCount: 0,
    supportPrevalence: 0,
    highCellCount: highCells,
  };
  let lastSourceHistoryAdmission = {
    identity: NATIVE_LOW_FIXED_SOURCE_DELTA_ADMISSION,
    fixedSourceDeltaCalibrationSha256: SOURCE_DELTA_CALIBRATION_SHA256,
    sourceDeltaThreshold: SOURCE_DELTA_THRESHOLD,
    sourceDeltaScales: [...SOURCE_DELTA_SCALES],
    sourceHistoryAvailable: false,
    historyEpochIdentity: null,
    priorHistoryEpochIdentity: null,
    currentHistoryEpochIdentity: null,
    historyEpochChanged: false,
    historyEpochValidForAdmission: false,
    sourceHistoryResetReason: 'first-frame-no-prior-history',
    uncappedLowCandidateCount: 0,
    uncappedCandidateCount: 0,
    uncappedCandidateCoverage: 0,
    sourceHistoryDispatchWorkgroups: 0,
    sourceHistoryDispatchThreadCount: 0,
    mohelWarning: null,
    runtimeTopK: false,
    dynamicPercentile: false,
    hiddenCandidateCap: false,
  };
  let lastCandidateHeadBenchmark = {
    identity: NATIVE_LOW_CANDIDATE_HEAD_COST_MICROBENCHMARK,
    enabled: false,
    authority: 'synthetic-deterministic-candidate-head-cost-substrate-not-learned-evidence-v0',
    learnedWeightsUsed: false,
    fidelityClaim: false,
    visualClaim: false,
  };
  let vivisectorWidth32WeightsBuffer = null;
  let vivisectorWidth32WeightsKey = null;
  let lastVivisectorWidth32Receiver = {
    identity: NATIVE_LOW_VIVISECTOR_WIDTH32_LIVE_RECEIVER,
    enabled: false,
    receiverClaimScope: 'performance-receiver-only-not-fidelity-or-visual-claim-v0',
    trainedWeightsUsed: false,
    syntheticBenchmarkWeights: false,
    failurePhase: null,
  };
  let lastCoarseSourceHistorySupportFrontReplacement = {
    identity: NATIVE_LOW_COARSE_SOURCE_HISTORY_SUPPORT_FRONT_REPLACEMENT,
    enabled: false,
    denseSupportFrontBypassed: false,
    denseRouteRetainedAsControl: true,
    hiddenCandidateCap: false,
    fullGridReceiverMaterialization: false,
    productionPathCpuReadback: false,
    syntheticBenchmarkWeights: false,
    syntheticBenchmarkAuthorityRejected: true,
    learnedVisualClaim: false,
    failurePhase: null,
  };
  let lastNative96SparseFrontContinuity = {
    identity: NATIVE96_SPARSE_FRONT_CONTINUITY,
    enabled: false,
    hardZeroOutsideCandidateVisuallyRejected: true,
    hardMaskTreatmentClaim: false,
    continuityReconstructionMode: 'feathered-local-5x5x5-front-residual-reconstruction-v0',
    learnedVisualClaim: false,
    failurePhase: null,
  };
  let coarseSourceHistorySupportFrontActive = false;
  let currentFrontAuthorityGateEffective = false;
  let candidateCueRecordReuseCount = 0;
  let candidateCueLifecycleToken = 0;
  let lastCandidateCueBufferLifecycle = {
    identity: NATIVE_LOW_RESIDENT_CUE_BUFFER_LIFECYCLE_STRESS,
    enabled: false,
    claimScope: 'lifecycle-cost-substrate-not-fidelity-or-visual-evidence-v0',
    candidateCueRecordCapacity: highCells,
    candidateCueRecordCapacityBytes: highCells * CANDIDATE_CUE_RECORD_STRIDE_BYTES,
    candidateCueRecordAllocationCount: 1,
    candidateCueRecordReuseCount,
    candidateCueRecordGrowthCount: 0,
    noReallocation: true,
    noLeak: true,
    hiddenCandidateCap: false,
    staleCueRowsRetained: false,
    fidelityClaim: false,
    visualClaim: false,
  };
  let lastCandidateCueLifecycleEncodeReceipt = {
    token: 0,
    previousCandidateCount: 0,
    stressEnabled: false,
  };
  const ensureVivisectorWidth32WeightsBuffer = (receiver) => {
    if (!receiver?.enabled) return null;
    const weights = receiver.weights;
    if (!ArrayBuffer.isView(weights) || weights.BYTES_PER_ELEMENT !== Float32Array.BYTES_PER_ELEMENT) {
      throw new Error('vivisector-width32-live-receiver:missing Float32Array weights');
    }
    if (weights.length !== VIVISECTOR_WIDTH32_WEIGHT_FLOAT_COUNT) {
      throw new Error(`vivisector-width32-live-receiver:weight length ${weights.length} != ${VIVISECTOR_WIDTH32_WEIGHT_FLOAT_COUNT}`);
    }
    const key = [
      receiver.packageProjectionSha256 || 'unknown-projection',
      receiver.sourceWeightsSha256 || receiver.effectiveWeightsSha256 || 'unknown-source',
      weights.length,
    ].join(':');
    if (!vivisectorWidth32WeightsBuffer || vivisectorWidth32WeightsKey !== key) {
      vivisectorWidth32WeightsBuffer?.destroy?.();
      vivisectorWidth32WeightsBuffer = device.createBuffer({
        label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} Vivisector width-32 receiver weights`,
        size: VIVISECTOR_WIDTH32_WEIGHT_BYTES,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(vivisectorWidth32WeightsBuffer, 0, weights);
      vivisectorWidth32WeightsKey = key;
    }
    return vivisectorWidth32WeightsBuffer;
  };
  const makeVivisectorWidth32ReceiverReceipt = (receiver, gpuMs = null, timestampValues = []) => {
    const enabled = Boolean(receiver?.enabled);
    const candidateCount = Number(lastSourceHistoryAdmission.uncappedCandidateCount || 0);
    const candidateCoverage = Number(lastSourceHistoryAdmission.uncappedCandidateCoverage || 0);
    const indirectWorkgroups = Math.ceil(candidateCount / RESIDUAL_WORKGROUP_SIZE);
    const indirectThreads = indirectWorkgroups * RESIDUAL_WORKGROUP_SIZE;
    const finiteGpuMs = Number(gpuMs);
    const timingDisposition = Number.isFinite(finiteGpuMs)
      ? finiteGpuMs < 10
        ? 'under-10ms-materially-profitable'
        : finiteGpuMs < 15
          ? 'under-15ms-credible-break-even'
          : finiteGpuMs <= 24
            ? '15-24ms-only-if-total-native96-frame-beats-native160'
            : 'above-24ms-current-architecture-failure'
      : 'not-measured';
    return {
      identity: NATIVE_LOW_VIVISECTOR_WIDTH32_LIVE_RECEIVER,
      enabled,
      receiverClaimScope: 'performance-receiver-only-not-fidelity-or-visual-claim-v0',
      packageIdentity: receiver?.packageIdentity || null,
      modelIdentity: receiver?.modelIdentity || null,
      requestedPackageSha256: receiver?.requestedPackageSha256 || null,
      effectivePackageSha256: receiver?.effectivePackageSha256 || null,
      requestedWeightsSha256: receiver?.requestedWeightsSha256 || null,
      effectiveWeightsSha256: receiver?.effectiveWeightsSha256 || null,
      sourceWeightsSha256: receiver?.sourceWeightsSha256 || receiver?.effectiveWeightsSha256 || null,
      packageProjectionSha256: receiver?.packageProjectionSha256 || null,
      weightEmbeddingAuthority: VIVISECTOR_WIDTH32_RECEIVER_EVAL_EMBEDDING.authority,
      weightsEmbeddedInShaderSha256: VIVISECTOR_WIDTH32_RECEIVER_EVAL_EMBEDDING.packageProjectionSha256,
      trainedWeightsUsed: enabled,
      syntheticBenchmarkWeights: false,
      coarseLatentRuntimeAuthority: receiver?.coarseLatentRuntimeAuthority || 'zeroed-coarse-latent-unimplemented-risk-not-fidelity-evidence-v0',
      fidelityClaim: false,
      visualClaim: false,
      activeTreatmentPath: false,
      candidateListSource: 'real-uncapped-fixed-gate-sourceHistoryCandidates-v0',
      dispatchIdentity: 'dispatchWorkgroupsIndirect-sourceHistoryDispatchArgs-v0',
      dispatchMode: 'dispatchWorkgroupsIndirect-sourceHistoryDispatchArgs-v0',
      indirectDispatch: true,
      candidateCount,
      instanceCount: candidateCount,
      candidateInstanceEquality: candidateCount === candidateCount,
      overflowCount: 0,
      candidateCoverage,
      indirectWorkgroups,
      indirectThreads,
      outputSchema: {
        identity: 'compact-renderer-facing-cue-record-v0',
        cueRecordStrideBytes: CANDIDATE_CUE_RECORD_STRIDE_BYTES,
        cueRecordVec4Count: 2,
        outputChannels: CANDIDATE_HEAD_OUTPUT_COUNT,
      },
      cueRecordStrideBytes: CANDIDATE_CUE_RECORD_STRIDE_BYTES,
      vivisectorWidth32ReceiverGpuMs: Number.isFinite(finiteGpuMs) ? finiteGpuMs : null,
      inferenceGpuMs: Number.isFinite(finiteGpuMs) ? finiteGpuMs : null,
      materializationMs: null,
      renderMs: null,
      totalFrameMs: null,
      timestampValues,
      timestampAuthority: timestampValues.length >= 2 ? 'webgpu-timestamp-query-vivisector-width32-receiver-v0' : 'not-measured',
      vivisectorReceiverDecisionBands: {
        profitableTargetMs: 10,
        credibleBreakEvenTargetMs: 15,
        outerKillBoundaryMs: 24,
        timingDisposition,
      },
      failurePhase: enabled ? null : 'vivisector-width32-live-receiver-disabled',
    };
  };
  const makeCandidateHeadBenchmarkReceipt = (widthTimings = null, timestampValues = []) => {
    const candidateCount = Number(lastSourceHistoryAdmission.uncappedCandidateCount || 0);
    const candidateCoverage = Number(lastSourceHistoryAdmission.uncappedCandidateCoverage || 0);
    const workgroups = Math.ceil(candidateCount / RESIDUAL_WORKGROUP_SIZE);
    const threads = workgroups * RESIDUAL_WORKGROUP_SIZE;
    const perCandidateMacs = CANDIDATE_HEAD_BENCHMARK_WIDTHS.reduce((acc, width) => {
      acc[width] = width * (CANDIDATE_HEAD_INPUT_COUNT + CANDIDATE_HEAD_OUTPUT_COUNT);
      return acc;
    }, {});
    const estimatedBytesPerCandidate = (SLOTS_PER_CELL * 4 * 4 * 2) + 4 + 4 + Uint32Array.BYTES_PER_ELEMENT + CANDIDATE_CUE_RECORD_STRIDE_BYTES;
    const widthResults = CANDIDATE_HEAD_BENCHMARK_WIDTHS.map(width => {
      const gpuMs = Number(widthTimings?.[width]);
      const disposition = Number.isFinite(gpuMs)
        ? gpuMs <= 10
          ? 'clears-profitable-target'
          : gpuMs <= 15
            ? 'clears-credible-break-even-target'
            : gpuMs <= 24
              ? 'under-outer-kill-boundary-only'
              : 'exceeds-outer-kill-boundary'
        : 'not-measured';
      return {
        width,
        gpuMs: Number.isFinite(gpuMs) ? gpuMs : null,
        macsPerCandidate: perCandidateMacs[width],
        estimatedTotalMacs: candidateCount * perCandidateMacs[width],
        estimatedBytesPerCandidate,
        estimatedTotalBytes: candidateCount * estimatedBytesPerCandidate,
        indirectWorkgroups: workgroups,
        indirectThreads: threads,
        budgetDisposition: {
          profitableTargetMs: 10,
          credibleBreakEvenTargetMs: 15,
          outerKillBoundaryMs: 24,
          disposition,
        },
      };
    });
    const width32 = widthResults.find(result => result.width === 32);
    const width24 = widthResults.find(result => result.width === 24);
    const width16 = widthResults.find(result => result.width === 16);
    const selectedNextAction = width32?.gpuMs !== null && width32?.gpuMs <= 15
      ? 'reserve-width-32-shape-for-vivisector-trained-weights'
      : (width24?.gpuMs !== null && width24?.gpuMs <= 15) || (width16?.gpuMs !== null && width16?.gpuMs <= 15)
        ? 'report-fidelity-capacity-pressure-width-32-over-budget'
        : widthResults.every(result => result.gpuMs !== null && result.gpuMs > 24)
          ? 'test-one-fused-f16-kernel-improvement-before-rejecting-candidate-shape'
          : 'continue-measuring-candidate-head-shape';
    return {
      identity: NATIVE_LOW_CANDIDATE_HEAD_COST_MICROBENCHMARK,
      enabled: true,
      authority: 'synthetic-deterministic-candidate-head-cost-substrate-not-learned-evidence-v0',
      coarseLatentAuthority: 'deterministic-synthetic-coarse-latent-v0',
      learnedWeightsUsed: false,
      trainedWeightsAvailable: false,
      vivisectorWeightsDelivered: false,
      fidelityClaim: false,
      visualClaim: false,
      activeTreatmentPath: false,
      frozenDenseHeadsControl: 'arithmetic-control-only',
      dispatchMode: 'dispatchWorkgroupsIndirect-sourceHistoryDispatchArgs-v0',
      candidateListSource: 'real-uncapped-fixed-gate-sourceHistoryCandidates-v0',
      sourceAdmissionTimedSeparately: true,
      candidateCount,
      candidateCoverage,
      highCellCount: highCells,
      benchmarkWidths: [...CANDIDATE_HEAD_BENCHMARK_WIDTHS],
      candidateInputs: {
        currentSourceChannels: 17,
        sourceDeltaChannels: 17,
        normalizedPositionAndSubcell: true,
        deterministicSyntheticCoarseLatentChannels: 8,
        inputCount: CANDIDATE_HEAD_INPUT_COUNT,
      },
      outputSchema: {
        identity: 'compact-renderer-facing-cue-record-v0',
        cueRecordStrideBytes: CANDIDATE_CUE_RECORD_STRIDE_BYTES,
        cueRecordVec4Count: 2,
        emittedCueRecordCount: candidateCount,
        emittedCueBytes: candidateCount * CANDIDATE_CUE_RECORD_STRIDE_BYTES,
      },
      pathExclusions: {
        noJsCandidateList: true,
        productionPathCpuReadback: false,
        diagnosticReceiptReadbackOnly: true,
        dense160ReceiverMaterialization: false,
        hiddenCandidateCap: false,
      },
      timestampAuthority: widthTimings ? 'webgpu-timestamp-query-width-split-v0' : 'not-measured',
      timestampValues,
      widthResults,
      budgetDisposition: {
        profitableTargetMs: 10,
        credibleBreakEvenTargetMs: 15,
        outerKillBoundaryMs: 24,
        selectedNextAction,
      },
      sourceDeltaAdmissionGpuMs: null,
      failurePhase: null,
    };
  };
  const makeInferenceWorkProfile = stats => {
    const supportPositiveCount = Number(stats?.supportPositiveCount || 0);
    if (coarseSourceHistorySupportFrontActive) {
      const candidateCount = Number(lastSourceHistoryAdmission.uncappedCandidateCount || 0);
      const candidateDispatchWorkgroups = Math.ceil(candidateCount / RESIDUAL_WORKGROUP_SIZE);
      return {
        identity: 'native-low-shared-device-inference-work-profile-v0',
        supportFrontReplacementActive: true,
        supportCompactionActive: true,
        supportCompactionIdentity: NATIVE_LOW_COARSE_SOURCE_HISTORY_SUPPORT_FRONT_REPLACEMENT,
        residualDispatchIdentity: 'sourceHistoryDispatchArgs',
        supportClassifierCoverage: 'coarse-scaffold-plus-source-history-detail-candidates-not-full-grid-160^3',
        modelEvaluatedCellCount: candidateCount,
        modelHeadEvaluationCount: candidateCount,
        supportClassifierEvaluatedCount: 0,
        frontTopologyEvaluatedCount: 0,
        supportPositiveCount: candidateCount,
        supportPrevalence: candidateCount / highCells,
        supportCompactedCount: candidateCount,
        residualHeadEvaluatedCount: candidateCount,
        residualHeadPolicy: 'source-history-detail-candidate-cue-emission-v0',
        residualDispatchMode: 'dispatchWorkgroupsIndirect-sourceHistoryDispatchArgs-v0',
        residualDispatchArgsFinalized: true,
        residualDispatchIndirect: true,
        residualDispatchFullGridEarlyReturn: false,
        residualDispatchWorkgroups: candidateDispatchWorkgroups,
        residualDispatchThreadCount: candidateDispatchWorkgroups * RESIDUAL_WORKGROUP_SIZE,
        residualWorkgroupSize: RESIDUAL_WORKGROUP_SIZE,
        dispatchWorkgroups: ['indirect', candidateDispatchWorkgroups],
        featureCount: selectedModel.features.featureCount,
        outputHeadCount: 'compact-renderer-facing-cue-record-v0',
        denseSupportFrontBypassed: true,
        denseRouteRetainedAsControl: true,
        hiddenSupportCap: false,
        hiddenCandidateCap: false,
      };
    }
    const residualDispatchWorkgroups = Math.ceil(supportPositiveCount / RESIDUAL_WORKGROUP_SIZE);
    const residualDispatchThreadCount = residualDispatchWorkgroups * RESIDUAL_WORKGROUP_SIZE;
    return {
      identity: 'native-low-shared-device-inference-work-profile-v0',
      supportCompactionActive: true,
      supportCompactionIdentity: NATIVE_LOW_SUPPORT_POSITIVE_RESIDUAL_DISPATCH,
      residualDispatchIdentity: NATIVE_LOW_SUPPORT_POSITIVE_INDIRECT_RESIDUAL_DISPATCH,
      supportClassifierCoverage: 'full-grid-160^3',
      modelEvaluatedCellCount: highCells + supportPositiveCount,
      modelHeadEvaluationCount: highCells * 2 + supportPositiveCount * 3,
      supportClassifierEvaluatedCount: highCells,
      frontTopologyEvaluatedCount: highCells,
      supportPositiveCount,
      supportPrevalence: supportPositiveCount / highCells,
      supportCompactedCount: supportPositiveCount,
      residualHeadEvaluatedCount: supportPositiveCount * 3,
      residualHeadPolicy: 'frontTopology-full-grid+fuel-visibleFireCarrier-fireLick-support-positive-v0',
      residualDispatchMode: 'support-positive-indirect-dispatch-args-v0',
      residualDispatchArgsFinalized: true,
      residualDispatchIndirect: true,
      residualDispatchFullGridEarlyReturn: false,
      residualDispatchWorkgroups,
      residualDispatchThreadCount,
      residualWorkgroupSize: RESIDUAL_WORKGROUP_SIZE,
      dispatchWorkgroups: [Math.ceil(HIGH_GRID / 4), Math.ceil(HIGH_GRID / 4), Math.ceil(HIGH_GRID / 4)],
      featureCount: selectedModel.features.featureCount,
      outputHeadCount: selectedModel.outputs.length,
      hiddenSupportCap: false,
      droppedInputChannels: false,
    };
  };
  const makeEmptySupportTileProfile = (tileProfileReadbackMs = 0) => {
    const tileSize = 16;
    const tileGrid = Math.ceil(HIGH_GRID / tileSize);
    return {
      identity: 'native-low-support-proximal-tile-profile-v0',
      authority: 'diagnostic-compacted-support-index-readback-v0',
      diagnosticFullSupportPassRequired: true,
      tileProfileReadbackMs,
      tileSize,
      tileGrid,
      highCellCount: highCells,
      supportMass: 0,
      supportCentroid: null,
      supportExtent: null,
      activeTileCount: 0,
      activeTileCoverage: 0,
      projectedSupportFrontCellCount: 0,
      projectedCellReduction: 1,
      hiddenSupportCap: false,
      droppedInputChannels: false,
    };
  };
  const makeEmptySourceTileCandidate = (candidateReadbackMs = 0) => {
    const tileSize = 16;
    const tileGrid = Math.ceil(HIGH_GRID / tileSize);
    return {
      identity: NATIVE_LOW_SOURCE_PROXIMAL_TILE_CANDIDATE,
      authority: 'current-source-low-front-tile-prior-compared-to-frozen-dense-support-v0',
      candidateEvaluationMode: 'diagnostic-dense-route-comparison-not-active-treatment-v0',
      diagnosticFullDenseSupportPassRequired: true,
      denseRouteRetained: true,
      candidateReadbackMs,
      sourceFrontThreshold: 1e-6,
      sourceTileDilation: 1,
      tileSize,
      tileGrid,
      lowCellCount: lowCells,
      highCellCount: highCells,
      sourceActiveLowCellCount: 0,
      candidateTileCount: 0,
      candidateTileCoverage: 0,
      projectedCandidateCellCount: 0,
      projectedCellReduction: 1,
      denseSupportCount: 0,
      supportCoveredByCandidateCount: 0,
      supportMissedByCandidateCount: 0,
      supportMissRate: 0,
      candidateCapturesAllDenseSupport: true,
      hiddenSupportCap: false,
      droppedInputChannels: false,
    };
  };
  let lastSupportTileProfile = makeEmptySupportTileProfile();
  let lastSourceTileCandidate = makeEmptySourceTileCandidate();
  return {
    identity: NATIVE_LOW_SHARED_DEVICE_ROUTE,
    transportMode: NATIVE_LOW_TRANSPORT_MODE,
    routeRegistryIdentity: NATIVE_LOW_TRAINED_PACKAGE_ROUTE_REGISTRY_IDENTITY,
    requestedTransferRouteId: transferRouteId,
    effectiveTransferRouteId: route.routeId,
    nativeLowTrainedPackageRoute: {
      identity: 'native-low-trained-package-route-v0',
      registryIdentity: NATIVE_LOW_TRAINED_PACKAGE_ROUTE_REGISTRY_IDENTITY,
      requestedTransferRouteId: transferRouteId,
      effectiveTransferRouteId: route.routeId,
      packageIdentity: route.packageIdentity,
      modelIdentity: route.modelIdentity,
      packageSha256: route.packageSha256,
      modelSha256: route.modelSha256,
      trainedLowGrid: route.trainedLowGrid,
      trainedHighGrid: route.trainedHighGrid,
      effectiveSourceGrid: lowGrid,
      dispatchIdentity: route.dispatchIdentity,
      sourceHistoryDispatchIdentity: route.sourceHistoryDispatchIdentity,
      rankingClaim: false,
    },
    requestedBackend: 'WebGPU',
    effectiveBackend: 'WebGPU',
    fallbackBackend: null,
    modelIdentity: selectedModel.identity,
    modelSha256,
    native96ExactFrontTeacherModelIdentity: NATIVE96_EXACT_FRONT_TEACHER_MODEL.identity,
    native96ExactFrontTeacherModelSha256: exactFrontTeacherSha256,
    native96F16FrontTeacherModelIdentity: NATIVE96_F16_FRONT_TEACHER_IDENTITY,
    native96F16FrontTeacherModelSha256: f16FrontTeacherSha256,
    native96F16FrontTeacherByteLength: NATIVE96_F16_FRONT_TEACHER_BYTE_LENGTH,
    shaderF16Available,
    native96ExactFrontTeacherParentCommit: NATIVE96_EXACT_FRONT_TEACHER_PARENT_COMMIT,
    featureAuthority: NATIVE_LOW_FEATURE_AUTHORITY,
    inputAuthority: NATIVE_LOW_INPUT_AUTHORITY,
    effectiveFeatureCount: selectedModel.features.featureCount,
    noHiddenCaps: true,
    supportCompactionIdentity: NATIVE_LOW_SUPPORT_POSITIVE_RESIDUAL_DISPATCH,
    runtimeBuildIdentity: NATIVE_LOW_RUNTIME_BUILD_IDENTITY,
    buffers: { lowSnapshotFluid, lowSnapshotFront, predictedFluid, predictedFront, nativeUpsampleFront, residualDispatchArgs, sourceHistoryCandidates, sourceHistoryDispatchArgs, candidateCueRecords, candidateCueLifecycleStats, candidateCueLifecycleParams },
    encodeFromNativeLow(encoder, sourceFluid, sourceFront, options = {}) {
      currentFrontAuthorityGateEffective = options.native96SparseFrontContinuityEnabled === true
        && options.native96FrontAuthorityGateEnabled === true;
      const currentHistoryEpochIdentity = String(options.historyEpochIdentity || 'native-low-source-history-epoch-unspecified-v0');
      const priorHistoryEpochIdentity = lastHistoryEpochIdentity;
      const historyEpochChanged = priorHistoryEpochIdentity !== null && priorHistoryEpochIdentity !== currentHistoryEpochIdentity;
      const historyEpochValidForAdmission = encodedFrameCount > 0 && !historyEpochChanged;
      const frontAuthorityThresholdEffective = options.native96FrontAuthorityGateEnabled === true
        ? Math.max(0, Number(options.native96FrontAuthorityThreshold ?? 0.01))
        : 0;
      const frontAuthorityThresholdBits = new Uint32Array(new Float32Array([frontAuthorityThresholdEffective]).buffer)[0];
      const sourceHistoryResetReason = !historyEpochValidForAdmission
        ? (historyEpochChanged ? 'epoch-changed-first-frame-invalidated' : 'first-frame-no-prior-history')
        : 'prior-history-valid';
      lastSourceHistoryEpochReceipt = {
        historyEpochIdentity: currentHistoryEpochIdentity,
        priorHistoryEpochIdentity,
        currentHistoryEpochIdentity,
        historyEpochChanged,
        historyEpochValidForAdmission,
        sourceHistoryResetReason,
        callerResetReason: options.historyResetReason || null,
      };
      device.queue.writeBuffer(stats, 0, new Uint32Array(4));
      device.queue.writeBuffer(residualDispatchArgs, 0, new Uint32Array(4));
      device.queue.writeBuffer(sourceHistoryStats, 0, new Uint32Array([0, 0, 0, historyEpochValidForAdmission ? 1 : 0, frontAuthorityThresholdBits]));
      device.queue.writeBuffer(sourceHistoryDispatchArgs, 0, new Uint32Array(4));
      const sourceHistoryBindGroup = device.createBindGroup({
        label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} fixed source-delta admission bind group`,
        layout: sourceHistoryAdmissionLayout,
        entries: [
          { binding: 0, resource: { buffer: sourceFluid } },
          { binding: 1, resource: { buffer: sourceFront } },
          { binding: 2, resource: { buffer: lowSnapshotFluid } },
          { binding: 3, resource: { buffer: lowSnapshotFront } },
          { binding: 4, resource: { buffer: sourceHistoryCandidates } },
          { binding: 5, resource: { buffer: sourceHistoryStats } },
        ],
      });
      const sourceDeltaAdmissionTimestampWrites = options.stageTimestampWrites?.sourceDeltaAdmission || null;
      const sourceHistoryPassTimestampWrites = sourceDeltaAdmissionTimestampWrites
        ? { querySet: sourceDeltaAdmissionTimestampWrites.querySet, beginningOfPassWriteIndex: sourceDeltaAdmissionTimestampWrites.beginningOfPassWriteIndex }
        : null;
      const finalizeSourceHistoryTimestampWrites = sourceDeltaAdmissionTimestampWrites
        ? { querySet: sourceDeltaAdmissionTimestampWrites.querySet, endOfPassWriteIndex: sourceDeltaAdmissionTimestampWrites.endOfPassWriteIndex }
        : null;
      const sourceHistoryPass = encoder.beginComputePass({
        label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} fixed source-delta admission`,
        ...(sourceHistoryPassTimestampWrites ? { timestampWrites: sourceHistoryPassTimestampWrites } : {}),
      });
      sourceHistoryPass.setPipeline(sourceHistoryAdmissionPipeline);
      sourceHistoryPass.setBindGroup(0, sourceHistoryBindGroup);
      sourceHistoryPass.dispatchWorkgroups(Math.ceil(lowGrid / 4), Math.ceil(lowGrid / 4), Math.ceil(lowGrid / 4));
      sourceHistoryPass.end();
      const finalizeSourceHistoryBindGroup = device.createBindGroup({
        label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} finalize source-delta dispatch args bind group`,
        layout: finalizeSourceHistoryDispatchLayout,
        entries: [
          { binding: 0, resource: { buffer: sourceHistoryStats } },
          { binding: 1, resource: { buffer: sourceHistoryDispatchArgs } },
        ],
      });
      const finalizeSourceHistoryPass = encoder.beginComputePass({
        label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} finalize source-delta dispatch args`,
        ...(finalizeSourceHistoryTimestampWrites ? { timestampWrites: finalizeSourceHistoryTimestampWrites } : {}),
      });
      finalizeSourceHistoryPass.setPipeline(finalizeSourceHistoryDispatchPipeline);
      finalizeSourceHistoryPass.setBindGroup(0, finalizeSourceHistoryBindGroup);
      finalizeSourceHistoryPass.dispatchWorkgroups(1);
      finalizeSourceHistoryPass.end();
      const vivisectorReceiver = options.vivisectorCandidateHeadReceiver || null;
      const vivisectorReceiverEnabled = vivisectorReceiver?.enabled === true;
      if (vivisectorReceiverEnabled) {
        const vivisectorBindGroup = device.createBindGroup({
          label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} Vivisector width-32 live receiver bind group`,
          layout: vivisectorWidth32ReceiverLayout,
          entries: [
            { binding: 0, resource: { buffer: sourceFluid } },
            { binding: 1, resource: { buffer: lowSnapshotFluid } },
            { binding: 2, resource: { buffer: sourceHistoryCandidates } },
            { binding: 3, resource: { buffer: sourceHistoryDispatchArgs } },
            { binding: 4, resource: { buffer: candidateCueRecords } },
          ],
        });
        const receiverTimestampWrites = options.stageTimestampWrites?.vivisectorWidth32Receiver || null;
        const vivisectorPass = encoder.beginComputePass({
          label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} Vivisector width-32 live receiver`,
          ...(receiverTimestampWrites ? { timestampWrites: receiverTimestampWrites } : {}),
        });
        vivisectorPass.setPipeline(vivisectorWidth32ReceiverPipeline);
        vivisectorPass.setBindGroup(0, vivisectorBindGroup);
        vivisectorPass.dispatchWorkgroupsIndirect(sourceHistoryDispatchArgs, 0);
        vivisectorPass.end();
        lastVivisectorWidth32Receiver = makeVivisectorWidth32ReceiverReceipt(vivisectorReceiver);
      } else {
        lastVivisectorWidth32Receiver = makeVivisectorWidth32ReceiverReceipt({ enabled: false });
      }
      if (options.candidateHeadBenchmarkEnabled === true) {
        const lifecycleStressEnabled = options.candidateCueBufferLifecycleStressEnabled === true;
        candidateCueRecordReuseCount += 1;
        candidateCueLifecycleToken = (candidateCueLifecycleToken % 0x00ffffff) + 1;
        const previousCandidateCount = Number(lastCandidateCueBufferLifecycle.candidateCount || 0);
        device.queue.writeBuffer(candidateCueLifecycleParams, 0, new Uint32Array([
          candidateCueLifecycleToken,
          previousCandidateCount,
          highCells,
          lifecycleStressEnabled ? 1 : 0,
        ]));
        if (lifecycleStressEnabled) {
          device.queue.writeBuffer(candidateCueLifecycleStats, 0, new Uint32Array(8));
        }
        lastCandidateCueLifecycleEncodeReceipt = {
          token: candidateCueLifecycleToken,
          previousCandidateCount,
          stressEnabled: lifecycleStressEnabled,
        };
        const candidateBenchmarkBindGroup = device.createBindGroup({
          label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} candidate-head benchmark bind group`,
          layout: candidateHeadBenchmarkLayout,
          entries: [
            { binding: 0, resource: { buffer: sourceFluid } },
            { binding: 1, resource: { buffer: sourceFront } },
            { binding: 2, resource: { buffer: lowSnapshotFluid } },
            { binding: 3, resource: { buffer: lowSnapshotFront } },
            { binding: 4, resource: { buffer: sourceHistoryCandidates } },
            { binding: 5, resource: { buffer: sourceHistoryDispatchArgs } },
            { binding: 6, resource: { buffer: candidateCueRecords } },
            { binding: 7, resource: { buffer: candidateCueLifecycleParams } },
          ],
        });
        const candidateTimestampWrites = options.stageTimestampWrites?.candidateHeadBenchmark || {};
        for (const width of CANDIDATE_HEAD_BENCHMARK_WIDTHS) {
          const candidatePass = encoder.beginComputePass({
            label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} candidate-head benchmark width ${width}`,
            ...(candidateTimestampWrites[width] ? { timestampWrites: candidateTimestampWrites[width] } : {}),
          });
          candidatePass.setPipeline(candidateHeadBenchmarkPipelines.get(width));
          candidatePass.setBindGroup(0, candidateBenchmarkBindGroup);
          candidatePass.dispatchWorkgroupsIndirect(sourceHistoryDispatchArgs, 0);
          candidatePass.end();
        }
        if (lifecycleStressEnabled) {
          const lifecycleBindGroup = device.createBindGroup({
            label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} candidate cue lifecycle bind group`,
            layout: candidateCueLifecycleLayout,
            entries: [
              { binding: 0, resource: { buffer: candidateCueRecords } },
              { binding: 1, resource: { buffer: sourceHistoryDispatchArgs } },
              { binding: 2, resource: { buffer: candidateCueLifecycleStats } },
              { binding: 3, resource: { buffer: candidateCueLifecycleParams } },
            ],
          });
          const lifecyclePass = encoder.beginComputePass({ label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} resident cue-buffer lifecycle check` });
          lifecyclePass.setPipeline(candidateCueLifecyclePipeline);
          lifecyclePass.setBindGroup(0, lifecycleBindGroup);
          lifecyclePass.dispatchWorkgroups(Math.ceil(highCells / RESIDUAL_WORKGROUP_SIZE));
          lifecyclePass.end();
        }
        lastCandidateHeadBenchmark = makeCandidateHeadBenchmarkReceipt();
      } else {
        lastCandidateCueLifecycleEncodeReceipt = {
          token: candidateCueLifecycleToken,
          previousCandidateCount: Number(lastCandidateCueBufferLifecycle.candidateCount || 0),
          stressEnabled: false,
        };
        lastCandidateHeadBenchmark = {
          identity: NATIVE_LOW_CANDIDATE_HEAD_COST_MICROBENCHMARK,
          enabled: false,
          authority: 'synthetic-deterministic-candidate-head-cost-substrate-not-learned-evidence-v0',
          learnedWeightsUsed: false,
          fidelityClaim: false,
          visualClaim: false,
        };
      }
      if (options.historyOnly === true) {
        encoder.copyBufferToBuffer(sourceFluid, 0, lowSnapshotFluid, 0, lowFluidBytes);
        encoder.copyBufferToBuffer(sourceFront, 0, lowSnapshotFront, 0, lowFrontBytes);
        coarseSourceHistorySupportFrontActive = false;
        lastNative96SparseFrontContinuity = {
          identity: NATIVE96_SPARSE_FRONT_CONTINUITY,
          enabled: false,
          authority: 'resident-package-history-only-no-model-evaluation-v0',
          candidateListSource: 'real-uncapped-fixed-gate-sourceHistoryCandidates-v0',
          exactFrontTeacherModelIdentity: NATIVE96_EXACT_FRONT_TEACHER_MODEL.identity,
          exactFrontTeacherModelSha256: exactFrontTeacherSha256,
          packageResident: true,
          sourceHistoryAdvanced: true,
          modelEvaluationEnabled: false,
          modelOutputConsumed: false,
          hiddenCandidateCap: false,
          runtimeTopK: false,
          dynamicPercentile: false,
          failurePhase: null,
        };
        encodedFrameCount += 1;
        lastHistoryEpochIdentity = currentHistoryEpochIdentity;
        return;
      }
      coarseSourceHistorySupportFrontActive = options.coarseSourceHistorySupportFrontEnabled === true;
      const native96SparseFrontContinuityActive = options.native96SparseFrontContinuityEnabled === true;
      if (!native96SparseFrontContinuityActive) {
        lastNative96SparseFrontContinuity = {
          identity: NATIVE96_SPARSE_FRONT_CONTINUITY,
          enabled: false,
          authority: 'not-executed-current-frame-v0',
          frontAuthorityGateRequested: false,
          frontAuthorityGateEffective: false,
          frontAuthorityThresholdEffective: null,
          teacherFrontAuthorityAdmittedCount: null,
          teacherFrontAuthorityAdmittedCoverage: null,
          teacherCandidateReduction: null,
          runtimeTruthUsed: false,
          failurePhase: null,
        };
      }
      if (native96SparseFrontContinuityActive) {
        const f16FrontTeacherRequested = options.native96F16FrontTeacherEnabled === true;
        const frontAuthorityGateRequested = options.native96FrontAuthorityGateEnabled === true;
        if (f16FrontTeacherRequested && frontAuthorityGateRequested) {
          throw new Error('native96-front-authority-gate-f16-combination-not-validated');
        }
        if (f16FrontTeacherRequested && !native96F16FrontTeacherCandidatePipeline) {
          throw new Error('f16-fallback-forbidden:shader-f16-unavailable');
        }
        const continuityBindGroup = device.createBindGroup({
          label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} native96 sparse-front continuity bind group`,
          layout: native96SparseFrontContinuityLayout,
          entries: [
            { binding: 0, resource: { buffer: sourceFluid } },
            { binding: 1, resource: { buffer: sourceFront } },
            { binding: 2, resource: { buffer: sourceHistoryCandidates } },
            { binding: 3, resource: { buffer: sourceHistoryDispatchArgs } },
            { binding: 4, resource: { buffer: f16FrontTeacherRequested ? native96F16FrontTeacherModel : native96ExactFrontTeacherModel } },
            { binding: 5, resource: { buffer: predictedFluid } },
            { binding: 6, resource: { buffer: predictedFront } },
            { binding: 7, resource: { buffer: nativeUpsampleFront } },
            { binding: 8, resource: { buffer: sourceHistoryStats } },
          ],
        });
        const teacherTimestampWrites = options.stageTimestampWrites?.native96ExactFrontTeacher || null;
        const continuityTimestampWrites = options.stageTimestampWrites?.native96SparseFrontContinuity || null;
        const initializePass = encoder.beginComputePass({ label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} native96 sparse-front initialize` });
        initializePass.setPipeline(native96SparseFrontInitializePipeline);
        initializePass.setBindGroup(0, continuityBindGroup);
        initializePass.dispatchWorkgroups(Math.ceil(HIGH_GRID / 4), Math.ceil(HIGH_GRID / 4), Math.ceil(HIGH_GRID / 4));
        initializePass.end();
        const teacherPass = encoder.beginComputePass({
          label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} ${f16FrontTeacherRequested ? 'native96 f16' : 'native96 exact f32'} front teacher candidates`,
          ...(teacherTimestampWrites ? { timestampWrites: teacherTimestampWrites } : {}),
        });
        teacherPass.setPipeline(frontAuthorityGateRequested
          ? native96FrontAuthorityGateCandidatePipeline
          : f16FrontTeacherRequested
            ? native96F16FrontTeacherCandidatePipeline
            : native96ExactFrontTeacherCandidatePipeline);
        teacherPass.setBindGroup(0, continuityBindGroup);
        teacherPass.dispatchWorkgroupsIndirect(sourceHistoryDispatchArgs, 0);
        teacherPass.end();
        const featherPass = encoder.beginComputePass({
          label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} native96 sparse-front feather continuity`,
          ...(continuityTimestampWrites ? { timestampWrites: continuityTimestampWrites } : {}),
        });
        featherPass.setPipeline(native96SparseFrontFeatherPipeline);
        featherPass.setBindGroup(0, continuityBindGroup);
        featherPass.dispatchWorkgroups(Math.ceil(HIGH_GRID / 4), Math.ceil(HIGH_GRID / 4), Math.ceil(HIGH_GRID / 4));
        featherPass.end();
        lastNative96SparseFrontContinuity = {
          identity: NATIVE96_SPARSE_FRONT_CONTINUITY,
          enabled: true,
          authority: 'exact-front-teacher-over-uncapped-source-history-candidates-plus-feathered-continuity-v0',
          requestedTeacherExecutionRoute: f16FrontTeacherRequested
            ? NATIVE96_F16_FRONT_TEACHER_CANDIDATES
            : frontAuthorityGateRequested
              ? NATIVE96_FRONT_AUTHORITY_GATED_F32_FRONT_TEACHER_CANDIDATES
            : 'native96-exact-f32-front-teacher-candidates-v0',
          effectiveTeacherExecutionRoute: f16FrontTeacherRequested
            ? NATIVE96_F16_FRONT_TEACHER_CANDIDATES
            : frontAuthorityGateRequested
              ? NATIVE96_FRONT_AUTHORITY_GATED_F32_FRONT_TEACHER_CANDIDATES
            : 'native96-exact-f32-front-teacher-candidates-v0',
          runtimeArithmeticDtype: f16FrontTeacherRequested ? 'f16' : 'f32',
          shaderF16Required: f16FrontTeacherRequested,
          shaderF16Available,
          f16Fallback: false,
          f16FrontTeacherModelIdentity: f16FrontTeacherRequested ? NATIVE96_F16_FRONT_TEACHER_IDENTITY : null,
          f16FrontTeacherModelSha256: f16FrontTeacherRequested ? f16FrontTeacherSha256 : null,
          f16FrontTeacherByteLength: f16FrontTeacherRequested ? NATIVE96_F16_FRONT_TEACHER_BYTE_LENGTH : null,
          frontAuthorityGateRequested,
          frontAuthorityGateEffective: frontAuthorityGateRequested,
          frontAuthorityThresholdEffective: frontAuthorityGateRequested ? frontAuthorityThresholdEffective : null,
          teacherFrontAuthorityAdmittedCount: null,
          teacherFrontAuthorityAdmittedCoverage: null,
          teacherCandidateReduction: null,
          runtimeTruthUsed: false,
          native96ExactFrontTeacherParentCommit: NATIVE96_EXACT_FRONT_TEACHER_PARENT_COMMIT,
          exactFrontTeacherModelIdentity: NATIVE96_EXACT_FRONT_TEACHER_MODEL.identity,
          exactFrontTeacherModelSha256: exactFrontTeacherSha256,
          exactFrontTeacherSourcePackedSha256: NATIVE96_EXACT_FRONT_TEACHER_SOURCE_PACKED_SHA256,
          exactFrontTeacherByteLength: NATIVE96_EXACT_FRONT_TEACHER_MODEL.packed.byteLength,
          fullFeatureAuthority: NATIVE_LOW_FEATURE_AUTHORITY,
          effectiveFeatureCount: NATIVE96_EXACT_FRONT_TEACHER_MODEL.features.featureCount,
          teacherHiddenWidth: NATIVE96_EXACT_FRONT_TEACHER_MODEL.architecture.hiddenWidth,
          candidateListSource: 'real-uncapped-fixed-gate-sourceHistoryCandidates-v0',
          dispatchIdentity: 'dispatchWorkgroupsIndirect-sourceHistoryDispatchArgs-v0',
          hardZeroOutsideCandidateVisuallyRejected: true,
          hardMaskTreatmentClaim: false,
          continuityReconstructionMode: 'feathered-local-5x5x5-front-residual-reconstruction-v0',
          deterministicVsLearnedEffectParity: 'preserve-native96-accepted-structural-delta-v0',
          hiddenCandidateCap: false,
          runtimeTopK: false,
          dynamicPercentile: false,
          fullGridTeacherReferenceRetained: true,
          sparseContinuityTreatmentRendererConsumed: true,
          native96Control: 'native96Control',
          deterministicNativeMaterialization: 'deterministicNativeMaterialization',
          fullExactFrontTeacherReference: 'fullExactFrontTeacherReference',
          sparseFrontContinuityTreatment: 'sparseFrontContinuityTreatment',
          visualClaim: 'requires-inspection-native96-sparse-front-continuity-v0',
          failurePhase: null,
        };
        encodedFrameCount += 1;
        lastHistoryEpochIdentity = currentHistoryEpochIdentity;
        return;
      }
      if (coarseSourceHistorySupportFrontActive) {
        lastCoarseSourceHistorySupportFrontReplacement = {
          identity: NATIVE_LOW_COARSE_SOURCE_HISTORY_SUPPORT_FRONT_REPLACEMENT,
          enabled: true,
          authority: 'coarse-scaffold-plus-fixed-source-history-detail-candidate-measurement-route-v0',
          coarseSourceHistorySupportFrontEnabled: true,
          denseSupportFrontBypassed: true,
          denseRouteRetainedAsControl: true,
          coarseScaffoldAuthority: 'native-low-coarse-front-scaffold-40^3-trilinear-v0',
          sourceHistoryDetailAuthority: 'native-low-source-history-detail-candidate-v0',
          candidateListSource: 'real-uncapped-fixed-gate-sourceHistoryCandidates-v0',
          dispatchIdentity: 'dispatchWorkgroupsIndirect-sourceHistoryDispatchArgs-v0',
          hiddenCandidateCap: false,
          fullGridReceiverMaterialization: false,
          productionPathCpuReadback: false,
          syntheticBenchmarkWeights: false,
          syntheticBenchmarkAuthorityRejected: true,
          learnedVisualClaim: false,
          activeTreatmentPath: false,
          rendererConsumption: false,
          historyEpochValidForAdmission,
          sourceHistoryResetReason,
          failurePhase: null,
        };
        encodedFrameCount += 1;
        lastHistoryEpochIdentity = currentHistoryEpochIdentity;
        return;
      }
      const bindGroup = device.createBindGroup({
        label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} bind group`,
        layout,
        entries: [
          { binding: 0, resource: { buffer: sourceFluid } },
          { binding: 1, resource: { buffer: sourceFront } },
          { binding: 2, resource: { buffer: predictedFluid } },
          { binding: 3, resource: { buffer: predictedFront } },
          { binding: 4, resource: { buffer: model } },
          { binding: 5, resource: { buffer: stats } },
          { binding: 6, resource: { buffer: lowSnapshotFluid } },
          { binding: 7, resource: { buffer: lowSnapshotFront } },
        ],
      });
      const supportTimestampWrites = options.stageTimestampWrites?.supportFront
        ? options.stageTimestampWrites.supportFront
        : options.timestampWrites
        ? { querySet: options.timestampWrites.querySet, beginningOfPassWriteIndex: options.timestampWrites.beginningOfPassWriteIndex }
        : null;
      const residualTimestampWrites = options.stageTimestampWrites?.supportPositiveResidual
        ? options.stageTimestampWrites.supportPositiveResidual
        : options.timestampWrites
        ? { querySet: options.timestampWrites.querySet, endOfPassWriteIndex: options.timestampWrites.endOfPassWriteIndex }
        : null;
      const supportPass = encoder.beginComputePass({
        label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} support+front`,
        ...(supportTimestampWrites ? { timestampWrites: supportTimestampWrites } : {}),
      });
      supportPass.setPipeline(supportPipeline);
      supportPass.setBindGroup(0, bindGroup);
      supportPass.dispatchWorkgroups(Math.ceil(HIGH_GRID / 4), Math.ceil(HIGH_GRID / 4), Math.ceil(HIGH_GRID / 4));
      supportPass.end();
      const finalizeBindGroup = device.createBindGroup({
        label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} finalize residual dispatch args bind group`,
        layout: finalizeResidualDispatchLayout,
        entries: [
          { binding: 0, resource: { buffer: stats } },
          { binding: 1, resource: { buffer: residualDispatchArgs } },
        ],
      });
      const finalizePass = encoder.beginComputePass({ label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} finalize residual dispatch args` });
      finalizePass.setPipeline(finalizeResidualDispatchPipeline);
      finalizePass.setBindGroup(0, finalizeBindGroup);
      finalizePass.dispatchWorkgroups(1);
      finalizePass.end();
      const residualPass = encoder.beginComputePass({
        label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} support-positive residuals`,
        ...(residualTimestampWrites ? { timestampWrites: residualTimestampWrites } : {}),
      });
      residualPass.setPipeline(residualPipeline);
      residualPass.setBindGroup(0, bindGroup);
      residualPass.dispatchWorkgroupsIndirect(residualDispatchArgs, 0);
      residualPass.end();
      const upsampleBindGroup = device.createBindGroup({
        label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} native front upsample bind group`,
        layout: frontUpsampleLayout,
        entries: [
          { binding: 0, resource: { buffer: sourceFront } },
          { binding: 1, resource: { buffer: nativeUpsampleFront } },
        ],
      });
      const upsamplePass = encoder.beginComputePass({ label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} native front upsample` });
      upsamplePass.setPipeline(frontUpsamplePipeline);
      upsamplePass.setBindGroup(0, upsampleBindGroup);
      upsamplePass.dispatchWorkgroups(Math.ceil(HIGH_GRID / 4), Math.ceil(HIGH_GRID / 4), Math.ceil(HIGH_GRID / 4));
      upsamplePass.end();
      encodedFrameCount += 1;
      lastHistoryEpochIdentity = currentHistoryEpochIdentity;
    },
    encodeDeterministicNativeUpsample(encoder, targetFluid, targetFront) {
      if (!encoder || !targetFluid || !targetFront) throw new Error('deterministicNativeUpsampleMissingTarget');
      const bindGroup = device.createBindGroup({
        label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} deterministic native state upsample bind group`,
        layout: deterministicNativeUpsampleLayout,
        entries: [
          { binding: 0, resource: { buffer: lowSnapshotFluid } },
          { binding: 1, resource: { buffer: lowSnapshotFront } },
          { binding: 2, resource: { buffer: targetFluid } },
          { binding: 3, resource: { buffer: targetFront } },
        ],
      });
      const pass = encoder.beginComputePass({ label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} deterministic native 96-to-160 materialization` });
      pass.setPipeline(deterministicNativeUpsamplePipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(Math.ceil(HIGH_GRID / 4), Math.ceil(HIGH_GRID / 4), Math.ceil(HIGH_GRID / 4));
      pass.end();
      return {
        identity: 'deterministic-native-low-nearest-96-to-160-materialization-v0',
        sourceGrid: lowGrid,
        outputGrid: HIGH_GRID,
        hiddenCellCap: false,
      };
    },
    async sampleSupportStats() {
      const values = await readU32Buffer(device, stats, STATS_BYTES, 'native-low shared-device support stats readback');
      const sourceHistoryValues = await readU32Buffer(device, sourceHistoryStats, SOURCE_HISTORY_STATS_BYTES, 'native-low fixed source-delta stats readback');
      const uncappedCandidateCount = Number(sourceHistoryValues[1] || 0);
      const teacherFrontAuthorityAdmittedCount = Number(sourceHistoryValues[2] || 0);
      const sourceHistoryDispatchWorkgroups = Math.ceil(uncappedCandidateCount / RESIDUAL_WORKGROUP_SIZE);
      const sourceHistoryAvailable = Number(sourceHistoryValues[3] || 0) > 0;
      const uncappedCandidateCoverage = uncappedCandidateCount / highCells;
      const normalBasinCoverageMean = 0.100226;
      const mohelWarningThresholdMultiple = 1.5;
      const mohelWarningBoundaryCoverage = normalBasinCoverageMean * mohelWarningThresholdMultiple;
      lastSourceHistoryAdmission = {
        identity: NATIVE_LOW_FIXED_SOURCE_DELTA_ADMISSION,
        authority: 'fixed-q99.5-source-delta-scales-threshold-baseline-v0',
        fixedSourceDeltaCalibrationSha256: SOURCE_DELTA_CALIBRATION_SHA256,
        calibrationPair: '96-97',
        heldPair: '97-98',
        scaleQuantile: 0.995,
        sourceDeltaThreshold: SOURCE_DELTA_THRESHOLD,
        sourceDeltaScales: [...SOURCE_DELTA_SCALES],
        runtimeTopK: false,
        dynamicPercentile: false,
        hiddenCandidateCap: false,
        runtimeTruthUsed: false,
        targetErrorRankingUsed: false,
        sourceChannelCount: 17,
        sourceHistoryAvailable,
        ...lastSourceHistoryEpochReceipt,
        sourceHistoryStatsReadbackAuthority: 'diagnostic-only-not-production-candidate-path-v0',
        productionCandidateNoCpuReadback: true,
        uncappedLowCandidateCount: Number(sourceHistoryValues[0] || 0),
        uncappedCandidateCount,
        uncappedCandidateCoverage,
        teacherFrontAuthorityAdmittedCount: currentFrontAuthorityGateEffective
          ? teacherFrontAuthorityAdmittedCount
          : null,
        teacherFrontAuthorityAdmittedCoverage: currentFrontAuthorityGateEffective
          ? teacherFrontAuthorityAdmittedCount / highCells
          : null,
        calibrationCoverage: 0.1,
        calibrationCandidateCount: 409600,
        calibrationEnergyCapture: 0.830176,
        heldCoverage: 0.100185,
        heldCandidateCount: 410357,
        heldEnergyCapture: 0.826572,
        fixedSourceDeltaLongStripSha256: '7c65fc162fbf2c91e7a614ec6e0b37797d31441872d00ced3bbc325a513f8d23',
        normalBasinCoverageRange: [0.099875, 0.100891],
        normalBasinCoverageMean,
        normalBasinCandidateCountRange: [409086, 413249],
        sourceHistoryDispatchArgsFinalized: true,
        sourceHistoryDispatchIndirectReady: true,
        sourceHistoryDispatchWorkgroups,
        sourceHistoryDispatchThreadCount: sourceHistoryDispatchWorkgroups * RESIDUAL_WORKGROUP_SIZE,
        mohelWarningThresholdMode: 'normal-basin-coverage-mean-multiple-v0',
        mohelWarningThresholdMultiple,
        mohelWarningBoundaryCoverage,
        mohelWarningCoverageRatio: normalBasinCoverageMean > 0 ? uncappedCandidateCoverage / normalBasinCoverageMean : null,
        mohelWarning: uncappedCandidateCoverage > mohelWarningBoundaryCoverage
          ? 'source-history-admission-coverage-exceeds-1.5x-normal-basin-mean-mohel-warning-no-cap-applied'
          : null,
        selectedNextImplementation: 'fixed-gate-candidate-head-dispatch-with-mohel-warning-under-emitter-shifts',
      };
      if (currentFrontAuthorityGateEffective) {
        lastNative96SparseFrontContinuity = {
          ...lastNative96SparseFrontContinuity,
          teacherFrontAuthorityAdmittedCount,
          teacherFrontAuthorityAdmittedCoverage: teacherFrontAuthorityAdmittedCount / highCells,
          teacherCandidateReduction: uncappedCandidateCount > 0
            ? 1 - teacherFrontAuthorityAdmittedCount / uncappedCandidateCount
            : 0,
        };
      }
      lastStats = {
        supportPositiveCount: coarseSourceHistorySupportFrontActive ? uncappedCandidateCount : Number(values[0] || 0),
        supportPrevalence: (coarseSourceHistorySupportFrontActive ? uncappedCandidateCount : Number(values[0] || 0)) / highCells,
        residualDispatchWorkgroups: Math.ceil((coarseSourceHistorySupportFrontActive ? uncappedCandidateCount : Number(values[0] || 0)) / RESIDUAL_WORKGROUP_SIZE),
        residualDispatchThreadCount: Math.ceil((coarseSourceHistorySupportFrontActive ? uncappedCandidateCount : Number(values[0] || 0)) / RESIDUAL_WORKGROUP_SIZE) * RESIDUAL_WORKGROUP_SIZE,
        highCellCount: highCells,
      };
      lastStats.nativeLowInferenceWorkProfile = makeInferenceWorkProfile(lastStats);
      if (coarseSourceHistorySupportFrontActive) {
        const receiverCount = lastVivisectorWidth32Receiver?.candidateCount ?? uncappedCandidateCount;
        lastCoarseSourceHistorySupportFrontReplacement = {
          ...lastCoarseSourceHistorySupportFrontReplacement,
          candidateCount: uncappedCandidateCount,
          candidateCoverage: uncappedCandidateCoverage,
          instanceCount: receiverCount,
          overflowCount: 0,
          candidateInstanceEquality: receiverCount === uncappedCandidateCount,
          sourceHistoryDispatchWorkgroups,
          sourceHistoryDispatchThreadCount: sourceHistoryDispatchWorkgroups * RESIDUAL_WORKGROUP_SIZE,
          historyEpochValidForAdmission: lastSourceHistoryEpochReceipt.historyEpochValidForAdmission === true,
          sourceHistoryResetReason: lastSourceHistoryEpochReceipt.sourceHistoryResetReason,
          staleCueHistoryRejected: lastSourceHistoryEpochReceipt.historyEpochValidForAdmission === true,
          nativeLowInferenceWorkProfile: lastStats.nativeLowInferenceWorkProfile,
        };
      }
      if (lastNative96SparseFrontContinuity.enabled) {
        lastNative96SparseFrontContinuity = {
          ...lastNative96SparseFrontContinuity,
          candidateCount: uncappedCandidateCount,
          instanceCount: uncappedCandidateCount,
          overflowCount: 0,
          candidateInstanceEquality: true,
          uncappedCandidateCount,
          uncappedCandidateCoverage,
          sourceHistoryDispatchWorkgroups,
          sourceHistoryDispatchThreadCount: sourceHistoryDispatchWorkgroups * RESIDUAL_WORKGROUP_SIZE,
          sourceHistoryAvailable,
          historyEpochValidForAdmission: lastSourceHistoryEpochReceipt.historyEpochValidForAdmission === true,
          sourceHistoryResetReason: lastSourceHistoryEpochReceipt.sourceHistoryResetReason,
          mohelWarning: lastSourceHistoryAdmission.mohelWarning,
          nativeLowInferenceWorkProfile: lastStats.nativeLowInferenceWorkProfile,
        };
      }
      return { ...lastStats, nativeLowFixedSourceDeltaAdmission: lastSourceHistoryAdmission };
    },
    makeCandidateHeadCostMicrobenchmarkReceipt(widthTimings = null, timestampValues = []) {
      lastCandidateHeadBenchmark = makeCandidateHeadBenchmarkReceipt(widthTimings, timestampValues);
      return { ...lastCandidateHeadBenchmark };
    },
    makeVivisectorWidth32ReceiverReceipt(receiver, gpuMs = null, timestampValues = []) {
      lastVivisectorWidth32Receiver = makeVivisectorWidth32ReceiverReceipt(receiver, gpuMs, timestampValues);
      return { ...lastVivisectorWidth32Receiver };
    },
    async sampleCandidateCueBufferLifecycle() {
      const values = await readU32Buffer(
        device,
        candidateCueLifecycleStats,
        CANDIDATE_CUE_LIFECYCLE_STATS_BYTES,
        'native-low resident cue-buffer lifecycle stats readback',
      );
      const currentCount = Number(values[4] || lastSourceHistoryAdmission.uncappedCandidateCount || 0);
      const previousCount = Number(values[5] || lastCandidateCueLifecycleEncodeReceipt.previousCandidateCount || 0);
      const activeTokenMismatchCount = Number(values[1] || 0);
      const staleTailRowsChecked = Number(values[2] || 0);
      const staleTailNonzeroCount = Number(values[3] || 0);
      lastCandidateCueBufferLifecycle = {
        identity: NATIVE_LOW_RESIDENT_CUE_BUFFER_LIFECYCLE_STRESS,
        enabled: lastCandidateCueLifecycleEncodeReceipt.stressEnabled === true,
        claimScope: 'lifecycle-cost-substrate-not-fidelity-or-visual-evidence-v0',
        syntheticWeightsAuthority: 'synthetic-deterministic-candidate-head-cost-substrate-not-learned-evidence-v0',
        coarseLatentAuthority: 'deterministic-synthetic-coarse-latent-v0',
        candidateListSource: 'real-uncapped-fixed-gate-sourceHistoryCandidates-v0',
        dispatchMode: 'dispatchWorkgroupsIndirect-sourceHistoryDispatchArgs-v0',
        lifecycleCheckDispatchMode: 'full-capacity-diagnostic-check-no-candidate-cap-v0',
        outputSchema: {
          identity: 'compact-renderer-facing-cue-record-v0',
          cueRecordStrideBytes: CANDIDATE_CUE_RECORD_STRIDE_BYTES,
          cueRecordVec4Count: 2,
          lifecycleTokenChannel: 'cueRecord[1].w diagnostic token under synthetic benchmark stress',
        },
        candidateCueRecordCapacity: highCells,
        candidateCueRecordCapacityBytes: highCells * CANDIDATE_CUE_RECORD_STRIDE_BYTES,
        candidateCueRecordAllocationCount: 1,
        candidateCueRecordReuseCount,
        candidateCueRecordGrowthCount: 0,
        noReallocation: true,
        noLeak: true,
        hiddenCandidateCap: false,
        candidateCount: currentCount,
        previousCandidateCount: previousCount,
        candidateCountChanged: currentCount !== previousCount,
        candidateCountDecrease: currentCount < previousCount,
        candidateCountWithinCapacity: currentCount <= highCells,
        activeRowsChecked: Number(values[0] || 0),
        activeTokenMismatchCount,
        staleTailRowsChecked,
        staleTailNonzeroCount,
        staleCueRowsRetained: staleTailNonzeroCount > 0,
        lifecycleToken: Number(values[6] || lastCandidateCueLifecycleEncodeReceipt.token || 0),
        reportedCapacityFromGpu: Number(values[7] || highCells),
        statsReadbackAuthority: 'diagnostic-only-lifecycle-stress-readback-not-production-path-v0',
        productionPathCpuReadback: false,
        diagnosticReceiptReadbackOnly: true,
        fidelityClaim: false,
        visualClaim: false,
        failurePhase: null,
      };
      return { ...lastCandidateCueBufferLifecycle };
    },
    async sampleSupportTileProfile() {
      const started = performance.now();
      const supportMass = Number(lastStats.supportPositiveCount || 0);
      if (supportMass <= 0) {
        lastSupportTileProfile = makeEmptySupportTileProfile(performance.now() - started);
        return { ...lastSupportTileProfile };
      }
      const supportIndices = await readU32BufferRange(
        device,
        lowSnapshotFront,
        lowFrontBytes,
        supportMass * Uint32Array.BYTES_PER_ELEMENT,
        'native-low shared-device support-proximal tile profile readback',
      );
      const tileSize = 16;
      const tileGrid = Math.ceil(HIGH_GRID / tileSize);
      const activeTiles = new Set();
      let sumX = 0;
      let sumY = 0;
      let sumZ = 0;
      let minX = HIGH_GRID;
      let minY = HIGH_GRID;
      let minZ = HIGH_GRID;
      let maxX = 0;
      let maxY = 0;
      let maxZ = 0;
      for (const highIndex of supportIndices) {
        const z = Math.floor(highIndex / (HIGH_GRID * HIGH_GRID));
        const y = Math.floor((highIndex - z * HIGH_GRID * HIGH_GRID) / HIGH_GRID);
        const x = highIndex - z * HIGH_GRID * HIGH_GRID - y * HIGH_GRID;
        sumX += x;
        sumY += y;
        sumZ += z;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        minZ = Math.min(minZ, z);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        maxZ = Math.max(maxZ, z);
        const tx = Math.floor(x / tileSize);
        const ty = Math.floor(y / tileSize);
        const tz = Math.floor(z / tileSize);
        activeTiles.add(tx + ty * tileGrid + tz * tileGrid * tileGrid);
      }
      const activeTileCount = activeTiles.size;
      const tileCellCount = tileSize ** 3;
      const projectedSupportFrontCellCount = Math.min(highCells, activeTileCount * tileCellCount);
      lastSupportTileProfile = {
        identity: 'native-low-support-proximal-tile-profile-v0',
        authority: 'diagnostic-compacted-support-index-readback-v0',
        diagnosticFullSupportPassRequired: true,
        tileProfileReadbackMs: performance.now() - started,
        tileSize,
        tileGrid,
        highCellCount: highCells,
        supportMass,
        supportCentroid: {
          cell: { x: sumX / supportMass, y: sumY / supportMass, z: sumZ / supportMass },
          normalized: {
            x: (sumX / supportMass) / Math.max(1, HIGH_GRID - 1),
            y: (sumY / supportMass) / Math.max(1, HIGH_GRID - 1),
            z: (sumZ / supportMass) / Math.max(1, HIGH_GRID - 1),
          },
        },
        supportExtent: {
          minCell: { x: minX, y: minY, z: minZ },
          maxCell: { x: maxX, y: maxY, z: maxZ },
          sizeCells: { x: maxX - minX + 1, y: maxY - minY + 1, z: maxZ - minZ + 1 },
        },
        activeTileCount,
        activeTileCoverage: activeTileCount / (tileGrid ** 3),
        projectedSupportFrontCellCount,
        projectedCellReduction: 1 - projectedSupportFrontCellCount / highCells,
        hiddenSupportCap: false,
        droppedInputChannels: false,
      };
      return { ...lastSupportTileProfile };
    },
    async sampleSourceProximalTileCandidate(options = {}) {
      const started = performance.now();
      const sourceFrontThreshold = Number.isFinite(options.sourceFrontThreshold) ? Math.max(0, options.sourceFrontThreshold) : 1e-6;
      const sourceTileDilation = Number.isFinite(options.sourceTileDilation) ? Math.max(0, Math.floor(options.sourceTileDilation)) : 1;
      const tileSize = 16;
      const tileGrid = Math.ceil(HIGH_GRID / tileSize);
      const tileCellCount = tileSize ** 3;
      const candidateTiles = new Set();
      const addCandidateTile = (tx, ty, tz) => {
        if (tx < 0 || ty < 0 || tz < 0 || tx >= tileGrid || ty >= tileGrid || tz >= tileGrid) return;
        candidateTiles.add(tx + ty * tileGrid + tz * tileGrid * tileGrid);
      };
      const sourceBits = await readU32BufferRange(
        device,
        lowSnapshotFront,
        0,
        lowFrontBytes,
        'native-low shared-device source-proximal tile candidate low-front readback',
      );
      const sourceFront = new Float32Array(sourceBits.buffer);
      let sourceActiveLowCellCount = 0;
      for (let lowIndex = 0; lowIndex < sourceFront.length; lowIndex += 1) {
        const value = sourceFront[lowIndex];
        if (!Number.isFinite(value) || Math.abs(value) <= sourceFrontThreshold) continue;
        sourceActiveLowCellCount += 1;
        const z = Math.floor(lowIndex / (lowGrid * lowGrid));
        const y = Math.floor((lowIndex - z * lowGrid * lowGrid) / lowGrid);
        const x = lowIndex - z * lowGrid * lowGrid - y * lowGrid;
        const hx = Math.min(HIGH_GRID - 1, Math.floor(x * HIGH_GRID / lowGrid));
        const hy = Math.min(HIGH_GRID - 1, Math.floor(y * HIGH_GRID / lowGrid));
        const hz = Math.min(HIGH_GRID - 1, Math.floor(z * HIGH_GRID / lowGrid));
        const tx = Math.floor(hx / tileSize);
        const ty = Math.floor(hy / tileSize);
        const tz = Math.floor(hz / tileSize);
        for (let dz = -sourceTileDilation; dz <= sourceTileDilation; dz += 1) {
          for (let dy = -sourceTileDilation; dy <= sourceTileDilation; dy += 1) {
            for (let dx = -sourceTileDilation; dx <= sourceTileDilation; dx += 1) {
              addCandidateTile(tx + dx, ty + dy, tz + dz);
            }
          }
        }
      }
      const denseSupportCount = Number(lastStats.supportPositiveCount || 0);
      let supportMissedByCandidateCount = 0;
      if (denseSupportCount > 0) {
        const supportIndices = await readU32BufferRange(
          device,
          lowSnapshotFront,
          lowFrontBytes,
          denseSupportCount * Uint32Array.BYTES_PER_ELEMENT,
          'native-low shared-device source-proximal candidate support comparison readback',
        );
        for (const highIndex of supportIndices) {
          const z = Math.floor(highIndex / (HIGH_GRID * HIGH_GRID));
          const y = Math.floor((highIndex - z * HIGH_GRID * HIGH_GRID) / HIGH_GRID);
          const x = highIndex - z * HIGH_GRID * HIGH_GRID - y * HIGH_GRID;
          const tx = Math.floor(x / tileSize);
          const ty = Math.floor(y / tileSize);
          const tz = Math.floor(z / tileSize);
          const tileId = tx + ty * tileGrid + tz * tileGrid * tileGrid;
          if (!candidateTiles.has(tileId)) supportMissedByCandidateCount += 1;
        }
      }
      const candidateTileCount = candidateTiles.size;
      const projectedCandidateCellCount = Math.min(highCells, candidateTileCount * tileCellCount);
      const supportCoveredByCandidateCount = Math.max(0, denseSupportCount - supportMissedByCandidateCount);
      lastSourceTileCandidate = {
        identity: NATIVE_LOW_SOURCE_PROXIMAL_TILE_CANDIDATE,
        authority: 'current-source-low-front-tile-prior-compared-to-frozen-dense-support-v0',
        candidateEvaluationMode: 'diagnostic-dense-route-comparison-not-active-treatment-v0',
        diagnosticFullDenseSupportPassRequired: true,
        denseRouteRetained: true,
        candidateReadbackMs: performance.now() - started,
        sourceFrontThreshold,
        sourceTileDilation,
        tileSize,
        tileGrid,
        lowCellCount: lowCells,
        highCellCount: highCells,
        sourceActiveLowCellCount,
        candidateTileCount,
        candidateTileCoverage: candidateTileCount / (tileGrid ** 3),
        projectedCandidateCellCount,
        projectedCellReduction: 1 - projectedCandidateCellCount / highCells,
        denseSupportCount,
        supportCoveredByCandidateCount,
        supportMissedByCandidateCount,
        supportMissRate: denseSupportCount > 0 ? supportMissedByCandidateCount / denseSupportCount : 0,
        candidateCapturesAllDenseSupport: supportMissedByCandidateCount === 0,
        hiddenSupportCap: false,
        droppedInputChannels: false,
      };
      return { ...lastSourceTileCandidate };
    },
    debugState() {
      const nativeLowInferenceWorkProfile = lastStats.nativeLowInferenceWorkProfile || makeInferenceWorkProfile(lastStats);
      return {
        routeIdentity: NATIVE_LOW_SHARED_DEVICE_ROUTE,
        runtimeBuildIdentity: NATIVE_LOW_RUNTIME_BUILD_IDENTITY,
        transportMode: NATIVE_LOW_TRANSPORT_MODE,
        routeRegistryIdentity: NATIVE_LOW_TRAINED_PACKAGE_ROUTE_REGISTRY_IDENTITY,
        requestedTransferRouteId: transferRouteId,
        effectiveTransferRouteId: route.routeId,
        nativeLowTrainedPackageRoute: {
          identity: 'native-low-trained-package-route-v0',
          registryIdentity: NATIVE_LOW_TRAINED_PACKAGE_ROUTE_REGISTRY_IDENTITY,
          requestedTransferRouteId: transferRouteId,
          effectiveTransferRouteId: route.routeId,
          packageIdentity: route.packageIdentity,
          modelIdentity: route.modelIdentity,
          packageSha256: route.packageSha256,
          modelSha256: route.modelSha256,
          trainedLowGrid: route.trainedLowGrid,
          trainedHighGrid: route.trainedHighGrid,
          effectiveSourceGrid: lowGrid,
          dispatchIdentity: route.dispatchIdentity,
          sourceHistoryDispatchIdentity: route.sourceHistoryDispatchIdentity,
          rankingClaim: false,
        },
        requestedBackend: 'WebGPU',
        effectiveBackend: 'WebGPU',
        fallbackBackend: null,
        modelIdentity: selectedModel.identity,
        modelSha256,
        inputAuthority: NATIVE_LOW_INPUT_AUTHORITY,
        featureAuthority: NATIVE_LOW_FEATURE_AUTHORITY,
        effectiveFeatureCount: selectedModel.features.featureCount,
        noHiddenCaps: true,
        encodedFrameCount,
        sourceHistoryEpochReceipt: lastSourceHistoryEpochReceipt,
        nativeLowInferenceWorkProfile,
        nativeLowSupportTileProfile: lastSupportTileProfile,
        nativeLowSourceTileCandidate: lastSourceTileCandidate,
        nativeLowFixedSourceDeltaAdmission: lastSourceHistoryAdmission,
        nativeLowCandidateHeadCostMicrobenchmark: lastCandidateHeadBenchmark,
        nativeLowVivisectorWidth32LiveReceiver: lastVivisectorWidth32Receiver,
        nativeLowCoarseSourceHistorySupportFrontReplacement: lastCoarseSourceHistorySupportFrontReplacement,
        native96SparseFrontContinuity: lastNative96SparseFrontContinuity,
        nativeLowCandidateCueBufferLifecycle: lastCandidateCueBufferLifecycle,
        ...lastStats,
      };
    },
    destroy() {
      lowSnapshotFluid.destroy();
      lowSnapshotFront.destroy();
      predictedFluid.destroy();
      predictedFront.destroy();
      nativeUpsampleFront.destroy();
      residualDispatchArgs.destroy();
      sourceHistoryCandidates.destroy();
      sourceHistoryStats.destroy();
      sourceHistoryDispatchArgs.destroy();
      candidateCueRecords.destroy();
      candidateCueLifecycleStats.destroy();
      candidateCueLifecycleParams.destroy();
      vivisectorWidth32WeightsBuffer?.destroy?.();
      stats.destroy();
      model.destroy();
      native96ExactFrontTeacherModel.destroy();
      native96F16FrontTeacherModel.destroy();
    },
  };
}

export async function createNativeLowSelectiveLiveRuntime(options = {}) {
  return createNativeLowSelectiveSharedDeviceRuntime(options);
}
