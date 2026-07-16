import { SAM3_BROWSER_MODEL_PACKAGE_SCHEMA } from './sam-browser-package-manifest.js';

export const SAM3_BROWSER_MODEL_PACKAGE_RUNTIME_SCHEMA = 'kaminos.sam3-browser-model-package-runtime.v0';

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

function requireString(value, label) {
  if (typeof value !== 'string' || !value) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export function createSam3BrowserModelPackageRuntime({ manifest, loadUint8 } = {}) {
  requireObject(manifest, 'manifest');
  if (manifest.schema !== SAM3_BROWSER_MODEL_PACKAGE_SCHEMA) {
    throw new Error(`model package schema must be ${SAM3_BROWSER_MODEL_PACKAGE_SCHEMA}`);
  }
  if (typeof loadUint8 !== 'function') throw new Error('loadUint8 must be a function');
  const packageId = requireString(manifest.packageId, 'manifest.packageId');
  const weights = manifest.weights;
  if (!Array.isArray(weights) || weights.length === 0) throw new Error('manifest.weights must be a non-empty array');

  const staticArtifactsBySha = new Map();
  for (const [index, weight] of weights.entries()) {
    requireObject(weight, `manifest.weights[${index}]`);
    const role = requireString(weight.role, `manifest.weights[${index}].role`);
    const file = requireString(weight.file, `manifest.weights[${index}].file`);
    const sha256 = requireString(weight.sha256, `manifest.weights[${index}].sha256`);
    if (!/^sha256:[a-f0-9]{64}$/.test(sha256)) throw new Error(`invalid weight sha256 ${sha256}`);
    if (!Number.isSafeInteger(weight.byteLength) || weight.byteLength <= 0) {
      throw new Error(`weight byte length must be a positive safe integer for ${role}`);
    }
    const alias = {
      packetName: weight.packetName || 'semantic-mask-serving',
      kind: weight.kind || 'weight',
      role,
      file,
      byteLength: weight.byteLength,
      ...(weight.dtype == null ? {} : { dtype: weight.dtype }),
      ...(weight.shape == null ? {} : { shape: clone(weight.shape) }),
      ...(weight.layout == null ? {} : { layout: clone(weight.layout) }),
    };
    const existing = staticArtifactsBySha.get(sha256);
    if (existing) {
      if (existing.byteLength !== weight.byteLength) {
        throw new Error(`same sha256 has conflicting byte length contracts: ${sha256}`);
      }
      existing.aliases.push(alias);
      continue;
    }
    staticArtifactsBySha.set(sha256, {
      file,
      sha256,
      byteLength: weight.byteLength,
      aliases: [alias],
    });
  }

  const staticArtifacts = [...staticArtifactsBySha.values()].map(artifact => Object.freeze({
    ...artifact,
    aliases: Object.freeze(artifact.aliases.map(alias => Object.freeze(alias))),
  }));
  const modelPackage = Object.freeze({
    schema: manifest.schema,
    model: Object.freeze(clone(manifest.model || {})),
    staticArtifacts: Object.freeze(staticArtifacts),
  });
  return Object.freeze({
    schema: SAM3_BROWSER_MODEL_PACKAGE_RUNTIME_SCHEMA,
    packageId,
    manifest,
    modelPackage,
    loadUint8,
  });
}
