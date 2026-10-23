import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const index = readFileSync(join(root, 'index.html'), 'utf8');
const volumeWitness = readFileSync(join(root, 'volume-witness.mjs'), 'utf8');
const serve = readFileSync(join(root, 'serve.py'), 'utf8');
const reactionFrontAtlasWitnessPath = join(root, 'volume-reaction-front-atlas-witness.mjs');
assert.ok(existsSync(reactionFrontAtlasWitnessPath), 'reaction-front atlas witness exists');
const reactionFrontAtlasWitness = readFileSync(reactionFrontAtlasWitnessPath, 'utf8');
const sceneOntologyPath = join(root, 'volume-scene-ontology.mjs');
const basinSmokePagePath = join(root, 'volume-basin-smoke.html');
const settingsPresetPagePath = join(root, 'volume-settings-preset.html');
const settingsPresetWitnessPath = join(root, 'volume-settings-preset-witness.mjs');
const settingsPresetContractPath = join(root, 'volume-settings-preset-contract.mjs');
const settingsPresetSchemaPath = join(root, 'volume-settings-preset-schema-v2.json');
assert.ok(existsSync(sceneOntologyPath), 'Volume scene authority lives in one shared ontology module');
assert.ok(existsSync(basinSmokePagePath), 'Legacy basin smoke links have a compatibility redirect');
assert.ok(existsSync(settingsPresetPagePath), 'Volume cockpit has a capture-backed settings-preset loader');
assert.ok(existsSync(settingsPresetWitnessPath), 'One-action settings persistence has a reusable browser witness');
assert.ok(existsSync(settingsPresetContractPath), 'Settings loader has executable artifact admission');
assert.ok(existsSync(settingsPresetSchemaPath), 'Settings loader has a canonical control inventory');
const sceneOntology = readFileSync(sceneOntologyPath, 'utf8');
const basinSmokePage = readFileSync(basinSmokePagePath, 'utf8');
const settingsPresetPage = readFileSync(settingsPresetPagePath, 'utf8');
const settingsPresetWitness = readFileSync(settingsPresetWitnessPath, 'utf8');
const settingsPresetContract = readFileSync(settingsPresetContractPath, 'utf8');
const settingsPresetSchema = JSON.parse(readFileSync(settingsPresetSchemaPath, 'utf8'));
const corePath = join(root, 'volume-core.js');
assert.ok(existsSync(corePath), 'volume-core.js exists');
const core = readFileSync(corePath, 'utf8');
const activeProductionCore = core.replace(
  /const RETIRED_RAYMARCH_CONTROL_KEYS[\s\S]*?^}\n/m,
  '/* explicit retired-control compatibility boundary */\n',
);
const topologyShellLabBlock = core.match(/let curlActivity = smoothstep[\s\S]*?let inspectShellMask =/)?.[0] || '';

assert.match(index, /data-tab="volume"/, 'sidebar exposes a Volume tab');

