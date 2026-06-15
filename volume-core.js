const ROUTE_IDENTITY = 'native-3d-compute-fluid-raymarch-v0';
const PROTOTYPE_IDENTITY = 'kaminos-volume-prototype-v0';
const DEFAULT_GRID_SIZE = 96;
const SUPPORTED_GRID_SIZES = [32, 48, 64, 96, 128, 160];
const FLUID_SLOTS_PER_CELL = 4;
const FLUID_COMPONENTS = FLUID_SLOTS_PER_CELL * 4;
const DEFAULT_MAJORANT_GRID_SIZE = 48;
const SUPPORTED_MAJORANT_GRID_SIZES = [24, 32, 48];
const MAX_EXTERNAL_EMITTERS = 32;
const EXTERNAL_EMITTER_COMPONENTS = 20;
const DEFAULT_VOLUME_SCENE = 'compact_plume';
const SUPPORTED_VOLUME_SCENES = new Set([DEFAULT_VOLUME_SCENE, 'tall_plume', 'bonfire_plume']);

function normalizeGridSize(value) {
  const requested = Number(value);
  if (SUPPORTED_GRID_SIZES.includes(requested)) return requested;
  return DEFAULT_GRID_SIZE;
}

function normalizeMajorantGridSize(value) {
  const requested = Number(value);
  if (SUPPORTED_MAJORANT_GRID_SIZES.includes(requested)) return requested;
  return DEFAULT_MAJORANT_GRID_SIZE;
}

function normalizeRenderScale(value) {
  const requested = Number(value);
  if (!Number.isFinite(requested)) return 0.85;
  return Math.max(0.6, Math.min(1, requested));
}

function normalizeVolumeScene(value) {
  return SUPPORTED_VOLUME_SCENES.has(value) ? value : DEFAULT_VOLUME_SCENE;
}

function normalizeWindStrength(value) {
  return clampFinite(value, 0, 1.5, 0);
}

function normalizeWindAngle(value) {
  return clampFinite(value, -180, 180, 0);
}

function normalizeWindHeight(value) {
  return clampFinite(value, -0.8, 0.8, 0.15);
}

function volumeSceneMode(value) {
  const scene = normalizeVolumeScene(value);
  if (scene === 'tall_plume') return 1;
  if (scene === 'bonfire_plume') return 2;
  return 0;
}

function gridCellCount(gridSize) {
  return gridSize * gridSize * gridSize;
}

function fluidBufferBytes(gridSize) {
  return gridCellCount(gridSize) * FLUID_COMPONENTS * Float32Array.BYTES_PER_ELEMENT;
}

function majorantBufferBytes(majorantGridSize = DEFAULT_MAJORANT_GRID_SIZE) {
  return majorantGridSize * majorantGridSize * majorantGridSize * 4 * Float32Array.BYTES_PER_ELEMENT;
}

function externalEmitterBufferBytes() {
  return MAX_EXTERNAL_EMITTERS * EXTERNAL_EMITTER_COMPONENTS * Float32Array.BYTES_PER_ELEMENT;
}

