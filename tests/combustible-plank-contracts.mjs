import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname;
const corePath = join(root, 'combustible-plank-core.js');
const pagePath = join(root, 'combustible-plank.html');
const witnessPath = join(root, 'combustible-plank-witness.mjs');

assert.ok(existsSync(corePath), 'combustible plank causal core exists');
assert.ok(existsSync(pagePath), 'combustible plank browser witness exists');
assert.ok(existsSync(witnessPath), 'combustible plank visual witness runner exists');

const {
  COMBUSTIBLE_PLANK_ROUTE,
  COMBUSTIBLE_PLANK_SCHEMA,
  COMBUSTIBLE_PLANK_SOURCE_AUTHORITY,
  buildCombustiblePlankWitnessScenario,
  createCombustiblePlankState,
  stepCombustiblePlank,
} = await import('../combustible-plank-core.js');

assert.equal(COMBUSTIBLE_PLANK_SCHEMA, 'kaminos.combustible-structural-plank.v0');
assert.equal(COMBUSTIBLE_PLANK_ROUTE, 'kaminos.combustible-plank-support-collapse.v0');
assert.equal(
  COMBUSTIBLE_PLANK_SOURCE_AUTHORITY,
  'internal-object-side-combustion-v0',
  'source authority does not impersonate live Pyro composition',
);

let burning = createCombustiblePlankState({ ignition: true });
let control = createCombustiblePlankState({ ignition: false });

for (let step = 0; step < 360; step += 1) {
  burning = stepCombustiblePlank(burning, 1 / 60);
  control = stepCombustiblePlank(control, 1 / 60);
}

assert.equal(control.support.failed, false, 'unburned matched control remains supported');
assert.equal(control.material.remainingFuel, 1, 'unburned control does not lose fuel');
assert.equal(control.support.capacity, 1, 'unburned control retains full support capacity');
assert.equal(control.motion.angleRad, 0, 'unburned control does not rotate');
assert.equal(control.motion.verticalDrop, 0, 'unburned control does not fall');

assert.equal(burning.support.failed, true, 'combusted plank loses load-bearing support');
assert.equal(
  burning.support.failureCause,
  'combustion-support-capacity-below-load-demand',
  'support failure names the combustion-to-load causal threshold',
);
assert.ok(burning.support.failureStep > burning.combustion.ignitionStep, 'support loss occurs after ignition');
assert.ok(burning.support.capacity < burning.support.demand, 'failed plank capacity is below applied load demand');
assert.ok(burning.material.remainingFuel < 0.45, 'support loss consumes a material amount of plank fuel');
assert.ok(burning.material.charMass > 0.08, 'combustion leaves persistent char');
assert.ok(burning.material.emittedVolatiles > 0.25, 'combustion emits source-accounted volatiles');
assert.equal(burning.material.accountingResidual, 0, 'fuel, char, volatiles, and residue reconcile exactly');
assert.ok(burning.motion.angleRad > 0.35, 'failed plank visibly rotates under gravity');
assert.ok(burning.motion.verticalDrop > 0.5, 'failed plank visibly drops from its supported pose');
assert.ok(burning.motion.impactStep > burning.support.failureStep, 'impact follows support loss rather than causing it');

const scenario = buildCombustiblePlankWitnessScenario({ steps: 360, dt: 1 / 60 });
assert.equal(scenario.schema, COMBUSTIBLE_PLANK_SCHEMA, 'scenario preserves state schema identity');
assert.equal(scenario.requestedRoute, COMBUSTIBLE_PLANK_ROUTE, 'scenario records requested route identity');
assert.equal(scenario.effectiveRoute, COMBUSTIBLE_PLANK_ROUTE, 'scenario records effective route identity');
assert.equal(scenario.sourceAuthority, COMBUSTIBLE_PLANK_SOURCE_AUTHORITY, 'scenario records bounded source authority');
assert.equal(scenario.fallback, null, 'scenario does not silently substitute a fallback route');
assert.equal(scenario.control.support.failed, false, 'scenario carries a standing unburned control');
assert.equal(scenario.burning.support.failed, true, 'scenario carries the combusted collapse result');
assert.equal(scenario.events[0].kind, 'ignition', 'ignition is the first causal event');
assert.ok(
  scenario.events.findIndex(event => event.kind === 'support-loss') <
    scenario.events.findIndex(event => event.kind === 'impact'),
  'scenario event order is ignition, support loss, then impact',
);

const pageSource = readFileSync(pagePath, 'utf8');
const witnessSource = readFileSync(witnessPath, 'utf8');
assert.match(pageSource, /kaminosCombustiblePlankDebugState/, 'browser exposes inspectable causal state');
assert.match(pageSource, /combustible-plank-core\.js/, 'browser consumes the deterministic plank core');
assert.match(pageSource, /control/i, 'browser labels the matched unburned control');
assert.match(pageSource, /internal object-side/i, 'browser labels its bounded combustion source authority');
assert.match(witnessSource, /requestedUrl/, 'witness records requested browser route');
assert.match(witnessSource, /effectiveUrl/, 'witness records effective browser route');
assert.match(witnessSource, /requestedViewport/, 'witness records requested viewport identity');
assert.match(witnessSource, /effectiveViewport/, 'witness records effective viewport identity');
assert.match(witnessSource, /support-loss/, 'witness requires the causal support-loss event');
assert.match(witnessSource, /control/, 'witness rejects collapse of the matched control');
assert.doesNotMatch(pageSource, /Math\.min\(1200/, 'debug advancement does not silently cap caller steps');

const failureStem = `/tmp/kaminos-combustible-plank-contract-failure-${process.pid}`;
const failureReportPath = `${failureStem}.json`;
const failureOutPath = `${failureStem}.png`;
const missingChromePath = `${failureStem}-missing-chrome`;
rmSync(failureReportPath, { force: true });
rmSync(failureOutPath, { force: true });
const failedWitness = spawnSync(process.execPath, [
  witnessPath,
  '--url', 'http://127.0.0.1:1/combustible-plank.html?plank_autoplay=0',
  '--out', failureOutPath,
  '--report', failureReportPath,
  '--debug-port', String(19000 + (process.pid % 1000)),
], {
  env: { ...process.env, KAMINOS_CHROME: missingChromePath },
  encoding: 'utf8',
  timeout: 5_000,
});
assert.notEqual(failedWitness.status, 0, 'witness launch failure exits nonzero');
assert.ok(existsSync(failureReportPath), 'witness preserves a report when Chrome fails before primary output');
const failedReport = JSON.parse(readFileSync(failureReportPath, 'utf8'));
assert.equal(failedReport.status, 'failed', 'pre-output report names failed status');
assert.match(failedReport.phase, /^failed:launching-chrome$/, 'pre-output report names the failure phase');
assert.equal(failedReport.effectiveUrl, null, 'pre-navigation failure does not invent an effective URL');
assert.equal(failedReport.fallback, null, 'pre-navigation failure does not disguise itself as fallback success');
assert.equal(existsSync(failureOutPath), false, 'pre-navigation failure does not leave a fake primary screenshot');
rmSync(failureReportPath, { force: true });
