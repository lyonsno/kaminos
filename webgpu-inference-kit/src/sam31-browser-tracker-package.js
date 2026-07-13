import { canonicalSam3IdentityJson } from './sam-browser-package-manifest.js';

export const SAM31_BROWSER_TRACKER_ROOT_SCHEMA = 'kaminos.sam31-browser-tracker-root.v0';
export const SAM31_BROWSER_TRACKER_MODEL_PACKAGE_SCHEMA = 'kaminos.sam31-browser-tracker-model-package.v0';
export const SAM31_BROWSER_TRACKER_INVOCATION_SCHEMA = 'kaminos.sam31-browser-tracker-invocation.v0';
export const SAM31_BROWSER_TRACKER_VERIFICATION_SCHEMA = 'kaminos.sam31-browser-tracker-verification.v0';

export const SAM31_BROWSER_TRACKER_PACKAGE_CONTRACT = Object.freeze({
  modelPackageSchema: SAM31_BROWSER_TRACKER_MODEL_PACKAGE_SCHEMA,
  invocationSchema: SAM31_BROWSER_TRACKER_INVOCATION_SCHEMA,
  verificationSchema: SAM31_BROWSER_TRACKER_VERIFICATION_SCHEMA,
  modelPackagePrefix: 'sam31-tracker-model-package:',
  invocationPrefix: 'sam31-tracker-invocation:',
  verificationPrefix: 'sam31-tracker-verification:',
  evidenceSchema: 'kaminos.sam31-browser-tracker-package-invocation-evidence.v0',
  modelPackageFields: Object.freeze(['packageId', 'model', 'source', 'routeIds', 'geometry', 'components', 'staticArtifacts', 'claims']),
  invocationFields: Object.freeze(['invocationId', 'sourceImages', 'initialMask', 'session', 'dynamicArtifacts']),
  verificationFields: Object.freeze(['verificationId', 'verifiedPackageId', 'verifiedInvocationId', 'reference', 'tolerances', 'componentAuthorities', 'tensors']),
});

const PACKET_NAMES = Object.freeze(['ingress', 'decoder', 'memory', 'temporal', 'episode', 'pointer']);
const INVOCATION_TENSORS = new Map([
  ['ingress:frame-0-rgba', 'source-image'],
  ['ingress:frame-1-rgba', 'source-image'],
  ['episode:frame-0-binary-mask-inputs', 'initial-mask'],
]);
const STATIC_TENSORS = new Set([
  'episode:frame-0-extra-per-object-embedding',
  'episode:frame-1-extra-per-object-embedding',
  'temporal:maskmem-temporal-embeddings',
  'temporal:pointer-position-projection-weight',
  'temporal:pointer-position-projection-bias',
]);

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

function requireEntry(entry, packetName, kind) {
  requireObject(entry, `${packetName} ${kind}`);
  if (typeof entry.role !== 'string' || !entry.role) throw new Error(`${packetName} ${kind} role is required`);
  if (typeof entry.file !== 'string' || !entry.file) throw new Error(`${packetName} ${kind} ${entry.role} file is required`);
  if (typeof entry.sha256 !== 'string' || !entry.sha256.startsWith('sha256:')) throw new Error(`${packetName} ${kind} ${entry.role} sha256 is required`);
  if (!Number.isInteger(entry.byteLength) || entry.byteLength < 0) throw new Error(`${packetName} ${kind} ${entry.role} byteLength is required`);
  return entry;
}

function safeRole(value) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-');
}

