#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  buildVolumeSettingsPresetTarget,
  buildVolumeSettingsPresetVisualTarget,
  validateVolumeSettingsPresetDocument,
} from './volume-settings-preset-contract.mjs';

export const BASIN_PROMOTION_PACKAGE_SCHEMA = 'kaminos.volume.basin-promotion-package.v0';
export const BASIN_PROMOTION_CHANNEL_SCHEMA = 'kaminos.volume.basin-promotion-channel.v0';
export const BASIN_PROMOTION_MOUNT_SCHEMA = 'kaminos.volume.basin-promotion-mount.v0';
export const BASIN_PROMOTION_ROUTING_SCHEMA = 'kaminos.volume.basin-promotion-routing.v0';

const VIEWS = Object.freeze(['splat-only', 'raymarch-only', 'smoke-hybrid', 'full-hybrid-diagnostic']);
const GIT_COMMIT = /^[0-9a-f]{40}$/;
const REVISION = /^basinrev-[a-f0-9]{64}$/;

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
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
  const state = assertObject(value, 'effective basin state');
  for (const key of ['simulator', 'renderer', 'presentation', 'source', 'initialization', 'route', 'backend', 'composition']) {
    if (!state[key] || typeof state[key] !== 'object' || Array.isArray(state[key])) {
      throw new Error(`effective basin state is missing ${key}`);
    }
  }
  if (!state.schemaIdentity && !state.schema) throw new Error('effective basin state is missing schema identity');
  return structuredClone(state);
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

function buildRoutes(settingsReceipt, origin) {
  const loaderTarget = buildVolumeSettingsPresetTarget(settingsReceipt, origin);
  const visual = {};
  for (const view of VIEWS) visual[view] = buildVolumeSettingsPresetVisualTarget(settingsReceipt, origin, view).href;
  return {
    loaderUrl: loaderTarget.href,
    visualUrls: visual,
    sourcePresetAuthority: settingsReceipt.sourcePresetAuthority,
  };
}

function revisionBasisFor({ handle, label, sourceCommit, settingsReceipt, effectiveState, routes }) {
  return {
    schema: BASIN_PROMOTION_PACKAGE_SCHEMA,
    handle,
    label,
    sourceCommit,
    settingsPreset: {
      presetId: settingsReceipt.presetId,
      contentHash: settingsReceipt.contentHash,
      schemaIdentity: settingsReceipt.schemaIdentity,
      controlCount: settingsReceipt.preset.controlCount,
      rendererControlCount: settingsReceipt.rendererControlCount,
      routeEntries: settingsReceipt.routeEntries,
    },
    effectiveState,
    routes,
  };
}

