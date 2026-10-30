import assert from 'node:assert/strict';

export function assertWorkerDrained(state) {
  assert(state.retention&&typeof state.retention==='object','worker retention diagnostics required');
  assert.equal(state.retention.pending,0,'worker queue must be explicitly drained');
  assert.equal(state.retention.error,null,'worker must explicitly report no retention error');
}
