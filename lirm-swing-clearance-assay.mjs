#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  evaluateSmoothFittedProxyRigPhase,
} from './lirm-reference-fitted-armature-core.mjs';
import {
  locateEditablePrimitive,
  normalizePositions,
  parseGlb,
  readAccessor,
} from './lirm-smooth-fitted-proxy-rig-assay.mjs';
import {
  createSupportPlacedFittedRig,
  createSupportRootFrame,
} from './lirm-stationary-hill-contact-core.mjs';
import {
  assertSwingClearanceAssayReport,
  createSwingClearanceBodySideSet,
  createSwingClearanceCandidate,
  createSwingClearanceMaskSummary,
  SWING_CLEARANCE_ASSAY_ROUTE,
  SWING_CLEARANCE_CONTACT_ATLAS_HASH,
  SWING_CLEARANCE_REGISTRATION_HASH,
  SWING_CLEARANCE_SOURCE_HASH,
  SWING_CLEARANCE_SUPPORT_ID,
} from './lirm-swing-clearance-assay-core.mjs';

const DEFAULT_INPUTS = Object.freeze({
  source: 'artifacts/motion-ready-719024/creature.glb',
  registration: 'artifacts/lirm-719024-fitted-proxy-rig-mechanism-witness-v1/registration.json',
  contactAtlas: 'artifacts/lirm-719024-smooth-fitted-phase-exercise-v0/admitted-contact-atlas.json',
  phaseReport: 'artifacts/lirm-719024-smooth-fitted-phase-exercise-v0/report.json',
  handshake:
    'artifacts/lirm-719024-motion-contact-probe-handshake-v0/stationary-hill-request-response.json',
  axialRegistration: 'artifacts/motion-ready-719024/registration.json',
  constraints: 'artifacts/motion-ready-719024/stationary-contact-constraints/constraints.json',
});
const EXPECTED_HASHES = Object.freeze({
  source: SWING_CLEARANCE_SOURCE_HASH,
  registration: SWING_CLEARANCE_REGISTRATION_HASH,
  contactAtlas: SWING_CLEARANCE_CONTACT_ATLAS_HASH,
  phaseReport: 'sha256:97abeb1cdacb802ecf26e2aba6e27ae9d96508e6f85836853b9c3bdd993583ff',
  handshake: 'sha256:a84bfcae1ad03f71961bcfc4c9040980648f4c579b1bccc3ba15d82a25a6210a',
  axialRegistration:
    'sha256:cb519913ad863441e88555b3d9fbd588ffef03650475de07c29ee1c71f500ff6',
  constraints: 'sha256:77a8e0f795791956ceb34a17da397865ea0a7504f98542de1e6b0529e66f72fb',
});

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

async function writeAtomic(path, bytes) {
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, bytes);
  await rename(temporary, path);
}