function buildPackageDocument({
  handle,
  label,
  packagePath,
  settingsReceipt,
  settingsPresetDocument,
  sourceCommit,
  effectiveState,
  origin,
}) {
  const routes = buildRoutes(settingsReceipt, origin);
  const basis = revisionBasisFor({ handle, label, sourceCommit, settingsReceipt, effectiveState, routes });
  const revisionHash = sha256(canonicalJson(basis));
  const revision = `basinrev-${revisionHash}`;
  const resolvedPackagePath = resolve(packagePath);
  return {
    schema: BASIN_PROMOTION_PACKAGE_SCHEMA,
    handle,
    label,
    revision,
    stableRef: `${handle}@${revision}`,
    sourceCommit,
    writtenAt: new Date().toISOString(),
    packagePath: resolvedPackagePath,
    packageIdentity: {
      revisionBasisSha256: revisionHash,
      revisionBasis: basis,
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
      storePath: settingsReceipt.storePath || settingsPresetDocument.storePath || null,
    },
    effectiveState,
    routes,
    routing: {
      controlPlane: {
        schema: BASIN_PROMOTION_ROUTING_SCHEMA,
        handle,
        revision,
        packagePath: resolvedPackagePath,
        sourceCommit,
        stableRef: `${handle}@${revision}`,
        packageSchema: BASIN_PROMOTION_PACKAGE_SCHEMA,
      },
      consumer: {
        mountContract: BASIN_PROMOTION_MOUNT_SCHEMA,
        channelSchema: BASIN_PROMOTION_CHANNEL_SCHEMA,
        replaceRevisionByUpdatingChannel: true,
        immutablePackageContents: true,
      },
    },
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
  const basis = revisionBasisFor({
    handle: document.handle,
    label: document.label,
    sourceCommit: document.sourceCommit,
    settingsReceipt: {
      presetId: document.settingsPreset?.presetId,
      contentHash: document.settingsPreset?.contentHash,
      schemaIdentity: document.settingsPreset?.schemaIdentity,
      preset: { controlCount: document.settingsPreset?.controlCount },
      rendererControlCount: document.settingsPreset?.rendererControlCount,
      routeEntries: document.packageIdentity?.revisionBasis?.settingsPreset?.routeEntries,
    },
    effectiveState: document.effectiveState,
    routes: document.routes,
  });
  const expected = `basinrev-${sha256(canonicalJson(basis))}`;
  if (document.revision !== expected || document.packageIdentity?.revisionBasisSha256 !== expected.slice('basinrev-'.length)) {
    throw new Error('basin promotion package revision hash mismatch');
  }
  if (document.routing?.controlPlane?.schema !== BASIN_PROMOTION_ROUTING_SCHEMA) {
    throw new Error('basin promotion package control-plane routing metadata is missing');
  }
  if (document.routing?.consumer?.mountContract !== BASIN_PROMOTION_MOUNT_SCHEMA) {
    throw new Error('basin promotion package consumer mount contract is missing');
  }
  return document;
}

export function writeBasinPromotionPackage(options = {}) {
  const packagePath = options.packagePath || options.package;
  if (!packagePath) throw new Error('caller-selected package path is required');
  const handle = slugifyHandle(options.handle);
  const label = String(options.label || options.handle || handle).trim();
  const sourceCommit = resolveSourceCommit(options.sourceCommit);
  const settingsSchema = options.settingsSchema || readJson(options.settingsSchemaPath, 'settings preset schema');
  const settingsPresetDocument = options.settingsPresetDocument || readJson(options.settingsPresetPath, 'settings preset artifact');
  const settingsReceipt = validateVolumeSettingsPresetDocument(
    settingsPresetDocument,
    settingsPresetDocument.requestedPresetRef || settingsPresetDocument.presetId,
    settingsSchema,
  );
  const effectiveState = normalizeEffectiveState(options.effectiveState || readJson(options.effectiveStatePath, 'effective basin state'));
  const origin = String(options.origin || effectiveState.route?.targetOrigin || 'http://127.0.0.1:8090');
  const packageDocument = buildPackageDocument({
    handle,
    label,
    packagePath,
    settingsReceipt,
    settingsPresetDocument,
    sourceCommit,
    effectiveState,
    origin,
  });
  const resolvedPackagePath = atomicWriteJson(packagePath, packageDocument);
  const packageSha256 = sha256File(resolvedPackagePath);
  let channelPath = null;
  if (options.channelPath || options.channel) {
    channelPath = writeBasinPromotionChannel({
      channelPath: options.channelPath || options.channel,
      packagePath: resolvedPackagePath,
      packageDocument,
      packageSha256,
    }).channelPath;
  }
  return {
    ok: true,
    status: 'written',
    schema: 'kaminos.volume.basin-promotion-package-write-receipt.v0',
    handle,
    label,
    revision: packageDocument.revision,
    stableRef: packageDocument.stableRef,
    packagePath: resolvedPackagePath,
    packageSha256,
    channelPath,
    loaderUrl: packageDocument.routes.loaderUrl,
    sourceCommit,
  };
}

export function writeBasinPromotionChannel({ channelPath, packagePath, packageDocument, packageSha256 }) {
  if (!channelPath) throw new Error('caller-selected channel path is required');
  const existing = existsSync(channelPath) ? readJson(resolve(channelPath), 'basin promotion channel') : null;
  if (existing && existing.schema !== BASIN_PROMOTION_CHANNEL_SCHEMA) throw new Error('basin promotion channel schema mismatch');
  if (existing && existing.handle !== packageDocument.handle) throw new Error('basin promotion channel handle mismatch');
  const current = {
    revision: packageDocument.revision,
    stableRef: packageDocument.stableRef,
    packagePath: resolve(packagePath),
    packageSha256,
    sourceCommit: packageDocument.sourceCommit,
    updatedAt: packageDocument.writtenAt,
  };
  const previous = Array.isArray(existing?.history) ? existing.history : [];
  const history = [
    ...previous.filter(entry => entry.revision !== current.revision),
    current,
  ];
  const channel = {
    schema: BASIN_PROMOTION_CHANNEL_SCHEMA,
    handle: packageDocument.handle,
    label: packageDocument.label,
    current,
    history,
  };
  return {
    channelPath: atomicWriteJson(channelPath, channel),
    channel,
  };
}

export function mountBasinPromotionPackage(options = {}) {
  const packagePath = options.packagePath || options.package;
  if (!packagePath) throw new Error('package path is required');
  const resolvedPackagePath = resolve(packagePath);
  const packageDocument = validateBasinPromotionPackage(readJson(resolvedPackagePath, 'basin promotion package'));
  const packageSha256 = sha256File(resolvedPackagePath);
  const expectedHandle = options.handle ? slugifyHandle(options.handle) : packageDocument.handle;
  if (expectedHandle !== packageDocument.handle) throw new Error(`mount handle mismatch: ${expectedHandle} != ${packageDocument.handle}`);
  if (options.revision && options.revision !== packageDocument.revision) {
    throw new Error(`mount revision mismatch: ${options.revision} != ${packageDocument.revision}`);
  }
  let currentChannel = null;
  if (options.channelPath || options.channel) {
    const channelPath = resolve(options.channelPath || options.channel);
    const channel = readJson(channelPath, 'basin promotion channel');
    if (channel.schema !== BASIN_PROMOTION_CHANNEL_SCHEMA) throw new Error('basin promotion channel schema mismatch');
    if (channel.handle !== packageDocument.handle) throw new Error('basin promotion channel handle mismatch');
    if (channel.current?.revision !== packageDocument.revision) throw new Error('basin promotion channel current revision mismatch');
    if (resolve(channel.current?.packagePath || '') !== resolvedPackagePath) {
      throw new Error('basin promotion channel package path mismatch');
    }
    currentChannel = {
      path: channelPath,
      revision: channel.current.revision,
      packagePath: channel.current.packagePath,
    };
  }
  const mount = {
    schema: BASIN_PROMOTION_MOUNT_SCHEMA,
    status: 'mounted',
    handle: packageDocument.handle,
    label: packageDocument.label,
    revision: packageDocument.revision,
    stableRef: packageDocument.stableRef,
    mountedAt: new Date().toISOString(),
    sourcePackage: {
      path: resolvedPackagePath,
      sha256: packageSha256,
      schema: packageDocument.schema,
      sourceCommit: packageDocument.sourceCommit,
    },
    currentChannel,
    loader: {
      targetUrl: packageDocument.routes.loaderUrl,
      visualUrls: packageDocument.routes.visualUrls,
      settingsPresetId: packageDocument.settingsPreset.presetId,
      settingsPresetAuthority: packageDocument.settingsPreset.sourcePresetAuthority,
    },
    consumerContract: {
      schema: BASIN_PROMOTION_MOUNT_SCHEMA,
      exactRevisionRequired: true,
      replaceRevisionByUpdatingChannel: true,
      packageContentsImmutable: true,
    },
  };
  const mountPath = options.outPath || options.out;
  if (mountPath) atomicWriteJson(mountPath, mount);
  return {
    ok: true,
    status: 'mounted',
    handle: mount.handle,
    revision: mount.revision,
    packagePath: resolvedPackagePath,
    packageSha256,
    mountPath: mountPath ? resolve(mountPath) : null,
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

function main() {
  const { command, args } = parseArgs(process.argv.slice(2));
  if (command === 'export') {
    const receipt = writeBasinPromotionPackage({
      handle: option(args, '--handle'),
      label: option(args, '--label') || option(args, '--handle'),
      packagePath: option(args, '--package'),
      settingsPresetPath: option(args, '--settings-preset'),
      settingsSchemaPath: option(args, '--settings-schema'),
      effectiveStatePath: option(args, '--effective-state'),
      sourceCommit: option(args, '--source-commit'),
      origin: option(args, '--origin'),
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
      outPath: option(args, '--out'),
    });
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
    return;
  }
  throw new Error('usage: volume-basin-promotion-package.mjs <export|mount> [options]');
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message || error}\n`);
    process.exitCode = 1;
  }
}