function clampFinite(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function externalEmitterNowMs() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function syntheticHandTrailEmitters(nowMs = externalEmitterNowMs()) {
  const t = nowMs * 0.001;
  const emitters = [];
  for (let i = 0; i < 5; i += 1) {
    const f = i - 2;
    const phase = t * 1.75 + i * 0.72;
    const x = f * 0.105 + Math.sin(phase * 0.81) * 0.035;
    const y = -0.58 + Math.sin(phase * 0.63) * 0.28 + i * 0.012;
    const z = Math.cos(phase * 0.74) * 0.055;
    const dx = Math.cos(phase * 1.17) * 0.075;
    const dy = 0.05 + Math.sin(phase * 0.91) * 0.045;
    const dz = Math.sin(phase * 1.23) * 0.055;
    emitters.push({
      start: [x - dx, y - dy, z - dz],
      end: [x + dx, y + dy, z + dz],
      radius: 0.030 + i * 0.002,
      strength: 0.92,
      velocity: [dx * 2.2, 0.20 + dy * 1.8, dz * 2.0],
      smoke: 0.62,
      heat: 1.08,
      fuel: 0.72,
      flame: 1.18,
      detail: 0.82,
      lifetime: 0.55,
      active: true,
    });
  }
  return emitters;
}

function normalizeExternalEmitters(payload = {}, nowMs = externalEmitterNowMs()) {
  const emitters = Array.isArray(payload.emitters) ? payload.emitters.slice(0, MAX_EXTERNAL_EMITTERS) : [];
  const data = new Float32Array(MAX_EXTERNAL_EMITTERS * EXTERNAL_EMITTER_COMPONENTS);
  const timestampMs = clampFinite(payload.timestampMs, 0, Number.MAX_SAFE_INTEGER, nowMs);
  const ageSeconds = Math.max(0, (nowMs - timestampMs) / 1000);
  const coordinateSpace = 'volume-local';
  let count = 0;
  for (const emitter of emitters) {
    if (!emitter || emitter.active === false) continue;
    const start = Array.isArray(emitter.start) ? emitter.start : [0, -0.72, 0];
    const end = Array.isArray(emitter.end) ? emitter.end : start;
    const velocity = Array.isArray(emitter.velocity) ? emitter.velocity : [0, 0.18, 0];
    const offset = count * EXTERNAL_EMITTER_COMPONENTS;
    data[offset] = clampFinite(start[0], -1.5, 1.5, 0);
    data[offset + 1] = clampFinite(start[1], -1.5, 1.5, -0.72);
    data[offset + 2] = clampFinite(start[2], -1.5, 1.5, 0);
    data[offset + 3] = clampFinite(emitter.radius, 0.006, 0.18, 0.028);
    data[offset + 4] = clampFinite(end[0], -1.5, 1.5, data[offset]);
    data[offset + 5] = clampFinite(end[1], -1.5, 1.5, data[offset + 1]);
    data[offset + 6] = clampFinite(end[2], -1.5, 1.5, data[offset + 2]);
    data[offset + 7] = clampFinite(emitter.strength, 0, 4, 1);
    data[offset + 8] = clampFinite(velocity[0], -3, 3, 0);
    data[offset + 9] = clampFinite(velocity[1], -3, 3, 0.18);
    data[offset + 10] = clampFinite(velocity[2], -3, 3, 0);
    data[offset + 11] = clampFinite(emitter.ageSeconds, 0, 10, ageSeconds);
    data[offset + 12] = clampFinite(emitter.smoke, 0, 3, 0.62);
    data[offset + 13] = clampFinite(emitter.heat, 0, 4, 1.08);
    data[offset + 14] = clampFinite(emitter.fuel, 0, 3, 0.72);
    data[offset + 15] = clampFinite(emitter.flame, 0, 4, 1.18);
    data[offset + 16] = clampFinite(emitter.detail, 0, 3, 0.82);
    data[offset + 17] = clampFinite(emitter.lifetime, 0.016, 8, 0.55);
    data[offset + 18] = 0;
    data[offset + 19] = 1;
    count += 1;
  }
  return {
    data,
    count,
    mode: payload.mode || (count > 0 ? 'external' : 'off'),
    coordinateSpace: count > 0 ? coordinateSpace : 'none',
    timestampMs,
    frameId: payload.frameId ?? null,
    ageMs: Math.max(0, nowMs - timestampMs),
  };
}

const WGSL = /* wgsl */`
override GRID: u32 = 64u;
override MAJORANT_GRID: u32 = 24u;
const SLOTS_PER_CELL: u32 = 4u;
const MAX_EXTERNAL_EMITTERS_WGSL: u32 = 32u;

struct Uniforms {
  invViewProj: mat4x4<f32>,
  cameraPos_time: vec4<f32>,
  viewport_steps_density: vec4<f32>,
  fire_smoke_curl_speed: vec4<f32>,
  grid_overlay_debug: vec4<f32>,
  source_controls: vec4<f32>,
  radiance_controls: vec4<f32>,
  occupancy_controls: vec4<f32>,
  temporal_controls: vec4<f32>,
  scale_controls: vec4<f32>,
  scene_controls: vec4<f32>,
  previousViewProj: mat4x4<f32>,
};

struct ExternalEmitter {
  start_radius: vec4<f32>,
  end_strength: vec4<f32>,
  velocity_age: vec4<f32>,
  material: vec4<f32>,
  detail_lifetime: vec4<f32>,
};

struct ExternalEmitterInfluence {
  material: vec4<f32>,
  fire: vec4<f32>,
  micro: vec4<f32>,
  velocity: vec4<f32>,
};

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read> fluidSrc: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> fluidDst: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> majorantField: array<vec4<f32>>;
@group(0) @binding(4) var historyTexture: texture_2d<f32>;
@group(0) @binding(5) var historySampler: sampler;
@group(0) @binding(6) var<storage, read> externalEmitters: array<ExternalEmitter>;
@group(1) @binding(0) var<storage, read_write> majorantDst: array<vec4<f32>>;

struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs(@builtin(vertex_index) i: u32) -> VSOut {
  var p = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -3.0),
    vec2<f32>( 3.0,  1.0),
    vec2<f32>(-1.0,  1.0)
  );
  var out: VSOut;
  out.pos = vec4<f32>(p[i], 0.0, 1.0);
  out.uv = p[i] * 0.5 + vec2<f32>(0.5);
  return out;
}

fn hash31(p: vec3<f32>) -> f32 {
  let q = fract(p * 0.1031);
  let r = q + dot(q, q.yzx + 33.33);
  return fract((r.x + r.y) * r.z);
}

fn sampleHistoryColor(uv: vec2<f32>) -> vec3<f32> {
  return textureSampleLevel(historyTexture, historySampler, clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0)), 0.0).rgb;
}

fn temporalReprojectionUv(worldPos: vec3<f32>, velocity: vec3<f32>, confidence: f32) -> vec3<f32> {
  let historyLag = mix(0.012, 0.042, clamp(confidence, 0.0, 1.0));
  let previousWorld = worldPos - velocity * historyLag;
  let clip = u.previousViewProj * vec4<f32>(previousWorld, 1.0);
  let safeW = max(abs(clip.w), 0.0001);
  let ndc = clip.xy / safeW;
  let uv = vec2<f32>(ndc.x * 0.5 + 0.5, 1.0 - (ndc.y * 0.5 + 0.5));
  let validX = step(0.0, uv.x) * step(uv.x, 1.0);
  let validY = step(0.0, uv.y) * step(uv.y, 1.0);
  let validW = step(0.0001, clip.w);
  return vec3<f32>(uv, validX * validY * validW);
}

fn temporalReprojectionConfidence(materialWeight: f32, majorantEdge: f32, reactiveSignal: f32) -> f32 {
  let materialConfidence = smoothstep(0.012, 0.18, materialWeight);
  let edgePenalty = 1.0 - smoothstep(0.05, 0.34, majorantEdge);
  let reactivePenalty = 1.0 - smoothstep(0.18, 1.15, reactiveSignal);
  return clamp(materialConfidence * edgePenalty * reactivePenalty, 0.0, 1.0);
}

fn temporalJitterOffset(uv: vec2<f32>, dtBase: f32) -> f32 {
  let temporalJitter = clamp(u.temporal_controls.y, 0.0, 1.0);
  let temporalFrame = u.temporal_controls.w;
  let pixel = floor(uv * u.viewport_steps_density.xy);
  let interleaved = hash31(vec3<f32>(pixel + vec2<f32>(temporalFrame * 17.0, temporalFrame * 29.0), temporalFrame));
  let r2 = fract(temporalFrame * 0.754877666 + interleaved * 0.569840296);
  return mix(0.5, r2, temporalJitter) * dtBase;
}

fn temporalHistoryClamp(history: vec3<f32>, current: vec3<f32>, clampStrength: f32) -> vec3<f32> {
  let currentLuma = dot(current, vec3<f32>(0.2126, 0.7152, 0.0722));
  let historyLuma = dot(history, vec3<f32>(0.2126, 0.7152, 0.0722));
  let energyDelta = abs(currentLuma - historyLuma);
  let fireTighten = smoothstep(0.42, 0.92, max(current.r, current.g));
  let radius = mix(vec3<f32>(0.26), vec3<f32>(0.045), clampStrength) + current * mix(0.10, 0.035, fireTighten) + vec3<f32>(energyDelta * 0.045);
  return clamp(history, max(vec3<f32>(0.0), current - radius), current + radius);
}

fn cheapTemporalRamp(x: f32, lo: f32, hi: f32) -> f32 {
  return clamp((x - lo) / max(hi - lo, 0.0001), 0.0, 1.0);
}

struct MaterialTemporalSignals {
  lanes: vec4<f32>,
  protectedDetail: f32,
  sampleWeight: f32,
  reactiveBoost: f32,
};

fn materialTemporalSignals(alpha: f32, smokeAlpha: f32, fireAlpha: f32, temp: f32, microTextureSignal: f32, interfaceShred: f32, fireLick: f32, majorantEdge: f32, interest: f32, trans: f32) -> MaterialTemporalSignals {
  let fireHistoryProtect = clamp(
    cheapTemporalRamp(fireAlpha, 0.010, 0.105)
      + cheapTemporalRamp(temp, 0.40, 1.18) * 0.70
      + cheapTemporalRamp(fireLick, 0.045, 0.36) * 0.36,
    0.0,
    1.0
  );
  let interfaceSignal = interfaceShred * 1.30 + fireLick * 0.34 + majorantEdge * 0.82;
  let detailSignal = microTextureSignal + interest * 0.20;
  let interfaceHistoryProtect = clamp(
    cheapTemporalRamp(interfaceSignal, 0.035, 0.52)
      + cheapTemporalRamp(detailSignal, 0.22, 1.20) * 0.30,
    0.0,
    1.0
  );
  let detailHistoryProtect = clamp(
    cheapTemporalRamp(detailSignal, 0.24, 1.35) * 0.74
      + interfaceHistoryProtect * 0.26,
    0.0,
    1.0
  );
  let smokeBody = cheapTemporalRamp(smokeAlpha, 0.012, 0.13) * (1.0 - cheapTemporalRamp(fireAlpha, 0.006, 0.075));
  let smokeHistoryTrust = clamp(
    smokeBody * (1.0 - fireHistoryProtect * 0.82) * (1.0 - interfaceHistoryProtect * 0.52)
      + cheapTemporalRamp(smokeAlpha, 0.025, 0.22) * 0.12,
    0.0,
    1.0
  );
  let protectedDetail = max(fireHistoryProtect, max(interfaceHistoryProtect, detailHistoryProtect));
  let smokeCarrier = smokeAlpha * (1.35 + smokeHistoryTrust * 0.68);
  let hotCarrier = fireAlpha * (3.10 + protectedDetail * 1.20);
  let edgeCarrier = interest * (0.030 + protectedDetail * 0.040);
  let sampleWeight = clamp((alpha * 2.20 + smokeCarrier + hotCarrier + edgeCarrier) * trans, 0.0, 1.0);
  let reactiveBoost = fireHistoryProtect * 0.36 + interfaceHistoryProtect * 0.22;
  return MaterialTemporalSignals(vec4<f32>(smokeHistoryTrust, fireHistoryProtect, interfaceHistoryProtect, detailHistoryProtect), protectedDetail, sampleWeight, reactiveBoost);
}

fn materialTemporalClassificationFromSignals(signals: MaterialTemporalSignals) -> vec4<f32> {
  return signals.lanes;
}

fn materialTemporalClassification(smokeAlpha: f32, fireAlpha: f32, temp: f32, microTextureSignal: f32, interfaceShred: f32, fireLick: f32, majorantEdge: f32, interest: f32) -> vec4<f32> {
  return materialTemporalClassificationFromSignals(materialTemporalSignals(smokeAlpha + fireAlpha, smokeAlpha, fireAlpha, temp, microTextureSignal, interfaceShred, fireLick, majorantEdge, interest, 1.0));
}

fn materialAwareImportanceWeightFromSignals(signals: MaterialTemporalSignals) -> f32 {
  return signals.sampleWeight;
}

fn materialAwareImportanceWeight(alpha: f32, smokeAlpha: f32, fireAlpha: f32, interest: f32, materialTemporal: vec4<f32>, trans: f32) -> f32 {
  let protectedDetail = max(materialTemporal.y, max(materialTemporal.z, materialTemporal.w));
  let smokeCarrier = smokeAlpha * (1.35 + materialTemporal.x * 0.68);
  let hotCarrier = fireAlpha * (3.10 + protectedDetail * 1.20);
  let edgeCarrier = interest * (0.030 + protectedDetail * 0.040);
  return clamp((alpha * 2.20 + smokeCarrier + hotCarrier + edgeCarrier) * trans, 0.0, 1.0);
}

fn materialAwareTemporalWeights(smokeHistoryTrustSum: f32, fireHistoryProtectSum: f32, interfaceHistoryProtectSum: f32, detailHistoryProtectSum: f32, materialWeight: f32) -> vec4<f32> {
  let inv = 1.0 / max(materialWeight, 0.0001);
  let fireHistoryProtect = clamp(fireHistoryProtectSum * inv, 0.0, 1.0);
  let interfaceHistoryProtect = clamp(interfaceHistoryProtectSum * inv, 0.0, 1.0);
  let detailHistoryProtect = clamp(detailHistoryProtectSum * inv, 0.0, 1.0);
  let smokeHistoryTrust = clamp(smokeHistoryTrustSum * inv * (1.0 - fireHistoryProtect * 0.58) * (1.0 - interfaceHistoryProtect * 0.40), 0.0, 1.0);
  return vec4<f32>(smokeHistoryTrust, fireHistoryProtect, interfaceHistoryProtect, detailHistoryProtect);
}

fn temporalReactiveMask(current: vec3<f32>, history: vec3<f32>, confidence: f32, reactiveSignal: f32, majorantEdge: f32, historyUvValid: f32, materialTemporalWeights: vec4<f32>) -> f32 {
  let currentLuma = dot(current, vec3<f32>(0.2126, 0.7152, 0.0722));
  let historyLuma = dot(history, vec3<f32>(0.2126, 0.7152, 0.0722));
  let currentHot = max(current.r, current.g);
  let historyHot = max(history.r, history.g);
  let smokeHistoryTrust = materialTemporalWeights.x;
  let fireHistoryProtect = materialTemporalWeights.y;
  let interfaceHistoryProtect = materialTemporalWeights.z;
  let detailHistoryProtect = materialTemporalWeights.w;
  let hotMismatch = smoothstep(0.055, 0.27, abs(historyHot - currentHot));
  let colorMismatch = smoothstep(0.045, 0.24, length(history - current));
  let fireReactive = smoothstep(0.22, 0.76, currentHot) * 0.78 + smoothstep(0.30, 1.10, reactiveSignal) * 0.82 + fireHistoryProtect * 0.76;
  let smokeBodyLoss = smoothstep(0.025, 0.16, historyLuma - currentLuma) * (1.0 - smokeHistoryTrust * 0.42);
  let edgeReactive = smoothstep(0.08, 0.34, majorantEdge) + interfaceHistoryProtect * 0.58 + detailHistoryProtect * 0.28;
  let invalid = 1.0 - historyUvValid * step(0.03, confidence);
  return clamp(max(max(hotMismatch, colorMismatch), max(fireReactive, max(smokeBodyLoss, edgeReactive))) + invalid, 0.0, 1.0);
}

fn temporalHistoryWeight(current: vec3<f32>, history: vec3<f32>, confidence: f32, reactiveMask: f32, materialTemporalWeights: vec4<f32>) -> f32 {
  let temporalAccum = clamp(u.temporal_controls.x, 0.0, 0.90);
  let currentLuma = dot(current, vec3<f32>(0.2126, 0.7152, 0.0722));
  let historyLuma = dot(history, vec3<f32>(0.2126, 0.7152, 0.0722));
  let currentHot = max(current.r, current.g);
  let historyHot = max(history.r, history.g);
  let smokeHistoryTrust = materialTemporalWeights.x;
  let fireHistoryProtect = materialTemporalWeights.y;
  let interfaceHistoryProtect = materialTemporalWeights.z;
  let detailHistoryProtect = materialTemporalWeights.w;
  let fireProtect = max(smoothstep(0.38, 0.82, currentHot), fireHistoryProtect);
  let hotMismatch = smoothstep(0.08, 0.34, abs(historyHot - currentHot));
  let colorMismatch = smoothstep(0.05, 0.28, length(history - current));
  let currentSupport = max(smoothstep(0.035, 0.18, currentLuma), smokeHistoryTrust * 0.26);
  let fadingTrailReject = 1.0 - smoothstep(0.018, 0.12, historyLuma - currentLuma);
  let smokeHistoryGain = mix(0.34, 1.08, smokeHistoryTrust);
  let materialProtection = (1.0 - fireProtect * 0.90) * (1.0 - interfaceHistoryProtect * 0.68) * (1.0 - detailHistoryProtect * 0.34);
  return temporalAccum * confidence * currentSupport * smokeHistoryGain * fadingTrailReject * (1.0 - reactiveMask) * materialProtection * (1.0 - hotMismatch * 0.82) * (1.0 - colorMismatch * 0.70);
}

fn temporalResolveColor(current: vec3<f32>, sameScreenUv: vec2<f32>, reprojectedUv: vec2<f32>, reprojectionConfidence: f32, reactiveSignal: f32, majorantEdge: f32, historyUvValid: f32, materialTemporalWeights: vec4<f32>) -> vec3<f32> {
  let historyClampStrength = clamp(u.temporal_controls.z, 0.0, 1.0);
  let uv = mix(sameScreenUv, reprojectedUv, smoothstep(0.04, 0.30, reprojectionConfidence) * historyUvValid);
  let history = sampleHistoryColor(uv);
  let clampedHistory = temporalHistoryClamp(history, current, historyClampStrength);
  let reactiveMask = temporalReactiveMask(current, history, reprojectionConfidence, reactiveSignal, majorantEdge, historyUvValid, materialTemporalWeights);
  let historyWeight = temporalHistoryWeight(current, history, reprojectionConfidence, reactiveMask, materialTemporalWeights);
  return mix(current, clampedHistory, historyWeight);
}

fn rotate2(p: vec2<f32>, a: f32) -> vec2<f32> {
  let c = cos(a);
  let s = sin(a);
  return vec2<f32>(c * p.x - s * p.y, s * p.x + c * p.y);
}

fn index3(c: vec3<u32>) -> u32 {
  return c.x + c.y * GRID + c.z * GRID * GRID;
}

fn clampCell(c: vec3<i32>) -> vec3<u32> {
  return vec3<u32>(clamp(c, vec3<i32>(0), vec3<i32>(i32(GRID) - 1)));
}

fn slotIndex(c: vec3<i32>, slot: u32) -> u32 {
  return index3(clampCell(c)) * SLOTS_PER_CELL + slot;
}

fn readSlot(c: vec3<i32>, slot: u32) -> vec4<f32> {
  return fluidSrc[slotIndex(c, slot)];
}

fn sampleFluidSlot(p: vec3<f32>, slot: u32) -> vec4<f32> {
  let pc = clamp(p, vec3<f32>(0.0), vec3<f32>(f32(GRID) - 1.001));
  let i0 = vec3<i32>(floor(pc));
  let f = fract(pc);
  let c000 = readSlot(i0 + vec3<i32>(0, 0, 0), slot);
  let c100 = readSlot(i0 + vec3<i32>(1, 0, 0), slot);
  let c010 = readSlot(i0 + vec3<i32>(0, 1, 0), slot);
  let c110 = readSlot(i0 + vec3<i32>(1, 1, 0), slot);
  let c001 = readSlot(i0 + vec3<i32>(0, 0, 1), slot);
  let c101 = readSlot(i0 + vec3<i32>(1, 0, 1), slot);
  let c011 = readSlot(i0 + vec3<i32>(0, 1, 1), slot);
  let c111 = readSlot(i0 + vec3<i32>(1, 1, 1), slot);
  let x00 = mix(c000, c100, f.x);
  let x10 = mix(c010, c110, f.x);
  let x01 = mix(c001, c101, f.x);
  let x11 = mix(c011, c111, f.x);
  let y0 = mix(x00, x10, f.y);
  let y1 = mix(x01, x11, f.y);
  return mix(y0, y1, f.z);
}

fn sampleWorldVelocity(p: vec3<f32>) -> vec4<f32> {
  let cell = (p * 0.5 + vec3<f32>(0.5)) * (f32(GRID) - 1.0);
  return sampleFluidSlot(cell, 0u);
}

fn sampleWorldMaterial(p: vec3<f32>) -> vec4<f32> {
  let cell = (p * 0.5 + vec3<f32>(0.5)) * (f32(GRID) - 1.0);
  return sampleFluidSlot(cell, 1u);
}

fn sampleWorldFireLayer(p: vec3<f32>) -> vec4<f32> {
  let cell = (p * 0.5 + vec3<f32>(0.5)) * (f32(GRID) - 1.0);
  return sampleFluidSlot(cell, 2u);
}

fn sampleWorldMicrodetail(p: vec3<f32>) -> vec4<f32> {
  let cell = (p * 0.5 + vec3<f32>(0.5)) * (f32(GRID) - 1.0);
  return sampleFluidSlot(cell, 3u);
}

fn majorantIndex(c: vec3<u32>) -> u32 {
  return c.x + c.y * MAJORANT_GRID + c.z * MAJORANT_GRID * MAJORANT_GRID;
}

fn materialMajorantFromSlots(velocityDensity: vec4<f32>, material: vec4<f32>, fireLayer: vec4<f32>, microLayer: vec4<f32>) -> vec4<f32> {
  let velMag = length(velocityDensity.xyz);
  let smoke = material.x + microLayer.x * 0.52 + microLayer.y * 0.34;
  let fire = fireLayer.x * 1.25 + fireLayer.y * 0.42 + fireLayer.z * 0.55 + microLayer.z * 0.70 + material.y * 0.28;
  let density = max(velocityDensity.w, smoke * 0.82 + material.y * 0.22 + material.w * 0.18);
  let extinction = smoke * 0.62 + microLayer.y * 0.36 + material.w * 0.16;
  let importance = clamp(density * 0.50 + extinction * 0.40 + fire * 0.44 + velMag * 0.36, 0.0, 3.0);
  return vec4<f32>(density, fire, extinction, importance);
}

fn sampleWorldMajorant(p: vec3<f32>) -> vec4<f32> {
  let q = clamp((p * 0.5 + vec3<f32>(0.5)) * f32(MAJORANT_GRID), vec3<f32>(0.0), vec3<f32>(f32(MAJORANT_GRID) - 0.001));
  return majorantField[majorantIndex(vec3<u32>(floor(q)))];
}

fn sampleMajorantCell(c: vec3<i32>) -> vec4<f32> {
  let cell = vec3<u32>(clamp(c, vec3<i32>(0), vec3<i32>(i32(MAJORANT_GRID) - 1)));
  return majorantField[majorantIndex(cell)];
}

fn sampleWorldMajorantLinear(p: vec3<f32>) -> vec4<f32> {
  let q = clamp((p * 0.5 + vec3<f32>(0.5)) * (f32(MAJORANT_GRID) - 1.0), vec3<f32>(0.0), vec3<f32>(f32(MAJORANT_GRID) - 1.001));
  let i0 = vec3<i32>(floor(q));
  let f = fract(q);
  let c000 = sampleMajorantCell(i0 + vec3<i32>(0, 0, 0));
  let c100 = sampleMajorantCell(i0 + vec3<i32>(1, 0, 0));
  let c010 = sampleMajorantCell(i0 + vec3<i32>(0, 1, 0));
  let c110 = sampleMajorantCell(i0 + vec3<i32>(1, 1, 0));
  let c001 = sampleMajorantCell(i0 + vec3<i32>(0, 0, 1));
  let c101 = sampleMajorantCell(i0 + vec3<i32>(1, 0, 1));
  let c011 = sampleMajorantCell(i0 + vec3<i32>(0, 1, 1));
  let c111 = sampleMajorantCell(i0 + vec3<i32>(1, 1, 1));
  let x00 = mix(c000, c100, f.x);
  let x10 = mix(c010, c110, f.x);
  let x01 = mix(c001, c101, f.x);
  let x11 = mix(c011, c111, f.x);
  let y0 = mix(x00, x10, f.y);
  let y1 = mix(x01, x11, f.y);
  return mix(y0, y1, f.z);
}

fn sampleWorldMajorantDilated(p: vec3<f32>) -> vec4<f32> {
  let q = clamp((p * 0.5 + vec3<f32>(0.5)) * f32(MAJORANT_GRID), vec3<f32>(0.0), vec3<f32>(f32(MAJORANT_GRID) - 0.001));
  let c = vec3<i32>(floor(q));
  var m = sampleMajorantCell(c);
  m = max(m, sampleMajorantCell(c + vec3<i32>(1, 0, 0)));
  m = max(m, sampleMajorantCell(c + vec3<i32>(-1, 0, 0)));
  m = max(m, sampleMajorantCell(c + vec3<i32>(0, 1, 0)));
  m = max(m, sampleMajorantCell(c + vec3<i32>(0, -1, 0)));
  m = max(m, sampleMajorantCell(c + vec3<i32>(0, 0, 1)));
  m = max(m, sampleMajorantCell(c + vec3<i32>(0, 0, -1)));
  return m;
}

fn majorantGradientSignal(p: vec3<f32>) -> f32 {
  let q = clamp((p * 0.5 + vec3<f32>(0.5)) * f32(MAJORANT_GRID), vec3<f32>(0.0), vec3<f32>(f32(MAJORANT_GRID) - 0.001));
  let c = vec3<i32>(floor(q));
  let x0 = sampleMajorantCell(c + vec3<i32>(-1, 0, 0)).w;
  let x1 = sampleMajorantCell(c + vec3<i32>(1, 0, 0)).w;
  let y0 = sampleMajorantCell(c + vec3<i32>(0, -1, 0)).w;
  let y1 = sampleMajorantCell(c + vec3<i32>(0, 1, 0)).w;
  let z0 = sampleMajorantCell(c + vec3<i32>(0, 0, -1)).w;
  let z1 = sampleMajorantCell(c + vec3<i32>(0, 0, 1)).w;
  return clamp(abs(x1 - x0) + abs(y1 - y0) + abs(z1 - z0), 0.0, 1.5);
}

fn majorantCellExitDistance(p: vec3<f32>, rd: vec3<f32>) -> f32 {
  let q = clamp((p * 0.5 + vec3<f32>(0.5)) * f32(MAJORANT_GRID), vec3<f32>(0.0), vec3<f32>(f32(MAJORANT_GRID) - 0.001));
  let dqdt = rd * (0.5 * f32(MAJORANT_GRID));
  var best = 1.0e6;
  if (abs(dqdt.x) > 0.0001) {
    let bx = select(floor(q.x), floor(q.x) + 1.0, dqdt.x > 0.0);
    let tx = (bx - q.x) / dqdt.x;
    if (tx > 0.0001) { best = min(best, tx); }
  }
  if (abs(dqdt.y) > 0.0001) {
    let by = select(floor(q.y), floor(q.y) + 1.0, dqdt.y > 0.0);
    let ty = (by - q.y) / dqdt.y;
    if (ty > 0.0001) { best = min(best, ty); }
  }
  if (abs(dqdt.z) > 0.0001) {
    let bz = select(floor(q.z), floor(q.z) + 1.0, dqdt.z > 0.0);
    let tz = (bz - q.z) / dqdt.z;
    if (tz > 0.0001) { best = min(best, tz); }
  }
  return min(best, 0.20);
}

fn curlAtCell(c: vec3<i32>) -> vec3<f32> {
  let vx0 = readSlot(c + vec3<i32>(-1, 0, 0), 0u).xyz;
  let vx1 = readSlot(c + vec3<i32>( 1, 0, 0), 0u).xyz;
  let vy0 = readSlot(c + vec3<i32>(0, -1, 0), 0u).xyz;
  let vy1 = readSlot(c + vec3<i32>(0,  1, 0), 0u).xyz;
  let vz0 = readSlot(c + vec3<i32>(0, 0, -1), 0u).xyz;
  let vz1 = readSlot(c + vec3<i32>(0, 0,  1), 0u).xyz;
  return vec3<f32>(
    (vy1.z - vy0.z) - (vz1.y - vz0.y),
    (vz1.x - vz0.x) - (vx1.z - vx0.z),
    (vx1.y - vx0.y) - (vy1.x - vy0.x)
  ) * 0.5;
}

fn curlMagnitudeAtCell(c: vec3<i32>) -> f32 {
  return length(curlAtCell(c));
}

fn divergenceAtCell(c: vec3<i32>) -> f32 {
  let vx0 = readSlot(c + vec3<i32>(-1, 0, 0), 0u).x;
  let vx1 = readSlot(c + vec3<i32>( 1, 0, 0), 0u).x;
  let vy0 = readSlot(c + vec3<i32>(0, -1, 0), 0u).y;
  let vy1 = readSlot(c + vec3<i32>(0,  1, 0), 0u).y;
  let vz0 = readSlot(c + vec3<i32>(0, 0, -1), 0u).z;
  let vz1 = readSlot(c + vec3<i32>(0, 0,  1), 0u).z;
  return ((vx1 - vx0) + (vy1 - vy0) + (vz1 - vz0)) * 0.5;
}

fn pressureProjectionCorrection(c: vec3<i32>, strength: f32) -> vec3<f32> {
  let divX = divergenceAtCell(c + vec3<i32>(1, 0, 0)) - divergenceAtCell(c + vec3<i32>(-1, 0, 0));
  let divY = divergenceAtCell(c + vec3<i32>(0, 1, 0)) - divergenceAtCell(c + vec3<i32>(0, -1, 0));
  let divZ = divergenceAtCell(c + vec3<i32>(0, 0, 1)) - divergenceAtCell(c + vec3<i32>(0, 0, -1));
  let gradient = vec3<f32>(divX, divY, divZ) * 0.5;
  let center = divergenceAtCell(c);
  let localDamping = readSlot(c, 0u).xyz * center * 0.055;
  return (gradient * 0.46 + localDamping) * clamp(strength, 0.0, 1.5);
}

fn vorticityConfinement(c: vec3<i32>, amount: f32) -> vec3<f32> {
  // Vorticity confinement preserves small curl features that semi-Lagrangian advection damps away.
  let magX = curlMagnitudeAtCell(c + vec3<i32>(1, 0, 0)) - curlMagnitudeAtCell(c + vec3<i32>(-1, 0, 0));
  let magY = curlMagnitudeAtCell(c + vec3<i32>(0, 1, 0)) - curlMagnitudeAtCell(c + vec3<i32>(0, -1, 0));
  let magZ = curlMagnitudeAtCell(c + vec3<i32>(0, 0, 1)) - curlMagnitudeAtCell(c + vec3<i32>(0, 0, -1));
  let normal = normalize(vec3<f32>(magX, magY, magZ) + vec3<f32>(0.0001));
  return cross(normal, curlAtCell(c)) * amount;
}

fn fineScaleBreakup(c: vec3<i32>, p: vec3<f32>, time: f32, curl: f32, heat: f32, smoke: f32, source: f32) -> vec3<f32> {
  let localCurl = curlAtCell(c);
  let curlEnergy = length(localCurl);
  let detailA = turbulentDetailForce(p * 1.63 + vec3<f32>(0.17, -0.11, 0.23), time * 1.37);
  let detailB = turbulentDetailForce(p * 2.41 + vec3<f32>(-0.31, 0.19, -0.07), time * 1.91);
  let shearAxis = normalize(localCurl + detailA * 0.19 + vec3<f32>(0.001));
  let shear = normalize(cross(shearAxis, detailB) + detailA * 0.36 + vec3<f32>(0.001));
  let activeFlow = source * 1.55 + heat * 0.52 + smoke * 0.18 + smoothstep(0.006, 0.095, curlEnergy) * 0.32;
  return shear * activeFlow * (0.006 + curl * 0.010);
}

fn turbulentDetailForce(p: vec3<f32>, time: f32) -> vec3<f32> {
  let q = p * vec3<f32>(9.0, 13.0, 11.0) + vec3<f32>(time * 1.7, -time * 2.1, time * 1.3);
  let a = vec3<f32>(
    sin(q.y + cos(q.z)),
    sin(q.z + cos(q.x)),
    sin(q.x + cos(q.y))
  );
  let b = vec3<f32>(
    cos(q.z * 1.37 - q.y),
    cos(q.x * 1.21 - q.z),
    cos(q.y * 1.43 - q.x)
  );
  return normalize(a + b * 0.72 + vec3<f32>(0.001));
}

fn materialInterfaceGradient(c: vec3<i32>) -> vec3<f32> {
  let sx0 = readSlot(c + vec3<i32>(-1, 0, 0), 1u).x;
  let sx1 = readSlot(c + vec3<i32>( 1, 0, 0), 1u).x;
  let hx0 = readSlot(c + vec3<i32>(-1, 0, 0), 1u).y;
  let hx1 = readSlot(c + vec3<i32>( 1, 0, 0), 1u).y;
  let fx0 = readSlot(c + vec3<i32>(-1, 0, 0), 2u).x;
  let fx1 = readSlot(c + vec3<i32>( 1, 0, 0), 2u).x;
  let sy0 = readSlot(c + vec3<i32>(0, -1, 0), 1u).x;
  let sy1 = readSlot(c + vec3<i32>(0,  1, 0), 1u).x;
  let hy0 = readSlot(c + vec3<i32>(0, -1, 0), 1u).y;
  let hy1 = readSlot(c + vec3<i32>(0,  1, 0), 1u).y;
  let fy0 = readSlot(c + vec3<i32>(0, -1, 0), 2u).x;
  let fy1 = readSlot(c + vec3<i32>(0,  1, 0), 2u).x;
  let sz0 = readSlot(c + vec3<i32>(0, 0, -1), 1u).x;
  let sz1 = readSlot(c + vec3<i32>(0, 0,  1), 1u).x;
  let hz0 = readSlot(c + vec3<i32>(0, 0, -1), 1u).y;
  let hz1 = readSlot(c + vec3<i32>(0, 0,  1), 1u).y;
  let fz0 = readSlot(c + vec3<i32>(0, 0, -1), 2u).x;
  let fz1 = readSlot(c + vec3<i32>(0, 0,  1), 2u).x;
  return vec3<f32>(
    (sx1 - sx0) * 0.72 - (hx1 - hx0) * 0.44 + (fx1 - fx0) * 0.38,
    (sy1 - sy0) * 0.72 - (hy1 - hy0) * 0.44 + (fy1 - fy0) * 0.38,
    (sz1 - sz0) * 0.72 - (hz1 - hz0) * 0.44 + (fz1 - fz0) * 0.38
  ) * 0.5;
}

fn transportedMicrodetailAdvection(cell: vec3<f32>, velocity: vec3<f32>, speed: f32, heat: f32, smoke: f32, flame: f32) -> vec4<f32> {
  let lift = vec3<f32>(0.0, (heat * 0.22 + flame * 0.34) * (0.28 + speed * 0.055), 0.0);
  let slip = turbulentDetailForce(cell * 0.031 + vec3<f32>(0.11, -0.07, 0.17), u.cameraPos_time.w * 1.27) * (0.18 + heat * 0.12 + smoke * 0.06);
  let backCell = cell - (velocity + lift + slip) * (1.44 + speed * 0.28);
  return sampleFluidSlot(backCell, 3u);
}

fn interfaceShreddingForce(c: vec3<i32>, p: vec3<f32>, time: f32, amount: f32, heat: f32, smoke: f32, flame: f32, carriedShred: f32) -> vec3<f32> {
  let interfaceGrad = materialInterfaceGradient(c);
  let interfaceEnergy = length(interfaceGrad);
  let localCurl = curlAtCell(c);
  let crossCurl = cross(normalize(interfaceGrad + vec3<f32>(0.001)), normalize(localCurl + turbulentDetailForce(p * 2.2, time) * 0.24 + vec3<f32>(0.001)));
  let interfaceActive = smoothstep(0.018, 0.23, interfaceEnergy) * (0.28 + smoke * 0.34 + heat * 0.28 + flame * 0.20 + carriedShred * 0.30);
  return normalize(crossCurl + turbulentDetailForce(p * 1.7 + vec3<f32>(0.23, -0.19, 0.13), time * 1.5) * 0.36 + vec3<f32>(0.001)) * interfaceActive * amount * 0.036;
}

fn smokeShredEnergy(c: vec3<i32>) -> f32 {
  let m = readSlot(c, 3u);
  return m.x * 0.52 + m.y * 0.90 + m.z * 0.30;
}

fn fireLickBreakup(c: vec3<i32>, p: vec3<f32>, time: f32, amount: f32, heat: f32, fuel: f32, flame: f32, flameDetail: f32, source: f32) -> vec4<f32> {
  let interfaceEnergy = length(materialInterfaceGradient(c));
  let lickWarp = turbulentDetailForce(p * 2.64 + vec3<f32>(0.19, -0.23, 0.11), time * 0.91) * (0.046 + source * 0.040 + heat * 0.018 + flameDetail * 0.016);
  let q = p + lickWarp;
  let combA = sin(q.y * 23.0 + sin(q.x * 19.0 + q.z * 11.0 + time * 3.2) + source * 2.6);
  let combB = cos(q.z * 27.0 - q.x * 13.0 + q.y * 7.0 - time * 4.1 + flameDetail * 1.7);
  let combC = hash31(floor((q + vec3<f32>(1.0)) * 24.0) + vec3<f32>(floor(time * 3.0)));
  let verticalComb = clamp(0.54 + 0.22 * combA + 0.18 * combB + 0.10 * (combC - 0.5), 0.12, 1.10);
  let hotEdge = smoothstep(0.10, 1.20, heat + flame * 0.62) * smoothstep(0.014, 0.18, interfaceEnergy + source * 0.08);
  let lick = hotEdge * verticalComb * amount * (0.16 + fuel * 0.22 + flameDetail * 0.18 + source * 0.24);
  let ash = smoothstep(0.18, 1.4, smokeShredEnergy(c)) * (0.06 + lick * 0.34);
  return vec4<f32>(lick, lick * (0.42 + fuel * 0.24), lick * (0.58 + heat * 0.22), ash);
}

fn externalEmitterInfluence(p: vec3<f32>, time: f32) -> ExternalEmitterInfluence {
  var result: ExternalEmitterInfluence;
  result.material = vec4<f32>(0.0);
  result.fire = vec4<f32>(0.0);
  result.micro = vec4<f32>(0.0);
  result.velocity = vec4<f32>(0.0);
  let count = min(u32(max(0.0, floor(u.scale_controls.w + 0.5))), MAX_EXTERNAL_EMITTERS_WGSL);
  for (var i: u32 = 0u; i < count; i = i + 1u) {
    let emitter = externalEmitters[i];
    let start = emitter.start_radius.xyz;
    let end = emitter.end_strength.xyz;
    let segment = end - start;
    let denom = max(dot(segment, segment), 0.00001);
    let t = clamp(dot(p - start, segment) / denom, 0.0, 1.0);
    let closest = start + segment * t;
    let radius = max(0.006, emitter.start_radius.w);
    let dist2 = dot(p - closest, p - closest);
    let strength = max(0.0, emitter.end_strength.w);
    let age = max(0.0, emitter.velocity_age.w);
    let lifetime = max(0.016, emitter.detail_lifetime.y);
    let isActiveEmitter = step(0.5, emitter.detail_lifetime.w);
    let ageFade = 1.0 - smoothstep(lifetime * 0.68, lifetime, age);
    let falloff = exp(-dist2 / max(0.00001, radius * radius)) * strength * ageFade * isActiveEmitter;
    let flicker = 0.82 + 0.18 * hash31(vec3<f32>(f32(i) * 13.7, time * 4.1, t * 9.3));
    let w = falloff * flicker;
    result.material.x = max(result.material.x, emitter.material.x * w);
    result.material.y = max(result.material.y, emitter.material.y * w);
    result.material.z = max(result.material.z, emitter.material.z * w);
    result.material.w = max(result.material.w, emitter.detail_lifetime.x * w);
    result.fire.x = max(result.fire.x, emitter.material.w * w);
    result.fire.y = max(result.fire.y, emitter.material.w * w * 0.42);
    result.fire.z = max(result.fire.z, emitter.detail_lifetime.x * w * 0.82);
    result.micro.x = max(result.micro.x, emitter.detail_lifetime.x * w * 0.72);
    result.micro.y = max(result.micro.y, emitter.detail_lifetime.x * w * 0.42 + emitter.material.w * w * 0.12);
    result.micro.z = max(result.micro.z, emitter.material.w * w * 0.60);
    result.micro.w = max(result.micro.w, emitter.material.w * w * 0.22);
    result.velocity = result.velocity + vec4<f32>(emitter.velocity_age.xyz * w, w);
  }
  return result;
}

fn applyExternalEmitterInjection(influence: ExternalEmitterInfluence) -> ExternalEmitterInfluence {
  return influence;
}

fn thermalAdvection(cell: vec3<f32>, velocity: vec3<f32>, speed: f32, localHeat: f32) -> vec4<f32> {
  let thermalLift = vec3<f32>(0.0, clamp(localHeat, 0.0, 1.7) * (0.24 + speed * 0.055), 0.0);
  let thermalSlip = vec3<f32>(
    sin(cell.z * 0.41 + localHeat * 2.7),
    0.0,
    cos(cell.x * 0.37 - localHeat * 2.1)
  ) * localHeat * 0.032;
  let backCell = cell - (velocity + thermalLift + thermalSlip) * (2.30 + speed * 0.46);
  return sampleFluidSlot(backCell, 1u);
}

fn thermalBuoyancyForce(heat: f32, smoke: f32, fuel: f32, speed: f32) -> vec3<f32> {
  let hotLift = smoothstep(0.04, 1.25, heat) * (0.034 + speed * 0.018);
  let smokeDrag = smoke * 0.014;
  let fuelKick = fuel * heat * 0.014;
  return vec3<f32>(0.0, hotLift + fuelKick - smokeDrag, 0.0);
}

fn heatGradientAtCell(c: vec3<i32>) -> vec3<f32> {
  let hx0 = readSlot(c + vec3<i32>(-1, 0, 0), 1u).y;
  let hx1 = readSlot(c + vec3<i32>( 1, 0, 0), 1u).y;
  let hy0 = readSlot(c + vec3<i32>(0, -1, 0), 1u).y;
  let hy1 = readSlot(c + vec3<i32>(0,  1, 0), 1u).y;
  let hz0 = readSlot(c + vec3<i32>(0, 0, -1), 1u).y;
  let hz1 = readSlot(c + vec3<i32>(0, 0,  1), 1u).y;
  return vec3<f32>(hx1 - hx0, hy1 - hy0, hz1 - hz0) * 0.5;
}

fn thermalExpansionForce(c: vec3<i32>, heat: f32, amount: f32) -> vec3<f32> {
  let grad = heatGradientAtCell(c);
  return -grad * smoothstep(0.08, 1.35, heat) * amount;
}

fn heatToSmokeConversion(heat: f32, fuel: f32, y: f32) -> f32 {
  let coolingBand = smoothstep(0.16, 1.05, heat) * (1.0 - smoothstep(1.18, 1.85, heat));
  let upperAir = smoothstep(-0.55, 0.72, y);
  let fuelSmoke = fuel * smoothstep(0.06, 0.86, heat) * 0.072;
  return coolingBand * upperAir * 0.064 + fuelSmoke;
}

fn fireLayerAdvection(cell: vec3<f32>, velocity: vec3<f32>, speed: f32, heat: f32) -> vec4<f32> {
  let fastLift = vec3<f32>(0.0, clamp(heat, 0.0, 1.9) * (0.40 + speed * 0.13), 0.0);
  let lick = vec3<f32>(
    sin(cell.y * 0.44 + cell.z * 0.19 + heat * 3.8),
    0.0,
    cos(cell.y * 0.38 - cell.x * 0.21 - heat * 3.1)
  ) * heat * 0.070;
  let backCell = cell - (velocity + fastLift + lick) * (1.82 + speed * 0.34);
  return sampleFluidSlot(backCell, 2u);
}

fn gridLine(p: vec3<f32>) -> f32 {
  let a = abs(p);
  var faceUv = vec2<f32>(0.0);
  if (a.x > a.y && a.x > a.z) {
    faceUv = p.yz * 0.5 + vec2<f32>(0.5);
  } else if (a.y > a.z) {
    faceUv = p.xz * 0.5 + vec2<f32>(0.5);
  } else {
    faceUv = p.xy * 0.5 + vec2<f32>(0.5);
  }
  let majorCells = max(4.0, f32(GRID) / 16.0);
  let f = fract(faceUv * majorCells);
  let nearest = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
  let line = 1.0 - smoothstep(0.014, 0.042, nearest);
  let face = smoothstep(0.940, 0.995, max(max(a.x, a.y), a.z));
  return line * face;
}

fn slabAxis(origin: f32, dir: f32, halfSize: f32) -> vec2<f32> {
  if (abs(dir) < 0.00001) {
    if (abs(origin) > halfSize) {
      return vec2<f32>(1.0, -1.0);
    }
    return vec2<f32>(-1.0e6, 1.0e6);
  }
  let a = (-halfSize - origin) / dir;
  let b = ( halfSize - origin) / dir;
  return vec2<f32>(min(a, b), max(a, b));
}

fn boxHit(ro: vec3<f32>, rd: vec3<f32>, b: vec3<f32>) -> vec2<f32> {
  let sx = slabAxis(ro.x, rd.x, b.x);
  let sy = slabAxis(ro.y, rd.y, b.y);
  let sz = slabAxis(ro.z, rd.z, b.z);
  return vec2<f32>(max(max(sx.x, sy.x), sz.x), min(min(sx.y, sy.y), sz.y));
}

fn fireColor(temp: f32) -> vec3<f32> {
  let ember = vec3<f32>(0.70, 0.10, 0.018);
  let orange = vec3<f32>(1.0, 0.38, 0.055);
  let gold = vec3<f32>(1.0, 0.74, 0.20);
  let pale = vec3<f32>(1.0, 0.82, 0.34);
  let a = mix(ember, orange, smoothstep(0.08, 0.44, temp));
  let b = mix(gold, pale, smoothstep(0.86, 1.55, temp));
  return mix(a, b, smoothstep(0.34, 1.08, temp));
}

fn emissiveTemperature(fireLayer: vec4<f32>, material: vec4<f32>, microLayer: vec4<f32>, velMag: f32) -> f32 {
  return clamp(
    fireLayer.x * 1.22
      + fireLayer.y * 0.46
      + fireLayer.z * 0.40
      + microLayer.z * 1.18
      + microLayer.w * 0.48
      + material.y * 0.20
      + velMag * 0.30,
    0.0,
    2.4
  );
}

fn fireRadianceEmission(temp: f32, flameDetail: f32, fireLick: f32, emberFleck: f32, radianceGain: f32, glowGain: f32) -> vec3<f32> {
  let core = smoothstep(0.16, 1.18, temp);
  let whiteCore = smoothstep(1.06, 2.10, temp);
  let lickSpark = smoothstep(0.025, 0.34, fireLick + emberFleck * 0.45);
  let filament = smoothstep(0.025, 0.62, flameDetail + fireLick * 0.56);
  let body = fireColor(temp) * (0.28 + core * 1.24 + filament * 0.34);
  let hot = mix(body, vec3<f32>(1.0, 0.92, 0.55), whiteCore * (0.34 + glowGain * 0.12));
  return hot * radianceGain * (0.55 + lickSpark * 0.20 + glowGain * 0.18);
}

fn smokeRadianceExtinction(smokeDensity: f32, microSmoke: f32, interfaceShred: f32, materialDetail: f32, absorptionGain: f32) -> f32 {
  let body = smokeDensity * 0.74 + microSmoke * 0.42 + interfaceShred * 0.34 + materialDetail * 0.12;
  return clamp(body * (0.34 + absorptionGain * 0.46), 0.0, 2.3);
}

fn raymarchInterest(
  density: f32,
  smoke: f32,
  heat: f32,
  temp: f32,
  flame: f32,
  flameDetail: f32,
  microTextureSignal: f32,
  velMag: f32,
  fireLick: f32,
  interfaceShred: f32
) -> f32 {
  let body = density * 0.22 + smoke * 0.16 + heat * 0.10;
  let fire = temp * 0.40 + flame * 0.36 + flameDetail * 0.22 + fireLick * 0.30;
  let edge = microTextureSignal * 0.22 + interfaceShred * 0.42 + velMag * 0.46;
  return clamp(body + fire + edge, 0.0, 1.6);
}

fn adaptiveRayStepScale(interest: f32, adaptiveRays: f32) -> f32 {
  let fine = smoothstep(0.035, 0.92, interest);
  let adaptiveScale = mix(2.65, 0.68, fine);
  return mix(1.0, adaptiveScale, clamp(adaptiveRays, 0.0, 1.0));
}

fn raymarchOccupancySignal(
  density: f32,
  smoke: f32,
  heat: f32,
  temp: f32,
  flame: f32,
  microTextureSignal: f32,
  velMag: f32,
  extinction: f32
) -> f32 {
  let body = density * 0.44 + smoke * 0.38 + extinction * 0.28;
  let fire = temp * 0.24 + flame * 0.28 + heat * 0.16;
  let detail = microTextureSignal * 0.20 + velMag * 0.32;
  return clamp(body + fire + detail, 0.0, 1.8);
}

fn occupancySkipStepScale(occupancy: f32, occupancySkipStrength: f32, adaptiveRays: f32) -> f32 {
  let emptySpan = 1.0 - smoothstep(0.012, 0.135, occupancy);
  let adaptiveAssist = mix(1.45, 3.20, clamp(adaptiveRays, 0.0, 1.0));
  return clamp(1.0 + emptySpan * clamp(occupancySkipStrength, 0.0, 1.0) * adaptiveAssist, 1.0, 4.60);
}

fn raymarchEarlyTermination(transmittance: f32) -> bool {
  return transmittance < 0.012;
}

fn microDetailDomainWarp(p: vec3<f32>, microLayer: vec4<f32>, fireLayer: vec4<f32>, material: vec4<f32>, velocity: vec3<f32>, time: f32) -> vec3<f32> {
  let carrier = clamp(
    microLayer.x * 0.62
      + microLayer.y * 1.08
      + microLayer.z * 0.78
      + microLayer.w * 0.30
      + fireLayer.z * 0.28
      + material.w * 0.18,
    0.0,
    2.6
  );
  let flow = normalize(velocity + turbulentDetailForce(p * 1.31 + vec3<f32>(0.17, -0.11, 0.23), time * 0.47) * 0.16 + vec3<f32>(0.012, 0.019, -0.014));
  let foldA = turbulentDetailForce(p * 2.17 + flow * (0.42 + carrier * 0.34), time * 0.83);
  let foldB = turbulentDetailForce(p.yzx * 2.91 + vec3<f32>(carrier * 0.19, -carrier * 0.13, carrier * 0.17), time * 1.19);
  return (foldA * 0.70 + foldB * 0.36 + flow * 0.24) * carrier * 0.038;
}

fn microFilamentNoise(p: vec3<f32>, warp: vec3<f32>, carrier: f32, velocity: vec3<f32>, time: f32) -> f32 {
  let q = p + warp + velocity * 0.31;
  let phaseA = dot(q, vec3<f32>(29.0, 17.0, -23.0)) + sin(dot(q.yzx, vec3<f32>(11.0, -19.0, 31.0)) + carrier * 2.7 + time * 2.3);
  let phaseB = dot(q.zxy, vec3<f32>(-13.0, 37.0, 19.0)) + cos(dot(q, vec3<f32>(23.0, -7.0, 13.0)) - carrier * 1.9 - time * 3.1);
  let cellNoise = hash31(floor((q + vec3<f32>(1.0)) * 28.0) + vec3<f32>(floor(time * 2.0)));
  return clamp(0.50 + 0.25 * sin(phaseA) + 0.18 * sin(phaseB) + 0.14 * (cellNoise - 0.5), 0.12, 1.12);
}

@compute @workgroup_size(4, 4, 4)
fn csMajorant(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (any(gid >= vec3<u32>(MAJORANT_GRID))) {
    return;
  }
  let brickStart = vec3<u32>(floor(vec3<f32>(gid) * f32(GRID) / f32(MAJORANT_GRID)));
  let brickEnd = max(brickStart + vec3<u32>(1), vec3<u32>(ceil(vec3<f32>(gid + vec3<u32>(1)) * f32(GRID) / f32(MAJORANT_GRID))));
  var majorant = vec4<f32>(0.0);
  for (var z = brickStart.z; z < min(brickEnd.z, GRID); z = z + 1u) {
    for (var y = brickStart.y; y < min(brickEnd.y, GRID); y = y + 1u) {
      for (var x = brickStart.x; x < min(brickEnd.x, GRID); x = x + 1u) {
        let c = vec3<i32>(vec3<u32>(x, y, z));
        let candidate = materialMajorantFromSlots(readSlot(c, 0u), readSlot(c, 1u), readSlot(c, 2u), readSlot(c, 3u));
        majorant = max(majorant, candidate);
      }
    }
  }
  majorantDst[majorantIndex(gid)] = majorant;
}

@compute @workgroup_size(4, 4, 4)
fn cs(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (any(gid >= vec3<u32>(GRID))) {
    return;
  }
  let idx = index3(gid);
  let base = idx * SLOTS_PER_CELL;
  let cell = vec3<f32>(gid) + vec3<f32>(0.5);
  let cellI = vec3<i32>(gid);
  let p = (cell / f32(GRID)) * 2.0 - vec3<f32>(1.0);
  let prev = fluidSrc[base];
  let speed = u.fire_smoke_curl_speed.w;
  let curl = u.fire_smoke_curl_speed.z;
  let inputRadius = max(0.04, u.source_controls.x);
  let inputFlow = max(0.0, u.source_controls.y);
  let projection = clamp(u.source_controls.z, 0.0, 1.5);
  let fireScale = clamp(u.scale_controls.x, 0.35, 1.30);
  let detailScale = clamp(u.scale_controls.y, 0.45, 3.20);
  let plumeHeight = clamp(u.scale_controls.z, 0.70, 2.20);
  let plumeHeight01 = smoothstep(0.70, 2.20, plumeHeight);
  let scaledSourceRadius = max(0.035, inputRadius * fireScale);
  let scaledSmokeSourceRadius = max(0.055, inputRadius * mix(0.92, 1.08, plumeHeight01));
  let scaledDetailFrequency = clamp(detailScale / max(fireScale, 0.45), 0.55, 5.40);
  let plumeRiseScale = mix(0.82, 1.58, plumeHeight01);
  let sourceScaleCompensation = mix(1.22, 0.94, smoothstep(0.35, 1.30, fireScale));
  let microAmount = clamp(u.grid_overlay_debug.y, 0.0, 2.5);
  let shredAmount = clamp(u.grid_overlay_debug.z, 0.0, 5.0);
  let fireLickAmount = clamp(u.grid_overlay_debug.w, 0.0, 5.0);
  let shredOperatorGain = shredAmount * (0.80 + shredAmount * 0.080);
  let fireLickOperatorGain = fireLickAmount * (0.82 + fireLickAmount * 0.110);
  let detailDomain = vec3<f32>(scaledDetailFrequency, mix(1.0, 1.18, plumeHeight01), scaledDetailFrequency);
  let time = u.cameraPos_time.w;
  let backCell = cell - prev.xyz * (2.55 + speed * 0.55);
  let advected = sampleFluidSlot(backCell, 0u);
  let localMaterial = readSlot(cellI, 1u);
  var material = thermalAdvection(cell, prev.xyz, speed, localMaterial.y);
  var fireLayer = fireLayerAdvection(cell, prev.xyz, speed, localMaterial.y);
  var microLayer = transportedMicrodetailAdvection(cell, prev.xyz, speed, localMaterial.y, localMaterial.x, fireLayer.x);
  var vel = advected.xyz * 0.982;
  var smoke = material.x * 0.990;
  var heat = material.y * 0.982;
  var fuel = material.z * 0.990;
  var materialDetail = material.w * 0.970;
  var flame = fireLayer.x * 0.938;
  var ember = fireLayer.y * 0.952;
  var flameDetail = fireLayer.z * 0.922;
  var microSmoke = microLayer.x * 0.972;
  var interfaceShred = microLayer.y * 0.948;
  var fireLick = microLayer.z * 0.902;
  var emberFleck = microLayer.w * 0.934;

  let radial = length(p.xz);
  let sourceCenter = p.xz;
  let sourceRadial = length(sourceCenter);
  let sceneMode = clamp(u.scene_controls.x, 0.0, 2.0);
  let windStrength = clamp(u.scene_controls.y, 0.0, 1.5);
  let windAngle = u.scene_controls.z;
  let windHeight = clamp(u.scene_controls.w, -0.8, 0.8);
  let windDirection = vec3<f32>(cos(windAngle), 0.0, sin(windAngle));
  let windHeightRamp = smoothstep(windHeight - 0.32, windHeight + 0.52, p.y);
  let bonfireScene = step(1.5, sceneMode);
  let sourceBand = smoothstep(-0.99, -0.80, p.y) * (1.0 - smoothstep(0.18, 0.58, p.y));
  let breakup = clamp(
    0.64
      + 0.24 * sin(p.x * 19.0 * scaledDetailFrequency + p.z * 7.0 * scaledDetailFrequency + time * 1.7)
      + 0.20 * cos(p.z * 23.0 * scaledDetailFrequency - p.x * 5.0 * scaledDetailFrequency - time * 1.3)
      + 0.16 * hash31(vec3<f32>(gid) * 0.061 * scaledDetailFrequency + vec3<f32>(floor(time * 2.0))),
    0.16,
    1.22
  );
  let bonfireSourceBreakup = clamp(
    0.72
      + 0.18 * sin(sourceRadial * 34.0 * scaledDetailFrequency + time * 1.45)
      + 0.14 * cos(sourceRadial * 21.0 * scaledDetailFrequency - time * 1.18)
      + 0.08 * hash31(vec3<f32>(sourceRadial * 17.0 * scaledDetailFrequency, p.y * 11.0, floor(time * 2.0))),
    0.32,
    1.14
  );
  let smokeSourceFalloff = 1.0 / max(0.0048, scaledSmokeSourceRadius * scaledSmokeSourceRadius);
  let fireSourceFalloff = 1.0 / max(0.0036, scaledSourceRadius * scaledSourceRadius);
  let columnSource = exp(-sourceRadial * sourceRadial * smokeSourceFalloff) * sourceBand * breakup * inputFlow;
  let bonfireVertical = (p.y - 0.62) / 0.23;
  let bonfireCoreRadius = max(0.090, scaledSourceRadius * 1.72);
  let bonfireSmokeRadius = max(0.125, scaledSmokeSourceRadius * 1.38);
  let bonfireFireball = exp(-(sourceRadial * sourceRadial) / max(0.0048, bonfireCoreRadius * bonfireCoreRadius) - bonfireVertical * bonfireVertical);
  let bonfireSmokeBand = smoothstep(0.30, 0.52, p.y) * (1.0 - smoothstep(0.82, 0.99, p.y));
  let bonfireSmokeSource = exp(-sourceRadial * sourceRadial / max(0.0064, bonfireSmokeRadius * bonfireSmokeRadius)) * bonfireSmokeBand * (0.72 + 0.44 * bonfireSourceBreakup) * inputFlow;
  let source = mix(columnSource, max(bonfireSmokeSource, bonfireFireball * inputFlow * 0.84), bonfireScene);
  let emberRingRadius = scaledSourceRadius * 0.94;
  let emberRingWidth = max(0.026, scaledSourceRadius * 0.22);
  let columnEmberRing = exp(-pow(abs(sourceRadial - emberRingRadius), 2.0) / max(0.002, emberRingWidth * emberRingWidth)) * sourceBand * inputFlow * (0.22 + 0.18 * sin(time * 1.7 + p.x * 9.0));
  let bonfireEmberRing = exp(-pow(abs(sourceRadial - bonfireCoreRadius * 0.78), 2.0) / max(0.002, emberRingWidth * emberRingWidth * 1.8)) * bonfireSmokeBand * inputFlow * (0.32 + 0.22 * sin(time * 2.4 + sourceRadial * 19.0 * scaledDetailFrequency));
  let emberRing = mix(columnEmberRing, bonfireEmberRing, bonfireScene);
  let fireBirthBand = smoothstep(-0.99, -0.82, p.y) * (1.0 - smoothstep(-0.22, 0.16, p.y));
  let columnFireBirth = exp(-sourceRadial * sourceRadial * fireSourceFalloff * mix(2.45, 1.35, smoothstep(0.35, 1.30, fireScale))) * fireBirthBand * inputFlow * sourceScaleCompensation * (0.72 + 0.66 * breakup);
  let bonfireFireBirth = (bonfireFireball * (1.08 + 0.58 * bonfireSourceBreakup) + bonfireEmberRing * 0.42) * inputFlow * sourceScaleCompensation;
  let fireBirth = mix(columnFireBirth, bonfireFireBirth, bonfireScene);
  let swirl = vec3<f32>(-p.z, 0.0, p.x) / max(radial, 0.08);
  let phase = time * 4.8 + p.y * 12.0 + hash31(vec3<f32>(gid) * 0.071) * 3.2;
  let interfaceEnergy = length(materialInterfaceGradient(cellI));
  let lickBirth = fireLickBreakup(cellI, p * detailDomain, time, fireLickOperatorGain, heat, fuel, flame, flameDetail, source);
  let externalInjection = applyExternalEmitterInjection(externalEmitterInfluence(p, time));
  let confinement = vorticityConfinement(cellI, 0.034 + curl * 0.044);
  let detailForce = turbulentDetailForce(p * (0.82 + detailScale * 0.30), time) * (source + smoke * 0.26 + heat * 0.18) * (0.018 + curl * 0.010);
  let microForce = turbulentDetailForce(p * (2.85 * scaledDetailFrequency) + vec3<f32>(0.13, -0.27, 0.31), time * 2.4) * microAmount * (source * 0.74 + microSmoke * 0.38 + interfaceShred * 0.26 + fireLick * 0.22) * 0.026;
  let shredForce = interfaceShreddingForce(cellI, p * detailDomain, time, shredOperatorGain, heat, smoke, flame, interfaceShred);
  let heatExpansion = thermalExpansionForce(cellI, heat, 0.048 + curl * 0.019);
  let projectionCorrection = pressureProjectionCorrection(cellI, projection);
  vel = vel + swirl * heat * (0.018 + 0.010 * curl) + swirl * source * 0.012;
  vel = vel + confinement * (0.35 + smoke * 0.34 + heat * 0.52);
  vel = vel + detailForce;
  vel = vel + microForce;
  vel = vel + shredForce;
  vel = vel + fineScaleBreakup(cellI, p, time, curl, heat, smoke, source);
  vel = vel + heatExpansion;
  vel = vel + externalInjection.velocity.xyz * (0.18 + speed * 0.036);
  let bonfireLiftDirection = mix(1.0, -1.0, bonfireScene);
  vel = vel + thermalBuoyancyForce(heat, smoke, fuel, speed) * plumeRiseScale * bonfireLiftDirection;
  vel.y = vel.y + (source * (0.022 + speed * 0.006) + smoke * 0.003) * plumeRiseScale * bonfireLiftDirection;
  vel.x = vel.x + sin(phase) * (smoke + heat) * 0.0038 * curl;
  vel.z = vel.z + cos(phase * 0.93) * (smoke + heat) * 0.0038 * curl;
  let explicitWindAuthority = smoothstep(0.05, 1.0, windStrength);
  let bonfireNonWindLateralDamping = mix(1.0, mix(0.28, 0.78, explicitWindAuthority), bonfireScene);
  vel.x = vel.x * bonfireNonWindLateralDamping;
  vel.z = vel.z * bonfireNonWindLateralDamping;
  let bonfireNonWindAuthority = bonfireScene * (1.0 - explicitWindAuthority);
  let bonfireCenteringCarrier = clamp(source * 0.72 + smoke * 0.46 + heat * 0.28, 0.0, 1.5);
  let bonfireNonWindCenteringForce = vec3<f32>(-p.x, 0.0, -p.z) * bonfireNonWindAuthority * bonfireCenteringCarrier * (0.026 + speed * 0.006);
  vel = vel + bonfireNonWindCenteringForce;
  let windMaterialCoupling = clamp(smoke * 0.54 + heat * 0.30 + source * 0.34 + flame * 0.18, 0.0, 1.6);
  let bonfireWindResponseGain = mix(1.0, 4.0, bonfireScene);
  vel = vel + windDirection * windStrength * windHeightRamp * windMaterialCoupling * bonfireWindResponseGain * (0.020 + speed * 0.004);
  vel = vel - projectionCorrection * (0.32 + smoke * 0.08 + heat * 0.06);
  let smokeFromHeat = heatToSmokeConversion(heat, fuel, p.y);
  smoke = max(smoke + smokeFromHeat, source * 0.54 + emberRing * 0.16);
  smoke = max(smoke, externalInjection.material.x * 0.76);
  heat = max(heat, source * 0.86 + emberRing * 0.22);
  heat = max(heat, externalInjection.material.y * 0.92);
  let sourceFuelMask = mix(1.0 - smoothstep(-0.74, -0.18, p.y), smoothstep(0.28, 0.58, p.y), bonfireScene);
  fuel = max(fuel, source * 0.88 * sourceFuelMask);
  fuel = max(fuel, externalInjection.material.z * 0.72);
  fuel = max(fuel - heat * 0.018, 0.0);
  materialDetail = max(materialDetail, (source + emberRing + smokeFromHeat * 3.2) * (0.32 + 0.56 * breakup));
  materialDetail = max(materialDetail, externalInjection.material.w * 0.90);
  microSmoke = max(microSmoke, (source * 0.26 + smokeFromHeat * 0.70 + materialDetail * 0.18) * microAmount * (0.48 + 0.52 * breakup));
  microSmoke = max(microSmoke, externalInjection.micro.x);
  interfaceShred = max(interfaceShred, interfaceEnergy * shredOperatorGain * (smoke * 0.54 + heat * 0.38 + flame * 0.32 + materialDetail * 0.28 + microSmoke * 0.13 + source * 0.30) * 1.72);
  interfaceShred = max(interfaceShred, externalInjection.micro.y);
  fireLick = max(fireLick, lickBirth.x + fireBirth * fireLickOperatorGain * 0.34);
  fireLick = max(fireLick, externalInjection.micro.z);
  emberFleck = max(emberFleck, lickBirth.w + emberRing * 0.18 + interfaceShred * 0.10);
  emberFleck = max(emberFleck, externalInjection.micro.w);
  materialDetail = max(materialDetail, microSmoke * 0.25 + interfaceShred * 0.38);
  flame = max(flame, fireBirth * 1.58 + heat * fuel * 0.060 + fireLick * 0.48);
  flame = max(flame, externalInjection.fire.x);
  ember = max(ember, fireBirth * 0.78 + flame * 0.22 + emberFleck * 0.18);
  ember = max(ember, externalInjection.fire.y);
  flameDetail = max(flameDetail, (fireBirth * 1.16 + heatExpansion.y * 4.0) * (0.44 + 0.62 * breakup) + lickBirth.z + fireLick * 0.34);
  flameDetail = max(flameDetail, externalInjection.fire.z);

  let bonfireFireCeiling = mix(1.0, smoothstep(0.18, 0.58, p.y), bonfireScene);
  flame = flame * bonfireFireCeiling;
  ember = ember * mix(1.0, max(0.24, bonfireFireCeiling), bonfireScene);
  flameDetail = flameDetail * bonfireFireCeiling;
  fireLick = fireLick * mix(1.0, max(0.18, bonfireFireCeiling), bonfireScene);

  let wall = max(max(abs(p.x), abs(p.y)), abs(p.z));
  let wallFade = 1.0 - smoothstep(0.86, 1.0, wall);
  let smokeTopFade = 1.0 - smoothstep(mix(0.66, 0.84, plumeHeight01), 0.995, p.y);
  let heatTopFade = 1.0 - smoothstep(mix(0.42, 0.62, plumeHeight01), 0.960, p.y);
  smoke = smoke * mix(0.42, 1.0, wallFade) * mix(0.72, 1.0, smokeTopFade);
  heat = heat * mix(0.30, 1.0, wallFade) * mix(0.16, 1.0, heatTopFade);
  fuel = fuel * mix(0.20, 1.0, wallFade) * mix(0.58, 1.0, heatTopFade);
  materialDetail = materialDetail * mix(0.22, 1.0, wallFade);
  flame = flame * mix(0.12, 1.0, wallFade) * mix(0.08, 1.0, heatTopFade);
  ember = ember * mix(0.18, 1.0, wallFade) * mix(0.16, 1.0, smokeTopFade);
  flameDetail = flameDetail * mix(0.10, 1.0, wallFade);
  microSmoke = microSmoke * mix(0.20, 1.0, wallFade) * mix(0.50, 1.0, smokeTopFade);
  interfaceShred = interfaceShred * mix(0.18, 1.0, wallFade);
  fireLick = fireLick * mix(0.10, 1.0, wallFade) * mix(0.10, 1.0, heatTopFade);
  emberFleck = emberFleck * mix(0.15, 1.0, wallFade);
  let density = clamp(max(smoke * 1.08 + microSmoke * 0.08, heat * 0.42 + materialDetail * 0.18 + interfaceShred * 0.20 + fireLick * 0.05 + fuel * 0.10), 0.0, 2.2);
  vel = vel * mix(0.55, 1.0, wallFade);
  vel.y = mix(max(vel.y, -0.015), vel.y, bonfireScene);
  fluidDst[base] = vec4<f32>(clamp(vel, vec3<f32>(-0.34), vec3<f32>(0.52)), density);
  fluidDst[base + 1u] = vec4<f32>(clamp(smoke, 0.0, 2.2), clamp(heat, 0.0, 2.4), clamp(fuel, 0.0, 1.8), clamp(materialDetail, 0.0, 1.8));
  fluidDst[base + 2u] = vec4<f32>(clamp(flame, 0.0, 2.4), clamp(ember, 0.0, 2.0), clamp(flameDetail, 0.0, 1.8), 0.0);
  fluidDst[base + 3u] = vec4<f32>(clamp(microSmoke, 0.0, 1.8), clamp(interfaceShred, 0.0, 1.8), clamp(fireLick, 0.0, 1.8), clamp(emberFleck, 0.0, 1.4));
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4<f32> {
  let ndc = vec2<f32>(in.uv.x * 2.0 - 1.0, (1.0 - in.uv.y) * 2.0 - 1.0);
  let nearClip = vec4<f32>(ndc, -1.0, 1.0);
  let farClip = vec4<f32>(ndc, 1.0, 1.0);
  let nearWorldRaw = u.invViewProj * nearClip;
  let farWorldRaw = u.invViewProj * farClip;
  let nearWorld = nearWorldRaw.xyz / nearWorldRaw.w;
  let farWorld = farWorldRaw.xyz / farWorldRaw.w;
  let ro = u.cameraPos_time.xyz;
  let rd = normalize(farWorld - nearWorld);
  let hit = boxHit(ro, rd, vec3<f32>(1.0, 1.0, 1.0));
  if (hit.y <= max(hit.x, 0.0)) {
    return vec4<f32>(0.004, 0.005, 0.006, 1.0);
  }

  let steps = clamp(u.viewport_steps_density.z, 24.0, 192.0);
  let fireScale = clamp(u.scale_controls.x, 0.35, 1.30);
  let detailScale = clamp(u.scale_controls.y, 0.45, 3.20);
  let plumeHeight = clamp(u.scale_controls.z, 0.70, 2.20);
  let scaledDetailFrequency = clamp(detailScale / max(fireScale, 0.45), 0.55, 5.40);
  let scaleDomain = vec3<f32>(scaledDetailFrequency, mix(1.0, 1.24, smoothstep(0.70, 2.20, plumeHeight)), scaledDetailFrequency);
  let startT = max(hit.x, 0.0);
  let endT = hit.y;
  let dtBase = (endT - startT) / steps;
  let jitter = temporalJitterOffset(in.uv, dtBase);
  var t = startT + jitter;
  var trans = 1.0;
  var color = vec3<f32>(0.004, 0.005, 0.006);
  let entryP = ro + rd * startT;
  let exitP = ro + rd * endT;
  var gridAccum = max(gridLine(entryP), gridLine(exitP));
  var temporalMaterialWeight = 0.0;
  var temporalWorldSum = vec3<f32>(0.0);
  var temporalVelocitySum = vec3<f32>(0.0);
  var temporalReactiveSignal = 0.0;
  var temporalMajorantEdge = 0.0;
  var temporalSmokeHistoryTrustSum = 0.0;
  var temporalFireHistoryProtectSum = 0.0;
  var temporalInterfaceHistoryProtectSum = 0.0;
  var temporalDetailHistoryProtectSum = 0.0;

  for (var i = 0; i < 192; i = i + 1) {
    if (f32(i) >= steps || raymarchEarlyTermination(trans) || t > endT) { break; }
    let p = ro + rd * t;
    let majorantNearest = sampleWorldMajorant(p);
    let majorantLinear = sampleWorldMajorantLinear(p);
    let majorantDilated = sampleWorldMajorantDilated(p);
    let majorantSkipStrength = clamp(u.occupancy_controls.y, 0.0, 1.0);
    let majorantSmooth = clamp(u.occupancy_controls.z, 0.0, 1.0);
    let majorantEdgeGuard = clamp(u.occupancy_controls.w, 0.0, 1.0);
    let majorant = mix(majorantNearest, mix(majorantLinear, majorantDilated, 0.28 + majorantEdgeGuard * 0.42), majorantSmooth);
    let majorantEdge = majorantGradientSignal(p);
    let guardedImportance = max(majorant.w, majorantDilated.w * majorantEdgeGuard * (0.55 + majorantSmooth * 0.25));
    let guardedThreshold = mix(0.050, 0.100, majorantEdgeGuard);
    let majorantEmpty = 1.0 - smoothstep(0.004, guardedThreshold, guardedImportance + majorantEdge * majorantEdgeGuard * 0.24);
    let edgeDamping = 1.0 - smoothstep(0.012, 0.16, majorantEdge * majorantEdgeGuard);
    let majorantSkipGate = majorantEmpty * majorantSkipStrength * edgeDamping;
    temporalMajorantEdge = max(temporalMajorantEdge, majorantEdge * (0.18 + majorantSkipGate));
    if (majorantSkipGate > 0.42) {
      let cellExit = majorantCellExitDistance(p, rd);
      let skipDt = min(cellExit + dtBase * 0.20, dtBase * (1.0 + majorantSkipGate * 6.0));
      t = t + min(skipDt, max(0.0001, endT - t));
      continue;
    }
    let state = sampleWorldVelocity(p);
    let material = sampleWorldMaterial(p);
    let fireLayer = sampleWorldFireLayer(p);
    let microLayer = sampleWorldMicrodetail(p);
    let velMag = length(state.xyz);
    let smokeDensity = material.x;
    let heat = material.y;
    let fuel = material.z;
    let materialDetail = material.w;
    let flame = fireLayer.x;
    let ember = fireLayer.y;
    let flameDetail = fireLayer.z;
    let microSmoke = microLayer.x;
    let interfaceShred = microLayer.y;
    let fireLick = microLayer.z;
    let emberFleck = microLayer.w;
    let flowDebug = clamp(u.source_controls.w, 0.0, 1.0);
    let radianceGain = max(0.0, u.radiance_controls.x);
    let absorptionGain = max(0.0, u.radiance_controls.y);
    let glowGain = max(0.0, u.radiance_controls.z);
    let adaptiveRays = clamp(u.radiance_controls.w, 0.0, 1.0);
    let occupancySkipStrength = clamp(u.occupancy_controls.x, 0.0, 1.0);
    let sampleCell = vec3<i32>(floor(clamp((p * 0.5 + vec3<f32>(0.5)) * f32(GRID), vec3<f32>(0.0), vec3<f32>(f32(GRID) - 1.0))));
    let curlDebug = curlMagnitudeAtCell(sampleCell);
    let divDebug = abs(divergenceAtCell(sampleCell));
    let microTextureSignal = clamp(microSmoke * 1.55 + interfaceShred * 2.45 + fireLick * 1.30 + emberFleck * 0.55, 0.0, 2.4);
    let microBodyContribution = microSmoke * 0.10 + interfaceShred * 0.18 + fireLick * 0.06;
    let density = (smokeDensity * 0.84 + heat * 0.28 + materialDetail * 0.14 + microBodyContribution) * u.viewport_steps_density.w;
    let y = clamp((p.y + 1.0) * 0.5, 0.0, 1.0);
    let fireGain = 0.42 + u.fire_smoke_curl_speed.x * 1.15;
    let temp = emissiveTemperature(fireLayer, material, microLayer, velMag) * fireGain;
    let smoke = (smokeDensity + microBodyContribution * 0.70) * smoothstep(0.03, 0.92, y) * u.fire_smoke_curl_speed.y;
    let extinction = smokeRadianceExtinction(smokeDensity, microSmoke, interfaceShred, materialDetail, absorptionGain);
    let occupancy = raymarchOccupancySignal(density, smoke, heat, temp, flame, microTextureSignal, velMag, extinction);
    let emptySpanScale = occupancySkipStepScale(occupancy, occupancySkipStrength, adaptiveRays);
    if (emptySpanScale > 1.08) {
      t = t + min(dtBase * emptySpanScale, max(0.0001, endT - t));
      continue;
    }
    let detailP = p * scaleDomain;
    let microWarp = microDetailDomainWarp(detailP, microLayer, fireLayer, material, state.xyz, u.cameraPos_time.w);
    let detailCarrier = clamp(microTextureSignal + materialDetail * 0.22 + flameDetail * 0.18 + velMag * 0.36, 0.0, 2.8);
    let filamentNoise = microFilamentNoise(detailP, microWarp, detailCarrier, state.xyz, u.cameraPos_time.w);
    let shredNoise = microFilamentNoise(detailP.zxy + vec3<f32>(0.13, -0.21, 0.09), microWarp.yzx * 1.21, detailCarrier + interfaceShred * 1.7, state.zxy, u.cameraPos_time.w * 1.17 + 1.3);
    let fireNoise = microFilamentNoise(detailP.yzx + vec3<f32>(-0.18, 0.07, 0.24), microWarp.zxy * 1.38, detailCarrier + fireLick * 2.1, state.yzx, u.cameraPos_time.w * 1.31 + 2.1);
    let interest = raymarchInterest(density, smoke, heat, temp, flame, flameDetail, microTextureSignal, velMag, fireLick, interfaceShred);
    let localDt = min(dtBase * adaptiveRayStepScale(interest, adaptiveRays), max(0.0001, endT - t));
    let rayStepOpacity = localDt * 3.65;
    let smokeAlpha = clamp((density * 1.08 + smoke * 0.40 + heat * 0.13 + materialDetail * 0.28 + microBodyContribution * 0.54) * rayStepOpacity * (0.86 + absorptionGain * 0.12), 0.0, 0.16);
    let fireAlpha = clamp((flame * 2.15 + ember * 0.86 + flameDetail * 0.82 + fireLick * 2.60 + emberFleck * 0.76 + interfaceShred * 0.26) * rayStepOpacity * fireGain * (0.58 + radianceGain * 0.18), 0.0, 0.20);
    let alpha = clamp(smokeAlpha + fireAlpha, 0.0, 0.18);
    let materialSignals = materialTemporalSignals(alpha, smokeAlpha, fireAlpha, temp, microTextureSignal, interfaceShred, fireLick, majorantEdge, interest, trans);
    let materialTemporal = materialTemporalClassificationFromSignals(materialSignals);
    let temporalSampleWeight = materialAwareImportanceWeightFromSignals(materialSignals);
    temporalMaterialWeight = temporalMaterialWeight + temporalSampleWeight;
    temporalWorldSum = temporalWorldSum + p * temporalSampleWeight;
    temporalVelocitySum = temporalVelocitySum + state.xyz * temporalSampleWeight;
    temporalSmokeHistoryTrustSum = temporalSmokeHistoryTrustSum + materialTemporal.x * temporalSampleWeight;
    temporalFireHistoryProtectSum = temporalFireHistoryProtectSum + materialTemporal.y * temporalSampleWeight;
    temporalInterfaceHistoryProtectSum = temporalInterfaceHistoryProtectSum + materialTemporal.z * temporalSampleWeight;
    temporalDetailHistoryProtectSum = temporalDetailHistoryProtectSum + materialTemporal.w * temporalSampleWeight;
    temporalReactiveSignal = max(temporalReactiveSignal, clamp(fireAlpha * 5.2 + temp * 0.075 + flameDetail * 0.45 + fireLick * 0.38 + interfaceShred * 0.16 + materialSignals.reactiveBoost, 0.0, 2.2));
    let filament = smoothstep(0.014, 0.34, max(materialDetail * 0.66, microTextureSignal)) * filamentNoise;
    let shredFilament = smoothstep(0.004, 0.22, interfaceShred * 3.10 + fireLick * 0.50 + microSmoke * 0.12) * shredNoise;
    let fireFilament = smoothstep(0.008, 0.34, max(flameDetail * 0.72, fireLick * 2.25 + emberFleck * 0.44)) * fireNoise;
    let fineShadow = 0.48 + 0.64 * filament - 0.20 * shredFilament;
    let smokeCol = vec3<f32>(0.28, 0.38, 0.42) * fineShadow * (0.42 + min(0.78, velMag * 6.0) + shredFilament * 0.26);
    let flameCol = fireColor(temp) * (0.22 + temp * 0.82 + fireFilament * 0.82 + fireLick * 0.32 + shredFilament * 0.10);
    let radianceEmission = fireRadianceEmission(temp, flameDetail, fireLick, emberFleck, radianceGain, glowGain);
    let smokeBacklight = fireColor(temp * 0.72) * smokeAlpha * glowGain * smoothstep(0.16, 1.25, temp) * (0.13 + fireFilament * 0.10);
    let fireMix = smoothstep(0.005, 0.052, fireAlpha) * smoothstep(0.08, 0.70, temp);
    var local = mix(smokeCol, flameCol * 0.30 + radianceEmission * 0.70, fireMix);
    let diagnosticColor = mix(vec3<f32>(0.08, 0.72, 0.95), vec3<f32>(1.0, 0.18, 0.08), smoothstep(0.010, 0.085, divDebug)) * (0.35 + smoothstep(0.012, 0.18, curlDebug));
    local = mix(local, diagnosticColor, flowDebug * smoothstep(0.015, 0.12, curlDebug + divDebug));
    color = color + trans * (alpha * local + fireAlpha * radianceEmission * 0.82 + smokeBacklight);
    let extinctionStep = clamp(alpha * (0.46 + extinction * 0.16) + fireAlpha * 0.08, 0.0, 0.34);
    trans = trans * exp(-extinctionStep);
    t = t + localDt;
  }

  let vignette = 1.0 - smoothstep(0.28, 1.48, length(ndc));
  let exposed = vec3<f32>(1.0) - exp(-color * 0.96);
  var grade = exposed * (0.80 + 0.18 * vignette);
  let overlay = clamp(gridAccum * u.grid_overlay_debug.x * 1.8, 0.0, 1.0);
  grade = mix(grade, vec3<f32>(0.04, 0.86, 0.98), overlay * 0.76);
  let current = pow(max(grade, vec3<f32>(0.0)), vec3<f32>(0.84));
  let temporalInvWeight = 1.0 / max(temporalMaterialWeight, 0.0001);
  let temporalWorld = temporalWorldSum * temporalInvWeight;
  let temporalVelocity = temporalVelocitySum * temporalInvWeight;
  let temporalConfidence = temporalReprojectionConfidence(temporalMaterialWeight, temporalMajorantEdge, temporalReactiveSignal);
  let temporalUv = temporalReprojectionUv(temporalWorld, temporalVelocity, temporalConfidence);
  let materialTemporalWeights = materialAwareTemporalWeights(temporalSmokeHistoryTrustSum, temporalFireHistoryProtectSum, temporalInterfaceHistoryProtectSum, temporalDetailHistoryProtectSum, temporalMaterialWeight);
  return vec4<f32>(temporalResolveColor(current, in.uv, temporalUv.xy, temporalConfidence * temporalUv.z, temporalReactiveSignal, temporalMajorantEdge, temporalUv.z, materialTemporalWeights), 1.0);
}
`;

export function createKaminosVolumePrototype({ THREE, viewport, camera, controls, getControls, onStatus }) {
  const canvas = document.createElement('canvas');
  canvas.id = 'kaminos-volume-canvas';
  canvas.dataset.prototype = PROTOTYPE_IDENTITY;
  canvas.dataset.routeIdentity = ROUTE_IDENTITY;
  viewport.appendChild(canvas);

  const invViewProj = new THREE.Matrix4();
  const viewProj = new THREE.Matrix4();
  const previousViewProj = new THREE.Matrix4();
  const uniforms = new Float32Array(72);
  let controlsSnapshot = getControls();
  let gridSize = normalizeGridSize(controlsSnapshot.resolution);
  let majorantGridSize = normalizeMajorantGridSize(controlsSnapshot.majorantGrid);
  const state = {
    prototypeIdentity: PROTOTYPE_IDENTITY,
    routeIdentity: ROUTE_IDENTITY,
    requestedRoute: 'kaminos_volume_smoke=1',
    effectiveRoute: ROUTE_IDENTITY,
    backend: 'inactive',
    active: false,
    width: 0,
    height: 0,
    displayWidth: 0,
    displayHeight: 0,
    renderWidth: 0,
    renderHeight: 0,
    renderScale: normalizeRenderScale(controlsSnapshot.renderScale),
    renderPixelRatio: 1,
    volumeReconstructionStyle: 'linear-css-upscale',
    volumeScene: normalizeVolumeScene(controlsSnapshot.volumeScene),
    frameCount: 0,
    simStepCount: 0,
    simGrid: gridSize,
    simGridLabel: `${gridSize}^3 velocity-material-fire-microdetail-storage-buffer`,
    gridOverlay: 0,
    adaptiveRaymarch: 0.65,
    occupancySkip: 0.35,
    majorantSkip: 0.70,
    majorantSmooth: 0.85,
    majorantGuard: 0.75,
    temporalAccum: 0.25,
    temporalJitter: 0.85,
    historyClamp: 0.70,
    fireScale: 0.86,
    detailScale: 1.75,
    plumeHeight: 1.45,
    windStrength: normalizeWindStrength(controlsSnapshot.windStrength),
    windAngle: normalizeWindAngle(controlsSnapshot.windAngle),
    windHeight: normalizeWindHeight(controlsSnapshot.windHeight),
    externalEmitterMode: 'off',
    externalEmitterCoordinateSpace: 'none',
    externalEmitterCount: 0,
    externalEmitterAgeMs: null,
    externalEmitterFrameId: null,
    temporalAccumEffective: 0,
    temporalReprojectionConfidence: 0,
    temporalHistoryWeight: 0,
    temporalRejectedHistory: 1,
    temporalSmokeHistoryTrust: 0,
    temporalFireHistoryProtect: 0,
    temporalInterfaceHistoryProtect: 0,
    temporalEvidenceSource: 'cpu-estimate-control-proxy',
    temporalHistoryFrames: 0,
    temporalHistoryResetCount: 0,
    temporalHistoryResetReason: 'initial',
    temporalHistoryValid: false,
    majorantGrid: majorantGridSize,
    majorantBuilt: false,
    majorantFrameCount: 0,
    lastFrameEnergy: 0,
    timing: {
      timingEvidenceSource: 'raf-and-queue-proxy',
      timingDisclaimer: 'not-gpu-exclusive-or-present-latency',
      rafFps: 0,
      frameDeltaMs: 0,
      frameP95Ms: 0,
      cpuFrameMs: 0,
      cpuFrameP95Ms: 0,
      queueDoneMs: null,
      queueDoneP95Ms: null,
      queueProbePending: false,
      queueSamples: 0,
      queueTimingAvailable: false,
    },
    error: null,
  };

  let adapter = null;
  let device = null;
  let context = null;
  let pipeline = null;
  let readbackPipeline = null;
  let computePipeline = null;
  let majorantComputePipeline = null;
  let bindGroups = [];
  let majorantFluidBindGroups = [];
  let majorantWriteBindGroup = null;
  let bindGroupLayout = null;
  let majorantFluidBindGroupLayout = null;
  let majorantWriteBindGroupLayout = null;
  let pipelineLayout = null;
  let majorantPipelineLayout = null;
  let shader = null;
  let uniformBuffer = null;
  let externalEmitterBuffer = null;
  let externalEmitterState = normalizeExternalEmitters();
  let majorantBuffer = null;
  let fluidBuffers = [];
  let currentFluid = 0;
  let frameTexture = null;
  let frameTextureSize = '';
  let historyTexture = null;
  let historyTextureSize = '';
  let historySampler = null;
  let historyValid = false;
  let previousViewProjReady = false;
  let lastTemporalCameraSignature = '';
  let lastTemporalControlSignature = '';
  let format = null;
  let raf = 0;
  const timingSamples = {
    rafDelta: [],
    cpuFrame: [],
    queueDone: [],
  };
  let lastRafNow = 0;
  let queueProbePending = false;

  function pushTimingSample(name, value, maxSamples = 120) {
    if (!Number.isFinite(value)) return;
    const samples = timingSamples[name];
    samples.push(value);
    if (samples.length > maxSamples) samples.shift();
  }

  function percentileTiming(samples, percentile) {
    if (!samples.length) return null;
    const sorted = [...samples].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(percentile * sorted.length) - 1));
    return sorted[index];
  }

  function recordVolumeFrameTiming(now, cpuFrameMs) {
    if (lastRafNow > 0) pushTimingSample('rafDelta', now - lastRafNow);
    lastRafNow = now;
    pushTimingSample('cpuFrame', cpuFrameMs);
    const rafP95 = percentileTiming(timingSamples.rafDelta, 0.95);
    const cpuP95 = percentileTiming(timingSamples.cpuFrame, 0.95);
    state.timing = {
      ...state.timing,
      timingEvidenceSource: 'raf-and-queue-proxy',
      timingDisclaimer: 'not-gpu-exclusive-or-present-latency',
      rafFps: rafP95 ? 1000 / rafP95 : 0,
      frameDeltaMs: timingSamples.rafDelta.at(-1) ?? 0,
      frameP95Ms: rafP95 ?? 0,
      cpuFrameMs,
      cpuFrameP95Ms: cpuP95 ?? 0,
      queueProbePending,
      queueSamples: timingSamples.queueDone.length,
    };
  }

  function recordVolumeQueueTiming(submittedAt) {
    const queueDoneMs = performance.now() - submittedAt;
    pushTimingSample('queueDone', queueDoneMs, 80);
    state.timing = {
      ...state.timing,
      timingEvidenceSource: 'raf-and-queue-proxy',
      timingDisclaimer: 'not-gpu-exclusive-or-present-latency',
      queueDoneMs,
      queueDoneP95Ms: percentileTiming(timingSamples.queueDone, 0.95),
      queueProbePending: queueProbePending,
      queueSamples: timingSamples.queueDone.length,
      queueTimingAvailable: true,
    };
  }

  function probeVolumeQueueTiming() {
    if (queueProbePending || !device?.queue?.onSubmittedWorkDone) return;
    queueProbePending = true;
    state.timing = {
      ...state.timing,
      timingEvidenceSource: 'raf-and-queue-proxy',
      timingDisclaimer: 'not-gpu-exclusive-or-present-latency',
      queueProbePending: true,
      queueTimingAvailable: true,
    };
    const submittedAt = performance.now();
    device.queue.onSubmittedWorkDone()
      .then(() => recordVolumeQueueTiming(submittedAt))
      .catch(error => {
        state.timing = {
          ...state.timing,
          timingEvidenceSource: 'raf-and-queue-proxy',
          timingDisclaimer: 'not-gpu-exclusive-or-present-latency',
          queueTimingAvailable: false,
          queueTimingError: error?.message || String(error),
        };
      })
      .finally(() => {
        queueProbePending = false;
        state.timing = {
          ...state.timing,
          timingEvidenceSource: 'raf-and-queue-proxy',
          timingDisclaimer: 'not-gpu-exclusive-or-present-latency',
          queueProbePending: false,
        };
      });
  }

  function emitStatus(extra = {}) {
    onStatus?.({ ...state, ...extra });
  }

  function updateExternalEmitterDebug(nowMs = externalEmitterNowMs()) {
    state.externalEmitterMode = externalEmitterState.mode;
    state.externalEmitterCoordinateSpace = externalEmitterState.coordinateSpace;
    state.externalEmitterCount = externalEmitterState.count;
    state.externalEmitterFrameId = externalEmitterState.frameId;
    state.externalEmitterAgeMs = externalEmitterState.count > 0 ? Math.max(0, nowMs - externalEmitterState.timestampMs) : null;
  }

  function ensureExternalEmitterBuffer() {
    if (externalEmitterBuffer) return;
    externalEmitterBuffer = device.createBuffer({
      label: `kaminos external segment emitters ${MAX_EXTERNAL_EMITTERS}`,
      size: externalEmitterBufferBytes(),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(externalEmitterBuffer, 0, externalEmitterState.data);
  }

  function writeExternalEmitterBuffer() {
    if (!device || !externalEmitterBuffer) return;
    device.queue.writeBuffer(externalEmitterBuffer, 0, externalEmitterState.data);
  }

  function makeInitialFluid(nextGridSize) {
    const data = new Float32Array(gridCellCount(nextGridSize) * FLUID_COMPONENTS);
    for (let z = 0; z < nextGridSize; z += 1) {
      for (let y = 0; y < nextGridSize; y += 1) {
        for (let x = 0; x < nextGridSize; x += 1) {
          const fx = (x + 0.5) / nextGridSize * 2 - 1;
          const fy = (y + 0.5) / nextGridSize * 2 - 1;
          const fz = (z + 0.5) / nextGridSize * 2 - 1;
          const radial = Math.hypot(fx, fz);
          const fireScale = Math.max(0.35, Math.min(1.3, controlsSnapshot.fireScale ?? 0.86));
          const detailScale = Math.max(0.45, Math.min(3.2, controlsSnapshot.detailScale ?? 1.75));
          const plumeHeight = Math.max(0.7, Math.min(2.2, controlsSnapshot.plumeHeight ?? 1.45));
          const plumeHeight01 = Math.max(0, Math.min(1, (plumeHeight - 0.7) / 1.5));
          const scaledDetailFrequency = Math.max(0.55, Math.min(5.4, detailScale / Math.max(fireScale, 0.45)));
          const inputRadius = Math.max(0.08, controlsSnapshot.inputRadius || 0.08) * (0.92 + (1.08 - 0.92) * plumeHeight01);
          const inputFlow = Math.max(0, controlsSnapshot.flowRate ?? 0.3);
          const source = Math.exp(-(radial * radial) / Math.max(0.0036, inputRadius * inputRadius)) * Math.max(0, 1 - Math.abs(fy + 0.74) * 4.2) * inputFlow;
          const i = ((x + y * nextGridSize + z * nextGridSize * nextGridSize) * FLUID_COMPONENTS);
          data[i] = -fz * source * 0.11;
          data[i + 1] = source * 0.22;
          data[i + 2] = fx * source * 0.11;
          data[i + 3] = source * 1.25;
          data[i + 4] = source * 0.74;
          data[i + 5] = source * 1.28;
          data[i + 6] = source * 1.0;
          data[i + 7] = source * (0.35 + 0.65 * Math.sin((fx * 18 * scaledDetailFrequency) + (fz * 11 * scaledDetailFrequency)) ** 2);
          data[i + 8] = source * 0.90;
          data[i + 9] = source * 0.42;
          data[i + 10] = source * (0.30 + 0.70 * Math.cos((fx * 13 * scaledDetailFrequency) - (fz * 17 * scaledDetailFrequency)) ** 2);
          data[i + 11] = 0;
          data[i + 12] = source * (0.22 + 0.78 * Math.sin((fx * 31 * scaledDetailFrequency) - (fz * 19 * scaledDetailFrequency)) ** 2);
          data[i + 13] = source * (0.12 + 0.50 * Math.cos((fx * 23 * scaledDetailFrequency) + (fy * 17) - (fz * 29 * scaledDetailFrequency)) ** 2);
          data[i + 14] = source * (0.18 + 0.82 * Math.sin((fy * 27) + (fz * 21 * scaledDetailFrequency)) ** 2);
          data[i + 15] = source * 0.16;
        }
      }
    }
    return data;
  }

  function destroyFluidState() {
    for (const buffer of fluidBuffers) buffer.destroy();
    fluidBuffers = [];
    bindGroups = [];
    majorantFluidBindGroups = [];
  }

  function destroyMajorantState() {
    majorantBuffer?.destroy();
    majorantBuffer = null;
    majorantWriteBindGroup = null;
  }

  function resetTemporalHistory(reason = 'reset') {
    historyValid = false;
    previousViewProjReady = false;
    state.temporalHistoryValid = false;
    state.temporalHistoryFrames = 0;
    state.temporalReprojectionConfidence = 0;
    state.temporalHistoryWeight = 0;
    state.temporalRejectedHistory = 1;
    state.temporalSmokeHistoryTrust = 0;
    state.temporalFireHistoryProtect = 0;
    state.temporalInterfaceHistoryProtect = 0;
    state.temporalEvidenceSource = 'cpu-estimate-control-proxy';
    state.temporalHistoryResetCount += 1;
    state.temporalHistoryResetReason = reason;
  }

  function commitPreviousViewProjection() {
    previousViewProj.copy(viewProj);
    previousViewProjReady = true;
  }

  function destroyTemporalHistory() {
    historyTexture?.destroy();
    historyTexture = null;
    historyTextureSize = '';
    resetTemporalHistory('history-destroyed');
  }

  function ensureTemporalHistoryTexture() {
    if (!device || !format) return;
    const width = Math.max(1, state.width || 1);
    const height = Math.max(1, state.height || 1);
    const key = `${width}x${height}:${format}`;
    if (historyTexture && historyTextureSize === key) return;
    historyTexture?.destroy();
    historyTexture = device.createTexture({
      label: `kaminos temporal history texture ${width}x${height}`,
      size: { width, height, depthOrArrayLayers: 1 },
      format,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    historyTextureSize = key;
    resetTemporalHistory('history-resized');
    rebuildFluidBindGroups();
  }

  function temporalCameraSignature() {
    return [
      camera.position.x.toFixed(4),
      camera.position.y.toFixed(4),
      camera.position.z.toFixed(4),
      camera.quaternion.x.toFixed(4),
      camera.quaternion.y.toFixed(4),
      camera.quaternion.z.toFixed(4),
      camera.quaternion.w.toFixed(4),
      camera.projectionMatrix.elements.map(value => value.toFixed(4)).join(','),
    ].join('|');
  }

  function temporalControlSignature(snapshot = controlsSnapshot) {
    return [
      snapshot.density,
      snapshot.fire,
      snapshot.radiance,
      snapshot.absorption,
      snapshot.glow,
      snapshot.smoke,
      snapshot.curl,
      snapshot.microdetail,
      snapshot.interfaceShred,
      snapshot.fireLicks,
      snapshot.projection,
      snapshot.speed,
      snapshot.raySteps,
      snapshot.adaptiveRays,
      snapshot.occupancySkip,
      snapshot.majorantSkip,
      snapshot.majorantSmooth,
      snapshot.majorantGuard,
      snapshot.renderScale,
      snapshot.fireScale,
      snapshot.detailScale,
      snapshot.plumeHeight,
      snapshot.windStrength,
      snapshot.windAngle,
      snapshot.windHeight,
      snapshot.inputRadius,
      snapshot.flowRate,
      snapshot.resolution,
      snapshot.majorantGrid,
      snapshot.gridOverlay,
      snapshot.flowDebug,
      normalizeVolumeScene(snapshot.volumeScene),
      snapshot.rayBudgetPreset || '',
    ].map(value => Number.isFinite(value) ? Number(value).toFixed(4) : String(value ?? '')).join('|');
  }

  function maybeResetTemporalHistoryForCamera() {
    const signature = temporalCameraSignature();
    if (lastTemporalCameraSignature && lastTemporalCameraSignature !== signature) {
      resetTemporalHistory('camera-change');
    }
    lastTemporalCameraSignature = signature;
  }

  function rebuildFluidBindGroups() {
    if (!device || !bindGroupLayout || !uniformBuffer || !externalEmitterBuffer || fluidBuffers.length !== 2 || !majorantBuffer || !historyTexture || !historySampler) return;
    bindGroups = [
      device.createBindGroup({
        label: `kaminos fluid bind group ${gridSize}^3 A to B`,
        layout: bindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: uniformBuffer } },
          { binding: 1, resource: { buffer: fluidBuffers[0] } },
          { binding: 2, resource: { buffer: fluidBuffers[1] } },
          { binding: 3, resource: { buffer: majorantBuffer } },
          { binding: 4, resource: historyTexture.createView() },
          { binding: 5, resource: historySampler },
          { binding: 6, resource: { buffer: externalEmitterBuffer } },
        ],
      }),
      device.createBindGroup({
        label: `kaminos fluid bind group ${gridSize}^3 B to A`,
        layout: bindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: uniformBuffer } },
          { binding: 1, resource: { buffer: fluidBuffers[1] } },
          { binding: 2, resource: { buffer: fluidBuffers[0] } },
          { binding: 3, resource: { buffer: majorantBuffer } },
          { binding: 4, resource: historyTexture.createView() },
          { binding: 5, resource: historySampler },
          { binding: 6, resource: { buffer: externalEmitterBuffer } },
        ],
      }),
    ];
  }

  function ensureMajorantBuffer() {
    if (majorantBuffer) return;
    majorantBuffer = device.createBuffer({
      label: `kaminos coarse majorant field ${majorantGridSize}^3`,
      size: majorantBufferBytes(majorantGridSize),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(majorantBuffer, 0, new Float32Array(majorantGridSize * majorantGridSize * majorantGridSize * 4));
    majorantWriteBindGroup = device.createBindGroup({
      label: `kaminos coarse majorant write bind group ${majorantGridSize}^3`,
      layout: majorantWriteBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: majorantBuffer } },
      ],
    });
  }

  function rebuildFluidState(nextGridSize = gridSize, nextMajorantGridSize = majorantGridSize) {
    gridSize = normalizeGridSize(nextGridSize);
    majorantGridSize = normalizeMajorantGridSize(nextMajorantGridSize);
    destroyFluidState();
    destroyMajorantState();
    ensureMajorantBuffer();
    const nextBufferBytes = fluidBufferBytes(gridSize);
    const initialFluid = makeInitialFluid(gridSize);
    fluidBuffers = [0, 1].map(i => {
      const buffer = device.createBuffer({
        label: `kaminos fluid state ${gridSize}^3 ${i}`,
        size: nextBufferBytes,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
      });
      device.queue.writeBuffer(buffer, 0, initialFluid);
      return buffer;
    });
    const renderPipelineConstants = { GRID: gridSize, MAJORANT_GRID: majorantGridSize };
    const computePipelineConstants = { GRID: gridSize };
    const majorantPipelineConstants = { GRID: gridSize, MAJORANT_GRID: majorantGridSize };
    const makePipeline = (targetFormat, label) => device.createRenderPipeline({
      label,
      layout: pipelineLayout,
      vertex: { module: shader, entryPoint: 'vs' },
      fragment: { module: shader, entryPoint: 'fs', constants: renderPipelineConstants, targets: [{ format: targetFormat }] },
      primitive: { topology: 'triangle-list' },
    });
    pipeline = makePipeline(format, `kaminos volume canvas native-3d-compute-fluid-raymarch-v0 ${gridSize}^3`);
    readbackPipeline = makePipeline('rgba8unorm', `kaminos volume readback native-3d-compute-fluid-raymarch-v0 ${gridSize}^3`);
    computePipeline = device.createComputePipeline({
      label: `kaminos first fluid sim compute pipeline ${gridSize}^3`,
      layout: pipelineLayout,
      compute: { module: shader, entryPoint: 'cs', constants: computePipelineConstants },
    });
    majorantComputePipeline = device.createComputePipeline({
      label: `kaminos coarse majorant compute pipeline ${gridSize}^3 to ${majorantGridSize}^3`,
      layout: majorantPipelineLayout,
      compute: { module: shader, entryPoint: 'csMajorant', constants: majorantPipelineConstants },
    });
    ensureTemporalHistoryTexture();
    rebuildFluidBindGroups();
    majorantFluidBindGroups = [
      device.createBindGroup({
        label: `kaminos majorant fluid-read bind group ${gridSize}^3 A`,
        layout: majorantFluidBindGroupLayout,
        entries: [
          { binding: 1, resource: { buffer: fluidBuffers[0] } },
        ],
      }),
      device.createBindGroup({
        label: `kaminos majorant fluid-read bind group ${gridSize}^3 B`,
        layout: majorantFluidBindGroupLayout,
        entries: [
          { binding: 1, resource: { buffer: fluidBuffers[1] } },
        ],
      }),
    ];
    currentFluid = 0;
    state.simStepCount = 0;
    state.simGrid = gridSize;
    state.simGridLabel = `${gridSize}^3 velocity-material-fire-microdetail-storage-buffer`;
    state.majorantGrid = majorantGridSize;
    state.majorantBuilt = false;
    state.majorantFrameCount = 0;
    resetTemporalHistory('grid-rebuilt');
    emitStatus({ phase: 'grid-rebuilt' });
  }

  async function ensureGpu() {
    if (device) return;
    if (!navigator.gpu) {
      throw new Error('WebGPU unavailable');
    }
    adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('WebGPU adapter unavailable');
    const maxRequestedFluidBufferBytes = fluidBufferBytes(Math.max(...SUPPORTED_GRID_SIZES));
    const requiredLimits = {};
    if ((adapter.limits?.maxStorageBufferBindingSize ?? 0) >= maxRequestedFluidBufferBytes) {
      requiredLimits.maxStorageBufferBindingSize = maxRequestedFluidBufferBytes;
    }
    device = await adapter.requestDevice(Object.keys(requiredLimits).length ? { requiredLimits } : undefined);
    context = canvas.getContext('webgpu');
    format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({
      device,
      format,
      alphaMode: 'opaque',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    device.addEventListener('uncapturederror', event => {
      state.error = event.error?.message || String(event.error || 'WebGPU uncaptured error');
      emitStatus({ phase: 'gpu-error', error: state.error });
    });
    uniformBuffer = device.createBuffer({
      label: 'kaminos fluid uniforms',
      size: uniforms.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    ensureExternalEmitterBuffer();
    historySampler = device.createSampler({
      label: 'kaminos temporal history sampler',
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });
    shader = device.createShaderModule({ label: 'kaminos compute fluid raymarch wgsl', code: WGSL });
    const compilationInfo = await shader.getCompilationInfo();
    const compilationErrors = compilationInfo.messages.filter(message => message.type === 'error');
    if (compilationErrors.length > 0) {
      const detail = compilationErrors
        .map(message => `${message.lineNum}:${message.linePos} ${message.message}`)
        .join('\n');
      throw new Error(`WGSL compilation failed:\n${detail}`);
    }
    bindGroupLayout = device.createBindGroupLayout({
      label: 'kaminos fluid bind group layout',
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
          buffer: { type: 'uniform' },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
          buffer: { type: 'read-only-storage' },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'storage' },
        },
        {
          binding: 3,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: 'read-only-storage' },
        },
        {
          binding: 4,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'float' },
        },
        {
          binding: 5,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: { type: 'filtering' },
        },
        {
          binding: 6,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'read-only-storage' },
        },
      ],
    });
    majorantFluidBindGroupLayout = device.createBindGroupLayout({
      label: 'kaminos majorant fluid-read bind group layout',
      entries: [
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'read-only-storage' },
        },
      ],
    });
    majorantWriteBindGroupLayout = device.createBindGroupLayout({
      label: 'kaminos majorant write bind group layout',
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'storage' },
        },
      ],
    });
    pipelineLayout = device.createPipelineLayout({
      label: 'kaminos fluid pipeline layout',
      bindGroupLayouts: [bindGroupLayout],
    });
    majorantPipelineLayout = device.createPipelineLayout({
      label: 'kaminos coarse majorant pipeline layout',
      bindGroupLayouts: [majorantFluidBindGroupLayout, majorantWriteBindGroupLayout],
    });
    device.pushErrorScope('validation');
    rebuildFluidState(controlsSnapshot.resolution, controlsSnapshot.majorantGrid);
    const pipelineError = await device.popErrorScope();
    if (pipelineError) {
      throw new Error(`fluid pipeline validation: ${pipelineError.message || String(pipelineError)}`);
    }
    state.backend = `WebGPU:${adapter.info?.vendor || 'adapter'}`;
    emitStatus({ phase: 'gpu-ready' });
  }

  function resize() {
    const rect = viewport.getBoundingClientRect();
    const dpr = 1;
    const displayWidth = Math.max(1, Math.floor(rect.width * dpr));
    const displayHeight = Math.max(1, Math.floor(rect.height * dpr));
    const renderScale = normalizeRenderScale(controlsSnapshot.renderScale);
    const renderWidth = Math.max(1, Math.floor(displayWidth * renderScale));
    const renderHeight = Math.max(1, Math.floor(displayHeight * renderScale));
    if (state.renderScale !== renderScale) {
      resetTemporalHistory('render-scale-change');
    }
    if (canvas.width !== renderWidth || canvas.height !== renderHeight || state.displayWidth !== displayWidth || state.displayHeight !== displayHeight) {
      canvas.width = renderWidth;
      canvas.height = renderHeight;
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      state.width = renderWidth;
      state.height = renderHeight;
      state.displayWidth = displayWidth;
      state.displayHeight = displayHeight;
      state.renderWidth = renderWidth;
      state.renderHeight = renderHeight;
      state.renderScale = renderScale;
      state.renderPixelRatio = renderWidth / Math.max(1, displayWidth);
      state.volumeReconstructionStyle = renderScale < 0.999 ? 'linear-css-upscale' : 'native-resolution';
      canvas.style.imageRendering = 'auto';
      frameTextureSize = '';
    }
  }

  function ensureFrameTexture() {
    const key = `${state.width}x${state.height}`;
    if (frameTexture && frameTextureSize === key) return;
    frameTexture?.destroy();
    frameTexture = device.createTexture({
      label: 'kaminos volume witness frame texture',
      size: { width: state.width, height: state.height, depthOrArrayLayers: 1 },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    frameTextureSize = key;
  }

  function updateUniforms(now) {
    resize();
    camera.updateMatrixWorld();
    maybeResetTemporalHistoryForCamera();
    ensureTemporalHistoryTexture();
    viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    invViewProj.copy(viewProj).invert();
    if (!previousViewProjReady) {
      previousViewProj.copy(viewProj);
      previousViewProjReady = true;
    }
    uniforms.set(invViewProj.elements, 0);
    uniforms[16] = camera.position.x;
    uniforms[17] = camera.position.y;
    uniforms[18] = camera.position.z;
    uniforms[19] = now * 0.001;
    uniforms[20] = state.width;
    uniforms[21] = state.height;
    uniforms[22] = controlsSnapshot.raySteps;
    uniforms[23] = controlsSnapshot.density;
    uniforms[24] = controlsSnapshot.fire;
    uniforms[25] = controlsSnapshot.smoke;
    uniforms[26] = controlsSnapshot.curl;
    uniforms[27] = controlsSnapshot.speed;
    uniforms[28] = controlsSnapshot.gridOverlay || 0;
    uniforms[29] = controlsSnapshot.microdetail ?? 1.55;
    uniforms[30] = controlsSnapshot.interfaceShred ?? 1.55;
    uniforms[31] = controlsSnapshot.fireLicks ?? 1.65;
    uniforms[32] = controlsSnapshot.inputRadius || 0.08;
    uniforms[33] = controlsSnapshot.flowRate ?? 0.3;
    uniforms[34] = controlsSnapshot.projection ?? 0.65;
    uniforms[35] = controlsSnapshot.flowDebug || 0;
    uniforms[36] = controlsSnapshot.radiance ?? 1.65;
    uniforms[37] = controlsSnapshot.absorption ?? 0.85;
    uniforms[38] = controlsSnapshot.glow ?? 1.15;
    uniforms[39] = controlsSnapshot.adaptiveRays ?? 0.65;
    uniforms[40] = controlsSnapshot.occupancySkip ?? 0.35;
    uniforms[41] = controlsSnapshot.majorantSkip ?? 0.70;
    uniforms[42] = controlsSnapshot.majorantSmooth ?? 0.85;
    uniforms[43] = controlsSnapshot.majorantGuard ?? 0.75;
    const requestedTemporalAccum = Math.max(0, Math.min(0.85, controlsSnapshot.temporalAccum ?? 0.25));
    uniforms[44] = historyValid ? requestedTemporalAccum : 0;
    uniforms[45] = controlsSnapshot.temporalJitter ?? 0.85;
    uniforms[46] = controlsSnapshot.historyClamp ?? 0.70;
    uniforms[47] = state.frameCount % 4096;
    uniforms[48] = controlsSnapshot.fireScale ?? 0.86;
    uniforms[49] = controlsSnapshot.detailScale ?? 1.75;
    uniforms[50] = controlsSnapshot.plumeHeight ?? 1.45;
    updateExternalEmitterDebug(now);
    uniforms[51] = state.externalEmitterCount;
    uniforms[52] = volumeSceneMode(controlsSnapshot.volumeScene);
    uniforms[53] = normalizeWindStrength(controlsSnapshot.windStrength);
    uniforms[54] = normalizeWindAngle(controlsSnapshot.windAngle) * Math.PI / 180;
    uniforms[55] = normalizeWindHeight(controlsSnapshot.windHeight);
    uniforms.set(previousViewProj.elements, 56);
    device.queue.writeBuffer(uniformBuffer, 0, uniforms);
    state.gridOverlay = controlsSnapshot.gridOverlay || 0;
    state.volumeScene = normalizeVolumeScene(controlsSnapshot.volumeScene);
    state.adaptiveRaymarch = uniforms[39];
    state.occupancySkip = uniforms[40];
    state.majorantSkip = uniforms[41];
    state.majorantSmooth = uniforms[42];
    state.majorantGuard = uniforms[43];
    state.temporalAccum = requestedTemporalAccum;
    state.temporalJitter = uniforms[45];
    state.historyClamp = uniforms[46];
    state.fireScale = Math.max(0.35, Math.min(1.3, uniforms[48]));
    state.detailScale = Math.max(0.45, Math.min(3.2, uniforms[49]));
    state.plumeHeight = Math.max(0.7, Math.min(2.2, uniforms[50]));
    state.windStrength = uniforms[53];
    state.windAngle = normalizeWindAngle(controlsSnapshot.windAngle);
    state.windHeight = uniforms[55];
    state.renderScale = normalizeRenderScale(controlsSnapshot.renderScale);
    state.renderPixelRatio = state.renderWidth / Math.max(1, state.displayWidth || state.renderWidth);
    state.temporalAccumEffective = uniforms[44];
    const temporalSettled = historyValid ? Math.min(1, Math.max(0, state.temporalHistoryFrames / 12)) : 0;
    const temporalMotionTrust = previousViewProjReady ? 1 : 0;
    const temporalReactiveEstimate = Math.min(0.82,
      0.18 * Math.max(0, Math.min(1, controlsSnapshot.majorantSkip ?? 0.70)) +
      0.12 * Math.max(0, Math.min(1, controlsSnapshot.adaptiveRays ?? 0.65)) +
      0.08 * Math.max(0, Math.min(1, (controlsSnapshot.fire ?? 1.4) / 2.2)) +
      0.06 * Math.max(0, Math.min(1, (controlsSnapshot.fireLicks ?? 1.65) / 5))
    );
    const smokeHistoryTrust = Math.max(0, Math.min(1,
      ((controlsSnapshot.smoke ?? 2.8) / 3.2) *
      (1 - Math.max(0, Math.min(1, (controlsSnapshot.fire ?? 1.4) / 2.4)) * 0.42) *
      (1 - Math.max(0, Math.min(1, (controlsSnapshot.interfaceShred ?? 2.5) / 5)) * 0.28)
    ));
    const fireHistoryProtect = Math.max(0, Math.min(1,
      (controlsSnapshot.fire ?? 1.4) / 2.2 * 0.48 +
      (controlsSnapshot.radiance ?? 1.65) / 3.0 * 0.26 +
      (controlsSnapshot.fireLicks ?? 1.65) / 5.0 * 0.26
    ));
    const interfaceHistoryProtect = Math.max(0, Math.min(1,
      (controlsSnapshot.interfaceShred ?? 2.5) / 5.0 * 0.52 +
      (controlsSnapshot.fireLicks ?? 1.65) / 5.0 * 0.24 +
      (controlsSnapshot.majorantGuard ?? 0.75) * 0.24
    ));
    const materialTemporalProtection = fireHistoryProtect * 0.46 + interfaceHistoryProtect * 0.34;
    state.temporalSmokeHistoryTrust = smokeHistoryTrust;
    state.temporalFireHistoryProtect = fireHistoryProtect;
    state.temporalInterfaceHistoryProtect = interfaceHistoryProtect;
    state.temporalEvidenceSource = 'cpu-estimate-control-proxy';
    state.temporalReprojectionConfidence = temporalSettled * temporalMotionTrust * Math.max(0, 1 - temporalReactiveEstimate - materialTemporalProtection * 0.18);
    state.temporalHistoryWeight = uniforms[44] * state.temporalReprojectionConfidence * (0.34 + smokeHistoryTrust * 0.66) * (1 - fireHistoryProtect * 0.55) * (1 - interfaceHistoryProtect * 0.36);
    state.temporalRejectedHistory = Math.max(0, Math.min(1, 1 - (state.temporalHistoryWeight / Math.max(0.0001, uniforms[44]))));
    state.temporalHistoryValid = historyValid;
  }

  function encodeSim(encoder) {
    const pass = encoder.beginComputePass({ label: 'kaminos fluid sim pass' });
    pass.setPipeline(computePipeline);
    pass.setBindGroup(0, bindGroups[currentFluid]);
    const workgroups = Math.ceil(gridSize / 4);
    pass.dispatchWorkgroups(workgroups, workgroups, workgroups);
    pass.end();
    currentFluid = 1 - currentFluid;
    state.simStepCount += 1;
  }

  function encodeMajorant(encoder) {
    const pass = encoder.beginComputePass({ label: 'kaminos coarse majorant build pass' });
    pass.setPipeline(majorantComputePipeline);
    pass.setBindGroup(0, majorantFluidBindGroups[currentFluid]);
    pass.setBindGroup(1, majorantWriteBindGroup);
    const workgroups = Math.ceil(majorantGridSize / 4);
    pass.dispatchWorkgroups(workgroups, workgroups, workgroups);
    pass.end();
    state.majorantBuilt = true;
    state.majorantFrameCount += 1;
  }

  function encodeDraw(encoder, view, label, targetPipeline = pipeline) {
    const pass = encoder.beginRenderPass({
      label,
      colorAttachments: [{
        view,
        clearValue: { r: 0.004, g: 0.005, b: 0.006, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    pass.setPipeline(targetPipeline);
    pass.setBindGroup(0, bindGroups[currentFluid]);
    pass.draw(3);
    pass.end();
  }

  function encodeHistoryCopy(encoder, sourceTexture) {
    if (!historyTexture || state.width < 1 || state.height < 1) return;
    encoder.copyTextureToTexture(
      { texture: sourceTexture },
      { texture: historyTexture },
      { width: state.width, height: state.height, depthOrArrayLayers: 1 }
    );
    historyValid = true;
    state.temporalHistoryValid = true;
    state.temporalHistoryFrames += 1;
  }

  function render(now) {
    if (!state.active) return;
    raf = requestAnimationFrame(render);
    const cpuStart = performance.now();
    controls?.update?.();
    updateUniforms(now);
    const encoder = device.createCommandEncoder({ label: 'kaminos compute fluid frame' });
    encodeSim(encoder);
    encodeMajorant(encoder);
    const currentTexture = context.getCurrentTexture();
    encodeDraw(encoder, currentTexture.createView(), 'kaminos volume canvas pass');
    encodeHistoryCopy(encoder, currentTexture);
    device.queue.submit([encoder.finish()]);
    commitPreviousViewProjection();
    state.frameCount += 1;
    state.lastFrameEnergy = Math.min(9.999, state.simStepCount * 0.001 + 0.55 * controlsSnapshot.density + 0.35 * controlsSnapshot.fire + 0.18 * (controlsSnapshot.radiance ?? 1.65));
    recordVolumeFrameTiming(now, performance.now() - cpuStart);
    if (state.frameCount % 12 === 0) probeVolumeQueueTiming();
  }

  async function sampleSimReadback() {
    const readback = device.createBuffer({
      label: 'kaminos fluid simReadback',
      size: fluidBufferBytes(gridSize),
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = device.createCommandEncoder({ label: 'kaminos fluid simReadback encoder' });
    encoder.copyBufferToBuffer(fluidBuffers[currentFluid], 0, readback, 0, fluidBufferBytes(gridSize));
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const data = new Float32Array(readback.getMappedRange());
    let densitySum = 0;
    let densityMax = 0;
    let heatSum = 0;
    let detailSum = 0;
    let fireLayerSum = 0;
    let radianceSum = 0;
    let extinctionSum = 0;
    let microdetailSum = 0;
    let interfaceShredSum = 0;
    let fireLickSum = 0;
    let velocitySum = 0;
    let curlSum = 0;
    let curlMax = 0;
    let divergenceSum = 0;
    let divergenceMax = 0;
    let liveVoxels = 0;
    const cells = gridCellCount(gridSize);
    const stride = Math.max(1, Math.floor(cells / 4096));
    const sampleCells = new Set();
    for (let cell = 0; cell < cells; cell += stride) sampleCells.add(cell);
    const addSampleCell = (x, y, z) => {
      const cx = Math.max(0, Math.min(gridSize - 1, x | 0));
      const cy = Math.max(0, Math.min(gridSize - 1, y | 0));
      const cz = Math.max(0, Math.min(gridSize - 1, z | 0));
      sampleCells.add(cx + cy * gridSize + cz * gridSize * gridSize);
    };
    const center = Math.floor(gridSize * 0.5);
    const sourceY = Math.floor(gridSize * 0.13);
    const sourceRadius = Math.max(2, Math.ceil(gridSize * Math.max(0.08, controlsSnapshot.inputRadius || 0.08) * 0.75));
    const localStep = Math.max(1, Math.floor(sourceRadius / 3));
    for (let y = sourceY - sourceRadius; y <= sourceY + sourceRadius * 6; y += localStep) {
      for (let z = center - sourceRadius; z <= center + sourceRadius; z += localStep) {
        for (let x = center - sourceRadius; x <= center + sourceRadius; x += localStep) {
          addSampleCell(x, y, z);
        }
      }
    }
    const clampIndex = value => Math.max(0, Math.min(gridSize - 1, value));
    const velocityAt = (x, y, z) => {
      const cx = clampIndex(x);
      const cy = clampIndex(y);
      const cz = clampIndex(z);
      const i = (cx + cy * gridSize + cz * gridSize * gridSize) * FLUID_COMPONENTS;
      return [data[i], data[i + 1], data[i + 2]];
    };
    let samples = 0;
    for (const cell of sampleCells) {
      const i = cell * FLUID_COMPONENTS;
      const x = cell % gridSize;
      const y = Math.floor(cell / gridSize) % gridSize;
      const z = Math.floor(cell / (gridSize * gridSize));
      const vx = data[i];
      const vy = data[i + 1];
      const vz = data[i + 2];
      const d = Math.max(data[i + 3], data[i + 4] * 0.9, data[i + 5] * 0.72);
      const smokeDensity = data[i + 4];
      const heat = data[i + 5];
      const detail = data[i + 7];
      const flame = data[i + 8];
      const ember = data[i + 9];
      const flameDetail = data[i + 10];
      const fireLayer = Math.max(flame, ember, flameDetail);
      const microdetail = data[i + 12];
      const interfaceShred = data[i + 13];
      const fireLick = data[i + 14];
      const emberFleck = data[i + 15];
      const radianceGain = controlsSnapshot.radiance ?? 1.65;
      const absorptionGain = controlsSnapshot.absorption ?? 0.85;
      const radiance = Math.max(0, flame * 1.22 + ember * 0.46 + flameDetail * 0.40 + fireLick * 1.18 + emberFleck * 0.48 + heat * 0.20) * radianceGain;
      const extinction = Math.max(0, smokeDensity * 0.74 + microdetail * 0.42 + interfaceShred * 0.34 + detail * 0.12) * (0.34 + absorptionGain * 0.46);
      densitySum += d;
      densityMax = Math.max(densityMax, d);
      heatSum += heat;
      detailSum += detail;
      fireLayerSum += fireLayer;
      radianceSum += radiance;
      extinctionSum += extinction;
      microdetailSum += microdetail;
      interfaceShredSum += interfaceShred;
      fireLickSum += fireLick;
      velocitySum += Math.hypot(vx, vy, vz);
      const vx0 = velocityAt(x - 1, y, z);
      const vx1 = velocityAt(x + 1, y, z);
      const vy0 = velocityAt(x, y - 1, z);
      const vy1 = velocityAt(x, y + 1, z);
      const vz0 = velocityAt(x, y, z - 1);
      const vz1 = velocityAt(x, y, z + 1);
      const curlX = ((vy1[2] - vy0[2]) - (vz1[1] - vz0[1])) * 0.5;
      const curlY = ((vz1[0] - vz0[0]) - (vx1[2] - vx0[2])) * 0.5;
      const curlZ = ((vx1[1] - vx0[1]) - (vy1[0] - vy0[0])) * 0.5;
      const curlMag = Math.hypot(curlX, curlY, curlZ);
      const div = Math.abs(((vx1[0] - vx0[0]) + (vy1[1] - vy0[1]) + (vz1[2] - vz0[2])) * 0.5);
      curlSum += curlMag;
      curlMax = Math.max(curlMax, curlMag);
      divergenceSum += div;
      divergenceMax = Math.max(divergenceMax, div);
      if (d > 0.02) liveVoxels += 1;
      samples += 1;
    }
    readback.unmap();
    readback.destroy();
    return {
      grid: gridSize,
      gridLabel: state.simGridLabel,
      samples,
      densityMean: densitySum / samples,
      densityMax,
      heatMean: heatSum / samples,
      detailMean: detailSum / samples,
      fireLayerMean: fireLayerSum / samples,
      radianceMean: radianceSum / samples,
      extinctionMean: extinctionSum / samples,
      microdetailMean: microdetailSum / samples,
      interfaceShredMean: interfaceShredSum / samples,
      fireLickMean: fireLickSum / samples,
      velocityMean: velocitySum / samples,
      curlMean: curlSum / samples,
      curlMax,
      divergenceMean: divergenceSum / samples,
      divergenceMax,
      liveVoxels,
    };
  }

  async function sampleMajorantReadback() {
    const readback = device.createBuffer({
      label: 'kaminos coarse majorant readback',
      size: majorantBufferBytes(majorantGridSize),
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = device.createCommandEncoder({ label: 'kaminos coarse majorant readback encoder' });
    encoder.copyBufferToBuffer(majorantBuffer, 0, readback, 0, majorantBufferBytes(majorantGridSize));
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const data = new Float32Array(readback.getMappedRange());
    let densitySum = 0;
    let radianceSum = 0;
    let extinctionSum = 0;
    let importanceSum = 0;
    let densityMax = 0;
    let radianceMax = 0;
    let extinctionMax = 0;
    let importanceMax = 0;
    let occupiedBricks = 0;
    const bricks = majorantGridSize * majorantGridSize * majorantGridSize;
    for (let i = 0; i < bricks; i += 1) {
      const offset = i * 4;
      const density = data[offset];
      const radiance = data[offset + 1];
      const extinction = data[offset + 2];
      const importance = data[offset + 3];
      densitySum += density;
      radianceSum += radiance;
      extinctionSum += extinction;
      importanceSum += importance;
      densityMax = Math.max(densityMax, density);
      radianceMax = Math.max(radianceMax, radiance);
      extinctionMax = Math.max(extinctionMax, extinction);
      importanceMax = Math.max(importanceMax, importance);
      if (importance > 0.015 || density > 0.01 || radiance > 0.01 || extinction > 0.01) occupiedBricks += 1;
    }
    readback.unmap();
    readback.destroy();
    const result = {
      grid: majorantGridSize,
      bricks,
      occupiedBricks,
      densityMean: densitySum / bricks,
      densityMax,
      radianceMean: radianceSum / bricks,
      radianceMax,
      extinctionMean: extinctionSum / bricks,
      extinctionMax,
      importanceMean: importanceSum / bricks,
      importanceMax,
    };
    state.majorantOccupiedBricks = occupiedBricks;
    state.majorantImportanceMax = importanceMax;
    return result;
  }

  async function sampleFrame() {
    if (!state.active || !device) return { ok: false, reason: 'inactive', ...state };
    updateUniforms(performance.now());
    ensureFrameTexture();
    const bytesPerPixel = 4;
    const unpaddedBytesPerRow = state.width * bytesPerPixel;
    const bytesPerRow = Math.ceil(unpaddedBytesPerRow / 256) * 256;
    const buffer = device.createBuffer({
      label: 'kaminos volume witness readback',
      size: bytesPerRow * state.height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    device.pushErrorScope('validation');
    const encoder = device.createCommandEncoder({ label: 'kaminos volume witness readback encoder' });
    encodeSim(encoder);
    encodeMajorant(encoder);
    encodeDraw(encoder, frameTexture.createView(), 'kaminos volume one-off readback pass', readbackPipeline);
    encoder.copyTextureToBuffer(
      { texture: frameTexture },
      { buffer, bytesPerRow, rowsPerImage: state.height },
      { width: state.width, height: state.height, depthOrArrayLayers: 1 }
    );
    device.queue.submit([encoder.finish()]);
    const validationError = await device.popErrorScope();
    if (validationError) {
      buffer.destroy();
      return {
        ok: false,
        reason: 'readback-validation',
        validationError: validationError.message || String(validationError),
        width: state.width,
        height: state.height,
        frameCount: state.frameCount,
        simStepCount: state.simStepCount,
        simGrid: state.simGrid,
        simGridLabel: state.simGridLabel,
        volumeScene: state.volumeScene,
        gridOverlay: state.gridOverlay,
        adaptiveRaymarch: state.adaptiveRaymarch,
        occupancySkip: state.occupancySkip,
        majorantSkip: state.majorantSkip,
        majorantSmooth: state.majorantSmooth,
        majorantGuard: state.majorantGuard,
        temporalAccum: state.temporalAccum,
        temporalJitter: state.temporalJitter,
        historyClamp: state.historyClamp,
        fireScale: state.fireScale,
        detailScale: state.detailScale,
        plumeHeight: state.plumeHeight,
        externalEmitterMode: state.externalEmitterMode,
        externalEmitterCoordinateSpace: state.externalEmitterCoordinateSpace,
        externalEmitterCount: state.externalEmitterCount,
        externalEmitterAgeMs: state.externalEmitterAgeMs,
        externalEmitterFrameId: state.externalEmitterFrameId,
        temporalAccumEffective: state.temporalAccumEffective,
        temporalReprojectionConfidence: state.temporalReprojectionConfidence,
        temporalHistoryWeight: state.temporalHistoryWeight,
        temporalRejectedHistory: state.temporalRejectedHistory,
        temporalSmokeHistoryTrust: state.temporalSmokeHistoryTrust,
        temporalFireHistoryProtect: state.temporalFireHistoryProtect,
        temporalInterfaceHistoryProtect: state.temporalInterfaceHistoryProtect,
        temporalEvidenceSource: state.temporalEvidenceSource,
        temporalHistoryFrames: state.temporalHistoryFrames,
        temporalHistoryResetCount: state.temporalHistoryResetCount,
        temporalHistoryResetReason: state.temporalHistoryResetReason,
        temporalHistoryValid: state.temporalHistoryValid,
        majorantGrid: state.majorantGrid,
        majorantBuilt: state.majorantBuilt,
        timing: { ...state.timing },
        effectiveRoute: state.effectiveRoute,
        prototypeIdentity: state.prototypeIdentity,
        backend: state.backend,
      };
    }
    await buffer.mapAsync(GPUMapMode.READ);
    const data = new Uint8Array(buffer.getMappedRange());
    let litPixels = 0;
    let fireLikePixels = 0;
    let emissiveLikePixels = 0;
    let smokeLikePixels = 0;
    let totalLuma = 0;
    let samples = 0;
    const volumeBounds = {
      minX: state.width,
      minY: state.height,
      maxX: -1,
      maxY: -1,
      pixelCount: 0,
      width: 0,
      height: 0,
      horizontalFillRatio: 0,
      verticalFillRatio: 0,
      sumX: 0,
      sumY: 0,
      centerX: 0,
      centerY: 0,
      normalizedCenterX: 0,
      normalizedCenterY: 0,
      screenDriftX: 0,
      screenDriftY: 0,
    };
    const fireBounds = { ...volumeBounds };
    const smokeBounds = { ...volumeBounds };
    const includeBoundPixel = (bounds, x, y) => {
      bounds.minX = Math.min(bounds.minX, x);
      bounds.minY = Math.min(bounds.minY, y);
      bounds.maxX = Math.max(bounds.maxX, x);
      bounds.maxY = Math.max(bounds.maxY, y);
      bounds.pixelCount += 1;
      bounds.sumX += x;
      bounds.sumY += y;
    };
    const finalizeBounds = bounds => {
      if (bounds.pixelCount > 0) {
        bounds.width = bounds.maxX - bounds.minX + 1;
        bounds.height = bounds.maxY - bounds.minY + 1;
        bounds.horizontalFillRatio = bounds.width / Math.max(1, state.width);
        bounds.verticalFillRatio = bounds.height / Math.max(1, state.height);
        bounds.centerX = bounds.sumX / bounds.pixelCount;
        bounds.centerY = bounds.sumY / bounds.pixelCount;
        bounds.normalizedCenterX = (bounds.centerX / Math.max(1, state.width - 1)) * 2 - 1;
        bounds.normalizedCenterY = (bounds.centerY / Math.max(1, state.height - 1)) * 2 - 1;
        bounds.screenDriftX = bounds.normalizedCenterX;
        bounds.screenDriftY = bounds.normalizedCenterY;
      } else {
        bounds.minX = 0;
        bounds.minY = 0;
        bounds.maxX = 0;
        bounds.maxY = 0;
        bounds.sumX = 0;
        bounds.sumY = 0;
        bounds.centerX = 0;
        bounds.centerY = 0;
        bounds.normalizedCenterX = 0;
        bounds.normalizedCenterY = 0;
        bounds.screenDriftX = 0;
        bounds.screenDriftY = 0;
      }
    };
    const previewWidth = 256;
    const previewHeight = Math.max(1, Math.round(previewWidth * state.height / state.width));
    const preview = new Uint8Array(previewWidth * previewHeight * 4);
    for (let y = Math.floor(state.height * 0.08); y < Math.floor(state.height * 0.92); y += 2) {
      const row = y * bytesPerRow;
      for (let x = Math.floor(state.width * 0.08); x < Math.floor(state.width * 0.92); x += 2) {
        const i = row + x * bytesPerPixel;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        totalLuma += luma;
        samples += 1;
        if (luma > 20) {
          litPixels += 1;
          includeBoundPixel(volumeBounds, x, y);
        }
        if (r > 120 && g > 70 && b < 90) {
          fireLikePixels += 1;
          includeBoundPixel(fireBounds, x, y);
        }
        if (r > 170 && g > 120 && b < 115 && luma > 130) {
          emissiveLikePixels += 1;
          includeBoundPixel(fireBounds, x, y);
        }
        if (b > 28 && g > 28 && r < 105 && Math.abs(g - b) < 60) {
          smokeLikePixels += 1;
          includeBoundPixel(volumeBounds, x, y);
          includeBoundPixel(smokeBounds, x, y);
        }
      }
    }
    finalizeBounds(volumeBounds);
    finalizeBounds(fireBounds);
    finalizeBounds(smokeBounds);
    for (let py = 0; py < previewHeight; py += 1) {
      const srcY = Math.min(state.height - 1, Math.floor(py / previewHeight * state.height));
      const row = srcY * bytesPerRow;
      for (let px = 0; px < previewWidth; px += 1) {
        const srcX = Math.min(state.width - 1, Math.floor(px / previewWidth * state.width));
        const src = row + srcX * bytesPerPixel;
        const dst = (py * previewWidth + px) * 4;
        preview[dst] = data[src];
        preview[dst + 1] = data[src + 1];
        preview[dst + 2] = data[src + 2];
        preview[dst + 3] = 255;
      }
    }
    buffer.unmap();
    buffer.destroy();
    const simReadback = await sampleSimReadback();
    const majorantReadback = await sampleMajorantReadback();
    return {
      ok: true,
      width: state.width,
      height: state.height,
      displayWidth: state.displayWidth,
      displayHeight: state.displayHeight,
      renderWidth: state.renderWidth,
      renderHeight: state.renderHeight,
      renderScale: state.renderScale,
      renderPixelRatio: state.renderPixelRatio,
      volumeReconstructionStyle: state.volumeReconstructionStyle,
      volumeScene: state.volumeScene,
      meanLuma: totalLuma / Math.max(1, samples),
      litPixels,
      fireLikePixels,
      emissiveLikePixels,
      smokeLikePixels,
      volumeBounds,
      fireBounds,
      smokeBounds,
      frameCount: state.frameCount,
      simStepCount: state.simStepCount,
      simGrid: state.simGrid,
      simGridLabel: state.simGridLabel,
      gridOverlay: state.gridOverlay,
      adaptiveRaymarch: state.adaptiveRaymarch,
      occupancySkip: state.occupancySkip,
      majorantSkip: state.majorantSkip,
      majorantSmooth: state.majorantSmooth,
      majorantGuard: state.majorantGuard,
      temporalAccum: state.temporalAccum,
      temporalJitter: state.temporalJitter,
      historyClamp: state.historyClamp,
      fireScale: state.fireScale,
      detailScale: state.detailScale,
      plumeHeight: state.plumeHeight,
      windStrength: state.windStrength,
      windAngle: state.windAngle,
      windHeight: state.windHeight,
      renderScale: state.renderScale,
      renderPixelRatio: state.renderPixelRatio,
      displayWidth: state.displayWidth,
      displayHeight: state.displayHeight,
      renderWidth: state.renderWidth,
      renderHeight: state.renderHeight,
      volumeReconstructionStyle: state.volumeReconstructionStyle,
      volumeScene: state.volumeScene,
      externalEmitterMode: state.externalEmitterMode,
      externalEmitterCoordinateSpace: state.externalEmitterCoordinateSpace,
      externalEmitterCount: state.externalEmitterCount,
      externalEmitterAgeMs: state.externalEmitterAgeMs,
      externalEmitterFrameId: state.externalEmitterFrameId,
      temporalAccumEffective: state.temporalAccumEffective,
      temporalReprojectionConfidence: state.temporalReprojectionConfidence,
      temporalHistoryWeight: state.temporalHistoryWeight,
      temporalRejectedHistory: state.temporalRejectedHistory,
      temporalSmokeHistoryTrust: state.temporalSmokeHistoryTrust,
      temporalFireHistoryProtect: state.temporalFireHistoryProtect,
      temporalInterfaceHistoryProtect: state.temporalInterfaceHistoryProtect,
      temporalEvidenceSource: state.temporalEvidenceSource,
      temporalHistoryFrames: state.temporalHistoryFrames,
      temporalHistoryResetCount: state.temporalHistoryResetCount,
      temporalHistoryResetReason: state.temporalHistoryResetReason,
      temporalHistoryValid: state.temporalHistoryValid,
      majorantGrid: state.majorantGrid,
      majorantBuilt: state.majorantBuilt,
      timing: { ...state.timing },
      simReadback,
      majorantReadback,
      effectiveRoute: state.effectiveRoute,
      prototypeIdentity: state.prototypeIdentity,
      backend: state.backend,
      preview: {
        width: previewWidth,
        height: previewHeight,
        rgba: Array.from(preview),
      },
    };
  }

  return {
    setControls(next) {
      const previousGrid = gridSize;
      const previousMajorantGrid = majorantGridSize;
      const previousControlSignature = lastTemporalControlSignature || temporalControlSignature(controlsSnapshot);
      controlsSnapshot = { ...controlsSnapshot, ...next };
      const nextControlSignature = temporalControlSignature(controlsSnapshot);
      if (previousControlSignature !== nextControlSignature) {
        resetTemporalHistory('control-change');
      }
      lastTemporalControlSignature = nextControlSignature;
      const requestedGrid = normalizeGridSize(controlsSnapshot.resolution);
      const requestedMajorantGrid = normalizeMajorantGridSize(controlsSnapshot.majorantGrid);
      if (device && (requestedGrid !== previousGrid || requestedMajorantGrid !== previousMajorantGrid)) {
        rebuildFluidState(requestedGrid, requestedMajorantGrid);
      } else {
        gridSize = requestedGrid;
        majorantGridSize = requestedMajorantGrid;
        state.simGrid = gridSize;
        state.simGridLabel = `${gridSize}^3 velocity-material-fire-microdetail-storage-buffer`;
        state.majorantGrid = majorantGridSize;
      }
      state.gridOverlay = controlsSnapshot.gridOverlay || 0;
      state.volumeScene = normalizeVolumeScene(controlsSnapshot.volumeScene);
      state.adaptiveRaymarch = controlsSnapshot.adaptiveRays ?? 0.65;
      state.occupancySkip = controlsSnapshot.occupancySkip ?? 0.35;
      state.majorantSkip = controlsSnapshot.majorantSkip ?? 0.70;
      state.majorantSmooth = controlsSnapshot.majorantSmooth ?? 0.85;
      state.majorantGuard = controlsSnapshot.majorantGuard ?? 0.75;
      state.temporalAccum = Math.max(0, Math.min(0.85, controlsSnapshot.temporalAccum ?? 0.25));
      state.temporalJitter = controlsSnapshot.temporalJitter ?? 0.85;
      state.historyClamp = controlsSnapshot.historyClamp ?? 0.70;
      state.fireScale = Math.max(0.35, Math.min(1.3, controlsSnapshot.fireScale ?? 0.86));
      state.detailScale = Math.max(0.45, Math.min(3.2, controlsSnapshot.detailScale ?? 1.75));
      state.plumeHeight = Math.max(0.7, Math.min(2.2, controlsSnapshot.plumeHeight ?? 1.45));
      state.windStrength = normalizeWindStrength(controlsSnapshot.windStrength);
      state.windAngle = normalizeWindAngle(controlsSnapshot.windAngle);
      state.windHeight = normalizeWindHeight(controlsSnapshot.windHeight);
      state.renderScale = normalizeRenderScale(controlsSnapshot.renderScale);
      state.renderPixelRatio = state.renderWidth / Math.max(1, state.displayWidth || state.renderWidth || 1);
      state.majorantGrid = majorantGridSize;
    },
    setExternalEmitters(payload = {}) {
      externalEmitterState = normalizeExternalEmitters(payload);
      updateExternalEmitterDebug();
      writeExternalEmitterBuffer();
      emitStatus({ phase: 'external-emitters' });
      return {
        mode: state.externalEmitterMode,
        coordinateSpace: state.externalEmitterCoordinateSpace,
        count: state.externalEmitterCount,
        ageMs: state.externalEmitterAgeMs,
        frameId: state.externalEmitterFrameId,
      };
    },
    syntheticHandTrailEmitters,
    async setActive(active) {
      if (active) {
        try {
          await ensureGpu();
          state.active = true;
          state.error = null;
          canvas.classList.add('active');
          cancelAnimationFrame(raf);
          raf = requestAnimationFrame(render);
          emitStatus({ phase: 'active' });
        } catch (err) {
          state.active = false;
          state.error = err?.message || String(err);
          state.backend = 'unavailable';
          canvas.classList.remove('active');
          emitStatus({ phase: 'error', error: state.error });
          throw err;
        }
      } else {
        state.active = false;
        canvas.classList.remove('active');
        cancelAnimationFrame(raf);
        emitStatus({ phase: 'inactive' });
      }
    },
    debugState() {
      return { ...state, controls: { ...controlsSnapshot } };
    },
    sampleFrame,
    dispose() {
      this.setActive(false);
      frameTexture?.destroy();
      externalEmitterBuffer?.destroy();
      destroyTemporalHistory();
      destroyFluidState();
      destroyMajorantState();
      canvas.remove();
    },
  };
}
