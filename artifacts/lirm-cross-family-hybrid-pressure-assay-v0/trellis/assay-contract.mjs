import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

import {
  GESTALT_TRELLIS_JOB_TYPE,
  GESTALT_TRELLIS_RUNNER,
  GESTALT_WITNESS_JOB_TYPE,
  GESTALT_WITNESS_RUNNER,
} from '../../../lirm-speciation-gestalt-imagegen-core.mjs';

export const CROSS_FAMILY_HYBRID_TRELLIS_PLAN_SCHEMA = 'kaminos.lirm-cross-family-hybrid-trellis-promotion-plan.v0';

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
  }
  return value;
}

function fingerprint(value) {
  return `sha256:${createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')}`;
}

export function trellisSubmissionFingerprint(cell) {
  return fingerprint({
    cellId: cell.cellId,
    evidenceRole: cell.evidenceRole,
    jobType: cell.jobType,
    requestedRoute: cell.requestedRoute,
    expectedRunner: cell.expectedRunner,
    input: cell.input,
    outputDir: cell.outputDir,
    outputPath: cell.outputPath,
    settings: cell.settings,
  });
}

export function witnessSubmissionFingerprint(cell) {
  return fingerprint({
    witnessId: cell.witnessId,
    cellId: cell.cellId,
    evidenceRole: cell.evidenceRole,
    jobType: cell.jobType,
    requestedRoute: cell.requestedRoute,
    expectedRunner: cell.expectedRunner,
    input: cell.input,
    witnessScript: cell.witnessScript,
    outputDir: cell.outputDir,
    outputPath: cell.outputPath,
    view: cell.view,
    yaw: cell.yaw,
    pitch: cell.pitch,
  });
}

export function recoverMatchingSubmissions({ cells, priorSubmitted, idKey, fingerprintFor }) {
  const currentById = new Map(cells.map(cell => [cell[idKey], cell]));
  const recovered = [];
  const staleRecoveredSubmissions = [];
  for (const prior of priorSubmitted ?? []) {
    const cell = currentById.get(prior[idKey]);
    const currentFingerprint = cell ? fingerprintFor(cell) : null;
    if (cell && prior.submissionFingerprint === currentFingerprint) {
      recovered.push(prior);
    } else {
      staleRecoveredSubmissions.push({
        [idKey]: prior[idKey],
        jobId: prior.jobId,
        storedFingerprint: prior.submissionFingerprint ?? null,
        currentFingerprint,
        reason: cell ? 'submission-fingerprint-mismatch' : 'submission-id-not-in-current-plan',
      });
    }
  }
  return { recovered, staleRecoveredSubmissions };
}

const SETTINGS = Object.freeze({
  seed: 42,
  resolution: 512,
  steps: 6,
  cascade: false,
  targetFaces: 200000,
  textureSize: 1024,
  simplifyFirst: true,
});

const WITNESS_VIEWS = Object.freeze([
  { view: 'left', yaw: -0.85, pitch: 0.2 },
  { view: 'front', yaw: 0, pitch: 0.2 },
  { view: 'right', yaw: 0.85, pitch: 0.2 },
  { view: 'opposite', yaw: 3.141593, pitch: 0.2 },
]);

async function fileEvidence(path) {
  const bytes = await readFile(path);
  const metadata = await stat(path);
  if (!metadata.isFile() || bytes.length === 0) throw new Error(`missing or empty promoted image: ${path}`);
  return {
    path: resolve(path),
    bytes: bytes.length,
    sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
  };
}

