// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import * as combustion from '../volume-reactant-combustion.mjs';
import { physicsSootKelvin, resolvePhysicsAppearance, physicsAppearanceUniformValues } from '../volume-physics-appearance.mjs';
import { migrateRetiredVolumeSettingsPresetDocument } from '../volume-retired-control-migration.mjs';
import { readFileSync } from 'node:fs';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('new flames use the accepted methane-air reference in the material and burnout uniform', () => {
  const reference = JSON.parse(readFileSync(new URL('./fixtures/flame-temperature-reference.json', import.meta.url)));
  const anchor = reference.rows.find(row => row.initialKelvin === 300 && row.equivalenceRatio === 1);
  const fit = combustion.calibrateReactantTemperature({ initialKelvin: 300, finalKelvin: anchor.finalKelvin, fuel: 0.25, oxidizer: 0.75 });
  const resolved = resolvePhysicsAppearance({}, { reactantAdmitted: true, emissiveRouteEffective: true });
  assert.equal(resolved.kelvinPerHeat, fit.kelvinPerHeat);
  assert.equal(physicsAppearanceUniformValues(resolved)[1], fit.kelvinPerHeat);
  assert.equal(physicsSootKelvin(1.5, resolved.kelvinPerHeat), anchor.finalKelvin);
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const input = html.match(/<input[^>]*id="volume-physical-kelvin-per-heat"[^>]*>/)[0];
  assert.equal(Number(input.match(/value="([^"]+)"/)[1]), fit.kelvinPerHeat, 'the cockpit starts with the same scale as the renderer');
});

test('saved calibration overrides and pre-calibration basins keep their temperature scale', () => {
  const schema = JSON.parse(readFileSync(new URL('../volume-settings-preset-schema-v2.json', import.meta.url)));
  const key = 'volume-physical-kelvin-per-heat';
  const descriptor = schema.controls.find(c => c.key === key);
  assert.equal(descriptor.additiveDefault, 1600, 'migration default is historical, not the new-flame default');
  for (const scale of [949.18689, 1600, 1283.6830556513362]) {
    assert.equal(resolvePhysicsAppearance({ physicalKelvinPerHeat: scale }).kelvinPerHeat, scale);
  }
  const old = { preset: { domControls: {}, route: 'http://kaminos.invalid/?kaminos_volume_smoke=1', controlCount: 0 } };
  const migrated = migrateRetiredVolumeSettingsPresetDocument(old, schema).document;
  assert.equal(migrated.preset.domControls[key].value, 1600);
  assert.equal(new URL(migrated.preset.route).searchParams.get(descriptor.param), '1600');
  assert.equal(old.preset.domControls[key], undefined, 'migration does not mutate the saved source');
});

test('reference calibration uses heat gain, not the final heat or brightness', () => {
  assert.equal(typeof combustion.calibrateReactantTemperature, 'function',
    'combustion must expose a no-loss reference calibration, independent of appearance');
  const c = combustion.calibrateReactantTemperature({
    initialKelvin: 600, finalKelvin: 2400, fuel: 0.25, oxidizer: 0.75,
  });
  assert.equal(c.burnableFuel, 0.25);
  assert.equal(c.heatRise, 1.5);
  assert.equal(c.kelvinPerHeat, 1200);
  assert.equal(c.kelvinPerFuelBurned, 7200);
  assert.equal(physicsSootKelvin(c.initialHeat + c.heatRise, c.kelvinPerHeat), 2400);
});

test('calibration accounts for oxygen limitation and rejects an impossible reference', () => {
  const calibrate = combustion.calibrateReactantTemperature;
  const reference = { initialKelvin: 300, finalKelvin: 2100, fuel: 0.5, oxidizer: 0.6 };
  const c = calibrate(reference);
  assert.ok(Math.abs(c.burnableFuel - 0.2) < 1e-14);
  assert.ok(Math.abs(c.kelvinPerHeat - 1500) < 1e-10);
  for (const bad of [{ fuel: 0 }, { oxidizer: -1 }, { finalKelvin: 300 }, { initialKelvin: 200 }, { initialKelvin: NaN }]) {
    assert.throws(() => calibrate({ ...reference, ...bad }));
  }
  assert.throws(() => calibrate(reference, { ...combustion.REACTANT_MODEL, heatOfCombustion: 0 }));
  assert.throws(() => calibrate(reference, { ...combustion.REACTANT_MODEL, oxidizerRequirement: Infinity }));
});

test('changing heat storage units preserves temperature gain per fuel burned', () => {
  const reference = { initialKelvin: 600, finalKelvin: 2400, fuel: 0.25, oxidizer: 0.75 };
  const a = combustion.calibrateReactantTemperature(reference);
  const b = combustion.calibrateReactantTemperature(reference, { ...combustion.REACTANT_MODEL, heatOfCombustion: 12 });
  assert.equal(b.kelvinPerHeat, a.kelvinPerHeat / 2);
  assert.equal(b.kelvinPerFuelBurned, a.kelvinPerFuelBurned);
});

test('reference comparison retains off-anchor errors and does not claim a cold parcel ignites', async () => {
  const assay = await import('../tools/flame-temperature-calibration.mjs').catch(e => {
    if (e.code === 'ERR_MODULE_NOT_FOUND' && e.url?.endsWith('/tools/flame-temperature-calibration.mjs')) return {};
    throw e;
  });
  assert.equal(typeof assay.compareTemperatureReference, 'function', 'a comparison must retain the entire reference, not just its fitted anchor');
  const reference = JSON.parse(readFileSync(new URL('./fixtures/flame-temperature-reference.json', import.meta.url)));
  const report = assay.compareTemperatureReference(reference);
  assert.equal(report.rows.length, reference.rows.length);
  assert.ok(Math.abs(report.calibration.kelvinPerHeat - 1283.68305565) < 1e-6);
  assert.equal(report.rows[2].potentialErrorKelvin, 0);
  assert.ok(report.rows[5].potentialErrorKelvin > 270, 'the rich residual is real, not auto-fitted away');
  assert.equal(report.rows[2].localBurn.status, 'not-ignited');
  assert.equal(report.rows[2].localBurn.burned, 0);
  assert.equal(report.rows[7].localBurn.status, 'depleted');
  assert.ok(report.rows[7].localBurn.energyResidual < 1e-10);
  assert.ok(report.rows[7].localBurn.subdivisionDifferenceKelvin < 1e-6);
  assert.deepEqual(reference.requested.cases, report.rows.map(r => ({ initialKelvin: r.initialKelvin, equivalenceRatio: r.equivalenceRatio })));
  assert.equal(combustion.REACTANT_MODEL.heatOfCombustion, 6, 'calibration does not mutate production coefficients');
});

test('reference comparison cannot certify wrong-route, partial, stale-case or nonconserving output', async () => {
  const assay = await import('../tools/flame-temperature-calibration.mjs').catch(e => {
    if (e.code === 'ERR_MODULE_NOT_FOUND' && e.url?.endsWith('/tools/flame-temperature-calibration.mjs')) return {};
    throw e;
  });
  assert.equal(typeof assay.compareTemperatureReference, 'function');
  const good = JSON.parse(readFileSync(new URL('./fixtures/flame-temperature-reference.json', import.meta.url)));
  for (const mutate of [
    x => { x.status = 'failed'; },
    x => { x.effective.constraint = 'UV'; },
    x => { x.effective.backend = 'mock'; },
    x => { x.rows.pop(); },
    x => { x.rows[0].equivalenceRatio = 1; },
    x => { x.rows[0].finalKelvin = NaN; },
    x => { x.rows[0].initial.temperatureKelvin = 900; },
    x => { x.rows[0].final.enthalpyMass += 1e5; },
    x => { x.rows[0].final.pressurePa *= 2; },
    x => { x.rows[0].final.massFractions = {}; },
  ]) {
    const bad = structuredClone(good); mutate(bad);
    assert.throws(() => assay.compareTemperatureReference(bad));
  }
  const additive = structuredClone(good); additive.effective.annotation = 'new metadata';
  assert.equal(assay.compareTemperatureReference(additive).rows.length, good.rows.length);
});

test('CLI preserves a failure report before any primary output exists', () => {
  const out = join(mkdtempSync(join(tmpdir(), 'flame-calibration-')), 'failure.json');
  const result = spawnSync(process.execPath, ['tools/flame-temperature-calibration.mjs', '--reference', `${out}.missing`, '--out', out],
    { cwd: new URL('../', import.meta.url), encoding: 'utf8' });
  assert.equal(result.status, 1);
  const report = JSON.parse(readFileSync(out));
  assert.equal(report.status, 'failed');
  assert.equal(report.phase, 'reference-read');
  assert.match(report.error, /ENOENT/);
  assert.equal(report.calibration, undefined);
});

test('reference generator reports input failure without a Cantera installation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'flame-reference-failure-'));
  const input = join(dir, 'request.json');
  const out = join(dir, 'report.json');
  writeFileSync(input, '{"pressurePa":1e400}');
  const result = spawnSync('python3', ['-S', 'tools/flame-temperature-reference.py', '--input', input, '--out', out],
    { cwd: new URL('../', import.meta.url), encoding: 'utf8' });
  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(readFileSync(out));
  assert.equal(report.status, 'failed');
  assert.equal(report.phase, 'input');
  assert.match(report.error, /non-finite JSON/);
});
