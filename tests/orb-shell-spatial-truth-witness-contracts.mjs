import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const core = readFileSync(join(root, 'orb-shell-composition-core.js'), 'utf8');
const witness = readFileSync(join(root, 'orb-shell-composition-witness.mjs'), 'utf8');
const index = readFileSync(join(root, 'index.html'), 'utf8');

assert.match(index, /orbShellFocus === 'spatial-truth'/, 'browser route must recognize spatial-truth focus');
assert.match(index, /orbShellFocus === 'material-truth'/, 'browser route must expose stable material-truth focus for the pre-clay material read');
assert.match(index, /enableSpatialTruthWitness/, 'browser route must activate spatial-truth material witness');
assert.match(index, /frameSpatialTruthView/, 'browser route must frame named spatial-truth views');
assert.match(index, /orb_shell_spatial_env_intensity/, 'spatial-truth route must expose environment intensity');
assert.match(index, /orb_shell_spatial_exposure/, 'spatial-truth route must expose exposure');
assert.match(index, /orb_shell_spatial_pass/, 'spatial-truth route must expose diagnostic pass identity');
assert.match(index, /if \(!params\.has\(name\)\) return defaultValue;/, 'route number parser must use defaults when optional spatial-truth params are omitted');
assert.match(index, /MaterialTruthRoutePolicy/, 'material-truth route must preserve its effective route identity');
assert.match(index, /MaterialTruthPhasePolicy/, 'material-truth route must expose the material phase it is preserving');
assert.match(index, /pre-hdr-warm/, 'material-truth must preserve the operator-observed pre-HDR warm material phase by default');
assert.match(index, /materialTruthPhaseLock/, 'material-truth must guard against async studio HDR load overwriting the preserved phase');

assert.match(core, /SpatialTruthMaterialPolicy/, 'composition core must expose a spatial-truth material policy');
assert.match(core, /SpatialTruthWitnessState/, 'composition core must return a spatial-truth witness state');
assert.match(core, /SpatialTruthDiagnosticPass/, 'composition core must name diagnostic pass records');
assert.match(core, /SpatialTruthViewSet/, 'composition core must name the multi-view spatial-truth view set');
assert.match(core, /enableSpatialTruthWitness/, 'composition witness must expose spatial-truth activation');
assert.match(core, /frameSpatialTruthView/, 'composition witness must expose named spatial-truth camera framing');
assert.match(core, /MeshStandardMaterial/, 'spatial-truth clay must be based on env-lit MeshStandardMaterial');
assert.match(core, /MeshNormalMaterial/, 'spatial-truth normal pass must use a real normal diagnostic material');
assert.match(core, /MeshDepthMaterial/, 'spatial-truth depth pass must use a real depth diagnostic material');
assert.match(core, /mode: 'env-lit-neutral-clay-spatial-truth-v1'/, 'spatial-truth clay policy must name the non-white settled-frame tuning');
assert.match(core, /envMapIntensity: 0\.45/, 'spatial-truth clay default environment intensity must not wash the settled frame white');
assert.match(core, /exposure: 0\.9/, 'spatial-truth clay default exposure must preserve gray clay sidewall legibility');
assert.match(core, /color: '#737d80'/, 'spatial-truth clay default color must be neutral gray rather than near-white');

assert.match(witness, /spatial-truth/, 'headless witness must know spatial-truth focus');
assert.match(witness, /material-truth/, 'headless witness must know material-truth focus');
assert.match(witness, /--diagnostic-pass/, 'headless witness must accept diagnostic pass selection');
assert.match(witness, /--view-set/, 'headless witness must accept reusable view-set selection');
assert.match(witness, /--contact-sheet-out/, 'headless witness must write a contact sheet artifact');
assert.match(witness, /SpatialTruthContactSheet/, 'headless report must name spatial-truth contact sheets');
assert.match(witness, /assertCompositionStructuralInvariants/, 'headless witness must isolate structural invariants from primary visual capture');
assert.match(witness, /visualCaptureCompleted/, 'headless witness must report whether primary visual capture completed before optional assertions');
