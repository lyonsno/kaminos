import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const core = await readFile(new URL('../volume-core.js', import.meta.url), 'utf8');
const witness = await readFile(new URL('../volume-witness.mjs', import.meta.url), 'utf8');
const receiverMetrics = await readFile(new URL('../receiver-light-witness-metrics.mjs', import.meta.url), 'utf8');

function requirePatterns(source, surface, patterns) {
  for (const [pattern, contract] of patterns) {
    assert.match(source, pattern, `${surface}: ${contract}`);
  }
}

requirePatterns(index, 'route', [
  [/volume_scene_context/, 'scene context is URL-routable'],
  [/createVolumeSceneContextRouter/, 'scene context uses an explicit router'],
  [/createVolumeBrickWallContext/, 'brick-wall context has a named constructor'],
  [/volume-scene-context-brick-wall-v0/, 'brick-wall context has stable identity'],
  [/kaminos-trellis-crumbled-brick-wall-fast8-350k-4k-20260701Tasset-probe/, 'brick-wall asset identity is preserved'],
  [/greenroom-glb-three-meshes-not-image-plate-v0/, 'brick-wall source is GLB geometry'],
  [/BRICK_WALL_VOLUME_CAMERA_FRAME/, 'brick-wall context has a dedicated camera'],
  [/resolveVolumeCameraFrame/, 'camera framing resolves scene context'],
  [/activeContext\s*===\s*'brick_wall'[\s\S]*BRICK_WALL_VOLUME_CAMERA_FRAME/, 'brick-wall context selects its camera'],
  [/servedUrlCandidates/, 'asset routing exposes explicit candidates'],
  [/local-assets\/greenroom\/kaminos-trellis-crumbled-brick-wall-fast8-350k-4k-20260701Tasset-probe\/output\.glb/, 'asset routing includes the local static route'],
  [/apiReadUrl/, 'asset routing preserves the API fallback'],
  [/assetEffectiveServedUrl/, 'asset routing reports the effective URL'],
  [/assetFailedServedUrls/, 'asset routing reports failed candidates'],
  [/window\.__kaminosVolumeSceneContext/, 'scene context is exposed to witnesses'],
]);

requirePatterns(core, 'receiver support', [
  [/COMBUSTION_FRONT_RECEIVER_SUPPORT_IDENTITY\s*=\s*'combustion-front-receiver-support-v0'/, 'support has stable identity'],
  [/COMBUSTION_FRONT_RECEIVER_SUPPORT_AUTHORITY\s*=\s*'combustion-front-topology-sidecar-v0\+reaction-front-stage-fields-v0'/, 'support names its source authority'],
  [/COMBUSTION_FRONT_RECEIVER_SUPPORT_CONSUMER\s*=\s*'tier2-opt-in-receiver-buffer-light-pass-v0'/, 'support names its consumer'],
  [/supportRole:\s*'lighting-input-not-rendered-receiver-light'/, 'support cannot masquerade as rendered light'],
  [/receiverMaskAuthority:\s*'opt-in-receiver-buffer-required-v0'/, 'support requires an opted-in receiver mask'],
  [/const receiverSupport = buildCombustionFrontReceiverSupport/, 'readback builds support from live metrics'],
  [/reactionFrontAtlas,\s*\n\s*receiverSupport,/, 'readback carries support beside the atlas'],
]);

