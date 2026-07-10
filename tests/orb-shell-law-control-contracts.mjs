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
assert.match(index, /id="orb-shell-law-debug-mode"/, 'Orb Shell UI must expose a law debug-mode selector');
assert.match(index, /id="orb-shell-law-debug-legend"/, 'Orb Shell UI must expose a law debug color legend');
assert.match(index, /function orbShellLawDebugLegendText\(/, 'Orb Shell UI must derive law debug legend text from active debug mode');
assert.match(index, /function readOrbShellLawControls\(\)/, 'Orb Shell UI must read law controls through a named reader');
assert.match(index, /lawControls:\s*readOrbShellLawControls\(\)/, 'composition controls must pass lawControls into the fixture/witness variation payload');
assert.match(index, /orb_shell_law_view/, 'law view mode must be URL-addressable for smoke/replay');
assert.match(index, /orb_shell_law_debug/, 'law debug mode must be URL-addressable for smoke/replay');
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
assert.match(
  index,
  /enableMacroMorphologyInventoryWitness\(\{\s*frame:\s*false\s*\}\)/,
  'curve-on-sphere live setting changes must refresh the curve witness without moving the operator camera',
);
assert.match(
  core,
  /enableMacroMorphologyInventoryWitness\(options = \{\}\)/,
  'morphology witness activation must accept options so operator refresh can disable framing',
);
assert.match(
  core,
  /if \(options\.frame !== false\) this\.frameMacroMorphologyInventory\(\)/,
  'morphology witness must frame only when the caller did not opt out',
);

assert.match(core, /OrbShellLawControls/, 'composition core must name the law-control schema');
assert.match(core, /normalizeOrbShellLawControls/, 'composition core must normalize law controls in one place');
assert.match(core, /MacroLawImpactCurveDecomposition/, 'composition core must name law-impact curve decomposition records');
assert.match(core, /MacroLawDebugDecomposition/, 'composition core must name law-specific debug decomposition records');
assert.match(core, /MacroLawOrbitDisplacementVector/, 'orbit debug must expose displacement vectors instead of only a post-law curve');
assert.match(core, /MacroLawCapEnvelopeRail/, 'cap debug must expose width-envelope rails instead of pretending cap moves the centerline');
assert.match(core, /ApertureAuthorityEligibilityGate/, 'aperture orbit capture must name a local authority eligibility gate');
assert.match(core, /apertureOrbitAuthorityAt/, 'aperture orbit capture must compute local authority before moving a curve point');
assert.match(core, /distanceFullAuthority/, 'aperture authority gate must expose a full-authority distance threshold');
assert.match(core, /tangentFullAuthority/, 'aperture authority gate must expose a full-authority tangent-agreement threshold');
assert.match(core, /macroMorphologyLawImpactCurveMaterial/, 'curve witness must render law-affected curves with a distinct material');
assert.match(core, /macroMorphologyOrbitDeltaVectorMaterial/, 'curve witness must render orbit displacement ticks with a distinct material');
assert.match(core, /macroMorphologyCapEnvelopeMaterial/, 'curve witness must render cap envelope rails with a distinct material');
assert.match(core, /inventory:\s*compactMacroMorphologyInventory\(\)/, 'morphology witness return payload must use compact inventory evidence');
assert.doesNotMatch(core, /inventory:\s*composition\.macroMorphologyInventory/, 'morphology witness return payload must not ship full nested inventory through CDP');
assert.match(core, /visibleOrbitDisplacementVectorCount/, 'morphology witness report must expose visible orbit displacement vector count');
assert.match(core, /visibleCapEnvelopeRailCount/, 'morphology witness report must expose visible cap envelope rail count');
assert.match(witness, /lawControls:\s*state\.lawControls/, 'visual witness reports must preserve effective law-control identity');
assert.match(witness, /new URL\(url\)\.searchParams\.get\('orb_shell_focus'\)/, 'visual witness focus must default from the route URL when --focus is omitted');
assert.match(witness, /disabled-by-law-controls/, 'visual witness must distinguish intentionally disabled laws from missing laws');
assert.match(witness, /lawControls\?\.apertureOrbitCapture\?\.enabled === false/, 'visual witness must branch on effective aperture capture controls');
assert.match(witness, /--orbit-strength-filmstrip-out/, 'headless witness must write an aperture-orbit strength sweep filmstrip artifact');
assert.match(witness, /--orbit-strengths/, 'orbit-strength filmstrip must accept explicit strength rows');
assert.match(witness, /--orbit-strength-filmstrip-elevations/, 'orbit-strength filmstrip must accept explicit elevation rows');
assert.match(witness, /--orbit-strength-filmstrip-azimuths/, 'orbit-strength filmstrip must accept explicit azimuth columns');
assert.match(witness, /OrbitStrengthSweepFilmstrip/, 'headless report must name orbit-strength sweep filmstrips distinctly from spatial-truth contact sheets');
assert.match(witness, /OrbitStrengthSweepGrid/, 'orbit-strength sweep report must preserve effective strength and camera grid identity');
assert.match(witness, /--cdp-timeout-ms/, 'visual witness must expose CDP timeout as an invocation-scoped argument');
assert.match(witness, /cdpTimeoutMs/, 'visual witness report must preserve effective CDP timeout');
assert.match(witness, /cellCount > 36/, 'large orbit-strength sweeps must split sheets instead of timing out on one giant screenshot');
assert.match(witness, /splitByStrength/, 'orbit-strength sweep report must say whether it split the composed sheets');
assert.match(witness, /OrbitStrengthSweepFilmstripSheet/, 'split orbit-strength sweep sheets must be named report artifacts');
assert.match(witness, /requestedStrength/, 'orbit-strength sweep cells must preserve the requested strength, not only the row label');
assert.match(witness, /effectiveStrength/, 'orbit-strength sweep cells must preserve the effective slider strength observed after UI coupling');
assert.match(witness, /lawImpactDeltaSummary/, 'orbit-strength sweep cells must preserve curve-level law-impact deltas for all families');
assert.match(witness, /apertureOrbitAuthorityMetrics/, 'orbit-strength sweep cells must preserve local aperture-authority metrics for all families');
assert.match(witness, /--dense-witness-pack-out/, 'headless witness must expose a dense parallax witness-pack output root');
assert.match(witness, /DenseWitnessPack/, 'dense witness pack report must name the reusable evidence bundle');
assert.match(witness, /DenseWitnessScoutSheet/, 'dense witness pack must include a scout sheet for broad parallax coverage');
assert.match(witness, /DenseWitnessDeltaPairSheet/, 'dense witness pack must include paired strength-delta comparison sheets');
assert.match(witness, /DenseWitnessHeroSheet/, 'dense witness pack must include larger hero/detail inspection sheets');
assert.match(witness, /denseWitnessPackOut/, 'dense witness pack report must preserve the requested output root');
assert.match(witness, /denseWitnessPackRouteIdentity/, 'dense witness pack report must preserve route/config identity separately from screenshots');
assert.match(core, /frameMacroMorphologySurveyPose/, 'composition witness must expose macro-morphology survey camera framing');

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
  debugMode: 'cap-envelope',
  curvatureWidthCap: { enabled: false, strength: 2 },
  apertureOrbitCapture: { enabled: false, strength: -1 },
});
assert.equal(clamped.viewMode, 'curve-on-sphere', 'curve-on-sphere view survives normalization');
assert.equal(clamped.debugMode, 'cap-envelope', 'cap-envelope debug mode survives normalization');
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
    debugMode: 'all-law-impact',
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
    debugMode: 'all-law-impact',
    curvatureWidthCap: { enabled: false, strength: 1 },
    apertureOrbitCapture: { enabled: false, strength: 1 },
  },
});
const zeroOrbitFixture = createTargetOrbShellCompositionFixture({
  variantId: 'wide-cup',
  variationSeed: 6,
  variationLeafCount: 11,
  lawControls: {
    viewMode: 'curve-on-sphere',
    debugMode: 'orbit-delta',
    curvatureWidthCap: { enabled: true, strength: 1 },
    apertureOrbitCapture: { enabled: true, strength: 0 },
  },
});

