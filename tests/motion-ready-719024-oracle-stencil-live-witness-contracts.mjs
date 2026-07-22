import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const witness = readFileSync(new URL('../motion-ready-719024-stencil-live-witness.mjs', import.meta.url), 'utf8');

assert.match(witness, /kaminos\.motion-ready-719024\.oracle-stencil-live-witness\.v0/, 'live witness writes a stable report schema');
assert.match(witness, /writeReport\(\{\s*ok: false/s, 'live witness preserves failures before primary output');
assert.match(witness, /lastTrustworthyEvidence/, 'live witness records the last trustworthy phase');
assert.match(witness, /requestedUrl/, 'live witness records its requested route');
assert.match(witness, /effectiveUrl/, 'live witness records its effective route');
assert.match(witness, /repoRoot/, 'live witness records the reviewed repository root');
assert.match(witness, /gitHead/, 'live witness records the reviewed source revision');
assert.match(witness, /dirtyStatus/, 'live witness records whether source differs from the reviewed revision');
assert.match(witness, /servedHtmlHash/, 'live witness records the effective served HTML identity');
assert.match(witness, /servedModuleHash/, 'live witness records the effective served stencil-module identity');
assert.match(witness, /implementation effective-byte identity mismatch/, 'live witness fails loud when served code differs from reviewed source');
assert.match(witness, /requestedStencilSource/, 'live witness distinguishes requested stencil input');
assert.match(witness, /effectiveStencilSource/, 'live witness rejects silent stencil fallback');
assert.match(witness, /blank operator draft/, 'live witness verifies that fresh authoring starts blank');
assert.match(witness, /Page\.captureScreenshot/, 'live witness captures the operator-facing viewport');
assert.match(witness, /localStorage/, 'live witness exercises semantic save and reload');
assert.match(witness, /stencilHash/, 'live witness proves round-trip semantic identity');
assert.match(witness, /derivedBinding/, 'live witness reports derived binding separately');
assert.match(witness, /consoleFailures/, 'live witness rejects browser console failures');
assert.match(witness, /body-axis/, 'live witness authors the body-axis primitive');
assert.match(witness, /appendage-chain/, 'live witness authors an appendage chain');
assert.match(witness, /contact-patch/, 'live witness authors a contact patch');
assert.match(witness, /preservation-region/, 'live witness authors a preservation region');
assert.match(witness, /acceptance must remain disabled/, 'live witness rejects blank and incomplete acceptance');
assert.match(witness, /complete stencil did not enable acceptance/, 'live witness proves the complete primitive set unlocks acceptance');

console.log('motion-ready-719024 oracle stencil live witness contracts passed');
