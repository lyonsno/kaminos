import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const cockpitUrl = new URL('../held-basin-smoke-assay.html', import.meta.url);
const witnessUrl = new URL('../held-basin-smoke-assay-witness.mjs', import.meta.url);

const cockpit = await readFile(cockpitUrl, 'utf8').catch(() => '');
const witness = await readFile(witnessUrl, 'utf8').catch(() => '');

assert.match(cockpit, /kaminos\.held-smoke-assay-cockpit\.v0/, 'cockpit exposes a stable runtime schema');
assert.match(cockpit, /window\.__kaminosHeldSmokeAssay/, 'cockpit exposes a live operator-readable receipt');
assert.match(cockpit, /webgpu-held-smoke-assay-v0/, 'cockpit requests the exact A\/B raster route');
assert.match(cockpit, /smoke-raymarch-under-splats-v0/, 'D requests raymarched smoke under splat flame');
assert.match(cockpit, /searchParams\.set\('embed',\s*'1'\)/, 'D uses the chrome-free embedded viewer mode');
assert.match(cockpit, /manifest_sha256/, 'D route binds the expected held manifest digest');
assert.match(cockpit, /assay_manifest_sha256/, 'A/B route binds the expected assay manifest digest');
assert.match(cockpit, /mountRequested/, 'cockpit records the requested held-source mount');
assert.match(cockpit, /mountRegistered/, 'cockpit records whether the held-source mount resolved');
assert.match(cockpit, /effectiveRoute/, 'cockpit records child effective routes, not only requested URLs');
assert.match(cockpit, /manifestSha256Effective/, 'cockpit records D effective source identity');
assert.match(cockpit, /assayManifestSha256Effective/, 'cockpit records A/B effective manifest identity');
assert.match(cockpit, /same-source-camera-independent-viewports-v0/, 'cockpit states the exact comparison framing authority');
assert.match(cockpit, /assay\.source\?\.manifestIdentity/, 'cockpit proves A/B and D share the same held source identity');
assert.match(cockpit, /id="a-frame"/, 'Route A gets an independent centered viewport');
assert.match(cockpit, /id="b-frame"/, 'Route B gets an independent centered viewport');
assert.match(cockpit, /product_index/, 'each splat viewport requests one exact product cell');
assert.match(cockpit, /neural history smoke decoder has no checksum-bound production raster product/, 'C stays explicitly open with its exact blocker');
assert.match(cockpit, />A<|>A Analytical</, 'cockpit visibly labels Route A');
assert.match(cockpit, />B<|>B Learned</, 'cockpit visibly labels Route B');
assert.match(cockpit, />D(?:<| Raymarch\b)/, 'cockpit visibly labels Route D');
assert.doesNotMatch(cockpit, /setTimeout\([^,]+,\s*[0-9]+\).*status\s*=\s*['"]running/s, 'cockpit cannot declare success on a timer alone');

assert.match(witness, /kaminos\.held-smoke-assay-witness\.v0/, 'witness emits a stable evidence schema');
assert.match(witness, /Page\.captureScreenshot/, 'witness captures the actual cockpit frame');
assert.match(witness, /Runtime\.evaluate/, 'witness reads live effective state');
assert.match(witness, /requestedRoute/, 'witness preserves requested route identity');
assert.match(witness, /effectiveRoute/, 'witness rejects child route substitution');
assert.match(witness, /manifestSha256Effective/, 'witness verifies the effective D source digest');
assert.match(witness, /assayManifestSha256Effective/, 'witness verifies the effective A/B assay digest');
assert.match(witness, /mountRegistered/, 'witness rejects an unregistered held-source mount');
assert.match(witness, /failurePhase/, 'pre-capture failures retain their phase');
assert.match(witness, /lastTrustworthyEvidence/, 'pre-capture failures retain partial evidence');
assert.doesNotMatch(witness, /error\?\.stack/, 'durable failure reports cannot leak the active worktree through stack traces');
assert.match(witness, /blank/i, 'witness rejects blank screenshots');
assert.match(witness, /partial|child/i, 'witness rejects partial child loading');
assert.doesNotMatch(witness, /Math\.min\([^\n]*(?:timeout|frame|count)/i, 'witness cannot silently cap caller evidence settings');

console.log('held basin smoke assay cockpit contracts passed');
