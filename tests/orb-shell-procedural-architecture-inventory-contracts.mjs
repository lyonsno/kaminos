import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const core = readFileSync(join(root, 'orb-shell-composition-core.js'), 'utf8');
const witness = readFileSync(join(root, 'orb-shell-composition-witness.mjs'), 'utf8');
const index = readFileSync(join(root, 'index.html'), 'utf8');

assert.match(core, /OrbShellProceduralArchitectureInventory/, 'composition core must name the cross-layer architecture inventory');
assert.match(core, /createProceduralArchitectureInventory/, 'composition core must build the cross-layer architecture inventory');
assert.match(core, /proceduralArchitectureInventory/, 'composition debug state must expose the architecture inventory');
assert.match(core, /enableProceduralArchitectureInventoryWitness/, 'browser witness must expose a curve-first architecture inventory mode');
assert.match(core, /proceduralArchitectureInventoryDebugState/, 'browser witness must expose a compact architecture inventory debug state');
assert.match(witness, /procedural-architecture-inventory/, 'headless witness must know the architecture inventory focus');
assert.match(witness, /proceduralArchitectureInventoryDebugState/, 'headless architecture focus must avoid the full generic debug state payload');
assert.match(index, /orbShellFocus === 'procedural-architecture-inventory'/, 'operator route must expose procedural architecture focus');
assert.match(index, /enableProceduralArchitectureInventoryWitness/, 'operator route must activate procedural architecture witness');

const { createTargetOrbShellCompositionFixture } = await import('../orb-shell-composition-core.js');

const fixture = createTargetOrbShellCompositionFixture({
  variantId: 'wide-cup',
  variationSeed: 6,
  variationLeafCount: 11,
});

const inventory = fixture.proceduralArchitectureInventory;
assert.equal(inventory?.schema, 'OrbShellProceduralArchitectureInventory', 'fixture exposes cross-layer architecture inventory');
assert.equal(inventory.mode, 'curve-first-semantic-architecture-xray-v0', 'inventory records accepted architecture x-ray mode');
assert.equal(inventory.stressCaseId, 'lower-socket-keel-promoted-body-socket-tongue-candidate', 'inventory keeps lower-socket tongue as diagnostic stress case');
assert.equal(inventory.activeRepairPosture, 'diagnose-upstream-laws-before-local-morphology-tuning', 'inventory forbids another local tongue beautification loop');
assert.ok(inventory.recordCount >= fixture.macroAssemblages.length, 'inventory has at least one record per macro family');

const records = inventory.records;
assert.equal(records.length, inventory.recordCount, 'record count matches architecture records');

for (const record of records) {
  assert.equal(record.schema, 'ProceduralArchitectureInventoryRecord', 'each record has stable schema');
  assert.ok(record.id, 'record has stable id');
  assert.ok(record.semanticRole, 'record names semantic role');
  assert.ok(record.semanticClass, 'record names semantic class');
  assert.ok(record.sourceCurve?.id || record.sourceCurve?.sourceCurveId, 'record names source curve identity');
  assert.ok(record.sourceCurve?.stage, 'record names source curve stage');
  assert.ok(record.territory?.id || record.territory?.territoryId, 'record names territory identity');
  assert.ok(record.widthProfile?.id || record.widthProfile?.source, 'record names width profile source');
  assert.ok(record.terminal?.mode, 'record names terminal mode');
  assert.ok('receiverRelation' in record, 'record names receiver relation, even when absent');
  assert.ok(record.meshDerivation?.mode, 'record names final mesh derivation mode');
  assert.ok(
    ['semantic-object', 'render-artifact', 'diagnostic-overlay', 'suppressed-legacy-artifact'].includes(record.objectLayer),
    'record distinguishes semantic object from render/debug artifact',
  );
}

const macroRecords = records.filter(record => record.semanticClass === 'macro-family');
assert.equal(macroRecords.length, fixture.macroAssemblages.length, 'one architecture record per selected macro family');
assert.ok(
  macroRecords.every(record => record.sourceCurve.stage === 'post-variation-pre-promotion-sphere-line'),
  'macro family records start at curve-first source stage',
);
assert.ok(
  macroRecords.every(record => record.territory.source === 'sphericalTerritory'),
  'macro family records expose spherical territory source',
);

const lowerSocket = records.find(record => record.parentAssemblage === 'lower-socket-keel' && record.semanticClass === 'macro-family');
assert.ok(lowerSocket, 'inventory includes lower-socket macro family as architecture record');
assert.ok(
  lowerSocket.diagnosticQuestions.includes('is the lower-socket failure born in source curve, width profile, terminal law, receiver law, or mesh derivation'),
  'lower socket record names the architecture-level diagnostic question',
);
assert.equal(lowerSocket.localMorphologyTuningAllowed, false, 'lower socket cannot be locally beautified while architecture diagnosis is active');

const stressCase = records.find(record => record.id === 'lower-socket-keel-promoted-body-socket-tongue-candidate-architecture-record');
assert.ok(stressCase, 'inventory carries the provisional tongue as a stress-case record');
assert.equal(stressCase.semanticClass, 'provisional-socket-tongue-stress-case', 'stress case is not mislabeled as a solved macro family');
assert.equal(stressCase.objectLayer, 'semantic-object', 'stress case remains a semantic object, not only a render artifact');
assert.equal(stressCase.meshDerivation.localTuningAllowed, false, 'stress case forbids local mesh-tuning as the current repair strategy');
assert.equal(stressCase.terminal.mode, 'provisional-visible-until-receiver-owned-tuck', 'stress case preserves provisional terminal authority');
assert.equal(stressCase.receiverRelation.mode, 'receiver-required-but-not-owned', 'stress case names missing receiver ownership');
assert.ok(
  stressCase.failureClasses.includes('downstream-constraint-soup-risk'),
  'stress case records why this local loop was demoted',
);

assert.ok(
  records.some(record => record.semanticClass === 'macro-family-substrip' && record.objectLayer === 'semantic-object'),
  'inventory includes substrip family members as semantic objects distinct from macro parents',
);
assert.ok(
  records.some(record => record.semanticClass === 'live-terminal-cap' && record.objectLayer === 'render-artifact'),
  'inventory includes terminal caps as render artifacts with terminal authority',
);
assert.ok(
  inventory.layerCounts['semantic-object'] >= fixture.macroAssemblages.length,
  'inventory summarizes semantic object layer count',
);
assert.ok(
  inventory.layerCounts['render-artifact'] >= 1,
  'inventory summarizes render artifact layer count',
);
assert.ok(
  inventory.sourceStageCounts['post-variation-pre-promotion-sphere-line'] >= fixture.macroAssemblages.length,
  'inventory summarizes source-curve stage coverage',
);
assert.ok(
  inventory.unresolvedArchitectureQuestions.includes('which layer owns lower-socket tongue repair'),
  'inventory keeps the tongue repair question open instead of pretending it is solved',
);
