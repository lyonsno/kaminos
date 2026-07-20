#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  buildVolumeSettingsPresetTarget,
  buildVolumeSettingsPresetVisualTarget,
  validateVolumeSettingsPresetDocument,
} from './volume-settings-preset-contract.mjs';

export const BASIN_PROMOTION_PACKAGE_SCHEMA = 'kaminos.volume.basin-promotion-package.v1';
export const BASIN_PROMOTION_CHANNEL_SCHEMA = 'kaminos.volume.basin-promotion-channel.v1';
export const BASIN_PROMOTION_MOUNT_SCHEMA = 'kaminos.volume.basin-promotion-mount.v1';
export const BASIN_PROMOTION_ROUTING_SCHEMA = 'kaminos.volume.basin-promotion-routing.v1';

const VIEWS = Object.freeze(['splat-only', 'raymarch-only', 'smoke-hybrid', 'full-hybrid-diagnostic']);
const GIT_COMMIT = /^[0-9a-f]{40}$/;
const REVISION = /^basinrev-[a-f0-9]{64}$/;
const ROUTE_ORIGIN = 'http://kaminos.invalid';

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(entry => entry === undefined ? 'null' : canonicalJson(entry)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .filter(key => value[key] !== undefined)
      .sort()
      .map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function sha256File(path) {
  return sha256(readFileSync(path));
}

function readJson(path, label = 'JSON') {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`${label} is unreadable at ${path}: ${error.message}`);
  }
}

function atomicWriteJson(path, payload) {
  const resolved = resolve(path);
  mkdirSync(dirname(resolved), { recursive: true });
  const temporary = `${resolved}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`);
  renameSync(temporary, resolved);
  return resolved;
}

function slugifyHandle(value) {
  const slug = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
  if (!slug) throw new Error('basin promotion handle is required');
  return slug;
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return value;
}

function normalizeEffectiveState(value = {}) {
  const state = structuredClone(assertObject(value, 'effective basin state'));
  for (const key of ['simulator', 'renderer', 'presentation', 'source', 'initialization', 'route', 'backend', 'composition']) {
    if (!state[key] || typeof state[key] !== 'object' || Array.isArray(state[key])) {
      throw new Error(`effective basin state is missing ${key}`);
    }
  }
  if (!state.schemaIdentity && !state.schema) throw new Error('effective basin state is missing schema identity');
  delete state.capturedAt;
  return state;
}

function bindEffectiveStateToPreset(value, presetId) {
  const state = normalizeEffectiveState(value);
  state.source.settingsPresetId = presetId;
  state.initialization.settingsPresetId = presetId;
  return state;
}

function assertEffectiveStatePresetBinding(state, presetId) {
  if (state.source.settingsPresetId !== presetId
    || state.initialization.settingsPresetId !== presetId) {
    throw new Error('effective basin state settings preset identity mismatch');
  }
}

function assertSettingsPresetSummary(summary, receipt) {
  assertObject(summary, 'basin promotion settings preset summary');
  const expected = {
    presetId: receipt.presetId,
    requestedPresetRef: receipt.requestedPresetRef,
    alias: receipt.alias,
    label: receipt.label,
    contentHash: receipt.contentHash,
    schemaIdentity: receipt.schemaIdentity,
    controlCount: receipt.preset.controlCount,
    rendererControlCount: receipt.rendererControlCount,
    sourcePresetAuthority: receipt.sourcePresetAuthority,
  };
  for (const [field, value] of Object.entries(expected)) {
    if (canonicalJson(summary[field]) !== canonicalJson(value)) {
      throw new Error(`basin promotion settings preset summary ${field} mismatch`);
    }
  }
}

