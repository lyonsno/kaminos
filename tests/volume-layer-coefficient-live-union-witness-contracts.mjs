#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const witness = readFileSync(new URL('../volume-layer-coefficient-live-union-witness.mjs', import.meta.url), 'utf8');
const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');

assert.match(witness, /kaminos\.volume\.layer-coefficient-live-union-witness\.v0/, 'witness publishes a stable report schema');
assert.equal((witness.match(/spawn\(chromeExecutable\(\)/g) || []).length, 1, 'witness owns exactly one Chrome process');
assert.ok(
  witness.indexOf('class CdpSocket') < witness.indexOf('socket = new CdpSocket'),
  'CDP client must be initialized before top-level witness execution enters browser launch',
);
for (const token of [
  '--source-field-manifest',
  '--source-capture-report',
  '--baseline-overlay-manifest',
  '--flow-overlay-manifest',
  'beginDebugFullFieldImport',
  'finishDebugFullFieldImport',
  'auditBoundarySplatLiveUnionSourceHashes',
  'auditBoundarySplatLiveUnionCoefficientOverlayPopulation',
  'kernel_moment_full_flame_union',
  'analytical-exact',
  'learned-baseline',
  'learned-flow',
  'matched-raymarch',
  'sameStateCaptureId',
  'sourceSimStepCount',
  'effectiveOverlayIdentity',
  'stableNativeCellIdSha256',
]) {
  assert.match(witness, new RegExp(token), `witness preserves ${token}`);
}
assert.match(witness, /createServer/, 'witness owns an explicit same-origin app and coefficient-package mount server');
assert.match(witness, /effectiveServerRoots/, 'report exposes the effective worktree and package mount roots');
assert.match(witness, /source-hash-audit-mismatch/, 'witness rejects imported or derived source hash substitution');
assert.match(witness, /population-audit/, 'witness rejects partial, overflowed, missing, or stale live union populations');
assert.match(witness, /blank-capture/, 'witness rejects blank operator-visible output');
assert.match(witness, /same-state-drift/, 'witness rejects simulation movement between matched conditions');
assert.match(witness, /document\.querySelector\('#basin'\)/, 'witness resolves the child renderer iframe on the top-level page');
assert.match(witness, /includeRgba:\s*true/, 'witness requests exact frozen-render RGBA readback');
assert.match(witness, /render\.rgbaCapture/, 'witness consumes pixels returned by the frozen renderer instead of page-shell pixels');
assert.match(witness, /gpu-rgba8-readback-frozen-sim-state-v0/, 'report names the exact GPU readback image authority');
assert.match(witness, /OffscreenCanvas/, 'witness PNG-encodes exact GPU pixels in the child runtime before CDP transport');
assert.match(witness, /pngBase64/, 'witness transports a compact PNG instead of millions of JSON integers');
assert.match(witness, /includeRgba:\s*!overlay/, 'overlay population priming does not request an unused pixel payload');
assert.doesNotMatch(witness, /Page\.captureScreenshot/, 'witness must not let application-shell pixels satisfy visual evidence gates');
assert.match(witness, /condition\.render\.controlOverrides\.boundarySplatMode/, 'union-mode assertion reads a field actually returned by the frozen renderer');
assert.match(witness, /condition\.overlay\?\.unionReceipt \|\| condition\.populationAudit\?\.unionReceipt/, 'union assertion reads the receipt from analytical and overlay condition shapes');
assert.match(witness, /gpu-validation-error/, 'witness rejects WebGPU validation errors instead of presenting black captures');
const frozenStart = core.indexOf('async function renderFrozenScaleToCanvas');
const frozenEnd = core.indexOf('async function sampleDeterministicReplayFrame', frozenStart);
const frozenBody = core.slice(frozenStart, frozenEnd);
assert.match(frozenBody, /options\.includeRgba === true/, 'frozen renderer accepts an exact RGBA readback request');
assert.match(frozenBody, /boundarySplatReadbackPipeline/, 'frozen RGBA path uses the splat pipeline matching the rgba8 readback target');
assert.match(frozenBody, /readbackPipeline/, 'frozen RGBA path uses the raymarch pipeline matching the rgba8 readback target');
assert.match(frozenBody, /device\.pushErrorScope\('validation'\)/, 'frozen RGBA pass opens a validation scope before encoding');
assert.match(frozenBody, /frozen-rgba8-readback-validation/, 'frozen RGBA pass fails loud on scoped GPU validation errors');
assert.match(frozenBody, /readTextureRgba8\(\s*frameTexture/, 'frozen renderer reads the exact offscreen rgba8 target after rendering');
assert.match(
  witness,
  /catch \(error\) \{\s*last = \{ error: error\?\.message \|\| String\(error\) \};\s*await delay\(250\);\s*continue;\s*\}\s*if \(last\?\.error\) throw new Error\(`volume runtime reported error:/,
  'authoritative runtime errors escape admission polling immediately instead of burning the full timeout',
);
assert.match(witness, /catch \(error\)[\s\S]*writeReport\(\{[\s\S]*status: 'failed'/, 'failure before primary output still writes a durable phase-local report');

console.log('volume layer coefficient live union witness contracts passed');
