import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  BEAMING_KILN_ROUTE_FIRE_BENCH_SCHEMA,
  buildKilnVolumeFireBenchModel,
} from '../kiln-volume-fire-bench.mjs';

const root = new URL('..', import.meta.url).pathname;
const index = readFileSync(join(root, 'index.html'), 'utf8');

const bench = buildKilnVolumeFireBenchModel({
  baseUrl: 'http://127.0.0.1:18114/',
});

assert.equal(BEAMING_KILN_ROUTE_FIRE_BENCH_SCHEMA, 'beaming.volume-fire.route-activity-bench.v0');
assert.equal(bench.schema, BEAMING_KILN_ROUTE_FIRE_BENCH_SCHEMA);
assert.equal(bench.routeActivitySchema, 'kaminos.kiln.route-activity.v0');
assert.equal(bench.visualBackendId, 'beaming.volume-fire.kiln-v0');
assert.equal(bench.acceptanceSurface, 'beaming-volume-witness-current-renderer');
assert.equal(bench.evidenceMode, 'performance');
assert.equal(bench.witness.schema, 'beaming.volume-fire.route-activity-witness.v0');
assert.equal(bench.witness.routeRunCount, 4);
assert.equal(bench.witness.fullBurnCount, 1);
assert.equal(bench.primaryBridge.routeRunId, 'live-run');
assert.equal(bench.primaryBridge.visualReceipt.allowsFullBurn, true);
assert.equal(bench.primaryBridge.routeActivitySchema, 'kaminos.kiln.route-activity.v0');
assert.equal(bench.primaryBridge.visualReceipt.visualBackendId, 'beaming.volume-fire.kiln-v0');
assert.ok(bench.falseAuthorityViolations.includes('fallback-run:volume_full_burn_without_live_compute'));
assert.ok(bench.truthWarnings.includes('fallback_kiln_not_requested_route'));

const fallbackRow = bench.routeRows.find(row => row.routeRunId === 'fallback-run');
assert.ok(fallbackRow);
assert.equal(fallbackRow.allowsFullBurn, false);
assert.equal(fallbackRow.truthMode, 'fallback');
assert.equal(fallbackRow.visualPhase, 'weak_heat');

const url = new URL(bench.launchUrl);
assert.equal(url.searchParams.get('kaminos_volume_smoke'), '1');
assert.equal(url.searchParams.get('volume_scene'), 'tall_plume');
assert.equal(url.searchParams.get('volume_tall_preset'), 'operator_fire_0622');
assert.equal(url.searchParams.get('volume_pressure_strategy'), 'spatial_tiers');
assert.equal(url.searchParams.get('volume_resolution'), '128');
assert.equal(url.searchParams.get('volume_majorant_grid'), '48');
assert.equal(url.searchParams.get('volume_fire'), '0.1');
assert.equal(url.searchParams.get('volume_fire_scale'), '0.42');
assert.equal(url.searchParams.get('volume_render_scale'), '0.95');

assert.match(index, /id="route-fire-bench"/, 'Volume tab hosts the route-fire bench');
assert.match(index, /data-route-fire-bench-schema="beaming\.volume-fire\.route-activity-bench\.v0"/, 'bench DOM preserves schema identity');
assert.match(index, /id="route-fire-launch"/, 'bench exposes a launch link into the current renderer');
assert.match(index, /id="route-fire-route-rows"/, 'bench exposes route rows instead of a single hidden summary');
assert.match(index, /data-route-fire-field="routeActivitySchema"/, 'bench exposes route-activity schema truth');
assert.match(index, /data-route-fire-field="visualBackendId"/, 'bench exposes Beaming visual backend truth');
assert.match(index, /data-route-fire-field="falseAuthorityViolations"/, 'bench exposes false-authority diagnostics');
assert.match(index, /buildKilnVolumeFireBenchModel/, 'Volume tab derives bench state from the shared route-fire model');
assert.match(index, /renderRouteFireBench/, 'Volume tab renders route-fire bench state explicitly');
