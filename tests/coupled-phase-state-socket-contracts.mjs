import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const domainModuleUrl = new URL('../coupled-smoke-domain.mjs', import.meta.url);
const domainSource = await readFile(domainModuleUrl, 'utf8').catch(() => '');
const core = await readFile(new URL('../volume-core.js', import.meta.url), 'utf8');

assert.match(
  domainSource,
  /export const COUPLED_PHASE_STATE_SOCKET_IDENTITY = 'coupled-near-far-phase-state-socket-v0'/,
  'coupled smoke must expose a stable renderer-neutral phase-state socket identity',
);

const {
  COUPLED_PHASE_STATE_FAR_LAYOUT,
  COUPLED_PHASE_STATE_HISTORY_AUTHORITY,
  COUPLED_PHASE_STATE_NEAR_LAYOUT,
  COUPLED_PHASE_STATE_PRODUCER_IDENTITY,
  COUPLED_PHASE_STATE_RENDERER_AUTHORITY,
  COUPLED_PHASE_STATE_SCHEMA,
  COUPLED_PHASE_STATE_SOCKET_IDENTITY,
  createCoupledSmokePhaseStateDescriptor,
} = await import(domainModuleUrl);

assert.equal(COUPLED_PHASE_STATE_SOCKET_IDENTITY, 'coupled-near-far-phase-state-socket-v0');
assert.equal(COUPLED_PHASE_STATE_SCHEMA, 'kaminos.coupled-smoke.phase-state.v0');
assert.equal(COUPLED_PHASE_STATE_PRODUCER_IDENTITY, 'native-near-far-fluid-state-export-v0');
assert.equal(COUPLED_PHASE_STATE_NEAR_LAYOUT, 'fluid-4xvec4f-per-cell-v0');
assert.equal(COUPLED_PHASE_STATE_FAR_LAYOUT, 'velocity-density-extinction-proxy-vec4f-per-cell-v0');
assert.equal(COUPLED_PHASE_STATE_HISTORY_AUTHORITY, 'current-state-only-no-fabricated-phase-history-v0');
assert.equal(COUPLED_PHASE_STATE_RENDERER_AUTHORITY, 'renderer-neutral-state-only-v0');

const nearBuffer = { label: 'near-live-fluid-buffer' };
const farBuffer = { label: 'far-live-smoke-buffer' };
const descriptor = createCoupledSmokePhaseStateDescriptor({
  active: true,
  generation: 7,
  retainedHistoryEpoch: 7,
  writeTick: 41,
  nearGrid: 96,
  farGrid: 48,
  nearBuffer,
  farBuffer,
  farBufferIndex: 1,
  expectedGeneration: 7,
  expectedRetainedHistoryEpoch: 7,
  expectedWriteTick: 41,
});

