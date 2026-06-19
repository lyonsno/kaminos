import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url).pathname;
const index = readFileSync(join(root, 'index.html'), 'utf8');

assert.match(index, /data-tab="lamellar"/, 'sidebar exposes a Lamellar tab');
assert.match(index, /id="tab-lamellar"/, 'Lamellar tab content is present');
assert.match(index, /kaminos_lamellar_witness/, 'URL route gate names the Lamellar witness');
assert.match(index, /lamellar-core\.js/, 'index imports the Lamellar witness module');
assert.match(index, /createKaminosLamellarWitness/, 'index initializes the Lamellar route explicitly');
assert.match(index, /function setActiveTab\(/, 'route initialization can activate the Lamellar tab without a click event');
assert.match(index, /id="lamellar-cut-radius"/, 'Lamellar tab exposes cut radius control');
assert.match(index, /id="lamellar-view"/, 'Lamellar tab exposes witness view selector');
assert.match(index, /id="lamellar-layer-count"/, 'Lamellar tab exposes layer count control');
assert.match(index, /id="lamellar-layer-count"[^>]*max="12"/, 'Lamellar macro layer count supports more than four layers');
assert.match(index, /id="lamellar-seed"/, 'Lamellar tab exposes procedural seed control');
assert.match(index, /id="lamellar-chirality"/, 'Lamellar tab exposes chirality control');
assert.match(index, /id="lamellar-chirality-pattern"/, 'Lamellar tab exposes chirality pattern through layers');
assert.match(index, /id="lamellar-shell-recipe"/, 'Lamellar tab exposes a shell recipe selector for coherent procedural starts');
assert.match(index, /equator-belts/, 'Lamellar shell recipes include an equator belt start');
assert.match(index, /opposing-belts/, 'Lamellar shell recipes include an opposing belts start');
assert.match(index, /polar-crown/, 'Lamellar shell recipes include a polar crown start');
assert.match(index, /diagonal-cage/, 'Lamellar shell recipes include a diagonal cage start');
assert.match(index, /nested-cup/, 'Lamellar shell recipes include a nested cup start');
assert.match(index, /function applyLamellarShellRecipe\(/, 'Lamellar UI can apply a selected shell recipe to macro controls');
assert.match(index, /__kaminosLamellarApplyShellRecipe/, 'Lamellar UI exposes recipe application for browser witnesses');
assert.match(index, /id="lamellar-depth-spacing"/, 'Lamellar tab exposes layer depth spacing control');
assert.match(index, /id="lamellar-chunkiness"/, 'Lamellar tab exposes layer chunkiness control');
assert.match(index, /id="lamellar-chunkiness-variance"/, 'Lamellar tab exposes chunkiness variance control');
assert.match(index, /id="lamellar-save-authoring"/, 'Lamellar tab exposes authoring-state save action');
assert.match(index, /id="lamellar-load-authoring"/, 'Lamellar tab exposes authoring-state load action');
assert.match(index, /id="lamellar-export-authoring"/, 'Lamellar tab exposes backup authoring-state export action');
assert.match(index, /id="lamellar-import-authoring"/, 'Lamellar tab exposes backup authoring-state import action');
assert.match(index, /id="lamellar-saved-state-list"/, 'Lamellar tab exposes an in-app saved-state shelf');
assert.match(index, /id="lamellar-authoring-file-input"/, 'Lamellar tab exposes authoring-state file input');
assert.match(index, /id="lamellar-authoring-status"/, 'Lamellar tab reports authoring save/load status');
assert.match(index, /kaminos\.lamellar-authoring\.v0/, 'Lamellar authoring save/load uses a stable schema id');
assert.match(index, /kaminos\.lamellar\.saved-states\.v0/, 'Lamellar saved-state shelf uses a stable local storage key');
assert.match(index, /function collectLamellarAuthoringState\(/, 'Lamellar UI can collect authoring state for save');
assert.match(index, /function applyLamellarAuthoringState\(/, 'Lamellar UI can apply authoring state for load');
assert.match(index, /function getLamellarSavedStates\(/, 'Lamellar UI can read in-app saved authoring slots');
assert.match(index, /function saveLamellarAuthoringSlot\(/, 'Lamellar UI can save authoring state into an in-app slot');
assert.match(index, /function loadLamellarAuthoringSlot\(/, 'Lamellar UI can load authoring state from an in-app slot');
assert.match(index, /function deleteLamellarAuthoringSlot\(/, 'Lamellar UI can delete an in-app authoring slot');
assert.match(index, /function captureLamellarAuthoringThumbnail\(/, 'Lamellar UI captures thumbnails for saved authoring slots');
assert.match(index, /function drawLamellarDescriptorThumbnail\(/, 'Lamellar UI draws saved-slot thumbnails from Lamellar descriptors');
assert.match(index, /function measureLamellarThumbnailCanvas\(/, 'Lamellar UI measures saved-slot thumbnail pixel diversity');
assert.match(index, /thumbnailStats/, 'Lamellar saved-state slots persist thumbnail pixel stats');
assert.match(index, /function renameLamellarAuthoringSlot\(/, 'Lamellar UI can rename an in-app authoring slot');
assert.match(index, /function renderLamellarSavedStateList\(/, 'Lamellar UI renders saved authoring slots');
assert.match(index, /className = 'lamellar-slot-thumbnail'/, 'Lamellar saved-state rows render a thumbnail element');
assert.match(index, /className = 'lamellar-slot-name-input'/, 'Lamellar saved-state rows render a rename input');
assert.match(index, /function downloadLamellarAuthoringState\(/, 'Lamellar UI can download authoring JSON');
assert.match(index, /function loadLamellarAuthoringFile\(/, 'Lamellar UI can load authoring JSON from a file');
assert.match(index, /__kaminosLamellarSaveAuthoringState/, 'Lamellar UI exposes save helper for browser witnesses');
assert.match(index, /__kaminosLamellarLoadAuthoringState/, 'Lamellar UI exposes load helper for browser witnesses');
assert.match(index, /__kaminosLamellarSaveAuthoringSlot/, 'Lamellar UI exposes slot save helper for browser witnesses');
assert.match(index, /__kaminosLamellarLoadAuthoringSlot/, 'Lamellar UI exposes slot load helper for browser witnesses');
assert.match(index, /__kaminosLamellarRenameAuthoringSlot/, 'Lamellar UI exposes slot rename helper for browser witnesses');
assert.match(index, /id="lamellar-layer-rows"/, 'Lamellar tab exposes per-layer authoring rows');
assert.match(index, /id="lamellar-layer-0-chirality"/, 'Lamellar tab exposes layer 0 chirality override');
assert.match(index, /id="lamellar-layer-0-chunkiness"/, 'Lamellar tab exposes layer 0 chunkiness override');
assert.match(index, /id="lamellar-layer-0-strip-count"/, 'Lamellar tab exposes layer 0 strip-count override');
assert.match(index, /id="lamellar-layer-0-radius"/, 'Lamellar tab exposes layer 0 shell radius override');
assert.match(index, /id="lamellar-layer-0-shell-set-count"/, 'Lamellar tab stores layer 0 shell-set count as a layer override');
assert.match(index, /id="lamellar-layer-detail"/, 'Lamellar tab exposes selected-layer authoring detail panel');
assert.doesNotMatch(index, /id="lamellar-layer-detail"[^>]*display:none/, 'Lamellar selected-layer authoring panel is visible in the normal sidebar flow');
assert.doesNotMatch(index, /id="lamellar-layer-selectors"[^>]*display:none/, 'Lamellar layer selectors are visible with the selected-layer authoring panel');
assert.match(index, /id="lamellar-layer-select-0"/, 'Lamellar tab exposes layer 0 selection control');
assert.match(index, /id="lamellar-layer-select-3"/, 'Lamellar tab exposes layer 3 selection control');
assert.match(index, /id="lamellar-selected-layer-index"/, 'Lamellar tab reports the selected layer identity');
assert.match(index, /id="lamellar-selected-layer-strip-count"/, 'Lamellar tab exposes selected-layer strip-count editor');
assert.match(index, /id="lamellar-selected-layer-radius"/, 'Lamellar tab exposes selected-layer shell radius editor');
assert.match(index, /id="lamellar-selected-layer-thickness-scale"/, 'Lamellar tab exposes a selected-layer descendant thickness control');
assert.match(index, /id="lamellar-selected-layer-thickness-scale"[^>]*data-scope="layer-descendants"/, 'selected-layer thickness control declares that it scopes to descendant strips');
assert.match(index, /id="lamellar-selected-layer-shell-set-count"/, 'Lamellar tab exposes selected-layer shell-set count control');
assert.match(index, /id="lamellar-selected-layer-shell-set-count"[^>]*data-scope="layer-shell-families"/, 'selected-layer shell-set control declares that it scopes to layer shell families');
assert.match(index, /id="lamellar-selected-strip-thickness"[^>]*data-scope="strip-local"/, 'selected-strip thickness control declares that it is a local override');
assert.match(index, /function applySelectedLayerThicknessScale\(/, 'Lamellar UI can write selected-layer descendant thickness overrides');
assert.match(index, /id="lamellar-add-strip"/, 'Lamellar tab exposes add-strip control for the selected layer');
assert.match(index, /id="lamellar-remove-strip"/, 'Lamellar tab exposes remove-strip control for the selected layer');
assert.match(index, /id="lamellar-selected-layer-strips"/, 'Lamellar tab reports selected-layer strip instances');
assert.match(index, /id="lamellar-context-inspector"/, 'Lamellar tab exposes a contextual inspector for viewport-selected objects');
assert.match(index, /id="lamellar-selected-object-kind"/, 'Lamellar context inspector reports selected object kind');
assert.match(index, /id="lamellar-selected-object-id"/, 'Lamellar context inspector reports selected object identity');
assert.match(index, /id="lamellar-selected-object-role"/, 'Lamellar context inspector reports selected object role');
assert.match(index, /id="lamellar-context-profile"/, 'Lamellar profile controls are scoped inside the selected-object context inspector');
assert.match(index, /id="lamellar-selected-object-level"/, 'Lamellar context inspector reports whether selection is at layer or strip level');
assert.match(index, /id="lamellar-selection-popover"/, 'Lamellar viewport exposes a floating selection popover');
assert.match(index, /id="lamellar-popover-title"/, 'Lamellar selection popover has a compact title');
assert.match(index, /id="lamellar-popover-meta"/, 'Lamellar selection popover has compact metadata');
assert.match(index, /id="lamellar-popover-actions"/, 'Lamellar selection popover has local contextual actions');
assert.match(index, /id="lamellar-popover-populations"/, 'Lamellar selection popover exposes same-layer population chips');
assert.match(index, /data-action="add-population"/, 'Lamellar layer toolhead can add a same-layer strip population');
assert.match(index, />Add lamella set</, 'Lamellar layer toolhead labels same-layer population addition in operator-readable words');
assert.match(index, /data-action="add-cutter"/, 'Lamellar layer toolhead can add a same-layer cutter population');
assert.match(index, />Add cutter set</, 'Lamellar layer toolhead labels cutter addition in operator-readable words');
assert.match(index, /data-action="solo-layer"/, 'Lamellar layer toolhead can solo the selected layer locally');
assert.match(index, />Solo layer</, 'Lamellar layer toolhead labels layer solo in operator-readable words');
assert.match(index, /data-action="fit-selection"/, 'Lamellar layer toolhead can fit the selected composition locally');
assert.match(index, />Fit view</, 'Lamellar layer toolhead labels local framing in operator-readable words');
assert.match(index, /data-population-id/, 'Lamellar layer toolhead population chips carry population ids');
assert.match(index, /data-action="population-count-minus"/, 'Lamellar population toolhead can reduce selected population count');
assert.match(index, />Remove strip</, 'Lamellar population toolhead labels count decrement in operator-readable words');
assert.match(index, /data-action="population-count-plus"/, 'Lamellar population toolhead can increase selected population count');
assert.match(index, />Add strip</, 'Lamellar population toolhead labels count increment in operator-readable words');
assert.match(index, /data-action="population-flip-chirality"/, 'Lamellar population toolhead can flip selected population chirality');
assert.match(index, />Flip chirality</, 'Lamellar population toolhead labels chirality flip in operator-readable words');
assert.match(index, /pinLamellarSelectionPopover/, 'Lamellar population toolhead can pin its initial screen position during direct manipulation');
assert.match(index, /data-popover-pinned/, 'Lamellar population toolhead exposes pinned state for witness/operator diagnostics');
assert.match(index, /id="lamellar-population-bearing-spread"/, 'Lamellar population toolhead exposes bearing spread control');
assert.match(index, /id="lamellar-population-bearing-offset"/, 'Lamellar population toolhead exposes bearing offset control');
assert.match(index, /Population layout/, 'Lamellar population toolhead groups layout controls coherently');
assert.match(index, /id="lamellar-population-lane-span"/, 'Lamellar population toolhead exposes lane span separately from spread');
assert.match(index, /id="lamellar-population-phase-stagger"/, 'Lamellar population toolhead exposes phase stagger separately from spread');
assert.match(index, /id="lamellar-population-radial-spacing"/, 'Lamellar population toolhead exposes radial shell spacing control');
assert.match(index, /id="lamellar-popover-layer-thickness-scale"/, 'Lamellar layer popover exposes descendant thickness control at the selection site');
assert.match(index, /id="lamellar-popover-shell-set-count"/, 'Lamellar layer popover exposes visible shell-set count control');
assert.match(index, /id="lamellar-popover-shell-set-count"[^>]*data-scope="layer-shell-families"/, 'Lamellar shell-set count declares layer shell-family scope');
assert.match(index, /function applyLamellarShellSetCount\(/, 'Lamellar UI can write visible shell-set count from the selection popover');
assert.match(index, /id="lamellar-strip-profile"/, 'Lamellar tab exposes selected-strip profile authoring panel');
assert.doesNotMatch(index, /id="lamellar-strip-select"/, 'Lamellar strip selection is viewport-driven rather than dropdown-driven');
assert.match(index, /id="lamellar-selected-strip-index"/, 'Lamellar tab reports the selected strip identity');
assert.match(index, /id="lamellar-selected-strip-width"/, 'Lamellar tab exposes selected-strip width control');
assert.match(index, /id="lamellar-selected-strip-thickness"/, 'Lamellar tab exposes selected-strip thickness control');
assert.match(index, /id="lamellar-selected-strip-width-variance"/, 'Lamellar tab exposes selected-strip width variance control');
assert.match(index, /id="lamellar-selected-strip-thickness-variance"/, 'Lamellar tab exposes selected-strip thickness variance control');
assert.match(index, /id="lamellar-selected-strip-gap-pattern"/, 'Lamellar tab exposes selected-strip gap pattern preset');
assert.match(index, /id="lamellar-population-count"/, 'Lamellar tab exposes macro same-layer population count');
assert.match(index, /id="lamellar-cutter-count"/, 'Lamellar tab exposes macro same-layer cutter population count');
assert.match(index, /id="lamellar-population-bearing-variance"/, 'Lamellar tab exposes macro same-layer direction variance');
assert.match(index, /id="lamellar-population-bearing-variance"[^>]*max="2"/, 'Lamellar macro population spread has enough range for coverage layouts');
assert.match(index, /id="lamellar-population-bearing-variance"[^>]*value="1/, 'Lamellar macro population spread defaults to shell coverage, not clustering');
assert.match(index, /id="lamellar-shell-enclosure"/, 'Lamellar tab exposes macro spherical enclosure control');
assert.match(index, /id="lamellar-strip-topology-count"/, 'Lamellar tab exposes strip topology member count control');
assert.match(index, /id="lamellar-population-bearing-spread"[^>]*max="2"/, 'Lamellar population toolhead spread has enough range for coverage layouts');
assert.match(index, /id="lamellar-population-bearing-offset"[^>]*min="-6\.283"/, 'Lamellar population toolhead rotate can make full-turn shell offsets');
assert.match(index, /id="lamellar-population-bearing-offset"[^>]*max="6\.283"/, 'Lamellar population toolhead rotate can make full-turn shell offsets');
assert.match(index, /id="lamellar-overlap-bias"/, 'Lamellar tab exposes overlap bias control');
assert.match(index, /id="lamellar-slice-t"/, 'Lamellar tab exposes slice position control');
assert.match(index, /id="lamellar-slice-angle"/, 'Lamellar tab exposes slice angle control');
assert.match(index, /lamellar_cut_radius/, 'URL route can override Lamellar cut radius');
assert.match(index, /lamellar_view/, 'URL route can override Lamellar witness view');
assert.match(index, /lamellar_layers/, 'URL route can override Lamellar placeholder layer count');
assert.match(index, /lamellar_seed/, 'URL route can override Lamellar procedural seed');
assert.match(index, /lamellar_chirality/, 'URL route can override Lamellar chirality');
assert.match(index, /lamellar_chirality_pattern/, 'URL route can override Lamellar layer chirality pattern');
assert.match(index, /lamellar_shell_recipe/, 'URL route can open directly into a named Lamellar shell recipe');
assert.match(index, /lamellar_depth_spacing/, 'URL route can override Lamellar depth spacing');
assert.match(index, /lamellar_chunkiness/, 'URL route can override Lamellar layer chunkiness');
assert.match(index, /lamellar_chunkiness_variance/, 'URL route can override Lamellar chunkiness variance');
assert.match(index, /lamellar_layer_chiralities/, 'URL route can override per-layer chirality values');
assert.match(index, /lamellar_layer_chunkiness/, 'URL route can override per-layer chunkiness values');
assert.match(index, /lamellar_layer_strip_counts/, 'URL route can override per-layer strip counts');
assert.match(index, /lamellar_layer_radii/, 'URL route can override per-layer shell radii');
assert.match(index, /lamellar_layer_shell_sets/, 'URL route can override per-layer shell-set counts');
assert.match(index, /lamellar_population_count/, 'URL route can override macro strip population count');
assert.match(index, /lamellar_cutter_count/, 'URL route can override macro cutter population count');
assert.match(index, /lamellar_population_bearing_variance/, 'URL route can override macro direction variance');
assert.match(index, /lamellar_shell_enclosure/, 'URL route can override macro spherical enclosure');
assert.match(index, /lamellar_strip_topology_count/, 'URL route can override subordinate strip topology member count');
assert.match(index, /lamellar_overlap_bias/, 'URL route can override Lamellar overlap bias');
assert.match(index, /lamellar_slice_t/, 'URL route can override Lamellar slice position');
assert.match(index, /lamellar_slice_angle/, 'URL route can override Lamellar slice angle');
assert.match(index, /function isLamellarRouteActive\(/, 'Lamellar route active check is centralized');
assert.match(index, /selectedLamellarLayerIndex/, 'Lamellar UI tracks selected layer state');
assert.match(index, /selectedLamellarStripIndex/, 'Lamellar UI tracks selected strip state');
assert.match(index, /selectedLamellarObject/, 'Lamellar UI tracks viewport-selected Lamellar object state');
assert.match(index, /function setSelectedLamellarLayer\(/, 'Lamellar UI can switch selected layer explicitly');
assert.match(index, /function syncSelectedLamellarLayer\(/, 'Lamellar UI syncs selected-layer authoring controls');
assert.match(index, /function nudgeSelectedLayerStripCount\(/, 'Lamellar UI can add or remove strips from the selected layer');
assert.match(index, /function installLamellarViewportSelection\(/, 'Lamellar UI installs viewport picking for visible strip selection');
assert.match(index, /function selectLamellarObject\(/, 'Lamellar UI can select Lamellar objects from scene picks');
assert.match(index, /function selectLamellarLayerFromStrip\(/, 'Lamellar UI single-click selection resolves picked strips to owning layer');
assert.match(index, /function drillIntoLamellarStrip\(/, 'Lamellar UI double-click selection drills into a specific strip');
assert.match(index, /function selectLamellarPopulation\(/, 'Lamellar UI can select a same-layer strip population from the viewport toolhead');
assert.match(index, /function syncLamellarPopulationToolhead\(/, 'Lamellar UI syncs selected population controls into the viewport toolhead');
assert.match(index, /function applyLamellarPopulationOverride\(/, 'Lamellar UI writes selected-population authoring overrides');
assert.match(index, /function nudgeSelectedPopulationCount\(/, 'Lamellar UI can nudge selected population count');
assert.match(index, /function flipSelectedPopulationChirality\(/, 'Lamellar UI can flip selected population chirality');
assert.match(index, /function fitLamellarSelection\(/, 'Lamellar UI exposes local fit action for the selected layer toolhead');
assert.match(index, /function soloSelectedLamellarLayer\(/, 'Lamellar UI exposes local solo action for the selected layer toolhead');
assert.match(index, /lamellarCameraInteracted/, 'Lamellar UI tracks whether the human has already moved the camera');
assert.match(index, /shouldFrameLamellarOnEnable\(/, 'Lamellar manual Enable can frame only when no human camera view exists yet');
assert.match(index, /function syncLamellarContextInspector\(/, 'Lamellar UI syncs selected-object context inspector controls');
assert.match(index, /function syncLamellarSelectionPopover\(/, 'Lamellar UI syncs the viewport selection popover');
assert.match(index, /function positionLamellarSelectionPopover\(/, 'Lamellar UI positions the popover from the 3D selection anchor');
assert.match(index, /scheduleLamellarControlsRebuild/, 'Lamellar slider input rebuilds are coalesced by a central scheduler');
assert.match(index, /LAMELLAR_REBUILD_MIN_INTERVAL_MS/, 'Lamellar slider input rebuilds have a named low-cadence budget instead of rebuilding at display cadence');
assert.match(index, /lamellarControlsRebuildTimeout/, 'Lamellar input rebuild scheduler can defer heavy geometry work beyond the next animation frame');
assert.match(index, /flushLamellarControlsRebuild/, 'Lamellar slider change events can flush pending rebuilds immediately');
assert.match(index, /function setSelectedLamellarStripById\(/, 'Lamellar UI can switch selected strip from a picked strip instance id');
assert.match(index, /function syncSelectedLamellarStrip\(/, 'Lamellar UI syncs selected-strip profile controls');
assert.match(index, /function applySelectedStripProfileOverride\(/, 'Lamellar UI writes selected-strip profile overrides');
assert.match(index, /addEventListener\('dblclick'/, 'Lamellar viewport supports double-click strip drilldown');
assert.match(index, /if \(!isLamellarRouteActive\(\)\) restoreSettings\(\)/, 'Lamellar route starts blank instead of restoring persisted scene/material state');
assert.doesNotMatch(index, /loadDemo\(DEMO_ASSETS\[0\]\)/, 'Kaminos starts blank and only loads demo assets by explicit user action');
assert.match(index, /kaminos-lamellar-witness-v0/, 'UI carries stable Lamellar witness identity');
assert.match(index, /sphere-domain-section-segment-witness-v0/, 'UI carries effective Lamellar route identity');

const corePath = join(root, 'lamellar-core.js');
assert.ok(existsSync(corePath), 'lamellar-core.js exists');
const core = existsSync(corePath) ? readFileSync(corePath, 'utf8') : '';
assert.match(core, /export function createKaminosLamellarWitness/, 'Lamellar module exports createKaminosLamellarWitness');
assert.match(core, /build\(\{ frame = false \} = \{\}\)/, 'Lamellar rebuild can preserve the current human camera');
assert.match(core, /setControls[\s\S]*build\(\{ frame: false \}\)/, 'slider/control changes rebuild without reframing the camera');
assert.match(core, /setActive[\s\S]*build\(\{ frame: false \}\)/, 'enabling Lamellar builds without moving the current human camera');
assert.match(core, /return \{[\s\S]*frameCamera[\s\S]*debugState[\s\S]*selectBySectionId[\s\S]*selectByStripInstanceId[\s\S]*pickFromClientPoint[\s\S]*\}/, 'explicit Frame button remains the only camera-framing command while selection APIs are exposed');
assert.match(core, /selectionLevel/, 'Lamellar debug state distinguishes layer selection from strip drilldown');
assert.match(core, /selectedLayerSpecId/, 'Lamellar debug state records selected layer spec id');
assert.match(core, /selectedStripInstanceId/, 'Lamellar debug state records selected strip instance id');
assert.match(core, /selectedPopulationId/, 'Lamellar debug state records selected same-layer population id');
assert.match(core, /selectionAnchor/, 'Lamellar debug state records a 3D selection anchor for popover placement');
assert.match(core, /selectLayerByStripInstanceId/, 'Lamellar core exposes layer selection from a picked strip');
assert.match(core, /selectStripByStripInstanceId/, 'Lamellar core exposes explicit strip drilldown selection');
assert.match(core, /selectPopulationByPopulationId/, 'Lamellar core exposes same-layer population selection');
assert.match(core, /layer-selection-highlight/, 'Lamellar core marks layer-level selection highlights distinctly');
assert.match(core, /strip-selection-highlight/, 'Lamellar core marks strip-level selection highlights distinctly');
assert.match(core, /population-selection-highlight/, 'Lamellar core marks population-level selection highlights distinctly');
assert.match(core, /selection-anchor-highlight/, 'Lamellar layer and population selection use cheap anchor highlights');
assert.match(core, /ownsHighlightGeometry/, 'Lamellar highlight cleanup tracks owned geometry instead of disposing shared mesh geometry');
assert.match(core, /populationStripIds/, 'Lamellar core selection object carries selected population strip ids');
assert.match(core, /kaminos-lamellar-witness-v0/, 'Lamellar module exposes stable witness identity');
assert.match(core, /sphere-domain-section-segment-witness-v0/, 'Lamellar module records effective route identity');
assert.match(core, /cap_profile/, 'Lamellar module supports the cap-profile witness view');
assert.match(core, /cut_radius_coupling/, 'Lamellar module supports the cut-radius coupling witness view');
assert.match(core, /perpendicular-cutting-edge/, 'Lamellar module exposes the cut-causing perpendicular edge as its own witness actor');
assert.match(core, /cuttingEdgeDescriptor/, 'Lamellar debug state reports the cut-causing edge descriptor');
assert.match(core, /cutAuthorEnvelopeDescriptor/, 'Lamellar debug state reports the neighbor cut-author envelope descriptor');
assert.match(core, /channelCutReceipt/, 'Lamellar debug state reports the channel-cut receipt');
assert.match(core, /neighbor-offset-envelope-terminal-channel-cut/, 'Lamellar core names the neighbor-offset envelope channel-cut mode');
assert.match(core, /neighbor-offset-envelope-rail-contour/, 'Lamellar core names the neighbor-derived terminal rail contour source');
assert.match(core, /selected-neighbor-channel-closeup/, 'Lamellar core records the cut-author witness anchor mode');
assert.match(core, /terminalRailStopCount/, 'Lamellar cut-author receipt records terminal rail stop count');
assert.match(core, /sampledClearanceBand/, 'Lamellar cut-author receipt records sampled clearance band');
assert.match(core, /makeCuttingEdgeGeometry/, 'Lamellar module builds a visible cross-cut edge instead of implying causality through parallel bands');
assert.match(core, /makeCutAuthorEnvelopeGeometry/, 'Lamellar module builds a visible thin neighbor envelope instead of a broad diagnostic slab');
assert.match(core, /stable-strip-width-cut-radius-only-changes-window-caps-gap/, 'Lamellar module preserves width/radius decoupling identity');
assert.match(core, /zero-lift-closed-terminal-cap-slab/, 'Lamellar module preserves closed end-cap sealing identity');
assert.match(core, /temporary-aesthetic-composition-primitive-not-final-lamellar-topology/, 'Lamellar module marks nested shells as placeholder composition only');
assert.match(core, /LamellarSectionSegment/, 'Lamellar core names procedural section descriptors explicitly');
assert.match(core, /LayerStackDescriptor/, 'Lamellar core names the authored layer-stack descriptor explicitly');
assert.match(core, /LayerShellDescriptor/, 'Lamellar core names layer shells as assemblages explicitly');
assert.match(core, /LamellarLayerSpec/, 'Lamellar core names per-layer specs explicitly');
assert.match(core, /LamellarStripInstance/, 'Lamellar core names per-strip instances explicitly');
assert.match(core, /SphereCurveDescriptor/, 'Lamellar core names sphere curves as the upstream authored geometry primitive');
assert.match(core, /generateSphereCurveDescriptors/, 'Lamellar core generates sphere curves before section mesh descriptors');
assert.match(core, /CurveInteractionReceipt/, 'Lamellar core records curve-space interaction receipts before meshing');
assert.match(core, /LamellarEnvelopeDescriptor/, 'Lamellar core names curve-family envelope bodies explicitly');
assert.match(core, /curve-family-envelope-loft-v0/, 'Lamellar core records the curve-family envelope loft mode');
assert.match(core, /multi-eligible-population-envelope-composition-v0/, 'Lamellar envelope generation records multi-population composition mode');
assert.match(core, /smooth-envelope-body-crisp-rail-debug-v0/, 'Lamellar envelope geometry records smooth body plus crisp rail debug mode');
assert.match(core, /ribbon-shell-angular-offset-v0/, 'Lamellar ribbon mesh emission records shell-angular width offsets instead of flat tangent-plane offsets');
assert.match(core, /StripProfileDescriptor/, 'Lamellar core names selected-strip profile descriptors explicitly');
assert.match(core, /StripPopulationDescriptor/, 'Lamellar core names macro strip population descriptors explicitly');
assert.match(core, /stripPopulationDescriptors/, 'Lamellar debug state reports macro strip population descriptors');
assert.match(core, /same-shell-direction-population-authoring-v0/, 'Lamellar core names same-shell direction population authoring mode');
assert.match(core, /even-shell-coverage-layout-v0/, 'Lamellar core names even shell coverage population layout');
assert.match(core, /decoupled-population-layout-controls-v0/, 'Lamellar core names decoupled population layout controls');
assert.match(core, /sphere-shell-enclosure-composition-v0/, 'Lamellar core names macro sphere-shell enclosure composition mode');
assert.match(core, /intra-strip-topology-members-v0/, 'Lamellar core names subordinate same-shell strip topology members');
assert.match(core, /shell-distributed-topology-families-v0/, 'Lamellar core names shell-distributed topology families');
assert.match(core, /stripTopologyDescriptors/, 'Lamellar debug state reports subordinate strip topology descriptors');
assert.match(core, /shellTopologyFamilyDescriptors/, 'Lamellar debug state reports shell-distributed topology family descriptors');
assert.match(core, /layoutPreset/, 'Lamellar strip population descriptors record their layout preset');
assert.match(core, /coverageSpacing/, 'Lamellar strip populations report coverage spacing for overlap diagnostics');
assert.match(core, /coverageSpan/, 'Lamellar strip populations report visible shell coverage span');
assert.match(core, /bearingPhase/, 'Lamellar strip instances carry actual shell bearing phase, not tiny jitter only');
assert.match(core, /shellLaneOffset/, 'Lamellar strip instances carry shell-lane offsets for visible coverage sets');
assert.match(core, /radialSpacing/, 'Lamellar strip populations report radial spacing for same-population clearance');
assert.match(core, /radialOffset/, 'Lamellar strip instances carry radial offsets so same-population strips can separate by shell radius');
assert.match(core, /radiusOffset/, 'Lamellar layer specs carry shell radius offsets for whole-layer radius authoring');
assert.match(core, /thicknessScale/, 'Lamellar layer specs carry descendant thickness scaling for hierarchy-scoped mass authoring');
assert.match(core, /layer-descendant-thickness-scale/, 'Lamellar strip profile receipts distinguish layer descendant thickness from strip-local overrides');
assert.match(core, /strip-local-profile-override/, 'Lamellar strip profile receipts distinguish explicit strip-local overrides from aggregate layer controls');
assert.match(core, /diagnosticLayerSeparationScale/, 'Lamellar core reports diagnostic layer separation exaggeration while authoring shells');
assert.match(core, /stripProfileOverrides/, 'Lamellar debug state reports selected-strip profile override inputs');
assert.match(core, /widthVariance/, 'Lamellar core supports strip-local width variance independent of layer chunkiness');
assert.match(core, /thicknessVariance/, 'Lamellar core supports strip-local thickness variance independent of layer thickness');
assert.match(core, /gapPattern/, 'Lamellar core supports strip-local gap pattern presets');
assert.match(core, /splitStripByGapPattern/, 'Lamellar core splits selected strip descriptors by gap-pattern presets before mesh emission');
assert.match(core, /selectBySectionId/, 'Lamellar witness exposes section-id selection for viewport picking');
assert.match(core, /pickFromClientPoint/, 'Lamellar witness exposes raycast picking from the viewport');
assert.match(core, /selectedLamellarObject/, 'Lamellar debug state reports selected viewport object');
assert.match(core, /generateLamellarLayerSpecs/, 'Lamellar core generates per-layer specs before section descriptors');
assert.match(core, /layer-shell-family-set-count-v0/, 'Lamellar core names layer-scoped shell-family set overrides');
assert.match(core, /generateLamellarStripInstances/, 'Lamellar core expands layer specs into strip instances before mesh emission');
assert.match(core, /generateLamellarSectionSegments/, 'Lamellar core generates data-first section descriptors before mesh emission');
assert.match(core, /sliceLamellarSectionSegments/, 'Lamellar core slices section descriptors before mesh emission');
assert.match(core, /composerDescriptor/, 'Lamellar debug state reports procedural composer descriptor');
assert.match(core, /layerStackDescriptor/, 'Lamellar debug state reports authored layer-stack descriptor');
assert.match(core, /layerSpecs/, 'Lamellar debug state reports per-layer specs');
assert.match(core, /stripInstances/, 'Lamellar debug state reports layer-owned strip instances');
assert.match(core, /sphereCurveDescriptors/, 'Lamellar debug state reports upstream sphere curve descriptors');
assert.match(core, /curveInteractionReceipt/, 'Lamellar debug state reports curve-space interaction receipt');
assert.match(core, /sourceCurveId/, 'Lamellar emitted descriptors carry source curve ancestry');
assert.match(core, /stripIds/, 'Lamellar layer specs report their owned strip ids');
assert.match(core, /stripCount/, 'Lamellar layer specs report their authored strip count');
assert.match(core, /chiralityPattern/, 'Lamellar debug state reports chirality pattern through layers');
assert.match(core, /chunkinessBase/, 'Lamellar debug state reports layer chunkiness base');
assert.match(core, /chunkinessVariance/, 'Lamellar debug state reports layer chunkiness variance');
assert.match(core, /layerOverrides/, 'Lamellar debug state reports per-layer override inputs');
assert.match(core, /layerSpecId/, 'Lamellar section descriptors carry layer-spec ancestry');
assert.match(core, /stripInstanceId/, 'Lamellar section descriptors carry strip-instance ancestry');
assert.match(core, /sliceToolDescriptor/, 'Lamellar debug state reports slicing tool descriptor');
assert.match(core, /sliceApplicationReceipt/, 'Lamellar debug state reports effective slice application receipt');
assert.match(core, /generatedSegmentDescriptors/, 'Lamellar debug state reports generated segment descriptors');
assert.match(core, /sectionSegments/, 'Lamellar debug state reports section segment descriptors');
assert.match(core, /capTValues/, 'Lamellar debug state reports cut cap T-values');
assert.match(core, /openEdgeCount/, 'Lamellar debug state reports open-edge evidence');
assert.match(core, /lightHooks/, 'Lamellar debug state reports exported light hooks');
assert.match(core, /effectiveRoute/, 'Lamellar debug state reports effective route identity');
assert.match(core, /cameraPosition/, 'Lamellar debug state reports camera position for slider-preservation witnesses');
assert.match(core, /cameraTarget/, 'Lamellar debug state reports camera target for slider-preservation witnesses');

const witnessPath = join(root, 'lamellar-witness.mjs');
assert.ok(existsSync(witnessPath), 'lamellar-witness.mjs exists');
const witness = existsSync(witnessPath) ? readFileSync(witnessPath, 'utf8') : '';
assert.match(witness, /kaminos_lamellar_witness=1/, 'witness captures the explicit Lamellar route');
assert.match(witness, /effectiveRoute/, 'witness records effective route identity');
assert.match(witness, /sphere-domain-section-segment-witness-v0/, 'witness requires the Lamellar route identity');
assert.match(witness, /requestedView/, 'witness records requested view');
assert.match(witness, /effectiveView/, 'witness records effective view');
assert.match(witness, /requestedCutRadius/, 'witness records requested cut radius');
assert.match(witness, /effectiveCutRadius/, 'witness records effective cut radius');
assert.match(witness, /capTValues/, 'witness records cap T-values');
assert.match(witness, /cuttingEdgeDescriptor/, 'witness records cut-causing edge descriptor');
assert.match(witness, /cutAuthorEnvelopeDescriptor/, 'witness records cut-author envelope descriptor');
assert.match(witness, /channelCutReceipt/, 'witness records channel-cut receipt');
assert.match(witness, /composerDescriptor/, 'witness records procedural composer descriptor');
assert.match(witness, /layerStackDescriptor/, 'witness records layer-stack descriptor');
assert.match(witness, /layerSpecs/, 'witness records per-layer specs');
assert.match(witness, /stripInstances/, 'witness records layer-owned strip instances');
assert.match(witness, /sphereCurveDescriptors/, 'witness records upstream sphere curve descriptors');
assert.match(witness, /lamellarEnvelopeDescriptors/, 'witness records curve-family envelope descriptors');
assert.match(witness, /authoringRoundTripReceipt/, 'witness records Lamellar authoring save/load round-trip evidence');
assert.match(witness, /authoringSlotRoundTripReceipt/, 'witness records Lamellar in-app saved-state slot round-trip evidence');
assert.match(witness, /thumbnailDataUrl/, 'witness records Lamellar saved-slot thumbnail data');
assert.match(witness, /thumbnailStats/, 'witness records Lamellar saved-slot thumbnail pixel diversity');
assert.match(witness, /renamedLabel/, 'witness records Lamellar saved-slot rename evidence');
assert.match(witness, /curveInteractionReceipt/, 'witness records curve-space interaction receipt');
assert.match(witness, /selectedLayerUi/, 'witness records selected-layer UI state');
assert.match(witness, /selectedLayerRadiusReceipt/, 'witness records selected-layer radius mutation behavior');
assert.match(witness, /lamellar-selected-layer-strips/, 'witness inspects selected-layer strip readout');
assert.match(witness, /selectedStripUi/, 'witness records selected-strip profile UI state');
assert.match(witness, /lamellar-selected-strip-width/, 'witness inspects selected-strip width control');
assert.match(witness, /selectionUi/, 'witness records viewport/context selection UI state');
assert.match(witness, /layerSelectionUi/, 'witness records layer-first viewport selection state');
assert.match(witness, /stripDrilldownUi/, 'witness records explicit strip drilldown state');
assert.match(witness, /selectionPopoverUi/, 'witness records the floating selection popover state');
assert.match(witness, /populationToolheadUi/, 'witness records selected-population toolhead state');
assert.match(witness, /popoverPinnedDuringSliderReceipt/, 'witness records that slider manipulation pins the floating toolhead');
assert.match(witness, /selectedPopulationObject/, 'witness records selected population object state');
assert.match(witness, /populationControlReceipt/, 'witness records a selected-population control mutation receipt');
assert.match(witness, /populationSliderSweepReceipt/, 'witness records selected-population slider sweep behavior');
assert.match(witness, /populationRadialSpacingReceipt/, 'witness records selected-population radial shell spacing behavior');
assert.match(witness, /selectionLevel/, 'witness records selection level in browser receipts');
assert.match(witness, /selectedLamellarObject/, 'witness records selected Lamellar object state');
assert.match(witness, /viewportPickReceipt/, 'witness records viewport pick receipt');
assert.match(witness, /stripProfileOverrides/, 'witness records selected-strip profile override inputs');
assert.match(witness, /stripProfileDescriptors/, 'witness records selected-strip profile descriptors');
assert.match(witness, /stripPopulationDescriptors/, 'witness records macro strip population descriptors');
assert.match(witness, /shellEnclosure/, 'witness records macro sphere-shell enclosure receipts');
assert.match(witness, /stripTopologyDescriptors/, 'witness records subordinate strip topology descriptors');
assert.match(witness, /shellTopologyFamilyDescriptors/, 'witness records shell-distributed topology family descriptors');
assert.match(witness, /layerOverrides/, 'witness records per-layer override inputs');
assert.match(witness, /sliceToolDescriptor/, 'witness records slicing tool descriptor');
assert.match(witness, /sliceApplicationReceipt/, 'witness records slice application receipt');
assert.match(witness, /segmentDescriptorCount/, 'witness records generated descriptor count');
assert.match(witness, /lightHookCount/, 'witness records exported light hook count');
assert.match(witness, /blank frame/i, 'witness fails loudly on blank visual output');
assert.match(witness, /assertVisualDiversity/, 'witness checks screenshot pixel diversity, not only file size');
assert.match(witness, /manualEnable/, 'witness can exercise the plain-load Lamellar tab Enable path');
assert.match(witness, /manualEnableUi/, 'witness records manual-enable camera and visibility state');
assert.match(witness, /recipeSmoke/, 'witness can run a focused shell-recipe smoke without the full mutation sweep');
assert.match(witness, /--recipe-smoke/, 'witness exposes a focused shell-recipe smoke CLI flag');
assert.match(witness, /shellRecipeReceipt/, 'witness records focused shell-recipe selection and generated population evidence');
assert.match(witness, /recipeSmokeReceipt/, 'witness records a focused shell-recipe visual/report receipt');
assert.match(witness, /cdpTimeoutMs/, 'witness bounds CDP request waits instead of hanging silently');
assert.match(witness, /requestPhase/, 'witness records the phase that failed before primary output');
assert.match(witness, /captureScreenshotWithFallback/, 'witness can fall back when primary Chrome screenshot capture stalls');
assert.match(witness, /screenshotFallbackReceipt/, 'witness records which screenshot capture route produced visual evidence');
assert.match(witness, /mac-screencapture-display/, 'witness records macOS display capture as a last-resort visual evidence route');

const coreModule = await import(`${pathToFileURL(corePath).href}?contract=${Date.now()}`);
assert.equal(coreModule.LAMELLAR_SHELL_RECIPE_MODE, 'shell-recipe-composition-v0', 'Lamellar core exposes a stable shell recipe mode');
assert.ok(Array.isArray(coreModule.LAMELLAR_SHELL_RECIPE_IDS), 'Lamellar core exports recipe ids for UI/test reuse');
assert.ok(coreModule.LAMELLAR_SHELL_RECIPE_IDS.includes('diagonal-cage'), 'Lamellar recipe ids include diagonal cage');
assert.equal(typeof coreModule.controlsForLamellarShellRecipe, 'function', 'Lamellar core exposes recipe-to-controls expansion');
{
  const diagonalControls = coreModule.controlsForLamellarShellRecipe('diagonal-cage', { seed: 17 });
  assert.equal(diagonalControls.shellRecipe, 'diagonal-cage', 'recipe controls record requested recipe id');
  assert.equal(diagonalControls.shellRecipeMode, 'shell-recipe-composition-v0', 'recipe controls record shell recipe mode');
  assert.ok(diagonalControls.layerCount >= 4, 'diagonal cage recipe creates a multi-layer starting point');
  assert.ok(diagonalControls.populationCount >= 5, 'diagonal cage recipe creates enough lamella members to read as a cage');
  assert.ok(diagonalControls.stripTopologyCount >= 2, 'diagonal cage recipe creates multiple shell-family orientations');
  assert.ok(diagonalControls.shellEnclosure >= 0.65, 'diagonal cage recipe starts as an enclosing shell composition');
  assert.ok((diagonalControls.stripPopulations || []).length >= 2, 'diagonal cage recipe emits authored population sets instead of only raw macro defaults');
  const diagonal = coreModule.generateLamellarSectionSegments(diagonalControls);
  assert.equal(diagonal.composerDescriptor.shellRecipe, 'diagonal-cage', 'composer descriptor records the effective shell recipe');
  assert.equal(diagonal.composerDescriptor.shellRecipeMode, 'shell-recipe-composition-v0', 'composer descriptor records the recipe mode');
  assert.equal(diagonal.composerDescriptor.recipeEffectiveParameters.populationCount, diagonalControls.populationCount, 'composer descriptor records effective recipe controls');
  assert.ok(diagonal.stripPopulationDescriptors.some(population => population.recipeRole === 'primary-diagonal'), 'diagonal cage recipe emits a named primary diagonal population');
  assert.ok(diagonal.stripPopulationDescriptors.some(population => population.recipeRole === 'counter-diagonal'), 'diagonal cage recipe emits a named counter diagonal population');
  assert.ok(diagonal.lamellarEnvelopeDescriptors.length >= 2, 'diagonal cage recipe creates multiple envelope bodies from its population families');
}
const envelopeGenerated = coreModule.generateLamellarSectionSegments({
  seed: 17,
  layerCount: 4,
  populationCount: 6,
  cutterCount: 1,
  populationBearingVariance: 1,
  chunkinessBase: 0.48,
  layerOverrides: [
    { layerIndex: 0, stripCount: 6 },
    { layerIndex: 2, stripCount: 5 },
    { layerIndex: 3, stripCount: 5 },
  ],
});
assert.ok((envelopeGenerated.lamellarEnvelopeDescriptors || []).length >= 3, 'curve-family generation emits multiple lamellar envelope descriptors across eligible layer populations');
const envelopeLayers = new Set(envelopeGenerated.lamellarEnvelopeDescriptors.map(envelope => envelope.layerIndex));
assert.ok(envelopeLayers.has(0) && envelopeLayers.has(2) && envelopeLayers.has(3), 'multi-envelope composition includes all eligible lamella layers while leaving cutter layers out');
assert.ok(!envelopeLayers.has(1), 'multi-envelope composition does not loft cutter/neighbor layers as lamella envelopes');
const firstEnvelope = envelopeGenerated.lamellarEnvelopeDescriptors[0];
assert.equal(firstEnvelope.kind, 'LamellarEnvelopeDescriptor', 'envelope descriptor carries explicit kind');
assert.equal(firstEnvelope.mode, 'curve-family-envelope-loft-v0', 'envelope descriptor carries curve-family loft mode');
assert.equal(firstEnvelope.compositionMode, 'multi-eligible-population-envelope-composition-v0', 'envelope descriptor records multi-population composition mode');
assert.equal(firstEnvelope.edgeLegibilityMode, 'smooth-envelope-body-crisp-rail-debug-v0', 'envelope descriptor records smooth-body/crisp-rail debug intent');
assert.ok((firstEnvelope.sourceCurveIds || []).length >= 3, 'envelope descriptor is derived from multiple source curves');
assert.equal(firstEnvelope.sourceCurveIds.length, firstEnvelope.sourceStripInstanceIds.length, 'envelope curve ids stay aligned with source strip ids');
assert.ok((firstEnvelope.sampleRows || []).length >= 8, 'envelope descriptor records sampled loft rows');
assert.ok((firstEnvelope.envelopeRails || []).length >= 2, 'envelope descriptor records outer rails for meshing');
assert.equal(
  firstEnvelope.enclosureMode,
  'sphere-shell-enclosure-composition-v0',
  'envelope descriptor records the macro enclosure composition mode'
);

const openEnclosure = coreModule.generateLamellarSectionSegments({
  seed: 17,
  layerCount: 4,
  populationCount: 6,
  cutterCount: 1,
  populationBearingVariance: 1,
  shellEnclosure: 0,
  chunkinessBase: 0.48,
  layerOverrides: [
    { layerIndex: 0, stripCount: 6 },
    { layerIndex: 2, stripCount: 5 },
    { layerIndex: 3, stripCount: 5 },
  ],
});
const closedEnclosure = coreModule.generateLamellarSectionSegments({
  seed: 17,
  layerCount: 4,
  populationCount: 6,
  cutterCount: 1,
  populationBearingVariance: 1,
  shellEnclosure: 1,
  chunkinessBase: 0.48,
  layerOverrides: [
    { layerIndex: 0, stripCount: 6 },
    { layerIndex: 2, stripCount: 5 },
    { layerIndex: 3, stripCount: 5 },
  ],
});
assert.equal(closedEnclosure.composerDescriptor.shellEnclosureMode, 'sphere-shell-enclosure-composition-v0', 'composer descriptor records shell enclosure mode');
assert.equal(closedEnclosure.composerDescriptor.shellEnclosure, 1, 'composer descriptor records effective shell enclosure amount');
assert.ok(
  closedEnclosure.sphereCurveDescriptors.every(curve => curve.shellEnclosureMode === 'sphere-shell-enclosure-composition-v0'),
  'sphere curves carry the enclosure mode before mesh emission'
);
function curveLatitudeSpread(generated) {
  const phiValues = generated.sphereCurveDescriptors.flatMap(curve => [
    curve.phi0,
    curve.phi0 + curve.phiSlope * -0.5,
    curve.phi0 + curve.phiSlope * 0.5,
  ]);
  return Math.max(...phiValues) - Math.min(...phiValues);
}
assert.ok(
  curveLatitudeSpread(closedEnclosure) > curveLatitudeSpread(openEnclosure) * 1.25,
  'high enclosure broadens sphere-curve latitude coverage before envelope meshing'
);
const shellParallelRibbon = coreModule.sampleLamellarRibbonShellRadii([0.12, 0.9], {
  theta0: -0.7,
  thetaTwist: 5.1,
  phi0: -0.2,
  phiSlope: 0.82,
  phase: 0.4,
  radius: 1.07,
  width: 0.18,
  edgeLift: 0.024,
  waviness: 0.09,
}, 18);
assert.equal(shellParallelRibbon.mode, 'ribbon-shell-angular-offset-v0', 'ribbon shell sampling uses the angular shell-offset mode');
assert.ok(
  shellParallelRibbon.maxShellRadiusError < 1e-9,
  `wide ribbon rails leave the intended shell radius by ${shellParallelRibbon.maxShellRadiusError}`
);
assert.ok(
  shellParallelRibbon.surfaceColumnCount >= 5,
  `wide ribbon mesh should subdivide across the sphere shell, got ${shellParallelRibbon.surfaceColumnCount} columns`
);
assert.ok(
  shellParallelRibbon.maxSurfaceRadiusError < 1e-9,
  `wide ribbon surface vertices leave the intended shell radius by ${shellParallelRibbon.maxSurfaceRadiusError}`
);
const lowChunk = coreModule.generateLamellarSectionSegments({
  seed: 31,
  layerCount: 4,
  chiralityPattern: 'alternating',
  depthSpacing: 0.09,
  chunkinessBase: 0.05,
  chunkinessVariance: 0,
  overlapBias: 1,
});
const highChunk = coreModule.generateLamellarSectionSegments({
  seed: 31,
  layerCount: 4,
  chiralityPattern: 'alternating',
  depthSpacing: 0.09,
  chunkinessBase: 0.96,
  chunkinessVariance: 0,
  overlapBias: 1,
});

function shapeSignature(generated) {
  return generated.descriptors.map(d => ({
    id: d.id,
    layerSpecId: d.layerSpecId,
    stripInstanceId: d.stripInstanceId,
    stripIndex: d.stripIndex,
    role: d.materialRole,
    layerIndex: d.layerIndex,
    chirality: d.chirality,
    interval: d.interval,
    theta0: d.theta0,
    thetaTwist: d.thetaTwist,
    phi0: d.phi0,
    phiSlope: d.phiSlope,
    phase: d.phase,
    radius: d.radius,
    waviness: d.waviness,
    segmentCount: d.segmentCount,
  }));
}

function massSignature(generated) {
  return generated.descriptors.map(d => ({
    id: d.id,
    layerSpecId: d.layerSpecId,
    stripInstanceId: d.stripInstanceId,
    stripIndex: d.stripIndex,
    chunkiness: d.chunkiness,
    width: d.width,
    thickness: d.thickness,
  }));
}

assert.deepEqual(
  shapeSignature(lowChunk),
  shapeSignature(highChunk),
  'chunkiness changes mass/width only, not layer shape, centerline law, intervals, or descriptor count'
);
assert.notDeepEqual(
  massSignature(lowChunk),
  massSignature(highChunk),
  'chunkiness still changes authored layer mass fields'
);

const assembled = coreModule.generateLamellarSectionSegments({
  seed: 31,
  layerCount: 4,
  chiralityPattern: 'alternating',
  depthSpacing: 0.09,
  chunkinessBase: 0.4,
  chunkinessVariance: 0,
  overlapBias: 1,
  layerOverrides: [
    { layerIndex: 0, chirality: 1, chunkiness: 0.22, stripCount: 3 },
    { layerIndex: 1, chirality: -1, chunkiness: 1, stripCount: 2 },
    { layerIndex: 2, chirality: 1, chunkiness: 0.36, stripCount: 2 },
    { layerIndex: 3, chirality: -1, chunkiness: 0.58, stripCount: 1 },
  ],
});
assert.equal(assembled.layerSpecs.length, 4, 'assembler preserves requested layer count');
assert.ok(assembled.stripInstances.length > assembled.layerSpecs.length, 'layer shells expand to more strip instances than layer specs');
assert.deepEqual(
  assembled.layerSpecs.map(layer => layer.stripIds.length),
  [3, 2, 2, 1],
  'each layer spec owns the requested strip ids'
);
assert.ok(
  assembled.stripInstances.every(strip => strip.kind === 'LamellarStripInstance' && strip.layerSpecId && Number.isInteger(strip.stripIndex)),
  'every strip instance carries kind, layer ancestry, and strip index'
);
assert.ok(
  assembled.descriptors.every(descriptor => descriptor.stripInstanceId && Number.isInteger(descriptor.stripIndex)),
  'every emitted descriptor carries strip-instance ancestry'
);
assert.ok(
  assembled.sphereCurveDescriptors.length >= assembled.stripInstances.length,
  'sphere-curve substrate emits at least one upstream curve for each strip instance'
);
assert.ok(
  assembled.sphereCurveDescriptors.every(curve =>
    curve.kind === 'SphereCurveDescriptor'
    && curve.sourceStripInstanceId
    && curve.sourcePopulationId
    && Array.isArray(curve.interval)
    && Number.isFinite(curve.radius)
    && Number.isFinite(curve.theta0)
    && Number.isFinite(curve.phi0)
  ),
  'sphere curves carry source strip/population ancestry and solved sphere-domain fields'
);
assert.ok(
  assembled.descriptors.every(descriptor =>
    descriptor.sourceCurveId
    && assembled.sphereCurveDescriptors.some(curve => curve.id === descriptor.sourceCurveId)
  ),
  'every emitted descriptor cites an upstream sphere curve'
);
assert.equal(
  assembled.curveInteractionReceipt?.mode,
  'sphere-curve-proximity-interaction-v0',
  'curve interaction receipt is emitted before mesh descriptors'
);
assert.ok(
  Number.isInteger(assembled.curveInteractionReceipt?.curveCount)
    && assembled.curveInteractionReceipt.curveCount === assembled.sphereCurveDescriptors.length,
  'curve interaction receipt counts the generated sphere curves'
);

const noStripTopologyFamilies = coreModule.generateLamellarSectionSegments({
  seed: 17,
  layerCount: 3,
  populationCount: 4,
  cutterCount: 1,
  populationBearingVariance: 1,
  stripTopologyCount: 0,
});
const withShellTopologyFamilies = coreModule.generateLamellarSectionSegments({
  seed: 17,
  layerCount: 3,
  populationCount: 4,
  cutterCount: 1,
  populationBearingVariance: 1,
  stripTopologyCount: 2,
  shellEnclosure: 0.55,
});
assert.equal(
  noStripTopologyFamilies.stripTopologyDescriptors.length,
  0,
  'zero strip topology count emits no topology descriptors'
);
assert.ok(
  withShellTopologyFamilies.stripTopologyDescriptors.length > 0,
  'positive strip topology count emits topology descriptors before mesh emission'
);
assert.ok(
  withShellTopologyFamilies.stripTopologyDescriptors.every(member =>
    member.kind === 'SphereCurveDescriptor'
    && member.topologyMode === 'shell-distributed-topology-families-v0'
    && member.topologyRole === 'shell-family-member'
    && member.sourceParentPopulationId
    && member.sourceParentCurveId
    && Number.isInteger(member.shellTopologyFamilyIndex)
    && Number.isFinite(member.topologyOrientationBearing)
  ),
  'shell topology families carry parent population/curve ancestry and sphere-family orientation identity'
);
const shellFamilyPopulationIds = new Set(
  withShellTopologyFamilies.stripTopologyDescriptors.map(member => member.populationId)
);
assert.ok(
  shellFamilyPopulationIds.size >= 2
    && Array.from(shellFamilyPopulationIds).every(id => /shell-family/.test(id)),
  'strip topology count creates additional shell-family populations, not just child strips inside one rib'
);
const shellFamilyBearings = new Set(
  withShellTopologyFamilies.stripTopologyDescriptors.map(member => member.topologyOrientationBearing.toFixed(3))
);
assert.ok(shellFamilyBearings.size >= 2, 'shell topology families are distributed across multiple sphere bearings');
const basePhiRange = (() => {
  const values = noStripTopologyFamilies.sphereCurveDescriptors.map(curve => curve.phi0);
  return Math.max(...values) - Math.min(...values);
})();
const shellPhiRange = (() => {
  const values = withShellTopologyFamilies.sphereCurveDescriptors.map(curve => curve.phi0);
  return Math.max(...values) - Math.min(...values);
})();
assert.ok(
  shellPhiRange > basePhiRange + 0.25,
  'shell topology families expand the latitude coverage instead of only subdividing each strip'
);
assert.ok(
  withShellTopologyFamilies.descriptors.filter(descriptor => descriptor.topologyRole === 'shell-family-member').length >= withShellTopologyFamilies.stripTopologyDescriptors.length,
  'shell topology families are emitted as Lamellar section geometry, not debug-only receipts'
);
assert.ok(
  withShellTopologyFamilies.lamellarEnvelopeDescriptors.some(envelope => shellFamilyPopulationIds.has(envelope.populationId)),
  'shell topology family populations are available to envelope meshing as independent curve families'
);
assert.ok(
  withShellTopologyFamilies.sphereCurveDescriptors.length > noStripTopologyFamilies.sphereCurveDescriptors.length,
  'shell topology families expand the sphere-curve substrate before envelope meshing'
);

const layerScopedShellSets = coreModule.generateLamellarSectionSegments({
  seed: 17,
  layerCount: 3,
  populationCount: 4,
  cutterCount: 1,
  populationBearingVariance: 1,
  stripTopologyCount: 1,
  shellEnclosure: 0.55,
  layerOverrides: [
    { layerIndex: 0, shellSetCount: 5 },
  ],
});
const shellFamilyIndexesForLayer = layerIndex => new Set(
  layerScopedShellSets.shellTopologyFamilyDescriptors
    .filter(member => member.layerIndex === layerIndex)
    .map(member => member.shellTopologyFamilyIndex)
);
assert.equal(
  layerScopedShellSets.layerSpecs.find(layer => layer.layerIndex === 0)?.shellSetCount,
  5,
  'selected layer shell-set override records five visible shell sets'
);
assert.equal(
  shellFamilyIndexesForLayer(0).size,
  4,
  'selected layer shell-set override creates four derived shell families around the primary family'
);
assert.equal(
  layerScopedShellSets.layerSpecs.find(layer => layer.layerIndex === 2)?.shellSetCount,
  2,
  'non-selected layer keeps the global shell-family default as two visible shell sets'
);
assert.equal(
  shellFamilyIndexesForLayer(2).size,
  1,
  'non-selected layer keeps one derived shell family from the global default'
);
assert.ok(
  layerScopedShellSets.shellTopologyFamilyDescriptors
    .filter(member => member.layerIndex === 0)
    .every(member => member.shellSetOverrideMode === 'layer-shell-family-set-count-v0' && member.shellSetCount === 5),
  'derived shell-family descriptors carry the selected layer set-count receipt'
);

const withIntraStripTopologyMembers = coreModule.generateLamellarSectionSegments({
  seed: 17,
  layerCount: 3,
  populationCount: 4,
  cutterCount: 1,
  populationBearingVariance: 1,
  stripTopologyCount: 0,
  intraStripTopologyCount: 2,
});
assert.ok(
  withIntraStripTopologyMembers.stripTopologyDescriptors.some(member =>
    member.topologyMode === 'intra-strip-topology-members-v0'
    && member.topologyRole === 'intra-strip-member'
    && member.sourceParentStripInstanceId
    && Number.isInteger(member.topologyMemberIndex)
  ),
  'intra-strip topology remains available only through an explicit detail/member control'
);

const crossLayerProximity = coreModule.generateLamellarSectionSegments({
  seed: 31,
  layerCount: 2,
  chiralityPattern: 'same',
  depthSpacing: 0.015,
  chunkinessBase: 0.8,
  chunkinessVariance: 0,
  overlapBias: 1,
  layerOverrides: [
    { layerIndex: 0, chirality: 1, chunkiness: 0.8, stripCount: 1 },
    { layerIndex: 1, chirality: 1, chunkiness: 0.8, stripCount: 1 },
  ],
});
assert.ok(
  crossLayerProximity.curveInteractionReceipt.closeApproaches.some(approach =>
    approach.interactionKind === 'cross-layer-proximity'
  ),
  'curve interaction receipt detects close cross-layer sphere curves before meshing'
);

const baseLayerRadius = coreModule.generateLamellarSectionSegments({
  seed: 31,
  layerCount: 3,
  chiralityPattern: 'same',
  depthSpacing: 0.05,
  chunkinessBase: 0.4,
  chunkinessVariance: 0,
  layerOverrides: [
    { layerIndex: 1, chirality: -1, chunkiness: 0.4, stripCount: 2, radiusOffset: 0 },
  ],
});
const liftedLayerRadius = coreModule.generateLamellarSectionSegments({
  seed: 31,
  layerCount: 3,
  chiralityPattern: 'same',
  depthSpacing: 0.05,
  chunkinessBase: 0.4,
  chunkinessVariance: 0,
  layerOverrides: [
    { layerIndex: 1, chirality: -1, chunkiness: 0.4, stripCount: 2, radiusOffset: 0.12 },
  ],
});
const baseLayerOneCurves = baseLayerRadius.sphereCurveDescriptors.filter(curve => curve.layerIndex === 1);
const liftedLayerOneCurves = liftedLayerRadius.sphereCurveDescriptors.filter(curve => curve.layerIndex === 1);
const liftedLayerOneDescriptors = liftedLayerRadius.descriptors.filter(descriptor => descriptor.layerIndex === 1);
assert.ok(
  liftedLayerRadius.layerSpecs.find(layer => layer.layerIndex === 1)?.radiusOffset === 0.12,
  'layer shell radius override is recorded on the layer spec'
);
assert.ok(
  liftedLayerOneCurves.every((curve, index) =>
    Number((curve.radius - baseLayerOneCurves[index].radius).toFixed(4)) === 0.12
  ),
  'selected layer radius override shifts every source sphere curve on that layer together'
);
assert.ok(
  liftedLayerOneDescriptors.every(descriptor =>
    descriptor.sourceCurveId
    && liftedLayerOneCurves.some(curve => curve.id === descriptor.sourceCurveId && curve.radius === descriptor.radius)
  ),
  'layer-radius-adjusted mesh descriptors are re-derived from shifted source curves'
);

const baseLayerThickness = coreModule.generateLamellarSectionSegments({
  seed: 31,
  layerCount: 2,
  chiralityPattern: 'same',
  chunkinessBase: 0.4,
  chunkinessVariance: 0,
  stripPopulations: [
    { layerIndex: 0, role: 'lamella', count: 3, chirality: 1, bearingOffset: 0, bearingVariance: 1 },
  ],
});
const scaledLayerThickness = coreModule.generateLamellarSectionSegments({
  seed: 31,
  layerCount: 2,
  chiralityPattern: 'same',
  chunkinessBase: 0.4,
  chunkinessVariance: 0,
  layerOverrides: [
    { layerIndex: 0, chirality: 1, chunkiness: 0.55, stripCount: 3, thicknessScale: 1.8 },
  ],
  stripPopulations: [
    { layerIndex: 0, role: 'lamella', count: 3, chirality: 1, bearingOffset: 0, bearingVariance: 1 },
  ],
  stripProfileOverrides: [
    { stripInstanceId: 'seed-31-layer-0-strip-1', thickness: 0.011 },
  ],
});
const baseLayerThicknessStrip = baseLayerThickness.stripInstances.find(strip => strip.id === 'seed-31-layer-0-strip-0');
const scaledLayerThicknessStrip = scaledLayerThickness.stripInstances.find(strip => strip.id === 'seed-31-layer-0-strip-0');
const localThicknessStrip = scaledLayerThickness.stripInstances.find(strip => strip.id === 'seed-31-layer-0-strip-1');
assert.equal(scaledLayerThickness.layerSpecs[0].thicknessScale, 1.8, 'layer spec records descendant thickness scale');
assert.ok(
  scaledLayerThicknessStrip.thickness > baseLayerThicknessStrip.thickness * 1.5,
  'layer thickness scale nudges descendant strips without visiting each strip'
);
assert.equal(
  scaledLayerThicknessStrip.stripProfileDescriptor.overrideSource,
  'layer-descendant-thickness-scale',
  'aggregate layer thickness receipts name their descendant scope'
);
assert.equal(localThicknessStrip.thickness, 0.011, 'strip-local thickness override is not stomped by aggregate layer scale');
assert.equal(
  localThicknessStrip.stripProfileDescriptor.overrideSource,
  'strip-local-profile-override',
  'strip-local thickness receipt remains explicit when an aggregate layer scale is present'
);
assert.ok(
  scaledLayerThickness.descriptors
    .filter(descriptor => descriptor.layerIndex === 0)
    .every(descriptor => descriptor.layerThicknessScale === 1.8),
  'mesh descriptors carry layer thickness scale receipts for downstream diagnostics'
);

const profiled = coreModule.generateLamellarSectionSegments({
  seed: 31,
  layerCount: 4,
  chiralityPattern: 'alternating',
  depthSpacing: 0.09,
  chunkinessBase: 0.4,
  chunkinessVariance: 0,
  overlapBias: 1,
  layerOverrides: [
    { layerIndex: 0, chirality: 1, chunkiness: 0.22, stripCount: 3 },
    { layerIndex: 1, chirality: -1, chunkiness: 1, stripCount: 2 },
    { layerIndex: 2, chirality: 1, chunkiness: 0.36, stripCount: 2 },
    { layerIndex: 3, chirality: -1, chunkiness: 0.58, stripCount: 1 },
  ],
  stripProfileOverrides: [
    {
      stripInstanceId: 'seed-31-layer-0-strip-1',
      width: 0.044,
      thickness: 0.031,
      widthVariance: 0.4,
      thicknessVariance: 0.2,
      gapPattern: 'dashed',
    },
  ],
});
const profiledStrip = profiled.stripInstances.find(strip => strip.id === 'seed-31-layer-0-strip-1');
assert.equal(profiledStrip?.stripProfileDescriptor?.kind, 'StripProfileDescriptor', 'profiled strip carries a named strip profile descriptor');
assert.equal(profiledStrip.stripProfileDescriptor.width, 0.044, 'strip profile width override is preserved independently');
assert.equal(profiledStrip.stripProfileDescriptor.thickness, 0.031, 'strip profile thickness override is preserved independently');
assert.equal(profiledStrip.stripProfileDescriptor.widthVariance, 0.4, 'strip profile width variance override is preserved independently');
assert.equal(profiledStrip.stripProfileDescriptor.thicknessVariance, 0.2, 'strip profile thickness variance override is preserved independently');
assert.equal(profiledStrip.stripProfileDescriptor.gapPattern, 'dashed', 'strip profile gap pattern override is preserved');
const profiledDescriptors = profiled.descriptors.filter(descriptor => descriptor.stripInstanceId === 'seed-31-layer-0-strip-1');
assert.ok(profiledDescriptors.length > 1, 'dashed selected-strip profile emits multiple descriptor spans for authored gaps');
assert.ok(
  profiledDescriptors.every(descriptor =>
    descriptor.stripProfileDescriptor?.kind === 'StripProfileDescriptor'
    && descriptor.width === 0.044
    && descriptor.thickness === 0.031
    && descriptor.widthVariance === 0.4
    && descriptor.thicknessVariance === 0.2
    && descriptor.gapPattern === 'dashed'
  ),
  'profiled descriptors carry selected-strip width, thickness, variance, and gap pattern receipts'
);

const macroStack = coreModule.generateLamellarSectionSegments({
  seed: 31,
  layerCount: 8,
  chiralityPattern: 'alternating',
  depthSpacing: 0.05,
  chunkinessBase: 0.4,
  chunkinessVariance: 0,
  overlapBias: 0.5,
});
assert.equal(macroStack.layerSpecs.length, 8, 'macro composer supports more than four layers');
assert.equal(macroStack.layerStackDescriptor.numLayers, 8, 'layer stack descriptor records expanded macro layer count');

const populated = coreModule.generateLamellarSectionSegments({
  seed: 31,
  layerCount: 3,
  chiralityPattern: 'same',
  depthSpacing: 0.05,
  chunkinessBase: 0.4,
  chunkinessVariance: 0,
  overlapBias: 0.5,
  stripPopulations: [
    { layerIndex: 0, role: 'lamella', count: 4, chirality: 1, bearingOffset: 0, bearingVariance: 0.28 },
    { layerIndex: 0, role: 'cutter', count: 2, chirality: -1, bearingOffset: 0.44, bearingVariance: 0.12, gapPattern: 'crosscut' },
  ],
});
{
  const populationRadius = coreModule.generateLamellarSectionSegments({
    seed: 31,
    layerCount: 2,
    chiralityPattern: 'same',
    chunkinessBase: 0.4,
    chunkinessVariance: 0,
    stripPopulations: [
      { id: 'inner-set', layerIndex: 0, role: 'lamella', count: 3, chirality: 1, bearingOffset: 0, bearingVariance: 1, radialSpacing: 0.04, radiusOffset: -0.06, layoutPreset: 'coverage' },
      { id: 'outer-set', layerIndex: 0, role: 'cutter', count: 3, chirality: -1, bearingOffset: 0.44, bearingVariance: 0.5, radialSpacing: 0.04, radiusOffset: 0.09, layoutPreset: 'coverage' },
    ],
  });
  const innerPopulation = populationRadius.stripPopulationDescriptors.find(population => population.id === 'inner-set');
  const outerPopulation = populationRadius.stripPopulationDescriptors.find(population => population.id === 'outer-set');
  const innerDescriptors = populationRadius.descriptors.filter(descriptor => descriptor.populationId === 'inner-set');
  const outerDescriptors = populationRadius.descriptors.filter(descriptor => descriptor.populationId === 'outer-set');
  const radiusAverage = descriptors => descriptors.reduce((sum, descriptor) => sum + descriptor.radius, 0) / Math.max(1, descriptors.length);
  const radiusRange = descriptors => Math.max(...descriptors.map(descriptor => descriptor.radius)) - Math.min(...descriptors.map(descriptor => descriptor.radius));
  assert.equal(innerPopulation?.radiusOffset, -0.06, 'inner population records its own set radius offset');
  assert.equal(outerPopulation?.radiusOffset, 0.09, 'outer population records its own set radius offset');
  assert.ok(radiusAverage(outerDescriptors) - radiusAverage(innerDescriptors) > 0.12, 'population radius offset moves whole same-layer sets apart');
  assert.ok(Math.abs(radiusRange(outerDescriptors) - radiusRange(innerDescriptors)) < 0.001, 'population radius offset is independent from intra-set radial spacing');
}
function circularMinGap(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  const gaps = sorted.map((value, index) => {
    const next = sorted[(index + 1) % sorted.length] + (index === sorted.length - 1 ? Math.PI * 2 : 0);
    return next - value;
  });
  return Math.min(...gaps);
}

function range(values) {
  return Math.max(...values) - Math.min(...values);
}

{
  const populationControlsBase = {
    seed: 31,
    layerCount: 2,
    chiralityPattern: 'same',
    chunkinessBase: 0.4,
    chunkinessVariance: 0,
    stripPopulations: [
      {
        id: 'spread-split-target',
        layerIndex: 0,
        role: 'lamella',
        count: 5,
        chirality: 1,
        bearingOffset: 0,
        bearingVariance: 0.35,
        laneSpan: 0.42,
        phaseStagger: 0.18,
        radialSpacing: 0.04,
        layoutPreset: 'coverage',
      },
    ],
  };
  const lowSpread = coreModule.generateLamellarSectionSegments(populationControlsBase);
  const highSpread = coreModule.generateLamellarSectionSegments({
    ...populationControlsBase,
    stripPopulations: [
      { ...populationControlsBase.stripPopulations[0], bearingVariance: 1.55 },
    ],
  });
  const lowPopulation = lowSpread.stripPopulationDescriptors.find(population => population.id === 'spread-split-target');
  const highPopulation = highSpread.stripPopulationDescriptors.find(population => population.id === 'spread-split-target');
  const lowStrips = lowSpread.stripInstances.filter(strip => strip.populationId === 'spread-split-target');
  const highStrips = highSpread.stripInstances.filter(strip => strip.populationId === 'spread-split-target');
  assert.equal(lowPopulation?.layoutControlMode, 'decoupled-population-layout-controls-v0', 'population records decoupled layout-control mode');
  assert.equal(lowPopulation?.laneSpan, 0.42, 'population records lane span independently from spread');
  assert.equal(highPopulation?.laneSpan, 0.42, 'spread does not rewrite authored lane span');
  assert.equal(lowPopulation?.phaseStagger, 0.18, 'population records phase stagger independently from spread');
  assert.equal(highPopulation?.phaseStagger, 0.18, 'spread does not rewrite authored phase stagger');
  assert.ok(range(highStrips.map(strip => strip.bearingPhase)) > range(lowStrips.map(strip => strip.bearingPhase)) * 3, 'spread still changes angular coverage');
  assert.ok(Math.abs(range(highStrips.map(strip => strip.shellLaneOffset)) - range(lowStrips.map(strip => strip.shellLaneOffset))) < 0.001, 'spread must not change shell-lane span');
  assert.ok(Math.abs(range(highStrips.map(strip => strip.phaseOffset)) - range(lowStrips.map(strip => strip.phaseOffset))) < 0.001, 'spread must not change curve phase staggering');
}

for (const count of [4, 5, 6]) {
  const covered = coreModule.generateLamellarSectionSegments({
    seed: 31,
    layerCount: 2,
    chiralityPattern: 'same',
    chunkinessBase: 0.4,
    chunkinessVariance: 0,
    stripPopulations: [
      { layerIndex: 0, role: 'lamella', count, chirality: 1, bearingOffset: 0, bearingVariance: 1, layoutPreset: 'coverage' },
    ],
  });
  const population = covered.stripPopulationDescriptors.find(candidate => candidate.role === 'lamella');
  const strips = covered.stripInstances.filter(strip => strip.populationId === population?.id);
  const descriptorsForPopulation = covered.descriptors.filter(descriptor => descriptor.populationId === population?.id);
  assert.equal(population?.layoutPreset, 'coverage', `count ${count} population records coverage layout preset`);
  assert.ok(population?.coverageSpacing >= (Math.PI * 2 / count) * 0.95, `count ${count} records near-even coverage spacing`);
  assert.ok(population?.coverageSpan >= 0.66, `count ${count} records a visible shell coverage span`);
  assert.equal(strips.length, count, `count ${count} emits exactly one strip per coverage slot`);
  assert.ok(circularMinGap(strips.map(strip => strip.bearingPhase)) >= (Math.PI * 2 / count) * 0.95, `count ${count} strips are evenly phase-spaced around the shell`);
  assert.ok(Math.max(...strips.map(strip => strip.shellLaneOffset)) - Math.min(...strips.map(strip => strip.shellLaneOffset)) >= 0.66, `count ${count} strips occupy visible shell lanes`);
  assert.ok(Math.max(...strips.map(strip => strip.radialOffset)) - Math.min(...strips.map(strip => strip.radialOffset)) >= 0.12, `count ${count} strips occupy separated radial shells`);
  assert.ok(Math.max(...descriptorsForPopulation.map(descriptor => descriptor.theta0)) - Math.min(...descriptorsForPopulation.map(descriptor => descriptor.theta0)) > 0.25, `count ${count} descriptors retain smooth rotational authority`);
  assert.ok(Math.max(...descriptorsForPopulation.map(descriptor => descriptor.phi0)) - Math.min(...descriptorsForPopulation.map(descriptor => descriptor.phi0)) >= 0.45, `count ${count} descriptors occupy visible shell-lane centerlines`);
  assert.ok(Math.max(...descriptorsForPopulation.map(descriptor => descriptor.radius)) - Math.min(...descriptorsForPopulation.map(descriptor => descriptor.radius)) >= 0.12, `count ${count} descriptors expose radial clearance in emitted shell radius`);
}
{
  const chiralityBase = {
    seed: 31,
    layerCount: 2,
    chiralityPattern: 'same',
    chunkinessBase: 0.4,
    chunkinessVariance: 0,
    stripPopulations: [
      { id: 'flip-target', layerIndex: 0, role: 'lamella', count: 4, chirality: 1, bearingOffset: 0, bearingVariance: 1, layoutPreset: 'coverage' },
    ],
  };
  const positive = coreModule.generateLamellarSectionSegments(chiralityBase);
  const negative = coreModule.generateLamellarSectionSegments({
    ...chiralityBase,
    stripPopulations: [{ ...chiralityBase.stripPopulations[0], chirality: -1 }],
  });
  const positivePopulation = positive.stripPopulationDescriptors.find(population => population.id === 'flip-target');
  const negativePopulation = negative.stripPopulationDescriptors.find(population => population.id === 'flip-target');
  const positiveDescriptors = positive.descriptors.filter(descriptor => descriptor.populationId === 'flip-target');
  const negativeDescriptors = negative.descriptors.filter(descriptor => descriptor.populationId === 'flip-target');
  assert.equal(positivePopulation?.chirality, 1, 'positive chirality population remains positive');
  assert.equal(negativePopulation?.chirality, -1, 'negative chirality population flips negative');
  assert.equal(positiveDescriptors.length, negativeDescriptors.length, 'chirality flip preserves population descriptor count');
  assert.ok(
    positiveDescriptors.some((descriptor, index) => Math.sign(descriptor.thetaTwist || 0) !== Math.sign(negativeDescriptors[index]?.thetaTwist || 0)),
    'population chirality flip changes emitted curve twist direction'
  );
  const positiveFamilies = coreModule.generateLamellarSectionSegments({
    ...chiralityBase,
    stripTopologyCount: 2,
  });
  const negativeFamilies = coreModule.generateLamellarSectionSegments({
    ...chiralityBase,
    stripTopologyCount: 2,
    stripPopulations: [{ ...chiralityBase.stripPopulations[0], chirality: -1 }],
  });
  const positiveFamilyDescriptors = positiveFamilies.descriptors.filter(descriptor =>
    descriptor.topologyRole === 'shell-family-member' && descriptor.sourceParentPopulationId === 'flip-target'
  );
  const negativeFamilyDescriptors = negativeFamilies.descriptors.filter(descriptor =>
    descriptor.topologyRole === 'shell-family-member' && descriptor.sourceParentPopulationId === 'flip-target'
  );
  assert.ok(positiveFamilyDescriptors.length > 0, 'shell-family chirality test emitted derived family descriptors');
  assert.equal(positiveFamilyDescriptors.length, negativeFamilyDescriptors.length, 'shell-family chirality flip preserves derived family count');
  assert.ok(
    positiveFamilyDescriptors.every((descriptor, index) => Math.sign(descriptor.thetaTwist || 0) === -Math.sign(negativeFamilyDescriptors[index]?.thetaTwist || 0)),
    'population chirality flip propagates into all derived shell-family sets'
  );
}
assert.ok(
  populated.stripPopulationDescriptors.every(population =>
    populated.stripInstances.some(strip => strip.populationId === population.id)
  ),
  'each population descriptor owns at least one emitted strip instance'
);
assert.ok(
  populated.stripInstances.filter(strip => strip.populationId === populated.stripPopulationDescriptors[0]?.id).length > 1,
  'population ids group multiple same-shell strip instances for population-level selection'
);
assert.ok(
  populated.stripPopulationDescriptors.some(population =>
    population.kind === 'StripPopulationDescriptor'
    && population.layerIndex === 0
    && population.role === 'cutter'
    && population.count === 2
    && population.bearingVariance === 0.12
  ),
  'macro same-layer cutter population descriptor is preserved'
);
assert.ok(
  populated.stripInstances.some(strip => strip.populationRole === 'cutter' && strip.chirality === -1),
  'same-layer cutter population emits opposite-direction strip instances'
);
assert.ok(
  populated.descriptors.some(descriptor => descriptor.populationRole === 'cutter' && descriptor.gapPattern === 'crosscut'),
  'same-layer cutter population reaches emitted descriptors with gap/crosscut intent'
);

const sliced = coreModule.sliceLamellarSectionSegments(highChunk.descriptors, {
  cutRadius: 0.052,
  sliceT: 0.352,
  sliceAngle: -11,
});
assert.equal(
  sliced.channelCutReceipt.mode,
  'neighbor-offset-envelope-terminal-channel-cut',
  'slice receipt identifies B offset envelope as the cut author'
);
assert.equal(
  sliced.channelCutReceipt.terminalContourSource,
  'neighbor-offset-envelope-rail-contour',
  'slice receipt identifies the neighbor-derived terminal contour source'
);
assert.ok(
  sliced.channelCutReceipt.channelGapRadius > 0,
  'slice receipt records a positive channel gap radius'
);
assert.equal(
  sliced.channelCutReceipt.terminalRailStopCount,
  30,
  'slice receipt keeps a stable rail-stop count for the channel contour'
);
assert.equal(
  sliced.channelCutReceipt.witnessAnchorMode,
  'selected-neighbor-channel-closeup',
  'slice receipt records the cut-author witness anchor mode'
);
assert.match(
  sliced.channelCutReceipt.sourceStripInstanceId,
  /^seed-31-layer-1-strip-/,
  'channel-cut receipt points at a specific cut-author strip instance'
);