assert.equal(enabledFixture.lawControls.schema, 'OrbShellLawControls', 'fixture exposes normalized law controls');
assert.equal(enabledFixture.lawControls.debugMode, 'all-law-impact', 'fixture preserves requested law debug mode');
assert.equal(disabledFixture.lawControls.viewMode, 'curve-on-sphere', 'fixture preserves requested law view mode');
assert.ok(enabledFixture.apertureOrbitCaptureLaw, 'enabled fixture creates aperture orbit capture law');
assert.equal(
  enabledFixture.apertureOrbitCaptureLaw.authorityGate?.schema,
  'ApertureAuthorityEligibilityGate',
  'aperture orbit law exposes the local authority eligibility gate',
);
assert.ok(
  enabledFixture.apertureOrbitCaptureLaw.authorityGate.distanceFullAuthority
    < enabledFixture.apertureOrbitCaptureLaw.authorityGate.distanceZeroAuthority,
  'aperture authority distance gate has a non-empty falloff band',
);
assert.ok(
  enabledFixture.apertureOrbitCaptureLaw.authorityGate.tangentZeroAuthority
    < enabledFixture.apertureOrbitCaptureLaw.authorityGate.tangentFullAuthority,
  'aperture authority tangent gate has a non-empty falloff band',
);
assert.equal(disabledFixture.apertureOrbitCaptureLaw, null, 'disabled fixture does not create aperture orbit capture law');
assert.equal(disabledFixture.apertureOrbitCaptureWitnessPlan?.status, 'disabled-by-law-controls', 'disabled fixture reports why orbit capture witness is absent');

