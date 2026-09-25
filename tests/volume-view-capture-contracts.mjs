import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

const requireSource = (pattern, message) => assert.ok(pattern.test(html), message);
requireSource(/id="volume-view-capture"/, 'Volume cockpit exposes a one-click view capture');
requireSource(/id="volume-view-restore"/, 'Volume cockpit exposes camera restore');
requireSource(/id="volume-view-restore-input"[^>]*accept="[^"]*json/, 'restore accepts a JSON view receipt');
requireSource(/id="volume-cockpit-layout-toolbar"[^>]*data-volume-basin-drive-ignore[^>]*data-volume-cockpit-layout-ui/, 'capture controls inherit exclusion from basin and cockpit layout inventories');
const toolbarStart = html.indexOf('id="volume-cockpit-layout-toolbar"');
const captureButton = html.indexOf('id="volume-view-capture"');
const rendererHeading = html.indexOf('<h2>Volume Renderer</h2>', toolbarStart);
assert.ok(toolbarStart >= 0 && captureButton > toolbarStart && captureButton < rendererHeading, 'capture controls remain in the top Volume toolbar');
requireSource(/async function captureVolumeViewEvidence\(/, 'capture has a named implementation');
requireSource(/sampleFrame\(\{\s*advanceSim:\s*false,\s*includeRgba:\s*true/, 'capture reads a renderer frame without advancing the simulation');
requireSource(/setSelectiveHeadLiveCapturePaused\(true\)/, 'capture holds the renderer loop during readback');
requireSource(/finally \{\s*controls\.enabled = controlsWereEnabled;\s*volumePrototype\.setSimulationPaused\(wasSimulationPaused\);\s*volumePrototype\.setSelectiveHeadLiveCapturePaused\(wasRenderPaused\);/s, 'capture restores the prior simulation, renderer, and camera-input state');
requireSource(/const rgba = frame\.image\?\.rgba/, 'capture uses the native sampled image payload');
requireSource(/kaminos\.volume-view-capture\.v0/, 'capture writes a versioned evidence receipt');
requireSource(/runtimeIdentityStatus/, 'view receipt distinguishes reported source identity from unverified');
requireSource(/runtimeIdentityFailure:\s*sourceIdentityFailure/, 'source lookup errors are stored under the captured receipt field');
requireSource(/function restoreVolumeViewEvidence\(/, 'view receipt can restore its camera');
requireSource(/receipt\.source\?\.presetId !== activePresetId/, 'restore rejects a view receipt from another basin');
requireSource(/pose\.fov <= 0 \|\| pose\.fov >= 180 \|\| pose\.near <= 0 \|\| pose\.far <= pose\.near \|\| pose\.zoom <= 0/, 'restore rejects invalid camera projection values');
requireSource(/volume-view-capture-status/, 'capture and restore report status in the cockpit');

process.stdout.write('volume view capture controls and frozen-frame evidence contract pass\n');
