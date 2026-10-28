// Native validation follows hand-live-contract at 1839cd308; this pair adds
// shared acquisition and all-or-nothing presentation of exact checkpoints.
export function validateModels(health, expected) {
  if (health.length !== 2 || expected.length !== 2) throw Error('two models required');
  health.forEach((h, i) => {
    if (h.status !== 'loaded' || h.identity?.model !== 'mobrecon_densestack_spiralconv' ||
        h.identity.backend !== 'pytorch' || h.identity.device !== 'cpu' ||
        h.interactionAuthority !== false || h.faces?.length !== 1538) throw Error('unexpected native route');
    if (!expected[i] || h.identity.checkpointSha256 !== expected[i]) throw Error('checkpoint mismatch');
  });
  if (expected[0] === expected[1]) throw Error('distinct checkpoints required');
}
export function cameraCrop(width, height, size = .85) {
  const half = Math.min(width, height) * size / 2;
  return [width / 2 - half, height / 2 - half, width / 2 + half, height / 2 + half];
}
export async function sharedInference(apis, sessions, request) {
  // One detector pass, then both networks on its exact crop, without a queue.
  const original = await apis[0]('/frame', {...request, sessionId: sessions[0]});
  const candidate = await apis[1]('/frame', {...request, sessionId: sessions[1],
    acquisitionMode: 'manual', cropBox: original.cropBox});
  return [original, candidate];
}
export function pairedPrediction(results, capture, identities) {
  if (results.length !== 2) throw Error('complete pair required');
  return results.map((r, index) => {
    if (r.captureId !== capture.captureId || r.captureEpochMs !== capture.captureEpochMs) throw Error('capture mismatch');
    for (const key of ['model', 'backend', 'device', 'checkpointSha256', 'sourceRevision']) {
      if (!identities[index][key] || r.identity?.[key] !== identities[index][key]) throw Error('route identity mismatch');
    }
    if (r.interactionAuthority !== false || r.authority !== 'live_native_diagnostic_not_interaction') throw Error('diagnostic authority mismatch');
    if (r.handedness !== capture.handedness) throw Error('handedness mismatch');
    if (!Array.isArray(r.cropBox) || r.cropBox.length !== 4 || !r.cropBox.every(Number.isFinite) ||
        r.cropBox[2] <= r.cropBox[0] || r.cropBox[3] <= r.cropBox[1] ||
        JSON.stringify(r.cropBox) !== JSON.stringify(results[0].cropBox)) throw Error('crop mismatch');
    if (!r.available || r.verticesMeters?.length !== 778 ||
        r.verticesMeters.some(v => !Array.isArray(v) || v.length !== 3 || !v.every(Number.isFinite)) ||
        r.meshJointsMeters?.length !== 21 ||
        r.meshJointsMeters.some(v => !Array.isArray(v) || v.length !== 3 || !v.every(Number.isFinite))) throw Error('invalid mesh');
    if (index === 0 && capture.acquisitionMode === 'detector') {
      const a = r.acquisitionDetails;
      if (!identities[0].detector || a?.mode !== 'detector' || a.captureId !== capture.captureId ||
          a.captureEpochMs !== capture.captureEpochMs || a.cropPadding !== capture.cropPadding ||
          a.detectorThreshold !== capture.detectorThreshold || !Array.isArray(a.detections) ||
          typeof a.fallback !== 'boolean' || a.fallback !== (a.detections.length === 0) ||
          r.acquisition !== (a.fallback ? 'manual_crop_fallback_no_detection' : 'wilor_yolo_detector_bbox_only')) throw Error('acquisition mismatch');
    }
    const wrist = r.meshJointsMeters[0];
    return new Float32Array(r.verticesMeters.flatMap(v => v.map((x, axis) => (x - wrist[axis]) * (axis === 1 ? -1 : 1))));
  });
}
