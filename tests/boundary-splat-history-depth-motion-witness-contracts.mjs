import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const witnessUrl = new URL('../boundary-splat-history-depth-motion-witness.mjs', import.meta.url);
const witness = await readFile(witnessUrl, 'utf8');

assert.match(witness, /kaminos\.volume\.boundary-splat-history-depth-motion-witness\.v0/, 'witness must publish a stable schema');
assert.match(witness, /REQUIRED_HISTORY_DEPTHS\s*=\s*\[16,\s*32,\s*64\]/, 'witness must require all operator-signed depths');
assert.match(witness, /measureHistoryUpperRung/, 'upper rung must be measured from runtime/device authority');
assert.match(witness, /historyDepthRows/, 'report must preserve every serial depth row');
assert.match(witness, /measuredUpperRung/, 'report must distinguish the measured upper rung');
assert.match(witness, /requestedEffectiveDepthAgreement/, 'each row must fail on requested/effective depth substitution');
assert.match(witness, /requestedEffectiveRouteAgreement/, 'each row must preserve requested/effective route identity');
assert.match(witness, /matchedSubstrateIdentity/, 'rows must prove matched basin, renderer, model, camera, and layout');
assert.match(witness, /boundarySplatHistoryAllocatedSlots/, 'rows must preserve physical allocation depth');
assert.match(witness, /boundarySplatBufferIntegrity/, 'rows must preserve physical history memory authority');
assert.match(witness, /primeBoundarySplatLiveHistory/, 'every depth must be fully primed before capture');
assert.match(witness, /sampleBoundarySplatPbrCostLadder/, 'every depth must record measured raster work');
assert.match(witness, /perSourceReuse/, 'rows must report selected history-slot reuse');
assert.match(witness, /Page\.captureScreenshot/, 'motion frames must come from the effective browser canvas');
assert.match(witness, /ffmpeg/, 'witness must encode operator-visible motion');
assert.doesNotMatch(witness, /-stream_loop/, 'motion output must not loop a frame or clip');
assert.match(witness, /missing-or-blank-frame/, 'blank or partial frames must fail loud');
assert.match(witness, /cached-or-static-motion/, 'repeated output must not pretend to be motion evidence');
assert.match(witness, /lastTrustworthyEvidence/, 'pre-output failures must leave durable evidence');
assert.match(witness, /failurePhase/, 'durable failures must identify their phase');
assert.match(witness, /browserProcessId/, 'one persistent browser identity must span every depth');
assert.match(witness, /pageId/, 'one page target identity must span every depth');
assert.match(witness, /CDP debug port already in use before launch/, 'witness must refuse a stale browser endpoint before launch');
assert.doesNotMatch(witness, /slice\(0,\s*\d+\)/, 'caller-requested frame/depth flow must not be silently capped');

const invalidRoot = mkdtempSync(join(tmpdir(), 'kaminos-history-depth-invalid-'));
const invalidReport = join(invalidRoot, 'nested', 'report.json');
const invalid = spawnSync(process.execPath, [
  witnessUrl.pathname,
  '--url', 'http://127.0.0.1:1/?kaminos_volume_smoke=1',
  '--out-dir', invalidRoot,
  '--report', invalidReport,
  '--history-depths', '16,16,64',
], { encoding: 'utf8' });
assert.notEqual(invalid.status, 0, 'duplicate/missing required depth invocation must fail');
const failure = JSON.parse(readFileSync(invalidReport, 'utf8'));
assert.equal(failure.status, 'failed', 'startup failure must leave a durable failed report');
assert.equal(failure.failurePhase, 'startup', 'startup failure must identify its phase');
assert.match(failure.error, /history depths must be unique/, 'failure must preserve the rejected duplicate depth');

const malformedRoot = mkdtempSync(join(tmpdir(), 'kaminos-history-depth-malformed-'));
const malformedReport = join(malformedRoot, 'nested', 'report.json');
const malformed = spawnSync(process.execPath, [
  witnessUrl.pathname,
  '--url', 'http://127.0.0.1:1/?kaminos_volume_smoke=1',
  '--out-dir', malformedRoot,
  '--report', malformedReport,
  '--frames', '0',
], { encoding: 'utf8' });
assert.notEqual(malformed.status, 0, 'malformed numeric input must fail');
const malformedFailure = JSON.parse(readFileSync(malformedReport, 'utf8'));
assert.equal(malformedFailure.status, 'failed', 'malformed input must still leave a durable failed report');
assert.equal(malformedFailure.failurePhase, 'startup', 'malformed input failure must identify startup');
assert.match(malformedFailure.error, /--frames must be a positive integer/, 'malformed report must retain the rejected input');

console.log('boundary splat history depth motion witness contracts passed');
