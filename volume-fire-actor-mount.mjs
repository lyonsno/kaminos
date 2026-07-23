#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import {
  BASIN_PROMOTION_MOUNT_SCHEMA,
  mountBasinPromotionPackage,
  validateBasinPromotionPackage,
} from './volume-basin-promotion-package.mjs';

export const FIRE_ACTOR_MOUNT_SCHEMA = 'kaminos.fire-actor-mount.v1';
export const FIRE_ACTOR_POLICY_SCHEMA = 'kaminos.fire-presentation-policy.v1';
export const FIRE_ACTOR_EPISODE_SCHEMA = 'kaminos.fire-actor-episode.v1';

const BASIN_REVISION = /^basinrev-[a-f0-9]{64}$/;

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

function contentIdentity(prefix, value) {
  return `${prefix}-${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`${label} is unreadable at ${path}: ${error.message}`);
  }
}

function atomicWriteJson(path, payload) {
  const target = resolve(path);
  mkdirSync(dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`);
  renameSync(temporary, target);
  return target;
}

function requiredString(value, label) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

function finiteNumber(value, label) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) throw new Error(`${label} must be finite`);
  return normalized;
}

function positiveInteger(value, label) {
  const normalized = finiteNumber(value, label);
  if (!Number.isInteger(normalized) || normalized <= 0) throw new Error(`${label} must be a positive integer`);
  return normalized;
}

function boolean(value, label) {
  if (value !== true && value !== false) throw new Error(`${label} must be boolean`);
  return value;
}

function normalizeVector(value, label, { positive = false } = {}) {
  if (!Array.isArray(value) || value.length !== 3) throw new Error(`${label} must contain exactly three values`);
  const normalized = value.map((entry, index) => finiteNumber(entry, `${label}[${index}]`));
  if (positive && normalized.some(entry => entry <= 0)) throw new Error(`${label} values must be positive`);
  return normalized;
}

function normalizeTransform(value = {}) {
  const rotation = normalizeVector(value.rotation, 'fire actor transform rotation');
  const scale = normalizeVector(value.scale, 'fire actor transform scale', { positive: true });
  if (rotation.some(entry => entry !== 0)) {
    throw new Error('fire actor mount v1 supports world-up placement only; rotation must be [0, 0, 0]');
  }
  if (scale.some(entry => entry !== scale[0])) {
    throw new Error('fire actor mount v1 requires uniform scale');
  }
  const transform = {
    position: normalizeVector(value.position, 'fire actor transform position'),
    rotation,
    scale,
  };
  return transform;
}

function normalizeConsumer(value = {}) {
  return {
    id: requiredString(value.id, 'fire actor consumer id'),
    surface: requiredString(value.surface, 'fire actor consumer surface'),
    anchor: requiredString(value.anchor, 'fire actor consumer anchor'),
  };
}

function normalizePolicySelection(value = {}) {
  const simulation = value.simulation || {};
  const smoke = value.smoke || {};
  const splats = value.splats || {};
  const scheduling = value.scheduling || {};
  const renderScale = finiteNumber(smoke.renderScale, 'fire actor smoke renderScale');
  if (renderScale <= 0 || renderScale > 1) throw new Error('fire actor smoke renderScale must be greater than zero and at most one');
  const adaptiveRays = finiteNumber(smoke.adaptiveRays, 'fire actor smoke adaptiveRays');
  if (adaptiveRays < 0 || adaptiveRays > 1) throw new Error('fire actor smoke adaptiveRays must be between zero and one');
  const flameContinuity = requiredString(scheduling.flameContinuity, 'fire actor flame continuity');
  if (!['live-every-frame', 'bounded-history-holdover'].includes(flameContinuity)) {
    throw new Error(`unsupported fire actor flame continuity: ${flameContinuity}`);
  }
  return {
    simulation: {
      gridResolution: positiveInteger(simulation.gridResolution, 'fire actor simulation gridResolution'),
    },
    smoke: {
      renderScale,
      raySteps: positiveInteger(smoke.raySteps, 'fire actor smoke raySteps'),
      adaptiveRays,
      enabled: boolean(smoke.enabled, 'fire actor smoke enabled'),
    },
    splats: {
      enabled: boolean(splats.enabled, 'fire actor splats enabled'),
    },
    scheduling: { flameContinuity },
  };
}

function controlValue(packageDocument, id) {
  const descriptor = packageDocument.settingsPreset?.artifact?.preset?.domControls?.[id];
  if (!descriptor || typeof descriptor !== 'object') return null;
  return Object.hasOwn(descriptor, 'rawValue') ? descriptor.rawValue : (descriptor.value ?? null);
}

