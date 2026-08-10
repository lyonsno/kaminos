import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import {
  createNBodyRosetteFixture,
  runNBodyRosetteCounterfeitAssay,
} from './nbody-packing-assay-core.mjs';
import { renderNBodyPackingAssayHtml } from './nbody-packing-assay-witness.mjs';
import {
  createNBodyRosetteJointReferenceConfig,
  solveNBodyRosetteJointReference,
} from './nbody-packing-joint-reference.mjs';
import {
  compileNBodySparseGraphProblem,
  createNBodySparseGraphConfig,
  solveNBodySparseGraphCandidate,
} from './nbody-packing-sparse-graph.mjs';
import {
  compileNBodyMixedFieldProblem,
  createNBodyMixedFieldConfig,
  solveNBodyMixedFieldCandidate,
} from './nbody-packing-mixed-field.mjs';
import { NBODY_PACKING_ASSAY_CAPTURE_VIEWPORT } from './nbody-packing-assay-capture.mjs';
import { validateReceiptBearingPng } from './lib/receipt-bearing-browser-capture.mjs';

export const NBODY_PACKING_JOINT_REFERENCE_WITNESS_ROUTE =
  'nbody-packing-joint-reference-orbitable-v0';
export const NBODY_PACKING_SPARSE_GLOBAL_WITNESS_ROUTE =
  'nbody-packing-sparse-global-comparison-orbitable-v0';
export const NBODY_PACKING_FRUSTRATED_COMPARISON_WITNESS_ROUTE =
  'nbody-packing-frustrated-comparison-orbitable-v0';
export const NBODY_PACKING_MIXED_FIELD_COMPARISON_WITNESS_ROUTE =
  'nbody-packing-mixed-field-comparison-orbitable-v0';

const REPORT_SCHEMA = 'kaminos.nbody-packing-joint-reference-witness-report.v0';
const SPARSE_REPORT_SCHEMA =
  'kaminos.nbody-packing-sparse-global-comparison-witness-report.v0';
const FRUSTRATED_REPORT_SCHEMA =
  'kaminos.nbody-packing-frustrated-comparison-witness-report.v0';
const MIXED_FIELD_REPORT_SCHEMA =
  'kaminos.nbody-packing-mixed-field-comparison-witness-report.v0';
const VISUAL_INSPECTION_SCHEMA =
  'kaminos.nbody-packing-joint-reference-visual-inspection.v0';
const SPARSE_VISUAL_INSPECTION_SCHEMA =
  'kaminos.nbody-packing-sparse-global-comparison-visual-inspection.v0';
const MIXED_FIELD_VISUAL_INSPECTION_SCHEMA =
  'kaminos.nbody-packing-mixed-field-comparison-visual-inspection.v0';
const PRIMARY_PATHS = Object.freeze([
  'fixture.json',
  'assay-result.json',
  'joint-reference.json',
  'index.html',
]);
const SPARSE_PRIMARY_PATHS = Object.freeze([
  'fixture.json',
  'assay-result.json',
  'joint-reference.json',
  'sparse-problem.json',
  'sparse-candidate.json',
  'index.html',
]);
const MIXED_FIELD_PRIMARY_PATHS = Object.freeze([
  ...SPARSE_PRIMARY_PATHS.slice(0, -1),
  'mixed-field-problem.json',
  'mixed-field-baseline.json',
  'mixed-field-shifted.json',
  'mixed-field-refined.json',
  'index.html',
]);
const VISUAL_STATES = Object.freeze([
  'known-feasible',
  'crowded',
  'sequential-counterfeit',
  'joint-reference',
]);
const SPARSE_VISUAL_STATES = Object.freeze([
  'known-feasible',
  'crowded',
  'sequential-counterfeit',
  'sparse-global-candidate',
  'joint-reference',
]);
const MIXED_FIELD_VISUAL_STATES = Object.freeze([
  'known-feasible',
  'crowded',
  'sequential-counterfeit',
  'sparse-global-candidate',
  'mixed-field-baseline',
  'mixed-field-shifted',
  'mixed-field-refined',
  'joint-reference',
]);
const VISUAL_MODES = Object.freeze(['volume', 'slice']);
const VISUAL_VERDICT_KEYS = Object.freeze([
  'nonblank',
  'orbitable',
  'statesLegible',
  'opaqueOverlapTruthLegible',
  'stableIdentityLegible',
  'attachmentsBoneCompartmentLegible',
  'metricsMatchMarkers',
  'packingSemanticsNotInverted',
  'jointReferenceLegible',
  'textContained',
]);
const SPARSE_VISUAL_VERDICT_KEYS = Object.freeze([
  ...VISUAL_VERDICT_KEYS,
  'sparseCandidateLegible',
  'candidateOracleDifferenceLegible',
]);
const MIXED_FIELD_VISUAL_VERDICT_KEYS = Object.freeze([
  ...SPARSE_VISUAL_VERDICT_KEYS,
  'mixedFieldFailuresLegible',
  'gridVariantsLegible',
]);
const DEFAULT_IO = { mkdir, readFile, rename, unlink, writeFile };

