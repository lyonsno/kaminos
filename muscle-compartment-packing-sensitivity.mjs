import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

import {
  measureMuscleCompartmentPacking,
  solveMuscleCompartmentPacking,
} from './muscle-compartment-packing-core.mjs';
import {
  renderMuscleCompartmentPackingHtml,
} from './muscle-compartment-packing-witness.mjs';

export const MUSCLE_COMPARTMENT_PACKING_SENSITIVITY_REQUEST_SCHEMA =
  'kaminos.muscle-compartment-packing-sensitivity-request.v0';

export const MUSCLE_COMPARTMENT_PACKING_SENSITIVITY_REPORT_SCHEMA =
  'kaminos.muscle-compartment-packing-sensitivity-report.v0';

export const MUSCLE_COMPARTMENT_PACKING_SENSITIVITY_ROUTE =
  'muscle-compartment-packing-sensitivity-orbitable-v0';

const DERIVATION_SCHEMA = 'kaminos.muscle-compartment-packing-sensitivity-derivation.v0';
const VARIANT_REPORT_SCHEMA = 'kaminos.muscle-compartment-packing-sensitivity-variant.v0';
const VISUAL_INSPECTION_SCHEMA =
  'kaminos.muscle-compartment-packing-sensitivity-visual-inspection.v0';
const DEFAULT_IO = { mkdir, readFile, rename, unlink, writeFile };
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const VARIANT_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const REQUIRED_VISUAL_EVIDENCE = Object.freeze([
  'nonblank',
  'statesDistinct',
  'stableMuscleIdentityLegible',
  'attachmentAndObstacleLegible',
  'displacementLegible',
  'metricsAndSolveStatusLegible',
  'residualBearingOutputNotPresentedAsAdmission',
]);
const REQUIRED_VISUAL_JUDGMENTS = Object.freeze([
  'sourceFormationPlausible',
  'packedRelationshipsPlausible',
  'skeletalClearanceVisuallyPlausible',
  'pairwiseExclusionVisuallyPlausible',
  'shapeDegeneracyAbsent',
]);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map(key => [key, canonical(value[key])]),
    );
  }
  if (typeof value === 'number' && Object.is(value, -0)) return 0;
  return value;
}

