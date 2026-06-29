import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const root = new URL('..', import.meta.url).pathname;
const dir = mkdtempSync(join(tmpdir(), 'kaminos-kiln-volume-fire-witness-'));
const out = join(dir, 'witness.json');

execFileSync(process.execPath, ['kiln-volume-fire-witness.mjs', '--out', out], {
  cwd: root,
  stdio: 'pipe',
});

const report = JSON.parse(readFileSync(out, 'utf8'));

assert.equal(report.schema, 'beaming.volume-fire.route-activity-witness-report.v0');
assert.equal(report.toolId, 'beaming-kiln-volume-fire-witness-v0');
assert.equal(report.effectiveFixture, 'wake-route-activity-bridge-fixture-v0');
assert.equal(report.requestedOut, out);
assert.equal(report.witness.schema, 'beaming.volume-fire.route-activity-witness.v0');
assert.equal(report.witness.visualBackendId, 'beaming.volume-fire.kiln-v0');
assert.equal(report.witness.routeRunCount, 7);
assert.equal(report.witness.fullBurnCount, 1);
assert.equal(report.witness.phaseCounts.preheat, 1);
assert.equal(report.witness.phaseCounts.completion_blaze, 1);
assert.equal(report.witness.phaseCounts.snuff, 1);
assert.equal(report.witness.effectCounts.preheat, 1);
assert.equal(report.witness.effectCounts.completion_blaze, 1);
assert.equal(report.witness.effectCounts.failure_snuff, 1);
assert.equal(report.witness.primaryBridge.routeRunId, 'live-run');
assert.equal(report.witness.primaryBridge.routeIdentity.requestedRoute, 'adapter.moge-local-webgpu.v0');
assert.equal(report.witness.primaryBridge.routeIdentity.effectiveRoute, 'adapter.moge-local-webgpu.v0');
assert.equal(report.witness.primaryBridge.visualReceipt.volumeParams.volume_pressure_strategy, 'spatial_tiers');
assert.ok(report.witness.falseAuthorityViolations.includes('fallback-run:volume_full_burn_without_live_compute'));
assert.ok(report.witness.truthWarnings.includes('fallback_kiln_not_requested_route'));
assert.ok(report.witness.truthWarnings.includes('kiln_backend_unavailable'));
assert.ok(report.witness.truthWarnings.includes('route_failed_after_backend_error'));

for (const bridge of report.witness.bridges) {
  assert.equal(bridge.visualBackendId, 'beaming.volume-fire.kiln-v0');
  assert.equal(bridge.routeActivitySchema, 'kaminos.kiln.route-activity.v0');
  assert.equal(bridge.lifecycleEffect.schema, 'beaming.volume-fire.lifecycle-effect.v0');
  assert.ok(Object.hasOwn(bridge.visualReceipt.volumeParams, 'kaminos_volume_smoke'));
}
