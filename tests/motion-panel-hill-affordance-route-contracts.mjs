import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const liveWitness = readFileSync(new URL('../motion-panel-live-witness.mjs', import.meta.url), 'utf8');

assert.match(index, /decodeHillMotionAffordancePacket/, 'browser imports the Hill motion affordance decoder');
assert.match(index, /createMotionRoutePlanFromTerrainAffordance/, 'browser imports the Hill terrain route planner');
assert.match(index, /function createMotionPanelHillAffordancePathWorld/, 'browser can convert a Hill route plan into a Path World route');
assert.match(index, /function createMotionPanelHillTerrainSurface/, 'browser can create a Hill support-frame terrain surface');
assert.match(index, /function createMotionPanelHillNativePathWorld/, 'browser can mount a Hill route and actor in the Hill world frame');
assert.match(index, /window\.kaminosPreviewHillMotionAffordanceRoutePlan/, 'browser exposes a scriptable Hill route preview entrypoint');
assert.match(index, /previewHillMotionAffordanceRouteFromParams/, 'browser can auto-load a Hill route from smoke URL params');
assert.match(index, /kaminos_hill_affordance_packet/, 'browser supports a Hill packet URL param for operator smoke links');
assert.match(index, /kaminos_hill_affordance_data/, 'browser supports a Hill data URL param for operator smoke links');
assert.match(index, /terrain-affordance-route-plan/, 'Path World evidence names terrain affordance route authority');
assert.match(index, /hill-motion-affordance-grid/, 'Path World evidence preserves Hill grid route source identity');
assert.match(index, /pathWorldRoutePlan/, 'Path World debug exposes the route plan evidence');
assert.match(index, /hillTerrainSurface/, 'Path World debug exposes the mounted Hill terrain surface evidence');
assert.match(index, /hillTerrainFrame/, 'Path World debug preserves the Hill support-frame source identity');
assert.match(index, /hill-native-route-world/, 'Hill route smoke names the Hill-native route world instead of only the flat display projection');
assert.match(index, /function createMotionPanelHillTerrainCarrier/, 'browser separates Hill route grounding from generated expressive root motion');
assert.match(index, /hillTerrainCarrier/, 'actor/debug evidence exposes Hill terrain carrier grounding');
assert.match(index, /terrainCarrierRoot/, 'Hill carrier evidence records the authoritative terrain root');
assert.match(index, /expressiveRootOffset/, 'Hill carrier evidence records bounded generated-motion offset separately');
assert.match(index, /groundingAuthority:\s*'hill-terrain-carrier'/, 'Hill carrier evidence names terrain carrier as grounding authority');

assert.match(liveWitness, /--hill-affordance-packet/, 'live witness accepts a Hill affordance packet path');
assert.match(liveWitness, /--hill-affordance-data/, 'live witness accepts a Hill affordance data path');
assert.match(liveWitness, /kaminosPreviewHillMotionAffordanceRoutePlan/, 'live witness can install the Hill route plan before frame capture');
assert.match(liveWitness, /pathWorldRoutePlan/, 'live witness report carries Hill route plan evidence');
assert.match(liveWitness, /hillTerrainSurface/, 'live witness records Hill terrain surface evidence');
assert.match(liveWitness, /hillTerrainFrame/, 'live witness records Hill terrain frame evidence');
assert.match(liveWitness, /hillTerrainCarrier/, 'live witness records Hill terrain carrier evidence');
assert.match(liveWitness, /groundingAuthority/, 'live witness records carrier grounding authority');
