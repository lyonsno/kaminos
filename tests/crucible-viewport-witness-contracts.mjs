import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const witness = readFileSync(new URL('../crucible-viewport-witness.mjs', import.meta.url), 'utf8');

for (const [pattern, message] of [
  [/crucible-viewport-witness\.v0/, 'Witness must name the Crucible viewport contract it emits'],
  [/--url/, 'Witness must accept an explicit Kaminos URL instead of hardcoding a server'],
  [/--out/, 'Witness must let callers choose the screenshot path'],
  [/--report/, 'Witness must let callers choose the JSON report path'],
  [/openGenerateTabExpression[\s\S]*data-tab="generate"[\s\S]*evaluate\(ws, openGenerateTabExpression\)/, 'Witness must open the real Generate tab path'],
  [/id: 'crucible-viewport-workspace'/, 'Witness report must include the requested workspace selector'],
  [/data-crucible-workroom/, 'Witness must verify workroom identity, not just screenshot nonblankness'],
  [/data-crucible-heat-state/, 'Witness must record heat state from the visible surface'],
  [/data-crucible-route-status/, 'Witness must record the effective route status shown by the workroom'],
  [/crucible-worktable-stage/, 'Witness must verify the worktable stage is actually mounted'],
  [/sourceOptionCount/, 'Witness must prove the plate has real source choices'],
  [/sourceSelectionExercise/, 'Witness must prove changing the plate selector changes the effective shared source'],
  [/fireButtonDisabled/, 'Witness must record whether the primary firing action can actually run'],
  [/castButtonDisabled/, 'Witness must record whether the cast action truthfully has a target'],
  [/pointerEvents/, 'Witness must prove the workroom is hittable instead of visually clickable only'],
  [/Page\.captureScreenshot/, 'Witness must capture the actual browser viewport'],
  [/Runtime\.exceptionThrown/, 'Witness must fail loud on browser runtime exceptions'],
  [/primaryOutputWritten/, 'Witness must report whether primary screenshot evidence was written'],
]) {
  assert.match(witness, pattern, message);
}
