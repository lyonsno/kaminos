import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (err) {
    failed++;
    console.error(`FAIL: ${name}\n  ${err.message}`);
  }
}

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('browser tray defines kiln activity schema and states', () => {
  assert.ok(html.includes('KILN_ACTIVITY_STATE_SCHEMA_BROWSER'), 'missing browser kiln schema constant');
  for (const state of ['cold', 'queued', 'warming', 'burning', 'banking', 'cooled', 'failed', 'cached', 'fixture', 'fallback', 'unavailable']) {
    assert.ok(html.includes(`'${state}'`), `missing browser kiln state ${state}`);
  }
});

test('browser derives kiln state from route truth', () => {
  assert.ok(html.includes('function deriveBrowserKilnActivityState'), 'missing deriveBrowserKilnActivityState');
  assert.ok(html.includes('allowsFullBurn'), 'kiln state must expose full-burn authority');
  assert.ok(html.includes('claimsLiveCompute'), 'kiln state must expose live-compute claim');
  assert.ok(html.includes('cached_not_fresh_compute'), 'cached kiln state must warn');
  assert.ok(html.includes('fixture_kiln_not_live_compute'), 'fixture kiln state must warn');
  assert.ok(html.includes('kiln_backend_unavailable'), 'unavailable kiln state must warn');
});

test('browser route runs carry kiln activity state', () => {
  assert.ok(html.includes('const kilnActivity = deriveBrowserKilnActivityState'), 'tray route runs must derive kiln activity');
  assert.ok(html.includes('kilnActivity,'), 'tray route runs must attach kiln activity');
});

test('tray renders kiln activity tile beside route source truth', () => {
  assert.ok(html.includes('route-composition-tray-kiln-tile'), 'missing kiln tile render class');
  assert.ok(html.includes('data-kiln-activity-state'), 'missing kiln activity state data attribute');
  assert.ok(html.includes('data-kiln-truth-mode'), 'missing kiln truth mode data attribute');
  assert.ok(html.includes('data-kiln-full-burn'), 'missing full-burn data attribute');
});

test('kiln tile preserves operator-facing labels without root ontology leak', () => {
  assert.ok(html.includes('Kiln'), 'kiln tile should be legible');
  assert.ok(html.includes('Live compute'), 'live compute label should be visible');
  assert.ok(html.includes('Fixture'), 'fixture label should be visible');
  assert.ok(!html.includes('Root Request'), 'operator UI must not expose root-request language');
});

test('fixture load exposes kiln witness on window for browser smoke', () => {
  assert.ok(html.includes('window.kaminosRouteCompositionTrayKilnWitness'), 'missing kiln witness window API');
});

console.log(`\nkiln activity UI contracts: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
