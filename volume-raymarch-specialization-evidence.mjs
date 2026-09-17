import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, readlinkSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { selectiveHeadLiveRoleAuthority } from './volume-core.js';

export const EXPECTED_RAYMARCH_WRAPPER_ROUTE = 'exact-basin-selective-head-live-v0';
export const EXPECTED_RAYMARCH_RENDERER_ROUTE = 'native-3d-compute-fluid-raymarch-v0';
export const EXPECTED_RAYMARCH_COMPOSITION = 'raymarch-only-v0';

function hasOwn(object, key) {
  return object != null && Object.hasOwn(object, key);
}

function hasExplicitNull(object, key) {
  return hasOwn(object, key) && object[key] === null;
}

export function runtimeAdmissionAccepted(state, expected = {}) {
  return state?.wrapperRoute === EXPECTED_RAYMARCH_WRAPPER_ROUTE
    && state?.wrapperStatus === 'running'
    && hasExplicitNull(state, 'wrapperFallbackReason')
    && state?.effectiveComposition === EXPECTED_RAYMARCH_COMPOSITION
    && state?.active
    && state?.effectiveRoute === EXPECTED_RAYMARCH_RENDERER_ROUTE
    && hasExplicitNull(state, 'rendererFallbackReason')
    && String(state.backend || '').startsWith('WebGPU')
    && typeof state.requestedRole === 'string'
    && state.requestedRole.length > 0
    && state.effectiveRole === state.requestedRole
    && state.roleAuthority === selectiveHeadLiveRoleAuthority(state.requestedRole)
    && state.roleAuthority !== 'off'
    && (!expected.requestedRole || state.requestedRole === expected.requestedRole)
    && state.frameCount > 2;
}

export function assertSpecializationSampleRoute(sample, arm, admitted) {
  if (!runtimeAdmissionAccepted(admitted)) {
    throw new Error(`${arm}-sample-bound-to-unadmitted-runtime`);
  }
  if (sample?.effectiveRoute !== admitted.effectiveRoute) {
    throw new Error(`${arm}-sample-renderer-route-drift:${sample?.effectiveRoute}`);
  }
  if (sample?.backend !== admitted.backend) {
    throw new Error(`${arm}-sample-backend-drift:${sample?.backend}`);
  }
  if (sample?.requestedRole !== admitted.requestedRole
    || sample?.effectiveRole !== admitted.effectiveRole) {
    throw new Error(`${arm}-sample-role-drift:${sample?.requestedRole}:${sample?.effectiveRole}`);
  }
  if (sample?.roleAuthority !== admitted.roleAuthority) {
    throw new Error(`${arm}-sample-role-authority-drift:${sample?.roleAuthority}`);
  }
  if (!hasExplicitNull(sample, 'fallbackReason') || !hasExplicitNull(sample, 'boundarySplatFallbackReason')) {
    throw new Error(`${arm}-sample-renderer-fallback:${sample?.fallbackReason || sample?.boundarySplatFallbackReason}`);
  }
  if (sample?.wrapperRoute !== admitted.wrapperRoute
    || sample?.wrapperStatus !== admitted.wrapperStatus
    || !hasExplicitNull(sample, 'wrapperFallbackReason')
    || sample?.wrapperEffectiveComposition !== admitted.effectiveComposition) {
    throw new Error(`${arm}-sample-wrapper-drift`);
  }
  const receipt = sample?.selectiveHeadLivePassReceipt;
  if (receipt?.composition !== EXPECTED_RAYMARCH_COMPOSITION) {
    throw new Error(`${arm}-sample-composition-drift:${receipt?.composition}`);
  }
  if (!hasExplicitNull(receipt, 'fallbackReason')) {
    throw new Error(`${arm}-sample-fallback:${receipt.fallbackReason}`);
  }
  if (receipt.raymarchApplied !== true || receipt.splatApplied !== false) {
    throw new Error(`${arm}-sample-pass-tuple-drift`);
  }
}

export function createEvidenceSourceManifest({ root, excludedPaths = [] }) {
  const absoluteRoot = resolve(root);
  const trackedPaths = new Set(gitPathList(absoluteRoot, ['ls-files', '-z']));
  const candidatePaths = [...new Set(gitPathList(absoluteRoot, ['ls-files', '-co', '--exclude-standard', '-z']))]
    .sort((left, right) => left.localeCompare(right));
  const exclusions = excludedPaths
    .map(path => normalizeExclusion(absoluteRoot, path))
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
  const entries = candidatePaths
    .filter(path => !exclusions.some(exclusion => path === exclusion || path.startsWith(`${exclusion}/`)))
    .map(path => sourceEntry(absoluteRoot, path, trackedPaths.has(path)));
  const identity = {
    schema: 'kaminos.evidence-source-manifest.v0',
    exclusions,
    entries,
  };
  return {
    ...identity,
    sha256: createHash('sha256').update(`${JSON.stringify(identity)}\n`).digest('hex'),
  };
}

function gitPathList(root, argv) {
  return execFileSync('git', argv, { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
}

function normalizeExclusion(root, path) {
  if (!path) return null;
  const absolute = isAbsolute(path) ? resolve(path) : resolve(root, path);
  const candidate = relative(root, absolute).split(sep).join('/');
  if (!candidate || candidate === '.') return null;
  if (candidate === '..' || candidate.startsWith('../')) return null;
  return candidate.replace(/\/$/, '');
}

function sourceEntry(root, path, tracked) {
  const absolute = resolve(root, path);
  const stat = lstatSync(absolute);
  const bytes = stat.isSymbolicLink()
    ? Buffer.from(readlinkSync(absolute))
    : readFileSync(absolute);
  return {
    path,
    tracked,
    mode: stat.isSymbolicLink() ? '120000' : stat.mode.toString(8).slice(-6),
    byteLength: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}
