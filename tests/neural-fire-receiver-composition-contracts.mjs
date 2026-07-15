import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const core = await readFile(new URL('../volume-core.js', import.meta.url), 'utf8');
const page = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const witness = await readFile(new URL('../volume-witness.mjs', import.meta.url), 'utf8');

await assert.doesNotReject(
  access(new URL('../lib/foreground-kiln-heartbeat.mjs', import.meta.url)),
  'the recovered page must not import a missing foreground-kiln heartbeat module and stall before volume initialization',
);

assert.match(
  core,
  /NATIVE_SPLAT_RECEIVER_ATTACHMENTS_IDENTITY\s*=\s*'gpu-splat-radiance-coverage-depth-moments-v0'/,
  'volume producer names the native receiver attachment ABI',
);
assert.match(
  core,
  /export function resolveBoundarySplatReceiverAttachmentAuthority/,
  'native receiver attachment authority is decided by a deterministic exported contract',
);

const {
  resolveBoundarySplatReceiverAttachmentAuthority,
  resolveNativeSplatReceiverPipelineDisposition,
} = await import('../volume-core.js');

const nativePipelineControls = {
  boundarySplatMode: 'learned',
  boundarySplatComposition: 'splat-only',
  nativeSplatReceiverAttachments: true,
};
assert.equal(
  resolveNativeSplatReceiverPipelineDisposition(nativePipelineControls),
  'skip-ordinary-pipelines-native-splat-receiver',
  'native splat-only receiver composition has an explicit pipeline disposition',
);
assert.equal(
  resolveNativeSplatReceiverPipelineDisposition({
    ...nativePipelineControls,
    boundarySplatComposition: 'hybrid-smoke',
  }),
  'ordinary-render-pipelines-required',
  'a live transition to hybrid smoke requires the pipeline family omitted by native startup',
);
assert.equal(
  resolveNativeSplatReceiverPipelineDisposition({
    ...nativePipelineControls,
    boundarySplatMode: 'off',
  }),
  'ordinary-render-pipelines-required',
  'turning boundary splats off requires an ordinary raymarch pipeline',
);

const validSnapshot = {
  producerActive: true,
  attachmentsEffective: true,
  attachmentFallbackReason: null,
  producedAtMs: 1_200,
  nowMs: 1_240,
  freshnessHorizonMs: 500,
  compositionEffective: 'splat-only',
  splatLayerIdentity: 'premultiplied-hdr-splat-radiance-alpha-linear-depth-moments-v0',
  smokeLayerIdentity: null,
  textureExtentCurrent: true,
  radianceTexturePresent: true,
  momentsTexturePresent: true,
  sameDevice: true,
  descriptorIdentity: 'boundary-splat-instance-descriptor-v0',
  descriptors: [
    { phaseSourceIdentity: 'shared-current-control', historyAllocationGeneration: 7 },
    { phaseSourceIdentity: 'live-history-offset', historyAllocationGeneration: 7 },
  ],
  rendererIdentity: 'neural-boundary-splat-renderer-v0',
  attributeModelIdentity: 'learned-boundary-splat-attributes-v0',
  sourceAuthority: 'combustion-front-topology-sidecar-v0',
  selectorPolicyIdentity: 'boundary-splat-selector-policy-v0',
  historyRingIdentity: 'boundary-splat-live-history-ring-v0',
  historyAllocationIdentity: 'boundary-splat-history-allocation-v0',
  historyAllocationGeneration: 7,
  frameCount: 41,
};

const accepted = resolveBoundarySplatReceiverAttachmentAuthority(validSnapshot);
assert.equal(accepted.status, 'effective');
assert.equal(accepted.identity, 'gpu-splat-radiance-coverage-depth-moments-v0');
assert.equal(accepted.phaseSourceIdentity, 'shared-current-plus-live-history-offset');
assert.equal(accepted.historyBackedInstanceCount, 1);
assert.equal(accepted.historyAllocationGeneration, 7);
assert.equal(accepted.fallbackAuthority, false);
assert.equal(accepted.cpuReadbackAuthority, false);
assert.equal(accepted.canvasAuthority, false);

