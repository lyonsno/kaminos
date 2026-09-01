import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const witness = readFileSync(new URL('../volume-basin-drive-live-witness.mjs', import.meta.url), 'utf8');

for (const argument of [
  '--url',
  '--expected-repo-root',
  '--expected-commit',
  '--expected-session-store',
  '--report',
  '--screenshot',
  '--timeout-ms',
]) {
  assert.match(witness, new RegExp(argument), `live witness requires ${argument}`);
}

for (const controlId of [
  'basin-drive-session-label',
  'basin-drive-record',
  'basin-drive-mark-label',
  'basin-drive-mark',
  'basin-drive-stop',
  'basin-drive-replay',
  'basin-drive-state',
]) {
  assert.match(witness, new RegExp(controlId), `live witness drives or observes ${controlId}`);
}

assert.match(witness, /kaminos\.volume\.basin-drive-session-artifact\.v0/);
assert.match(witness, /kaminos\.volume\.basin-drive-live-witness\.v0/);
assert.match(witness, /\/api\/volume-basin-drive-session\?id=/);
assert.match(witness, /WebGPU:/);
assert.match(witness, /Runtime\.exceptionThrown/);
assert.match(witness, /Log\.entryAdded/);
assert.match(witness, /failurePhase/);
assert.match(witness, /lastTrustworthyEvidence/);
assert.match(witness, /perturb/i);
assert.match(witness, /replay/i);
assert.match(witness, /Page\.captureScreenshot/);
assert.match(witness, /Input\.dispatchMouseEvent/);
assert.match(witness, /Input\.dispatchKeyEvent/);
assert.match(witness, /elementFromPoint/);
assert.match(witness, /eventCount, 3/);
assert.match(witness, /controlEventCount, 2/);
assert.match(witness, /Runtime\.consoleAPICalled[\s\S]*type === 'error'/);
assert.doesNotMatch(
  witness,
  /__kaminos(?:Start|Mark|Stop|Replay)VolumeBasinDriveSession\s*\(/,
  'live witness must exercise visible cockpit commands instead of calling their implementation hooks',
);

console.log('volume basin drive live witness contracts passed');
