import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../smokes/sam-semantic-mask-workbench.html', import.meta.url), 'utf8');
const workbench = readFileSync(new URL('../smokes/sam-semantic-mask-workbench.js', import.meta.url), 'utf8');
const runner = readFileSync(new URL('../smokes/sam-mask-island-parity.js', import.meta.url), 'utf8');

for (const id of [
  'sample-picker',
  'prompt-input',
  'run-segmentation',
  'run-negative-control',
  'source-canvas',
  'overlay-canvas',
  'mask-canvas',
  'workbench-status',
  'effective-route',
]) {
  assert.match(html, new RegExp(`id=["']${id}["']`), `workbench must expose #${id}`);
}
assert.match(html, /sam-mask-runtime-frame/, 'workbench must host the existing SAM runtime composition');
assert.match(html, /aria-live=["']polite["']/, 'workbench status must be observable while the long browser route runs');

assert.match(workbench, /const SAMPLE_IMAGES\s*=\s*\[/, 'workbench must define selectable samples');
for (const sample of ['truck.jpg', 'groceries.jpg', 'test_image.jpg']) {
  assert.match(workbench, new RegExp(sample.replace('.', '\\.')), `workbench must include ${sample}`);
}
assert.match(workbench, /runSam3Invocation\([^,]+,\s*\{[\s\S]*promptText[\s\S]*sourceImage[\s\S]*verificationMode:\s*['"]execution-only['"]/, 'workbench must pass dynamic prompt and image authority into the existing runtime');
assert.match(workbench, /samMaskIslandVisualOutput\(\)/, 'workbench must consume the runtime actual-mask output surface');
assert.match(workbench, /outputAuthority\s*!==\s*['"]actual-webgpu-readback['"]/, 'workbench must reject expected, fixture, cached, or unidentified masks');
assert.match(workbench, /invocationId\s*!==\s*activeInvocationId/, 'workbench must reject stale output from an earlier run');
assert.match(workbench, /drawMaskOverlay/, 'workbench must render the selected GPU mask over the source image');
assert.match(workbench, /drawRawMask/, 'workbench must render the raw selected GPU mask independently');
assert.match(workbench, /negative-control/, 'workbench must offer a deliberately mismatched prompt control');
assert.match(workbench, /negativeButton\.disabled\s*=\s*busy\s*\|\|\s*positiveMaskFingerprint\s*===\s*null/, 'negative control must remain disabled until the current sample has a positive mask fingerprint');
assert.match(workbench, /selectedCandidateCount\s*===\s*0/, 'workbench must expose an honest empty result when selection keeps no candidate');

assert.match(runner, /verificationMode/, 'runtime must distinguish execution-only from reference-parity invocations');
assert.match(runner, /promptText/, 'runtime must accept a dynamic browser prompt');
assert.match(runner, /sourceImage/, 'runtime must accept dynamic source-image authority');
assert.match(runner, /sourceImageUrl\.origin\s*!==\s*window\.location\.origin/, 'dynamic source images must be same-origin');
assert.match(runner, /sourceImageUrl\.pathname\.startsWith\(['"]\/sam3-samples\/['"]\)/, 'dynamic workbench images must remain inside the authenticated sample namespace');
assert.match(runner, /runtimeOwner\s*===\s*['"]browser-workbench['"][\s\S]*manifest\.sourceImage\.file/, 'browser-workbench source inputs must bypass package-root artifact resolution only after same-origin validation');
assert.match(runner, /readArtifactText:\s*file\s*=>\s*fetchTextRaw\(resolveManifestFile\(file\)\)/, 'split package bootstrap JSON must use resolver-owned hash verification before the static cache is configured');
assert.match(runner, /window\.samMaskIslandVisualOutput/, 'runtime must expose actual mask output to a same-origin workbench');
assert.match(runner, /outputAuthority:\s*['"]actual-webgpu-readback['"]/, 'runtime output must identify actual GPU readback authority');
assert.match(runner, /verificationState:\s*['"]not-attached['"]/, 'execution-only dynamic work must not counterfeit parity passage');
assert.match(runner, /selectedCandidateCount\s*===\s*0[\s\S]*new Uint32Array/, 'runtime must not render candidate zero after an empty selection');
assert.match(runner, /if \(verificationAttached\)[\s\S]*WebGPU parity mismatch/, 'reference mismatch gates must remain load-bearing when verification is attached');

console.log('sam semantic mask workbench contracts passed');
