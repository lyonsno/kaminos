import {
  createSam3BrowserStaticArtifactCache,
  resolveSam3BrowserArtifactUrl,
  resolveSam3BrowserPackageManifest,
} from './sam-browser-package-manifest.js';
import { SAM31_BROWSER_TRACKER_PACKAGE_CONTRACT } from './sam31-browser-tracker-package.js';

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
        rgbaSha256: source.sha256,
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
    const values = await cache.fetchArray(url, Type);
    if (values.byteLength !== entry.byteLength) throw new Error(`${entry.role || entry.file} byte length mismatch`);
    return values;
  }

  return {
    rootUrl: effectiveRootUrl,
    packageId: manifest.packageId,
    invocationId: manifest.invocationId,
    verificationId: manifest.verificationId || null,
    verificationAttached,
    sourceImageSha256: manifest.sourceImages.map(image => image.sha256),
    initialMaskSha256: manifest.initialMask.sha256,
    manifests: composePacketManifests(manifest),
    packageResolution: resolution.evidence,
    componentAuthorities: manifest.componentAuthorities || null,
    loadFloat32: entry => load(entry, Float32Array),
    loadUint8: entry => load(entry, Uint8Array),
    cacheEvidence: () => cache.evidence(),
  };
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
  const firstImages = new Set(first.packageRuntime.sourceImageSha256);
  const firstFinalMask = first.receipts.at(-1).outputs.find(output => output.role === 'sam31-multiplex-selected-masks');
  const secondFinalMask = second.receipts.at(-1).outputs.find(output => output.role === 'sam31-multiplex-selected-masks');
  const evidence = {
    schema: 'kaminos.sam31-browser-tracker-dual-invocation-evidence.v0',
    sameModelPackage: first.packageRuntime.packageId === second.packageRuntime.packageId,
    distinctInvocationIds: first.packageRuntime.invocationId !== second.packageRuntime.invocationId,
    distinctVerificationAttachments: first.packageRuntime.verificationId !== second.packageRuntime.verificationId,
    distinctSourceImages: second.packageRuntime.sourceImageSha256.every(identity => !firstImages.has(identity)),
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
    stateIsolationPassed: first.trackerState.version === 1 && second.trackerState.version === 1 && first.trackerState.frames[0].tensorDigests.maskLogits !== second.trackerState.frames[0].tensorDigests.maskLogits,
    distinctExecutionRealms: typeof first.executionRealmId === 'string' && first.executionRealmId.length > 0 && typeof second.executionRealmId === 'string' && first.executionRealmId !== second.executionRealmId,
    betweenInvocationCheckpointPassed: betweenInvocationCheckpoints.length === 1 && betweenInvocationCheckpoints[0].passed === true && betweenInvocationCheckpoints[0].realmRemoved === true,
    noDeviceLoss: invocations.every(invocation => invocation.deviceLoss == null),
  };
  evidence.passed = Object.entries(evidence).filter(([key]) => key !== 'schema').every(([, value]) => value === true);
  return evidence;
}
