// kaminos-test: node
// Operator 2026-10-22: the hidden procedural-force switches go. Microdetail and
// Shred are their own switches (0 is off); Fine breakup becomes Swirl jostle,
// a 0-2 strength (1 = the force as it was), with its focus slider visible.
// Saved basins keep their look: a switch that was off sets its slider to 0.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateVolumeSettingsPresetDocument } from '../volume-settings-preset-contract.mjs';
import { projectFireSettingsToSchema } from '../scene-fire-domain.mjs';
import { detailForceContributionMask } from '../volume-detail-force-isolation.mjs';
import { VOLUME_CONTROL_DESCRIPTIONS, volumeControlTooltip } from '../volume-control-descriptions.mjs';

const schema = JSON.parse(readFileSync(new URL('../volume-settings-preset-schema-v2.json', import.meta.url), 'utf8'));
const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const SWITCHES = ['volume-procedural-detail-forces', 'volume-force-micro-carrier', 'volume-force-interface-shred', 'volume-force-fine-breakup'];

const jostle = schema.controls.find(control => control.key === 'volume-swirl-jostle');
assert.ok(jostle, 'Swirl jostle is a live control');
assert.equal(Number(jostle.additiveDefault), 1, 'basins without it load at 1, the force as it was');
assert.match(index, /<input[^>]+id="volume-swirl-jostle"[^>]+min="0"[^>]+max="2"/, 'its slider runs 0 to 2');
for (const id of SWITCHES) {
  assert.ok(!schema.controls.some(control => control.key === id), `${id} is no longer a live control`);
  assert.ok(schema.retiredControls.some(control => control.key === id), `${id} is a declared retirement`);
  assert.doesNotMatch(index, new RegExp(`id="${id}"`), `${id} has no cockpit row`);
}
const focusRow = index.slice(index.lastIndexOf('<div class="slider-row', index.indexOf('id="volume-fine-breakup-localization"')), index.indexOf('id="volume-fine-breakup-localization"'));
assert.doesNotMatch(focusRow, /data-volume-ui-retired/, 'the focus slider is visible');
assert.match(focusRow, />Swirl jostle focus</, 'and named for what it focuses');
assert.deepEqual(detailForceContributionMask({ swirlJostle: 1.5 }), [1, 1, 1, 1.5], 'micro and shred always run (their sliders gate them); the fine term carries the strength');
assert.deepEqual(detailForceContributionMask({ swirlJostle: 0 }), [1, 1, 1, 0]);
assert.match(core, /if \(u\.detail_force_isolation\.w > 0\.0\) \{[\s\S]*?fineBreakup = vec3<f32>\(fineBreakupLateral\.x, rawFineBreakup\.y, fineBreakupLateral\.y\) \* u\.detail_force_isolation\.w;/, 'the kernel scales the force by the strength');
for (const id of ['volume-swirl-jostle', 'volume-fine-breakup-localization', 'volume-microdetail', 'volume-interface-shred']) {
  assert.ok(VOLUME_CONTROL_DESCRIPTIONS[id], `${id} is described`);
}
assert.match(volumeControlTooltip('volume-microdetail'), /\b0\b.*off|off.*\b0\b/i, 'Microdetail says 0 turns its force off');
assert.match(volumeControlTooltip('volume-interface-shred'), /\b0\b.*off|off.*\b0\b/i, 'Shred says 0 turns its force off');
for (const id of SWITCHES) assert.equal(VOLUME_CONTROL_DESCRIPTIONS[id], undefined, `${id} is not described`);

// A saved record carrying the switches: a full current record plus the four retired entries.
const hash = '9'.repeat(64);
function savedRecord(switches, sliders) {
  const route = new URL('http://kaminos.invalid/?kaminos_volume_smoke=1');
  const domControls = {};
  for (const control of schema.controls) {
    const value = control.key in sliders ? sliders[control.key] : (control.additiveDefault ?? (control.type === 'checkbox' ? false : 0));
    domControls[control.key] = { key: control.key, param: control.param, tagName: control.tagName, type: control.type, id: control.key, value };
    route.searchParams.set(control.param, String(value));
  }
  for (const [key, value] of Object.entries(switches)) {
    const retired = schema.retiredControls.find(control => control.key === key);
    domControls[key] = { key, param: retired.param, tagName: retired.tagName, type: retired.type, id: key, value };
    route.searchParams.set(retired.param, String(value));
  }
  for (const control of [...schema.rendererControls, ...schema.presentationControls]) route.searchParams.set(control.param, String(control.additiveDefault ?? 0));
  for (const param of schema.routeExtraParams) route.searchParams.set(param, 'fixture');
  const count = Object.keys(domControls).length;
  return {
    identity: 'kaminos-volume-settings-preset-artifact-v2', presetId: `vsp-${hash}`, contentHash: `sha256:${hash}`, schemaIdentity: schema.identity, controlCount: count,
    preset: {
      identity: 'kaminos-volume-settings-preset-v2', kind: 'settings-preset', schemaIdentity: schema.identity, savedAt: '2026-10-01T00:00:00Z', route: route.href,
      domControls, controlCount: count,
      rendererControls: Object.fromEntries(schema.rendererControls.map(control => [control.key, { ...control, id: control.key, value: control.additiveDefault ?? 0 }])),
      rendererControlCount: schema.rendererControls.length,
      presentationControls: Object.fromEntries(schema.presentationControls.map(control => [control.key, { ...control, id: control.key, value: control.additiveDefault }])),
      presentationControlCount: schema.presentationControls.length,
      stateExclusions: Object.fromEntries(schema.excludedStateFields.map(field => [field, true])),
      note: 'force switch transfer fixture',
    },
  };
}
const value = (receipt, key) => Number(receipt.preset.domControls[key].value);
const routeValue = (receipt, key) => Number(receipt.presetRoute.searchParams.get(schema.controls.find(control => control.key === key).param));
const allOn = { 'volume-procedural-detail-forces': true, 'volume-force-micro-carrier': true, 'volume-force-interface-shred': true, 'volume-force-fine-breakup': true };
const sliders = { 'volume-microdetail': 0.9, 'volume-interface-shred': 5, 'volume-swirl-jostle': 1 };
// The common saved shape: Shred at 5 with its switch off.
const shredOff = validateVolumeSettingsPresetDocument(savedRecord({ ...allOn, 'volume-force-interface-shred': false, 'volume-force-fine-breakup': false }, sliders), `vsp-${hash}`, schema);
assert.equal(value(shredOff, 'volume-interface-shred'), 0, 'a shred switch that was off sets Shred to 0, so the basin does not gain a shred force');
assert.equal(routeValue(shredOff, 'volume-interface-shred'), 0, 'the route agrees');
assert.equal(value(shredOff, 'volume-swirl-jostle'), 0, 'a fine-breakup switch that was off sets Swirl jostle to 0');
assert.equal(value(shredOff, 'volume-microdetail'), 0.9, 'a switch that was on leaves its slider alone');
const masterOff = validateVolumeSettingsPresetDocument(savedRecord({ ...allOn, 'volume-procedural-detail-forces': false }, sliders), `vsp-${hash}`, schema);
assert.deepEqual(['volume-microdetail', 'volume-interface-shred', 'volume-swirl-jostle'].map(key => value(masterOff, key)), [0, 0, 0], 'the master switch off turned all three forces off');
const on = validateVolumeSettingsPresetDocument(savedRecord(allOn, sliders), `vsp-${hash}`, schema);
assert.deepEqual(['volume-microdetail', 'volume-interface-shred', 'volume-swirl-jostle'].map(key => value(on, key)), [0.9, 5, 1], 'all switches on: the sliders are unchanged');
// Records saved before Swirl jostle existed gain it at 1, or at 0 when their fine-breakup switch was off.
const preJostle = savedRecord({ ...allOn, 'volume-force-fine-breakup': false }, sliders);
delete preJostle.preset.domControls['volume-swirl-jostle'];
const preRoute = new URL(preJostle.preset.route); preRoute.searchParams.delete('volume_swirl_jostle'); preJostle.preset.route = preRoute.href;
preJostle.controlCount -= 1; preJostle.preset.controlCount -= 1;
assert.equal(value(validateVolumeSettingsPresetDocument(preJostle, `vsp-${hash}`, schema), 'volume-swirl-jostle'), 0);

// The scene's saved fire settings take the same path.
const sceneSettings = { domControls: Object.fromEntries(Object.entries(savedRecord({ ...allOn, 'volume-force-interface-shred': false }, sliders).preset.domControls).map(([key, entry]) => [key, { value: entry.value, rawValue: String(entry.value) }])), rendererControls: {}, presentationControls: {} };
const projected = projectFireSettingsToSchema(sceneSettings, schema);
assert.equal(Number(projected.domControls['volume-interface-shred'].value), 0, 'scene fire settings: shred switch off sets Shred to 0');
assert.equal(Number(projected.domControls['volume-microdetail'].value), 0.9);
console.log('swirl jostle contracts passed');
