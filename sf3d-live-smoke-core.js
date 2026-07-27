export const SF3D_LIVE_SMOKE_ROUTE_ID = 'sf3d.image-to-mesh.webgpu-local.v0';
export const SF3D_LIVE_SMOKE_SOURCE_REVISION = '2f79b9b84a19809107f5eb29b5fab806e00e6c6a';
export const SF3D_LIVE_SMOKE_CANONICAL_GLB_SHA256 = 'e1f70de3407df24d571bf68f70fac2b59373bdd948075a2387f1834e4faff8b7';
export const SF3D_LIVE_SMOKE_GPU_TOPOLOGY = 'same-page-dual-device-shared-physical-gpu';

export const SF3D_LIVE_SMOKE_OPTIONS = Object.freeze({
  cooperativeDino: false,
  cooperativeBake: true,
  bakeSchedulingMode: 'cooperative',
  bakeBatchTexels: 4096,
  decoderArena: true,
  materializeWorker: true,
});

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
