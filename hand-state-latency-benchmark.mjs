const LIVE_AUTHORITY = 'live_simulation';
const LIVE_ROUTE = 'native_wilor_mini_mlx_detector_sidecar_live';
const RUNTIME_OWNER = 'hand-state-runtime';
const MANO_VERTEX_COUNT = 778;
const MANO_FACE_COUNT = 1538;

const METRICS = [
  'clientEncodeMs',
  'nativePostMs',
  'modelLatencyMs',
  'captureToSidecarPublishMs',
  'publishToViewerReceiveMs',
  'captureToViewerReceiveMs',
  'captureToRenderCompleteMs',
];

function quantile(sorted, probability) {
  return sorted[Math.max(0, Math.ceil(sorted.length * probability) - 1)];
}

function rounded(value) {
  return Math.round(value * 1000) / 1000;
}

function distribution(samples, metric) {
  const values = samples.map(sample => sample[metric]).sort((left, right) => left - right);
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    min: rounded(values[0]),
    mean: rounded(total / values.length),
    p50: rounded(quantile(values, 0.50)),
    p90: rounded(quantile(values, 0.90)),
    p95: rounded(quantile(values, 0.95)),
    p99: rounded(quantile(values, 0.99)),
    max: rounded(values.at(-1)),
  };
}

function validateSample(sample, seenFrames) {
  if (!sample || typeof sample !== 'object') throw new Error('latency sample is missing');
  if (!sample.frameId) throw new Error('latency sample frameId is missing');
  if (seenFrames.has(sample.frameId)) throw new Error(`duplicate frame in benchmark: ${sample.frameId}`);
  seenFrames.add(sample.frameId);
  if (sample.runtimeOwner !== RUNTIME_OWNER) throw new Error(`wrong runtime owner: ${sample.runtimeOwner}`);
  if (sample.sourceAuthority !== LIVE_AUTHORITY) throw new Error(`wrong source authority: ${sample.sourceAuthority}`);
  if (sample.effectiveRoute !== LIVE_ROUTE) throw new Error(`wrong effective route: ${sample.effectiveRoute}`);
  if (sample.manoVertexCount !== MANO_VERTEX_COUNT || sample.manoFaceCount !== MANO_FACE_COUNT) {
    throw new Error(`invalid MANO geometry: ${sample.manoVertexCount}/${sample.manoFaceCount}`);
  }
  for (const metric of METRICS) {
    if (!Number.isFinite(sample[metric]) || sample[metric] < 0) throw new Error(`${metric} is missing or invalid`);
  }
}

export function summarizeLatencySamples(samples) {
  if (!Array.isArray(samples) || samples.length === 0) throw new Error('no live latency samples');
  const seenFrames = new Set();
  samples.forEach(sample => validateSample(sample, seenFrames));
  const first = samples[0];
  const distributions = Object.fromEntries(METRICS.map(metric => [metric, distribution(samples, metric)]));
  return {
    schema: 'hand-state.viewer-latency-benchmark.v0',
    generatedAt: new Date().toISOString(),
    sampleCount: samples.length,
    runtimeOwner: first.runtimeOwner,
    sourceAuthority: first.sourceAuthority,
    requestedRoute: first.requestedRoute,
    effectiveRoute: first.effectiveRoute,
    model: first.model,
    deviceRoute: first.deviceRoute,
    dtypeRoute: first.dtypeRoute,
    manoVertexCount: first.manoVertexCount,
    manoFaceCount: first.manoFaceCount,
    firstFrameId: first.frameId,
    lastFrameId: samples.at(-1).frameId,
    distributions,
    samples: samples.map(sample => ({ ...sample })),
  };
}
