import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const root = new URL('..', import.meta.url).pathname;
const volumeWitnessSource = readFileSync(join(root, 'volume-witness.mjs'), 'utf8');
const dir = mkdtempSync(join(tmpdir(), 'kaminos-kiln-volume-fire-visual-witness-'));
const out = join(dir, 'route-fire.png');
const reportPath = join(dir, 'route-fire.json');

execFileSync(process.execPath, [
  'kiln-volume-fire-visual-witness.mjs',
  '--dry-run',
  '--out',
  out,
  '--report',
  reportPath,
], {
  cwd: root,
  stdio: 'pipe',
});

const report = JSON.parse(readFileSync(reportPath, 'utf8'));

assert.equal(report.schema, 'beaming.volume-fire.route-activity-visual-witness-report.v0');
assert.equal(report.toolId, 'beaming-kiln-volume-fire-visual-witness-v0');
assert.equal(report.dryRun, true);
assert.equal(report.evidenceMode, 'performance');
assert.equal(report.acceptanceSurface, 'beaming-volume-witness-current-renderer');
assert.equal(report.visualWitnessReport, null);
assert.equal(report.screenshot, out);
assert.equal(report.routeActivityWitness.schema, 'beaming.volume-fire.route-activity-witness.v0');
assert.equal(report.routeActivityWitness.fullBurnCount, 1);
assert.equal(report.primaryBridge.routeRunId, 'live-run');
assert.equal(report.primaryBridge.routeActivitySchema, 'kaminos.kiln.route-activity.v0');
assert.equal(report.primaryBridge.routeIdentity.requestedRoute, 'adapter.moge-local-webgpu.v0');
assert.equal(report.primaryBridge.routeIdentity.effectiveRoute, 'adapter.moge-local-webgpu.v0');
assert.equal(report.primaryBridge.routeIdentity.backendClass, 'browser-webgpu');
assert.equal(report.primaryBridge.visualReceipt.visualBackendId, 'beaming.volume-fire.kiln-v0');
assert.equal(report.primaryBridge.visualReceipt.visualPhase, 'burn');
assert.equal(report.primaryBridge.visualReceipt.allowsFullBurn, true);
assert.ok(report.routeActivityWitness.falseAuthorityViolations.includes('fallback-run:volume_full_burn_without_live_compute'));
assert.ok(report.routeActivityWitness.truthWarnings.includes('fallback_kiln_not_requested_route'));

const url = new URL(report.volumeWitnessUrl);
assert.equal(url.searchParams.get('kaminos_volume_smoke'), '1');
assert.equal(url.searchParams.get('volume_scene'), 'tall_plume');
assert.equal(url.searchParams.get('volume_tall_preset'), 'operator_fire_0622');
assert.equal(url.searchParams.get('volume_pressure_strategy'), 'spatial_tiers');
assert.equal(url.searchParams.get('volume_resolution'), '128');
assert.equal(url.searchParams.get('volume_majorant_grid'), '48');
assert.equal(url.searchParams.get('volume_density'), '3.05');
assert.equal(url.searchParams.get('volume_fire'), '0.1');
assert.equal(url.searchParams.get('volume_radiance'), '2.9');
assert.equal(url.searchParams.get('volume_absorption'), '2');
assert.equal(url.searchParams.get('volume_glow'), '2.5');
assert.equal(url.searchParams.get('volume_smoke'), '2.8');
assert.equal(url.searchParams.get('volume_curl'), '2.3');
assert.equal(url.searchParams.get('volume_fire_licks'), '3.25');
assert.equal(url.searchParams.get('volume_projection'), '0.25');
assert.equal(url.searchParams.get('volume_speed'), '5');
assert.equal(url.searchParams.get('volume_steps'), '160');
assert.equal(url.searchParams.get('volume_fire_scale'), '0.42');
assert.equal(url.searchParams.get('volume_plume_height'), '0.7');
assert.equal(url.searchParams.get('volume_render_scale'), '0.95');

assert.match(volumeWitnessSource, /visualSourceTruth:\s*\{/, 'live volume witness report names visual source truth');
assert.match(volumeWitnessSource, /source:\s*'live-webgpu-volume'/, 'live volume witness report identifies live WebGPU volume as source');
assert.match(volumeWitnessSource, /mayClaimLiveNovelty:\s*true/, 'live volume witness may claim novelty only after GPU readback succeeds');
