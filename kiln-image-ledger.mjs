import { createHash } from 'node:crypto';

export const KILN_IMAGE_ARTIFACT_SCHEMA = 'kaminos.kiln.image-artifact.v0';
export const KILN_IMAGE_ROUTE_RECEIPT_SCHEMA = 'kaminos.kiln.image-route-receipt.v0';
export const KILN_IMAGE_LEDGER_SCHEMA = 'kaminos.kiln.image-ledger.v0';
export const KILN_IMAGE_IMPORT_TRAY_WITNESS_SCHEMA = 'kaminos.kiln.image-import-tray-witness.v0';

const SOURCE_KINDS = new Set([
  'operator_import',
  'clipboard_import',
  'screenshot_import',
  'external_app_export',
  'web_reference',
  'openai_api',
  'gemini_api',
  'local_webgpu',
  'local_native',
  'fixture',
  'fallback',
]);

const ARTIFACT_ROLES = new Set([
  'reference',
  'candidate',
  'texture_swatch',
  'material_swatch',
  'mask_source',
  'depth_source',
  'normal_source',
  'crop',
  'paint_over',
  'negative_law_evidence',
  'failure_evidence',
  'promotion_candidate',
  'scene_native_candidate',
]);

const PROMOTION_STATES = new Set([
  'loose_reference',
  'bench_evidence',
  'conditioning_input',
  'kiln_candidate',
  'scene_native_candidate',
  'promoted_asset',
  'rejected_pathology',
]);

function cloneJson(value, fallback = null) {
  if (value === undefined) return fallback;
  return value === null ? null : JSON.parse(JSON.stringify(value));
}

function requiredString(value, field) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`${field} is required`);
  return text;
}

function enumValue(value, allowed, field) {
  const text = requiredString(value, field);
  if (!allowed.has(text)) throw new Error(`unsupported ${field}: ${text}`);
  return text;
}

