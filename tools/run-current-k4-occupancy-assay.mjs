#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import {
  createSourceShapedPackingPerturbationSeries,
  deriveEndpointTaperedPackingSource,
  solveMuscleCompartmentPacking,
} from '../muscle-compartment-packing-core.mjs';
import { renderMuscleCompartmentPackingHtml } from '../muscle-compartment-packing-witness.mjs';

const RUN_REPORT_SCHEMA = 'kaminos.current-k4-occupancy-assay-run-report.v0';
const ASSAY_RESULT_SCHEMA = 'kaminos.current-k4-occupancy-assay-result.v0';
const VISUAL_ROUTE = 'current-k4-occupancy-orbitable-v0';
const LEVELS = Object.freeze([
  { id: 'baseline', crowdingFraction: 0 },
  { id: 'mild', crowdingFraction: 0.12 },
  { id: 'moderate', crowdingFraction: 0.24 },
]);
const ROLE_TABLE = Object.freeze({
  'muscle-34': Object.freeze({ azimuthRadians: -1.2, radialDistance: 1.8, axialOffset: 0 }),
  'muscle-13': Object.freeze({ azimuthRadians: 2.65, radialDistance: 2.2, axialOffset: 0 }),
  'muscle-12': Object.freeze({ azimuthRadians: 0.75, radialDistance: 1.4, axialOffset: -0.25 }),
  'muscle-45': Object.freeze({ azimuthRadians: 0.05, radialDistance: 1.8, axialOffset: 0.25 }),
});

function parseArguments(argv) {
  const supported = new Set([
    '--parent-atlas',
    '--routes',
    '--output',
    '--endpoint-radius-multiplier',
    '--transition-fraction',
    '--max-iterations',
    '--occupancy-envelope',
  ]);
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!supported.has(argument)) throw new Error(`unsupported argument ${argument}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value`);
    parsed[argument.slice(2)] = value;
    index += 1;
  }
  for (const key of [
    'parent-atlas',
    'routes',
    'output',
    'endpoint-radius-multiplier',
    'transition-fraction',
    'max-iterations',
    'occupancy-envelope',
  ]) {
    if (!parsed[key]) throw new Error(`--${key} is required`);
  }
  const requestedConstructionIds = parsed.routes.split(',').map(value => value.trim()).filter(Boolean);
  if (requestedConstructionIds.length === 0) throw new Error('--routes must name construction ids');
  const missingRoles = requestedConstructionIds.filter(id => !ROLE_TABLE[id]);
  if (missingRoles.length > 0) {
    throw new Error(`no explicit current-K4 occupancy role for: ${missingRoles.join(', ')}`);
  }
  const endpointRadiusMultiplier = Number(parsed['endpoint-radius-multiplier']);
  const transitionFraction = Number(parsed['transition-fraction']);
  const maxIterations = Number(parsed['max-iterations']);
  if (!Number.isFinite(endpointRadiusMultiplier)) {
    throw new Error('--endpoint-radius-multiplier must be finite');
  }
  if (!Number.isFinite(transitionFraction)) throw new Error('--transition-fraction must be finite');
  if (!Number.isInteger(maxIterations) || maxIterations <= 0) {
    throw new Error('--max-iterations must be a positive integer');
  }
  const occupancyEnvelope = parsed['occupancy-envelope'];
  if (!['normalized-sine', 'normalized-sine-squared'].includes(occupancyEnvelope)) {
    throw new Error(
      '--occupancy-envelope must be normalized-sine or normalized-sine-squared',
    );
  }
  return {
    requestedParentAtlasPath: parsed['parent-atlas'],
    requestedConstructionIds,
    outputDirectory: path.resolve(parsed.output),
    requestedTaper: {
      endpointRadiusMultiplier,
      transitionFraction,
      profile: 'smoothstep-arc-length',
      volumeCompensation: 'global-radius',
    },
    maxIterations,
    occupancyEnvelope,
  };
}

