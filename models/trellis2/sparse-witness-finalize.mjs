// Cleanup errors must not erase the last trustworthy execution phase/error.
// The ENOTEMPTY signal is observed in the native-cabd7564 run, not a GPU pass.
export async function finalizeSparseWitness({ report, cleanup, persist }) {
  for (const [phase, action] of cleanup) {
    try { await action(); }
    catch (error) {
      report.cleanupErrors ||= [];
      report.cleanupErrors.push({ phase, code: error.code || null, message: error.message });
    }
  }
  if (report.cleanupErrors?.length) {
    report.status = 'failed';
    report.phase ||= 'cleanup';
    report.error ||= { message: 'witness cleanup failed; see cleanupErrors' };
  }
  report.finishedAt = new Date().toISOString();
  await persist();
}
