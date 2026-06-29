import { strict as assert } from 'node:assert';

// --- Route Composition Tray Data Contract Tests ---

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

// Import the module under test
let mod;
try {
  mod = await import('../route-composition-tray.mjs');
} catch (err) {
  console.error(`FAIL: route-composition-tray.mjs must exist and export the tray contract\n  ${err.message}`);
  process.exit(1);
}

const {
  ROUTE_COMPOSITION_TRAY_SCHEMA,
  TRAY_ARTIFACT_ENTRY_SCHEMA,
  TRAY_ROUTE_RUN_SCHEMA,
  CONDITIONING_LINK_ROLES,
  ARTIFACT_SOURCE_KINDS,
  ROUTE_STATUS_BADGES,
  createTray,
  addSourceArtifact,
  addConditioningLink,
  addRouteRun,
  appendOutputArtifact,
  buildFixtureWitnessTray,
  trayWitness,
} = mod;

// --- Schema constants ---

test('ROUTE_COMPOSITION_TRAY_SCHEMA is defined', () => {
  assert.equal(ROUTE_COMPOSITION_TRAY_SCHEMA, 'kaminos.kiln.route-composition-tray.v0');
});

test('TRAY_ARTIFACT_ENTRY_SCHEMA is defined', () => {
  assert.equal(TRAY_ARTIFACT_ENTRY_SCHEMA, 'kaminos.kiln.tray-artifact-entry.v0');
});

test('TRAY_ROUTE_RUN_SCHEMA is defined', () => {
  assert.equal(TRAY_ROUTE_RUN_SCHEMA, 'kaminos.kiln.tray-route-run.v0');
});

test('CONDITIONING_LINK_ROLES includes core conditioning types', () => {
  const required = ['source-image', 'mask', 'matte', 'depth', 'normal', 'scribble', 'reference', 'negative-law'];
  for (const role of required) {
    assert.ok(CONDITIONING_LINK_ROLES.includes(role), `missing conditioning role: ${role}`);
  }
});

test('ARTIFACT_SOURCE_KINDS distinguishes fixture, import, generated, and cached', () => {
  for (const kind of ['fixture', 'imported-external', 'imported-manual', 'generated', 'cached', 'failed']) {
    assert.ok(ARTIFACT_SOURCE_KINDS.includes(kind), `missing source kind: ${kind}`);
  }
});

test('ROUTE_STATUS_BADGES includes core statuses', () => {
  for (const badge of ['real', 'fixture', 'cached', 'fallback', 'missing-backend', 'failed']) {
    assert.ok(ROUTE_STATUS_BADGES.includes(badge), `missing status badge: ${badge}`);
  }
});

// --- Tray creation ---

test('createTray produces a valid empty tray', () => {
  const tray = createTray({ trayId: 'test-tray-001' });
  assert.equal(tray.schema, ROUTE_COMPOSITION_TRAY_SCHEMA);
  assert.equal(tray.trayId, 'test-tray-001');
  assert.ok(Array.isArray(tray.sourceArtifacts));
  assert.ok(Array.isArray(tray.conditioningLinks));
  assert.ok(Array.isArray(tray.routeRuns));
  assert.ok(Array.isArray(tray.outputArtifacts));
  assert.equal(tray.sourceArtifacts.length, 0);
  assert.equal(tray.outputArtifacts.length, 0);
});

// --- Source artifact entries ---

test('addSourceArtifact adds a source artifact with human-legible title', () => {
  const tray = createTray({ trayId: 'test-tray-002' });
  const updated = addSourceArtifact(tray, {
    artifactId: 'src-001',
    title: 'Red lerm reference photo',
    sourceKind: 'imported-external',
    mimeType: 'image/png',
  });
  assert.equal(updated.sourceArtifacts.length, 1);
  const entry = updated.sourceArtifacts[0];
  assert.equal(entry.schema, TRAY_ARTIFACT_ENTRY_SCHEMA);
  assert.equal(entry.artifactId, 'src-001');
  assert.equal(entry.title, 'Red lerm reference photo');
  assert.equal(entry.sourceKind, 'imported-external');
});

