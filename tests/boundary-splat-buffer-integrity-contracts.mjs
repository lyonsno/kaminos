import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const coreSource = await readFile(new URL('../volume-core.js', import.meta.url), 'utf8');
const witnessSource = await readFile(new URL('../volume-boundary-splat-pbr-witness.mjs', import.meta.url), 'utf8');
const core = await import('../volume-core.js');

assert.equal(typeof core.boundarySplatBufferIntegrity, 'function', 'runtime must expose a deterministic buffer-integrity audit instead of equating zero compaction overflow with all buffers being safe');
assert.equal(typeof core.boundarySplatHistoryAgeFrames, 'function', 'runtime must expose exact physical history age under a stride-compressed ring');
assert.equal(typeof core.boundarySplatDeviceCandidateCapacity, 'function', 'capacity growth must preflight the physical history allocation against WebGPU device limits');

assert.equal(core.boundarySplatDeviceCandidateCapacity({
  maxBufferSize: 268_435_456,
  maxStorageBufferBindingSize: 262_144_000,
}), 341_333, 'device candidate ceiling must account for all 16 physically allocated history slots');
assert.equal(core.boundarySplatDeviceCandidateCapacity({
  maxBufferSize: 64 * 1024 * 1024,
  maxStorageBufferBindingSize: 64 * 1024 * 1024,
}), 87_381, 'smaller devices must be bounded by the whole history allocation, not one candidate buffer');

assert.equal(core.boundarySplatHistoryAgeFrames(0, 8, 3575), 0, 'current-control history must remain current');
assert.equal(core.boundarySplatHistoryAgeFrames(5, 8, 3575), 40, 'end-of-stride history age must match the nominal five-slot offset');
assert.equal(core.boundarySplatHistoryAgeFrames(5, 8, 3568), 33, 'start-of-stride history age must disclose the physical slot overwrite age instead of claiming a false 40-frame offset');
assert.equal(core.boundarySplatHistoryAgeFrames(15, 8, 3568), 113, 'oldest physical history age must remain truthful at the start of a stride block');

const healthy = core.boundarySplatBufferIntegrity({
  candidateCapacity: 131072,
  candidateCount: 3217,
  sourceCandidateCount: 3217,
  historySlotCount: 16,
  historyWriteSlot: 14,
  requestedInstanceCount: 100,
  renderedInstanceCount: 320255,
  descriptorCapacity: 128,
  maxBufferSize: 1_073_741_824,
  maxStorageBufferBindingSize: 1_073_741_824,
});
assert.equal(healthy.ok, true, 'observed 100-flame dimensions must be index- and device-limit-safe');
assert.equal(healthy.identity, 'boundary-splat-buffer-integrity-v0');
assert.equal(healthy.candidateBufferBytes, 6_291_456);
assert.equal(healthy.historyBufferBytes, 100_663_296);
assert.equal(healthy.maxHistoryIndex, 1_969_296);
assert.deepEqual(healthy.failureReasons, []);

const shallowActiveHistory = core.boundarySplatBufferIntegrity({
  candidateCapacity: 131072,
  candidateCount: 3217,
  sourceCandidateCount: 3217,
  historySlotCount: 4,
  allocatedHistorySlotCount: 16,
  historyWriteSlot: 3,
  requestedInstanceCount: 100,
  renderedInstanceCount: 320255,
  descriptorCapacity: 128,
  maxBufferSize: 268_435_456,
  maxStorageBufferBindingSize: 262_144_000,
});
assert.equal(shallowActiveHistory.historySlotCount, 4, 'active history depth must remain the addressing authority');
assert.equal(shallowActiveHistory.allocatedHistorySlotCount, 16, 'diagnostics must expose the physically allocated ring depth');
assert.equal(shallowActiveHistory.historyBufferBytes, 100_663_296, 'allocation accounting must not shrink when controls expose fewer active history slots');
assert.equal(shallowActiveHistory.maxHistoryIndex, 396_432, 'active address ceiling must remain bounded by the configured history depth');

const unavailable = core.boundarySplatBufferIntegrity({
  candidateCapacity: 131072,
  candidateCount: null,
  sourceCandidateCount: null,
  historySlotCount: 16,
  historyWriteSlot: 0,
  requestedInstanceCount: 100,
  renderedInstanceCount: null,
  descriptorCapacity: 128,
  maxBufferSize: 268_435_456,
  maxStorageBufferBindingSize: 262_144_000,
});
assert.equal(unavailable.ok, false, 'missing post-submit GPU counts must never masquerade as a healthy empty buffer');
assert.deepEqual(unavailable.failureReasons, [
  'candidate-count-unavailable',
  'source-candidate-count-unavailable',
  'rendered-instance-count-unavailable',
]);

const unsafe = core.boundarySplatBufferIntegrity({
  candidateCapacity: 131072,
  candidateCount: 131073,
  sourceCandidateCount: 131073,
  historySlotCount: 16,
  historyWriteSlot: 16,
  requestedInstanceCount: 129,
  renderedInstanceCount: 2 ** 32,
  descriptorCapacity: 128,
  maxBufferSize: 64 * 1024 * 1024,
  maxStorageBufferBindingSize: 64 * 1024 * 1024,
});
assert.equal(unsafe.ok, false, 'audit must reject silent candidate, history-slot, descriptor, draw-count, and device-limit overflow together');
assert.deepEqual(unsafe.failureReasons, [
  'candidate-count-exceeds-capacity',
  'source-candidate-count-exceeds-capacity',
  'history-write-slot-out-of-range',
  'requested-instance-count-exceeds-descriptor-capacity',
  'rendered-instance-count-exceeds-u32',
  'history-buffer-exceeds-max-buffer-size',
  'history-buffer-exceeds-max-storage-binding-size',
]);

assert.match(coreSource, /boundarySplatBufferIntegrity:\s*bufferIntegrity/, 'debug state must publish the full integrity record');
assert.match(coreSource, /function ensureBoundarySplatBuffers\(\)[\s\S]*boundarySplatCapacity\s*=\s*Math\.min\([\s\S]*boundarySplatDeviceCandidateCapacity/, 'initial and rebuilt history allocation must apply the device candidate ceiling before createBuffer');
assert.match(coreSource, /boundarySplatPhysicalHistoryAgeFrames/, 'runtime telemetry must distinguish physical frame age from nominal slot-stride labels');
assert.match(coreSource, /boundarySplatBufferIntegrityFailureReason/, 'runtime must fail loud when a non-compaction buffer invariant is violated');
assert.match(witnessSource, /boundary-splat-buffer-integrity-v0/, 'PBR witness must require the exact buffer-integrity identity');
assert.match(witnessSource, /boundarySplatBufferIntegrity\?\.ok !== true/, 'PBR witness must reject missing or failed integrity instead of trusting zero compaction overflow');
assert.match(witnessSource, /boundarySplatBufferIntegrityFailureReason/, 'PBR witness must preserve the effective non-compaction failure reason');

console.log('boundary splat buffer integrity contracts passed');
