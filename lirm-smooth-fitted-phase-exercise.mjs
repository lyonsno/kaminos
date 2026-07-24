#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import {
  SMOOTH_FITTED_PHASE_ROUTE,
  createSmoothFittedProxyRigBinding,
  createSmoothFittedProxyRigProbeBinding,
  evaluateSmoothFittedProxyRigPhase,
} from './lirm-reference-fitted-armature-core.mjs';
import {
  locateEditablePrimitive,
  normalizePositions,
  parseGlb,
  readAccessor,
} from './lirm-smooth-fitted-proxy-rig-assay.mjs';

export const SMOOTH_FITTED_PHASE_EXERCISE_ROUTE = 'kaminos/fitted-proxy-rig/arbitrary-phase-flat-support-exercise-v0';

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

async function writeJsonAtomic(path, value) {
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, path);
}

function packedBounds(positions) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < positions.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], positions[index + axis]);
      max[axis] = Math.max(max[axis], positions[index + axis]);
    }
  }
  return { min, max };
}

function finitePacket(packet) {
  return [...packet.bodyPositions, ...packet.worldPositions].every(Number.isFinite)
    && packet.probes.every(probe => [
      ...probe.bodyPosition,
      ...probe.worldPosition,
      ...probe.bodyNormal,
      ...probe.worldNormal,
    ].every(Number.isFinite));
}

function compactProbe(probe) {
  return {
    id: probe.id,
    axialRegion: probe.axialRegion,
    side: probe.side,
    phaseOffset: probe.phaseOffset,
    vertexCount: probe.vertexCount,
    bodyArcCoordinate: probe.bodyArcCoordinate,
    bodyPosition: probe.bodyPosition,
    worldPosition: probe.worldPosition,
    bodyNormal: probe.bodyNormal,
    worldNormal: probe.worldNormal,
    normalAuthority: probe.normalAuthority,
  };
}

