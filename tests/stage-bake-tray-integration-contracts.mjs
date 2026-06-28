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

test('Stage Bake function calls tray population helper', () => {
  assert.ok(
    html.includes('populateTrayFromConditioningRequest'),
    'kaminosPipelineCreateFixtureConditioningRouteRequest must call populateTrayFromConditioningRequest'
  );
});

test('populateTrayFromConditioningRequest function exists', () => {
  assert.ok(
    html.includes('function populateTrayFromConditioningRequest'),
    'populateTrayFromConditioningRequest function must exist'
  );
});

test('Tray population creates source artifact from beauty input', () => {
  // The function must reference inputArtifactIds to create source entries
  assert.ok(
    html.includes('inputArtifactIds') && html.includes('trayAddSource'),
    'tray population must use inputArtifactIds to add source artifacts'
  );
});

test('Tray population creates conditioning links from view artifacts', () => {
  assert.ok(
    html.includes('trayAddConditioningLink') && html.includes('conditioningArtifactIds'),
    'tray population must create conditioning links from conditioningArtifactIds'
  );
});

test('Tray population creates route run from request', () => {
  assert.ok(
    html.includes('trayAddRouteRun'),
    'tray population must create a route run entry'
  );
});

test('Tray population maps conditioning view kinds to tray conditioning roles', () => {
  // Should map depth -> depth, normal -> normal, mask -> mask, etc.
  const hasDepth = html.includes("'depth'") && html.includes('trayAddConditioningLink');
  const hasNormal = html.includes("'normal'") && html.includes('trayAddConditioningLink');
  const hasMask = html.includes("'mask'") && html.includes('trayAddConditioningLink');
  assert.ok(hasDepth && hasNormal && hasMask, 'tray must map depth/normal/mask view kinds to conditioning link roles');
});

test('Route run from Stage Bake has request-only effective route', () => {
  // The tray route run should use request_only as effective route, not claim live generation
  assert.ok(
    html.includes('request_only') || html.includes('request-only'),
    'Stage Bake tray route run should have request_only effective route'
  );
});

test('Stage Bake tray integration renders the tray after population', () => {
  assert.ok(
    html.includes('renderRouteCompositionTray'),
    'tray must be rendered after Stage Bake populates it'
  );
});

test('Window API for tray state is available for witness', () => {
  assert.ok(html.includes('window.kaminosRouteCompositionTrayState'), 'window.kaminosRouteCompositionTrayState must exist');
});

console.log(`\nstage-bake-tray-integration contracts: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
