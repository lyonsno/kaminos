#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  computeWeightedRmsPatchRadius,
  contactStateAtUnitPhase,
  ordinaryMedian,
  periodicCentralDifference,
  runSupportVelocityAssay,
  SUPPORT_IDS,
  SUPPORT_VELOCITY_ASSAY_ROUTE,
} from './lirm-support-velocity-assay-core.mjs';
import {
  locateEditablePrimitive,
  normalizePositions,
  parseGlb,
  readAccessor,
} from './lirm-smooth-fitted-proxy-rig-assay.mjs';

const BASELINE_COMMIT = '6217fff858c0b12e330499baf28127f9122826f7';
const EXPECTED_HASHES = {
  source: 'sha256:8fed20d958ef48797c14ad1d3846a50eae05d43e6ae67f8805060b02f1abde8e',
  samples: 'sha256:017ef8037447494a4f1c17293b9d3b55f105109ebed16635ffbda15a9c31200a',
  atlas: 'sha256:e3007a55f930d709ac8a7bf684ff32ad862e7d55186343220edb3e2ad3635b78',
  phaseReport: 'sha256:97abeb1cdacb802ecf26e2aba6e27ae9d96508e6f85836853b9c3bdd993583ff',
  fittedRegistration: 'sha256:a63fa02ffa7a144234eef3b9902ac9d349fd413d93a19c87ee1464b0b61ca7f9',
  axialRegistration: 'sha256:cb519913ad863441e88555b3d9fbd588ffef03650475de07c29ee1c71f500ff6',
};
const SAMPLE_COUNT = 48;
const CYCLE_DURATION_SECONDS = 8.1;
const SAMPLE_INTERVAL_SECONDS = CYCLE_DURATION_SECONDS / SAMPLE_COUNT;
const FORWARD_AXIS = [0, 0, -1];

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, path);
}

async function admitFile(path, expectedHash, label) {
  if (!path || !existsSync(path)) throw new Error(`${label} does not exist`);
  const bytes = await readFile(path);
  if (bytes.length === 0) throw new Error(`${label} is blank`);
  const actualHash = sha256(bytes);
  if (actualHash !== expectedHash) {
    throw new Error(`${label} hash mismatch: ${actualHash} != ${expectedHash}`);
  }
  return { bytes, sha256: actualHash };
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

function vectorEqual(left, right) {
  return Array.isArray(left) && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => Object.is(value, right[index]) || value === right[index]);
}

