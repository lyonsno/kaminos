#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';

const core = fs.readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');

assert.match(
  core,
  /async function renderBoundarySplatHistorySlotToCanvas\(options = \{\}\)/,
  'the Crucible runtime must expose the proven draw-only history-slot renderer socket',
);
assert.match(
  core,
  /async function sampleBoundarySplatHistorySlotMetadata\(\)/,
  'holdover must select only GPU-completed history slot metadata',
);
assert.match(
  core,
  /@group\(0\) @binding\(11\) var<uniform> boundarySplatHistoryArchiveControl/,
  'CPU archive control must remain uniform authority within WebGPU storage limits',
);
assert.match(
  core,
  /@group\(0\) @binding\(12\) var<storage, read_write> boundarySplatHistorySlotMetadata/,
  'the GPU archive must author per-slot completion metadata',
);
assert.match(
  core,
  /simulationSubmitted:\s*false[\s\S]*sidecarSubmitted:\s*false[\s\S]*compactionSubmitted:\s*false[\s\S]*archiveSubmitted:\s*false/,
  'a held frame must explicitly deny every source-progression submission',
);
assert.match(
  core,
  /\.\.\.\(options\.controlOverrides[\s\S]{0,300}boundarySplatInstances:\s*1/,
  'the renderer must force one flame after applying caller overrides',
);
assert.match(
  core,
  /sampleBoundarySplatHistorySlotMetadata,[\s\S]{0,500}renderBoundarySplatHistorySlotToCanvas,/,
  'the public prototype must expose metadata inspection and draw-only holdover rendering',
);
assert.match(
  core,
  /const compositorFrameCountBefore = state\.boundarySplatFrameCount;[\s\S]{0,7000}renderFrameCount: state\.boundarySplatFrameCount,[\s\S]{0,500}renderFrameAdvanced: state\.boundarySplatFrameCount > compositorFrameCountBefore/,
  'holdover evidence must report the compositor frame that actually advances',
);
assert.match(
  core,
  /sourceRenderFrameCountBefore,[\s\S]{0,500}sourceRenderFrameCount: state\.frameCount,[\s\S]{0,500}sourceRenderFrameAdvanced: state\.frameCount !== sourceRenderFrameCountBefore/,
  'holdover evidence must separately report the frozen source render clock',
);
assert.match(
  core,
  /simStepCountBefore,[\s\S]{0,500}simStepCount: state\.simStepCount,[\s\S]{0,500}simulatorStepAdvanced: state\.simStepCount !== simStepCountBefore/,
  'holdover evidence must separately report the frozen simulator clock',
);

console.log('kiln flame history runtime integration contracts passed');