test('addSourceArtifact preserves immutable tray identity', () => {
  const tray = createTray({ trayId: 'test-tray-003' });
  const updated = addSourceArtifact(tray, {
    artifactId: 'src-002',
    title: 'Another source',
    sourceKind: 'imported-manual',
  });
  assert.equal(updated.trayId, 'test-tray-003');
  // Original tray not mutated
  assert.equal(tray.sourceArtifacts.length, 0);
});

// --- Conditioning links ---

test('addConditioningLink attaches a conditioning artifact', () => {
  let tray = createTray({ trayId: 'test-tray-004' });
  tray = addSourceArtifact(tray, {
    artifactId: 'src-001',
    title: 'Source image',
    sourceKind: 'imported-external',
  });
  const updated = addConditioningLink(tray, {
    sourceArtifactId: 'src-001',
    conditioningArtifactId: 'depth-001',
    role: 'depth',
    title: 'Depth map',
    sourceKind: 'generated',
  });
  assert.equal(updated.conditioningLinks.length, 1);
  const link = updated.conditioningLinks[0];
  assert.equal(link.role, 'depth');
  assert.equal(link.conditioningArtifactId, 'depth-001');
  assert.equal(link.sourceArtifactId, 'src-001');
});

test('addConditioningLink supports all required roles', () => {
  let tray = createTray({ trayId: 'test-tray-005' });
  tray = addSourceArtifact(tray, { artifactId: 'src-001', title: 'Source', sourceKind: 'imported-external' });
  const roles = ['source-image', 'mask', 'matte', 'depth', 'normal', 'scribble', 'reference', 'negative-law'];
  for (const role of roles) {
    tray = addConditioningLink(tray, {
      sourceArtifactId: 'src-001',
      conditioningArtifactId: `cond-${role}`,
      role,
      title: `${role} artifact`,
      sourceKind: 'fixture',
    });
  }
  assert.equal(tray.conditioningLinks.length, roles.length);
});

// --- Route runs ---

test('addRouteRun creates a route run entry with human-legible status', () => {
  let tray = createTray({ trayId: 'test-tray-006' });
  const updated = addRouteRun(tray, {
    runId: 'run-001',
    requestedRoute: 'image_conditioned_generation',
    effectiveRoute: 'sdxl_t2i_adapter',
    backendClass: 'local-command',
    statusBadge: 'real',
    receiptId: 'receipt-001',
    inputArtifactIds: ['src-001'],
    conditioningArtifactIds: ['depth-001', 'normal-001'],
  });
  assert.equal(updated.routeRuns.length, 1);
  const run = updated.routeRuns[0];
  assert.equal(run.schema, TRAY_ROUTE_RUN_SCHEMA);
  assert.equal(run.requestedRoute, 'image_conditioned_generation');
  assert.equal(run.effectiveRoute, 'sdxl_t2i_adapter');
  assert.equal(run.backendClass, 'local-command');
  assert.equal(run.statusBadge, 'real');
  assert.equal(run.receiptId, 'receipt-001');
  // Human-legible display fields exist
  assert.ok(typeof run.displayStatus === 'string');
  assert.ok(typeof run.displayRoute === 'string');
});

// --- Output artifacts ---

test('appendOutputArtifact adds output without overwriting source identity', () => {
  let tray = createTray({ trayId: 'test-tray-007' });
  tray = addSourceArtifact(tray, { artifactId: 'src-001', title: 'Original source', sourceKind: 'imported-external' });
  const updated = appendOutputArtifact(tray, {
    artifactId: 'out-001',
    title: 'Generated image',
    sourceKind: 'generated',
    routeRunId: 'run-001',
  });
  assert.equal(updated.outputArtifacts.length, 1);
  // Source artifacts unchanged
  assert.equal(updated.sourceArtifacts.length, 1);
  assert.equal(updated.sourceArtifacts[0].artifactId, 'src-001');
  assert.equal(updated.sourceArtifacts[0].title, 'Original source');
});