function assertExactInputs({ samples, atlas, phaseReport, fittedRegistration, axialRegistration }) {
  if (samples.schema !== 'kaminos.lirm-smooth-fitted-flat-support-probe-samples.v0'
      || samples.samples?.length !== SAMPLE_COUNT + 1) {
    throw new Error('probe sample packet schema or sample count mismatch');
  }
  if (atlas.schema !== 'kaminos.creature-contact-atlas.v0'
      || atlas.castHash !== EXPECTED_HASHES.source.slice('sha256:'.length)
      || atlas.registrationHash !== EXPECTED_HASHES.axialRegistration.slice('sha256:'.length)
      || atlas.patches?.length !== SUPPORT_IDS.length) {
    throw new Error('contact atlas identity or shape mismatch');
  }
  if (phaseReport.schema !== 'kaminos.lirm-smooth-fitted-phase-exercise.v0'
      || phaseReport.requestedRoute !== 'kaminos/fitted-proxy-rig/arbitrary-phase-flat-support-exercise-v0'
      || phaseReport.effectiveRoute !== phaseReport.requestedRoute
      || phaseReport.effectiveConfig?.sampleCount !== SAMPLE_COUNT + 1
      || phaseReport.effectiveConfig?.amplitude !== 0.18) {
    throw new Error('phase report route or effective configuration mismatch');
  }
  if (fittedRegistration.schema !== 'kaminos.lirm-fitted-proxy-rig-registration.v0'
      || fittedRegistration.donorSha256 !== EXPECTED_HASHES.source) {
    throw new Error('fitted registration does not bind the exact source');
  }
  if (axialRegistration.schema !== 'kaminos.axial-crawler-registration.v0'
      || !vectorEqual(axialRegistration.localForwardAxis, FORWARD_AXIS)) {
    throw new Error('axial registration forward axis mismatch');
  }
  const expectedSources = {
    castSha256: EXPECTED_HASHES.source,
    fittedRegistrationSha256: EXPECTED_HASHES.fittedRegistration,
    contactAtlasSha256: EXPECTED_HASHES.atlas,
    contactAtlasRegistrationHash: atlas.registrationHash,
  };
  for (const [key, value] of Object.entries(expectedSources)) {
    if (samples.source?.[key] !== value) throw new Error(`probe sample source ${key} mismatch`);
  }
  const first = samples.samples[0];
  const closure = samples.samples[SAMPLE_COUNT];
  if (first.requestedPhase !== 0 || closure.requestedPhase !== 1
      || first.phase !== 0 || closure.phase !== 0
      || JSON.stringify({ ...first, requestedPhase: 1 })
        !== JSON.stringify({ ...closure, requestedPhase: 1 })) {
    throw new Error('probe samples do not contain one exact periodic closure frame');
  }
  for (let index = 0; index < SAMPLE_COUNT; index += 1) {
    const sample = samples.samples[index];
    if (sample.requestedPhase !== index / SAMPLE_COUNT
        || sample.probes?.length !== SUPPORT_IDS.length) {
      throw new Error(`probe sample ${index} cadence or support shape mismatch`);
    }
    for (const supportId of SUPPORT_IDS) {
      const probe = sample.probes.find(candidate => candidate.id === supportId);
      if (!probe || !Array.isArray(probe.bodyPosition) || probe.bodyPosition.length !== 3
          || !probe.bodyPosition.every(Number.isFinite)) {
        throw new Error(`probe sample ${index} missing finite ${supportId} body position`);
      }
    }
  }
}

function buildSupportEvidence({ samples, atlas, normalizedPositions }) {
  return SUPPORT_IDS.map(id => {
    const patch = atlas.patches.find(candidate => candidate.id === id);
    if (!patch) throw new Error(`contact atlas missing ${id}`);
    const phaseOffsets = samples.samples.slice(0, SAMPLE_COUNT)
      .map(sample => sample.probes.find(probe => probe.id === id)?.phaseOffset);
    if (phaseOffsets.some(value => value !== patch.phaseOffset)) {
      throw new Error(`${id} phase offset disagrees across source artifacts`);
    }
    const forwardCoordinates = samples.samples.slice(0, SAMPLE_COUNT).map(sample => {
      const position = sample.probes.find(probe => probe.id === id).bodyPosition;
      return position.reduce((sum, value, axis) => sum + value * FORWARD_AXIS[axis], 0);
    });
    const supportVelocityTrace = periodicCentralDifference(
      forwardCoordinates,
      SAMPLE_INTERVAL_SECONDS,
    );
    const radius = computeWeightedRmsPatchRadius(
      normalizedPositions,
      patch.vertexIndices,
      patch.weights,
    );
    return {
      id,
      phaseOffset: patch.phaseOffset,
      normalizedWeightSum: radius.weightSum,
      normalizedCentroid: radius.centroid,
      rmsRadius: radius.rmsRadius,
      forwardCoordinateTrace: forwardCoordinates,
      supportVelocityTrace,
      impliedSpeedTrace: supportVelocityTrace.map(value => -value),
      activeTrace: Array.from({ length: SAMPLE_COUNT }, (_, index) => (
        contactStateAtUnitPhase(index / SAMPLE_COUNT, patch.phaseOffset).state === 'stance'
      )),
    };
  });
}