function canonicalBytes(value) {
  return Buffer.from(JSON.stringify(canonical(value)));
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function hashJson(value) {
  return sha256(canonicalBytes(value));
}

function receiptLocator(path, receiptRoot) {
  const relativePath = relative(receiptRoot, path);
  if (relativePath === '') return 'repo://.';
  if (!relativePath.startsWith(`..${sep}`) && relativePath !== '..' && !isAbsolute(relativePath)) {
    return `repo://${relativePath.split(sep).join('/')}`;
  }
  return path;
}

function receiptIdentity(identity, receiptRoot) {
  return { ...identity, path:receiptLocator(identity.path, receiptRoot) };
}

function requirePositiveFinite(value, label) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be positive and finite`);
  }
}

function subtract(left, right) {
  return left.map((value, index) => value - right[index]);
}

function add(left, right) {
  return left.map((value, index) => value + right[index]);
}

function scale(vector, amount) {
  return vector.map(value => value * amount);
}

function dot(left, right) {
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
}

function closestPointOnAxis(point, start, end) {
  const direction = subtract(end, start);
  const denominator = dot(direction, direction);
  if (denominator <= 1e-24) throw new Error('attachment radial scale obstacle axis is degenerate');
  const parameter = dot(subtract(point, start), direction) / denominator;
  return add(start, scale(direction, parameter));
}

function deriveAttachmentRadialScale(source, derivation) {
  requirePositiveFinite(derivation.scaleFactor, 'attachment radial scale factor');
  if (typeof derivation.obstacleId !== 'string' || derivation.obstacleId.length === 0) {
    throw new Error('attachment radial scale requires obstacleId');
  }
  const obstacle = source.obstacles.find(row => row.id === derivation.obstacleId);
  if (!obstacle) throw new Error(`attachment radial scale obstacle not found: ${derivation.obstacleId}`);
  if (obstacle.kind !== 'capsule') {
    throw new Error('attachment radial scale currently requires a capsule obstacle axis');
  }
  for (const muscle of source.muscles) {
    for (const [attachmentName, knotIndex] of [['origin', 0], ['insertion', -1]]) {
      const attachment = muscle.attachments[attachmentName];
      const closest = closestPointOnAxis(attachment.position, obstacle.start, obstacle.end);
      const moved = add(closest, scale(subtract(attachment.position, closest), derivation.scaleFactor));
      attachment.position = moved;
      const effectiveKnotIndex = knotIndex < 0 ? muscle.centerline.length - 1 : knotIndex;
      muscle.centerline[effectiveKnotIndex].position = [...moved];
    }
  }
  return {
    axis:'attachment-radial-scale',
    obstacleId:derivation.obstacleId,
    scaleFactor:derivation.scaleFactor,
  };
}

function deriveVolumeCrossSectionScale(source, derivation) {
  requirePositiveFinite(derivation.factor, 'volume cross-section factor');
  const radiusScale = Math.sqrt(derivation.factor);
  for (const muscle of source.muscles) {
    for (const knot of muscle.centerline) knot.radius *= radiusScale;
    muscle.targetVolume *= derivation.factor;
  }
  return {
    axis:'volume-cross-section-scale',
    factor:derivation.factor,
    radiusScale,
  };
}

function deriveSelectedMuscleIds(source, derivation) {
  if (!Array.isArray(derivation.muscleIds)) {
    throw new Error('selected muscle ids derivation requires muscleIds');
  }
  if (new Set(derivation.muscleIds).size !== derivation.muscleIds.length) {
    throw new Error('selected muscle ids must be unique');
  }
  if (derivation.muscleIds.length < 2 || derivation.muscleIds.length > 8) {
    throw new Error('selected muscle ids must retain between two and eight muscles');
  }
  const selected = new Set(derivation.muscleIds);
  const effectiveOrder = source.muscles
    .filter(muscle => selected.has(muscle.id))
    .map(muscle => muscle.id);
  if (
    effectiveOrder.length !== derivation.muscleIds.length ||
    effectiveOrder.some((id, index) => id !== derivation.muscleIds[index])
  ) {
    throw new Error('selected muscle ids must exist exactly once in parent source order');
  }
  source.muscles = source.muscles.filter(muscle => selected.has(muscle.id));
  return {
    axis:'selected-muscle-ids',
    muscleIds:[...effectiveOrder],
  };
}

export function deriveMuscleCompartmentPackingSensitivitySource(parentSource, derivation) {
  const parentSnapshot = structuredClone(parentSource);
  measureMuscleCompartmentPacking(parentSnapshot);
  const source = structuredClone(parentSnapshot);
  const requested = structuredClone(derivation);
  let effective;
  if (derivation?.axis === 'attachment-radial-scale') {
    effective = deriveAttachmentRadialScale(source, derivation);
  } else if (derivation?.axis === 'volume-cross-section-scale') {
    effective = deriveVolumeCrossSectionScale(source, derivation);
  } else if (derivation?.axis === 'selected-muscle-ids') {
    effective = deriveSelectedMuscleIds(source, derivation);
  } else {
    throw new Error(`unsupported muscle packing sensitivity axis: ${derivation?.axis || 'missing'}`);
  }
  const parentInput = structuredClone(parentSource.input.effective);
  const derivationIdentity = hashJson({ parentInput, effective });
  source.id = `${parentSource.id}--sensitivity-${derivationIdentity.slice(0, 16)}`;
  source.authority = {
    kind:'reference-anchored',
    anatomicalAdmission:'sensitivity-derived-only',
    parent:structuredClone(parentSource.authority),
  };
  source.sensitivityDerivation = {
    schema:DERIVATION_SCHEMA,
    parentSource: {
      id:parentSource.id,
      input:parentInput,
    },
    requested,
    effective:structuredClone(effective),
    fallbackUsed:false,
  };
  delete source.input;
  const sourceSha256 = hashJson(source);
  source.input = {
    requested: {
      kind:'sensitivity-derived-source',
      id:source.id,
      sha256:sourceSha256,
    },
    effective: {
      kind:'sensitivity-derived-source',
      id:source.id,
      sha256:sourceSha256,
    },
  };
  measureMuscleCompartmentPacking(source);
  return {
    source,
    receipt: {
      schema:DERIVATION_SCHEMA,
      axis:effective.axis,
      parentSource: {
        id:parentSource.id,
        input:parentInput,
      },
      requested,
      effective:structuredClone(effective),
      fallbackUsed:false,
      derivedSource:structuredClone(source.input.effective),
    },
  };
}

async function writeJsonAtomically(io, path, value) {
  await io.mkdir(dirname(path), { recursive:true });
  const temporaryPath = `${path}.tmp-${process.pid}`;
  await io.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
  await io.rename(temporaryPath, path);
}

async function clearFile(io, path) {
  try {
    await io.unlink(path);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

function safeFailureReportPath(requestedPath, protectedPaths) {
  let suffix = 0;
  while (true) {
    const candidate = resolve(
      suffix === 0
        ? `${requestedPath}.muscle-packing-sensitivity-failure.json`
        : `${requestedPath}.muscle-packing-sensitivity-failure.${suffix}.json`,
    );
    if (!protectedPaths.has(candidate)) return candidate;
    suffix += 1;
  }
}

function validateRequest(request) {
  if (request?.schema !== MUSCLE_COMPARTMENT_PACKING_SENSITIVITY_REQUEST_SCHEMA) {
    throw new Error(`muscle packing sensitivity request schema mismatch: ${request?.schema || 'missing'}`);
  }
  if (typeof request.id !== 'string' || request.id.length === 0) {
    throw new Error('muscle packing sensitivity request id must be nonempty');
  }
  if (request.expectedSourceSha256 !== undefined && !HASH_PATTERN.test(request.expectedSourceSha256)) {
    throw new Error('muscle packing sensitivity expected source sha256 must be a SHA-256 identity');
  }
  if (!Array.isArray(request.variants) || request.variants.length === 0) {
    throw new Error('muscle packing sensitivity request requires at least one variant');
  }
  const ids = new Set();
  for (const variant of request.variants) {
    if (!VARIANT_ID_PATTERN.test(variant?.id || '')) {
      throw new Error(`muscle packing sensitivity variant id is unsafe: ${variant?.id || 'missing'}`);
    }
    if (ids.has(variant.id)) throw new Error(`duplicate muscle packing sensitivity variant id: ${variant.id}`);
    ids.add(variant.id);
    if (!variant.derivation || typeof variant.derivation !== 'object') {
      throw new Error(`${variant.id} sensitivity variant requires derivation`);
    }
    if (!variant.solverConfig || typeof variant.solverConfig !== 'object') {
      throw new Error(`${variant.id} sensitivity variant requires explicit solverConfig`);
    }
  }
}

function renderPortfolioHtml(report) {
  const rows = report.variants.map(variant => {
    const visualDisposition = variant.visualInspection?.disposition || 'pending-agent-inspection';
    return `
      <tr>
        <td>${variant.id}</td>
        <td>${variant.derivation.axis}</td>
        <td class="${variant.solve.status === 'converged' ? 'pass' : 'fail'}">${variant.solve.status}</td>
        <td class="${visualDisposition === 'visually-admissible' ? 'pass' : visualDisposition === 'visually-rejected' ? 'reject' : 'pending'}">${visualDisposition}</td>
        <td>${variant.solve.metrics.packed.pairwisePenetration}</td>
        <td><a href="${variant.artifacts.relativeRoot}/index.html?state=before">derived input</a></td>
        <td><a href="${variant.artifacts.relativeRoot}/index.html?state=packed">solver output</a></td>
      </tr>`;
  }).join('');
  const inspectionDisposition = report.visualInspection?.disposition ||
    report.visualInspection?.status || 'pending-agent-inspection';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${report.request.id} · packing sensitivity assay</title>
<style>
body{margin:0;padding:28px;background:#07090d;color:#e8edf2;font:14px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace}main{max-width:1160px;margin:auto}h1{font-size:21px}p{color:#aeb9c6}table{width:100%;border-collapse:collapse;margin-top:22px}th,td{text-align:left;padding:10px;border-bottom:1px solid #ffffff22}th{color:#8e9baa;font-size:11px;text-transform:uppercase}.pass{color:#8ce6be}.fail{color:#ffd166}.reject{color:#ff7f7f;font-weight:700}.pending{color:#9aa7b4}a{color:#9ecbff}.identity{font-size:11px;overflow-wrap:anywhere}
</style></head><body><main>
<h1>Muscle packing sensitivity assay</h1>
<p>Every row binds exact derived-source and solver receipts to an orbitable before/output diagnostic. Residual-bearing geometry is visible evidence of what the algorithm did, not packing admission.</p>
<p><strong>Visual disposition:</strong> ${inspectionDisposition}. Numerical convergence and visual admission are separate gates.</p>
<p class="identity">run ${report.run.id} · source ${report.input.source.effective.sha256} · route ${report.route.effective}</p>
<table><thead><tr><th>variant</th><th>axis</th><th>solver disposition</th><th>visual disposition</th><th>pairwise residual</th><th>before</th><th>output</th></tr></thead><tbody>${rows}
</tbody></table></main></body></html>`;
}