export async function buildCrossFamilyHybridTrellisPromotionPlan({
  imagegenPlan,
  imagegenCollection,
  adjudication,
  contactSheetReceipt,
  contactSheetRoot,
  durableImageRoot,
  outputRoot,
}) {
  if (imagegenPlan?.schema !== 'kaminos.lirm-cross-family-hybrid-imagegen-pressure-plan.v0') {
    throw new Error(`unexpected imagegen plan: ${imagegenPlan?.schema}`);
  }
  if (imagegenCollection?.schema !== 'kaminos.lirm-cross-family-hybrid-imagegen-collection.v0'
      || imagegenCollection.status !== 'complete-inspected') {
    throw new Error('rare gestalt imagegen collection is not complete and inspected');
  }
  if (adjudication?.schema !== 'kaminos.lirm-cross-family-hybrid-imagegen-adjudication.v0'
      || adjudication.status !== 'visually-inspected-promotion-selected'
      || adjudication.contactSheet?.inspectedAtOriginalResolution !== true) {
    throw new Error('rare gestalt Trellis promotion requires original-resolution visual adjudication');
  }
  if (contactSheetReceipt?.schema !== 'kaminos.lirm-cross-family-hybrid-imagegen-contact-sheet-receipt.v0'
      || contactSheetReceipt.status !== 'complete-inspected'
      || contactSheetReceipt.visualInspectionVerified !== true) {
    throw new Error('rare gestalt Trellis promotion requires the inspected contact sheet receipt');
  }
  if (!contactSheetReceipt.contactSheet?.sha256
      || adjudication.contactSheet?.sha256 !== contactSheetReceipt.contactSheet.sha256) {
    throw new Error('adjudication contact sheet hash drift');
  }
  if (!contactSheetRoot || !contactSheetReceipt.contactSheet?.path) {
    throw new Error('contact sheet live path is missing');
  }
  const resolvedContactSheetRoot = resolve(contactSheetRoot);
  const contactSheetPath = resolve(resolvedContactSheetRoot, contactSheetReceipt.contactSheet.path);
  const contactSheetRelativePath = relative(resolvedContactSheetRoot, contactSheetPath);
  if (contactSheetRelativePath.startsWith('..') || isAbsolute(contactSheetRelativePath)) {
    throw new Error('contact sheet live path escapes the artifact root');
  }
  let liveContactSheet;
  try {
    liveContactSheet = await fileEvidence(contactSheetPath);
  } catch (error) {
    throw new Error(`contact sheet live file is missing: ${contactSheetPath}`, { cause: error });
  }
  if (liveContactSheet.sha256 !== contactSheetReceipt.contactSheet.sha256) {
    throw new Error('contact sheet live file hash drift');
  }
  const sourceReceipts = new Map((contactSheetReceipt.sources ?? []).map(item => [item.cellId, item]));
  if (sourceReceipts.size !== imagegenCollection.accepted.length) {
    throw new Error('contact sheet source coverage does not match imagegen collection');
  }
  for (const completion of imagegenCollection.accepted) {
    const sourceReceipt = sourceReceipts.get(completion.cellId);
    if (!sourceReceipt
        || sourceReceipt.sha256 !== completion.output?.sha256
        || sourceReceipt.sha256 !== completion.durableOutput?.sha256) {
      throw new Error(`contact sheet source hash drift: ${completion.cellId}`);
    }
  }
  const selections = adjudication.trellisPromotion?.evidenceRoles;
  if (adjudication.trellisPromotion?.status !== 'selected'
      || !Array.isArray(selections) || selections.length !== 3) {
    throw new Error('cross-family hybrid Trellis promotion requires three evidence roles');
  }
  if (new Set(selections.map(item => item.cellId)).size !== 3
      || new Set(selections.map(item => item.role)).size !== 3) {
    throw new Error('cross-family hybrid Trellis evidence roles must be unique');
  }

  const planned = new Map(imagegenPlan.cells.map(cell => [cell.cellId, cell]));
  const accepted = new Map(imagegenCollection.accepted.map(entry => [entry.cellId, entry]));
  const cells = [];
  for (const selection of selections) {
    const source = planned.get(selection.cellId);
    const completion = accepted.get(selection.cellId);
    if (!source || !completion) throw new Error(`promoted image is not accepted: ${selection.cellId}`);
    const durablePath = resolve(durableImageRoot, `${selection.cellId}.png`);
    const input = await fileEvidence(durablePath);
    if (input.sha256 !== completion.output?.sha256
        || input.sha256 !== completion.durableOutput?.sha256) {
      throw new Error(`promoted image hash drift: ${selection.cellId}`);
    }
    const outputDir = resolve(outputRoot, selection.cellId);
    cells.push({
      cellId: selection.cellId,
      evidenceRole: selection.role,
      candidateId: source.candidateId,
      stance: source.stance,
      imagegenSeed: source.seed,
      referenceSet: source.referenceSet,
      jobType: GESTALT_TRELLIS_JOB_TYPE,
      requestedRoute: `gpu-greenroom/${GESTALT_TRELLIS_JOB_TYPE}`,
      expectedRunner: GESTALT_TRELLIS_RUNNER,
      input,
      outputDir,
      outputPath: resolve(outputDir, 'output.glb'),
      settings: { ...SETTINGS },
    });
  }
  return {
    schema: CROSS_FAMILY_HYBRID_TRELLIS_PLAN_SCHEMA,
    status: 'planned',
    comparisonContract: {
      kind: 'three-cross-family-hybrid-spatial-survival-probes',
      evidenceRoles: selections.map(item => ({ ...item })),
      fixedSettings: { ...SETTINGS },
      loadBearingDiscriminators: [
        'annular aperture remains open through opposite views',
        'dorsal canopy remains independently legible from the annular frame',
        'sparse tripod support field remains grounded and spatially separated',
        'suspended anatomy remains distinct inside the aperture rather than becoming surface relief',
        'imagegen invention remains recognizably composed from both parent topologies',
      ],
    },
    evidencePredicate: {
      directInferenceForbidden: true,
      routeFallbackAllowed: false,
      missingGlbCountsAsSuccess: false,
      sourceHashDriftAllowed: false,
      spatialCoherenceRequiresRenderedWitness: true,
      frontViewOnlyDoesNotSatisfy: true,
    },
    cells,
  };
}