function authoringPolicy(packageDocument) {
  const effectiveState = packageDocument.effectiveState;
  return {
    simulation: {
      gridResolution: Number(effectiveState.simulator.grid),
    },
    smoke: {
      renderScale: Number(effectiveState.renderer.renderScale),
      raySteps: Number(effectiveState.renderer.raySteps),
      adaptiveRays: Number(effectiveState.renderer.adaptiveRays),
      enabled: effectiveState.presentation.raymarchSmoke !== 'off',
    },
    splats: {
      enabled: String(effectiveState.composition.effective || '').includes('splats'),
    },
    scheduling: {
      flameContinuity: 'live-every-frame',
    },
  };
}

export function createFireActorPolicy({ packageDocument, requested } = {}) {
  const validatedPackage = validateBasinPromotionPackage(packageDocument);
  const baseline = normalizePolicySelection(authoringPolicy(validatedPackage));
  const selection = normalizePolicySelection(requested);
  const identityBasis = {
    schema: FIRE_ACTOR_POLICY_SCHEMA,
    basinRevision: validatedPackage.revision,
    requested: selection,
  };
  return {
    schema: FIRE_ACTOR_POLICY_SCHEMA,
    policyId: contentIdentity('firepolicy', identityBasis),
    authority: 'consumer-selected-over-authoring-snapshot-v1',
    authoringBaseline: baseline,
    requested: selection,
    effective: structuredClone(selection),
    runtimeEffectiveReceiptRequired: true,
    basinRevisionChanged: false,
  };
}

function representationFromPackage(packageDocument) {
  return {
    composition: requiredString(packageDocument.effectiveState.composition.effective, 'fire actor composition'),
    rendererIdentity: requiredString(packageDocument.effectiveState.renderer.identity, 'fire actor renderer identity'),
    backend: requiredString(packageDocument.effectiveState.backend.effective, 'fire actor backend'),
    splatMode: controlValue(packageDocument, 'volume-boundary-splat-mode'),
    splatRadius: controlValue(packageDocument, 'volume-boundary-splat-radius'),
    splatSharpness: controlValue(packageDocument, 'volume-boundary-splat-sharpness'),
    sourceSidecar: controlValue(packageDocument, 'volume-boundary-sidecar-source'),
  };
}

function validateBasinMount(mount, packageDocument) {
  if (mount?.schema !== BASIN_PROMOTION_MOUNT_SCHEMA || mount.status !== 'mounted') {
    throw new Error('fire actor requires a completed basin promotion mount');
  }
  if (mount.revision !== packageDocument.revision || mount.stableRef !== packageDocument.stableRef) {
    throw new Error('fire actor basin mount/package identity mismatch');
  }
  return mount;
}

function createFireActorMount({ basinMount, packageDocument, actorId, consumer, transform, policy }) {
  const validatedPackage = validateBasinPromotionPackage(packageDocument);
  const validatedBasinMount = validateBasinMount(basinMount, validatedPackage);
  const normalizedActorId = requiredString(actorId, 'fire actor id');
  const normalizedConsumer = normalizeConsumer(consumer);
  const normalizedTransform = normalizeTransform(transform);
  const normalizedPolicy = createFireActorPolicy({ packageDocument: validatedPackage, requested: policy });
  const representation = representationFromPackage(validatedPackage);
  const identityBasis = {
    schema: FIRE_ACTOR_MOUNT_SCHEMA,
    actorId: normalizedActorId,
    consumer: normalizedConsumer,
    transform: normalizedTransform,
    basin: {
      stableRef: validatedPackage.stableRef,
      packageSha256: validatedBasinMount.sourcePackage.sha256,
    },
    representation,
    policyId: normalizedPolicy.policyId,
  };
  return {
    schema: FIRE_ACTOR_MOUNT_SCHEMA,
    status: 'mounted',
    mountId: contentIdentity('firemount', identityBasis),
    actorId: normalizedActorId,
    consumer: normalizedConsumer,
    transform: normalizedTransform,
    basin: {
      handle: validatedPackage.handle,
      revision: validatedPackage.revision,
      stableRef: validatedPackage.stableRef,
      sourceCommit: validatedPackage.sourceCommit,
      authoringSnapshotSchema: validatedPackage.schema,
      authoringSnapshotPreserved: true,
    },
    representation,
    policy: normalizedPolicy,
    runtimeApplication: {
      controls: {
        resolution: normalizedPolicy.requested.simulation.gridResolution,
        raySteps: normalizedPolicy.requested.smoke.raySteps,
        adaptiveRays: normalizedPolicy.requested.smoke.adaptiveRays,
        renderScale: normalizedPolicy.requested.smoke.renderScale,
      },
      presentation: {
        raymarchSmoke: normalizedPolicy.requested.smoke.enabled ? 'on' : 'off',
        boundarySplats: normalizedPolicy.requested.splats.enabled ? 'on' : 'off',
        flameContinuity: normalizedPolicy.requested.scheduling.flameContinuity,
      },
      transform: {
        translate: [...normalizedTransform.position],
        scale: normalizedTransform.scale[0],
      },
    },
    sourcePackage: structuredClone(validatedBasinMount.sourcePackage),
    currentChannel: structuredClone(validatedBasinMount.currentChannel),
    settingsPreset: structuredClone(validatedBasinMount.settingsPreset),
    loader: structuredClone(validatedBasinMount.loader),
    activationContract: {
      episodeSchema: FIRE_ACTOR_EPISODE_SCHEMA,
      operatorPreviewRequiresInference: false,
      routeEpisodeRequiresExplicitRouteRef: true,
      runtimeEffectivePresentationRequired: true,
      placementContract: 'world-up-translate-uniform-scale-v1',
    },
  };
}

