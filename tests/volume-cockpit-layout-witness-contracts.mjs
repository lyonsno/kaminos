import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const witness = readFileSync(join(root, 'volume-cockpit-layout-witness.mjs'), 'utf8');
const layout = readFileSync(join(root, 'volume-cockpit-layout.mjs'), 'utf8');
const index = readFileSync(join(root, 'index.html'), 'utf8');

assert.match(
  witness,
  /this\.browserEvents\s*=\s*\[\][\s\S]*Runtime\.exceptionThrown[\s\S]*Runtime\.consoleAPICalled[\s\S]*Log\.entryAdded/,
  'the reusable layout witness must retain browser exceptions, console calls, and log entries',
);
assert.match(
  witness,
  /Runtime\.enable[\s\S]*Log\.enable[\s\S]*initial-layout-admission/,
  'browser diagnostics must be enabled before layout admission is evaluated',
);
assert.match(
  witness,
  /lastTrustworthyEvidence\.admissionProbe\s*=\s*state/,
  'every layout-admission poll must preserve its last observed wrapper, frame, receipt, and status state',
);
assert.match(
  witness,
  /class TerminalWitnessError[\s\S]*catch\s*\(error\)\s*\{[\s\S]*instanceof TerminalWitnessError[\s\S]*throw error/,
  'a source-signed failed receipt or browser exception must terminate admission immediately instead of aging into a timeout',
);
assert.match(
  witness,
  /lastTrustworthyEvidence,[\s\S]*browserEvents:\s*\(socket\?\.browserEvents\s*\|\|\s*\[\]\)\.map\(summarizeBrowserEvent\)/,
  'terminal failure reports must preserve compact browser events beside the last trustworthy state',
);
for (const phase of ['schema-fetch', 'source-layout-build', 'inventory-validation', 'editor-apply', 'store-index']) {
  assert.match(layout, new RegExp(`onPhase\\('${phase}'\\)`), `layout initialization must expose the ${phase} phase`);
}
assert.match(index, /publishVolumeCockpitLayoutPhase\s*=\s*phase\s*=>[\s\S]*status:\s*'initializing'[\s\S]*phase,/, 'the live cockpit publishes an initializing phase receipt');
assert.ok(
  index.indexOf("publishVolumeCockpitLayoutPhase('scheduled')") < index.indexOf('const volumeCockpitLayoutReady'),
  'the initializing receipt must exist before asynchronous layout work begins',
);
assert.match(index, /initializeVolumeCockpitLayout\(\{[\s\S]*onPhase:\s*publishVolumeCockpitLayoutPhase/, 'the initializer publishes every semantic phase to the live receipt');

console.log('volume cockpit layout witness contracts passed');