function preScanOutputDirectory(argv) {
  let outputDirectory = null;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== '--output') continue;
    const value = argv[index + 1];
    if (value && !value.startsWith('--')) outputDirectory = path.resolve(value);
  }
  return outputDirectory;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

async function writeAtomic(target, bytes) {
  const temporary = `${target}.tmp-${process.pid}`;
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(temporary, bytes);
  await rename(temporary, target);
}

function receiptPath(target) {
  const relative = path.relative(process.cwd(), target);
  if (relative === '') return 'repo://.';
  if (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`)) {
    return `repo://${relative.split(path.sep).join('/')}`;
  }
  return target;
}

function routeReceipt() {
  return { requested: VISUAL_ROUTE, effective: VISUAL_ROUTE, fallbackUsed: false };
}

function roleSchedule(ids) {
  return ids.map(muscleId => ({ muscleId, ...ROLE_TABLE[muscleId] }));
}

function ownedPrimaryPaths(outputDirectory) {
  return [
    'assay-result.json',
    'index.html',
    ...LEVELS.flatMap(level => [
      `${level.id}-tapered-source.png`,
      `${level.id}-occupied-result.png`,
      `${level.id}-tapered-source-capture-report.json`,
      `${level.id}-occupied-result-capture-report.json`,
    ]),
    'visual-inspection.json',
    'interpretation.md',
    ...LEVELS.flatMap(level => [
      `conditions/${level.id}/authenticated-source.json`,
      `conditions/${level.id}/parent-preflight-result.json`,
      `conditions/${level.id}/tapered-source.json`,
      `conditions/${level.id}/taper-receipt.json`,
      `conditions/${level.id}/occupied-result.json`,
      `conditions/${level.id}/index.html`,
    ]),
  ].map(relative => path.join(outputDirectory, relative));
}

