#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import {
  VOLUME_PRESERVING_TAPERED_BELLY_PROFILE,
  createSourceShapedPackingPerturbationSeries,
  solveMuscleCompartmentPacking,
} from '../muscle-compartment-packing-core.mjs';
import { renderMuscleCompartmentPackingHtml } from '../muscle-compartment-packing-witness.mjs';

const RUN_REPORT_SCHEMA = 'kaminos.current-k4-dual-profile-occupancy-assay-run-report.v0';
const ASSAY_RESULT_SCHEMA = 'kaminos.current-k4-dual-profile-occupancy-assay-result.v0';
const VISUAL_ROUTE = 'current-k4-dual-profile-occupancy-orbitable-v0';
const TUBE_PROFILE = 'source-candidate-radius-tubes';
const PROFILE_ORDER = Object.freeze([TUBE_PROFILE, VOLUME_PRESERVING_TAPERED_BELLY_PROFILE]);
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
    '--parent-atlas', '--routes', '--output', '--max-iterations', '--occupancy-envelope',
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
  for (const key of ['parent-atlas', 'routes', 'output', 'max-iterations', 'occupancy-envelope']) {
    if (!parsed[key]) throw new Error(`--${key} is required`);
  }
  const requestedConstructionIds = parsed.routes.split(',').map(value => value.trim()).filter(Boolean);
  if (requestedConstructionIds.length === 0) throw new Error('--routes must name construction ids');
  const missingRoles = requestedConstructionIds.filter(id => !ROLE_TABLE[id]);
  if (missingRoles.length > 0) {
    throw new Error(`no explicit current-K4 occupancy role for: ${missingRoles.join(', ')}`);
  }
  const maxIterations = Number(parsed['max-iterations']);
  if (!Number.isInteger(maxIterations) || maxIterations <= 0) {
    throw new Error('--max-iterations must be a positive integer');
  }
  const occupancyEnvelope = parsed['occupancy-envelope'];
  if (!['normalized-sine', 'normalized-sine-squared'].includes(occupancyEnvelope)) {
    throw new Error('--occupancy-envelope must be normalized-sine or normalized-sine-squared');
  }
  return {
    requestedParentAtlasPath: parsed['parent-atlas'],
    requestedConstructionIds,
    outputDirectory: path.resolve(parsed.output),
    maxIterations,
    occupancyEnvelope,
  };
}

