import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../scripts/smoke-kimodo-shared-device.mjs', import.meta.url), 'utf8');

assert.match(source, /writeReport\(['"]starting['"]\)/, 'the witness writes a durable receipt before browser launch');
assert.match(source, /finally\s*\{[\s\S]*writeReport/, 'the witness publishes its terminal state even when launch, load, or generation fails');
assert.match(source, /deviceTopology\s*!==\s*['"]same-device['"]/, 'the witness rejects a topology claim weaker than one shared GPUDevice');
assert.match(source, /queueTopology\s*!==\s*['"]exact-device-queue['"]/, 'the witness rejects separate or merely compatible queues');
assert.match(source, /source\.status\s*!==\s*['"]built['"]/, 'the witness rejects a missing or partial derived source manifest');
assert.match(source, /frameCount[\s\S]*simStepCount/, 'the witness records live flame progress rather than page nonblankness alone');
assert.match(source, /foregroundReceipts/, 'the witness retains the foreground service receipts that establish actual scheduled frames');
assert.match(source, /embeddingAuthority/, 'the witness distinguishes a live encoder from a replayed embedding fixture');
assert.match(source, /embeddingFixtureSha256/, 'a replayed embedding is tied to exact fixture bytes');
assert.match(source, /screenshot/, 'the witness captures a human-inspectable rendered frame');
assert.doesNotMatch(source, /slice\(-|splice\(|\.shift\(\)/, 'the witness does not erase earlier contention evidence');

console.log('Kimodo shared-device smoke contracts passed');
