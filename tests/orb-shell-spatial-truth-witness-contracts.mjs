import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const core = readFileSync(join(root, 'orb-shell-composition-core.js'), 'utf8');
const witness = readFileSync(join(root, 'orb-shell-composition-witness.mjs'), 'utf8');
const index = readFileSync(join(root, 'index.html'), 'utf8');

assert.match(index, /orbShellFocus === 'spatial-truth'/, 'browser route must recognize spatial-truth focus');
assert.match(index, /enableSpatialTruthWitness/, 'browser route must activate spatial-truth material witness');
assert.match(index, /frameSpatialTruthView/, 'browser route must frame named spatial-truth views');
assert.match(index, /orb_shell_spatial_env_intensity/, 'spatial-truth route must expose environment intensity');
assert.match(index, /orb_shell_spatial_exposure/, 'spatial-truth route must expose exposure');
assert.match(index, /orb_shell_spatial_pass/, 'spatial-truth route must expose diagnostic pass identity');

assert.match(core, /SpatialTruthMaterialPolicy/, 'composition core must expose a spatial-truth material policy');
assert.match(core, /SpatialTruthWitnessState/, 'composition core must return a spatial-truth witness state');
assert.match(core, /SpatialTruthDiagnosticPass/, 'composition core must name diagnostic pass records');
assert.match(core, /SpatialTruthViewSet/, 'composition core must name the multi-view spatial-truth view set');
assert.match(core, /enableSpatialTruthWitness/, 'composition witness must expose spatial-truth activation');
assert.match(core, /frameSpatialTruthView/, 'composition witness must expose named spatial-truth camera framing');
assert.match(core, /MeshStandardMaterial/, 'spatial-truth clay must be based on env-lit MeshStandardMaterial');
assert.match(core, /MeshNormalMaterial/, 'spatial-truth normal pass must use a real normal diagnostic material');
assert.match(core, /MeshDepthMaterial/, 'spatial-truth depth pass must use a real depth diagnostic material');

assert.match(witness, /spatial-truth/, 'headless witness must know spatial-truth focus');
assert.match(witness, /--diagnostic-pass/, 'headless witness must accept diagnostic pass selection');
assert.match(witness, /--view-set/, 'headless witness must accept reusable view-set selection');
assert.match(witness, /--contact-sheet-out/, 'headless witness must write a contact sheet artifact');
assert.match(witness, /SpatialTruthContactSheet/, 'headless report must name spatial-truth contact sheets');
