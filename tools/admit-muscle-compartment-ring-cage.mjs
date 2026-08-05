#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import {
  admitMuscleCompartmentRingCageDocument,
} from '../muscle-compartment-ring-cage-intake.mjs';

const RUN_REPORT_SCHEMA = 'kaminos.muscle-compartment-ring-cage-admission-run-report.v0';

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!['--input', '--output', '--expected-document-sha256'].includes(argument)) {
      throw new Error(`unsupported argument ${argument}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value`);
    values[argument.slice(2)] = value;
    index += 1;
  }
  if (!values.input) throw new Error('--input is required');
  if (!values.output) throw new Error('--output is required');
  if (!/^[0-9a-f]{64}$/.test(values['expected-document-sha256'] || '')) {
    throw new Error('--expected-document-sha256 requires a lowercase SHA-256 identity');
  }
  return {
    requestedInputPath: path.resolve(values.input),
    outputDirectory: path.resolve(values.output),
    expectedDocumentSha256: values['expected-document-sha256'],
  };
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function receiptPath(target) {
  const relative = path.relative(process.cwd(), target);
  if (relative === '') return 'repo://.';
  if (!relative.startsWith(`..${path.sep}`) && relative !== '..' &&
      !path.isAbsolute(relative)) {
    return `repo://${relative.split(path.sep).join('/')}`;
  }
  return target;
}

async function effectiveDestination(target) {
  const absolute = path.resolve(target);
  let cursor = absolute;
  const missingSuffix = [];
  while (true) {
    try {
      return path.join(await realpath(cursor), ...missingSuffix);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      const parent = path.dirname(cursor);
      if (parent === cursor) throw error;
      missingSuffix.unshift(path.basename(cursor));
      cursor = parent;
    }
  }
}

async function writeJson(target, value) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  await writeBytes(target, bytes);
  return bytes;
}

async function writeBytes(target, bytes) {
  const temporary = `${target}.tmp-${process.pid}`;
  await writeFile(temporary, bytes);
  await rename(temporary, target);
}

function compactAdmission(admission) {
  if (!admission) return null;
  return {
    ...admission,
    solverCarrier: admission.solverCarrier
      ? {
          schema: admission.solverCarrier.schema,
          sourceDocument: admission.solverCarrier.sourceDocument,
          orderedConstructionIds: admission.solverCarrier.orderedConstructionIds,
          cageCount: admission.solverCarrier.cages.length,
          identity: admission.solverCarrier.identity,
        }
      : null,
  };
}

let phase = 'parse-arguments';
let args;
let inputPath = '';
let inputFileSha256 = '';
let reportPath = '';
let primaryPath = '';
let inputArtifactPath = '';
let admission = null;
let lastTrustworthyEvidence = null;
let outputMutationAllowed = false;
let reportWritten = false;

try {
  args = parseArguments(process.argv.slice(2));
  phase = 'prepare-output';
  await mkdir(args.outputDirectory, { recursive: true });
  const outputDirectory = await realpath(args.outputDirectory);
  reportPath = path.join(outputDirectory, 'run-report.json');
  primaryPath = path.join(outputDirectory, 'solver-carrier.json');
  inputArtifactPath = path.join(outputDirectory, 'input-cage-document.json');

  phase = 'guard-output-alias';
  const requestedInputDestination = await effectiveDestination(args.requestedInputPath);
  const effectiveReportPath = await effectiveDestination(reportPath);
  const effectivePrimaryPath = await effectiveDestination(primaryPath);
  const effectiveInputArtifactPath = await effectiveDestination(inputArtifactPath);
  if ([
    effectiveReportPath,
    effectivePrimaryPath,
    effectiveInputArtifactPath,
  ].includes(requestedInputDestination)) {
    throw new Error('ring cage admission output must not alias the input document');
  }
  outputMutationAllowed = true;

  phase = 'clear-stale-output';
  await unlink(primaryPath).catch(error => {
    if (error?.code !== 'ENOENT') throw error;
  });
  await unlink(inputArtifactPath).catch(error => {
    if (error?.code !== 'ENOENT') throw error;
  });

  phase = 'resolve-input';
  inputPath = await realpath(args.requestedInputPath);
  phase = 'read-input';
  const inputBytes = await readFile(inputPath);
  inputFileSha256 = sha256(inputBytes);
  await writeBytes(inputArtifactPath, inputBytes);
  lastTrustworthyEvidence = {
    phase: 'input-bytes-read',
    inputPath,
    inputFileSha256,
  };

  phase = 'parse-input';
  const document = JSON.parse(inputBytes);
  phase = 'carrier-admission';
  admission = admitMuscleCompartmentRingCageDocument(document, {
    expectedDocumentSha256: args.expectedDocumentSha256,
  });
  lastTrustworthyEvidence = admission.lastTrustworthyEvidence;
  if (admission.status !== 'admitted' || !admission.solverCarrier) {
    throw new Error(
      `ring cage carrier admission refused with ${admission.blockingMechanisms.length} blocker(s)`,
    );
  }

  phase = 'write-primary';
  const primaryBytes = await writeJson(primaryPath, admission.solverCarrier);
  phase = 'write-report';
  const report = {
    schema: RUN_REPORT_SCHEMA,
    status: 'completed',
    failurePhase: null,
    requestedInputPath: args.requestedInputPath,
    effectiveInputPath: inputPath,
    inputFileSha256,
    expectedDocumentSha256: args.expectedDocumentSha256,
    inputArtifact: {
      path: receiptPath(inputArtifactPath),
      sha256: inputFileSha256,
    },
    route: admission.route,
    admission: compactAdmission(admission),
    primaryOutput: {
      path: receiptPath(primaryPath),
      sha256: sha256(primaryBytes),
    },
  };
  await writeJson(reportPath, report);
  reportWritten = true;
  process.stdout.write(`${JSON.stringify({
    status: report.status,
    reportPath,
    primaryPath,
    inputDocumentSha256: admission.input.effectiveSha256,
    solverCarrierSha256: admission.solverCarrier.identity.sha256,
  })}\n`);
} catch (error) {
  if (primaryPath && outputMutationAllowed) {
    await unlink(primaryPath).catch(unlinkError => {
      if (unlinkError?.code !== 'ENOENT') error.unlinkError = unlinkError.message;
    });
  }
  const report = {
    schema: RUN_REPORT_SCHEMA,
    status: 'failed',
    failurePhase: phase,
    requestedInputPath: args?.requestedInputPath ?? null,
    effectiveInputPath: inputPath || null,
    inputFileSha256: inputFileSha256 || null,
    expectedDocumentSha256: args?.expectedDocumentSha256 ?? null,
    inputArtifact: inputFileSha256 && inputArtifactPath
      ? { path: receiptPath(inputArtifactPath), sha256: inputFileSha256 }
      : null,
    route: admission?.route ?? {
      requested: 'generic-ring-cage-contact-containment-intake.v0',
      effective: null,
      fallbackUsed: false,
    },
    admission: compactAdmission(admission),
    lastTrustworthyEvidence,
    error: error.message,
    primaryOutput: null,
  };
  if (reportPath && outputMutationAllowed) {
    await writeJson(reportPath, report);
    reportWritten = true;
  }
  process.stderr.write(`${JSON.stringify({
    status: report.status,
    reportPath: reportWritten ? reportPath : null,
    failurePhase: report.failurePhase,
    blockerKinds: admission?.blockingMechanisms?.map(item => item.kind) ?? [],
    error: report.error,
  })}\n`);
  process.exitCode = 1;
}
