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

// Read index.html as text to verify DOM contracts
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('Tray tab exists in tab bar', () => {
  assert.ok(html.includes('data-tab="tray"'), 'missing tray tab in tab bar');
});

test('Tray tab-content panel exists', () => {
  assert.ok(html.includes('id="tab-tray"'), 'missing tab-tray content div');
});

test('Route composition tray panel exists', () => {
  assert.ok(html.includes('id="route-composition-tray-panel"'), 'missing tray panel');
});

test('Fixture tray button exists', () => {
  assert.ok(html.includes('id="route-composition-tray-fixture-button"'), 'missing fixture button');
});

test('Clear button exists', () => {
  assert.ok(html.includes('id="route-composition-tray-clear-button"'), 'missing clear button');
});

test('Source section exists', () => {
  assert.ok(html.includes('id="route-composition-tray-sources"'), 'missing sources container');
});

test('Conditioning section exists', () => {
  assert.ok(html.includes('id="route-composition-tray-conditioning"'), 'missing conditioning container');
});

test('Route runs section exists', () => {
  assert.ok(html.includes('id="route-composition-tray-runs"'), 'missing runs container');
});

test('Outputs section exists', () => {
  assert.ok(html.includes('id="route-composition-tray-outputs"'), 'missing outputs container');
});

test('Diagnostics section exists', () => {
  assert.ok(html.includes('id="route-composition-tray-diagnostics"'), 'missing diagnostics');
  assert.ok(html.includes('id="route-composition-tray-id"'), 'missing tray id field');
  assert.ok(html.includes('id="route-composition-tray-source-count"'), 'missing source count');
  assert.ok(html.includes('id="route-composition-tray-conditioning-count"'), 'missing conditioning count');
  assert.ok(html.includes('id="route-composition-tray-run-count"'), 'missing run count');
  assert.ok(html.includes('id="route-composition-tray-output-count"'), 'missing output count');
});

test('Tray section labels use person-facing language', () => {
  assert.ok(html.includes('Source Images'), 'missing human-readable "Source Images" label');
  assert.ok(html.includes('Conditioning Layers'), 'missing human-readable "Conditioning Layers" label');
  assert.ok(html.includes('Route Runs'), 'missing human-readable "Route Runs" label');
  assert.ok(html.includes('Outputs'), 'missing human-readable "Outputs" label');
  assert.ok(html.includes('Composition Tray'), 'missing human-readable "Composition Tray" heading');
});

test('Window API for witness testing is exposed', () => {
  assert.ok(html.includes('window.kaminosRouteCompositionTrayState'), 'missing window.kaminosRouteCompositionTrayState');
  assert.ok(html.includes('window.kaminosLoadRouteCompositionFixtureTray'), 'missing window.kaminosLoadRouteCompositionFixtureTray');
  assert.ok(html.includes('window.kaminosClearRouteCompositionTray'), 'missing window.kaminosClearRouteCompositionTray');
});

test('Tray auto-loads fixture when URL param route_composition_tray_fixture is present', () => {
  assert.ok(html.includes('route_composition_tray_fixture'), 'missing auto-load URL param support');
});

test('FALSE-CLOSURE: fixture display labels are distinct from generated/live', () => {
  // Verify the source kind display map distinguishes fixture from generated
  assert.ok(html.includes("'fixture': 'Fixture'"), 'fixture display label not found');
  assert.ok(html.includes("'generated': 'Generated'"), 'generated display label not found');
  assert.ok(html.includes("'imported-external': 'External import'"), 'imported-external display label not found');
});

test('FALSE-CLOSURE: missing-backend status has distinct display', () => {
  assert.ok(html.includes("'missing-backend': 'Backend unavailable'"), 'missing-backend status display not found');
});

test('FALSE-CLOSURE: route humanization replaces underscores', () => {
  assert.ok(html.includes('.replace(/_/g,'), 'route humanization does not replace underscores');
});

console.log(`\nroute-composition-tray bridge contracts: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
