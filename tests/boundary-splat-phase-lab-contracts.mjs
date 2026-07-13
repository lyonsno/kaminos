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

for (const mode of requiredModes) {
  assert.match(core, new RegExp(`['"]${mode}['"]`), `runtime must recognize phase-lab mode ${mode}`);
  assert.match(witness, new RegExp(`['"]${mode}['"]`), `witness must exercise phase-lab mode ${mode}`);
}

assert.match(core, /boundarySplatPhaseMode/, 'debug state must preserve requested/effective phase mode');
assert.match(core, /phaseMode:\s*descriptor\.phaseMode/, 'instance descriptor telemetry must carry per-instance phase mode');
assert.match(core, /phaseModeIdentity/, 'runtime phase-source telemetry must include a mode identity distinct from source authority');
assert.match(core, /same-history-slot-control/, 'runtime must distinguish same-history-slot from offset-history');
assert.match(core, /age-sweep-history/, 'runtime must distinguish age-sweep from offset-history');

assert.match(witness, /phaseLabWitness/, 'witness report must include phase-lab A\\/B summary');
assert.match(witness, /operatorPrettySubstrate/, 'witness report must carry the optional operator pretty-substrate pointer');
assert.match(witness, /phaseModeComparisons/, 'witness must compare phase modes under one route/browser authority');
assert.match(witness, /learned-splat-phase-\$\{phaseMode\}/, 'phase-lab witness must capture learned splat phase modes, not only analytic controls');

console.log('boundary splat phase-lab contracts passed');
