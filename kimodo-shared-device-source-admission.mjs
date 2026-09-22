import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';

export const KIT_REGISTRY_IDENTITY = Object.freeze({
  version: '0.1.52',
  resolved: 'https://registry.npmjs.org/@kaminos/webgpu-inference-kit/-/webgpu-inference-kit-0.1.52.tgz',
  integrity: 'sha512-oO/z66LktX6Utofa3mL+6TY2P6ocfRA16wGcvKODAf1dLih2njG3+DKxxiMN9c2gbUz76SO53hfbLYoW8pWg/g==',
});

function fileIdentity(path) {
  const bytes = readFileSync(path);
  return {
    bytes: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

function assertContained(root, name, label) {
  const target = resolve(root, name);
  const displacement = relative(resolve(root), target);
  if (displacement === '..' || displacement.startsWith(`..${sep}`)) {
    throw new Error(`${label} identity escapes its admitted root: ${name}`);
  }
  return target;
}

export function collectIdentityMap(root) {
  const identities = {};
  const visit = (directory, prefix = '') => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const relativeName = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absoluteName = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absoluteName, relativeName);
      } else if (entry.isFile()) {
        identities[relativeName] = fileIdentity(absoluteName);
      }
    }
  };
  visit(resolve(root));
  return identities;
}

export function verifyIdentityMap({ root, identities, label }) {
  if (!identities || typeof identities !== 'object' || Object.keys(identities).length === 0) {
    throw new Error(`${label} identity map is absent or empty`);
  }
  for (const [name, expected] of Object.entries(identities)) {
    const target = assertContained(root, name, label);
    if (!statSync(target).isFile()) throw new Error(`${label} identity is not a regular file: ${name}`);
    const actual = fileIdentity(target);
    if (actual.bytes !== expected?.bytes || actual.sha256 !== expected?.sha256) {
      throw new Error(`${label} identity mismatch: ${name}`);
    }
  }
  return identities;
}

function verifyRegistryIdentity(identity, label) {
  for (const field of ['version', 'resolved', 'integrity']) {
    if (identity?.[field] !== KIT_REGISTRY_IDENTITY[field]) {
      throw new Error(`${label} registry identity mismatch: ${field}`);
    }
  }
}

function assertIdentityMapsEqual(actual, expected, message) {
  const actualNames = Object.keys(actual || {}).sort();
  const expectedNames = Object.keys(expected || {}).sort();
  if (actualNames.length !== expectedNames.length
    || actualNames.some((name, index) => name !== expectedNames[index])
    || actualNames.some(name => actual[name]?.bytes !== expected[name]?.bytes
      || actual[name]?.sha256 !== expected[name]?.sha256)) {
    throw new Error(message);
  }
}

export function verifyCanonicalKitSource({ packageRoot, canonicalKit, label = 'inference-kit source' }) {
  verifyRegistryIdentity(canonicalKit, 'inference-kit canonical artifact');
  const installedPackage = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8'));
  if (installedPackage.version !== KIT_REGISTRY_IDENTITY.version) {
    throw new Error(`inference-kit installed version mismatch: ${installedPackage.version}`);
  }
  const actualFiles = collectIdentityMap(resolve(packageRoot, 'src'));
  assertIdentityMapsEqual(
    actualFiles,
    canonicalKit.files,
    `${label} does not match the SRI-verified canonical source map`,
  );
  verifyIdentityMap({
    root: resolve(packageRoot, 'src'),
    identities: canonicalKit.files,
    label,
  });
  return canonicalKit;
}

export function verifyRuntimeKitSource({ packageRoot, runtimeKit, canonicalKit }) {
  verifyRegistryIdentity(runtimeKit, 'inference-kit');
  verifyRegistryIdentity(canonicalKit, 'inference-kit canonical artifact');
  assertIdentityMapsEqual(
    runtimeKit?.files,
    canonicalKit?.files,
    'inference-kit manifest does not match the SRI-verified canonical source map',
  );
  verifyCanonicalKitSource({ packageRoot, canonicalKit, label: 'inference-kit source' });
  return runtimeKit;
}
