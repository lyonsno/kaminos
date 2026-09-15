export async function withSamPhaseCleanup(runtime, execute) {
  let result;
  let failed = false;
  let primaryError;
  try {
    result = await execute();
    return result;
  } catch (error) {
    failed = true;
    primaryError = error;
    throw error;
  } finally {
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
