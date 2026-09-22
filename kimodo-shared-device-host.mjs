import {
  KIMODO_TEXT_TO_MOTION_ROUTE_ID,
  WEBGPU_INFERENCE_KIT_VERSION,
  createWebGpuForegroundService,
  validateWebGpuBackendIdentity,
  validateWebGpuDeviceRequirements,
} from '@kaminos/webgpu-inference-kit';

export const KIMODO_SHARED_DEVICE_ROUTE = KIMODO_TEXT_TO_MOTION_ROUTE_ID;

// Kimodo's actual model buffers are below the native flame's 160^3 storage
// field. The explicit descriptor still makes feature/limit composition part
// of the host contract, while requestBrowserWebGpuDevice carries the adapter's
// six inference limits at their supported values.
export const sharedGpuDeviceRequirements = Object.freeze({
  requiredFeatures: Object.freeze([]),
  requiredLimits: Object.freeze({}),
});

export function snapshotKimodoSharedDevice(sharedGpu) {
  const device = sharedGpu?.device;
  if (!device || sharedGpu.queue !== device.queue || typeof device.queue?.submit !== 'function') {
    throw new Error('Kimodo shared-device composition requires the host GPUDevice and its exact queue');
  }
  const requirementValidation = validateWebGpuDeviceRequirements(device, sharedGpuDeviceRequirements);
  if (!requirementValidation.ok) {
    throw new Error(`Kimodo shared device requirements failed: ${requirementValidation.errors.join('; ')}`);
  }
  const identityValidation = validateWebGpuBackendIdentity(sharedGpu.backendIdentity);
  if (!identityValidation.ok) {
    throw new Error(`Kimodo shared device backend identity failed: ${identityValidation.errors.join('; ')}`);
  }
  return Object.freeze({
    routeId: KIMODO_SHARED_DEVICE_ROUTE,
    kitVersion: WEBGPU_INFERENCE_KIT_VERSION,
    deviceTopology: 'same-device',
    queueTopology: 'exact-device-queue',
    hostIdentity: sharedGpu.identity ?? null,
    backendIdentity: sharedGpu.backendIdentity,
  });
}

export function connectKimodoSharedDeviceForeground({
  producer,
  prototype,
  host,
  sharedGpu,
  onReceipt = () => {},
} = {}) {
  const deviceReceipt = snapshotKimodoSharedDevice(sharedGpu);
  const context = prototype?.foregroundGpuContext?.();
  if (context?.renderer !== 'ordinary-volume' || context.productFrameOwner !== 'prototype' || context.active !== true) {
    throw new Error('Kimodo foreground service requires the active prototype-owned ordinary volume renderer');
  }
  if (
    !producer
    || producer.deviceInjected !== true
    || producer.device !== sharedGpu.device
    || host?.device !== sharedGpu.device
    || context.device !== sharedGpu.device
    || context.queue !== sharedGpu.device.queue
  ) {
    throw new Error('Kimodo shared-device foreground service device mismatch');
  }

  const service = createWebGpuForegroundService({
    routeId: KIMODO_SHARED_DEVICE_ROUTE,
    device: sharedGpu.device,
    queue: sharedGpu.device.queue,
  });
  let activeRun = null;
  let boundarySequence = 0;
  let disposed = false;

  prototype.setForegroundOpportunityRequester(request => {
    const handle = service.request({
      ...request,
      run: foregroundService => {
        if (foregroundService.device !== context.device || foregroundService.queue !== context.queue) {
          throw new Error('Kimodo foreground service device mismatch during frame service');
        }
        if (foregroundService.signal?.aborted) throw new Error('Kimodo foreground frame canceled');
        return host.runForegroundFrame(() => request.run(foregroundService));
      },
    });
    return Object.freeze({
      ...handle,
      completion: handle.completion.then(receipt => {
        onReceipt(receipt);
        return receipt;
      }),
    });
  });
  host.setForegroundServiceActive(true);

  async function beginRun(runId) {
    if (disposed) throw new Error('Kimodo foreground service is disposed');
    if (activeRun) throw new Error(`Kimodo foreground run ${activeRun.runId} is still active`);
    const kitRun = await service.beginRun(runId);
    const run = {
      runId,
      async foregroundOpportunity(boundary = {}) {
        if (activeRun !== run) throw new Error(`Kimodo foreground run ${runId} is not active`);
        boundarySequence += 1;
        const step = Number(boundary.step);
        const pass = String(boundary.pass ?? 'unknown-pass');
        const boundaryId = `${runId}:step-${Number.isFinite(step) ? step : 'unknown'}:pass-${pass}:boundary-${boundarySequence}`;
        return kitRun.foregroundOpportunities.serviceAtBoundary({
          invocationId: runId,
          boundaryId,
          dutyId: boundaryId,
          phase: String(boundary.phase || 'ddim-sampling'),
          position: 'before-encode',
          metadata: {
            step: Number.isFinite(step) ? step : null,
            numSteps: Number.isFinite(Number(boundary.numSteps)) ? Number(boundary.numSteps) : null,
            pass,
          },
        });
      },
      withForeground: kitRun.withForeground,
      async finish() {
        if (activeRun !== run) throw new Error(`Kimodo foreground run ${runId} is not active`);
        try {
          return await kitRun.finish();
        } finally {
          activeRun = null;
        }
      },
    };
    activeRun = run;
    return Object.freeze(run);
  }

  function snapshot() {
    return Object.freeze({
      routeId: KIMODO_SHARED_DEVICE_ROUTE,
      deviceReceipt,
      activeRun: activeRun?.runId ?? null,
      foregroundService: service.snapshot(),
    });
  }

  async function dispose() {
    if (disposed) return;
    if (activeRun) throw new Error(`finish Kimodo foreground run ${activeRun.runId} before disposing`);
    disposed = true;
    prototype.setForegroundOpportunityRequester(null);
    host.setForegroundServiceActive(false);
    await service.dispose();
  }

  return Object.freeze({ deviceReceipt, beginRun, snapshot, dispose });
}
