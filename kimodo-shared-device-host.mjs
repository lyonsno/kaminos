import {
  KIMODO_TEXT_TO_MOTION_ROUTE_ID,
  WEBGPU_INFERENCE_KIT_VERSION,
  createWebGpuForegroundService,
  validateWebGpuBackendIdentity,
  validateWebGpuDeviceRequirements,
} from '@kaminos/webgpu-inference-kit';

export const KIMODO_SHARED_DEVICE_ROUTE = KIMODO_TEXT_TO_MOTION_ROUTE_ID;

function foregroundFailure(message, detail = null) {
  const error = new Error(message);
  error.name = 'KimodoForegroundError';
  error.detail = detail;
  return error;
}

function validateForegroundReceipt(receipt, phase = 'foreground') {
  if (receipt?.status !== 'completed') {
    throw foregroundFailure(`${phase} foreground receipt failed (${receipt?.status || 'missing'})`, receipt);
  }
  if (receipt.submissionCount < 1 || receipt.result?.status !== 'submitted') {
    throw foregroundFailure(`${phase} foreground receipt did not return a required shared-queue submission`, receipt);
  }
  return receipt;
}

function validateForegroundServiceTurn(turn, phase = 'foreground') {
  if (!turn || !['serviced', 'no-demand'].includes(turn.status)) {
    throw foregroundFailure(`${phase} foreground service turn failed (${turn?.status || 'missing'})`, turn);
  }
  if (turn.failures?.length) {
    throw foregroundFailure(`${phase} foreground service turn reported callback failures`, turn);
  }
  for (const receipt of turn.receipts || []) validateForegroundReceipt(receipt, phase);
  return turn;
}

function validateForegroundRunReport(report, phase = 'finish') {
  if (report?.status !== 'succeeded') {
    throw foregroundFailure(`${phase} foreground run did not drain (${report?.status || 'missing'})`, report);
  }
  for (const service of report.services || []) validateForegroundServiceTurn(service, phase);
  for (const receipt of report.receipts || []) validateForegroundReceipt(receipt, phase);
  return report;
}

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
  const effectiveRequirements = sharedGpu.requirements ?? sharedGpuDeviceRequirements;
  const requirementValidation = validateWebGpuDeviceRequirements(device, effectiveRequirements);
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
    requirements: effectiveRequirements,
  });
}