function variantPresentation(variant, result) {
  const converged = result.status === 'converged';
  return {
    title:`Packing sensitivity · ${variant.id}`,
    authorityLabel:'Derived-source assay diagnostic, not packing admission',
    solveStatus:result.status,
    beforeLabel:'Derived input',
    packedLabel:converged ? 'Converged output' : 'Residual-bearing output',
    explanation:
      `This orbitable pair is the geometric output of the exact recorded sensitivity derivation ` +
      `and solver configuration. ${converged
        ? 'The solver met its numerical convergence contract; visual admission remains separate.'
        : 'The solver did not meet its convergence contract; the output remains visible only to diagnose the residual and deformation.'}`,
    hint:'Drag to orbit · wheel to zoom · output view retains input centerlines and displacement vectors',
  };
}

export async function writeMuscleCompartmentPackingSensitivityAssay({
  outDir,
  reportPath,
  sourcePath,
  requestPath,
  receiptRoot = process.cwd(),
  io:ioOverrides = {},
} = {}) {
  const io = { ...DEFAULT_IO, ...ioOverrides };
  const outputRoot = resolve(outDir || 'artifacts/muscle-compartment-packing-sensitivity-v0');
  const effectiveReportPath = resolve(reportPath || resolve(outputRoot, 'report.json'));
  const effectiveSourcePath = resolve(sourcePath || '');
  const effectiveRequestPath = resolve(requestPath || '');
  const effectiveReceiptRoot = resolve(receiptRoot);
  const portfolioPath = resolve(outputRoot, 'index.html');
  const protectedInputPaths = new Set([effectiveSourcePath, effectiveRequestPath]);
  let effectiveFailureReportPath = effectiveReportPath;
  let portfolioMayBeCleared = false;
  let phase = 'prepare-output';
  let lastTrustworthyEvidence = null;
  let sourceIdentity = null;
  let requestIdentity = null;
  let request = null;
  const failureBase = {
    schema:MUSCLE_COMPARTMENT_PACKING_SENSITIVITY_REPORT_SCHEMA,
    status:'failed',
    route: {
      requested:MUSCLE_COMPARTMENT_PACKING_SENSITIVITY_ROUTE,
      effective:null,
      fallbackUsed:false,
    },
  };
  try {
    if (!sourcePath) throw new Error('muscle packing sensitivity sourcePath is required');
    if (!requestPath) throw new Error('muscle packing sensitivity requestPath is required');
    phase = 'validate-path-custody';
    if (effectiveSourcePath === effectiveRequestPath) {
      throw new Error('muscle packing sensitivity source and request paths must be distinct');
    }
    if (protectedInputPaths.has(effectiveReportPath)) {
      effectiveFailureReportPath = safeFailureReportPath(
        effectiveReportPath,
        protectedInputPaths,
      );
      throw new Error('muscle packing sensitivity report path cannot alias a protected input');
    }
    if (protectedInputPaths.has(portfolioPath)) {
      throw new Error('muscle packing sensitivity portfolio path cannot alias a protected input');
    }
    if (portfolioPath === effectiveReportPath) {
      throw new Error('muscle packing sensitivity portfolio path cannot alias the terminal report');
    }
    portfolioMayBeCleared = true;
    phase = 'prepare-output';
    await io.mkdir(outputRoot, { recursive:true });
    await clearFile(io, portfolioPath);
    phase = 'read-inputs';
    const [sourceBytes, requestBytes] = await Promise.all([
      io.readFile(effectiveSourcePath),
      io.readFile(effectiveRequestPath),
    ]);
    sourceIdentity = { path:effectiveSourcePath, sha256:sha256(sourceBytes) };
    requestIdentity = { path:effectiveRequestPath, sha256:sha256(requestBytes) };
    lastTrustworthyEvidence = 'source and request bytes read';
    request = JSON.parse(String(requestBytes));
    phase = 'validate-source-identity';
    const expectedSourceSha256 = request.expectedSourceSha256 || sourceIdentity.sha256;
    if (expectedSourceSha256 !== sourceIdentity.sha256) {
      throw new Error(
        `muscle packing sensitivity source SHA-256 mismatch: requested ${expectedSourceSha256}, ` +
        `effective ${sourceIdentity.sha256}`,
      );
    }
    phase = 'validate-request';
    validateRequest(request);
    const source = JSON.parse(String(sourceBytes));
    measureMuscleCompartmentPacking(source);
    lastTrustworthyEvidence = 'source identity and request contract validated';
    const runId = `run-${hashJson({ sourceSha256:sourceIdentity.sha256, request }).slice(0, 20)}`;
    const runRoot = resolve(outputRoot, runId);
    const variants = [];
    for (const variant of request.variants) {
      phase = `derive-variant:${variant.id}`;
      const derived = deriveMuscleCompartmentPackingSensitivitySource(source, variant.derivation);
      lastTrustworthyEvidence = `${variant.id} derived source ${derived.source.input.effective.sha256}`;
      phase = `solve-variant:${variant.id}`;
      const result = solveMuscleCompartmentPacking(derived.source, variant.solverConfig);
      lastTrustworthyEvidence = `${variant.id} solver returned ${result.status}`;
      const relativeRoot = `${runId}/${variant.id}`;
      const variantRoot = resolve(outputRoot, relativeRoot);
      const variantReport = {
        schema:VARIANT_REPORT_SCHEMA,
        status:'complete',
        id:variant.id,
        route: {
          requested:MUSCLE_COMPARTMENT_PACKING_SENSITIVITY_ROUTE,
          effective:MUSCLE_COMPARTMENT_PACKING_SENSITIVITY_ROUTE,
          fallbackUsed:false,
        },
        derivation:derived.receipt,
        solve: {
          status:result.status,
          iterations:result.iterations,
          requestedConfig:structuredClone(variant.solverConfig),
          effectiveConfig:structuredClone(result.config),
          fallbackUsed:false,
          config:structuredClone(result.config),
          metrics:structuredClone(result.metrics),
          failure:result.failure ? structuredClone(result.failure) : null,
        },
        visual: {
          role:'diagnostic-not-admission',
          status:'pending-agent-inspection',
          route: {
            requested:MUSCLE_COMPARTMENT_PACKING_SENSITIVITY_ROUTE,
            effective:MUSCLE_COMPARTMENT_PACKING_SENSITIVITY_ROUTE,
            fallbackUsed:false,
          },
          artifact:'index.html',
        },
      };
      phase = `write-variant:${variant.id}`;
      const variantArtifactPaths = ['source.json', 'packed.json', 'index.html', 'report.json']
        .map(path => resolve(variantRoot, path));
      const protectedVariantPath = variantArtifactPaths.find(path =>
        protectedInputPaths.has(path) || path === effectiveReportPath || path === portfolioPath,
      );
      if (protectedVariantPath) {
        throw new Error(
          `${variant.id} sensitivity artifact path aliases protected custody: ${protectedVariantPath}`,
        );
      }
      await io.mkdir(variantRoot, { recursive:true });
      for (const path of variantArtifactPaths) await clearFile(io, path);
      const sourceJson = `${JSON.stringify(derived.source, null, 2)}\n`;
      const packedJson = `${JSON.stringify(result, null, 2)}\n`;
      const html = renderMuscleCompartmentPackingHtml({
        source:derived.source,
        result,
        report:variantReport,
        presentation:variantPresentation(variant, result),
      });
      await Promise.all([
        io.writeFile(resolve(variantRoot, 'source.json'), sourceJson),
        io.writeFile(resolve(variantRoot, 'packed.json'), packedJson),
        io.writeFile(resolve(variantRoot, 'index.html'), html),
      ]);
      const completedVariant = {
        ...variantReport,
        artifacts: {
          relativeRoot,
          sourceJsonSha256:sha256(sourceJson),
          packedJsonSha256:sha256(packedJson),
          indexHtmlSha256:sha256(html),
        },
      };
      await writeJsonAtomically(io, resolve(variantRoot, 'report.json'), completedVariant);
      variants.push(completedVariant);
    }
    phase = 'verify-source-immutability';
    const sourceBytesAfter = await io.readFile(effectiveSourcePath);
    const sourceSha256After = sha256(sourceBytesAfter);
    if (sourceSha256After !== sourceIdentity.sha256) {
      throw new Error(
        `muscle packing sensitivity mutated source bytes: before ${sourceIdentity.sha256}, ` +
        `after ${sourceSha256After}`,
      );
    }
    const report = {
      schema:MUSCLE_COMPARTMENT_PACKING_SENSITIVITY_REPORT_SCHEMA,
      status:'complete',
      route: {
        requested:MUSCLE_COMPARTMENT_PACKING_SENSITIVITY_ROUTE,
        effective:MUSCLE_COMPARTMENT_PACKING_SENSITIVITY_ROUTE,
        fallbackUsed:false,
      },
      request: {
        id:request.id,
        schema:request.schema,
      },
      run: { id:runId, relativeRoot:runId },
      input: {
        source: {
          requested: {
            path:receiptLocator(effectiveSourcePath, effectiveReceiptRoot),
            sha256:request.expectedSourceSha256 || sourceIdentity.sha256,
          },
          effective:receiptIdentity(sourceIdentity, effectiveReceiptRoot),
          sha256After:sourceSha256After,
          mutated:false,
        },
        request: {
          requested:receiptIdentity(requestIdentity, effectiveReceiptRoot),
          effective:receiptIdentity(requestIdentity, effectiveReceiptRoot),
        },
      },
      variants,
      visualInspection: {
        status:'pending-agent-inspection',
        portfolio:'index.html',
        requirement:'inspect every decision-bearing variant before assay disposition',
      },
    };
    phase = 'write-portfolio';
    const portfolioHtml = renderPortfolioHtml(report);
    await io.writeFile(portfolioPath, portfolioHtml);
    report.visualInspection.portfolioSha256 = sha256(portfolioHtml);
    phase = 'publish-report';
    await writeJsonAtomically(io, effectiveReportPath, report);
    return { outputRoot, reportPath:effectiveReportPath, report };
  } catch (error) {
    if (portfolioMayBeCleared) {
      try {
        await clearFile(io, portfolioPath);
      } catch (cleanupError) {
        error.portfolioCleanupError = cleanupError;
      }
    }
    const failureReport = {
      ...failureBase,
      failurePhase:phase,
      lastTrustworthyEvidence,
      input: {
        source:sourceIdentity ? {
          requested: {
            path:receiptLocator(effectiveSourcePath, effectiveReceiptRoot),
            sha256:request?.expectedSourceSha256 || sourceIdentity.sha256,
          },
          effective:receiptIdentity(sourceIdentity, effectiveReceiptRoot),
        } : {
          requested:{ path:receiptLocator(effectiveSourcePath, effectiveReceiptRoot), sha256:null },
          effective:null,
        },
        request:requestIdentity ? {
          requested:receiptIdentity(requestIdentity, effectiveReceiptRoot),
          effective:receiptIdentity(requestIdentity, effectiveReceiptRoot),
        } : {
          requested:{ path:receiptLocator(effectiveRequestPath, effectiveReceiptRoot), sha256:null },
          effective:null,
        },
      },
      error: { name:error.name, message:error.message },
    };
    try {
      await writeJsonAtomically(io, effectiveFailureReportPath, failureReport);
    } catch (reportError) {
      error.failureReportError = reportError;
    }
    error.failureReportPath = effectiveFailureReportPath;
    throw error;
  }
}

