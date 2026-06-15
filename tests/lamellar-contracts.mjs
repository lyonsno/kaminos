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
assert.match(index, /id="lamellar-depth-spacing"/, 'Lamellar tab exposes layer depth spacing control');
assert.match(index, /id="lamellar-chunkiness"/, 'Lamellar tab exposes layer chunkiness control');
assert.match(index, /id="lamellar-chunkiness-variance"/, 'Lamellar tab exposes chunkiness variance control');
assert.match(index, /id="lamellar-layer-rows"/, 'Lamellar tab exposes per-layer authoring rows');
assert.match(index, /id="lamellar-layer-0-chirality"/, 'Lamellar tab exposes layer 0 chirality override');
assert.match(index, /id="lamellar-layer-0-chunkiness"/, 'Lamellar tab exposes layer 0 chunkiness override');
assert.match(index, /id="lamellar-layer-0-strip-count"/, 'Lamellar tab exposes layer 0 strip-count override');
assert.match(index, /id="lamellar-layer-0-radius"/, 'Lamellar tab exposes layer 0 shell radius override');
assert.match(index, /id="lamellar-layer-detail"/, 'Lamellar tab exposes selected-layer authoring detail panel');
assert.doesNotMatch(index, /id="lamellar-layer-detail"[^>]*display:none/, 'Lamellar selected-layer authoring panel is visible in the normal sidebar flow');
assert.doesNotMatch(index, /id="lamellar-layer-selectors"[^>]*display:none/, 'Lamellar layer selectors are visible with the selected-layer authoring panel');
assert.match(index, /id="lamellar-layer-select-0"/, 'Lamellar tab exposes layer 0 selection control');
assert.match(index, /id="lamellar-layer-select-3"/, 'Lamellar tab exposes layer 3 selection control');
assert.match(index, /id="lamellar-selected-layer-index"/, 'Lamellar tab reports the selected layer identity');
assert.match(index, /id="lamellar-selected-layer-strip-count"/, 'Lamellar tab exposes selected-layer strip-count editor');
assert.match(index, /id="lamellar-selected-layer-radius"/, 'Lamellar tab exposes selected-layer shell radius editor');
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
assert.match(index, /id="lamellar-population-radial-spacing"/, 'Lamellar population toolhead exposes radial shell spacing control');
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
assert.match(index, /lamellar_depth_spacing/, 'URL route can override Lamellar depth spacing');
assert.match(index, /lamellar_chunkiness/, 'URL route can override Lamellar layer chunkiness');
assert.match(index, /lamellar_chunkiness_variance/, 'URL route can override Lamellar chunkiness variance');
assert.match(index, /lamellar_layer_chiralities/, 'URL route can override per-layer chirality values');
assert.match(index, /lamellar_layer_chunkiness/, 'URL route can override per-layer chunkiness values');
assert.match(index, /lamellar_layer_strip_counts/, 'URL route can override per-layer strip counts');
assert.match(index, /lamellar_layer_radii/, 'URL route can override per-layer shell radii');
assert.match(index, /lamellar_population_count/, 'URL route can override macro strip population count');
assert.match(index, /lamellar_cutter_count/, 'URL route can override macro cutter population count');
assert.match(index, /lamellar_population_bearing_variance/, 'URL route can override macro direction variance');
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
assert.match(core, /ribbon-shell-angular-offset-v0/, 'Lamellar ribbon mesh emission records shell-angular width offsets instead of flat tangent-plane offsets');
assert.match(core, /StripProfileDescriptor/, 'Lamellar core names selected-strip profile descriptors explicitly');
assert.match(core, /StripPopulationDescriptor/, 'Lamellar core names macro strip population descriptors explicitly');
assert.match(core, /stripPopulationDescriptors/, 'Lamellar debug state reports macro strip population descriptors');
assert.match(core, /same-shell-direction-population-authoring-v0/, 'Lamellar core names same-shell direction population authoring mode');
assert.match(core, /even-shell-coverage-layout-v0/, 'Lamellar core names even shell coverage population layout');
assert.match(core, /layoutPreset/, 'Lamellar strip population descriptors record their layout preset');
assert.match(core, /coverageSpacing/, 'Lamellar strip populations report coverage spacing for overlap diagnostics');
assert.match(core, /coverageSpan/, 'Lamellar strip populations report visible shell coverage span');
assert.match(core, /bearingPhase/, 'Lamellar strip instances carry actual shell bearing phase, not tiny jitter only');
assert.match(core, /shellLaneOffset/, 'Lamellar strip instances carry shell-lane offsets for visible coverage sets');
assert.match(core, /radialSpacing/, 'Lamellar strip populations report radial spacing for same-population clearance');
assert.match(core, /radialOffset/, 'Lamellar strip instances carry radial offsets so same-population strips can separate by shell radius');
assert.match(core, /radiusOffset/, 'Lamellar layer specs carry shell radius offsets for whole-layer radius authoring');
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
assert.match(witness, /layerOverrides/, 'witness records per-layer override inputs');
assert.match(witness, /sliceToolDescriptor/, 'witness records slicing tool descriptor');
assert.match(witness, /sliceApplicationReceipt/, 'witness records slice application receipt');
assert.match(witness, /segmentDescriptorCount/, 'witness records generated descriptor count');
assert.match(witness, /lightHookCount/, 'witness records exported light hook count');
assert.match(witness, /blank frame/i, 'witness fails loudly on blank visual output');
assert.match(witness, /assertVisualDiversity/, 'witness checks screenshot pixel diversity, not only file size');
assert.match(witness, /manualEnable/, 'witness can exercise the plain-load Lamellar tab Enable path');
assert.match(witness, /manualEnableUi/, 'witness records manual-enable camera and visibility state');

const coreModule = await import(`${pathToFileURL(corePath).href}?contract=${Date.now()}`);
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
