import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const witnessUrl = new URL('../volume-raymarch-filament-orbit-witness.mjs', import.meta.url);
const witnessPath = fileURLToPath(witnessUrl);

assert.ok(existsSync(witnessPath), 'Wave One filament-orbit witness implementation must exist');
const witness = readFileSync(witnessPath, 'utf8');

assert.match(witness, /kaminos\.volume\.raymarch-filament-orbit-witness\.v0/, 'witness publishes a stable schema');
assert.match(witness, /sameStateCaptureId/, 'witness pins one exact simulator state across the orbit');
assert.match(witness, /advanceSim:\s*false/, 'witness forbids simulator evolution during capture');
assert.match(witness, /setRaymarchSmokePresentationMode\(['"]off['"]\)/, 'witness explicitly disables raymarch smoke');
assert.match(witness, /rayStepCounts/, 'witness exercises multiple requested ray-step counts');
assert.match(witness, /effectiveRaySteps/, 'witness records effective ray-step identity');
assert.match(witness, /kaminosSetCameraDebugPose/, 'witness drives a controlled camera orbit');
assert.match(witness, /cameraPoseHash/, 'witness preserves every effective camera pose');
assert.match(witness, /stateDerivedSupport/, 'witness preserves state-derived filament support evidence');
assert.match(witness, /nonRidgeFilaments/, 'witness captures the exact non-ridge filament target separately from ridge-owned support');
assert.match(witness, /nonnegative-non-ridge-flame-emission-coefficient-v0/, 'witness pins the non-ridge emission target identity');
assert.match(witness, /analyticSplat/, 'witness compares available analytic splats');
assert.match(witness, /filamentContinuity/, 'witness measures filament disappearance and width change');
assert.match(witness, /rayStepAppearance/, 'witness quantifies same-state radiance and width changes across ray-step budgets');
assert.match(witness, /adjacentCameraDelta/, 'witness quantifies image change along the controlled camera path');
assert.match(witness, /rejectFalseClosure/, 'witness centralizes evidence rejection');
assert.match(witness, /requested\/effective route disagreement/, 'witness rejects route substitution');
assert.match(witness, /requested\/effective ray-step disagreement/, 'witness rejects stale or default quality');
assert.match(witness, /simulator state changed during frozen orbit/, 'witness rejects state evolution masquerading as camera flicker');
assert.match(witness, /missing, partial, or blank capture/, 'witness rejects absent visual evidence');
assert.match(witness, /cached or static output pretending to be live/, 'witness rejects replayed capture evidence');
assert.match(witness, /renderer fallback/, 'witness rejects effective fallback');
assert.match(witness, /failurePhase/, 'witness writes phase-specific failure receipts');
assert.match(witness, /lastTrustworthyEvidence/, 'witness preserves pre-failure evidence');
assert.match(witness, /item\.indexOf\(['"]=['"]\)/, 'witness accepts equals-form CLI arguments without silently using defaults');
assert.match(witness, /unknown argument/, 'witness rejects unknown CLI options instead of ignoring them');

console.log('raymarch filament orbit witness contracts passed');
