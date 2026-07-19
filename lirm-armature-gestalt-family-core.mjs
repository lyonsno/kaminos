import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

import {
  writeLirmArmatureProgramImplicitBodyWitness,
} from './lirm-speciation-armature-core.js';
import {
  CRAWLER_ARMATURE_PROGRAM,
} from './lirm-reference-fitted-armature-core.mjs';
import {
  UPRIGHT_MACROCEPHALIC_ARMATURE_PROGRAM,
} from './lirm-upright-macrocephalic-armature-program.mjs';
import {
  BULBOUS_RADIAL_UPRIGHT_ARMATURE_PROGRAM,
} from './lirm-bulbous-radial-upright-armature-program.mjs';

export const LIRM_ARMATURE_GESTALT_FAMILY_ROUTE =
  'kaminos/lirm-armature-gestalt-family/source-anchored-conditioning-v0';

const MACRO_ACCEPTANCE_REPORT =
  'artifacts/lirm-upright-macrocephalic-basin-robustness-assay-v1/report.json';
const MACRO_ACCEPTANCE_SHA256 =
  'sha256:d4d69117a0153440a01e5c12fdd26b5dd41b8db476b19743a96c0e71f3a35ff3';

export const DEFAULT_LIRM_ARMATURE_GESTALT_FAMILY_SOURCES = Object.freeze([
  Object.freeze({
    id: 'crawler-basin22',
    armatureProgram: CRAWLER_ARMATURE_PROGRAM,
    fitReportPath: 'artifacts/lirm-reference-fitted-armature-assay-v0/report.json',
    fitReportSha256: 'sha256:604bb7ffb1ff4e37ab86cc77ef94f27aecfa14f37edb1cb2d2e9e4e3ca170cdb',
    acceptance: Object.freeze({ kind: 'direct-status', expectedStatus: 'assay-passed-inspected' }),
    allowLegacyProgramOmission: true,
  }),
  Object.freeze({
    id: 'upright-basin03',
    armatureProgram: UPRIGHT_MACROCEPHALIC_ARMATURE_PROGRAM,
    fitReportPath: `${MACRO_ACCEPTANCE_REPORT.replace('/report.json', '')}/donors/basin-03-metabolizer-upright/report.json`,
    fitReportSha256: 'sha256:24730bd1f78eeb765f2e992693b7edf9cf2992277a92f9ac929cbd480f9131d2',
    acceptance: Object.freeze({
      kind: 'ledger-row',
      reportPath: MACRO_ACCEPTANCE_REPORT,
      reportSha256: MACRO_ACCEPTANCE_SHA256,
      donorId: 'basin-03-metabolizer-upright',
      expectedStatus: 'basin-passed-inspected',
      expectedOutcome: 'recovered',
      expectedVisualDisposition: 'accepted',
    }),
  }),
  Object.freeze({
    id: 'upright-basin10',
    armatureProgram: UPRIGHT_MACROCEPHALIC_ARMATURE_PROGRAM,
    fitReportPath: `${MACRO_ACCEPTANCE_REPORT.replace('/report.json', '')}/donors/basin-10-metabolizer-upright/report.json`,
    fitReportSha256: 'sha256:88b82b9fad3afd179b8ba53b6a9ede12c3ae143814d7d5f6f0569dc32d47765f',
    acceptance: Object.freeze({
      kind: 'ledger-row',
      reportPath: MACRO_ACCEPTANCE_REPORT,
      reportSha256: MACRO_ACCEPTANCE_SHA256,
      donorId: 'basin-10-metabolizer-upright',
      expectedStatus: 'basin-passed-inspected',
      expectedOutcome: 'recovered',
      expectedVisualDisposition: 'accepted',
    }),
  }),
  Object.freeze({
    id: 'upright-basin22',
    armatureProgram: UPRIGHT_MACROCEPHALIC_ARMATURE_PROGRAM,
    fitReportPath: `${MACRO_ACCEPTANCE_REPORT.replace('/report.json', '')}/donors/basin-22-metabolizer-upright/report.json`,
    fitReportSha256: 'sha256:7a4b103c7c3dbc1346a842dda98a8d9afb5d3b2456f0c1a72df737c1be3f97c4',
    acceptance: Object.freeze({
      kind: 'ledger-row',
      reportPath: MACRO_ACCEPTANCE_REPORT,
      reportSha256: MACRO_ACCEPTANCE_SHA256,
      donorId: 'basin-22-metabolizer-upright',
      expectedStatus: 'basin-passed-inspected',
      expectedOutcome: 'recovered',
      expectedVisualDisposition: 'accepted',
    }),
  }),
  Object.freeze({
    id: 'bulbous-radial-lirm02',
    armatureProgram: BULBOUS_RADIAL_UPRIGHT_ARMATURE_PROGRAM,
    fitReportPath: 'artifacts/lirm-bulbous-radial-upright-armature-assay-v1/report.json',
    fitReportSha256: 'sha256:d4ca63ebad2fa83f7266afb435eae240983659254a3f1b251bd12036c47d32bf',
    acceptance: Object.freeze({ kind: 'direct-status', expectedStatus: 'assay-passed-inspected' }),
  }),
]);

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function assertSafeId(id) {
  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    throw new Error(`family candidate id must be filesystem-safe: ${id ?? 'missing'}`);
  }
}

