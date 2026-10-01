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
    for (const s of samples) {
      const expectedZ = -0.87 + 1.74 * (s.completedLayers - 1) / (s.totalLayers - 1);
      // The existing marching-tet deformation can move known vertices by
      // 1.74/160 along each axis; interpolation stays within those endpoints.
      const allowance = 1.74 / 160 + 1e-6;
      if (!Number.isFinite(s.maxZ) || Math.abs(s.maxZ - expectedZ) > 1e-6
        || !Number.isSafeInteger(s.numVertices) || s.numVertices < 0
        || !Number.isSafeInteger(s.numFaces) || s.numFaces < 0
        || !Array.isArray(s.vertices) || s.vertices.length !== s.numVertices * 3
        || !Array.isArray(s.faces) || s.faces.length !== s.numFaces * 3
        || s.vertices.some((v, i) => !Number.isFinite(v) || v < -0.87 - allowance
          || v > (i % 3 === 2 ? s.maxZ : 0.87) + allowance)
        || s.faces.some(i => !Number.isSafeInteger(i) || i < 0 || i >= s.numVertices)) {
        throw new Error(`contradictory construction geometry: ${stageId}`);
      }
    }
    construction.push({ stageId, updates: samples.length, firstMs: samples[0].atMs,
      lastMs: samples.at(-1).atMs, metrics: complete.metrics });
  }
  return { readbackBytes: features.reduce((n, sample) => n + sample.values.length * 4, 0),
    gpuReadbackAndReductionMs: features.reduce((n, sample) => n + sample.observationMs, 0),
    firstFeaturesMs: features[0].atMs, fullMeshMs: earlyMesh.atMs, exportObservedMs, construction,
    constructionVisualAuthority: 'unverified' };
}
