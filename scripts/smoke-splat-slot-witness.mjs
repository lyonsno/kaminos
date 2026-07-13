#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  SMOKE_SPLAT_PRODUCER_AUTHORITY,
  createSmokeSplatSlotCache,
  decodeReferenceSmokeHierarchy,
  makeSmokeSplatPhaseInstances,
} from '../smoke-splat-slot-cache.mjs';

const ROUTE_IDENTITY = 'pure-module-reference-smoke-slot-witness-v0';
const EVIDENCE_SCOPE = 'scheduling-cache-hierarchy-accounting-no-gpu-render';

function parseArgs(argv) {
  const options = { outputPath: null, capacity: null, omittedHistorySlot: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--out') options.outputPath = resolve(argv[++index] ?? '');
    else if (argument === '--capacity') options.capacity = Number(argv[++index]);
    else if (argument === '--omit-slot') options.omittedHistorySlot = Number(argv[++index]);
    else throw new Error(`unknown argument ${argument}`);
  }
  if (!options.outputPath) throw new Error('--out is required');
  if (options.capacity !== null && (!Number.isFinite(options.capacity) || options.capacity < 0)) {
    throw new Error('--capacity must be a non-negative number');
  }
  if (options.omittedHistorySlot !== null && !Number.isFinite(options.omittedHistorySlot)) {
    throw new Error('--omit-slot must be finite');
  }
  return options;
}

function makePhaseDescriptors(instanceCount = 100) {
  const phaseSources = [
    { phaseHistorySlot: 1, phaseHistoryOffsetSlots: 3 },
    { phaseHistorySlot: 2, phaseHistoryOffsetSlots: 2 },
    { phaseHistorySlot: 3, phaseHistoryOffsetSlots: 1 },
    { phaseHistorySlot: 0, phaseHistoryOffsetSlots: 0 },
  ];
  return Array.from({ length: instanceCount }, (_, index) => {
    const { phaseHistorySlot, phaseHistoryOffsetSlots } = phaseSources[index % phaseSources.length];
    return {
      identity: 'boundary-splat-instance-descriptor-v0',
      index,
      phaseHistorySlot,
      phaseHistoryOffsetSlots,
      historyDepth: 4,
      phaseHistoryOffsetFrames: phaseHistoryOffsetSlots * 2,
      transform: {
        translate: [index % 10, 0, Math.floor(index / 10)],
        scale: 1,
      },
      phaseSourceAuthority: phaseHistoryOffsetSlots > 0
        ? 'live-gpu-candidate-history-ring'
        : 'current-live-candidate-buffer',
    };
  });
}

function makePayload(historySlot, slotWriteTick) {
  const drift = historySlot * 0.07;
  return {
    identity: `synthetic-smoke-payload:${historySlot}:${slotWriteTick}`,
    cells: [
      { position: [0 + drift, 0, 0], density: 0.42, temperature: 0.75, velocity: [0.05, 1.1, 0] },
      { position: [0.25 + drift, 0.6, 0], density: 0.16, temperature: 0.45, velocity: [0.12, 0.9, 0.03] },
      { position: [0.55 + drift, 1.1, 0.1], density: 0.012, temperature: 0.2, velocity: [0.18, 0.7, 0.06] },
      { position: [1.2 + drift, 1.7, 0.15], density: 0.07, temperature: 0.3, velocity: [0.2, 0.55, 0.08] },
    ],
  };
}

function compactResolveReport(report) {
  const {
    instanceBindings,
    slotProducts,
    ...summary
  } = report;
  return {
    ...summary,
    instanceBindingSummary: {
      count: instanceBindings.length,
      uniqueProductCount: new Set(instanceBindings.map(binding => binding.productIdentity)).size,
    },
    slotProducts: slotProducts.map(product => ({
      identity: product.identity,
      schema: product.schema,
      producerAuthority: product.producerAuthority,
      producerKind: product.producerKind,
      slotIdentity: product.slotIdentity,
      payloadIdentity: product.payloadIdentity,
      requiredSplatCount: product.requiredSplatCount,
      hierarchyCounts: product.hierarchyCounts,
      accounting: product.accounting,
      capacity: product.capacity,
      diagnostics: product.diagnostics,
    })),
  };
}

function assertion(name, passed, evidence) {
  return { name, passed: Boolean(passed), evidence };
}

