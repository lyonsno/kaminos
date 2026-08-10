import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { renderNBodyPackingAssayHtml } from './nbody-packing-assay-witness.mjs';
import {
  compileNBodyUnifiedKktProblem,
  createNBodyUnifiedKktConfig,
  solveNBodyUnifiedKktCandidate,
} from './nbody-packing-unified-kkt.mjs';

export const NBODY_PACKING_UNIFIED_KKT_WITNESS_ROUTE =
  'nbody-packing-unified-kkt-comparison-orbitable-v0';
export const NBODY_PACKING_UNIFIED_KKT_WITNESS_SCHEMA =
  'kaminos.nbody-packing-unified-kkt-comparison-witness-report.v0';

const BASE_ROUTE = 'nbody-packing-mixed-field-comparison-orbitable-v0';
const BASE_SCHEMA = 'kaminos.nbody-packing-mixed-field-comparison-witness-report.v0';
const PRIMARY_PATHS = Object.freeze([
  'fixture.json',
  'assay-result.json',
  'joint-reference.json',
  'sparse-problem.json',
  'sparse-candidate.json',
  'mixed-field-problem.json',
  'mixed-field-baseline.json',
  'mixed-field-shifted.json',
  'mixed-field-refined.json',
  'unified-kkt-problem.json',
  'unified-kkt-candidate.json',
  'index.html',
]);
const BASE_BINDINGS = Object.freeze({
  'fixture.json':'fixtureJsonSha256',
  'assay-result.json':'assayResultJsonSha256',
  'joint-reference.json':'jointReferenceJsonSha256',
  'sparse-problem.json':'sparseProblemJsonSha256',
  'sparse-candidate.json':'sparseCandidateJsonSha256',
  'mixed-field-problem.json':'mixedFieldProblemJsonSha256',
  'mixed-field-baseline.json':'mixedFieldBaselineJsonSha256',
  'mixed-field-shifted.json':'mixedFieldShiftedJsonSha256',
  'mixed-field-refined.json':'mixedFieldRefinedJsonSha256',
});
const VISUAL_STATES = Object.freeze([
  'known-feasible',
  'crowded',
  'sequential-counterfeit',
  'sparse-global-candidate',
  'mixed-field-baseline',
  'mixed-field-shifted',
  'mixed-field-refined',
  'unified-kkt-candidate',
  'joint-reference',
]);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

async function writeJsonAtomically(path, value) {
  const temporaryPath = `${path}.tmp`;
  await writeFile(temporaryPath, jsonBytes(value));
  await rename(temporaryPath, path);
}

async function clearPrimaryArtifacts(outputRoot) {
  const rows = [];
  for (const path of PRIMARY_PATHS) {
    try {
      await unlink(resolve(outputRoot, path));
      rows.push({ path, status:'removed' });
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      rows.push({ path, status:'absent' });
    }
  }
  return rows;
}

function validateBaseReport(report, baseBytes) {
  if (
    report.schema !== BASE_SCHEMA ||
    report.status !== 'complete-visual-inspected' ||
    report.route?.requested !== BASE_ROUTE ||
    report.route?.effective !== BASE_ROUTE ||
    report.route?.fallbackUsed !== false ||
    report.visualInspection?.status !== 'passed-agent-inspection'
  ) {
    throw new Error('unified KKT witness requires the exact admitted mixed-field base route');
  }
  for (const [path, binding] of Object.entries(BASE_BINDINGS)) {
    if (sha256(baseBytes[path]) !== report.bindings?.[binding]) {
      throw new Error(`unified KKT witness rejects stale mixed-field base artifact ${path}`);
    }
  }
}

