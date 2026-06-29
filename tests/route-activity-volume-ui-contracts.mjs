import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const index = readFileSync(join(root, 'index.html'), 'utf8');
const witness = readFileSync(join(root, 'pipeline-ui-witness.mjs'), 'utf8');

assert.match(index, /KAMINOS_ROUTE_ACTIVITY_VOLUME_ADAPTER_SCHEMA_BROWSER/, 'browser must name the route activity volume adapter schema');
assert.match(index, /deriveBrowserRouteActivityVolumeAdapter/, 'browser must derive volume adapter payloads from route activity');
assert.match(index, /applyRouteActivityVolumeAdapter/, 'browser must apply route activity volume adapter payloads to the volume prototype');
assert.match(index, /renderRouteActivityVolumePreview/, 'browser must render an actual volume readback preview for the route adapter');
assert.match(index, /route-activity-volume-preview-canvas/, 'browser must expose a route activity volume preview canvas');
assert.match(index, /webgpu-sample-frame-readback/, 'route volume preview must identify WebGPU sampleFrame readback as its source');
assert.match(index, /window\.__kaminosRouteActivityVolumeAdapterState/, 'browser must expose route activity volume adapter witness state');
assert.match(index, /data-route-volume-adapter-schema/, 'route kiln tile must expose volume adapter schema');
assert.match(index, /data-route-volume-adapter-mode/, 'route kiln tile must expose volume adapter mode');
assert.match(index, /data-route-volume-activation-state/, 'route kiln tile must expose volume activation state');
assert.match(index, /data-route-volume-allows-burn/, 'route kiln tile must expose volumetric burn authority');
assert.match(index, /route_activity_false_authority_blocked_volume/, 'browser adapter must block volume on route false-authority violations');
assert.match(index, /kiln_route_activity_volume_witness/, 'URL witness route must activate the route-activity volume surface');
assert.match(witness, /route-activity-volume-adapter/, 'Pipeline UI witness must include a route activity volume adapter scenario');
assert.match(witness, /__kaminosRouteActivityVolumeAdapterState/, 'Pipeline UI witness must inspect the route activity volume adapter state');
assert.match(witness, /data-route-volume-adapter-mode/, 'Pipeline UI witness must inspect route volume adapter DOM authority');
assert.match(witness, /route-activity-volume-preview-canvas/, 'Pipeline UI witness must inspect the route volume preview canvas');