assert.deepEqual(
  resolveBoundarySplatReceiverAttachmentAuthority({
    ...validSnapshot,
    producerActive: false,
  }).reason,
  'native-attachment-producer-inactive',
  'a stopped producer must invalidate its last GPU attachment handles immediately',
);
assert.deepEqual(
  resolveBoundarySplatReceiverAttachmentAuthority({
    ...validSnapshot,
    attachmentsEffective: false,
    attachmentFallbackReason: 'native-attachment-producer-render-error',
  }).reason,
  'native-attachment-producer-render-error',
  'the authority resolver must preserve a producer-side invalidation reason instead of resurrecting old textures',
);
assert.deepEqual(
  resolveBoundarySplatReceiverAttachmentAuthority({
    ...validSnapshot,
    producedAtMs: 1_200,
    nowMs: 1_701,
  }).reason,
  'native-attachment-producer-stale',
  'an active producer whose attachment cadence has stopped must fail closed after its declared freshness horizon',
);

assert.deepEqual(
  resolveBoundarySplatReceiverAttachmentAuthority({
    ...validSnapshot,
    radianceTexturePresent: false,
  }).reason,
  'native-radiance-attachment-unavailable',
  'missing native radiance must fail loud instead of substituting a scalar envelope',
);
assert.deepEqual(
  resolveBoundarySplatReceiverAttachmentAuthority({
    ...validSnapshot,
    sameDevice: false,
  }).reason,
  'producer-consumer-device-mismatch',
  'cross-device GPU handles are rejected before Three samples them',
);
assert.deepEqual(
  resolveBoundarySplatReceiverAttachmentAuthority({
    ...validSnapshot,
    compositionEffective: 'raymarch-fallback',
  }).reason,
  'native-splat-attachment-composition-not-effective',
  'a fallback composition cannot advertise learned splat moments',
);

assert.equal(
  resolveBoundarySplatReceiverAttachmentAuthority({
    ...validSnapshot,
    compositionEffective: 'hybrid-smoke',
    smokeLayerIdentity: 'raymarched-smoke-front-back-radiance-transmittance-linear-depth-intervals-v1',
  }).status,
  'effective',
  'the existing hybrid-smoke route remains a valid producer of the same native splat attachment ABI',
);
const acceptedSingleHero = resolveBoundarySplatReceiverAttachmentAuthority({
  ...validSnapshot,
  descriptors: [{ phaseSourceIdentity: 'shared-current-control', historyAllocationGeneration: 7 }],
});
assert.equal(
  acceptedSingleHero.status,
  'effective',
  'one live hero descriptor exports its current-frame GPU attachments without pretending history is effective',
);
assert.equal(acceptedSingleHero.phaseSourceIdentity, 'shared-current-control');
assert.equal(acceptedSingleHero.historyBackedInstanceCount, 0);

