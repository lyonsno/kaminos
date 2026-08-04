#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import {
  runSourceShapedPackingPerturbationSeries,
} from '../muscle-compartment-packing-core.mjs';

const RUN_REPORT_SCHEMA = 'kaminos.source-shaped-muscle-packing-assay-run-report.v0';
const LEVELS = Object.freeze([
  { id: 'baseline', crowdingFraction: 0 },
  { id: 'mild', crowdingFraction: 0.12 },
  { id: 'moderate', crowdingFraction: 0.24 },
]);

function parseArguments(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!['--parent-atlas', '--routes', '--output'].includes(argument)) {
      throw new Error(`unsupported argument ${argument}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value`);
    parsed[argument.slice(2)] = value;
    index += 1;
  }
  for (const key of ['parent-atlas', 'routes', 'output']) {
    if (!parsed[key]) throw new Error(`--${key} is required`);
  }
  const requestedConstructionIds = parsed.routes.split(',').map(value => value.trim()).filter(Boolean);
  if (requestedConstructionIds.length === 0) throw new Error('--routes must name construction ids');
  return {
    requestedParentAtlasPath: parsed['parent-atlas'],
    requestedConstructionIds,
    outputDirectory: path.resolve(parsed.output),
  };
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function writeJson(target, value) {
  const bytes = `${JSON.stringify(value, null, 2)}\n`;
  const temporary = `${target}.tmp-${process.pid}`;
  await writeFile(temporary, bytes, 'utf8');
  await rename(temporary, target);
  return Buffer.from(bytes);
}

async function effectiveDestination(target) {
  const absolutePath = path.resolve(target);
  try {
    return await realpath(absolutePath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    const effectiveParent = await realpath(path.dirname(absolutePath));
    return path.resolve(effectiveParent, path.basename(absolutePath));
  }
}

function compactCondition(condition) {
  return {
    id: condition.id,
    crowdingFraction: condition.crowdingFraction,
    sourceInput: condition.source.input,
    perturbation: condition.source.assayProvenance.perturbation,
    assumptions: condition.source.assayProvenance.assumptions,
    status: condition.result.status,
    iterations: condition.result.iterations,
    initial: condition.result.metrics.initial,
    packed: condition.result.metrics.packed,
    response: condition.response,
  };
}

let phase = 'parse-arguments';
let args;
let effectiveParentAtlasPath = '';
let parentAtlasFileSha256 = '';
let parentAtlasId = '';
let parentAtlasSha256 = '';
let primaryPath = '';
let reportPath = '';
let primaryPathIsSafe = false;
let reportPathIsSafe = false;

try {
  args = parseArguments(process.argv.slice(2));
  phase = 'resolve-destinations';
  const requestedParentAtlasPath = path.resolve(args.requestedParentAtlasPath);
  effectiveParentAtlasPath = await realpath(requestedParentAtlasPath);
  await mkdir(args.outputDirectory, { recursive: true });
  const effectiveOutputDirectory = await realpath(args.outputDirectory);
  primaryPath = path.join(args.outputDirectory, 'perturbation-result.json');
  reportPath = path.join(args.outputDirectory, 'run-report.json');
  const effectivePrimaryPath = await effectiveDestination(
    path.join(effectiveOutputDirectory, 'perturbation-result.json'),
  );
  const effectiveReportPath = await effectiveDestination(
    path.join(effectiveOutputDirectory, 'run-report.json'),
  );
  const protectedParentPaths = new Set([requestedParentAtlasPath, effectiveParentAtlasPath]);
  if (protectedParentPaths.has(effectiveReportPath)) {
    reportPath = path.join(
      args.outputDirectory,
      'run-report.json.source-shaped-packing-assay-failure.json',
    );
    reportPathIsSafe = true;
    throw new Error('report path must not alias the parent atlas');
  }
  reportPathIsSafe = true;
  if (protectedParentPaths.has(effectivePrimaryPath)) {
    throw new Error('primary output path must not alias the parent atlas');
  }
  primaryPathIsSafe = true;
  await unlink(primaryPath).catch(error => {
    if (error.code !== 'ENOENT') throw error;
  });

  phase = 'read-parent-atlas';
  const parentAtlasBytes = await readFile(effectiveParentAtlasPath);
  parentAtlasFileSha256 = sha256(parentAtlasBytes);
  const parentAtlas = JSON.parse(parentAtlasBytes);
  parentAtlasId = parentAtlas.id || '';
  parentAtlasSha256 = parentAtlas.atlasSha256 || '';

  phase = 'build-and-solve';
  const result = runSourceShapedPackingPerturbationSeries({
    parentAtlas,
    parentAtlasFileSha256,
    requestedConstructionIds: args.requestedConstructionIds,
    levels: LEVELS,
  });

  phase = 'write-primary';
  const primaryBytes = await writeJson(primaryPath, result);
  const outputSha256 = sha256(primaryBytes);

  phase = 'write-report';
  const report = {
    schema: RUN_REPORT_SCHEMA,
    status: 'completed',
    failurePhase: null,
    requestedParentAtlasPath: args.requestedParentAtlasPath,
    effectiveParentAtlasPath,
    parentAtlasId,
    parentAtlasSha256,
    parentAtlasFileSha256,
    requestedConstructionIds: args.requestedConstructionIds,
    effectiveConstructionIds: result.effectiveConstructionIds,
    evidenceTrack: result.evidenceTrack,
    claimCeiling: result.claimCeiling,
    mechanism: result.mechanism,
    interpretationChecks: result.interpretationChecks,
    conditions: result.conditions.map(compactCondition),
    primaryOutput: 'perturbation-result.json',
    outputSha256,
    lastTrustworthyEvidence: {
      phase: 'primary-output-written',
      parentAtlasFileSha256,
      effectiveConstructionIds: result.effectiveConstructionIds,
    },
  };
  await writeJson(reportPath, report);
  process.stdout.write(`${JSON.stringify({
    status: report.status,
    reportPath,
    primaryPath,
    outputSha256,
    interpretationChecks: result.interpretationChecks,
  })}\n`);
} catch (error) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  if (args?.outputDirectory) {
    await mkdir(args.outputDirectory, { recursive: true });
    primaryPath ||= path.join(args.outputDirectory, 'perturbation-result.json');
    reportPath ||= path.join(args.outputDirectory, 'run-report.json');
    if (primaryPathIsSafe) {
      await unlink(primaryPath).catch(unlinkError => {
        if (unlinkError.code !== 'ENOENT') throw unlinkError;
      });
    }
    if (reportPathIsSafe) await writeJson(reportPath, {
      schema: RUN_REPORT_SCHEMA,
      status: 'failed',
      failurePhase: phase,
      error: message,
      requestedParentAtlasPath: args.requestedParentAtlasPath,
      effectiveParentAtlasPath: effectiveParentAtlasPath || null,
      requestedConstructionIds: args.requestedConstructionIds,
      effectiveConstructionIds: [],
      primaryOutput: null,
      outputSha256: null,
      lastTrustworthyEvidence: {
        phase: parentAtlasFileSha256 ? 'parent-atlas-read-and-hashed' : 'arguments-resolved',
        parentAtlasId: parentAtlasId || null,
        parentAtlasSha256: parentAtlasSha256 || null,
        parentAtlasFileSha256: parentAtlasFileSha256 || null,
        requestedConstructionIds: args.requestedConstructionIds,
      },
    });
  }
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
