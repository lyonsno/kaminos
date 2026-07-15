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
  invocationFields: Object.freeze(['invocationId', 'modelPackageId', 'sourceImages', 'initialMask', 'session', 'dynamicArtifacts']),
  verificationFields: Object.freeze(['verificationId', 'verifiedPackageId', 'verifiedInvocationId', 'reference', 'stateTransition', 'tolerances', 'componentAuthorities', 'tensors']),
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
  const excluded = new Set(['tensors', 'weights', 'attentionWeights', 'tolerances', 'createdAt', 'outputSummary', 'assemblyParity', 'sourceImages', 'fixture', 'stateTransition', 'imageIngress', 'ingressAuthority']);
  return Object.fromEntries(Object.entries(manifest).filter(([key]) => !excluded.has(key)));
}

function sourceImageAuthority(sourceImages, frameArtifacts) {
  if (!Array.isArray(sourceImages) || sourceImages.length !== 2) {
    throw new Error('tracker invocation requires two authenticated source-image records');
  }
  const result = frameArtifacts.map((artifact, frameIndex) => {
    const source = sourceImages.find(entry => entry?.frameIndex === frameIndex);
    if (!source) throw new Error(`tracker source-image authority is missing frame ${frameIndex}`);
    for (const field of ['originalSha256', 'rgbaSha256']) {
      if (typeof source[field] !== 'string' || !source[field].startsWith('sha256:')) {
        throw new Error(`tracker source-image frame ${frameIndex} ${field} is required`);
      }
    }
    if (source.rgbaSha256 !== artifact.sha256) {
      throw new Error(`tracker source-image frame ${frameIndex} RGBA identity does not match its invocation artifact`);
    }
    return {
      frameIndex,
      role: artifact.role,
      file: artifact.file,
      sha256: artifact.sha256,
      byteLength: artifact.byteLength,
      originalSha256: source.originalSha256,
      rgbaSha256: source.rgbaSha256,
    };
  });
  if (new Set(result.map(source => source.originalSha256)).size !== result.length) {
    throw new Error('tracker invocation requires distinct encoded source images');
  }
  if (new Set(result.map(source => source.rgbaSha256)).size !== result.length) {
    throw new Error('tracker invocation requires distinct RGBA source images');
  }
  return result;
}

