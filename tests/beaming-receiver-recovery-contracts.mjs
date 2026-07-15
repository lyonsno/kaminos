import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const core = await readFile(new URL('../volume-core.js', import.meta.url), 'utf8');
const witness = await readFile(new URL('../volume-witness.mjs', import.meta.url), 'utf8');

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
  [/TIER2_RECEIVER_DYNAMIC_ENVELOPE_IDENTITY\s*=\s*'tier2-live-debug-receiver-envelope-v1'/, 'dynamic envelope has stable identity'],
  [/TIER2_RECEIVER_DYNAMIC_ENVELOPE_SOURCE\s*=\s*'volume-debug-frame-energy-procedural-envelope-no-readback-v1'/, 'procedural envelope names its authority'],
  [/TIER2_RECEIVER_SPLAT_MOMENT_ENVELOPE_SOURCE\s*=\s*'gpu-splat-radiance-coverage-depth-moments-v0'/, 'splat-moment envelope names its authority'],
  [/requestedEnvelopeSource:\s*requestedReceiverEnvelopeSource/, 'debug state preserves requested envelope source'],
  [/effectiveEnvelopeSource:\s*effectiveReceiverEnvelopeSource/, 'debug state preserves effective envelope source'],
  [/dynamicEnvelopeSource:\s*'pending-envelope-source-resolution'/, 'debug state starts unresolved'],
  [/state\.dynamicEnvelopeSource\s*=\s*effectiveReceiverEnvelopeSource/, 'debug state records effective resolution'],
  [/splatMomentEnvelopeAccepted/, 'debug state reports splat-moment acceptance'],
  [/createTier2ReceiverBufferLightPass/, 'renderer builds a separate receiver light pass'],
  [/receiverMaskRenderTarget/, 'renderer owns an explicit receiver mask target'],
  [/volume_receiver_light/, 'route can opt into receiver lighting'],
  [/volume_receiver_light_isolate/, 'route can isolate receiver-light evidence'],
  [/window\.kaminosTier2ReceiverLightDebugState/, 'light-pass state is exposed to witnesses'],
  [/supportIdentity:\s*TIER2_RECEIVER_SUPPORT_IDENTITY/, 'debug state preserves support identity'],
  [/supportAuthority:\s*TIER2_RECEIVER_SUPPORT_AUTHORITY/, 'debug state preserves support authority'],
  [/receiverBufferSource:\s*TIER2_RECEIVER_BUFFER_SOURCE/, 'light pass starts from an explicit receiver buffer'],
  [/dynamicEnvelopeIdentity:\s*TIER2_RECEIVER_DYNAMIC_ENVELOPE_IDENTITY/, 'debug state preserves envelope identity'],
  [/receiverLightMaskTexture\.needsUpdate\s*=\s*true/, 'receiver envelope refreshes'],
  [/cpuReadbackAuthority:\s*false/, 'CPU readback is not lighting authority'],
  [/hiddenThreeLightAuthority:\s*false/, 'hidden Three lights are not lighting authority'],
  [/canvasBridgeAuthority:\s*false/, 'the stale canvas bridge is not lighting authority'],
  [/tier2ReceiverLightActive[\s\S]*mainRendererNeeded/, 'active receiver lighting forces a main-renderer draw'],
]);

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
  [/dynamicEnvelopeAccepted/, 'reports preserve envelope liveness'],
  [/stale receiver-light envelope/, 'stale envelopes fail loud'],
  [/receiver-light rendered evidence overexposed/, 'overexposed evidence fails loud'],
  [/receiverLightDebug\.identity !== 'tier2-opt-in-receiver-buffer-light-pass-v0'/, 'wrong light-pass identity fails loud'],
  [/requestedEnvelopeSource !== 'gpu-splat-radiance-coverage-depth-moments-v0'/, 'wrong requested envelope fails loud'],
  [/effectiveEnvelopeSource !== 'gpu-splat-radiance-coverage-depth-moments-v0'/, 'fallback envelope fails loud'],
  [/receiver-light-rendered-evidence[\s\S]*Page\.captureScreenshot[\s\S]*receiverLightEvidence[\s\S]*return;/, 'visual evidence is written before unrelated legacy gates'],
  [/!expectsNoFireVolumeEvidence\s*&&\s*!expectsReceiverSupportEvidence\s*&&\s*!expectsReceiverLightIsolateEvidence\s*&&\s*!expectsReceiverLightBrickWallEvidence[\s\S]*fireLayerMean/, 'receiver modes bypass legacy fire-layer beauty gates'],
  [/!expectsFuelStarvedTallPlume\s*&&\s*!expectsNoFireVolumeEvidence\s*&&\s*!expectsReceiverSupportEvidence\s*&&\s*!expectsReceiverLightIsolateEvidence\s*&&\s*!expectsReceiverLightBrickWallEvidence[\s\S]*radianceMean/, 'receiver modes bypass legacy radiance beauty gates'],
  [/else if \(!expectsReceiverSupportEvidence && !expectsReceiverLightIsolateEvidence && !expectsReceiverLightBrickWallEvidence && \([\s\S]*fireFuelOverlapRatio <= 0\.01[\s\S]*\)\) \{/, 'receiver modes bypass the legacy overlap threshold'],
]);

console.log('beaming receiver recovery contracts passed');