function validateUnifiedCandidate(fixture, problem, candidate, requestedConfig) {
  if (
    candidate.status !== 'converged-unified-kkt-candidate' ||
    candidate.source?.fixtureSha256 !== fixture.identity.sha256 ||
    candidate.source?.problemSha256 !== problem.identity.sha256 ||
    candidate.route?.fallbackUsed !== false ||
    candidate.mechanism?.oracleTargetCoordinatesConsumed !== false ||
    candidate.mechanism?.contactGraphRowsConsumed !== false ||
    candidate.invariance?.candidateEnumeration !== 'passed' ||
    !Object.values(candidate.invariance?.comparison || {}).every(Boolean) ||
    candidate.selected?.maximumPhysicalResidual > requestedConfig.convergenceTolerance ||
    candidate.selected?.metrics?.pairwisePenetration > requestedConfig.convergenceTolerance ||
    candidate.selected?.metrics?.skeletalPenetration > requestedConfig.convergenceTolerance ||
    candidate.selected?.metrics?.compartmentEscape > requestedConfig.convergenceTolerance ||
    candidate.selected?.metrics?.endpointDrift > requestedConfig.convergenceTolerance ||
    candidate.selected?.metrics?.maximumRelativeVolumeError > requestedConfig.convergenceTolerance ||
    candidate.selected?.displacement?.movedMemberCount < 4
  ) {
    throw new Error('unified KKT witness rejects substituted or inadmissible candidate evidence');
  }
}