async function writeReport(outputPath, report) {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

let options;
try {
  options = parseArgs(process.argv.slice(2));
  const cache = createSmokeSplatSlotCache({ decodeSlot: decodeReferenceSmokeHierarchy });
  const instances = makeSmokeSplatPhaseInstances({
    instances: makePhaseDescriptors(),
    historyWriteTick: 20,
  });
  const payloadForSlot = (historySlot, slotIdentity) => {
    if (historySlot === options.omittedHistorySlot) return null;
    return makePayload(historySlot, slotIdentity.slotWriteTick);
  };
  const request = {
    instances,
    payloadForSlot,
    simulatorGeneration: 1,
    modelIdentity: 'reference-smoke-model:witness-v0',
    sparseDensityThreshold: 0.02,
    coarseCellSize: 1,
    fineMassFraction: 0.5,
    capacity: options.capacity,
  };

  const firstResolve = cache.resolve(request);
  const warmResolve = cache.resolve(request);
  const reusedInstances = instances.map(instance => instance.phaseHistorySlot === 2
    ? { ...instance, slotWriteTick: instance.slotWriteTick + 4 }
    : instance);
  const slotReuseResolve = cache.resolve({ ...request, instances: reusedInstances });
  const assertions = [
    assertion('decode-count-follows-unique-slots', firstResolve.decodeCount === 4, {
      instanceCount: firstResolve.instanceCount,
      uniqueSlotCount: firstResolve.uniqueSlotCount,
      decodeCount: firstResolve.decodeCount,
    }),
    assertion('warm-cache-does-no-decode-work', warmResolve.decodeCount === 0 && warmResolve.cacheHitCount === 4, {
      decodeCount: warmResolve.decodeCount,
      cacheHitCount: warmResolve.cacheHitCount,
    }),
    assertion('slot-epoch-reuse-decodes-one-product', slotReuseResolve.decodeCount === 1, {
      decodeCount: slotReuseResolve.decodeCount,
      cacheHitCount: slotReuseResolve.cacheHitCount,
    }),
    assertion('extinction-mass-is-conserved', firstResolve.slotProducts.every(product => (
      Math.abs(product.accounting.sourceExtinctionMass - product.accounting.representedExtinctionMass) < 1e-12
      && product.accounting.rejectedExtinctionMass === 0
    )), firstResolve.accounting),
    assertion('producer-authority-is-explicit', firstResolve.effectiveProducerAuthority === SMOKE_SPLAT_PRODUCER_AUTHORITY, {
      requested: firstResolve.requestedProducerAuthority,
      effective: firstResolve.effectiveProducerAuthority,
    }),
    assertion('capacity-pressure-never-truncates', firstResolve.slotProducts.every(product => product.capacity.outputWasTruncated === false), {
      capacity: options.capacity,
      statuses: firstResolve.slotProducts.map(product => product.capacity.status),
    }),
  ];
  const passed = assertions.every(item => item.passed);
  const report = {
    identity: 'kaminos-smoke-splat-slot-witness-report-v0',
    status: passed ? 'passed' : 'failed',
    requestedRoute: ROUTE_IDENTITY,
    effectiveRoute: ROUTE_IDENTITY,
    evidenceScope: EVIDENCE_SCOPE,
    producerAuthority: SMOKE_SPLAT_PRODUCER_AUTHORITY,
    requestedConfig: {
      instanceCount: 100,
      historySlots: [1, 2, 3, 0],
      historyWriteTick: 20,
      capacity: options.capacity,
      omittedHistorySlot: options.omittedHistorySlot,
    },
    firstResolve: compactResolveReport(firstResolve),
    warmResolve: compactResolveReport(warmResolve),
    slotReuseResolve: compactResolveReport(slotReuseResolve),
    assertions,
  };
  await writeReport(options.outputPath, report);
  if (!passed) process.exitCode = 1;
} catch (error) {
  const outputPath = options?.outputPath;
  const failureReport = {
    identity: 'kaminos-smoke-splat-slot-witness-report-v0',
    status: 'failed',
    requestedRoute: ROUTE_IDENTITY,
    effectiveRoute: null,
    evidenceScope: EVIDENCE_SCOPE,
    failurePhase: error?.report?.failurePhase ?? (options ? 'witness-execution' : 'argument-resolution'),
    message: error?.message ?? String(error),
    requestedProducerAuthority: error?.report?.requestedProducerAuthority ?? SMOKE_SPLAT_PRODUCER_AUTHORITY,
    effectiveProducerAuthority: error?.report?.effectiveProducerAuthority ?? null,
    lastTrustworthyEvidence: {
      ...(error?.report?.lastTrustworthyEvidence ?? {}),
      requestedRoute: ROUTE_IDENTITY,
      omittedHistorySlot: options?.omittedHistorySlot ?? null,
    },
  };
  if (outputPath) await writeReport(outputPath, failureReport);
  else process.stderr.write(`${failureReport.message}\n`);
  process.exitCode = 1;
}
