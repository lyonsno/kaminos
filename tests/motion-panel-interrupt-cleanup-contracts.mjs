import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const liveWitness = readFileSync(new URL('../motion-panel-live-witness.mjs', import.meta.url), 'utf8');

assert.match(index, /id="motion-panel-interrupt-radio"/, 'Motion panel exposes Interrupt as a visible radio group');
assert.doesNotMatch(index, /id="motion-panel-interrupt-options"/, 'Interrupt is not buried in a collapsed details group');
assert.doesNotMatch(index, /<select[^>]+id="motion-panel-cliplet-interrupt"/, 'Interrupt does not use a one-control select');
assert.match(index, /name="motion-panel-cliplet-interrupt"[^>]+value="off"/, 'Interrupt radio exposes Off mode');
assert.match(index, /name="motion-panel-cliplet-interrupt"[^>]+value="path-trigger"/, 'Interrupt radio exposes Path trigger mode');
assert.ok(
  index.indexOf('id="motion-panel-interrupt-radio"') < index.indexOf('id="motion-panel-phrase-preview"'),
  'Interrupt radio appears before the populated phrase preview list'
);
assert.match(index, /querySelector\('input\[name="motion-panel-cliplet-interrupt"\]:checked'\)/, 'Motion panel reads the checked interrupt radio');
assert.match(index, /querySelectorAll\('input\[name="motion-panel-cliplet-interrupt"\]'\)/, 'Motion panel wires interrupt radio listeners');

assert.doesNotMatch(index, /id="motion-panel-procedural-clips-details"/, 'Motion panel no longer exposes an opaque Procedural Clips drawer');
assert.doesNotMatch(index, />Procedural Clips</, 'Motion panel does not present dead procedural clip rows to the operator');
assert.doesNotMatch(index, /proceduralClipsOpen/, 'Operator layout debug state does not report a removed procedural drawer');

assert.match(liveWitness, /querySelectorAll\('input\[name="motion-panel-cliplet-interrupt"\]'\)/, 'Live witness drives the interrupt radio group');
assert.doesNotMatch(liveWitness, /getElementById\('motion-panel-cliplet-interrupt'\)/, 'Live witness no longer drives the removed interrupt select');
