import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { deflateSync } from 'node:zlib';

const root = new URL('..', import.meta.url).pathname;
const corePath = join(root, 'combustible-plank-core.js');
const pagePath = join(root, 'combustible-plank.html');
const witnessPath = join(root, 'combustible-plank-witness.mjs');
const pixelChecksPath = join(root, 'combustible-plank-pixel-checks.mjs');

assert.ok(existsSync(corePath), 'combustible plank causal core exists');
assert.ok(existsSync(pagePath), 'combustible plank browser witness exists');
assert.ok(existsSync(witnessPath), 'combustible plank visual witness runner exists');
assert.ok(existsSync(pixelChecksPath), 'combustible plank decoded-pixel checks exist');

const {
  COMBUSTIBLE_PLANK_ROUTE,
  COMBUSTIBLE_PLANK_SCHEMA,
  COMBUSTIBLE_PLANK_SOURCE_AUTHORITY,
  buildCombustiblePlankWitnessScenario,
  createCombustiblePlankState,
  stepCombustiblePlank,
} = await import('../combustible-plank-core.js');
const { validateWitnessPixelSequence } = await import('../combustible-plank-pixel-checks.mjs');

function pngChunk(type, data) {
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4, 4, 'ascii');
  data.copy(chunk, 8);
  return chunk;
}

function syntheticPng(phase, blank = false) {
  const width = 80;
  const height = 64;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    for (let x = 0; x < width; x += 1) {
      const offset = row + 1 + x * 4;
      let color = blank ? [0, 0, 0] : [36, 38, 32];
      if (!blank && ((y < 5 || y > 59) && x % 4 < 2)) color = [220, 220, 210];
      if (!blank && y >= 25 && y <= 34 && x >= 8 && x <= 70) color = [190, 108, 48];
      if (!blank && phase === 'combustion' && y >= 18 && y <= 26 && x >= 49 && x <= 55) color = [255, 190, 36];
      if (!blank && phase === 'fallen' && y >= 35 && y <= 49 && x >= 45 && x <= 68) color = [175, 91, 40];
      raw[offset] = color[0];
      raw[offset + 1] = color[1];
      raw[offset + 2] = color[2];
      raw[offset + 3] = 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const pixelProof = validateWitnessPixelSequence({
  initial: syntheticPng('initial'),
  combustion: syntheticPng('combustion'),
  final: syntheticPng('fallen'),
});
assert.equal(pixelProof.method, 'decoded-composed-png-phase-regions-v0');
assert.ok(pixelProof.phases.combustion.flamePixels > pixelProof.phases.initial.flamePixels);
assert.ok(pixelProof.deltas.initialToFinal.changedRatio > 0, 'pixel proof records visible collapse delta');
let blankPixelError = null;
try {
  validateWitnessPixelSequence({
    initial: syntheticPng('initial', true),
    combustion: syntheticPng('combustion', true),
    final: syntheticPng('fallen', true),
  });
} catch (error) {
  blankPixelError = error;
}
assert.match(
  String(blankPixelError?.message),
  /blank|wood|text|visual/i,
  'route-correct blank captures fail decoded-pixel validation',
);
assert.equal(blankPixelError?.pixelChecks?.status, 'failed', 'pixel rejection carries failed status');
assert.equal(
  blankPixelError?.pixelChecks?.phases?.initial?.width,
  80,
  'pixel rejection preserves its last trustworthy decoded phase metrics',
);

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

let boundary = createCombustiblePlankState({ ignition: true });
while (!boundary.support.failed && boundary.step < 360) {
  boundary = stepCombustiblePlank(boundary, 1 / 60);
}
assert.equal(boundary.support.failed, true, 'threshold walk reaches support loss');
assert.equal(boundary.phase, 'support-lost', 'threshold-crossing state exposes support loss before motion');
assert.equal(boundary.motion.angularVelocity, 0, 'threshold-crossing state has no gravity velocity yet');
assert.equal(boundary.motion.angleRad, 0, 'threshold-crossing state has not rotated yet');
assert.equal(boundary.motion.verticalDrop, 0, 'threshold-crossing state has not dropped yet');
const firstFalling = stepCombustiblePlank(boundary, 1 / 60);
assert.equal(firstFalling.phase, 'falling', 'gravity begins on the step after support loss');
assert.ok(firstFalling.motion.angularVelocity > 0, 'post-boundary state gains gravity velocity');
assert.ok(firstFalling.motion.angleRad > 0, 'post-boundary state rotates');
assert.equal(firstFalling.support.failureStep, boundary.support.failureStep, 'failure identity remains at threshold step');

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
assert.match(witnessSource, /waitForRequestedTarget/, 'witness stabilizes the exact requested page before evaluation');
assert.match(witnessSource, /validateWitnessPixelSequence/, 'witness gates success on decoded composed pixels');
assert.match(
  witnessSource,
  /Page\.captureScreenshot[^\n]+fromSurface: false[^\n]+captureTimeoutMs\)/,
  'composed screenshot capture uses its caller-visible watchdog instead of the generic CDP timeout',
);
assert.match(witnessSource, /phase = 'capturing-initial'/, 'witness reports the exact initial capture phase');
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
assert.equal(failedReport.captureTimeoutMs, 120_000, 'report records the effective compositor watchdog');
assert.equal(failedReport.screenshots.initial, null, 'failure report does not invent an unwritten initial screenshot');
assert.equal(existsSync(failureOutPath), false, 'pre-navigation failure does not leave a fake primary screenshot');
rmSync(failureReportPath, { force: true });