test('appendOutputArtifact preserves append-only: multiple outputs accumulate', () => {
  let tray = createTray({ trayId: 'test-tray-008' });
  tray = appendOutputArtifact(tray, { artifactId: 'out-001', title: 'First output', sourceKind: 'generated', routeRunId: 'run-001' });
  tray = appendOutputArtifact(tray, { artifactId: 'out-002', title: 'Second output', sourceKind: 'generated', routeRunId: 'run-002' });
  assert.equal(tray.outputArtifacts.length, 2);
  assert.equal(tray.outputArtifacts[0].artifactId, 'out-001');
  assert.equal(tray.outputArtifacts[1].artifactId, 'out-002');
});

// --- False-closure coverage ---

test('FALSE-CLOSURE: fixture cannot masquerade as live generated output', () => {
  let tray = createTray({ trayId: 'test-fc-001' });
  tray = appendOutputArtifact(tray, {
    artifactId: 'out-fixture',
    title: 'Fixture output',
    sourceKind: 'fixture',
    routeRunId: 'run-fixture',
  });
  const output = tray.outputArtifacts[0];
  assert.equal(output.sourceKind, 'fixture');
  assert.ok(output.sourceKind !== 'generated', 'fixture must not appear as generated');
  // Source truth warnings must flag fixture
  assert.ok(
    output.sourceTruthWarnings.some(w => w.includes('fixture')),
    'fixture output must carry a fixture source-truth warning'
  );
});

test('FALSE-CLOSURE: missing backend cannot silently succeed', () => {
  let tray = createTray({ trayId: 'test-fc-002' });
  tray = addRouteRun(tray, {
    runId: 'run-missing',
    requestedRoute: 'sdxl_controlnet',
    effectiveRoute: 'missing',
    backendClass: 'missing',
    statusBadge: 'missing-backend',
    receiptId: 'receipt-missing',
  });
  const run = tray.routeRuns[0];
  assert.equal(run.statusBadge, 'missing-backend');
  assert.ok(
    run.sourceTruthWarnings.some(w => w.includes('missing') || w.includes('backend')),
    'missing backend run must carry a source-truth warning'
  );
  // displayStatus must not say "completed" or "success"
  assert.ok(
    !run.displayStatus.toLowerCase().includes('success'),
    'missing-backend run displayStatus must not say success'
  );
});

test('FALSE-CLOSURE: output append cannot overwrite source graph identity', () => {
  let tray = createTray({ trayId: 'test-fc-003' });
  tray = addSourceArtifact(tray, { artifactId: 'src-001', title: 'My precious source', sourceKind: 'imported-external' });
  // Append output with same-looking data
  tray = appendOutputArtifact(tray, { artifactId: 'out-001', title: 'Generated result', sourceKind: 'generated', routeRunId: 'run-001' });
  // Source must still be exactly what it was
  assert.equal(tray.sourceArtifacts.length, 1);
  assert.equal(tray.sourceArtifacts[0].artifactId, 'src-001');
  assert.equal(tray.sourceArtifacts[0].title, 'My precious source');
  assert.equal(tray.sourceArtifacts[0].sourceKind, 'imported-external');
  // Output must have its own separate identity
  assert.notEqual(tray.outputArtifacts[0].artifactId, tray.sourceArtifacts[0].artifactId);
});

test('FALSE-CLOSURE: raw route/warning ids cannot be the primary operator-facing status', () => {
  let tray = createTray({ trayId: 'test-fc-004' });
  tray = addRouteRun(tray, {
    runId: 'run-001',
    requestedRoute: 'image_conditioned_generation',
    effectiveRoute: 'sdxl_t2i_adapter',
    backendClass: 'local-command',
    statusBadge: 'real',
    receiptId: 'receipt-001',
  });
  const run = tray.routeRuns[0];
  // displayRoute must be human-legible, not raw id
  assert.ok(run.displayRoute.length > 0, 'displayRoute must not be empty');
  assert.ok(!run.displayRoute.includes('_'), `displayRoute "${run.displayRoute}" should not use underscored ids as primary text`);
  // displayStatus must be human-legible
  assert.ok(run.displayStatus.length > 0, 'displayStatus must not be empty');
});

