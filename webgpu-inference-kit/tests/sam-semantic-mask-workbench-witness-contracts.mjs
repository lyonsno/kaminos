import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const witness = readFileSync(new URL('../tools/sam-semantic-mask-workbench-witness.mjs', import.meta.url), 'utf8');

for (const argument of ['url', 'out', 'report', 'debug-port', 'timeout-ms', 'negative-control', 'negative-out']) {
  assert.match(witness, new RegExp(`['"]${argument}['"]`), `witness must expose --${argument}`);
}
assert.match(witness, /api\/sam3-workbench-route/, 'witness must collect server route registration evidence');
assert.match(witness, /run-segmentation/, 'witness must activate the operator control rather than calling a hidden test hook');
assert.match(witness, /workbench-status/, 'witness must observe the human-facing status surface');
assert.match(witness, /button\s*&&\s*!button\.disabled/, 'witness initialization must tolerate the page before its controls exist');
assert.match(witness, /source-canvas/, 'witness must inspect source canvas pixels');
assert.match(witness, /overlay-canvas/, 'witness must inspect overlay canvas pixels');
assert.match(witness, /mask-canvas/, 'witness must inspect raw mask canvas pixels');
assert.match(witness, /Page\.captureScreenshot/, 'witness must preserve the visible browser output');
assert.match(witness, /actual-webgpu-readback/, 'witness must reject non-GPU output authority');
assert.match(witness, /run-negative-control/, 'optional negative witness must activate the visible operator control');
assert.match(witness, /negativeControl/, 'report must preserve negative-control output separately from the positive witness');
assert.match(witness, /Different from positive|Empty as expected/, 'negative control must fail unless it differs from the positive mask or selects nothing');
assert.match(witness, /registrationState[^]*mounted/, 'witness must reject an unmounted or projected route');
assert.match(witness, /failurePhase/, 'witness report must remain useful after pre-output failure');
assert.match(witness, /writeReport/, 'witness must write its report on success and failure');
assert.match(witness, /Promise\.race/, 'Chrome spawn failure must rejoin the durable report path instead of throwing from an event callback');
assert.doesNotMatch(witness, /once\(['"]error['"],\s*error\s*=>\s*\{\s*throw/, 'Chrome spawn errors must not escape the durable report path');

console.log('sam semantic mask workbench witness contracts passed');
