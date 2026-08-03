import { readFileSync } from 'node:fs';
import path from 'node:path';

export const SF3D_RUNTIME_KIT_PACKAGE = '@kaminos/webgpu-inference-kit';

function readJson(filePath, label) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`${label} could not be read at ${filePath}: ${error.message || String(error)}`);
  }
}

export function resolveSf3dRuntimeKitIdentity(repo, expectedVersion) {
  const requestedPackagePath = path.join(repo, 'package.json');
  const requestedManifest = readJson(requestedPackagePath, 'SF3D package manifest');
  const requestedVersion = requestedManifest.dependencies?.[SF3D_RUNTIME_KIT_PACKAGE]
    ?? requestedManifest.devDependencies?.[SF3D_RUNTIME_KIT_PACKAGE];
  if (requestedVersion !== expectedVersion) {
    throw new Error(
      `SF3D WebGPU kit request ${requestedVersion || 'missing'} != accepted ${expectedVersion}`,
    );
  }

  const effectivePackagePath = path.join(
    repo,
    'node_modules',
    '@kaminos',
    'webgpu-inference-kit',
    'package.json',
  );
  const effectiveManifest = readJson(effectivePackagePath, 'installed SF3D WebGPU kit');
  if (effectiveManifest.name !== SF3D_RUNTIME_KIT_PACKAGE) {
    throw new Error(`installed SF3D WebGPU kit package name mismatch: ${effectiveManifest.name || 'missing'}`);
  }
  const effectiveVersion = effectiveManifest.version;
  if (effectiveVersion !== requestedVersion) {
    throw new Error(
      `SF3D WebGPU kit identity mismatch: requested ${requestedVersion}, effective ${effectiveVersion || 'missing'}`,
    );
  }
  return Object.freeze({
    packageName: SF3D_RUNTIME_KIT_PACKAGE,
    requestedVersion,
    effectiveVersion,
    requestedPackagePath,
    effectivePackagePath,
  });
}
