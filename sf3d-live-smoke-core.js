export const SF3D_LIVE_SMOKE_ROUTE_ID = 'sf3d.image-to-mesh.webgpu-local.v0';
export const SF3D_LIVE_SMOKE_SOURCE_REVISION = 'f977b50fb21815f955a04a1c3a392b3a44060561';
export const SF3D_LIVE_SMOKE_CANONICAL_GLB_SHA256 = 'e1f70de3407df24d571bf68f70fac2b59373bdd948075a2387f1834e4faff8b7';
export const SF3D_LIVE_SMOKE_GPU_TOPOLOGY = 'same-page-dual-device-shared-physical-gpu';
export const SF3D_LIVE_SMOKE_SHARED_GPU_TOPOLOGY = 'same-page-shared-device-shared-queue';

export const SF3D_LIVE_SMOKE_OPTIONS = Object.freeze({
  cooperativeDino: false,
  cooperativeBake: true,
  bakeSchedulingMode: 'cooperative',
  bakeBatchTexels: 4096,
  decoderArena: true,
  materializeWorker: true,
});

export function resolveSf3dGpuTopologyRequest(params) {
  const requested = params?.get?.('sf3d_gpu_topology');
  if (requested == null || requested === '' || requested === 'dual-device') {
    return SF3D_LIVE_SMOKE_GPU_TOPOLOGY;
  }
  if (requested === 'shared-device') return SF3D_LIVE_SMOKE_SHARED_GPU_TOPOLOGY;
  throw new Error(`Unsupported SF3D GPU topology: ${requested}`);
}

export function resolveSf3dRenderTargetFps(params, requestedTopology) {
  if (
    requestedTopology !== SF3D_LIVE_SMOKE_GPU_TOPOLOGY
    && requestedTopology !== SF3D_LIVE_SMOKE_SHARED_GPU_TOPOLOGY
  ) {
    throw new Error(`Unsupported SF3D GPU topology: ${requestedTopology || 'missing'}`);
  }
  const raw = params?.get?.('sf3d_render_fps');
  if (raw == null || raw === '') return null;
  const targetFps = Number(raw);
  if (!Number.isFinite(targetFps) || targetFps <= 0) {
    throw new Error('SF3D render target FPS must be a positive finite number');
  }
  return targetFps;
}

export function createSf3dRenderCadenceGate({ targetFps }) {
  if (targetFps != null && (!Number.isFinite(targetFps) || targetFps <= 0)) {
    throw new Error('SF3D render target FPS must be a positive finite number');
  }
  const targetFrameMs = targetFps == null ? null : 1000 / targetFps;
  let lastAdmittedAt = null;
  let admittedFrames = 0;
  let skippedFrames = 0;
  return Object.freeze({
    shouldRender(now, { inferenceActive = false } = {}) {
      if (!Number.isFinite(now)) throw new Error('SF3D render cadence timestamp must be finite');
      if (
        inferenceActive
        && targetFrameMs != null
        && lastAdmittedAt != null
        && now - lastAdmittedAt < targetFrameMs
      ) {
        skippedFrames++;
        return false;
      }
      lastAdmittedAt = now;
      admittedFrames++;
      return true;
    },
    snapshot() {
      return Object.freeze({
        targetFps,
        targetFrameMs,
        authority: targetFps == null ? 'unthrottled-rAF-admission' : 'caller-owned-rAF-admission',
        admittedFrames,
        skippedFrames,
      });
    },
  });
}

export function createSf3dRendererOptions({
  requestedTopology,
  inferenceDevice,
}) {
  if (requestedTopology === SF3D_LIVE_SMOKE_GPU_TOPOLOGY) {
    return { antialias: true };
  }
  if (requestedTopology !== SF3D_LIVE_SMOKE_SHARED_GPU_TOPOLOGY) {
    throw new Error(`Unsupported SF3D GPU topology: ${requestedTopology || 'missing'}`);
  }
  if (!inferenceDevice?.queue) {
    throw new Error('Shared-device SF3D rendering requires the prepared SF3D GPUDevice');
  }
  return { antialias: true, device: inferenceDevice };
}

