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

// --- Import capability ---

test('Drop zone exists for image import', () => {
  assert.ok(html.includes('id="route-composition-tray-drop-zone"'), 'missing drop zone');
});

test('File input exists for image import', () => {
  assert.ok(html.includes('id="route-composition-tray-file-input"'), 'missing file input');
});

test('trayImportImageFile function exists', () => {
  assert.ok(html.includes('function trayImportImageFile'), 'missing trayImportImageFile');
});

test('trayImportFromPaste function exists', () => {
  assert.ok(html.includes('function trayImportFromPaste'), 'missing trayImportFromPaste');
});

test('Paste handler is wired to tray tab', () => {
  assert.ok(html.includes("addEventListener('paste'"), 'missing paste event listener');
  assert.ok(html.includes('tab-tray'), 'paste handler should check tray tab active');
});

test('Drop handler calls trayImportImageFile', () => {
  assert.ok(html.includes('trayImportImageFile') && html.includes("'drop'"), 'drop handler must import image file');
});

test('Import creates source with imported-manual source kind', () => {
  assert.ok(html.includes("sourceKind: 'imported-manual'") && html.includes('trayImportImageFile'), 'import must use imported-manual source kind');
});

test('Window API exposes trayImportImageFile', () => {
  assert.ok(html.includes('window.kaminosTrayImportImageFile'), 'missing window.kaminosTrayImportImageFile');
});

// --- Output as conditioning reuse ---

test('trayUseAsConditioning function exists', () => {
  assert.ok(html.includes('function trayUseAsConditioning'), 'missing trayUseAsConditioning');
});

test('trayUseAsConditioning is exposed on window', () => {
  assert.ok(html.includes('window.trayUseAsConditioning'), 'missing window.trayUseAsConditioning');
});

test('Conditioning reuse buttons rendered on source artifacts', () => {
  assert.ok(html.includes('data-tray-reuse-buttons'), 'missing reuse buttons container');
  assert.ok(html.includes('data-tray-reuse-role'), 'missing reuse role buttons');
});

test('Reuse buttons include reference, mask, depth, normal, source-image roles', () => {
  // These are in a template literal generating buttons from an array
  for (const role of ['reference', 'mask', 'depth', 'normal', 'source-image']) {
    assert.ok(html.includes(`'${role}'`), `missing role '${role}' in conditioning button generator`);
  }
});

test('Reuse creates conditioning link with artifact id and role', () => {
  assert.ok(html.includes('trayAddConditioningLink') && html.includes('trayUseAsConditioning'), 'reuse must create conditioning link');
});

test('Reuse prevents duplicate conditioning links', () => {
  assert.ok(html.includes('conditioningArtifactId === artifactId && l.role === role'), 'reuse must check for duplicate links');
});

test('Reuse buttons also rendered on output artifacts', () => {
  // Both source and output sections should call conditioningButtons
  const sourceSection = html.indexOf('sourceArtifacts.map');
  const outputSection = html.indexOf('outputArtifacts.map');
  const condButtonsAfterSource = html.indexOf('conditioningButtons', sourceSection);
  const condButtonsAfterOutput = html.indexOf('conditioningButtons', outputSection);
  assert.ok(condButtonsAfterSource > sourceSection && condButtonsAfterSource < outputSection, 'source section must have conditioning buttons');
  assert.ok(condButtonsAfterOutput > outputSection, 'output section must have conditioning buttons');
});

// --- Honest route probe ---

test('Route probe button exists', () => {
  assert.ok(html.includes('id="route-composition-tray-probe-route-button"'), 'missing probe route button');
});

test('trayProbeRoute function exists', () => {
  assert.ok(html.includes('function trayProbeRoute'), 'missing trayProbeRoute');
});

test('Route probe creates missing-backend run for SHARP', () => {
  assert.ok(html.includes("'sharp_image_to_splat'") && html.includes("'missing-backend'"), 'probe must record SHARP as missing-backend');
});

test('Route probe is exposed on window', () => {
  assert.ok(html.includes('window.kaminosTrayProbeRoute'), 'missing window.kaminosTrayProbeRoute');
});

test('Route probe button is wired', () => {
  assert.ok(html.includes('route-composition-tray-probe-route-button') && html.includes('trayProbeRoute'), 'probe button must call trayProbeRoute');
});

// --- Thumbnails ---

test('Source artifact rows show thumbnail when source is available', () => {
  assert.ok(html.includes('a.source ? `<img src=') && html.includes('sourceArtifacts.map'), 'source artifacts must show thumbnails');
});

// --- Data contract: reuse test ---

let mod;
try {
  mod = await import('../route-composition-tray.mjs');
} catch (err) {
  console.error(`FAIL: route-composition-tray.mjs import failed: ${err.message}`);
  process.exit(1);
}

test('Output-as-conditioning reuse: output can become conditioning input', () => {
  let tray = mod.createTray({ trayId: 'reuse-test' });
  tray = mod.addSourceArtifact(tray, { artifactId: 'src-001', title: 'Source photo', sourceKind: 'imported-manual' });
  tray = mod.appendOutputArtifact(tray, { artifactId: 'out-001', title: 'Generated depth', sourceKind: 'generated', routeRunId: 'run-001' });
  // Reuse the generated output as a depth conditioning input
  tray = mod.addConditioningLink(tray, {
    sourceArtifactId: 'src-001',
    conditioningArtifactId: 'out-001',
    role: 'depth',
    title: 'Generated depth as depth conditioning',
    sourceKind: 'generated',
  });
  assert.equal(tray.conditioningLinks.length, 1);
  assert.equal(tray.conditioningLinks[0].conditioningArtifactId, 'out-001');
  assert.equal(tray.conditioningLinks[0].role, 'depth');
  // Source and output identity unchanged
  assert.equal(tray.sourceArtifacts[0].artifactId, 'src-001');
  assert.equal(tray.outputArtifacts[0].artifactId, 'out-001');
});

test('Import: imported-manual artifact has correct display', () => {
  let tray = mod.createTray({ trayId: 'import-test' });
  tray = mod.addSourceArtifact(tray, { artifactId: 'imp-001', title: 'Pasted screenshot', sourceKind: 'imported-manual' });
  const entry = tray.sourceArtifacts[0];
  assert.equal(entry.displaySourceKind, 'Manual import');
  assert.equal(entry.sourceKind, 'imported-manual');
});

test('Route probe: missing-backend run has correct warnings', () => {
  let tray = mod.createTray({ trayId: 'probe-test' });
  tray = mod.addRouteRun(tray, {
    runId: 'probe-001',
    requestedRoute: 'sharp_image_to_splat',
    effectiveRoute: 'missing',
    backendClass: 'local-command',
    statusBadge: 'missing-backend',
    receiptId: 'probe-001',
  });
  const run = tray.routeRuns[0];
  assert.equal(run.statusBadge, 'missing-backend');
  assert.equal(run.displayStatus, 'Backend unavailable');
  assert.ok(run.sourceTruthWarnings.includes('missing_backend_route_unavailable'));
  assert.ok(run.sourceTruthWarnings.includes('route_requested_effective_mismatch'));
});

console.log(`\ntray-milestone contracts: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