export function mountPromotedFireActor(options = {}) {
  const outPath = options.outPath || options.out;
  if (!outPath) throw new Error('caller-selected fire actor output path is required');
  const requested = {
    handle: options.handle || null,
    revision: options.revision || null,
    actorId: options.actorId || null,
    consumer: options.consumer || null,
  };
  let failurePhase = 'basin-package-mount';
  const lastTrustworthyEvidence = {
    channelPath: options.channelPath ? resolve(options.channelPath) : null,
  };
  try {
    const basinReceipt = mountBasinPromotionPackage({
      channelPath: options.channelPath,
      packagePath: options.packagePath,
      handle: options.handle,
      revision: options.revision,
      settingsStorePath: options.settingsStorePath,
      origin: options.origin,
      outPath,
    });
    lastTrustworthyEvidence.basinMount = basinReceipt.mount;
    failurePhase = 'fire-actor-contract';
    const packageDocument = validateBasinPromotionPackage(readJson(basinReceipt.packagePath, 'basin promotion package'));
    const mount = createFireActorMount({
      basinMount: basinReceipt.mount,
      packageDocument,
      actorId: options.actorId,
      consumer: options.consumer,
      transform: options.transform,
      policy: options.policy,
    });
    const writtenPath = atomicWriteJson(outPath, mount);
    return {
      ok: true,
      status: 'mounted',
      mountPath: writtenPath,
      basinMount: basinReceipt.mount,
      mount,
    };
  } catch (error) {
    atomicWriteJson(outPath, {
      schema: 'kaminos.fire-actor-mount-failure.v1',
      status: 'failed',
      failurePhase,
      error: error.message || String(error),
      requested,
      lastTrustworthyEvidence,
    });
    throw error;
  }
}

function validateActorMount(mount) {
  if (mount?.schema !== FIRE_ACTOR_MOUNT_SCHEMA || mount.status !== 'mounted') {
    throw new Error('fire actor episode requires a mounted fire actor');
  }
  if (!/^firemount-[a-f0-9]{64}$/.test(String(mount.mountId || ''))) {
    throw new Error('fire actor mount identity is invalid');
  }
  if (!BASIN_REVISION.test(String(mount.basin?.revision || ''))) {
    throw new Error('fire actor basin revision is invalid');
  }
  return mount;
}

function normalizeActivation(value = {}) {
  const mode = requiredString(value.mode, 'fire actor activation mode');
  if (!['operator-preview', 'consumer-route'].includes(mode)) {
    throw new Error(`unsupported fire actor activation mode: ${mode}`);
  }
  const inferenceRequired = boolean(value.inferenceRequired, 'fire actor activation inferenceRequired');
  const routeRef = value.routeRef ? String(value.routeRef) : null;
  const authority = requiredString(value.authority, 'fire actor activation authority');
  if (mode === 'operator-preview' && inferenceRequired) throw new Error('operator preview cannot require inference');
  if (mode === 'operator-preview' && routeRef) throw new Error('operator preview cannot carry a route ref');
  if (mode === 'operator-preview' && authority !== 'operator-selected-preview') {
    throw new Error('operator preview authority must be operator-selected-preview');
  }
  if (mode === 'consumer-route' && !routeRef) throw new Error('consumer route activation requires an explicit route ref');
  return {
    mode,
    authority,
    inferenceRequired,
    routeRef,
  };
}

function fireActorEpisodeIdentity({ episodeId, mountId, activation }) {
  return contentIdentity('fireepisode', {
    schema: FIRE_ACTOR_EPISODE_SCHEMA,
    episodeId,
    mountId,
    activation,
  });
}