export function createSf3dGpuTopologyReceipt({
  requestedTopology,
  inferenceDevice,
  rendererDevice,
}) {
  if (
    requestedTopology !== SF3D_LIVE_SMOKE_GPU_TOPOLOGY
    && requestedTopology !== SF3D_LIVE_SMOKE_SHARED_GPU_TOPOLOGY
  ) {
    throw new Error(`Unsupported SF3D GPU topology: ${requestedTopology || 'missing'}`);
  }
  if (!inferenceDevice?.queue || !rendererDevice?.queue) {
    throw new Error('SF3D topology verification requires both initialized GPUDevices');
  }
  const sameDevice = inferenceDevice === rendererDevice;
  const sameQueue = inferenceDevice.queue === rendererDevice.queue;
  if (requestedTopology === SF3D_LIVE_SMOKE_SHARED_GPU_TOPOLOGY && (!sameDevice || !sameQueue)) {
    throw new Error('Requested shared GPUDevice topology did not initialize with exact device and queue identity');
  }
  return Object.freeze({
    requested: requestedTopology,
    effective: sameDevice && sameQueue
      ? SF3D_LIVE_SMOKE_SHARED_GPU_TOPOLOGY
      : SF3D_LIVE_SMOKE_GPU_TOPOLOGY,
    sameDevice,
    sameQueue,
    authority: 'exact-browser-object-identity',
  });
}

