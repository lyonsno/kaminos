import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');

assert.match(
  core,
  /createKaminosVolumePrototype\(\{[\s\S]{0,180}gpuContext\s*=\s*null/,
  'the product volume constructor must accept caller-owned GPU state for the embedded SHARP route',
);
assert.match(
  core,
  /let gpuInitialized = false;/,
  'the renderer must track completed GPU setup separately from device presence',
);
assert.match(
  core,
  /async function ensureGpu\(\) \{[\s\S]{0,120}if \(gpuInitialized\) return;/,
  'an injected device must still pass through one-time canvas and pipeline initialization',
);
assert.match(
  core,
  /if \(!device\) \{[\s\S]{0,2000}navigator\.gpu\.requestAdapter[\s\S]{0,2000}adapter\.requestDevice/,
  'the renderer must request a device only when the caller did not inject one',
);
assert.match(
  core,
  /requiredLimits\.maxBufferSize\s*=\s*adapter\.limits\.maxBufferSize[\s\S]{0,500}requiredLimits\.maxStorageBufferBindingSize\s*=\s*adapter\.limits\.maxStorageBufferBindingSize/,
  'the product-owned device must request SHARP-sized buffers before it becomes the shared volume/inference device',
);
for (const limit of [
  'maxComputeWorkgroupStorageSize',
  'maxComputeInvocationsPerWorkgroup',
  'maxComputeWorkgroupSizeX',
  'maxComputeWorkgroupSizeY',
]) {
  assert.match(
    core,
    new RegExp(`requiredLimits\\.${limit}\\s*=\\s*adapter\\.limits\\.${limit}`),
    `the shared device must preserve SHARP's ${limit} requirement`,
  );
}
assert.match(
  core,
  /async function setForegroundOpportunityMode\(active\)[\s\S]{0,500}if \(active === true && activeHoldoverRenderPromise\)[\s\S]{0,300}await activeHoldoverRenderPromise[\s\S]{0,500}fireEpisodeFramesQuiescing = active === true[\s\S]{0,300}cancelAnimationFrame\(raf\)/,
  'foreground-driven rendering must let an in-flight holdover settle before stopping the ordinary volume RAF',
);
assert.match(
  core,
  /function renderLiveFrame\(now, \{[\s\S]{0,250}submitCommandBuffers = null/,
  'the actual live kiln frame encoder must accept the foreground submission lease',
);
assert.match(
  core,
  /const commandBuffer = encoder\.finish\(\);[\s\S]{0,700}submitCommandBuffers\(\[commandBuffer\],/,
  'the lease must receive the real command buffer finished by volume-core',
);
assert.match(
  core,
  /async function renderForegroundOpportunityFrame\(options = \{\}\)[\s\S]{0,4000}renderLiveFrame\([\s\S]{0,500}submitCommandBuffers: options\.submit/,
  'the public foreground method must invoke the ordinary real-frame encoder with the kit lease',
);
assert.match(
  core,
  /function nextForegroundOpportunityFrameId\([\s\S]{0,500}state\.flameContinuityPresentationOrdinal \+ 1/,
  'the hook must reserve the exact next canonical ledger identity instead of inventing a parallel frame namespace',
);
assert.match(
  core,
  /async function renderForegroundOpportunityFrame\(options = \{\}\)[\s\S]{0,2600}flameContinuityPresentationOrdinal \+= 1[\s\S]{0,1200}kilnFrameStageLedger\.beginFrame\([\s\S]{0,1200}stageLedgerFrameId !== frameId[\s\S]{0,1800}renderLiveFrame/,
  'a lease-driven frame must open and verify its canonical ledger row before real encoding and submission',
);
assert.match(
  core,
  /recordKilnFrameStage\([\s\S]{0,200}stageLedgerFrameId,[\s\S]{0,200}'volume-raf',[\s\S]{0,300}'sharp-same-device-submission-lease'/,
  'the leased frame must enter the closed ledger vocabulary as a volume RAF equivalent with explicit lease authority',
);
assert.match(
  core,
  /async function renderForegroundOpportunityFrame\(options = \{\}\)[\s\S]{0,1800}recordPresentationOpportunity\(lastKilnFrameStageId,[\s\S]{0,500}authority: 'sharp-foreground-opportunity-request'[\s\S]{0,300}lastKilnFrameStageId = null[\s\S]{0,1000}beginFrame\(/,
  'each leased request must receipt the preceding frame presentation opportunity before opening its own ledger row',
);
assert.match(
  core,
  /schema: 'kaminos\.volume-foreground-frame-receipt\.v0'[\s\S]{0,700}encoderIdentity: 'volume-core\.renderLiveFrame'[\s\S]{0,500}commandBufferCount: 1/,
  'the foreground receipt must identify the actual encoder and one submitted command buffer',
);
assert.match(
  core,
  /foregroundGpuContext\(\)[\s\S]{0,700}schema: 'kaminos\.volume-foreground-gpu-context\.v0'[\s\S]{0,500}device,[\s\S]{0,200}queue: device\.queue/,
  'the public volume API must expose object-identical device and queue ownership to the hook gate',
);
assert.match(
  core,
  /setForegroundOpportunityMode,[\s\S]{0,300}nextForegroundOpportunityFrameId,[\s\S]{0,300}renderForegroundOpportunityFrame,[\s\S]{0,300}foregroundGpuContext,/,
  'the product prototype must expose the complete foreground integration sockets together',
);

console.log('volume foreground opportunity contracts passed');
