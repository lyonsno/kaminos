export function liveMeshFrame(result, capture, identity) {
  if (result.captureId !== capture.captureId || result.captureEpochMs !== capture.captureEpochMs) throw Error('capture mismatch');
  for (const key of ['model','backend','device','checkpointSha256','sourceRevision']) {
    if (!identity[key] || result.identity?.[key] !== identity[key]) throw Error('route identity mismatch');
  }
  if (result.interactionAuthority !== false || result.authority !== 'live_native_diagnostic_not_interaction') throw Error('diagnostic authority mismatch');
  if (!result.available || !['left','right'].includes(result.handedness) || result.verticesMeters?.length !== 778 ||
      result.verticesMeters.some(v => !Array.isArray(v) || v.length !== 3 || !v.every(Number.isFinite))) throw Error('invalid mesh');
  return new Float32Array(result.verticesMeters.flat());
}

export function cameraCrop(width, height, x, y, size) {
  if (![width,height,x,y,size].every(Number.isFinite) || width <= 0 || height <= 0 || size <= 0) throw Error('invalid crop');
  const half = Math.min(width,height)*size/2;
  return [x*width-half,y*height-half,x*width+half,y*height+half];
}
