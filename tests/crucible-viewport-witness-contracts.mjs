import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const witness = readFileSync(new URL('../crucible-viewport-witness.mjs', import.meta.url), 'utf8');

for (const [pattern, message] of [
  [/crucible-viewport-witness\.v0/, 'Witness must name the Crucible viewport contract it emits'],
  [/--url/, 'Witness must accept an explicit Kaminos URL instead of hardcoding a server'],
  [/--out/, 'Witness must let callers choose the screenshot path'],
  [/--report/, 'Witness must let callers choose the JSON report path'],
  [/--fire-friendly/, 'Witness must expose an explicit opt-in real Friendly firing mode'],
  [/--expected-sharp-revision/, 'Full-route witness must accept the exact expected SHARP source revision'],
  [/openGenerateTabExpression[\s\S]*data-tab="generate"[\s\S]*evaluate\(ws, openGenerateTabExpression\)/, 'Witness must open the real Generate tab path'],
  [/id: 'crucible-viewport-workspace'/, 'Witness report must include the requested workspace selector'],
  [/data-crucible-workroom/, 'Witness must verify workroom identity, not just screenshot nonblankness'],
  [/data-crucible-heat-state/, 'Witness must record heat state from the visible surface'],
  [/data-crucible-route-status/, 'Witness must record the effective route status shown by the workroom'],
  [/crucible-worktable-stage/, 'Witness must verify the worktable stage is actually mounted'],
  [/sourceOptionCount/, 'Witness must prove the plate has real source choices'],
  [/sourceSelectionExercise/, 'Witness must prove changing the plate selector changes the effective shared source'],
  [/backgroundHeartbeat/, 'Full-route witness mode must preserve the corrected heartbeat receipt'],
  [/inferenceWindow/, 'Full-route witness mode must fail if the measured inference window is absent'],
  [/worstFrameGaps/, 'Full-route witness mode must fail if scoped gap rows are absent'],
  [/volumeReleased/, 'Full-route witness mode must verify the furnace releases after the cast lands'],
  [/cpuChunkItems/, 'Full-route witness must verify the effective cooperative CPU chunk size'],
  [/routeTailYieldMs/, 'Full-route witness must verify the effective route-tail yield'],
  [/routeTailCheckpointEvents/, 'Full-route witness must require observed prep and Gaussian compose checkpoints'],
  [/fireButtonDisabled/, 'Witness must record whether the primary firing action can actually run'],
  [/castButtonDisabled/, 'Witness must record whether the cast action truthfully has a target'],
  [/pointerEvents/, 'Witness must prove the workroom is hittable instead of visually clickable only'],
  [/Page\.captureScreenshot/, 'Witness must capture the actual browser viewport'],
  [/Runtime\.exceptionThrown/, 'Witness must fail loud on browser runtime exceptions'],
  [/primaryOutputWritten/, 'Witness must report whether primary screenshot evidence was written'],
  [/lastTrustworthyEvidence/, 'Witness failures after inference must preserve the last trustworthy route and heartbeat evidence'],
]) {
  assert.match(witness, pattern, message);
}