export function canFireSf3dLiveSmoke({ running, deviceLost, attempted = false }) {
  return running !== true && deviceLost !== true && attempted !== true;
}

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`);
  return value.trim();
}

export function validateSf3dLiveSmokeConfig(value) {
  if (!value || typeof value !== 'object') throw new Error('SF3D live smoke config is missing');
  if (value.ok !== true) throw new Error(value.error || 'SF3D live smoke config is not executable');
  if (value.schema !== 'kaminos.sf3d-live-smoke-config.v0') throw new Error('SF3D live smoke config schema mismatch');
  if (value.routeId !== SF3D_LIVE_SMOKE_ROUTE_ID) throw new Error(`SF3D route identity mismatch: ${value.routeId || 'missing'}`);
  if (value.requestedRevision !== SF3D_LIVE_SMOKE_SOURCE_REVISION) {
    throw new Error(`SF3D requested revision mismatch: ${value.requestedRevision || 'missing'}`);
  }
  if (value.effectiveRevision !== value.requestedRevision) {
    throw new Error(`SF3D effective revision mismatch: ${value.effectiveRevision || 'missing'}`);
  }
  if (value.clean !== true) throw new Error('SF3D live smoke requires a clean source checkout');
  const origin = new URL(requiredString(value.origin, 'SF3D origin'));
  if (!['127.0.0.1', 'localhost'].includes(origin.hostname) || origin.protocol !== 'http:') {
    throw new Error(`SF3D origin must be local HTTP, got ${origin.href}`);
  }
  return Object.freeze({ ...value, origin: origin.origin });
}

const PHASE_PROGRESS = [
  [/^Preprocessing image/i, 2, 'Image preprocessing'],
  [/^Computing camera embedding/i, 4, 'Camera embedding'],
  [/^Running DINOv2 backbone/i, 8, 'DINOv2 backbone'],
  [/^Running two-stream backbone/i, 42, 'Two-stream backbone'],
  [/^Running post-processor/i, 60, 'Post-processor'],
  [/^Querying triplane and decoding/i, 67, 'Triplane decode'],
  [/^Loaded tet grid/i, 72, 'Tet grid loaded'],
  [/^Reading back SDF/i, 74, 'SDF readback'],
  [/^Extracting mesh/i, 78, 'Mesh extraction'],
  [/^Mesh extracted/i, 82, 'Mesh extracted'],
];

export function progressFromSf3dMessage(message) {
  const text = String(message || '').trim();
  const dino = text.match(/^DINOv2 blocks\s+(\d+)\/(\d+)/i);
  if (dino) {
    const completed = Number(dino[1]);
    const total = Number(dino[2]);
    const fraction = total > 0 ? Math.min(1, completed / total) : 0;
    return { percent: Math.round(8 + fraction * 18), label: `DINOv2 blocks ${completed} / ${total}` };
  }
  const texture = text.match(/^Texture bake\s+(\d+)\/(\d+)/i);
  if (texture) {
    const completed = Number(texture[1]);
    const total = Number(texture[2]);
    const fraction = total > 0 ? Math.min(1, completed / total) : 0;
    return { percent: Math.round(88 + fraction * 8), label: `Texture bake ${completed} / ${total}` };
  }
  for (const [pattern, percent, label] of PHASE_PROGRESS) {
    if (pattern.test(text)) return { percent, label };
  }
  return { percent: null, label: text || 'Running SF3D' };
}

function percentile(sorted, quantile) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)];
}

export function summarizeSf3dFrameGaps(frameGaps) {
  const sorted = [...frameGaps].filter(Number.isFinite).sort((a, b) => a - b);
  return Object.freeze({
    samples: sorted.length,
    p95Ms: percentile(sorted, 0.95),
    p99Ms: percentile(sorted, 0.99),
    maxMs: sorted.at(-1) || 0,
    thresholdCounts: Object.freeze({
      over50Ms: sorted.filter(value => value >= 50).length,
      over100Ms: sorted.filter(value => value >= 100).length,
      over250Ms: sorted.filter(value => value >= 250).length,
    }),
  });
}

export function frameGapsWithinStage(frameTimes, stage) {
  if (!stage || !Number.isFinite(stage.start) || !Number.isFinite(stage.end)) return [];
  const gaps = [];
  for (let index = 1; index < frameTimes.length; index++) {
    const start = frameTimes[index - 1];
    const end = frameTimes[index];
    const midpoint = (start + end) / 2;
    if (midpoint >= stage.start && midpoint < stage.end) gaps.push(end - start);
  }
  return gaps;
}

function requiredSha256(value, label) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value)) {
    throw new Error(`${label} must be a SHA-256`);
  }
  return value.toLowerCase();
}

function normalizeEvidenceValue(value, path, seen, warnings) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return value;
    warnings.push({ kind: 'non-finite-number', path, value: String(value) });
    return { evidenceType: 'non-finite-number', value: String(value) };
  }
  if (typeof value === 'bigint') {
    warnings.push({ kind: 'bigint', path });
    return { evidenceType: 'bigint', value: value.toString() };
  }
  if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') {
    const kind = `unsupported-${typeof value}`;
    warnings.push({ kind, path });
    return { evidenceType: kind };
  }
  if (value instanceof ArrayBuffer) {
    warnings.push({ kind: 'array-buffer', path, byteLength: value.byteLength });
    return {
      evidenceType: 'array-buffer',
      byteLength: value.byteLength,
      binaryPayloadOmitted: true,
    };
  }
  if (ArrayBuffer.isView(value)) {
    const constructor = value.constructor?.name || 'TypedArray';
    warnings.push({ kind: 'typed-array', path, constructor, byteLength: value.byteLength });
    return {
      evidenceType: 'typed-array',
      constructor,
      length: Number.isFinite(value.length) ? value.length : null,
      byteLength: value.byteLength,
      binaryPayloadOmitted: true,
    };
  }
  if (seen.has(value)) {
    const refPath = seen.get(value);
    warnings.push({ kind: 'circular-reference', path, refPath });
    return { evidenceType: 'circular-reference', refPath };
  }
  seen.set(value, path);
  if (Array.isArray(value)) {
    return value.map((entry, index) => (
      normalizeEvidenceValue(entry, `${path}[${index}]`, seen, warnings)
    ));
  }
  if (value instanceof Error) {
    return {
      evidenceType: 'error',
      name: value.name,
      message: value.message,
    };
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    const constructor = value.constructor?.name || 'non-plain-object';
    warnings.push({ kind: 'non-plain-object', path, constructor });
    return {
      evidenceType: 'non-plain-object',
      constructor,
      objectPayloadOmitted: true,
    };
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      normalizeEvidenceValue(entry, `${path}.${key}`, seen, warnings),
    ]),
  );
}

function normalizeEvidence(value, label) {
  const warnings = [];
  const normalized = normalizeEvidenceValue(value, label, new WeakMap(), warnings);
  return { normalized, warnings };
}

export function freezeSf3dRouteEvidence({
  startedAt,
  completedAt,
  frameTimes,
  frameCpuTimes,
}) {
  if (!Number.isFinite(startedAt) || !Number.isFinite(completedAt) || completedAt < startedAt) {
    throw new Error('SF3D route timestamps must be finite and ordered');
  }
  if (!Array.isArray(frameTimes) || !Array.isArray(frameCpuTimes)) {
    throw new Error('SF3D route frame evidence must be arrays');
  }
  return Object.freeze({
    routeWallMs: completedAt - startedAt,
    frameTimes: Object.freeze([...frameTimes]),
    frameCpuTimes: Object.freeze([...frameCpuTimes]),
  });
}

export function buildSf3dCompletedOutputReceipt({
  output,
  outputSha256,
  expectedSha256,
  routeWallMs,
  frameTimes,
  frameCpuTimes,
}) {
  if (!(output?.glb instanceof ArrayBuffer)) {
    throw new Error('SF3D completed output GLB must be an ArrayBuffer');
  }
  if (!Number.isFinite(routeWallMs) || routeWallMs < 0) {
    throw new Error('SF3D completed route wall must be finite and non-negative');
  }
  if (!Array.isArray(frameTimes) || !Array.isArray(frameCpuTimes)) {
    throw new Error('SF3D completed frame evidence must be arrays');
  }
  const sha256 = requiredSha256(outputSha256, 'SF3D output SHA-256');
  const expected = requiredSha256(expectedSha256, 'SF3D expected SHA-256');
  const cooperativeEvidence = normalizeEvidence(
    output.cooperativeReports || {},
    'cooperativeReports',
  );
  const arenaEvidence = normalizeEvidence(output.arenaSnapshot || null, 'arenaSnapshot');
  const gaps = frameTimes.slice(1).map((time, index) => time - frameTimes[index]);
  const stages = (output.stageSpans || []).map(stage => {
    const summary = summarizeSf3dFrameGaps(frameGapsWithinStage(frameTimes, stage));
    return Object.freeze({
      name: stage.name,
      wallMs: stage.end - stage.start,
      maxGapMs: summary.maxMs,
      p99Ms: summary.p99Ms,
    });
  });
  return Object.freeze({
    totalWallMs: routeWallMs,
    output: Object.freeze({
      sha256,
      expectedSha256: expected,
      bytes: output.glb.byteLength,
      canonical: sha256 === expected,
      numVertices: output.numVertices ?? null,
      numFaces: output.numFaces ?? null,
    }),
    renderer: Object.freeze({
      ...summarizeSf3dFrameGaps(gaps),
      renderedFrames: frameTimes.length,
      cpuFrameP99Ms: summarizeSf3dFrameGaps(frameCpuTimes).p99Ms,
    }),
    stages: Object.freeze(stages),
    cooperativeReports: cooperativeEvidence.normalized,
    arenaSnapshot: arenaEvidence.normalized,
    evidenceWarnings: Object.freeze([
      ...cooperativeEvidence.warnings,
      ...arenaEvidence.warnings,
    ]),
  });
}

export function buildSf3dFailureEvidence(completedOutput) {
  return Object.freeze({
    output: completedOutput?.output ?? null,
    renderer: completedOutput?.renderer ?? null,
    stages: completedOutput?.stages ?? [],
    cooperativeReports: completedOutput?.cooperativeReports ?? {},
    arenaSnapshot: completedOutput?.arenaSnapshot ?? null,
    evidenceWarnings: completedOutput?.evidenceWarnings ?? [],
  });
}
