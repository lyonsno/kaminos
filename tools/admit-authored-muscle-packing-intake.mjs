#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';

import {
  AUTHORED_MUSCLE_PACKING_INTAKE_RECEIPT_SCHEMA,
  admitAuthoredMusclePackingIntake,
} from '../authored-muscle-packing-intake-core.mjs';
import {
  MUSCLE_COMPARTMENT_PACKING_WITNESS_ROUTE,
  writeMuscleCompartmentPackingWitness,
} from '../muscle-compartment-packing-witness.mjs';

const WITNESS_ARTIFACT_PATHS = Object.freeze([
  'source.json',
  'packed.json',
  'index.html',
  'report.json',
]);

function usage() {
  return [
    'Usage:',
    '  node tools/admit-authored-muscle-packing-intake.mjs \\',
    '    --routing-fixture <fixture.json> \\',
    '    [--coordinate-carrier <carrier.json>] \\',
    '    [--witness-out <directory>] \\',
    '    --receipt <receipt.json>',
  ].join('\n');
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--help' || flag === '-h') return { help: true };
    if (![
      '--routing-fixture',
      '--coordinate-carrier',
      '--witness-out',
      '--receipt',
    ].includes(flag)) {
      throw new Error(`unknown argument: ${flag}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${flag} requires a path`);
    args[flag.slice(2)] = value;
    index += 1;
  }
  if (!args['routing-fixture']) throw new Error('--routing-fixture is required');
  if (!args.receipt) throw new Error('--receipt is required');
  return args;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  if (typeof value === 'number' && Object.is(value, -0)) return 0;
  return value;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function withReceiptIdentity(value) {
  const { receiptSha256: ignored, ...core } = value;
  return canonical({ receiptSha256: sha256(JSON.stringify(canonical(core))), ...core });
}

async function writeReceipt(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${process.pid}`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporaryPath, path);
}

async function effectiveDestination(path) {
  let existingAncestor = resolve(path);
  const missingSuffix = [];
  while (true) {
    try {
      return resolve(await realpath(existingAncestor), ...missingSuffix.reverse());
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      const parent = dirname(existingAncestor);
      if (parent === existingAncestor) return resolve(path);
      missingSuffix.push(basename(existingAncestor));
      existingAncestor = parent;
    }
  }
}

async function safeFailureSidecar(requestedPath, protectedPaths) {
  let suffix = 0;
  while (true) {
    const candidate = suffix === 0
      ? `${requestedPath}.authored-muscle-packing-intake-failure.json`
      : `${requestedPath}.authored-muscle-packing-intake-failure.${suffix}.json`;
    if (!protectedPaths.has(await effectiveDestination(candidate))) return candidate;
    suffix += 1;
  }
}

function isAtOrInside(path, root) {
  const relation = relative(root, path);
  return relation === '' || (!relation.startsWith('..') && !isAbsolute(relation));
}

async function clearRefusedWitnessArtifacts(outputRoot) {
  const results = await Promise.allSettled(WITNESS_ARTIFACT_PATHS.map(async path => {
    try {
      await unlink(resolve(outputRoot, path));
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }));
  const failures = results.flatMap((result, index) => result.status === 'rejected'
    ? [{ path: WITNESS_ARTIFACT_PATHS[index], reason: result.reason?.message || String(result.reason) }]
    : []);
  const cleanup = failures.length === 0
    ? { status: 'cleared', paths: [...WITNESS_ARTIFACT_PATHS] }
    : { status: 'failed', paths: [...WITNESS_ARTIFACT_PATHS], failures };
  if (failures.length > 0) {
    const error = new Error('refused intake could not clear the requested witness artifacts');
    error.staleWitnessArtifactCleanup = cleanup;
    throw error;
  }
  return cleanup;
}

function identity(kind, id, bytes) {
  const row = { kind, id, sha256: sha256(bytes) };
  return { requested: { ...row }, effective: { ...row } };
}

let args;
try {
  args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    process.exit(0);
  }
} catch (error) {
  console.error(`${error.message}\n${usage()}`);
  process.exit(1);
}

const requested = {
  routingFixture: args['routing-fixture'],
  coordinateCarrier: args['coordinate-carrier'] || null,
  witnessOut: args['witness-out'] || null,
  receipt: args.receipt,
};
const effective = {
  routingFixture: args['routing-fixture'],
  coordinateCarrier: args['coordinate-carrier'] || null,
  witnessOut: args['witness-out'] || null,
  receipt: args.receipt,
};
let phase = 'read-routing-fixture';
let lastTrustworthyEvidence = 'invocation-arguments-validated';
let routingBytes;
let coordinateBytes;

try {
  phase = 'output-path-validation';
  const inputPaths = [effective.routingFixture, effective.coordinateCarrier].filter(Boolean);
  const resolvedInputs = await Promise.all(inputPaths.map(async path => {
    try {
      return await realpath(path);
    } catch (error) {
      if (error?.code === 'ENOENT') return resolve(path);
      throw error;
    }
  }));
  const protectedInputs = new Set([
    ...inputPaths.map(path => resolve(path)),
    ...resolvedInputs,
  ]);
  if (protectedInputs.has(await effectiveDestination(effective.receipt))) {
    effective.receipt = await safeFailureSidecar(requested.receipt, protectedInputs);
    throw new Error(`receipt path must not alias an input; redirected receipt to ${effective.receipt}`);
  }
  if (effective.witnessOut) {
    const witnessRoots = [...new Set([
      resolve(effective.witnessOut),
      await effectiveDestination(effective.witnessOut),
    ])];
    const protectedOutputs = [...new Set([
      resolve(effective.receipt),
      await effectiveDestination(effective.receipt),
      ...inputPaths.map(path => resolve(path)),
      ...resolvedInputs,
    ])];
    const witnessArtifactDestinations = new Set();
    for (const root of witnessRoots) {
      for (const artifact of WITNESS_ARTIFACT_PATHS) {
        const path = resolve(root, artifact);
        witnessArtifactDestinations.add(path);
        witnessArtifactDestinations.add(await effectiveDestination(path));
      }
    }
    if (
      protectedOutputs.some(path => witnessRoots.some(root => isAtOrInside(path, root))) ||
      protectedOutputs.some(path => witnessArtifactDestinations.has(path))
    ) {
      throw new Error('witness output directory must not contain an authenticated input or receipt');
    }
    effective.witnessOut = witnessRoots.at(-1);
  }

  phase = 'read-routing-fixture';
  routingBytes = await readFile(effective.routingFixture);
  lastTrustworthyEvidence = 'routing-fixture-bytes-read';
  phase = 'parse-routing-fixture';
  const routingFixture = JSON.parse(routingBytes.toString('utf8'));

  let coordinateCarrier = null;
  if (effective.coordinateCarrier) {
    phase = 'read-coordinate-carrier';
    coordinateBytes = await readFile(effective.coordinateCarrier);
    lastTrustworthyEvidence = 'coordinate-carrier-bytes-read';
    phase = 'parse-coordinate-carrier';
    coordinateCarrier = JSON.parse(coordinateBytes.toString('utf8'));
  }

  phase = 'admit-coordinate-carrier';
  const input = {
    routingFixture: identity(
      'track-m-routing-fixture',
      routingFixture.selection?.id || 'missing-selection-id',
      routingBytes,
    ),
    coordinateCarrier: coordinateCarrier
      ? identity('authored-coordinate-carrier', coordinateCarrier.id || 'missing-carrier-id', coordinateBytes)
      : null,
  };
  const admitted = admitAuthoredMusclePackingIntake({
    routingFixture,
    coordinateCarrier,
    input,
  });
  let witness = null;
  if (effective.witnessOut && !admitted.admitted) {
    phase = 'clear-refused-witness';
    const staleWitnessArtifactCleanup = await clearRefusedWitnessArtifacts(effective.witnessOut);
    effective.witnessOut = null;
    phase = 'pipeline-refused';
    lastTrustworthyEvidence = 'intake refusal constructed; witness not run';
    witness = {
      requested: requested.witnessOut,
      effective: null,
      route: {
        requested: MUSCLE_COMPARTMENT_PACKING_WITNESS_ROUTE,
        effective: null,
      },
      status: 'not-run-intake-refused',
      staleWitnessArtifactCleanup,
    };
  } else if (effective.witnessOut) {
    phase = 'write-packing-witness';
    lastTrustworthyEvidence = 'coordinate carrier admitted and packing source constructed';
    try {
      const written = await writeMuscleCompartmentPackingWitness({
        outDir: effective.witnessOut,
        source: admitted.packingSource,
      });
      const witnessReportPath = resolve(written.outputRoot, 'report.json');
      const witnessReportBytes = await readFile(witnessReportPath);
      effective.witnessOut = written.outputRoot;
      witness = {
        requested: requested.witnessOut,
        effective: written.outputRoot,
        route: {
          requested: MUSCLE_COMPARTMENT_PACKING_WITNESS_ROUTE,
          effective: written.report.route.effective,
        },
        status: written.report.status,
        report: witnessReportPath,
        reportFileSha256: sha256(witnessReportBytes),
      };
      phase = 'pipeline-complete';
      lastTrustworthyEvidence = 'intake receipt and witness report constructed';
    } catch (error) {
      effective.witnessOut = resolve(effective.witnessOut);
      witness = {
        requested: requested.witnessOut,
        effective: resolve(effective.witnessOut),
        route: {
          requested: MUSCLE_COMPARTMENT_PACKING_WITNESS_ROUTE,
          effective: null,
        },
        status: 'failed',
        failureReport: error.failureReportPath || null,
        reason: error.message,
      };
      phase = 'pipeline-failed';
      lastTrustworthyEvidence = 'coordinate carrier admitted; witness returned durable failure';
    }
  }
  const terminal = withReceiptIdentity({
    ...admitted,
    execution: {
      phase: witness ? phase : 'admission-complete',
      lastTrustworthyEvidence: witness
        ? lastTrustworthyEvidence
        : 'admission-receipt-constructed',
      requested,
      effective: {
        ...effective,
        routingFixtureFileSha256: sha256(routingBytes),
        coordinateCarrierFileSha256: coordinateBytes ? sha256(coordinateBytes) : null,
      },
      ...(witness ? { witness } : {}),
    },
  });
  await writeReceipt(effective.receipt, terminal);
  console.log(JSON.stringify({
    status: terminal.status,
    admitted: terminal.admitted,
    receipt: effective.receipt,
    receiptSha256: terminal.receiptSha256,
  }));
  process.exitCode = terminal.admitted
    ? witness?.status === 'failed' ? 1 : 0
    : terminal.status === 'identity-coherent_geometry-unavailable' ? 2 : 3;
} catch (error) {
  const terminal = withReceiptIdentity({
    schema: AUTHORED_MUSCLE_PACKING_INTAKE_RECEIPT_SCHEMA,
    status: 'input-read-failed',
    admitted: false,
    reason: error.message,
    input: null,
    source: null,
    acceptedFields: [],
    missingFields: [],
    conflictingFields: [],
    packingSource: null,
    execution: {
      phase,
      lastTrustworthyEvidence,
      requested,
      effective: {
        ...effective,
        routingFixtureFileSha256: routingBytes ? sha256(routingBytes) : null,
        coordinateCarrierFileSha256: coordinateBytes ? sha256(coordinateBytes) : null,
      },
      ...(error.staleWitnessArtifactCleanup
        ? { staleWitnessArtifactCleanup: error.staleWitnessArtifactCleanup }
        : {}),
    },
  });
  try {
    await writeReceipt(effective.receipt, terminal);
  } catch (writeError) {
    console.error(JSON.stringify({
      status: 'receipt-write-failed',
      reason: writeError.message,
      priorFailure: error.message,
      phase,
      lastTrustworthyEvidence,
      requested,
      effective,
    }));
    process.exit(1);
  }
  console.error(JSON.stringify({
    status: terminal.status,
    reason: terminal.reason,
    receipt: effective.receipt,
    receiptSha256: terminal.receiptSha256,
  }));
  process.exitCode = 1;
}