export function connectKimodoSharedDeviceForeground({
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
    host?.device !== sharedGpu.device
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
  let attachedProducer = null;
  let boundarySequence = 0;
  let disposed = false;
  let disposal = null;
  let serviceFailure = null;
  const receiptPromises = new Map();

  function rememberFailure(error) {
    serviceFailure ||= error;
    if (activeRun) activeRun.failure ||= error;
    return error;
  }

  function assertHealthy(phase = 'foreground') {
    const failure = activeRun?.failure || serviceFailure;
    if (failure) throw foregroundFailure(`${phase} blocked after foreground service failed: ${failure.message}`, failure.detail ?? failure);
  }

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
    const completion = handle.completion.then(receipt => {
      onReceipt(receipt);
      try {
        validateForegroundReceipt(receipt, 'frame');
      } catch (error) {
        rememberFailure(error);
      }
      if (receipt.runId == null) receiptPromises.delete(receipt.requestId);
      return receipt;
    });
    receiptPromises.set(handle.requestId, completion);
    return Object.freeze({
      ...handle,
      completion,
    });
  });
  host.setForegroundServiceActive(true);

  function attachProducer(producer) {
    if (disposed) throw new Error('Kimodo foreground service is disposed');
    assertHealthy('producer attachment');
    if (
      !producer
      || producer.deviceInjected !== true
      || producer.device !== sharedGpu.device
    ) {
      throw new Error('Kimodo shared-device foreground service producer device mismatch');
    }
    if (attachedProducer && attachedProducer !== producer) {
      throw new Error('Kimodo foreground service already has a different producer');
    }
    attachedProducer = producer;
    return snapshot();
  }

  async function beginRun(runId) {
    if (disposed) throw new Error('Kimodo foreground service is disposed');
    assertHealthy('run start');
    if (!attachedProducer) throw new Error('attach the exact shared-device Kimodo producer before beginning a generation');
    if (activeRun) throw new Error(`Kimodo foreground run ${activeRun.runId} is still active`);
    const kitRun = await service.beginRun(runId);
    const run = {
      runId,
      failure: null,
      finishPromise: null,
      async foregroundOpportunity(boundary = {}) {
        if (activeRun !== run) throw new Error(`Kimodo foreground run ${runId} is not active`);
        assertHealthy('model boundary');
        boundarySequence += 1;
        const step = Number(boundary.step);
        const pass = String(boundary.pass ?? 'unknown-pass');
        const boundaryId = `${runId}:step-${Number.isFinite(step) ? step : 'unknown'}:pass-${pass}:boundary-${boundarySequence}`;
        const turn = await kitRun.foregroundOpportunities.serviceAtBoundary({
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
        try {
          validateForegroundServiceTurn(turn, 'model boundary');
          const receipts = await Promise.all((turn.receiptIds || []).map(requestId => {
            const completion = receiptPromises.get(requestId);
            if (!completion) throw foregroundFailure(`model boundary omitted completion for ${requestId}`, turn);
            return completion;
          }));
          for (const receipt of receipts) validateForegroundReceipt(receipt, 'model boundary');
          for (const requestId of turn.receiptIds || []) receiptPromises.delete(requestId);
          return Object.freeze({ ...turn, receipts });
        } catch (error) {
          throw rememberFailure(error);
        }
      },
      async withForeground(phase, work) {
        if (activeRun !== run) throw new Error(`Kimodo foreground run ${runId} is not active`);
        assertHealthy(`CPU window ${phase}`);
        try {
          const value = await kitRun.withForeground(phase, work);
          await Promise.resolve();
          assertHealthy(`CPU window ${phase}`);
          return value;
        } catch (error) {
          throw rememberFailure(error);
        }
      },
      async finish() {
        if (run.finishPromise) return run.finishPromise;
        if (activeRun !== run) throw new Error(`Kimodo foreground run ${runId} is not active`);
        run.finishPromise = (async () => {
          try {
            const report = await kitRun.finish();
            validateForegroundRunReport(report);
            for (const receipt of report.receipts || []) receiptPromises.delete(receipt.requestId);
            assertHealthy('finish');
            return report;
          } catch (error) {
            throw rememberFailure(error);
          } finally {
            if (activeRun === run) activeRun = null;
          }
        })();
        return run.finishPromise;
      },
    };
    activeRun = run;
    return run;
  }

  function snapshot() {
    return Object.freeze({
      routeId: KIMODO_SHARED_DEVICE_ROUTE,
      deviceReceipt,
      producerAttached: Boolean(attachedProducer),
      activeRun: activeRun?.runId ?? null,
      foregroundService: service.snapshot(),
    });
  }

  function dispose() {
    if (disposal) return disposal;
    disposal = (async () => {
      let failure = null;
      const preserveFailure = error => { failure ||= error; };
      try {
        await prototype.pauseForegroundFrames?.();
      } catch (error) {
        preserveFailure(error);
      }
      try {
        if (activeRun) await activeRun.finish();
      } catch (error) {
        preserveFailure(error);
      }
      try {
        if (typeof prototype.stopForegroundFrames !== 'function') {
          throw new Error('Kimodo foreground teardown requires stopForegroundFrames');
        }
        await prototype.stopForegroundFrames();
      } catch (error) {
        preserveFailure(error);
      }
      try {
        prototype.setForegroundOpportunityRequester(null);
      } catch (error) {
        preserveFailure(error);
      }
      try {
        host.setForegroundServiceActive(false);
      } catch (error) {
        preserveFailure(error);
      }
      try {
        await service.dispose();
      } catch (error) {
        preserveFailure(error);
      }
      disposed = true;
      if (failure) throw failure;
    })();
    return disposal;
  }

  return Object.freeze({ deviceReceipt, attachProducer, beginRun, snapshot, dispose });
}
