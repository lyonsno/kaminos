import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  loadFrozenCrawlerBasinManifest,
  recordCrawlerBasinVisualInspection,
  validateCrawlerBasinMatrixReport,
} from '../lirm-crawler-basin-robustness-core.mjs';
import { CRAWLER_ARMATURE_PROGRAM } from '../lirm-reference-fitted-armature-core.mjs';
import { UPRIGHT_MACROCEPHALIC_ARMATURE_PROGRAM } from '../lirm-upright-macrocephalic-armature-program.mjs';

const repoRoot = resolve(import.meta.dirname, '..');
const manifestPath = resolve(
  repoRoot,
  'artifacts/lirm-upright-macrocephalic-basin-robustness-assay-v0/manifest.json',
);

const frozen = await loadFrozenCrawlerBasinManifest({ manifestPath, repoRoot });
assert.equal(frozen.familyId, 'upright-macrocephalic-low-multicontact-v0');
assert.equal(frozen.donors.length, 4);
assert.equal(frozen.sourceWitnesses.length, 2);
assert.ok(frozen.sourceWitnesses.every(witness => witness.absolutePath.startsWith(repoRoot)));
assert.ok(frozen.sourceWitnesses.every(witness => witness.mapping.absolutePath.startsWith(repoRoot)));

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const temporaryRoot = await mkdtemp(join(tmpdir(), 'kaminos-upright-basin-contract-'));

const mappingLie = structuredClone(manifest);
mappingLie.sourceWitnesses[0].mapping.sha256 = `sha256:${'0'.repeat(64)}`;
const mappingLiePath = join(temporaryRoot, 'mapping-lie.json');
await writeFile(mappingLiePath, `${JSON.stringify(mappingLie, null, 2)}\n`);
await assert.rejects(
  () => loadFrozenCrawlerBasinManifest({ manifestPath: mappingLiePath, repoRoot }),
  /source witness .*mapping hash mismatch/,
  'selection mapping substitution must fail before fitting',
);

const witnessEscape = structuredClone(manifest);
witnessEscape.sourceWitnesses[0].path = '../outside-selection-witness.png';
const witnessEscapePath = join(temporaryRoot, 'witness-escape.json');
await writeFile(witnessEscapePath, `${JSON.stringify(witnessEscape, null, 2)}\n`);
await assert.rejects(
  () => loadFrozenCrawlerBasinManifest({ manifestPath: witnessEscapePath, repoRoot }),
  /source witness .*escapes repo root/,
);

const programAwareManifest = structuredClone(manifest);
programAwareManifest.schema = 'kaminos.lirm-upright-macrocephalic-basin-robustness-manifest.v1';
programAwareManifest.intent = 'Fit the frozen upright family with the explicit upright macrocephalic armature program.';
programAwareManifest.fixedRoute.parameterVocabulary = UPRIGHT_MACROCEPHALIC_ARMATURE_PROGRAM.parameterVocabulary;
programAwareManifest.fixedRoute.armatureProgram = {
  id: UPRIGHT_MACROCEPHALIC_ARMATURE_PROGRAM.id,
  parameterVocabulary: UPRIGHT_MACROCEPHALIC_ARMATURE_PROGRAM.parameterVocabulary,
  parameterSpecs: UPRIGHT_MACROCEPHALIC_ARMATURE_PROGRAM.parameterSpecs,
};
const programAwarePath = join(temporaryRoot, 'upright-program-v1.json');
await writeFile(programAwarePath, `${JSON.stringify(programAwareManifest, null, 2)}\n`);
const programAwareFrozen = await loadFrozenCrawlerBasinManifest({
  manifestPath: programAwarePath,
  repoRoot,
  armatureProgram: UPRIGHT_MACROCEPHALIC_ARMATURE_PROGRAM,
});
assert.equal(programAwareFrozen.fixedRoute.armatureProgram.id, UPRIGHT_MACROCEPHALIC_ARMATURE_PROGRAM.id);
await assert.rejects(
  () => loadFrozenCrawlerBasinManifest({
    manifestPath: programAwarePath,
    repoRoot,
    armatureProgram: CRAWLER_ARMATURE_PROGRAM,
  }),
  /armature program .*mismatch/,
  'an upright manifest must fail before donor fitting when the crawler program is selected',
);

