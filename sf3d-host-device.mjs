// Capacity comes from two_stream.js fine-stage GEGLU: 3*96*96 tokens,
// 2*4096 float32 values per token, bound as one storage buffer (864 MiB).
export const sharedGpuBufferRequirements = Object.freeze({
  maxBufferSize: 3 * 96 * 96 * 2 * 4096 * 4,
  maxStorageBufferBindingSize: 3 * 96 * 96 * 2 * 4096 * 4,
});
export const SF3D_PRODUCER_COMMIT = 'e4ec909cbbd896e04b221bb9aed9c910fd03ec6d';

export function judgeSf3dSmoke(result, {expectedScene = null, expectedReopen = null} = {}) {
  const errors = [];
  if (!result) return ['missing result'];
  if (result.deviceTopology !== 'same-device') errors.push('not same-device');
  if (result.foregroundScheduling !== 'producer-foreground-opportunities') errors.push('foreground service not connected');
  if (result.receiptValidation?.ok !== true) errors.push('invalid producer receipt');
  if (!(result.glbBytes > 0)) errors.push('empty GLB');
  const p = result.presentation;
  if (p?.status !== 'registered' || !p.objectId || !p.source?.startsWith('/api/read?') || p.sha256 !== result.glbSha256 || p.runId !== result.runId) errors.push('missing or stale host presentation');
  const progress = result.flameProgress;
  if (!(progress?.after?.frameCount > progress?.before?.frameCount && progress?.after?.simStepCount > progress?.before?.simStepCount)) errors.push('ordinary flame did not advance');
  const frames = result.foregroundFrames ?? [];
  const live = frames.filter(row => row.runId === result.runId);
  if (live.length < 2) errors.push('insufficient in-run ordinary frames');
  // Both active-run kit receipts and outside-run bridge receipts preserve the
  // actual submission rows; successfulSubmissionCount exists only outside runs.
  if (frames.some(row => row.status !== 'completed' || !row.submissions?.some(submission => submission.submissionStatus === 'queue-submit-returned' && submission.commandBufferCount > 0) || row.result?.renderer !== 'ordinary-volume' || row.result?.status !== 'submitted')) errors.push('failed or alternate foreground frame');
  if (live.length >= 2 && !['frameCount','simStepCount','sceneFrameCount'].every(key=>live.at(-1).result?.[key] > live[0].result?.[key])) errors.push('foreground scene/flame counters did not advance');
  if (expectedScene) {
    const scene = result.sceneEvidence;
    if (scene?.routeSceneFile !== expectedScene.file) errors.push('wrong or absent scene route');
    if (scene?.runtimePresetId !== expectedScene.presetId) errors.push('wrong or absent scene basin');
    if (!scene?.runtimeModelSources?.includes(expectedScene.modelSource)) errors.push('authored kiln mesh was not loaded');
    if (!scene?.runtimeStatus || /^Restore failed:/i.test(scene.runtimeStatus)) errors.push('scene restore did not complete');
  }
  if (expectedReopen) {
    const reopen = result.reopenEvidence;
    const kilnSource = expectedReopen.kilnSource || expectedScene?.modelSource;
    const hasBoth = sources => Array.isArray(sources) && sources.includes(kilnSource) && sources.includes(expectedReopen.generatedSource);
    const samePosition = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === 3 && b.length === 3 &&
      a.every((value, index) => Number.isFinite(value) && Number.isFinite(b[index]) && Math.abs(value - b[index]) < 1e-5);
    if (!reopen?.savedSceneFile || reopen.savedSceneFile === expectedScene?.file) errors.push('generated composition was not saved as a new scene');
    if (!hasBoth(reopen?.savedSources)) errors.push('saved scene lacks kiln or generated mesh');
    if (!hasBoth(reopen?.reopenedSources)) errors.push('reopened scene lacks kiln or generated mesh');
    if (!reopen?.savedPresetId || reopen.reopenedPresetId !== reopen.savedPresetId ||
        (expectedScene?.presetId && reopen.savedPresetId !== expectedScene.presetId)) errors.push('reopened scene has wrong flame basin');
    if (!reopen?.reopenedStatus || /^Restore failed:/i.test(reopen.reopenedStatus)) errors.push('generated composition did not restore');
    if (!(reopen?.flameAfter > reopen?.flameBefore)) errors.push('reopened flame did not advance');
    if (reopen?.sourceUnchanged !== true) errors.push('Save As did not preserve the source scene');
    if (!samePosition(reopen?.editedPosition, reopen?.reopenedPosition) ||
        samePosition(reopen?.originalPosition, reopen?.editedPosition)) errors.push('generated object edit did not survive reopen');
  }
  return errors;
}

export function connectSf3dForeground(producer, prototype, host, onReceipt = () => {}) {
  const context = prototype?.foregroundGpuContext?.();
  if (context?.renderer !== 'ordinary-volume' || context.productFrameOwner !== 'prototype') {
    throw new Error('SF3D foreground service requires the actual ordinary renderer');
  }
  if (!host || host.device !== producer.device || context.device !== producer.device || context.queue !== producer.device.queue) {
    throw new Error('SF3D foreground service device mismatch');
  }
  prototype.setForegroundOpportunityRequester(request => {
    const handle = producer.requestForegroundOpportunity({
      ...request,
      run: service => {
        if (service.device !== context.device || service.queue !== context.queue) throw new Error('SF3D service device mismatch');
        if (service.signal?.aborted) throw new Error('SF3D service canceled');
        return host.runForegroundFrame(() => request.run(service));
      },
    });
    return {...handle, completion:handle.completion.then(receipt => {onReceipt(receipt); return receipt;})};
  });
  host.setForegroundServiceActive(true);
}

export function snapshotSf3dSharedDevice(sharedGpu) {
  const device = sharedGpu?.device;
  if (!device || sharedGpu.queue !== device.queue || typeof device.queue?.submit !== 'function') {
    throw new Error('SF3D requires the host shared GPU device and its exact queue');
  }
  for (const [name, required] of Object.entries(sharedGpuBufferRequirements)) {
    if (!(device.limits?.[name] >= required)) {
      throw new Error(`SF3D shared device buffer requirement ${name}=${required} exceeds effective limit ${device.limits?.[name]}`);
    }
  }
  return {
    producerCommit: SF3D_PRODUCER_COMMIT,
    hostIdentity: sharedGpu.identity ?? null,
    effectiveLimits: Object.fromEntries(Object.keys(sharedGpuBufferRequirements).map(name => [name, device.limits[name]])),
    enabledFeatures: [...device.features],
  };
}

export async function createSharedDeviceSf3dProducer(createProducer, sharedGpu, options = {}) {
  snapshotSf3dSharedDevice(sharedGpu);
  const producer = await createProducer({
    ...options,
    device: sharedGpu.device,
    adapter: sharedGpu.adapter,
    commit: SF3D_PRODUCER_COMMIT,
  });
  if (producer.device !== sharedGpu.device || producer.deviceInjected !== true) {
    throw new Error('SF3D producer device-mismatch: expected the injected host device');
  }
  return producer;
}
