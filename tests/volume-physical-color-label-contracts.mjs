import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { syncVolumeCockpitModeAvailability } from '../volume-cockpit-layout.mjs';
const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const generic = page.slice(page.indexOf('function syncReactionFrontExtractorLabels('), page.indexOf('\nfunction applyCanonicalVolumeMacroPreset('));
const updateStart = page.indexOf('  const physicalBoundaryColor =');
const update = page.slice(updateStart, page.indexOf("  document.getElementById('volume-pyro-compare-val')", updateStart));
for (const [mode, render, inspect, expected] of [[0,'inspect','boundary_fire','legacy'],[1,'stock','boundary_fire','inactive route'],[1,'inspect','front','inactive route'],[1,'inspect','boundary_fire','active']]) {
  const nodes = new Map();
  const context = {
    c: new Proxy({physicalColorMode:mode,fireRenderMode:render,shellInspectMode:inspect,physicalThermalStrength:2}, {get:(o,k)=>k in o?o[k]:0}),
    document:{getElementById:id=>{if(id.includes('control-root'))return null;if(!nodes.has(id))nodes.set(id,{dataset:{}});return nodes.get(id)}, querySelectorAll:()=>[]},
    volumePrototype: null,
    syncVolumeCockpitModeAvailability,
    REACTION_FRONT_EXTRACTOR_CONTROL_FIELDS:[{id:'volume-physical-mode',key:'physicalColorMode',decimals:0},{id:'volume-physical-thermal',key:'physicalThermalStrength',decimals:2}],
    normalizeReactionFrontLiveView:v=>v, normalizeBoundarySidecarSource:v=>v, normalizeBoundarySidecarView:v=>v, normalizeBoundarySplatMode:v=>v,
  };
  vm.runInNewContext(`${generic}\n${update}`, context);
  assert.equal(nodes.get('volume-physical-mode-val').textContent, expected, 'composed label update preserves effective route');
  assert.equal(nodes.get('volume-physical-thermal-val').textContent, '2.00', 'ordinary numeric synchronization still applies');
}
console.log('physical color composed route labels passed');