function canonicalText(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function sha256Text(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return `sha256:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

async function identity(prefix, value, fields, identityField) {
  const contract = Object.fromEntries(fields
    .filter(field => field !== identityField && Object.hasOwn(value, field))
    .map(field => [field, value[field]]));
  return `${prefix}${await sha256Text(canonicalSam3IdentityJson(contract))}`;
}

function componentMetadata(manifest) {
  const excluded = new Set(['tensors', 'weights', 'attentionWeights', 'tolerances', 'createdAt', 'outputSummary', 'assemblyParity']);
  return Object.fromEntries(Object.entries(manifest).filter(([key]) => !excluded.has(key)));
}

export async function createSam31BrowserTrackerPackageProjection({ packets, sessionId = 'sam31-session-0', componentAuthorities = {} }) {
  requireObject(packets, 'packets');
  for (const name of PACKET_NAMES) requireObject(packets[name], `${name} packet`);
  if (typeof sessionId !== 'string' || !sessionId) throw new Error('sessionId is required');

  const staticByHash = new Map();
  const dynamicArtifacts = [];
  const verificationTensors = {};
  const materialization = [];
  const components = {};

  function addStatic(packetName, entry, kind) {
    requireEntry(entry, packetName, kind);
    let artifact = staticByHash.get(entry.sha256);
    if (artifact && artifact.byteLength !== entry.byteLength) throw new Error(`static artifact byte-length conflict for ${entry.sha256}`);
    if (!artifact) {
      artifact = {
        file: `static/${entry.sha256.slice(7)}.bin`,
        sha256: entry.sha256,
        byteLength: entry.byteLength,
        aliases: [],
      };
      staticByHash.set(entry.sha256, artifact);
      materialization.push({ ownership: 'model-package', packetName, sourceFile: entry.file, targetFile: artifact.file, sha256: entry.sha256, byteLength: entry.byteLength });
    }
    artifact.aliases.push({ packetName, kind, role: entry.role });
    return { ...entry, file: artifact.file };
  }

  function addOwned(packetName, entry, ownership) {
    requireEntry(entry, packetName, 'tensor');
    const targetFile = `${ownership}/${packetName}/${safeRole(entry.role)}-${entry.sha256.slice(7, 19)}.bin`;
    materialization.push({ ownership, packetName, sourceFile: entry.file, targetFile, sha256: entry.sha256, byteLength: entry.byteLength });
    return { ...entry, file: targetFile };
  }

  for (const packetName of PACKET_NAMES) {
    const manifest = packets[packetName];
    const component = componentMetadata(manifest);
    const weights = [...(manifest.weights || []), ...(manifest.attentionWeights || [])];
    component.weights = weights.map(entry => addStatic(packetName, entry, 'weight'));
    const staticTensors = [];
    const verification = [];
    for (const entry of manifest.tensors || []) {
      const key = `${packetName}:${entry.role}`;
      if (INVOCATION_TENSORS.has(key)) {
        dynamicArtifacts.push({ ...addOwned(packetName, entry, 'invocation'), invocationRole: INVOCATION_TENSORS.get(key) });
      } else if (STATIC_TENSORS.has(key)) {
        staticTensors.push(addStatic(packetName, entry, 'tensor'));
      } else {
        verification.push(addOwned(packetName, entry, 'verification'));
      }
    }
    component.staticTensors = staticTensors;
    components[packetName] = component;
    verificationTensors[packetName] = verification;
  }

  const ingress = packets.ingress;
  const episode = packets.episode;
  const frameArtifacts = dynamicArtifacts.filter(entry => entry.invocationRole === 'source-image').sort((left, right) => left.role.localeCompare(right.role));
  const maskArtifact = dynamicArtifacts.find(entry => entry.invocationRole === 'initial-mask');
  if (frameArtifacts.length !== 2 || !maskArtifact) throw new Error('tracker invocation requires two source-image tensors and one initial mask');
  const routeIds = Array.from(new Set(PACKET_NAMES.flatMap(name => {
    const manifest = packets[name];
    return [...(manifest.routeIds || []), ...(manifest.routeId ? [manifest.routeId] : [])];
  })));
  const modelPackage = {
    schema: SAM31_BROWSER_TRACKER_MODEL_PACKAGE_SCHEMA,
    packageId: 'pending',
    model: episode.reference?.model,
    source: episode.reference?.source,
    routeIds,
    geometry: { ingress: ingress.shape, episode: episode.shape, plan: episode.plan },
    components,
    staticArtifacts: Array.from(staticByHash.values()).sort((left, right) => left.sha256.localeCompare(right.sha256)),
    claims: {
      reusableStaticWeights: true,
      invocationOwnsSourceImagesAndInitialMask: true,
      verificationOwnsExpectedTensors: true,
      verificationRequiredForExecution: false,
    },
  };
  modelPackage.packageId = await identity(SAM31_BROWSER_TRACKER_PACKAGE_CONTRACT.modelPackagePrefix, modelPackage, SAM31_BROWSER_TRACKER_PACKAGE_CONTRACT.modelPackageFields, 'packageId');

  const invocation = {
    schema: SAM31_BROWSER_TRACKER_INVOCATION_SCHEMA,
    invocationId: 'pending',
    sourceImages: frameArtifacts.map((entry, frameIndex) => ({ frameIndex, role: entry.role, file: entry.file, sha256: entry.sha256, byteLength: entry.byteLength })),
    initialMask: { role: maskArtifact.role, file: maskArtifact.file, sha256: maskArtifact.sha256, byteLength: maskArtifact.byteLength },
    session: { sessionId, conditioningFrameIndex: 0, propagationFrameIndices: [1] },
    dynamicArtifacts: dynamicArtifacts.map(({ invocationRole, ...entry }) => ({ ...entry, invocationRole })),
  };
  invocation.invocationId = await identity(SAM31_BROWSER_TRACKER_PACKAGE_CONTRACT.invocationPrefix, invocation, SAM31_BROWSER_TRACKER_PACKAGE_CONTRACT.invocationFields, 'invocationId');

  const verification = {
    schema: SAM31_BROWSER_TRACKER_VERIFICATION_SCHEMA,
    verificationId: 'pending',
    verifiedPackageId: modelPackage.packageId,
    verifiedInvocationId: invocation.invocationId,
    reference: episode.reference,
    tolerances: Object.fromEntries(PACKET_NAMES.map(name => [name, packets[name].tolerances || null])),
    componentAuthorities,
    tensors: verificationTensors,
  };
  verification.verificationId = await identity(SAM31_BROWSER_TRACKER_PACKAGE_CONTRACT.verificationPrefix, verification, SAM31_BROWSER_TRACKER_PACKAGE_CONTRACT.verificationFields, 'verificationId');

  const modelPackageText = canonicalText(modelPackage);
  const invocationText = canonicalText(invocation);
  const verificationText = canonicalText(verification);
  const refs = {
    modelPackage: { file: 'sam31-model-package.json', sha256: await sha256Text(modelPackageText), schema: modelPackage.schema },
    invocation: { file: 'sam31-invocation.json', sha256: await sha256Text(invocationText), schema: invocation.schema },
    verification: { file: 'sam31-verification.json', sha256: await sha256Text(verificationText), schema: verification.schema },
  };
  const root = { schema: SAM31_BROWSER_TRACKER_ROOT_SCHEMA, modelPackage: refs.modelPackage, invocation: refs.invocation, verification: refs.verification };
  const runtimeRoot = { schema: SAM31_BROWSER_TRACKER_ROOT_SCHEMA, modelPackage: refs.modelPackage, invocation: refs.invocation };
  return {
    root,
    runtimeRoot,
    modelPackage,
    invocation,
    verification,
    texts: { root: canonicalText(root), runtimeRoot: canonicalText(runtimeRoot), modelPackage: modelPackageText, invocation: invocationText, verification: verificationText },
    materialization,
  };
}
