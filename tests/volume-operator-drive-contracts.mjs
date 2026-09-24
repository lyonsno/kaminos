import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const selectiveHead = readFileSync(new URL('../volume-selective-head-live.html', import.meta.url), 'utf8');
const presetWitness = readFileSync(new URL('../volume-settings-preset-witness.mjs', import.meta.url), 'utf8');

assert.match(
  index,
  /#sidebar\s*\{[^}]*contain:\s*layout paint;[^}]*overscroll-behavior:\s*contain;/s,
  'the long operator sidebar contains its layout/paint work and scroll chain beside the live WebGPU viewport',
);
assert.doesNotMatch(
  index,
  /document\.addEventListener\(['"](?:wheel|scroll)['"],\s*observeVolumeBasinDriveCockpitEvent/,
  'Basin Atlas recording must not turn panel scrolling into control-state capture work',
);
assert.doesNotMatch(index, /Structure size, not render resolution:/, 'Detail Scale does not add explanatory prose to the driving surface');
assert.match(core, /let physicalDetailScale = mix\(detailScale, 1\.0, detailScaleArtifactQuarantine\);/);
assert.match(core, /let visibleDetailOverlayGain = mix\(1\.0, 0\.35, detailScaleArtifactQuarantine\);/);

assert.match(
  index,
  /id="volume-wind-angle" min="-180" max="180"[^>]*data-angle-domain="full-circle-signed"/,
  'wind direction declares that the signed endpoints span a full circle',
);
assert.match(
  index,
  /<span class="slider-label">Wind Angle \(°\)<\/span>/,
  'wind direction marks its unit directly on the control label',
);
assert.doesNotMatch(index, /Full circle:\s*−180°/, 'wind direction does not add a prose definition below the control');
assert.match(index, /function formatVolumeWindDirection\(/, 'wind direction has one honest signed readout formatter');
assert.match(
  index,
  /volume-wind-angle-val'\)\.textContent\s*=\s*formatVolumeWindDirection\(c\.windAngle\)/,
  'the visible wind direction readout uses the signed full-circle formatter',
);
assert.match(core, /function normalizeWindAngle\(value\)\s*\{\s*return clampFinite\(value, -180, 180, 0\);\s*\}/);
assert.match(core, /let windDirection = vec3<f32>\(cos\(windAngle\), 0\.0, sin\(windAngle\)\);/);

assert.match(
  selectiveHead,
  /const assayToolbarRequested = params\.get\('assay_toolbar'\) === '1';/,
  'the selective-head diagnostic placard is opt-in rather than painted into the default beauty cockpit',
);
assert.match(
  selectiveHead,
  /const requestedVisible = assayToolbarRequested && activeTab === 'volume';/,
  'default viewport placement keeps the diagnostic placard out of operator captures',
);
assert.match(
  presetWitness,
  /witnessUrl\.searchParams\.set\('assay_toolbar', '1'\)/,
  'diagnostic witnesses explicitly opt into the placard they inspect',
);

console.log('volume operator drive contracts passed');
