import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const core = await readFile(new URL('../volume-core.js', import.meta.url), 'utf8');
const page = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const witness = await readFile(new URL('../volume-boundary-splat-motion-witness.mjs', import.meta.url), 'utf8');

const requiredModes = [
  'shared-current',
  'same-history-slot',
  'offset-history',
  'age-sweep',
];

assert.match(core, /BOUNDARY_SPLAT_PHASE_LAB_MODES/, 'runtime must publish phase-lab mode vocabulary');
assert.match(core, /normalizeBoundarySplatPhaseMode/, 'runtime must normalize requested phase-lab mode explicitly');
assert.match(page, /volume_boundary_splat_phase_mode/, 'operator route must expose phase-lab mode');
assert.match(page, /id="volume-boundary-splat-phase-mode"/, 'operator UI must expose phase-lab mode without console mutation');
assert.match(page, /volume_boundary_splat_phase_stride/, 'operator route must expose phase stride');
assert.match(page, /id="volume-boundary-splat-phase-stride"/, 'operator UI must expose phase stride');
assert.match(page, /volume_boundary_splat_history_depth/, 'operator route must expose live-history depth');
assert.match(page, /id="volume-boundary-splat-history-depth"/, 'operator UI must expose live-history depth');
assert.match(page, /volume_boundary_splat_history_frame_stride/, 'operator route must expose live-history frame stride for macro-motion offsets');
assert.match(page, /id="volume-boundary-splat-history-frame-stride"/, 'operator UI must expose live-history frame stride without console mutation');

for (const mode of requiredModes) {
  assert.match(core, new RegExp(`['"]${mode}['"]`), `runtime must recognize phase-lab mode ${mode}`);
  assert.match(witness, new RegExp(`['"]${mode}['"]`), `witness must exercise phase-lab mode ${mode}`);
}

assert.match(core, /boundarySplatPhaseMode/, 'debug state must preserve requested/effective phase mode');
assert.match(core, /normalizeBoundarySplatPhaseStride/, 'runtime must normalize requested phase stride explicitly');
assert.match(core, /normalizeBoundarySplatHistoryDepth/, 'runtime must normalize requested live-history depth explicitly');
assert.match(core, /normalizeBoundarySplatHistoryFrameStride/, 'runtime must normalize requested live-history frame stride explicitly');
assert.match(core, /boundarySplatPhaseStride/, 'debug state must preserve requested/effective phase stride');
assert.match(core, /boundarySplatHistoryDepth/, 'debug state must preserve requested/effective live-history depth');
assert.match(core, /boundarySplatHistoryFrameStride/, 'debug state must preserve requested/effective live-history frame stride');
assert.match(core, /phaseMode:\s*descriptor\.phaseMode/, 'instance descriptor telemetry must carry per-instance phase mode');
assert.match(core, /phaseStride:\s*descriptor\.phaseStride/, 'instance descriptor telemetry must carry per-instance phase stride');
assert.match(core, /historyDepth:\s*descriptor\.historyDepth/, 'instance descriptor telemetry must carry per-instance history depth');
assert.match(core, /historyFrameStride:\s*descriptor\.historyFrameStride/, 'instance descriptor telemetry must carry per-instance history frame stride');
assert.match(core, /effectiveHistoryOffsetFrames:\s*descriptor\.effectiveHistoryOffsetFrames/, 'instance descriptor telemetry must carry the effective macro-motion frame offset');
assert.match(core, /phaseModeIdentity/, 'runtime phase-source telemetry must include a mode identity distinct from source authority');
assert.match(core, /same-history-slot-control/, 'runtime must distinguish same-history-slot from offset-history');
assert.match(core, /age-sweep-history/, 'runtime must distinguish age-sweep from offset-history');
assert.match(core, /phaseMode === 'age-sweep'[\s\S]*index \* phaseStride/, 'age-sweep must mine stride-spaced history offsets instead of duplicating offset-history');
assert.match(core, /const effectiveHistoryOffsetFrames = historyOffsetSlots \* historyFrameStride/, 'age-sweep telemetry must distinguish slot offsets from macro frame offsets');
assert.match(core, /const writeTick = sourceCandidateGeneration > 0[\s\S]*historyFrameStride/, 'history write slot must advance by source generation and live-history stride rather than render cadence');
assert.match(core, /boundarySplatHistoryArchiveDecision\([\s\S]*sourceCandidateGeneration[\s\S]*sourceSimStepCount/, 'history archive admission must bind each write to simulator-backed source identity');
assert.match(core, /phaseMode === 'offset-history'[\s\S]*historyOffsetFrames = requestedInstanceCount > 1 \? index : 0/, 'offset-history must remain the adjacent-offset baseline');

assert.match(witness, /phaseLabWitness/, 'witness report must include phase-lab A\\/B summary');
assert.match(witness, /operatorPrettySubstrate/, 'witness report must carry the optional operator pretty-substrate pointer');
assert.match(witness, /phaseModeComparisons/, 'witness must compare phase modes under one route/browser authority');
assert.match(witness, /learned-splat-phase-\$\{phaseMode\}/, 'phase-lab witness must capture learned splat phase modes, not only analytic controls');
assert.match(witness, /boundarySplatPhaseStride/, 'witness must preserve phase stride telemetry');
assert.match(witness, /boundarySplatHistoryDepth/, 'witness must preserve history depth telemetry');
assert.match(witness, /boundarySplatHistoryFrameStride/, 'witness must preserve history frame stride telemetry');
assert.match(witness, /--phase-stride/, 'witness CLI must allow explicit phase stride for mining runs');
assert.match(witness, /--history-depth/, 'witness CLI must allow explicit history depth for mining runs');
assert.match(witness, /--history-frame-stride/, 'witness CLI must allow explicit history frame stride for long-offset macro-motion runs');

console.log('boundary splat phase-lab contracts passed');