export async function admitMuscleCompartmentPackingSensitivityVisualInspection({
  outDir,
  reportPath,
  receiptPath,
  inspection,
  receiptRoot = process.cwd(),
  io:ioOverrides = {},
} = {}) {
  const io = { ...DEFAULT_IO, ...ioOverrides };
  const outputRoot = resolve(outDir || 'artifacts/muscle-compartment-packing-sensitivity-v0');
  const effectiveReportPath = resolve(reportPath || resolve(outputRoot, 'report.json'));
  const effectiveReceiptPath = resolve(
    receiptPath || resolve(outputRoot, 'visual-inspection.json'),
  );
  const effectiveReceiptRoot = resolve(receiptRoot);
  if (effectiveReceiptPath === effectiveReportPath) {
    throw new Error('muscle packing sensitivity inspection receipt cannot alias the assay report');
  }
  if (
    typeof inspection?.observedAt !== 'string' || inspection.observedAt.length === 0 ||
    typeof inspection?.url !== 'string' || inspection.url.length === 0 ||
    !Array.isArray(inspection?.variants)
  ) {
    throw new Error('muscle packing sensitivity inspection requires observedAt, url, and variants');
  }
  const inspectionBaseUrl = new URL(
    inspection.url.endsWith('/') ? inspection.url : `${inspection.url}/`,
  );
  if (!['http:', 'https:'].includes(inspectionBaseUrl.protocol)) {
    throw new Error('muscle packing sensitivity inspection url must use http or https');
  }
  const pendingReportBytes = await io.readFile(effectiveReportPath);
  const pendingReport = JSON.parse(String(pendingReportBytes));
  if (
    pendingReport.schema !== MUSCLE_COMPARTMENT_PACKING_SENSITIVITY_REPORT_SCHEMA ||
    pendingReport.status !== 'complete' ||
    pendingReport.route?.requested !== MUSCLE_COMPARTMENT_PACKING_SENSITIVITY_ROUTE ||
    pendingReport.route?.effective !== MUSCLE_COMPARTMENT_PACKING_SENSITIVITY_ROUTE ||
    pendingReport.route?.fallbackUsed !== false ||
    !['pending-agent-inspection', 'completed-agent-inspection'].includes(
      pendingReport.visualInspection?.status,
    )
  ) {
    throw new Error(
      'muscle packing sensitivity inspection requires the current complete pending assay report',
    );
  }
  const inspectionInputReportSha256 =
    pendingReport.visualInspection.inspectionInputReportSha256 || sha256(pendingReportBytes);
  const inspectionInputPortfolioSha256 =
    pendingReport.visualInspection.priorPortfolioSha256 ||
    pendingReport.visualInspection.portfolioSha256;
  const expectedVariantIds = pendingReport.variants.map(variant => variant.id);
  const inspectedVariantIds = inspection.variants.map(variant => variant?.id);
  if (
    inspectedVariantIds.length !== expectedVariantIds.length ||
    inspectedVariantIds.some((id, index) => id !== expectedVariantIds[index])
  ) {
    throw new Error(
      'muscle packing sensitivity inspection must cover every report variant in report order',
    );
  }
  const inspectedVariants = [];
  for (const [variantIndex, inspectedVariant] of inspection.variants.entries()) {
    const reportVariant = pendingReport.variants[variantIndex];
    const currentArtifactPaths = {
      source:resolve(outputRoot, reportVariant.artifacts.relativeRoot, 'source.json'),
      packed:resolve(outputRoot, reportVariant.artifacts.relativeRoot, 'packed.json'),
      html:resolve(outputRoot, reportVariant.artifacts.relativeRoot, 'index.html'),
    };
    const currentArtifactBytes = Object.fromEntries(await Promise.all(
      Object.entries(currentArtifactPaths).map(async ([key, path]) => [key, await io.readFile(path)]),
    ));
    if (
      sha256(currentArtifactBytes.source) !== reportVariant.artifacts.sourceJsonSha256 ||
      sha256(currentArtifactBytes.packed) !== reportVariant.artifacts.packedJsonSha256 ||
      sha256(currentArtifactBytes.html) !== reportVariant.artifacts.indexHtmlSha256
    ) {
      throw new Error(`${reportVariant.id} sensitivity visual artifacts no longer match the assay report`);
    }
    const evidenceKeys = Object.keys(inspectedVariant?.evidence || {});
    const missingEvidence = REQUIRED_VISUAL_EVIDENCE.filter(key => !evidenceKeys.includes(key));
    const unexpectedEvidence = evidenceKeys.filter(key => !REQUIRED_VISUAL_EVIDENCE.includes(key));
    if (
      missingEvidence.length > 0 || unexpectedEvidence.length > 0 ||
      Object.values(inspectedVariant?.evidence || {}).some(value => value !== true)
    ) {
      throw new Error(
        `${reportVariant.id} sensitivity visual evidence mismatch; ` +
        `missing: ${missingEvidence.join(', ') || 'none'}; ` +
        `unexpected: ${unexpectedEvidence.join(', ') || 'none'}`,
      );
    }
    const judgmentKeys = Object.keys(inspectedVariant?.judgment || {});
    const missingJudgments = REQUIRED_VISUAL_JUDGMENTS.filter(
      key => !judgmentKeys.includes(key),
    );
    const unexpectedJudgments = judgmentKeys.filter(
      key => !REQUIRED_VISUAL_JUDGMENTS.includes(key),
    );
    if (
      missingJudgments.length > 0 || unexpectedJudgments.length > 0 ||
      Object.values(inspectedVariant?.judgment || {}).some(value => typeof value !== 'boolean')
    ) {
      throw new Error(
        `${reportVariant.id} sensitivity visual judgment mismatch; ` +
        `missing: ${missingJudgments.join(', ') || 'none'}; ` +
        `unexpected: ${unexpectedJudgments.join(', ') || 'none'}`,
      );
    }
    const allJudgmentsPositive = Object.values(inspectedVariant.judgment).every(Boolean);
    const expectedDisposition = allJudgmentsPositive
      ? 'visually-admissible'
      : 'visually-rejected';
    if (inspectedVariant.disposition !== expectedDisposition) {
      throw new Error(
        `${reportVariant.id} sensitivity visual disposition must be ${expectedDisposition}`,
      );
    }
    if (!Array.isArray(inspectedVariant.images) || inspectedVariant.images.length !== 2) {
      throw new Error(`${reportVariant.id} sensitivity inspection requires before and packed images`);
    }
    const stateOrder = inspectedVariant.images.map(image => image?.state);
    if (stateOrder[0] !== 'before' || stateOrder[1] !== 'packed') {
      throw new Error(
        `${reportVariant.id} sensitivity inspection image order must be before then packed`,
      );
    }
    const images = [];
    for (const image of inspectedVariant.images) {
      const expectedImageRelativePath =
        `${reportVariant.artifacts.relativeRoot}/${image.state}.png`;
      const expectedCaptureRelativePath =
        `${reportVariant.artifacts.relativeRoot}/capture-${image.state}-report.json`;
      if (
        image.path !== expectedImageRelativePath ||
        image.captureReport !== expectedCaptureRelativePath
      ) {
        throw new Error(
          `${reportVariant.id} ${image.state} sensitivity capture paths do not match its artifact root`,
        );
      }
      const imagePath = resolve(outputRoot, image.path);
      const captureReportPath = resolve(outputRoot, image.captureReport);
      if (
        !imagePath.startsWith(`${outputRoot}/`) ||
        !captureReportPath.startsWith(`${outputRoot}/`) ||
        imagePath === effectiveReportPath || captureReportPath === effectiveReportPath ||
        imagePath === effectiveReceiptPath || captureReportPath === effectiveReceiptPath
      ) {
        throw new Error(`${reportVariant.id} sensitivity capture path escapes or aliases custody`);
      }
      const [imageBytes, captureReportBytes] = await Promise.all([
        io.readFile(imagePath),
        io.readFile(captureReportPath),
      ]);
      if (imageBytes.length === 0) {
        throw new Error(`${reportVariant.id} ${image.state} sensitivity capture is blank`);
      }
      const imageSha256 = sha256(imageBytes);
      const captureReport = JSON.parse(String(captureReportBytes));
      const expectedCaptureUrl = new URL(
        `${reportVariant.artifacts.relativeRoot}/?state=${image.state}`,
        inspectionBaseUrl,
      ).href;
      if (
        captureReport.schema !== 'kaminos.receipt-bearing-browser-capture.v0' ||
        captureReport.status !== 'complete' ||
        captureReport.route?.requested !== 'independent-headless-screenshot-v0' ||
        captureReport.route?.effective !== 'independent-headless-screenshot-v0' ||
        captureReport.route?.fallbackUsed !== false ||
        captureReport.browser?.effective?.installedStableChrome !== false ||
        captureReport.invocation?.url !== expectedCaptureUrl ||
        captureReport.stderr?.truncated !== false ||
        /\bUncaught\b|\bUnhandled\b/i.test(captureReport.stderr?.tail || '') ||
        captureReport.process?.cleanup?.groupPresentAfter !== false ||
        captureReport.process?.profileCleanup?.status !== 'complete-removed' ||
        captureReport.primaryOutput?.sha256 !== imageSha256 ||
        captureReport.primaryOutput?.sizeBytes !== imageBytes.length ||
        !Number.isInteger(captureReport.primaryOutput?.png?.width) ||
        !Number.isInteger(captureReport.primaryOutput?.png?.height) ||
        captureReport.primaryOutput.png.width <= 0 ||
        captureReport.primaryOutput.png.height <= 0
      ) {
        throw new Error(
          `${reportVariant.id} ${image.state} sensitivity capture receipt is incomplete or mismatched`,
        );
      }
      images.push({
        state:image.state,
        path:image.path,
        sha256:imageSha256,
        sizeBytes:imageBytes.length,
        viewport:[
          captureReport.primaryOutput.png.width,
          captureReport.primaryOutput.png.height,
        ],
        capture: {
          report:image.captureReport,
          reportSha256:sha256(captureReportBytes),
          url:captureReport.invocation.url,
          route:structuredClone(captureReport.route),
          browser:structuredClone(captureReport.browser),
          fallbackUsed:captureReport.route.fallbackUsed,
        },
      });
    }
    if (images[0].sha256 === images[1].sha256) {
      throw new Error(`${reportVariant.id} sensitivity before and packed captures are identical`);
    }
    inspectedVariants.push({
      id:reportVariant.id,
      solveStatus:reportVariant.solve.status,
      bindings: {
        sourceJsonSha256:reportVariant.artifacts.sourceJsonSha256,
        packedJsonSha256:reportVariant.artifacts.packedJsonSha256,
        indexHtmlSha256:reportVariant.artifacts.indexHtmlSha256,
      },
      images,
      evidence:structuredClone(inspectedVariant.evidence),
      judgment:structuredClone(inspectedVariant.judgment),
      disposition:inspectedVariant.disposition,
      notes:inspectedVariant.notes || null,
    });
  }
  const disposition = inspectedVariants.some(
    variant => variant.disposition === 'visually-rejected',
  ) ? 'visually-rejected' : 'visually-admissible';
  const inspectionByVariantId = new Map(
    inspectedVariants.map(variant => [variant.id, variant]),
  );
  const inspectedReport = {
    ...pendingReport,
    variants:pendingReport.variants.map(variant => {
      const inspected = inspectionByVariantId.get(variant.id);
      return {
        ...variant,
        visualInspection: {
          status:'completed-agent-inspection',
          disposition:inspected.disposition,
          evidence:structuredClone(inspected.evidence),
          judgment:structuredClone(inspected.judgment),
          notes:inspected.notes,
          images:inspected.images.map(image => ({
            state:image.state,
            path:image.path,
            sha256:image.sha256,
          })),
        },
      };
    }),
    visualInspection: {
      status:'completed-agent-inspection',
      disposition,
      observedAt:inspection.observedAt,
      portfolio:pendingReport.visualInspection.portfolio,
      inspectionInputReportSha256,
      priorPortfolioSha256:inspectionInputPortfolioSha256,
      variantCount:inspectedVariants.length,
    },
  };
  const inspectedPortfolioHtml = renderPortfolioHtml(inspectedReport);
  const inspectedPortfolioSha256 = sha256(inspectedPortfolioHtml);
  await io.writeFile(resolve(outputRoot, inspectedReport.visualInspection.portfolio), inspectedPortfolioHtml);
  const receipt = {
    schema:VISUAL_INSPECTION_SCHEMA,
    status:'completed-agent-inspection',
    disposition,
    observedAt:inspection.observedAt,
    url:inspection.url || null,
    route:structuredClone(pendingReport.route),
    bindings: {
      inspectionInputReportSha256,
      inspectionInputPortfolioSha256,
      inspectedPortfolioSha256,
      runId:pendingReport.run.id,
      sourceSha256:pendingReport.input.source.effective.sha256,
    },
    variants:inspectedVariants,
  };
  await writeJsonAtomically(io, effectiveReceiptPath, receipt);
  const receiptBytes = await io.readFile(effectiveReceiptPath);
  const report = {
    ...inspectedReport,
    visualInspection: {
      ...inspectedReport.visualInspection,
      portfolioSha256:inspectedPortfolioSha256,
      receipt:receiptLocator(effectiveReceiptPath, effectiveReceiptRoot),
      receiptSha256:sha256(receiptBytes),
      variantCount:inspectedVariants.length,
    },
  };
  await writeJsonAtomically(io, effectiveReportPath, report);
  return { outputRoot, reportPath:effectiveReportPath, receiptPath:effectiveReceiptPath, report, receipt };
}
