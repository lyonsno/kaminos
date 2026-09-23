function boundaryKey(boundary) {
  return JSON.stringify([
    boundary?.step, boundary?.numSteps, boundary?.pass, boundary?.chunkIndex,
    boundary?.chunkCount, boundary?.layerStart, boundary?.layerEnd,
  ]);
}

export function validateMountedComposition(snapshot) {
  const { setup, state, volume } = snapshot || {};
  if (setup?.status !== 'mounted') throw new Error(`composition did not reach mounted state (${setup?.status || 'missing'})`);
  if (volume?.active !== true || volume?.ordinaryForeground?.mode !== 'producer-foreground-opportunities') {
    throw new Error('composition mounted without an active persistent-service-owned volume renderer');
  }
  if (state?.status !== 'mounted' || state.mount?.foregroundConnected !== true || state.mount?.loadHandlerInstalled !== true) {
    throw new Error('composition published a partial shared-device mount');
  }
  if (state.deviceTopology !== 'same-device' || state.queueTopology !== 'exact-device-queue') {
    throw new Error('composition did not preserve exact same-device and queue topology');
  }
  return state;
}

export function validateSuccessfulRun(terminal, requestedSchedule = null) {
  if (terminal?.status !== 'succeeded') throw new Error(terminal?.lastError?.message || `Generation ended as ${terminal?.status || 'missing'}`);
  const run = terminal.runs?.at(-1);
  if (requestedSchedule !== null) {
    const schedule = {
      'full-pass': { layers: 16, chunks: 1, capacity: 2 },
      'fence-light': { layers: 4, chunks: 4, capacity: 4 },
      'single-layer': { layers: 1, chunks: 16, capacity: 4 },
    }[requestedSchedule];
    const { layers, chunks, capacity } = schedule ?? {};
    const passNames = ['cond-root', 'cond-body', 'uncond-root', 'uncond-body'];
    const generationId = run?.generationId;
    const steps = run?.steps;
    const expected = steps * passNames.length * chunks;
    const submission = run?.receipt?.metadata?.gpuSubmission;
    const scheduler = run?.telemetry?.scheduler;
    const rawSubmission = run?.diagnostics?.submissionReport;
    const expectedForegroundFrameBoundaries = [];
    const countFields = [
      'status', 'maxInFlightDuties', 'maxObservedInFlightDuties',
      'submittedDutyCount', 'completedDutyCount', 'failedDutyCount', 'inFlightDutyCount', 'hostSubmissionCount',
    ];
    const summariesAgree = (...summaries) => summaries.every(summary => summary != null)
      && countFields.every(field => summaries.every(summary => summary[field] === summaries[0][field]));
    if (!schedule
      || !Number.isSafeInteger(generationId) || generationId <= 0
      || !Number.isSafeInteger(steps) || steps <= 0
      || run?.scheduling?.mode !== requestedSchedule
      || run.scheduling.layersPerDuty !== layers || run.scheduling.chunksPerPass !== chunks
      || run.scheduling.maxInFlightDuties !== capacity
      || run.diagnostics?.generationId !== generationId
      || run.diagnostics?.numSteps !== steps
      || run.diagnostics?.scheduleMode !== requestedSchedule
      || run.diagnostics?.scheduling?.mode !== requestedSchedule
      || run.diagnostics?.scheduling?.layersPerDuty !== layers
      || run.diagnostics?.scheduling?.chunksPerPass !== chunks
      || run.diagnostics?.scheduling?.maxInFlightDuties !== capacity
      || run.receipt?.generationId !== generationId
      || run.telemetry?.generationId !== generationId
      || !Number.isSafeInteger(expected) || expected < 4
      || run.diagnostics?.passes?.length !== expected
      || rawSubmission?.duties?.length !== expected
      || rawSubmission.status !== 'drained' || rawSubmission.maxInFlightDuties !== capacity
      || !Number.isSafeInteger(rawSubmission.maxObservedInFlightDuties)
      || rawSubmission.maxObservedInFlightDuties < 1 || rawSubmission.maxObservedInFlightDuties > capacity
      || rawSubmission.submittedDutyCount !== expected || rawSubmission.completedDutyCount !== expected
      || rawSubmission.failedDutyCount !== 0 || rawSubmission.inFlightDutyCount !== 0
      || submission?.status !== 'drained' || submission.maxInFlightDuties !== capacity
      || submission.submittedDutyCount !== expected || submission.completedDutyCount !== expected
      || submission.failedDutyCount !== 0 || submission.inFlightDutyCount !== 0
      || !summariesAgree(submission, run.submission, run.telemetry?.submission)
      || run.telemetry?.scheduler?.requestedMaxInFlightDuties !== capacity
      || run.telemetry?.scheduler?.boundariesPerStep !== 4 * chunks
      || run.telemetry?.scheduler?.expectedForegroundBoundaryCount !== expected
      || run.telemetry?.scheduler?.observedForegroundBoundaryCount !== expected
      || run.telemetry?.status !== 'succeeded') {
      throw new Error('Requested Kimodo schedule lacks current-generation diagnostics, complete telemetry, and matching terminal receipts');
    }
    let ordinal = 0;
    let finalExpected = null;
    for (let step = 1; step <= steps; step++) {
      for (const passName of passNames) {
        for (let chunkIndex = 1; chunkIndex <= chunks; chunkIndex++) {
          const dutyId = `g${generationId}-s${step}-${passName}${chunks > 1 ? `-c${chunkIndex}` : ''}`;
          const layerStart = (chunkIndex - 1) * layers;
          const layerEnd = layerStart + layers;
          const pass = run.diagnostics.passes[ordinal];
          const duty = rawSubmission.duties[ordinal];
          if (pass.dutyId !== dutyId || pass.step !== step || pass.numSteps !== steps || pass.pass !== passName
            || pass.chunkIndex !== chunkIndex || pass.chunkCount !== chunks
            || pass.layerStart !== layerStart || pass.layerEnd !== layerEnd
            || duty.dutyId !== dutyId || duty.status !== 'completed'
            || (duty.sequence != null && duty.sequence !== ordinal + 1)) {
            throw new Error('Kimodo effective schedule contains a missing, extra, stale, reordered, or conflicting duty identity');
          }
          finalExpected = { dutyId, step, pass: passName, chunkIndex, chunkCount: chunks, layerStart, layerEnd };
          expectedForegroundFrameBoundaries.push({
            step,
            numSteps: steps,
            pass: passName,
            chunkIndex,
            chunkCount: chunks,
            layerStart,
            layerEnd,
          });
          ordinal++;
        }
      }
    }
    const expectedBoundaryKeys = new Set(expectedForegroundFrameBoundaries.map(boundaryKey));
    const samplingReceipts = (run.foregroundReceipts || []).filter(receipt => receipt.boundary?.phase === 'ddim-sampling');
    const samplingKeys = samplingReceipts.map(receipt => boundaryKey(receipt.boundary?.metadata));
    if (samplingKeys.some(key => !expectedBoundaryKeys.has(key)) || new Set(samplingKeys).size !== samplingKeys.length) {
      throw new Error('Kimodo foreground frame evidence contains an unexpected or duplicate sampling frame receipt');
    }
    // Split schedules explicitly wait for a browser frame at each duty. Full
    // pass intentionally does not: its reference path records whatever the
    // ordinary foreground requester actually serviced while GPU work ran.
    if (requestedSchedule !== 'full-pass'
      && (samplingKeys.length !== expectedForegroundFrameBoundaries.length
        || samplingKeys.some((key, index) => key !== boundaryKey(expectedForegroundFrameBoundaries[index])))) {
      throw new Error('Kimodo split schedule lacks one foreground frame receipt per scheduled duty');
    }
    const last = scheduler.lastBoundary;
    if (last?.phase !== 'ddim-sampling' || last.step !== finalExpected.step || last.numSteps !== steps
      || last.pass !== finalExpected.pass || last.dutyId !== finalExpected.dutyId
      || last.chunkIndex !== finalExpected.chunkIndex || last.chunkCount !== chunks
      || last.layerStart !== finalExpected.layerStart || last.layerEnd !== finalExpected.layerEnd) {
      throw new Error('Kimodo foreground telemetry last-boundary identity does not match the final scheduled duty');
    }
  }
  if (!run?.foregroundRunReport) throw new Error('Generation succeeded without a persistent foreground run report');
  if (!run.runId || run.foregroundRunReport.runId !== run.runId) {
    throw new Error('Generation succeeded with a mismatched foreground run report identity');
  }
  if (!run.foregroundReceipts?.length) throw new Error('Generation succeeded without current-run foreground frame receipts');
  if (run.foregroundReceipts.some(receipt => receipt.runId !== run.runId)) {
    throw new Error('Generation receipt evidence is not bound to the exact current run');
  }
  if (run.foregroundReceipts.some(receipt => receipt.status !== 'completed' || receipt.submissionCount < 1 || receipt.result?.status !== 'submitted')) {
    throw new Error('Generation succeeded with a failed, canceled, or submission-free current-run foreground receipt');
  }
  if (!run.foregroundRunReport.receipts?.length) {
    throw new Error('Generation run report contains no exact current-run foreground receipts');
  }
  if (run.foregroundRunReport.status !== 'succeeded'
    || run.foregroundRunReport.receipts.some(receipt => receipt.runId !== run.runId
      || receipt.status !== 'completed'
      || receipt.submissionCount < 1
      || receipt.result?.status !== 'submitted')
    || run.foregroundRunReport.services?.some(service => service.runId !== run.runId
      || !['serviced', 'no-demand'].includes(service.status)
      || service.failures?.length)) {
    throw new Error('Generation succeeded with an unhealthy foreground service report');
  }
  if (requestedSchedule !== null) {
    const captureByRequest = new Map();
    for (const receipt of run.foregroundReceipts) {
      if (!receipt.requestId || captureByRequest.has(receipt.requestId)) {
        throw new Error('Generation contains a duplicate current-run foreground frame request');
      }
      const atMs = receipt.result?.atMs;
      const settledAtMs = receipt.settledAtMs ?? atMs;
      const frameBefore = receipt.metadata?.frameCountBefore;
      const simStepBefore = receipt.metadata?.simStepCountBefore;
      const frameAfter = receipt.result?.frameCount;
      if (!Number.isFinite(atMs) || !Number.isSafeInteger(frameBefore)
        || !Number.isFinite(settledAtMs) || settledAtMs < atMs
        || !Number.isSafeInteger(simStepBefore) || !Number.isSafeInteger(frameAfter)
        || !Number.isSafeInteger(receipt.result?.simStepCount)
        || frameAfter !== frameBefore + 1
        || receipt.result.simStepCount !== simStepBefore + 1) {
        throw new Error('Generation foreground frame receipt lacks exact timestamp, frame-count, and simulation-count evidence');
      }
      captureByRequest.set(receipt.requestId, receiptSignatureForSample(receipt));
    }
    const reportByRequest = new Map();
    for (const receipt of run.foregroundRunReport.receipts) {
      if (!receipt.requestId || reportByRequest.has(receipt.requestId)) {
        throw new Error('Generation foreground run report contains a duplicate frame request');
      }
      reportByRequest.set(receipt.requestId, receiptSignatureForSample(receipt));
    }
    if (captureByRequest.size !== reportByRequest.size
      || [...captureByRequest].some(([requestId, signature]) => reportByRequest.get(requestId) !== signature)) {
      throw new Error('Generation page capture and foreground report receipts disagree');
    }
  }
  if (!(run.flameAfter?.frameCount > run.flameBefore?.frameCount)
    || !(run.flameAfter?.simStepCount > run.flameBefore?.simStepCount)) {
    throw new Error('Generation completed without positive same-run flame frame and simulation progress');
  }
  const runningSamples = (run.samples || []).filter(sample => sample.status === 'running');
  if (runningSamples.length < 2
    || Math.max(...runningSamples.map(sample => sample.frameCount ?? -Infinity)) <= Math.min(...runningSamples.map(sample => sample.frameCount ?? Infinity))) {
    throw new Error('Generation lacks sampled flame progress while model work was running');
  }
  if (requestedSchedule !== null) {
    const initialFrame = run.flameBefore?.frameCount;
    const initialSimStep = run.flameBefore?.simStepCount;
    if (!Number.isSafeInteger(initialFrame) || !Number.isSafeInteger(initialSimStep)) {
      throw new Error('Generation running samples lack exact initial flame frame and simulation counts');
    }
    let previousAtMs = -Infinity;
    let previousFrame = initialFrame;
    let previousSimStep = initialSimStep;
    const captureByRequest = new Map(run.foregroundReceipts.map(receipt => [
      receipt.requestId,
      receiptSignatureForSample(receipt),
    ]));
    const reportByRequest = new Map(run.foregroundRunReport.receipts.map(receipt => [
      receipt.requestId,
      receiptSignatureForSample(receipt),
    ]));
    for (const sample of runningSamples) {
      const frameCount = sample.frameCount;
      const simStepCount = sample.simStepCount;
      const atMs = sample.atMs;
      const lastReceipt = sample.foreground?.lastReceipt;
      if (!Number.isFinite(atMs) || atMs < previousAtMs
        || !Number.isSafeInteger(frameCount) || frameCount < previousFrame
        || !Number.isSafeInteger(simStepCount) || simStepCount < previousSimStep
        || frameCount < initialFrame || simStepCount < initialSimStep) {
        throw new Error('Generation running sample flame timestamps and progress must be finite and non-regressing');
      }
      if (sample.foreground?.completedFrames !== undefined
        && sample.foreground.completedFrames !== frameCount) {
        throw new Error('Generation running sample completed-frame count disagrees with its sampled frame count');
      }
      if (!lastReceipt) {
        if (frameCount !== initialFrame || simStepCount !== initialSimStep) {
          throw new Error('Generation progressed sample lacks its exact foreground receipt');
        }
      } else {
        const receiptFrame = lastReceipt.result?.frameCount;
        const receiptSimStep = lastReceipt.result?.simStepCount;
        const receiptAtMs = lastReceipt.settledAtMs ?? lastReceipt.result?.atMs;
        if (!Number.isSafeInteger(receiptFrame) || !Number.isSafeInteger(receiptSimStep)
          || receiptFrame !== frameCount || receiptSimStep !== simStepCount
          || !Number.isFinite(receiptAtMs) || receiptAtMs > atMs
          || lastReceipt.metadata?.frameCountBefore !== receiptFrame - 1
          || lastReceipt.metadata?.simStepCountBefore !== receiptSimStep - 1) {
          throw new Error('Generation sample foreground receipt frame, simulation count, or timestamp disagrees with the sample');
        }
        const progressed = frameCount > initialFrame || simStepCount > initialSimStep;
        if (progressed && (lastReceipt.runId !== run.runId
          || !lastReceipt.requestId
          || captureByRequest.get(lastReceipt.requestId) !== receiptSignatureForSample(lastReceipt)
          || reportByRequest.get(lastReceipt.requestId) !== receiptSignatureForSample(lastReceipt))) {
          throw new Error('Generation progressed sample foreground receipt request identity disagrees with both authoritative receipt ledgers');
        }
      }
      previousAtMs = atMs;
      previousFrame = frameCount;
      previousSimStep = simStepCount;
    }
    const lastRunningSample = runningSamples.reduce((latest, sample) => sample.atMs > (latest?.atMs ?? -Infinity) ? sample : latest, null);
    const maxSampledFrame = Math.max(...runningSamples.map(sample => sample.frameCount));
    const sampledFrameDelta = maxSampledFrame - initialFrame;
    if (!Number.isSafeInteger(initialFrame)
      || !Number.isFinite(lastRunningSample?.atMs)
      || !Number.isSafeInteger(maxSampledFrame)
      || !Number.isSafeInteger(sampledFrameDelta) || sampledFrameDelta <= 0) {
      throw new Error('Generation sampled progress is not covered by the exact foreground receipt stream');
    }
    const observedFrames = run.foregroundReceipts
      .filter(receipt => receipt.result.atMs <= lastRunningSample.atMs
        && receipt.result.frameCount > initialFrame
        && receipt.result.frameCount <= maxSampledFrame)
      .map(receipt => receipt.result.frameCount)
      .sort((a, b) => a - b);
    if (observedFrames.length !== sampledFrameDelta
      || observedFrames.some((frame, index) => frame !== initialFrame + index + 1)) {
      throw new Error('Generation sampled progress is not covered by the exact foreground receipt stream');
    }
  }
  return run;
}

