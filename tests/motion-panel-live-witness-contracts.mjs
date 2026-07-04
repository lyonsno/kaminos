import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const witness = readFileSync(new URL('../motion-panel-live-witness.mjs', import.meta.url), 'utf8');

assert.match(witness, /kaminos\.motion-panel-live-witness\.v0/, 'live witness writes a stable report schema');
assert.match(witness, /kaminos\.motion-panel-live-filmstrip\.v0/, 'live witness writes a stable filmstrip schema');
assert.match(witness, /window\.generateMotion\(\)/, 'live witness exercises the real motion panel Generate Motion path');
assert.match(witness, /--prompt/, 'live witness exposes prompt as an invocation input');
assert.match(witness, /--frames/, 'live witness exposes frame count as an invocation input');
assert.match(witness, /--interval-ms/, 'live witness exposes capture interval as an invocation input');
assert.match(witness, /--tile-width/, 'live witness exposes filmstrip tile width as an invocation input');
assert.match(witness, /--columns/, 'live witness exposes filmstrip grid columns as an invocation input');
assert.match(witness, /--export-current-view/, 'live witness can exercise the in-page current-view export path');
assert.match(witness, /--export-selected-cliplet/, 'live witness can exercise the in-page selected-cliplet export path');
assert.match(witness, /--focus-phrase-preview/, 'live witness can frame the Motion panel phrase preview for visual smoke');
assert.match(witness, /--focus-take-shelf/, 'live witness can frame the Motion panel take shelf for visual smoke');
assert.match(witness, /--promote-take/, 'live witness can exercise durable motion-take promotion');
assert.match(witness, /BOOLEAN_ARGS/, 'live witness parser distinguishes boolean flags from valued flags');
assert.match(witness, /i \+= BOOLEAN_ARGS\.has/, 'live witness boolean flags must not shift later valued arguments such as report and filmstrip paths');
assert.match(witness, /--export-reference-mode/, 'live witness can force an export-only reference skeleton mode');
assert.match(witness, /window\.exportMotionPanelCurrentViewFilmstrip/, 'live witness invokes the actual Motion panel current-view export function');
assert.match(witness, /window\.exportMotionPanelSelectedClipletFilmstrip/, 'live witness invokes the actual Motion panel selected-cliplet export function');
assert.match(witness, /kaminos\.motion-panel-live-current-view-export\.v0/, 'live witness records current-view export evidence with a stable schema');
assert.match(witness, /kaminos\.motion-panel-live-selected-cliplet-export\.v0/, 'live witness records selected-cliplet export evidence with a stable schema');
assert.match(witness, /kaminos\.motion-panel-live-phrase-preview-focus\.v0/, 'live witness records phrase preview focus evidence with a stable schema');
assert.match(witness, /kaminos\.motion-panel-live-take-shelf-focus\.v0/, 'live witness records take shelf focus evidence with a stable schema');
assert.match(witness, /kaminos\.motion-panel-live-take-promotion\.v0/, 'live witness records durable take promotion evidence with a stable schema');
assert.match(witness, /window\.promoteMotionPanelSelectedTake/, 'live witness invokes the actual Motion panel take promotion path');
assert.match(witness, /window\.previewDurableMotionPanelTake/, 'live witness verifies promoted takes can be loaded back without regeneration');
assert.match(witness, /exportReferenceMode/, 'live witness records requested export reference mode in report evidence');
assert.match(witness, /sourceModeAfterExport/, 'live witness records source mode after export to catch failed restoration');
assert.match(witness, /takeShelf/, 'live witness records the motion take shelf after generation');
assert.match(witness, /selectedTake/, 'live witness records the selected take in current-view export evidence');
assert.match(witness, /motion take shelf did not select generated take/, 'live witness rejects missing generated-take selection');
assert.match(witness, /current-view export did not record selected take/, 'live witness rejects exports without selected take evidence');
assert.match(witness, /sourceGhostAtExportStart/, 'live witness records source ghost visibility at current-view export start');
assert.match(witness, /source mode overlay did not produce x-ray source ghost evidence/, 'live witness rejects overlay mode without x-ray overlay evidence');
assert.match(witness, /source ghost overlay display bounds are not credible/, 'live witness rejects overlay ghosts that collapse into an illegible display span');
assert.match(witness, /--overlay-size/, 'live witness can drive the overlay-size control');
assert.match(witness, /source ghost overlay size did not reach requested multiplier/, 'live witness rejects stale or ignored overlay size controls');
assert.match(witness, /sourceFrameTotal/, 'live witness records original source animation frame totals in frame evidence');
assert.match(witness, /actorGrounding/, 'live witness records grounded-display evidence for generated temporal actors');
assert.match(witness, /actorRawRoot/, 'live witness records raw source root beside grounded display root');
assert.match(witness, /actorSourceVerticalPolicy/, 'live witness records the source vertical display policy');
assert.match(witness, /sheetFrameLabel/, 'live witness contact-sheet labels expose sheet frame denominator');
assert.match(witness, /sourceFrameLabel/, 'live witness contact-sheet labels expose source frame denominator');
assert.match(witness, /contact-sheet\.html/, 'live witness composes large visual smokes through a file-backed contact sheet');
assert.match(witness, /pathToFileURL/, 'live witness loads the local contact sheet by file URL instead of base64 eval payloads');
assert.match(witness, /contact sheet navigation did not settle/, 'live witness rejects stale app-page evidence before capturing the contact sheet');
{
  const contactSheetBlock = witness.match(/async function composeFilmstrip[\s\S]*?return \{[\s\S]*?path: filmstripPath,/)?.[0] || '';
  const navigateIndex = contactSheetBlock.indexOf("Page.navigate', { url: contactSheetUrl }");
  const metricsIndex = contactSheetBlock.indexOf("Emulation.setDeviceMetricsOverride");
  assert.ok(navigateIndex >= 0 && metricsIndex >= 0, 'live witness contact-sheet compositor must navigate and resize explicitly');
  assert.ok(
    navigateIndex < metricsIndex,
    'live witness must navigate off the live WebGPU app before resizing viewport to full contact-sheet dimensions',
  );
}
assert.match(witness, /pngDimensions/, 'live witness derives contact-sheet crop from captured PNG dimensions');
assert.match(witness, /Emulation\.setDeviceMetricsOverride/, 'live witness sizes the browser viewport to the complete generated contact sheet');
assert.doesNotMatch(witness, /screenshotDataUrl:\s*frame\.screenshotDataUrl/, 'live witness filmstrip composition must not send every captured frame through Runtime.evaluate');
assert.match(witness, /exportTray/, 'live witness records the motion panel export tray after current-view export');
assert.match(witness, /Page\.captureScreenshot/, 'live witness captures the operator-facing browser viewport');
assert.match(witness, /'about:blank'/, 'live witness starts from about:blank so console capture is enabled before app navigation');
assert.match(witness, /Page\.navigate/, 'live witness navigates after CDP Runtime and Log capture are enabled');
assert.match(witness, /Runtime\.exceptionThrown/, 'live witness records early runtime exceptions such as module import failures');
assert.match(witness, /Runtime\.consoleAPICalled/, 'live witness records early console calls before route preflight');
assert.match(witness, /consoleEvents/, 'live witness includes captured console events in durable reports');
assert.match(witness, /consoleFailureEvents/, 'live witness promotes browser console exceptions/errors into witness failures');
assert.match(witness, /browser console produced/, 'live witness rejects success closeout when the browser route throws');
assert.match(witness, /writeReport\(\{\s*ok: false/s, 'live witness writes a durable failure report');
assert.doesNotMatch(witness, /Math\.min\([^)]*frameCount/, 'live witness must not silently cap requested frame count');
