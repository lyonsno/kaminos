#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { createNBodyLocalizedChallengeSuite } from './nbody-packing-assay-core.mjs';
import { hashMusclePackingCanonicalJson } from './muscle-compartment-packing-core.mjs';
import { compileNBodyAdaptiveKktProblem } from './nbody-packing-unified-kkt.mjs';
import {
  createNBodyAllNeighborRestorationConfig,
  solveNBodyAllNeighborRestoration,
} from './nbody-packing-restoration.mjs';

export const NBODY_PACKING_RESTORATION_ASSAY_SCHEMA =
  'kaminos.nbody-packing-all-neighbor-restoration-assay.v0';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

async function writeAtomically(targetPath, bytes) {
  const temporaryPath = `${targetPath}.tmp`;
  await writeFile(temporaryPath, bytes);
  await rename(temporaryPath, targetPath);
}

function verifyCanonicalIdentity(value, label) {
  const core = structuredClone(value);
  delete core.identity;
  if (value.identity?.sha256 !== hashMusclePackingCanonicalJson(core)) {
    throw new Error(`restoration assay rejects stale ${label} identity`);
  }
}

export async function runNBodyPackingRestorationAssay({
  outDir = 'artifacts/nbody-packing-all-neighbor-restoration-v0',
  patternResultPath =
    'artifacts/nbody-packing-localized-challenge-v0/oracle-pattern-search-032.json',
  homotopyResultPath =
    'artifacts/nbody-packing-localized-challenge-v0/homotopy-032-fine-0875-to-1.json',
} = {}) {
  const outputRoot = path.resolve(outDir);
  let phase = 'read-frozen-inputs';
  let lastTrustworthyEvidence = { phase:'none' };
  await mkdir(outputRoot, { recursive:true });
  try {
    const [patternBytes, homotopyBytes] = await Promise.all([
      readFile(path.resolve(patternResultPath)),
      readFile(path.resolve(homotopyResultPath)),
    ]);
    const pattern = JSON.parse(String(patternBytes));
    const homotopy = JSON.parse(String(homotopyBytes));
    verifyCanonicalIdentity(pattern, 'coordinate-search result');
    verifyCanonicalIdentity(homotopy, 'homotopy result');
    lastTrustworthyEvidence = {
      phase:'frozen-inputs-read',
      patternFileSha256:sha256(patternBytes),
      homotopyFileSha256:sha256(homotopyBytes),
    };
    phase = 'bind-problem-and-baselines';
    const fixture = createNBodyLocalizedChallengeSuite().find(
      row => row.assayProfile.severity === 0.32,
    );
    const problem = compileNBodyAdaptiveKktProblem(fixture);
    const patternFloor = pattern.seedRows?.[0]?.final;
    const homotopyFloor = homotopy.stages?.at(-1)?.solverResult?.selected;
    if (
      pattern.schema !== 'kaminos.nbody-localized-same-basis-pattern-search.v0' ||
      pattern.status !== 'same-basis-feasibility-unresolved' ||
      pattern.route?.effective !== 'deterministic-coupled-coordinate-pattern-search' ||
      pattern.route?.fallbackUsed !== false ||
      pattern.problemIdentity?.sha256 !== problem.identity.sha256 ||
      pattern.mechanism?.oracleTargetCoordinatesConsumed !== false ||
      pattern.mechanism?.contactGraphRowsConsumed !== false ||
      pattern.starts?.length !== 1 ||
      pattern.seedRows?.length !== 1 ||
      pattern.selected !== null ||
      patternFloor?.maximumPhysicalResidual !== 0.001615326586
    ) throw new Error('restoration assay rejects substituted coordinate-search floor');
    if (
      homotopy.schema !== 'kaminos.nbody-localized-constraint-homotopy-result.v0' ||
      homotopy.status !== 'complete-stalled-before-full-clearance' ||
      homotopy.route?.effective !== 'compiled-problem-clearance-homotopy' ||
      homotopy.route?.fallbackUsed !== false ||
      homotopy.source?.fixtureSha256 !== fixture.identity.sha256 ||
      homotopy.source?.problemSha256 !== problem.identity.sha256 ||
      homotopyFloor?.maximumPhysicalResidual !== 0.000945973079
    ) throw new Error('restoration assay rejects substituted homotopy floor');
    lastTrustworthyEvidence = {
      ...lastTrustworthyEvidence,
      phase:'problem-and-baselines-bound',
      fixtureSha256:fixture.identity.sha256,
      problemSha256:problem.identity.sha256,
      patternResultSha256:pattern.identity.sha256,
      homotopyResultSha256:homotopy.identity.sha256,
    };
    phase = 'solve-all-neighbor-restoration';
    const result = solveNBodyAllNeighborRestoration({
      problem,
      startVector:patternFloor.vector,
      requestedConfig:createNBodyAllNeighborRestorationConfig(),
    });
    phase = 'verify-restoration-result';
    if (
      result.route.effective !== 'all-neighbor-p8-merit-trust-region-restoration-v0' ||
      result.route.fallbackUsed !== false ||
      result.source.problemSha256 !== problem.identity.sha256 ||
      result.start.maximumPhysicalResidual !== patternFloor.maximumPhysicalResidual ||
      !(result.selected.maximumPhysicalResidual < homotopyFloor.maximumPhysicalResidual) ||
      result.mechanism.oracleTargetCoordinatesConsumed !== false ||
      result.mechanism.contactGraphRowsConsumed !== false ||
      result.invariance.candidateEnumeration !== 'passed'
    ) throw new Error('restoration assay result did not clear its exact admission predicate');
    phase = 'write-terminal-artifacts';
    const resultBytes = jsonBytes(result);
    const reportCore = {
      schema:NBODY_PACKING_RESTORATION_ASSAY_SCHEMA,
      status:'complete-mechanism-floor-improved',
      route:structuredClone(result.route),
      source:{
        fixtureSha256:fixture.identity.sha256,
        problemSha256:problem.identity.sha256,
        pattern:{ path:patternResultPath, fileSha256:sha256(patternBytes), resultSha256:pattern.identity.sha256 },
        homotopy:{ path:homotopyResultPath, fileSha256:sha256(homotopyBytes), resultSha256:homotopy.identity.sha256 },
      },
      comparison:{
        coordinateSearchFloor:patternFloor.maximumPhysicalResidual,
        homotopyFloor:homotopyFloor.maximumPhysicalResidual,
        restorationResidual:result.selected.maximumPhysicalResidual,
        improvementVersusCoordinateSearch:
          patternFloor.maximumPhysicalResidual / result.selected.maximumPhysicalResidual,
        improvementVersusHomotopy:
          homotopyFloor.maximumPhysicalResidual / result.selected.maximumPhysicalResidual,
      },
      bindings:{ resultJsonSha256:sha256(resultBytes), resultSha256:result.identity.sha256 },
      claimCeiling:result.claimCeiling,
    };
    const report = {
      ...reportCore,
      identity:{ sha256:hashMusclePackingCanonicalJson(reportCore) },
    };
    await Promise.all([
      writeAtomically(path.join(outputRoot, 'result.json'), resultBytes),
      writeAtomically(path.join(outputRoot, 'run-report.json'), jsonBytes(report)),
    ]);
    return { outputRoot, result, report };
  } catch (error) {
    const failure = {
      schema:NBODY_PACKING_RESTORATION_ASSAY_SCHEMA,
      status:'failed',
      route:{
        requested:'all-neighbor-p8-merit-trust-region-restoration-v0',
        effective:null,
        fallbackUsed:false,
      },
      failurePhase:phase,
      lastTrustworthyEvidence,
      error:{ name:error.name, message:error.message },
    };
    await writeAtomically(path.join(outputRoot, 'run-report.json'), jsonBytes(failure));
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const outDir = process.argv[2] || 'artifacts/nbody-packing-all-neighbor-restoration-v0';
  const { outputRoot, report } = await runNBodyPackingRestorationAssay({ outDir });
  process.stdout.write(`${JSON.stringify({ outputRoot, report }, null, 2)}\n`);
}
