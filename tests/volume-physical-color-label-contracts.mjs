import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { syncVolumeCockpitModeAvailability } from '../volume-cockpit-layout.mjs';
// The physical mode and material law selects were retired with the legacy
// material laws (2026-10-18): emissive transport under the Physics law is the
// only route, so the composed label is the thermal-strength label alone.
const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const generic = page.slice(page.indexOf('function syncReactionFrontExtractorLabels('), page.indexOf('\nfunction applyCanonicalVolumeMacroPreset('));
const updateStart = page.indexOf("  document.getElementById('volume-physical-thermal-label')");
const updateEnd = page.indexOf('  syncReactionFrontExtractorLabels(c);\n', updateStart);
const update = page.slice(updateStart, updateEnd + '  syncReactionFrontExtractorLabels(c);\n'.length);
const nodes = new Map();
const context = {
  c: new Proxy({ physicalThermalStrength: 2 }, { get: (o, k) => k in o ? o[k] : 0 }),
  document: { getElementById: id => { if (id.includes('control-root')) return null; if (!nodes.has(id)) nodes.set(id, { dataset: {} }); return nodes.get(id); }, querySelectorAll: () => [] },
  volumePrototype: null,
  syncVolumeCockpitModeAvailability,
  REACTION_FRONT_EXTRACTOR_CONTROL_FIELDS: [{ id: 'volume-physical-thermal', key: 'physicalThermalStrength', decimals: 2 }],
  normalizeReactionFrontLiveView: v => v, normalizeBoundarySidecarSource: v => v, normalizeBoundarySidecarView: v => v, normalizeBoundarySplatMode: v => v,
};
vm.runInNewContext(`${generic}\n${update}`, context);
assert.equal(nodes.get('volume-physical-thermal-label').textContent, 'Glow gain', 'under the Physics law the thermal strength is the glow gain');
assert.equal(nodes.get('volume-physical-thermal-val').textContent, '2.00', 'ordinary numeric synchronization still applies');
assert.doesNotMatch(page, /id="volume-physical-mode"|id="volume-physical-material-law"/, 'the mode and law selects are retired');
console.log('physical color composed route labels passed');
