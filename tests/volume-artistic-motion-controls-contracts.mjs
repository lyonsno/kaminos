import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');

assert.match(index, /<select[^>]+id="emitter-assay-family"[^>]+data-volume-settings-param="volume_emitter_family"/, 'emitter selection declares its canonical basin route parameter');
assert.match(index, /function volumeDomControlParamFromElement\(el\)[\s\S]*?el\.dataset\.volumeSettingsParam[\s\S]*?volumeDomControlParamFromId\(el\.id\)/, 'capture prefers explicit route identity and retains the volume-* fallback');

assert.match(index, /id="volume-artistic-swirl"[^>]*type="checkbox"|type="checkbox"[^>]*id="volume-artistic-swirl"/, 'cockpit exposes the optional artistic swirl gate');
assert.match(index, /id="volume-phased-sway"[^>]*type="checkbox"|type="checkbox"[^>]*id="volume-phased-sway"/, 'cockpit exposes the optional phased sway gate');
assert.match(index, /\['artisticSwirl', 'volume_artistic_swirl'\]/, 'basin URLs preserve the artistic swirl choice');
assert.match(index, /\['phasedSway', 'volume_phased_sway'\]/, 'basin URLs preserve the phased sway choice');
assert.match(index, /artisticSwirl: document\.getElementById\('volume-artistic-swirl'\)\.checked/, 'cockpit controls reach the runtime snapshot');
assert.match(index, /phasedSway: document\.getElementById\('volume-phased-sway'\)\.checked/, 'phased sway reaches the runtime snapshot');

assert.match(core, /artistic_motion_controls: vec4<f32>/, 'the GPU uniform contract carries both motion gates');
assert.match(core, /bonfireSwirlSymmetryGain \* artisticSwirl/, 'artistic swirl gates only the authored macro rotation');
assert.match(core, /0\.0038 \* curl \* phasedSway/, 'phased sway gates only the authored lateral oscillation');
assert.match(core, /uniforms\[360\] = controlsSnapshot\.artisticSwirl === false \? 0 : 1/, 'gold-host uniform packing preserves the artistic swirl gate');
assert.match(core, /uniforms\[361\] = controlsSnapshot\.phasedSway === false \? 0 : 1/, 'gold-host uniform packing preserves the phased sway gate');
assert.match(core, /uniforms\.set\(previousViewProj\.elements, 364\)/, 'the camera matrix follows the two motion gates in the gold-host layout');

console.log('volume artistic motion controls: cockpit, basin, and gold-host GPU gates pass');
