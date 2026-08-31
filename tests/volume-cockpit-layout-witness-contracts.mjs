import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const witness = readFileSync(join(root, 'volume-cockpit-layout-witness.mjs'), 'utf8');
const witnessContract = readFileSync(join(root, 'volume-cockpit-layout-witness-contract.mjs'), 'utf8');
const layout = readFileSync(join(root, 'volume-cockpit-layout.mjs'), 'utf8');
const index = readFileSync(join(root, 'index.html'), 'utf8');

assert.match(
  witness,
  /this\.browserEvents\s*=\s*\[\][\s\S]*Runtime\.exceptionThrown[\s\S]*Runtime\.consoleAPICalled[\s\S]*Log\.entryAdded/,
  'the reusable layout witness must retain browser exceptions, console calls, and log entries',
);
assert.match(
  witness,
  /navigateWithBrowserDiagnostics\(socket,\s*url\)[\s\S]*initial-layout-admission/,
  'pre-navigation browser diagnostics must be established before layout admission is evaluated',
);
assert.match(
  witness,
  /lastTrustworthyEvidence\.admissionProbe\s*=\s*state/,
  'every layout-admission poll must preserve its last observed wrapper, frame, receipt, and status state',
);
assert.match(
  witnessContract,
  /class TerminalWitnessError/,
  'the reusable witness contract must expose a dedicated terminal failure class',
);
assert.match(
  witness,
  /catch\s*\(error\)\s*\{[\s\S]*instanceof TerminalWitnessError[\s\S]*throw error/,
  'a source-signed failed receipt or browser exception must terminate admission immediately instead of aging into a timeout',
);
assert.match(
  witness,
  /lastTrustworthyEvidence,[\s\S]*browserEvents:\s*\(socket\?\.browserEvents\s*\|\|\s*\[\]\)\.map\(summarizeBrowserEvent\)/,
  'terminal failure reports must preserve compact browser events beside the last trustworthy state',
);
assert.match(
  witness,
  /const browserEventAudit\s*=\s*auditBrowserEvents\(socket\.browserEvents,[\s\S]*allowExpectedLayoutStoreBlock:\s*true[\s\S]*browserEventAudit[\s\S]*ok:\s*true/,
  'a success report must reject browser errors observed after initial admission instead of merely recording them',
);
assert.match(
  witness,
  /while\s*\(Date\.now\(\)\s*<\s*deadline\)[\s\S]*auditBrowserEvents\(socket\.browserEvents,[\s\S]*failurePhase\s*===\s*'layout-store-outage-isolation'[\s\S]*await callback\(\)/,
  'every wait phase must adjudicate retained browser errors before polling for success',
);
assert.match(
  witness,
  /'about:blank'[\s\S]*navigateWithBrowserDiagnostics\(socket,\s*url\)/,
  'the browser must attach on a neutral page before navigating to the target wrapper',
);
assert.match(
  witnessContract,
  /Page\.enable[\s\S]*Runtime\.enable[\s\S]*Log\.enable[\s\S]*Page\.navigate/,
  'the target navigation helper must enable browser diagnostics before target navigation',
);
assert.match(
  witness,
  /terminalLayoutReceiptFailure\(state\.receipt\)[\s\S]*throw new TerminalWitnessError/,
  'a completed persistence fallback must terminate admission with its source receipt',
);
assert.match(
  witness,
  /const authoredLayoutWitness\s*=\s*\{[\s\S]*layoutId:\s*customLayout\.layout\.layoutId[\s\S]*movedControlId[\s\S]*sourceGroupId[\s\S]*targetGroupId[\s\S]*assertAuthoredLayoutRestored\(\{\s*authored:\s*authoredLayoutWitness,\s*reloaded\s*\}\)/,
  'reload persistence must verify the authored layout identity and moved-control structure',
);
assert.match(
  witness,
  /prepareScreenshotEvidence\([\s\S]*runId[\s\S]*stageScreenshotEvidence[\s\S]*publishScreenshotEvidence[\s\S]*screenshotEvidence/,
  'screenshot output must be generation-bound, staged, and published only after terminal admission',
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
