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
let modelAcquireCount = 0;
let modelCloseCount = 0;
let nowMs = 100;
let releaseModelClose;
const modelCloseGate = new Promise(resolve => { releaseModelClose = resolve; });
const lifecycle = [];
const resources = kit.createSam3BrowserServingResources({
  now: () => nowMs,
  async acquireExecutionContext() {
    acquireCount += 1;
    return {
      adapter: { info: { description: 'test-adapter' } },
      device: { destroy() { destroyCount += 1; lifecycle.push('device-destroy'); } },
    };
  },
  async acquireModelSession({ packageRuntime, executionContext, commit }) {
    modelAcquireCount += 1;
    assert.equal(executionContext, firstContext);
    assert.equal(commit, 'fixture-commit');
    nowMs += 7;
    return {
      packageId: packageRuntime.packageId,
      residentTensorResolver() {},
      loadFloat32() {},
      evidence() { return { packageId: packageRuntime.packageId, uploadCount: 2 }; },
      async close() {
        modelCloseCount += 1;
        lifecycle.push('model-close');
        await modelCloseGate;
      },
    };
  },
});

const firstContext = await resources.executionContext();
const secondContext = await resources.executionContext();
assert.strictEqual(secondContext, firstContext);
assert.equal(acquireCount, 1, 'resident serving must acquire one execution context');

const packageRuntime = { packageId: modelPackage.packageId };
const [firstModelSession, concurrentModelSession] = await Promise.all([
  resources.modelSession(packageRuntime, { commit: 'fixture-commit' }),
  resources.modelSession(packageRuntime, { commit: 'fixture-commit' }),
]);
const reusedModelSession = await resources.modelSession(packageRuntime, { commit: 'fixture-commit' });
assert.strictEqual(concurrentModelSession, firstModelSession);
assert.strictEqual(reusedModelSession, firstModelSession);
assert.equal(modelAcquireCount, 1, 'resident model acquisition must single-flight and persist across prompt invocations');
await assert.rejects(
  () => resources.modelSession({ packageId: 'sam3-model-package:other' }, { commit: 'fixture-commit' }),
  /already bound|package identity|cannot switch/i,
  'one serving page must not silently switch resident model packages',
);

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
  executionContextReuses: 2,
  modelSessionAcquisitions: 1,
  modelSessionReuses: 2,
  modelPreparationMilliseconds: 7,
  activeModelPackageId: modelPackage.packageId,
  modelSession: { packageId: modelPackage.packageId, uploadCount: 2 },
  imageCacheHits: 1,
  imageCacheMisses: 2,
  imageCacheWrites: 1,
  activeImageCacheKey: firstImageKey,
});

let secondCloseSettled = false;
const firstClose = resources.close();
const secondClose = resources.close().then(() => { secondCloseSettled = true; });
await Promise.resolve();
assert.equal(secondCloseSettled, false, 'concurrent close callers must share the complete teardown flight');
releaseModelClose();
await Promise.all([firstClose, secondClose]);
await resources.close();
assert.equal(destroyCount, 1, 'resident serving close must release its device exactly once');
assert.equal(modelCloseCount, 1, 'resident serving close must release its model session exactly once');
assert.deepEqual(lifecycle, ['model-close', 'device-destroy'], 'model leases must close before their device is destroyed');
await assert.rejects(() => resources.executionContext(), /serving resources are closed/);
assert.throws(() => resources.setImageFeatures(firstImageKey, cachedFeatures), /serving resources are closed/);

let invalidModelCloseCount = 0;
let invalidModelDeviceDestroyCount = 0;
const invalidModelResources = kit.createSam3BrowserServingResources({
  async acquireExecutionContext() {
    return {
      adapter: { info: { description: 'invalid-model-test-adapter' } },
      device: { destroy() { invalidModelDeviceDestroyCount += 1; } },
    };
  },
  async acquireModelSession() {
    return {
      packageId: 'sam3-model-package:wrong-package',
      async close() { invalidModelCloseCount += 1; },
    };
  },
});
await assert.rejects(
  () => invalidModelResources.modelSession(packageRuntime),
  /preserve package identity and close authority/i,
  'a resident model session with substituted package identity must be rejected',
);
assert.equal(invalidModelCloseCount, 1, 'a rejected but live resident model session must be closed before its authority is discarded');
await invalidModelResources.close();
assert.equal(invalidModelDeviceDestroyCount, 1, 'rejected model acquisition must still release the borrowed serving device');