export async function runExactSupportVelocityAssay({
  sourcePath,
  samplesPath,
  atlasPath,
  phaseReportPath,
  fittedRegistrationPath,
  axialRegistrationPath,
  outDir,
} = {}) {
  const outputRoot = resolve(outDir);
  const reportPath = resolve(outputRoot, 'report.json');
  const startedAt = Date.now();
  const requestedConfig = {
    measurementBaselineCommit: BASELINE_COMMIT,
    sampleCount: SAMPLE_COUNT,
    cycleDurationSeconds: CYCLE_DURATION_SECONDS,
    sampleIntervalSeconds: SAMPLE_INTERVAL_SECONDS,
    differentiation: 'unsmoothed-periodic-central-difference',
    forwardAxis: FORWARD_AXIS,
    stanceFraction: 0.58,
    releaseFraction: 0.08,
    stanceEnd: 0.5,
    exclusions: [],
    nullFamily: 'all-global-integer-sample-shifts',
    percentile: 'empirical-midrank-(less+0.5*equal)/N',
    score: 'minimum-component-percentile',
    strongThreshold: 0.95,
    effectSize: 'signed-displacement-gte-median-active-weighted-rms-patch-radius',
  };
  const paths = {
    source: sourcePath,
    samples: samplesPath,
    atlas: atlasPath,
    phaseReport: phaseReportPath,
    fittedRegistration: fittedRegistrationPath,
    axialRegistration: axialRegistrationPath,
  };
  const report = {
    schema: 'kaminos.lirm-support-velocity-assay.v0',
    status: 'running',
    failurePhase: null,
    requestedRoute: SUPPORT_VELOCITY_ASSAY_ROUTE,
    effectiveRoute: null,
    requestedConfig,
    effectiveConfig: null,
    inputs: Object.fromEntries(Object.entries(paths).map(([id, path]) => [
      id,
      { path: path ? relative(outputRoot, resolve(path)) : null, sha256: null },
    ])),
    nullFamily: {
      shiftCount: SAMPLE_COUNT,
      selectedShiftCount: 0,
      perSupportShiftsAllowed: false,
    },
    supports: [],
    shifts: [],
    result: null,
    timing: { startedAt: new Date(startedAt).toISOString(), finishedAt: null, durationSeconds: null },
    lastTrustworthyEvidence: 'invocation recorded; inputs not admitted',
  };
  await writeJsonAtomic(reportPath, report);
  let phase = 'input-admission';
  try {
    const admitted = {};
    for (const [id, path] of Object.entries(paths)) {
      admitted[id] = await admitFile(path, EXPECTED_HASHES[id], id);
      report.inputs[id].sha256 = admitted[id].sha256;
    }
    const samples = parseJson(admitted.samples.bytes, 'samples');
    const atlas = parseJson(admitted.atlas.bytes, 'atlas');
    const phaseReport = parseJson(admitted.phaseReport.bytes, 'phase report');
    const fittedRegistration = parseJson(admitted.fittedRegistration.bytes, 'fitted registration');
    const axialRegistration = parseJson(admitted.axialRegistration.bytes, 'axial registration');
    assertExactInputs({ samples, atlas, phaseReport, fittedRegistration, axialRegistration });
    report.lastTrustworthyEvidence = 'all exact source identities, routes, cadence, and closure frame admitted';
    await writeJsonAtomic(reportPath, report);

    phase = 'normalized-patch-radius';
    const { json, binary } = parseGlb(admitted.source.bytes);
    const primitive = locateEditablePrimitive(json);
    const sourcePositions = readAccessor(
      json,
      binary,
      primitive.attributes.POSITION,
      'VEC3',
    ).values;
    if (sourcePositions.length / 3 !== atlas.vertexCount) {
      throw new Error('contact atlas vertex count does not match source primitive');
    }
    const normalization = normalizePositions(sourcePositions);
    const supports = buildSupportEvidence({
      samples,
      atlas,
      normalizedPositions: normalization.values,
    });
    const activeRadii = [];
    for (let index = 0; index < SAMPLE_COUNT; index += 1) {
      for (const support of supports) {
        if (support.activeTrace[index]) activeRadii.push(support.rmsRadius);
      }
    }
    const medianActivePatchRmsRadius = ordinaryMedian(activeRadii);
    report.lastTrustworthyEvidence = 'four support traces and normalized weighted patch radii derived without smoothing or exclusions';
    await writeJsonAtomic(reportPath, report);

    phase = 'exhaustive-null-family';
    const assay = runSupportVelocityAssay({
      supports,
      sampleCount: SAMPLE_COUNT,
      dt: SAMPLE_INTERVAL_SECONDS,
      medianActivePatchRmsRadius,
    });
    report.effectiveConfig = {
      ...requestedConfig,
      cadenceAuthority: 'exact-artifact-48-unique-sample-cycle',
      duplicateClosureFrameExcluded: true,
      activePatchRadiusOccurrenceCount: activeRadii.length,
      sourceNormalization: {
        center: normalization.center,
        scale: normalization.scale,
        sourceBounds: normalization.sourceBounds,
      },
    };
    report.supports = supports;
    report.shifts = assay.shifts;
    report.result = assay.result;
    report.effectiveRoute = SUPPORT_VELOCITY_ASSAY_ROUTE;
    report.status = 'pass';
    report.lastTrustworthyEvidence = 'all 48 global phase shifts measured; frozen classification emitted';
  } catch (error) {
    report.status = 'fail';
    report.failurePhase = phase;
    report.error = { name: error.name, message: error.message };
    report.lastTrustworthyEvidence = `${report.lastTrustworthyEvidence}; failed during ${phase}`;
    throw error;
  } finally {
    const finishedAt = Date.now();
    report.timing.finishedAt = new Date(finishedAt).toISOString();
    report.timing.durationSeconds = (finishedAt - startedAt) / 1000;
    await writeJsonAtomic(reportPath, report);
  }
  return report;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) throw new Error(`unexpected argument: ${key}`);
    const value = argv[++index];
    if (value === undefined) throw new Error(`missing value for ${key}`);
    options[key.slice(2)] = value;
  }
  return options;
}

