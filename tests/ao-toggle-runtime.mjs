import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Execute the actual viewer initialization and frame branch with GPU calls
// replaced by counters. This tests switching, not GPU compatibility or pixels.
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const init = html.slice(html.indexOf('  // --- GTAO Compute AO'), html.indexOf("  window.addEventListener('resize'", html.indexOf('  // --- GTAO Compute AO')));
const frame = html.slice(html.indexOf('      const t0 = performance.now();') + '      const t0 = performance.now();'.length, html.indexOf('      const frameMs = performance.now() - t0;'));
const values = { 'ao-toggle': true, 'ao-intensity': '0.7', 'ao-radius': '0.3', 'ao-scale': '1.6', 'ao-thickness': '1.8', 'ao-falloff': '0.74' };
const elements = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { checked: value === true, value, disabled: false, style: {} }]));
elements['ao-controls'] = { style: {} };
const calls = { builds: 0, ao: 0, direct: 0 };
const node = new Proxy({}, { get: (_, key) => key === 'type' ? 0 : (...args) => node });
const pass = () => ({ name: '', setMRT() {}, getTextureNode: () => node, getTexture: () => ({}) , mul: () => node });
const sandbox = {
  URLSearchParams, window: { location: { search: '?gtao=0' } },
  document: { getElementById: id => elements[id] },
  renderer: { getDrawingBufferSize: () => ({ x: 800, y: 600 }), render() { calls.direct++; } },
  scene: {}, camera: {}, renderPipeline: null, postProcessing: null, scenePass: null, aoPass: null, aoIntensity: null,
  THREE: { RenderPipeline: class { constructor() { calls.builds++; } render() { calls.ao++; } }, Vector2: class {}, RenderTarget: class { texture = {}; }, NodeMaterial: class {} },
  pass, mrt: () => node, packNormalToRGB: () => node, normalView: node, sample: () => node,
  unpackRGBToNormal: () => node, positionView: { z: node }, vec4: () => node, vec3: () => node,
  texture: () => node, convertToTexture: () => node, denoise: () => ({ r: node }),
  uniform: value => ({ value }), mix: () => node, float: () => node,
  aoCompute: () => ({ setDepthPass() {}, getTextureNode: () => node, radius: {}, scale: {}, thickness: {}, distanceFallOff: {} }),
};
vm.createContext(sandbox);
vm.runInContext(init, sandbox);
assert.equal(elements['ao-toggle'].disabled, false, 'off query must not lock the AO switch');
assert.equal(elements['ao-toggle'].checked, false);
vm.runInContext(frame, sandbox);
assert.deepEqual(calls, { builds: 0, ao: 0, direct: 1 }, 'off must render without constructing GPU AO');
elements['ao-toggle'].checked = true;
vm.runInContext(frame, sandbox);
assert.deepEqual(calls, { builds: 1, ao: 1, direct: 1 }, 'switch on must create and use AO');
assert.equal(sandbox.aoPass.radius.value, 0.3);
assert.equal(sandbox.aoIntensity.value, 0.7);
elements['ao-toggle'].checked = false;
vm.runInContext(frame, sandbox);
assert.deepEqual(calls, { builds: 1, ao: 1, direct: 2 }, 'switch off must bypass AO again');
elements['ao-toggle'].checked = true;
vm.runInContext(frame, sandbox);
assert.deepEqual(calls, { builds: 1, ao: 2, direct: 2 }, 'switch on again must reuse AO');
console.log('PASS: AO off/on/off/on uses the actual viewer branches; GPU/pixel behavior not covered.');