function positiveInt(value, field) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${field} must be a positive integer`);
  return number;
}

function nowIso() {
  return new Date().toISOString();
}

function sha256Hex(value) {
  const hash = createHash('sha256');
  if (Buffer.isBuffer(value)) hash.update(value);
  else hash.update(String(value ?? ''));
  return hash.digest('hex');
}

function normalizedArray(value) {
  return Array.isArray(value) ? value.map(item => String(item)).filter(Boolean) : [];
}

function normalizedConditioningLinks(links = {}) {
  return {
    specimenCheckpointId: links.specimenCheckpointId ?? null,
    cameraId: links.cameraId ?? null,
    viewId: links.viewId ?? null,
    inputArtifactIds: normalizedArray(links.inputArtifactIds),
    maskArtifactIds: normalizedArray(links.maskArtifactIds),
    depthArtifactIds: normalizedArray(links.depthArtifactIds),
    normalArtifactIds: normalizedArray(links.normalArtifactIds),
    scribbleArtifactIds: normalizedArray(links.scribbleArtifactIds),
    collageArtifactIds: normalizedArray(links.collageArtifactIds),
    referenceArtifactIds: normalizedArray(links.referenceArtifactIds),
    regionLockIds: normalizedArray(links.regionLockIds),
    negativeLawIds: normalizedArray(links.negativeLawIds),
    previousCandidateArtifactIds: normalizedArray(links.previousCandidateArtifactIds),
  };
}

function sourceTruthWarningsForArtifact({ sourceKind, licenseOrCustody, routeReceipt }) {
  const warnings = [];
  if (licenseOrCustody === 'operator_supplied_unknown') warnings.push('operator_supplied_unknown_custody');
  if (sourceKind === 'external_app_export') warnings.push('external_app_export_not_reproducible_by_kaminos');
  if (sourceKind === 'web_reference') warnings.push('web_reference_not_authored_or_generated_truth');
  if (sourceKind === 'fallback') warnings.push('fallback_artifact_not_requested_route_truth');
  if (routeReceipt?.requestedRoute && routeReceipt?.effectiveRoute && routeReceipt.requestedRoute !== routeReceipt.effectiveRoute) {
    warnings.push('route_receipt_requested_effective_mismatch');
  }
  return [...new Set(warnings)];
}

export function buildImageRouteReceipt({
  requestedRoute,
  effectiveRoute,
  backend = null,
  model = null,
  modelVersionOrHash = null,
  runtime = null,
  device = null,
  prompt = null,
  negativePrompt = null,
  seed = null,
  steps = null,
  cfgOrGuidance = null,
  scheduler = null,
  size = null,
  quality = null,
  inputArtifactIds = [],
  maskArtifactIds = [],
  depthArtifactIds = [],
  normalArtifactIds = [],
  scribbleArtifactIds = [],
  regionLockIds = [],
  negativeLawIds = [],
  startedAt = null,
  finishedAt = null,
  durationMs = null,
  costEstimate = null,
  errorPhase = null,
  errorMessage = null,
  fallbackReason = null,
  sourceTruthWarnings = [],
} = {}) {
  const requested = requiredString(requestedRoute, 'requestedRoute');
  const effective = requiredString(effectiveRoute, 'effectiveRoute');
  const warnings = normalizedArray(sourceTruthWarnings);
  if (requested !== effective) {
    if (!String(fallbackReason || '').trim()) {
      throw new Error('fallbackReason is required when effectiveRoute differs from requestedRoute');
    }
    warnings.push('fallback_route_mismatch');
  }
  const receipt = {
    schema: KILN_IMAGE_ROUTE_RECEIPT_SCHEMA,
    requestedRoute: requested,
    effectiveRoute: effective,
    backend,
    model,
    modelVersionOrHash,
    runtime,
    device,
    prompt,
    negativePrompt,
    seed,
    steps,
    cfgOrGuidance,
    scheduler,
    size,
    quality,
    inputArtifactIds: normalizedArray(inputArtifactIds),
    maskArtifactIds: normalizedArray(maskArtifactIds),
    depthArtifactIds: normalizedArray(depthArtifactIds),
    normalArtifactIds: normalizedArray(normalArtifactIds),
    scribbleArtifactIds: normalizedArray(scribbleArtifactIds),
    regionLockIds: normalizedArray(regionLockIds),
    negativeLawIds: normalizedArray(negativeLawIds),
    startedAt,
    finishedAt,
    durationMs,
    costEstimate,
    errorPhase,
    errorMessage,
    fallbackReason: fallbackReason || null,
    sourceTruthWarnings: [...new Set(warnings)],
  };
  receipt.receiptHash = sha256Hex(JSON.stringify({ ...receipt, receiptHash: null }));
  return receipt;
}

export function buildFallbackRouteReceipt(options = {}) {
  return buildImageRouteReceipt({
    ...options,
    fallbackReason: requiredString(options.fallbackReason, 'fallbackReason'),
  });
}

export function buildImageArtifact({
  artifactId,
  createdAt = nowIso(),
  sourceKind,
  assetRole,
  promotionState,
  mimeType,
  width,
  height,
  storageRef,
  content = null,
  contentHash = null,
  operatorNote = null,
  licenseOrCustody = 'operator_supplied_unknown',
  routeReceipt = null,
  conditioningLinks = {},
  failureLabels = [],
  sourceTruthWarnings = [],
} = {}) {
  const normalizedSourceKind = enumValue(sourceKind, SOURCE_KINDS, 'sourceKind');
  const normalizedRole = enumValue(assetRole, ARTIFACT_ROLES, 'assetRole');
  const normalizedPromotion = enumValue(promotionState, PROMOTION_STATES, 'promotionState');
  const normalizedReceipt = routeReceipt ? cloneJson(routeReceipt) : null;
  if (normalizedReceipt && normalizedReceipt.schema !== KILN_IMAGE_ROUTE_RECEIPT_SCHEMA) {
    throw new Error(`routeReceipt must use ${KILN_IMAGE_ROUTE_RECEIPT_SCHEMA}`);
  }
  const artifact = {
    schema: KILN_IMAGE_ARTIFACT_SCHEMA,
    artifactId: requiredString(artifactId, 'artifactId'),
    createdAt,
    sourceKind: normalizedSourceKind,
    assetRole: normalizedRole,
    promotionState: normalizedPromotion,
    contentHash: contentHash || sha256Hex(content ?? storageRef),
    mimeType: requiredString(mimeType, 'mimeType'),
    width: positiveInt(width, 'width'),
    height: positiveInt(height, 'height'),
    storageRef: requiredString(storageRef, 'storageRef'),
    operatorNote,
    licenseOrCustody: requiredString(licenseOrCustody, 'licenseOrCustody'),
    routeReceipt: normalizedReceipt,
    conditioningLinks: normalizedConditioningLinks(conditioningLinks),
    failureLabels: normalizedArray(failureLabels),
    sourceTruthWarnings: [],
  };
  artifact.sourceTruthWarnings = [...new Set([
    ...sourceTruthWarningsForArtifact(artifact),
    ...normalizedArray(sourceTruthWarnings),
  ])];
  return artifact;
}

export function buildImageLedger({ artifacts = [], createdAt = nowIso(), ledgerId = 'kiln-image-ledger-fixture-v0' } = {}) {
  const normalizedArtifacts = artifacts.map(artifact => {
    if (artifact?.schema !== KILN_IMAGE_ARTIFACT_SCHEMA) {
      throw new Error(`ledger artifact must use ${KILN_IMAGE_ARTIFACT_SCHEMA}`);
    }
    return cloneJson(artifact);
  });
  return {
    schema: KILN_IMAGE_LEDGER_SCHEMA,
    ledgerId,
    createdAt,
    artifactCount: normalizedArtifacts.length,
    artifacts: normalizedArtifacts,
  };
}

export function buildFixtureImportTrayWitness({
  importedContent = Buffer.from('red lerm no-face reference pixels\n'),
  requestedGeneratorRoute = 'openai_api',
  effectiveFallbackRoute = 'fixture',
  fallbackReason = 'openai_api_unconfigured',
} = {}) {
  const importReceipt = buildImageRouteReceipt({
    requestedRoute: 'operator_import',
    effectiveRoute: 'operator_import',
    backend: 'kaminos-import-tray',
    runtime: 'node-fixture',
  });
  const imported = buildImageArtifact({
    artifactId: 'artifact-red-lerm-import',
    sourceKind: 'operator_import',
    assetRole: 'reference',
    promotionState: 'bench_evidence',
    mimeType: 'image/png',
    width: 64,
    height: 48,
    storageRef: 'fixtures/red-lerm/reference.png',
    content: importedContent,
    licenseOrCustody: 'operator_supplied_unknown',
    routeReceipt: importReceipt,
    conditioningLinks: {
      specimenCheckpointId: 'red-lerm-specimen-checkpoint-v0',
      maskArtifactIds: ['mask-no-face-front-cap'],
      negativeLawIds: ['no-visible-eyes'],
    },
    failureLabels: ['eye-drift-blocked'],
  });
  const fallbackReceipt = buildFallbackRouteReceipt({
    requestedRoute: requestedGeneratorRoute,
    effectiveRoute: effectiveFallbackRoute,
    backend: 'kaminos-fixture',
    runtime: 'node-fixture',
    fallbackReason,
    errorPhase: 'route-selection',
    inputArtifactIds: [imported.artifactId],
    negativeLawIds: ['no-visible-eyes'],
  });
  const fallbackCandidate = buildImageArtifact({
    artifactId: 'artifact-red-lerm-fallback-candidate',
    sourceKind: 'fallback',
    assetRole: 'candidate',
    promotionState: 'kiln_candidate',
    mimeType: 'image/png',
    width: 64,
    height: 48,
    storageRef: 'fixtures/red-lerm/fallback-candidate.png',
    content: `fallback:${imported.contentHash}`,
    licenseOrCustody: 'fixture',
    routeReceipt: fallbackReceipt,
    conditioningLinks: {
      inputArtifactIds: [imported.artifactId],
      maskArtifactIds: ['mask-no-face-front-cap'],
      negativeLawIds: ['no-visible-eyes'],
      previousCandidateArtifactIds: [],
    },
    failureLabels: ['requested-route-unavailable'],
  });
  const ledger = buildImageLedger({ artifacts: [imported, fallbackCandidate] });
  return {
    schema: KILN_IMAGE_IMPORT_TRAY_WITNESS_SCHEMA,
    ok: true,
    phase: 'complete',
    ledger,
    sourceTruthSummary: {
      artifactCount: ledger.artifactCount,
      fallbackCount: ledger.artifacts.filter(artifact => artifact.sourceKind === 'fallback').length,
      importCount: ledger.artifacts.filter(artifact => artifact.sourceKind.endsWith('_import')).length,
      warningCount: ledger.artifacts.reduce((count, artifact) => count + artifact.sourceTruthWarnings.length, 0),
    },
  };
}
