#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import {
  parseGlbTriangleSoup,
  signedEnvelopeDistance,
} from '../k4-envelope-fit-core.mjs';
import {
  applyConstantAreaRingCageSectionAnisotropy,
  applyLongitudinalRingCageSectionVolumeRamp,
  derivePressureAlignedRingCageSectionAnisotropy,
  measureMuscleCompartmentRingCageContactResidualLedger,
  measureMuscleCompartmentRingCageContactState,
  solveMuscleCompartmentRingCageContact,
} from '../muscle-compartment-ring-cage-contact-core.mjs';

const FRAME_RECEIPT_SCHEMA = 'kaminos.k4-envelope-frame-binding-receipt.v0';
const RESULT_SCHEMA = 'kaminos.k4-m45-obstacle-yield-assay-result.v0';
const REPORT_SCHEMA = 'kaminos.k4-m45-obstacle-yield-assay-run-report.v0';
const CUSTODY_MARKER = '.kaminos-k4-m45-obstacle-yield-assay-output';
const CUSTODY_SCHEMA = 'kaminos.k4-m45-obstacle-yield-assay-output-custody.v0';
const CUSTODY_BYTES = Buffer.from(`${CUSTODY_SCHEMA}\n`);
const ARM_DIRECTORY = 'arms';
const OWNED_PATHS = Object.freeze(['yield-assay-result.json', ARM_DIRECTORY]);
const ESCAPE_SECTION = 'muscle-12:section:0008';
const SUBJECT_CONSTRUCTION = 'muscle-12';
const HELD_CONSTRUCTION = 'muscle-34';
const NEIGHBORHOOD_CONTACT_FLOOR = 2;
const SOLVER_BASE = Object.freeze({
  convergenceTolerance: 0.0001,
  curvatureRegularization: 12,
  maximumLocalTurningAngleChange: 0.25,
  maximumRelativeVolumeError: 0.015,
  maximumTotalTurningAngleChange: 1.25,
  relaxationStep: 0.32,
});

