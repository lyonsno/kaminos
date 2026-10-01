export function acceptLearnObservations(observations, exportObservedMs) {
  const features = observations.filter(sample => sample.kind === 'encoder');
  if (features.length !== 24 || features.some((sample, index) => sample.completedBlocks !== index + 1
      || sample.totalBlocks !== 24 || sample.width !== 36 || sample.height !== 36
      || sample.values.length !== 1296 || !sample.values.every(Number.isFinite))) {
    throw new Error('missing, unordered, or invalid encoder observations');
  }
  const earlyMesh = observations.find(sample => sample.kind === 'mesh');
  if (!earlyMesh || earlyMesh.numVertices <= 0 || earlyMesh.numFaces <= 0
      || !(earlyMesh.atMs < exportObservedMs)) throw new Error('full mesh did not precede textured output');
  return { readbackBytes: features.reduce((n, sample) => n + sample.values.length * 4, 0),
    gpuReadbackAndReductionMs: features.reduce((n, sample) => n + sample.observationMs, 0),
    firstFeaturesMs: features[0].atMs, fullMeshMs: earlyMesh.atMs, exportObservedMs };
}
