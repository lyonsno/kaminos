import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as kit from '../src/index.js';
import { canonicalSam3IdentityJson } from '../src/sam-browser-package-manifest.js';

const sha256Text = async text => `sha256:${createHash('sha256').update(text).digest('hex')}`;

async function identity(prefix, artifact, fields, identityField) {
  const payload = Object.fromEntries(fields
    .filter(field => field !== identityField && Object.hasOwn(artifact, field))
    .map(field => [field, artifact[field]]));
  return `${prefix}${await sha256Text(canonicalSam3IdentityJson(payload))}`;
}

const modelPackage = {
  schema: kit.SAM3_BROWSER_MODEL_PACKAGE_SCHEMA,
  model: { id: 'serving-test-model' },
  staticWeights: { role: 'reference-upstream', sha256: 'sha256:weights' },
  shape: { batch: 1 },
  claims: { fullSam3BrowserExecution: false },
  weights: [{ role: 'weight', file: 'weight.bin', sha256: 'sha256:weight' }],
};
modelPackage.packageId = await identity(
  kit.SAM3_BROWSER_PACKAGE_CONTRACT.modelPackagePrefix,
  modelPackage,
  kit.SAM3_BROWSER_PACKAGE_CONTRACT.modelPackageFields,
  'packageId',
);

const invocation = {
  schema: kit.SAM3_BROWSER_INVOCATION_SCHEMA,
  prompt: { text: 'truck', sha256: 'sha256:prompt' },
  sourceImage: { file: 'truck.jpg', sha256: 'sha256:image' },
  postprocess: { scoreThreshold: 0.5 },
};
invocation.invocationId = await identity(
  kit.SAM3_BROWSER_PACKAGE_CONTRACT.invocationPrefix,
  invocation,
  kit.SAM3_BROWSER_PACKAGE_CONTRACT.invocationFields,
  'invocationId',
);

const modelText = JSON.stringify(modelPackage);
const invocationText = JSON.stringify(invocation);
const root = {
  schema: 'kaminos.sam3-serving-test-root.v0',
  routeId: 'sam3.serving.test',
  modelPackage: {
    file: 'model.json',
    sha256: await sha256Text(modelText),
    schema: kit.SAM3_BROWSER_MODEL_PACKAGE_SCHEMA,
  },
  invocation: {
    file: 'invocation.json',
    sha256: await sha256Text(invocationText),
    schema: kit.SAM3_BROWSER_INVOCATION_SCHEMA,
  },
  verification: {
    file: 'verification-must-not-load.json',
    sha256: 'sha256:verification',
    schema: kit.SAM3_BROWSER_VERIFICATION_SCHEMA,
  },
};

const artifactTexts = new Map([
  ['model.json', modelText],
  ['invocation.json', invocationText],
]);
const reads = [];
const detached = await kit.resolveSam3BrowserPackageManifest(root, {
  includeVerification: false,
  sha256Text,
  readArtifactText(file) {
    reads.push(file);
    if (!artifactTexts.has(file)) throw new Error(`serving resolver loaded forbidden artifact ${file}`);
    return artifactTexts.get(file);
  },
});
assert.deepEqual(reads.sort(), ['invocation.json', 'model.json']);
assert.equal(detached.evidence.verification.attached, false);
assert.equal(detached.evidence.verification.requestedRef.file, 'verification-must-not-load.json');
assert.equal(Object.hasOwn(detached.manifest, 'tensors'), false);
assert.equal(detached.manifest.packageId, modelPackage.packageId);
assert.equal(detached.manifest.invocationId, invocation.invocationId);

const detachedArtifactCache = kit.createSam3BrowserStaticArtifactCache({
  async fetchArrayBuffer() { throw new Error('serving bootstrap must not fetch during configuration'); },
  async fetchText() { throw new Error('serving bootstrap must not fetch during configuration'); },
});
detachedArtifactCache.configure({
  packageId: modelPackage.packageId,
  artifacts: [{ url: 'http://localhost/weight.bin', kind: 'array-buffer', sha256: 'sha256:weight' }],
});
assert.doesNotThrow(() => detachedArtifactCache.configureInvocation({
  invocationId: invocation.invocationId,
  artifacts: [],
}), 'verification-free invocation configuration must accept an empty dynamic artifact set');

assert.equal(typeof kit.createSam3BrowserServingResources, 'function', 'serving runtime must expose a resident resource owner');
assert.equal(typeof kit.createSam3BrowserImageCacheKey, 'function', 'serving runtime must expose an authenticated image-cache key');

let acquireCount = 0;
let destroyCount = 0;
const resources = kit.createSam3BrowserServingResources({
  async acquireExecutionContext() {
    acquireCount += 1;
    return {
      adapter: { info: { description: 'test-adapter' } },
      device: { destroy() { destroyCount += 1; } },
    };
  },
});