const legacyReport = JSON.parse(await readFile(resolve(
  repoRoot,
  'artifacts/lirm-upright-macrocephalic-basin-robustness-assay-v0/report.json',
), 'utf8'));
assert.doesNotThrow(
  () => validateCrawlerBasinMatrixReport(legacyReport),
  'program injection must preserve the historical crawler-transfer rejection receipt',
);
const programAwareReport = JSON.parse(await readFile(resolve(
  repoRoot,
  'artifacts/lirm-upright-macrocephalic-basin-robustness-assay-v1/report.json',
), 'utf8'));
assert.equal(programAwareReport.status, 'basin-passed-inspected');
assert.doesNotThrow(() => validateCrawlerBasinMatrixReport(programAwareReport));
const fallbackLie = structuredClone(programAwareReport);
fallbackLie.effectiveArmatureProgramId = CRAWLER_ARMATURE_PROGRAM.id;
assert.throws(
  () => validateCrawlerBasinMatrixReport(fallbackLie, { requireFiles: false }),
  /matrix armature program receipt mismatch/,
  'an upright matrix must reject a crawler fallback even when donor metrics are green',
);

const preinspectionReport = structuredClone(programAwareReport);
preinspectionReport.status = 'basin-passed-uninspected';
preinspectionReport.visualInspection = 'pending';
const preinspectionPath = join(temporaryRoot, 'upright-program-preinspection.json');
await writeFile(preinspectionPath, `${JSON.stringify(preinspectionReport, null, 2)}\n`);
const edgeInspected = await recordCrawlerBasinVisualInspection({
  reportPath: preinspectionPath,
  disposition: 'accepted',
  visibleDelta: 'Three donors preserve the upright family; LIRM 02 remains a disconnected bulbous-radial topology edge.',
  missClassifications: { 'lirm-02-bulbous-radial-upright': 'topology-family-mismatch' },
});
assert.equal(edgeInspected.rows[3].outcome, 'inspected-edge-miss');
assert.equal(edgeInspected.rows[3].numericOutcome, 'recovered');
assert.equal(edgeInspected.rows[3].missClassification, 'topology-family-mismatch');
assert.deepEqual(edgeInspected.acceptance, {
  donorCount: 4,
  recoveredDonorCount: 3,
  missedDonorCount: 1,
  failedDonorCount: 0,
  passed: true,
});
assert.doesNotThrow(() => validateCrawlerBasinMatrixReport(edgeInspected));

const recoveredClassificationLie = structuredClone(edgeInspected);
recoveredClassificationLie.rows[3].outcome = 'recovered';
delete recoveredClassificationLie.rows[3].numericOutcome;
delete recoveredClassificationLie.rows[3].missClassification;
recoveredClassificationLie.acceptance = {
  donorCount: 4,
  recoveredDonorCount: 4,
  missedDonorCount: 0,
  failedDonorCount: 0,
  passed: true,
};
assert.throws(
  () => validateCrawlerBasinMatrixReport(recoveredClassificationLie, { requireFiles: false }),
  /visual miss classification disagrees with matrix row outcome/,
  'an accepted inspection cannot hide a topology miss behind a recovered row',
);
const missingEdgeClassification = structuredClone(edgeInspected);
delete missingEdgeClassification.visualInspection.missClassifications['lirm-02-bulbous-radial-upright'];
assert.throws(
  () => validateCrawlerBasinMatrixReport(missingEdgeClassification, { requireFiles: false }),
  /missing visual miss classification for lirm-02-bulbous-radial-upright/,
  'every inspected edge miss must retain an exact visual classification',
);

console.log('lirm upright macrocephalic basin robustness contracts passed');
