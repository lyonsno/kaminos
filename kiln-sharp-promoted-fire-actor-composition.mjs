export const WAKE_SHARP_FIRE_ACTOR_PRODUCT_EPISODE_SCHEMA =
  'kaminos.wake-sharp-fire-actor-product-episode.v1';

const SELECTION_SCHEMA = 'kaminos.wake-sharp-fire-actor-selection.v1';
const LOAD_SCHEMA = 'kaminos.kiln.promoted-fire-actor-load.v1';
const APPLICATION_SCHEMA = 'kaminos.kiln.promoted-fire-actor-application.v1';
const ENGINE_SCHEMA = 'kaminos.kiln.promoted-fire-engine.v1';
const RENDERER_EPISODE_IDENTITY = 'foreground-kiln-fire-episode-hooks-v0';
const FOREGROUND_HEARTBEAT_SCHEMA = 'kaminos.foreground-kiln-heartbeat.v0';
const SHARP_REPORT_SCHEMA = 'kaminos.sharp-inline-product-route-report.v0';

function requireString(value, label) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label} mismatch`);
}

function validateSelection(selection) {
  assertEqual(selection?.schema, SELECTION_SCHEMA, 'FireActor selection schema');
  assertEqual(selection?.status, 'selected', 'FireActor selection status');
  requireString(selection.mountUrl, 'FireActor selection mount URL');
  for (const field of [
    'mountId',
    'actorId',
    'basinRevision',
    'packageSha256',
    'engineSha256',
    'carrierIdentity',
    'carrierSha256',
  ]) {
    requireString(selection.expected?.[field], `FireActor selection expected ${field}`);
  }
  assertEqual(selection.productRoute?.routeId, 'sharp-image-to-splat-live-v0', 'product route');
  assertEqual(
    selection.productRoute?.authority,
    'same-browser-product-realm-shared-device',
    'product route authority',
  );
  assertEqual(selection.productRoute?.inferenceRequired, true, 'product route inference requirement');
}

function validateLoadedSelection(selection, loaded) {
  assertEqual(loaded?.schema, LOAD_SCHEMA, 'promoted actor load schema');
  assertEqual(loaded?.status, 'verified', 'promoted actor load status');
  assertEqual(loaded.mount?.mountId, selection.expected.mountId, 'selected mount identity');
  assertEqual(loaded.mount?.actorId, selection.expected.actorId, 'selected actor identity');
  assertEqual(loaded.mount?.basin?.revision, selection.expected.basinRevision, 'selected basin revision');
  assertEqual(loaded.packageSha256, selection.expected.packageSha256, 'selected package SHA-256');
}

function validateApplication(loaded, application) {
  assertEqual(application?.schema, APPLICATION_SCHEMA, 'promoted actor application schema');
  assertEqual(application?.status, 'requested', 'promoted actor application status');
  assertEqual(application.mountId, loaded.mount.mountId, 'promoted actor application mount');
  assertEqual(application.policyId, loaded.mount.policy?.policyId, 'promoted actor application policy');
  assertEqual(application.basinRevision, loaded.mount.basin.revision, 'promoted actor application revision');
}

function validateEngine(selection, engineIdentity) {
  if (engineIdentity?.schema !== ENGINE_SCHEMA
    || engineIdentity.sha256 !== selection.expected.engineSha256
    || engineIdentity.effectiveSha256 !== selection.expected.engineSha256
    || engineIdentity.consumerPath !== 'kiln-promoted-fire-volume-core.js') {
    throw new Error('promoted engine identity mismatch');
  }
}

function validateCarrier(selection, carrierIdentity) {
  if (carrierIdentity?.identity !== selection.expected.carrierIdentity
    || carrierIdentity.consumerPath !== 'kiln-sharp-promoted-fire-volume-adapter.mjs'
    || carrierIdentity.sha256 !== selection.expected.carrierSha256
    || carrierIdentity.effectiveSha256 !== selection.expected.carrierSha256) {
    throw new Error('promoted carrier identity mismatch');
  }
}

function validateSharpMount(sharpMount) {
  if (sharpMount?.registered !== true
    || sharpMount.moduleExists !== true
    || sharpMount.weightsExists !== true
    || !sharpMount.expectedRevision
    || sharpMount.revision !== sharpMount.expectedRevision
    || sharpMount.revisionMatchesExpectation !== true
    || sharpMount.revisionContractStatus !== 'matched') {
    throw new Error('SHARP revision contract mismatch');
  }
}

function validateRendererEpisode(rendererEpisode, firingId, status, label) {
  if (rendererEpisode?.identity !== RENDERER_EPISODE_IDENTITY
    || rendererEpisode.firingId !== firingId
    || rendererEpisode.status !== status) {
    throw new Error(`${label} mismatch`);
  }
}

export function beginWakeSharpFireActorProductEpisode({
  selection,
  loaded,
  application,
  engineIdentity,
  carrierIdentity,
  sharpMount,
  firingId,
  requireSharpDutyCorrelation = false,
  rendererEpisode,
} = {}) {
  validateSelection(selection);
  validateLoadedSelection(selection, loaded);
  validateApplication(loaded, application);
  validateEngine(selection, engineIdentity);
  validateCarrier(selection, carrierIdentity);
  validateSharpMount(sharpMount);
  const exactFiringId = requireString(firingId, 'Wake SHARP firing id');
  validateRendererEpisode(rendererEpisode, exactFiringId, 'recording', 'renderer episode');

  return {
    schema: WAKE_SHARP_FIRE_ACTOR_PRODUCT_EPISODE_SCHEMA,
    status: 'recording',
    firingId: exactFiringId,
    mountId: loaded.mount.mountId,
    actorId: loaded.mount.actorId,
    basinHandle: loaded.mount.basin.handle,
    basinRevision: loaded.mount.basin.revision,
    basinSourceCommit: loaded.mount.basin.sourceCommit,
    packageSha256: loaded.packageSha256,
    policyId: loaded.mount.policy.policyId,
    engine: {
      sourceCommit: engineIdentity.sourceCommit,
      sourcePath: engineIdentity.sourcePath,
      consumerPath: engineIdentity.consumerPath,
      sha256: engineIdentity.sha256,
      effectiveSha256: engineIdentity.effectiveSha256,
    },
    carrier: {
      identity: carrierIdentity.identity,
      consumerPath: carrierIdentity.consumerPath,
      sha256: carrierIdentity.sha256,
      effectiveSha256: carrierIdentity.effectiveSha256,
    },
    sharp: {
      requestedRevision: sharpMount.expectedRevision,
      effectiveRevision: sharpMount.revision,
      revisionContractStatus: sharpMount.revisionContractStatus,
    },
    activation: {
      mode: 'product-route',
      authority: selection.productRoute.authority,
      routeId: selection.productRoute.routeId,
      inferenceRequired: true,
    },
    evidenceRequirements: {
      sharpDutyCorrelation: requireSharpDutyCorrelation === true,
    },
    requestedApplication: structuredClone(application),
    rendererEpisodeIdentity: rendererEpisode.identity,
  };
}

function validateRecordingEpisode(selection, loaded, episode) {
  if (episode?.schema !== WAKE_SHARP_FIRE_ACTOR_PRODUCT_EPISODE_SCHEMA
    || episode.status !== 'recording') {
    throw new Error('FireActor product episode is not recording');
  }
  assertEqual(episode.mountId, selection.expected.mountId, 'product episode mount');
  assertEqual(episode.actorId, selection.expected.actorId, 'product episode actor');
  assertEqual(episode.basinRevision, selection.expected.basinRevision, 'product episode basin revision');
  assertEqual(episode.packageSha256, selection.expected.packageSha256, 'product episode package SHA-256');
  assertEqual(episode.engine?.effectiveSha256, selection.expected.engineSha256, 'product episode engine');
  assertEqual(episode.carrier?.identity, selection.expected.carrierIdentity, 'product episode carrier identity');
  assertEqual(episode.carrier?.effectiveSha256, selection.expected.carrierSha256, 'product episode carrier SHA-256');
  assertEqual(episode.mountId, loaded.mount.mountId, 'product episode loaded mount');
  assertEqual(episode.policyId, loaded.mount.policy?.policyId, 'product episode loaded policy');
  assertEqual(episode.activation?.routeId, selection.productRoute.routeId, 'product episode route');
  assertEqual(episode.activation?.authority, selection.productRoute.authority, 'product episode route authority');
  assertEqual(episode.activation?.inferenceRequired, true, 'product episode inference requirement');
}

function validateEffectivePresentation(loaded, episode, effectivePresentation) {
  if (effectivePresentation?.mountId !== episode.mountId
    || effectivePresentation.actorId !== episode.actorId
    || effectivePresentation.basinRevision !== episode.basinRevision
    || effectivePresentation.packageSha256 !== episode.packageSha256
    || effectivePresentation.policyId !== episode.policyId
    || effectivePresentation.composition !== loaded.mount.representation?.composition
    || effectivePresentation.rendererIdentity !== loaded.mount.representation?.rendererIdentity
    || effectivePresentation.splatMode !== loaded.mount.representation?.splatMode
    || effectivePresentation.smokePresentation !== 'on') {
    throw new Error('FireActor effective presentation mismatch');
  }
  if (effectivePresentation.fallbackReason) {
    throw new Error(`FireActor product fallback: ${effectivePresentation.fallbackReason}`);
  }
}

export function completeWakeSharpFireActorProductEpisode({
  selection,
  loaded,
  episode,
  rendererEpisode,
  foregroundHeartbeat,
  sharpReport,
  effectivePresentation,
} = {}) {
  validateSelection(selection);
  validateLoadedSelection(selection, loaded);
  validateRecordingEpisode(selection, loaded, episode);
  validateRendererEpisode(rendererEpisode, episode.firingId, 'complete', 'renderer completion');
  if (foregroundHeartbeat?.schema !== FOREGROUND_HEARTBEAT_SCHEMA
    || foregroundHeartbeat.status !== 'verified'
    || foregroundHeartbeat.firingId !== episode.firingId) {
    throw new Error('foreground heartbeat completion mismatch');
  }
  const sharpDutyCorrelation = foregroundHeartbeat.sharpDutyCorrelation || null;
  if (episode.evidenceRequirements?.sharpDutyCorrelation === true
    && (sharpDutyCorrelation?.status !== 'verified'
      || sharpDutyCorrelation.firingId !== episode.firingId)) {
    throw new Error('foreground SHARP duty correlation mismatch');
  }
  if (sharpReport?.schema !== SHARP_REPORT_SCHEMA
    || sharpReport.status !== 'real'
    || sharpReport.firingId !== episode.firingId
    || sharpReport.revision !== episode.sharp.effectiveRevision
    || sharpReport.effectiveRoute !== selection.productRoute.authority
    || sharpReport.sharedGpu?.exactObjectIdentityVerified !== true) {
    throw new Error('SHARP product report mismatch');
  }
  validateEffectivePresentation(loaded, episode, effectivePresentation);

  return {
    ...structuredClone(episode),
    status: 'completed',
    sharp: {
      ...structuredClone(episode.sharp),
      sharedGpuExactObjectIdentityVerified: true,
    },
    effectivePresentation: {
      mountId: episode.mountId,
      actorId: episode.actorId,
      basinRevision: episode.basinRevision,
      packageSha256: episode.packageSha256,
      policyId: episode.policyId,
      composition: loaded.mount.representation.composition,
      rendererIdentity: loaded.mount.representation.rendererIdentity,
      splatMode: loaded.mount.representation.splatMode,
      smokePresentation: 'on',
      fallbackReason: null,
    },
    evidence: {
      rendererEpisodeStatus: rendererEpisode.status,
      foregroundHeartbeatStatus: foregroundHeartbeat.status,
      sharpDutyCorrelationStatus: sharpDutyCorrelation?.status || 'not-required',
      sharpReportStatus: sharpReport.status,
    },
  };
}