async function writeJsonAtomic(path, value) {
  await writeAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function loadExact(path, expectedHash, parseJson = true) {
  const bytes = await readFile(path);
  const actualHash = sha256(bytes);
  if (actualHash !== expectedHash) {
    throw new Error(`exact input hash mismatch for ${path}: ${actualHash} != ${expectedHash}`);
  }
  return {
    bytes,
    sha256: actualHash,
    value: parseJson ? JSON.parse(bytes) : null,
  };
}

function float32Bytes(values) {
  return Buffer.from(Float32Array.from(values).buffer);
}

function stripCandidate(candidate, files) {
  return {
    family: candidate.family,
    positionsFile: files.positions,
    displacementFile: files.displacement,
    appliedTranslation: candidate.appliedTranslation,
    rotationAxis: candidate.rotationAxis,
    rotationRadians: candidate.rotationRadians,
    sourceClearance: candidate.sourceClearance,
    clearance: candidate.clearance,
    collar: candidate.collar,
    deformation: {
      ...candidate.deformation,
      displacement: undefined,
    },
  };
}

function relativeInput(root, path) {
  return relative(root, path).replaceAll('\\', '/');
}

export async function runSwingClearanceAssay({
  root = process.cwd(),
  outDir = 'artifacts/lirm-719024-swing-clearance-assay-v0',
  inputs = DEFAULT_INPUTS,
} = {}) {
  const absoluteRoot = resolve(root);
  const absoluteOutDir = resolve(absoluteRoot, outDir);
  const reportPath = resolve(absoluteOutDir, 'report.json');
  await mkdir(absoluteOutDir, { recursive: true });
  let failurePhase = 'input-admission';
  let lastTrustworthyEvidence = null;
  const startedAt = performance.now();
  try {
    const absoluteInputs = Object.fromEntries(
      Object.entries(inputs).map(([key, path]) => [key, resolve(absoluteRoot, path)]),
    );
    const loaded = Object.fromEntries(await Promise.all(
      Object.entries(absoluteInputs).map(async ([key, path]) => [
        key,
        await loadExact(path, EXPECTED_HASHES[key], key !== 'source'),
      ]),
    ));
    lastTrustworthyEvidence = 'all exact inputs admitted by byte hash';
    failurePhase = 'source-geometry';
    const { json, binary } = parseGlb(loaded.source.bytes);
    const primitive = locateEditablePrimitive(json);
    const sourcePositions = readAccessor(
      json,
      binary,
      primitive.attributes.POSITION,
      'VEC3',
    ).values;
    const indices = Uint32Array.from(
      readAccessor(json, binary, primitive.indices, 'SCALAR').values,
    );
    const normalization = normalizePositions(sourcePositions);
    const admittedNormalization = loaded.handshake.value.normalization;
    if (normalization.center.some(
      (value, axis) => Math.abs(value - admittedNormalization.center[axis]) > 1e-12,
    ) || Math.abs(normalization.scale - admittedNormalization.scale) > 1e-12) {
      throw new Error('source normalization diverged from frozen handshake');
    }
    lastTrustworthyEvidence = 'exact source geometry and handshake normalization agree';
    failurePhase = 'frozen-phase-realization';
    const prepass = loaded.handshake.value.prepass;
    const placedRig = createSupportPlacedFittedRig({
      normalizedPositions: normalization.values,
      registration: loaded.registration.value,
      normalization,
      bodyScale: prepass.body.scale,
      contactAtlas: loaded.contactAtlas.value,
      contactAtlasSha256: loaded.contactAtlas.sha256,
      sampleCount: loaded.phaseReport.value.effectiveConfig.curveSampleCount,
    });
    const rootFrame = createSupportRootFrame({
      prepass,
      contactPlaneY: loaded.axialRegistration.value.contactPlaneY,
    });
    const constraintPhase = loaded.constraints.value.phase;
    const phase = ((constraintPhase / (Math.PI * 2)) % 1 + 1) % 1;
    const baseline = evaluateSmoothFittedProxyRigPhase({
      binding: placedRig.binding,
      probeBinding: placedRig.probeBinding,
      phase,
      amplitude: loaded.phaseReport.value.effectiveConfig.amplitude,
      rootFrame,
    });
    const probe = placedRig.probeBinding.probes.find(
      entry => entry.id === SWING_CLEARANCE_SUPPORT_ID,
    );
    const constraint = loaded.constraints.value.patches.find(
      entry => entry.id === SWING_CLEARANCE_SUPPORT_ID,
    );
    if (!probe || !constraint) throw new Error('frozen rear-left support is missing');
    lastTrustworthyEvidence = 'frozen phase realized with exact rear-left support identity';
    failurePhase = 'body-side-set';
    const bodySideSet = createSwingClearanceBodySideSet({
      positions: baseline.worldPositions,
      probes: placedRig.probeBinding.probes,
      probe,
      neighborsPerAttachment: 4,
    });
    lastTrustworthyEvidence = 'frozen nearest body-side collar comparison set constructed';
    failurePhase = 'candidate-realization';
    const candidates = ['source', 'translation', 'minimum-rotation'].map(family => (
      createSwingClearanceCandidate({
        family,
        positions: baseline.worldPositions,
        indices,
        probe,
        probes: placedRig.probeBinding.probes,
        terrainPoint: constraint.terrainPoint,
        terrainNormal: constraint.terrainNormal,
        targetClearance: 0.008,
        maximumTranslation: 0.035,
        bodySideSet,
      })
    ));
    const candidateReports = [];
    for (const candidate of candidates) {
      const slug = candidate.family;
      const positionsFile = `${slug}-positions.f32`;
      const displacementFile = `${slug}-displacement.f32`;
      await writeAtomic(
        resolve(absoluteOutDir, positionsFile),
        float32Bytes(candidate.positions),
      );
      await writeAtomic(
        resolve(absoluteOutDir, displacementFile),
        float32Bytes(candidate.deformation.displacement),
      );
      candidateReports.push(stripCandidate(candidate, {
        positions: positionsFile,
        displacement: displacementFile,
      }));
    }
    lastTrustworthyEvidence = 'all three candidate fields written';
    failurePhase = 'report';
    const report = {
      schema: 'kaminos.lirm-swing-clearance-assay-report.v0',
      status: 'complete',
      requestedRoute: SWING_CLEARANCE_ASSAY_ROUTE,
      effectiveRoute: SWING_CLEARANCE_ASSAY_ROUTE,
      sourceHash: SWING_CLEARANCE_SOURCE_HASH,
      actualSourceHash: loaded.source.sha256,
      supportId: SWING_CLEARANCE_SUPPORT_ID,
      phase: {
        radians: constraintPhase,
        normalized: phase,
        poseId: loaded.constraints.value.poseId,
      },
      rootFrame,
      inputHashes: {
        source: loaded.source.sha256,
        registration: loaded.registration.sha256,
        contactAtlas: loaded.contactAtlas.sha256,
        phaseReport: loaded.phaseReport.sha256,
        handshake: loaded.handshake.sha256,
        axialRegistration: loaded.axialRegistration.sha256,
        constraints: loaded.constraints.sha256,
      },
      inputs: Object.fromEntries(
        Object.entries(absoluteInputs).map(([key, path]) => [
          key,
          relativeInput(absoluteRoot, path),
        ]),
      ),
      vertexCount: sourcePositions.length / 3,
      triangleCount: indices.length / 3,
      terrain: {
        point: constraint.terrainPoint,
        normal: constraint.terrainNormal,
        contactState: constraint.contactState,
      },
      masks: createSwingClearanceMaskSummary(probe),
      bodySideSet,
      candidates: candidateReports,
      authority: {
        assay: 'operator-inspection-only',
        support: 'none',
        continuation:
          'A passing translation candidate earns only the swing-to-plant handoff assay.',
      },
      outputInventory: [
        'report.json',
        ...candidateReports.flatMap(candidate => [
          candidate.positionsFile,
          candidate.displacementFile,
        ]),
      ],
      failurePhase: null,
      lastTrustworthyEvidence,
      timing: { elapsedMilliseconds: performance.now() - startedAt },
    };
    assertSwingClearanceAssayReport(report);
    await writeJsonAtomic(reportPath, report);
    return { report, reportPath };
  } catch (error) {
    const failure = {
      schema: 'kaminos.lirm-swing-clearance-assay-report.v0',
      status: 'failed',
      requestedRoute: SWING_CLEARANCE_ASSAY_ROUTE,
      effectiveRoute: null,
      sourceHash: SWING_CLEARANCE_SOURCE_HASH,
      supportId: SWING_CLEARANCE_SUPPORT_ID,
      failurePhase,
      lastTrustworthyEvidence,
      error: String(error?.stack || error),
      timing: { elapsedMilliseconds: performance.now() - startedAt },
    };
    await writeJsonAtomic(reportPath, failure);
    throw error;
  }
}

function parseArguments(argv) {
  const values = { root: process.cwd() };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--root') values.root = argv[++index];
    else if (argv[index] === '--out-dir') values.outDir = argv[++index];
    else throw new Error(`unknown argument ${argv[index]}`);
  }
  return values;
}

if (process.argv[1]
    && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  runSwingClearanceAssay(parseArguments(process.argv.slice(2)))
    .then(({ reportPath, report }) => {
      process.stdout.write(`${JSON.stringify({
        status: report.status,
        route: report.effectiveRoute,
        supportId: report.supportId,
        report: relative(process.cwd(), reportPath),
      })}\n`);
    })
    .catch(error => {
      process.stderr.write(`${String(error?.stack || error)}\n`);
      process.exitCode = 1;
    });
}
