export function liveMeshFrame(result, capture, identity) {
  if (result.captureId !== capture.captureId || result.captureEpochMs !== capture.captureEpochMs) throw Error('capture mismatch');
  for (const key of ['model','backend','device','checkpointSha256','sourceRevision']) {
    if (!identity[key] || result.identity?.[key] !== identity[key]) throw Error('route identity mismatch');
  }
  if (result.interactionAuthority !== false || result.authority !== 'live_native_diagnostic_not_interaction') throw Error('diagnostic authority mismatch');
  if (capture.acquisitionMode === 'detector') {
    const a = result.acquisitionDetails;
    if (!identity.detector || JSON.stringify(result.identity?.detector) !== JSON.stringify(identity.detector) ||
        a?.mode !== 'detector' || a.captureId !== capture.captureId || a.captureEpochMs !== capture.captureEpochMs ||
        a.cropPadding !== capture.cropPadding || a.detectorThreshold !== capture.detectorThreshold ||
        !Array.isArray(a.detections) || typeof a.fallback !== 'boolean' ||
        result.acquisition !== (a.fallback ? 'manual_crop_fallback_no_detection' : 'wilor_yolo_detector_bbox_only') ||
        a.fallback !== (a.detections.length === 0)) throw Error('acquisition route mismatch');
  }
  if (!result.available || !['left','right'].includes(result.handedness) || result.verticesMeters?.length !== 778 ||
      result.verticesMeters.some(v => !Array.isArray(v) || v.length !== 3 || !v.every(Number.isFinite))) throw Error('invalid mesh');
  return new Float32Array(result.verticesMeters.flat());
}

export function cameraCrop(width, height, x, y, size) {
  if (![width,height,x,y,size].every(Number.isFinite) || width <= 0 || height <= 0 || size <= 0) throw Error('invalid crop');
  const half = Math.min(width,height)*size/2;
  return [x*width-half,y*height-half,x*width+half,y*height+half];
}