function assertProgram(program) {
  if (!program || typeof program.createPrimitives !== 'function') {
    throw new Error('family source requires an armature program with a primitive factory');
  }
  if (typeof program.id !== 'string' || !Array.isArray(program.parameterSpecs) || program.parameterSpecs.length === 0) {
    throw new Error('family source requires a stable armature program identity and parameter specs');
  }
}

async function readPinnedJson(repoRoot, path, expectedSha256, label) {
  const absolutePath = resolve(repoRoot, path);
  const bytes = await readFile(absolutePath);
  const actualSha256 = sha256(bytes);
  if (actualSha256 !== expectedSha256) {
    throw new Error(`${label} hash mismatch for ${path}: ${actualSha256} != ${expectedSha256}`);
  }
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new Error(`${label} is not valid JSON for ${path}: ${error.message}`);
  }
  return {
    value,
    evidence: {
      path: relative(repoRoot, absolutePath),
      byteSize: bytes.length,
      sha256: actualSha256,
    },
  };
}

function validateFitReport(source, report) {
  if (!['assay-passed-inspected', 'assay-passed-uninspected'].includes(report.status)) {
    throw new Error(`fit report for ${source.id} is not a passed assay: ${report.status ?? 'missing'}`);
  }
  const reportProgram = report.armatureProgram;
  if (!reportProgram && !source.allowLegacyProgramOmission) {
    throw new Error(`fit report for ${source.id} omitted armature program identity`);
  }
  if (reportProgram) {
    if (reportProgram.id !== source.armatureProgram.id
        || reportProgram.parameterVocabulary !== source.armatureProgram.parameterVocabulary) {
      throw new Error(`fit report armature program mismatch for ${source.id}`);
    }
    if (JSON.stringify(reportProgram.parameterSpecs) !== JSON.stringify(source.armatureProgram.parameterSpecs)) {
      throw new Error(`fit report parameter spec mismatch for ${source.id}`);
    }
  }
  if (!report.fittedParameters || typeof report.fittedParameters !== 'object') {
    throw new Error(`fit report for ${source.id} has no fitted parameters`);
  }
  const expectedIds = source.armatureProgram.parameterSpecs.map(spec => spec.id);
  if (JSON.stringify(Object.keys(report.fittedParameters)) !== JSON.stringify(expectedIds)) {
    throw new Error(`fit report parameter identity mismatch for ${source.id}`);
  }
  const parameters = {};
  for (const spec of source.armatureProgram.parameterSpecs) {
    const value = report.fittedParameters[spec.id];
    if (!Number.isFinite(value) || value < spec.min || value > spec.max) {
      throw new Error(`fit report parameter out of bounds for ${source.id}: ${spec.id}`);
    }
    parameters[spec.id] = value;
  }
  return parameters;
}