assert.equal(descriptor.schema, COUPLED_PHASE_STATE_SCHEMA);
assert.equal(descriptor.socketIdentity, COUPLED_PHASE_STATE_SOCKET_IDENTITY);
assert.equal(descriptor.producerIdentity, COUPLED_PHASE_STATE_PRODUCER_IDENTITY);
assert.deepEqual(descriptor.phase.token, {
  generation: 7,
  retainedHistoryEpoch: 7,
  writeTick: 41,
});
assert.equal(descriptor.phase.retainedSlotCount, 1);
assert.equal(descriptor.phase.historyOffset, 0);
assert.equal(descriptor.phase.currentFarStateIndex, 1);
assert.equal(descriptor.phase.retainedHistoryAuthority, COUPLED_PHASE_STATE_HISTORY_AUTHORITY);
assert.equal(descriptor.phase.writeTickAuthority, 'command-encoded-order-not-queue-completion-v0');
assert.equal(descriptor.domains.near.buffer, nearBuffer, 'near GPU state must pass through by exact reference');
assert.equal(descriptor.domains.far.buffer, farBuffer, 'far GPU state must pass through by exact reference');
assert.equal(descriptor.domains.near.bufferLayout.identity, COUPLED_PHASE_STATE_NEAR_LAYOUT);
assert.equal(descriptor.domains.near.bufferLayout.bytesPerCell, 64);
assert.equal(descriptor.domains.near.witnesses.materialTemperature.availability, 'source-fields-present');
assert.equal(
  descriptor.domains.near.witnesses.materialTemperature.temperatureAuthority,
  'normalized-simulation-heat-witness-not-kelvin-v0',
);
assert.deepEqual(descriptor.domains.near.unitFromWorld, {
  scale: [0.5, 0.5, 0.5],
  offset: [0.5, 0.5, 0.5],
});
assert.equal(descriptor.domains.far.bufferLayout.identity, COUPLED_PHASE_STATE_FAR_LAYOUT);
assert.equal(descriptor.domains.far.bufferLayout.bytesPerCell, 16);
assert.equal(descriptor.domains.far.witnesses.materialTemperature.availability, 'unavailable');
assert.deepEqual(descriptor.domains.far.unitFromWorld, {
  scale: [0.25, 0.25, 0.25],
  offset: [0.5, -0.125, 0.5],
});
assert.equal(descriptor.overlap.authority, 'near-authoritative-overlap-far-residual-v0');
assert.equal(descriptor.overlap.depthContract, 'splat-depth-conditioned-front-back-near-far-smoke-intervals-v1');
assert.deepEqual(descriptor.overlap.axisIntervals, {
  x: [-1, 1],
  y: [0.5, 1],
  z: [-1, 1],
});
assert.equal(descriptor.renderer.authority, COUPLED_PHASE_STATE_RENDERER_AUTHORITY);
assert.equal(descriptor.renderer.ownsRasterization, false);
assert.equal(descriptor.renderer.ownsPhaseSlotCache, false);
assert.equal(
  descriptor.renderer.consumerSynchronization,
  'same-device-queue-order-or-explicit-onSubmittedWorkDone-v0',
);

const baseArgs = {
  active: true,
  generation: 3,
  retainedHistoryEpoch: 3,
  writeTick: 8,
  nearGrid: 64,
  farGrid: 24,
  nearBuffer,
  farBuffer,
  farBufferIndex: 0,
};

assert.throws(
  () => createCoupledSmokePhaseStateDescriptor({ ...baseArgs, historyOffset: 1 }),
  /history offset 1 unavailable/,
  'the socket must not substitute current smoke for an unretained phase slot',
);
assert.throws(
  () => createCoupledSmokePhaseStateDescriptor({ ...baseArgs, expectedGeneration: 2 }),
  /stale generation: expected 2, effective 3/,
);
assert.throws(
  () => createCoupledSmokePhaseStateDescriptor({ ...baseArgs, expectedRetainedHistoryEpoch: 2 }),
  /stale retained-history epoch: expected 2, effective 3/,
);
assert.throws(
  () => createCoupledSmokePhaseStateDescriptor({ ...baseArgs, expectedWriteTick: 7 }),
  /stale write tick: expected 7, effective 8/,
);
assert.throws(
  () => createCoupledSmokePhaseStateDescriptor({ ...baseArgs, active: false }),
  /socket inactive/,
);
assert.throws(
  () => createCoupledSmokePhaseStateDescriptor({ ...baseArgs, farBuffer: null }),
  /farBuffer is unavailable/,
);

assert.match(core, /getCoupledSmokePhaseState\(options = \{\}\)/, 'prototype exposes the renderer-neutral socket');
assert.match(core, /fluidBuffers\[currentFluid\]/, 'socket resolves the live near-fluid ping-pong state');
assert.match(core, /smokeDomainFarStateBuffers\[currentSmokeDomainFarState\]/, 'socket resolves the live far-smoke ping-pong state');
assert.match(core, /coupledPhaseStateGeneration/, 'debug state exposes socket generation');
assert.match(core, /coupledPhaseStateRetainedHistoryEpoch/, 'debug state exposes the retained-history epoch');
assert.match(core, /coupledPhaseStateWriteTick/, 'debug state exposes the current write tick');

console.log('coupled phase state socket contracts passed');
