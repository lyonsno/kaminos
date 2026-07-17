#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const witness = readFileSync(new URL('../volume-layer-coefficient-live-union-witness.mjs', import.meta.url), 'utf8');

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
  'Page.captureScreenshot',
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
assert.match(witness, /catch \(error\)[\s\S]*writeReport\(\{[\s\S]*status: 'failed'/, 'failure before primary output still writes a durable phase-local report');

console.log('volume layer coefficient live union witness contracts passed');
