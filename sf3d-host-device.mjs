// Capacity comes from two_stream.js fine-stage GEGLU: 3*96*96 tokens,
// 2*4096 float32 values per token, bound as one storage buffer (864 MiB).
export const sharedGpuBufferRequirements = Object.freeze({
  maxBufferSize: 3 * 96 * 96 * 2 * 4096 * 4,
  maxStorageBufferBindingSize: 3 * 96 * 96 * 2 * 4096 * 4,
});
export const SF3D_PRODUCER_COMMIT = '0ff8dc4527ba5513f2f6a9f5a7a6497e710af691';

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
