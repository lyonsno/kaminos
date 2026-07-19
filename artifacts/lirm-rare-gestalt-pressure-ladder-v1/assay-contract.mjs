import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

import {
  LIRM_ARMATURE_PROGRAM_IMPLICIT_BODY_ROUTE,
  writeLirmArmatureProgramImplicitBodyWitness,
} from '../../lirm-speciation-armature-core.js';
import {
  ANNULAR_TRIPOD_ARMATURE_PROGRAM,
  TRIPOD_CANOPY_ARMATURE_PROGRAM,
} from '../../lirm-rare-gestalt-armature-programs.mjs';

const initialParameters = program => Object.fromEntries(
  program.parameterSpecs.map(spec => [spec.id, spec.initial]),
);

const candidate = (id, program, overrides, lineagePressure) => Object.freeze({
  id,
  program,
  parameters: Object.freeze({ ...initialParameters(program), ...overrides }),
  lineagePressure,
});

export const RARE_GESTALT_PRESSURE_CANDIDATES = Object.freeze([
  candidate(
    'annular-tripod-open-crown',
    ANNULAR_TRIPOD_ARMATURE_PROGRAM,
    {},
    'baseline rejoining loop topology with a load-bearing aperture and tripod grounding',
  ),
  candidate(
    'annular-tripod-wide-slant',
    ANNULAR_TRIPOD_ARMATURE_PROGRAM,
    {
      apertureWidth: 1.22,
      apertureHeight: 0.76,
      ringSkew: 0.22,
      ringTwist: 0.18,
      sensoryAngle: 0.42,
      supportSpread: 0.86,
    },
    'wide low aperture, slanted loop, and displaced sensory mass without quadruped fallback',
  ),
  candidate(
    'annular-tripod-tall-keyhole',
    ANNULAR_TRIPOD_ARMATURE_PROGRAM,
    {
      apertureWidth: 0.7,
      apertureHeight: 1.24,
      ringTwist: 0.24,
      ringSkew: -0.12,
      sensoryAngle: 1.08,
      supportForeAft: 0.46,
    },
    'tall keyhole aperture with depth divergence and an elevated off-axis sensory lobe',
  ),
  candidate(
    'tripod-canopy-suspended',
    TRIPOD_CANOPY_ARMATURE_PROGRAM,
    {},
    'baseline top-heavy canopy with a distinct suspended sensory body and three supports',
  ),
  candidate(
    'tripod-canopy-wide-low-pendant',
    TRIPOD_CANOPY_ARMATURE_PROGRAM,
    {
      canopyWidth: 1.78,
      canopyHeight: 0.32,
      canopyArch: 0.12,
      pendantDrop: 0.76,
      pendantForward: 0.5,
      supportSpread: 0.86,
    },
    'extreme table-like canopy with a low hanging head and a sparse tripod silhouette',
  ),
  candidate(
    'tripod-canopy-asymmetric-deep',
    TRIPOD_CANOPY_ARMATURE_PROGRAM,
    {
      canopyWidth: 1.28,
      canopyDepth: 1.28,
      canopyArch: 0.36,
      canopyAsymmetry: 0.3,
      pendantDrop: 0.62,
      pendantForward: 0.58,
      supportForeAft: 0.54,
    },
    'deep asymmetric canopy that tests whether depth-heavy gestalt remains readable from one conditioning view',
  ),
]);

export async function writeRareGestaltPressureWitness({
  outDir = new URL('.', import.meta.url).pathname,
  pixelWidth = 256,
  pixelHeight = 224,
  candidates = RARE_GESTALT_PRESSURE_CANDIDATES,
} = {}) {
  await mkdir(outDir, { recursive: true });
  const receiptPath = join(outDir, 'receipt.json');
  const initialized = {
    schema: 'kaminos.lirm-rare-gestalt-pressure-witness.v0',
    status: 'running',
    phase: 'writer-initialized',
    failurePhase: null,
    requestedRoute: LIRM_ARMATURE_PROGRAM_IMPLICIT_BODY_ROUTE,
    effectiveRoute: null,
    requestedConfig: { pixelWidth, pixelHeight },
    requestedCandidateIds: candidates.map(item => item.id),
    candidates: [],
    visualInspectionClaim: 'not-yet-inspected',
    lastTrustworthyEvidence: 'invocation recorded; no control witness accepted',
  };
  await writeFile(receiptPath, `${JSON.stringify(initialized, null, 2)}\n`);
  let phase = 'candidate-validation';
  try {
    if (!Array.isArray(candidates) || candidates.length === 0) throw new Error('rare gestalt witness requires candidates');
    const ids = new Set();
    for (const item of candidates) {
      if (!/^[a-z0-9][a-z0-9-]*$/.test(item.id) || ids.has(item.id)) throw new Error(`invalid or duplicate candidate id: ${item.id}`);
      ids.add(item.id);
      if (!item.lineagePressure) throw new Error(`candidate omitted lineage pressure: ${item.id}`);
    }
    phase = 'control-witness-write';
    const accepted = [];
    for (const item of candidates) {
      const candidateOutDir = join(outDir, 'candidates', item.id);
      const result = await writeLirmArmatureProgramImplicitBodyWitness({
        outDir: candidateOutDir,
        armatureProgram: item.program,
        parameters: item.parameters,
        candidateId: item.id,
        pixelWidth,
        pixelHeight,
      });
      const receipt = JSON.parse(await readFile(result.receiptPath, 'utf8'));
      if (receipt.status !== 'complete') throw new Error(`candidate witness incomplete: ${item.id}`);
      accepted.push({
        id: item.id,
        armatureProgramId: item.program.id,
        lineagePressure: item.lineagePressure,
        receiptPath: relative(outDir, result.receiptPath),
        receipt,
      });
    }
    const completed = {
      ...initialized,
      status: 'complete-uninspected',
      phase: 'control-witnesses-written',
      effectiveRoute: LIRM_ARMATURE_PROGRAM_IMPLICIT_BODY_ROUTE,
      effectiveConfig: { pixelWidth, pixelHeight },
      candidates: accepted,
      falseClosureGuards: {
        blankOrMissingControlCountsAsSuccess: false,
        generatorFiringClaim: 'forbidden',
        finishedCreatureClaim: 'forbidden',
        visualSelectionRequiresInspection: true,
      },
      lastTrustworthyEvidence: `${accepted.length} implicit-body control packages written with per-output byte and hash evidence; visual inspection pending`,
    };
    await writeFile(receiptPath, `${JSON.stringify(completed, null, 2)}\n`);
    return completed;
  } catch (error) {
    await writeFile(receiptPath, `${JSON.stringify({
      ...initialized,
      status: 'failed',
      phase: 'failed',
      failurePhase: phase,
      errorMessage: error.message,
      lastTrustworthyEvidence: phase === 'candidate-validation'
        ? 'invocation recorded; no candidate accepted'
        : 'candidate definitions accepted; one or more control witnesses incomplete',
    }, null, 2)}\n`);
    throw error;
  }
}