async function validateAcceptance(repoRoot, source, fitReport) {
  const acceptance = source.acceptance;
  if (acceptance?.kind === 'direct-status') {
    if (fitReport.status !== acceptance.expectedStatus) {
      throw new Error(`direct acceptance status mismatch for ${source.id}: ${fitReport.status}`);
    }
    return {
      acceptance: {
        kind: acceptance.kind,
        status: fitReport.status,
        outcome: fitReport.status,
        visualDisposition: 'embedded-in-fit-report',
      },
      evidence: null,
    };
  }
  if (acceptance?.kind !== 'ledger-row') throw new Error(`unknown acceptance contract for ${source.id}`);
  const loaded = await readPinnedJson(
    repoRoot,
    acceptance.reportPath,
    acceptance.reportSha256,
    'acceptance report',
  );
  const ledger = loaded.value;
  if (ledger.status !== acceptance.expectedStatus
      || ledger.visualInspection?.disposition !== acceptance.expectedVisualDisposition
      || ledger.effectiveArmatureProgramId !== source.armatureProgram.id) {
    throw new Error(`acceptance ledger contract mismatch for ${source.id}`);
  }
  const row = ledger.rows?.find(candidate => candidate.donorId === acceptance.donorId);
  if (!row || row.outcome !== acceptance.expectedOutcome) {
    throw new Error(`acceptance outcome mismatch for ${source.id}`);
  }
  if (row.subreport?.status !== fitReport.status
      || row.subreport?.donor?.sha256 !== fitReport.donor?.sha256
      || JSON.stringify(row.subreport?.fittedParameters) !== JSON.stringify(fitReport.fittedParameters)) {
    throw new Error(`acceptance ledger subreport mismatch for ${source.id}`);
  }
  return {
    acceptance: {
      kind: acceptance.kind,
      status: ledger.status,
      outcome: row.outcome,
      visualDisposition: ledger.visualInspection.disposition,
      donorId: row.donorId,
    },
    evidence: loaded.evidence,
  };
}

export async function loadLirmArmatureGestaltFamily({
  repoRoot = process.cwd(),
  sourceDefinitions = DEFAULT_LIRM_ARMATURE_GESTALT_FAMILY_SOURCES,
} = {}) {
  if (!Array.isArray(sourceDefinitions) || sourceDefinitions.length === 0) {
    throw new Error('armature gestalt family requires source definitions');
  }
  const ids = new Set();
  const candidates = [];
  for (const source of sourceDefinitions) {
    assertSafeId(source.id);
    if (ids.has(source.id)) throw new Error(`duplicate family candidate id: ${source.id}`);
    ids.add(source.id);
    assertProgram(source.armatureProgram);
    const loadedFit = await readPinnedJson(
      repoRoot,
      source.fitReportPath,
      source.fitReportSha256,
      'fit report',
    );
    const parameters = validateFitReport(source, loadedFit.value);
    const accepted = await validateAcceptance(repoRoot, source, loadedFit.value);
    candidates.push({
      id: source.id,
      armatureProgram: source.armatureProgram,
      parameters,
      acceptance: accepted.acceptance,
      donor: loadedFit.value.donor,
      metrics: {
        heldOutMeanIou: loadedFit.value.metrics?.fitted?.heldOut?.meanIou ?? null,
        heldOutMeanDepthMae: loadedFit.value.metrics?.fitted?.heldOut?.meanDepthMae ?? null,
      },
      sourceEvidence: {
        fitReport: loadedFit.evidence,
        acceptanceReport: accepted.evidence,
      },
    });
  }
  return {
    schema: 'kaminos.lirm-armature-gestalt-family.v0',
    requestedRoute: LIRM_ARMATURE_GESTALT_FAMILY_ROUTE,
    effectiveRoute: LIRM_ARMATURE_GESTALT_FAMILY_ROUTE,
    candidates,
    falseClosureGuards: {
      productionCreatureClaim: 'forbidden',
      generatorFiringClaim: 'not_yet_fired',
      generalMorphologyMediumClaim: 'not_yet_assayed',
      sourceAnchorClaim: 'pinned_fit_and_acceptance_reports_only',
    },
  };
}

