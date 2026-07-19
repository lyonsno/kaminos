import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

import {
  LIRM_ARMATURE_PROGRAM_IMPLICIT_BODY_ROUTE,
  writeLirmArmatureProgramImplicitBodyWitness,
} from '../../lirm-speciation-armature-core.js';
import {
  CROSS_FAMILY_HYBRID_CANDIDATES,
} from '../../lirm-cross-family-rare-gestalt-armature-program.mjs';

const LOAD_BEARING_COMMITMENTS = Object.freeze([
  'open-annular-aperture',
  'independent-dorsal-canopy',
  'sparse-tripod-support-field',
  'spatially-distinct-suspended-anatomy',
  'silhouette-distinct-from-both-parent-families',
]);

export const CROSS_FAMILY_HYBRID_PRESSURE_CANDIDATES = Object.freeze(
  CROSS_FAMILY_HYBRID_CANDIDATES.map(item => Object.freeze({
    ...item,
    loadBearingCommitments: LOAD_BEARING_COMMITMENTS,
  })),
);

export async function writeCrossFamilyHybridPressureWitness({
  outDir = new URL('.', import.meta.url).pathname,
  pixelWidth = 288,
  pixelHeight = 256,
  candidates = CROSS_FAMILY_HYBRID_PRESSURE_CANDIDATES,
} = {}) {
  await mkdir(outDir, { recursive: true });
  const receiptPath = join(outDir, 'receipt.json');
  const initialized = {
    schema: 'kaminos.lirm-cross-family-hybrid-pressure-witness.v0',
    status: 'running',
    phase: 'writer-initialized',
    failurePhase: null,
    requestedRoute: LIRM_ARMATURE_PROGRAM_IMPLICIT_BODY_ROUTE,
    effectiveRoute: null,
    requestedConfig: { pixelWidth, pixelHeight },
    requestedCandidateIds: candidates.map(item => item.id),
    comparisonContract: {
      parentFamilies: [
        'kaminos.lirm-armature-program.annular-tripod.v0',
        'kaminos.lirm-armature-program.tripod-canopy.v0',
      ],
      minimumCommitmentsPerCandidate: 4,
      requiredCommitments: [...LOAD_BEARING_COMMITMENTS],
    },
    candidates: [],
    visualInspectionClaim: 'not-yet-inspected',
    lastTrustworthyEvidence: 'invocation recorded; no hybrid control witness accepted',
  };
  await writeFile(receiptPath, `${JSON.stringify(initialized, null, 2)}\n`);
  let phase = 'candidate-validation';
  try {
    if (!Array.isArray(candidates) || candidates.length === 0) throw new Error('hybrid pressure witness requires candidates');
    const ids = new Set();
    for (const item of candidates) {
      if (!/^[a-z0-9][a-z0-9-]*$/.test(item.id) || ids.has(item.id)) {
        throw new Error(`invalid or duplicate candidate id: ${item.id}`);
      }
      ids.add(item.id);
      if (item.program?.id !== 'kaminos.lirm-armature-program.annular-canopy-hybrid.v0') {
        throw new Error(`candidate uses wrong hybrid program: ${item.id}`);
      }
      if (!item.lineagePressure) throw new Error(`candidate omitted lineage pressure: ${item.id}`);
      if (!Array.isArray(item.loadBearingCommitments)
          || item.loadBearingCommitments.length < initialized.comparisonContract.minimumCommitmentsPerCandidate) {
        throw new Error(`candidate omitted load-bearing commitments: ${item.id}`);
      }
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
        loadBearingCommitments: [...item.loadBearingCommitments],
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
        parentReversionCountsAsSuccess: false,
        preservingOnlyOneParentCommitmentCountsAsSuccess: false,
        generatorFiringClaim: 'forbidden',
        finishedCreatureClaim: 'forbidden',
        visualSelectionRequiresInspection: true,
      },
      lastTrustworthyEvidence: `${accepted.length} cross-family hybrid control packages written with per-output byte and hash evidence; visual inspection pending`,
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