const workbench = readFileSync(new URL('../smokes/sam-semantic-mask-workbench.js', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../smokes/sam-mask-island-parity.js', import.meta.url), 'utf8');
assert.match(workbench, /sam-mask-island-serving\.html/, 'workbench must enter a serving route rather than the parity page');
assert.match(runtime, /resolveBrowserManifest\(rootManifest,\s*\{\s*includeVerification:\s*verificationAttached\s*\}\)/, 'execution-only runtime must detach verification before artifact resolution');
assert.match(runtime, /createSam3BrowserServingResources/, 'runtime must own resident WebGPU and image resources');
assert.match(runtime, /createSam3BrowserModelPackageRuntime/, 'runtime must project the semantic model package into shared resident-resource ownership');
assert.match(runtime, /servingResources\.modelSession\(/, 'detached serving must single-flight a persistent model session');
assert.match(runtime, /residentTensorResolver/, 'semantic phase execution must receive authenticated resident tensor resolution');
assert.match(runtime, /const imageCacheKey\s*=\s*!verificationAttached\s*\?[\s\S]*createSam3BrowserImageCacheKey\(/, 'detached runtime must authenticate image feature reuse');
assert.match(runtime, /servingResources\.getImageFeatures\(imageCacheKey\)/, 'detached runtime must look up image features before image execution');
assert.match(runtime, /servingResources\.setImageFeatures\(imageCacheKey,\s*\{/, 'detached runtime must preserve newly computed image features');
assert.match(runtime, /if \(includeImagePreprocess && !cachedImageFeatures\)/, 'an authenticated cache hit must bypass image preprocessing');
assert.match(runtime, /imageCache:\s*\{[\s\S]*status:\s*cachedImageFeatures\s*\?\s*['"]hit['"]\s*:\s*['"]miss['"]/, 'runtime evidence must distinguish live image cache hits from misses');
assert.match(runtime, /executedRouteReceipts/, 'runtime evidence must identify routes executed in the current invocation');
assert.match(runtime, /reusedRouteReceipts/, 'runtime evidence must identify cached image-stage provenance separately');
assert.match(runtime, /compositionRequestIds:\s*executedRouteResults[\s\S]*\.map\(routeResult\s*=>\s*routeResult\.requestId\)/, 'current invocation request identity must exclude reused image-stage request ids');
assert.match(runtime, /visualOutput\s*=\s*\{[\s\S]*imageCache:\s*result\.imageCache/, 'operator-visible output must carry the effective image-cache route');
assert.match(runtime, /\.\.\.\(verificationAttached\s*\?\s*\{\s*expectedLayerCheckpoints:\s*expectedVitLayerCheckpoints\s*\}\s*:\s*\{\s*\}\)/, 'detached ViT execution must omit the expected-checkpoint contract rather than pass an empty list');
assert.match(runtime, /const parity\s*=\s*verificationAttached\s*\?\s*\{/, 'detached execution must not construct final reference parity from absent expected tensors');
assert.match(runtime, /loadDetrStackPayload\(manifest,\s*\{[\s\S]*verificationAttached[\s\S]*servingResources/, 'full SAM runner must receive serving authority explicitly');
assert.match(runtime, /if \(verificationAttached\) \{[\s\S]*oracle packet self-check failed/, 'CPU oracle self-check must be unreachable in detached serving mode');
const residentAcquireIndex = runtime.indexOf('servingResources.modelSession(');
for (const validationMarker of [
  'if (!SUPPORTED_ROUTE_IDS.has(manifest.routeId))',
  "if (manifest.claims?.fullSam3BrowserExecution !== false)",
  "if (!manifest.staticWeights?.sha256",
]) {
  assert.ok(runtime.indexOf(validationMarker) >= 0 && runtime.indexOf(validationMarker) < residentAcquireIndex, `${validationMarker} must reject before multi-gigabyte resident acquisition`);
}

for (const file of [
  'sam-image-patch-embed-phase-program.js',
  'sam-image-vit-prefix-phase-program.js',
  'sam-image-vit-first-block-phase-program.js',
  'sam-image-vit-block-stack-phase-program.js',
  'sam-image-fpn-neck-phase-program.js',
  'sam-prompt-text-ingress-phase-program.js',
  'sam-detr-encoder-phase-program.js',
  'sam-prompt-fpn-phase-program.js',
  'sam-pixel-decoder-phase-program.js',
  'sam-detr-decoder-phase-program.js',
  'sam-scoring-phase-program.js',
  'sam-mask-tail-phase-program.js',
]) {
  const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
  assert.match(source, /residentTensorResolver:\s*input\.residentTensorResolver/, `${file} must compose the shared resident tensor resolver`);
}

console.log('sam browser serving runtime contracts passed');