function parseArguments(argv) {
  const flags = new Map([
    ['--frame-receipt', 'frameReceipt'],
    ['--envelope', 'envelope'],
    ['--carrier', 'carrier'],
    ['--source', 'source'],
    ['--yield-scales', 'yieldScales'],
    ['--solver-iterations', 'solverIterations'],
    ['--obstacle-construction', 'obstacleConstruction'],
    ['--output', 'output'],
  ]);
  const parsed = { obstacleConstruction: 'muscle-45' };
  for (let index = 0; index < argv.length; index += 1) {
    const key = flags.get(argv[index]);
    if (!key) throw new Error(`unsupported argument ${argv[index]}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${argv[index]} requires a value`);
    parsed[key] = value;
    index += 1;
  }
  for (const key of [
    'frameReceipt', 'envelope', 'carrier', 'source',
    'yieldScales', 'solverIterations', 'output',
  ]) {
    if (!parsed[key]) throw new Error(`--${key} is required`);
  }
  parsed.output = path.resolve(parsed.output);
  parsed.yieldScales = parsed.yieldScales.split(',').map(Number);
  if (parsed.yieldScales.length === 0 ||
      parsed.yieldScales.some(value => !Number.isFinite(value) ||
        !(value > 0 && value < 1)) ||
      new Set(parsed.yieldScales).size !== parsed.yieldScales.length) {
    throw new Error('--yield-scales requires unique fractions in (0, 1)');
  }
  parsed.solverIterations = Number(parsed.solverIterations);
  if (!Number.isInteger(parsed.solverIterations) || parsed.solverIterations <= 0) {
    throw new Error('--solver-iterations must be a positive integer');
  }
  return parsed;
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

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function hasOutputCustody(outputDirectory) {
  try {
    return (await readFile(path.join(outputDirectory, CUSTODY_MARKER)))
      .equals(CUSTODY_BYTES);
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function clearOwnedOutput(outputDirectory) {
  await Promise.all(OWNED_PATHS.map(relative =>
    rm(path.join(outputDirectory, relative), { recursive: true, force: true })));
}

async function claimOutputCustody(outputDirectory) {
  await mkdir(outputDirectory, { recursive: true });
  if (await hasOutputCustody(outputDirectory)) return;
  const occupied = [];
  for (const relative of [...OWNED_PATHS, 'run-report.json']) {
    if (await exists(path.join(outputDirectory, relative))) occupied.push(relative);
  }
  if (occupied.length > 0) {
    throw new Error(`refusing to claim unowned output containing ${occupied.join(', ')}`);
  }
  await writeAtomic(path.join(outputDirectory, CUSTODY_MARKER), CUSTODY_BYTES);
}

function receiptPath(target) {
  const relative = path.relative(process.cwd(), target);
  if (!path.isAbsolute(relative) && relative !== '..' &&
      !relative.startsWith(`..${path.sep}`)) {
    return `repo://${relative.split(path.sep).join('/')}`;
  }
  return target;
}

function scaleToken(scale) {
  return `s${String(Math.round(scale * 100)).padStart(3, '0')}`;
}

function ledgerRowGroup(ledger, predicate) {
  const rows = ledger.pairwise.contacts.filter(predicate);
  return {
    contactCount: rows.length,
    totalPenetration: rows.reduce((sum, row) => sum + row.penetration, 0),
    maximumPenetration: Math.max(0, ...rows.map(row => row.penetration)),
  };
}

function ledgerRows(ledger, obstacleConstruction) {
  return {
    m12s8ToM45: ledgerRowGroup(ledger, row =>
      row.subjectConstructionId === SUBJECT_CONSTRUCTION &&
      row.sectionId === ESCAPE_SECTION &&
      row.obstacleConstructionId === obstacleConstruction),
    m45s8ToM12: ledgerRowGroup(ledger, row =>
      row.subjectConstructionId === obstacleConstruction &&
      row.obstacleConstructionId === SUBJECT_CONSTRUCTION &&
      /:section:0008$/.test(row.sectionId)),
    m12s8ToM13: ledgerRowGroup(ledger, row =>
      row.subjectConstructionId === SUBJECT_CONSTRUCTION &&
      row.sectionId === ESCAPE_SECTION &&
      row.obstacleConstructionId === 'muscle-13'),
    m34Linked: ledgerRowGroup(ledger, row =>
      row.subjectConstructionId === HELD_CONSTRUCTION ||
      row.obstacleConstructionId === HELD_CONSTRUCTION),
  };
}

const rawArguments = process.argv.slice(2);
const preScannedOutputDirectory = preScanOutputDirectory(rawArguments);
let args = null;
let phase = 'parse-arguments';
let inputReceipts = null;
let reportPath = preScannedOutputDirectory
  ? path.join(preScannedOutputDirectory, 'run-report.json')
  : null;

try {
  args = parseArguments(rawArguments);
  reportPath = path.join(args.output, 'run-report.json');
  phase = 'claim-output-custody';
  await claimOutputCustody(args.output);
  phase = 'clear-stale-evidence';
  await clearOwnedOutput(args.output);
  phase = 'read-inputs';
  const inputPaths = {};
  const inputBytes = {};
  for (const key of ['frameReceipt', 'envelope', 'carrier', 'source']) {
    inputPaths[key] = await realpath(path.resolve(args[key]));
    inputBytes[key] = await readFile(inputPaths[key]);
  }
  inputReceipts = Object.fromEntries(Object.keys(inputPaths).map(key => [key, {
    requestedPath: receiptPath(path.resolve(args[key])),
    effectivePath: receiptPath(inputPaths[key]),
    sha256: sha256(inputBytes[key]),
  }]));
  const frameReceipt = JSON.parse(inputBytes.frameReceipt);
  const solverCarrier = JSON.parse(inputBytes.carrier);
  const source = JSON.parse(inputBytes.source);
  phase = 'verify-inputs';
  if (frameReceipt?.schema !== FRAME_RECEIPT_SCHEMA ||
      frameReceipt?.inputs?.envelopeFileSha256 !== inputReceipts.envelope.sha256) {
    throw new Error('yield assay frame receipt or envelope identity mismatch');
  }
  phase = 'parse-envelope';
  const envelopeMesh = parseGlbTriangleSoup(inputBytes.envelope);
  const transform = frameReceipt.sourceToEnvelope.transform;
  const toEnvelope = point => {
    const scaled = point.map(value => value * transform.scale);
    return [0, 1, 2].map(row =>
      transform.rotation[row][0] * scaled[0] +
      transform.rotation[row][1] * scaled[1] +
      transform.rotation[row][2] * scaled[2] +
      transform.translation[row]);
  };
  const s8AxisDistance = carrier => {
    const cage = carrier.cages.find(
      row => row.constructionId === SUBJECT_CONSTRUCTION,
    );
    const axis = cage.manifest.nodes.find(
      node => node.id === `${ESCAPE_SECTION}:axis`,
    );
    return signedEnvelopeDistance(toEnvelope(axis.currentPosition), envelopeMesh)
      .signedDistance;
  };
  phase = 'derive-neighborhood';
  const baselineLedger = measureMuscleCompartmentRingCageContactResidualLedger(
    solverCarrier, source,
  );
  const reciprocalContacts = baselineLedger.pairwise.contacts.filter(row =>
    row.fixed === false &&
    row.subjectConstructionId === args.obstacleConstruction &&
    row.obstacleConstructionId === SUBJECT_CONSTRUCTION);
  const neighborhoodPressure = new Map();
  for (const row of reciprocalContacts) {
    neighborhoodPressure.set(row.sectionId,
      (neighborhoodPressure.get(row.sectionId) || 0) + row.penetration);
  }
  const neighborhoodSectionIds = [...neighborhoodPressure.keys()].sort();
  if (reciprocalContacts.length < NEIGHBORHOOD_CONTACT_FLOOR ||
      neighborhoodSectionIds.length === 0) {
    throw new Error(
      `yield assay cannot derive a causal contact neighborhood: ` +
      `${reciprocalContacts.length} reciprocal ` +
      `${args.obstacleConstruction}->${SUBJECT_CONSTRUCTION} contacts is below ` +
      `the floor of ${NEIGHBORHOOD_CONTACT_FLOOR}`,
    );
  }
  const obstacleCage = solverCarrier.cages.find(
    row => row.constructionId === args.obstacleConstruction,
  );
  const fixedNodeIds = new Set((obstacleCage.manifest.constraints?.boundaryMasks || [])
    .filter(mask => mask.fixed === true)
    .map(mask => mask.nodeId));
  const allSectionIds = [...new Set(obstacleCage.manifest.nodes
    .map(node => /^(.*:section:\d+)/.exec(node.id)?.[1])
    .filter(Boolean))].sort();
  const fixedSectionIds = new Set(allSectionIds.filter(sectionId =>
    obstacleCage.manifest.nodes.some(node =>
      node.id.startsWith(`${sectionId}:`) && fixedNodeIds.has(node.id))));
  const contactSectionIds = new Set();
  for (const row of baselineLedger.pairwise.contacts) {
    if (row.subjectConstructionId === args.obstacleConstruction) {
      contactSectionIds.add(row.sectionId);
    }
  }
  const quietSectionIds = allSectionIds.filter(sectionId =>
    !fixedSectionIds.has(sectionId) &&
    !contactSectionIds.has(sectionId) &&
    !neighborhoodSectionIds.includes(sectionId));
  if (quietSectionIds.length === 0) {
    throw new Error('yield assay found no quiet repayment sections');
  }
  const repaymentSectionIds = quietSectionIds.slice(0, 4);
  const shamCandidates = quietSectionIds
    .filter(sectionId => !repaymentSectionIds.includes(sectionId))
    .reverse();
  const shamSectionIds = shamCandidates.slice(0, neighborhoodSectionIds.length);
  if (shamSectionIds.length === 0) {
    throw new Error(
      'yield assay found no sham sections disjoint from repayment; refusing ' +
      'to run an uncontrolled treatment',
    );
  }
  const baselineS8 = s8AxisDistance(solverCarrier);
  phase = 'evaluate-arms';
  const arms = [];
  const pushArm = async (id, carrier, extras = {}) => {
    const measurement = measureMuscleCompartmentRingCageContactState(carrier, source);
    const ledger = measureMuscleCompartmentRingCageContactResidualLedger(
      carrier, source,
    );
    const carrierBytes = jsonBytes(carrier);
    const relative = `${ARM_DIRECTORY}/${id}-carrier.json`;
    await writeAtomic(path.join(args.output, relative), carrierBytes);
    arms.push({
      id,
      metrics: {
        pairwiseMovableTotalPenetration: measurement.pairwise.movableTotalPenetration,
        pairwiseMovableMaximumPenetration:
          measurement.pairwise.movableMaximumPenetration,
        pairwiseFixedTotalPenetration: measurement.pairwise.fixedTotalPenetration,
        pairwiseFixedMaximumPenetration:
          measurement.pairwise.fixedMaximumPenetration,
        skeletalTotalPenetration: measurement.skeletal.totalPenetration,
        compartmentMaximumEscape: measurement.compartment.maximumEscape,
        maximumRelativeVolumeError: Math.max(
          ...measurement.cages.map(cage => cage.relativeVolumeError),
        ),
        maximumLocalTurn: measurement.cages.reduce((maximum, cage) =>
          Math.max(maximum, cage.centerline.maximumLocalTurningAngle), 0),
        s8AxisSignedDistance: s8AxisDistance(carrier),
      },
      ledgerRows: ledgerRows(ledger, args.obstacleConstruction),
      carrier: { path: relative, sha256: sha256(carrierBytes) },
      ...extras,
    });
  };
  await pushArm('baseline-contained', solverCarrier);
  const applyYield = (startCarrier, sectionIds, scale, directionSource) => {
    const ramp = applyLongitudinalRingCageSectionVolumeRamp(startCarrier, {
      constructionId: args.obstacleConstruction,
      compressionSections: sectionIds.map(sectionId => ({
        sectionId, areaScale: scale,
      })),
      repaymentSectionIds,
      maximumRepaymentAreaScale: 1.35,
      maximumAdjacentAreaScaleDelta: 0.7,
      volumeRelativeTolerance: 1e-10,
    });
    const rampLedger = measureMuscleCompartmentRingCageContactResidualLedger(
      ramp.outputCarrier, source,
    );
    const selection = derivePressureAlignedRingCageSectionAnisotropy(
      ramp.outputCarrier, rampLedger, {
        subjectConstructionId: args.obstacleConstruction,
        obstacleConstructionId: SUBJECT_CONSTRUCTION,
        compressionScale: scale,
      },
    );
    const derived = selection.adjustments.find(adjustment =>
      adjustment.sectionId === directionSource);
    if (!derived) {
      throw new Error(
        `yield assay selection lacks direction section ${directionSource}`,
      );
    }
    const anisotropy = applyConstantAreaRingCageSectionAnisotropy(
      ramp.outputCarrier,
      sectionIds.map(sectionId => ({
        constructionId: args.obstacleConstruction,
        sectionId,
        pressureDirection: derived.pressureDirection,
        compressionScale: scale,
      })),
    );
    return { ramp, selection, anisotropy, outputCarrier: anisotropy.outputCarrier };
  };
  const directionSource = neighborhoodSectionIds
    .slice()
    .sort((left, right) =>
      neighborhoodPressure.get(right) - neighborhoodPressure.get(left))[0];
  for (const scale of args.yieldScales) {
    const token = scaleToken(scale);
    try {
      const treatment = applyYield(
        solverCarrier, neighborhoodSectionIds, scale, directionSource,
      );
      await pushArm(`treatment-${token}`, treatment.outputCarrier, {
        yield: {
          kind: 'contact-neighborhood',
          sectionIds: neighborhoodSectionIds,
          shamSectionIds: [],
          repaymentSectionIds,
          scale,
          heldConstructionIds: [HELD_CONSTRUCTION],
          rampReceipt: {
            sourceCarrierSha256: treatment.ramp.sourceCarrierSha256,
            outputCarrierSha256: treatment.ramp.outputCarrierSha256,
            repaymentAreaScale: treatment.ramp.effective.repaymentAreaScale,
          },
          anisotropyOutputCarrierSha256:
            treatment.anisotropy.outputCarrierSha256,
        },
      });
      const treatmentArm = arms.at(-1);
      if (treatmentArm.metrics.s8AxisSignedDistance > baselineS8 + 1e-9) {
        treatmentArm.containmentWorsened = true;
      }
    } catch (error) {
      arms.push({
        id: `treatment-${token}`,
        status: 'application-refused',
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      });
    }
    try {
      const sham = applyYield(
        solverCarrier, shamSectionIds, scale, directionSource,
      );
      await pushArm(`sham-${token}`, sham.outputCarrier, {
        yield: {
          kind: 'sham-non-contact',
          sectionIds: shamSectionIds,
          shamSectionIds,
          repaymentSectionIds,
          scale,
          heldConstructionIds: [HELD_CONSTRUCTION],
          rampReceipt: {
            sourceCarrierSha256: sham.ramp.sourceCarrierSha256,
            outputCarrierSha256: sham.ramp.outputCarrierSha256,
            repaymentAreaScale: sham.ramp.effective.repaymentAreaScale,
          },
          anisotropyOutputCarrierSha256: sham.anisotropy.outputCarrierSha256,
        },
      });
    } catch (error) {
      arms.push({
        id: `sham-${token}`,
        status: 'application-refused',
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      });
    }
  }
  phase = 'solve-probe';
  // Optional constrained solve probe from the strongest admissible treatment.
  // The probe releases every construction including the held control, so its
  // result is recorded beside the arms, never as an arm.
  let solveProbe = null;
  const probeArm = arms.filter(arm =>
    arm.id.startsWith('treatment') && arm.carrier).at(-1);
  if (probeArm) {
    const probeCarrier = JSON.parse(
      await readFile(path.join(args.output, probeArm.carrier.path)),
    );
    const startDistance = s8AxisDistance(probeCarrier);
    const solve = solveMuscleCompartmentRingCageContact(
      probeCarrier, source,
      { ...SOLVER_BASE, maxIterations: args.solverIterations },
      {
        stepConstraint: candidate =>
          s8AxisDistance(candidate) > startDistance + 1e-9
            ? 's8-envelope-signed-distance-must-not-increase'
            : null,
      },
    );
    solveProbe = {
      fromArmId: probeArm.id,
      releasesHeldConstruction: true,
      acceptedIterations: solve.iterations,
      termination: solve.termination.reason,
      finalMovableTotal: solve.metrics.packed.pairwise.movableTotalPenetration,
      finalSkeletalTotal: solve.metrics.packed.skeletal.totalPenetration,
      finalS8AxisSignedDistance: s8AxisDistance(solve.packedCarrier),
    };
  }
  const result = {
    schema: RESULT_SCHEMA,
    status: 'completed-provisional',
    claimCeiling:
      'provisional route-local mechanical claim only; no anatomy, authored ' +
      'intent, stiffness, or final objective weights',
    inputs: inputReceipts,
    control: { heldConstructionId: HELD_CONSTRUCTION },
    contactNeighborhood: {
      obstacleConstructionId: args.obstacleConstruction,
      sectionIds: neighborhoodSectionIds,
      reciprocalContactCount: reciprocalContacts.length,
      directionSourceSectionId: directionSource,
    },
    shamSectionIds,
    repaymentSectionIds,
    baselineS8AxisSignedDistance: baselineS8,
    arms,
    solveProbe,
  };
  phase = 'write-assay-result';
  const resultBytes = jsonBytes(result);
  await writeAtomic(path.join(args.output, 'yield-assay-result.json'), resultBytes);
  const report = {
    schema: REPORT_SCHEMA,
    status: 'completed',
    failurePhase: null,
    claimCeiling: result.claimCeiling,
    inputs: inputReceipts,
    outputs: {
      yieldAssayResult: {
        path: 'yield-assay-result.json',
        sha256: sha256(resultBytes),
      },
    },
    lastTrustworthyEvidence: {
      phase: 'yield-assay-result-written',
      yieldAssayResultSha256: sha256(resultBytes),
      armIds: arms.map(arm => arm.id),
    },
  };
  phase = 'write-report';
  await writeAtomic(reportPath, jsonBytes(report));
  process.stdout.write(`${JSON.stringify({
    status: report.status,
    reportPath,
    arms: arms.map(arm => ({
      id: arm.id,
      s8: arm.metrics?.s8AxisSignedDistance ?? null,
      m12s8ToM45Total: arm.ledgerRows?.m12s8ToM45.totalPenetration ?? null,
      movTot: arm.metrics?.pairwiseMovableTotalPenetration ?? null,
      skel: arm.metrics?.skeletalTotalPenetration ?? null,
      error: arm.error ?? null,
    })),
    solveProbe,
  })}\n`);
} catch (error) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const outputDirectory = args?.output || preScannedOutputDirectory;
  if (outputDirectory) {
    await mkdir(outputDirectory, { recursive: true });
    reportPath ||= path.join(outputDirectory, 'run-report.json');
    const outputCustodyVerified = await hasOutputCustody(outputDirectory);
    if (outputCustodyVerified) await clearOwnedOutput(outputDirectory);
    await writeAtomic(reportPath, jsonBytes({
      schema: REPORT_SCHEMA,
      status: 'failed',
      failurePhase: phase,
      error: message,
      rawArguments,
      inputs: inputReceipts,
      outputCustodyVerified,
      staleEvidenceCleared: outputCustodyVerified,
      outputs: null,
      lastTrustworthyEvidence: {
        phase: inputReceipts ? 'inputs-read-and-hashed' : 'raw-arguments-captured',
        inputs: inputReceipts,
      },
    }));
  }
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
