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
import { validateReceiptBearingPng } from './lib/receipt-bearing-browser-capture.mjs';

export const NBODY_PACKING_JOINT_REFERENCE_WITNESS_ROUTE =
  'nbody-packing-joint-reference-orbitable-v0';

const REPORT_SCHEMA = 'kaminos.nbody-packing-joint-reference-witness-report.v0';
const VISUAL_INSPECTION_SCHEMA =
  'kaminos.nbody-packing-joint-reference-visual-inspection.v0';
const PRIMARY_PATHS = Object.freeze([
  'fixture.json',
  'assay-result.json',
  'joint-reference.json',
  'index.html',
]);
const VISUAL_STATES = Object.freeze([
  'known-feasible',
  'crowded',
  'sequential-counterfeit',
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
const DEFAULT_IO = { mkdir, readFile, rename, unlink, writeFile };

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function writeJsonAtomically(io, path, value) {
  const temporaryPath = `${path}.tmp`;
  await io.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
  await io.rename(temporaryPath, path);
}

async function clearPrimaryArtifacts(io, outputRoot) {
  const settled = await Promise.allSettled(PRIMARY_PATHS.map(async path => {
    try {
      await io.unlink(resolve(outputRoot, path));
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }));
  const failures = settled.flatMap((entry, index) => entry.status === 'rejected'
    ? [{ path:PRIMARY_PATHS[index], error:entry.reason?.message || String(entry.reason) }]
    : []);
  return failures.length === 0
    ? { status:'cleared', paths:[...PRIMARY_PATHS] }
    : { status:'failed', paths:[...PRIMARY_PATHS], failures };
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
  io:ioOverrides = {},
} = {}) {
  const io = { ...DEFAULT_IO, ...ioOverrides };
  const outputRoot = resolve(outDir);
  const route = {
    requested:NBODY_PACKING_JOINT_REFERENCE_WITNESS_ROUTE,
    effective:NBODY_PACKING_JOINT_REFERENCE_WITNESS_ROUTE,
    fallbackUsed:false,
  };
  let phase = 'prepare-output';
  let stalePrimaryCleanup = { status:'not-attempted', paths:[...PRIMARY_PATHS] };
  let lastTrustworthyEvidence = {
    phase:'fixture-received',
    fixtureId:fixture?.id || null,
    recordedFixtureSha256:fixture?.identity?.sha256 || null,
  };
  try {
    await io.mkdir(outputRoot, { recursive:true });
    phase = 'clear-stale-primary';
    stalePrimaryCleanup = await clearPrimaryArtifacts(io, outputRoot);
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
    const reportCore = {
      schema:REPORT_SCHEMA,
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
      claims: {
        knownFeasibility:'supported-by-manufactured-witness',
        localCounterfeitDiscrimination:'supported-by-global-debt-ledger',
        boundedJointReference:'supported-by-kkt-and-continuous-admission',
        scalableProductionSolver:'not-assayed',
        anatomicalCorrectness:'not-assayed',
        fasciaMechanics:'not-assayed',
      },
      visualInspection: {
        status:'pending-agent-inspection',
        artifact:'index.html',
        requiredStates:[
          'known-feasible',
          'crowded',
          'sequential-counterfeit',
          'joint-reference',
        ],
        requiredModes:['volume', 'slice'],
      },
      stalePrimaryCleanup,
    };
    const fixtureBytes = Buffer.from(`${JSON.stringify(fixture, null, 2)}\n`);
    const assayBytes = Buffer.from(`${JSON.stringify(assayResult, null, 2)}\n`);
    const referenceBytes = Buffer.from(`${JSON.stringify(jointReference, null, 2)}\n`);
    const htmlBytes = Buffer.from(renderNBodyPackingAssayHtml({
      fixture,
      result:assayResult,
      jointReference,
      report:reportCore,
    }));
    const report = {
      ...reportCore,
      bindings: {
        fixtureJsonSha256:sha256(fixtureBytes),
        assayResultJsonSha256:sha256(assayBytes),
        jointReferenceJsonSha256:sha256(referenceBytes),
        indexHtmlSha256:sha256(htmlBytes),
      },
    };
    lastTrustworthyEvidence = {
      ...lastTrustworthyEvidence,
      phase:'primary-artifacts-bound',
      bindings:structuredClone(report.bindings),
    };
    phase = 'write-primary-artifacts';
    const writes = await Promise.allSettled([
      io.writeFile(resolve(outputRoot, 'fixture.json'), fixtureBytes),
      io.writeFile(resolve(outputRoot, 'assay-result.json'), assayBytes),
      io.writeFile(resolve(outputRoot, 'joint-reference.json'), referenceBytes),
      io.writeFile(resolve(outputRoot, 'index.html'), htmlBytes),
    ]);
    const primaryPublication = writes.map((entry, index) => entry.status === 'fulfilled'
      ? { path:PRIMARY_PATHS[index], status:'written' }
      : { path:PRIMARY_PATHS[index], status:'failed', error:entry.reason?.message || String(entry.reason) });
    lastTrustworthyEvidence = {
      ...lastTrustworthyEvidence,
      phase:'primary-publication-attempted',
      primaryPublication,
    };
    const rejected = writes.find(entry => entry.status === 'rejected');
    if (rejected) throw rejected.reason;
    phase = 'publish-report';
    await writeJsonAtomically(io, resolve(outputRoot, 'report.json'), report);
    return { outputRoot, fixture, assayResult, jointReference, report };
  } catch (error) {
    const failureReport = {
      schema:REPORT_SCHEMA,
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
  const verdictKeys = Object.keys(inspection.verdict || {}).sort();
  if (
    JSON.stringify(verdictKeys) !== JSON.stringify([...VISUAL_VERDICT_KEYS].sort()) ||
    VISUAL_VERDICT_KEYS.some(key => inspection.verdict[key] !== true)
  ) {
    throw new Error('joint-reference visual admission requires the exact all-positive verdict contract');
  }
  const expectedCombinations = new Set(
    VISUAL_STATES.flatMap(state => VISUAL_MODES.map(mode => `${state}|${mode}`)),
  );
  const effectiveCombinations = inspection.images.map(image => `${image?.state}|${image?.mode}`);
  if (
    inspection.images.length !== expectedCombinations.size ||
    new Set(effectiveCombinations).size !== expectedCombinations.size ||
    effectiveCombinations.some(key => !expectedCombinations.has(key))
  ) {
    throw new Error('joint-reference visual admission requires every state/mode combination exactly once');
  }

  const reportPath = resolve(outputRoot, 'report.json');
  const fixturePath = resolve(outputRoot, 'fixture.json');
  const assayPath = resolve(outputRoot, 'assay-result.json');
  const referencePath = resolve(outputRoot, 'joint-reference.json');
  const indexPath = resolve(outputRoot, 'index.html');
  const [reportBytes, fixtureBytes, assayBytes, referenceBytes, indexBytes] =
    await Promise.all([
      io.readFile(reportPath),
      io.readFile(fixturePath),
      io.readFile(assayPath),
      io.readFile(referencePath),
      io.readFile(indexPath),
    ]);
  const report = JSON.parse(String(reportBytes));
  if (
    report.schema !== REPORT_SCHEMA ||
    report.status !== 'complete-pending-visual-inspection' ||
    report.route?.requested !== NBODY_PACKING_JOINT_REFERENCE_WITNESS_ROUTE ||
    report.route?.effective !== NBODY_PACKING_JOINT_REFERENCE_WITNESS_ROUTE ||
    report.route?.fallbackUsed !== false ||
    report.visualInspection?.status !== 'pending-agent-inspection'
  ) {
    throw new Error('joint-reference visual admission requires the current exact pending witness report');
  }
  const bindingChecks = {
    fixtureJsonSha256:sha256(fixtureBytes),
    assayResultJsonSha256:sha256(assayBytes),
    jointReferenceJsonSha256:sha256(referenceBytes),
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
    const effectivePng = validateReceiptBearingPng(
      imageBytes,
      captureReport.invocation?.viewport,
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
      domReceipt.dataset?.witnessRoute !== NBODY_PACKING_JOINT_REFERENCE_WITNESS_ROUTE
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
    throw new Error('joint-reference visual admission requires distinct pixels for all eight captures');
  }
  const receipt = {
    schema:VISUAL_INSPECTION_SCHEMA,
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
