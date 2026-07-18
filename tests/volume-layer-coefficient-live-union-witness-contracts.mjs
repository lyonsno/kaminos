#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const witness = readFileSync(new URL('../volume-layer-coefficient-live-union-witness.mjs', import.meta.url), 'utf8');

assert.match(witness, /kaminos\.volume\.layer-coefficient-live-union-witness\.v0/, 'witness publishes a stable report schema');
assert.equal((witness.match(/spawn\(chromeExecutable\(\)/g) || []).length, 1, 'witness owns exactly one Chrome process');
for (const token of [
  '--source-field-manifest',
  '--source-capture-report',
  '--exact-overlay-manifest',
  '--baseline-overlay-manifest',
  '--flow-overlay-manifest',
  'beginDebugFullFieldImport',
  'finishDebugFullFieldImport',
  'auditBoundarySplatLiveUnionSourceHashes',
  'auditBoundarySplatLiveUnionCoefficientOverlayPopulation',
  'setFullSupportDepositionMode',
  'flow-tangent-five-tap-bilinear-v0',
  'kernel_moment_full_flame_union',
  'analytical-exact',
  'learned-baseline',
  'learned-flow',
  'matched-raymarch',
  'includeRgba',
  'rgbaBase64',
  'gpu-presentation-texture-rgba8-readback-frozen-sim-state',
  'sameStateCaptureId',
  'sourceSimStepCount',
  'effectiveOverlayIdentity',
  'fullSupportDepositionEffective',
  'stableNativeCellIdSha256',
]) {
  assert.match(witness, new RegExp(token), `witness preserves ${token}`);
}
assert.match(witness, /createServer/, 'witness owns an explicit same-origin app and coefficient-package mount server');
assert.match(witness, /effectiveServerRoots/, 'report exposes the effective worktree and package mount roots');
assert.match(witness, /source-hash-audit-mismatch/, 'witness rejects imported or derived source hash substitution');
assert.match(witness, /population-audit/, 'witness rejects partial, overflowed, missing, or stale live union populations');
assert.match(witness, /blank-capture/, 'witness rejects blank operator-visible output');
assert.match(witness, /captureCssRect/, 'witness records top-level capture geometry separately from the inner canvas geometry');
assert.match(witness, /frameCssRect/, 'witness translates nested volume-frame coordinates into the top-level screenshot surface');
assert.match(witness, /canvasElement\(\)/, 'witness captures the renderer-owned canvas instead of an ambiguous diagnostic canvas');
assert.match(witness, /canvas\.classList\.add\('active'\)/, 'witness presents the frozen renderer canvas without restarting simulation');
assert.match(witness, /encodePngRgba/, 'witness encodes the renderer-owned GPU readback rather than relying on page compositing');
assert.match(witness, /duplicate-condition-image/, 'witness rejects a capture surface that returns the same image for distinct render conditions');
assert.match(witness, /elapsedMs/, 'witness measures each condition instead of reporting integration cost from intuition');
assert.match(witness, /same-state-drift/, 'witness rejects simulation movement between matched conditions');
assert.match(witness, /\/api\/volume-settings-presets/, 'witness server supplies the renderer preset index API instead of allowing a page-level 404');
assert.match(witness, /\/api\/pipeline-manifest/, 'witness server supplies the pipeline manifest API instead of allowing a page-level 404');
assert.match(witness, /browser-event-audit/, 'witness names browser event admission as an explicit failure phase');
assert.match(witness, /Runtime\.exceptionThrown/, 'witness rejects unhandled browser runtime exceptions');
assert.match(witness, /Log\.entryAdded[\s\S]*level[\s\S]*error/, 'witness rejects browser error log entries');
assert.ok(
  witness.indexOf("failurePhase = 'browser-event-audit'") < witness.indexOf("status: 'captured'"),
  'browser errors must be adjudicated before the witness can report a captured artifact',
);
assert.match(witness, /catch \(error\)[\s\S]*writeReport\(\{[\s\S]*status: 'failed'/, 'failure before primary output still writes a durable phase-local report');
assert.ok(
  witness.indexOf('class CdpSocket') < witness.indexOf('try {\n  validateInputs();'),
  'CDP client must be initialized before top-level witness execution',
);
assert.match(
  witness,
  /catch \(error\) \{\n\s+if \(error\.runtimeReported\) throw error;/,
  'runtime-reported route errors fail immediately instead of burning the whole admission timeout',
);

console.log('volume layer coefficient live union witness contracts passed');
