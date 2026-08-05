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

const RUN_REPORT_SCHEMA = 'kaminos.current-k4-fixed-contact-assay-run-report.v0';
const ASSAY_RESULT_SCHEMA = 'kaminos.current-k4-fixed-contact-assay-result.v0';
const VISUAL_ROUTE = 'current-k4-fixed-contact-orbitable-v0';
const LEVELS = Object.freeze([
  { id: 'baseline', crowdingFraction: 0 },
  { id: 'mild', crowdingFraction: 0.12 },
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

function outputEntry(relativePath, bytes) {
  return { path: relativePath, sha256: sha256(bytes) };
}

function roleSchedule(ids) {
  return ids.map(muscleId => ({ muscleId, ...ROLE_TABLE[muscleId] }));
}

function ownedPaths(outputDirectory) {
  return [
    'assay-result.json',
    'source.json',
    'strict-preflight-result.json',
    'contact-admitted-source.json',
    'contact-admitted-result.json',
    'index.html',
    'baseline-source.png',
    'baseline-contact-admitted-result.png',
    'baseline-source-capture-report.json',
    'baseline-contact-admitted-result-capture-report.json',
    'visual-inspection.json',
    'interpretation.md',
  ].map(relative => path.join(outputDirectory, relative));
}

async function clearPaths(targets) {
  for (const target of targets) {
    await unlink(target).catch(error => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}

function endpoint(source, muscleId, attachment) {
  const muscle = source.muscles.find(candidate => candidate.id === muscleId);
  if (!muscle) throw new Error(`fixed contact fixture requires ${muscleId}`);
  return {
    muscleId,
    attachment,
    attachmentId: muscle.attachments[attachment].id,
  };
}

function exactContacts(source) {
  return [
    {
      id: 'current-k4-m34-m45-shared-insertion-contact',
      authority: 'agent-authored-provisional',
      left: endpoint(source, 'muscle-34', 'insertion'),
      right: endpoint(source, 'muscle-45', 'insertion'),
      scope: { kind: 'exact-fixed-endpoint', maximumPathFraction: 0 },
    },
    {
      id: 'current-k4-m12-m45-shared-insertion-contact',
      authority: 'agent-authored-provisional',
      left: endpoint(source, 'muscle-12', 'insertion'),
      right: endpoint(source, 'muscle-45', 'insertion'),
      scope: { kind: 'exact-fixed-endpoint', maximumPathFraction: 0 },
    },
  ];
}

function resultSummary(result) {
  return {
    status: result.status,
    iterations: result.iterations,
    failure: result.failure || null,
    metrics: result.metrics,
    clusterProjection: result.clusterProjection,
    fixedAttachmentContact: result.fixedAttachmentContact || null,
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
  outputPaths = ownedPaths(args.outputDirectory);
  await clearPaths(outputPaths);

  phase = 'read-parent-atlas';
  effectiveParentAtlasPath = await realpath(path.resolve(args.requestedParentAtlasPath));
  const parentAtlasBytes = await readFile(effectiveParentAtlasPath);
  parentAtlasFileSha256 = sha256(parentAtlasBytes);
  const parentAtlas = JSON.parse(parentAtlasBytes);
  parentAtlasId = parentAtlas.id || null;

  phase = 'compile-strict-belly-source';
  const common = {
    parentAtlas,
    parentAtlasFileSha256,
    requestedConstructionIds: args.requestedConstructionIds,
    levels: LEVELS,
    shapeProfileId: VOLUME_PRESERVING_TAPERED_BELLY_PROFILE,
  };
  const strictSeries = createSourceShapedPackingPerturbationSeries(common);
  const source = strictSeries.conditions.find(condition => condition.id === 'baseline').source;
  const schedule = roleSchedule(strictSeries.effectiveConstructionIds);
  const requestedSolverConfig = {
    maxIterations: args.maxIterations,
    clusterUpdate: 'capsule-axis-occupancy-allocation',
    clusterObstacleId: source.obstacles[0].id,
    clusterOccupancyReferenceDirection: [1, 0, 0],
    clusterAllocationSchedule: schedule,
    clusterOccupancyEnvelope: args.occupancyEnvelope,
  };

  phase = 'strict-preflight';
  const strictResult = solveMuscleCompartmentPacking(source, requestedSolverConfig);
  const strictBlockers = strictResult.failure?.blockingMechanisms || [];
  if (
    strictResult.status !== 'immutable-constraint-conflict' ||
    strictBlockers.length !== 2
  ) {
    throw new Error('current-K4 fixed-contact assay requires the exact two-blocker belly refusal');
  }

  phase = 'compile-contact-admitted-source';
  const contacts = exactContacts(source);
  const admittedSeries = createSourceShapedPackingPerturbationSeries({
    ...common,
    fixedAttachmentContacts: contacts,
  });
  const admittedSource = admittedSeries.conditions.find(condition => condition.id === 'baseline').source;

  phase = 'solve-contact-admitted-source';
  const admittedResult = solveMuscleCompartmentPacking(admittedSource, {
    ...requestedSolverConfig,
    clusterObstacleId: admittedSource.obstacles[0].id,
  });
  if (admittedResult.status === 'immutable-constraint-conflict' || admittedResult.iterations === 0) {
    throw new Error('exact fixed-contact admission did not open occupancy negotiation');
  }

  phase = 'prepare-artifacts';
  const presentation = {
    title: 'Current-K4 baseline · exact fixed-contact boundary',
    authorityLabel: 'Agent-authored provisional contact assay · no anatomical admission',
    explanation:
      'The exact Bytebound tapered-belly source strictly refuses on two insertion contacts. ' +
      'This assay admits only those two exact source-linked endpoint pairs for preflight, keeps ' +
      'their penetration in the full residual, and exercises the unchanged occupancy mechanism.',
    beforeLabel: 'Tapered-belly source · strict refusal has 2 fixed-contact blockers',
    packedLabel: 'Contact admitted · occupancy attempted · residual remains',
    solveStatus: admittedResult.status,
    hint: 'Drag to orbit · wheel to zoom · this is a terminal-residual mechanism assay, not packed anatomy',
  };
  const viewerBytes = Buffer.from(renderMuscleCompartmentPackingHtml({
    source: admittedSource,
    result: admittedResult,
    report: { route: routeReceipt() },
    presentation,
  }));
  const sourceBytes = jsonBytes(source);
  const strictResultBytes = jsonBytes(strictResult);
  const admittedSourceBytes = jsonBytes(admittedSource);
  const admittedResultBytes = jsonBytes(admittedResult);
  const assayResult = {
    schema: ASSAY_RESULT_SCHEMA,
    evidenceTrack: 'agent-authored-provisional',
    claimCeiling: 'exact-fixed-contact-mechanism-response',
    parentAtlas: {
      requestedPath: args.requestedParentAtlasPath,
      effectivePath: receiptPath(effectiveParentAtlasPath),
      id: parentAtlasId,
      fileSha256: parentAtlasFileSha256,
    },
    requestedConstructionIds: args.requestedConstructionIds,
    effectiveConstructionIds: strictSeries.effectiveConstructionIds,
    shapeProfile: strictSeries.shapeProfile,
    requestedSolverConfig,
    strictPreflight: {
      status: strictResult.status,
      iterations: strictResult.iterations,
      blockerCount: strictBlockers.length,
      blockingMechanisms: strictBlockers,
      metrics: strictResult.metrics,
    },
    contactAdmission: {
      requested: contacts,
      effective: admittedSource.fixedAttachmentContacts,
      fallbackUsed: false,
    },
    contactAdmittedResult: resultSummary(admittedResult),
  };
  const assayResultBytes = jsonBytes(assayResult);
  const artifacts = {
    assayResult: ['assay-result.json', assayResultBytes],
    source: ['source.json', sourceBytes],
    strictPreflightResult: ['strict-preflight-result.json', strictResultBytes],
    contactAdmittedSource: ['contact-admitted-source.json', admittedSourceBytes],
    contactAdmittedResult: ['contact-admitted-result.json', admittedResultBytes],
    viewer: ['index.html', viewerBytes],
  };

  phase = 'write-primary-artifacts';
  for (const [, [relative, bytes]] of Object.entries(artifacts)) {
    await writeAtomic(path.join(args.outputDirectory, relative), bytes);
  }
  const outputs = Object.fromEntries(
    Object.entries(artifacts).map(([key, [relative, bytes]]) => [key, outputEntry(relative, bytes)]),
  );

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
    effectiveConstructionIds: strictSeries.effectiveConstructionIds,
    shapeProfile: strictSeries.shapeProfile,
    requestedMaxIterations: args.maxIterations,
    requestedOccupancyEnvelope: args.occupancyEnvelope,
    requestedAllocationSchedule: schedule,
    strictPreflight: assayResult.strictPreflight,
    contactAdmission: assayResult.contactAdmission,
    contactAdmittedResult: assayResult.contactAdmittedResult,
    outputs,
    visual: {
      route: routeReceipt(),
      status: 'pending-agent-inspection',
      viewer: outputs.viewer,
      expectedCaptures: [
        'baseline-source.png',
        'baseline-contact-admitted-result.png',
      ],
    },
    lastTrustworthyEvidence: {
      phase: 'primary-artifacts-written',
      strictStatus: strictResult.status,
      admittedStatus: admittedResult.status,
      admittedIterations: admittedResult.iterations,
    },
  };
  await writeAtomic(reportPath, jsonBytes(report));
  process.stdout.write(`${JSON.stringify({
    status: report.status,
    reportPath,
    strictStatus: strictResult.status,
    admittedStatus: admittedResult.status,
    route: report.visual.route,
  })}\n`);
} catch (error) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const outputDirectory = args?.outputDirectory || preScannedOutputDirectory;
  if (outputDirectory) {
    await mkdir(outputDirectory, { recursive: true });
    reportPath ||= path.join(outputDirectory, 'run-report.json');
    outputPaths = outputPaths.length > 0 ? outputPaths : ownedPaths(outputDirectory);
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