requirePatterns(index, 'receiver light', [
  [/TIER2_RECEIVER_LIGHT_PASS_IDENTITY\s*=\s*'tier2-opt-in-receiver-buffer-light-pass-v0'/, 'light pass has stable identity'],
  [/TIER2_RECEIVER_MASK_AUTHORITY\s*=\s*'opt-in-receiver-buffer-required-v0'/, 'light pass preserves mask authority'],
  [/TIER2_RECEIVER_SPLAT_MOMENT_ENVELOPE_SOURCE\s*=\s*'gpu-splat-radiance-coverage-depth-moments-v0'/, 'native splat attachment ABI names its authority'],
  [/attachmentAuthority:\s*'native-shared-device-gpu-texture-only-v0'/, 'debug state names native shared-device texture authority'],
  [/effectiveAttachmentIdentity:\s*null/, 'debug state starts unavailable instead of advertising fallback light'],
  [/volumePrototype\?\.receiverLightAttachments\?\.\(\)/, 'receiver requests producer-owned native attachments'],
  [/attachments\.device\s*===\s*sharedGpu\.device/, 'receiver rejects a different WebGPU device'],
  [/sourceTexture\s*=\s*attachments\.radianceTexture/, 'receiver binds the producer radiance texture directly'],
  [/sourceTexture\s*=\s*attachments\.momentsTexture/, 'receiver binds the producer moments texture directly'],
  [/createTier2ReceiverBufferLightPass/, 'renderer builds a separate receiver light pass'],
  [/createTier2ReceiverBufferLightPass\(baseOutputNode, sceneDepthNode\)/, 'receiver pass consumes the rendered scene prepass depth'],
  [/scene-prepass-depth-dynamic-receiver-mask-v0/, 'dynamic rendered geometry has stable receiver-mask authority'],
  [/sceneGeometryReceiverMaskNode/, 'light is restricted to scene geometry instead of proxy planes'],
  [/receiverRadianceLowResTarget/, 'renderer downsamples live fire radiance before spreading it'],
  [/receiverRadianceBlurHorizontalTarget/, 'renderer owns a horizontal low-resolution radiance blur target'],
  [/receiverRadianceBlurVerticalTarget/, 'renderer owns a vertical low-resolution radiance blur target'],
  [/receiver-radiance-iterative-separable-low-resolution-area-wash-v1/, 'the continuous GPU area-wash strategy has a stable identity'],
  [/new THREE\.QuadMesh/, 'the live GPU attachment is filtered without CPU readback'],
  [/volume_receiver_light/, 'route can opt into receiver lighting'],
  [/volume_receiver_light_isolate/, 'route can isolate receiver-light evidence'],
  [/window\.kaminosTier2ReceiverLightDebugState/, 'light-pass state is exposed to witnesses'],
  [/window\.kaminosTier2ReceiverLightSetWitnessForegroundMute/, 'witnesses can hide foreground fire without hiding receiver illumination'],
  [/supportIdentity:\s*TIER2_RECEIVER_SUPPORT_IDENTITY/, 'debug state preserves support identity'],
  [/supportAuthority:\s*TIER2_RECEIVER_SUPPORT_AUTHORITY/, 'debug state preserves support authority'],
  [/receiverBufferSource:\s*TIER2_RECEIVER_BUFFER_SOURCE/, 'light pass starts from an explicit receiver buffer'],
  [/state\.attachmentGeneration\s*=\s*attachments\.textureGeneration/, 'debug state preserves native texture generation'],
  [/state\.attachmentFrameCount\s*=\s*attachments\.frameCount/, 'debug state preserves live native attachment cadence'],
  [/cpuReadbackAuthority:\s*false/, 'CPU readback is not lighting authority'],
  [/hiddenThreeLightAuthority:\s*false/, 'hidden Three lights are not lighting authority'],
  [/canvasBridgeAuthority:\s*false/, 'the stale canvas bridge is not lighting authority'],
  [/tier2ReceiverLightActive[\s\S]*mainRendererNeeded/, 'active receiver lighting forces a main-renderer draw'],
]);