export async function runSmoothFittedPhaseExercise({
  sourcePath,
  registrationPath,
  contactAtlasPath,
  outDir,
  sampleCount = 49,
  curveSampleCount = 192,
  amplitude = 0.18,
} = {}) {
  const outputRoot = resolve(outDir);
  await mkdir(outputRoot, { recursive: true });
  const reportPath = resolve(outputRoot, 'report.json');
  const probeSamplesPath = resolve(outputRoot, 'flat-support-probe-samples.json');
  const admittedAtlasPath = resolve(outputRoot, 'admitted-contact-atlas.json');
  const startedAt = Date.now();
  const report = {
    schema: 'kaminos.lirm-smooth-fitted-phase-exercise.v0',
    status: 'running',
    failurePhase: null,
    requestedRoute: SMOOTH_FITTED_PHASE_EXERCISE_ROUTE,
    effectiveRoute: null,
    requestedEvaluatorRoute: SMOOTH_FITTED_PHASE_ROUTE,
    effectiveEvaluatorRoute: null,
    requestedExerciseRoute: SMOOTH_FITTED_PHASE_EXERCISE_ROUTE,
    effectiveExerciseRoute: null,
    requestedConfig: { sampleCount, curveSampleCount, amplitude },
    effectiveConfig: null,
    source: { path: sourcePath ? relative(outputRoot, resolve(sourcePath)) : null, sha256: null },
    registration: {
      path: registrationPath ? relative(outputRoot, resolve(registrationPath)) : null,
      sha256: null,
    },
    contactAtlas: {
      path: contactAtlasPath ? relative(outputRoot, resolve(contactAtlasPath)) : null,
      sha256: null,
    },
    outputInventory: {},
    results: {},
    timing: { startedAt: new Date(startedAt).toISOString(), finishedAt: null, durationSeconds: null },
    lastTrustworthyEvidence: 'invocation recorded; inputs not admitted',
  };
  await writeJsonAtomic(reportPath, report);
  let phase = 'input-admission';
  try {
    if (![sourcePath, registrationPath, contactAtlasPath].every(path => path && existsSync(path))) {
      throw new Error('source GLB, fitted registration, and contact atlas must exist');
    }
    if (!Number.isInteger(sampleCount) || sampleCount < 7 || sampleCount > 4097) {
      throw new Error('phase exercise sampleCount must be an integer in [7, 4097]');
    }
    const [sourceBytes, registrationBytes, contactAtlasBytes] = await Promise.all([
      readFile(sourcePath),
      readFile(registrationPath),
      readFile(contactAtlasPath),
    ]);
    report.source.sha256 = sha256(sourceBytes);
    report.registration.sha256 = sha256(registrationBytes);
    report.contactAtlas.sha256 = sha256(contactAtlasBytes);
    const registration = JSON.parse(registrationBytes.toString('utf8'));
    const contactAtlas = JSON.parse(contactAtlasBytes.toString('utf8'));
    if (registration.schema !== 'kaminos.lirm-fitted-proxy-rig-registration.v0'
        || registration.donorSha256 !== report.source.sha256) {
      throw new Error('fitted registration does not bind the exact source GLB');
    }
    report.lastTrustworthyEvidence = 'exact source, fitted registration, and contact atlas bytes admitted by hash';
    phase = 'cast-binding';
    await writeJsonAtomic(reportPath, report);

    const { json, binary } = parseGlb(sourceBytes);
    const primitive = locateEditablePrimitive(json);
    const sourcePositions = readAccessor(json, binary, primitive.attributes.POSITION, 'VEC3').values;
    const normalization = normalizePositions(sourcePositions);
    const binding = createSmoothFittedProxyRigBinding({
      positions: normalization.values,
      registration,
      sampleCount: curveSampleCount,
    });
    const probeBinding = createSmoothFittedProxyRigProbeBinding({
      binding,
      contactAtlas,
      contactAtlasSha256: report.contactAtlas.sha256,
    });
    report.binding = {
      vertexCount: binding.vertexCount,
      parameterization: binding.parameterization,
      curveSampleCount: binding.sampleCount,
      probeIds: probeBinding.probes.map(probe => probe.id),
      probeVertexCounts: Object.fromEntries(
        probeBinding.probes.map(probe => [probe.id, probe.vertexIndices.length]),
      ),
    };
    phase = 'flat-support-root';
    await writeJsonAtomic(reportPath, report);

    const identityRoot = {
      schema: 'kaminos.creature-root-frame.v0',
      origin: { x: 0, y: 0, z: 0 },
      lateral: { x: 1, y: 0, z: 0 },
      normal: { x: 0, y: 1, z: 0 },
      tangent: { x: 0, y: 0, z: 1 },
    };
    const rest = evaluateSmoothFittedProxyRigPhase({
      binding,
      probeBinding,
      phase: 0,
      amplitude,
      rootFrame: identityRoot,
    });
    const restProbeMinimum = Math.min(...rest.probes.map(probe => probe.bodyPosition[1]));
    const flatSupportRoot = {
      ...identityRoot,
      origin: { x: 0, y: -restProbeMinimum, z: 0 },
    };
    report.flatSupport = {
      schema: 'kaminos.deterministic-flat-support-fixture.v0',
      rootFrame: flatSupportRoot,
      plane: { normal: [0, 1, 0], offset: 0 },
      admissionBasis: 'minimum exact rest-pose semantic probe',
    };

    phase = 'phase-sampling';
    const samples = [];
    let minimumWorldY = Infinity;
    let maximumWorldY = -Infinity;
    let maximumProbePenetration = 0;
    for (let index = 0; index < sampleCount; index += 1) {
      const normalizedPhase = index / (sampleCount - 1);
      const packet = evaluateSmoothFittedProxyRigPhase({
        binding,
        probeBinding,
        phase: normalizedPhase,
        amplitude,
        rootFrame: flatSupportRoot,
      });
      if (packet.requestedRoute !== SMOOTH_FITTED_PHASE_ROUTE
          || packet.effectiveRoute !== SMOOTH_FITTED_PHASE_ROUTE) {
        throw new Error(`phase ${normalizedPhase} evaluator route mismatch`);
      }
      if (!finitePacket(packet)) throw new Error(`phase ${normalizedPhase} produced non-finite output`);
      const bounds = packedBounds(packet.worldPositions);
      minimumWorldY = Math.min(minimumWorldY, bounds.min[1]);
      maximumWorldY = Math.max(maximumWorldY, bounds.max[1]);
      maximumProbePenetration = Math.max(
        maximumProbePenetration,
        ...packet.probes.map(probe => Math.max(0, -probe.worldPosition[1])),
      );
      samples.push({
        effectiveEvaluatorRoute: packet.effectiveRoute,
        effectiveExerciseRoute: SMOOTH_FITTED_PHASE_EXERCISE_ROUTE,
        source: {
          castSha256: report.source.sha256,
          fittedRegistrationSha256: report.registration.sha256,
          contactAtlasSha256: report.contactAtlas.sha256,
        },
        phase: packet.pose.phase,
        requestedPhase: normalizedPhase,
        segment: packet.pose.segment,
        fromPreset: packet.pose.fromPreset,
        toPreset: packet.pose.toPreset,
        linearMix: packet.pose.linearMix,
        mix: packet.pose.mix,
        bounds,
        probes: packet.probes.map(compactProbe),
      });
    }
    const first = samples[0];
    const last = samples.at(-1);
    if (JSON.stringify(first.probes) !== JSON.stringify(last.probes)) {
      throw new Error('phase cycle did not close exactly at the probe packet');
    }
    const probeSamples = {
      schema: 'kaminos.lirm-smooth-fitted-flat-support-probe-samples.v0',
      requestedEvaluatorRoute: SMOOTH_FITTED_PHASE_ROUTE,
      effectiveEvaluatorRoute: SMOOTH_FITTED_PHASE_ROUTE,
      requestedExerciseRoute: SMOOTH_FITTED_PHASE_EXERCISE_ROUTE,
      effectiveExerciseRoute: SMOOTH_FITTED_PHASE_EXERCISE_ROUTE,
      source: {
        castSha256: report.source.sha256,
        fittedRegistrationSha256: report.registration.sha256,
        contactAtlasSha256: report.contactAtlas.sha256,
        contactAtlasRegistrationHash: probeBinding.contactAtlasRegistrationHash,
      },
      flatSupport: {
        schema: report.flatSupport.schema,
        rootFrame: flatSupportRoot,
        plane: { normal: [0, 1, 0], offset: 0 },
        authority: 'deterministic-flat-support-fixture-v0',
      },
      amplitude,
      sampleCount,
      samples,
    };
    await writeJsonAtomic(probeSamplesPath, probeSamples);
    await writeFile(admittedAtlasPath, contactAtlasBytes);
    report.outputInventory.probeSamples = {
      path: relative(outputRoot, probeSamplesPath),
      bytes: (await readFile(probeSamplesPath)).byteLength,
      sha256: sha256(await readFile(probeSamplesPath)),
    };
    report.outputInventory.admittedContactAtlas = {
      path: relative(outputRoot, admittedAtlasPath),
      bytes: contactAtlasBytes.byteLength,
      sha256: report.contactAtlas.sha256,
    };
    report.results = {
      exactCycleClosure: true,
      finiteSampleCount: samples.length,
      minimumWorldY,
      maximumWorldY,
      maximumProbePenetration,
      probeCount: probeBinding.probes.length,
      probeIds: probeBinding.probes.map(probe => probe.id),
    };
    report.effectiveRoute = SMOOTH_FITTED_PHASE_EXERCISE_ROUTE;
    report.effectiveEvaluatorRoute = SMOOTH_FITTED_PHASE_ROUTE;
    report.effectiveExerciseRoute = SMOOTH_FITTED_PHASE_EXERCISE_ROUTE;
    report.effectiveConfig = {
      sampleCount,
      curveSampleCount,
      amplitude,
      parameterization: binding.parameterization,
      phaseRealization: 'station-chain-interpolation-plus-fitted-curve-reconstruction-v0',
      frameTransport: 'rotation-minimizing-parallel-transport-v0',
      supportFixture: 'flat-plane-y-zero-v0',
    };
    report.status = 'exercise-complete-uninspected';
    report.lastTrustworthyEvidence = 'all phase packets finite; exact cycle closure and stable probe identity recorded';
  } catch (error) {
    report.status = 'failed';
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

if (import.meta.url === `file://${process.argv[1]}`) {
  const options = parseArgs(process.argv.slice(2));
  const report = await runSmoothFittedPhaseExercise({
    sourcePath: options.source,
    registrationPath: options.registration,
    contactAtlasPath: options['contact-atlas'],
    outDir: options.out,
    sampleCount: options.samples ? Number(options.samples) : 49,
    curveSampleCount: options['curve-samples'] ? Number(options['curve-samples']) : 192,
    amplitude: options.amplitude ? Number(options.amplitude) : 0.18,
  });
  process.stdout.write(`${JSON.stringify({
    status: report.status,
    report: resolve(options.out, 'report.json'),
    timing: report.timing,
  }, null, 2)}\n`);
}
