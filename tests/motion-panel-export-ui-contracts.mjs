import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

assert.match(index, /id="motion-panel-export-view"/, 'motion panel exposes a current-view export button');
assert.match(index, /id="motion-panel-export-resolution"/, 'motion panel exposes an export resolution selector');
assert.match(index, /id="motion-panel-export-frames"/, 'motion panel exposes an export frame-count selector');
assert.match(index, /id="motion-panel-export-columns"/, 'motion panel exposes an export columns selector');
assert.match(index, /function motionPanelExportSettingsFromInputs/, 'motion panel reads export controls through a stable settings helper');
assert.match(index, /async function exportMotionPanelCurrentViewFilmstrip/, 'motion panel implements current-view filmstrip export');
assert.match(index, /window\.exportMotionPanelCurrentViewFilmstrip = exportMotionPanelCurrentViewFilmstrip/, 'current-view export is scriptable for smoke automation');
assert.match(index, /renderer\.domElement/, 'current-view export captures the existing renderer canvas');
assert.match(index, /camera\.position\.toArray/, 'current-view export records camera position evidence');
assert.match(index, /controls\.target\.toArray/, 'current-view export records controls target evidence');
assert.match(index, /window\.motionPanelCurrentViewCameraEvidence = motionPanelCurrentViewCameraEvidence/, 'current-view camera evidence is scriptable for smoke automation');
assert.match(index, /canvas\.toDataURL\('image\/png'\)/, 'current-view export captures the displayed WebGPU canvas pixels');
assert.match(index, /a\.download = `kaminos-motion-current-view/, 'current-view export downloads a shareable PNG');
assert.match(index, /document\.getElementById\('motion-panel-export-view'\)\?\.addEventListener\('click'/, 'export button is wired in route initialization');

const exportBlock = index.match(/async function exportMotionPanelCurrentViewFilmstrip[\s\S]*?window\.exportMotionPanelCurrentViewFilmstrip = exportMotionPanelCurrentViewFilmstrip;/)?.[0] || '';
assert.ok(exportBlock, 'export function block is discoverable');
assert.doesNotMatch(exportBlock, /frameMotionAgencyCamera\(/, 'current-view export must not reset or frame the camera');
assert.doesNotMatch(exportBlock, /createGeneratedPoseTemporalScene\(/, 'current-view export must not recreate the motion scene');
assert.doesNotMatch(index, /createImageBitmap\(/, 'current-view export must not use createImageBitmap on the WebGPU renderer canvas');
assert.doesNotMatch(exportBlock, /readRenderTargetPixelsAsync|new THREE\.RenderTarget/, 'current-view export must not use banding-prone WebGPU render-target readback');
