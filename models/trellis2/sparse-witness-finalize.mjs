// Cleanup errors must not erase the last trustworthy execution phase/error.
// The ENOTEMPTY signal is observed in the native-cabd7564 run, not a GPU pass.
import { createHash } from 'node:crypto';

// Preserve the complete browser result outside the CDP return message. Losing
// that transport still fails the run, but cannot erase its primary evidence.
export async function persistSparseWitnessResult({ report, bytes, outputPath, write }) {
  const value = JSON.parse(bytes.toString('utf8'));
  if (!value || !['succeeded', 'failed'].includes(value.status)) throw new Error('browser result status is missing or invalid');
  const receipt = { path: outputPath, byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  await write(outputPath, bytes);
  report.result = value;
  report.browserResult = receipt;
  return receipt;
}

export function admitSparseWitnessResult(report, receipt) {
  if (!report.result || !report.browserResult) throw new Error('durable browser result is absent');
  if (!receipt || receipt.path !== report.browserResult.path || receipt.byteLength !== report.browserResult.byteLength ||
    receipt.sha256 !== report.browserResult.sha256) throw new Error('browser result receipt mismatch');
  return report.result;
}

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
