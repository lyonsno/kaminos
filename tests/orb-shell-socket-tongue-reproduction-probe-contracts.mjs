import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const core = readFileSync(join(root, 'orb-shell-composition-core.js'), 'utf8');

assert.match(core, /SocketTongueReproductionProbe/, 'composition core must name the socket-tongue reproduction probe');
assert.match(core, /createSocketTongueReproductionProbeMatrix/, 'composition core must expose a socket-tongue reproduction matrix builder');

const {
  createSocketTongueReproductionProbeMatrix,
} = await import('../orb-shell-composition-core.js');

const probe = createSocketTongueReproductionProbeMatrix();

assert.equal(probe?.schema, 'SocketTongueReproductionProbeMatrix', 'probe matrix is typed');
assert.equal(probe.mode, 'socket-tongue-reproduction-probe-v0', 'probe matrix records its mode');
assert.equal(probe.referenceCandidateId, 'lower-socket-keel-promoted-body-socket-tongue-candidate', 'probe preserves the known source candidate');
assert.ok(probe.caseCount >= 6, 'probe matrix covers the known case plus neighboring stress configurations');
assert.equal(probe.caseCount, probe.cases.length, 'caseCount matches cases');
assert.ok(probe.summary.reproducedCount >= 3, `probe should reproduce the recipe in several cases, got ${probe.summary.reproducedCount}`);
assert.ok(probe.summary.reproducedExcludingReferenceCount >= 2, 'probe must prove the recipe is not only the original accident');
assert.ok(probe.summary.failureCount >= 1, 'probe keeps at least one negative/failure case so the classifier can fail usefully');
assert.ok(
  ['geometry-repair-unlocked', 'law-repair-required-before-geometry'].includes(probe.geometryGate.verdict),
  'geometry gate must give an explicit next-slice verdict',
);
assert.equal(
  probe.geometryGate.verdict,
  'geometry-repair-unlocked',
  'current matrix should unlock geometry repair only after non-reference reproduction evidence exists',
);
assert.ok(
  probe.geometryGate.acceptanceEvidence.length >= 2,
  'geometry gate names the reproduced cases that justify attacking the smoothness/receiver wall',
);

const reference = probe.cases.find(item => item.isReferenceCase);
assert.ok(reference, 'probe includes a marked reference case');
assert.equal(reference.disposition, 'reproduced', 'reference case reproduces the preserved socket tongue');
assert.equal(reference.config.variantId, 'wide-cup', 'reference case records variant id');
assert.equal(reference.config.variationSeed, 6, 'reference case records seed');
assert.equal(reference.config.variationLeafCount, 11, 'reference case records leaf pressure');

const absentLowerSocket = probe.cases.find(item => item.disposition === 'failed-no-lower-socket');
assert.ok(absentLowerSocket, 'probe includes a case where lower-socket source is not selected');
assert.ok(
  absentLowerSocket.failureClasses.includes('failed-no-lower-socket'),
  'absence case reports a source-selection failure class instead of silently disappearing',
);

for (const caseRecord of probe.cases) {
  assert.equal(caseRecord.schema, 'SocketTongueReproductionProbeCase', 'each case is typed');
  assert.ok(caseRecord.config.variantId, 'case records variant id');
  assert.equal(typeof caseRecord.config.variationSeed, 'number', 'case records numeric seed');
  assert.equal(typeof caseRecord.config.variationLeafCount, 'number', 'case records numeric leaf pressure');
  assert.ok(Array.isArray(caseRecord.selectedMacroAssemblageIds), 'case records selected macro ids');
  assert.ok(Array.isArray(caseRecord.failureClasses), 'case records failure classes');
  assert.ok(
    ['reproduced', 'partial', 'failed-no-lower-socket', 'failed-no-receiver', 'failed-cord-collapse', 'failed-full-macro', 'failed-crumple'].includes(caseRecord.disposition),
    `case disposition ${caseRecord.disposition} is part of the reproduction classifier vocabulary`,
  );
  assert.equal(
    caseRecord.contractFlags?.schema,
    'SocketTongueReproductionContractFlags',
    'case exposes contract flags rather than only a score',
  );
  if (caseRecord.disposition === 'reproduced') {
    assert.ok(caseRecord.contractFlags.lowerSocketSelected, 'reproduced case selected lower socket');
    assert.ok(caseRecord.contractFlags.receiverPresent, 'reproduced case has receiver/seam/aperture owner evidence');
    assert.ok(caseRecord.contractFlags.subordinateObjecthood, 'reproduced case stays subordinate');
    assert.ok(caseRecord.contractFlags.sheetlikeBody, 'reproduced case remains sheetlike');
    assert.ok(caseRecord.contractFlags.hiddenTerminalCaps, 'reproduced case hides terminal cap authority');
    assert.ok(caseRecord.contractFlags.liveSidewalls, 'reproduced case has live sidewalls');
    assert.ok(caseRecord.metrics.meanSideWallThickness >= 0.045, 'reproduced case preserves readable sidewall thickness');
    assert.ok(caseRecord.metrics.endCapWidthExpansionRatio >= 2, 'reproduced case preserves hook pressure');
  }
}
