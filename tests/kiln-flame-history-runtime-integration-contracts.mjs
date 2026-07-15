#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';

const core = fs.readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');

assert.match(
  core,
  /import \{ createSingleFlameHistoryHoldoverDecision \} from '\.\/kiln-flame-history-holdover\.mjs';/,
  'the volume runtime must consume the tested Wake selector instead of duplicating its policy',
);

assert.match(
  core,
  /async function renderBoundarySplatHistorySlotToCanvas\(options = \{\}\)/,
  'the Crucible runtime must expose the proven draw-only history-slot renderer socket',
);
assert.match(
  core,
  /async function sampleBoundarySplatHistorySlotMetadata\(options = \{\}\)/,
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
assert.match(
  core,
  /async function actuateSingleFlameHistoryHoldoverFrame\(now,[\s\S]*sampleBoundarySplatHistorySlotMetadata\([\s\S]*createSingleFlameHistoryHoldoverDecision\([\s\S]*renderBoundarySplatHistorySlotToCanvas\(\{/,
  'an alternating runtime frame must select only completed metadata and actuate the proven renderer ABI',
);
assert.match(
  core,
  /slotIndex: decision\.selectedHistorySlot\.slotIndex,[\s\S]*historyAllocationGeneration: decision\.selectedHistorySlot\.historyAllocationGeneration,[\s\S]*archiveWriteSequence: decision\.selectedHistorySlot\.archiveWriteSequence/,
  'actuation must carry the exact selected slot identity across the selector-to-renderer boundary',
);
assert.match(
  core,
  /renderFrameAdvanced !== true[\s\S]*sourceRenderFrameAdvanced !== false[\s\S]*simulatorStepAdvanced !== false/,
  'runtime actuation must reject receipts that hide raster, source-frame, or simulator advancement',
);
assert.match(
  core,
  /const attemptHoldover = state\.flameContinuityPresentationOrdinal % 2 === 0;[\s\S]*const useHoldover = holdoverEligible && attemptHoldover;[\s\S]*actuateSingleFlameHistoryHoldoverFrame\(now, \{ stageLedgerFrameId \}\)[\s\S]*renderLiveFrame\(now, \{ preserveContinuityDecision: true, stageLedgerFrameId \}\)/,
  'bounded history must alternate with the ordinary live frame and fail closed back to live simulation',
);
assert.match(
  core,
  /function renderLiveFrame\(now,[\s\S]*const compositorFrameCountBefore = state\.boundarySplatFrameCount;[\s\S]*const sourceRenderFrameCountBefore = state\.frameCount;[\s\S]*const simStepCountBefore = state\.simStepCount;[\s\S]*renderFrameAdvanced: state\.boundarySplatFrameCount > compositorFrameCountBefore,[\s\S]*sourceRenderFrameAdvanced: state\.frameCount !== sourceRenderFrameCountBefore,[\s\S]*simulatorStepAdvanced: state\.simStepCount !== simStepCountBefore/,
  'live and fail-closed frames must derive each advancement claim from the clocks that actually moved',
);
assert.match(
  core,
  /if \(preserveContinuityDecision\) \{[\s\S]*state\.flameContinuityEvidence = \{[\s\S]*\.\.\.state\.flameContinuityEvidence,[\s\S]*\.\.\.continuityClockEvidence,[\s\S]*\};[\s\S]*\} else \{[\s\S]*liveFlameContinuityDecision\(continuityClockEvidence\);/,
  'a fail-closed live frame must replace attempted holdover clock claims with its observed advancement',
);
assert.match(
  core,
  /flameContinuityRequested:[\s\S]*flameContinuityEffective:[\s\S]*flameContinuityDecision:[\s\S]*flameContinuityEvidence:/,
  'terminal state must preserve requested/effective policy and the latest selector and actuation evidence',
);
assert.match(
  core,
  /beginFireEpisode\(options\) \{[\s\S]*flameContinuityPresentationOrdinal = 0;[\s\S]*flameContinuityDecision = null;[\s\S]*flameContinuityLastHoldoverDecision = null;[\s\S]*flameContinuityEvidence = null;/,
  'a new exact firing must not inherit the prior firing holdover cursor or counters',
);

console.log('kiln flame history runtime integration contracts passed');