const root = dirname(fileURLToPath(import.meta.url));
const defaults = {
  source: resolve(root, 'artifacts/motion-ready-719024/creature.glb'),
  samples: resolve(root, 'artifacts/lirm-719024-smooth-fitted-phase-exercise-v0/flat-support-probe-samples.json'),
  atlas: resolve(root, 'artifacts/lirm-719024-smooth-fitted-phase-exercise-v0/admitted-contact-atlas.json'),
  'phase-report': resolve(root, 'artifacts/lirm-719024-smooth-fitted-phase-exercise-v0/report.json'),
  'fitted-registration': resolve(root, 'artifacts/lirm-719024-fitted-proxy-rig-mechanism-witness-v1/registration.json'),
  'axial-registration': resolve(root, 'artifacts/motion-ready-719024/registration.json'),
  out: resolve(root, 'artifacts/lirm-719024-support-velocity-assay-v0'),
};

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const args = { ...defaults, ...parseArgs(process.argv.slice(2)) };
  runExactSupportVelocityAssay({
    sourcePath: args.source,
    samplesPath: args.samples,
    atlasPath: args.atlas,
    phaseReportPath: args['phase-report'],
    fittedRegistrationPath: args['fitted-registration'],
    axialRegistrationPath: args['axial-registration'],
    outDir: args.out,
  }).then(report => {
    console.log(JSON.stringify({
      status: report.status,
      classification: report.result.classification,
      score: report.result.unshiftedScore,
      signedDisplacement: report.result.unshiftedMetrics.signedDisplacement,
      patchRadius: report.result.medianActivePatchRmsRadius,
      visualAbEarned: report.result.visualAbEarned,
    }, null, 2));
  }).catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