function resolveSourceCommit(inputCommit = null) {
  const requested = String(inputCommit || '').trim();
  if (requested) {
    if (!GIT_COMMIT.test(requested)) throw new Error(`source commit must be a 40-hex git commit: ${requested}`);
    return requested;
  }
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' });
  if (result.status !== 0 || !GIT_COMMIT.test(result.stdout.trim())) {
    throw new Error(`could not resolve source commit: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

function portablePresetArtifact(document) {
  return {
    identity: document.identity,
    presetId: document.presetId,
    requestedPresetRef: document.requestedPresetRef,
    alias: document.alias || null,
    label: document.label || document.initialLabel || null,
    contentHash: document.contentHash,
    schemaIdentity: document.schemaIdentity,
    controlCount: document.controlCount,
    preset: structuredClone(document.preset),
  };
}

function relativeTarget(target) {
  return `${target.pathname}${target.search}${target.hash}`;
}

function buildRouteTemplates(settingsReceipt) {
  const loaderTarget = buildVolumeSettingsPresetTarget(settingsReceipt, ROUTE_ORIGIN);
  const visual = {};
  for (const view of VIEWS) {
    visual[view] = relativeTarget(buildVolumeSettingsPresetVisualTarget(settingsReceipt, ROUTE_ORIGIN, view));
  }
  return {
    loader: relativeTarget(loaderTarget),
    visual,
    sourcePresetAuthority: settingsReceipt.sourcePresetAuthority,
  };
}

function materializeRoutes(routes, origin) {
  let base;
  try {
    base = new URL(String(origin || ''));
  } catch (error) {
    throw new Error(`consumer origin is invalid: ${error.message}`);
  }
  if (!['http:', 'https:'].includes(base.protocol)) throw new Error('consumer origin must use http or https');
  const visualUrls = {};
  for (const [view, target] of Object.entries(routes.visual || {})) {
    visualUrls[view] = new URL(target, base).href;
  }
  return {
    targetUrl: new URL(routes.loader, base).href,
    visualUrls,
  };
}

function revisionBasisFor({ handle, label, sourceCommit, settingsArtifact, settingsSchema, effectiveState, routes }) {
  return {
    schema: BASIN_PROMOTION_PACKAGE_SCHEMA,
    handle,
    label,
    sourceCommit,
    settingsPreset: {
      artifact: settingsArtifact,
      schema: settingsSchema,
    },
    effectiveState,
    routes,
  };
}

function preparePackage(options = {}) {
  const handle = slugifyHandle(options.handle);
  const label = String(options.label || options.handle || handle).trim();
  const sourceCommit = resolveSourceCommit(options.sourceCommit);
  const settingsSchema = structuredClone(
    options.settingsSchema || readJson(options.settingsSchemaPath, 'settings preset schema'),
  );
  const sourcePresetDocument = options.settingsPresetDocument
    || readJson(options.settingsPresetPath, 'settings preset artifact');
  validateVolumeSettingsPresetDocument(
    sourcePresetDocument,
    sourcePresetDocument.requestedPresetRef || sourcePresetDocument.presetId,
    settingsSchema,
  );
  const settingsArtifact = portablePresetArtifact(sourcePresetDocument);
  const settingsReceipt = validateVolumeSettingsPresetDocument(
    settingsArtifact,
    settingsArtifact.requestedPresetRef || settingsArtifact.presetId,
    settingsSchema,
  );
  const effectiveState = bindEffectiveStateToPreset(
    options.effectiveState || readJson(options.effectiveStatePath, 'effective basin state'),
    settingsReceipt.presetId,
  );
  const routes = buildRouteTemplates(settingsReceipt);
  const basis = revisionBasisFor({
    handle,
    label,
    sourceCommit,
    settingsArtifact,
    settingsSchema,
    effectiveState,
    routes,
  });
  const revisionHash = sha256(canonicalJson(basis));
  const revision = `basinrev-${revisionHash}`;
  const stableRef = `${handle}@${revision}`;
  return {
    packageDocument: {
      schema: BASIN_PROMOTION_PACKAGE_SCHEMA,
      handle,
      label,
      revision,
      stableRef,
      sourceCommit,
      packageIdentity: {
        revisionBasisSha256: revisionHash,
        canonicalRelativePath: `revisions/${revision}/package.json`,
      },
      settingsPreset: {
        presetId: settingsReceipt.presetId,
        requestedPresetRef: settingsReceipt.requestedPresetRef,
        alias: settingsReceipt.alias,
        label: settingsReceipt.label,
        contentHash: settingsReceipt.contentHash,
        schemaIdentity: settingsReceipt.schemaIdentity,
        controlCount: settingsReceipt.preset.controlCount,
        rendererControlCount: settingsReceipt.rendererControlCount,
        sourcePresetAuthority: settingsReceipt.sourcePresetAuthority,
        artifact: settingsArtifact,
        schema: settingsSchema,
      },
      effectiveState,
      routes,
      routing: {
        controlPlane: {
          schema: BASIN_PROMOTION_ROUTING_SCHEMA,
          handle,
          revision,
          sourceCommit,
          stableRef,
          packageSchema: BASIN_PROMOTION_PACKAGE_SCHEMA,
          canonicalRelativePath: `revisions/${revision}/package.json`,
        },
        consumer: {
          mountContract: BASIN_PROMOTION_MOUNT_SCHEMA,
          channelSchema: BASIN_PROMOTION_CHANNEL_SCHEMA,
          replaceRevisionByUpdatingChannel: true,
          immutablePackageContents: true,
          installEmbeddedPreset: true,
          consumerOriginRequired: true,
        },
      },
    },
    handle,
    label,
    revision,
    stableRef,
    sourceCommit,
  };
}

export function validateBasinPromotionPackage(packageDocument) {
  const document = assertObject(packageDocument, 'basin promotion package');
  if (document.schema !== BASIN_PROMOTION_PACKAGE_SCHEMA) throw new Error('basin promotion package schema mismatch');
  const handle = slugifyHandle(document.handle);
  if (handle !== document.handle) throw new Error('basin promotion package handle is not stable');
  if (!REVISION.test(String(document.revision || ''))) throw new Error('basin promotion package revision is invalid');
  if (!GIT_COMMIT.test(String(document.sourceCommit || ''))) throw new Error('basin promotion package source commit is invalid');
  if (document.stableRef !== `${document.handle}@${document.revision}`) throw new Error('basin promotion package stable ref mismatch');
  const settingsReceipt = validateVolumeSettingsPresetDocument(
    document.settingsPreset?.artifact,
    document.settingsPreset?.presetId,
    document.settingsPreset?.schema,
  );
  assertSettingsPresetSummary(document.settingsPreset, settingsReceipt);
  const effectiveState = normalizeEffectiveState(document.effectiveState);
  assertEffectiveStatePresetBinding(effectiveState, settingsReceipt.presetId);
  const expectedRoutes = buildRouteTemplates(settingsReceipt);
  if (canonicalJson(document.routes) !== canonicalJson(expectedRoutes)) {
    throw new Error('basin promotion package route templates do not match embedded preset');
  }
  const basis = revisionBasisFor({
    handle: document.handle,
    label: document.label,
    sourceCommit: document.sourceCommit,
    settingsArtifact: document.settingsPreset.artifact,
    settingsSchema: document.settingsPreset.schema,
    effectiveState,
    routes: document.routes,
  });
  const expected = `basinrev-${sha256(canonicalJson(basis))}`;
  if (document.revision !== expected
    || document.packageIdentity?.revisionBasisSha256 !== expected.slice('basinrev-'.length)) {
    throw new Error('basin promotion package revision hash mismatch');
  }
  const canonicalRelativePath = `revisions/${document.revision}/package.json`;
  if (document.packageIdentity?.canonicalRelativePath !== canonicalRelativePath
    || document.routing?.controlPlane?.canonicalRelativePath !== canonicalRelativePath) {
    throw new Error('basin promotion package canonical relative path mismatch');
  }
  if (document.routing?.controlPlane?.schema !== BASIN_PROMOTION_ROUTING_SCHEMA) {
    throw new Error('basin promotion package control-plane routing metadata is missing');
  }
  if (document.routing?.consumer?.mountContract !== BASIN_PROMOTION_MOUNT_SCHEMA) {
    throw new Error('basin promotion package consumer mount contract is missing');
  }
  return document;
}

function portableRelativePath(fromDirectory, targetPath, label, allowParent = false) {
  const candidate = relative(resolve(fromDirectory), resolve(targetPath)).split(sep).join('/');
  if (!candidate || isAbsolute(candidate) || (!allowParent && (candidate === '..' || candidate.startsWith('../')))) {
    throw new Error(`${label} must remain inside its portable root`);
  }
  return candidate;
}

export function writeBasinPromotionChannel({ channelPath, packagePath, packageDocument, packageSha256 }) {
  if (!channelPath) throw new Error('caller-selected channel path is required');
  const resolvedChannelPath = resolve(channelPath);
  const existing = existsSync(resolvedChannelPath) ? readJson(resolvedChannelPath, 'basin promotion channel') : null;
  if (existing && existing.schema !== BASIN_PROMOTION_CHANNEL_SCHEMA) throw new Error('basin promotion channel schema mismatch');
  if (existing && existing.handle !== packageDocument.handle) throw new Error('basin promotion channel handle mismatch');
  const current = {
    revision: packageDocument.revision,
    stableRef: packageDocument.stableRef,
    packageRelativePath: portableRelativePath(dirname(resolvedChannelPath), packagePath, 'channel package path'),
    packageSha256,
    sourceCommit: packageDocument.sourceCommit,
    updatedAt: new Date().toISOString(),
  };
  const previous = Array.isArray(existing?.history) ? existing.history : [];
  const history = [...previous.filter(entry => entry.revision !== current.revision), current];
  const channel = {
    schema: BASIN_PROMOTION_CHANNEL_SCHEMA,
    handle: packageDocument.handle,
    label: packageDocument.label,
    current,
    history,
  };
  return {
    channelPath: atomicWriteJson(resolvedChannelPath, channel),
    channel,
  };
}

function writePreparedPackage(prepared, packagePath, channelPath = null) {
  const resolvedPackagePath = atomicWriteJson(packagePath, prepared.packageDocument);
  const packageSha256 = sha256File(resolvedPackagePath);
  const resolvedChannelPath = channelPath
    ? writeBasinPromotionChannel({
      channelPath,
      packagePath: resolvedPackagePath,
      packageDocument: prepared.packageDocument,
      packageSha256,
    }).channelPath
    : null;
  return {
    ok: true,
    status: 'written',
    schema: 'kaminos.volume.basin-promotion-package-write-receipt.v1',
    handle: prepared.handle,
    label: prepared.label,
    revision: prepared.revision,
    stableRef: prepared.stableRef,
    packagePath: resolvedPackagePath,
    packageSha256,
    channelPath: resolvedChannelPath,
    routeTemplates: prepared.packageDocument.routes,
    sourceCommit: prepared.sourceCommit,
  };
}

export function writeBasinPromotionPackage(options = {}) {
  const packagePath = options.packagePath || options.package;
  if (!packagePath) throw new Error('caller-selected package path is required');
  return writePreparedPackage(
    preparePackage(options),
    packagePath,
    options.channelPath || options.channel || null,
  );
}

export function promoteBasinPackage(options = {}) {
  const promotionRoot = options.promotionRoot || options.root;
  if (!promotionRoot) throw new Error('caller-selected promotion root is required');
  const prepared = preparePackage(options);
  const basinRoot = join(resolve(promotionRoot), prepared.handle);
  const packagePath = join(basinRoot, 'revisions', prepared.revision, 'package.json');
  const channelPath = join(basinRoot, 'current.json');
  return {
    ...writePreparedPackage(prepared, packagePath, channelPath),
    promotionRoot: resolve(promotionRoot),
    basinRoot,
    packageRelativePath: portableRelativePath(basinRoot, packagePath, 'promotion package path'),
    channelRelativePath: portableRelativePath(resolve(promotionRoot), channelPath, 'promotion channel path'),
  };
}

function validateChannel(channel) {
  assertObject(channel, 'basin promotion channel');
  if (channel.schema !== BASIN_PROMOTION_CHANNEL_SCHEMA) throw new Error('basin promotion channel schema mismatch');
  if (slugifyHandle(channel.handle) !== channel.handle) throw new Error('basin promotion channel handle is not stable');
  if (!REVISION.test(String(channel.current?.revision || ''))) throw new Error('basin promotion channel current revision is invalid');
  const packageRelativePath = String(channel.current?.packageRelativePath || '');
  const canonicalRelativePath = `revisions/${channel.current.revision}/package.json`;
  if (packageRelativePath !== canonicalRelativePath) {
    throw new Error('basin promotion channel package path is not canonical');
  }
  return channel;
}

function installPresetArtifact(settingsStorePath, packageDocument) {
  const storePath = resolve(settingsStorePath);
  const presetPath = join(storePath, 'presets', `${packageDocument.settingsPreset.presetId}.json`);
  const artifact = packageDocument.settingsPreset.artifact;
  if (existsSync(presetPath)) {
    const existing = readJson(presetPath, 'consumer settings preset');
    if (canonicalJson(existing) !== canonicalJson(artifact)) {
      throw new Error('consumer settings store contains conflicting preset content');
    }
  } else {
    atomicWriteJson(presetPath, artifact);
  }
  return presetPath;
}

export function mountBasinPromotionPackage(options = {}) {
  const channelInput = options.channelPath || options.channel;
  if (!channelInput) throw new Error('channel path is required');
  if (!options.handle) throw new Error('exact mount handle is required');
  if (!options.revision) throw new Error('exact mount revision is required');
  const settingsStoreInput = options.settingsStorePath || options.settingsStore;
  if (!settingsStoreInput) throw new Error('caller-selected consumer settings store is required');
  if (!options.origin) throw new Error('consumer origin is required');

  const channelPath = resolve(channelInput);
  const channel = validateChannel(readJson(channelPath, 'basin promotion channel'));
  const resolvedPackagePath = resolve(dirname(channelPath), channel.current.packageRelativePath);
  const requestedPackagePath = options.packagePath || options.package;
  if (requestedPackagePath && resolve(requestedPackagePath) !== resolvedPackagePath) {
    throw new Error('basin promotion channel package path mismatch');
  }
  const packageDocument = validateBasinPromotionPackage(readJson(resolvedPackagePath, 'basin promotion package'));
  const packageSha256 = sha256File(resolvedPackagePath);
  const expectedHandle = slugifyHandle(options.handle);
  if (expectedHandle !== packageDocument.handle || channel.handle !== packageDocument.handle) {
    throw new Error(`mount handle mismatch: ${expectedHandle} != ${packageDocument.handle}`);
  }
  if (options.revision !== packageDocument.revision) {
    throw new Error(`mount revision mismatch: ${options.revision} != ${packageDocument.revision}`);
  }
  if (channel.current.revision !== packageDocument.revision) {
    throw new Error('basin promotion channel current revision mismatch');
  }
  if (channel.current.packageSha256 !== packageSha256) throw new Error('basin promotion channel package hash mismatch');

  const presetPath = installPresetArtifact(settingsStoreInput, packageDocument);
  const materializedRoutes = materializeRoutes(packageDocument.routes, options.origin);
  const mountPathInput = options.outPath || options.out;
  const mountPath = mountPathInput ? resolve(mountPathInput) : null;
  const locatorBase = mountPath ? dirname(mountPath) : dirname(channelPath);
  const mount = {
    schema: BASIN_PROMOTION_MOUNT_SCHEMA,
    status: 'mounted',
    handle: packageDocument.handle,
    label: packageDocument.label,
    revision: packageDocument.revision,
    stableRef: packageDocument.stableRef,
    sourcePackage: {
      relativePath: portableRelativePath(locatorBase, resolvedPackagePath, 'mount package path', true),
      sha256: packageSha256,
      schema: packageDocument.schema,
      sourceCommit: packageDocument.sourceCommit,
    },
    currentChannel: {
      relativePath: portableRelativePath(locatorBase, channelPath, 'mount channel path', true),
      revision: channel.current.revision,
      packageRelativePath: channel.current.packageRelativePath,
    },
    settingsPreset: {
      presetId: packageDocument.settingsPreset.presetId,
      authority: packageDocument.settingsPreset.sourcePresetAuthority,
      storeRelativePath: portableRelativePath(locatorBase, presetPath, 'mount settings store path', true),
    },
    loader: materializedRoutes,
    consumerContract: {
      schema: BASIN_PROMOTION_MOUNT_SCHEMA,
      exactRevisionRequired: true,
      replaceRevisionByUpdatingChannel: true,
      packageContentsImmutable: true,
      embeddedPresetInstalled: true,
    },
  };
  if (mountPath) atomicWriteJson(mountPath, mount);
  return {
    ok: true,
    status: 'mounted',
    handle: mount.handle,
    revision: mount.revision,
    packagePath: resolvedPackagePath,
    packageSha256,
    channelPath,
    settingsPresetPath: presetPath,
    mountPath,
    mount,
  };
}

function parseArgs(argv) {
  const command = argv[0];
  const args = new Map();
  for (let index = 1; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) args.set(key, true);
    else {
      args.set(key, next);
      index += 1;
    }
  }
  return { command, args };
}

function option(args, name) {
  const value = args.get(name);
  return value === true ? null : value;
}

function packageOptions(args) {
  return {
    handle: option(args, '--handle'),
    label: option(args, '--label') || option(args, '--handle'),
    settingsPresetPath: option(args, '--settings-preset'),
    settingsSchemaPath: option(args, '--settings-schema'),
    effectiveStatePath: option(args, '--effective-state'),
    sourceCommit: option(args, '--source-commit'),
  };
}

function main() {
  const { command, args } = parseArgs(process.argv.slice(2));
  if (command === 'promote') {
    const receipt = promoteBasinPackage({
      ...packageOptions(args),
      promotionRoot: option(args, '--root'),
    });
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
    return;
  }
  if (command === 'export') {
    const receipt = writeBasinPromotionPackage({
      ...packageOptions(args),
      packagePath: option(args, '--package'),
      channelPath: option(args, '--channel'),
    });
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
    return;
  }
  if (command === 'mount') {
    const receipt = mountBasinPromotionPackage({
      packagePath: option(args, '--package'),
      channelPath: option(args, '--channel'),
      handle: option(args, '--handle'),
      revision: option(args, '--revision'),
      settingsStorePath: option(args, '--settings-store'),
      origin: option(args, '--origin'),
      outPath: option(args, '--out'),
    });
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
    return;
  }
  throw new Error('usage: volume-basin-promotion-package.mjs <promote|export|mount> [options]');
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message || error}\n`);
    process.exitCode = 1;
  }
}
