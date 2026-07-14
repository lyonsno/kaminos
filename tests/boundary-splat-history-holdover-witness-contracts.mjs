import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const witnessUrl = new URL('../volume-boundary-splat-history-holdover-witness.mjs', import.meta.url);
assert.equal(existsSync(witnessUrl), true, 'the Greenroom holdover witness must exist');

const witness = readFileSync(witnessUrl, 'utf8');
assert.match(witness, /--holdover-frames/, 'caller must own the bounded repeat count');
assert.match(witness, /--minimum-source-age-generations/, 'caller must own the minimum truthful holdback age');
assert.match(witness, /sampleBoundarySplatHistorySlotMetadata/, 'slot choice must consume direct GPU metadata readback');
assert.match(witness, /archiveWriteSequence:\s*selectedSlot\.archiveWriteSequence \+ 1/, 'witness must prove an overwritten selection fails before accepted playback');
assert.match(witness, /slot-overwritten-after-selection/, 'stale-slot rejection must remain visible in report evidence');
assert.match(witness, /renderBoundarySplatHistorySlotToCanvas/, 'witness must use the draw-only holdover socket');
assert.match(witness, /boundarySplatInstances:\s*100/, 'witness must adversarially try to override the one-instance boundary');
assert.match(witness, /simulationSubmitted[\s\S]*sidecarSubmitted[\s\S]*compactionSubmitted[\s\S]*archiveSubmitted/, 'every accepted frame must deny source work');
assert.match(witness, /gpu-indirect-command-buffer-post-submit-readback-v0/, 'accepted playback must retain physical command authority');
assert.match(witness, /sourceCandidateGeneration/, 'each playback row must retain its archived source identity');
assert.match(witness, /Page\.captureScreenshot/, 'the witness must retain the actual composed canvas');
assert.match(witness, /requestedEffectiveRouteAgreement/, 'report must preserve requested/effective route identity');
assert.match(witness, /lastTrustworthyEvidence/, 'pre-output failure must preserve the last trustworthy evidence');
assert.match(witness, /sameBrowserTargetPreserved/, 'report must prove the existing target survived');
assert.match(witness, /simStepCountAfterResume/, 'witness must prove the ordinary live simulator resumed after holdover');
assert.doesNotMatch(witness, /spawn\(/, 'the holdover witness must never launch a second browser');
assert.doesNotMatch(witness, /slice\(0,\s*\d+\)/, 'the witness must not hide a caller-requested repeat count behind a cap');

const invalidOutDir = mkdtempSync(join(tmpdir(), 'kaminos-history-holdover-invalid-'));
const invalidReport = join(invalidOutDir, 'nested', 'report.json');
const invalidRun = spawnSync(process.execPath, [
  witnessUrl.pathname,
  '--url', 'http://127.0.0.1:1/?kaminos_volume_smoke=1',
  '--out-dir', invalidOutDir,
  '--report', invalidReport,
  '--holdover-frames', '0',
], { encoding: 'utf8' });
assert.notEqual(invalidRun.status, 0, 'invalid invocation must fail');
const failure = JSON.parse(readFileSync(invalidReport, 'utf8'));
assert.equal(failure.status, 'failed', 'startup failure must leave a durable failed report');
assert.equal(failure.failurePhase, 'startup', 'startup failure report must name its phase');
assert.match(failure.error, /--holdover-frames must be positive/, 'startup report must preserve the rejected input');

console.log('boundary splat history holdover witness contracts passed');
