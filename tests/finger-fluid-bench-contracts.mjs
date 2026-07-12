import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const benchCorePath = join(root, 'finger-fluid-bench-core.js');
const benchWitnessPath = join(root, 'finger-fluid-bench-witness.mjs');
const indexPath = join(root, 'index.html');

assert.ok(existsSync(benchCorePath), 'Kaminos-native finger fluid bench core exists');
assert.ok(existsSync(benchWitnessPath), 'Kaminos-native finger fluid bench witness exists');
assert.ok(existsSync(indexPath), 'Kaminos app shell exists');

const benchCoreSource = readFileSync(benchCorePath, 'utf8');
const benchWitnessSource = readFileSync(benchWitnessPath, 'utf8');
const indexSource = readFileSync(indexPath, 'utf8');

assert.match(benchCoreSource, /KAMINOS_FINGER_FLUID_BENCH_STATE_SCHEMA\s*=\s*'kaminos\.finger-fluid-bench\.state\.v0'/, 'bench state schema is explicit');
assert.match(benchCoreSource, /KAMINOS_FINGER_FLUID_BENCH_ROUTE\s*=\s*'kaminos\/finger-fluid-bench'/, 'bench route identity is explicit');
assert.match(benchCoreSource, /BIG_PAPA_FLUID_SOURCE_SCHEMA\s*=\s*'big-papa\.finger-fluid\.synthetic-source\.v0'/, 'bench source schema is explicit');
assert.match(benchCoreSource, /browser-fluid-research-bench-v0/, 'bench records research-bench solver identity');
assert.match(benchCoreSource, /kaminos_native_synthetic_fluid_not_lerms_source_truth/, 'bench keeps synthetic source downgrade loud');
assert.match(benchCoreSource, /fluid_field_render_not_final_finger_juice/, 'bench distinguishes fluid-field render from final Finger Juice');
assert.match(benchCoreSource, /createFingerFluidBenchState/, 'bench core exports state creation');

assert.match(indexSource, /data-tab="finger-fluid-bench"/, 'Kaminos sidebar exposes a Finger Fluid bench tab');
assert.match(indexSource, /id="tab-finger-fluid-bench"/, 'Kaminos app shell contains Finger Fluid bench content');
assert.match(indexSource, /kaminos_finger_fluid_bench=1/, 'Kaminos route can open directly into the fluid bench');
assert.match(indexSource, /id="finger-fluid-bench-canvas"/, 'fluid bench owns a native canvas');
assert.match(indexSource, /window\.kaminosFingerFluidBenchDebugState/, 'fluid bench exposes browser witness state');
assert.match(indexSource, /kaminos\/finger-fluid-bench/, 'fluid bench displays route identity');
assert.doesNotMatch(indexSource, /finger-fluid-bench-open-direct/, 'fluid bench must not expose Open Direct/new-tab acceptance escape');
assert.doesNotMatch(indexSource, /id="finger-fluid-bench-frame"/, 'fluid bench must not use iframe as acceptance surface');

assert.match(benchWitnessSource, /kaminos_finger_fluid_bench=1/, 'bench witness opens the native fluid bench route');
assert.match(benchWitnessSource, /kaminosFingerFluidBenchDebugState/, 'bench witness reads native fluid bench debug state');
assert.match(benchWitnessSource, /kaminos\.finger-fluid-bench\.state\.v0/, 'bench witness requires bench state schema');
assert.match(benchWitnessSource, /primary_output_written/, 'bench witness writes durable failure reports before screenshot success');
assert.match(benchWitnessSource, /activeRatio/, 'bench witness measures visible activity ratio');
assert.match(benchWitnessSource, /kaminos_native_synthetic_fluid_not_lerms_source_truth/, 'bench witness requires synthetic downgrade evidence');

const mod = await import(benchCorePath);
assert.equal(mod.KAMINOS_FINGER_FLUID_BENCH_STATE_SCHEMA, 'kaminos.finger-fluid-bench.state.v0');
assert.equal(mod.KAMINOS_FINGER_FLUID_BENCH_ROUTE, 'kaminos/finger-fluid-bench');
assert.equal(mod.BIG_PAPA_FLUID_SOURCE_SCHEMA, 'big-papa.finger-fluid.synthetic-source.v0');
assert.equal(typeof mod.createFingerFluidBenchState, 'function');

const state = mod.createFingerFluidBenchState({
  viewport: { width: 1280, height: 800 },
  timeSeconds: 2.5,
  fieldColumns: 96,
  fieldRows: 64,
  basinFillRatio: 0.46,
  activeRatio: 0.38,
  frameTimeMsEstimate: 26.5,
});

assert.equal(state.schema, 'kaminos.finger-fluid-bench.state.v0');
assert.equal(state.route, 'kaminos/finger-fluid-bench');
assert.equal(state.source.schema, 'big-papa.finger-fluid.synthetic-source.v0');
assert.equal(state.source.producerDiaulos, 'big-papa-finger-fluid');
assert.equal(state.solver.identity, 'browser-fluid-research-bench-v0');
assert.equal(state.renderer.identity, 'kaminos-native-fluid-field-canvas-v0');
assert.equal(state.graduation.mode, 'remain_in_kaminos_terrarium_until_source_exports_earn_extraction');
assert.ok(state.downgrades.includes('kaminos_native_synthetic_fluid_not_lerms_source_truth'));
assert.ok(state.downgrades.includes('fluid_field_render_not_final_finger_juice'));
assert.ok(state.compatibility.lermsEventSchemas.includes('lerms.juice-hit-event.v0'));
assert.ok(state.visual.activeRatio >= 0.38);
assert.ok(state.visual.basinFillRatio >= 0.46);
assert.equal(state.acceptance.acceptanceSurface, 'native_kaminos_route');
assert.equal(state.acceptance.iframeAcceptance, false);
assert.equal(state.acceptance.openDirectAcceptance, false);
