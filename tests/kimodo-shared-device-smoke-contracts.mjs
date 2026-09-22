import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../scripts/smoke-kimodo-shared-device.mjs', import.meta.url), 'utf8');

assert.match(source, /writeReport\(['"]starting['"]\)/, 'the witness writes a durable receipt before browser launch');
assert.match(source, /finally\s*\{[\s\S]*writeReport/, 'the witness publishes its terminal state even when launch, load, or generation fails');
assert.match(source, /validateMountedComposition/, 'the witness delegates mount and exact-topology adjudication to the executable contract');
assert.match(source, /source\.status\s*!==\s*['"]built['"]/, 'the witness rejects a missing or partial derived source manifest');
assert.match(source, /frameCount[\s\S]*simStepCount/, 'the witness records live flame progress rather than page nonblankness alone');
assert.match(source, /wallMs:\s*lastRun\.wallMs/, 'the witness reports the run duration field actually retained by the page');
assert.doesNotMatch(source, /elapsedMs:\s*lastRun\.elapsedMs/, 'the witness cannot silently publish an undefined legacy duration field');
assert.match(source, /foregroundReceipts/, 'the witness retains the foreground service receipts that establish actual scheduled frames');
assert.match(source, /embeddingAuthority/, 'the witness distinguishes a live encoder from a replayed embedding fixture');
assert.match(source, /embeddingFixtureSha256/, 'a replayed embedding is tied to exact fixture bytes');
assert.match(source, /screenshot/, 'the witness captures a human-inspectable rendered frame');
assert.match(source, /total-timeout-ms/, 'the witness has a bounded total product-run deadline');
assert.match(source, /no-progress-timeout-ms/, 'the witness distinguishes a no-progress wedge from merely slow generation');
assert.match(source, /lastRun\.foregroundReceipts/, 'the witness adjudicates receipts from the current run rather than page-global history');
assert.match(source, /validateSuccessfulRun/, 'the witness delegates same-run receipt and flame-progress adjudication to the executable contract');
assert.match(source, /__kaminosCompositionSetup[\s\S]*mounted/, 'the witness rejects a partial HUD/device receipt when composition mount failed');
assert.match(
  source,
  /report\.classification[\s\S]*writeReport\(['"]failed['"]\)[\s\S]*report\.teardown\s*=/,
  'terminal failure is durably published before best-effort page teardown can hang',
);
assert.match(source, /verifyIdentityMap[\s\S]*sourceManifest\.bundles/, 'smoke rehashes admitted producer and telemetry bundles');
assert.match(source, /verifyIdentityMap[\s\S]*sourceManifest\.assets/, 'smoke rehashes admitted model and metadata assets');
assert.match(source, /verifyRuntimeKitSource/, 'smoke verifies the effective inference-kit implementation closure, not only its version string');
assert.doesNotMatch(source, /slice\(-|splice\(|\.shift\(\)/, 'the witness does not erase earlier contention evidence');

console.log('Kimodo shared-device smoke contracts passed');