export async function buildCrossFamilyHybridTrellisWitnessPlan({
  trellisPlan,
  trellisCompletion,
  witnessScript,
  outputRoot,
}) {
  if (trellisPlan?.schema !== CROSS_FAMILY_HYBRID_TRELLIS_PLAN_SCHEMA || trellisPlan.status !== 'planned') {
    throw new Error(`unexpected rare gestalt Trellis plan: ${trellisPlan?.schema}/${trellisPlan?.status}`);
  }
  if (trellisCompletion?.schema !== 'kaminos.lirm-cross-family-hybrid-trellis-collection.v0'
      || trellisCompletion.status !== 'complete-glbs-unwitnessed') {
    throw new Error(`rare gestalt Trellis completion is not witnessable: ${trellisCompletion?.status}`);
  }
  const accepted = new Map(trellisCompletion.accepted.map(item => [item.cellId, item]));
  if (accepted.size !== trellisPlan.cells.length) throw new Error('accepted rare gestalt GLB count does not match plan');
  const script = await fileEvidence(witnessScript);
  const cells = [];
  for (const source of trellisPlan.cells) {
    const completion = accepted.get(source.cellId);
    if (!completion) throw new Error(`missing accepted rare gestalt GLB: ${source.cellId}`);
    const input = await fileEvidence(completion.output.path);
    if (input.sha256 !== completion.output.sha256) throw new Error(`durable rare gestalt GLB hash drift: ${source.cellId}`);
    if (completion.evidenceRole !== source.evidenceRole) throw new Error(`rare gestalt evidence role drift: ${source.cellId}`);
    for (const witnessView of WITNESS_VIEWS) {
      const outputDir = resolve(outputRoot, source.cellId, witnessView.view);
      cells.push({
        witnessId: `${source.cellId}-${witnessView.view}`,
        cellId: source.cellId,
        evidenceRole: source.evidenceRole,
        candidateId: source.candidateId,
        stance: source.stance,
        imagegenSeed: source.imagegenSeed,
        jobType: GESTALT_WITNESS_JOB_TYPE,
        expectedRunner: GESTALT_WITNESS_RUNNER,
        requestedRoute: `gpu-greenroom/${GESTALT_WITNESS_JOB_TYPE}`,
        input,
        witnessScript: script,
        outputDir,
        outputPath: resolve(outputDir, 'render.png'),
        ...witnessView,
      });
    }
  }
  return {
    schema: 'kaminos.lirm-cross-family-hybrid-trellis-witness-plan.v0',
    status: 'planned',
    requiredViews: WITNESS_VIEWS.map(item => ({ ...item })),
    evidencePredicate: {
      expectedWitnessCount: trellisPlan.cells.length * WITNESS_VIEWS.length,
      blankOrMissingFrameCountsAsSuccess: false,
      routeFallbackAllowed: false,
      apertureAndSuspensionRequireOppositeViewInspection: true,
      spatialClaimRequiresHumanVisualInspection: true,
    },
    cells,
  };
}