const receiverPassSource = index.slice(
  index.indexOf('function createTier2ReceiverBufferLightPass'),
  index.indexOf('async function initKaminosVolumeRoute'),
);
assert.doesNotMatch(receiverPassSource, /receiverProxies|tier2-receiver-proxy-/, 'proxy planes must not masquerade as scene receivers');
const receiverBlurKernelSource = receiverPassSource.match(/const blurKernel = \[([\s\S]*?)\n\s*\];/)?.[1] || '';
const receiverBlurOffsets = [...receiverBlurKernelSource.matchAll(/\[\s*([0-9]+(?:\.[0-9]+)?),/g)]
  .map(match => Number(match[1]));
assert.ok(receiverBlurOffsets.length >= 5, 'receiver area wash must declare a compact integration kernel');
assert.ok(
  Math.max(...receiverBlurOffsets) <= 8,
  `receiver area wash cannot expose sparse translated source copies; largest tap was ${Math.max(...receiverBlurOffsets)}`,
);
assert.match(
  receiverPassSource,
  /const receiverAreaWashBlurRounds = [4-9];/,
  'receiver area wash must accumulate compact taps across bounded iterative rounds',
);
assert.match(
  receiverPassSource,
  /for \(let blurRound = 1; blurRound < receiverAreaWashBlurRounds; blurRound \+= 1\)/,
  'receiver area wash must spread energy through repeated integration instead of distant one-shot taps',
);

requirePatterns(witness, 'witness', [
  [/receiverSupport\.identity !== 'combustion-front-receiver-support-v0'/, 'wrong support identity fails loud'],
  [/receiverSupport\.supportRole !== 'lighting-input-not-rendered-receiver-light'/, 'support and rendered light remain distinct'],
  [/receiverSupport:\s*sample\.simReadback\?\.receiverSupport \?\? null/, 'reports preserve support receipts'],
  [/reactionFrontAtlas[\s\S]*rgbaLength[\s\S]*rgbaOmitted/, 'reports preserve atlas metadata without inline RGBA'],
  [/receiver-support/, 'support evidence mode is accepted'],
  [/receiver-support-sim-readback/, 'support mode names sim-readback authority'],
  [/expectsReceiverSupportEvidence/, 'support gates are distinct from fire beauty'],
  [/receiverSupportEvidence/, 'reports preserve support evidence'],
  [/receiver-light-isolate/, 'isolate evidence mode is accepted'],
  [/tier2-receiver-light-isolate/, 'isolate visual identity is stable'],
  [/receiver-light-brick-wall/, 'brick-wall evidence mode is accepted'],
  [/tier2-receiver-light-brick-wall/, 'brick-wall visual identity is stable'],
  [/expectsReceiverLightBrickWallEvidence/, 'brick-wall gates are distinct'],
  [/__kaminosVolumeSceneContext/, 'witness reads scene-context state'],
  [/volume-scene-context-brick-wall-v0/, 'witness verifies context identity'],
  [/trellis-fast8-350k-4k-brick-wall-glb-v0/, 'witness verifies asset identity'],
  [/brick-wall-greenroom-local-static-mount-v0/, 'witness records the static mount'],
  [/assetEffectiveServedUrl === BRICK_WALL_STATIC_ROUTE_URL/, 'witness requires the effective static GLB route'],
  [/sceneContextCssComposite !== true/, 'witness requires CSS composition'],
  [/nativeCanvasMixBlendMode !== 'screen'/, 'witness requires the screen blend mode'],
  [/kaminosTier2ReceiverLightDebugState/, 'witness reads receiver-light state'],
  [/receiverLightEvidence/, 'reports preserve receiver-light evidence'],
  [/nativeAttachmentAccepted/, 'reports preserve native attachment liveness'],
  [/stale native receiver-light attachments/, 'stale native attachments fail loud'],
  [/for \(let cadenceProbe = 0; cadenceProbe < 20; cadenceProbe \+= 1\)/, 'native attachment cadence is polled across contested frames instead of sampled after one brittle sleep'],
  [/for \(let cadenceProbe = 0; cadenceProbe < 20; cadenceProbe \+= 1\)[\s\S]{0,500}Page\.captureScreenshot/, 'each headless cadence probe requests a compositor frame so the witness cannot stall its own producer'],
  [/attachmentFrameCount[\s\S]{0,500}break/, 'cadence polling exits only after the attachment frame advances'],
  [/receiver-light attachment cadence did not advance within 5s/, 'cadence timeout names the actual evidence horizon'],
  [/receiver-light rendered evidence overexposed/, 'overexposed evidence fails loud'],
  [/kaminosTier2ReceiverLightSetWitnessMute/, 'the witness can mute only the receiver contribution without changing scene composition'],
  [/kaminosTier2ReceiverLightSetWitnessForegroundMute\?\.\(true\)/, 'paired receiver proof hides the temporally changing foreground flame'],
  [/finally\s*\{[\s\S]*kaminosTier2ReceiverLightSetWitnessForegroundMute\?\.\(false\)/, 'paired receiver proof restores foreground fire even when capture fails'],
  [/foregroundMutedAtCapture/, 'paired evidence records that foreground fire could not supply the measured delta'],
  [/finally\s*\{[\s\S]*kaminosTier2ReceiverLightSetWitnessMute\?\.\(false\)/, 'mute-only diagnostics restore receiver output even when capture fails'],
  [/receiverLightDeltaEvidence/, 'reports preserve receiver-region delta evidence'],
  [/receiver-light paired delta missing warm receiver signal/, 'a nonblank flame or scene cannot substitute for positive receiver-light delta'],
  [/receiverLightDebug\.identity !== 'tier2-opt-in-receiver-buffer-light-pass-v0'/, 'wrong light-pass identity fails loud'],
  [/attachmentIdentity !== 'gpu-splat-radiance-coverage-depth-moments-v0'/, 'wrong requested native attachment fails loud'],
  [/effectiveAttachmentIdentity !== 'gpu-splat-radiance-coverage-depth-moments-v0'/, 'missing effective native attachment fails loud'],
  [/attachmentAuthority !== 'native-shared-device-gpu-texture-only-v0'/, 'fallback attachment authority fails loud'],
  [/receiver-light-rendered-evidence[\s\S]*Page\.captureScreenshot[\s\S]*receiverLightEvidence[\s\S]*return;/, 'visual evidence is written before unrelated legacy gates'],
  [/!expectsNoFireVolumeEvidence\s*&&\s*!expectsReceiverSupportEvidence\s*&&\s*!expectsReceiverLightIsolateEvidence\s*&&\s*!expectsReceiverLightBrickWallEvidence[\s\S]*fireLayerMean/, 'receiver modes bypass legacy fire-layer beauty gates'],
  [/!expectsFuelStarvedTallPlume\s*&&\s*!expectsNoFireVolumeEvidence\s*&&\s*!expectsReceiverSupportEvidence\s*&&\s*!expectsReceiverLightIsolateEvidence\s*&&\s*!expectsReceiverLightBrickWallEvidence[\s\S]*radianceMean/, 'receiver modes bypass legacy radiance beauty gates'],
  [/else if \(!expectsReceiverSupportEvidence && !expectsReceiverLightIsolateEvidence && !expectsReceiverLightBrickWallEvidence && \([\s\S]*fireFuelOverlapRatio <= 0\.01[\s\S]*\)\) \{/, 'receiver modes bypass the legacy overlap threshold'],
]);

requirePatterns(receiverMetrics, 'receiver delta metrics', [
  [/receiver-light-paired-delta-v0/, 'brick-wall evidence carries a paired light-on/light-muted delta identity'],
  [/warmPositivePixels/, 'paired metrics distinguish warm receiver gain from arbitrary frame change'],
  [/matching dimensions and channels/, 'mismatched paired captures fail loud'],
]);

console.log('beaming receiver recovery contracts passed');