function preScanOutputDirectory(argv) {
  const index = argv.indexOf('--output');
  const value = index >= 0 ? argv[index + 1] : null;
  return value && !value.startsWith('--') ? path.resolve(value) : null;
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

function expectedVisualPaths(outputDirectory) {
  return [
    'index.html', 'assay-result.json', 'visual-inspection.json', 'interpretation.md',
    ...LEVELS.flatMap(level => PROFILE_ORDER.flatMap(profile => [
      `${level.id}-${profile}-source.png`,
      `${level.id}-${profile}-result.png`,
      `${level.id}-${profile}-source-capture-report.json`,
      `${level.id}-${profile}-result-capture-report.json`,
      `conditions/${level.id}/${profile}/source.json`,
      `conditions/${level.id}/${profile}/result.json`,
      `conditions/${level.id}/${profile}/index.html`,
    ])),
  ].map(relative => path.join(outputDirectory, relative));
}

async function clearPaths(targets) {
  for (const target of targets) {
    await unlink(target).catch(error => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}

function outputEntry(relativePath, bytes) {
  return { path: relativePath, sha256: sha256(bytes) };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function labels(profile, status) {
  return profile === TUBE_PROFILE
    ? {
      source: 'Unchanged source-candidate-radius tube',
      result: 'Immutable refusal · source preserved',
    }
    : {
      source: 'Volume-preserving tapered-belly input',
      result: status === 'immutable-constraint-conflict'
        ? 'Immutable refusal · tapered belly preserved'
        : 'Occupied + locally relaxed belly',
    };
}

function presentation(conditionId, profile, result) {
  const stateLabels = labels(profile, result.status);
  return {
    title: `Current-K4 ${conditionId} · ${profile}`,
    authorityLabel: 'Agent-authored provisional profile/mechanism evidence · no anatomical admission',
    explanation: profile === TUBE_PROFILE
      ? 'The unchanged source-candidate-radius tubes retain the fixed-attachment conflict. The refusal is deliberate and returns the source without partial mutation.'
      : 'The exact Bytebound tapered-belly profile changes radii only, preserves measured volume, and receives the same identity-bound occupancy schedule and local relaxation.',
    beforeLabel: stateLabels.source,
    packedLabel: stateLabels.result,
    solveStatus: result.status,
    hint: 'Drag to orbit · wheel to zoom · labels name the geometric state explicitly',
  };
}

function renderPortfolio(conditions, occupancyEnvelope) {
  const cards = conditions.map(condition => {
    const profileFrames = PROFILE_ORDER.map(profile => {
      const receipt = condition.profiles[profile];
      const stateLabels = labels(profile, receipt.result.status);
      const root = `conditions/${condition.id}/${profile}`;
      return `<article><h3>${escapeHtml(profile)}</h3><p>${escapeHtml(receipt.result.status)} · pairwise ${receipt.result.initial.pairwisePenetration.toFixed(6)} → ${receipt.result.packed.pairwisePenetration.toFixed(6)} · skeletal ${receipt.result.initial.skeletalPenetration.toFixed(6)} → ${receipt.result.packed.skeletalPenetration.toFixed(6)}</p><div class="states"><a href="${root}/?state=before">${escapeHtml(stateLabels.source)}</a><a href="${root}/?state=packed">${escapeHtml(stateLabels.result)}</a></div><div class="frames"><section><h4>${escapeHtml(stateLabels.source)}</h4><iframe title="${escapeHtml(condition.id)} ${escapeHtml(profile)} source" src="${root}/?state=before"></iframe></section><section><h4>${escapeHtml(stateLabels.result)}</h4><iframe title="${escapeHtml(condition.id)} ${escapeHtml(profile)} result" src="${root}/?state=packed"></iframe></section></div></article>`;
    }).join('');
    return `<section class="condition"><h2>${escapeHtml(condition.id)} · crowding ${condition.crowdingFraction}</h2>${profileFrames}</section>`;
  }).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Current-K4 dual-profile occupancy assay</title><style>:root{color-scheme:dark;font-family:Inter,system-ui,sans-serif}body{margin:0;padding:24px;background:#07090d;color:#f4eee3}header,main{max-width:1500px;margin:auto}header p,p{color:#aeb9c6;line-height:1.4}.condition{padding:16px;margin:0 0 20px;border:1px solid #ffffff24;border-radius:14px;background:#0b1017}.condition>article{margin-top:18px;padding-top:14px;border-top:1px solid #ffffff18}.frames{display:grid;grid-template-columns:1fr 1fr;gap:12px}.frames section{min-width:0}.states{display:flex;gap:8px;margin:10px 0}.states a{padding:7px 9px;border-radius:8px;background:#172231;color:#e7d1a8;text-decoration:none;font:600 11px ui-monospace,monospace}h2,h3,h4{font-family:ui-monospace,monospace}h2{font-size:16px}h3{font-size:14px;color:#e7d1a8}h4{font-size:12px}iframe{width:100%;height:540px;border:0;border-radius:10px;background:#07090d}@media(max-width:1000px){.frames{grid-template-columns:1fr}}</style></head><body><header><h1>Current-K4 dual-profile occupancy · ${escapeHtml(occupancyEnvelope)}</h1><p>One parent atlas, one ordered M34/M13/M12/M45 cohort, one three-rung crowding ladder, one provisional environment, and one occupancy schedule. The only profile variable is unchanged source-candidate radii versus Bytebound’s exact volume-preserving tapered belly. Tube refusal remains visible instead of being laundered into a partial solve.</p></header><main>${cards}</main></body></html>`;
}

function visibility(ids, source, result) {
  const sourceIds = source.muscles.map(muscle => muscle.id);
  const resultIds = result.muscles.map(muscle => muscle.id);
  return {
    requestedMemberCount: ids.length,
    effectiveSourceMemberCount: sourceIds.length,
    effectiveResultMemberCount: resultIds.length,
    missingSourceMembers: ids.filter(id => !sourceIds.includes(id)),
    missingResultMembers: ids.filter(id => !resultIds.includes(id)),
  };
}

function resultReceipt(source, result) {
  const blockers = result.failure?.blockingMechanisms || [];
  const sourceGeometry = source.muscles.map(muscle => ({
    id: muscle.id,
    attachments: muscle.attachments,
    centerline: muscle.centerline,
    targetVolume: muscle.targetVolume,
  }));
  const resultGeometry = result.muscles.map(muscle => ({
    id: muscle.id,
    attachments: muscle.attachments,
    centerline: muscle.centerline,
    targetVolume: muscle.targetVolume,
  }));
  return {
    status: result.status,
    failurePhase: result.failure?.phase || null,
    blockerCount: blockers.length,
    blockingMechanisms: blockers,
    sourceGeometryPreservedExactly: JSON.stringify(resultGeometry) === JSON.stringify(sourceGeometry),
    occupancyProjectionApplied: result.iterations > 0 &&
      result.clusterProjection?.effectiveUpdate === 'capsule-axis-occupancy-allocation',
    requestedEnvelopeProfile: result.clusterProjection?.requestedEnvelopeProfile || null,
    effectiveEnvelopeProfile: result.clusterProjection?.effectiveEnvelopeProfile || null,
    iterations: result.iterations,
    endpointDrift: result.metrics.packed.endpointDrift,
    maximumRelativeVolumeError: result.metrics.packed.maximumRelativeVolumeError,
    sourceTangentReversalCount: result.metrics.packed.sourceTangentReversalCount,
    pairwiseRelationReversalCount: result.metrics.packed.pairwiseRelationReversalCount,
    sourceCurvatureReversalCount: result.metrics.packed.sourceCurvatureReversalCount,
    initial: result.metrics.initial,
    packed: result.metrics.packed,
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
  outputPaths = expectedVisualPaths(args.outputDirectory);
  await clearPaths(outputPaths);

  phase = 'read-parent-atlas';
  effectiveParentAtlasPath = await realpath(path.resolve(args.requestedParentAtlasPath));
  const parentAtlasBytes = await readFile(effectiveParentAtlasPath);
  parentAtlasFileSha256 = sha256(parentAtlasBytes);
  const parentAtlas = JSON.parse(parentAtlasBytes);
  parentAtlasId = parentAtlas.id || null;

  phase = 'compile-profile-ladders';
  const common = {
    parentAtlas,
    parentAtlasFileSha256,
    requestedConstructionIds: args.requestedConstructionIds,
    levels: LEVELS,
  };
  const seriesByProfile = {
    [TUBE_PROFILE]: createSourceShapedPackingPerturbationSeries(common),
    [VOLUME_PRESERVING_TAPERED_BELLY_PROFILE]: createSourceShapedPackingPerturbationSeries({
      ...common,
      shapeProfileId: VOLUME_PRESERVING_TAPERED_BELLY_PROFILE,
    }),
  };
  const schedule = roleSchedule(seriesByProfile[TUBE_PROFILE].effectiveConstructionIds);
  const artifacts = new Map();
  const conditions = [];

  phase = 'solve-profile-conditions';
  for (const level of LEVELS) {
    const condition = { id: level.id, crowdingFraction: level.crowdingFraction, profiles: {} };
    for (const profile of PROFILE_ORDER) {
      const series = seriesByProfile[profile];
      const sourceCondition = series.conditions.find(candidate => candidate.id === level.id);
      const source = sourceCondition.source;
      const requestedSolverConfig = {
        maxIterations: args.maxIterations,
        clusterUpdate: 'capsule-axis-occupancy-allocation',
        clusterObstacleId: source.obstacles[0].id,
        clusterOccupancyReferenceDirection: [1, 0, 0],
        clusterAllocationSchedule: schedule,
        clusterOccupancyEnvelope: args.occupancyEnvelope,
      };
      const result = solveMuscleCompartmentPacking(source, requestedSolverConfig);
      const root = `conditions/${level.id}/${profile}`;
      const sourceBytes = jsonBytes(source);
      const resultBytes = jsonBytes(result);
      const viewerBytes = Buffer.from(renderMuscleCompartmentPackingHtml({
        source,
        result,
        report: { route: routeReceipt() },
        presentation: presentation(level.id, profile, result),
      }));
      const outputs = {
        source: outputEntry(`${root}/source.json`, sourceBytes),
        result: outputEntry(`${root}/result.json`, resultBytes),
        viewer: outputEntry(`${root}/index.html`, viewerBytes),
      };
      artifacts.set(outputs.source.path, sourceBytes);
      artifacts.set(outputs.result.path, resultBytes);
      artifacts.set(outputs.viewer.path, viewerBytes);
      condition.profiles[profile] = {
        source: {
          shapeProfile: series.shapeProfile || null,
          input: source.input,
          parentAtlasFileSha256,
          effectiveConstructionIds: source.muscles.map(muscle => muscle.identity.constructionId),
          environment: {
            compartment: source.compartment,
            obstacles: source.obstacles,
          },
        },
        requestedSolverConfig,
        result: resultReceipt(source, result),
        visibility: visibility(args.requestedConstructionIds, source, result),
        outputs,
      };
    }
    conditions.push(condition);
  }

  phase = 'prepare-artifacts';
  const portfolioBytes = Buffer.from(renderPortfolio(conditions, args.occupancyEnvelope));
  artifacts.set('index.html', portfolioBytes);
  const assayResult = {
    schema: ASSAY_RESULT_SCHEMA,
    evidenceTrack: 'agent-authored-provisional',
    claimCeiling: 'profile-local-qualitative-mechanical-response',
    parentAtlas: {
      requestedPath: args.requestedParentAtlasPath,
      effectivePath: receiptPath(effectiveParentAtlasPath),
      id: parentAtlasId,
      fileSha256: parentAtlasFileSha256,
    },
    requestedConstructionIds: args.requestedConstructionIds,
    effectiveConstructionIds: seriesByProfile[TUBE_PROFILE].effectiveConstructionIds,
    profileOrder: PROFILE_ORDER,
    requestedOccupancyEnvelope: args.occupancyEnvelope,
    levels: LEVELS,
    conditions,
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
    effectiveConstructionIds: assayResult.effectiveConstructionIds,
    profileOrder: PROFILE_ORDER,
    requestedMaxIterations: args.maxIterations,
    requestedOccupancyEnvelope: args.occupancyEnvelope,
    requestedAllocationSchedule: schedule,
    conditions,
    outputs: { assayResult: outputEntry('assay-result.json', assayResultBytes) },
    visual: {
      route: routeReceipt(),
      status: 'pending-agent-inspection',
      portfolio: outputEntry('index.html', portfolioBytes),
      conditionViewers: conditions.flatMap(condition => PROFILE_ORDER.map(
        profile => condition.profiles[profile].outputs.viewer,
      )),
    },
    lastTrustworthyEvidence: {
      phase: 'primary-artifacts-written',
      profiles: PROFILE_ORDER,
      resultStatuses: conditions.flatMap(condition => PROFILE_ORDER.map(profile => ({
        condition: condition.id,
        profile,
        status: condition.profiles[profile].result.status,
      }))),
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
    outputPaths = outputPaths.length > 0 ? outputPaths : expectedVisualPaths(outputDirectory);
    await clearPaths(outputPaths);
    await writeAtomic(reportPath, jsonBytes({
      schema: RUN_REPORT_SCHEMA,
      status: 'failed',
      failurePhase: phase,
      error: message,
      rawArguments,
      requestedParentAtlasPath: args?.requestedParentAtlasPath || null,
      effectiveParentAtlasPath: effectiveParentAtlasPath ? receiptPath(effectiveParentAtlasPath) : null,
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
