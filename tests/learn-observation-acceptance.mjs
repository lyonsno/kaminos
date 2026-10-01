export function acceptLearnObservations(observations, exportObservedMs, { requireConstruction = false } = {}) {
  const features = observations.filter(sample => sample.kind === 'encoder');
  if (features.length !== 24 || features.some((sample, index) => sample.completedBlocks !== index + 1
      || sample.totalBlocks !== 24 || sample.width !== 36 || sample.height !== 36
      || sample.values.length !== 1296 || !sample.values.every(Number.isFinite))) {
    throw new Error('missing, unordered, or invalid encoder observations');
  }
  const earlyMesh = observations.find(sample => sample.kind === 'mesh');
  if (!earlyMesh || earlyMesh.numVertices <= 0 || earlyMesh.numFaces <= 0
      || !(earlyMesh.atMs < exportObservedMs)) throw new Error('full mesh did not precede textured output');
  const construction = [];
  if (requireConstruction) for (const stageId of ['block-0-fuse-out', 'block-1-fuse-out']) {
    const samples = observations.filter(s => s.kind === 'construction' && s.stageId === stageId);
    const complete = observations.find(s => s.kind === 'construction-complete' && s.stageId === stageId);
    if (samples.length < 2 || !complete || complete.metrics.slabs !== samples.length
      || samples.some((s, i) => !Number.isSafeInteger(s.completedLayers) || s.completedLayers < 1
        || s.totalLayers !== samples[0].totalLayers || s.completedLayers > s.totalLayers
        || s.totalSamples !== s.totalLayers ** 3 || s.completedSamples !== s.completedLayers * s.totalLayers ** 2
        || !Number.isFinite(s.atMs) || !(s.atMs < earlyMesh.atMs)
        || (i > 0 && (s.completedLayers <= samples[i - 1].completedLayers || s.atMs < samples[i - 1].atMs)))
      || samples.at(-1).completedLayers !== samples.at(-1).totalLayers
      || !samples.some(s => s.numFaces > 0 && s.completedLayers < s.totalLayers)
      || !(complete.atMs >= samples.at(-1).atMs && complete.atMs < earlyMesh.atMs)) {
      throw new Error(`missing, incomplete, or unordered construction: ${stageId}`);
    }
    construction.push({ stageId, updates: samples.length, firstMs: samples[0].atMs,
      lastMs: samples.at(-1).atMs, metrics: complete.metrics });
  }
  return { readbackBytes: features.reduce((n, sample) => n + sample.values.length * 4, 0),
    gpuReadbackAndReductionMs: features.reduce((n, sample) => n + sample.observationMs, 0),
    firstFeaturesMs: features[0].atMs, fullMeshMs: earlyMesh.atMs, exportObservedMs, construction };
}
