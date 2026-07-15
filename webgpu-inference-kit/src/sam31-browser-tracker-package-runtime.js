import {
  canonicalSam3IdentityJson,
  createSam3BrowserStaticArtifactCache,
  resolveSam3BrowserArtifactUrl,
  resolveSam3BrowserPackageManifest,
} from './sam-browser-package-manifest.js';
import {
  SAM31_BROWSER_TRACKER_MODEL_PACKAGE_SCHEMA,
  SAM31_BROWSER_TRACKER_PACKAGE_CONTRACT,
  SAM31_BROWSER_TRACKER_ROOT_SCHEMA,
} from './sam31-browser-tracker-package.js';

const PACKET_NAMES = Object.freeze(['ingress', 'decoder', 'memory', 'temporal', 'episode', 'pointer']);

function requireFetch(fetchImpl) {
  if (typeof fetchImpl !== 'function') throw new Error('fetchImpl must be a function');
  return fetchImpl;
}

async function responseText(fetchImpl, url) {
  const response = await fetchImpl(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`fetch ${url} failed ${response.status}`);
  return response.text();
}

async function responseArrayBuffer(fetchImpl, url) {
  const response = await fetchImpl(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`fetch ${url} failed ${response.status}`);
  return response.arrayBuffer();
}

async function sha256Text(value) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return `sha256:${Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

function flattenVerificationTensors(tensors) {
  if (!tensors) return [];
  return PACKET_NAMES.flatMap(packetName => (tensors[packetName] || []).map(entry => ({ ...entry, packetName })));
}

function composePacketManifests(manifest) {
  const dynamicByPacket = Object.fromEntries(PACKET_NAMES.map(name => [name, []]));
  for (const entry of manifest.dynamicArtifacts) {
    if (!dynamicByPacket[entry.packetName]) throw new Error(`unsupported invocation packet owner ${entry.packetName}`);
    dynamicByPacket[entry.packetName].push(entry);
  }
  const result = {};
  for (const packetName of PACKET_NAMES) {
    const component = manifest.components[packetName];
    if (!component) throw new Error(`model package is missing ${packetName} component`);
    const verification = manifest.tensors?.[packetName] || [];
    const packet = {
      ...component,
      tensors: [...(component.staticTensors || []), ...dynamicByPacket[packetName], ...verification],
      ...(manifest.tolerances ? { tolerances: manifest.tolerances[packetName] } : {}),
    };
    if (packetName === 'temporal') {
      packet.attentionWeights = packet.weights;
      delete packet.weights;
    }
    if (packetName === 'ingress') {
      const sourceImages = manifest.sourceImages.slice().sort((left, right) => left.frameIndex - right.frameIndex);
      packet.sourceImages = sourceImages.map((source, frameIndex) => ({
        ...(component.sourceImages?.[frameIndex] || {}),
        ...source,
        rgbaSha256: source.rgbaSha256,
      }));
    }
    if (packetName === 'episode') {
      packet.stateTransition = manifest.stateTransition || {
        conditioningObjects: manifest.session.conditioningObjects,
      };
    }
    result[packetName] = packet;
  }
  return result;
}

function createOpfsStaticBackingStore() {
  if (typeof globalThis.navigator?.storage?.getDirectory !== 'function') return null;
  let directoryPromise;
  const directory = () => {
    directoryPromise ||= globalThis.navigator.storage.getDirectory()
      .then(root => root.getDirectoryHandle('kaminos-sam31-static-v0', { create: true }));
    return directoryPromise;
  };
  const fileName = identity => `${identity.replace(/[^a-zA-Z0-9._-]/g, '_')}.bin`;
  return {
    kind: 'browser-opfs',
    async read(identity) {
      try {
        const handle = await (await directory()).getFileHandle(fileName(identity));
        return (await handle.getFile()).arrayBuffer();
      } catch (error) {
        if (error?.name === 'NotFoundError') return null;
        throw error;
      }
    },
    async write(identity, bytes) {
      const handle = await (await directory()).getFileHandle(fileName(identity), { create: true });
      const writable = await handle.createWritable();
      try {
        await writable.write(bytes);
        await writable.close();
      } catch (error) {
        await writable.abort().catch(() => {});
        throw error;
      }
    },
  };
}

export function createSam31BrowserTrackerPackageCache({
  fetchImpl = globalThis.fetch,
  staticBackingStore = null,
  persistentStaticBacking = false,
} = {}) {
  const fetcher = requireFetch(fetchImpl);
  const effectiveStaticBackingStore = staticBackingStore || (persistentStaticBacking ? createOpfsStaticBackingStore() : null);
  const backingEvidence = {
    kind: effectiveStaticBackingStore?.kind || 'retained-memory',
    staticOriginNetworkLoadCount: 0,
    staticBackingStoreHitCount: 0,
    staticBackingStoreWriteCount: 0,
  };
  const fetchStaticArrayBuffer = effectiveStaticBackingStore ? async (url, identity) => {
    const stored = await effectiveStaticBackingStore.read(identity);
    if (stored != null) {
      backingEvidence.staticBackingStoreHitCount += 1;
      return stored;
    }
    const response = await fetcher(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`fetch ${url} failed ${response.status}`);
    const bytes = await response.arrayBuffer();
    await effectiveStaticBackingStore.write(identity, bytes);
    backingEvidence.staticOriginNetworkLoadCount += 1;
    backingEvidence.staticBackingStoreWriteCount += 1;
    return bytes;
  } : url => responseArrayBuffer(fetcher, url);
  const cache = createSam3BrowserStaticArtifactCache({
    fetchArrayBuffer: url => responseArrayBuffer(fetcher, url),
    fetchText: url => responseText(fetcher, url),
    fetchStaticArrayBuffer,
    retainStaticValues: !effectiveStaticBackingStore,
  });
  const baseEvidence = cache.evidence.bind(cache);
  cache.evidence = () => {
    const evidence = baseEvidence();
    const effectiveBackingEvidence = effectiveStaticBackingStore
      ? { ...backingEvidence }
      : {
          kind: 'retained-memory',
          staticOriginNetworkLoadCount: evidence.staticNetworkLoadCount,
          staticBackingStoreHitCount: evidence.staticCacheHitCount,
          staticBackingStoreWriteCount: evidence.staticNetworkLoadCount,
        };
    return { ...evidence, backingStore: effectiveBackingEvidence };
  };
  return cache;
}

export async function loadSam31BrowserTrackerModelPackageRuntime({
  rootUrl,
  pageUrl = globalThis.location?.href,
  fetchImpl = globalThis.fetch,
  cache,
}) {
  const fetcher = requireFetch(fetchImpl);
  if (!cache || typeof cache.configure !== 'function' || typeof cache.fetchArray !== 'function') {
    throw new Error('a shared SAM 3.1 browser tracker package cache is required');
  }
  const effectiveRootUrl = new URL(rootUrl, pageUrl).toString();
  const rootText = await responseText(fetcher, effectiveRootUrl);
  const root = JSON.parse(rootText);
  if (!root || typeof root !== 'object' || Array.isArray(root)) throw new Error('tracker model root must be an object');
  if (root.schema !== SAM31_BROWSER_TRACKER_ROOT_SCHEMA) throw new Error(`unsupported tracker model root ${root.schema || 'missing'}`);
  if (Object.hasOwn(root, 'invocation') || Object.hasOwn(root, 'verification')) {
    throw new Error('tracker model-only root must not contain invocation or verification references');
  }
  for (const field of SAM31_BROWSER_TRACKER_PACKAGE_CONTRACT.modelPackageFields) {
    if (Object.hasOwn(root, field)) throw new Error(`tracker model root duplicates model-package field ${field}`);
  }
  const ref = root.modelPackage;
  if (!ref || typeof ref.file !== 'string' || !ref.file || typeof ref.sha256 !== 'string' || ref.schema !== SAM31_BROWSER_TRACKER_MODEL_PACKAGE_SCHEMA) {
    throw new Error('tracker model root has an invalid model-package reference');
  }
  const modelPackageUrl = resolveSam3BrowserArtifactUrl(ref.file, effectiveRootUrl, pageUrl);
  const modelPackageText = await responseText(fetcher, modelPackageUrl);
  const effectiveSha256 = await sha256Text(modelPackageText);
  if (effectiveSha256 !== ref.sha256) throw new Error(`tracker model-package hash mismatch: ${effectiveSha256} !== ${ref.sha256}`);
  const modelPackage = JSON.parse(modelPackageText);
  if (modelPackage?.schema !== SAM31_BROWSER_TRACKER_MODEL_PACKAGE_SCHEMA) throw new Error(`unsupported tracker model package ${modelPackage?.schema || 'missing'}`);
  const identityContract = Object.fromEntries(SAM31_BROWSER_TRACKER_PACKAGE_CONTRACT.modelPackageFields
    .filter(field => field !== 'packageId' && Object.hasOwn(modelPackage, field))
    .map(field => [field, modelPackage[field]]));
  const expectedPackageId = `${SAM31_BROWSER_TRACKER_PACKAGE_CONTRACT.modelPackagePrefix}${await sha256Text(canonicalSam3IdentityJson(identityContract))}`;
  if (modelPackage.packageId !== expectedPackageId) throw new Error(`tracker model-package identity mismatch: ${modelPackage.packageId || 'missing'} !== ${expectedPackageId}`);
  const artifactUrl = file => resolveSam3BrowserArtifactUrl(file, modelPackageUrl, pageUrl);
  const declared = new Map();
  for (const entry of modelPackage.staticArtifacts || []) {
    if (!entry?.file || !entry?.sha256 || !Number.isInteger(entry?.byteLength)) throw new Error('tracker static artifact entry is incomplete');
    const url = artifactUrl(entry.file);
    const identity = `${entry.sha256}:${entry.byteLength}`;
    if (declared.has(url) && declared.get(url) !== identity) throw new Error(`package artifact identity conflict for ${url}`);
    declared.set(url, identity);
  }
  cache.configure({
    packageId: modelPackage.packageId,
    artifacts: modelPackage.staticArtifacts.map(entry => ({ url: artifactUrl(entry.file), sha256: entry.sha256, kind: 'array-buffer' })),
  });
  async function load(entry, Type) {
    if (!entry?.file || !entry?.sha256 || !Number.isInteger(entry?.byteLength)) throw new Error('tracker static artifact entry is incomplete');
    const url = artifactUrl(entry.file);
    if (declared.get(url) !== `${entry.sha256}:${entry.byteLength}`) throw new Error(`${entry.role || entry.file} is not declared by the authenticated model package`);
    const values = await cache.fetchArray(url, Type, entry.sha256);
    if (values.byteLength !== entry.byteLength) throw new Error(`${entry.role || entry.file} byte length mismatch`);
    return values;
  }
  return {
    rootUrl: effectiveRootUrl,
    packageId: modelPackage.packageId,
    modelPackage,
    packageResolution: {
      schema: 'kaminos.sam31-browser-tracker-model-package-evidence.v0',
      packageId: modelPackage.packageId,
      modelPackage: { ...ref, effectiveSha256 },
    },
    loadFloat32: entry => load(entry, Float32Array),
    loadUint8: entry => load(entry, Uint8Array),
    cacheEvidence: () => cache.evidence(),
  };
}

export async function loadSam31BrowserTrackerPackageRuntime({
  rootUrl,
  pageUrl = globalThis.location?.href,
  fetchImpl = globalThis.fetch,
  cache,
}) {
  const fetcher = requireFetch(fetchImpl);
  if (!cache || typeof cache.configure !== 'function' || typeof cache.fetchArray !== 'function') {
    throw new Error('a shared SAM 3.1 browser tracker package cache is required');
  }
  const effectiveRootUrl = new URL(rootUrl, pageUrl).toString();
  const rootText = await responseText(fetcher, effectiveRootUrl);
  const root = JSON.parse(rootText);
  if (!root || typeof root !== 'object' || Array.isArray(root)) throw new Error('tracker package root must be an object');
  if (root.schema !== SAM31_BROWSER_TRACKER_ROOT_SCHEMA) throw new Error(`unsupported tracker package root ${root.schema || 'missing'}`);
  const artifactUrl = file => resolveSam3BrowserArtifactUrl(file, effectiveRootUrl, pageUrl);
  const resolution = await resolveSam3BrowserPackageManifest(root, {
    contract: SAM31_BROWSER_TRACKER_PACKAGE_CONTRACT,
    readArtifactText: file => responseText(fetcher, artifactUrl(file)),
    sha256Text,
  });
  const manifest = resolution.manifest;
  const verificationAttached = resolution.evidence.verification.attached;
  const verificationArtifacts = flattenVerificationTensors(manifest.tensors);
  const dynamicArtifacts = [...manifest.dynamicArtifacts, ...verificationArtifacts];
  const declared = new Map();
  for (const entry of [...manifest.staticArtifacts, ...dynamicArtifacts]) {
    const url = artifactUrl(entry.file);
    const identity = `${entry.sha256}:${entry.byteLength}`;
    if (declared.has(url) && declared.get(url) !== identity) throw new Error(`package artifact identity conflict for ${url}`);
    declared.set(url, identity);
  }
  cache.configure({
    packageId: manifest.packageId,
    artifacts: manifest.staticArtifacts.map(entry => ({ url: artifactUrl(entry.file), sha256: entry.sha256, kind: 'array-buffer' })),
  });
  cache.configureInvocation({
    invocationId: manifest.invocationId,
    artifacts: dynamicArtifacts.map(entry => ({ url: artifactUrl(entry.file), sha256: entry.sha256, kind: 'array-buffer' })),
  });

  async function load(entry, Type) {
    if (!entry?.file || !entry?.sha256 || !Number.isInteger(entry?.byteLength)) throw new Error('tracker artifact entry is incomplete');
    const url = artifactUrl(entry.file);
    if (declared.get(url) !== `${entry.sha256}:${entry.byteLength}`) {
      throw new Error(`${entry.role || entry.file} is not declared by the authenticated package root`);
    }
    const values = await cache.fetchArray(url, Type, entry.sha256);
    if (values.byteLength !== entry.byteLength) throw new Error(`${entry.role || entry.file} byte length mismatch`);
    return values;
  }

  return {
    rootUrl: effectiveRootUrl,
    packageId: manifest.packageId,
    invocationId: manifest.invocationId,
    verificationId: manifest.verificationId || null,
    verificationAttached,
    encodedSourceImageSha256: manifest.sourceImages.map(image => image.originalSha256),
    rgbaSourceImageSha256: manifest.sourceImages.map(image => image.rgbaSha256),
    sourceImageSha256: manifest.sourceImages.map(image => image.sha256),
    initialMaskSha256: manifest.initialMask.sha256,
    session: structuredClone(manifest.session),
    manifests: composePacketManifests(manifest),
    packageResolution: resolution.evidence,
    componentAuthorities: manifest.componentAuthorities || null,
    loadFloat32: entry => load(entry, Float32Array),
    loadUint8: entry => load(entry, Uint8Array),
    cacheEvidence: () => cache.evidence(),
  };
}

const CAUSAL_TRACKER_STATE_DIGESTS = Object.freeze(['memory', 'image', 'pointers', 'maskLogits']);
const DETERMINISTIC_TRACKER_STATE_DIGESTS = Object.freeze(['memoryPosition', 'imagePosition', 'objectScores']);

function sameArray(left, right) {
  return Array.isArray(left) && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function trackerStateShapePassed(invocation) {
  const state = invocation.trackerState;
  const session = invocation.packageRuntime.session;
  if (!state || state.version !== 1 || !session) return false;
  const frameIndex = session.conditioningFrameIndex;
  const frame = state.frames?.[0];
  return Number.isInteger(frameIndex)
    && sameArray(state.conditioningFrameIndices, [frameIndex])
    && sameArray(state.nonConditioningFrameIndices, [])
    && state.frames?.length === 1
    && frame?.frameIndex === frameIndex
    && frame?.kind === 'conditioning'
    && sameArray(frame.conditioningObjects, session.conditioningObjects)
    && [...CAUSAL_TRACKER_STATE_DIGESTS, ...DETERMINISTIC_TRACKER_STATE_DIGESTS]
      .every(name => typeof frame.tensorDigests?.[name] === 'string' && frame.tensorDigests[name].length > 0);
}

export function createSam31BrowserTrackerDualInvocationEvidence({
  invocations,
  betweenInvocationCheckpoints = [],
}) {
  if (!Array.isArray(invocations) || invocations.length !== 2) {
    throw new Error('dual tracker evidence requires exactly two invocation records');
  }
  const [first, second] = invocations;
  const firstRequests = new Set(first.requestIds);
  const firstOutputs = new Set(first.receipts.flatMap(receipt => receipt.outputs.map(output => output.artifactId)));
  const firstEncodedImages = new Set(first.packageRuntime.encodedSourceImageSha256);
  const firstRgbaImages = new Set(first.packageRuntime.rgbaSourceImageSha256);
  const firstFinalMask = first.receipts.at(-1).outputs.find(output => output.role === 'sam31-multiplex-selected-masks');
  const secondFinalMask = second.receipts.at(-1).outputs.find(output => output.role === 'sam31-multiplex-selected-masks');
  const firstStateShapePassed = trackerStateShapePassed(first);
  const secondStateShapePassed = trackerStateShapePassed(second);
  const firstStateDigests = first.trackerState?.frames?.[0]?.tensorDigests || {};
  const secondStateDigests = second.trackerState?.frames?.[0]?.tensorDigests || {};
  const distinctCausalTrackerState = firstStateShapePassed && secondStateShapePassed
    && CAUSAL_TRACKER_STATE_DIGESTS.every(name => firstStateDigests[name] !== secondStateDigests[name]);
  const deterministicTrackerStateShared = firstStateShapePassed && secondStateShapePassed
    && DETERMINISTIC_TRACKER_STATE_DIGESTS.every(name => firstStateDigests[name] === secondStateDigests[name]);
  const trackerStateShapeValid = firstStateShapePassed && secondStateShapePassed;
  const evidence = {
    schema: 'kaminos.sam31-browser-tracker-dual-invocation-evidence.v0',
    causalTrackerStateDigestNames: [...CAUSAL_TRACKER_STATE_DIGESTS],
    deterministicTrackerStateDigestNames: [...DETERMINISTIC_TRACKER_STATE_DIGESTS],
    sameModelPackage: first.packageRuntime.packageId === second.packageRuntime.packageId,
    distinctInvocationIds: first.packageRuntime.invocationId !== second.packageRuntime.invocationId,
    distinctVerificationAttachments: first.packageRuntime.verificationId !== second.packageRuntime.verificationId,
    distinctEncodedSourceImages: second.packageRuntime.encodedSourceImageSha256.every(identity => !firstEncodedImages.has(identity)),
    distinctRgbaSourceImages: second.packageRuntime.rgbaSourceImageSha256.every(identity => !firstRgbaImages.has(identity)),
    distinctSourceImages: second.packageRuntime.encodedSourceImageSha256.every(identity => !firstEncodedImages.has(identity))
      && second.packageRuntime.rgbaSourceImageSha256.every(identity => !firstRgbaImages.has(identity)),
    distinctInitialMasks: first.packageRuntime.initialMaskSha256 !== second.packageRuntime.initialMaskSha256,
    distinctRequestIds: second.requestIds.every(requestId => !firstRequests.has(requestId)),
    distinctOutputIds: second.receipts.flatMap(receipt => receipt.outputs.map(output => output.artifactId)).every(outputId => !firstOutputs.has(outputId)),
    distinctFinalOutputs: Boolean(firstFinalMask?.sha256 && secondFinalMask?.sha256 && firstFinalMask.sha256 !== secondFinalMask.sha256),
    firstVerificationAttached: first.verificationAttached === true,
    secondVerificationFree: second.verificationAttached === false && second.parity === null,
    bothRouteChainsReal: first.evidence.routeChainPassed === true && second.evidence.routeChainPassed === true && first.receipts.length === 19 && second.receipts.length === 19,
    noSecondStaticNetworkLoads: second.packageRuntime.cacheEvidence.staticNetworkLoadCount === first.packageRuntime.cacheEvidence.staticNetworkLoadCount,
    secondStaticCacheHitsObserved: second.packageRuntime.cacheEvidence.staticCacheHitCount > first.packageRuntime.cacheEvidence.staticCacheHitCount,
    noSecondStaticOriginNetworkLoads: second.packageRuntime.cacheEvidence.backingStore.staticOriginNetworkLoadCount === first.packageRuntime.cacheEvidence.backingStore.staticOriginNetworkLoadCount,
    secondBackingStoreHitsObserved: second.packageRuntime.cacheEvidence.backingStore.staticBackingStoreHitCount > first.packageRuntime.cacheEvidence.backingStore.staticBackingStoreHitCount,
    freshSecondDynamicReadsObserved: second.packageRuntime.cacheEvidence.dynamicNetworkLoadCount > first.packageRuntime.cacheEvidence.dynamicNetworkLoadCount,
    trackerStateShapePassed: trackerStateShapeValid,
    distinctCausalTrackerState,
    deterministicTrackerStateShared,
    stateIsolationPassed: trackerStateShapeValid && distinctCausalTrackerState && deterministicTrackerStateShared,
    distinctExecutionRealms: typeof first.executionRealmId === 'string' && first.executionRealmId.length > 0 && typeof second.executionRealmId === 'string' && first.executionRealmId !== second.executionRealmId,
    betweenInvocationCheckpointPassed: betweenInvocationCheckpoints.length === 1 && betweenInvocationCheckpoints[0].passed === true && betweenInvocationCheckpoints[0].realmRemoved === true,
    noDeviceLoss: invocations.every(invocation => invocation.deviceLoss == null),
  };
  evidence.passed = Object.entries(evidence)
    .filter(([key]) => !['schema', 'causalTrackerStateDigestNames', 'deterministicTrackerStateDigestNames'].includes(key))
    .every(([, value]) => value === true);
  return evidence;
}
