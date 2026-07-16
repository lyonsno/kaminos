import { canonicalSam3IdentityJson } from './sam-browser-package-manifest.js';

export const SAM3_BROWSER_SERVING_RESOURCES_EVIDENCE_SCHEMA = 'kaminos.sam3-browser-serving-resources-evidence.v0';

function requireNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function requireResolution(value) {
  if (!Array.isArray(value) || value.length !== 2 || value.some(dimension => !Number.isInteger(dimension) || dimension <= 0)) {
    throw new Error('sourceImage.encodedResolution must contain two positive integers');
  }
  return value;
}

export function createSam3BrowserImageCacheKey({ packageId, sourceImage, imageShape, kernelProfile }) {
  if (!sourceImage || typeof sourceImage !== 'object') throw new Error('sourceImage must be an object');
  if (!imageShape || typeof imageShape !== 'object' || Array.isArray(imageShape)) throw new Error('imageShape must be an object');
  return `sam3-image-features:${canonicalSam3IdentityJson({
    packageId: requireNonEmptyString(packageId, 'packageId'),
    sourceImageSha256: requireNonEmptyString(sourceImage.sha256, 'sourceImage.sha256'),
    encodedResolution: requireResolution(sourceImage.encodedResolution),
    imageShape,
    kernelProfile: requireNonEmptyString(kernelProfile, 'kernelProfile'),
  })}`;
}

export function createSam3BrowserServingResources({ acquireExecutionContext }) {
  if (typeof acquireExecutionContext !== 'function') throw new Error('acquireExecutionContext must be a function');

  let status = 'active';
  let context = null;
  let contextPromise = null;
  let activeImageCacheKey = null;
  let activeImageFeatures = null;
  let executionContextAcquisitions = 0;
  let executionContextReuses = 0;
  let imageCacheHits = 0;
  let imageCacheMisses = 0;
  let imageCacheWrites = 0;

  function assertActive() {
    if (status !== 'active') throw new Error('SAM3 browser serving resources are closed');
  }

  async function executionContext() {
    assertActive();
    if (context) {
      executionContextReuses += 1;
      return context;
    }
    if (contextPromise) {
      executionContextReuses += 1;
      return contextPromise;
    }
    contextPromise = Promise.resolve()
      .then(acquireExecutionContext)
      .then(value => {
        if (!value?.adapter || !value?.device) throw new Error('execution context must contain adapter and device');
        executionContextAcquisitions += 1;
        context = value;
        return value;
      })
      .catch(error => {
        contextPromise = null;
        throw error;
      });
    return contextPromise;
  }

  function getImageFeatures(cacheKey) {
    assertActive();
    requireNonEmptyString(cacheKey, 'cacheKey');
    if (cacheKey === activeImageCacheKey && activeImageFeatures !== null) {
      imageCacheHits += 1;
      return activeImageFeatures;
    }
    imageCacheMisses += 1;
    return null;
  }

  function setImageFeatures(cacheKey, features) {
    assertActive();
    requireNonEmptyString(cacheKey, 'cacheKey');
    if (features === null || features === undefined) throw new Error('image features must be present');
    activeImageCacheKey = cacheKey;
    activeImageFeatures = features;
    imageCacheWrites += 1;
  }

  function evidence() {
    return {
      schema: SAM3_BROWSER_SERVING_RESOURCES_EVIDENCE_SCHEMA,
      status,
      executionContextAcquisitions,
      executionContextReuses,
      imageCacheHits,
      imageCacheMisses,
      imageCacheWrites,
      activeImageCacheKey,
    };
  }

  async function close() {
    if (status === 'closed') return;
    status = 'closed';
    let acquired = context;
    if (!acquired && contextPromise) {
      try {
        acquired = await contextPromise;
      } catch {
        acquired = null;
      }
    }
    acquired?.device?.destroy?.();
    context = null;
    contextPromise = null;
    activeImageCacheKey = null;
    activeImageFeatures = null;
  }

  return {
    executionContext,
    getImageFeatures,
    setImageFeatures,
    evidence,
    close,
  };
}
