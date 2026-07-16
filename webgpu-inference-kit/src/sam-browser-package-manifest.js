export const SAM3_BROWSER_MODEL_PACKAGE_SCHEMA = 'kaminos.sam3-browser-model-package.v0';
export const SAM3_BROWSER_INVOCATION_SCHEMA = 'kaminos.sam3-browser-invocation.v0';
export const SAM3_BROWSER_VERIFICATION_SCHEMA = 'kaminos.sam3-browser-verification.v0';

const REQUIRED_INVOCATION_IDENTITY_FIELDS = new Map([
  ['kaminos.sam31-browser-tracker-invocation.v0', Object.freeze(['modelPackageId'])],
]);

const MODEL_PACKAGE_FIELDS = [
  'packageId',
  'model',
  'modelLoad',
  'staticWeights',
  'shape',
  'claims',
  'promptTokenizer',
  'imagePreprocess',
  'imagePatchEmbed',
  'imageVitPrefix',
  'imageVitFirstBlock',
  'imageVitBlockStack',
  'imageFpnNeck',
  'promptTextIngress',
  'weights',
];
const INVOCATION_FIELDS = ['invocationId', 'prompt', 'sourceImage', 'postprocess'];
const VERIFICATION_FIELDS = [
  'verificationId',
  'verifiedPackageId',
  'verifiedInvocationId',
  'reference',
  'upstreamBoundaries',
  'toleranceBudgetSource',
  'toleranceCalibration',
  'tolerances',
  'visualization',
  'tensors',
];

export const SAM3_BROWSER_PACKAGE_CONTRACT = Object.freeze({
  modelPackageSchema: SAM3_BROWSER_MODEL_PACKAGE_SCHEMA,
  invocationSchema: SAM3_BROWSER_INVOCATION_SCHEMA,
  verificationSchema: SAM3_BROWSER_VERIFICATION_SCHEMA,
  modelPackagePrefix: 'sam3-model-package:',
  invocationPrefix: 'sam3-invocation:',
  verificationPrefix: 'sam3-verification:',
  evidenceSchema: 'kaminos.sam3-browser-package-invocation-evidence.v0',
  modelPackageFields: Object.freeze(MODEL_PACKAGE_FIELDS),
  invocationFields: Object.freeze(INVOCATION_FIELDS),
  verificationFields: Object.freeze(VERIFICATION_FIELDS),
});

function requireNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function canonicalArtifactSet(artifacts, { allowEmpty = false } = {}) {
  if (!Array.isArray(artifacts) || (!allowEmpty && artifacts.length === 0)) throw new Error('static artifacts must be a non-empty array');
  const byIdentity = new Map();
  const urls = new Map();
  for (const artifact of artifacts) {
    requireObject(artifact, 'static artifact');
    const url = requireNonEmptyString(artifact.url, 'static artifact url');
    const sha256 = requireNonEmptyString(artifact.sha256, 'static artifact sha256');
    const kind = artifact.kind;
    if (kind !== 'array-buffer' && kind !== 'text') throw new Error(`unsupported static artifact kind ${kind || 'missing'}`);
    const identity = `${kind}:${sha256}`;
    if (urls.has(url) && urls.get(url) !== identity) throw new Error(`static artifact identity conflict for ${url}`);
    urls.set(url, identity);
    byIdentity.set(identity, { kind, sha256 });
  }
  return {
    identities: new Map(Array.from(byIdentity.entries()).sort(([left], [right]) => left.localeCompare(right))),
    urls,
  };
}

function sameArtifactSet(left, right) {
  if (left.identities.size !== right.identities.size) return false;
  for (const identity of left.identities.keys()) if (!right.identities.has(identity)) return false;
  return true;
}