assert.match(
  witness,
  /function expectedReceiverAttachmentPhaseSourceIdentity\(instanceCount\)/,
  'receiver-light evidence must derive its expected attachment phase from the requested instance count',
);
assert.match(
  witness,
  /Number\(instanceCount \|\| 0\) > 1[\s\S]*'shared-current-plus-live-history-offset'[\s\S]*'shared-current-control'/,
  'one hero instance accepts current-frame authority while a multi-instance sweep requires live history',
);
assert.equal(
  (witness.match(/attachmentPhaseSourceIdentity === expectedReceiverAttachmentPhaseSource/g) || []).length,
  2,
  'both the primary evidence path and durable failure report must enforce the same route-aware phase identity',
);
assert.match(
  witness,
  /receiverLightEvidence:\s*\{[\s\S]*\.\.\.receiverLightEvidence,[\s\S]*debugAtCapture:\s*refreshedReceiverLightEval\.result\.value/,
  'the final screenshot receipt must preserve the cadence baseline and record later capture state separately',
);
assert.doesNotMatch(
  witness,
  /receiverLightEvidence:\s*\{[\s\S]*\.\.\.receiverLightEvidence,[\s\S]*debug:\s*refreshedReceiverLightEval\.result\.value/,
  'the final screenshot receipt must not overwrite the cadence baseline with a newer frame count',
);

assert.deepEqual(
  resolveBoundarySplatReceiverAttachmentAuthority({
    ...validSnapshot,
    descriptors: [{ phaseSourceIdentity: 'live-history-offset', historyAllocationGeneration: 7 }],
  }).reason,
  'current-live-instance-selection-required',
  'a history-only stream cannot masquerade as the current live hero flame',
);
assert.deepEqual(
  resolveBoundarySplatReceiverAttachmentAuthority({
    ...validSnapshot,
    descriptors: [
      { phaseSourceIdentity: 'shared-current-control', historyAllocationGeneration: 7 },
      { phaseSourceIdentity: 'live-history-offset', historyAllocationGeneration: 6 },
    ],
  }).reason,
  'history-allocation-generation-mismatch',
  'a mixed-generation age sweep cannot advertise coherent native receiver attachments',
);

assert.match(
  core,
  /receiverLightAttachments\(\)/,
  'volume runtime exposes the gated native attachment socket to the receiver',
);
assert.match(
  core,
  /function boundarySplatNativeReceiverAttachmentsRequested\(\)/,
  'volume producer has an explicit route gate for native splat receiver attachments',
);
assert.match(
  core,
  /function ensureNativeSplatReceiverTextures\(\)/,
  'native splat radiance and moment textures allocate independently of hybrid smoke layers',
);
assert.match(
  core,
  /function encodeBoundarySplatReceiverAttachments\(encoder\)/,
  'splat-only rendering exports the selected learned flame into native receiver attachments',
);
assert.match(
  core,
  /function invalidateNativeSplatReceiverAttachments\(reason\)/,
  'the producer has one explicit invalidation path for stop, route failure, and render failure',
);
assert.match(
  core,
  /setActive\(active\)[\s\S]*invalidateNativeSplatReceiverAttachments\('native-attachment-producer-inactive'\)/,
  'stopping the volume invalidates native attachment authority before a receiver can sample the old textures',
);
assert.match(
  page,
  /attachments\?\.producerActive === true[\s\S]*attachmentFreshnessAgeMs[\s\S]*native-attachment-producer-stale/,
  'the receiver independently rejects inactive or stale producer snapshots instead of trusting producer status alone',
);

const renderPipelineConfigurationSource = core.slice(
  core.indexOf('function configureRenderPipelinesForCurrentRoute'),
  core.indexOf('function rebuildFluidState'),
);
assert.match(
  renderPipelineConfigurationSource,
  /const nativeSplatReceiverRoute = boundarySplatNativeReceiverAttachmentsRequested\(\)/,
  'pipeline construction records whether the current route is a native splat receiver route',
);
assert.match(
  renderPipelineConfigurationSource,
  /if \(!nativeSplatReceiverRoute\)\s*\{[\s\S]*native-3d-compute-fluid-raymarch-v0/,
  'the monolithic volume raymarch pipeline is not instantiated on the native splat receiver route',
);

const fluidRebuildSource = core.slice(
  core.indexOf('function rebuildFluidState'),
  core.indexOf('async function ensureGpu'),
);
assert.match(
  fluidRebuildSource,
  /configureRenderPipelinesForCurrentRoute\(reason\)/,
  'full fluid rebuilds delegate render-pipeline route selection to the live route configurator',
);

const renderLoopSource = core.slice(
  core.indexOf('function render(now)'),
  core.indexOf('function pumpLookLabFrozenFrame'),
);
assert.match(
  renderLoopSource,
  /encodeBoundarySplatReceiverAttachments\(encoder\)/,
  'the live splat-only frame records native receiver attachments on the same encoder submission',
);
assert.match(
  renderLoopSource,
  /native-splat-receiver-route-has-no-raymarch-fallback/,
  'a failed native splat receiver frame fails loud instead of invoking the omitted raymarch pipeline',
);
assert.match(
  page,
  /volumePrototype\?\.receiverLightAttachments\?\.\(\)/,
  'Tier 2 receiver requests the live producer socket rather than reconstructing it from debug scalars',
);
assert.match(
  page,
  /sourceTexture\s*=\s*attachments\.radianceTexture/,
  'Three samples the producer-owned radiance GPUTexture directly',
);
assert.match(
  page,
  /sourceTexture\s*=\s*attachments\.momentsTexture/,
  'Three samples the producer-owned moments GPUTexture directly',
);

const receiverPassSource = page.slice(
  page.indexOf('function createTier2ReceiverBufferLightPass'),
  page.indexOf('async function initKaminosVolumeRoute'),
);
assert.doesNotMatch(receiverPassSource, /CanvasTexture|createElement\('canvas'\)|getContext\('2d'\)/, 'native receiver pass has no canvas envelope path');
assert.doesNotMatch(receiverPassSource, /lastFrameEnergy|candidateEnergy|Math\.sin\(phase/, 'native receiver pass has no scalar or sinusoidal light-authority path');
assert.doesNotMatch(receiverPassSource, /cpuReadbackAuthority:\s*true|canvasBridgeAuthority:\s*true/, 'native receiver pass never promotes CPU or canvas fallback authority');
assert.match(
  receiverPassSource,
  /bindBlackAttachments\('receiver-light-pass-disposed'\)[\s\S]*radianceExternalTexture\.dispose\(\)[\s\S]*momentsExternalTexture\.dispose\(\)/,
  'receiver teardown rebinds external wrappers to receiver-owned placeholders before releasing Three renderer state',
);
assert.doesNotMatch(
  receiverPassSource,
  /attachments\.(?:radianceTexture|momentsTexture)\.destroy\(\)/,
  'receiver teardown never destroys producer-owned native attachments',
);

assert.match(
  page,
  /new THREE\.WebGPURenderer\(\{\s*antialias:\s*true,\s*device:\s*sharedGpu\.device\s*\}\)/,
  'Three renderer is initialized on the same explicit WebGPU device as the volume producer',
);
assert.match(
  page,
  /createKaminosVolumePrototype\(\{[\s\S]*gpuDevice:\s*sharedGpu\.device/,
  'volume producer receives the same explicit WebGPU device as Three',
);
assert.match(
  page,
  /nativeSplatReceiverAttachments:\s*isTier2ReceiverLightRoute\(\)/,
  'native splat receiver attachments use the established explicit Tier 2 route predicate',
);
assert.doesNotMatch(
  page,
  /volumeReceiverLightRouteRequested/,
  'the control handoff cannot call an undefined receiver-route predicate',
);

const volumeControlLifecycleSource = core.slice(
  core.indexOf('setControls(next)'),
  core.indexOf('setExternalEmitters(payload'),
);
assert.doesNotMatch(
  volumeControlLifecycleSource,
  /if \(device[^)]*\)[\s\S]{0,180}rebuildFluidState/,
  'a shared GPUDevice alone does not authorize control-driven fluid rebuilds before pipeline initialization',
);
assert.match(
  volumeControlLifecycleSource,
  /gpuInitialized[\s\S]{0,180}rebuildFluidState/,
  'control-driven fluid rebuilds wait for initialized bind-group layouts and pipelines',
);
assert.match(
  volumeControlLifecycleSource,
  /previousPipelineDisposition[\s\S]*nextPipelineDisposition[\s\S]*gpuInitialized[\s\S]*configureRenderPipelinesForCurrentRoute\('control-route-transition'\)/,
  'live native-to-ordinary route changes reconfigure omitted render pipelines without requiring a grid change',
);
assert.match(
  core,
  /function encodeDraw\([^)]*\)[\s\S]{0,220}if \(!targetPipeline\) throw new Error\('volume-render-pipeline-unavailable-for-effective-route'\)/,
  'ordinary rendering fails explicitly before attempting a null WebGPU pipeline bind',
);

const primitiveLifecycleSource = core.slice(
  core.indexOf('setVolumePrimitives(next)'),
  core.indexOf('setExternalEmitters(payload'),
);
assert.doesNotMatch(
  primitiveLifecycleSource,
  /if \(device\) rebuildFluidState/,
  'a preinstalled shared GPUDevice cannot trigger a primitive rebuild before pipeline initialization',
);
assert.match(
  primitiveLifecycleSource,
  /if \(gpuInitialized\) rebuildFluidState/,
  'primitive changes rebuild fluid state only after GPU pipeline initialization',
);

console.log('neural fire receiver composition contracts passed');