function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer`);
  return value;
}

export function validateSam31BrowserTrackerGeometry(ingressShape, episodeShape) {
  requireObject(ingressShape, 'tracker ingress geometry');
  requireObject(episodeShape, 'tracker episode geometry');
  const carriesSpatialContract = ['patchSize', 'patchHeight', 'patchWidth', 'patchTokens']
    .some(field => Object.hasOwn(ingressShape, field))
    || [
      'queryHeight', 'queryWidth', 'queryTokens', 'maskHeight', 'maskWidth',
      'sourceImageHeight', 'sourceImageWidth', 'sourceMaskHeight', 'sourceMaskWidth',
      'promptMaskHeight', 'promptMaskWidth', 'decoderMaskHeight', 'decoderMaskWidth',
      'memoryInputMaskHeight', 'memoryInputMaskWidth',
    ]
      .some(field => Object.hasOwn(episodeShape, field));
  if (!carriesSpatialContract) return null;

  const imageHeight = positiveInteger(ingressShape.imageHeight, 'ingress imageHeight');
  const imageWidth = positiveInteger(ingressShape.imageWidth, 'ingress imageWidth');
  const patchSize = positiveInteger(ingressShape.patchSize, 'ingress patchSize');
  const patchHeight = positiveInteger(ingressShape.patchHeight, 'ingress patchHeight');
  const patchWidth = positiveInteger(ingressShape.patchWidth, 'ingress patchWidth');
  const patchTokens = positiveInteger(ingressShape.patchTokens, 'ingress patchTokens');
  if (imageHeight !== patchHeight * patchSize || imageWidth !== patchWidth * patchSize || patchTokens !== patchHeight * patchWidth) {
    throw new Error('ingress image and patch geometry are inconsistent');
  }
  if (!Array.isArray(ingressShape.fpnLevels) || ingressShape.fpnLevels.length !== 3) {
    throw new Error('ingress geometry requires the three SAM 3.1 FPN levels');
  }
  for (const [index, scaleFactor] of [4, 2, 1].entries()) {
    const level = ingressShape.fpnLevels[index];
    if (level?.level !== index || level.scaleFactor !== scaleFactor
        || level.height !== patchHeight * scaleFactor || level.width !== patchWidth * scaleFactor) {
      throw new Error(`ingress FPN level ${index} does not match the patch geometry`);
    }
  }

  const queryHeight = positiveInteger(episodeShape.queryHeight, 'episode queryHeight');
  const queryWidth = positiveInteger(episodeShape.queryWidth, 'episode queryWidth');
  const queryTokens = positiveInteger(episodeShape.queryTokens, 'episode queryTokens');
  if (queryHeight !== patchHeight || queryWidth !== patchWidth || queryTokens !== patchTokens) {
    throw new Error('episode query geometry does not match ingress patch geometry');
  }
  const maskHeight = positiveInteger(episodeShape.maskHeight, 'episode maskHeight');
  const maskWidth = positiveInteger(episodeShape.maskWidth, 'episode maskWidth');
  if (maskHeight !== queryHeight * 4 || maskWidth !== queryWidth * 4) {
    throw new Error('episode mask geometry alias must name the H*4 decoder mask');
  }
  const sourceImageHeight = positiveInteger(episodeShape.sourceImageHeight, 'episode sourceImageHeight');
  const sourceImageWidth = positiveInteger(episodeShape.sourceImageWidth, 'episode sourceImageWidth');
  if (sourceImageHeight !== imageHeight || sourceImageWidth !== imageWidth) {
    throw new Error('episode source image geometry does not match authenticated ingress');
  }
  const sourceMaskHeight = positiveInteger(episodeShape.sourceMaskHeight, 'episode sourceMaskHeight');
  const sourceMaskWidth = positiveInteger(episodeShape.sourceMaskWidth, 'episode sourceMaskWidth');
  if (sourceMaskHeight !== queryHeight * 16 || sourceMaskWidth !== queryWidth * 16) {
    throw new Error('episode source mask geometry must be sixteen times the query geometry');
  }
  const promptMaskHeight = positiveInteger(episodeShape.promptMaskHeight, 'episode promptMaskHeight');
  const promptMaskWidth = positiveInteger(episodeShape.promptMaskWidth, 'episode promptMaskWidth');
  if (promptMaskHeight !== queryHeight * 4 || promptMaskWidth !== queryWidth * 4) {
    throw new Error('episode prompt mask geometry must be four times the query geometry');
  }
  const decoderMaskHeight = positiveInteger(episodeShape.decoderMaskHeight, 'episode decoderMaskHeight');
  const decoderMaskWidth = positiveInteger(episodeShape.decoderMaskWidth, 'episode decoderMaskWidth');
  if (decoderMaskHeight !== promptMaskHeight || decoderMaskWidth !== promptMaskWidth
      || maskHeight !== decoderMaskHeight || maskWidth !== decoderMaskWidth) {
    throw new Error('episode decoder mask geometry must equal the prompt mask and legacy mask alias');
  }
  const memoryInputMaskHeight = positiveInteger(episodeShape.memoryInputMaskHeight, 'episode memoryInputMaskHeight');
  const memoryInputMaskWidth = positiveInteger(episodeShape.memoryInputMaskWidth, 'episode memoryInputMaskWidth');
  if (memoryInputMaskHeight !== sourceMaskHeight || memoryInputMaskWidth !== sourceMaskWidth) {
    throw new Error('mask-conditioned memory input must retain the H*16 source mask geometry');
  }
  const memorySpatialTokens = positiveInteger(episodeShape.memorySpatialTokens, 'episode memorySpatialTokens');
  const numObjPtrTokens = positiveInteger(episodeShape.numObjPtrTokens, 'episode numObjPtrTokens');
  const memoryTokens = positiveInteger(episodeShape.memoryTokens, 'episode memoryTokens');
  if (memorySpatialTokens !== queryTokens || memoryTokens !== memorySpatialTokens + numObjPtrTokens) {
    throw new Error('episode memory geometry does not match query and pointer tokens');
  }
  return Object.freeze({
    imageHeight,
    imageWidth,
    patchSize,
    patchHeight,
    patchWidth,
    patchTokens,
    queryHeight,
    queryWidth,
    queryTokens,
    maskHeight,
    maskWidth,
    sourceImageHeight,
    sourceImageWidth,
    sourceMaskHeight,
    sourceMaskWidth,
    promptMaskHeight,
    promptMaskWidth,
    decoderMaskHeight,
    decoderMaskWidth,
    memoryInputMaskHeight,
    memoryInputMaskWidth,
    memorySpatialTokens,
    numObjPtrTokens,
    memoryTokens,
  });
}

export function createSam31BrowserTrackerInvocationId(invocation) {
  return identity(
    SAM31_BROWSER_TRACKER_PACKAGE_CONTRACT.invocationPrefix,
    invocation,
    SAM31_BROWSER_TRACKER_PACKAGE_CONTRACT.invocationFields,
    'invocationId',
  );
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
        dynamicArtifacts.push({
          ...addOwned(packetName, entry, 'invocation'),
          packetName,
          invocationRole: INVOCATION_TENSORS.get(key),
        });
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
  validateSam31BrowserTrackerGeometry(ingress.shape, episode.shape);
  const frameArtifacts = dynamicArtifacts.filter(entry => entry.invocationRole === 'source-image').sort((left, right) => left.role.localeCompare(right.role));
  const maskArtifact = dynamicArtifacts.find(entry => entry.invocationRole === 'initial-mask');
  if (frameArtifacts.length !== 2 || !maskArtifact) throw new Error('tracker invocation requires two source-image tensors and one initial mask');
  const sourceImages = sourceImageAuthority(ingress.sourceImages, frameArtifacts);
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
    modelPackageId: modelPackage.packageId,
    sourceImages,
    initialMask: { role: maskArtifact.role, file: maskArtifact.file, sha256: maskArtifact.sha256, byteLength: maskArtifact.byteLength },
    session: {
      sessionId,
      conditioningFrameIndex: 0,
      propagationFrameIndices: [1],
      conditioningObjects: episode.stateTransition?.conditioningObjects || Array.from({ length: 16 }, (_, index) => index),
      maskVariant: episode.fixture?.maskVariant ?? 0,
    },
    dynamicArtifacts: dynamicArtifacts.map(({ invocationRole, ...entry }) => ({ ...entry, invocationRole })),
  };
  invocation.invocationId = await createSam31BrowserTrackerInvocationId(invocation);

  const verification = {
    schema: SAM31_BROWSER_TRACKER_VERIFICATION_SCHEMA,
    verificationId: 'pending',
    verifiedPackageId: modelPackage.packageId,
    verifiedInvocationId: invocation.invocationId,
    reference: episode.reference,
    ...(episode.stateTransition ? { stateTransition: episode.stateTransition } : {}),
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
  const modelRoot = { schema: SAM31_BROWSER_TRACKER_ROOT_SCHEMA, modelPackage: refs.modelPackage };
  const root = { schema: SAM31_BROWSER_TRACKER_ROOT_SCHEMA, modelPackage: refs.modelPackage, invocation: refs.invocation, verification: refs.verification };
  const runtimeRoot = { schema: SAM31_BROWSER_TRACKER_ROOT_SCHEMA, modelPackage: refs.modelPackage, invocation: refs.invocation };
  return {
    modelRoot,
    root,
    runtimeRoot,
    modelPackage,
    invocation,
    verification,
    texts: { modelRoot: canonicalText(modelRoot), root: canonicalText(root), runtimeRoot: canonicalText(runtimeRoot), modelPackage: modelPackageText, invocation: invocationText, verification: verificationText },
    materialization,
  };
}
