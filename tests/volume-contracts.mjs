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
assert.match(index, /Tall plume \(prototype\)/, 'Tall plume is visibly the prototype scene');
assert.match(index, /Compact plume \(superseded\)/, 'Compact plume remains visibly compatibility-only');
assert.match(index, /Canonical plume \(superseded\)/, 'Canonical plume remains visibly compatibility-only');
assert.match(index, /Bonfire plume \(superseded\)/, 'Bonfire plume remains visibly compatibility-only');
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
assert.match(sceneOntology, /DEFAULT_VOLUME_SCENE\s*=\s*'tall_plume'/, 'Unsupported or missing scene requests default to the sole prototype');
assert.match(sceneOntology, /tall_plume:[\s\S]*status:\s*'prototype'/, 'Scene ontology grants prototype authority only to tall plume');
for (const scene of ['compact_plume', 'canonical_plume', 'bonfire_plume']) {
  assert.match(sceneOntology, new RegExp(`${scene}:[\\s\\S]*?status:\\s*'superseded'[\\s\\S]*?supersededBy:\\s*'tall_plume'`), `${scene} is explicitly superseded by tall_plume`);
}
assert.match(sceneOntology, /fallbackReason:[\s\S]*unsupported-volume-scene/, 'Scene normalization reports unsupported substitution instead of hiding it');
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
assert.match(settingsPresetWitness, /steerabilityReceipt[\s\S]*settings-preset-load-here[\s\S]*restored/, 'Settings witness proves one reversible control change in the reopened cockpit');