async function sha256Payload(value, kind) {
  let bytes;
  if (kind === 'text') {
    bytes = new TextEncoder().encode(value);
  } else if (value instanceof ArrayBuffer) {
    bytes = new Uint8Array(value);
  } else if (ArrayBuffer.isView(value)) {
    bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  } else {
    throw new Error('static array-buffer artifact loader returned a non-buffer value');
  }
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  return `sha256:${Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

export function createSam3BrowserStaticArtifactCache({
  fetchArrayBuffer,
  fetchText,
  fetchStaticArrayBuffer = fetchArrayBuffer,
  fetchStaticText = fetchText,
  retainStaticValues = true,
}) {
  if (typeof fetchArrayBuffer !== 'function') throw new Error('fetchArrayBuffer must be a function');
  if (typeof fetchText !== 'function') throw new Error('fetchText must be a function');
  let packageId = null;
  let invocationId = null;
  let staticArtifacts = { identities: new Map(), urls: new Map() };
  let dynamicArtifacts = { identities: new Map(), urls: new Map() };
  let configurationCount = 0;
  let dynamicConfigurationCount = 0;
  let staticNetworkLoadCount = 0;
  let staticCacheHitCount = 0;
  let dynamicNetworkLoadCount = 0;
  let staticHashVerificationCount = 0;
  let staticHashVerificationFailureCount = 0;
  let dynamicHashVerificationCount = 0;
  let dynamicHashVerificationFailureCount = 0;
  const staticLoads = new Map();
  const verifiedStaticIdentities = new Set();

  function staticIdentity(url, kind) {
    const identity = staticArtifacts.urls.get(url);
    return identity?.startsWith(`${kind}:`) ? identity : null;
  }

  async function loadVerifiedStatic(url, kind, identity) {
    const value = kind === 'array-buffer' ? await fetchStaticArrayBuffer(url, identity) : await fetchStaticText(url, identity);
    staticHashVerificationCount += 1;
    const effectiveSha256 = await sha256Payload(value, kind);
    const expectedSha256 = identity.slice(kind.length + 1);
    if (effectiveSha256 !== expectedSha256) {
      staticHashVerificationFailureCount += 1;
      throw new Error(`static artifact hash mismatch for ${url}: ${effectiveSha256} !== ${expectedSha256}`);
    }
    return value;
  }

  async function loadVerifiedDynamic(url, kind, identity) {
    const value = kind === 'array-buffer' ? await fetchArrayBuffer(url) : await fetchText(url);
    dynamicHashVerificationCount += 1;
    const effectiveSha256 = await sha256Payload(value, kind);
    const expectedSha256 = identity.slice(kind.length + 1);
    if (effectiveSha256 !== expectedSha256) {
      dynamicHashVerificationFailureCount += 1;
      throw new Error(`dynamic artifact hash mismatch for ${url}: ${effectiveSha256} !== ${expectedSha256}`);
    }
    return value;
  }

  async function acquireStatic(url, kind, identity) {
    if (staticLoads.has(identity)) {
      staticCacheHitCount += 1;
      return staticLoads.get(identity);
    }
    if (verifiedStaticIdentities.has(identity)) {
      staticCacheHitCount += 1;
      return loadVerifiedStatic(url, kind, identity);
    }
    staticNetworkLoadCount += 1;
    const pending = loadVerifiedStatic(url, kind, identity);
    staticLoads.set(identity, pending);
    try {
      const value = await pending;
      verifiedStaticIdentities.add(identity);
      if (!retainStaticValues) staticLoads.delete(identity);
      return value;
    } catch (error) {
      staticLoads.delete(identity);
      throw error;
    }
  }

  function expectedIdentity(kind, expectedSha256) {
    if (expectedSha256 == null) return null;
    return `${kind}:${requireNonEmptyString(expectedSha256, 'expected artifact sha256')}`;
  }

  return {
    configure(input) {
      const nextPackageId = requireNonEmptyString(input?.packageId, 'packageId');
      const nextArtifacts = canonicalArtifactSet(input?.artifacts);
      if (packageId && packageId !== nextPackageId) {
        throw new Error(`static artifact cache already bound to ${packageId}; cannot switch to ${nextPackageId}`);
      }
      if (packageId && !sameArtifactSet(staticArtifacts, nextArtifacts)) {
        throw new Error(`static artifact set changed for package ${packageId}`);
      }
      packageId = nextPackageId;
      if (configurationCount === 0) {
        staticArtifacts = nextArtifacts;
      } else {
        for (const [url, identity] of nextArtifacts.urls) staticArtifacts.urls.set(url, identity);
      }
      configurationCount += 1;
    },

    configureInvocation(input) {
      invocationId = requireNonEmptyString(input?.invocationId, 'invocationId');
      dynamicArtifacts = canonicalArtifactSet(input?.artifacts, { allowEmpty: true });
      dynamicConfigurationCount += 1;
    },

    async fetchArray(url, Type, expectedSha256 = null) {
      if (typeof Type !== 'function' || typeof Type.BYTES_PER_ELEMENT !== 'number') throw new Error('Type must be a typed array constructor');
      const identity = staticIdentity(url, 'array-buffer');
      const expected = expectedIdentity('array-buffer', expectedSha256);
      if (!identity) {
        const dynamicIdentity = expected || dynamicArtifacts.urls.get(url);
        if (!dynamicIdentity?.startsWith('array-buffer:')) {
          throw new Error(`dynamic artifact identity is required for ${url}; unverified fallback reads are forbidden`);
        }
        dynamicNetworkLoadCount += 1;
        const value = await loadVerifiedDynamic(url, 'array-buffer', dynamicIdentity);
        return new Type(value);
      }
      if (expected && identity !== expected) {
        throw new Error(`static artifact identity mismatch for ${url}: ${identity} !== ${expected}`);
      }
      return new Type(await acquireStatic(url, 'array-buffer', identity));
    },

    async fetchText(url, expectedSha256 = null) {
      const identity = staticIdentity(url, 'text');
      const expected = expectedIdentity('text', expectedSha256);
      if (!identity) {
        const dynamicIdentity = expected || dynamicArtifacts.urls.get(url);
        if (!dynamicIdentity?.startsWith('text:')) {
          throw new Error(`dynamic artifact identity is required for ${url}; unverified fallback reads are forbidden`);
        }
        dynamicNetworkLoadCount += 1;
        return loadVerifiedDynamic(url, 'text', dynamicIdentity);
      }
      if (expected && identity !== expected) {
        throw new Error(`static artifact identity mismatch for ${url}: ${identity} !== ${expected}`);
      }
      return acquireStatic(url, 'text', identity);
    },

    evidence() {
      return {
        schema: 'kaminos.sam3-browser-static-artifact-cache-evidence.v0',
        packageId,
        invocationId,
        configurationCount,
        dynamicConfigurationCount,
        staticArtifactCount: staticArtifacts.identities.size,
        dynamicArtifactCount: dynamicArtifacts.identities.size,
        staticNetworkLoadCount,
        staticCacheHitCount,
        dynamicNetworkLoadCount,
        staticHashVerificationCount,
        staticHashVerificationFailureCount,
        dynamicHashVerificationCount,
        dynamicHashVerificationFailureCount,
      };
    },
  };
}

function validateInvocationSummary(summary, label) {
  requireObject(summary, label);
  requireNonEmptyString(summary.packageId, `${label}.packageId`);
  requireNonEmptyString(summary.invocationId, `${label}.invocationId`);
  requireNonEmptyString(summary.verificationSha256, `${label}.verificationSha256`);
  requireNonEmptyString(summary.sourceImageSha256, `${label}.sourceImageSha256`);
  requireNonEmptyString(summary.promptSha256, `${label}.promptSha256`);
  requireNonEmptyString(summary.outputIdentity, `${label}.outputIdentity`);
  if (!Array.isArray(summary.requestIds) || summary.requestIds.length === 0 || summary.requestIds.some(value => typeof value !== 'string' || value.length === 0)) {
    throw new Error(`${label}.requestIds must be a non-empty string array`);
  }
}

export function createSam3DualInvocationEvidence(first, second) {
  validateInvocationSummary(first, 'first invocation');
  validateInvocationSummary(second, 'second invocation');
  if (first.packageId !== second.packageId) throw new Error('dual invocation model package identity changed');
  if (first.invocationId === second.invocationId) throw new Error('dual invocation identity was reused');
  if (first.verificationSha256 === second.verificationSha256) throw new Error('dual invocation verification identity was reused');
  if (first.sourceImageSha256 === second.sourceImageSha256) throw new Error('dual invocation source image identity was reused');
  if (first.promptSha256 === second.promptSha256) throw new Error('dual invocation prompt identity was reused');
  if (first.outputIdentity === second.outputIdentity) throw new Error('dual invocation output identity was reused');
  const firstRequests = new Set(first.requestIds);
  if (second.requestIds.some(requestId => firstRequests.has(requestId))) throw new Error('dual invocation request identity was reused');
  return {
    schema: 'kaminos.sam3-browser-dual-invocation-evidence.v0',
    packageId: first.packageId,
    sameModelPackage: true,
    distinctInvocations: true,
    distinctVerification: true,
    distinctSourceImages: true,
    distinctPrompts: true,
    distinctRequestSets: true,
    distinctOutputs: true,
    first: JSON.parse(JSON.stringify(first)),
    second: JSON.parse(JSON.stringify(second)),
  };
}

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function validateRootAuthority(root, contract) {
  for (const field of [...contract.modelPackageFields, ...contract.invocationFields, ...contract.verificationFields]) {
    if (Object.hasOwn(root, field)) {
      const owner = contract.modelPackageFields.includes(field) ? 'model package' : contract.invocationFields.includes(field) ? 'invocation' : 'verification';
      throw new Error(`root manifest duplicates ${owner}-owned field ${field}`);
    }
  }
}

function validateContractAuthority(contract) {
  const requiredFields = REQUIRED_INVOCATION_IDENTITY_FIELDS.get(contract.invocationSchema) || [];
  for (const field of requiredFields) {
    if (!contract.invocationFields.includes(field)) {
      throw new Error(`SAM 3.1 invocation contract must require ${field}`);
    }
  }
}

function validateArtifactRef(ref, expectedSchema, label) {
  requireObject(ref, `${label} reference`);
  if (typeof ref.file !== 'string' || ref.file.length === 0) throw new Error(`${label} reference missing file`);
  if (typeof ref.sha256 !== 'string' || ref.sha256.length === 0) throw new Error(`${label} reference missing sha256`);
  if (ref.schema !== expectedSchema) throw new Error(`${label} reference schema mismatch: ${ref.schema || 'missing'} !== ${expectedSchema}`);
}

function parseArtifact(text, ref, expectedSchema, label, effectiveSha256) {
  if (effectiveSha256 !== ref.sha256) {
    throw new Error(`${label} hash mismatch: ${effectiveSha256} !== ${ref.sha256}`);
  }
  let artifact;
  try {
    artifact = JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
  requireObject(artifact, label);
  if (artifact.schema !== expectedSchema) throw new Error(`${label} schema mismatch: ${artifact.schema || 'missing'} !== ${expectedSchema}`);
  return artifact;
}

function fieldsFrom(artifact, fields) {
  return Object.fromEntries(fields.filter(field => Object.hasOwn(artifact, field)).map(field => [field, artifact[field]]));
}

function canonicalNumber(value) {
  if (!Number.isFinite(value)) throw new Error('identity contract contains non-finite number');
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setFloat64(0, value, false);
  return JSON.stringify(`f64:${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`);
}

export function canonicalSam3IdentityJson(value) {
  if (typeof value === 'number') return canonicalNumber(value);
  if (Array.isArray(value)) return `[${value.map(canonicalSam3IdentityJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalSam3IdentityJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function identityContract(artifact, fields, identityField) {
  return fieldsFrom(artifact, fields.filter(field => field !== identityField));
}

function assertIdentity(label, actual, prefix, digest) {
  const expected = `${prefix}${digest}`;
  if (actual !== expected) throw new Error(`${label} identity mismatch: ${actual || 'missing'} !== ${expected}`);
}

function assertVerificationBinding(verification, modelPackage, invocation) {
  requireNonEmptyString(verification.verificationId, 'verification.verificationId');
  requireNonEmptyString(verification.verifiedPackageId, 'verification.verifiedPackageId');
  requireNonEmptyString(verification.verifiedInvocationId, 'verification.verifiedInvocationId');
  if (verification.verifiedPackageId !== modelPackage.packageId) {
    throw new Error(`verification model package binding mismatch: ${verification.verifiedPackageId} !== ${modelPackage.packageId}`);
  }
  if (verification.verifiedInvocationId !== invocation.invocationId) {
    throw new Error(`verification invocation binding mismatch: ${verification.verifiedInvocationId} !== ${invocation.invocationId}`);
  }
}

function assertInvocationBinding(invocation, modelPackage, contract) {
  const packageBindingRequired = contract.invocationFields.includes('modelPackageId');
  if (!Object.hasOwn(invocation, 'modelPackageId')) {
    if (packageBindingRequired) throw new Error('invocation missing required identity field modelPackageId');
    return;
  }
  requireNonEmptyString(invocation.modelPackageId, 'invocation.modelPackageId');
  if (invocation.modelPackageId !== modelPackage.packageId) {
    throw new Error(`invocation model package binding mismatch: ${invocation.modelPackageId} !== ${modelPackage.packageId}`);
  }
}

export function resolveSam3BrowserArtifactUrl(file, manifestUrl, pageUrl) {
  const artifactRef = requireNonEmptyString(file, 'artifact file');
  const page = new URL(requireNonEmptyString(pageUrl, 'page URL'));
  const manifest = new URL(requireNonEmptyString(manifestUrl, 'manifest URL'), page);
  const artifactRoot = new URL('.', manifest);
  const resolved = new URL(artifactRef, manifest);
  let rootPath = artifactRoot.pathname;
  let resolvedPath = resolved.pathname;
  try {
    while (decodeURIComponent(rootPath) !== rootPath) rootPath = decodeURIComponent(rootPath);
    while (decodeURIComponent(resolvedPath) !== resolvedPath) resolvedPath = decodeURIComponent(resolvedPath);
  } catch {
    throw new Error(`artifact file escapes manifest artifact root: ${artifactRef}`);
  }
  const relativePath = resolvedPath.startsWith(rootPath) ? resolvedPath.slice(rootPath.length) : '';
  const hasTraversalSegment = relativePath.split(/[\\/]/u).some(segment => segment === '..');
  if (resolved.origin !== artifactRoot.origin || !resolvedPath.startsWith(rootPath) || hasTraversalSegment) {
    throw new Error(`artifact file escapes manifest artifact root: ${artifactRef}`);
  }
  return resolved.toString();
}

function composeResolution(root, modelPackage, invocation, verification, effectiveHashes, contract) {
  if (!modelPackage.packageId) throw new Error('model package missing packageId');
  if (!invocation.invocationId) throw new Error('invocation missing invocationId');
  const manifest = {
    ...root,
    ...fieldsFrom(modelPackage, contract.modelPackageFields),
    ...fieldsFrom(invocation, contract.invocationFields),
    ...(verification ? fieldsFrom(verification, contract.verificationFields) : {}),
    schema: root.schema,
  };
  const evidence = {
    schema: contract.evidenceSchema,
    packageId: modelPackage.packageId,
    invocationId: invocation.invocationId,
    modelPackage: { ...root.modelPackage, effectiveSha256: effectiveHashes.modelPackage },
    invocation: { ...root.invocation, effectiveSha256: effectiveHashes.invocation },
    verification: verification
      ? { attached: true, ...root.verification, effectiveSha256: effectiveHashes.verification }
      : {
          attached: false,
          ...(root.verification ? { requestedRef: { ...root.verification } } : {}),
        },
  };
  return { manifest, evidence };
}

function isSplitManifest(root) {
  return Boolean(root?.modelPackage || root?.invocation || root?.verification);
}

export async function resolveSam3BrowserPackageManifest(rootManifest, {
  readArtifactText,
  sha256Text,
  contract = SAM3_BROWSER_PACKAGE_CONTRACT,
  includeVerification = true,
}) {
  const root = requireObject(rootManifest, 'root manifest');
  if (!isSplitManifest(root)) return { manifest: root, evidence: null };
  validateContractAuthority(contract);
  validateRootAuthority(root, contract);
  validateArtifactRef(root.modelPackage, contract.modelPackageSchema, 'model package');
  validateArtifactRef(root.invocation, contract.invocationSchema, 'invocation');
  if (includeVerification && root.verification) validateArtifactRef(root.verification, contract.verificationSchema, 'verification');
  const load = async (ref, schema, label) => {
    const text = await readArtifactText(ref.file);
    return parseArtifact(text, ref, schema, label, await sha256Text(text));
  };
  const [modelPackage, invocation, verification] = await Promise.all([
    load(root.modelPackage, contract.modelPackageSchema, 'model package'),
    load(root.invocation, contract.invocationSchema, 'invocation'),
    includeVerification && root.verification ? load(root.verification, contract.verificationSchema, 'verification') : null,
  ]);
  assertIdentity(
    'model package',
    modelPackage.packageId,
    contract.modelPackagePrefix,
    await sha256Text(canonicalSam3IdentityJson(identityContract(modelPackage, contract.modelPackageFields, 'packageId'))),
  );
  assertIdentity(
    'invocation',
    invocation.invocationId,
    contract.invocationPrefix,
    await sha256Text(canonicalSam3IdentityJson(identityContract(invocation, contract.invocationFields, 'invocationId'))),
  );
  assertInvocationBinding(invocation, modelPackage, contract);
  if (verification) {
    assertVerificationBinding(verification, modelPackage, invocation);
    assertIdentity(
      'verification',
      verification.verificationId,
      contract.verificationPrefix,
      await sha256Text(canonicalSam3IdentityJson(identityContract(verification, contract.verificationFields, 'verificationId'))),
    );
  }
  return composeResolution(root, modelPackage, invocation, verification, {
    modelPackage: root.modelPackage.sha256,
    invocation: root.invocation.sha256,
    verification: root.verification?.sha256 || null,
  }, contract);
}

export function resolveSam3BrowserPackageManifestSync(rootManifest, {
  readArtifactText,
  sha256Text,
  contract = SAM3_BROWSER_PACKAGE_CONTRACT,
  includeVerification = true,
}) {
  const root = requireObject(rootManifest, 'root manifest');
  if (!isSplitManifest(root)) return { manifest: root, evidence: null };
  validateContractAuthority(contract);
  validateRootAuthority(root, contract);
  validateArtifactRef(root.modelPackage, contract.modelPackageSchema, 'model package');
  validateArtifactRef(root.invocation, contract.invocationSchema, 'invocation');
  if (includeVerification && root.verification) validateArtifactRef(root.verification, contract.verificationSchema, 'verification');
  const load = (ref, schema, label) => {
    const text = readArtifactText(ref.file);
    return parseArtifact(text, ref, schema, label, sha256Text(text));
  };
  const modelPackage = load(root.modelPackage, contract.modelPackageSchema, 'model package');
  const invocation = load(root.invocation, contract.invocationSchema, 'invocation');
  const verification = includeVerification && root.verification ? load(root.verification, contract.verificationSchema, 'verification') : null;
  assertIdentity(
    'model package',
    modelPackage.packageId,
    contract.modelPackagePrefix,
    sha256Text(canonicalSam3IdentityJson(identityContract(modelPackage, contract.modelPackageFields, 'packageId'))),
  );
  assertIdentity(
    'invocation',
    invocation.invocationId,
    contract.invocationPrefix,
    sha256Text(canonicalSam3IdentityJson(identityContract(invocation, contract.invocationFields, 'invocationId'))),
  );
  assertInvocationBinding(invocation, modelPackage, contract);
  if (verification) {
    assertVerificationBinding(verification, modelPackage, invocation);
    assertIdentity(
      'verification',
      verification.verificationId,
      contract.verificationPrefix,
      sha256Text(canonicalSam3IdentityJson(identityContract(verification, contract.verificationFields, 'verificationId'))),
    );
  }
  return composeResolution(root, modelPackage, invocation, verification, {
    modelPackage: root.modelPackage.sha256,
    invocation: root.invocation.sha256,
    verification: root.verification?.sha256 || null,
  }, contract);
}
