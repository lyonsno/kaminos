import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const liveWitness = readFileSync(new URL('../motion-panel-live-witness.mjs', import.meta.url), 'utf8');

assert.match(index, /decodeHillMotionAffordancePacket/, 'browser imports the Hill motion affordance decoder');
assert.match(index, /createMotionRoutePlanFromTerrainAffordance/, 'browser imports the Hill terrain route planner');
assert.match(index, /function createMotionPanelHillAffordancePathWorld/, 'browser can convert a Hill route plan into a Path World route');
assert.match(index, /window\.kaminosPreviewHillMotionAffordanceRoutePlan/, 'browser exposes a scriptable Hill route preview entrypoint');
assert.match(index, /previewHillMotionAffordanceRouteFromParams/, 'browser can auto-load a Hill route from smoke URL params');
assert.match(index, /kaminos_hill_affordance_packet/, 'browser supports a Hill packet URL param for operator smoke links');
assert.match(index, /kaminos_hill_affordance_data/, 'browser supports a Hill data URL param for operator smoke links');
assert.match(index, /terrain-affordance-route-plan/, 'Path World evidence names terrain affordance route authority');
assert.match(index, /hill-motion-affordance-grid/, 'Path World evidence preserves Hill grid route source identity');
assert.match(index, /pathWorldRoutePlan/, 'Path World debug exposes the route plan evidence');

assert.match(liveWitness, /--hill-affordance-packet/, 'live witness accepts a Hill affordance packet path');
assert.match(liveWitness, /--hill-affordance-data/, 'live witness accepts a Hill affordance data path');
assert.match(liveWitness, /kaminosPreviewHillMotionAffordanceRoutePlan/, 'live witness can install the Hill route plan before frame capture');
assert.match(liveWitness, /pathWorldRoutePlan/, 'live witness report carries Hill route plan evidence');
