const REQUEST_WORKLOAD_IDENTITY = 'actual-volume-core-kiln-frame-v0';
const GPU_CONTEXT_SCHEMA = 'kaminos.volume-foreground-gpu-context.v0';
const FRAME_RECEIPT_SCHEMA = 'kaminos.volume-foreground-frame-receipt.v0';
const FRAME_ENCODER_IDENTITY = 'volume-core.renderLiveFrame';

function requireNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function productGpuContext(volume) {
  if (!volume || typeof volume.foregroundGpuContext !== 'function') {
    throw new Error('same-device kiln hook requires volume.foregroundGpuContext()');
  }
  const context = volume.foregroundGpuContext();
  if (context?.schema !== GPU_CONTEXT_SCHEMA || !context.device || !context.queue) {
    throw new Error('same-device kiln hook requires an active product volume GPU context');
  }
  requireNonEmptyString(context.deviceIdentity, 'product device identity');
  requireNonEmptyString(context.queueIdentity, 'product queue identity');
  return context;
}

function assertSharedGpu(product, service, phase) {
  if (product.device !== service.device) {
    throw new Error(`same-device kiln ${phase} device identity mismatch`);
  }
  if (product.queue !== service.queue) {
    throw new Error(`same-device kiln ${phase} queue identity mismatch`);
  }
}

function validateFrameReceipt(receipt, expected) {
  const valid = receipt?.schema === FRAME_RECEIPT_SCHEMA
    && receipt.status === 'submitted'
    && receipt.firingId === expected.firingId
    && receipt.frameId === expected.frameId
    && receipt.requestId === expected.requestId
    && receipt.encoderIdentity === FRAME_ENCODER_IDENTITY
    && Number.isInteger(receipt.commandBufferCount)
    && receipt.commandBufferCount > 0
    && receipt.submission
    && receipt.submission.commandBufferCount === receipt.commandBufferCount
    && receipt.submission.submissionStatus === 'queue-submit-returned';
  if (!valid) {
    throw new Error('foreground service did not return an actual volume-core kiln frame receipt');
  }
  return receipt;
}

export function createSharpSameDeviceKilnOpportunityHook({
  volume,
  firingId,
  nextFrameId,
} = {}) {
  const exactFiringId = requireNonEmptyString(firingId, 'firingId');
  if (typeof nextFrameId !== 'function') {
    throw new Error('same-device kiln hook requires nextFrameId()');
  }

  return function sharpSameDeviceKilnOpportunity(context = {}) {
    const product = productGpuContext(volume);
    assertSharedGpu(product, context, 'request');
    const frameId = requireNonEmptyString(nextFrameId(context), 'frameId');
    const requestId = frameId;

    return {
      requestId,
      metadata: {
        workloadIdentity: REQUEST_WORKLOAD_IDENTITY,
        firingId: exactFiringId,
        frameId,
        routeId: context.routeId || null,
        runId: context.runId || null,
        stage: context.stage || null,
        phase: context.phase || null,
        boundary: context.boundary || null,
        dutyId: context.dutyId || null,
        deviceIdentity: product.deviceIdentity,
        queueIdentity: product.queueIdentity,
      },
      async run(service = {}) {
        const effectiveProduct = productGpuContext(volume);
        assertSharedGpu(effectiveProduct, service, 'service');
        if (typeof service.submit !== 'function') {
          throw new Error('same-device kiln service requires the foreground submission lease');
        }
        if (typeof volume.renderForegroundOpportunityFrame !== 'function') {
          throw new Error('same-device kiln hook requires volume.renderForegroundOpportunityFrame()');
        }
        const receipt = await volume.renderForegroundOpportunityFrame({
          firingId: exactFiringId,
          frameId,
          requestId,
          signal: service.signal,
          submit: service.submit,
        });
        return validateFrameReceipt(receipt, {
          firingId: exactFiringId,
          frameId,
          requestId,
        });
      },
    };
  };
}