export function beginFireActorEpisode({ mount, episodeId, activation } = {}) {
  const actorMount = validateActorMount(mount);
  const normalizedEpisodeId = requiredString(episodeId, 'fire actor episode id');
  const normalizedActivation = normalizeActivation(activation);
  return {
    schema: FIRE_ACTOR_EPISODE_SCHEMA,
    status: 'recording',
    episodeIdentity: fireActorEpisodeIdentity({
      episodeId: normalizedEpisodeId,
      mountId: actorMount.mountId,
      activation: normalizedActivation,
    }),
    episodeId: normalizedEpisodeId,
    mountId: actorMount.mountId,
    actorId: actorMount.actorId,
    basinRevision: actorMount.basin.revision,
    policyId: actorMount.policy.policyId,
    activation: normalizedActivation,
    requestedPresentation: {
      composition: actorMount.representation.composition,
      rendererIdentity: actorMount.representation.rendererIdentity,
      policyId: actorMount.policy.policyId,
    },
  };
}

export function completeFireActorEpisode({ mount, episode, effectivePresentation } = {}) {
  const actorMount = validateActorMount(mount);
  if (episode?.schema !== FIRE_ACTOR_EPISODE_SCHEMA || episode.status !== 'recording') {
    throw new Error('fire actor episode is not recording');
  }
  const activation = normalizeActivation(episode.activation);
  const expectedEpisodeIdentity = fireActorEpisodeIdentity({
    episodeId: requiredString(episode.episodeId, 'fire actor episode id'),
    mountId: actorMount.mountId,
    activation,
  });
  if (episode.mountId !== actorMount.mountId
    || episode.episodeIdentity !== expectedEpisodeIdentity
    || episode.actorId !== actorMount.actorId
    || episode.basinRevision !== actorMount.basin.revision
    || episode.policyId !== actorMount.policy.policyId
    || effectivePresentation?.mountId !== actorMount.mountId
    || effectivePresentation?.episodeId !== episode.episodeId) {
    throw new Error('fire actor episode identity mismatch');
  }
  if (episode.requestedPresentation?.composition !== actorMount.representation.composition
    || episode.requestedPresentation?.rendererIdentity !== actorMount.representation.rendererIdentity
    || episode.requestedPresentation?.policyId !== actorMount.policy.policyId) {
    throw new Error('fire actor episode requested presentation identity mismatch');
  }
  if (effectivePresentation.policyId !== actorMount.policy.policyId
    || effectivePresentation.basinRevision !== actorMount.basin.revision
    || effectivePresentation.composition !== actorMount.representation.composition
    || effectivePresentation.rendererIdentity !== actorMount.representation.rendererIdentity) {
    throw new Error('fire actor effective presentation identity mismatch');
  }
  if (effectivePresentation.fallbackReason) {
    throw new Error(`fire actor effective presentation fallback: ${effectivePresentation.fallbackReason}`);
  }
  return {
    schema: FIRE_ACTOR_EPISODE_SCHEMA,
    status: 'completed',
    episodeIdentity: expectedEpisodeIdentity,
    episodeId: episode.episodeId,
    mountId: actorMount.mountId,
    actorId: actorMount.actorId,
    basinRevision: actorMount.basin.revision,
    policyId: actorMount.policy.policyId,
    activation,
    requestedPresentation: structuredClone(episode.requestedPresentation),
    inferenceRan: activation.inferenceRequired,
    effectivePresentation: structuredClone(effectivePresentation),
  };
}

function parseArgs(argv) {
  const command = argv[0];
  const args = new Map();
  for (let index = 1; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) args.set(key, true);
    else {
      args.set(key, value);
      index += 1;
    }
  }
  return { command, args };
}

function option(args, key) {
  const value = args.get(key);
  return value === true ? null : value;
}

function main() {
  const { command, args } = parseArgs(process.argv.slice(2));
  if (command !== 'mount') {
    throw new Error('usage: volume-fire-actor-mount.mjs mount --channel <current.json> --handle <handle> --revision <basinrev> --settings-store <path> --origin <url> --actor-id <id> --consumer <json> --transform <json> --policy <json> --out <mount.json>');
  }
  const receipt = mountPromotedFireActor({
    channelPath: option(args, '--channel'),
    packagePath: option(args, '--package'),
    handle: option(args, '--handle'),
    revision: option(args, '--revision'),
    settingsStorePath: option(args, '--settings-store'),
    origin: option(args, '--origin'),
    actorId: option(args, '--actor-id'),
    consumer: readJson(option(args, '--consumer'), 'fire actor consumer'),
    transform: readJson(option(args, '--transform'), 'fire actor transform'),
    policy: readJson(option(args, '--policy'), 'fire actor policy'),
    outPath: option(args, '--out'),
  });
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message || error}\n`);
    process.exitCode = 1;
  }
}
