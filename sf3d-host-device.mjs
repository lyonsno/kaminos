// Capacity comes from two_stream.js fine-stage GEGLU: 3*96*96 tokens,
// 2*4096 float32 values per token, bound as one storage buffer (864 MiB).
export const sharedGpuBufferRequirements = Object.freeze({
  maxBufferSize: 3 * 96 * 96 * 2 * 4096 * 4,
  maxStorageBufferBindingSize: 3 * 96 * 96 * 2 * 4096 * 4,
});
export const SF3D_PRODUCER_COMMIT = '0ff8dc4527ba5513f2f6a9f5a7a6497e710af691';

export function judgeSf3dSmoke(result) {
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
  if (frames.some(row => row.status !== 'completed' || !(row.successfulSubmissionCount > 0) || row.result?.renderer !== 'ordinary-volume' || row.result?.status !== 'submitted')) errors.push('failed or alternate foreground frame');
  if (live.length >= 2 && !['frameCount','simStepCount','sceneFrameCount'].every(key=>live.at(-1).result?.[key] > live[0].result?.[key])) errors.push('foreground scene/flame counters did not advance');
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
