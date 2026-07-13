import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const core = await readFile(new URL('../volume-core.js', import.meta.url), 'utf8');
const page = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const pbrWitness = await readFile(new URL('../volume-boundary-splat-pbr-witness.mjs', import.meta.url), 'utf8');

assert.match(
  core,
  /BOUNDARY_SPLAT_SELECTOR_BUDGETS\s*=\s*\[0,\s*6400,\s*3200,\s*1600,\s*800\]/,
  'candidate-budget contract includes an explicit uncapped source-preserving mode',
);
assert.match(
  core,
  /function normalizeBoundarySplatCandidateBudget[\s\S]*return BOUNDARY_SPLAT_SELECTOR_BUDGETS\.includes\(requested\) \? requested : 0/,
  'missing or unsupported budgets normalize to uncapped instead of a hidden cap',
);
assert.match(
  core,
  /let effectiveBudget = select\(candidateCount,\s*min\(candidateCount,\s*boundarySplatDraw\.requestedCandidateBudget\),\s*boundarySplatDraw\.requestedCandidateBudget > 0u\)/,
  'the GPU selector preserves every candidate unless a positive budget is explicit',
);
assert.match(
  page,
  /id="volume-boundary-splat-candidate-budget"[\s\S]*option value="0" selected>Full source<\/option>[\s\S]*option value="6400">6400<\/option>/,
  'operator control renders full source as the selected default and 6400 as an explicit option',
);
assert.match(page, /volume_boundary_splat_candidate_budget/, 'candidate budget is route-addressable');
assert.match(core, /boundarySplatRequestedCandidateBudget/, 'runtime telemetry records the requested budget');
assert.match(core, /boundarySplatEffectiveCandidateBudget/, 'runtime telemetry records the effective budget');
assert.match(core, /boundarySplatSelectedCandidateCount/, 'runtime telemetry records the selected candidate count');
assert.match(
  pbrWitness,
  /requestedCandidateBudget:[\s\S]*effectiveCandidateBudget:[\s\S]*selectedCandidateCount:/,
  'the PBR witness preserves requested, effective, and selected budget evidence',
);
assert.match(
  core,
  /async function sampleBoundarySplatLiveCadence[\s\S]*identity:\s*'boundary-splat-live-cadence-v0'[\s\S]*frameGapsMs:[\s\S]*samples:/,
  'runtime exposes a bounded live cadence sequence with frame gaps and authoritative state samples',
);
assert.match(
  pbrWitness,
  /--cadence-ms[\s\S]*sampleBoundarySplatLiveCadence[\s\S]*validateCadence[\s\S]*liveCadence/,
  'PBR witness requests, validates, and preserves the live cadence sequence',
);
assert.match(
  pbrWitness,
  /failurePhase = 'live-cadence'[\s\S]*Page\.bringToFront[\s\S]*sampleBoundarySplatLiveCadence/,
  'PBR witness foregrounds its existing page before relying on RAF cadence',
);
assert.match(
  pbrWitness,
  /Page\.navigate[\s\S]*Page\.bringToFront[\s\S]*waitForPrototype[\s\S]*waitForBoundarySplatTelemetry/,
  'PBR witness foregrounds immediately after navigation and waits for complete selector telemetry',
);
assert.match(
  core,
  /ok:\s*durationMs >= requestedDurationMs[\s\S]*frameGapsMs\.length > 1[\s\S]*samples\.length > 1/,
  'runtime cannot label a one-frame background-starved cadence sample successful',
);
assert.doesNotMatch(
  core,
  /state\.boundarySplatEffectiveCandidateBudget = null;[\s\S]*state\.boundarySplatSelectedCandidateCount = null;/,
  'render submission cannot erase the last authoritative selector telemetry between async samples',
);
assert.match(
  core,
  /boundarySplatTelemetryRequestedCandidateBudget:[\s\S]*boundarySplatSelectorTelemetryFrameCount:/,
  'runtime state distinguishes the GPU-observed selector request and its sample frame from current controls',
);
assert.match(
  pbrWitness,
  /waitForBoundarySplatTelemetry[\s\S]*boundarySplatTelemetryRequestedCandidateBudget[\s\S]*boundarySplatRequestedCandidateBudget/,
  'witness waits for GPU-observed and current candidate budgets to agree',
);
assert.match(
  core,
  /async function renderFrozenScaleToCanvas[\s\S]*boundarySplatRequestedCandidateBudget:\s*state\.boundarySplatRequestedCandidateBudget[\s\S]*boundarySplatEffectiveCandidateBudget:\s*state\.boundarySplatEffectiveCandidateBudget[\s\S]*boundarySplatSelectedCandidateCount:\s*state\.boundarySplatSelectedCandidateCount/,
  'frozen PBR capture returns the selector counts resolved for the captured frame',
);
assert.match(
  pbrWitness,
  /incomplete-cadence-duration[\s\S]*stale-or-default-cadence-budget[\s\S]*cadence-selected-count-mismatch[\s\S]*cadence-fallback-or-overflow/,
  'cadence evidence fails loud on partial, stale, mismatched, fallback, and overflow paths',
);

console.log('boundary splat peak budget contracts passed');