function receiptSignatureForSample(receipt) {
  return JSON.stringify([
    receipt.schema,
    receipt.routeId,
    receipt.runId,
    receipt.requestId,
    receipt.requestSequence,
    receipt.status,
    receipt.requestedAtMs,
    receipt.startedAtMs,
    receipt.settledAtMs,
    receipt.submissionCount,
    receipt.boundary?.invocationId,
    receipt.boundary?.boundaryId,
    receipt.boundary?.phase,
    receipt.boundary?.position,
    receipt.boundary?.dutyId,
    boundaryKey(receipt.boundary?.metadata),
    receipt.metadata?.frameCountBefore,
    receipt.metadata?.simStepCountBefore,
    receipt.result?.status,
    receipt.result?.atMs,
    receipt.result?.frameCount,
    receipt.result?.simStepCount,
  ]);
}

export function progressFailure({ now, deadline, lastProgressAt, noProgressTimeoutMs, label, totalTimeoutMs }) {
  if (now >= deadline) {
    const error = new Error(`${label} exceeded the bounded ${totalTimeoutMs}ms witness deadline`);
    error.code = 'TIMEOUT';
    return error;
  }
  if (now - lastProgressAt >= noProgressTimeoutMs) {
    const error = new Error(`${label} made no source-owned progress for ${noProgressTimeoutMs}ms`);
    error.code = 'WEDGED';
    return error;
  }
  return null;
}

export async function boundedCleanup(promise, { label, timeoutMs }) {
  let timeoutId = null;
  try {
    return await Promise.race([
      Promise.resolve(promise).then(
        value => ({ status: 'succeeded', value }),
        error => ({ status: 'failed', error: error?.message || String(error) }),
      ),
      new Promise(resolve => {
        timeoutId = setTimeout(() => resolve({
          status: 'timed-out',
          error: `${label} did not settle within ${timeoutMs}ms`,
        }), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId != null) clearTimeout(timeoutId);
  }
}
