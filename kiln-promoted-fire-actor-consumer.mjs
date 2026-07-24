export const KILN_PROMOTED_FIRE_ACTOR_LOAD_SCHEMA = 'kaminos.kiln.promoted-fire-actor-load.v1';
export const KILN_PROMOTED_FIRE_ACTOR_APPLICATION_SCHEMA = 'kaminos.kiln.promoted-fire-actor-application.v1';
export const KILN_PROMOTED_FIRE_ACTOR_PREVIEW_SCHEMA = 'kaminos.kiln.promoted-fire-actor-preview.v1';

const FIRE_ACTOR_MOUNT_SCHEMA = 'kaminos.fire-actor-mount.v1';
const FIRE_ACTOR_POLICY_SCHEMA = 'kaminos.fire-presentation-policy.v1';
const FIRE_ACTOR_EPISODE_SCHEMA = 'kaminos.fire-actor-episode.v1';
const BASIN_PACKAGE_SCHEMA = 'kaminos.volume.basin-promotion-package.v1';
const BASIN_CHANNEL_SCHEMA = 'kaminos.volume.basin-promotion-channel.v1';
const MOUNT_ID = /^firemount-[a-f0-9]{64}$/;
const POLICY_ID = /^firepolicy-[a-f0-9]{64}$/;
const REVISION = /^basinrev-[a-f0-9]{64}$/;

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(entry => canonicalJson(entry)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .filter(key => value[key] !== undefined)
      .sort()
      .map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

async function sha256(value, cryptoImpl = globalThis.crypto) {
  if (!cryptoImpl?.subtle) throw new Error('promoted fire actor requires Web Crypto SHA-256');
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const digest = await cryptoImpl.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function contentIdentity(prefix, value, cryptoImpl) {
  return `${prefix}-${await sha256(canonicalJson(value), cryptoImpl)}`;
}

function requiredString(value, label) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label} mismatch`);
}

async function fetchText(url, fetchImpl, label) {
  const response = await fetchImpl(url, { cache: 'no-store' });
  if (!response?.ok) throw new Error(`${label} fetch failed: ${response?.status ?? 'missing response'}`);
  return response.text();
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

function validateMountShape(mount) {
  assertEqual(mount?.schema, FIRE_ACTOR_MOUNT_SCHEMA, 'fire actor mount schema');
  assertEqual(mount?.status, 'mounted', 'fire actor mount status');
  if (!MOUNT_ID.test(String(mount.mountId || ''))) throw new Error('fire actor mount identity is invalid');
  if (!POLICY_ID.test(String(mount.policy?.policyId || ''))) throw new Error('fire actor policy identity is invalid');
  if (!REVISION.test(String(mount.basin?.revision || ''))) throw new Error('fire actor basin revision is invalid');
  assertEqual(mount.policy?.schema, FIRE_ACTOR_POLICY_SCHEMA, 'fire actor policy schema');
  assertEqual(mount.policy?.basinRevisionChanged, false, 'fire actor basin revision mutation');
  assertEqual(mount.activationContract?.episodeSchema, FIRE_ACTOR_EPISODE_SCHEMA, 'fire actor episode schema');
  assertEqual(mount.activationContract?.operatorPreviewRequiresInference, false, 'operator preview inference contract');
  assertEqual(mount.activationContract?.placementContract, 'world-up-translate-uniform-scale-v1', 'fire actor placement contract');
  assertEqual(canonicalJson(mount.policy.requested), canonicalJson(mount.policy.effective), 'fire actor requested/effective policy');
  return mount;
}

async function validateContentIdentities(mount, cryptoImpl) {
  const expectedPolicyId = await contentIdentity('firepolicy', {
    schema: FIRE_ACTOR_POLICY_SCHEMA,
    basinRevision: mount.basin.revision,
    requested: mount.policy.requested,
  }, cryptoImpl);
  assertEqual(mount.policy.policyId, expectedPolicyId, 'fire actor policy identity');
  const expectedMountId = await contentIdentity('firemount', {
    schema: FIRE_ACTOR_MOUNT_SCHEMA,
    actorId: mount.actorId,
    consumer: mount.consumer,
    transform: mount.transform,
    basin: {
      stableRef: mount.basin.stableRef,
      packageSha256: mount.sourcePackage.sha256,
    },
    representation: mount.representation,
    policyId: mount.policy.policyId,
  }, cryptoImpl);
  assertEqual(mount.mountId, expectedMountId, 'fire actor mount identity');
}

function validatePackageProjection(mount, packageDocument, packageSha256) {
  assertEqual(packageDocument?.schema, BASIN_PACKAGE_SCHEMA, 'basin package schema');
  assertEqual(packageSha256, mount.sourcePackage.sha256, 'basin package SHA-256');
  assertEqual(packageDocument.handle, mount.basin.handle, 'basin package handle');
  assertEqual(packageDocument.revision, mount.basin.revision, 'basin package revision');
  assertEqual(packageDocument.stableRef, mount.basin.stableRef, 'basin package stable ref');
  assertEqual(packageDocument.sourceCommit, mount.basin.sourceCommit, 'basin package source commit');
  assertEqual(packageDocument.effectiveState?.composition?.effective, mount.representation.composition, 'basin composition');
  assertEqual(packageDocument.effectiveState?.renderer?.identity, mount.representation.rendererIdentity, 'basin renderer identity');
}

function validateChannelProjection(mount, channelDocument) {
  assertEqual(channelDocument?.schema, BASIN_CHANNEL_SCHEMA, 'basin channel schema');
  assertEqual(channelDocument.handle, mount.basin.handle, 'basin channel handle');
  assertEqual(channelDocument.current?.revision, mount.basin.revision, 'basin channel revision');
  assertEqual(channelDocument.current?.revision, mount.currentChannel.revision, 'mounted channel revision');
  assertEqual(
    channelDocument.current?.packageRelativePath,
    mount.currentChannel.packageRelativePath,
    'mounted channel package path',
  );
}

function validatePresetProjection(mount, packageDocument, settingsPresetArtifact) {
  assertEqual(settingsPresetArtifact?.presetId, mount.settingsPreset.presetId, 'installed settings preset id');
  assertEqual(settingsPresetArtifact?.identity, 'kaminos-volume-settings-preset-artifact-v2', 'installed settings preset identity');
  assertEqual(
    canonicalJson(settingsPresetArtifact),
    canonicalJson(packageDocument.settingsPreset?.artifact),
    'installed settings preset/package artifact',
  );
}

export async function loadKilnPromotedFireActor({
  mountUrl,
  fetchImpl = globalThis.fetch?.bind(globalThis),
  cryptoImpl = globalThis.crypto,
} = {}) {
  if (!fetchImpl) throw new Error('promoted fire actor requires fetch');
  const resolvedMountUrl = new URL(requiredString(mountUrl, 'promoted fire actor mount URL'), globalThis.location?.href).toString();
  const mount = validateMountShape(parseJson(
    await fetchText(resolvedMountUrl, fetchImpl, 'fire actor mount'),
    'fire actor mount',
  ));
  await validateContentIdentities(mount, cryptoImpl);

  const packageUrl = new URL(requiredString(mount.sourcePackage?.relativePath, 'source package relative path'), resolvedMountUrl).toString();
  const channelUrl = new URL(requiredString(mount.currentChannel?.relativePath, 'current channel relative path'), resolvedMountUrl).toString();
  const settingsPresetUrl = new URL(requiredString(mount.settingsPreset?.storeRelativePath, 'settings preset relative path'), resolvedMountUrl).toString();
  const [packageText, channelText, presetText] = await Promise.all([
    fetchText(packageUrl, fetchImpl, 'basin package'),
    fetchText(channelUrl, fetchImpl, 'basin channel'),
    fetchText(settingsPresetUrl, fetchImpl, 'settings preset'),
  ]);
  const packageDocument = parseJson(packageText, 'basin package');
  const channelDocument = parseJson(channelText, 'basin channel');
  const settingsPresetArtifact = parseJson(presetText, 'settings preset');
  const packageSha256 = await sha256(packageText, cryptoImpl);
  validatePackageProjection(mount, packageDocument, packageSha256);
  validateChannelProjection(mount, channelDocument);
  validatePresetProjection(mount, packageDocument, settingsPresetArtifact);

  return {
    schema: KILN_PROMOTED_FIRE_ACTOR_LOAD_SCHEMA,
    status: 'verified',
    mount,
    packageDocument,
    channelDocument,
    settingsPresetArtifact,
    packageSha256,
    resources: {
      mountUrl: resolvedMountUrl,
      packageUrl,
      channelUrl,
      settingsPresetUrl,
    },
  };
}

function controlEntries(controls) {
  return Object.entries(controls || {}).map(([id, descriptor]) => ({
    id,
    value: Object.hasOwn(descriptor || {}, 'rawValue') ? descriptor.rawValue : descriptor?.value,
  }));
}

export function createKilnPromotedFireActorApplication(loaded) {
  if (loaded?.schema !== KILN_PROMOTED_FIRE_ACTOR_LOAD_SCHEMA || loaded.status !== 'verified') {
    throw new Error('promoted fire actor application requires a verified load');
  }
  const { mount, settingsPresetArtifact } = loaded;
  if (mount.policy.requested.splats.enabled !== true) {
    throw new Error('Wake Kiln actor consumer v1 requires boundary splats enabled');
  }
  const preset = settingsPresetArtifact.preset || {};
  return {
    schema: KILN_PROMOTED_FIRE_ACTOR_APPLICATION_SCHEMA,
    status: 'requested',
    mountId: mount.mountId,
    policyId: mount.policy.policyId,
    basinRevision: mount.basin.revision,
    domControls: controlEntries(preset.domControls),
    rendererControls: controlEntries(preset.rendererControls),
    runtimeControls: {
      'volume-resolution': mount.runtimeApplication.controls.resolution,
      'volume-steps': mount.runtimeApplication.controls.raySteps,
      'volume-adaptive-rays': mount.runtimeApplication.controls.adaptiveRays,
      'volume-render-scale': mount.runtimeApplication.controls.renderScale,
    },
    presentation: structuredClone(mount.runtimeApplication.presentation),
    productTransform: structuredClone(mount.runtimeApplication.transform),
  };
}

async function previewIdentity(preview, cryptoImpl) {
  return contentIdentity('fireepisode', {
    schema: FIRE_ACTOR_EPISODE_SCHEMA,
    episodeId: preview.episodeId,
    mountId: preview.mountId,
    activation: preview.activation,
  }, cryptoImpl);
}

export async function beginKilnPromotedFireActorPreview({
  loaded,
  episodeId,
  rendererEpisode,
  cryptoImpl = globalThis.crypto,
} = {}) {
  if (loaded?.schema !== KILN_PROMOTED_FIRE_ACTOR_LOAD_SCHEMA || loaded.status !== 'verified') {
    throw new Error('promoted fire preview requires a verified actor load');
  }
  const normalizedEpisodeId = requiredString(episodeId, 'promoted fire preview episode id');
  if (rendererEpisode?.identity !== 'foreground-kiln-fire-episode-hooks-v0'
    || rendererEpisode.firingId !== normalizedEpisodeId
    || rendererEpisode.status !== 'recording') {
    throw new Error('promoted fire preview renderer episode identity mismatch');
  }
  const mount = loaded.mount;
  const preview = {
    schema: KILN_PROMOTED_FIRE_ACTOR_PREVIEW_SCHEMA,
    actorEpisodeSchema: FIRE_ACTOR_EPISODE_SCHEMA,
    status: 'recording',
    episodeIdentity: null,
    episodeId: normalizedEpisodeId,
    mountId: mount.mountId,
    actorId: mount.actorId,
    basinRevision: mount.basin.revision,
    policyId: mount.policy.policyId,
    activation: {
      mode: 'operator-preview',
      authority: 'operator-selected-preview',
      inferenceRequired: false,
      routeRef: null,
    },
    requestedPresentation: {
      composition: mount.representation.composition,
      rendererIdentity: mount.representation.rendererIdentity,
      policyId: mount.policy.policyId,
    },
    rendererEpisodeIdentity: rendererEpisode.identity,
  };
  preview.episodeIdentity = await previewIdentity(preview, cryptoImpl);
  return preview;
}

export async function completeKilnPromotedFireActorPreview({
  loaded,
  preview,
  rendererEpisode,
  effectivePresentation,
  cryptoImpl = globalThis.crypto,
} = {}) {
  if (loaded?.schema !== KILN_PROMOTED_FIRE_ACTOR_LOAD_SCHEMA || loaded.status !== 'verified') {
    throw new Error('promoted fire preview completion requires a verified actor load');
  }
  const mount = loaded.mount;
  if (preview?.schema !== KILN_PROMOTED_FIRE_ACTOR_PREVIEW_SCHEMA || preview.status !== 'recording') {
    throw new Error('promoted fire preview is not recording');
  }
  const expectedEpisodeIdentity = await previewIdentity(preview, cryptoImpl);
  if (preview.episodeIdentity !== expectedEpisodeIdentity
    || preview.mountId !== mount.mountId
    || preview.actorId !== mount.actorId
    || preview.basinRevision !== mount.basin.revision
    || preview.policyId !== mount.policy.policyId
    || preview.activation?.mode !== 'operator-preview'
    || preview.activation?.authority !== 'operator-selected-preview'
    || preview.activation?.inferenceRequired !== false
    || preview.activation?.routeRef !== null) {
    throw new Error('promoted fire preview episode identity mismatch');
  }
  if (rendererEpisode?.identity !== preview.rendererEpisodeIdentity
    || rendererEpisode.firingId !== preview.episodeId
    || rendererEpisode.status !== 'completed') {
    throw new Error('promoted fire preview renderer completion mismatch');
  }
  if (effectivePresentation?.mountId !== mount.mountId
    || effectivePresentation?.episodeId !== preview.episodeId
    || effectivePresentation?.policyId !== mount.policy.policyId
    || effectivePresentation?.basinRevision !== mount.basin.revision
    || effectivePresentation?.composition !== mount.representation.composition
    || effectivePresentation?.rendererIdentity !== mount.representation.rendererIdentity) {
    throw new Error('promoted fire preview effective presentation identity mismatch');
  }
  if (effectivePresentation.fallbackReason) {
    throw new Error(`promoted fire preview fallback: ${effectivePresentation.fallbackReason}`);
  }
  if (effectivePresentation.inferenceRan !== false || effectivePresentation.routeRef !== null) {
    throw new Error('promoted fire preview cannot carry inference or route evidence');
  }
  const trustedEffectivePresentation = {
    mountId: mount.mountId,
    episodeId: preview.episodeId,
    policyId: mount.policy.policyId,
    basinRevision: mount.basin.revision,
    composition: mount.representation.composition,
    rendererIdentity: mount.representation.rendererIdentity,
    fallbackReason: null,
    inferenceRan: false,
    routeRef: null,
  };
  return {
    ...structuredClone(preview),
    status: 'completed',
    effectivePresentation: trustedEffectivePresentation,
  };
}