function canonicalMixedFieldDescriptorRows() {
  const baseConfig = createNBodyMixedFieldConfig();
  return [
    {
      stateKey:'mixed-field-baseline',
      label:'Field baseline',
      requestedConfig:baseConfig,
    },
    {
      stateKey:'mixed-field-shifted',
      label:'Field half-cell',
      requestedConfig:{ ...baseConfig, latticeTranslation:[0.5, 0.5] },
    },
    {
      stateKey:'mixed-field-refined',
      label:'Field refined',
      requestedConfig:{ ...baseConfig, latticeResolution:[37, 43] },
    },
  ];
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function writeJsonAtomically(io, path, value) {
  const temporaryPath = `${path}.tmp`;
  await io.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
  await io.rename(temporaryPath, path);
}

async function clearPrimaryArtifacts(io, outputRoot, primaryPaths = PRIMARY_PATHS) {
  const settled = await Promise.allSettled(primaryPaths.map(async path => {
    try {
      await io.unlink(resolve(outputRoot, path));
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }));
  const failures = settled.flatMap((entry, index) => entry.status === 'rejected'
    ? [{ path:primaryPaths[index], error:entry.reason?.message || String(entry.reason) }]
    : []);
  return failures.length === 0
    ? { status:'cleared', paths:[...primaryPaths] }
    : { status:'failed', paths:[...primaryPaths], failures };
}

function validateReference(fixture, reference) {
  if (reference.status !== 'converged-joint-reference') {
    throw new Error(`joint reference witness requires converged result, got ${reference.status}`);
  }
  if (
    reference.fixture?.sha256 !== fixture.identity.sha256 ||
    reference.config?.fallbackUsed !== false ||
    reference.invariance?.candidateEnumeration !== 'passed' ||
    reference.invariance?.mechanism !== 'paired-full-solve-artifact-comparison' ||
    reference.invariance?.rows?.length !== 2 ||
    new Set(reference.invariance.rows.map(
      row => row.effectiveConfig?.candidateEnumeration,
    )).size !== 2 ||
    Object.values(reference.invariance?.comparison || {}).length !== 4 ||
    !Object.values(reference.invariance.comparison).every(Boolean)
  ) {
    throw new Error('joint reference witness rejects fixture, fallback, or invariance substitution');
  }
  if (
    reference.selected?.maximumPhysicalResidual > reference.config.effective.hardTolerance ||
    reference.stationarity?.projectedGradientInfinityNorm > 5e-5 ||
    !Array.isArray(reference.selected?.muscles) ||
    !reference.selected?.belt
  ) {
    throw new Error('joint reference witness rejects unadmitted physical or stationarity evidence');
  }
}

export async function writeNBodyPackingJointReferenceWitness({
  outDir = 'artifacts/nbody-packing-joint-reference-v0',
  fixture = createNBodyRosetteFixture(),
  requestedAssayConfig,
  requestedReferenceConfig = createNBodyRosetteJointReferenceConfig(),
  includeSparseGlobalCandidate = false,
  sparseAdmission = 'require-converged',
  requestedSparseConfig = createNBodySparseGraphConfig(),
  includeMixedFieldCandidates = false,
  requestedMixedFieldConfigs = null,
  io:ioOverrides = {},
} = {}) {
  const io = { ...DEFAULT_IO, ...ioOverrides };
  const outputRoot = resolve(outDir);
  const primaryPaths = includeMixedFieldCandidates
    ? MIXED_FIELD_PRIMARY_PATHS
    : includeSparseGlobalCandidate ? SPARSE_PRIMARY_PATHS : PRIMARY_PATHS;
  const visualStates = includeMixedFieldCandidates
    ? MIXED_FIELD_VISUAL_STATES
    : includeSparseGlobalCandidate ? SPARSE_VISUAL_STATES : VISUAL_STATES;
  const isFrustratedComparison = sparseAdmission === 'require-frustrated-physical-failure';
  if (!['require-converged', 'require-frustrated-physical-failure'].includes(sparseAdmission)) {
    throw new Error(`unsupported sparse witness admission: ${sparseAdmission}`);
  }
  if (isFrustratedComparison && !includeSparseGlobalCandidate) {
    throw new Error('frustrated sparse failure witness requires a sparse global candidate');
  }
  if (includeMixedFieldCandidates && !isFrustratedComparison) {
    throw new Error('mixed field comparison requires the frustrated sparse failure comparison');
  }
  const reportSchema = includeMixedFieldCandidates
    ? MIXED_FIELD_REPORT_SCHEMA
    : isFrustratedComparison
    ? FRUSTRATED_REPORT_SCHEMA
    : includeSparseGlobalCandidate
      ? SPARSE_REPORT_SCHEMA
      : REPORT_SCHEMA;
  const effectiveRoute = includeMixedFieldCandidates
    ? NBODY_PACKING_MIXED_FIELD_COMPARISON_WITNESS_ROUTE
    : isFrustratedComparison
    ? NBODY_PACKING_FRUSTRATED_COMPARISON_WITNESS_ROUTE
    : includeSparseGlobalCandidate
      ? NBODY_PACKING_SPARSE_GLOBAL_WITNESS_ROUTE
      : NBODY_PACKING_JOINT_REFERENCE_WITNESS_ROUTE;
  const route = {
    requested:effectiveRoute,
    effective:effectiveRoute,
    fallbackUsed:false,
  };
  let phase = 'prepare-output';
  let stalePrimaryCleanup = { status:'not-attempted', paths:[...primaryPaths] };
  let lastTrustworthyEvidence = {
    phase:'fixture-received',
    fixtureId:fixture?.id || null,
    recordedFixtureSha256:fixture?.identity?.sha256 || null,
  };
  try {
    await io.mkdir(outputRoot, { recursive:true });
    const mixedFieldDescriptorRows = includeMixedFieldCandidates
      ? structuredClone(requestedMixedFieldConfigs || canonicalMixedFieldDescriptorRows())
      : null;
    if (
      includeMixedFieldCandidates &&
      !isDeepStrictEqual(mixedFieldDescriptorRows, canonicalMixedFieldDescriptorRows())
    ) {
      phase = 'validate-mixed-field-descriptors';
      throw new Error(
        'mixed field witness requires the exact canonical baseline, shifted, and refined descriptor table',
      );
    }
    phase = 'clear-stale-primary';
    stalePrimaryCleanup = await clearPrimaryArtifacts(io, outputRoot, primaryPaths);
    if (stalePrimaryCleanup.status !== 'cleared') {
      throw new Error('joint reference witness could not clear stale primary artifacts');
    }
    phase = 'build-assay';
    const assayResult = runNBodyRosetteCounterfeitAssay({
      fixture,
      ...(requestedAssayConfig === undefined ? {} : { requestedConfig:requestedAssayConfig }),
    });
    if (assayResult.status !== 'counterfeit-rejected-global-debt') {
      throw new Error(`joint reference witness requires rejected counterfeit, got ${assayResult.status}`);
    }
    lastTrustworthyEvidence = {
      ...lastTrustworthyEvidence,
      phase:'assay-built',
      assay:{ status:assayResult.status, sha256:assayResult.identity.sha256 },
    };
    phase = 'solve-joint-reference';
    const jointReference = solveNBodyRosetteJointReference({
      fixture,
      requestedConfig:requestedReferenceConfig,
    });
    validateReference(fixture, jointReference);
    lastTrustworthyEvidence = {
      ...lastTrustworthyEvidence,
      phase:'joint-reference-admitted',
      jointReference: {
        status:jointReference.status,
        sha256:jointReference.identity.sha256,
        maximumPhysicalResidual:jointReference.selected.maximumPhysicalResidual,
        projectedGradientInfinityNorm:jointReference.stationarity.projectedGradientInfinityNorm,
      },
    };
    let sparseProblem = null;
    let sparseGlobalCandidate = null;
    if (includeSparseGlobalCandidate) {
      phase = 'compile-sparse-global-problem';
      sparseProblem = compileNBodySparseGraphProblem(fixture);
      phase = 'solve-sparse-global-candidate';
      sparseGlobalCandidate = solveNBodySparseGraphCandidate({
        problem:sparseProblem,
        requestedConfig:requestedSparseConfig,
      });
      const sharedSparseEvidenceValid =
        sparseGlobalCandidate.source.fixtureSha256 !== fixture.identity.sha256 ||
        sparseGlobalCandidate.source.problemSha256 !== sparseProblem.identity.sha256 ||
        sparseGlobalCandidate.route.fallbackUsed !== false ||
        sparseGlobalCandidate.mechanism.oracleTargetCoordinatesConsumed !== false ||
        sparseGlobalCandidate.mechanism.pairwiseClosureAuthority !== false ||
        sparseGlobalCandidate.invariance?.candidateEnumeration !== 'passed' ||
        sparseGlobalCandidate.invariance?.rows?.length !== 2 ||
        !Object.values(sparseGlobalCandidate.invariance?.comparison || {}).every(Boolean);
      const convergedEvidenceInvalid =
        sparseGlobalCandidate.status !== 'converged-sparse-global-candidate' ||
        sparseGlobalCandidate.selected.maximumPhysicalResidual >
          sparseGlobalCandidate.config.effective.convergenceTolerance;
      const frustratedFailureInvalid =
        sparseGlobalCandidate.status !== 'stalled-sparse-global-candidate' ||
        sparseGlobalCandidate.failure?.phase !== 'global-sparse-contact-projection' ||
        sparseGlobalCandidate.failure?.lastTrustworthyEvidence !== 'selected' ||
        sparseGlobalCandidate.selected.metrics?.pairwisePenetration <=
          sparseGlobalCandidate.config.effective.convergenceTolerance ||
        sparseGlobalCandidate.selected.metrics?.skeletalPenetration <=
          sparseGlobalCandidate.config.effective.convergenceTolerance;
      if (
        sharedSparseEvidenceValid ||
        (isFrustratedComparison ? frustratedFailureInvalid : convergedEvidenceInvalid)
      ) {
        throw new Error('sparse global witness rejects substituted or inadmissible candidate evidence');
      }
      lastTrustworthyEvidence = {
        ...lastTrustworthyEvidence,
        phase:isFrustratedComparison
          ? 'sparse-global-candidate-physical-failure-bound'
          : 'sparse-global-candidate-admitted',
        sparseGlobalCandidate: {
          status:sparseGlobalCandidate.status,
          sha256:sparseGlobalCandidate.identity.sha256,
          physicalStateSha256:sparseGlobalCandidate.selected.physicalStateSha256,
          maximumPhysicalResidual:sparseGlobalCandidate.selected.maximumPhysicalResidual,
          pairwisePenetration:sparseGlobalCandidate.selected.metrics.pairwisePenetration,
          skeletalPenetration:sparseGlobalCandidate.selected.metrics.skeletalPenetration,
          iterations:sparseGlobalCandidate.work.iterations,
        },
      };
    }
    let mixedFieldProblem = null;
    let mixedFieldCandidates = [];
    let mixedFieldMaximumStateGap = null;
    if (includeMixedFieldCandidates) {
      phase = 'compile-mixed-field-problem';
      mixedFieldProblem = compileNBodyMixedFieldProblem(fixture);
      const requestedRows = mixedFieldDescriptorRows;
      for (const requestedRow of requestedRows) {
        phase = `solve-${requestedRow.stateKey}`;
        const result = solveNBodyMixedFieldCandidate({
          problem:mixedFieldProblem,
          requestedConfig:requestedRow.requestedConfig,
        });
        if (
          result.status !== 'stalled-mixed-field-candidate' ||
          result.source.fixtureSha256 !== fixture.identity.sha256 ||
          result.source.problemSha256 !== mixedFieldProblem.identity.sha256 ||
          result.route.fallbackUsed !== false ||
          !isDeepStrictEqual(result.config.effective, requestedRow.requestedConfig) ||
          result.mechanism.oracleTargetCoordinatesConsumed !== false ||
          result.mechanism.contactGraphRowsConsumed !== false ||
          result.invariance?.candidateEnumeration !== 'passed' ||
          !Object.values(result.invariance?.comparison || {}).every(Boolean) ||
          result.selected.metrics.pairwisePenetration <=
            result.config.effective.convergenceTolerance ||
          result.selected.metrics.skeletalPenetration >
            result.config.effective.convergenceTolerance ||
          result.selected.metrics.compartmentEscape >
            result.config.effective.convergenceTolerance ||
          result.selected.displacement.movedMemberCount < 4 ||
          result.failure?.lastTrustworthyEvidence !== 'selected'
        ) {
          throw new Error(`mixed field witness rejects substituted or falsely admitted ${requestedRow.stateKey}`);
        }
        mixedFieldCandidates.push({
          stateKey:requestedRow.stateKey,
          label:requestedRow.label,
          result,
        });
      }
      mixedFieldMaximumStateGap = 0;
      for (let left = 0; left < mixedFieldCandidates.length; left += 1) {
        for (let right = left + 1; right < mixedFieldCandidates.length; right += 1) {
          mixedFieldMaximumStateGap = Math.max(
            mixedFieldMaximumStateGap,
            ...mixedFieldCandidates[left].result.selected.vector.map((value, axis) =>
              Math.abs(value - mixedFieldCandidates[right].result.selected.vector[axis])),
          );
        }
      }
      if (mixedFieldMaximumStateGap > 0.2) {
        throw new Error(`mixed field witness cross-lattice state gap exceeds 0.2: ${mixedFieldMaximumStateGap}`);
      }
      lastTrustworthyEvidence = {
        ...lastTrustworthyEvidence,
        phase:'mixed-field-grid-failure-class-bound',
        mixedField: {
          problemSha256:mixedFieldProblem.identity.sha256,
          maximumStateGap:mixedFieldMaximumStateGap,
          rows:mixedFieldCandidates.map(candidate => ({
            stateKey:candidate.stateKey,
            status:candidate.result.status,
            sha256:candidate.result.identity.sha256,
            pairwisePenetration:candidate.result.selected.metrics.pairwisePenetration,
            skeletalPenetration:candidate.result.selected.metrics.skeletalPenetration,
          })),
        },
      };
    }
    const reportCore = {
      schema:reportSchema,
      status:'complete-pending-visual-inspection',
      route,
      fixture: {
        id:fixture.id,
        schema:fixture.schema,
        sha256:fixture.identity.sha256,
        memberCount:fixture.contactGraph.members.length,
      },
      assay: {
        schema:assayResult.schema,
        status:assayResult.status,
        sha256:assayResult.identity.sha256,
      },
      jointReference: {
        schema:jointReference.schema,
        status:jointReference.status,
        sha256:jointReference.identity.sha256,
        selectedPhysicalStateSha256:jointReference.selected.physicalStateSha256,
        maximumPhysicalResidual:jointReference.selected.maximumPhysicalResidual,
        projectedGradientInfinityNorm:jointReference.stationarity.projectedGradientInfinityNorm,
        activeConstraintCount:jointReference.stationarity.activeConstraintCount,
        admissibleMultistarts:jointReference.multistart.admissibleCount,
        declaredMultistarts:jointReference.multistart.rows.length,
        candidateEnumeration:jointReference.invariance.candidateEnumeration,
        candidateEnumerationReceipt:structuredClone(jointReference.invariance),
      },
      ...(sparseGlobalCandidate ? {
        sparseGlobalCandidate: {
          schema:sparseGlobalCandidate.schema,
          status:sparseGlobalCandidate.status,
          sha256:sparseGlobalCandidate.identity.sha256,
          problemSha256:sparseProblem.identity.sha256,
          selectedPhysicalStateSha256:sparseGlobalCandidate.selected.physicalStateSha256,
          maximumPhysicalResidual:sparseGlobalCandidate.selected.maximumPhysicalResidual,
          deformationEnergy:sparseGlobalCandidate.selected.deformationEnergy,
          movedMemberCount:sparseGlobalCandidate.selected.displacement.movedMemberCount,
          iterations:sparseGlobalCandidate.work.iterations,
          graphEdgeCount:sparseGlobalCandidate.mechanism.graphEdgeCount,
          maximumDegree:sparseGlobalCandidate.mechanism.maximumDegree,
          candidateEnumerationReceipt:structuredClone(sparseGlobalCandidate.invariance),
          admission:isFrustratedComparison
            ? 'rejected-physical-residual'
            : 'admitted-bounded-synthetic-candidate',
        },
      } : {}),
      ...(mixedFieldCandidates.length > 0 ? {
        claimCeiling: {
          authority:'bounded-synthetic-negative-mechanism-result',
          formulation: {
            algorithm:'identity-bearing-shared-occupancy-pressure-traction-v0',
            carrier:'3d-tapered-centerline-carrier-with-per-member-xz-sine-basis-zero-at-attachments',
            occupancySupport:'shared-xz-lattice-at-centerline-knots-2-and-3',
            fixtureGeometry:'short-extruded-five-body-frustrated-rosette',
            fixtureId:fixture.id,
            fixtureSha256:fixture.identity.sha256,
            gridComparison:'exact-baseline-half-cell-and-refined-order-two-quadrature',
          },
          admittedClaim:'this-exact-formulation-stalls-with-live-pair-debt-on-this-exact-fixture',
          rankingAuthority:'none',
          anatomicalAdmission:'none',
          nonGoals:[
            'general-continuum-or-field-method-rejection',
            'arbitrary-n-closure',
            'anatomical-correctness',
            'fascia-mechanics',
            'production-solver-admission',
          ],
        },
        mixedField: {
          problemSha256:mixedFieldProblem.identity.sha256,
          maximumStateGap:mixedFieldMaximumStateGap,
          stateGapCeiling:0.2,
          admission:'rejected-stable-grid-failure-class',
          rows:mixedFieldCandidates.map(candidate => ({
            stateKey:candidate.stateKey,
            label:candidate.label,
            schema:candidate.result.schema,
            status:candidate.result.status,
            sha256:candidate.result.identity.sha256,
            selectedPhysicalStateSha256:candidate.result.selected.physicalStateSha256,
            maximumPhysicalResidual:candidate.result.selected.maximumPhysicalResidual,
            pairwisePenetration:candidate.result.selected.metrics.pairwisePenetration,
            skeletalPenetration:candidate.result.selected.metrics.skeletalPenetration,
            compartmentEscape:candidate.result.selected.metrics.compartmentEscape,
            movedMemberCount:candidate.result.selected.displacement.movedMemberCount,
            latticeResolution:candidate.result.config.effective.latticeResolution,
            latticeTranslation:candidate.result.config.effective.latticeTranslation,
            latticeQuadratureOrder:candidate.result.config.effective.latticeQuadratureOrder,
          })),
        },
      } : {}),
      claims: {
        knownFeasibility:'supported-by-manufactured-witness',
        localCounterfeitDiscrimination:'supported-by-global-debt-ledger',
        boundedJointReference:'supported-by-kkt-and-continuous-admission',
        scalableSyntheticCandidate:isFrustratedComparison
          ? 'rejected-on-frustrated-bone-clearance-assay'
          : includeSparseGlobalCandidate
            ? 'supported-only-on-bounded-five-body-assay'
            : 'not-assayed',
        scalableProductionSolver:'not-assayed',
        mixedFieldCandidate:mixedFieldCandidates.length
          ? 'rejected-stable-grid-failure-class'
          : 'not-assayed',
        anatomicalCorrectness:'not-assayed',
        fasciaMechanics:'not-assayed',
      },
      visualInspection: {
        status:'pending-agent-inspection',
        artifact:'index.html',
        requiredStates:[...visualStates],
        requiredModes:['volume', 'slice'],
      },
      stalePrimaryCleanup,
    };
    const fixtureBytes = Buffer.from(`${JSON.stringify(fixture, null, 2)}\n`);
    const assayBytes = Buffer.from(`${JSON.stringify(assayResult, null, 2)}\n`);
    const referenceBytes = Buffer.from(`${JSON.stringify(jointReference, null, 2)}\n`);
    const sparseProblemBytes = sparseProblem
      ? Buffer.from(`${JSON.stringify(sparseProblem, null, 2)}\n`)
      : null;
    const sparseCandidateBytes = sparseGlobalCandidate
      ? Buffer.from(`${JSON.stringify(sparseGlobalCandidate, null, 2)}\n`)
      : null;
    const mixedFieldProblemBytes = mixedFieldProblem
      ? Buffer.from(`${JSON.stringify(mixedFieldProblem, null, 2)}\n`)
      : null;
    const mixedFieldCandidateBytes = mixedFieldCandidates.map(candidate =>
      Buffer.from(`${JSON.stringify(candidate.result, null, 2)}\n`));
    const htmlBytes = Buffer.from(renderNBodyPackingAssayHtml({
      fixture,
      result:assayResult,
      jointReference,
      sparseGlobalCandidate,
      mixedFieldCandidates,
      report:reportCore,
    }));
    const report = {
      ...reportCore,
      bindings: {
        fixtureJsonSha256:sha256(fixtureBytes),
        assayResultJsonSha256:sha256(assayBytes),
        jointReferenceJsonSha256:sha256(referenceBytes),
        ...(sparseProblemBytes ? {
          sparseProblemJsonSha256:sha256(sparseProblemBytes),
          sparseCandidateJsonSha256:sha256(sparseCandidateBytes),
        } : {}),
        ...(mixedFieldProblemBytes ? {
          mixedFieldProblemJsonSha256:sha256(mixedFieldProblemBytes),
          mixedFieldBaselineJsonSha256:sha256(mixedFieldCandidateBytes[0]),
          mixedFieldShiftedJsonSha256:sha256(mixedFieldCandidateBytes[1]),
          mixedFieldRefinedJsonSha256:sha256(mixedFieldCandidateBytes[2]),
        } : {}),
        indexHtmlSha256:sha256(htmlBytes),
      },
    };
    lastTrustworthyEvidence = {
      ...lastTrustworthyEvidence,
      phase:'primary-artifacts-bound',
      bindings:structuredClone(report.bindings),
    };
    phase = 'write-primary-artifacts';
    const primaryBytes = [
      fixtureBytes,
      assayBytes,
      referenceBytes,
      ...(sparseProblemBytes ? [sparseProblemBytes, sparseCandidateBytes] : []),
      ...(mixedFieldProblemBytes ? [mixedFieldProblemBytes, ...mixedFieldCandidateBytes] : []),
      htmlBytes,
    ];
    const writes = await Promise.allSettled(primaryPaths.map((path, index) =>
      io.writeFile(resolve(outputRoot, path), primaryBytes[index])));
    const primaryPublication = writes.map((entry, index) => entry.status === 'fulfilled'
      ? { path:primaryPaths[index], status:'written' }
      : { path:primaryPaths[index], status:'failed', error:entry.reason?.message || String(entry.reason) });
    lastTrustworthyEvidence = {
      ...lastTrustworthyEvidence,
      phase:'primary-publication-attempted',
      primaryPublication,
    };
    const rejected = writes.find(entry => entry.status === 'rejected');
    if (rejected) throw rejected.reason;
    phase = 'publish-report';
    await writeJsonAtomically(io, resolve(outputRoot, 'report.json'), report);
    return {
      outputRoot,
      fixture,
      assayResult,
      jointReference,
      sparseProblem,
      sparseGlobalCandidate,
      mixedFieldProblem,
      mixedFieldCandidates,
      report,
    };
  } catch (error) {
    const failureReport = {
      schema:reportSchema,
      status:'failed',
      route:{ requested:route.requested, effective:null, fallbackUsed:false },
      failurePhase:phase,
      lastTrustworthyEvidence,
      stalePrimaryCleanup,
      error:{ name:error.name, message:error.message },
    };
    const reportPath = phase === 'prepare-output'
      ? `${outputRoot}.failure-report.json`
      : resolve(outputRoot, 'report.json');
    error.failureReportPath = reportPath;
    try {
      await io.mkdir(dirname(reportPath), { recursive:true });
      await writeJsonAtomically(io, reportPath, failureReport);
    } catch (reportError) {
      error.failureReportError = reportError;
    }
    throw error;
  }
}

export async function writeNBodyPackingSparseGlobalCandidateWitness(options = {}) {
  return writeNBodyPackingJointReferenceWitness({
    outDir:'artifacts/nbody-packing-sparse-global-v0',
    ...options,
    includeSparseGlobalCandidate:true,
  });
}

export async function writeNBodyPackingFrustratedComparisonWitness(options = {}) {
  const referenceBase = createNBodyRosetteJointReferenceConfig();
  return writeNBodyPackingJointReferenceWitness({
    outDir:'artifacts/nbody-packing-frustrated-comparison-v0',
    fixture:createNBodyRosetteFixture({ stressTier:'frustrated-comparative-v0' }),
    requestedReferenceConfig:{
      ...referenceBase,
      penaltySchedule:[1e11],
      stepSchedule:[
        0.04,
        0.01,
        0.0025,
        0.000625,
        0.00015625,
        0.0000390625,
        0.000009765625,
        0.00000244140625,
        0.0000006103515625,
        0.000000152587890625,
        0.0000000762939453125,
      ],
    },
    requestedSparseConfig:{
      ...createNBodySparseGraphConfig(),
      lineSearch:[1],
    },
    ...options,
    includeSparseGlobalCandidate:true,
    sparseAdmission:'require-frustrated-physical-failure',
  });
}

export async function writeNBodyPackingMixedFieldComparisonWitness(options = {}) {
  return writeNBodyPackingFrustratedComparisonWitness({
    outDir:'artifacts/nbody-packing-mixed-field-comparison-v0',
    ...options,
    includeMixedFieldCandidates:true,
  });
}

export async function admitNBodyPackingJointReferenceVisualInspection({
  outDir = 'artifacts/nbody-packing-joint-reference-v0',
  inspection,
  io:ioOverrides = {},
} = {}) {
  const io = { ...DEFAULT_IO, ...ioOverrides };
  const outputRoot = resolve(outDir);
  if (
    typeof inspection?.observedAt !== 'string' || inspection.observedAt.length === 0 ||
    typeof inspection?.baseUrl !== 'string' || inspection.baseUrl.length === 0 ||
    typeof inspection?.summary !== 'string' || inspection.summary.length === 0 ||
    !Array.isArray(inspection?.images)
  ) {
    throw new Error(
      'joint-reference visual admission requires observedAt, baseUrl, summary, and images',
    );
  }
  const reportPath = resolve(outputRoot, 'report.json');
  const reportBytes = await io.readFile(reportPath);
  const report = JSON.parse(String(reportBytes));
  const isJointReference =
    report.schema === REPORT_SCHEMA &&
    report.route?.requested === NBODY_PACKING_JOINT_REFERENCE_WITNESS_ROUTE &&
    report.route?.effective === NBODY_PACKING_JOINT_REFERENCE_WITNESS_ROUTE;
  const isSparseGlobal =
    report.schema === SPARSE_REPORT_SCHEMA &&
    report.route?.requested === NBODY_PACKING_SPARSE_GLOBAL_WITNESS_ROUTE &&
    report.route?.effective === NBODY_PACKING_SPARSE_GLOBAL_WITNESS_ROUTE;
  const isFrustratedComparison =
    report.schema === FRUSTRATED_REPORT_SCHEMA &&
    report.route?.requested === NBODY_PACKING_FRUSTRATED_COMPARISON_WITNESS_ROUTE &&
    report.route?.effective === NBODY_PACKING_FRUSTRATED_COMPARISON_WITNESS_ROUTE;
  const isMixedFieldComparison =
    report.schema === MIXED_FIELD_REPORT_SCHEMA &&
    report.route?.requested === NBODY_PACKING_MIXED_FIELD_COMPARISON_WITNESS_ROUTE &&
    report.route?.effective === NBODY_PACKING_MIXED_FIELD_COMPARISON_WITNESS_ROUTE;
  if (!isJointReference && !isSparseGlobal && !isFrustratedComparison && !isMixedFieldComparison) {
    throw new Error('joint-reference visual admission requires a recognized exact pending witness route');
  }
  const includesSparseCandidate = isSparseGlobal || isFrustratedComparison || isMixedFieldComparison;
  const visualStates = isMixedFieldComparison
    ? MIXED_FIELD_VISUAL_STATES
    : includesSparseCandidate ? SPARSE_VISUAL_STATES : VISUAL_STATES;
  const visualVerdictKeys = isMixedFieldComparison
    ? MIXED_FIELD_VISUAL_VERDICT_KEYS
    : includesSparseCandidate
    ? SPARSE_VISUAL_VERDICT_KEYS
    : VISUAL_VERDICT_KEYS;
  const visualInspectionSchema = isMixedFieldComparison
    ? MIXED_FIELD_VISUAL_INSPECTION_SCHEMA
    : includesSparseCandidate
    ? SPARSE_VISUAL_INSPECTION_SCHEMA
    : VISUAL_INSPECTION_SCHEMA;
  const effectiveRoute = report.route.effective;
  const verdictKeys = Object.keys(inspection.verdict || {}).sort();
  if (
    JSON.stringify(verdictKeys) !== JSON.stringify([...visualVerdictKeys].sort()) ||
    visualVerdictKeys.some(key => inspection.verdict[key] !== true)
  ) {
    throw new Error('joint-reference visual admission requires the exact all-positive verdict contract');
  }
  const expectedCombinations = new Set(
    visualStates.flatMap(state => VISUAL_MODES.map(mode => `${state}|${mode}`)),
  );
  const effectiveCombinations = inspection.images.map(image => `${image?.state}|${image?.mode}`);
  if (
    inspection.images.length !== expectedCombinations.size ||
    new Set(effectiveCombinations).size !== expectedCombinations.size ||
    effectiveCombinations.some(key => !expectedCombinations.has(key))
  ) {
    throw new Error('joint-reference visual admission requires every state/mode combination exactly once');
  }

  const fixturePath = resolve(outputRoot, 'fixture.json');
  const assayPath = resolve(outputRoot, 'assay-result.json');
  const referencePath = resolve(outputRoot, 'joint-reference.json');
  const sparseProblemPath = includesSparseCandidate ? resolve(outputRoot, 'sparse-problem.json') : null;
  const sparseCandidatePath = includesSparseCandidate ? resolve(outputRoot, 'sparse-candidate.json') : null;
  const mixedFieldProblemPath = isMixedFieldComparison ? resolve(outputRoot, 'mixed-field-problem.json') : null;
  const mixedFieldBaselinePath = isMixedFieldComparison ? resolve(outputRoot, 'mixed-field-baseline.json') : null;
  const mixedFieldShiftedPath = isMixedFieldComparison ? resolve(outputRoot, 'mixed-field-shifted.json') : null;
  const mixedFieldRefinedPath = isMixedFieldComparison ? resolve(outputRoot, 'mixed-field-refined.json') : null;
  const indexPath = resolve(outputRoot, 'index.html');
  const [
    fixtureBytes,
    assayBytes,
    referenceBytes,
    sparseProblemBytes,
    sparseCandidateBytes,
    mixedFieldProblemBytes,
    mixedFieldBaselineBytes,
    mixedFieldShiftedBytes,
    mixedFieldRefinedBytes,
    indexBytes,
  ] =
    await Promise.all([
      io.readFile(fixturePath),
      io.readFile(assayPath),
      io.readFile(referencePath),
      ...(includesSparseCandidate
        ? [io.readFile(sparseProblemPath), io.readFile(sparseCandidatePath)]
        : [Promise.resolve(null), Promise.resolve(null)]),
      ...(isMixedFieldComparison
        ? [
          io.readFile(mixedFieldProblemPath),
          io.readFile(mixedFieldBaselinePath),
          io.readFile(mixedFieldShiftedPath),
          io.readFile(mixedFieldRefinedPath),
        ]
        : Array.from({ length:4 }, () => Promise.resolve(null))),
      io.readFile(indexPath),
    ]);
  if (
    report.status !== 'complete-pending-visual-inspection' ||
    report.route?.fallbackUsed !== false ||
    report.visualInspection?.status !== 'pending-agent-inspection'
  ) {
    throw new Error('joint-reference visual admission requires the current exact pending witness report');
  }
  const bindingChecks = {
    fixtureJsonSha256:sha256(fixtureBytes),
    assayResultJsonSha256:sha256(assayBytes),
    jointReferenceJsonSha256:sha256(referenceBytes),
    ...(includesSparseCandidate ? {
      sparseProblemJsonSha256:sha256(sparseProblemBytes),
      sparseCandidateJsonSha256:sha256(sparseCandidateBytes),
    } : {}),
    ...(isMixedFieldComparison ? {
      mixedFieldProblemJsonSha256:sha256(mixedFieldProblemBytes),
      mixedFieldBaselineJsonSha256:sha256(mixedFieldBaselineBytes),
      mixedFieldShiftedJsonSha256:sha256(mixedFieldShiftedBytes),
      mixedFieldRefinedJsonSha256:sha256(mixedFieldRefinedBytes),
    } : {}),
    indexHtmlSha256:sha256(indexBytes),
  };
  if (JSON.stringify(bindingChecks) !== JSON.stringify(report.bindings)) {
    throw new Error('joint-reference visual admission rejects stale or mismatched primary artifacts');
  }

  const baseUrl = new URL(inspection.baseUrl);
  const images = [];
  const independentFallbackPolicies = new Set([
    'independent-artifact-or-fail-no-stable-chrome',
    'explicit-independent-override-or-fail-no-stable-chrome',
  ]);
  for (const image of inspection.images) {
    if (
      typeof image.path !== 'string' || image.path.length === 0 ||
      typeof image.captureReportPath !== 'string' || image.captureReportPath.length === 0
    ) {
      throw new Error('joint-reference visual admission image paths are incomplete');
    }
    const imagePath = resolve(outputRoot, image.path);
    const captureReportPath = resolve(outputRoot, image.captureReportPath);
    if (
      !imagePath.startsWith(`${outputRoot}/`) ||
      !captureReportPath.startsWith(`${outputRoot}/`)
    ) {
      throw new Error('joint-reference visual admission image or capture report escapes output root');
    }
    const [imageBytes, captureReportBytes] = await Promise.all([
      io.readFile(imagePath),
      io.readFile(captureReportPath),
    ]);
    if (imageBytes.length === 0) {
      throw new Error(`joint-reference visual admission rejects blank capture: ${image.path}`);
    }
    const captureReport = JSON.parse(String(captureReportBytes));
    const captureUrl = new URL(captureReport.invocation?.url || inspection.baseUrl);
    const effectiveImageSha256 = sha256(imageBytes);
    const effectiveViewport = captureReport.invocation?.viewport;
    if (
      !Number.isInteger(effectiveViewport?.width) ||
      !Number.isInteger(effectiveViewport?.height) ||
      effectiveViewport.width !== NBODY_PACKING_ASSAY_CAPTURE_VIEWPORT.width ||
      effectiveViewport.height !== NBODY_PACKING_ASSAY_CAPTURE_VIEWPORT.height
    ) {
      throw new Error(
        `joint-reference visual admission viewport must be exactly ` +
        `${NBODY_PACKING_ASSAY_CAPTURE_VIEWPORT.width}x` +
        `${NBODY_PACKING_ASSAY_CAPTURE_VIEWPORT.height}: ${image.state}/${image.mode}`,
      );
    }
    const effectivePng = validateReceiptBearingPng(
      imageBytes,
      effectiveViewport,
    );
    if (
      !captureReport.primaryOutput?.png ||
      JSON.stringify(effectivePng) !== JSON.stringify(captureReport.primaryOutput.png)
    ) {
      throw new Error(
        `joint-reference visual admission PNG receipt mismatch: ${image.state}/${image.mode}`,
      );
    }
    const domReceipt = captureReport.domReceipt;
    if (
      domReceipt?.status !== 'complete' ||
      domReceipt.url !== captureReport.invocation?.url ||
      domReceipt.dataset?.witnessLoaded !== 'true' ||
      domReceipt.dataset?.witnessState !== image.state ||
      domReceipt.dataset?.witnessMode !== image.mode ||
      domReceipt.dataset?.witnessRoute !== effectiveRoute
    ) {
      throw new Error(
        `joint-reference visual admission effective DOM mismatch: ${image.state}/${image.mode}`,
      );
    }
    if (
      captureReport.schema !== 'kaminos.receipt-bearing-browser-capture.v0' ||
      captureReport.status !== 'complete' ||
      captureReport.route?.requested !== 'independent-headless-screenshot-v0' ||
      captureReport.route?.effective !== 'independent-headless-screenshot-v0' ||
      captureReport.route?.fallbackUsed !== false ||
      captureReport.browser?.effective?.installedStableChrome !== false ||
      !independentFallbackPolicies.has(captureReport.browser?.fallbackPolicy) ||
      captureUrl.origin !== baseUrl.origin ||
      captureUrl.pathname !== baseUrl.pathname ||
      captureUrl.searchParams.get('state') !== image.state ||
      captureUrl.searchParams.get('mode') !== image.mode ||
      !captureReport.primaryOutput?.path?.endsWith(`/${image.path}`)
    ) {
      throw new Error(
        `joint-reference visual admission capture route mismatch: ${image.state}/${image.mode}`,
      );
    }
    if (
      captureReport.primaryOutput.sha256 !== effectiveImageSha256 ||
      captureReport.primaryOutput.sizeBytes !== imageBytes.length
    ) {
      throw new Error(
        `joint-reference visual admission capture primary hash mismatch: ${image.state}/${image.mode}`,
      );
    }
    images.push({
      state:image.state,
      mode:image.mode,
      path:image.path,
      byteLength:imageBytes.length,
      sha256:effectiveImageSha256,
      captureReportPath:image.captureReportPath,
      captureReportSha256:sha256(captureReportBytes),
      viewport:structuredClone(captureReport.invocation.viewport),
      capture: {
        route:structuredClone(captureReport.route),
        url:captureReport.invocation.url,
        browser: {
          kind:captureReport.browser.effective.kind,
          installedStableChrome:captureReport.browser.effective.installedStableChrome,
          fallbackPolicy:captureReport.browser.fallbackPolicy,
        },
        effectiveDom:structuredClone(domReceipt),
      },
    });
  }
  if (new Set(images.map(image => image.sha256)).size !== images.length) {
    throw new Error('joint-reference visual admission requires distinct pixels for every capture');
  }
  const receipt = {
    schema:visualInspectionSchema,
    status:'passed-agent-inspection',
    observedAt:inspection.observedAt,
    route:{ ...structuredClone(report.route), baseUrl:inspection.baseUrl },
    bindings: {
      ...bindingChecks,
      pendingReportSha256:sha256(reportBytes),
    },
    images,
    verdict:structuredClone(inspection.verdict),
    summary:inspection.summary,
  };
  const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
  const admittedReport = {
    ...report,
    status:'complete-visual-inspected',
    visualInspection: {
      status:'passed-agent-inspection',
      artifact:'index.html',
      receipt:'visual-inspection.json',
      receiptSha256:sha256(receiptBytes),
      summary:inspection.summary,
    },
  };
  await io.writeFile(resolve(outputRoot, 'visual-inspection.json'), receiptBytes);
  await writeJsonAtomically(io, reportPath, admittedReport);
  return { outputRoot, report:admittedReport, receipt };
}

async function main() {
  const outDir = process.argv[2] || 'artifacts/nbody-packing-joint-reference-v0';
  const written = await writeNBodyPackingJointReferenceWitness({ outDir });
  process.stdout.write(`${JSON.stringify({
    status:written.report.status,
    outputRoot:written.outputRoot,
    route:written.report.route,
    jointReference:written.report.jointReference,
    bindings:written.report.bindings,
  }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