test('FALSE-CLOSURE: imported/external/manual remain distinguishable from generated/local', () => {
  let tray = createTray({ trayId: 'test-fc-005' });
  tray = addSourceArtifact(tray, { artifactId: 'ext-001', title: 'ChatGPT export', sourceKind: 'imported-external' });
  tray = addSourceArtifact(tray, { artifactId: 'man-001', title: 'Hand-drawn sketch', sourceKind: 'imported-manual' });
  tray = appendOutputArtifact(tray, { artifactId: 'gen-001', title: 'Generated from depth', sourceKind: 'generated', routeRunId: 'run-001' });
  const ext = tray.sourceArtifacts.find(a => a.artifactId === 'ext-001');
  const man = tray.sourceArtifacts.find(a => a.artifactId === 'man-001');
  const gen = tray.outputArtifacts.find(a => a.artifactId === 'gen-001');
  assert.equal(ext.sourceKind, 'imported-external');
  assert.equal(man.sourceKind, 'imported-manual');
  assert.equal(gen.sourceKind, 'generated');
  // Each must have a distinct human-readable display label for source kind
  assert.ok(typeof ext.displaySourceKind === 'string');
  assert.ok(typeof man.displaySourceKind === 'string');
  assert.ok(typeof gen.displaySourceKind === 'string');
  assert.notEqual(ext.displaySourceKind, gen.displaySourceKind);
  assert.notEqual(man.displaySourceKind, gen.displaySourceKind);
});

// --- Fixture witness ---

test('buildFixtureWitnessTray produces a complete tray with all required parts', () => {
  const tray = buildFixtureWitnessTray();
  assert.equal(tray.schema, ROUTE_COMPOSITION_TRAY_SCHEMA);
  // At least one source/import artifact
  assert.ok(tray.sourceArtifacts.length >= 1, 'fixture tray must have at least one source artifact');
  // At least two conditioning links
  assert.ok(tray.conditioningLinks.length >= 2, 'fixture tray must have at least two conditioning links');
  // At least one route run
  assert.ok(tray.routeRuns.length >= 1, 'fixture tray must have at least one route run');
  // At least one output artifact
  assert.ok(tray.outputArtifacts.length >= 1, 'fixture tray must have at least one output artifact');
});

test('buildFixtureWitnessTray marks fixture outputs with fixture source-truth warnings', () => {
  const tray = buildFixtureWitnessTray();
  for (const output of tray.outputArtifacts) {
    if (output.sourceKind === 'fixture') {
      assert.ok(
        output.sourceTruthWarnings.some(w => w.includes('fixture')),
        `fixture output ${output.artifactId} must carry fixture warning`
      );
    }
  }
});

test('buildFixtureWitnessTray route runs carry source-truth warnings for fixture/fallback', () => {
  const tray = buildFixtureWitnessTray();
  for (const run of tray.routeRuns) {
    if (run.statusBadge === 'fixture' || run.statusBadge === 'missing-backend') {
      assert.ok(
        run.sourceTruthWarnings.length > 0,
        `route run ${run.runId} with badge ${run.statusBadge} must carry source-truth warnings`
      );
    }
  }
});

// --- Witness ---

test('trayWitness validates a complete fixture tray as ok', () => {
  const tray = buildFixtureWitnessTray();
  const witness = trayWitness(tray);
  assert.equal(witness.ok, true);
  assert.ok(witness.sourceArtifactCount >= 1);
  assert.ok(witness.conditioningLinkCount >= 2);
  assert.ok(witness.routeRunCount >= 1);
  assert.ok(witness.outputArtifactCount >= 1);
});

test('trayWitness rejects an empty tray as not ok', () => {
  const tray = createTray({ trayId: 'empty' });
  const witness = trayWitness(tray);
  assert.equal(witness.ok, false);
});

// --- Summary ---

console.log(`\nroute-composition-tray contracts: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