const firstContext = await resources.executionContext();
const secondContext = await resources.executionContext();
assert.strictEqual(secondContext, firstContext);
assert.equal(acquireCount, 1, 'resident serving must acquire one execution context');

const firstImageKey = kit.createSam3BrowserImageCacheKey({
  packageId: modelPackage.packageId,
  sourceImage: { sha256: 'sha256:image-a', encodedResolution: [640, 480] },
  imageShape: { width: 224, height: 224, hiddenSize: 1024 },
  kernelProfile: 'sam3-image-fpn-neck-phase-program-v0',
});
const sameImageKey = kit.createSam3BrowserImageCacheKey({
  packageId: modelPackage.packageId,
  sourceImage: { sha256: 'sha256:image-a', encodedResolution: [640, 480] },
  imageShape: { hiddenSize: 1024, height: 224, width: 224 },
  kernelProfile: 'sam3-image-fpn-neck-phase-program-v0',
});
const secondImageKey = kit.createSam3BrowserImageCacheKey({
  packageId: modelPackage.packageId,
  sourceImage: { sha256: 'sha256:image-b', encodedResolution: [640, 480] },
  imageShape: { width: 224, height: 224, hiddenSize: 1024 },
  kernelProfile: 'sam3-image-fpn-neck-phase-program-v0',
});
assert.equal(sameImageKey, firstImageKey);
assert.notEqual(secondImageKey, firstImageKey);

const cachedFeatures = { fpn: [new Float32Array([1, 2, 3])] };
assert.equal(resources.getImageFeatures(firstImageKey), null);
resources.setImageFeatures(firstImageKey, cachedFeatures);
assert.strictEqual(resources.getImageFeatures(sameImageKey), cachedFeatures);
assert.equal(resources.getImageFeatures(secondImageKey), null);
assert.deepEqual(resources.evidence(), {
  schema: 'kaminos.sam3-browser-serving-resources-evidence.v0',
  status: 'active',
  executionContextAcquisitions: 1,
  executionContextReuses: 1,
  imageCacheHits: 1,
  imageCacheMisses: 2,
  imageCacheWrites: 1,
  activeImageCacheKey: firstImageKey,
});

await resources.close();
await resources.close();
assert.equal(destroyCount, 1, 'resident serving close must release its device exactly once');
await assert.rejects(() => resources.executionContext(), /serving resources are closed/);
assert.throws(() => resources.setImageFeatures(firstImageKey, cachedFeatures), /serving resources are closed/);

const workbench = readFileSync(new URL('../smokes/sam-semantic-mask-workbench.js', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../smokes/sam-mask-island-parity.js', import.meta.url), 'utf8');
assert.match(workbench, /sam-mask-island-serving\.html/, 'workbench must enter a serving route rather than the parity page');
assert.match(runtime, /resolveBrowserManifest\(rootManifest,\s*\{\s*includeVerification:\s*verificationAttached\s*\}\)/, 'execution-only runtime must detach verification before artifact resolution');
assert.match(runtime, /createSam3BrowserServingResources/, 'runtime must own resident WebGPU and image resources');
assert.match(runtime, /const imageCacheKey\s*=\s*!verificationAttached\s*\?[\s\S]*createSam3BrowserImageCacheKey\(/, 'detached runtime must authenticate image feature reuse');
assert.match(runtime, /servingResources\.getImageFeatures\(imageCacheKey\)/, 'detached runtime must look up image features before image execution');
assert.match(runtime, /servingResources\.setImageFeatures\(imageCacheKey,\s*\{/, 'detached runtime must preserve newly computed image features');
assert.match(runtime, /if \(includeImagePreprocess && !cachedImageFeatures\)/, 'an authenticated cache hit must bypass image preprocessing');
assert.match(runtime, /imageCache:\s*\{[\s\S]*status:\s*cachedImageFeatures\s*\?\s*['"]hit['"]\s*:\s*['"]miss['"]/, 'runtime evidence must distinguish live image cache hits from misses');
assert.match(runtime, /visualOutput\s*=\s*\{[\s\S]*imageCache:\s*result\.imageCache/, 'operator-visible output must carry the effective image-cache route');
assert.match(runtime, /\.\.\.\(verificationAttached\s*\?\s*\{\s*expectedLayerCheckpoints:\s*expectedVitLayerCheckpoints\s*\}\s*:\s*\{\s*\}\)/, 'detached ViT execution must omit the expected-checkpoint contract rather than pass an empty list');
assert.match(runtime, /const parity\s*=\s*verificationAttached\s*\?\s*\{/, 'detached execution must not construct final reference parity from absent expected tensors');
assert.match(runtime, /loadDetrStackPayload\(manifest,\s*\{[\s\S]*verificationAttached[\s\S]*servingResources/, 'full SAM runner must receive serving authority explicitly');
assert.match(runtime, /if \(verificationAttached\) \{[\s\S]*oracle packet self-check failed/, 'CPU oracle self-check must be unreachable in detached serving mode');

console.log('sam browser serving runtime contracts passed');
