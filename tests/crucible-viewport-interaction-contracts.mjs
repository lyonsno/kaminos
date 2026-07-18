import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

const consolePreferenceSource = html.match(
  /function crucibleViewportNextConsolePreference\([\s\S]*?\n}/,
);
assert.ok(consolePreferenceSource, 'Console retuck policy must be a testable state transition');
const crucibleViewportNextConsolePreference = Function(`return (${consolePreferenceSource[0]})`)();
assert.equal(
  crucibleViewportNextConsolePreference({ roomPosture: 'cast-held', previousRoomPosture: 'firing', preference: 'expanded' }),
  'auto',
  'a cast arriving after an operator opened the firing bench must reveal itself automatically',
);
assert.equal(
  crucibleViewportNextConsolePreference({ roomPosture: 'cast-held', previousRoomPosture: 'cast-held', preference: 'expanded' }),
  'expanded',
  'opening an already completed cast must remain an operator-owned presentation choice',
);
assert.equal(
  crucibleViewportNextConsolePreference({ roomPosture: 'firing', previousRoomPosture: 'firing', preference: 'expanded' }),
  'expanded',
  'opening the bench during a firing must remain stable until the result arrives',
);

const replayRunSource = html.match(
  /function replayRunWithSourceReport\([\s\S]*?\n}/,
);
assert.ok(replayRunSource, 'Crucible replay must expose a testable source-report preservation helper');
const replayRunWithSourceReport = Function(`return (${replayRunSource[0]})`)();
const sourceReportPath = '/tmp/pipeline-runs/completed/pipeline-witness.json';
const receiptBearingReplayRun = replayRunWithSourceReport({
  replay: { reportPath: sourceReportPath },
  run: { runId: 'visual-replay:abc', report: { document: { ok: true } } },
});
assert.equal(receiptBearingReplayRun.report.path, sourceReportPath);
assert.equal(receiptBearingReplayRun.report.document.ok, true, 'adding replay report identity must not discard existing report content');
assert.throws(
  () => replayRunWithSourceReport({ replay: {}, run: {} }),
  /source pipeline witness path/,
  'an under-sourced replay must fail before importing or recording a cast',
);

assert.doesNotMatch(
  html,
  /cooperative-(?:fixed-16ms-donation|spn-fusion-tiles-524288)/,
  'Invocation-only scheduler experiments must not become operator-facing Crucible modes',
);

assert.doesNotMatch(
  html,
  /#crucible-viewport-workspace\s*\{[^}]*pointer-events:\s*none/s,
  'The Crucible workroom must accept pointer input instead of behaving like an untouchable overlay',
);

const requiredControls = [
  ['crucible-viewport-source-select', 'The source plate must expose a direct image chooser'],
  ['crucible-viewport-route-select', 'The firing mouth must expose the intended output route'],
  ['crucible-viewport-profile-select', 'The firing mouth must expose the available firing behavior'],
  ['crucible-viewport-presentation-select', 'The firing mouth must expose the visible fire presentation'],
  ['crucible-viewport-flame-continuity-select', 'The firing mouth must expose the flame continuity policy'],
  ['crucible-viewport-fire-button', 'The firing mouth must expose one obvious primary command'],
  ['crucible-viewport-cast-button', 'The cast tray must expose the finished cast action'],
  ['crucible-viewport-console-toggle', 'The active caddy must expose one plain-language control for reopening the full bench'],
];

for (const [id, message] of requiredControls) {
  assert.match(html, new RegExp(`id=["']${id}["']`), message);
}

