import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const witness = readFileSync(join(root, 'volume-shared-transmittance-witness.mjs'), 'utf8');

assert.match(witness, /kaminos\.volume\.shared-transmittance-witness\.v0/, 'focused witness owns a durable report identity');
assert.match(witness, /settings_preset[\s\S]*FLAMEBOWL_PRESET_ID[\s\S]*settings_preset_authority[\s\S]*shared-volume-settings-preset-v2/, 'witness rejects substituted Flamebowl preset authority');
assert.match(witness, /role=truthHigh[\s\S]*composition=raymarch-only-v0/, 'witness requires the exact raymarch-only route');
assert.match(witness, /setSelectiveHeadLiveCapturePaused\(true\)[\s\S]*sameStateCaptureId[\s\S]*baseFrameCount[\s\S]*baseSimStepCount/, 'all captures bind to one frozen simulation state');
assert.match(
  witness,
  /ridge-emission-under-ridge-extinction[\s\S]*ridge-emission-under-total-flame-extinction[\s\S]*nonridge-emission-under-total-flame-extinction[\s\S]*complete-flame-under-total-extinction/,
  'focused witness captures exactly the four optical-layer modes',
);
assert.match(witness, /requestedEmissionMask[\s\S]*effectiveEmissionMask[\s\S]*requestedExtinctionMask[\s\S]*effectiveExtinctionMask/, 'witness rejects label/mask coupling or substitution');
assert.match(witness, /application\.sourceState[\s\S]*application\.camera[\s\S]*application\.route[\s\S]*application\.backend[\s\S]*application\.quality[\s\S]*application\.postprocess/, 'witness validates all authority-bearing receipt axes');
assert.match(witness, /fallbackReason[\s\S]*null/, 'fallback cannot look authoritative');
assert.match(witness, /sampleSharedTransmittanceContributions\(\{[\s\S]*sameStateCaptureId[\s\S]*baseFrameCount[\s\S]*baseSimStepCount/, 'MRT readback uses the same frozen state as visual captures');
assert.match(witness, /exactWithinDeclaredPrecision[\s\S]*violationCount[\s\S]*channelsNonblank[\s\S]*maxAbsError/, 'witness rejects inexact, partial, or blank MRT evidence');
assert.match(witness, /metrics\.nonblank[\s\S]*pixelHash/, 'every visual mode must be nonblank and content-addressed');
assert.match(witness, /failurePhase[\s\S]*lastTrustworthyEvidence[\s\S]*writeFileSync\(reportPath/, 'pre-primary failures still write a durable phase report');
assert.match(witness, /transport-ridge-emission-ridge-extinction\.png[\s\S]*transport-ridge-emission-total-extinction\.png[\s\S]*transport-nonridge-emission-total-extinction\.png[\s\S]*transport-complete-flame-total-extinction\.png/, 'witness writes the four inspectable visual artifacts');
assert.doesNotMatch(witness, /captureAppearance\('structural-a'\)|cameraHoldout|beautySmokeRestored/, 'focused witness does not re-admit unrelated legacy assay captures');

console.log('volume shared transmittance witness contracts passed');
