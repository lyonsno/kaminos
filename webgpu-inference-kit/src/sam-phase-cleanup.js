function bindSchedule(runtime, schedule) {
  if (schedule == null) return () => {};
  if (schedule.runtime?.device !== runtime.device || schedule.runtime?.queue !== runtime.queue
      || schedule.invocation?.routeId !== schedule.runtime?.routeId
      || typeof schedule.invocation?.invocationId !== 'string' || !schedule.invocation.invocationId
      || typeof schedule.control?.runDuty !== 'function'
      || typeof schedule.runtime?.prepareCommandDutyAtBoundary !== 'function'
      || typeof schedule.runtime?.settleCommandDuty !== 'function') {
    throw new Error('SAM schedule must bind the admitted invocation, device, queue and control');
  }
  const original = { runKernel: runtime.runKernel, readTensor: runtime.readTensor };
  for (const [method, operation] of Object.entries(original)) {
    runtime[method] = (...args) => schedule.control.runDuty(async () => {
      const duty = await schedule.runtime.prepareCommandDutyAtBoundary({
        phase: args[1]?.stage || args[1]?.commandDuty?.phase || runtime.routeId,
        kind: method === 'runKernel' ? 'compute' : 'readback',
        metadata: { samRouteId: runtime.routeId },
      }, schedule.invocation);
      let result;
      try { result = await operation.apply(runtime, args); }
      catch (error) {
        try { schedule.runtime.settleCommandDuty(duty, { status: 'failed', error }); }
        catch (settlement) { throw new AggregateError([error, settlement], 'SAM duty settlement failed', { cause: error }); }
        throw error;
      }
      schedule.runtime.settleCommandDuty(duty, { status: 'encoded' });
      return result;
    });
  }
  return () => Object.assign(runtime, original);
}

export async function withSamPhaseCleanup(runtime, execute, schedule = null) {
  let result;
  let failed = false;
  let primaryError;
  let restore = () => {};
  try {
    restore = bindSchedule(runtime, schedule);
    if (schedule) await schedule.control.runDuty(async () => {});
    result = await execute();
    return result;
  } catch (error) {
    failed = true;
    primaryError = error;
    throw error;
  } finally {
    restore();
    try {
      const disposal = await runtime.dispose();
      if (!failed) result.resourceDisposal = disposal;
    } catch (cleanupError) {
      if (!failed) throw cleanupError;
      // Frozen or primitive primary failures must still retain their identity.
      try {
        primaryError.cleanupErrors = [...(primaryError.cleanupErrors || []), cleanupError];
      } catch {}
    }
  }
}