assert.match(
  html,
  /function renderCrucibleViewportSourceOptions\(/,
  'The plate chooser must render from the real indexed image assets',
);
assert.match(
  html,
  /pipelineDockState\.browserAssetsByKind\?\.image/,
  'The plate chooser must consume the shared image index rather than a private fixture list',
);
assert.match(
  html,
  /function selectCrucibleViewportSource\(assetId\)[\s\S]*pipelineDockState\.browserSelectedAssetIds\.image\s*=\s*assetId/,
  'Choosing a plate image must update the existing shared source selection',
);

assert.match(
  html,
  /function runCrucibleViewportFiring\([\s\S]*firePresentationMode[\s\S]*flameContinuityMode[\s\S]*runKilnRouteBenchRoute\(route\.id,\s*profileId,\s*\{ firePresentationMode, flameContinuityMode \}\)/,
  'The central fire command must carry the effective route, profile, presentation, and flame continuity policy',
);
assert.match(
  html,
  />Keep the flame moving from recent frames</,
  'bounded holdover must be offered in ordinary operator language',
);
assert.match(
  html,
  />Run every simulation frame</,
  'the live-every-frame comparison must be offered in ordinary operator language',
);
assert.match(
  html,
  /volumePrototype\.setControls\(\{[\s\S]*flameContinuityMode[\s\S]*\}\)/,
  'the same-firing start must apply the chosen continuity mode to the volume runtime',
);
assert.match(
  html,
  /function readVolumeControls\(\)[\s\S]*return backOffVolumeLegacyPyroControls\(applyVolumeRuntimeQualityLadder\(\{[\s\S]{0,500}flameContinuityMode:\s*crucibleViewportFlameContinuityMode,/,
  'ordinary volume control synchronization must preserve the operator-selected continuity policy',
);
assert.match(
  html,
  /flameContinuityRequested:[\s\S]*flameContinuityEffective:/,
  'the Crucible debug surface must distinguish requested and effective continuity routes',
);
assert.match(
  html,
  /fireButton\.disabled\s*=\s*running\s*\|\|\s*!currentSource\?\.source/,
  'The central fire command must fail visibly disabled without a source or while another firing runs',
);
assert.match(
  html,
  /workspace\.dataset\.crucibleRouteStatus\s*=\s*kilnRouteBenchState\.status/,
  'The workroom must expose the real route status used by its controls',
);
assert.match(
  html,
  /function toggleCrucibleViewportConsole\(\)[\s\S]*crucibleViewportConsolePreference\s*=\s*currentState\s*===\s*'tucked'\s*\?\s*'expanded'\s*:\s*'tucked'[\s\S]*renderCrucibleViewportWorkspace\(\)/,
  'The operator must be able to open or tuck the bench without mutating route or cast state',
);
assert.match(
  html,
  /consoleToggle\.textContent\s*=\s*consoleState\s*===\s*'tucked'[\s\S]*'Open bench'[\s\S]*roomPosture\s*===\s*'cast-held'[\s\S]*'See cast'[\s\S]*'See furnace'/,
  'The console toggle must describe the visible result in ordinary language',
);
assert.match(
  html,
  /progressLabel\.textContent\s*=\s*Number\.isFinite\(routeProgress\)[\s\S]*Math\.round\(routeProgress\s*\*\s*100\)/,
  'The firing mouth must turn real route progress into a legible percentage when one exists',
);
assert.match(
  html,
  /const onProgress\s*=\s*event\s*=>\s*\{[\s\S]*event\?\.message\s*\|\|\s*'The model is working on your cast\.'[\s\S]*setKilnRouteBenchStatus/,
  'Progress-only route events must update the caddy instead of being dropped when message is absent',
);
assert.doesNotMatch(
  html,
  /onProgress:\s*event\s*=>\s*\{\s*if\s*\(event\?\.message\)/,
  'A missing optional progress message must not gate truthful progress ingestion',
);
assert.match(
  html,
  /crucibleViewportConsolePreference\s*=\s*crucibleViewportNextConsolePreference\(\{[\s\S]*previousRoomPosture:\s*crucibleViewportLastRoomPosture/,
  'A newly completed cast must retuck even when the operator opened the full bench during firing',
);
assert.match(
  html,
  /function crucibleViewportCastScreenPoint\(castRecord\)[\s\S]*\.project\(camera\)[\s\S]*screenX/,
  'The witness debug surface must expose where the selected cast lands in the visible scene',
);
assert.match(
  html,
  /const sceneViewportResizeObserver\s*=\s*new ResizeObserver\([\s\S]*sceneViewportResizeObserver\.observe\(vp\)/,
  'The renderer must follow flex-driven viewport changes when the Crucible releases or restores sidebar width',
);
assert.match(
  html,
  /function crucibleViewportFiringCopy\([\s\S]*'The kiln is shaping your cast\.'[\s\S]*'Your cast is in the scene\.'/,
  'Primary firing copy must explain the human-visible state instead of leading with route identity',
);
assert.match(
  html,
  /function crucibleViewportCastCopy\([\s\S]*'Your splat is in the scene\.'/,
  'Primary cast copy must explain the result while path and route identity remain in the receipt',
);

assert.match(
  html,
  /castButton\.disabled\s*=\s*!lastCast\?\.assetId\s*\|\|\s*!castRecord/,
  'The cast action must stay disabled until its recorded scene object still exists',
);
assert.match(
  html,
  /function openCrucibleViewportCast\([\s\S]*window\.selectSceneObject\(lastCast\.assetId\)[\s\S]*setActiveTab\('assets'\)/,
  'Opening a cast must select the recorded scene object and move to the actual asset surface',
);
assert.match(
  html,
  /const importedObject = await greenroomImportSplat\([\s\S]*sceneObjects\.find\(entry => entry\.object === importedObject\)/,
  'Generated splat loading must resolve the importer object back to its registered scene record before recording a cast',
);
assert.match(
  html,
  /window\.kaminosCrucibleViewportDebugState\s*=\s*crucibleViewportDebugState/,
  'Browser witnesses must be able to read effective source, route, profile, running, and cast-target state',
);
assert.match(
  html,
  /async function replayRealPipelineCastInCrucible\(\{ replay, run, artifact \}\)[\s\S]*replayRunWithSourceReport\([\s\S]*pipelineLoadRunSplatArtifact\(replayRun, artifact\)[\s\S]*crucibleBenchRecordCast\([\s\S]*crucibleBenchRecordReceipt\([\s\S]*status:\s*'complete'/,
  'Real-output replay must use the actual pipeline importer and Crucible firing/cast/receipt state machine',
);
assert.match(
  html,
  /const receipt = crucibleBenchRecordReceipt\([\s\S]*return \{ firing, record, receipt \}/,
  'The replay bridge must return its persisted receipt so the browser witness can verify source-report custody',
);
assert.match(
  html,
  /window\.kaminosCrucibleViewportReplayRealCast\s*=\s*replayRealPipelineCastInCrucible/,
  'The visual witness must use one application-owned replay bridge instead of reaching into lexical internals',
);

console.log('Crucible viewport interaction contracts passed.');
