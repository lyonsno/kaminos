import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const core = readFileSync(join(root, 'orb-shell-composition-core.js'), 'utf8');
const witness = readFileSync(join(root, 'orb-shell-composition-witness.mjs'), 'utf8');
const index = readFileSync(join(root, 'index.html'), 'utf8');

assert.match(index, /orbShellFocus === 'spatial-truth'/, 'browser route must recognize spatial-truth focus');
assert.match(index, /orbShellFocus === 'pre-hdr-warm'/, 'browser route must expose the pre-HDR warm flash as its own diagnostic focus');
assert.match(index, /orbShellFocus === 'material-truth'/, 'browser route must expose stable material-truth focus for env-coupled material inspection');
assert.match(index, /enableSpatialTruthWitness/, 'browser route must activate spatial-truth material witness');
assert.match(index, /frameSpatialTruthView/, 'browser route must frame named spatial-truth views');
assert.match(index, /orb_shell_spatial_env_intensity/, 'spatial-truth route must expose environment intensity');
assert.match(index, /orb_shell_spatial_exposure/, 'spatial-truth route must expose exposure');
assert.match(index, /orb_shell_spatial_pass/, 'spatial-truth route must expose diagnostic pass identity');
assert.match(index, /if \(!params\.has\(name\)\) return defaultValue;/, 'route number parser must use defaults when optional spatial-truth params are omitted');
assert.match(index, /MaterialTruthRoutePolicy/, 'material-truth route must preserve its effective route identity');
assert.match(index, /PreHdrWarmPhasePolicy/, 'pre-HDR warm route must expose the phase it is preserving without calling it material truth');
assert.match(index, /MaterialTruthEnvPolicy/, 'material-truth route must expose its env-map-coupled material policy');
assert.match(index, /environmentDisposition: 'env-map-coupled'/, 'material-truth route must keep environment-map coupling enabled');
assert.match(index, /applyMaterialTruthStandardMaterialTuning/, 'material-truth route must tune real MeshStandardMaterial instances, not only declare material params');
assert.match(index, /materialOverrideCount/, 'material-truth route must report how many materials it actually tuned');
assert.match(index, /preHdrWarmPhaseLock/, 'pre-HDR warm route must guard against async studio HDR load overwriting the preserved flash');
assert.doesNotMatch(
  index,
  /orbShellFocus === 'material-truth'[\s\S]{0,1200}applyOrbShellMaterialTruthPhasePolicy/,
  'material-truth must not default to the pre-HDR phase-lock route',
);

assert.match(core, /SpatialTruthMaterialPolicy/, 'composition core must expose a spatial-truth material policy');
assert.match(core, /SpatialTruthWitnessState/, 'composition core must return a spatial-truth witness state');
assert.match(core, /SpatialTruthDiagnosticPass/, 'composition core must name diagnostic pass records');
assert.match(core, /SpatialTruthViewSet/, 'composition core must name the multi-view spatial-truth view set');
assert.match(core, /enableSpatialTruthWitness/, 'composition witness must expose spatial-truth activation');
assert.match(core, /frameSpatialTruthView/, 'composition witness must expose named spatial-truth camera framing');
assert.match(core, /frameSpatialTruthSurveyPose/, 'composition witness must expose elevation/azimuth survey camera framing');
assert.match(core, /MeshStandardMaterial/, 'spatial-truth clay must be based on env-lit MeshStandardMaterial');
assert.match(core, /MeshNormalMaterial/, 'spatial-truth normal pass must use a real normal diagnostic material');
assert.match(core, /MeshDepthMaterial/, 'spatial-truth depth pass must use a real depth diagnostic material');
assert.match(core, /mode: 'env-lit-neutral-clay-spatial-truth-v1'/, 'spatial-truth clay policy must name the non-white settled-frame tuning');
assert.match(core, /envMapIntensity: 0\.45/, 'spatial-truth clay default environment intensity must not wash the settled frame white');
assert.match(core, /exposure: 0\.9/, 'spatial-truth clay default exposure must preserve gray clay sidewall legibility');
assert.match(core, /color: '#737d80'/, 'spatial-truth clay default color must be neutral gray rather than near-white');

assert.match(witness, /spatial-truth/, 'headless witness must know spatial-truth focus');
assert.match(witness, /material-truth/, 'headless witness must know material-truth focus');
assert.match(witness, /pre-hdr-warm/, 'headless witness must know pre-HDR warm focus');
assert.match(witness, /materialTruthEnvPolicy/, 'headless witness must report material-truth env policy');
assert.match(witness, /preHdrWarmPhasePolicy/, 'headless witness must report pre-HDR warm phase policy');
assert.match(witness, /--diagnostic-pass/, 'headless witness must accept diagnostic pass selection');
assert.match(witness, /--view-set/, 'headless witness must accept reusable view-set selection');
assert.match(witness, /--contact-sheet-out/, 'headless witness must write a contact sheet artifact');
assert.match(witness, /SpatialTruthContactSheet/, 'headless report must name spatial-truth contact sheets');
assert.match(witness, /--survey-contact-sheet-out/, 'headless witness must write a large parallax survey contact sheet artifact');
assert.match(witness, /--survey-elevations/, 'survey witness must accept explicit elevation rows');
assert.match(witness, /--survey-azimuths/, 'survey witness must accept explicit azimuth columns');
assert.match(witness, /SpatialTruthSurveyContactSheet/, 'headless report must name spatial-truth survey contact sheets distinctly from small view sets');
assert.match(witness, /SpatialTruthSurveyGrid/, 'survey witness report must preserve the effective elevation/azimuth grid');
assert.match(witness, /cameraPose/, 'survey witness cells must record their effective camera pose');
assert.match(witness, /MohelIndicator/, 'survey witness must warn on large grids instead of silently capping them');
assert.match(witness, /cellCount > 64/, 'survey witness must define the large-grid warning from actual requested cell count');
assert.match(witness, /viewCount: captures\.length/, 'survey witness must report captured cell count from completed captures');
assert.match(witness, /assertCompositionStructuralInvariants/, 'headless witness must isolate structural invariants from primary visual capture');
assert.match(witness, /visualCaptureCompleted/, 'headless witness must report whether primary visual capture completed before optional assertions');
