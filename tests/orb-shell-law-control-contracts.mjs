import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const index = readFileSync(join(root, 'index.html'), 'utf8');
const core = readFileSync(join(root, 'orb-shell-composition-core.js'), 'utf8');
const witness = readFileSync(join(root, 'orb-shell-composition-witness.mjs'), 'utf8');

assert.match(index, /id="orb-shell-law-view-mode"/, 'Orb Shell UI must expose a law view-mode control');
assert.match(index, /id="orb-shell-law-curvature-width-cap-enabled"/, 'Orb Shell UI must expose a curvature-width-cap toggle');
assert.match(index, /id="orb-shell-law-curvature-width-cap-strength"/, 'Orb Shell UI must expose a curvature-width-cap strength slider');
assert.match(index, /id="orb-shell-law-aperture-orbit-capture-enabled"/, 'Orb Shell UI must expose an aperture-orbit-capture toggle');
assert.match(index, /id="orb-shell-law-aperture-orbit-capture-strength"/, 'Orb Shell UI must expose an aperture-orbit-capture strength slider');
assert.match(index, /function readOrbShellLawControls\(\)/, 'Orb Shell UI must read law controls through a named reader');
assert.match(index, /lawControls:\s*readOrbShellLawControls\(\)/, 'composition controls must pass lawControls into the fixture/witness variation payload');
assert.match(index, /orb_shell_law_view/, 'law view mode must be URL-addressable for smoke/replay');
assert.match(index, /orb_shell_law_curvature_width_cap/, 'curvature-width-cap toggle must be URL-addressable');
assert.match(index, /orb_shell_law_aperture_orbit_capture/, 'aperture-orbit-capture toggle must be URL-addressable');
assert.match(index, /function hydrateOrbShellLawControlsFromParams[\s\S]*updateOrbShellLawReadout\(\)/, 'route hydration must immediately refresh the visible law-control readout');
const syncControlsBlock = index.match(/const syncControls = \(\) => \{[\s\S]*?\n  \};/)?.[0] || '';
assert.ok(syncControlsBlock, 'Orb Shell UI must expose the live syncControls block');
assert.doesNotMatch(syncControlsBlock, /frameOrbShellCompositionCamera\(/, 'live operator control changes must not reset the composition camera');
assert.match(index, /orb-shell-composition-frame'\)\.addEventListener\('click', frameOrbShellCompositionCamera\)/, 'explicit composition Frame button remains the only default camera-frame operator action');
assert.doesNotMatch(
  index,
  /orbShellCompositionWitness\.setActive\(active\);[\s\S]{0,120}if \(active\) frameOrbShellCompositionCamera\(\)/,
  'composition enable/disable must not reset the operator camera',
);
assert.doesNotMatch(
  index,
  /else \{\s*frameOrbShellCompositionCamera\(\);\s*setInfo\(orbShellCompositionStatusText\(orbShellCompositionWitness\.debugState\(\)\)\);\s*\}/,
  'default composition route must not frame the operator camera unless a witness route or Frame button asks for it',
);

assert.match(core, /OrbShellLawControls/, 'composition core must name the law-control schema');
assert.match(core, /normalizeOrbShellLawControls/, 'composition core must normalize law controls in one place');
assert.match(witness, /lawControls:\s*state\.lawControls/, 'visual witness reports must preserve effective law-control identity');
assert.match(witness, /disabled-by-law-controls/, 'visual witness must distinguish intentionally disabled laws from missing laws');
assert.match(witness, /lawControls\?\.apertureOrbitCapture\?\.enabled === false/, 'visual witness must branch on effective aperture capture controls');

const {
  createTargetOrbShellCompositionFixture,
  normalizeOrbShellLawControls,
} = await import('../orb-shell-composition-core.js');

const defaults = normalizeOrbShellLawControls();
assert.equal(defaults.schema, 'OrbShellLawControls', 'default law controls carry a schema');
assert.equal(defaults.viewMode, 'geometry', 'default law view is normal geometry');
assert.equal(defaults.curvatureWidthCap.enabled, true, 'curvature width cap is enabled by default');
assert.equal(defaults.apertureOrbitCapture.enabled, true, 'aperture orbit capture is enabled by default');

const clamped = normalizeOrbShellLawControls({
  viewMode: 'curve-on-sphere',
  curvatureWidthCap: { enabled: false, strength: 2 },
  apertureOrbitCapture: { enabled: false, strength: -1 },
});
assert.equal(clamped.viewMode, 'curve-on-sphere', 'curve-on-sphere view survives normalization');
assert.equal(clamped.curvatureWidthCap.enabled, false, 'curvature cap disabled flag survives normalization');
assert.equal(clamped.curvatureWidthCap.strength, 1, 'curvature cap strength clamps high inputs');
assert.equal(clamped.apertureOrbitCapture.enabled, false, 'aperture capture disabled flag survives normalization');
assert.equal(clamped.apertureOrbitCapture.strength, 0, 'aperture capture strength clamps low inputs');

const enabledFixture = createTargetOrbShellCompositionFixture({
  variantId: 'wide-cup',
  variationSeed: 6,
  variationLeafCount: 11,
  lawControls: {
    viewMode: 'geometry',
    curvatureWidthCap: { enabled: true, strength: 1 },
    apertureOrbitCapture: { enabled: true, strength: 1 },
  },
});
const disabledFixture = createTargetOrbShellCompositionFixture({
  variantId: 'wide-cup',
  variationSeed: 6,
  variationLeafCount: 11,
  lawControls: {
    viewMode: 'curve-on-sphere',
    curvatureWidthCap: { enabled: false, strength: 1 },
    apertureOrbitCapture: { enabled: false, strength: 1 },
  },
});

assert.equal(enabledFixture.lawControls.schema, 'OrbShellLawControls', 'fixture exposes normalized law controls');
assert.equal(disabledFixture.lawControls.viewMode, 'curve-on-sphere', 'fixture preserves requested law view mode');
assert.ok(enabledFixture.apertureOrbitCaptureLaw, 'enabled fixture creates aperture orbit capture law');
assert.equal(disabledFixture.apertureOrbitCaptureLaw, null, 'disabled fixture does not create aperture orbit capture law');
assert.equal(disabledFixture.apertureOrbitCaptureWitnessPlan?.status, 'disabled-by-law-controls', 'disabled fixture reports why orbit capture witness is absent');

const enabledLower = enabledFixture.macroAssemblages.find(assemblage => assemblage.id === 'lower-socket-keel');
const disabledLower = disabledFixture.macroAssemblages.find(assemblage => assemblage.id === 'lower-socket-keel');
assert.equal(enabledLower?.macroPromotedBody?.curvatureWidthCapLaw?.schema, 'CurvatureWidthCapLaw', 'enabled fixture attaches lower-socket curvature cap');
assert.equal(disabledLower?.macroPromotedBody?.curvatureWidthCapLaw, null, 'disabled fixture does not attach lower-socket curvature cap');

const enabledLowerRecord = enabledFixture.macroMorphologyInventory.records.find(record => record.parentAssemblage === 'lower-socket-keel');
const disabledLowerRecord = disabledFixture.macroMorphologyInventory.records.find(record => record.parentAssemblage === 'lower-socket-keel');
assert.ok(
  enabledLowerRecord.pathologyClasses.includes('curvature-width-cap-applied'),
  'enabled morphology inventory exposes applied curvature cap pressure',
);
assert.ok(
  !disabledLowerRecord.pathologyClasses.includes('curvature-width-cap-applied'),
  'disabled morphology inventory removes applied curvature cap pressure',
);
