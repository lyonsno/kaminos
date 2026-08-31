import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');

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
assert.match(
  index,
  /Structure size, not render resolution:[^<]*higher = finer breakup; lower = broader folds\.[^<]*Tall Plume limits the main frequency to 1\.0 and the visible overlay to 35%\./,
  'Detail Scale explains its spatial-frequency role and the current Tall Plume quarantine in the cockpit',
);
assert.match(core, /let physicalDetailScale = mix\(detailScale, 1\.0, detailScaleArtifactQuarantine\);/);
assert.match(core, /let visibleDetailOverlayGain = mix\(1\.0, 0\.35, detailScaleArtifactQuarantine\);/);

assert.match(
  index,
  /id="volume-wind-angle" min="-180" max="180"[^>]*data-angle-domain="full-circle-signed"/,
  'wind direction declares that the signed endpoints span a full circle',
);
assert.match(
  index,
  /Full circle:\s*−180°\s*…\s*\+180°\.\s*0°\s*=\s*\+X;\s*\+90°\s*=\s*\+Z\./,
  'wind direction explains its signed full-circle basis in the cockpit',
);
assert.match(index, /function formatVolumeWindDirection\(/, 'wind direction has one honest signed readout formatter');
assert.match(
  index,
  /volume-wind-angle-val'\)\.textContent\s*=\s*formatVolumeWindDirection\(c\.windAngle\)/,
  'the visible wind direction readout uses the signed full-circle formatter',
);
assert.match(core, /function normalizeWindAngle\(value\)\s*\{\s*return clampFinite\(value, -180, 180, 0\);\s*\}/);
assert.match(core, /let windDirection = vec3<f32>\(cos\(windAngle\), 0\.0, sin\(windAngle\)\);/);

console.log('volume operator drive contracts passed');