const lawImpactRecords = enabledFixture.macroMorphologyInventory.records
  .filter(record => record.lawImpactCurve?.schema === 'MacroLawImpactCurveDecomposition');
assert.equal(
  lawImpactRecords.length,
  enabledFixture.macroAssemblages.length,
  'morphology inventory exposes a law-impact curve for every macro family',
);
assert.ok(
  lawImpactRecords.every(record => record.lawImpactCurve.apertureOrbitCaptureCurve?.visualOverlayId?.endsWith('-law-impact-curve-line')),
  'law-impact curves carry stable visual overlay ids for curve-on-sphere rendering',
);
assert.ok(
  lawImpactRecords.some(record => record.lawImpactCurve.apertureOrbitCaptureDeltaMetrics?.maxPointDelta > 0.02),
  'at least one law-impact curve shows visible aperture orbit displacement before meshing',
);
assert.ok(
  lawImpactRecords.every(record => record.lawImpactCurve.apertureOrbitAuthorityMetrics?.schema === 'ApertureOrbitAuthorityMetrics'),
  'law-impact curves expose local aperture-authority metrics for every macro family',
);
assert.ok(
  lawImpactRecords.some(record => record.lawImpactCurve.apertureOrbitAuthorityMetrics?.minAuthority < 0.25),
  'at least one macro family has local segments where aperture authority is mostly suppressed',
);
assert.ok(
  lawImpactRecords.some(record => record.lawImpactCurve.apertureOrbitAuthorityMetrics?.maxAuthority > 0.65),
  'at least one macro family still reaches strong aperture authority where close and tangent-compatible',
);
assert.ok(
  zeroOrbitFixture.macroMorphologyInventory.records.every(record => (
    record.lawImpactCurve.apertureOrbitCaptureDeltaMetrics.maxPointDelta < 1e-6
  )),
  'orbit strength zero must produce no law-impact curve displacement',
);
assert.ok(
  lawImpactRecords.every(record => record.lawDebugDecomposition?.schema === 'MacroLawDebugDecomposition'),
  'morphology inventory exposes law-specific debug decomposition for every macro family',
);
assert.ok(
  lawImpactRecords.some(record => record.lawDebugDecomposition.orbitDisplacementVectors?.some(vector => vector.schema === 'MacroLawOrbitDisplacementVector' && vector.length > 0.02)),
  'orbit debug exposes visible displacement vectors where orbit capture moves a curve',
);
assert.ok(
  lawImpactRecords.every(record => record.lawDebugDecomposition.capEnvelopeRails?.some(rail => rail.schema === 'MacroLawCapEnvelopeRail' && rail.stage === 'pre-cap-envelope')),
  'cap debug exposes pre-cap envelope rails for every macro family',
);
assert.ok(
  lawImpactRecords.some(record => record.lawDebugDecomposition.capEnvelopeDeltaMetrics?.maxRailDelta > 0.02),
  'cap debug exposes visible envelope difference where curvature cap narrows a family',
);

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