export async function writeNBodyPackingUnifiedKktWitness({
  baseDir = 'artifacts/nbody-packing-mixed-field-comparison-v0',
  outDir = 'artifacts/nbody-packing-unified-kkt-comparison-v0',
  requestedConfig = createNBodyUnifiedKktConfig(),
} = {}) {
  const baseRoot = resolve(baseDir);
  const outputRoot = resolve(outDir);
  let phase = 'read-admitted-base';
  let lastTrustworthyEvidence = { phase:'none' };
  let stalePrimaryCleanup = [];
  try {
    const basePaths = Object.keys(BASE_BINDINGS);
    const baseRows = await Promise.all(basePaths.map(async path => [
      path,
      await readFile(resolve(baseRoot, path)),
    ]));
    const baseBytes = Object.fromEntries(baseRows);
    const baseReportBytes = await readFile(resolve(baseRoot, 'report.json'));
    const baseReport = JSON.parse(String(baseReportBytes));
    validateBaseReport(baseReport, baseBytes);
    lastTrustworthyEvidence = {
      phase:'admitted-mixed-field-base-bound',
      reportSha256:sha256(baseReportBytes),
      visualInspectionReceiptSha256:baseReport.visualInspection.receiptSha256,
    };

    phase = 'compile-unified-problem';
    const fixture = JSON.parse(String(baseBytes['fixture.json']));
    const assayResult = JSON.parse(String(baseBytes['assay-result.json']));
    const jointReference = JSON.parse(String(baseBytes['joint-reference.json']));
    const sparseGlobalCandidate = JSON.parse(String(baseBytes['sparse-candidate.json']));
    const mixedFieldCandidates = [
      ['mixed-field-baseline', 'Field baseline', 'mixed-field-baseline.json'],
      ['mixed-field-shifted', 'Field half-cell', 'mixed-field-shifted.json'],
      ['mixed-field-refined', 'Field refined', 'mixed-field-refined.json'],
    ].map(([stateKey, label, path]) => ({
      stateKey,
      label,
      result:JSON.parse(String(baseBytes[path])),
    }));
    const problem = compileNBodyUnifiedKktProblem(fixture);

    phase = 'solve-unified-candidate';
    const candidate = solveNBodyUnifiedKktCandidate({ problem, requestedConfig });
    validateUnifiedCandidate(fixture, problem, candidate, requestedConfig);
    lastTrustworthyEvidence = {
      ...lastTrustworthyEvidence,
      phase:'unified-candidate-admitted-for-visual-inspection',
      problemSha256:problem.identity.sha256,
      candidateSha256:candidate.identity.sha256,
      selectedPhysicalStateSha256:candidate.selected.physicalStateSha256,
      maximumPhysicalResidual:candidate.selected.maximumPhysicalResidual,
    };

    phase = 'prepare-output';
    await mkdir(outputRoot, { recursive:true });
    stalePrimaryCleanup = await clearPrimaryArtifacts(outputRoot);
    const route = {
      requested:NBODY_PACKING_UNIFIED_KKT_WITNESS_ROUTE,
      effective:NBODY_PACKING_UNIFIED_KKT_WITNESS_ROUTE,
      fallbackUsed:false,
    };
    const reportCore = {
      schema:NBODY_PACKING_UNIFIED_KKT_WITNESS_SCHEMA,
      status:'complete-pending-visual-inspection',
      route,
      source: {
        baseRoute:baseReport.route,
        baseReportSha256:sha256(baseReportBytes),
        baseVisualInspectionReceiptSha256:baseReport.visualInspection.receiptSha256,
      },
      fixture:structuredClone(baseReport.fixture),
      unifiedKkt: {
        problemSha256:problem.identity.sha256,
        candidateSha256:candidate.identity.sha256,
        selectedPhysicalStateSha256:candidate.selected.physicalStateSha256,
        status:candidate.status,
        maximumPhysicalResidual:candidate.selected.maximumPhysicalResidual,
        iterations:candidate.work.iterations,
        movedMemberCount:candidate.selected.displacement.movedMemberCount,
        traversalEquivalence:structuredClone(candidate.invariance),
      },
      claimCeiling: {
        authority:'bounded-synthetic-positive-mechanism-result-pending-visual-inspection',
        admittedClaim:'one exact global active-set formulation closes all declared hard residuals on one exact frustrated five-body fixture',
        visualAdmission:'pending',
        rankingAuthority:'none',
        anatomicalAdmission:'none',
        nonGoals:[
          'arbitrary-n-closure',
          'authenticated-anatomical-correctness',
          'fascia-or-skin-mechanics',
          'production-performance',
          'global-optimality',
        ],
      },
      visualInspection: {
        status:'pending-agent-inspection',
        artifact:'index.html',
        requiredStates:[...VISUAL_STATES],
        requiredModes:['volume', 'slice'],
      },
      stalePrimaryCleanup,
    };
    const htmlBytes = Buffer.from(renderNBodyPackingAssayHtml({
      fixture,
      result:assayResult,
      report:reportCore,
      jointReference,
      sparseGlobalCandidate,
      mixedFieldCandidates,
      unifiedKktCandidate:candidate,
    }));
    const problemBytes = jsonBytes(problem);
    const candidateBytes = jsonBytes(candidate);
    const outputBytes = {
      ...baseBytes,
      'unified-kkt-problem.json':problemBytes,
      'unified-kkt-candidate.json':candidateBytes,
      'index.html':htmlBytes,
    };
    const bindings = {
      ...Object.fromEntries(Object.entries(BASE_BINDINGS).map(([path, binding]) => [
        binding,
        sha256(outputBytes[path]),
      ])),
      unifiedKktProblemJsonSha256:sha256(problemBytes),
      unifiedKktCandidateJsonSha256:sha256(candidateBytes),
      indexHtmlSha256:sha256(htmlBytes),
    };
    phase = 'write-primary-artifacts';
    await Promise.all(PRIMARY_PATHS.map(path =>
      writeFile(resolve(outputRoot, path), outputBytes[path])));
    const report = { ...reportCore, bindings };
    phase = 'publish-report';
    await writeJsonAtomically(resolve(outputRoot, 'report.json'), report);
    return { outputRoot, problem, candidate, report };
  } catch (error) {
    await mkdir(outputRoot, { recursive:true });
    await writeJsonAtomically(resolve(outputRoot, 'report.json'), {
      schema:NBODY_PACKING_UNIFIED_KKT_WITNESS_SCHEMA,
      status:'failed',
      route:{ requested:NBODY_PACKING_UNIFIED_KKT_WITNESS_ROUTE, effective:null, fallbackUsed:false },
      failurePhase:phase,
      lastTrustworthyEvidence,
      stalePrimaryCleanup,
      error:{ name:error.name, message:error.message },
    });
    throw error;
  }
}

async function main() {
  const outDir = process.argv[2] || 'artifacts/nbody-packing-unified-kkt-comparison-v0';
  const written = await writeNBodyPackingUnifiedKktWitness({ outDir });
  process.stdout.write(`${JSON.stringify({
    status:written.report.status,
    outputRoot:written.outputRoot,
    route:written.report.route,
    unifiedKkt:written.report.unifiedKkt,
    bindings:written.report.bindings,
  }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
