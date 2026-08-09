import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

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
import { NBODY_PACKING_ASSAY_CAPTURE_VIEWPORT } from './nbody-packing-assay-capture.mjs';
import { validateReceiptBearingPng } from './lib/receipt-bearing-browser-capture.mjs';

export const NBODY_PACKING_JOINT_REFERENCE_WITNESS_ROUTE =
  'nbody-packing-joint-reference-orbitable-v0';
export const NBODY_PACKING_SPARSE_GLOBAL_WITNESS_ROUTE =
  'nbody-packing-sparse-global-comparison-orbitable-v0';

const REPORT_SCHEMA = 'kaminos.nbody-packing-joint-reference-witness-report.v0';
const SPARSE_REPORT_SCHEMA =
  'kaminos.nbody-packing-sparse-global-comparison-witness-report.v0';
const VISUAL_INSPECTION_SCHEMA =
  'kaminos.nbody-packing-joint-reference-visual-inspection.v0';
const SPARSE_VISUAL_INSPECTION_SCHEMA =
  'kaminos.nbody-packing-sparse-global-comparison-visual-inspection.v0';
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
const DEFAULT_IO = { mkdir, readFile, rename, unlink, writeFile };

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
  requestedSparseConfig = createNBodySparseGraphConfig(),
  io:ioOverrides = {},
} = {}) {
  const io = { ...DEFAULT_IO, ...ioOverrides };
  const outputRoot = resolve(outDir);
  const primaryPaths = includeSparseGlobalCandidate ? SPARSE_PRIMARY_PATHS : PRIMARY_PATHS;
  const visualStates = includeSparseGlobalCandidate ? SPARSE_VISUAL_STATES : VISUAL_STATES;
  const reportSchema = includeSparseGlobalCandidate ? SPARSE_REPORT_SCHEMA : REPORT_SCHEMA;
  const effectiveRoute = includeSparseGlobalCandidate
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
      if (
        sparseGlobalCandidate.status !== 'converged-sparse-global-candidate' ||
        sparseGlobalCandidate.source.fixtureSha256 !== fixture.identity.sha256 ||
        sparseGlobalCandidate.source.problemSha256 !== sparseProblem.identity.sha256 ||
        sparseGlobalCandidate.route.fallbackUsed !== false ||
        sparseGlobalCandidate.mechanism.oracleTargetCoordinatesConsumed !== false ||
        sparseGlobalCandidate.mechanism.pairwiseClosureAuthority !== false ||
        sparseGlobalCandidate.invariance?.candidateEnumeration !== 'passed' ||
        sparseGlobalCandidate.invariance?.rows?.length !== 2 ||
        !Object.values(sparseGlobalCandidate.invariance?.comparison || {}).every(Boolean) ||
        sparseGlobalCandidate.selected.maximumPhysicalResidual >
          sparseGlobalCandidate.config.effective.convergenceTolerance
      ) {
        throw new Error('sparse global witness rejects substituted or inadmissible candidate evidence');
      }
      lastTrustworthyEvidence = {
        ...lastTrustworthyEvidence,
        phase:'sparse-global-candidate-admitted',
        sparseGlobalCandidate: {
          status:sparseGlobalCandidate.status,
          sha256:sparseGlobalCandidate.identity.sha256,
          physicalStateSha256:sparseGlobalCandidate.selected.physicalStateSha256,
          maximumPhysicalResidual:sparseGlobalCandidate.selected.maximumPhysicalResidual,
          iterations:sparseGlobalCandidate.work.iterations,
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
        },
      } : {}),
      claims: {
        knownFeasibility:'supported-by-manufactured-witness',
        localCounterfeitDiscrimination:'supported-by-global-debt-ledger',
        boundedJointReference:'supported-by-kkt-and-continuous-admission',
        scalableSyntheticCandidate:includeSparseGlobalCandidate
          ? 'supported-only-on-bounded-five-body-assay'
          : 'not-assayed',
        scalableProductionSolver:'not-assayed',
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
    const htmlBytes = Buffer.from(renderNBodyPackingAssayHtml({
      fixture,
      result:assayResult,
      jointReference,
      sparseGlobalCandidate,
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
  if (!isJointReference && !isSparseGlobal) {
    throw new Error('joint-reference visual admission requires a recognized exact pending witness route');
  }
  const visualStates = isSparseGlobal ? SPARSE_VISUAL_STATES : VISUAL_STATES;
  const visualVerdictKeys = isSparseGlobal
    ? SPARSE_VISUAL_VERDICT_KEYS
    : VISUAL_VERDICT_KEYS;
  const visualInspectionSchema = isSparseGlobal
    ? SPARSE_VISUAL_INSPECTION_SCHEMA
    : VISUAL_INSPECTION_SCHEMA;
  const effectiveRoute = isSparseGlobal
    ? NBODY_PACKING_SPARSE_GLOBAL_WITNESS_ROUTE
    : NBODY_PACKING_JOINT_REFERENCE_WITNESS_ROUTE;
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
  const sparseProblemPath = isSparseGlobal ? resolve(outputRoot, 'sparse-problem.json') : null;
  const sparseCandidatePath = isSparseGlobal ? resolve(outputRoot, 'sparse-candidate.json') : null;
  const indexPath = resolve(outputRoot, 'index.html');
  const [fixtureBytes, assayBytes, referenceBytes, sparseProblemBytes, sparseCandidateBytes, indexBytes] =
    await Promise.all([
      io.readFile(fixturePath),
      io.readFile(assayPath),
      io.readFile(referencePath),
      ...(isSparseGlobal
        ? [io.readFile(sparseProblemPath), io.readFile(sparseCandidatePath)]
        : [Promise.resolve(null), Promise.resolve(null)]),
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
    ...(isSparseGlobal ? {
      sparseProblemJsonSha256:sha256(sparseProblemBytes),
      sparseCandidateJsonSha256:sha256(sparseCandidateBytes),
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
