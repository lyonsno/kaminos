import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { basename, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  GESTALT_TRELLIS_JOB_TYPE,
  GESTALT_TRELLIS_RUNNER,
  GESTALT_WITNESS_JOB_TYPE,
  GESTALT_WITNESS_RUNNER,
} from '../../../lirm-speciation-gestalt-imagegen-core.mjs';

export const HERITABLE_LINEAGE_TRELLIS_PLAN_SCHEMA = 'kaminos.lirm-heritable-hybrid-lineage-trellis-promotion-plan.v0';

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
    lineageId: cell.lineageId,
    generation: cell.generation,
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
    lineageId: cell.lineageId,
    generation: cell.generation,
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

function witnessInspectionEvidence(completion) {
  return {
    witnessId: completion.witnessId,
    cellId: completion.cellId,
    view: completion.view,
    yaw: completion.yaw,
    pitch: completion.pitch,
    requestedRoute: completion.requestedRoute,
    effectiveJobType: completion.effectiveJobType,
    effectiveRoute: completion.effectiveRoute,
    effectiveParams: completion.effectiveParams,
    input: completion.input && {
      bytes: completion.input.bytes,
      sha256: completion.input.sha256,
    },
    witnessScript: completion.witnessScript && {
      bytes: completion.witnessScript.bytes,
      sha256: completion.witnessScript.sha256,
    },
    output: completion.output && {
      bytes: completion.output.bytes,
      sha256: completion.output.sha256,
    },
  };
}

export function preserveIdenticalWitnessInspectionState({ prior, current }) {
  if (prior?.schema !== current?.schema
      || prior.status !== 'complete-frames-inspected'
      || prior.visualInspectionClaim !== 'inspected'
      || current.status !== 'complete-frames-uninspected'
      || current.visualInspectionClaim !== 'not-yet-inspected'
      || current.rejected?.length !== 0
      || current.nonterminal?.length !== 0
      || !Array.isArray(prior.accepted)
      || !Array.isArray(current.accepted)
      || prior.accepted.length !== current.accepted.length) {
    return current;
  }
  const sortedEvidence = accepted => accepted
    .map(witnessInspectionEvidence)
    .sort((left, right) => left.witnessId.localeCompare(right.witnessId));
  if (fingerprint(sortedEvidence(prior.accepted)) !== fingerprint(sortedEvidence(current.accepted))) {
    return current;
  }
  return {
    ...current,
    status: 'complete-frames-inspected',
    visualInspectionClaim: 'inspected',
    lastTrustworthyEvidence: `${current.accepted.length}/${current.requestedCount} unchanged route-validated witness frames retain prior joint visual inspection`,
  };
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

const EXPECTED_PROMOTION_ROLES = Object.freeze([
  'founder-spatial-baseline',
  'cleft-crown-terminal',
  'stilted-keel-terminal',
  'lateral-sail-terminal',
]);

const SPATIAL_VERDICT_CLAIM = 'A procedural founder can be cumulatively mutated into distinct terminal armatures whose ancestry and branch-specific gestalt survive fixed image hallucination and fixed Trellis conversion as coherent spatial creatures.';

const SPATIAL_VERDICT_KEYS = Object.freeze([
  'allCastsSpatiallyCoherent',
  'ancestryPreserved',
  'annularAperturePreservedAcrossAllCasts',
  'claim',
  'exactSupportCountPreserved',
  'spatiallySeparateInteriorAnatomyPreservedAcrossAllCasts',
  'terminalDivergencePreserved',
]);

async function fileEvidence(path, label = 'promoted image') {
  const bytes = await readFile(path);
  const metadata = await stat(path);
  if (!metadata.isFile() || bytes.length === 0) throw new Error(`missing or empty ${label}: ${path}`);
  return {
    path: resolve(path),
    bytes: bytes.length,
    sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
  };
}

function rootPath(root) {
  return root instanceof URL ? fileURLToPath(root) : root;
}

function containedPath(root, path, label) {
  const resolvedRoot = resolve(rootPath(root));
  const resolvedPath = resolve(resolvedRoot, path);
  const relativePath = relative(resolvedRoot, resolvedPath);
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error(`${label} escapes the artifact root`);
  }
  return resolvedPath;
}