const formatVolumeBasinRouteValueSource = index.match(/function formatVolumeBasinRouteValue\(value\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(formatVolumeBasinRouteValueSource, 'volume capture exposes a named route-value serializer');
const formatVolumeBasinRouteValue = Function(`return (${formatVolumeBasinRouteValueSource})`)();
assert.equal(
  formatVolumeBasinRouteValue(0.550993236027056),
  '0.550993236027056',
  'basin recapture preserves exact high-precision slider values instead of rounding them',
);

const readVolumeDomControlValueSource = index.match(/function readVolumeDomControlValue\(el\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(readVolumeDomControlValueSource, 'volume capture exposes a named DOM-value reader');
const readVolumeDomControlValue = Function(`return (${readVolumeDomControlValueSource})`)();
assert.equal(
  readVolumeDomControlValue({ type: 'text', tagName: 'INPUT', value: '', checked: false }),
  '',
  'empty text controls remain empty strings instead of silently becoming numeric zero',
);
assert.match(
  index,
  /function readVolumeSettingsControls\(role = 'basin'\)[\s\S]*controls\[el\.id\]\s*=\s*\{[\s\S]*function readVolumeDomControls\(\)/,
  'native settings presets key controls by stable DOM id to match the canonical inventory',
);
assert.match(
  index,
  /params\.get\('volume_shell_inspect_mode'\)/,
  'route loading reads the same shell-inspect parameter name emitted by capture',
);
assert.match(
  index,
  /sourceQualityReason[\s\S]*volume_quality_reason/,
  'recapture preserves the source settings provenance instead of overwriting it with a generic capture label',
);
assert.match(
  settingsPresetPage,
  /validateVolumeSettingsPresetDocument/,
  'the short preset loader delegates admission to the shared behavioral contract',
);
assert.equal(settingsPresetSchema.identity, 'kaminos-volume-settings-preset-schema-v2');
assert.equal(
  settingsPresetSchema.controlCount,
  settingsPresetSchema.controls.length,
  'canonical schema count derives from its active production volume-control inventory',
);
assert.match(settingsPresetContract, /schema\.forbiddenPresetFields[\s\S]*settings preset contains forbidden runtime or replay state/, 'shared admission rejects forbidden replay/runtime payload fields');
assert.match(
  settingsPresetContract,
  /shared-volume-settings-preset-v2/,
  'shared settings authority is explicit instead of impersonating a replay capture',
);
assert.match(
  settingsPresetWitness,
  /sourcePresetAuthority/,
  'one-action witness preserves the effective preset authority in its durable receipt',
);
assert.match(index, /id="tab-volume"/, 'Volume tab content is present');
assert.match(index, /kaminos_volume_smoke/, 'URL route gate names the volume smoke prototype');
assert.match(index, /volume_primitive_fixture/, 'URL route can seed a saved volume primitive fixture');
assert.match(index, /createVolumeMainRendererBridge/, 'volume route composes into the main Three.js renderer');
assert.match(index, /CanvasTexture\(volumePrototype\.canvasElement\(\)\)/, 'main renderer consumes the native volume canvas as a Three.js texture');
assert.match(index, /volume-main-renderer-bridge-v0/, 'volume main-renderer bridge carries stable route identity');
assert.match(index, /volumeBridge\.update/, 'render loop refreshes the volume bridge before main renderer draw');
assert.doesNotMatch(index, /#kaminos-volume-canvas\.active \{ display: block; \}/, 'volume canvas active route must not rely on the stale display-block overlay rule');
assert.match(index, /#kaminos-volume-canvas\.active \{[^}]*opacity:\s*1;[^}]*z-index:\s*3;[^}]*\}/, 'volume route must make the native WebGPU canvas visible for landing smoke');
assert.match(index, /createLamellarHookVolumePrimitiveFixture/, 'URL fixture can seed a Lamellar-derived volume primitive');
assert.match(index, /couplingSource:\s*'lamellar'/, 'Lamellar volume primitives preserve coupling source identity');
assert.match(index, /targetHookId:\s*'lamellar-0-0-selected'/, 'Lamellar volume primitives preserve target hook identity');
assert.match(index, /temporary-aesthetic-composition-primitive-not-final-lamellar-topology/, 'Lamellar fixture preserves the placeholder topology contract');
assert.match(index, /VOLUME_PRIMITIVE_SCHEMA/, 'scene data names the volume primitive schema explicitly');
assert.match(index, /volumePrimitives/, 'scene data persists authored volume primitives');
assert.match(index, /setVolumePrimitivesState/, 'scene loading can restore authored volume primitives');
assert.match(index, /volume-core\.js/, 'index imports the volume prototype module');
assert.match(index, /volume-core\.js\?v=[a-z0-9-]+/, 'volume prototype import carries a cache key so browser smokes pick up shader changes');
assert.match(index, /id="volume-render-source-orientation"/, 'Volume tab exposes render/source orientation identity for operator smoke');
assert.match(index, /id="volume-canonical-render-mode-state"/, 'Volume tab exposes effective canonical render diagnostic mode for operator smoke');
assert.match(index, /id="volume-canonical-motion-mode-state"/, 'Volume tab exposes effective canonical motion diagnostic mode for operator smoke');
assert.match(index, /DEFAULT_VOLUME_SMOKE_BASIN_URL\s*=\s*'\.\/artifacts\/default-basin\/cheap-blast-furnace\.json'/, 'bare smoke routes default to the committed cheap-blast-furnace basin export');
assert.match(index, /boundary_fire_bonfire_a_la_ruffles_0709:[\s\S]*reactionLiveView:\s*'boundary_fire'/, 'Boundary Fire Bonfire_a_la_ruffles basin activates boundary-fire as the default live fire view');
assert.match(index, /boundary_fire_bonfire_a_la_ruffles_0709:[\s\S]*boundarySidecarSource:\s*'baked'[\s\S]*boundarySidecarBlur:\s*1\.00[\s\S]*boundarySidecarWidth:\s*2\.00[\s\S]*boundarySidecarRidge:\s*2\.00/, 'Boundary Fire Bonfire_a_la_ruffles basin uses the promoted baked sidecar reconstruction path');
assert.match(index, /boundary_fire_bonfire_a_la_ruffles_0709:[\s\S]*reactionBoundaryFireRidge:\s*1\.28[\s\S]*reactionBoundaryFireRidgeCut:\s*0\.10[\s\S]*reactionBoundaryFireLuma:\s*5\.00/, 'Boundary Fire Bonfire_a_la_ruffles basin preserves the promoted ridge and luma values');
assert.match(index, /boundary_fire_bonfire_a_la_ruffles_0709:[\s\S]*reactionBoundaryFireCleanBlue:\s*0\.64[\s\S]*reactionBoundaryFireSoot:\s*0\.64[\s\S]*reactionBoundaryFireYellow:\s*0\.40[\s\S]*reactionBoundaryFireWarmth:\s*0\.40/, 'Boundary Fire Bonfire_a_la_ruffles basin respects the reduced soot-yellowing and thermal-warmth ceilings');
assert.match(index, /boundary_fire_bonfire_a_la_ruffles_0709:[\s\S]*density:\s*6\.00[\s\S]*fire:\s*3\.50[\s\S]*radiance:\s*0\.00[\s\S]*absorption:\s*0\.30[\s\S]*glow:\s*0\.00[\s\S]*smoke:\s*2\.80/, 'Boundary Fire Bonfire_a_la_ruffles basin preserves the promoted transport and smoke gains');
assert.match(index, /boundary_fire_bonfire_a_la_ruffles_0709:[\s\S]*raySteps:\s*132[\s\S]*adaptiveRays:\s*1\.00[\s\S]*occupancySkip:\s*1\.00[\s\S]*renderScale:\s*0\.65[\s\S]*resolution:\s*128/, 'Boundary Fire Bonfire_a_la_ruffles basin preserves the promoted simulation and production ray budget');
for (const forbiddenId of [
  'volume-agent-camera-save', 'volume-agent-view-save', 'volume-basin-copy', 'volume-basin-restore',
  'volume-basin-slot', 'volume-basin-slot-save', 'volume-basin-slot-load', 'volume-look-library-kind',
  'volume-look-library-entry', 'volume-look-library-name', 'volume-look-library-json',
  'volume-look-library-save', 'volume-look-library-load', 'volume-look-library-export', 'volume-look-library-import',
]) {
  assert.doesNotMatch(index, new RegExp(`id="${forbiddenId}"`), `dangerous legacy persistence control is absent: ${forbiddenId}`);
}
assert.match(index, /id="settings-preset-label"/, 'Shared preset surface accepts a human label outside the canonical volume-control inventory');
assert.match(index, /id="settings-preset-save"/, 'Shared preset surface exposes an exact Save command');
assert.match(index, /id="settings-preset-select"/, 'Shared preset surface lists branch-independent presets');
assert.match(index, /id="settings-preset-load-here"/, 'Shared preset surface loads the selected basin in the current cockpit tab');
assert.match(index, /id="settings-preset-open-fresh"/, 'Shared preset surface loads the selected basin in a fresh cockpit tab');
assert.match(index, /id="settings-preset-view"/, 'Shared preset surface keeps renderer composition as an explicit inspection-only choice');
assert.match(index, /id="settings-preset-inspect-fresh"/, 'Shared preset surface exposes renderer inspection separately from cockpit loading');
assert.match(index, /dataset\.commandWired = 'true'/, 'Shared preset buttons report when their commands are wired');
assert.match(index, /id="volume-scene-authority"/, 'Volume cockpit exposes current scene authority beside the scene selector');
assert.match(index, /saveVolumeSettingsPreset/, 'Shared settings persistence uses a named durable orchestration path');
assert.match(index, /refreshVolumeSettingsPresetList/, 'Shared settings persistence refreshes a server-backed index');
const settingsLoadBlock = index.match(/function navigateToSelectedVolumeSettingsPreset[\s\S]*?\n\}/)?.[0] || '';
assert.match(index, /function selectedVolumeSettingsPresetUrl\(\)[\s\S]*?volume-settings-preset\.html\?preset=/, 'Cockpit loading uses the visible exact-preset loader without a renderer view');
assert.doesNotMatch(settingsLoadBlock, /\basync\b|\bawait\b|\bfetch\(/, 'Cockpit load navigation is synchronous so stale fetch completion cannot supersede later operator intent');
assert.match(settingsLoadBlock, /window\.open\(target, '_blank'\)[\s\S]*location\.assign\(target\)/, 'Current and fresh cockpit loads give the exact loader page ownership immediately');
assert.match(index, /function selectedVolumeSettingsPresetInspectionUrl\(\)[\s\S]*?volume-settings-preset\.html/, 'Explicit renderer inspection retains the separate visual wrapper');
assert.match(settingsPresetContract, /VOLUME_SETTINGS_PRESET_VIEW_BY_COMPOSITION/, 'Shared preset inspection maps effective composition to an explicit loader view');
assert.match(settingsPresetPage, /buildVolumeSettingsPresetTarget/, 'The viewless exact-preset loader builds the canonical ordinary cockpit target');
assert.match(settingsPresetPage, /if \(!view\)[\s\S]*buildVolumeSettingsPresetTarget[\s\S]*location\.replace\((?:target|forwardCompositionHash\(target, location\.hash, location\.search\))\)/, 'The viewless loader validates then redirects into the ordinary steerable cockpit, carrying any authored composition hash');
assert.match(index, /validateVolumeSettingsPresetDocument[\s\S]*validateVolumeSettingsPresetTarget/, 'The ordinary live target imports exact preset admission');
assert.match(index, /async function admitVolumeSettingsPresetRoute[\s\S]*validateVolumeSettingsPresetTarget\(receipt, params\)/, 'The ordinary live target re-reads and validates preset authority instead of trusting route text');
assert.match(index, /async function initKaminosVolumeRoute\(\) \{[\s\S]*?await admitVolumeSettingsPresetRoute\(params\);[\s\S]*?routedBonfireAblationControls/, 'Preset admission completes before any route settings are applied');
assert.match(index, /stateExclusions:[\s\S]*fluidField:\s*true[\s\S]*replayState:\s*true/, 'Settings preset records that runtime fields and replay state are excluded');
assert.doesNotMatch(index, /const runtimeContext = settingsPreset/, 'Settings presets no longer share a replay/runtime capture builder');
const settingsSaveBlock = index.match(/async function saveVolumeSettingsPreset\(\) \{[\s\S]*?\n\}/)?.[0] || '';
assert.doesNotMatch(settingsSaveBlock, /sceneReceipt|boundarySplatMode|resolution/, 'Settings persistence has no scene, renderer, or grid admission gate');
assert.match(index, /\/api\/volume-settings-presets/, 'Volume cockpit uses the branch-independent settings store API');
assert.match(index, /readVolumeDomControls/, 'Volume capture reads all live DOM volume controls, not only curated look fields');
assert.match(index, /buildVolumeAgentCaptureRoute/, 'Volume capture serializes all live DOM controls into the replay route');
assert.match(serve, /--volume-settings-store/, 'Server accepts an explicit branch-independent preset-store path');
assert.match(serve, /KAMINOS_VOLUME_SETTINGS_STORE/, 'Server has a configurable shared-store default');
assert.match(serve, /\/api\/volume-settings-presets/, 'Local server exposes shared preset list and write endpoints');
assert.match(serve, /\/api\/volume-settings-preset/, 'Local server exposes exact shared preset reads');
assert.match(serve, /validate_volume_settings_preset_payload/, 'Server runs one exact settings-preset admission helper before writing');
assert.match(serve, /volume-settings-preset\.html\?preset=/, 'Saved settings presets receive a short ordinary-live loader route');
assert.match(serve, /settings preset requires exactly/, 'Server rejects incomplete settings presets');
assert.match(serve, /settings preset must not contain runtime, renderer, camera, or replay state/, 'Server rejects settings payloads that smuggle runtime context behind exclusion flags');
assert.match(serve, /os\.replace/, 'Shared preset writes use atomic replacement');
assert.doesNotMatch(settingsPresetContract, /volume_scene'\)|volume_boundary_splat_mode'\)|volume_resolution'\)/, 'Settings admission is independent of scene, renderer, and grid values');
assert.match(settingsPresetContract, /new URL\('\/', origin\)/, 'Settings target opens the ordinary live prototype');
const ordinarySettingsTargetBlock = settingsPresetContract.match(/export function buildVolumeSettingsPresetTarget[\s\S]*?\n\}/)?.[0] || '';
assert.doesNotMatch(ordinarySettingsTargetBlock, /target\.searchParams\.set\('role'|target\.searchParams\.set\('composition'|warmup_steps/, 'Ordinary settings target does not invent renderer assay parameters');
assert.match(settingsPresetPage, /status\.classList\.add\('failed'\)/, 'Settings loader fails visibly instead of presenting fallback as authority');
assert.match(settingsPresetWitness, /failurePhase/, 'Settings witness records its exact failure phase');
assert.match(settingsPresetWitness, /sourcePresetId/, 'Settings witness verifies durable preset identity at the live target');
assert.match(settingsPresetWitness, /continuousSimStepDelta/, 'Settings witness rejects static live output');
assert.match(settingsPresetWitness, /visualAuthority:\s*'not-evaluated-settings-persistence-only'/, 'Settings witness does not present ordinary-route screenshots as renderer evidence');
assert.match(settingsPresetWitness, /operatorWindow\.__kaminosSaveVolumeSettingsPreset\(\)/, 'Settings witness invokes the exact shared-store UI command implementation');
const settingsWitnessSelectiveDebugBlock = settingsPresetWitness.match(/const selectiveDebugExpression[\s\S]*?\}\)\(\)`;/)?.[0] || '';
assert.match(settingsWitnessSelectiveDebugBlock, /window\.__kaminosSelectiveHeadLive\?\.debugState/, 'Settings witness reads source renderer evidence from the selective-head wrapper');
const settingsWitnessOrdinaryDebugBlock = settingsPresetWitness.match(/const ordinaryDebugExpression[\s\S]*?\}\)\(\)`;/)?.[0] || '';
assert.match(settingsWitnessOrdinaryDebugBlock, /__kaminosVolumePrototype\?\.debugState[\s\S]*__kaminosVolumeSettingsPresetReceipt/, 'Settings witness reads reopened cockpit state and exact preset admission together');
assert.match(settingsPresetWitness, /function assertSelectiveCompositionState[\s\S]*expectedComposition[\s\S]*selectiveHeadLivePassReceipt/, 'Settings witness requires the exact selected composition and pass receipt');
assert.match(settingsPresetWitness, /function assertOrdinaryCockpitState[\s\S]*shared-volume-settings-preset-v2[\s\S]*activeTab/, 'Settings witness requires ordinary live-cockpit and immutable preset authority after loading');
assert.match(settingsPresetWitness, /expectedPassTuple[\s\S]*splatApplied[\s\S]*raymarchApplied/, 'Settings witness verifies composition-specific applied pass tuples');
assert.match(settingsPresetWitness, /smoke-raymarch-under-splats-v0[\s\S]*raymarchFireAuthority:\s*0[\s\S]*full-raymarch-under-splats-diagnostic-v0[\s\S]*raymarchFireAuthority:\s*1/, 'Settings witness distinguishes smoke-only raymarch authority from duplicate-fire diagnostic authority');
assert.match(settingsPresetWitness, /compositionAuthority[\s\S]*raymarchAuthority[\s\S]*raymarchFireAuthority/, 'Settings witness verifies authority identity in addition to pass presence');
assert.match(settingsPresetWitness, /assertSelectiveCompositionState[\s\S]*fallbackReason[\s\S]*compositionFallbackReason[\s\S]*boundarySplatFallbackReason/, 'Settings witness rejects every selective wrapper fallback surface');
assert.match(settingsPresetWitness, /function operatorContext[\s\S]*querySelector\('#basin'\)[\s\S]*contentWindow/, 'Settings witness locates operator controls inside the wrapper-backed product view');
assert.match(settingsPresetWitness, /operatorWindow\.__kaminosSaveVolumeSettingsPreset/, 'Settings witness saves through the product view inner window');
assert.match(settingsPresetWitness, /awaitPromise:\s*true/, 'Settings witness waits for the persistence receipt before following its popup');
assert.match(settingsPresetWitness, /commandResult\.presetUrl/, 'Settings witness rejects command completion without a durable live route');
assert.match(settingsPresetWitness, /liveUrl\.pathname[\s\S]*'\/'[\s\S]*forbiddenRendererParam/, 'Settings witness rejects a renderer-assay route masquerading as the reopened cockpit');
assert.match(settingsPresetWitness, /steerabilityReceipt[\s\S]*settings-preset-load-here[\s\S]*restored/, 'Settings witness proves one reversible control change in the reopened cockpit');assert.match(settingsPresetWitness, /function operatorContext[\s\S]*querySelector\('#basin'\)[\s\S]*contentWindow/, 'Settings witness locates operator controls inside the wrapper-backed product view');
assert.match(settingsPresetWitness, /operatorWindow\.__kaminosSaveVolumeSettingsPreset/, 'Settings witness saves through the product view inner window');
assert.match(settingsPresetWitness, /awaitPromise:\s*true/, 'Settings witness waits for the persistence receipt before following its popup');
assert.match(settingsPresetWitness, /commandResult\.presetUrl/, 'Settings witness rejects command completion without a durable live route');
assert.match(settingsPresetWitness, /liveUrl\.pathname[\s\S]*'\/'[\s\S]*forbiddenRendererParam/, 'Settings witness rejects a renderer-assay route masquerading as the reopened cockpit');
assert.match(settingsPresetWitness, /steerabilityReceipt[\s\S]*settings-preset-load-here[\s\S]*restored/, 'Settings witness proves one reversible control change in the reopened cockpit');
assert.match(
  settingsPresetWitness,
  /function assertNumericEquivalent[\s\S]*Number\.EPSILON[\s\S]*assertNumericEquivalent\(steerabilityReceipt\?\.changed, steerabilityReceipt\?\.requested/,
  'Settings witness accepts floating-point-equivalent browser range values without accepting material tuning substitution',
);
assert.match(settingsPresetWitness, /commandDiagnostic[\s\S]*volume-settings-preset-state/, 'Settings witness preserves the operator-visible save failure when the command returns no artifact');
assert.match(settingsPresetWitness, /'volumeDebugState'[\s\S]*Object\.hasOwn\(presetDocument\.preset, field\)/, 'Settings witness verifies runtime debug state is absent from the durable preset');
assert.match(settingsPresetWitness, /status:\s*'failed'/, 'Settings witness writes a durable report when it fails before output');
assert.match(volumeWitness, /--capture/, 'Volume witness accepts a saved capture path for replay');
assert.match(volumeWitness, /isCaptureReplay/, 'Volume witness reports whether it replayed a saved capture');
assert.match(volumeWitness, /kaminosSetCameraDebugPose/, 'Volume witness reapplies saved camera poses for capture replay');
assert.match(volumeWitness, /replayCaptureControls/, 'Volume witness reapplies saved DOM controls before capture screenshots');
assert.match(volumeWitness, /buildRouteParamsForWitness/, 'Volume witness validates capture replay against saved DOM controls, not only the original route');
assert.match(volumeWitness, /replay\?\.capture\?\.domControls/, 'Capture replay DOM controls feed route/control expectations');
assert.match(volumeWitness, /volumeParamNameFromControlKey/, 'Capture replay maps DOM control keys back to volume route params for witness identity');
assert.match(volumeWitness, /function captureControlValue/, 'Capture replay accepts both raw and structured saved DOM control values');
assert.match(volumeWitness, /function assertCaptureReplayControls/, 'Capture replay has its own sparse-control assertion path instead of borrowing the full route witness');
assert.match(volumeWitness, /capture replay had no saved DOM controls to verify/, 'Capture replay fails loud when a save produced no replayable controls');
assert.match(volumeWitness, /capture-replay-evidence/, 'Capture replay writes a direct screenshot/report artifact before generic route assertions');
assert.doesNotMatch(volumeWitness, /\bproc\.kill\(/, 'Capture replay cleanup does not reference the retired single-process browser handle');
assert.match(volumeWitness, /capture-replay-evidence[\s\S]*closeBrowserSession\(browserSession\)/, 'Capture replay closes the active reusable browser session after writing evidence');
assert.match(volumeWitness, /capture replay native GPU frame missing visible volume/, 'Capture replay refuses to present a blank native GPU frame as proof');
const captureReplayEvidenceStart = volumeWitness.indexOf("phase = 'capture-replay-evidence'");
const captureReplayEvidenceEnd = volumeWitness.indexOf("assert.equal(state.volumeScene", captureReplayEvidenceStart);
const captureReplayEvidenceBody = volumeWitness.slice(captureReplayEvidenceStart, captureReplayEvidenceEnd);
assert.match(captureReplayEvidenceBody, /sampleFrame\?\.\(\{\s*advanceSim:\s*false,\s*includeRgba:\s*true\s*\}\)/, 'Capture replay reads the renderer GPU frame at full resolution without advancing simulation');
assert.match(captureReplayEvidenceBody, /expectedLength\s*=\s*sample\.image\.width\s*\*\s*sample\.image\.height\s*\*\s*4[\s\S]*sample\.image\.rgba\.length\s*!==\s*expectedLength/, 'Capture replay rejects partial native RGBA output instead of laundering it into evidence');
assert.match(captureReplayEvidenceBody, /nativeRgba\.length\s*!==\s*nativeFrame\.expectedLength/, 'Capture replay verifies the transported native RGBA byte count before writing evidence');
assert.match(captureReplayEvidenceBody, /for \(let offset = 0; offset < nativeFrame\.expectedLength; offset \+= nativeFrameTransportChunkBytes\)/, 'Capture replay transports every native RGBA byte in bounded CDP messages without capping the image');
assert.match(captureReplayEvidenceBody, /Buffer\.concat\(nativeRgbaChunks\)/, 'Capture replay reconstructs the complete native frame from all transport chunks');
assert.match(captureReplayEvidenceBody, /writeRgbaPng\(out,\s*nativeFrame\.width,\s*nativeFrame\.height,\s*nativeRgba\)/, 'Capture replay writes native renderer RGBA directly to the primary PNG artifact');
assert.doesNotMatch(captureReplayEvidenceBody, /Page\.captureScreenshot/, 'Capture replay must not substitute a browser screenshot for native renderer pixels');
assert.match(captureReplayEvidenceBody, /gpu-frame-texture-rgba8-readback/, 'Capture replay report names native GPU frame readback authority');
assert.doesNotMatch(index, /BUILT_IN_VOLUME_LOOK_LIBRARY/, 'Retired partial look-library aliases are removed from the operator runtime');
assert.match(index, /kaminos_volume_smoke'\)\s*===\s*'1'[\s\S]*!params\.has\('settings_preset'\)[\s\S]*await applyDefaultVolumeSmokeBasin\(params\)/, 'bare smoke routes apply the default basin when no explicit scene, tall preset, or settings preset is routed');
assert.match(index, /id="volume-boundary-sidecar-source"/, 'Boundary Fire tuning exposes a live/baked sidecar source selector');
assert.match(index, /volume_boundary_sidecar_source/, 'Basin URLs preserve the boundary sidecar source control');
assert.match(index, /id="volume-boundary-sidecar-view"/, 'Boundary Fire tuning exposes a primary-view sidecar channel selector');
assert.match(index, /volume_boundary_sidecar_view/, 'Basin URLs preserve the sidecar channel debug selector');
assert.match(index, /value="coverage"[\s\S]*value="ridge"[\s\S]*value="proximity"[\s\S]*value="footprint"/, 'Sidecar channel selector exposes coverage, ridge, proximity, and footprint views');
assert.match(index, /id="volume-boundary-sidecar-blur"/, 'Boundary Fire tuning exposes a sidecar blur/sample-efficiency control');
assert.match(index, /id="volume-boundary-sidecar-width"/, 'Boundary Fire tuning exposes a sidecar step-footprint width control');
assert.match(index, /id="volume-boundary-sidecar-ridge"/, 'Boundary Fire tuning exposes a baked ridge gain control');
assert.match(index, /boundarySidecarSource/, 'Volume controls carry the boundary sidecar source into the renderer');
assert.match(index, /boundarySidecarView/, 'Volume controls carry the sidecar channel debug view into the renderer');
assert.ok(index.includes("['flame', 'tall_plume'].includes(params.get('volume_scene'))"), 'both simulator names preserve the default basin');
assert.match(index, /routeVolumeScene && !shouldApplyDefaultVolumeSmokeTallPreset/, 'a scene alias must not overwrite the loaded default basin');
assert.match(index, /pyro_material_bonfire_family_0702:[\s\S]*resolution:\s*96/, 'Pyro material bonfire basin keeps a conservative default grid while preserving the look controls');
assert.match(index, /pyro_material_bonfire_family_0702:[\s\S]*fire:\s*0\.00/, 'Pyro material bonfire basin lets Pyro own the visible flame instead of stacking old stock fire');
assert.match(index, /pyro_material_bonfire_family_0702:[\s\S]*pyroMaterialGain:\s*0\.65/, 'Pyro material bonfire basin preserves the recovered material gain');
assert.match(index, /pyro_material_bonfire_family_0702:[\s\S]*pyroBiteCore:\s*0\.15/, 'Pyro material bonfire basin preserves the carved core bite field');
assert.match(index, /pyro_material_bonfire_family_0702:[\s\S]*pyroBiteRim:\s*1\.00/, 'Pyro material bonfire basin preserves the rim bite field');
assert.match(index, /pyro_material_bonfire_family_0702:[\s\S]*pyroBiteAfter:\s*1\.00/, 'Pyro material bonfire basin preserves the after-bite wake field');
assert.match(index, /pyro_material_bonfire_family_0702:[\s\S]*pyroFireMode:\s*'pyro-owned'/, 'Pyro material bonfire basin keeps the Pyro-owned flame display mode');
assert.match(index, /pyro_material_bonfire_family_0702:[\s\S]*pyroRadianceSource:\s*'fire'/, 'Pyro material bonfire basin pins the rebuilt radiance source to fire');
assert.match(index, /pyro_material_bonfire_family_0702:[\s\S]*pyroRadianceFireLock:\s*0\.00/, 'Pyro material bonfire basin preserves the recovered radiance fire-lock state');
assert.match(index, /pyro_material_bonfire_family_0702:[\s\S]*pressureMode:\s*'global-p3'/, 'Pyro material bonfire basin preserves the Full P3 pressure solve');
assert.match(index, /exploding_jellow_fireball_motherfucker_0706:[\s\S]*fire:\s*0\.00/, 'Exploding jellow fireball basin keeps Pyro-owned visible flame authority');
assert.match(index, /exploding_jellow_fireball_motherfucker_0706:[\s\S]*pyroMaterialGain:\s*1\.50/, 'Exploding jellow fireball basin preserves the operator-tuned high material gain');
assert.match(index, /exploding_jellow_fireball_motherfucker_0706:[\s\S]*pyroBiteHotColor:\s*'#ff4000'/, 'Exploding jellow fireball basin preserves the operator-tuned bite hot color');
assert.match(index, /exploding_jellow_fireball_motherfucker_0706:[\s\S]*pyroRadianceCoolColor:\s*'#ff6b6b'/, 'Exploding jellow fireball basin preserves the operator-tuned radiance cool color');
assert.match(index, /exploding_jellow_fireball_motherfucker_0706:[\s\S]*pyroFireMode:\s*'pyro-owned'/, 'Exploding jellow fireball basin preserves Pyro-owned flame display mode');
assert.match(index, /exploding_jellow_fireball_motherfucker_0706:[\s\S]*pressureMode:\s*'global-p3'/, 'Exploding jellow fireball basin preserves the Full P3 pressure solve for training pickup');
assert.match(index, /pyro_flow_small_bonfire_gamut_0707:[\s\S]*density:\s*6\.00/, 'Pyro Flow small-bonfire gamut basin preserves the high-density live basin');
assert.match(index, /pyro_flow_small_bonfire_gamut_0707:[\s\S]*fire:\s*0\.00/, 'Pyro Flow small-bonfire gamut basin lets Pyro own the visible flame');
assert.match(index, /pyro_flow_small_bonfire_gamut_0707:[\s\S]*inputRadius:\s*0\.19/, 'Pyro Flow small-bonfire gamut basin preserves the operator-tuned input radius');
assert.match(index, /pyro_flow_small_bonfire_gamut_0707:[\s\S]*flowRate:\s*0\.85/, 'Pyro Flow small-bonfire gamut basin preserves the operator-tuned flow rate');
assert.match(index, /pyro_flow_small_bonfire_gamut_0707:[\s\S]*pyroFlowBite:\s*3\.00/, 'Pyro Flow small-bonfire gamut basin preserves the loud Flow carrier gain');
assert.match(index, /pyro_flow_small_bonfire_gamut_0707:[\s\S]*pyroFlowRadiance:\s*4\.00/, 'Pyro Flow small-bonfire gamut basin preserves the Flow radiance gain');
assert.match(index, /pyro_flow_small_bonfire_gamut_0707:[\s\S]*pyroFlowSpikes:\s*1\.00/, 'Pyro Flow small-bonfire gamut basin preserves the Flow spike gain');
assert.match(index, /pyro_flow_small_bonfire_gamut_0707:[\s\S]*pyroFlowCoolColor:\s*'#ff6400'/, 'Pyro Flow small-bonfire gamut basin preserves the operator-tuned Flow cool color');
assert.match(index, /pyro_flow_small_bonfire_gamut_0707:[\s\S]*pyroFlowHotColor:\s*'#ff320f'/, 'Pyro Flow small-bonfire gamut basin preserves the operator-tuned Flow hot color');
assert.match(index, /pyro_flow_small_bonfire_gamut_0707:[\s\S]*pressureMode:\s*'global-p3'/, 'Pyro Flow small-bonfire gamut basin preserves the Full P3 pressure solve for training pickup');
assert.match(index, /id="volume-basin-bonfire-family"/, 'Volume cockpit exposes a one-click Pyro material bonfire family basin action');
assert.doesNotMatch(index, /KAMINOS_VOLUME_BASIN_STORAGE_KEY|KAMINOS_VOLUME_BASIN_SLOT_STORAGE_PREFIX/, 'Browser-local basin authority is removed');
assert.doesNotMatch(index, /saveVolumeBasinSnapshot|restoreVolumeBasinSnapshot|copyVolumeBasinUrl/, 'Legacy basin persistence implementation is removed rather than hidden');
assert.doesNotMatch(index, /KAMINOS_VOLUME_LOOK_LIBRARY_STORAGE_KEY|saveVolumeLookLibraryEntry|loadVolumeLookLibraryEntry/, 'Partial browser-local look persistence is removed');
assert.match(index, /id="volume-look-freeze"/, 'Volume look lab exposes a freeze control');
assert.match(index, /pixel-stable pin for simulation steps and shader time/i, 'Volume freeze control explains the active deterministic pinning contract');
assert.match(index, /volume_look_freeze/, 'Basin URLs preserve look-lab freeze state');
assert.match(index, /volume_pyro_compare/, 'Basin URLs preserve Pyro compare mode');
assert.match(index, /id="volume-look-lab-state"/, 'Volume readout exposes effective look-lab freeze/compare state');
assert.match(index, /Volume route controls loaded; renderer failed/, 'Volume route still hydrates basin controls when renderer activation fails');
assert.match(index, /initKaminosVolumeRoute\(\)\.catch/, 'Volume route initializes from the scene-init fallback path for setup diagnostics');
assert.match(index, /\.slider-row\s*\{[^}]*user-select:\s*none/, 'Slider rows prevent label/help text selection from stealing drag gestures');
assert.match(index, /\.slider-row input\[type="range"\]\s*\{[^}]*min-height:\s*24px/, 'Range sliders expose a taller grab lane than the visible rail');
assert.match(core, /topology-lab-monotonic-carrier-mix-v0/, 'Topology shell lab declares monotonic additive carrier-mix identity');
assert.doesNotMatch(topologyShellLabBlock, /shellCarrierGainSum|\/\s*max\(\s*0\.001[\s\S]*shellThermalGain/, 'Topology shell carrier gains must not be normalized through a shared hidden denominator');
assert.match(core, /BOUNDARY_SIDECAR_IDENTITY\s*=\s*'baked-boundary-sidecar-v0'/, 'Boundary sidecar bake carries a stable identity');
assert.match(core, /BOUNDARY_SIDECAR_BAKE_AUTHORITY\s*=\s*'band-limited-support-coverage-ridge-proximity-footprint-v1'/, 'Boundary sidecar bake names reconstructable sheet structure authority');
assert.match(core, /function boundarySidecarBufferBytes/, 'Boundary sidecar buffer size is explicit and grid-scaled');
assert.match(core, /function normalizeBoundarySidecarView/, 'Renderer normalizes sidecar channel debug views');
assert.match(core, /function boundarySidecarViewValue/, 'Renderer maps sidecar channel debug views into uniforms');
assert.match(core, /@group\(3\) @binding\(0\) var<storage, read_write> boundarySidecarDst/, 'WGSL has a write-only boundary sidecar bake output binding');
assert.match(core, /boundary_sidecar_display:\s*vec4<f32>/, 'Raymarch uniforms carry sidecar debug display controls separately from reconstruction controls');
assert.match(core, /@compute @workgroup_size\(4, 4, 4\)\s*fn csBoundarySidecar/, 'WGSL includes a boundary sidecar compute bake pass');
assert.match(core, /boundarySidecarCoverage/, 'Boundary sidecar bake records a coverage/opacity integral channel');
assert.match(core, /boundarySidecarProximity/, 'Boundary sidecar raymarch derives a proximity support channel');
assert.match(core, /boundarySidecarFootprintWidth/, 'Boundary sidecar raymarch derives a ray-footprint reconstruction width');
assert.match(core, /boundarySidecarBuildPipeline/, 'Renderer owns a boundary sidecar compute pipeline');
assert.match(core, /encodeBoundarySidecar/, 'Render loop encodes the boundary sidecar bake before drawing');
assert.match(core, /async function sampleFrame\([^)]*\)[\s\S]*encodeBoundarySidecar\(encoder(?:,[^)]*)?\)[\s\S]*encodeDraw\(encoder, frameTexture\.createView\(\), 'kaminos volume one-off readback pass'/, 'sampleFrame readback bakes the boundary sidecar before drawing evidence frames');
assert.match(core, /sampleWorldBoundarySidecar/, 'Raymarch samples the baked boundary sidecar');
assert.match(core, /boundarySidecarStepFootprintWidth/, 'Boundary-fire path compensates sheet width for ray step footprint');
const boundaryFireBranch = core.match(/if \(boundarySurfaceMode > 0\.5\) \{[\s\S]*?let boundaryGradientGate/);
assert.ok(boundaryFireBranch, 'Boundary-fire shader branch is discoverable for sidecar source contracts');
const bakedOnlyBranch = boundaryFireBranch[0].match(/if \(boundarySidecarSource > 0\.5 && boundarySidecarSource <= 1\.5\) \{([\s\S]*?)\} else \{/);
assert.ok(bakedOnlyBranch, 'Baked sidecar mode has a distinct branch from live/mix');
assert.match(bakedOnlyBranch[1], /sampleWorldFlowReconstructedSidecar\(materialP, reconstructed\)/, 'Baked sidecar mode lazily consumes the shared reconstructed baked-structure sample at the material lookup');
assert.doesNotMatch(bakedOnlyBranch[1], /liveBoundarySupportAt/, 'Baked sidecar mode must not pay the live seven-tap boundary support path per ray step');
assert.match(boundaryFireBranch[0], /if \(boundarySidecarSource > 1\.5\) \{[\s\S]*mix\(boundarySupport, boundarySidecarSample\.x, 0\.5\)/, 'Mix sidecar mode is the explicit expensive live+baked comparison path');
assert.match(core, /boundaryStructureSource:\s*boundarySidecarSourceName/, 'Debug state reports the effective boundary structure source');
assert.match(core, /boundarySidecarDebug/, 'Debug state exposes boundary sidecar bake identity and controls');
assert.match(core, /channels:\s*\['support', 'coverage', 'ridge', 'proximity', 'footprint'\]/, 'Debug state reports sidecar channel semantics');
assert.match(core, /uniforms\[312\]\s*=\s*boundarySidecarViewValue/, 'Uniform upload carries the sidecar debug view selector');
assert.match(core, /const sidecarViewConsumer = presentationActive && view !== 'off'/, 'Sidecar channel debug views remain an explicit sidecar-bake consumer even when the live source remains selected');
assert.match(index, /Flow only/i, 'Pyro carrier isolate selector can show Flow alone');
for (const param of [
  'volume_pyro_flow_bite',
  'volume_pyro_flow_border',
  'volume_pyro_flow_teeth',
  'volume_pyro_flow_rise',
  'volume_pyro_flow_fire_lock',
  'volume_pyro_flow_luma',
  'volume_pyro_flow_radiance',
  'volume_pyro_flow_spikes',
  'volume_pyro_flow_cool_color',
  'volume_pyro_flow_hot_color',
]) {
  assert.match(index, new RegExp(param), `Pyro basin URLs preserve ${param}`);
}
for (const routeName of [
  'routePyroFlowBite',
  'routePyroFlowBorder',
  'routePyroFlowTeeth',
  'routePyroFlowRise',
  'routePyroFlowFireLock',
  'routePyroFlowLuma',
  'routePyroFlowRadiance',
  'routePyroFlowSpikes',
  'routePyroFlowCoolColor',
  'routePyroFlowHotColor',
]) {
  assert.match(index, new RegExp(routeName), `Pyro route parser accepts ${routeName}`);
}
const volumeSyncControlLoop = index.match(/for \(const id of \[([\s\S]*?'volume-canonical-body-balance'[\s\S]*?)\]\) \{\s*document\.getElementById\(id\)\?\.addEventListener\('input', syncControls\)/);
assert.ok(volumeSyncControlLoop, 'Volume cockpit has one explicit syncControls listener list for slider/select controls');
assert.match(index, /moveVolumePyroRadianceControlsBelowFlow/, 'Pyro cockpit keeps old Radiance directly below Flow instead of burying it under demoted Bite/Fold/Wake controls');
assert.match(index, /moveVolumePyroLegacyControlsBelowRadiance/, 'Pyro cockpit explicitly demotes legacy Bite/Fold/Wake controls below the still-useful Radiance surface');
const legacyPyroControlIds = index.match(/const LEGACY_PYRO_CONTROL_IDS = \[([\s\S]*?)\];/)?.[1] || '';
assert.doesNotMatch(legacyPyroControlIds, /volume-pyro-radiance/, 'Demoted Bite/Fold/Wake controls must not bury the still-useful Radiance controls');
assert.match(index, /moveVolumePyroFreezeIntoCarrierWorkbench/, 'Pyro cockpit explicitly moves Look Freeze into the carrier-tuning workbench');
assert.match(index, /PYRO_CARRIER_WORKBENCH_PINNED_IDS[\s\S]*volume-look-freeze/, 'Pyro Freeze is pinned near the carrier controls instead of stranded in the generic route controls');
assert.match(core, /pyroFlowSignal[\s\S]*combustionFrontTopology[\s\S]*fireLick/, 'Pyro shader derives Flow carrier from combustion-front topology and live fire-lick breakup');
assert.match(core, /pyroFlowRadianceBoost[\s\S]*pyroFlowSignal/, 'Pyro shader exposes Flow radiance as a sparse additive term derived from the live Flow carrier');
assert.match(core, /pyroFlowSpikeSignal[\s\S]*pyroFlowSignal/, 'Pyro shader exposes Flow spikes as a separate topology/filament term derived from the live Flow carrier');
assert.match(core, /flowSignalMax/, 'Pyro renderer debug state exposes flow carrier max for route evidence');
assert.match(core, /flowRadianceMax/, 'Pyro renderer debug state exposes Flow radiance gain for route evidence');
assert.match(core, /flowSpikeMax/, 'Pyro renderer debug state exposes Flow spike gain for route evidence');
assert.match(index, /volume_pyro_radiance_gate/, 'Pyro basin URLs preserve radiance gate');
assert.match(index, /volume_pyro_radiance_spill/, 'Pyro basin URLs preserve radiance spill');
assert.match(index, /volume_pyro_radiance_warmth/, 'Pyro basin URLs preserve radiance warmth');
assert.match(index, /volume_pyro_bite_heat/, 'Pyro basin URLs preserve bite heat color');
assert.match(index, /volume_pyro_bite_chroma/, 'Pyro basin URLs preserve bite chroma');
assert.match(index, /volume_pyro_radiance_hue/, 'Pyro basin URLs preserve radiance hue');
assert.match(index, /volume_pyro_radiance_chroma/, 'Pyro basin URLs preserve radiance chroma');
for (const param of [
  'volume_pyro_flame_paint',
  'volume_pyro_stock_mix',
  'volume_pyro_flame_core_color',
  'volume_pyro_flame_edge_color',
  'volume_pyro_bite_ember_color',
  'volume_pyro_bite_hot_color',
  'volume_pyro_wake_shadow_color',
  'volume_pyro_wake_ember_color',
  'volume_pyro_radiance_cool_color',
  'volume_pyro_radiance_warm_color',
  'volume_pyro_flame_luma',
  'volume_pyro_bite_luma',
  'volume_pyro_wake_luma',
  'volume_pyro_radiance_luma',
]) {
  assert.match(index, new RegExp(param), `Pyro basin URLs preserve ${param}`);
}
assert.match(index, /volume_pyro_bite_height/, 'Pyro basin URLs preserve bite height gate');
assert.match(index, /volume_pyro_bite_fire_lock/, 'Pyro basin URLs preserve bite live-fire lock');
for (const param of [
  'volume_pyro_bite_core',
  'volume_pyro_bite_core_cut',
  'volume_pyro_bite_rim',
  'volume_pyro_bite_rim_cut',
  'volume_pyro_bite_after',
  'volume_pyro_bite_after_cut',
]) {
  assert.match(index, new RegExp(param), `Pyro basin URLs preserve stacked Bite control ${param}`);
}
assert.match(index, /volume_pyro_wake_lift/, 'Pyro basin URLs preserve wake lift');
assert.match(index, /volume_pyro_wake_warmth/, 'Pyro basin URLs preserve wake warmth');
assert.match(index, /volume_pyro_radiance_source/, 'Pyro basin URLs preserve radiance source routing');
assert.match(index, /volume_pyro_radiance_height/, 'Pyro basin URLs preserve radiance height gate');
assert.match(index, /volume_pyro_fire_mode/, 'Pyro basin URLs preserve fire-renderer ownership mode');
assert.match(index, /volume_pyro_radiance_border/, 'Pyro basin URLs preserve radiance border/focus');
assert.match(index, /volume_pyro_radiance_teeth/, 'Pyro basin URLs preserve radiance teeth/bite');
assert.match(index, /volume_pyro_radiance_rise/, 'Pyro basin URLs preserve radiance rise/climb');
assert.match(index, /volume_pyro_radiance_fire_lock/, 'Pyro basin URLs preserve radiance live-fire lock');
assert.doesNotMatch(volumeWitness, /`\/tmp\/kaminos-volume-witness-profile-\$\{port\}`/, 'Volume witness must not reuse one persistent browser profile per debug port');
assert.match(volumeWitness, /mkdtempSync\([^)]*kaminos-volume-witness-profile-/, 'Volume witness default profile must be fresh per run so stale localStorage cannot shadow the requested route');
assert.doesNotMatch(volumeWitness, /Number\(args\.get\('--debug-port'\) \|\| 9433\)/, 'Volume witness must not reuse one fixed default Chrome debug port across runs');
assert.match(volumeWitness, /randomInt\(/, 'Volume witness default debug port must be randomized so stale Chrome targets cannot shadow the requested route');
assert.match(volumeWitness, /--freeze-integrity-probe/, 'Volume witness can run a live look-freeze integrity probe');
assert.match(volumeWitness, /--freeze-integrity-probe-only/, 'Volume witness can isolate freeze integrity from broader visual evidence gates');
assert.match(volumeWitness, /look-freeze-render-phase-integrity-probe-v0/, 'Freeze integrity probe writes a stable predicate identity');
assert.match(volumeWitness, /renderPhaseTimeFrozen/, 'Freeze integrity probe verifies renderer time stays pinned during frozen control scrubs');
assert.match(volumeWitness, /renderPhaseFinite/, 'Freeze integrity probe rejects null or non-finite pinned renderer phases');
assert.match(volumeWitness, /pyroDynamicDetailPhaseFrozen/, 'Freeze integrity probe verifies Pyro material memory does not advance during frozen control scrubs');
assert.match(index, /routePyroRadianceGate/, 'Pyro route parser accepts radiance gate');
assert.match(index, /routePyroRadianceSpill/, 'Pyro route parser accepts radiance spill');
assert.match(index, /routePyroRadianceWarmth/, 'Pyro route parser accepts radiance warmth');
assert.match(index, /routePyroBiteHeat/, 'Pyro route parser accepts bite heat color');
assert.match(index, /routePyroBiteChroma/, 'Pyro route parser accepts bite chroma');
assert.match(index, /routePyroRadianceHue/, 'Pyro route parser accepts radiance hue');
assert.match(index, /routePyroRadianceChroma/, 'Pyro route parser accepts radiance chroma');
assert.match(index, /routePyroFlamePaint/, 'Pyro route parser accepts flame paint gain');
assert.match(index, /routePyroStockMix/, 'Pyro route parser accepts stock flame mix');
assert.match(index, /routePyroFlameCoreColor/, 'Pyro route parser accepts editable flame core color');
assert.match(index, /routePyroBiteHeight/, 'Pyro route parser accepts bite height gate');
assert.match(index, /routePyroBiteFireLock/, 'Pyro route parser accepts bite live-fire lock');
assert.match(index, /routePyroBiteCore/, 'Pyro route parser accepts Bite core gain');
assert.match(index, /routePyroBiteCoreCut/, 'Pyro route parser accepts Bite core threshold cut');
assert.match(index, /routePyroBiteRim/, 'Pyro route parser accepts Bite rim gain');
assert.match(index, /routePyroBiteRimCut/, 'Pyro route parser accepts Bite rim threshold cut');
assert.match(index, /routePyroBiteAfter/, 'Pyro route parser accepts Bite after/wake gain');
assert.match(index, /routePyroBiteAfterCut/, 'Pyro route parser accepts Bite after/wake threshold cut');
assert.match(index, /routePyroWakeLift/, 'Pyro route parser accepts wake lift');
assert.match(index, /routePyroWakeWarmth/, 'Pyro route parser accepts wake warmth');
assert.match(index, /routePyroRadianceSource/, 'Pyro route parser accepts radiance source routing');
assert.match(index, /routePyroRadianceHeight/, 'Pyro route parser accepts radiance height gate');
assert.match(index, /routePyroFireMode/, 'Pyro route parser accepts fire-renderer ownership mode');
assert.match(index, /routePyroRadianceBorder/, 'Pyro route parser accepts radiance border/focus');
assert.match(index, /routePyroRadianceTeeth/, 'Pyro route parser accepts radiance teeth/bite');
assert.match(index, /routePyroRadianceRise/, 'Pyro route parser accepts radiance rise/climb');
assert.match(index, /routePyroRadianceFireLock/, 'Pyro route parser accepts radiance live-fire lock');
assert.match(index, /Flow only/i, 'Pyro carrier isolate selector can show Flow alone');
assert.match(index, /id="volume-pyro-carrier-state"/, 'Volume readout exposes Pyro carrier diagnostic state');
assert.match(index, /id="volume-canonical-content-mode-state"/, 'Volume tab exposes effective canonical content mode for smoke/fire separation');
assert.match(index, /initKaminosVolumeRoute/, 'index initializes the volume route explicitly');
assert.match(index, /volume_external_emitters/, 'URL route can enable synthetic external volume emitters');
assert.match(index, /synthetic_hand_trails/, 'Volume route exposes a synthetic hand-trail emitter smoke');
assert.match(index, /id="volume-resolution"/, 'Volume tab exposes a fluid grid resolution control');
assert.match(index, /id="volume-grid-overlay"/, 'Volume tab exposes a grid overlay control');
assert.match(index, /id="volume-raf-fps"/, 'Volume tab exposes route-local RAF cadence separate from app FPS');
assert.match(index, /id="volume-frame-p95"/, 'Volume tab exposes route-local frame-time percentile');
assert.match(index, /id="volume-queue-ms"/, 'Volume tab exposes GPU queue completion latency');
assert.match(index, /id="volume-queue-p95"/, 'Volume tab exposes GPU queue latency percentile');
assert.match(index, /volume timing/i, 'Volume readout labels timing as route-local volume timing');
assert.match(index, /volume_resolution/, 'URL route can override fluid sim resolution');
assert.match(index, /volume_grid/, 'URL route can enable the fluid grid overlay');
assert.match(index, /id="volume-density"[^>]+max="12"/, 'Soot display gain exposes the expanded authoring range');
assert.match(index, /id="volume-density"[^>]+value="4\.2"/, 'smoke route defaults to denser normalized raymarch body');
assert.match(index, /id="volume-curl"[^>]+value="2\.65"/, 'smoke route defaults to the accepted curl shape');
assert.match(index, /id="volume-microdetail"/, 'Volume tab exposes transported microdetail control');
assert.match(index, /id="volume-interface-shred"/, 'Volume tab exposes interface shredding control');
assert.match(index, /id="volume-fire-licks"/, 'Volume tab exposes fire-lick breakup control');
assert.match(index, /id="volume-interface-shred"[^>]+max="10"/, 'Shred exposes an exaggerated tuning ceiling for operator range finding');
assert.match(index, /id="volume-fire-licks"[^>]+max="10"/, 'Fire Licks exposes an exaggerated tuning ceiling for operator range finding');
assert.match(index, /id="volume-speed"[^>]+value="5"/, 'smoke route defaults to the latest operator-found speed');
assert.match(index, /volume_speed/, 'URL route can override speed for repeatable tall-plume flame-cutoff probes');
assert.match(index, /params\.has\('volume_speed'\)/, 'speed route override must be an explicit route path rather than only a preset side effect');
assert.match(index, /id="volume-steps"[^>]+value="96"/, 'smoke route defaults to a lower step budget after normalized alpha');
assert.match(index, /id="volume-adaptive-rays"/, 'Volume tab exposes adaptive raymarch sampling control');
assert.match(index, /volume_adaptive_rays/, 'URL route can override adaptive raymarch sampling');
assert.match(index, /adaptiveRays/, 'Volume controls carry adaptive raymarch sampling into the renderer');
assert.match(
  index,
  /Empty-Space Acceleration[\s\S]*id="volume-occupancy-skip"/,
  'Volume tab exposes conservative empty-space acceleration under the compatible occupancy key',
);
assert.match(
  index,
  /supported reconstructed samples are always evaluated and composited/,
  'the empty-space acceleration control explains that supported ridge samples cannot be skipped',
);
assert.match(index, /volume_occupancy_skip/, 'URL route can override occupancy/importance skipping');
assert.match(index, /occupancySkip/, 'Volume controls carry occupancy/importance skip strength into the renderer');
assert.doesNotMatch(index, /volume_(?:majorant|temporal)|volume_history_clamp/, 'Volume routes do not retain retired raymarch controls');
assert.match(core, /stripRetiredRaymarchControls/, 'historical controls cross one explicit retirement boundary');
assert.match(core, /retiredRaymarchControls/, 'runtime state receipts every stripped historical control');
assert.match(core, /uniforms\[19\]\s*=\s*0\s*;/, 'ordinary product shaders receive explicit zero render-time authority');
assert.match(core, /uniforms\[47\]\s*=\s*controlsSnapshot\.rayStartNoise === false \? 0 : 1;/, 'reused frame-cycle slot carries only the static ray-start toggle');
assert.doesNotMatch(core, /uniforms\[47\]\s*=.*(?:frameCount|now|renderPhase)/, 'ray starts do not restore retired frame-cycle authority');
assert.match(core, /writeAnalyticEmitterInjectionUniform\([\s\S]*?renderPhaseTimeMs\s*\*\s*0\.001/, 'look freeze pins time only for explicit analytic-emitter temporal descriptors');
assert.match(core, /if \(advanceSim && !sampleLookFreeze && !simulationPaused\) \{[\s\S]*encodeSim\(encoder\)/, 'sampleFrame does not advance simulation while look freeze is active');
assert.match(index, /id="volume-fire-scale"/, 'Volume tab exposes emitter scale control');
assert.match(index, /<span class="slider-label">Emitter Scale<\/span>\s*<input type="range" id="volume-fire-scale"/, 'Fire Scale is labeled by its honest emitter/source role');
assert.match(index, /volume_fire_scale/, 'URL route can override emitter scale');
assert.match(index, /fireScale/, 'Volume controls carry emitter scale into the renderer');
assert.match(index, /detailScale/, 'Volume controls carry fine-detail scale into the renderer');
assert.match(index, /id="volume-plume-height"/, 'Volume tab exposes plume height/world-rise scale control');
assert.match(index, /volume_plume_height/, 'URL route can override plume height/world-rise scale');
assert.match(index, /plumeHeight/, 'Volume controls carry plume height/world-rise scale into the renderer');
assert.doesNotMatch(index, /id="volume-flame-life"|volume_flame_life|flameLife|Flame Life/, 'withdrawn Flame Life control must not ship as a misleading flame-height control');
assert.match(index, /id="volume-wind-strength"/, 'Volume tab exposes explicit volume wind strength control');
assert.match(index, /id="volume-wind-angle"/, 'Volume tab exposes explicit volume wind direction control');
assert.match(index, /id="volume-wind-height"/, 'Volume tab exposes explicit volume wind height/ramp control');
assert.match(index, /volume_wind_strength/, 'URL route can override explicit volume wind strength');
assert.match(index, /volume_wind_angle/, 'URL route can override explicit volume wind direction');
assert.match(index, /volume_wind_height/, 'URL route can override explicit volume wind height/ramp');
assert.match(index, /windStrength/, 'Volume controls carry explicit wind strength into the renderer');
assert.match(index, /windAngle/, 'Volume controls carry explicit wind direction into the renderer');
assert.match(index, /windHeight/, 'Volume controls carry explicit wind height/ramp into the renderer');
assert.match(index, /id="volume-render-scale"/, 'Volume tab exposes internal render-scale control');
assert.match(index, /id="volume-render-scale" min="0\.1" max="1" step="any"/, 'Volume tab gives the operator exact numeric control over the requested 10–100% raymarch range');
assert.match(index, /renderScale: readVolumeRenderScaleControlValue\(\)/, 'runtime uses the exact full-range render resolution');
assert.match(index, /volume_render_scale/, 'URL route can override internal render scale');
assert.match(index, /renderScale/, 'Volume controls carry internal render scale into the renderer');
assert.match(index, /data-volume-control-section="visual-tuning"[\s\S]*id="volume-fire-licks"[\s\S]*id="volume-projection"[\s\S]*id="volume-input-radius"[\s\S]*id="volume-flow-rate"[\s\S]*data-volume-control-section="render-budget"/, 'Volume tab groups visual tuning knobs with hidden cost consequences before the obvious render budget controls');
assert.match(index, /data-volume-visual-cost-knob="branch-threshold"[\s\S]*id="volume-fire-licks"/, 'Fire Licks is marked as a visual knob that can enable extra sim shader work');
assert.match(index, /data-volume-visual-cost-knob="projection-pass-gate"[\s\S]*id="volume-projection"/, 'Projection is marked as a visual knob that can gate pressure projection work');
assert.match(index, /data-volume-visual-cost-knob="occupied-volume"[\s\S]*id="volume-flow-rate"/, 'Flow Rate is marked as a visual knob that can expand occupied sim/raymarch volume');
assert.match(index, /volume_pressure_iterations/, 'URL route can override staged pressure iteration count for sim-throughput probes');
assert.match(index, /pressureIterations/, 'Volume controls carry staged pressure iteration override into the renderer');
assert.match(index, /volume_pressure_strategy/, 'URL route can select staged pressure strategy for spatial-quality probes');
assert.match(index, /routedVolumePressureStrategy/, 'Volume controls carry routed pressure strategy identity into the renderer');
assert.match(index, /pressureStrategy/, 'Volume controls expose effective pressure strategy to the renderer');
assert.match(index, /volume-pressure-mode/, 'Volume cockpit exposes a live pressure mode selector for tier/global comparison');
assert.match(index, /global-p3/, 'Volume pressure mode selector can switch to full global pressure3');
assert.match(index, /routed-global/, 'Volume pressure mode preserves non-selector routed global counts such as pressure4');
assert.match(index, /pressureMode/, 'Volume controls derive pressure strategy and iterations from the live pressure mode selector');
assert.match(index, /params\.get\('volume_pressure_mode'\)/, 'URL route replays the visible pressure mode selector instead of dropping saved P3/Tiered state');
assert.match(index, /hasExplicitPressureRoute/, 'named tall-plume presets keep their pressure mode unless the URL explicitly overrides pressure');
assert.match(index, /effectivePressureModeLabel/, 'Pressure selector has an effective label path that exposes resolved default pressure count');
assert.match(index, /pressureEffectiveLabel/, 'Volume controls carry the visible effective pressure label into renderer debug state');
assert.match(index, /Default P\$\{effectiveIterations\}/, 'Default pressure mode label prints the resolved pressure iteration count');
assert.match(index, /Route P\$\{effectiveIterations\}/, 'Routed global pressure mode label prints the exact routed pressure iteration count');
assert.match(index, /volume-pressure-tier-overlay/, 'Volume cockpit exposes a pressure-tier overlay opacity slider');
assert.match(index, /volume-pressure-tier-lower-max/, 'Volume cockpit exposes the pressure2 lower-slab max threshold');
assert.match(index, /volume-pressure-tier-hero-min/, 'Volume cockpit exposes the pressure3 hero-band min threshold');
assert.match(index, /volume-pressure-tier-hero-max/, 'Volume cockpit exposes the pressure3 hero-band max threshold');
assert.match(index, /id="volume-pressure-tier-lower-max" min="0\.10" max="0\.98"/, 'Pressure2 tier max slider can reach the upper flame/smoke transition band');
assert.match(index, /id="volume-pressure-tier-hero-min" min="0" max="0\.95"/, 'Pressure3 tier min slider can move out of the bottom fire root');
assert.match(index, /id="volume-pressure-tier-hero-max" min="0\.02" max="0\.98"/, 'Pressure3 tier max slider can reach the upper flame/smoke transition band');
assert.match(index, /volume_pressure_tier_overlay/, 'URL route can seed the pressure-tier overlay opacity');
assert.match(index, /volume_pressure_tier_lower_max/, 'URL route can seed the pressure2 lower-slab max threshold');
assert.match(index, /volume_pressure_tier_hero_min/, 'URL route can seed the pressure3 hero-band min threshold');
assert.match(index, /volume_pressure_tier_hero_max/, 'URL route can seed the pressure3 hero-band max threshold');
assert.match(index, /pressureTierOverlay/, 'Volume controls expose pressure-tier overlay opacity to the renderer');
assert.match(index, /pressureTierLowerMax/, 'Volume controls expose pressure2 lower-slab max threshold to the renderer');
assert.match(index, /pressureTierHeroMin/, 'Volume controls expose pressure3 hero-band min threshold to the renderer');
assert.match(index, /pressureTierHeroMax/, 'Volume controls expose pressure3 hero-band max threshold to the renderer');
assert.match(index, /volume_sim_profile/, 'URL route can request sim-cost profiling without changing the render contract');
assert.match(index, /simProfile/, 'Volume controls carry sim profile request identity into the renderer');
assert.match(index, /<option value="128">128<\/option>/, 'Volume grid selector exposes the 128-cell width independently of height');
assert.match(index, /<option value="160">160<\/option>/, 'Volume grid selector exposes the 160-cell width independently of height');
assert.match(index, /id="volume-ray-budget-gamut"/, 'Volume tab exposes the coupled ray-budget gamut control');
assert.match(index, /id="volume-ray-budget-handle"/, 'ray-budget gamut exposes a draggable handle');
assert.match(index, /id="volume-ray-budget-readout"/, 'ray-budget gamut exposes a compact effective budget readout');
for (const preset of ['draft', 'live', 'rich', 'hero']) {
  assert.match(index, new RegExp(`data-volume-budget-preset="${preset}"`), `Volume tab exposes ${preset} ray-budget preset`);
}
assert.match(index, /VOLUME_RAY_BUDGET_PRESETS/, 'ray-budget presets have stable source identities');
assert.match(index, /rayBudgetGamutPointFromControls/, 'ray-budget gamut maps slider values to a 2D point');
assert.match(index, /applyRayBudgetGamutPoint/, 'ray-budget gamut maps pointer positions back to sliders');
assert.match(index, /syncRayBudgetGamutFromControls/, 'ray-budget gamut stays coupled when individual sliders move');
assert.match(index, /applyRayBudgetPreset/, 'ray-budget preset buttons jump to stable budget positions');
assert.match(index, /volume_ray_budget_preset/, 'URL route can select a named ray-budget preset');
assert.match(index, /<option value="96" selected>96<\/option>/, 'smoke route defaults to the 96-cell width independently of height');
assert.match(index, /id="volume-input-radius"/, 'Volume tab exposes an input radius control');
assert.match(index, /id="volume-flow-rate"/, 'Volume tab exposes an input flow-rate control');
assert.match(index, /id="volume-scene"/, 'Volume tab exposes an explicit volume scene selector');
assert.match(index, /canonical_plume/, 'Volume tab exposes a minimal canonical plume proof scene');
assert.match(index, /value="flame"[^>]*>Flame/, 'the legacy select admits only the single simulator');
assert.match(index, /TALL_PLUME_OPERATOR_PRESETS/, 'tall plume operator-found regimes have stable named route presets');
assert.match(index, /operator_fire_0622/, 'tall plume preserves the 2026-06-22 operator-found fire/smoke wind foothold by stable route identity');
assert.match(index, /operator_fire_0622[\s\S]*detailScale:\s*1\.00/, 'operator fire foothold parks detail scale at a neutral value while legacy detail overlay is quarantined');
assert.match(index, /volume_tall_preset/, 'URL route can select a named tall-plume operator preset');
assert.match(index, /applyTallPlumeOperatorPreset/, 'tall-plume operator preset application is a named control path before wind route overrides');
assert.match(index, /function isKaminosVolumeSmokeRoute/, 'volume smoke routes have a named isolation predicate for optional app-surface startup');
assert.match(index, /<link rel="icon" href="data:,">/, 'static volume smoke routes do not emit a favicon 404 before visual evidence');
assert.match(index, /isKaminosVolumeSmokeRoute\(\)[\s\S]*\/api\/runtime-config/, 'volume smoke routes skip optional runtime-config fetches on static smoke servers');
assert.match(index, /id="finger-juice-viewport-frame"[\s\S]*data-src="lerms-finger-juice\.html\?lerms_world_finger_juice=1"[\s\S]*loading="lazy"/, 'volume smoke startup does not eager-load the hidden Finger Juice child route');
assert.match(index, /if \(isKaminosVolumeSmokeRoute\(\)\)[\s\S]*asset browser deferred[\s\S]*Greenroom browse deferred/, 'volume smoke startup defers optional Greenroom/API browser fetches');
assert.match(index, /mainRendererNeeded = !volumeSmokeRouteActive/, 'volume smoke routes skip idle main-renderer draws while native volume canvas owns the viewport');
assert.match(index, /volume_reaction_fuel/, 'URL route can starve tall-plume reaction fuel without rewriting visual controls');
assert.match(index, /routedVolumeReactionFuelScale/, 'route-only reaction fuel scale is preserved outside the visible cockpit sliders');
assert.match(index, /reactionFuelScale/, 'Volume controls carry tall-plume reaction fuel scale into renderer debug state');
assert.match(index, /volume_lifecycle_effect/, 'URL route can request a lifecycle visual effect without rewriting cockpit fire controls');
assert.match(index, /volume_lifecycle_t/, 'URL route can pin lifecycle effect phase for deterministic visual witnesses');
assert.match(index, /volume_quench_vapor/, 'URL route can set cheap quench-vapor strength for failure snuff visuals');
assert.match(index, /volume_runtime_quality/, 'URL route can request a pressure-aware volume runtime quality mode');
assert.match(index, /volume_gpu_pressure/, 'URL route can pass host GPU pressure into the volume runtime ladder');
assert.match(index, /volume_quality_reason/, 'URL route can preserve the host reason for a quality fallback');
assert.match(index, /routedVolumeLifecycleEffect/, 'route-only lifecycle effect is preserved outside visible cockpit sliders');
assert.match(index, /routedVolumeLifecycleT/, 'route-only lifecycle phase is preserved outside visible cockpit sliders');
assert.match(index, /routedVolumeQuenchVapor/, 'route-only quench-vapor strength is preserved outside visible cockpit sliders');
assert.match(index, /routedVolumeRuntimeQuality/, 'route-only runtime quality is preserved outside visible cockpit sliders');
assert.match(index, /applyVolumeRuntimeQualityLadder/, 'runtime quality ladder applies explicit effective control downgrades');
assert.match(index, /canonicalPlumeReadoutActive/, 'volume readout distinguishes canonical labels from ordinary scene truth');
assert.match(index, /sceneContentLabel/, 'non-canonical volume readout derives content from live scene controls instead of canonical defaults');
assert.match(index, /BONFIRE_VOLUME_CAMERA_FRAME/, 'Bonfire scene has a straight-on camera frame that does not make vertical smoke look wind-blown');
assert.match(index, /volume_scene/, 'URL route can select a named volume scene');
assert.match(index, /applyVolumeScenePreset/, 'Volume route applies stable scene presets before per-control overrides');
assert.match(index, /id="volume-input-radius"[^>]+value="0\.12"/, 'smoke route defaults to the accepted input radius');
assert.match(index, /id="volume-flow-rate"[^>]+value="0\.15"/, 'smoke route defaults to the accepted input flow rate');
assert.match(index, /id="volume-projection"/, 'Volume tab exposes a pressure/projection control');
assert.match(index, /id="volume-flow-debug"/, 'Volume tab exposes a flow diagnostic overlay control');
assert.match(index, /id="volume-oracle-activity-cue"/, 'Volume tab exposes a truth-oracle scalar activity receiver master toggle');
assert.match(index, /id="volume-oracle-activity-display"/, 'Volume tab exposes an inert scalar activity display control');
assert.match(index, /id="volume-oracle-activity-curl-noise"/, 'Volume tab exposes a scalar activity curl-noise receiver gain');
assert.match(index, /id="volume-oracle-activity-vorticity"/, 'Volume tab exposes a scalar activity vorticity receiver gain');
assert.match(index, /id="volume-oracle-activity-material"/, 'Volume tab exposes a scalar activity material/interface receiver gain');
assert.match(index, /volume_oracle_activity_cue/, 'Basin URLs preserve scalar activity receiver master toggle');
assert.match(index, /volume_oracle_activity_curl_noise/, 'Basin URLs preserve scalar activity curl-noise receiver gain');
assert.match(index, /volume_oracle_activity_vorticity/, 'Basin URLs preserve scalar activity vorticity receiver gain');
assert.match(index, /volume_oracle_activity_material/, 'Basin URLs preserve scalar activity material receiver gain');
assert.match(core, /TRUTH_ORACLE_ACTIVITY_RECEIVER_IDENTITY\s*=\s*'truth-oracle-scalar-activity-receiver-v0'/, 'volume core names the truth-oracle scalar activity receiver route');
assert.match(core, /TRUTH_ORACLE_ACTIVITY_CUE_AUTHORITY\s*=\s*'truth-high-diagnostic-activity-projected-to-receiver-grid-v0'/, 'volume core preserves truth-derived cue authority separately from learned/product inputs');
assert.match(core, /oracle_activity_controls:\s*vec4<f32>/, 'fluid uniforms carry scalar activity receiver hook controls');
assert.match(core, /oracle_activity_controls2:\s*vec4<f32>/, 'fluid uniforms carry scalar activity cue source/display controls');
assert.match(core, /truthOracleActivityCueAtCell/, 'fluid shader samples a named scalar activity cue field');
assert.match(core, /oracleActivityCurlForce/, 'fluid shader exposes a scalar-activity-gated field-derived curl-force hook');
assert.match(core, /oracleActivityVorticityConfinement/, 'fluid shader exposes scalar activity gated vorticity confinement hook');
assert.match(core, /oracleActivityMaterialBirth/, 'fluid shader exposes scalar activity gated material/interface birth hook');
assert.match(core, /setTruthOracleActivityCue/, 'volume prototype exposes a public API for feeding projected truth activity cue buffers');
assert.match(core, /function normalizeScalarActivityCueGridSize/, 'truth-oracle cue source grids use a dedicated positive-integer normalizer instead of supported receiver-grid snapping');
assert.match(core, /sourceGrid\s*=\s*normalizeScalarActivityCueGridSize/, 'truth-oracle cue upload preserves source-grid identity before resampling to the receiver grid');
assert.match(core, /scalarActivityReceiver/, 'debug state reports scalar activity receiver identity, cue authority, toggles, gains, and effective source');
assert.match(core, /requestedCueAuthority/, 'scalar activity receiver debug state distinguishes requested cue authority');
assert.match(core, /effectiveCueAuthority/, 'scalar activity receiver debug state distinguishes effective cue authority');
assert.match(core, /externalCueCellCount/, 'scalar activity receiver debug state reports whether an external cue buffer is actually present');
assert.match(index, /id="volume-pyro-dynamic-atlas"/, 'Volume tab exposes an inspectable Pyro dynamic detail atlas canvas');
assert.match(index, /id="volume-pyro-detail-state"/, 'Volume readout exposes Pyro dynamic detail reset/live state');
assert.match(index, /id="volume-pyro-detail-confidence"/, 'Volume readout exposes Pyro dynamic detail confidence');
assert.match(index, /id="volume-pyro-detail-reset"/, 'Volume readout exposes Pyro dynamic detail reset reason');
assert.match(index, /id="volume-canonical-spread"/, 'Volume tab exposes a canonical plume scalar-spread cockpit control');
assert.match(index, /id="volume-canonical-centerline"/, 'Volume tab exposes a canonical plume centerline-relief cockpit control');
assert.match(index, /id="volume-canonical-body-balance"/, 'Volume tab exposes a canonical plume body/chimney balance cockpit control');
assert.match(index, /CANONICAL_VOLUME_HIDDEN_CONTROLS/, 'canonical plume has an explicit hidden-control registry');
assert.match(index, /CANONICAL_VOLUME_HIDDEN_SECTIONS/, 'canonical plume has an explicit hidden-section registry');
// volume-radiance and volume-glow left this registry with the legacy material laws (2026-10-18).
// volume-radiance, volume-glow (2026-10-18), volume-fire and volume-detail-scale (2026-10-21) left this registry when they were retired.
for (const hiddenCanonicalControl of [
  'volume-microdetail',
  'volume-interface-shred',
  'volume-fire-licks',
  'volume-fire-scale',
  'volume-wind-strength',
  'volume-wind-angle',
  'volume-wind-height',
]) {
  assert.match(
    index,
    new RegExp(`CANONICAL_VOLUME_HIDDEN_CONTROLS[\\s\\S]*${hiddenCanonicalControl}`),
    `canonical plume hides ${hiddenCanonicalControl} from the operator cockpit`,
  );
}
assert.match(index, /id="volume-ray-budget-section"/, 'ray-budget gamut has a stable wrapper for canonical plume visibility');
assert.match(index, /CANONICAL_VOLUME_HIDDEN_SECTIONS[\s\S]*volume-ray-budget-section/, 'canonical plume hides the coupled ray-budget gamut section');
assert.match(index, /closest\('\.slider-row'\)/, 'canonical plume hides whole slider rows instead of disabling only bare inputs');
assert.match(index, /NON_CANONICAL_VOLUME_HIDDEN_CONTROLS/, 'non-canonical scenes have an explicit hidden-control registry for canonical-only controls');
for (const canonicalOnlyControl of [
  'volume-canonical-spread',
  'volume-canonical-centerline',
  'volume-canonical-body-balance',
]) {
  assert.match(
    index,
    new RegExp(`NON_CANONICAL_VOLUME_HIDDEN_CONTROLS[\\s\\S]*${canonicalOnlyControl}`),
    `non-canonical scenes hide canonical-only ${canonicalOnlyControl} from the operator cockpit`,
  );
}
assert.match(index, /volume_input_radius/, 'URL route can override the fluid input radius');
assert.match(index, /volume_flow_rate/, 'URL route can override the fluid input flow rate');
assert.match(index, /volume_density/, 'URL route can override plume density for visual torture witnesses');
assert.match(index, /volume_smoke/, 'URL route can override smoke visibility for fire/smoke separation witnesses');
assert.match(index, /volume_projection/, 'URL route can override pressure/projection strength');
assert.match(index, /volume_flow_debug/, 'URL route can override flow diagnostic overlay');
assert.match(index, /volume_pyro_detail/, 'URL route can enable the Pyro dynamic detail debug atlas');
assert.match(index, /volume_pyro_material_gain/, 'URL route can enable visible Pyro material-memory renderer coupling');
assert.match(index, /volume_canonical_spread/, 'URL route can override canonical plume scalar-spread cockpit gain');
assert.match(index, /volume_canonical_centerline/, 'URL route can override canonical plume centerline-relief cockpit gain');
assert.match(index, /volume_canonical_body_balance/, 'URL route can override canonical plume body/chimney cockpit gain');
assert.match(index, /volume_canonical_source_mode/, 'URL route can select canonical passive/forced/buoyant source physics mode');
assert.match(index, /volume_canonical_render_mode/, 'URL route can select canonical smoke-only render diagnostic mode');
assert.match(index, /volume_canonical_motion_mode/, 'URL route retains compatibility custody for legacy canonical motion requests');
assert.match(index, /volume_canonical_content/, 'URL route can select canonical smoke/fire content mode');
assert.match(index, /CANONICAL_VOLUME_CONTENT_MODE_VALUES/, 'canonical plume has stable content-mode identities for smoke/fire separation');
assert.match(index, /honest_smoke_0622/, 'canonical plume preserves the operator-accepted honest smoke route by stable preset identity');
assert.match(index, /fire_smoke/, 'canonical content route supports a combined fire and smoke proof mode');
assert.match(index, /passive_bottom/, 'canonical source route supports a passive bottom-source scalar proof mode');
assert.match(index, /buoyant_bottom/, 'canonical source route supports an explicit buoyant bottom-source proof mode');
assert.match(index, /volume_canonical_source_y/, 'URL route can override canonical source height for bottom-source physics proofs');
assert.match(index, /volume_canonical_injection/, 'URL route can isolate canonical source injection momentum from flow rate');
assert.match(index, /volume_canonical_buoyancy/, 'URL route can isolate canonical buoyant lift from source injection');
assert.match(index, /CANONICAL_VOLUME_MACRO_PRESETS/, 'canonical plume has named macro presets for operator-accepted regimes');
assert.match(index, /macro_foothold_0621/, 'canonical plume preserves the 2026-06-21 operator-accepted macro foothold by stable route identity');
assert.match(index, /volume_canonical_preset/, 'URL route can select a named canonical plume macro preset');
assert.match(index, /applyCanonicalVolumeMacroPreset/, 'canonical macro preset application is a named control path before route overrides');
assert.match(index, /canonicalMacroPreset/, 'volume controls carry effective canonical macro preset identity into renderer debug state');
assert.match(index, /canonicalRenderMode/, 'volume controls carry effective canonical render diagnostic mode into renderer debug state');
assert.match(index, /canonicalMotionRetirementIdentity/, 'volume controls carry canonical analytic motion retirement identity into renderer debug state');
assert.match(index, /canonicalContentMode/, 'volume controls carry effective canonical content mode into renderer debug state');
assert.match(index, /volume-canonical-render-mode-state'\)\.textContent/, 'volume readout prints effective canonical render diagnostic mode');
assert.match(index, /volume-canonical-motion-mode-state'\)\.textContent/, 'volume readout prints the canonical analytic motion retirement state');
assert.match(index, /volume-canonical-content-mode-state'\)\.textContent/, 'volume readout prints effective canonical content mode');
assert.match(index, /density:\s*0\.45/, 'canonical macro foothold preserves the operator-tuned low density control');
assert.match(index, /smoke:\s*2\.80/, 'canonical macro foothold preserves the operator-tuned smoke visibility control');
assert.match(index, /flowRate:\s*1\.90/, 'canonical macro foothold preserves the operator-tuned flow-rate control');
assert.match(index, /volume_microdetail/, 'URL route can override transported microdetail strength');
assert.match(index, /volume_curl/, 'URL route can override curl strength for force-isolation witnesses');
assert.match(index, /volume_interface_shred/, 'URL route can override interface shredding strength');
assert.match(index, /volume_fire_licks/, 'URL route can override fire-lick breakup strength');
assert.match(index, /Math\.min\(10, routeInterfaceShred\)/, 'Shred route override clamps to the widened operator tuning ceiling');
assert.match(index, /Math\.min\(10, routeFireLicks\)/, 'Fire Licks route override clamps to the widened operator tuning ceiling');
assert.match(index, /volume_radiance/, 'URL route can override fire radiance strength');
assert.match(index, /volume_glow/, 'URL route can override emissive glow strength');
assert.match(index, /params\.has\('volume_input_radius'\)/, 'missing input-radius route param must not clamp the default to zero');
assert.match(index, /params\.has\('volume_flow_rate'\)/, 'missing flow-rate route param must not clamp the default to zero');
assert.match(index, /params\.has\('volume_projection'\)/, 'missing projection route param must not clamp the default to zero');
assert.match(index, /normalizeBonfireAblationControls/, 'bonfire ablation controls are normalized before reaching renderer/debug state');
assert.match(index, /volume_bonfire_recenter/, 'URL route can disable bonfire recentering/scalar symmetry for ablation');
assert.match(index, /volume_bonfire_lateral_damping/, 'URL route can disable bonfire non-wind lateral damping for ablation');
assert.match(index, /volume_bonfire_shear/, 'URL route can disable bonfire layer shear for ablation');
assert.match(index, /volume_bonfire_detail_forces/, 'URL route can disable bonfire detail-force injection for ablation');
assert.match(index, /volume_bonfire_depinch/, 'URL route can disable bonfire upper depinch outflow for ablation');
assert.match(index, /volume_bonfire_projection/, 'URL route can isolate bonfire projection strength without rewriting the base pressure slider');
assert.match(index, /volume_bonfire_temporal/, 'URL route can isolate bonfire temporal accumulation without rewriting the base temporal slider');
assert.match(index, /volume_bonfire_instability_probe/, 'URL route can opt into a named non-production instability probe');
assert.match(index, /params\.has\('volume_flow_debug'\)/, 'missing flow-debug route param must not clamp the default to zero');
assert.match(index, /rotateSpeed\s*=\s*-\d/, 'viewport orbit drag uses object-turntable rotation direction');
assert.match(index, /screenSpacePanning\s*=\s*true/, 'viewport pan tracks screen-space pointer movement');

assert.match(core, /export function createKaminosVolumePrototype/, 'volume module exports createKaminosVolumePrototype');
assert.match(core, /kaminos-volume-prototype-v0/, 'volume module exposes stable witness identity');
assert.match(core, /native-3d-compute-fluid-raymarch-v0/, 'volume module records compute-backed fluid route identity');
assert.match(core, /DEFAULT_GRID_SIZE\s*=\s*96/, 'smoke route defaults to the operator-found 96^3 grid size');
assert.match(core, /SUPPORTED_GRID_SIZES/, 'fluid sim declares supported resolution choices');
assert.match(core, /'canonical_plume'/, 'fluid sim supports a minimal canonical plume proof scene');
assert.match(core, /minimalPlumeProof/, 'debug state exposes the minimal plume proof contract identity');
assert.doesNotMatch(core, /canonicalPlumeScene[\s\S]{0,1600}bonfireRenderedFireEdgeCarrier/, 'canonical plume proof scene must not depend on bonfire rendered fire carriers');
assert.match(core, /canonicalSmokeFieldSlice/, 'canonical plume exposes a CPU-readback field-slice artifact instead of relying only on camera raymarch evidence');
assert.match(core, /canonical-smoke-field-slice-v0/, 'canonical plume field slice has a stable witness identity');
assert.match(core, /smoke-density-max-z-projection/, 'canonical plume field slice includes a smoke-density max-Z projection for field-shape diagnosis');
assert.match(core, /REACTION_FRONT_STAGE_IDENTITY\s*=\s*'reaction-front-stage-fields-v0'/, 'reaction-front atlas uses a stable modular stage identity');
assert.match(core, /REACTION_FRONT_ATLAS_SCHEMA\s*=\s*'kaminos\.volume\.reaction-front-atlas\.v0'/, 'reaction-front atlas reports a stable schema');
assert.match(core, /buildReactionFrontAtlas/, 'reaction-front atlas is built from the CPU fluid/front readback path');
assert.match(core, /reactionFrontAtlas/, 'sampleFrame sim readback exposes the reaction-front atlas for future live debug viewers');
assert.match(core, /heatSupport[\s\S]*fuelSupport[\s\S]*reactionPotential[\s\S]*gradientMagnitude[\s\S]*narrowFrontCandidate[\s\S]*shellCandidate/, 'reaction-front atlas stages keep source support, potential, gradient, narrow-front, and shell-candidate fields distinct');
assert.match(core, /labelOverlay:\s*true/, 'reaction-front atlas PNG declares visible panel labels for operator smoke');
assert.match(core, /drawAtlasLabel/, 'reaction-front atlas draws panel labels into the PNG pixels instead of relying only on report metadata');
assert.match(index, /data-volume-control-section="reaction-front-extractor"/, 'reaction-front extractor controls are grouped away from legacy pyro controls');
assert.match(index, /id="volume-reaction-live-view"/, 'reaction-front extractor exposes a primary-viewer live inspect selector');
assert.match(index, /<option value="boundary">boundary<\/option>/, 'reaction-front live inspect selector exposes the derived boundary candidate in the primary viewer');
assert.match(index, /<option value="boundary_fire">boundary-fire<\/option>/, 'reaction-front live inspect selector exposes the boundary-fire sheet radiance mode separately from scalar boundary inspect');
assert.match(index, /volume_reaction_live_view/, 'reaction-front live inspect selector is routeable through basin URLs');
assert.match(index, /reactionLiveView[\s\S]*fireRenderMode:\s*reactionLiveView !== 'off' \? 'inspect'/, 'reaction-front live inspect selector overrides the primary renderer into inspect mode');
assert.match(index, /reaction-live-view-shader-inspect-v0/, 'reaction-front live inspect labels its shader-side approximation boundary');
assert.match(index, /reaction-boundary-live-controls-v0/, 'reaction-front live boundary controls declare a stable route/debug identity');
assert.match(index, /reactionBoundaryControls:\s*\{[\s\S]*gradientGain[\s\S]*supportThermal[\s\S]*displayOpacity/, 'reaction-front live boundary controls reach the runtime controls object as a grouped contract');
assert.match(index, /reaction-boundary-fire-controls-v0/, 'reaction-front boundary-fire controls declare a stable sheet-radiance identity');
assert.match(index, /reactionBoundaryFireControls:\s*\{[\s\S]*ridgeGain[\s\S]*tipBreakup[\s\S]*cleanBlue[\s\S]*fireLuma/, 'reaction-front boundary-fire controls reach the runtime controls object as a grouped contract');
assert.match(core, /shellInspectModeValue[\s\S]*mode === 'boundary'[\s\S]*return 8[\s\S]*mode === 'boundary_fire'[\s\S]*return 9/, 'volume shader routing maps boundary and boundary-fire inspect modes to distinct mode ids');
assert.match(core, /let shellInspectMode = clamp\(u\.topology_shell_controls\.y,\s*0\.0,\s*9\.0\)/, 'shader inspect mode clamp includes boundary-fire');
assert.match(core, /boundary_fire_structure:\s*vec4<f32>[\s\S]*boundary_fire_color:\s*vec4<f32>[\s\S]*boundary_fire_display:\s*vec4<f32>/, 'shader carries dedicated boundary-fire uniforms instead of stealing unrelated controls');
assert.match(core, /fn liveBoundarySupportAt/, 'shader computes live boundary support from sampled carriers instead of trusting a named front field');
assert.match(core, /inspectBoundaryMask[\s\S]*boundaryCandidate/, 'shader primary-view inspect path includes a derived boundary candidate signal');
assert.match(core, /boundaryFireRidge[\s\S]*boundaryFireTipGate[\s\S]*boundaryFireErosion/, 'shader boundary-fire mode derives ridge, dynamic tip, and topology erosion terms');
assert.match(core, /cleanFuelColor[\s\S]*sootMaturity[\s\S]*sootThermalColor[\s\S]*boundaryFireColor/, 'shader boundary-fire color mixes clean fuel color toward soot-rich thermal color');
assert.match(core, /reactionBoundaryControls/, 'renderer debug state exposes effective live boundary controls for witness reports');
assert.match(core, /reactionBoundaryFireControls/, 'renderer debug state exposes effective boundary-fire controls for witness reports');
assert.match(index, /reactionHeatMin:\s*parseFloat\(document\.getElementById\('volume-reaction-heat-min'\)\.value\)/, 'reaction-front heat threshold reaches the runtime controls object');
assert.match(index, /volume-reaction-atlas-canvas/, 'reaction-front atlas has an in-page visual capture surface for operator smoke');
assert.match(index, /captureVolumeReactionAtlas/, 'reaction-front atlas capture path can draw sampleFrame output without rewiring the renderer');
assert.match(core, /normalizeReactionFrontAtlasControls/, 'reaction-front atlas has a normalized controls contract independent of legacy pyro controls');
assert.match(core, /reactionFrontAtlasControls/, 'reaction-front atlas readback returns effective extractor controls');
assert.match(core, /stretchErode[\s\S]*divergenceGain[\s\S]*curlWarp[\s\S]*shellContrast/, 'reaction-front atlas supports stretch erosion, divergence gating, curl warp, and contrast shaping knobs');
assert.match(reactionFrontAtlasWitness, /kaminos\.volume-reaction-front-atlas-witness\.v0/, 'reaction-front atlas witness declares its schema');
assert.match(reactionFrontAtlasWitness, /reactionFrontAtlas/, 'reaction-front atlas witness consumes sampleFrame sim readback atlas data');
assert.match(reactionFrontAtlasWitness, /failure_phase/, 'reaction-front atlas witness writes failure phase for false-closure diagnosis');
assert.match(reactionFrontAtlasWitness, /primary_output_written/, 'reaction-front atlas witness records whether primary visual output was actually written');
assert.match(reactionFrontAtlasWitness, /requestedRoute[\s\S]*effectiveRoute/, 'reaction-front atlas witness records requested and effective route identity');
assert.match(reactionFrontAtlasWitness, /reactionFrontAtlas\.controls/, 'reaction-front atlas witness records effective extractor controls in its report');
assert.match(reactionFrontAtlasWitness, /uiCaptureSummary[\s\S]*__kaminosCaptureVolumeReactionAtlas/, 'reaction-front atlas witness exercises the in-page capture hook');
assert.match(core, /let ndc = vec2<f32>\(in\.uv\.x \* 2\.0 - 1\.0, in\.uv\.y \* 2\.0 - 1\.0\)/, 'raymarch screen-to-world Y must match source/readback field orientation');
assert.doesNotMatch(core, /canonicalFrozenMotion|canonicalPhaseTime/, 'canonical plume transport no longer owns a procedural entrainment clock');
assert.doesNotMatch(core, /let canonicalEntrainmentVelocity =[^;]*(bonfire|fireLick|frontTopology|radiance|microdetail)/, 'canonical entrainment must stay smoke-only and must not reintroduce bonfire/fire/detail carriers');
assert.doesNotMatch(core, /let canonicalScalarSpread =[^;]*(fire|radiance|microdetail|frontTopology|bonfire)/, 'canonical scalar spread must stay smoke-only and must not reintroduce bonfire/fire/detail carriers');
assert.match(core, /state\.canonicalPlumeControls/, 'debug state exposes effective canonical plume cockpit controls for witness/report identity');
assert.match(core, /macroPreset:\s*controlsSnapshot\.canonicalMacroPreset/, 'debug state exposes the effective canonical macro preset identity');
assert.match(core, /sourceMode:\s*normalizeCanonicalSourceMode\(controlsSnapshot\.canonicalSourceMode\)/, 'debug state exposes the effective canonical source mode');
assert.match(core, /sourceModeValue:\s*uniforms\[67\]/, 'debug state exposes the effective canonical source mode numeric identity');
assert.match(core, /sourceY:\s*uniforms\[68\]/, 'debug state exposes the effective canonical source height');
assert.match(core, /sourceInjection:\s*uniforms\[69\]/, 'debug state exposes the effective canonical source injection gain');
assert.match(core, /buoyancyLift:\s*uniforms\[70\]/, 'debug state exposes the effective canonical buoyancy lift gain');
assert.match(core, /renderMode:\s*normalizeCanonicalRenderMode\(controlsSnapshot\.canonicalRenderMode\)/, 'debug state exposes the effective canonical render diagnostic mode');
assert.match(core, /motionRetirementIdentity:\s*canonicalMotionReceipt\.identity/, 'debug state exposes the canonical analytic motion retirement identity');
assert.match(core, /requestedRetiredMotionMode:\s*canonicalMotionReceipt\.requested/, 'debug state distinguishes the legacy canonical motion request from effective state');
assert.match(core, /uniforms\[73\]\s*=\s*CANONICAL_ANALYTIC_MOTION_RETIRED_UNIFORM_VALUE/, 'the retired Canonical motion ABI slot is reserved at explicit zero authority');
assert.match(core, /contentMode:\s*normalizeCanonicalContentMode\(controlsSnapshot\.canonicalContentMode\)/, 'debug state exposes the effective canonical content mode');
assert.doesNotMatch(core, /let canonicalPlumeBodyBalance =[^;]*(fire|radiance|microdetail|frontTopology|bonfire)/, 'canonical plume body balance must stay smoke-only and must not reintroduce bonfire/fire/detail carriers');
assert.doesNotMatch(core, /let canonicalMinimalFireBirth =[^;]*(bonfire|fireLick|frontTopology|microdetail|interfaceShred)/, 'minimal canonical fire bridge must not reintroduce bonfire/detail/front-topology carriers');
assert.match(core, /canonicalSourceControlSignature/, 'canonical plume has a named source-control signature for trusted cockpit tuning');
assert.match(core, /canonical-source-control-change/, 'canonical source-control edits record a durable fluid reset reason');
assert.match(core, /sourceStateResetNeeded[\s\S]*rebuildFluidState\(requestedGrid, 'canonical-source-control-change'\)/, 'canonical source-control edits rebuild the live fluid field on the sole simulation grid');
assert.match(core, /state\.fluidStateResetReason/, 'debug state exposes why the live fluid field was rebuilt');
assert.match(core, /state\.fluidStateResetCount/, 'debug state exposes source-control fluid reset count');
assert.match(core, /SUPPORTED_GRID_SIZES\s*=\s*\[[^\]]*128[^\]]*160[^\]]*\]/s, 'fluid sim supports bounded larger 128^3 and 160^3 sweep grids');
assert.match(core, /maxStorageBufferBindingSize/, 'larger sim grids request the required WebGPU storage-buffer binding limit');
assert.match(core, /FLUID_SLOTS_PER_CELL\s*=\s*4/, 'fluid sim stores a distinct transported microdetail slot beyond fire and smoke material channels');
assert.doesNotMatch(core, /FLUID_SLOTS_PER_CELL\s*=\s*[5-9]/, 'transported emission detail must reuse existing fire storage instead of adding a fifth fluid slot');
assert.match(core, /FLUID_COMPONENTS\s*=\s*FLUID_SLOTS_PER_CELL\s*\*\s*4/, 'fluid component count derives from the four slot layout');
assert.match(core, /FRONT_FIELD_IDENTITY\s*=\s*'combustion-front-topology-sidecar-v0'/, 'bonfire front topology sidecar has a stable route identity');
assert.match(core, /function frontFieldBufferBytes\(gridSize,\s*gridHeight\s*=\s*gridSize,\s*gridDepth\s*=\s*gridSize\)/, 'front topology sidecar has an explicit scalar byte-size function for rectangular grids');
assert.match(core, /function frontFieldBufferBytes\(gridSize,\s*gridHeight\s*=\s*gridSize,\s*gridDepth\s*=\s*gridSize\)\s*\{\s*return gridCellCount\(gridSize, gridHeight, gridDepth\)\s*\*\s*Float32Array\.BYTES_PER_ELEMENT/, 'front topology sidecar stores one scalar per rectangular simulation cell, not a fifth vec4 fluid slot');
assert.match(core, /frontBuffers\s*=\s*\[\]/, 'front topology sidecar owns ping-ponged GPU buffers');
assert.match(core, /state\.frontFieldIdentity/, 'debug state exposes the effective front topology sidecar identity');
assert.match(core, /state\.frontFieldBytes/, 'debug state exposes front topology sidecar byte cost');
assert.match(core, /MAX_EXTERNAL_EMITTERS/, 'fluid sim declares a bounded external emitter capacity');
assert.match(core, /externalEmitterBuffer/, 'fluid sim owns an external emitter storage buffer');
assert.match(core, /ExternalEmitter/, 'WGSL shader declares an external emitter struct');
assert.match(core, /externalEmitters/, 'WGSL shader binds external emitter data');
assert.match(core, /externalEmitterInfluence/, 'fluid compute shader evaluates segment/capsule external emitters');
assert.match(core, /applyExternalEmitterInjection/, 'fluid compute shader injects external emitters into real smoke/fire fields');
assert.match(core, /setExternalEmitters/, 'volume prototype exposes a public external emitter API');
assert.match(core, /normalizeExternalEmitters/, 'external emitter API normalizes and bounds caller-provided emitter payloads');
assert.match(core, /syntheticHandTrailEmitters/, 'volume prototype can generate synthetic hand-trail emitters for witness smoke');
assert.match(core, /externalEmitterCoordinateSpace/, 'debug state records external emitter coordinate space');
assert.match(core, /externalEmitterCount/, 'debug state records effective external emitter count');
assert.match(core, /externalEmitterAgeMs/, 'debug state records external emitter age for stale-input diagnosis');

const fieldSliceWitnessPath = join(root, 'volume-witness.mjs');
const fieldSliceWitness = existsSync(fieldSliceWitnessPath) ? readFileSync(fieldSliceWitnessPath, 'utf8') : '';
assert.match(fieldSliceWitness, /--field-slice/, 'volume witness accepts an explicit field-slice artifact path');
assert.match(fieldSliceWitness, /canonicalFieldSlice/, 'volume witness reports canonical field-slice evidence');
assert.match(fieldSliceWitness, /canonicalPlumeControls/, 'volume witness reports effective canonical cockpit controls by stable identity');
assert.match(fieldSliceWitness, /expectedCanonicalMacroPreset/, 'volume witness verifies requested canonical macro preset identity');
assert.match(fieldSliceWitness, /macro_foothold_0621/, 'volume witness recognizes the accepted canonical macro foothold preset');
assert.match(fieldSliceWitness, /honest_smoke_0622/, 'volume witness recognizes the accepted honest smoke preset');
assert.match(fieldSliceWitness, /expectedCanonicalContentMode/, 'volume witness verifies requested canonical content mode identity');
assert.match(fieldSliceWitness, /canonicalContentMode/, 'volume witness reports effective canonical content mode');
assert.match(fieldSliceWitness, /expectsCanonicalFireEvidence/, 'volume witness only requires canonical fire evidence when fire content is requested');
assert.match(fieldSliceWitness, /expectedCanonicalSourceMode/, 'volume witness verifies requested canonical source physics mode identity');
assert.match(fieldSliceWitness, /passive_bottom/, 'volume witness recognizes passive bottom-source proof mode');
assert.match(fieldSliceWitness, /buoyant_bottom/, 'volume witness recognizes buoyant bottom-source proof mode');
assert.match(fieldSliceWitness, /writeRgbaPng\(fieldSliceOut/, 'volume witness writes the field slice as an inspectable PNG artifact');
assert.match(fieldSliceWitness, /fieldSliceBackend:\s*'cpu-fluid-buffer-readback'/, 'field-slice report names CPU fluid-buffer readback as the evidence backend');
assert.match(core, /directCellOpticalSupportFromSlots/, 'raymarch derives skip support from native simulation-cell records');
assert.match(core, /directCellExitDistance/, 'raymarch crosses empty native cells at their geometric boundary');
assert.match(core, /let expensiveSampleBudget = select\(u32\(ceil\(steps\)\), nonRidgeOpticalCaptureHeader.sampleCount, opticalTrace\)/, 'ordinary ray setting defines a fixed expensive-sample budget; trace uses its explicit capture count');
assert.match(core, /let maxTraversalSteps = GRID_Y \* 3u \+ expensiveSampleBudget \+ 3u/, 'traversal safety derives from expanded vertical grid geometry plus the explicit sample budget');
assert.match(core, /expensiveSamples = expensiveSamples \+ 1u/, 'occupied reconstruction spends exactly one expensive sample');
assert.match(core, /let adaptiveScale = mix\(2\.65, 1\.0, fine\)/, 'adaptive march never shrinks below the baseline segment or increases expensive work');
assert.match(core, /fn segmentOpacity\(opticalDepth: f32, maxOpacity: f32\)/, 'variable-length segments integrate opacity through exponential optical depth');
assert.doesNotMatch(activeProductionCore, /\b(?:MAJORANT_GRID|majorantBuffer|encodeMajorant|historyTexture|previousViewProj|temporalAccum)\b/, 'retired acceleration and history mechanisms are absent from production core');
assert.match(core, /readFrontField/, 'WGSL has a scalar front-topology sidecar reader');
assert.match(core, /sampleFrontField/, 'WGSL has scalar front-topology sidecar interpolation separate from fire-layer sampling');
assert.match(core, /sampleWorldFrontField/, 'raymarch can sample the front topology sidecar in world space');
assert.match(core, /combustionFrontTopology/, 'shader names the independent combustion-front topology signal');
assert.match(core, /frontSrc:\s*array<f32>/, 'WGSL binds a read-only scalar front topology sidecar');
assert.match(core, /frontDst:\s*array<f32>/, 'WGSL binds a writable scalar front topology sidecar');
assert.match(core, /rebuildFluidState/, 'fluid sim can rebuild GPU state when resolution changes');
assert.match(core, /gridOverlay/, 'fluid renderer exposes grid overlay state');
assert.match(core, /gridLine/, 'fragment shader renders an active grid overlay');
assert.match(core, /curlAtCell/, 'fluid compute shader measures velocity curl for fine detail');
assert.match(core, /vorticity confinement/i, 'fluid compute shader includes explicit vorticity confinement forcing');
assert.doesNotMatch(core, /turbulentDetailForce/, 'fluid compute shader must not inject shared trigonometric detail force');
assert.match(core, /transportedDetailDirection/, 'fluid compute shader derives optional small-scale force direction from transported state');
assert.match(core, /divergenceAtCell/, 'fluid compute shader measures local divergence before projection');
assert.match(core, /pressureProjectionCorrection/, 'fluid compute shader applies an explicit pressure-like projection correction');
assert.match(core, /fieldDerivedFineScaleBreakup/, 'fluid compute shader applies controllable field-derived fine-scale breakup');
assert.match(core, /transportedMicrodetailAdvection/, 'fluid compute shader advects a distinct microdetail field');
assert.match(core, /interfaceShreddingForce/, 'fluid compute shader shreds smoke/fire interfaces from transported gradients');
assert.match(core, /fireLickBreakup/, 'fluid compute shader creates short-lived fire lick breakup from heat/fire fields');
assert.match(core, /detailScaleArtifactQuarantine/, 'tall-plume fire foothold names the legacy detail-scale artifact quarantine');
assert.match(core, /visibleDetailOverlayGain/, 'tall-plume fire foothold exposes a physical-detail overlay gain instead of letting detail scale imply realism');
assert.doesNotMatch(core, /rawDetailForce = turbulentDetailForce\(p \* \(0\.82 \+ detailScale \* 0\.30\)/, 'legacy detail scale must not directly inject a source/smoke/heat turbulent force into the tall-plume foothold');
assert.doesNotMatch(core, /transportedDetailPhaseAnchor/, 'tall-plume detail must not preserve a procedural phase domain after periodic force retirement');
assert.match(core, /rawDetailForce\s*=\s*transportedDetailDirection\(/, 'raw detail force derives from transported state');
assert.match(core, /rawMicroForce\s*=\s*transportedDetailDirection\(/, 'raw micro force derives from transported state');
assert.match(core, /rawFineBreakup\s*=\s*fieldDerivedFineScaleBreakup\(/, 'fine breakup derives from local curl and transported scalars');
assert.doesNotMatch(core, /fn\s+microDetailDomainWarp\b/, 'raymarch must not repaint transported detail through a presentation-only periodic domain warp');
assert.match(core, /microTextureSignal/, 'raymarch keeps microdetail texture separate from body density');
assert.match(core, /microBodyContribution/, 'raymarch limits microdetail contribution to visible volume body');
assert.match(core, /rayStepOpacity/, 'raymarch alpha integrates with per-step optical thickness');
assert.match(core, /raymarchInterest/, 'raymarch computes local sample interest before adapting step distance');
assert.match(core, /adaptiveRayStepScale/, 'raymarch adapts step distance instead of only changing alpha');
assert.match(core, /raymarchEarlyTermination/, 'raymarch exposes named early-termination behavior');
assert.match(core, /occupancy_controls/, 'volume uniforms carry occupancy/importance skip controls separately from adaptive rays');
assert.match(core, /directCellOpticalSupport/, 'raymarch conservatively proves native cells empty before occupancy acceleration');
assert.match(core, /emptyCellAdvance = mix\([\s\S]*dtBase[\s\S]*directCellExitDistance|directCellExitDistance\(p, rd\)[\s\S]*emptyCellAdvance = mix\([\s\S]*dtBase/, 'occupancy skip interpolates between ordinary sampling and empty-cell boundary traversal');
assert.match(core, /occupancySkipStrength/, 'shader gives conservative empty-cell acceleration an explicit bounded strength');
assert.doesNotMatch(core, /occupancySkipStepScale/, 'low reconstructed occupancy cannot discard optically supported ridge samples');
assert.match(core, /state\.occupancySkip/, 'debug state exposes effective occupancy skip strength');
assert.match(core, /state\.frontFieldReadIndex/, 'debug state exposes the current front topology read buffer index');
assert.match(core, /state\.frontFieldWriteIndex/, 'debug state exposes the current front topology write buffer index');
assert.match(core, /adaptiveRaymarch/, 'debug state exposes effective adaptive raymarch strength');
assert.match(core, /state\.retiredRaymarchControls/, 'debug state exposes compatibility stripping instead of fake effective controls');
assert.match(core, /state\.detailScaleArtifactQuarantine/, 'debug state exposes whether the legacy detail-scale artifact quarantine is active');
assert.match(core, /state\.visibleDetailOverlayGain/, 'debug state exposes whether raymarch fine-detail overlays are active for the current scene');
assert.match(core, /scale_controls/, 'volume uniforms carry fire/detail/plume scale controls');
assert.match(core, /fireScale/, 'debug state exposes apparent fire/world scale');
assert.match(core, /detailScale/, 'debug state exposes fine-detail scale');
assert.match(core, /plumeHeight/, 'debug state exposes plume height/world-rise scale');
assert.match(core, /normalizeRenderScale/, 'renderer normalizes internal render scale explicitly');
assert.match(core, /Math\.max\(0\.1,\s*Math\.min\(1,\s*requested\)\)/, 'core render-scale normalization preserves the 0.1 operator exploration floor');
assert.match(core, /displayWidth/, 'debug state preserves displayed canvas width separately from internal render width');
assert.match(core, /renderWidth/, 'debug state exposes internal render width');
assert.match(core, /renderPixelRatio/, 'debug state exposes render-to-display pixel ratio');
assert.match(core, /volumeReconstructionStyle/, 'canvas uses an explicit reconstruction/upscale style for lower internal render scale');
assert.match(core, /scaledSourceRadius/, 'fluid source scales fire size without relying only on screen zoom');
assert.match(core, /scaledDetailFrequency/, 'raymarch detail frequency can increase so fire details read smaller');
assert.match(core, /flameTransportedDetailFrequency/, 'tall plume decouples transported detail frequency from emitter scale');
assert.match(core, /detailDomain = vec3<f32>\(flameTransportedDetailFrequency/, 'transport detail domains use Fire Scale-decoupled frequency for tall plume');
assert.doesNotMatch(core, /tallPlumeRenderDetailFrequency|scaleDomain = vec3<f32>/, 'Detail Scale must not drive a second presentation-only raymarch frequency domain');
assert.match(core, /plumeRiseScale/, 'fluid sim has an explicit plume height/world-rise scale');
assert.doesNotMatch(core, /dt \* steps/, 'raymarch steps must not secretly multiply opacity or brightness accumulation');
assert.doesNotMatch(core, /fn\s+microFilamentNoise\b/, 'raymarch must not paint periodic filament noise over transported material');
assert.match(core, /transportedCurtainStructure/, 'bonfire smoke variation derives from transported microdetail and material structure');
assert.match(core, /transportedFireStructure/, 'bonfire fire variation derives from transported reaction and interface structure');
assert.doesNotMatch(core, /bonfireSpatialRayDephase/, 'bonfire raymarch does not replace coherent lanes with stable per-pixel hash texture');
assert.match(core, /var t = startT \+ jitter;/, 'all scenes begin at the deterministic midpoint of the first ray segment');
assert.doesNotMatch(core, /bonfireVisibleSourceRelief/, 'bonfire must not hide a smooth source plug by suppressing the render transfer after solver fire already exists');
assert.match(core, /let transportedStructure = clamp\(/, 'fire-lick breakup derives its modulation from transported fire, microdetail, front, and flow structure');
assert.doesNotMatch(core, /let lickWarp = turbulentDetailForce/, 'fire-lick breakup must not hide an analytic periodic field behind a dephasing warp');
assert.doesNotMatch(core, /sin\(p\.x \* 43\.0 \+ p\.y \* 61\.0 - p\.z \* 37\.0/, 'visible microdetail must not use the old single coherent diagonal phase wave');
assert.match(core, /shredOperatorGain/, 'Shred slider has explicit nonlinear leverage for the exaggerated end of the range');
assert.match(core, /fireLickOperatorGain/, 'Fire Licks slider has explicit nonlinear leverage for the exaggerated end of the range');
assert.match(core, /material = thermalAdvection\(cell, advectVelocity, speed, localMaterial.y, thermalAdvectionRiseDirection\)/, 'legacy transport retains its thermal material backtrace');
assert.match(core, /thermalAdvection/, 'fluid compute shader treats heat as an explicit thermal-advection channel');
assert.match(core, /thermalBuoyancyForce/, 'fluid compute shader derives buoyancy from transported heat');
assert.match(core, /thermalExpansionForce/, 'fluid compute shader expands hot flow from heat gradients');
assert.match(core, /heatToSmokeConversion/, 'fluid compute shader converts cooling heat/fuel into smoke');
assert.match(core, /thermalAdvectionRiseDirection/, 'thermal material advection receives the scene-aware rise direction');
assert.match(core, /fireLayerRiseDirection/, 'fire layer advection receives the scene-aware rise direction');
assert.match(core, /microdetailRiseDirection/, 'microdetail advection receives the scene-aware rise direction');
assert.doesNotMatch(core, /fn thermalAdvection\(cell: vec3<f32>, velocity: vec3<f32>, speed: f32, localHeat: f32, lateralSlipScale: f32\)/, 'thermal advection must not hardcode positive-Y lift independent of bonfire rise convention');
assert.doesNotMatch(core, /fn fireLayerAdvection\(cell: vec3<f32>, velocity: vec3<f32>, speed: f32, heat: f32, lateralSlipScale: f32\)/, 'fire layer advection must not hardcode positive-Y lift independent of bonfire rise convention');
assert.doesNotMatch(core, /fn transportedMicrodetailAdvection\(cell: vec3<f32>, velocity: vec3<f32>, speed: f32, heat: f32, smoke: f32, flame: f32, lateralSlipScale: f32\)/, 'microdetail advection must not hardcode positive-Y lift independent of bonfire rise convention');
assert.doesNotMatch(core, /jetA|jetB|jetC/, 'default motion must not be driven by a three-nozzle whirling sprayer');
assert.match(core, /fireLayerAdvection/, 'fluid compute shader advects a distinct fire layer');
assert.match(core, /combustionFront/, 'fluid compute shader names a transported combustion-front/reaction-progress fire channel');
assert.doesNotMatch(core, /fluidDst\[base \+ 2u\]\s*=\s*vec4<f32>\([^;]*,\s*0\.0\);/s, 'fire layer slot2.w must not be written as a constant zero; it carries transported combustion-front evidence');
assert.match(core, /sampleWorldFireLayer/, 'fragment shader samples fire separately from smoke material');
assert.match(core, /radiance_controls/, 'fluid uniforms carry emissive radiance controls separately from smoke/fire transport');
assert.match(core, /fireRadianceEmission/, 'fragment shader computes fire as radiance emission');
assert.match(core, /smokeRadianceExtinction/, 'fragment shader computes smoke absorption against fire radiance');
assert.match(core, /fireLayerMean/, 'sim readback reports separate fire layer evidence');
assert.match(core, /combustionFrontMean/, 'sim readback reports transported combustion-front evidence separately from generic fire layer');
assert.match(core, /frontTopologyMean/, 'sim readback reports independent front topology sidecar evidence');
assert.match(core, /frontTopologySourcePlugRatio/, 'sim readback reports whether the sidecar front topology is trapped in one source bin');
assert.match(core, /frontTopologyRisingBodyRatio/, 'sim readback reports whether the sidecar front topology rises out of the source bin');
assert.match(core, /frontTopologyHeightSpread/, 'sim readback reports sidecar front topology height distribution breadth');
assert.match(core, /frontTopologyRadianceCoupling/, 'sim readback reports whether visible bonfire radiance is coupled to front topology');
assert.match(core, /frontTopologyFlameDetailCoupling/, 'sim readback reports whether sidecar topology survives into flame-detail storage');
assert.match(core, /frontTopologyFireLickCoupling/, 'sim readback reports whether sidecar topology survives into fire-lick breakup');
assert.match(core, /frontTopologyVisibleTransferLoss/, 'sim readback reports when rising sidecar topology is lost before visible flame transfer');
assert.match(core, /fireFlameDetailSourcePlugRatio/, 'sim readback reports whether flame-detail is the visible source-plug carrier');
assert.match(core, /fireVisibleCarrierSourcePlugRatio/, 'sim readback exposes the clearer visible-fire carrier alias for legacy flameDetail source-plug evidence');
assert.match(core, /fireVisibleCarrierRisingBodyRatio/, 'sim readback exposes the clearer visible-fire carrier alias for legacy flameDetail rising-body evidence');
assert.match(core, /fireLickSourcePlugRatio/, 'sim readback reports whether fire-lick storage is the visible source-plug carrier');
assert.match(core, /fireHeatSourcePlugRatio/, 'sim readback reports whether heat is the visible source-plug carrier');
assert.match(core, /fireChannelSourcePlugDominant/, 'sim readback names the dominant visible fire source-plug channel');
assert.match(core, /radianceMean/, 'sim readback reports fire radiance evidence');
assert.match(core, /extinctionMean/, 'sim readback reports smoke extinction evidence');
assert.match(core, /microdetailMean/, 'sim readback reports transported microdetail evidence');
assert.match(core, /interfaceShredMean/, 'sim readback reports interface shredding evidence');
assert.match(core, /fireLickMean/, 'sim readback reports fire-lick breakup evidence');
assert.match(core, /source_controls/, 'fluid uniforms carry source radius and flow controls');
assert.match(core, /u\.source_controls\.z/, 'fluid uniforms carry pressure/projection strength');
assert.match(core, /u\.source_controls\.w/, 'fluid uniforms carry flow diagnostic overlay strength');
assert.match(core, /pyro-dynamic-detail-atlas-v0/, 'renderer names the Pyro dynamic detail atlas identity');
assert.match(core, /pyro-dynamic-detail-authority-live-fields-v0/, 'renderer names live-field authority for Pyro dynamic detail state');
assert.match(core, /pyro-dynamic-detail-reset-policy-v0/, 'renderer names reset policy for subordinate Pyro detail state');
assert.match(core, /pyroDynamicDetail/, 'debug state exposes Pyro dynamic detail state for witness and UI');
assert.match(core, /visualRole:\s*'debug-atlas-only-not-main-fire'/, 'Pyro dynamic detail state is explicitly not main fire authority');
assert.match(core, /pyroDynamicDetailLastInputMs/, 'Pyro dynamic detail tracks live input freshness separately from optional readback cadence');
assert.match(core, /if\s*\(\s*reactionFuel\s*<=\s*0\.0005\s*\)\s*resetReasons\.push\('fuel-off'\)/, 'explicit fuel-off routes reset Pyro material memory independent of scene family');
assert.match(core, /if\s*\(\s*rawLiveFireAuthority\s*<=\s*0\.015\s*\)\s*resetReasons\.push\('no-live-fire-authority'\)/, 'Pyro material memory records no-live-fire authority as a reset reason');
assert.match(core, /resetReasons\.includes\('snuff-quench'\)[\s\S]*resetReasons\.includes\('no-live-fire-authority'\)[\s\S]*resetReasons\.includes\('stale-input'\)/, 'broad smoke/no-fire routes block Pyro material memory uploads instead of only recording the reason');
assert.match(core, /pyro-dynamic-detail-material-contract-v0/, 'Pyro dynamic detail exposes a stable renderer-adjacent material contract identity');
assert.match(core, /materialMemory:\s*\{/, 'Pyro dynamic detail state preserves a compatibility receipt for the retired material-memory payload');
assert.match(core, /PYRO_DYNAMIC_DETAIL_TEXTURE_LAYOUT\s*=\s*\{[\s\S]*width:\s*8[\s\S]*height:\s*3[\s\S]*channels:\s*4/, 'Pyro material memory declares a compact 8x3x4 texture layout');
assert.doesNotMatch(core, /PYRO_DYNAMIC_DETAIL_PHASE_(?:BASE|FIRE|SMOKE)_STEP/, 'retired Pyro material memory owns no self-advancing presentation phase');
assert.match(core, /PYRO_DYNAMIC_DETAIL_CELL_BLEND\s*=\s*0\.14/, 'Pyro scalar debug readout remains temporally damped without becoming shader authority');
assert.match(core, /const\s+sampleVector4\s*=\s*new Array\([\s\S]*\.map\(\(\)\s*=>\s*\[0,\s*0,\s*0,\s*0\]\)/, 'retired Pyro material-memory samples remain explicitly zero');
assert.match(core, /shaderReadiness:\s*'retired-synthetic-atlas'/, 'Pyro material memory reports that synthetic shader sampling is retired');
assert.match(core, /pyro_detail_controls:\s*vec4<f32>/, 'WGSL uniforms expose Pyro material-memory controls to the renderer');
assert.match(core, /pyro_carrier_controls:\s*vec4<f32>/, 'WGSL uniforms expose Pyro material carrier cockpit controls to the renderer');
assert.match(core, /pyro_diagnostic_controls:\s*vec4<f32>/, 'WGSL uniforms expose Pyro carrier isolate/overdrive diagnostics to the renderer');
assert.match(core, /pyro_shape_controls:\s*vec4<f32>/, 'WGSL uniforms expose Pyro Bite/Fold shaping controls to the renderer');
assert.match(core, /pyro_light_controls:\s*vec4<f32>/, 'WGSL uniforms expose Pyro contrast-lighting controls to the renderer');
assert.match(core, /pyro_route_controls:\s*vec4<f32>/, 'WGSL uniforms expose Pyro carrier routing controls to the renderer');
assert.match(core, /pyro_detail_cells:\s*array<vec4<f32>,\s*24>/, 'WGSL keeps the retired 8x3 cell slots reserved for uniform-layout compatibility');
assert.match(core, /pyro-transported-field-coupling-v0/, 'debug state names transported-field Pyro renderer coupling authority');
assert.match(core, /uniforms\[84\]\s*=\s*pyroMaterialGain/, 'CPU uploads the user-authored Pyro transported-field gain into the WGSL uniform block');
assert.match(core, /normalizeLookFreeze\(controlsSnapshot\.lookFreeze\)/, 'CPU render path normalizes the look-lab freeze control');
assert.match(core, /normalizePyroCompareMode\(controlsSnapshot\.pyroCompareMode\)/, 'CPU render path normalizes the Pyro compare mode');
assert.match(core, /pyroCompareMuted\s*=\s*pyroCompareMode\s*===\s*'base'/, 'Base compare mode mutes Pyro material carriers');
assert.match(core, /lookFreezeCanPin\(state\)/, 'Look-lab freeze waits for an initialized sim frame before pinning');
assert.match(core, /pumpLookLabFrozenFrame\(\)/, 'Frozen look-lab controls force a redraw even when the browser parks RAF');
assert.match(core, /if \(lookFreeze\)[\s\S]*state\.lookFreezeFrame[\s\S]*else[\s\S]*encodeSim\(encoder\)/, 'Look-lab freeze skips simulation while live mode keeps stepping');
assert.match(core, /lookFreezeRenderTimeMs/, 'Look-lab freeze pins explicit emitter temporal descriptors and render-phase evidence as well as sim stepping');
assert.match(core, /lookFreezeRenderFrame/, 'Look-lab freeze pins render-phase evidence as well as sim stepping');
assert.match(core, /typeof state\.lookFreezeRenderTimeMs !== 'number'/, 'Look-lab freeze render-time pin treats null as unpinned rather than finite zero');
assert.match(core, /uniforms\[19\]\s*=\s*0\s*;/, 'retired renderer-time ABI component remains explicit zero authority');
assert.match(core, /uniforms\[47\]\s*=\s*controlsSnapshot\.rayStartNoise === false \? 0 : 1;/, 'retired temporal-frame component is reused only for a stable spatial sampling choice');
assert.match(core, /const renderPhaseAuthority\s*=\s*lookFreeze\s*\?\s*'look-freeze-pinned-render-phase'/, 'Debug state reports whether render phase is live or look-freeze pinned');
assert.match(core, /setControls\(next\)[\s\S]*const controlsLookFreeze[\s\S]*if \(!controlsLookFreeze\) updatePyroDynamicDetailState\(\{ inputKind: 'control-proxy' \}\)/, 'Look-lab freeze prevents control scrubbing from advancing Pyro material-memory state');
assert.match(core, /uniforms\[85\]\s*=\s*pyroMaterialEnergy/, 'CPU preserves a nonspatial live-field energy gate after retiring the synthetic atlas');
assert.match(core, /uniforms\[88\s*\+\s*memoryIndex\s*\*\s*4\]\s*=\s*0/, 'CPU zeros every retired Pyro material-memory atlas cell');
assert.doesNotMatch(core, /samplePyroMaterialMemoryCell/, 'shader no longer samples the synthetic Pyro material-memory atlas');
assert.match(core, /let\s+transportedPyroStructure\s*=\s*clamp\(/, 'Pyro shaping derives spatial structure from transported fields');
assert.match(core, /pyroMaterialGain[\s\S]{0,120}\*\s*pyroTransportEnergy[\s\S]{0,120}\*\s*pyroLiveAuthority/, 'Pyro shaping retains only a scalar live-field energy gate before transported spatial structure');
assert.match(core, /pyroInterfaceFocus/, 'shader gates Pyro memory toward the flame/smoke interface');
assert.match(core, /pyroEdgeBite/, 'shader lets Pyro memory perturb flame edge detail');
assert.match(core, /pyroSmokeFold/, 'shader lets Pyro memory perturb smoke/absorption carriers');
assert.match(core, /pyroDiagnosticPaint/, 'shader separates false-color diagnostic paint from production-ish carrier effects');
assert.match(core, /pyroCarrierViewMode/, 'shader can isolate Pyro carrier channels for diagnosis');
assert.match(core, /pyroCarrierOverdrive/, 'shader can intentionally overdrive subtle Pyro carriers');
assert.match(core, /pyroBiteBorderFocus/, 'Bite carrier has its own border/interface focus without a new texture fetch');
assert.match(core, /pyroFoldBorderFocus/, 'Fold carrier has its own border/interface focus without a new texture fetch');
assert.match(core, /pyroBiteTeeth/, 'Bite carrier exposes high-gradient edge teeth shaping');
assert.match(core, /pyroBiteWake/, 'Bite carrier exposes lower rising-boundary wake shaping');
assert.match(core, /pyroFoldWake/, 'Fold carrier exposes downstream smoke wake length shaping');
assert.match(core, /pyroContrastRadiance/, 'Pyro material memory exposes reset-gated contrast radiance shaping');
assert.match(core, /pyroBiteEdgeEvent/, 'shader derives a named Bite edge-event predicate');
assert.match(core, /pyroFoldWakeSignal/, 'shader derives a named Fold wake-memory predicate');
assert.match(core, /pyroRadianceContrastSignal/, 'shader derives a named Pyro radiance contrast predicate');
assert.match(core, /pyroRadianceView/, 'shader can isolate the Pyro radiance carrier for diagnosis');
assert.match(core, /pyroRadianceMask/, 'shader routes Radiance through the carrier-view mask');
assert.match(core, /pyroContrastRadiance\s*=\s*select\(clamp\(u\.pyro_light_controls\.x,\s*0\.0,\s*10\.0\),\s*0\.0,\s*LEAN_STOCK_RAYMARCH\)/, 'full WGSL accepts loud Pyro radiance contrast while the lean specialization neutralizes it');
assert.match(core, /pyroRadianceGate\s*=\s*clamp\(u\.pyro_light_controls\.y,\s*0\.0,\s*1\.0\)/, 'WGSL accepts a separate Pyro radiance sparsity gate');
assert.match(core, /pyroRadianceSpill\s*=\s*clamp\(u\.pyro_light_controls\.z,\s*0\.0,\s*1\.0\)/, 'WGSL accepts a separate Pyro radiance smoke-spill control');
assert.match(core, /pyroRadianceWarmth\s*=\s*clamp\(u\.pyro_light_controls\.w,\s*0\.0,\s*1\.0\)/, 'WGSL accepts a separate Pyro radiance warmth/chroma control');
assert.match(core, /pyroRadianceSparsity/, 'shader derives a named sparse radiance gate predicate');
assert.match(core, /pyroRadianceSpillSignal/, 'shader derives a named radiance spill predicate');
assert.match(core, /Math\.min\(10,\s*controlsSnapshot\.pyroRadiance/, 'CPU upload accepts loud Pyro radiance contrast range');
assert.match(core, /uniforms\[197\]\s*=\s*pyroRadianceGate/, 'CPU uploads Pyro radiance gate into the WGSL uniform block');
assert.match(core, /uniforms\[198\]\s*=\s*pyroRadianceSpill/, 'CPU uploads Pyro radiance spill into the WGSL uniform block');
assert.match(core, /uniforms\[199\]\s*=\s*pyroRadianceWarmth/, 'CPU uploads Pyro radiance warmth into the WGSL uniform block');
assert.match(core, /pyro_color_controls:\s*vec4<f32>/, 'WGSL receives packed Pyro carrier color controls');
assert.match(core, /pyroBiteHeat\s*=\s*clamp\(u\.pyro_color_controls\.x,\s*0\.0,\s*1\.0\)/, 'WGSL accepts a separate Bite heat color control');
assert.match(core, /pyroBiteChroma\s*=\s*clamp\(u\.pyro_color_controls\.y,\s*0\.0,\s*1\.0\)/, 'WGSL accepts a separate Bite chroma control');
assert.match(core, /pyroRadianceHue\s*=\s*clamp\(u\.pyro_color_controls\.z,\s*0\.0,\s*1\.0\)/, 'WGSL accepts a separate Radiance hue-bias control');
assert.match(core, /pyroRadianceChroma\s*=\s*clamp\(u\.pyro_color_controls\.w,\s*0\.0,\s*1\.0\)/, 'WGSL accepts a separate Radiance chroma control');
assert.match(core, /pyro_luma_controls:\s*vec4<f32>/, 'WGSL receives packed Pyro gain/luminance controls');
assert.match(core, /pyroFlamePaint\s*=\s*select\(clamp\(u\.pyro_luma_controls\.x,\s*0\.0,\s*3\.0\),\s*0\.0,\s*LEAN_STOCK_RAYMARCH\)/, 'full WGSL accepts independent Pyro flame paint while the lean specialization disables repainting');
assert.match(core, /pyroFlameLuma\s*=\s*select\(clamp\(u\.pyro_luma_controls\.y,\s*0\.0,\s*3\.0\),\s*1\.0,\s*LEAN_STOCK_RAYMARCH\)/, 'full WGSL accepts independent Pyro flame luminance while the lean specialization keeps neutral luminance');
assert.match(core, /pyroStockMix\s*=\s*select\(clamp\(u\.pyro_luma_controls\.z,\s*0\.0,\s*1\.0\),\s*1\.0,\s*LEAN_STOCK_RAYMARCH\)/, 'full WGSL accepts flame survival mix while the lean specialization keeps the stock color');
assert.match(core, /pyroBiteLuma\s*=\s*clamp\(u\.pyro_luma_controls\.w,\s*0\.0,\s*3\.0\)/, 'WGSL accepts independent Bite luminance');
assert.match(core, /pyroWakeLuma\s*=\s*clamp\(u\.pyro_luma_controls2\.x,\s*0\.0,\s*3\.0\)/, 'WGSL accepts independent Wake luminance');
assert.match(core, /pyroRadianceLuma\s*=\s*clamp\(u\.pyro_luma_controls2\.y,\s*0\.0,\s*3\.0\)/, 'WGSL accepts independent Radiance luminance');
for (const uniform of [
  'pyro_palette_flame',
  'pyro_palette_flame_edge',
  'pyro_palette_bite',
  'pyro_palette_bite_hot',
  'pyro_palette_wake',
  'pyro_palette_wake_ember',
  'pyro_palette_radiance',
  'pyro_palette_radiance_warm',
]) {
  assert.match(core, new RegExp(`${uniform}:\\s*vec4<f32>`), `WGSL receives editable palette uniform ${uniform}`);
}
assert.match(core, /pyroRawFireMix/, 'WGSL derives a raw live-fire mix separate from display Fire gain');
assert.match(core, /pyroFlamePaintSignal/, 'WGSL derives a named Pyro flame-paint carrier');
assert.match(core, /pyroBiteHeight\s*=\s*clamp\(u\.pyro_route_controls\.x,\s*0\.0,\s*1\.0\)/, 'WGSL accepts a separate Bite height/climb gate');
assert.match(core, /pyroBiteFireLock\s*=\s*clamp\(u\.pyro_route_controls\.y,\s*0\.0,\s*1\.0\)/, 'WGSL accepts a separate Bite current-fire authority lock');
assert.match(core, /pyroWakeLift\s*=\s*clamp\(u\.pyro_route_controls\.z,\s*0\.0,\s*1\.0\)/, 'WGSL accepts a separate smoke-memory Wake lift control');
assert.match(core, /pyroWakeWarmth\s*=\s*clamp\(u\.pyro_route_controls\.w,\s*0\.0,\s*1\.0\)/, 'WGSL accepts a separate smoke-memory Wake warmth control');
assert.match(core, /pyro_radiance_route_controls:\s*vec4<f32>/, 'WGSL uniforms expose Pyro radiance source/height routing controls');
assert.match(core, /pyroRadianceSource\s*=\s*clamp\(u\.pyro_radiance_route_controls\.x,\s*0\.0,\s*2\.0\)/, 'WGSL accepts a separate Radiance source selector');
assert.match(core, /pyroRadianceHeight\s*=\s*clamp\(u\.pyro_radiance_route_controls\.y,\s*0\.0,\s*1\.0\)/, 'WGSL accepts a separate Radiance height gate');
assert.match(core, /pyro_bite_stack_controls:\s*vec4<f32>/, 'WGSL receives the first packed Bite stack layer controls');
assert.match(core, /pyro_bite_stack_controls2:\s*vec4<f32>/, 'WGSL receives the second packed Bite stack layer controls');
assert.match(core, /pyroBiteCoreEvent/, 'WGSL derives a named inner/current-flame Bite layer');
assert.match(core, /pyroBiteRimEvent/, 'WGSL derives a named rim/interface Bite layer');
assert.match(core, /pyroBiteAfterEvent/, 'WGSL derives a named after/wake Bite layer');
assert.match(core, /pyroStackedBiteEvent/, 'WGSL combines Bite layers before load-bearing alpha/color contribution');
assert.match(core, /pyroStackedBiteEvent\s*=\s*clamp\(\s*pyroBiteEvent\s*\+/, 'Stacked Bite preserves the legacy Bite carrier at full strength before optional layers add detail');
assert.match(core, /pyroWakeSignal/, 'WGSL computes a named smoke-memory Wake carrier separate from Bite');
assert.match(core, /pyroCurrentFireLock/, 'WGSL computes a named current-fire authority lock for Bite');
assert.match(core, /uniforms\[200\]\s*=\s*pyroBiteHeat/, 'CPU uploads Bite heat into the Pyro color uniform block');
assert.match(core, /uniforms\[201\]\s*=\s*pyroBiteChroma/, 'CPU uploads Bite chroma into the Pyro color uniform block');
assert.match(core, /uniforms\[202\]\s*=\s*pyroRadianceHue/, 'CPU uploads Radiance hue into the Pyro color uniform block');
assert.match(core, /uniforms\[203\]\s*=\s*pyroRadianceChroma/, 'CPU uploads Radiance chroma into the Pyro color uniform block');
assert.match(core, /uniforms\[212\]\s*=\s*pyroFlamePaint/, 'CPU uploads flame paint gain into the Pyro luma uniform block');
assert.match(core, /uniforms\[213\]\s*=\s*pyroFlameLuma/, 'CPU uploads flame luminance into the Pyro luma uniform block');
assert.match(core, /writePyroPaletteUniform/, 'CPU uploads editable Pyro palette color endpoints');
assert.match(core, /paletteShape/, 'debug state exposes editable Pyro palette shape');
assert.match(core, /lumaShape/, 'debug state exposes independent Pyro luma shape');
assert.match(core, /radianceShape/, 'debug state exposes Pyro radiance gate/spill/warmth shape');
assert.match(core, /colorShape/, 'debug state exposes Pyro Bite/Radiance color shaping');
assert.match(core, /pyroBiteAlphaBoost/, 'Bite carrier affects load-bearing flame alpha instead of final color only');
assert.match(core, /pyroFoldExtinctionBoost/, 'Fold carrier affects load-bearing smoke extinction instead of final color only');
assert.match(core, /pyroRadianceBoost/, 'Radiance carrier affects load-bearing emissive contribution instead of diagnostic paint only');
assert.match(core, /pyroDiagnosticPaintAlpha/, 'diagnostic paint has a bounded continuous alpha path instead of being forced by isolate mode');
assert.match(core, /carrierDebug/, 'debug state exposes Pyro carrier diagnostic readout');
assert.match(core, /pyro-transported-field-coupling-v0/, 'debug state names transported fields as visible Pyro renderer authority');
assert.match(core, /pyroMaterialActive\s*=\s*pyroMaterialRequestedGain\s*>\s*0\s*&&\s*!pyroCompareMuted\s*&&\s*!pyroDetailForRender\.resetGate/, 'visible Pyro renderer coupling is gated by live transported authority rather than synthetic atlas readiness');
assert.match(core, /reactionFuelScale/, 'fluid uniforms carry a route-visible tall-plume fuel/reaction scale');
assert.match(core, /quenchVaporStrength/, 'fluid uniforms carry the cheap route-visible quench-vapor render strength');
assert.match(core, /snuffVisualModel/, 'debug state names the active failure-snuff visual model');
assert.match(core, /quench-vapor-v0/, 'failure snuff visual has a stable cheap quench-vapor identity');
assert.match(core, /flameQuenchModel/, 'debug state names the active flame-body quench model separately from vapor');
assert.match(core, /quench-flame-body-v0/, 'failure snuff damps the flame body instead of only painting vapor over it');
assert.match(core, /quenchCoreCollapse/, 'render path computes a high-temperature flame-core collapse signal for snuff');
assert.match(core, /normalizeRuntimeQuality/, 'volume core normalizes host-requested runtime quality');
assert.match(core, /runtimeQualityRequested/, 'debug state records requested runtime quality separately from effective mode');
assert.match(core, /runtimeQualityEffective/, 'debug state records the effective runtime quality mode');
assert.match(core, /runtimeQualityReceipt/, 'debug state exposes the pressure-aware ladder receipt');
assert.match(core, /volume-runtime-quality-ladder-v0/, 'runtime quality ladder has a stable receipt identity');
assert.match(core, /flameFuelHeatReaction/, 'tall-plume fire is born from fuel/heat contact instead of source color alone');
assert.match(core, /fuelConsumption/, 'tall-plume reaction consumes the fuel lane before writing material state');
assert.match(core, /fireFuelOverlapRatio/, 'sim readback reports whether visible fire overlaps live fuel');
assert.match(core, /flameDirectSmokeBirthGain/, 'tall plume source cadence reduces broad direct source-authored smoke birth');
assert.match(core, /flameReactionMemory/, 'tall plume source cadence keeps a small reaction memory to prevent threshold chatter');
assert.match(core, /flamePilotReaction/, 'tall plume source cadence exposes a pilot reaction floor for small flame continuity');
assert.match(core, /flameReactionSmokeBirth/, 'tall plume smoke birth is explicitly led by fuel consumption and cooling');
assert.match(core, /tallPlumeReactionCadenceDebug/, 'debug state exposes tall-plume source/reaction cadence identity');
assert.match(core, /tallPlumeFlameCutoffContract/, 'debug state exposes tall-plume flame cutoff/speed decoupling identity');
assert.match(core, /tall-plume-speed-cutoff-decoupled-v0/, 'tall-plume flame cutoff contract has a stable identity');
assert.match(core, /tallPlumeFlowShelfContract/, 'debug state exposes tall-plume flow-rate shelf mitigation identity');
assert.match(core, /tall-plume-flow-shelf-mitigated-v0/, 'tall-plume flow-rate shelf mitigation has a stable identity');
assert.match(core, /tallPlumeFlameHeightLawContract/, 'debug state exposes tall-plume reaction/fuel flame-height law identity');
assert.match(core, /tall-plume-flame-height-law-v2/, 'tall-plume reaction/fuel flame-height law has a stable identity');
assert.match(core, /flameBurnoutTail/, 'tall plume fire survival keeps a fuel-bound hot burnout tail for high-flow regimes');
assert.match(core, /flameFireSurvivalSignal/, 'tall plume fire survival uses a widened survival signal instead of a hard live-reaction threshold');
assert.match(core, /flameFlowHeightDemand/, 'tall plume high-flow fire raises survival demand with height instead of only changing render speed');
assert.match(core, /flameFlameHeightDemand/, 'tall plume fire survival raises its reaction demand continuously with flame height');
assert.match(core, /flameFlameHeightSurvival/, 'tall plume visible fire survival is shaped by a named flame-height law');
assert.match(core, /flameFrontWidthTaper/, 'tall plume upper live fire is tapered by front width instead of filling the source column');
assert.match(core, /flameFlameTipTaper/, 'tall plume upper live fire has a named tip taper to prevent square-ended flame shelves');
assert.match(core, /flameUpperSlabExtinction/, 'tall plume upper live fire has a named slab extinction term for high-flow filled bodies');
assert.match(core, /flameTransitionBandStagger/, 'tall plume fire-to-smoke transition has a named stagger term so it does not retire as one gradient band');
assert.match(core, /flameTransitionRetirementBreakup/, 'tall plume visible fire retirement is broken up by transported plume state');
assert.match(core, /flameTransitionWisps/, 'raymarch preserves wispy transition occupancy instead of coarsening the fire/smoke boundary away');
assert.match(core, /flameLiveFlameTaperedSurvival/, 'tall plume live flame survival must pass through the topology/tip taper before it can render');
assert.match(core, /flameHighFlowHeightGate/, 'tall plume high-flow fallback tail is explicitly gated by flame height');
assert.match(core, /flameLiveFlameSurvival/, 'tall plume flame survival distinguishes live reaction/fuel survival from stale tail fallback');
assert.match(core, /flameTailOnlySurvival/, 'tall plume stale burnout tail has a named bounded survival fallback');
assert.match(core, /flameHighFlowShelfExtinction/, 'tall plume high-flow visible fire has an explicit source-shelf extinction term');
assert.match(core, /flameUpperFlowExtinction/, 'tall plume upper high-flow fire requires fresh reaction/fuel rather than stale tail survival');
assert.match(core, /flameReactionContour/, 'tall plume visible fire is contoured by reaction topology instead of raw source shape');
assert.match(core, /flameRawSourceFireRelief/, 'tall plume raw source fire has a named relief gate before visible fire transfer');
assert.match(core, /flameSourceSlabRelief/, 'tall plume high-flow source slab has a named relief gate before visible fire transfer');
assert.match(core, /flameEmitterBand/, 'tall plume has a named compact emitter band for combustion source birth');
assert.match(core, /flameCombustionSource/, 'tall plume combustion source is separated from the broad smoke source column');
assert.match(core, /flameEmitterFireBirth/, 'tall plume fire birth is separated from the broad column fire source');
assert.match(core, /flameSourceWidthGate/, 'tall plume source birth must explicitly know when the emitter is wide enough to need extra front topology');
assert.match(core, /flameFrontPacketBreakup/, 'tall plume wide-source front birth must retain bounded transported/static breakup');
assert.doesNotMatch(core, /tallPlumeFrontPacketDensity/, 'tall plume source width must not author a periodic packet-density comb');
assert.match(core, /flameAnnularFrontBirth/, 'tall plume wide-source birth must add an annular combustion-front carrier');
assert.match(core, /flameInteriorFireRelief/, 'tall plume wide-source birth must relieve the interior so broad sources do not become solid hot plugs');
assert.match(core, /let columnFrontTopologyBirth = max\(columnCombustionFrontBirth \* 0\.32, flameAnnularFrontBirth \* 0\.42\);/, 'tall plume annular source birth must feed combustion front topology, not only visible flame color');
assert.match(core, /transportedSourceStructure/, 'tall plume source breakup must respond to transported material and combustion-front topology');
assert.match(core, /sourceSpatialDephase/, 'tall plume source startup may retain low-amplitude static spatial dephasing');
assert.doesNotMatch(core, /tallPlumeSmokeDebandWarp|tallPlumeSmokeDebandBasis/, 'tall plume smoke source must not retain animated trigonometric de-banding painters');
assert.match(core, /flameSmokeSourceBreakup/, 'tall plume smoke source must expose the transported/static breakup selected for smoke density birth');
assert.match(core, /let columnSource = exp\(-sourceRadial \* sourceRadial \* smokeSourceFalloff\) \* sourceBand \* \(flameSmokeSourceBreakup\) \* inputFlow;/, 'smoke birth retains the transported breakup without a scene branch');
assert.doesNotMatch(core, /let columnSource = exp\(-sourceRadial \* sourceRadial \* smokeSourceFalloff\) \* sourceBand \* breakup \* inputFlow;/, 'tall plume smoke birth must not bake the old planar breakup directly into density');
assert.match(core, /flameLiveReactionCarrier/, 'tall plume reaction is driven by compact combustion carrier rather than broad smoke source');
assert.doesNotMatch(core, /let flameLiveFlameSurvival = flameReactionSurvival \* flameFuelSurvival \* flameFlameContourSurvival;/, 'tall plume live flame survival must not bypass front topology and tip taper');
assert.match(core, /fireBirth \* 0\.024 \* flameRawSourceFireRelief/, 'tall plume flame storage must downweight raw source birth at high flow');
assert.match(core, /columnFlameDetailBirth \* 0\.018 \* flameSourceSlabRelief/, 'tall plume visible fire detail must not expose the raw column flame-detail slab at high flow');
assert.doesNotMatch(core, /columnFlameDetailBirth \* 0\.20\s*\+\s*flameFuelHeatReaction/, 'tall plume visible fire detail must not retain the high-flow raw source-slab transfer');
assert.doesNotMatch(core, /0\.18 \+ 0\.22 \* source \+ 0\.18 \* columnFireBirth \+ 0\.18 \* flame/, 'tall plume live reaction must not be coupled directly to the broad source and column fire birth');
assert.doesNotMatch(core, /max\(\s*flameReactionSurvival \* flameFuelSurvival \* flameFlameContourSurvival,\s*flameBurnoutTail \* 2\.2\s*\)/, 'tall plume stale burnout tail must not bypass the high-flow height survival law');
assert.doesNotMatch(core, /let flameFireSurvival = mix\(1\.0, smoothstep\(0\.0005, 0\.070, flameFireSurvivalSignal\), tallPlumeScene\);/, 'tall-plume fire survival must not be a single global reaction threshold that high flow can fill into a shelf');
assert.doesNotMatch(core, /flame = max\(flame, canonicalMinimalFireBirth \* 1\.04\);/, 'canonical minimal fire birth must not bypass tall-plume reaction/fuel survival after the flame-height law runs');
assert.doesNotMatch(core, /flameDetail = max\(flameDetail, canonicalMinimalFireBirth \* 0\.42\);/, 'canonical minimal flame detail must not bypass tall-plume reaction/fuel survival after the flame-height law runs');
assert.doesNotMatch(core, /let flameFireSurvival = mix\(1\.0, smoothstep\(0\.001, 0\.040, flameFuelHeatReaction \+ flamePilotReaction \* 0\.90 \+ fuel \* heat \* 0\.14 \+ fuel \* 0\.035\), tallPlumeScene\);/, 'tall-plume fire survival must not use the narrow live-reaction threshold that creates high-flow shelves');
assert.match(core, /flameFireTopFade/, 'tall-plume fire uses a named fire top fade instead of inheriting the old low heat ceiling');
assert.match(core, /flameHeatTopFade/, 'tall-plume heat uses a named heat top fade separate from fire survival');
assert.doesNotMatch(core, /let heatTopFade = 1\.0 - smoothstep\(mix\(0\.42, 0\.62, plumeHeight01\), 0\.960, p\.y\);/, 'tall-plume flame cutoff must not be directly owned by the old low heat top fade');
assert.match(core, /flame = flame \* stepRate\(mix\(0\.12, 1\.0, wallFade\) \* mix\(0\.08, 1\.0, fireTopFade\)\);/, 'visible flame must use the fire-specific top fade');
assert.match(core, /fuelMean/, 'sim readback reports mean fuel evidence');
assert.match(core, /reactionMean/, 'sim readback reports fuel/heat reaction evidence');
assert.match(core, /fuelConsumptionMean/, 'sim readback reports reaction fuel consumption evidence');
assert.match(core, /state\.volumeScene/, 'debug state exposes the effective volume scene identity');
assert.match(core, /volumeScene/, 'renderer controls carry named scene identity for witness/debug routing');
assert.match(core, /scene_controls/, 'fluid uniforms carry scene-shaping controls into the shader');
assert.doesNotMatch(core, /bonfireLiftDirection = mix\(1\.0, -1\.0, bonfireScene\)/, 'bonfire thermal rise must not be an implicit scene-mode Y-axis flip');
assert.doesNotMatch(core, /bonfireSymmetricCombustionPairOffset|bonfireCombustionPacketOffset/, 'bonfire source must not restore fixed pair or packet populations');
assert.doesNotMatch(core, /let cellJitter = vec2<f32>\(\s*sin\(time \* 0\.73 \+ fi \* 2\.17\),\s*cos\(time \* 0\.61 - fi \* 1\.91\)\s*\) \* sourceRadius \* 0\.10;/, 'bonfire source must not use independent per-lobe jitter that shifts the source center of mass');
assert.doesNotMatch(core, /sin\(p\.x \* 43\.0 \* scaledDetailFrequency \+ p\.y \* 13\.0 - time \* 1\.9\)/, 'bonfire edge breakup must not multiply source birth with a one-sided X phase');
assert.doesNotMatch(core, /cos\(p\.z \* 47\.0 \* scaledDetailFrequency - p\.y \* 9\.0 \+ time \* 1\.4\)/, 'bonfire edge breakup must not multiply source birth with a one-sided Z phase');
assert.doesNotMatch(core, /bonfireZeroMeanLateralFlow|bonfireSymmetricLateralForce|bonfireZeroMeanPlumeRoll|bonfireConvectiveCellRoll/, 'bonfire dynamics must not restore periodic macro flow, roll, or symmetric-force choreography');
assert.doesNotMatch(core, /bonfireAzimuthalBreakup|bonfireMirrorBalancedBreakup/, 'bonfire smoke/detail source must not restore animated azimuthal choreography');
assert.match(core, /combustionFrontGradient/, 'shared fire-lick logic retains transported front gradients');
assert.doesNotMatch(core, /fn bonfireReferenceConfinementForce\([^)]*time/, 'bonfire reference confinement must not accept time as a direct phase input');
assert.doesNotMatch(core, /hash31\(vec3<f32>\(sourceRadial \* 17\.0 \* scaledDetailFrequency, p\.y \* 11\.0, floor\(time \* 2\.0\)\)\)/, 'bonfire source breakup must not be keyed only by radius and height');
assert.doesNotMatch(core, /let bonfireFireball = max\(smoothBonfireFireball/, 'bonfire visible fireball must not be seeded directly by the smooth support heat core');
assert.doesNotMatch(core, /let bonfireSourceCarrier = smoothBonfireFireball/, 'bonfire source carrier must not begin with smooth support occupancy');
assert.doesNotMatch(core, /let bonfireFireBirth = \(\s*bonfireFireball/, 'bonfire visible fire birth must not begin with the compatibility fireball carrier');
assert.doesNotMatch(core, /fuel = max\(fuel, source \* 0\.88 \* sourceFuelMask\);/, 'bonfire fuel injection must not be hidden behind generic source storage');
assert.doesNotMatch(core, /heat \* fuel \* bonfireRadianceSourceGate \* 0\.024/, 'bonfire flame storage must not repaint visible fire from broad heat/fuel support');
assert.doesNotMatch(core, /bonfireInteriorEmissionBridge \* 1\.28/, 'bonfire radiance birth must not use the old strong smooth interior bridge coefficient');
assert.doesNotMatch(core, /bonfireLayeredPlumeShear|bonfireLayerShearPhase/, 'bonfire plume transport must not restore periodic layered shear');
assert.match(core, /frontDst\[idx\]\s*=\s*select\(clamp\(combustionFrontTopology, 0\.0, 2\.0\), 0\.0, compact\)/, 'compute pass writes the independent combustion-front topology sidecar');
assert.doesNotMatch(core, /data\[i \+ 8\] = source \* 0\.90;/, 'bonfire initial flame storage must not seed a smooth source plug as source * 0.90');
assert.match(core, /visibleFireCarrier/, 'bonfire route names fireLayer.z as a visible-fire carrier rather than cosmetic detail');
assert.match(core, /seedVisibleFireCarrier/, 'bonfire CPU seed names fireLayer.z as a visible-fire carrier rather than flame detail');
assert.match(core, /data\[i \+ 10\]\s*=\s*source \* seedVisibleFireCarrier/, 'bonfire CPU seed writes the visible-fire carrier, not a smooth flame-detail blob, into fireLayer.z');
assert.doesNotMatch(core, /let fireBirth = mix\(columnFireBirth, bonfireLiftedFlameBirth, bonfireScene\);/, 'bonfire fire birth must not directly render the broad lifted flame occupancy as visible emission');
assert.match(core, /plumeFieldColumnCoherence/, 'sim readback reports field-level vertical column coherence separately from screenshot stripe metrics');
assert.match(core, /plumeScalarCurlContact/, 'sim readback reports whether smoke/extinction occupies locally curling flow');
assert.match(core, /plumeSmokeBodyBreadth/, 'sim readback reports field-level smoke body breadth so broad render silhouettes cannot hide narrow scalar columns');
assert.match(core, /plumeTopPinchRatio/, 'sim readback reports upper plume breadth relative to the lower smoke body so a pointy centerline chimney cannot hide inside global breadth');
assert.match(core, /fireSourcePlugRatio/, 'sim readback reports whether bonfire radiance is trapped in one smooth source bin instead of rising through broken flame lobes');
assert.match(core, /liftedFireShellRatio/, 'sim readback reports whether lifted bonfire radiance is annular/shell-dominant like a goblet');
assert.match(core, /liftedFireInteriorRatio/, 'sim readback reports whether lifted bonfire radiance has interior contact instead of only a bright ring wall');
assert.match(core, /emissionDetailMean/, 'sim readback reports transported emission detail separately from broad fire occupancy');
assert.match(core, /liftedEmissionDetailRatio/, 'sim readback reports whether transported emission detail reaches the lifted fire body');
assert.match(core, /emissionDetailCurlContact/, 'sim readback reports whether transported emission detail occupies curling/contacting flow');
assert.match(core, /emissionDetailVerticalCoherence/, 'sim readback reports when transported emission detail remains vertically coherent across height bins');
assert.match(core, /smokeDetailVerticalCoherence/, 'sim readback reports when smoke detail remains vertically coherent across height bins');
assert.match(core, /combustionFrontSourcePlugRatio/, 'sim readback reports whether transported combustion-front evidence is trapped in one source bin');
assert.match(core, /combustionFrontRisingBodyRatio/, 'sim readback reports whether transported combustion-front evidence rises out of the source bin');
assert.match(core, /let cell = vec3<f32>\(gid\) \+ vec3<f32>\(0\.5\);/, 'fluid sim constructs cell-centered coordinates before source shaping');
assert.match(core, /fn worldToCell\(p: vec3<f32>\) -> vec3<f32> \{\s*return vec3<f32>\(\(p\.x \* 0\.5 \+ 0\.5\) \* f32\(GRID\), \(p\.y \+ 1\.0\) \* \(0\.5 \* f32\(GRID\)\), \(p\.z \* 0\.5 \+ 0\.5\) \* f32\(GRID\)\);/, 'world-to-cell mapping preserves horizontal cell pitch and the expanded positive-y domain');
assert.match(core, /fn cellToWorld\(cell: vec3<f32>\) -> vec3<f32> \{\s*return vec3<f32>\(cell\.x \* \(2\.0 \/ f32\(GRID\)\) - 1\.0, cell\.y \* \(2\.0 \/ f32\(GRID\)\) - 1\.0, cell\.z \* \(2\.0 \/ f32\(GRID\)\) - 1\.0\);/, 'cell-to-world mapping preserves uniform physical pitch across the taller grid');
assert.match(core, /fn sampleFluidSlot\(cellCenter: vec3<f32>, slot: u32\)/, 'fluid slot sampler explicitly accepts cell-center coordinates, matching sim advection callers');
assert.match(core, /cellCenter - vec3<f32>\(0\.5\)/, 'fluid slot sampler converts cell-center coordinates to lattice-index coordinates before trilinear interpolation');
assert.doesNotMatch(core, /let pc = clamp\(p, vec3<f32>\(0\.0\), vec3<f32>\(f32\(GRID\) - 1\.001\)\);/, 'fluid slot sampler must not treat cell-center coordinates as raw lattice indices');
assert.doesNotMatch(core, /\* \(f32\(GRID\) - 1\.0\)/, 'world-space volume sampling must use the same GRID cell-center coordinate convention as simulation advection');
assert.match(core, /windDirection/, 'fluid compute shader derives an explicit wind direction vector');
assert.match(core, /windHeightRamp/, 'fluid compute shader gates explicit wind through a height/ramp control');
assert.match(core, /windMaterialCoupling/, 'fluid compute shader applies wind through smoke/fire material coupling');
assert.match(core, /bonfire_ablation_controls/, 'bonfire ablation uniforms expose route-selected solver controls to WGSL');
assert.match(core, /bonfire_ablation_controls2/, 'bonfire ablation uniforms preserve projection/depinch/probe controls without stealing existing sliders');
assert.doesNotMatch(core, /let bonfireShearAblation =/, 'retired periodic layer shear must not retain shader work behind its compatibility route field');
assert.match(core, /state\.bonfireAblation/, 'debug state exposes effective bonfire ablation controls');
assert.match(core, /state\.bonfireReferenceConfinement/, 'debug state exposes reference-confinement route identity for witness and ablation comparison');
assert.doesNotMatch(core, /bonfireZeroMeanMicrodetailSlipGain|bonfireLocalMicrodetailSlipGain/, 'bonfire transport does not preserve a private microdetail slip path');
assert.match(core, /csDivergencePressure/, 'bonfire plume needs a staged divergence pass instead of only in-line velocity heuristics');
assert.match(core, /csPressureJacobi/, 'bonfire plume needs pressure iterations before projection, not just a one-sample divergence gradient');
assert.match(core, /csProjectPressure/, 'bonfire plume needs a projection pass after all forces/source terms are applied');
assert.match(core, /pressureBuffers/, 'runtime must allocate pressure buffers for staged projection');
assert.match(core, /encodePressureProjection/, 'frame loop must run the staged pressure projection before raymarch');
assert.match(core, /csProjectPressure[\s\S]*frontDst\[idx\]\s*=\s*frontSrc\[idx\]/, 'pressure projection must pass through front topology so fluid/front ping-pong stays aligned');
assert.match(core, /currentFront\s*=\s*1\s*-\s*currentFront/, 'frame loop toggles the front sidecar ping-pong index with the fluid ping-pong');
assert.match(core, /state\.frontFieldProjectionPassthrough\s*=\s*true/, 'debug state records pressure projection sidecar pass-through');
assert.doesNotMatch(core, /let bonfireAdvectionLateralDamping = mix\(1\.0, explicitWindAuthority, bonfireScene\);/, 'zero-wind bonfire advection must not collapse all lateral transport to explicit wind authority');
assert.doesNotMatch(core, /let bonfireDetailLateralDamping = mix\(1\.0, explicitWindAuthority, bonfireScene\);/, 'zero-wind bonfire detail forces must not collapse all lateral motion to explicit wind authority');
assert.doesNotMatch(core, /let bonfireSwirlSymmetryGain = mix\(1\.0, explicitWindAuthority, bonfireScene\);/, 'zero-wind bonfire swirl must not be disabled just because global wind is zero');
assert.doesNotMatch(core, /let bonfireNonWindLateralDamping = mix\(1\.0, explicitWindAuthority, bonfireScene\);/, 'zero-wind bonfire final velocity must preserve local lateral circulation while damping net drift');
assert.doesNotMatch(core, /bonfireNoWindSymmetryBlend = bonfireScene \* \(1\.0 - explicitWindAuthority\);/, 'bonfire no-wind correction must not fully mirror material state and kill vertical advection');
assert.match(core, /thermalAdvection\(cell, advectVelocity, speed, localMaterial\.y, thermalAdvectionRiseDirection\)/, 'bonfire thermal scalar advection must use transported velocity and heat lift without analytic lateral slip');
assert.match(core, /fireLayerAdvection\(cell, advectVelocity, speed, localMaterial\.y, fireLayerRiseDirection\)/, 'bonfire fire-layer advection must use transported velocity and heat lift without analytic lateral slip');
assert.match(core, /transportedMicrodetailAdvection\(cell, advectVelocity, speed, localMaterial\.y, fireLayer\.x, microdetailRiseDirection\)/, 'microdetail transport follows resolved velocity and its existing thermal lift without a separate slip vector');
assert.match(core, /deterministicInitialSeedUnit/, 'bonfire reset seed uses deterministic spatial dephasing instead of directional or periodic patterning');
assert.match(core, /state\.windStrength/, 'debug state exposes effective explicit wind strength');
assert.match(core, /state\.windAngle/, 'debug state exposes effective explicit wind direction');
assert.match(core, /state\.windHeight/, 'debug state exposes effective explicit wind height/ramp');
assert.match(core, /materialDetail/, 'fluid renderer consumes a transported fine-detail material tracer');
assert.match(core, /GPUBufferUsage\.STORAGE/, 'fluid state lives in WebGPU storage buffers');
assert.match(core, /createComputePipeline/, 'fluid state advances through a WebGPU compute pipeline');
assert.match(core, /dispatchWorkgroups/, 'fluid sim dispatches compute workgroups each frame');
assert.match(core, /simStepCount/, 'debug state exposes simulation step count');
assert.match(core, /simGrid/, 'debug state exposes simulation grid identity');
assert.match(core, /recordVolumeFrameTiming/, 'volume core records route-local frame timing');
assert.match(core, /percentileTiming/, 'volume core computes timing percentiles rather than only instant FPS');
assert.match(core, /queue\.onSubmittedWorkDone/, 'volume core samples WebGPU queue completion timing');
assert.match(core, /queueProbePending/, 'volume core exposes whether GPU queue timing is currently pending');
assert.match(core, /timing:/, 'debug state exposes a timing object');
assert.match(core, /raf-and-queue-proxy/, 'timing evidence is explicitly labeled as RAF/queue proxy data');
assert.match(core, /not-gpu-exclusive-or-present-latency/, 'timing evidence carries a present-latency disclaimer');
assert.match(core, /SIM_COST_LEDGER_IDENTITY\s*=\s*'tall-plume-sim-cost-ledger-v0'/, 'volume core names the tall-plume sim-cost ledger identity');
assert.match(core, /PRESSURE_SOURCE_STRATEGY_INLINE_DIVERGENCE/, 'volume core names inline-divergence pressure source strategy');
assert.match(core, /PRESSURE_SOURCE_STRATEGY_DISABLED/, 'volume core names disabled pressure source strategy');
assert.match(core, /TALL_PLUME_PRESSURE_ITERATION_STRATEGY_PRESSURE2\s*=\s*'tall-plume-pressure2-v0'/, 'volume core names the tall-plume pressure2 strategy');
assert.match(core, /TALL_PLUME_PRESSURE_ITERATION_STRATEGY_INACTIVE\s*=\s*'inactive'/, 'volume core names the inactive non-tall pressure2 strategy');
assert.match(core, /TALL_PLUME_SPATIAL_PRESSURE_TIER_STRATEGY\s*=\s*'tall-plume-spatial-pressure-tiers-v0'/, 'volume core names the spatial tall-plume pressure tier strategy');
assert.match(core, /PRESSURE_PROJECTION_READ_STRATEGY_COMPOSITE\s*=\s*'composite-pressure-tier-read-v0'/, 'volume core names composite tier pressure projection reads');
assert.match(core, /PRESSURE_PROJECTION_READ_STRATEGY_SINGLE_BUFFER\s*=\s*'single-pressure-buffer-read-v0'/, 'volume core names single-buffer pressure projection reads');
assert.match(core, /function defaultPressureIterationsForScene\(value\)\s*\{\s*return 2;/, 'single simulator retains the two-iteration pressure default');
assert.match(core, /normalizePressureStrategy/, 'volume core normalizes pressure strategy separately from raw iteration count');
assert.match(core, /spatial_tiers/, 'volume core recognizes the spatial pressure tier route value');
assert.match(core, /normalizePressureTierControls/, 'volume core normalizes pressure tier threshold controls');
assert.match(core, /pressure_tier_controls/, 'volume uniforms carry threshold and overlay controls into WGSL');
assert.match(core, /pressureTierLowerMax/, 'volume core reads the operator-tuned lower pressure tier bound');
assert.match(core, /pressureTierHeroMin/, 'volume core reads the operator-tuned hero pressure tier lower bound');
assert.match(core, /pressureTierHeroMax/, 'volume core reads the operator-tuned hero pressure tier upper bound');
assert.match(core, /pressureTierOverlay/, 'volume core reads pressure tier overlay opacity');
assert.match(core, /primitive_source/, 'fluid uniforms carry an explicit primitive source transform');
assert.match(core, /setVolumePrimitives/, 'volume prototype accepts authored primitive records');
assert.match(core, /assertNoPlaceholderTopologyClaim/, 'volume prototype fails loudly on placeholder topology production claims');
assert.match(core, /placeholderContract/, 'volume prototype preserves placeholder topology contracts in debug state');
assert.match(core, /volumePrimitiveCount/, 'debug state records the number of consumed volume primitives');
assert.match(core, /volumePrimitiveIds/, 'debug state records stable primitive ids');
assert.match(core, /let sourceCenter = p - u\.primitive_source\.xyz;/, 'fluid source is centered from the selected primitive transform');
assert.doesNotMatch(core, /let sourceCenter = p\.xz;/, 'fluid source must not fall back to the old implicit centered source');
assert.match(core, /MAIN_FLUID_KERNEL_STRATEGY_FIRE_LICK_BREAKUP\s*=\s*'main-fluid-fire-lick-breakup-v0'/, 'volume core names the active fire-lick breakup main-kernel strategy');
assert.match(core, /MAIN_FLUID_KERNEL_STRATEGY_ZERO_FIRE_LICK_BYPASS\s*=\s*'main-fluid-zero-fire-lick-bypass-v0'/, 'volume core names the zero-fire-lick bypass main-kernel strategy');
assert.match(core, /MAIN_FLUID_LOCAL_PROJECTION_STRATEGY_STAGED_PRESSURE_ONLY\s*=\s*'main-fluid-local-projection-staged-pressure-only-v0'/, 'volume core names staged-only main-fluid local projection strategy');
assert.match(core, /MAIN_FLUID_BONFIRE_COMBUSTION_FIELD_STRATEGY_ACTIVE\s*=\s*'bonfire-combustion-field-active-v0'/, 'volume core names the active bonfire combustion-field kernel strategy');
assert.match(core, /MAIN_FLUID_BONFIRE_COMBUSTION_FIELD_STRATEGY_NON_BONFIRE_BYPASS\s*=\s*'non-bonfire-combustion-field-bypass-v0'/, 'volume core names the non-bonfire combustion-field bypass strategy');
assert.match(core, /MAIN_FLUID_BONFIRE_PROCEDURAL_BREAKUP_STRATEGY_ACTIVE\s*=\s*'bonfire-procedural-breakup-active-v0'/, 'volume core names the active bonfire procedural-breakup strategy');
assert.match(core, /MAIN_FLUID_BONFIRE_PROCEDURAL_BREAKUP_STRATEGY_NON_BONFIRE_BYPASS\s*=\s*'non-bonfire-procedural-breakup-bypass-v0'/, 'volume core names the non-bonfire procedural-breakup bypass strategy');
assert.match(core, /MAIN_FLUID_BONFIRE_PERIODIC_MACRO_FORCE_STRATEGY_RETIRED\s*=\s*'retired-periodic-bonfire-macro-forces-v0'/, 'volume core names periodic Bonfire macro-force retirement');
assert.match(core, /MAIN_FLUID_BONFIRE_SCALAR_NEIGHBORHOOD_STRATEGY_ACTIVE\s*=\s*'bonfire-scalar-neighborhood-active-v0'/, 'volume core names the active bonfire scalar-neighborhood strategy');
assert.match(core, /MAIN_FLUID_BONFIRE_SCALAR_NEIGHBORHOOD_STRATEGY_NON_BONFIRE_BYPASS\s*=\s*'non-bonfire-scalar-neighborhood-bypass-v0'/, 'volume core names the non-bonfire scalar-neighborhood bypass strategy');
assert.match(core, /TALL_PLUME_DETAIL_COHERENCE_STRATEGY_TRANSPORTED_FIELDS\s*=\s*'transported-field-detail-direction-v0'/, 'volume core names the tall-plume transported-field detail coherence strategy');
assert.match(core, /MAIN_FLUID_PERIODIC_DETAIL_FORCE_STRATEGY_RETIRED\s*=\s*'retired-periodic-detail-force-basis-v0'/, 'volume core names periodic detail-force retirement');
assert.match(core, /TALL_PLUME_DETAIL_COHERENCE_STRATEGY_INACTIVE\s*=\s*'inactive'/, 'volume core names the non-tall-plume detail coherence bypass strategy');
assert.match(core, /TALL_PLUME_TRANSITION_BAND_STRATEGY_STAGGERED_RETIREMENT\s*=\s*'staggered-transition-retirement-v0'/, 'volume core names the tall-plume staggered transition-band strategy');
assert.match(core, /TALL_PLUME_TRANSITION_BAND_STRATEGY_INACTIVE\s*=\s*'inactive'/, 'volume core names the non-tall-plume transition-band bypass strategy');
assert.match(core, /FIRE_LICK_BREAKUP_BYPASS_THRESHOLD/, 'volume core names the zero-fire-lick bypass threshold');
assert.match(core, /updateSimCostLedger/, 'volume core keeps a structural sim-cost ledger for high-grid throughput probes');
assert.match(core, /simCostLedger/, 'debug state exposes the sim-cost ledger');
assert.match(core, /cpu-structural-pass-ledger-plus-raf-queue-proxy/, 'sim-cost ledger labels structural pass counts separately from timing proxies');
assert.match(core, /mainFluidKernelStrategy/, 'sim-cost ledger records the main-fluid kernel strategy');
assert.match(core, /mainFluidLocalProjectionStrategy/, 'sim-cost ledger records the main-fluid local projection strategy');
assert.match(core, /mainFluidLocalProjectionDivergenceEvaluationsPerCell/, 'sim-cost ledger records main-fluid local projection divergence evaluations per cell');
assert.match(core, /fireLickBreakupEvaluationsPerCell/, 'sim-cost ledger records fire-lick breakup evaluations per cell');
assert.match(core, /fireLickBreakupEnabled/, 'main-fluid shader makes zero-fire-lick breakup bypass explicit');
assert.match(core, /fireLickAshCarry/, 'main-fluid shader preserves zero-lick ash carry without paying breakup evaluation');
assert.match(core, /mainFluidBonfireCombustionFieldStrategy/, 'sim-cost ledger records the bonfire combustion-field strategy');
assert.match(core, /bonfireCombustionFieldEvaluationsPerCell/, 'sim-cost ledger records bonfire combustion-field evaluations per cell');
assert.match(core, /const bonfireCombustionFieldEvaluationsPerCell = bonfireCombustionFieldActive \? 1 : 0;/, 'bonfire combustion cost ledger records exact one-or-zero work');
assert.match(core, /mainFluidBonfireProceduralBreakupStrategy/, 'sim-cost ledger records the bonfire procedural-breakup strategy');
assert.match(core, /bonfireProceduralBreakupEvaluationsPerCell/, 'sim-cost ledger records bonfire procedural-breakup evaluations per cell');
assert.match(core, /var sourceDetailBreakup = breakup/, 'main-fluid shader retains the source detail breakup without Bonfire evaluation');
assert.match(core, /const bonfireProceduralBreakupEvaluationsPerCell = bonfireCombustionFieldActive \? 1 : 0;/, 'bonfire breakup cost ledger records exact one-or-zero work');
assert.match(core, /mainFluidBonfireSymmetricForceStrategy/, 'sim-cost ledger records the bonfire symmetric-force strategy');
assert.match(core, /bonfireSymmetricForceEvaluationsPerCell/, 'sim-cost ledger records bonfire symmetric-force evaluations per cell');
assert.match(core, /const mainFluidBonfireSymmetricForceStrategy = MAIN_FLUID_BONFIRE_PERIODIC_MACRO_FORCE_STRATEGY_RETIRED;/, 'symmetric-force strategy reports periodic macro-force retirement');
assert.match(core, /const bonfireSymmetricForceEvaluationsPerCell = 0;/, 'symmetric-force cost ledger records zero work for every scene');
assert.match(core, /mainFluidBonfireNonWindForceStrategy/, 'sim-cost ledger records the bonfire non-wind force strategy');
assert.match(core, /bonfireNonWindForceEvaluationsPerCell/, 'sim-cost ledger records bonfire non-wind force evaluations per cell');
assert.match(core, /const mainFluidBonfireNonWindForceStrategy = MAIN_FLUID_BONFIRE_PERIODIC_MACRO_FORCE_STRATEGY_RETIRED;/, 'non-wind macro-force strategy reports periodic macro-force retirement');
assert.match(core, /const bonfireNonWindForceEvaluationsPerCell = 0;/, 'non-wind macro-force cost ledger records zero work for every scene');
assert.match(core, /mainFluidBonfireScalarNeighborhoodStrategy/, 'sim-cost ledger records the bonfire scalar-neighborhood strategy');
assert.match(core, /bonfireScalarNeighborhoodReadsPerCell/, 'sim-cost ledger records bonfire scalar-neighborhood reads per cell');
assert.match(core, /bonfireSourceTopologyExtraReadsPerCell/, 'sim-cost ledger records that transported Bonfire source topology adds no neighborhood reads');
assert.match(core, /tallPlumeDetailCoherenceStrategy/, 'sim-cost ledger records the tall-plume detail coherence strategy');
assert.match(core, /tallPlumeDetailCoherenceExtraReadsPerCell/, 'sim-cost ledger records that transported detail coherence does not restore neighborhood reads');
assert.match(core, /tallPlumeTransitionBandStrategy/, 'compatibility ledger records the flame transition-band strategy');
assert.match(core, /tallPlumeTransitionBandExtraReadsPerCell/, 'compatibility ledger records that transition breakup does not restore neighborhood reads');
assert.match(core, /tallPlumePressureIterationStrategy/, 'sim-cost ledger records tall-plume pressure iteration strategy');
assert.match(core, /tallPlumePressureIterationTarget/, 'sim-cost ledger records tall-plume pressure iteration target');
assert.match(core, /tallPlumePressureTierStrategy/, 'sim-cost ledger records tall-plume spatial pressure tier strategy');
assert.match(core, /pressureProjectionReadStrategy/, 'sim-cost ledger records whether pressure projection used composite tier reads');
assert.match(core, /pressureJacobiFullGridEquivalentPasses/, 'sim-cost ledger records equivalent full-grid pressure work for partial slab dispatches');
assert.match(core, /pressureTierDispatches/, 'sim-cost ledger records pressure tier dispatch geometry');
assert.match(core, /pressureTierBounds/, 'sim-cost ledger records pressure tier y bounds');
assert.match(core, /pressureTierBufferOwnership/, 'sim-cost ledger records which pressure buffer owns each tier');
assert.match(core, /pressureTierRequestedBounds/, 'sim-cost ledger records requested pressure tier y bounds separately from dispatch quantization');
assert.match(core, /pressureTierEffectiveBounds/, 'sim-cost ledger records dispatch-effective pressure tier y bounds');
assert.match(core, /pressureTierOverlayOpacity/, 'debug state records pressure-tier overlay opacity without treating it as sim cost');
assert.match(core, /pressureTierDebugOverlayColor/, 'raymarch shader can color pressure tier bands as a transparent overlay');
assert.doesNotMatch(core, /pressureTierGuideY/, 'pressure-tier overlay does not use the old post-raymarch screen-footprint slab guide');
assert.match(core, /csPressureJacobiTiered/, 'volume core has a tiered Jacobi kernel for partial slab pressure refinement');
assert.match(core, /csProjectPressureTiered/, 'volume core has a tiered projection kernel that can read composite pressure buffers');
assert.match(core, /pressureReadComposite/, 'tiered projection reads pressure through a composite tier-aware accessor');
assert.match(core, /dispatchPressureTierPass/, 'pressure encoder has a named helper for partial slab pressure dispatch');
assert.match(core, /dispatchWorkgroups\(workgroups,\s*tierWorkgroupsY,\s*workgroups\)/, 'spatial pressure tiers dispatch fewer y workgroups instead of branching over the full grid');
assert.doesNotMatch(core, /let\s+projectionCorrection\s*=\s*pressureProjectionCorrection\(cellI,\s*effectiveProjection\)/, 'main fluid kernel does not keep the old local divergence projection heuristic active');
assert.match(core, /let\s+projectionCorrection\s*=\s*vec3<f32>\(0\.0\)/, 'main fluid kernel bypasses local projection and relies on staged pressure projection');
assert.match(core, /simPassesPerFrame/, 'sim-cost ledger records full-grid sim pass count');
assert.match(core, /pressureSourceStrategy/, 'sim-cost ledger records pressure source strategy');
assert.match(core, /pressureDivergencePasses/, 'sim-cost ledger records pressure divergence pass count');
assert.match(core, /pressureJacobiPasses/, 'sim-cost ledger records pressure Jacobi pass count');
assert.match(core, /pressureJacobiInlineDivergencePasses/, 'sim-cost ledger records pressure Jacobi inline-divergence pass count');
assert.match(core, /pressureProjectionPasses/, 'sim-cost ledger records pressure projection pass count');
assert.match(core, /fullGridPassBreakdown/, 'sim-cost ledger records pass-level full-grid breakdown');
assert.doesNotMatch(core, /beginComputePass\(\{\s*label:\s*'kaminos divergence pressure pass'\s*\}\)/, 'active pressure projection should not dispatch a standalone divergence pressure pass');
assert.match(core, /kaminos pressure jacobi inline-divergence pass/, 'active pressure Jacobi pass label names inline divergence source');
assert.doesNotMatch(core, /majorantBuildCadence|majorantBuiltThisFrame/, 'sim-cost ledger does not preserve retired majorant work as apparent live cost');
assert.match(core, /fullGridCellVisitsPerFrame/, 'sim-cost ledger records full-grid cell visits per frame');
assert.match(core, /fluidBufferBytes/, 'sim-cost ledger records fluid buffer footprint');
assert.match(core, /frontFieldBufferBytes/, 'sim-cost ledger records front sidecar footprint');
assert.match(core, /pressureBufferBytes/, 'sim-cost ledger records pressure buffer footprint');
assert.match(core, /curlMean/, 'sim readback reports curl evidence');
assert.match(core, /divergenceMean/, 'sim readback reports divergence/projection evidence');
assert.match(core, /plumeScalarCurlContact/, 'sim readback reports smoke/extinction contact with local curl, not only global curl existence');
assert.match(core, /plumeFieldColumnCoherence/, 'sim readback reports whether field smoke columns are still vertically preserved');
assert.match(core, /plumeSmokeBodyBreadth/, 'sim readback reports scalar plume breadth independently of rendered silhouette');
assert.match(core, /smokeCenterX/, 'sim readback reports smoke center of mass in simulation X');
assert.match(core, /smokeCenterZ/, 'sim readback reports smoke center of mass in simulation Z');
assert.match(core, /fireCenterX/, 'sim readback reports fire center of mass in simulation X');
assert.match(core, /smokeVelocityY/, 'sim readback reports smoke-weighted vertical transport');
assert.match(core, /fireVelocityY/, 'sim readback reports fire-weighted vertical transport');
assert.match(core, /smokeVisualRiseVelocity/, 'sim readback reports scene-aware visual upward smoke transport');
assert.match(core, /smokeVisualRiseDisplacement/, 'sim readback reports source-relative scene-aware smoke displacement, not only instantaneous velocity');
assert.match(core, /fireVisualRiseDisplacement/, 'sim readback reports source-relative scene-aware fire displacement, not only instantaneous velocity');
assert.match(core, /sourceRelativeVisualHeightBins/, 'sim readback reports source-relative visual height bins for plume verticality');
assert.match(core, /addPlumeDriftCell/, 'sim readback has an explicit plume-corridor sample path for drift evidence');
assert.doesNotMatch(core, /const plumeDriftCells = new Set\(sampleCells\);/, 'plume drift evidence must not silently exclude the later-added plume corridor cells');
assert.match(core, /fireRoughnessMean/, 'visual readback reports fire roughness so smooth glowing bulbs cannot close the bonfire attractor');
assert.match(core, /fireEdgeEnergy/, 'visual readback reports fire edge energy for the bonfire combustion boundary');
assert.match(core, /plumeHeightBins/, 'sim readback reports per-height plume drift bins');
assert.match(core, /sampleGridStep/, 'sim readback samples the 3D grid with a per-axis lattice step');
assert.match(core, /sampleGridAxis/, 'sim readback uses endpoint-balanced lattice coordinates on even grids');
assert.doesNotMatch(core, /for \(let cell = 0; cell < cells; cell \+= stride\) sampleCells\.add\(cell\);/, 'sim readback must not alias all center diagnostics onto one flat-buffer X column');
assert.match(core, /normalizedCenterX/, 'visual readback bounds report normalized screen-space center for drift/bias checks');
assert.match(core, /screenDriftX/, 'visual readback bounds report signed screen-space drift from frame center');
assert.doesNotMatch(core, /screenGridLine/, 'grid overlay must not fall back to a fake screen-space lattice');
assert.match(core, /faceUv = p\.yz/, 'grid overlay uses volume coordinates on x-facing cube surfaces');
assert.match(core, /faceUv = p\.xz/, 'grid overlay uses volume coordinates on y-facing cube surfaces');
assert.match(core, /faceUv = p\.xy/, 'grid overlay uses volume coordinates on z-facing cube surfaces');

const witnessPath = join(root, 'volume-witness.mjs');
assert.ok(existsSync(witnessPath), 'volume-witness.mjs exists');
const witness = existsSync(witnessPath) ? readFileSync(witnessPath, 'utf8') : '';
assert.match(witness, /kaminos_volume_smoke=1/, 'witness captures the explicit volume route');
assert.match(witness, /expectedPrimitiveFixture/, 'witness derives expected volume primitive fixture identity from the route');
assert.match(witness, /volumePrimitiveCount/, 'witness requires effective volume primitive consumption');
assert.match(witness, /volumePrimitiveIds/, 'witness records stable primitive ids');
assert.match(witness, /volumePrimitives/, 'witness report carries primitive records');
assert.match(witness, /assertNoPlaceholderTopologyClaim/, 'witness fails loudly on placeholder topology production claims');
assert.match(witness, /expectedLamellarHookFixture/, 'witness knows when the route expects a Lamellar hook fixture');
assert.match(witness, /effectiveRoute/, 'witness records effective route identity');
assert.match(witness, /native-3d-compute-fluid-raymarch-v0/, 'witness requires the compute-backed fluid route identity');
assert.match(witness, /expectedAdaptiveRays/, 'witness verifies adaptive raymarch route/control identity');
assert.match(witness, /expectedOccupancySkip/, 'witness verifies occupancy skip route/control identity');
assert.doesNotMatch(witness, /expectedMajorant|expectedTemporalAccum|expectedTemporalJitter|expectedHistoryClamp/, 'witness does not request retired raymarch mechanisms');
assert.match(witness, /expectedPressureIterations/, 'witness verifies pressure iteration route/control identity');
assert.match(witness, /expectedPressureIterations = expectedSpatialPressureTiers[\s\S]{0,80}\? 3/, 'witness treats spatial pressure tiers as pressure3-by-construction');
assert.match(witness, /expectedSimProfile/, 'witness verifies sim profile request identity');
assert.match(witness, /adaptiveRaymarch/, 'witness records effective adaptive raymarch strength');
assert.match(witness, /occupancySkip/, 'witness records effective occupancy skip strength');
assert.match(witness, /retiredRaymarchControls/, 'witness records any historical package controls stripped by the runtime');
assert.doesNotMatch(witness, /temporalHistoryFrames|temporalReprojectionConfidence|majorantReadback/, 'witness does not launder retired history or majorant state into evidence');
assert.match(witness, /plumeScalarCurlContact/, 'witness reports scalar/curl contact so visible smoke must be carried by local flow');
assert.match(witness, /plumeFieldColumnCoherence/, 'witness reports field-level column coherence so render breakup cannot substitute for scalar mixing');
assert.match(witness, /plumeSmokeBodyBreadth/, 'witness reports field-level smoke breadth so broad screenshots cannot mask a thin solver column');
assert.match(witness, /bonfire plume retained solver-column coherence/, 'bonfire witness rejects solver-column preservation even when the rendered frame is nonblank');
assert.match(witness, /expectedFireScale/, 'witness verifies apparent fire/world scale route/control identity');
assert.match(witness, /expectedDetailScale/, 'witness verifies fine-detail scale route/control identity');
assert.match(witness, /expectedPlumeHeight/, 'witness verifies plume height/world-rise route/control identity');
assert.match(witness, /expectedCurl/, 'witness verifies curl route/control identity for force-isolation probes');
assert.match(witness, /expectedMicrodetail/, 'witness verifies microdetail route/control identity for force-isolation probes');
assert.match(witness, /expectedRenderScale/, 'witness verifies internal render-scale route/control identity');
assert.match(witness, /expectedVolumeScene/, 'witness verifies named volume scene route/control identity');
assert.match(witness, /canonical_plume/, 'witness recognizes the minimal canonical plume scene');
assert.match(witness, /expectsCanonicalPlumeProof/, 'witness has a dedicated simple-plume proof branch separate from bonfire fire checks');
assert.match(witness, /expectedCanonicalMacroPreset/, 'witness records and verifies the canonical macro preset route identity');
assert.match(witness, /canonicalMacroPreset/, 'witness reports the effective canonical macro preset in controls/debug output');
assert.match(witness, /expectedCanonicalSourceMode/, 'witness records and verifies the canonical source physics mode route identity');
assert.match(witness, /canonicalSourceMode/, 'witness reports the effective canonical source mode in controls/debug output');
assert.match(witness, /expectedCanonicalRenderMode/, 'witness records and verifies the canonical render diagnostic mode route identity');
assert.match(witness, /canonicalRenderMode/, 'witness reports the effective canonical render diagnostic mode in controls/debug output');
assert.match(witness, /expectedCanonicalMotionRequest/, 'witness records the legacy canonical motion request as compatibility input');
assert.match(witness, /expectedCanonicalMotionRetirementIdentity/, 'witness verifies the canonical analytic motion retirement identity');
assert.match(witness, /requestedRetiredMotionMode/, 'witness separates the legacy canonical motion request from effective state');
assert.match(witness, /expectedCanonicalSourceY/, 'witness verifies canonical source height route identity');
assert.match(witness, /expectedCanonicalInjection/, 'witness verifies canonical source injection route identity');
assert.match(witness, /expectedCanonicalBuoyancy/, 'witness verifies canonical buoyancy route identity');
assert.match(witness, /canonicalPassiveBottomNonRiseProof/, 'witness treats passive bottom-source non-rise as a deliberate negative source-isolation proof');
assert.match(witness, /canonicalPassiveBottomFieldProof/, 'witness accepts passive bottom-source proof from live field readback instead of visible plume pixels');
assert.match(witness, /expectedWindStrength/, 'witness verifies explicit wind strength route/control identity');
assert.match(witness, /expectedWindAngle/, 'witness verifies explicit wind direction route/control identity');
assert.match(witness, /expectedWindHeight/, 'witness verifies explicit wind height/ramp route/control identity');
assert.match(witness, /TALL_PLUME_OPERATOR_PRESETS/, 'witness knows named tall-plume operator presets');
assert.match(witness, /operator_fire_0622/, 'witness recognizes the 2026-06-22 tall-plume fire/smoke wind foothold preset');
assert.match(witness, /operator_memory_fire_0701/, 'witness recognizes the 2026-07-01 operator-found Pyro-memory tall-plume baseline preset');
assert.match(witness, /pyro_material_bonfire_family_0702/, 'witness recognizes the 2026-07-02 operator-found Pyro material bonfire family basin');
assert.match(witness, /exploding_jellow_fireball_motherfucker_0706/, 'witness recognizes the 2026-07-06 operator-found exploding jellow fireball Pyro basin');
assert.match(witness, /pyro_flow_small_bonfire_gamut_0707/, 'witness recognizes the 2026-07-07 operator-found Pyro Flow small-bonfire gamut basin');
assert.match(witness, /boundary_fire_bonfire_a_la_ruffles_0709/, 'witness recognizes the 2026-07-09 operator-found Boundary Fire Bonfire_a_la_ruffles basin');
assert.match(witness, /DEFAULT_VOLUME_SMOKE_BASIN_PATH = new URL\('\.\/artifacts\/default-basin\/cheap-blast-furnace\.json'/, 'witness mirrors the bare smoke route default basin from the same committed export');
assert.match(witness, /kaminos_volume_smoke'\)\s*===\s*'1'[\s\S]*defaultVolumeBasin \? volumeBasinScenePreset\(/, 'witness expects bare smoke routes to boot into the default basin');
assert.ok(witness.includes("['flame', 'tall_plume'].includes(routeParams.get('volume_scene'))"), 'witness preserves the same default basin for both simulator names');
assert.match(witness, /expectedDetailScaleArtifactQuarantine/, 'witness verifies the tall-plume detail-scale artifact quarantine state');
assert.match(witness, /detailScaleArtifactQuarantine/, 'witness records the effective detail-scale artifact quarantine state');
assert.match(witness, /expectedReactionFuelScale/, 'witness verifies tall-plume reaction fuel route identity');
assert.match(witness, /expectsFuelStarvedTallPlume/, 'witness has a fuel-starved tall-plume negative fire branch');
assert.match(witness, /volume_reaction_fuel/, 'witness accepts a route-only tall-plume reaction fuel control');
assert.match(witness, /expectedLifecycleEffect/, 'witness verifies lifecycle visual effect route identity');
assert.match(witness, /expectedLifecycleT/, 'witness verifies lifecycle visual phase route identity');
assert.match(witness, /expectedQuenchVapor/, 'witness verifies quench-vapor route identity');
assert.match(witness, /expectedRuntimeQualityRequested/, 'witness verifies requested runtime quality route identity');
assert.match(witness, /expectedRuntimeQualityEffective/, 'witness verifies effective runtime quality identity');
assert.match(witness, /runtimeQualityReceipt/, 'witness records the runtime quality ladder receipt');
assert.match(witness, /volume-runtime-quality-ladder-v0/, 'witness recognizes the stable runtime quality ladder identity');
assert.match(witness, /snuffVisualModel/, 'witness records the active snuff visual model identity');
assert.match(witness, /quenchVaporStrength/, 'witness records effective quench-vapor strength');
assert.match(witness, /quench-vapor-v0/, 'witness recognizes the cheap failure-snuff vapor model');
assert.match(witness, /flameQuenchModel/, 'witness records the active flame-body quench model identity');
assert.match(witness, /quench-flame-body-v0/, 'witness recognizes the snuff flame-body quench model');
assert.match(witness, /expectsSnuffVisualEvidence/, 'witness accepts late snuff by vapor/smoke evidence instead of requiring active fire pixels');
assert.match(witness, /bridged snuff vapor volume/, 'main-renderer witness names snuff vapor evidence separately from live fire');
assert.match(witness, /fireFuelOverlapRatio/, 'witness records fire/fuel overlap evidence');
assert.match(witness, /expectedTallPlumePreset/, 'witness reports effective tall-plume operator preset identity');
assert.match(witness, /volume_expected_wind_drift/, 'witness can assert expected wind drift direction for tall-plume wind probes');
assert.match(witness, /expectedWindDrift/, 'witness reports requested wind drift expectation');
assert.match(witness, /plumeNetLateralVelocityX/, 'witness wind report exposes field lateral velocity evidence');
assert.match(witness, /expectedBonfireRecenter/, 'witness verifies bonfire recentering ablation route/control identity');
assert.match(witness, /expectedBonfireLateralDamping/, 'witness verifies bonfire lateral damping ablation route/control identity');
assert.match(witness, /expectedBonfireShear/, 'witness verifies bonfire shear ablation route/control identity');
assert.match(witness, /expectedBonfireDetailForces/, 'witness verifies bonfire detail-force ablation route/control identity');
assert.match(witness, /expectedBonfireDepinch/, 'witness verifies bonfire depinch ablation route/control identity');
assert.match(witness, /expectedBonfireProjection/, 'witness verifies bonfire projection ablation route/control identity');
assert.match(witness, /expectedBonfireTemporal/, 'witness verifies bonfire temporal ablation route/control identity');
assert.match(witness, /expectedBonfireInstabilityProbe/, 'witness verifies non-production instability probe route/control identity');
assert.match(witness, /bonfireAblation/, 'witness records effective bonfire ablation controls in the report');
assert.match(witness, /bonfireReferenceConfinement/, 'witness records effective bonfire reference-confinement route identity');
assert.match(witness, /volumeScene/, 'witness records effective named volume scene identity');
assert.match(witness, /renderScale/, 'witness records effective internal render scale');
assert.match(witness, /displayWidth/, 'witness records displayed canvas width');
assert.match(witness, /renderWidth/, 'witness records internal render width');
assert.match(witness, /renderPixelRatio/, 'witness records render-to-display pixel ratio');
assert.match(witness, /volumeResidualMode/, 'witness records effective residual mode when residual reconstruction is active');
assert.match(witness, /volumeResidualFeatureAuthority/, 'witness records residual feature-plane authority identity');
assert.match(witness, /volumeResidualFeatureDebugMode/, 'witness records residual feature debug visualization identity');
assert.match(witness, /volumeResidualCost/, 'witness records residual application cost evidence');
assert.match(witness, /recoverIdentityFrameState[\s\S]*Page\.captureScreenshot[\s\S]*debugState/, 'witness forces a compositor read and rechecks debug state before failing slow/backgrounded volume identity');
assert.match(witness, /function wsRequest[\s\S]*setInterval[\s\S]*clearInterval/, 'CDP websocket requests keep Node alive until each browser response resolves or rejects');
assert.match(witness, /expectedExternalEmitterMode/, 'witness verifies external emitter route identity when requested');
assert.match(witness, /externalEmitterMode/, 'witness records external emitter mode');
assert.match(witness, /externalEmitterCount/, 'witness records effective external emitter count');
assert.match(witness, /externalEmitterCoordinateSpace/, 'witness records external emitter coordinate space');
assert.match(witness, /externalEmitterAgeMs/, 'witness records external emitter age');
assert.match(witness, /setExternalEmitters/, 'witness can seed synthetic external emitter payloads through the public API');
assert.match(witness, /fireScale/, 'witness records effective apparent fire/world scale');
assert.match(witness, /detailScale/, 'witness records effective fine-detail scale');
assert.match(witness, /visibleDetailOverlayGain/, 'witness records whether raymarch fine-detail overlays are active');
assert.match(witness, /tallPlumeDetailFrequencySource/, 'witness records whether tall-plume detail frequency is decoupled from Fire Scale');
assert.match(witness, /tallPlumeReactionCadenceDebug/, 'witness records the effective tall-plume source/reaction cadence identity');
assert.match(witness, /tallPlumeFlameCutoffContract/, 'witness records the effective tall-plume flame cutoff/speed identity');
assert.match(witness, /tallPlumeFlowShelfContract/, 'witness records the effective tall-plume flow-rate shelf mitigation identity');
assert.match(witness, /tallPlumeFlameHeightLawContract/, 'witness records the effective tall-plume reaction/fuel flame-height law identity');
assert.match(witness, /expectedSpeed/, 'witness records the route-applied speed for repeatable flame cutoff probes');
assert.match(witness, /plumeHeight/, 'witness records effective plume height/world-rise scale');
assert.match(witness, /windStrength/, 'witness records effective explicit wind strength');
assert.match(witness, /windAngle/, 'witness records effective explicit wind direction');
assert.match(witness, /windHeight/, 'witness records effective explicit wind height/ramp');
assert.match(witness, /simCostLedger/, 'witness records sim-cost ledger evidence');
assert.match(witness, /tall-plume-sim-cost-ledger-v0/, 'witness requires the tall-plume sim-cost ledger identity');
assert.match(witness, /fullGridCellVisitsPerFrame/, 'witness reports full-grid cell visit cost');
assert.match(witness, /mainFluidKernelStrategy/, 'witness reports the main-fluid kernel strategy');
assert.match(witness, /main-fluid-zero-fire-lick-bypass-v0/, 'witness recognizes the zero-fire-lick bypass strategy');
assert.match(witness, /mainFluidLocalProjectionStrategy/, 'witness reports the main-fluid local projection strategy');
assert.match(witness, /main-fluid-local-projection-staged-pressure-only-v0/, 'witness recognizes the staged-only main-fluid local projection strategy');
assert.match(witness, /mainFluidLocalProjectionDivergenceEvaluationsPerCell/, 'witness reports main-fluid local projection divergence evaluations per cell');
assert.match(witness, /fireLickBreakupEvaluationsPerCell/, 'witness reports fire-lick breakup evaluations per cell');
const selectiveHeadLiveWitness = readFileSync(join(root, 'volume-selective-head-live-witness.mjs'), 'utf8');
const selectiveHeadLiveSequenceWitness = readFileSync(join(root, 'volume-selective-head-live-sequence-witness.mjs'), 'utf8');
const selectiveHeadCompositionWitness = readFileSync(join(root, 'volume-selective-head-composition-witness.mjs'), 'utf8');
const selectiveHeadLivePage = readFileSync(join(root, 'volume-selective-head-live.html'), 'utf8');
assert.match(core, /SELECTIVE_HEAD_LIVE_RENDER_COMPOSITIONS/, 'selective-head live renderer compositions are explicit identities, not hidden pass side effects');
assert.match(core, /splat-only-v0/, 'selective-head live supports a splat-only attribution composition');
assert.match(core, /raymarch-only-v0/, 'selective-head live supports a raymarch-only diagnostic composition');
assert.match(core, /smoke-raymarch-under-splats-v0/, 'selective-head live supports the non-double-counted smoke raymarch under splat-fire composition');
assert.match(core, /full-raymarch-under-splats-diagnostic-v0/, 'selective-head live preserves the old full-fire hybrid only as an explicit diagnostic');
assert.match(core, /normalizeSelectiveHeadLiveRenderComposition/, 'selective-head live normalizes requested renderer composition before use');
assert.match(core, /selectiveHeadLiveCompositionRequestedRaw/, 'selective-head live debug state preserves the raw requested renderer composition');
assert.match(core, /selectiveHeadLiveCompositionRequested/, 'selective-head live debug state records requested renderer composition');
assert.match(core, /selectiveHeadLiveCompositionEffective/, 'selective-head live debug state records effective renderer composition');
assert.match(core, /selectiveHeadLiveCompositionFallbackReason/, 'selective-head live fails loud when renderer composition is substituted');
assert.match(core, /selectiveHeadLivePassReceipt/, 'selective-head live reports exactly which raymarch and splat passes were encoded and applied');
assert.match(core, /setControls\(next\)[\s\S]*selectiveHeadLiveRenderCompositionRequest/, 'route-init controls normalize renderer composition in setControls without depending on render-loop locals');
assert.match(core, /smoke-raymarch-authority-broad-smoke-only-v0/, 'smoke-hybrid mode names the raymarch authority partition');
assert.match(core, /splat-fire-authority-learned-boundary-sheets-v0/, 'smoke-hybrid mode names the splat fire-sheet authority partition');
assert.doesNotMatch(core, /const selectiveHybrid = state\.selectiveHeadLiveEffectiveRole !== 'off';[\s\S]*loadOp: selectiveHybrid \? 'load' : 'clear'/, 'selective-head live must not silently equate role-on with full raymarch-under-splats');
assert.match(selectiveHeadLivePage, /data-splats-enabled/, 'operator page exposes ordinary splat authority explicitly');
assert.match(selectiveHeadLivePage, /data-smoke-presentation="on"[\s\S]*data-smoke-presentation="off"/, 'operator page exposes ordinary smoke authority explicitly');
assert.match(selectiveHeadLivePage, /function deriveRequestedBeautyComposition\(\)[\s\S]*smoke-raymarch-under-splats-v0[\s\S]*splat-only-v0[\s\S]*raymarch-only-v0/, 'operator page derives ordinary composition without ambiguous full-fire duplication');
assert.doesNotMatch(selectiveHeadLivePage, /data-composition="full-raymarch-under-splats-diagnostic-v0"/, 'operator page keeps the old full hybrid out of compact controls');
assert.match(selectiveHeadLivePage, /legacyDiagnosticCompositionRequested/, 'explicit diagnostic composition routes remain compatible');
assert.match(selectiveHeadLivePage, /composition authority/i, 'operator status labels renderer composition authority');
assert.match(selectiveHeadLivePage, /pass receipt/i, 'operator status labels applied pass receipts');
assert.match(selectiveHeadLiveWitness, /expectedComposition/, 'selective-head live witness verifies requested renderer composition');
assert.match(selectiveHeadLiveWitness, /composition drift/i, 'selective-head live witness rejects composition drift during observation');
assert.match(selectiveHeadLiveWitness, /selectiveHeadLivePassReceipt/, 'selective-head live witness records pass receipts');
assert.match(selectiveHeadLiveSequenceWitness, /composition drift/i, 'selective-head sequence witness rejects per-frame composition drift');
assert.match(selectiveHeadLiveSequenceWitness, /selectiveHeadLivePassReceipt/, 'selective-head sequence witness records pass receipts for encoded frames');
for (const source of [selectiveHeadLiveWitness, selectiveHeadLiveSequenceWitness, selectiveHeadCompositionWitness]) {
  assert.match(source, /isInspectablePageTarget/, 'selective-head witnesses reject Chrome extension targets before CDP evaluation');
  assert.ok(source.includes('chrome-extension://'), 'selective-head witnesses make extension-target fallback impossible to confuse with page evidence');
}
assert.ok(selectiveHeadCompositionWitness.includes("lastTrustworthyEvidence = { phase: 'route-settle', state };"), 'same-state composition witness preserves route-settle state on pre-capture failure');
assert.match(witness, /pressureSourceStrategy/, 'witness reports pressure source strategy');
assert.match(witness, /tallPlumePressureIterationStrategy/, 'witness reports tall-plume pressure iteration strategy');
assert.match(witness, /tall-plume-pressure2-v0/, 'witness recognizes the tall-plume pressure2 strategy');
assert.match(witness, /expectedTallPlumePressureIterationStrategy/, 'witness verifies tall-plume pressure2 route/default identity');
assert.match(witness, /tallPlumePressureTierStrategy/, 'witness reports spatial pressure tier strategy');
assert.match(witness, /tall-plume-spatial-pressure-tiers-v0/, 'witness recognizes tall-plume spatial pressure tiers');
assert.match(witness, /pressureProjectionReadStrategy/, 'witness reports composite pressure projection read strategy');
assert.match(witness, /composite-pressure-tier-read-v0/, 'witness recognizes composite pressure tier reads');
assert.match(witness, /pressureJacobiFullGridEquivalentPasses/, 'witness reports equivalent full-grid pressure tier work');
assert.match(witness, /pressureTierDispatches/, 'witness reports partial pressure tier dispatches');
assert.match(witness, /pressureTierRequestedBounds/, 'witness reports requested pressure tier thresholds');
assert.match(witness, /pressureTierEffectiveBounds/, 'witness reports dispatch-effective pressure tier thresholds');
assert.match(witness, /pressureTierOverlayOpacity/, 'witness reports pressure-tier overlay opacity');
assert.match(witness, /expectedTallPlumePressureTierStrategy/, 'witness verifies spatial pressure tier route identity');
assert.match(witness, /jacobi-inline-divergence-v0/, 'witness recognizes inline-divergence pressure source identity');
assert.match(witness, /pressureDivergencePasses/, 'witness reports pressure divergence pass cost');
assert.match(witness, /pressureJacobiPasses/, 'witness reports pressure Jacobi pass cost');
assert.match(witness, /pressureJacobiInlineDivergencePasses/, 'witness reports Jacobi inline-divergence pressure cost');
assert.match(witness, /fullGridPassBreakdown/, 'witness reports pass-level full-grid breakdown');
assert.match(witness, /performance-volume-signal/, 'witness has a performance visual-evidence mode that does not confuse low-fire measurement frames with missing output');
assert.match(witness, /low-fire-performance-evidence/, 'performance witness preserves low-fire visual frames as warnings instead of failing before primary cost reports');
assert.match(witness, /pyro-material/, 'witness accepts a visible Pyro material-memory evidence mode');
assert.match(witness, /pyro-material-coupled-volume-signal/, 'witness reports Pyro material-memory visual evidence identity');
assert.match(witness, /pyro-material-memory-spatial-coupling-v0/, 'witness requires the spatial Pyro material-memory renderer coupling identity');
assert.match(witness, /expectsPyroMaterialEvidence/, 'witness separates Pyro material-memory visual evidence from ordinary orange-fire gates');
assert.match(witness, /pyroRawCarrierPaintEvidence/, 'witness reports raw-carrier Pyro Flame Paint evidence separately from stock fire-layer evidence');
assert.match(witness, /pyro-raw-carrier-paint-evidence-v0/, 'witness names the raw-carrier Pyro Flame Paint evidence identity');
assert.match(witness, /stock-fire-layer-low-but-raw-pyro-carrier-live/, 'Pyro material witness can accept low stock fire-layer readback only when raw live carriers prove authority');
assert.match(witness, /no-fire-volume/, 'witness accepts a deliberate no-fire volume evidence mode');
assert.match(witness, /no-fire-volume-signal/, 'witness reports no-fire volume visual evidence identity');
assert.match(witness, /expectsNoFireVolumeEvidence/, 'witness separates deliberate no-fire evidence from missing fire failures');
assert.match(witness, /if \(\s*!expectsCanonicalPlumeProof\s*&&\s*!expectsFuelStarvedTallPlume\s*&&\s*!expectsNoFireVolumeEvidence\s*&&\s*\(!Number\.isFinite\(sample\.simReadback\.fireLayerMean\) \|\| sample\.simReadback\.fireLayerMean <= 0\.0005\)\s*&&\s*!acceptsRawCarrierPyroPaint\s*\)/, 'no-fire evidence routes do not require positive transported fire-layer readback');
assert.match(witness, /!expectsFuelStarvedTallPlume\s*&&\s*!expectsNoFireVolumeEvidence[\s\S]*radianceMean/, 'no-fire evidence routes do not require positive fire radiance readback');
assert.match(witness, /pyroDynamicDetail/, 'witness report carries Pyro dynamic detail state and reset semantics');
assert.match(witness, /rayBudgetPreset/, 'witness records named ray-budget preset/config identity when present');
assert.match(witness, /timing/, 'witness records route-local timing evidence');
assert.match(witness, /queueDoneMs/, 'witness records GPU queue completion timing when available');
assert.match(witness, /timingEvidenceSource/, 'witness records timing evidence provenance');
assert.match(witness, /not-gpu-exclusive-or-present-latency/, 'witness preserves timing proxy disclaimer');
assert.match(witness, /windowSize/, 'witness accepts an explicit browser window size for fullscreen-ish sweeps');
assert.match(witness, /simStepCount/, 'witness records simulation step count');
assert.match(witness, /simReadback/, 'witness records simulation readback evidence');
assert.match(witness, /function parseCliArgs[\s\S]*next && !next\.startsWith\('--'\)[\s\S]*true[\s\S]*parsed\.set\(key, value\)/, 'volume witness parses bare boolean flags without swallowing the next option');
assert.match(witness, /detailMean/, 'witness records transported material detail evidence');
assert.match(witness, /simGridLabel/, 'witness records human-readable sim grid identity');
assert.match(witness, /velocity-material-fire-microdetail-storage-buffer/, 'witness requires the microdetail storage label');
assert.match(witness, /fireLayerMean/, 'witness requires transported fire layer evidence');
assert.match(witness, /combustionFrontMean/, 'witness requires transported combustion-front evidence when bonfire fire is visible');
assert.match(witness, /radianceMean/, 'witness requires fire radiance evidence');
assert.match(witness, /boundaryFireReadbackEvidence[\s\S]*emissionDetailMean[\s\S]*combustionFrontMean[\s\S]*frontTopologyMean/, 'boundary-fire inspect/shell routes can prove live fire from topology/emission carriers when stock radiance is intentionally zero');
assert.match(witness, /fireFuelOverlapRatio <= 0\.01[\s\S]*!boundaryFireReadbackEvidence\.acceptsZeroRadiance/, 'boundary-fire inspect/shell routes do not fail tall-plume support solely because stock fire/fuel overlap is intentionally bypassed');
assert.match(witness, /boundaryFireMainRendererEvidence[\s\S]*boundaryFireReadbackEvidence\.acceptsZeroRadiance[\s\S]*mainRendererMetrics\.litPixels[\s\S]*mainRendererMetrics\.meanLuma/, 'boundary-fire inspect/shell routes do not require orange-fire screenshot classification when live topology/emission carriers and lit main-renderer volume are present');
assert.match(witness, /boundaryFireVisualEvidence[\s\S]*boundaryFireReadbackEvidence\.acceptsZeroRadiance[\s\S]*metrics\.litPixels[\s\S]*metrics\.volumeBounds[\s\S]*metrics\.meanLuma/, 'boundary-fire inspect/shell routes do not require orange-fire cropped preview classification when live topology/emission carriers and visible volume bounds are present');
assert.match(witness, /extinctionMean/, 'witness requires smoke extinction evidence');
assert.match(witness, /emissiveLikePixels/, 'witness records emissive-fire visual evidence separately from generic fire color');
assert.match(witness, /volumeBounds/, 'witness records visual volume bounds for scale-scene comparison');
assert.match(witness, /fireBounds/, 'witness records visual fire bounds for bottom-fireball scene checks');
assert.match(witness, /smokeBounds/, 'witness records visual smoke bounds for rising plume scene checks');
assert.match(witness, /fireRoughnessMean/, 'witness records fire roughness evidence for bonfire source shape');
assert.match(witness, /fireEdgeEnergy/, 'witness records fire edge energy evidence for bonfire source shape');
assert.match(witness, /normalizedCenterX/, 'witness records normalized screen-space center for drift/bias checks');
assert.match(witness, /screenDriftX/, 'witness records signed screen-space drift from frame center');
assert.match(witness, /verticalFillRatio/, 'witness records vertical fill ratio for tall-plume scale checks');
assert.match(witness, /microdetailMean/, 'witness requires transported microdetail evidence');
assert.match(witness, /interfaceShredMean/, 'witness requires interface shredding evidence');
assert.match(witness, /fireLickMean/, 'witness requires fire-lick breakup evidence');
assert.match(witness, /expectsInterfaceShredEvidence/, 'witness only requires interface shredding evidence when the route requests it');
assert.match(witness, /expectsFireLickEvidence/, 'witness only requires fire-lick evidence when the route requests it');
assert.match(witness, /expectsMicrodetailEvidence/, 'witness only requires microdetail evidence when the route requests it');
assert.match(witness, /expectsCurlEvidence/, 'witness only requires curl evidence when the route requests it');
assert.match(witness, /plumeHeightBins/, 'witness preserves sim-space per-height plume drift bins');
assert.match(witness, /expectsBonfireVerticalTransport/, 'witness requires scene-aware vertical transport evidence for the bonfire plume');
assert.match(witness, /smokeVisualRiseDisplacement/, 'witness records source-relative smoke rise displacement for the bonfire plume');
assert.match(witness, /sourceRelativeVisualHeightBins/, 'witness records source-relative height bins for scene-aware vertical transport');
assert.match(witness, /expectsBonfireZeroDrift/, 'witness requires zero-wind bonfire drift evidence separately from vertical rise evidence');
assert.match(witness, /bonfire plume retained non-wind lateral drift/, 'witness fails loudly when zero-wind bonfire drift remains nonzero');
assert.match(core, /risingSmokeVisualRiseDisplacement/, 'sim readback reports source-relative rising-plume displacement separately from fireball/source smoke center');
assert.match(witness, /risingSmokeVisualRiseDisplacement/, 'witness gates bonfire plume rise on source-relative rising-plume bins instead of only source-weighted smoke center');
assert.match(core, /smokeVerticalStripeRatio/, 'visual readback reports vertical striping so columnar non-convective smoke cannot pass as plume motion');
assert.match(witness, /smokeVerticalStripeRatio/, 'witness records smoke vertical stripe evidence for bonfire plume visual failures');
assert.match(witness, /bonfire plume retained vertical curtain striping/, 'witness fails loudly when a centered bonfire plume still resolves as vertical curtains');
assert.match(witness, /bonfire plume retained centerline chimney pinching/, 'witness fails loudly when the bonfire plume narrows into a centered point instead of keeping a broad rolling smoke body');
assert.match(witness, /bonfire plume retained smooth fire source plug/, 'witness fails loudly when the bonfire base remains a smooth oval emitter feeding the smoke column');
assert.match(witness, /combustionFrontSourcePlugRatio/, 'witness preserves combustion-front source concentration evidence in fire-plug failures');
assert.match(witness, /combustionFrontRisingBodyRatio/, 'witness preserves combustion-front rising-body evidence in fire-plug failures');
assert.match(witness, /emissionDetailVerticalCoherence/, 'witness preserves transported emission-detail coherence evidence in fire-plug failures');
assert.match(witness, /smokeDetailVerticalCoherence/, 'witness preserves smoke-detail coherence evidence in fire-plug failures');
assert.match(witness, /emissionDetailCurlContact/, 'witness preserves emission-detail curl/contact evidence in fire-plug failures');
assert.doesNotMatch(core, /let bonfireSmokeBand = smoothstep\(bonfireSourceY - 0\.54, bonfireSourceY - 0\.26, p\.y\)/, 'bonfire smoke source must not stamp a broad vertical sleeve above the fire every frame');
assert.match(core, /plumeLocalLateralVelocityMean/, 'sim readback reports smoke-weighted local lateral velocity so zero drift cannot mean dead lateral transport');
assert.match(core, /plumeNetLateralVelocity/, 'sim readback reports smoke-weighted net lateral velocity separately from local lateral energy');
assert.match(core, /plumeLateralVelocityBalance/, 'sim readback reports local-vs-net lateral balance for zero-mean convection');
assert.match(core, /plumeRadialVelocityAbsMean/, 'sim readback reports radial entrainment/outflow motion instead of only vertical velocity');
assert.match(core, /plumeSmokeWeightedCurlMean/, 'sim readback reports smoke-weighted plume curl instead of global sparse-grid curl only');
assert.match(witness, /expectsBonfireConvectionProof/, 'witness has a simulation-first bonfire convection proof gate');
assert.match(witness, /bonfire plume lacked local zero-mean convection/, 'witness fails centered-but-dead bonfire columns instead of using visuals as proof');
assert.match(witness, /captureViewportScreenshot/, 'witness can preserve a large viewport screenshot when thumbnail readback hides striping artifacts');
assert.match(witness, /fullScreenshot/, 'witness report names the full-size screenshot artifact when captured');
assert.match(witness, /for \(let i = 0; i < 80; i\+\+\)/, 'witness waits through first-frame WebGPU warmup before declaring a volume route dead');
assert.match(witness, /volume route did not render enough frames \(\$\{state\.frameCount/, 'witness failure reports observed frame and viewport counts instead of a bare timeout');
assert.match(witness, /curlMean/, 'witness requires curl diagnostic evidence');
assert.match(witness, /divergenceMean/, 'witness requires divergence diagnostic evidence');
assert.match(witness, /gridOverlay/, 'witness records grid overlay/debug state');
assert.match(witness, /blank frame/i, 'witness fails loudly on blank visual output');

const sweepPath = join(root, 'volume-sweep.mjs');
assert.ok(existsSync(sweepPath), 'volume-sweep.mjs exists');
const sweep = existsSync(sweepPath) ? readFileSync(sweepPath, 'utf8') : '';
assert.doesNotMatch(sweep, /i\s*\+=\s*2\)\s*\{\s*args\.set\(process\.argv\[i\], process\.argv\[i \+ 1\]\)/, 'sweep CLI parser must not treat boolean flags as value-taking pairs');
assert.match(sweep, /volume_resolution/, 'sweep harness varies simulation grid resolution by route');
assert.match(sweep, /volume_steps/, 'sweep harness can pin ray-step budgets');
assert.match(sweep, /COMPACT_MATRIX_SCENARIOS/, 'sweep harness carries named compact visual/perf matrix scenarios');
assert.match(sweep, /parseScenarioList/, 'sweep harness can run a bounded subset of named scenarios');
assert.match(sweep, /volume_render_scale/, 'sweep matrix varies internal render scale explicitly');
assert.doesNotMatch(sweep, /volume_majorant_|volume_temporal_|volume_history_clamp/, 'sweep matrix does not route retired raymarch controls');
assert.match(sweep, /volume_external_emitters/, 'sweep matrix includes the synthetic external-emitter workload');
assert.match(sweep, /PERFORMANCE_MATRIX_ID/, 'performance sweep carries a durable matrix identity');
assert.match(sweep, /tall-plume-performance-matrix-v0/, 'performance sweep identity names the tall plume matrix contract');
assert.match(sweep, /PERFORMANCE_MATRIX_SCENARIOS/, 'sweep harness carries named tall-plume performance scenarios');
assert.match(sweep, /matrixMode === 'performance'/, 'sweep harness can run the tall-plume performance matrix');
assert.match(sweep, /volume_tall_preset/, 'performance sweep pins the tall-plume preset instead of inheriting stale defaults');
assert.match(sweep, /preset-identity-not-retained/, 'performance sweep records a missing tall-preset echo as a warning instead of silent closure');
assert.match(sweep, /tallPresetEvidence/, 'performance sweep records whether tall-preset identity was reported or inferred from expanded controls');
assert.match(sweep, /expanded-controls/, 'performance sweep can validate expanded control identity when the app does not echo a preset label');
assert.match(sweep, /volume_reaction_fuel/, 'performance sweep pins reaction fuel scale');
assert.match(sweep, /volume_microdetail/, 'performance sweep pins microdetail');
assert.match(sweep, /volume_interface_shred/, 'performance sweep pins interface shred');
assert.match(sweep, /volume_fire_licks/, 'performance sweep pins fire licks');
assert.match(sweep, /volume_projection/, 'performance sweep pins projection');
assert.match(sweep, /volume_speed/, 'performance sweep pins plume speed');
assert.match(sweep, /volume_density/, 'performance sweep pins density');
assert.match(sweep, /volume_fire/, 'performance sweep pins fire visibility');
assert.match(sweep, /volume_smoke/, 'performance sweep pins smoke visibility');
assert.match(sweep, /volume_glow/, 'performance sweep pins glow');
assert.match(sweep, /volume_wind_strength/, 'performance sweep pins wind strength');
assert.match(sweep, /volume_input_radius/, 'performance sweep pins source input radius');
assert.match(sweep, /volume_pressure_iterations/, 'performance sweep pins pressure iteration count');
assert.match(sweep, /volume_pressure_strategy/, 'performance sweep can select spatial pressure strategy by route');
assert.match(sweep, /volume_sim_profile/, 'performance sweep requests the simulation cost profile');
assert.match(sweep, /pressureIterations: 2/, 'performance sweep tall-plume baseline defaults to pressure2');
assert.match(sweep, /tallPlumePressureIterationStrategy/, 'sweep aggregate preserves tall-plume pressure iteration strategy');
assert.match(sweep, /tall-plume-pressure2-v0/, 'sweep validation recognizes tall-plume pressure2 strategy');
assert.match(sweep, /tallPlumePressureTierStrategy/, 'sweep aggregate preserves spatial pressure tier strategy');
assert.match(sweep, /tall-plume-spatial-pressure-tiers-v0/, 'sweep validation recognizes spatial pressure tier strategy');
assert.match(sweep, /pressureJacobiFullGridEquivalentPasses/, 'sweep aggregate preserves equivalent full-grid pressure tier work');
assert.match(sweep, /pressureProjectionReadStrategy/, 'sweep aggregate preserves composite pressure projection read strategy');
assert.match(sweep, /pressureTierRequestedBounds/, 'sweep aggregate preserves requested pressure tier thresholds');
assert.match(sweep, /pressureTierEffectiveBounds/, 'sweep aggregate preserves dispatch-effective pressure tier thresholds');
assert.match(sweep, /pressureTierOverlayOpacity/, 'sweep aggregate preserves pressure-tier overlay opacity');
assert.match(sweep, /--evidence-mode/, 'performance sweep forwards explicit witness evidence mode');
assert.match(sweep, /aggregate/, 'sweep harness writes aggregate evidence across runs');
assert.match(sweep, /effectiveConfig/, 'sweep aggregate records effective renderer configuration, not only requested knobs');
assert.match(sweep, /prototypeIdentity/, 'sweep aggregate preserves the effective prototype identity');
assert.match(sweep, /simCostLedger/, 'sweep aggregate preserves the simulation cost ledger');
assert.match(sweep, /fullGridPassesPerFrame/, 'sweep aggregate preserves full-grid pass count');
assert.match(sweep, /fullGridCellVisitsPerFrame/, 'sweep aggregate preserves full-grid cell visit count');
assert.match(sweep, /fluidBufferBytes/, 'sweep aggregate preserves fluid buffer byte estimates');
assert.match(sweep, /mainFluidKernelStrategy/, 'sweep aggregate preserves main-fluid kernel strategy');
assert.match(sweep, /mainFluidLocalProjectionStrategy/, 'sweep aggregate preserves main-fluid local projection strategy');
assert.match(sweep, /mainFluidLocalProjectionDivergenceEvaluationsPerCell/, 'sweep aggregate preserves main-fluid local projection divergence evaluations per cell');
assert.match(sweep, /fireLickBreakupEvaluationsPerCell/, 'sweep aggregate preserves fire-lick breakup evaluations per cell');
assert.match(sweep, /pressureSourceStrategy/, 'sweep aggregate preserves pressure source strategy');
assert.match(sweep, /pressureDivergencePasses/, 'sweep aggregate preserves pressure divergence cost');
assert.match(sweep, /pressureJacobiPasses/, 'sweep aggregate preserves pressure projection cost');
assert.match(sweep, /pressureJacobiInlineDivergencePasses/, 'sweep aggregate preserves Jacobi inline-divergence pressure cost');
assert.match(sweep, /pressureEffectiveLabelForRun/, 'sweep derives the expected pressure label for default, tiered, full, and routed-global pressure modes');
assert.match(sweep, /pressure-effective-label-mismatch/, 'sweep validation fails loudly when the visible pressure label does not match effective route identity');
assert.match(sweep, /fullGridPassBreakdown/, 'sweep aggregate preserves pass-level full-grid breakdown');
assert.match(sweep, /performanceMatrixId/, 'sweep aggregate preserves the performance matrix identity');
assert.match(sweep, /wrong-fallback-route/, 'sweep validation names wrong-route false closure');
assert.match(sweep, /stale-default-config/, 'sweep validation names stale/default config false closure');
assert.match(sweep, /missing-primary-report/, 'sweep failure records missing primary reports');
assert.match(sweep, /blank-or-partial-output/, 'sweep validation names blank or partial output false closure');
assert.match(sweep, /absent-effective-identity/, 'sweep validation names absent identity false closure');
assert.match(sweep, /failurePhase/, 'sweep failures preserve the phase that failed');
assert.match(sweep, /validation/, 'sweep runs preserve validation evidence');
assert.match(sweep, /timingEvidenceSource/, 'sweep aggregate preserves timing evidence-source labels');
assert.match(sweep, /timingDisclaimer/, 'sweep aggregate preserves timing proxy disclaimer labels');
assert.match(sweep, /performanceVisualWarnings/, 'performance sweep preserves witness visual warnings in aggregate evidence');
assert.match(sweep, /density:\s*witness\.density\s*\?\?\s*controls\.density/, 'performance sweep validates requested controls against effective witness controls instead of treating nested control echoes as stale defaults');
assert.match(sweep, /scoreSweepRun/, 'sweep harness computes a compact recommendation score from visual and timing evidence');
assert.match(sweep, /recommendationRank/, 'sweep aggregate emits a ranked scenario surface for operator triage');
assert.match(sweep, /--window-size/, 'sweep harness forwards explicit browser window size to the witness');
assert.match(sweep, /frameP95Ms/, 'sweep aggregate preserves route-local frame p95 timing');
assert.match(sweep, /queueDoneP95Ms/, 'sweep aggregate preserves GPU queue-completion p95 timing');
assert.match(sweep, /screenshot/, 'sweep aggregate preserves per-run screenshot paths for visual inspection');

const greenroomBenchmarkPath = join(root, 'volume-greenroom-benchmark.mjs');
assert.ok(existsSync(greenroomBenchmarkPath), 'volume greenroom benchmark launcher exists');
const greenroomBenchmark = existsSync(greenroomBenchmarkPath) ? readFileSync(greenroomBenchmarkPath, 'utf8') : '';
assert.match(greenroomBenchmark, /kaminos\.volume\.greenroom-benchmark\.v0/, 'greenroom benchmark writes a stable job schema identity');
assert.match(greenroomBenchmark, /volume-sweep\.mjs/, 'greenroom benchmark wraps the existing sweep harness instead of forking benchmark logic');
assert.match(greenroomBenchmark, /--matrix['"],\s*['"]performance/, 'greenroom benchmark forces the tall-plume performance matrix');
assert.match(greenroomBenchmark, /--evidence-mode|performance matrix evidence mode/i, 'greenroom benchmark preserves the sweep evidence-mode contract');
assert.match(greenroomBenchmark, /greenroom-job\.json/, 'greenroom benchmark writes a durable job packet before running');
assert.match(greenroomBenchmark, /greenroom-run\.json/, 'greenroom benchmark writes a durable run packet after running or failing');
assert.match(greenroomBenchmark, /requestedCommand/, 'greenroom benchmark records the exact command it intends to run');
assert.match(greenroomBenchmark, /effectiveCommand/, 'greenroom benchmark records the exact command it actually ran');
assert.match(greenroomBenchmark, /cwd/, 'greenroom benchmark records the benchmark checkout cwd');
assert.match(greenroomBenchmark, /gitCommit/, 'greenroom benchmark records the git commit under test');
assert.match(greenroomBenchmark, /baseUrl/, 'greenroom benchmark records the target server route');
assert.match(greenroomBenchmark, /uncontendedEvidenceClaim/, 'greenroom benchmark must distinguish requested greenroom conditions from proven uncontended timing evidence');
assert.match(greenroomBenchmark, /dryRun/, 'greenroom benchmark supports writing the packet without spending a browser/GPU sweep');

const renderPairDatasetPath = join(root, 'volume-render-pair-dataset.mjs');
assert.ok(existsSync(renderPairDatasetPath), 'volume render-scale pair dataset extractor exists');
const renderPairDataset = existsSync(renderPairDatasetPath) ? readFileSync(renderPairDatasetPath, 'utf8') : '';
const renderPairCorpusPath = join(root, 'volume-render-pair-corpus.mjs');
assert.ok(existsSync(renderPairCorpusPath), 'volume render-scale pair corpus generator exists');
const renderPairCorpus = existsSync(renderPairCorpusPath) ? readFileSync(renderPairCorpusPath, 'utf8') : '';
assert.match(renderPairDataset, /kaminos\.volume\.render-pair-dataset\.v0/, 'render-pair dataset writes a stable dataset schema identity');
assert.match(renderPairDataset, /volume-witness\.mjs/, 'render-pair dataset captures frames through the witness instead of bypassing route validation');
assert.match(renderPairDataset, /lowRenderScale/, 'render-pair dataset records requested low render scale');
assert.match(renderPairDataset, /highRenderScale/, 'render-pair dataset records requested high render scale');
assert.match(renderPairDataset, /volume_render_scale/, 'render-pair dataset varies render scale through the public route parameter');
assert.match(renderPairDataset, /volumeReconstructionStyle/, 'render-pair dataset preserves effective reconstruction/upscale identity');
assert.match(renderPairDataset, /effectiveRoute/, 'render-pair dataset records effective route identity from each witness');
assert.match(renderPairDataset, /prototypeIdentity/, 'render-pair dataset records effective prototype identity from each witness');
assert.match(renderPairDataset, /renderPixelRatio/, 'render-pair dataset records low/high internal-to-display pixel ratio');
assert.match(renderPairDataset, /dryRun/, 'render-pair dataset supports a dry run manifest without spending browser/GPU time');
assert.match(renderPairDataset, /failurePhase/, 'render-pair dataset records the phase when capture or validation fails');
assert.match(renderPairDataset, /frame-locked-render-scale-set-v0/, 'render-pair dataset must expose frame-locked same-state pair authority for supervised residual training');
assert.match(renderPairDataset, /sameStateCaptureId/, 'render-pair dataset records a same-state capture identity shared by low/high scales');
assert.match(renderPairDataset, /featureCapture/, 'render-pair dataset records same-state residual feature captures when requested');
assert.match(renderPairDataset, /featurePath/, 'render-pair dataset exposes feature image paths for feature-aware residual training');
assert.match(renderPairDataset, /shader-material-authority-residual-feature-v0/, 'render-pair dataset preserves shader/material feature authority for feature images');
assert.match(renderPairDataset, /gpu-feature-texture-rgba8-readback-frozen-sim-state-source-pass/, 'render-pair dataset preserves source-pass feature readback authority');
assert.match(renderPairDataset, /baseFrameCount/, 'render-pair dataset records the frozen source frame count');
assert.match(renderPairDataset, /baseSimStepCount/, 'render-pair dataset records the frozen source sim-step count');
assert.match(renderPairDataset, /--render-scale-set/, 'render-pair dataset asks the witness for a same-state render-scale set');
assert.match(renderPairDataset, /supervisedResidualTrainingSuitable/, 'render-pair dataset labels whether a pair is suitable for supervised residual training');
assert.match(renderPairDataset, /--reuse-witness-browser/, 'render-pair dataset can reuse one headful witness browser across repeated captures');
assert.match(renderPairDataset, /shared-headful-cdp-browser-v0/, 'render-pair dataset records the shared headful CDP browser reuse policy');
assert.match(renderPairDataset, /witnessBrowserSession/, 'render-pair dataset records effective witness browser session identity in the manifest');
assert.match(renderPairDataset, /cleanupWitnessBrowserSession/, 'render-pair dataset closes the shared witness browser once after capture instead of per frame');
assert.match(renderPairCorpus, /shared-headful-cdp-browser-v0/, 'render-pair corpus records the shared headful browser policy for whole-corpus capture runs');
assert.match(renderPairCorpus, /corpus-owned-shared-headful-cdp-browser/, 'render-pair corpus can hold one headful browser across all variant/frame child captures');
assert.match(renderPairCorpus, /cleanupCorpusWitnessBrowserSession/, 'render-pair corpus closes its shared witness browser once after all captures');
assert.match(renderPairCorpus, /--keep-witness-browser-open/, 'render-pair corpus keeps child dataset browsers open for corpus-level cleanup');
assert.match(renderPairCorpus, /gpu-feature-texture-rgba8-readback-frozen-sim-state-source-pass/, 'render-pair corpus top-level metadata preserves source-pass feature readback authority');
const controlledStepVariantStart = renderPairCorpus.indexOf('function runControlledStepVariant');
const controlledStepVariantSummaryStart = renderPairCorpus.indexOf('const summary = {', controlledStepVariantStart);
const controlledStepVariantCommandBlock = renderPairCorpus.slice(controlledStepVariantStart, controlledStepVariantSummaryStart);
assert.match(controlledStepVariantCommandBlock, /--render-scale-feature-captures/, 'render-pair corpus forwards requested feature captures through controlled-step witness captures');
assert.match(controlledStepVariantCommandBlock, /--render-scale-auxiliary-captures/, 'render-pair corpus forwards requested Flow Debug/interface auxiliary captures through controlled-step witness captures');
assert.match(fieldSliceWitness, /sampleRenderScaleSet/, 'volume witness invokes the browser-side same-state render-scale set API');
assert.match(fieldSliceWitness, /renderFrozenScaleToCanvas/, 'volume witness renders each same-state scale to the visible canvas before image capture');
assert.match(fieldSliceWitness, /imageAuthority/, 'volume witness preserves screenshot authority for frozen-state scale images');
assert.match(fieldSliceWitness, /sourcePassApplied/, 'volume witness preserves whether feature captures came from the frozen source pass');
assert.match(fieldSliceWitness, /--render-scale-auxiliary-captures/, 'volume witness exposes auxiliary render-scale captures for debug-conditioning images');
assert.match(fieldSliceWitness, /flowDebug/, 'volume witness labels the Flow Debug/interface auxiliary capture separately from residual material features');
assert.match(fieldSliceWitness, /controlOverrides:\s*\{\s*flowDebug:\s*1\s*\}/, 'Flow Debug auxiliary capture must use the flow/interface debug control override');
assert.match(fieldSliceWitness, /canvasCssRect/, 'volume witness records canvas clip bounds for clean training images');
assert.match(fieldSliceWitness, /Page\.captureScreenshot[\s\S]*clip/, 'volume witness captures clean canvas clips instead of full-page UI screenshots for render-scale pairs');
assert.match(fieldSliceWitness, /fps-counter/, 'volume witness suppresses the in-viewport FPS HUD during clean render-scale pair capture');
assert.match(fieldSliceWitness, /hudSuppression/, 'volume witness reports HUD suppression state for clean render-scale pair capture');
assert.match(fieldSliceWitness, /--controlled-step-sequence/, 'volume witness exposes controlled-step sequence mode for temporal corpus generation');
assert.match(fieldSliceWitness, /controlledStepFrame/, 'volume witness advances the browser simulator through explicit controlled-step frames');
assert.match(fieldSliceWitness, /controlledStepSequenceReport/, 'volume witness reports controlled-step frame-locked captures for temporal corpus consumers');
assert.match(fieldSliceWitness, /--reuse-browser/, 'volume witness can attach to an existing headful browser for repeated capture');
assert.match(fieldSliceWitness, /attach-or-launch-shared-cdp-browser-v0/, 'volume witness names the attach-or-launch shared browser policy');
assert.match(fieldSliceWitness, /keepBrowserOpen/, 'volume witness can leave the shared browser alive for the dataset runner instead of killing it per capture');
assert.match(fieldSliceWitness, /unref\(\)/, 'volume witness must detach kept-open Chrome so shared-browser corpus captures do not hang after writing reports');
assert.match(core, /sampleRenderScaleSet/, 'volume core exposes a same-state multi-render-scale capture API');
assert.match(core, /compactRenderScaleSample[\s\S]*reactionFrontAtlas[\s\S]*null[\s\S]*sampleRenderScaleSet[\s\S]*compactSamples/, 'controlled-step render-scale captures compact heavy sim readback atlases before returning over CDP');
assert.match(core, /renderFrozenScaleToCanvas/, 'volume core exposes render-only frozen-state canvas capture');
const renderFrozenScaleToCanvasStart = core.indexOf('async function renderFrozenScaleToCanvas');
const renderFrozenScaleToCanvasEnd = core.indexOf('async function sampleRenderScaleSet', renderFrozenScaleToCanvasStart);
const renderFrozenScaleToCanvasBody = core.slice(renderFrozenScaleToCanvasStart, renderFrozenScaleToCanvasEnd);
assert.match(renderFrozenScaleToCanvasBody, /controlOverrides/, 'frozen render-scale canvas capture accepts explicit render-only control overrides for auxiliary debug captures');
assert.match(renderFrozenScaleToCanvasBody, /\.\.\.controlsSnapshot,\s*\.\.\.controlOverrides,\s*renderScale/, 'frozen render-scale control overrides must be applied before renderScale so requested scale remains authoritative');
assert.match(renderFrozenScaleToCanvasBody, /includeFeatureRgba[\s\S]*encodeBrowserResidualSourcePass/, 'frozen feature captures must render the residual source MRT for the requested frozen scale instead of reading a stale feature texture');
assert.match(renderFrozenScaleToCanvasBody, /encodeDraw\(encoder,\s*currentTexture\.createView\(\),\s*'kaminos frozen render-scale canvas pass'\)[\s\S]*includeFeatureRgba[\s\S]*ensureFrameTexture\(\)[\s\S]*encodeBrowserResidualSourcePass\(encoder,\s*frameTexture\.createView\(\),\s*browserResidualFeatureTexture\.createView\(\)\)/, 'frozen feature captures must preserve the normal visible RGB draw and render feature MRT into an offscreen frame texture');
assert.doesNotMatch(renderFrozenScaleToCanvasBody, /encodeBrowserResidualSourcePass\(encoder,\s*currentTexture\.createView\(\),\s*browserResidualFeatureTexture\.createView\(\)\)/, 'frozen feature source pass must not overwrite the visible canvas texture');
assert.match(renderFrozenScaleToCanvasBody, /featureCaptureSourcePassApplied/, 'frozen feature captures must report whether the source pass produced the feature texture for this capture');
assert.match(renderFrozenScaleToCanvasBody, /gpu-feature-texture-rgba8-readback-frozen-sim-state-source-pass/, 'frozen feature captures must distinguish source-pass feature readback authority from opportunistic texture readback');
assert.match(core, /advanceSim:\s*false/, 'same-state render-scale capture renders without advancing the simulator for each scale');
assert.match(core, /render-only-frozen-sim-state/, 'same-state render-scale capture labels render-only frozen simulator authority');
assert.match(core, /gpu-presentation-texture-rgba8-readback-frozen-sim-state/, 'volume core labels GPU presentation-texture authority for frozen-state scale images');

const sourceScaleProbePath = join(root, 'volume-source-scale-probe.mjs');
assert.ok(existsSync(sourceScaleProbePath), 'source-scale blobbiness probe exists');
const sourceScaleProbe = existsSync(sourceScaleProbePath) ? readFileSync(sourceScaleProbePath, 'utf8') : '';
assert.match(sourceScaleProbe, /kaminos\.volume\.source-scale-blobbiness-probe\.v0/, 'source-scale probe writes a stable manifest schema identity');
assert.match(sourceScaleProbe, /volume-witness\.mjs/, 'source-scale probe captures frames through the witness instead of bypassing route validation');
assert.match(sourceScaleProbe, /volume_input_radius/, 'source-scale probe varies source radius through the public route parameter');
assert.match(sourceScaleProbe, /volume_fire_scale/, 'source-scale probe varies fire scale through the public route parameter');
assert.match(sourceScaleProbe, /effectiveRouteIdentity/, 'source-scale probe records effective route identity from each witness');
assert.match(sourceScaleProbe, /sourceRadius/, 'source-scale probe records the requested source radius');
assert.match(sourceScaleProbe, /perimeterAreaRatio/, 'source-scale probe reports flame boundary complexity');
assert.match(sourceScaleProbe, /boundaryGradientEnergy/, 'source-scale probe reports boundary gradient energy');
assert.match(sourceScaleProbe, /localMaxCount/, 'source-scale probe reports interior lobe/local-maximum count');
assert.match(sourceScaleProbe, /saturationFraction/, 'source-scale probe reports whiteout/saturation fraction');
assert.match(sourceScaleProbe, /complexityCollapseRatio/, 'source-scale probe reports large-source complexity collapse ratios');
assert.match(sourceScaleProbe, /failurePhase/, 'source-scale probe records the failure phase before pretending to produce evidence');

const residualMlxPath = join(root, 'volume-residual-upscale-mlx.py');
assert.ok(existsSync(residualMlxPath), 'MLX residual upscaler runner exists in the branch for reproducible Greenroom jobs');
const residualMlx = existsSync(residualMlxPath) ? readFileSync(residualMlxPath, 'utf8') : '';
assert.match(residualMlx, /kaminos\.volume\.residual-upscale-mlx\.v0/, 'MLX residual runner writes a stable report schema');
assert.match(residualMlx, /frame-locked-render-scale-set-v0/, 'MLX residual runner accepts frame-locked same-state pair manifests');
assert.match(residualMlx, /cdp-canvas-clip-capture-after-render-only-frozen-sim-state/, 'MLX residual runner requires canvas-clip same-state image authority');
assert.match(residualMlx, /mx\.default_device\(\)/, 'MLX residual runner records the effective MLX device');

const residualGreenroomRunnerPath = join(root, 'volume-residual-greenroom-runner.py');
assert.ok(existsSync(residualGreenroomRunnerPath), 'Greenroom wrapper exists for residual MLX jobs');
const residualGreenroomRunner = existsSync(residualGreenroomRunnerPath) ? readFileSync(residualGreenroomRunnerPath, 'utf8') : '';
assert.match(residualGreenroomRunner, /kaminos\.volume\.residual-greenroom-runner\.v0/, 'Greenroom wrapper writes stable route-proof identity');
assert.match(residualGreenroomRunner, /mlxDefaultDevice/, 'Greenroom wrapper prints MLX default device before heavy work');
assert.match(residualGreenroomRunner, /greenroom-route-proof\.json/, 'Greenroom wrapper writes route proof into the job output directory');
assert.match(residualMlx, /--edge-band-mode/, 'MLX residual runner can derive target-error edge bands from low/high pairs');
assert.match(residualMlx, /low-gradient/, 'MLX residual runner supports low-image gradient proxy masks for inference-available edge curriculum probes');
assert.match(residualMlx, /low-luma/, 'MLX residual runner supports low-image luma proxy masks for inference-available fire/body curriculum probes');
assert.match(residualMlx, /low-gradient-luma/, 'MLX residual runner supports mixed low-image gradient+luma proxy masks');
assert.match(residualMlx, /edgeBandAuthority/, 'MLX residual runner reports whether the active edge-band mask was target-derived or low-image proxy-derived');
assert.match(residualMlx, /targetEdgeBandDeltaPsnr/, 'MLX residual runner audits proxy-mask runs against target-derived edge bands');
assert.match(residualMlx, /--edge-sampling-probability/, 'MLX residual runner can bias patch sampling toward target-error edge bands');
assert.match(residualMlx, /--edge-loss-weight/, 'MLX residual runner exposes explicit edge-band reconstruction loss');
assert.match(residualMlx, /--edge-gradient-loss-weight/, 'MLX residual runner exposes edge-band gradient loss for crisp silhouette recovery');
assert.match(residualMlx, /--outside-edge-residual-weight/, 'MLX residual runner can penalize hallucinated residual energy outside target-error edge bands');
assert.match(residualMlx, /--residual-output-limit/, 'MLX residual runner can bound residual output amplitude to prevent edge-mask ringing from poisoning background');
assert.match(residualMlx, /residualOutputLimit/, 'MLX residual runner reports the effective residual output limit');
assert.match(residualMlx, /apply_limited_residual/, 'MLX residual runner centralizes residual limiting before adding model residuals back to the low image');
assert.match(residualMlx, /--residual-application-mask-mode/, 'MLX residual runner can gate applied residuals with an inference-available mask');
assert.match(residualMlx, /residualApplicationMaskAuthority/, 'MLX residual runner reports whether the residual application mask is inference-available or target-derived');
assert.match(residualMlx, /residualApplicationMaskMode/, 'saved MLX residual artifacts preserve the residual application mask mode');
assert.match(residualMlx, /edge_band_mask/, 'MLX residual runner names the target-derived edge-band mask builder');
assert.match(residualMlx, /edgeBandPixels/, 'MLX residual runner records edge-band mask pixel counts per pair');
assert.match(residualMlx, /edgeBandDeltaPsnr/, 'MLX residual runner reports edge-band PSNR delta separately from full-frame PSNR');
assert.match(residualMlx, /outsideEdgeResidualMse/, 'MLX residual runner reports outside-edge residual damage separately from edge improvement');
assert.match(residualMlx, /residual-preview-low-model-target-targetres-modelres-error-mask\.png/, 'MLX residual runner writes a preview strip exposing target residual, model residual, remaining error, and mask');
assert.match(residualGreenroomRunner, /--edge-band-mode/, 'Greenroom residual wrapper forwards edge-band mode to the MLX runner');
assert.match(residualGreenroomRunner, /targetEdgeBandDeltaPsnr/, 'Greenroom residual wrapper preserves target-edge audit metrics from proxy-mask runs');
assert.match(residualGreenroomRunner, /--edge-sampling-probability/, 'Greenroom residual wrapper forwards edge-biased sampling probability');
assert.match(residualGreenroomRunner, /--edge-gradient-loss-weight/, 'Greenroom residual wrapper forwards edge gradient loss weight');
assert.match(residualGreenroomRunner, /--residual-output-limit/, 'Greenroom residual wrapper forwards residual output limit for bounded proxy-mask runs');
assert.match(residualGreenroomRunner, /--residual-application-mask-mode/, 'Greenroom residual wrapper forwards residual application mask mode for inference-authority gate probes');

// --- Fire irradiance light field: shared-device + same-state lattice contracts (Beaming 2026-08-31) ---
// Static resource/dispatch contracts only. Visual acceptance evidence is owned by
// the Visual-Contact PIP witness discipline and is deliberately NOT asserted here.

// Shared GPU device factory and Three seating.
assert.match(core, /export async function requestKaminosSharedWebGpuDevice\(/, 'volume core exports the shared Three/Pyro WebGPU device factory');
assert.match(core, /kaminos-three-volume-shared-webgpu-device-v0/, 'shared device contract carries stable identity');
assert.match(core, /single-explicit-device-three-and-volume-v0/, 'shared device contract names its single-device authority');
assert.match(core, /maxStorageBuffersInFragmentStage/, 'shared device factory requests per-fragment-stage storage buffer limits for Three node materials');
assert.match(index, /requestKaminosSharedWebGpuDevice/, 'index imports the shared device factory');
assert.match(index, /new THREE\.WebGPURenderer\(\{[^}]*device:\s*sharedGpu\.device/, 'Three renderer is constructed on the shared GPUDevice when available');
assert.match(index, /sharedGpuContext:\s*fingerFluidPyroCompositionRequested\(\) \? null : sharedGpu/, 'volume prototype is seated on the same shared GPU context, except the liquid-contact route that adopts the fluid solver device');

// Same-state, same-law irradiance lattice seed.
assert.match(core, /IRRADIANCE_GRID = u32\(u\.grid_shape\.z\);/, 'irradiance lattice grid size is a runtime value seated from the uniforms, not a hardcoded constant');
assert.match(core, /fn csIrradianceSeed/, 'irradiance lattice is seeded by a dedicated GPU compute entry point');
assert.match(core, /fn csIrradiancePropagate/, 'irradiance lattice has a dedicated GPU propagation entry point');
assert.match(core, /fn csIrradianceResolve/, 'irradiance lattice resolves into a sampleable atlas by a dedicated GPU entry point');
assert.match(core, /fn csIrradianceSeed[\s\S]*?emissiveTemperature\([\s\S]*?fireRadianceEmission\(/, 'irradiance seed reuses the exact raymarch emissiveTemperature and fireRadianceEmission law rather than a reimplemented palette');
assert.match(core, /fire-irradiance-lattice-32-same-state-rgb-v0/, 'irradiance lattice carries stable same-state identity');
assert.match(core, /irradianceLatticeBufferBytes/, 'irradiance lattice has an explicit storage-buffer byte size');
assert.match(core, /irradianceSeedPipeline/, 'irradiance seed has a dedicated compute pipeline');
assert.match(core, /irradiancePropagatePipeline/, 'irradiance propagation has a dedicated compute pipeline');
assert.match(core, /irradianceResolvePipeline/, 'irradiance resolve has a dedicated compute pipeline');
assert.match(core, /encodeSim\(encoder\);\s*\n\s*encodeFireIrradianceLightField\(encoder\)/, 'frame encoding seeds the irradiance lattice from the freshly advanced fluid state directly after sim');

// Native sampleable atlas export on the shared device.
assert.match(core, /gpu-fire-irradiance-lattice-atlas-v0/, 'irradiance atlas export carries stable identity');
assert.match(core, /fireIrradianceLightField\(\)/, 'volume prototype exposes the fire irradiance light field export surface');
assert.match(core, /irradianceAtlasTexture\s*=\s*device\.createTexture\(\{[\s\S]*?format:\s*'rgba16float'/, 'irradiance atlas is an HDR rgba16float GPU texture');
assert.match(core, /cpuReadbackAuthority:\s*false/, 'irradiance light field export forswears CPU readback authority');

// GPU timestamp stages for the three incremental passes.
assert.match(core, /sampleFireLightFieldGpuProfile/, 'fire light field exposes a GPU timestamp profile surface');
assert.match(core, /'irradiance-seed'/, 'GPU profile names the seed stage');
assert.match(core, /'irradiance-propagation'/, 'GPU profile names the propagation stage');
assert.match(core, /'irradiance-resolve'/, 'GPU profile names the resolve stage');

// Receiver evaluation in the Three/TSL post-forward composition.
assert.match(index, /volume_light_field/, 'URL route gates the fire light field receiver pass');
assert.match(index, /world-position-fire-light-field-receiver-pass-v0/, 'receiver pass carries stable world-position identity');
assert.match(index, /createFireLightFieldReceiverPass/, 'receiver pass has a dedicated constructor in the scene composition');
assert.match(index, /getViewPosition/, 'receiver pass reconstructs receiver position from scene depth');
assert.match(index, /lightField\.device === sharedGpu\.device/, 'receiver pass rejects atlas textures from a mismatched GPUDevice');
assert.match(index, /kaminosFireLightFieldDebugState/, 'fire light field exposes a window debug state surface');
assert.match(index, /fireLightFieldStrength/, 'receiver pass has an explicit strength/mute uniform rather than an unconditional contribution');
assert.match(index, /sceneProjectionMatrixInverse/, 'receiver pass binds the scene camera projection inverse explicitly; the output-pass TSL camera nodes resolve to the fullscreen quad camera and must not be used for unprojection');
assert.match(index, /sceneCameraWorldMatrix\.value\.copy\(camera\.matrixWorld\)/, 'receiver pass refreshes scene-camera matrices every frame');
assert.match(core, /uniforms\[316\] = effectiveSelectiveHeadRaymarchFireSuppression\(\)/, 'the smoke-only partition uniform passes through the effective suppression gate, not the raw composition request');
assert.match(core, /boundarySplatFallbackRaymarchFireSuppression\(/, 'an unavailable splat layer falls back to raymarch fire authority instead of stripping fire from the frame');

// Shell-lab fire visibility must be step-invariant: the color weight rides a
// step-length-free carrier body (mask * authority * wrinkle * snuff); alpha
// already carries per-step rayStepOpacity scaling. Gating shellColor on the
// rayStepOpacity-scaled shellAlpha double-scales by step length and collapses
// the flame toward invisibility as raySteps grows (the Sept 2026 smoke-only
// plain-route regression).
assert.match(core, /let shellVisibilityBody = clamp\(shellMask \* fireVisualAuthority \* shellWrinkle \* fireSnuffDamping/, 'shell visibility weight is built from a step-invariant carrier body');
assert.match(core, /shellColor \* shellRenderMode \* smoothstep\(0\.020, 0\.520, shellVisibilityBody\)/, 'shell color enters the accumulation gated by the step-invariant body, not by per-step shellAlpha');
assert.doesNotMatch(core, /local = local \+ shellColor \* shellRenderMode \* smoothstep\(0\.002, 0\.060, shellAlpha\)/, 'the old rayStepOpacity-scaled shellAlpha visibility gate must not return');

// The transparent-canvas override must actually reach pipeline creation:
// the WGSL default is 0.0 (opaque), and a constants object without it
// silently buries the composited Three scene behind an opaque volume canvas.
assert.match(core, /renderPipelineConstants = \{[^}]*TRANSPARENT_CANVAS: transparentCanvas \? 1 : 0/, 'raymarch pipeline constants carry the transparent-canvas override');
assert.match(core, /leanStockRenderPipelineConstants = \{ \.\.\.renderPipelineConstants|leanStockRenderPipelineConstants = \{[^}]*TRANSPARENT_CANVAS: transparentCanvas \? 1 : 0/, 'lean raymarch pipeline constants carry the transparent-canvas override (directly or by spreading the base constants)');

// Receiver shading is directional: incident light direction comes from the
// irradiance-field luminance gradient and shades true N.L against the
// world-space scene normal. The earlier camera-facing stand-in lit surfaces
// by screen orientation, producing proximity glow with no above/below
// response to the fire's actual position.
assert.match(index, /latticeGradient = vec3\(/, 'receiver recovers incident direction from the lattice luminance gradient');
assert.match(index, /worldNormalNode = sceneCameraWorldMatrix\.mul\(vec4\(normalSampleNode, 0\.0\)\)/, 'receiver rotates the prepass view-space normal into world space for shading');
assert.match(index, /normalNode\.dot\(lightDirection\)/, 'receiver shades with N.L against the recovered fire direction');
assert.match(index, /fireLightAt\(worldPositionNode, worldNormalNode\)/, 'receiver pixels shade through the shared fire light function with world position and world normal');
assert.match(index, /fireShadow\.visibilityAt\(point, normal\)/, 'world-point light probes use the same fire shadow cube as receiver pixels');
assert.match(index, /fireLightAt\(point, normal\)\.signal/, 'world-point light probes use the same fire light function as receiver pixels');
assert.doesNotMatch(index, /facingResponse = normalSampleNode\.z\.abs\(\)/, 'the camera-facing shading stand-in must not return');

// Far-field radiance: the diffusion lattice carries light only ~4 cells from
// the flame, so side geometry beyond the shell went dark (the flashlight-up
// report). The producer reduces the live field to centroid/power/color and
// the receiver adds a true 1/r^2 radial term from it, unclipped by the box.
assert.match(core, /fn csIrradianceAnalytic/, 'producer reduces the lattice to far-field meta each frame');
assert.match(core, /fire-irradiance-far-field-meta-v0/, 'far-field meta carries a stable identity');
assert.match(core, /metaTexture: irradianceMetaTexture/, 'light field export hands consumers the far-field meta texture');
assert.match(index, /farVector = fireCenterWorld\.sub\(positionNode\)/, 'receiver builds the radial vector from the reduced fire center');
assert.match(index, /farDistanceSq\.mul\(2\.5\)\.add\(0\.25\)/, 'far term falls off with squared distance, softened at the flame core');
assert.match(index, /nearSignal\.add\(farSignal\)/, 'near-field and far-field compose additively before masking');

// Operator light controls live in the Assets tab: a test-geometry toggle and
// a photographic stops gain (2^stops) on the receiver strength.
assert.match(index, /id="fire-light-test-scene-toggle"/, 'Assets tab exposes the fire-light test geometry toggle');
assert.match(index, /id="fire-light-gain-stops"/, 'Assets tab exposes the light gain slider in stops');
assert.match(index, /baseStrength \* Math\.pow\(2, passState\.gainStops \|\| 0\)/, 'receiver strength applies the stops gain as a power of two');

// Light-field route params ride the URL hash on basin/settings-preset routes,
// mirroring the composition-module seam: those routes reject unexpected
// volume_* query parameters, so query-only reading would make the light field
// unreachable on exactly the composed routes that need it.
assert.match(index, /function fireLightFieldRouteParams\(\)[\s\S]*?window\.location\.hash/, 'light-field route params merge the URL hash');
assert.match(index, /function isFireLightFieldRoute\(params = fireLightFieldRouteParams\(\)\)/, 'light-field route detection reads the merged params');
assert.doesNotMatch(index, /isFireLightFieldIsolateRoute\(params = new URLSearchParams\(window\.location\.search\)\)/, 'no light-field helper reads the query alone');

// On emissive-transport basins the legacy radiance/glow gains are zero and
// the flame comes from the emissive material law; the irradiance seed must
// follow that law or the light field is silently dark on exactly those basins
// (observed: black isolate view on elfinblue-fuckeryyy).
assert.match(core, /fn csIrradianceSeed[\s\S]*?if \(u\.physical_fire\.x > 1\.5\) \{[\s\S]*?emissiveMaterial\(r, coverage, smokeVisible\)/, 'irradiance seed follows the emissive material law when emissive transport is active');
assert.match(core, /fn csIrradianceSeed[\s\S]*?exp2\(u\.physical_display\.y\)/, 'emissive-seeded light carries the basin exposure');