function uniqueSourceEvidence(candidates) {
  const byPath = new Map();
  for (const candidate of candidates) {
    for (const evidence of Object.values(candidate.sourceEvidence)) {
      if (evidence) byPath.set(evidence.path, evidence);
    }
  }
  return [...byPath.values()];
}

async function fileEvidence(path, relativePath) {
  const bytes = await readFile(path);
  return { path: relativePath, byteSize: bytes.length, sha256: sha256(bytes) };
}

export async function writeLirmArmatureGestaltFamilyWitness({
  repoRoot = process.cwd(),
  outDir = join(process.cwd(), 'artifacts', 'lirm-armature-multi-gestalt-conditioning-assay-v0'),
  sourceDefinitions = DEFAULT_LIRM_ARMATURE_GESTALT_FAMILY_SOURCES,
  pixelWidth = 256,
  pixelHeight = 192,
} = {}) {
  await mkdir(outDir, { recursive: true });
  const receiptPath = join(outDir, 'receipt.json');
  const initialized = {
    schema: 'kaminos.lirm-armature-gestalt-family-witness.v0',
    status: 'running',
    phase: 'writer_initialized',
    failurePhase: null,
    requestedRoute: LIRM_ARMATURE_GESTALT_FAMILY_ROUTE,
    effectiveRoute: null,
    requestedConfig: { pixelWidth, pixelHeight },
    effectiveConfig: null,
    requestedCandidateIds: sourceDefinitions.map(source => source.id),
    sourceEvidence: [],
    candidates: [],
    lastTrustworthyEvidence: 'invocation recorded; no source report accepted',
  };
  await writeFile(receiptPath, `${JSON.stringify(initialized, null, 2)}\n`);
  let phase = 'source-validation';
  try {
    const family = await loadLirmArmatureGestaltFamily({ repoRoot, sourceDefinitions });
    const sourceEvidence = uniqueSourceEvidence(family.candidates);
    phase = 'conditioning-witness';
    const candidateReceipts = [];
    for (const candidate of family.candidates) {
      const candidateOutDir = join(outDir, 'candidates', candidate.id);
      const result = await writeLirmArmatureProgramImplicitBodyWitness({
        outDir: candidateOutDir,
        armatureProgram: candidate.armatureProgram,
        parameters: candidate.parameters,
        candidateId: candidate.id,
        pixelWidth,
        pixelHeight,
      });
      const receiptRelativePath = relative(outDir, result.receiptPath);
      candidateReceipts.push({
        id: candidate.id,
        armatureProgramId: candidate.armatureProgram.id,
        acceptance: candidate.acceptance,
        donorSha256: candidate.donor?.sha256 ?? null,
        metrics: candidate.metrics,
        sourceEvidence: candidate.sourceEvidence,
        receiptPath: receiptRelativePath,
        receiptEvidence: await fileEvidence(result.receiptPath, receiptRelativePath),
      });
    }
    const receipt = {
      ...initialized,
      status: 'complete',
      phase: 'family_witness_written',
      effectiveRoute: family.effectiveRoute,
      effectiveConfig: { pixelWidth, pixelHeight },
      sourceEvidence,
      candidates: candidateReceipts,
      falseClosureGuards: family.falseClosureGuards,
      lastTrustworthyEvidence: 'five source-anchored conditioning packages written with pinned source and output receipt hashes',
    };
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    return {
      schema: 'kaminos.lirm-armature-gestalt-family-write-result.v0',
      status: 'complete',
      route: family.effectiveRoute,
      receiptPath,
      candidateCount: candidateReceipts.length,
    };
  } catch (error) {
    await writeFile(receiptPath, `${JSON.stringify({
      ...initialized,
      status: 'failed',
      phase: 'failed',
      failurePhase: phase,
      errorMessage: error.message,
      lastTrustworthyEvidence: phase === 'source-validation'
        ? 'invocation recorded; no source report accepted'
        : 'source reports accepted; one or more conditioning witnesses incomplete',
    }, null, 2)}\n`);
    throw error;
  }
}
