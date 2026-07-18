import assert from 'node:assert/strict';

import {
  createSharpSameDeviceKilnOpportunityHook,
} from '../lib/sharp-same-device-kiln-interlock.mjs';

function makeHarness(overrides = {}) {
  const device = {};
  const queue = {};
  let renderCalls = 0;
  const volume = {
    foregroundGpuContext() {
      return {
        schema: 'kaminos.volume-foreground-gpu-context.v0',
        device,
        queue,
        deviceIdentity: 'product-volume-device',
        queueIdentity: 'product-volume-queue',
      };
    },
    async renderForegroundOpportunityFrame(input) {
      renderCalls += 1;
      const commandBuffer = { identity: 'real-volume-core-command-buffer' };
      const submission = input.submit([commandBuffer], {
        submissionId: `${input.requestId}:kiln-submit`,
        metadata: {
          firingId: input.firingId,
          frameId: input.frameId,
          encoderIdentity: 'volume-core.renderLiveFrame',
        },
      });
      return {
        schema: 'kaminos.volume-foreground-frame-receipt.v0',
        status: 'submitted',
        firingId: input.firingId,
        frameId: input.frameId,
        requestId: input.requestId,
        encoderIdentity: 'volume-core.renderLiveFrame',
        commandBufferCount: 1,
        submission,
      };
    },
    ...overrides,
  };
  return { device, queue, volume, renderCalls: () => renderCalls };
}

const harness = makeHarness();
const hook = createSharpSameDeviceKilnOpportunityHook({
  volume: harness.volume,
  firingId: 'firing-titan-hammer-01',
  nextFrameId: () => 'firing-titan-hammer-01:frame:17',
});
const requestInput = hook({
  routeId: 'sharp.image-to-splat.webgpu-local.v0',
  runId: 'sharp-run-shared-device-01',
  stage: 'spn',
  phase: 'spn',
  boundary: 'before-encode',
  dutyId: 'spn-patch-17',
  device: harness.device,
  queue: harness.queue,
});

assert.equal(requestInput.requestId, 'firing-titan-hammer-01:frame:17');
assert.equal(requestInput.metadata.workloadIdentity, 'actual-volume-core-kiln-frame-v0');
assert.equal(requestInput.metadata.deviceIdentity, 'product-volume-device');
assert.equal(requestInput.metadata.queueIdentity, 'product-volume-queue');

const submitted = [];
const receipt = await requestInput.run({
  device: harness.device,
  queue: harness.queue,
  signal: new AbortController().signal,
  submit(commandBuffers, submissionInput) {
    submitted.push({ commandBuffers, submissionInput });
    return {
      submissionId: submissionInput.submissionId,
      commandBufferCount: commandBuffers.length,
      submissionStatus: 'queue-submit-returned',
    };
  },
});

assert.equal(harness.renderCalls(), 1);
assert.equal(submitted.length, 1);
assert.equal(submitted[0].commandBuffers.length, 1);
assert.equal(submitted[0].commandBuffers[0].identity, 'real-volume-core-command-buffer');
assert.equal(receipt.status, 'submitted');
assert.equal(receipt.firingId, 'firing-titan-hammer-01');
assert.equal(receipt.frameId, 'firing-titan-hammer-01:frame:17');
assert.equal(receipt.encoderIdentity, 'volume-core.renderLiveFrame');
assert.equal(receipt.commandBufferCount, 1);

const separateDevice = makeHarness();
const separateHook = createSharpSameDeviceKilnOpportunityHook({
  volume: separateDevice.volume,
  firingId: 'firing-separate-device',
  nextFrameId: () => 'firing-separate-device:frame:1',
});
assert.throws(
  () => separateHook({
    routeId: 'sharp.image-to-splat.webgpu-local.v0',
    runId: 'sharp-run-wrong-device',
    stage: 'spn',
    phase: 'spn',
    boundary: 'before-encode',
    dutyId: 'spn-patch-1',
    device: {},
    queue: separateDevice.queue,
  }),
  /device identity mismatch/,
);

const noOp = makeHarness({
  async renderForegroundOpportunityFrame(input) {
    return {
      schema: 'kaminos.volume-foreground-frame-receipt.v0',
      status: 'submitted',
      firingId: input.firingId,
      frameId: input.frameId,
      requestId: input.requestId,
      encoderIdentity: 'synthetic-no-op',
      commandBufferCount: 0,
      submission: null,
    };
  },
});
const noOpRequest = createSharpSameDeviceKilnOpportunityHook({
  volume: noOp.volume,
  firingId: 'firing-no-op',
  nextFrameId: () => 'firing-no-op:frame:1',
})({
  routeId: 'sharp.image-to-splat.webgpu-local.v0',
  runId: 'sharp-run-no-op',
  stage: 'vit',
  phase: 'vit',
  boundary: 'before-encode',
  dutyId: 'vit-block-1',
  device: noOp.device,
  queue: noOp.queue,
});
await assert.rejects(
  () => noOpRequest.run({
    device: noOp.device,
    queue: noOp.queue,
    signal: new AbortController().signal,
    submit() {
      throw new Error('no-op workload must not reach submit');
    },
  }),
  /actual volume-core kiln frame receipt/,
);

console.log('SHARP same-device kiln interlock contracts passed');
