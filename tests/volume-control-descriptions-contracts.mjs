// kaminos-test: node
// Every fire control says what it actually does in this simulation (operator,
// 2026-10-20): one description per control, shown as the tooltip in the
// cockpit and in the flame inspector, honest about proxies, artistic terms,
// conditions and controls that only affect quality or diagnostics.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VOLUME_CONTROL_DESCRIPTIONS, VOLUME_CONTROL_KINDS, volumeControlTooltip, applyVolumeControlDescriptions } from '../volume-control-descriptions.mjs';
import { syncVolumeCockpitModeAvailability } from '../volume-cockpit-layout.mjs';

const schema = JSON.parse(readFileSync(new URL('../volume-settings-preset-schema-v2.json', import.meta.url), 'utf8'));
const ids = [...schema.controls, ...(schema.rendererControls || [])].map(control => control.key);
const retired = new Set((schema.retiredControls || []).map(control => control.key));

for (const id of ids) {
  const entry = VOLUME_CONTROL_DESCRIPTIONS[id];
  assert.ok(entry, `${id} has a description`);
  assert.ok(VOLUME_CONTROL_KINDS.includes(entry.kind), `${id} declares what kind of control it is (${entry.kind})`);
  assert.ok(typeof entry.tooltip === 'string' && entry.tooltip.trim().length >= 30, `${id} tooltip says something`);
  assert.ok(entry.tooltip.length <= 320, `${id} tooltip stays a tooltip (${entry.tooltip.length} characters)`);
  if (entry.kind === 'conditional') assert.ok(entry.activeWhen && entry.activeWhen !== 'always', `${id} names the condition it needs`);
}
for (const id of Object.keys(VOLUME_CONTROL_DESCRIPTIONS)) {
  assert.ok(ids.includes(id), `${id} described but not a live control`);
  assert.ok(!retired.has(id), `${id} is retired and must not be described`);
}
assert.equal(volumeControlTooltip('volume-not-a-control'), null, 'unknown ids have no tooltip');

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
assert.match(index, /from '\.\/volume-control-descriptions\.mjs'/, 'the cockpit imports the descriptions');
assert.match(index, /applyVolumeControlDescriptions\(document\)/, 'the cockpit applies them to its rows at startup');
const inspector = readFileSync(new URL('../flame-authoring.mjs', import.meta.url), 'utf8');
assert.match(inspector, /volumeControlTooltip\(id\)/, 'the flame inspector shows the same description');

// Review IC-01: the availability refresh must keep the description; an
// unavailable control shows its reason and still says what it is.
{
  const make = id => {
    const label = { title: '' };
    const row = { querySelector: selector => (selector === '.slider-label' ? label : null) };
    return { id, title: '', disabled: false, dataset: {}, label, closest: selector => (selector === '.slider-row' ? row : null) };
  };
  const elements = new Map(['volume-physical-exposure'].map(id => [id, make(id)]));
  const documentRef = {
    getElementById: id => elements.get(id) ?? null,
    querySelectorAll: () => [],
  };
  applyVolumeControlDescriptions(documentRef);
  const exposure = elements.get('volume-physical-exposure');
  const description = volumeControlTooltip('volume-physical-exposure');
  assert.equal(exposure.title, description, 'startup sets the input description');
  syncVolumeCockpitModeAvailability(documentRef, {}, { effective: 'emissive-transport-v2' });
  assert.equal(exposure.title, description, 'an active control keeps its description after an availability refresh');
  syncVolumeCockpitModeAvailability(documentRef, {}, { effective: 'legacy' });
  assert.ok(exposure.disabled && exposure.title.length > description.length && exposure.title.includes(description), 'unavailable: reason plus description');
  syncVolumeCockpitModeAvailability(documentRef, {}, { effective: 'emissive-transport-v2' });
  assert.equal(exposure.title, description, 'active again: the description alone');
}
// Review IC-02: source height runs from the floor to the box ceiling (default -1 to 3), not -1 to 1.
assert.doesNotMatch(volumeControlTooltip('volume-immersed-centre-y'), /[−-]1 to 1\b/, 'height is not limited to the horizontal bounds');
assert.match(volumeControlTooltip('volume-immersed-centre-y'), /ceiling|top of the box/i, 'height is described against the box floor and ceiling');
// Operator 2026-10-21: Density is renamed for what it is (a display gain on the soot drawn).
const densityRow = index.slice(index.lastIndexOf('<div class="slider-row', index.indexOf('id="volume-density"')), index.indexOf('id="volume-density"'));
assert.doesNotMatch(densityRow, />Density</, 'the cockpit no longer calls the drawn-soot gain Density');
assert.doesNotMatch(inspector, /\['volume-density','Density'\]/, 'nor does the flame inspector');
console.log('volume control descriptions contracts passed');
