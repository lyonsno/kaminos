import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const root = new URL('..', import.meta.url).pathname;
const dir = mkdtempSync(join(tmpdir(), 'kaminos-hand-surface-witness-'));
const out = join(dir, 'witness.json');
const svg = join(dir, 'witness.svg');

execFileSync(process.execPath, ['hand-surface-compositor-witness.mjs', '--out', out, '--svg', svg], {
  cwd: root,
  stdio: 'pipe',
});

const report = JSON.parse(readFileSync(out, 'utf8'));
const svgText = readFileSync(svg, 'utf8');
const demoHtml = readFileSync(join(root, 'hand-surface-compositor-demo.html'), 'utf8');

assert.equal(report.schema, 'kaminos.tracked-hand-surface-witness-report.v0');
assert.equal(report.toolId, 'kaminos-hand-surface-compositor-witness-v0');
assert.equal(report.witnessSchema, 'kaminos.tracked-hand-surface-witness.v0');
assert.equal(report.effectiveFixture, 'perceptasia-live-wilor-shape-fixture-v0');
assert.equal(report.requestedOut, out);
assert.equal(report.svgPath, svg);
assert.equal(report.witness.schema, 'kaminos.tracked-hand-surface-compositor.v0');
assert.equal(report.witness.authority, 'live_tracked_hand_surface');
assert.equal(report.witness.sourceTruth.owner, 'kaminos');
assert.equal(report.witness.sourceTruth.sourceSchema, 'perceptasia.hand-control.v0');
assert.equal(report.witness.sourceTruth.endpoint.effective, '/hand-control-sidecar-event');
assert.equal(report.witness.consumerBridge.sourceTruthOwner, 'kaminos');
assert.equal(report.witness.consumerBridge.ownership, 'consumer');
assert.equal(report.witness.surface.denseMano.present, true);
assert.equal(report.witness.surface.surfaceSource, 'dense_mano');
assert.deepEqual(report.witness.falseAuthorityViolations, []);
assert.ok(existsSync(svg));
assert.match(svgText, /kaminos-tracked-hand-surface-witness/);
assert.match(svgText, /webcam-ground-truth/);
assert.match(svgText, /consumer: lerms-hand-surface-field/);
assert.match(demoHtml, /kaminosTrackedHandSurfaceDebugState/);
assert.match(demoHtml, /hand_packet_url/);
assert.match(demoHtml, /composeTrackedHandSurface/);
assert.doesNotMatch(demoHtml, /__perceptasiaDebug/);
assert.doesNotMatch(demoHtml, /iframe/i);

const replayOut = join(dir, 'replay.json');
execFileSync(process.execPath, ['hand-surface-compositor-witness.mjs', '--out', replayOut, '--fixture', 'replay'], {
  cwd: root,
  stdio: 'pipe',
});
const replay = JSON.parse(readFileSync(replayOut, 'utf8'));
assert.equal(replay.witness.authority, 'synthetic_or_replay_surface');
assert.ok(replay.witness.falseAuthorityViolations.includes('consumer_must_not_claim_live_from_replay_backend'));

console.log('ok - hand-surface compositor witness contracts');