async function clearPaths(targets) {
  for (const target of targets) {
    await unlink(target).catch(error => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}

function presentation(condition, result, occupancyEnvelope) {
  return {
    title: `Current-K4 ${condition.id} · ${occupancyEnvelope} occupancy before local relaxation`,
    authorityLabel: 'Agent-authored provisional mechanism · no anatomical or source admission',
    explanation:
      'The constant-radius parent refuses unchanged at fixed attachments. This viewer compares the ' +
      'volume-preserving tapered source against explicit identity-bound occupancy followed by local ' +
      'pairwise and skeletal relaxation. Faint lines preserve the source centerline reference.',
    beforeLabel: 'Tapered source',
    packedLabel: 'Occupied + locally relaxed result',
    solveStatus: result.status,
    hint: 'Drag to orbit · wheel to zoom · use the explicit source/result labels below',
  };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function renderPortfolio(conditions, occupancyEnvelope) {
  const cards = conditions.map(condition => {
    const root = `conditions/${condition.id}`;
    return `<section><h2>${escapeHtml(condition.id)} · ${escapeHtml(condition.status)}</h2>` +
      `<p>Pairwise ${condition.initialPairwise.toFixed(6)} → ${condition.packedPairwise.toFixed(6)} · ` +
      `skeletal ${condition.initialSkeletal.toFixed(6)} → ${condition.packedSkeletal.toFixed(6)}</p>` +
      `<div class="states"><a href="${root}/?state=before">Tapered source</a>` +
      `<a href="${root}/?state=packed">Occupied + locally relaxed result</a></div>` +
      `<div class="frames"><article><h3>Tapered source</h3><iframe title="${escapeHtml(condition.id)} tapered source" src="${root}/?state=before"></iframe></article>` +
      `<article><h3>Occupied + locally relaxed result</h3><iframe title="${escapeHtml(condition.id)} occupied result" src="${root}/?state=packed"></iframe></article></div>` +
      `</section>`;
  }).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Current-K4 explicit occupancy assay</title><style>
  :root{color-scheme:dark;font-family:Inter,system-ui,sans-serif}body{margin:0;padding:24px;background:#07090d;color:#f4eee3}header{max-width:1280px;margin:0 auto 20px}h1{font-size:24px;margin:0 0 8px}header p,section p{color:#aeb9c6;line-height:1.45}main{display:grid;gap:18px}section{min-width:0;padding:14px;border:1px solid #ffffff24;border-radius:14px;background:#0b1017}h2{font:650 15px/1.2 ui-monospace,monospace;margin:0}h3{font:600 12px/1.2 ui-monospace,monospace;color:#e7d1a8;margin:0 0 8px}.states{display:flex;gap:8px;margin:10px 0}.states a{padding:7px 9px;border-radius:8px;background:#172231;color:#e7d1a8;text-decoration:none;font:600 11px ui-monospace,monospace}.frames{display:grid;grid-template-columns:1fr 1fr;gap:12px}.frames article{min-width:0}iframe{width:100%;height:560px;border:0;border-radius:10px;background:#07090d}@media(max-width:1000px){.frames{grid-template-columns:1fr}}</style></head><body><header><h1>Current-K4 ${escapeHtml(occupancyEnvelope)} occupancy</h1><p>Exact ordered M34/M13/M12/M45 identities across Bytebound’s baseline, mild, and moderate crowding ladder. Every rung shows the volume-preserving tapered source beside the identity-bound occupied result. The authenticated constant-radius parent still refuses unchanged; this is provisional mechanism evidence, not anatomical admission.</p></header><main>${cards}</main></body></html>`;
}

function outputEntry(relativePath, bytes) {
  return { path: relativePath, sha256: sha256(bytes) };
}

function correctionConcentration(result) {
  const rows = result.correctionAttribution.byMuscle.map(row => ({
    muscleId: row.muscleId,
    cumulativeAppliedKnotDisplacement: Object.values(row.corrections).reduce(
      (sum, correction) => sum + correction.cumulativeAppliedKnotDisplacement,
      0,
    ),
  }));
  const total = rows.reduce((sum, row) => sum + row.cumulativeAppliedKnotDisplacement, 0);
  return {
    interpretation: result.correctionAttribution.interpretation,
    byMuscle: rows.map(row => ({
      ...row,
      share: total > 0 ? row.cumulativeAppliedKnotDisplacement / total : 0,
    })),
    maximumMuscleShare: total > 0
      ? Math.max(...rows.map(row => row.cumulativeAppliedKnotDisplacement / total))
      : 0,
  };
}

const rawArguments = process.argv.slice(2);
const preScannedOutputDirectory = preScanOutputDirectory(rawArguments);
let phase = 'parse-arguments';
let args;
let effectiveParentAtlasPath = null;
let parentAtlasId = null;
let parentAtlasFileSha256 = null;
let reportPath = null;
let outputPaths = [];

try {
  args = parseArguments(rawArguments);
  await mkdir(args.outputDirectory, { recursive: true });
  reportPath = path.join(args.outputDirectory, 'run-report.json');
  outputPaths = ownedPrimaryPaths(args.outputDirectory);
  await clearPaths(outputPaths);

  phase = 'read-parent-atlas';
  effectiveParentAtlasPath = await realpath(path.resolve(args.requestedParentAtlasPath));
  const parentAtlasBytes = await readFile(effectiveParentAtlasPath);
  parentAtlasFileSha256 = sha256(parentAtlasBytes);
  const parentAtlas = JSON.parse(parentAtlasBytes);
  parentAtlasId = parentAtlas.id || null;

  phase = 'compile-source-ladder';
  const series = createSourceShapedPackingPerturbationSeries({
    parentAtlas,
    parentAtlasFileSha256,
    requestedConstructionIds: args.requestedConstructionIds,
    levels: LEVELS,
  });
  const schedule = roleSchedule(series.effectiveConstructionIds);
  const artifacts = new Map();
  const resultConditions = [];
  const visualConditions = [];

  phase = 'derive-and-solve-conditions';
  for (const condition of series.conditions) {
    const parentPreflight = solveMuscleCompartmentPacking(condition.source, { maxIterations: 1 });
    const derivation = deriveEndpointTaperedPackingSource(condition.source, args.requestedTaper);
    const requestedSolverConfig = {
      maxIterations: args.maxIterations,
      clusterUpdate: 'capsule-axis-occupancy-allocation',
      clusterObstacleId: derivation.source.obstacles[0].id,
      clusterOccupancyReferenceDirection: [1, 0, 0],
      clusterAllocationSchedule: schedule,
      clusterOccupancyEnvelope: args.occupancyEnvelope,
    };
    const occupiedResult = solveMuscleCompartmentPacking(derivation.source, requestedSolverConfig);
    const root = `conditions/${condition.id}`;
    const conditionArtifacts = {
      authenticatedSource: [`${root}/authenticated-source.json`, jsonBytes(condition.source)],
      parentPreflightResult: [`${root}/parent-preflight-result.json`, jsonBytes(parentPreflight)],
      taperedSource: [`${root}/tapered-source.json`, jsonBytes(derivation.source)],
      taperReceipt: [`${root}/taper-receipt.json`, jsonBytes(derivation.receipt)],
      occupiedResult: [`${root}/occupied-result.json`, jsonBytes(occupiedResult)],
      viewer: [`${root}/index.html`, Buffer.from(renderMuscleCompartmentPackingHtml({
        source: derivation.source,
        result: occupiedResult,
        report: { route: routeReceipt() },
        presentation: presentation(condition, occupiedResult, args.occupancyEnvelope),
      }))],
    };
    for (const [, [relative, bytes]] of Object.entries(conditionArtifacts)) {
      artifacts.set(relative, bytes);
    }
    const fixedBlockers = parentPreflight.failure?.blockingMechanisms || [];
    resultConditions.push({
      id: condition.id,
      crowdingFraction: condition.crowdingFraction,
      sourceInput: condition.source.input,
      perturbation: condition.source.assayProvenance.perturbation,
      assumptions: condition.source.assayProvenance.assumptions,
      taper: {
        requested: derivation.receipt.requested,
        effective: derivation.receipt.effective,
        fallbackUsed: derivation.receipt.fallbackUsed,
      },
      occupancy: {
        requested: requestedSolverConfig,
        effective: occupiedResult.clusterProjection,
        fallbackUsed: occupiedResult.clusterProjection.fallbackUsed,
      },
      parentPreflight: {
        status: parentPreflight.status,
        blockerCount: fixedBlockers.length,
        blockingMechanisms: fixedBlockers,
      },
      occupiedResult: {
        status: occupiedResult.status,
        iterations: occupiedResult.iterations,
        initial: occupiedResult.metrics.initial,
        packed: occupiedResult.metrics.packed,
        failure: occupiedResult.failure || null,
        correctionConcentration: correctionConcentration(occupiedResult),
      },
      outputs: Object.fromEntries(
        Object.entries(conditionArtifacts).map(([key, [relative, bytes]]) => [
          key,
          outputEntry(relative, bytes),
        ]),
      ),
    });
    visualConditions.push({
      id: condition.id,
      status: occupiedResult.status,
      initialPairwise: occupiedResult.metrics.initial.pairwisePenetration,
      packedPairwise: occupiedResult.metrics.packed.pairwisePenetration,
      initialSkeletal: occupiedResult.metrics.initial.skeletalPenetration,
      packedSkeletal: occupiedResult.metrics.packed.skeletalPenetration,
    });
  }

  phase = 'prepare-artifacts';
  const portfolioBytes = Buffer.from(renderPortfolio(visualConditions, args.occupancyEnvelope));
  artifacts.set('index.html', portfolioBytes);
  const assayResult = {
    schema: ASSAY_RESULT_SCHEMA,
    evidenceTrack: 'agent-authored-provisional',
    claimCeiling: 'qualitative-route-local-mechanism-selection',
    parentAtlas: {
      requestedPath: args.requestedParentAtlasPath,
      effectivePath: receiptPath(effectiveParentAtlasPath),
      id: parentAtlasId,
      fileSha256: parentAtlasFileSha256,
    },
    requestedConstructionIds: args.requestedConstructionIds,
    requestedOccupancyEnvelope: args.occupancyEnvelope,
    effectiveConstructionIds: series.effectiveConstructionIds,
    levels: LEVELS,
    conditions: resultConditions,
  };
  const assayResultBytes = jsonBytes(assayResult);
  artifacts.set('assay-result.json', assayResultBytes);

  phase = 'write-primary-artifacts';
  for (const [relative, bytes] of artifacts) {
    await writeAtomic(path.join(args.outputDirectory, relative), bytes);
  }

  phase = 'write-report';
  const report = {
    schema: RUN_REPORT_SCHEMA,
    status: 'completed',
    failurePhase: null,
    evidenceTrack: assayResult.evidenceTrack,
    claimCeiling: assayResult.claimCeiling,
    requestedParentAtlasPath: args.requestedParentAtlasPath,
    effectiveParentAtlasPath: receiptPath(effectiveParentAtlasPath),
    parentAtlasId,
    parentAtlasFileSha256,
    requestedConstructionIds: args.requestedConstructionIds,
    effectiveConstructionIds: series.effectiveConstructionIds,
    requestedTaper: args.requestedTaper,
    requestedMaxIterations: args.maxIterations,
    requestedOccupancyEnvelope: args.occupancyEnvelope,
    requestedAllocationSchedule: schedule,
    conditions: resultConditions,
    outputs: {
      assayResult: outputEntry('assay-result.json', assayResultBytes),
    },
    visual: {
      route: routeReceipt(),
      status: 'pending-agent-inspection',
      portfolio: outputEntry('index.html', portfolioBytes),
      conditionViewers: resultConditions.map(condition => condition.outputs.viewer),
    },
    lastTrustworthyEvidence: {
      phase: 'primary-artifacts-written',
      effectiveConstructionIds: series.effectiveConstructionIds,
      resultStatuses: resultConditions.map(condition => ({
        id: condition.id,
        status: condition.occupiedResult.status,
      })),
    },
  };
  await writeAtomic(reportPath, jsonBytes(report));
  process.stdout.write(`${JSON.stringify({
    status: report.status,
    reportPath,
    resultStatuses: report.lastTrustworthyEvidence.resultStatuses,
    route: report.visual.route,
  })}\n`);
} catch (error) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const outputDirectory = args?.outputDirectory || preScannedOutputDirectory;
  if (outputDirectory) {
    await mkdir(outputDirectory, { recursive: true });
    reportPath ||= path.join(outputDirectory, 'run-report.json');
    outputPaths = outputPaths.length > 0 ? outputPaths : ownedPrimaryPaths(outputDirectory);
    await clearPaths(outputPaths);
    await writeAtomic(reportPath, jsonBytes({
      schema: RUN_REPORT_SCHEMA,
      status: 'failed',
      failurePhase: phase,
      error: message,
      rawArguments,
      requestedParentAtlasPath: args?.requestedParentAtlasPath || null,
      effectiveParentAtlasPath: effectiveParentAtlasPath
        ? receiptPath(effectiveParentAtlasPath)
        : null,
      parentAtlasId,
      parentAtlasFileSha256,
      requestedConstructionIds: args?.requestedConstructionIds || [],
      effectiveConstructionIds: [],
      outputs: null,
      visual: null,
      lastTrustworthyEvidence: {
        phase: parentAtlasFileSha256 ? 'parent-atlas-read-and-hashed' : 'raw-arguments-captured',
        parentAtlasId,
        parentAtlasFileSha256,
      },
    }));
  }
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