function sameFileEvidence(actual, expected) {
  return actual?.path === expected?.path
    && actual?.bytes === expected?.bytes
    && actual?.sha256 === expected?.sha256;
}

function assertPromotionRoles(selections) {
  if (!Array.isArray(selections) || selections.length !== EXPECTED_PROMOTION_ROLES.length) {
    throw new Error('heritable lineage Trellis promotion requires founder and three terminal lineages');
  }
  const roles = selections.map(item => item.role);
  if (new Set(roles).size !== EXPECTED_PROMOTION_ROLES.length
      || !EXPECTED_PROMOTION_ROLES.every(role => roles.includes(role))) {
    throw new Error('heritable lineage Trellis promotion requires founder and three terminal lineages with exact evidence roles');
  }
  const founder = selections.find(item => item.role === 'founder-spatial-baseline');
  const terminals = selections.filter(item => item.role !== 'founder-spatial-baseline');
  if (founder?.generation !== 0
      || terminals.some(item => item.generation !== 3)
      || new Set(selections.map(item => item.cellId)).size !== 4
      || new Set(terminals.map(item => item.lineageId)).size !== 3) {
    throw new Error('heritable lineage Trellis promotion requires founder and three terminal lineages with exact generations');
  }
}

export async function buildHeritableLineageTrellisPromotionPlan({
  imagegenPlan,
  imagegenCollection,
  adjudication,
  contactSheetReceipt,
  contactSheetRoot,
  durableImageRoot,
  outputRoot,
}) {
  if (imagegenPlan?.schema !== 'kaminos.lirm-heritable-hybrid-lineage-imagegen-plan.v0'
      || imagegenPlan.status !== 'planned') {
    throw new Error(`unexpected heritable lineage imagegen plan: ${imagegenPlan?.schema}/${imagegenPlan?.status}`);
  }
  if (imagegenCollection?.schema !== 'kaminos.lirm-heritable-hybrid-lineage-imagegen-collection.v0'
      || imagegenCollection.status !== 'complete-inspected'
      || imagegenCollection.visualInspectionClaim !== 'inspected') {
    throw new Error('heritable lineage imagegen collection is not complete and inspected');
  }
  if (adjudication?.schema !== 'kaminos.lirm-heritable-hybrid-lineage-imagegen-adjudication.v0'
      || adjudication.status !== 'visually-inspected-promotion-selected'
      || adjudication.contactSheet?.inspectedAtOriginalResolution !== true) {
    throw new Error('heritable lineage Trellis promotion requires original-resolution visual adjudication');
  }
  if (contactSheetReceipt?.schema !== 'kaminos.lirm-heritable-hybrid-lineage-imagegen-contact-sheet-receipt.v0'
      || contactSheetReceipt.status !== 'complete-inspected'
      || contactSheetReceipt.visualInspectionVerified !== true
      || contactSheetReceipt.visualInspectionClaim !== 'inspected') {
    throw new Error('heritable lineage Trellis promotion requires the inspected contact sheet receipt');
  }
  if (!contactSheetReceipt.contactSheet?.sha256
      || adjudication.contactSheet?.sha256 !== contactSheetReceipt.contactSheet.sha256) {
    throw new Error('adjudication contact sheet hash drift');
  }

  const resolvedContactSheetRoot = resolve(contactSheetRoot);
  const contactSheetPath = resolve(resolvedContactSheetRoot, contactSheetReceipt.contactSheet.path);
  const relativeContactSheet = relative(resolvedContactSheetRoot, contactSheetPath);
  if (relativeContactSheet.startsWith('..') || isAbsolute(relativeContactSheet)) {
    throw new Error('contact sheet live path escapes the artifact root');
  }
  const liveContactSheet = await fileEvidence(contactSheetPath, 'contact sheet');
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
  if (adjudication.trellisPromotion?.status !== 'selected') {
    throw new Error('heritable lineage Trellis promotion selection is absent');
  }
  assertPromotionRoles(selections);

  const planned = new Map(imagegenPlan.cells.map(cell => [cell.cellId, cell]));
  const accepted = new Map(imagegenCollection.accepted.map(entry => [entry.cellId, entry]));
  const cells = [];
  for (const selection of selections) {
    const source = planned.get(selection.cellId);
    const completion = accepted.get(selection.cellId);
    if (!source || !completion) throw new Error(`promoted lineage image is not accepted: ${selection.cellId}`);
    if (source.candidateId !== selection.candidateId
        || source.lineageId !== selection.lineageId
        || source.generation !== selection.generation) {
      throw new Error(`promoted lineage metadata drift: ${selection.cellId}`);
    }
    const input = await fileEvidence(resolve(durableImageRoot, `${selection.cellId}.png`));
    if (input.sha256 !== selection.sha256
        || input.sha256 !== completion.output?.sha256
        || input.sha256 !== completion.durableOutput?.sha256) {
      throw new Error(`promoted lineage image hash drift: ${selection.cellId}`);
    }
    const outputDir = resolve(outputRoot, selection.cellId);
    cells.push({
      cellId: selection.cellId,
      evidenceRole: selection.role,
      candidateId: source.candidateId,
      lineageId: source.lineageId,
      generation: source.generation,
      parentId: source.parentId,
      inheritedCommitments: [...source.inheritedCommitments],
      inheritedMutations: [...source.inheritedMutations],
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
    schema: HERITABLE_LINEAGE_TRELLIS_PLAN_SCHEMA,
    status: 'planned',
    comparisonContract: {
      kind: 'founder-versus-three-heritable-terminal-spatial-survival-probes',
      evidenceRoles: selections.map(item => ({ ...item })),
      fixedSettings: { ...SETTINGS },
      loadBearingDiscriminators: [
        'the founder annular aperture remains open through opposite views',
        'the suspended interior organ remains spatially distinct from the annular body',
        'the cleft terminal retains a split horned crown and multiplied suspended organs',
        'the stilt terminal retains its widened articulated support field and ventral keel',
        'the sail terminal retains its widened annulus and lateral sensory spars',
        'all terminals remain recognizably descended from the founder while occupying distinct spatial gestalts',
      ],
    },
    evidencePredicate: {
      directInferenceForbidden: true,
      routeFallbackAllowed: false,
      missingGlbCountsAsSuccess: false,
      sourceHashDriftAllowed: false,
      spatialCoherenceRequiresRenderedWitness: true,
      frontViewOnlyDoesNotSatisfy: true,
      imageSpaceInheritanceDoesNotSatisfy: true,
    },
    cells,
  };
}

export async function buildHeritableLineageTrellisWitnessPlan({
  trellisPlan,
  trellisCompletion,
  witnessScript,
  outputRoot,
}) {
  if (trellisPlan?.schema !== HERITABLE_LINEAGE_TRELLIS_PLAN_SCHEMA || trellisPlan.status !== 'planned') {
    throw new Error(`unexpected heritable lineage Trellis plan: ${trellisPlan?.schema}/${trellisPlan?.status}`);
  }
  if (trellisCompletion?.schema !== 'kaminos.lirm-heritable-hybrid-lineage-trellis-collection.v0'
      || trellisCompletion.status !== 'complete-glbs-unwitnessed') {
    throw new Error(`heritable lineage Trellis completion is not witnessable: ${trellisCompletion?.status}`);
  }
  const accepted = new Map(trellisCompletion.accepted.map(item => [item.cellId, item]));
  if (accepted.size !== trellisPlan.cells.length) throw new Error('accepted heritable lineage GLB count does not match plan');
  const script = await fileEvidence(witnessScript, 'witness script');
  const cells = [];
  for (const source of trellisPlan.cells) {
    const completion = accepted.get(source.cellId);
    if (!completion) throw new Error(`missing accepted heritable lineage GLB: ${source.cellId}`);
    const input = await fileEvidence(completion.output.path, 'durable heritable lineage GLB');
    if (input.sha256 !== completion.output.sha256) throw new Error(`durable heritable lineage GLB hash drift: ${source.cellId}`);
    if (completion.evidenceRole !== source.evidenceRole
        || completion.lineageId !== source.lineageId
        || completion.generation !== source.generation) {
      throw new Error(`heritable lineage completion metadata drift: ${source.cellId}`);
    }
    for (const witnessView of WITNESS_VIEWS) {
      const outputDir = resolve(outputRoot, source.cellId, witnessView.view);
      cells.push({
        witnessId: `${source.cellId}-${witnessView.view}`,
        cellId: source.cellId,
        evidenceRole: source.evidenceRole,
        candidateId: source.candidateId,
        lineageId: source.lineageId,
        generation: source.generation,
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
    schema: 'kaminos.lirm-heritable-hybrid-lineage-trellis-witness-plan.v0',
    status: 'planned',
    requiredViews: WITNESS_VIEWS.map(item => ({ ...item })),
    evidencePredicate: {
      expectedWitnessCount: trellisPlan.cells.length * WITNESS_VIEWS.length,
      blankOrMissingFrameCountsAsSuccess: false,
      routeFallbackAllowed: false,
      annulusAndSuspensionRequireOppositeViewInspection: true,
      terminalDivergenceRequiresCrossAssetComparison: true,
      spatialClaimRequiresHumanVisualInspection: true,
    },
    cells,
  };
}

export async function validateHeritableLineageSpatialEvidence({
  artifactRoot,
  adjudication,
  trellisCompletion,
  witnessPlan,
  witnessCompletion,
  witnessReceipt,
}) {
  if (adjudication?.schema !== 'kaminos.lirm-heritable-hybrid-lineage-spatial-adjudication.v0'
      || adjudication.status !== 'spatial-lineage-hit-with-bounded-drift') {
    throw new Error(`unexpected spatial adjudication authority: ${adjudication?.schema}/${adjudication?.status}`);
  }
  if (trellisCompletion?.schema !== 'kaminos.lirm-heritable-hybrid-lineage-trellis-collection.v0'
      || trellisCompletion.status !== 'complete-glbs-witnessed-inspected'
      || !Array.isArray(trellisCompletion.accepted)
      || trellisCompletion.accepted.length !== EXPECTED_PROMOTION_ROLES.length) {
    throw new Error('spatial adjudication requires exactly four witnessed and inspected Trellis casts');
  }
  if (witnessCompletion?.schema !== 'kaminos.lirm-heritable-hybrid-lineage-trellis-witness-collection.v0'
      || witnessCompletion.status !== 'complete-frames-inspected'
      || witnessCompletion.visualInspectionClaim !== 'inspected'
      || !Array.isArray(witnessCompletion.accepted)
      || witnessCompletion.accepted.length !== EXPECTED_PROMOTION_ROLES.length * WITNESS_VIEWS.length) {
    throw new Error('spatial adjudication requires exactly sixteen witness frames with inspected completion state');
  }
  if (witnessPlan?.schema !== 'kaminos.lirm-heritable-hybrid-lineage-trellis-witness-plan.v0'
      || witnessPlan.status !== 'planned'
      || !Array.isArray(witnessPlan.cells)
      || witnessPlan.cells.length !== EXPECTED_PROMOTION_ROLES.length * WITNESS_VIEWS.length) {
    throw new Error('spatial adjudication requires the exact persisted sixteen-frame witness plan');
  }
  if (witnessReceipt?.schema !== 'kaminos.lirm-heritable-hybrid-lineage-trellis-witness-contact-sheet.v0'
      || witnessReceipt.status !== 'complete-inspected'
      || witnessReceipt.visualInspectionClaim !== 'inspected') {
    throw new Error('spatial adjudication requires an inspected witness receipt');
  }

  if (adjudication.witnessSheet?.inspectedAtOriginalResolution !== true
      || adjudication.witnessSheet?.sourceFrameCount !== 16
      || adjudication.witnessSheet?.sha256 !== witnessReceipt.sheet?.sha256) {
    throw new Error('witness sheet hash drift between adjudication and inspected receipt');
  }
  const sheet = await fileEvidence(
    containedPath(artifactRoot, adjudication.witnessSheet.path, 'witness sheet'),
    'witness sheet',
  );
  if (sheet.sha256 !== adjudication.witnessSheet.sha256 || sheet.bytes !== witnessReceipt.sheet?.bytes) {
    throw new Error('witness sheet hash drift from live artifact');
  }

  const expectedTrellisRoute = `gpu-greenroom/${GESTALT_TRELLIS_JOB_TYPE}`;
  if (adjudication.routeEvidence?.requestedRoute !== expectedTrellisRoute
      || adjudication.routeEvidence?.effectiveJobType !== GESTALT_TRELLIS_JOB_TYPE
      || adjudication.routeEvidence?.effectiveRunner !== GESTALT_TRELLIS_RUNNER
      || JSON.stringify(adjudication.routeEvidence?.settings) !== JSON.stringify(SETTINGS)) {
    throw new Error('spatial adjudication Trellis route or settings drift');
  }

  const castsByRole = new Map((adjudication.casts ?? []).map(cast => [cast.role, cast]));
  if (castsByRole.size !== EXPECTED_PROMOTION_ROLES.length
      || !EXPECTED_PROMOTION_ROLES.every(role => castsByRole.has(role))) {
    throw new Error('spatial adjudication cast roles drift');
  }
  const completionByCell = new Map();
  for (const completion of trellisCompletion.accepted) {
    if (completionByCell.has(completion.cellId)
        || completion.requestedRoute !== expectedTrellisRoute
        || completion.effectiveJobType !== GESTALT_TRELLIS_JOB_TYPE) {
      throw new Error(`Trellis route drift: ${completion.cellId}`);
    }
    completionByCell.set(completion.cellId, completion);
    const cast = castsByRole.get(completion.evidenceRole);
    if (!cast
        || cast.candidateId !== completion.candidateId
        || cast.glb?.sha256 !== completion.output?.sha256
        || cast.glb?.bytes !== completion.output?.bytes) {
      throw new Error(`cast hash drift: ${completion.cellId}`);
    }
    const liveCast = await fileEvidence(
      containedPath(artifactRoot, cast.glb.path, `cast ${completion.cellId}`),
      `cast ${completion.cellId}`,
    );
    if (liveCast.sha256 !== cast.glb.sha256 || liveCast.bytes !== cast.glb.bytes) {
      throw new Error(`cast hash drift from live artifact: ${completion.cellId}`);
    }
  }

  const expectedWitnessRoute = `gpu-greenroom/${GESTALT_WITNESS_JOB_TYPE}`;
  const requiredViews = new Map(WITNESS_VIEWS.map(item => [item.view, item]));
  const viewsByCell = new Map([...completionByCell.keys()].map(cellId => [cellId, new Set()]));
  const planByWitnessId = new Map(witnessPlan.cells.map(cell => [cell.witnessId, cell]));
  if (planByWitnessId.size !== witnessPlan.cells.length) throw new Error('witness plan contains duplicate witness ids');
  const receiptEvidenceByName = new Map((witnessReceipt.sourceEvidence ?? []).map(item => [basename(item.path), item]));
  if (receiptEvidenceByName.size !== 16) throw new Error('inspected witness receipt does not bind exactly sixteen source frames');
  const liveWitnessScripts = new Map();
  for (const completion of witnessCompletion.accepted) {
    const effectiveExecutable = String(completion.effectiveRoute ?? '').trim().split(/\s+/, 1)[0];
    const expectedView = requiredViews.get(completion.view);
    const planCell = planByWitnessId.get(completion.witnessId);
    const trellisSource = completionByCell.get(completion.cellId);
    if (completion.requestedRoute !== expectedWitnessRoute
        || completion.effectiveJobType !== GESTALT_WITNESS_JOB_TYPE
        || effectiveExecutable !== GESTALT_WITNESS_RUNNER
        || !trellisSource
        || !planCell
        || planCell.cellId !== completion.cellId
        || planCell.jobType !== GESTALT_WITNESS_JOB_TYPE
        || planCell.requestedRoute !== expectedWitnessRoute
        || planCell.expectedRunner !== GESTALT_WITNESS_RUNNER
        || !expectedView
        || planCell.view !== expectedView.view
        || planCell.yaw !== expectedView.yaw
        || planCell.pitch !== expectedView.pitch
        || completion.yaw !== expectedView.yaw
        || completion.pitch !== expectedView.pitch
        || String(completion.effectiveParams?.yaw) !== String(expectedView.yaw)
        || String(completion.effectiveParams?.pitch) !== String(expectedView.pitch)) {
      throw new Error(`witness route or view drift: ${completion.witnessId}`);
    }
    if (!sameFileEvidence(planCell.input, trellisSource.output)
        || !sameFileEvidence(completion.input, trellisSource.output)) {
      throw new Error(`witness input identity drift: ${completion.witnessId}`);
    }
    if (completion.effectiveParams?.witness_script !== planCell.witnessScript?.path
        || !sameFileEvidence(completion.witnessScript, planCell.witnessScript)) {
      throw new Error(`witness script identity drift: ${completion.witnessId}`);
    }
    let liveWitnessScript = liveWitnessScripts.get(planCell.witnessScript.path);
    if (!liveWitnessScript) {
      liveWitnessScript = await fileEvidence(planCell.witnessScript.path, 'witness script');
      liveWitnessScripts.set(planCell.witnessScript.path, liveWitnessScript);
    }
    if (!sameFileEvidence(liveWitnessScript, planCell.witnessScript)) {
      throw new Error(`witness script identity drift from live artifact: ${completion.witnessId}`);
    }
    const expectedName = `${completion.cellId}-${completion.view}.png`;
    if (basename(completion.output?.path ?? '') !== expectedName) {
      throw new Error(`witness output identity drift: ${completion.witnessId}`);
    }
    const cellViews = viewsByCell.get(completion.cellId);
    if (cellViews.has(completion.view)) throw new Error(`duplicate witness view: ${completion.witnessId}`);
    cellViews.add(completion.view);
    const receiptEvidence = receiptEvidenceByName.get(expectedName);
    if (!receiptEvidence
        || receiptEvidence.sha256 !== completion.output.sha256
        || receiptEvidence.bytes !== completion.output.bytes) {
      throw new Error(`witness receipt hash drift: ${completion.witnessId}`);
    }
    const liveFrame = await fileEvidence(
      containedPath(artifactRoot, `witness/frames/${expectedName}`, `witness frame ${completion.witnessId}`),
      `witness frame ${completion.witnessId}`,
    );
    if (liveFrame.sha256 !== completion.output.sha256 || liveFrame.bytes !== completion.output.bytes) {
      throw new Error(`witness frame hash drift from live artifact: ${completion.witnessId}`);
    }
  }
  if ([...viewsByCell.values()].some(views => views.size !== requiredViews.size)) {
    throw new Error('witness inventory lacks one or more required views');
  }

  const livePlanPath = containedPath(artifactRoot, 'witness-plan.json', 'persisted witness plan');
  const livePlanEvidence = await fileEvidence(livePlanPath, 'persisted witness plan');
  const persistedWitnessPlan = JSON.parse(await readFile(livePlanPath, 'utf8'));
  if (!sameFileEvidence(witnessReceipt.plan, livePlanEvidence)
      || fingerprint(witnessPlan) !== fingerprint(persistedWitnessPlan)) {
    throw new Error('persisted witness plan drift from inspected receipt or supplied authority');
  }
  const liveCompletionPath = containedPath(artifactRoot, 'witness-completion-report.json', 'persisted witness completion');
  const liveCompletionEvidence = await fileEvidence(liveCompletionPath, 'persisted witness completion');
  const persistedWitnessCompletion = JSON.parse(await readFile(liveCompletionPath, 'utf8'));
  if (!sameFileEvidence(witnessReceipt.completion, liveCompletionEvidence)
      || fingerprint(witnessCompletion) !== fingerprint(persistedWitnessCompletion)) {
    throw new Error('persisted witness completion drift from inspected receipt or supplied authority');
  }

  const verdict = adjudication.verdict;
  const verdictKeys = Object.keys(verdict ?? {}).sort();
  if (JSON.stringify(verdictKeys) !== JSON.stringify(SPATIAL_VERDICT_KEYS)) {
    throw new Error('spatial adjudication verdict keys drift');
  }
  if (verdict?.ancestryPreserved !== true
      || verdict.terminalDivergencePreserved !== true
      || verdict.allCastsSpatiallyCoherent !== true
      || verdict.annularAperturePreservedAcrossAllCasts !== true
      || verdict.spatiallySeparateInteriorAnatomyPreservedAcrossAllCasts !== true
      || verdict.exactSupportCountPreserved !== false
      || verdict.claim !== SPATIAL_VERDICT_CLAIM) {
    throw new Error('spatial adjudication verdict is incomplete or overclaims exact support inheritance');
  }

  return {
    schema: 'kaminos.lirm-heritable-hybrid-lineage-spatial-verification.v0',
    status: 'verified-spatial-lineage-hit-with-bounded-drift',
    verifiedCasts: completionByCell.size,
    verifiedWitnessFrames: witnessCompletion.accepted.length,
    witnessSheet: sheet,
  };
}
