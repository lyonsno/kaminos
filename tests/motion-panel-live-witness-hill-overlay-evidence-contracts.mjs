import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const evidenceModuleUrl = new URL('../motion-panel-live-witness-evidence.mjs', import.meta.url);

assert.ok(
  existsSync(evidenceModuleUrl),
  'live witness evidence gate helper missing: route-cost overlay requests must fail loud on stale/default effective evidence',
);

const { assertHillRouteOverlayEvidence } = await import(evidenceModuleUrl);

const validEvidence = {
  schema: 'kaminos.motion-panel-live-hill-affordance-route.v0',
  pathWorldRouteCostProfile: { id: 'ridge-runner' },
  terrainOverlayLegend: {
    mode: 'route-cost',
    profileSensitive: true,
    normalization: {
      method: 'profile-quantile-range-v0',
      costProfile: 'ridge-runner',
    },
    overlayColorFingerprint: 'fnv1a-deadbeef',
  },
};

assert.doesNotThrow(() => assertHillRouteOverlayEvidence(validEvidence, {
  hillTerrainOverlay: 'route-cost',
  hillRouteProfile: 'ridge-runner',
}), 'valid route-cost evidence should satisfy the live witness overlay gate');

assert.throws(
  () => assertHillRouteOverlayEvidence({ ...validEvidence, terrainOverlayLegend: null }, {
    hillTerrainOverlay: 'route-cost',
    hillRouteProfile: 'ridge-runner',
  }),
  /route-cost overlay evidence missing terrainOverlayLegend/,
  'live witness rejects missing route-cost overlay legend instead of returning nullable evidence',
);

assert.throws(
  () => assertHillRouteOverlayEvidence({
    ...validEvidence,
    terrainOverlayLegend: { ...validEvidence.terrainOverlayLegend, mode: 'semantic-styles' },
  }, {
    hillTerrainOverlay: 'route-cost',
    hillRouteProfile: 'ridge-runner',
  }),
  /requested route-cost overlay but effective overlay is semantic-styles/,
  'live witness rejects stale/default overlay mode evidence',
);

assert.throws(
  () => assertHillRouteOverlayEvidence({
    ...validEvidence,
    pathWorldRouteCostProfile: { id: 'meadow' },
  }, {
    hillTerrainOverlay: 'route-cost',
    hillRouteProfile: 'ridge-runner',
  }),
  /requested Hill route profile ridge-runner but effective route profile is meadow/,
  'live witness rejects stale/default route profile evidence',
);

assert.throws(
  () => assertHillRouteOverlayEvidence({
    ...validEvidence,
    terrainOverlayLegend: {
      ...validEvidence.terrainOverlayLegend,
      normalization: { ...validEvidence.terrainOverlayLegend.normalization, costProfile: 'meadow' },
    },
  }, {
    hillTerrainOverlay: 'route-cost',
    hillRouteProfile: 'ridge-runner',
  }),
  /requested Hill route profile ridge-runner but route-cost normalization profile is meadow/,
  'live witness rejects route-cost normalization from the wrong profile',
);

assert.throws(
  () => assertHillRouteOverlayEvidence({
    ...validEvidence,
    terrainOverlayLegend: { ...validEvidence.terrainOverlayLegend, overlayColorFingerprint: null },
  }, {
    hillTerrainOverlay: 'route-cost',
    hillRouteProfile: 'ridge-runner',
  }),
  /route-cost overlay evidence missing overlayColorFingerprint/,
  'live witness rejects missing color fingerprint for route-cost overlay evidence',
);

assert.match(
  index,
  /normalization\?\.method === 'profile-quantile-range-v0'/,
  'route-cost scalar fallback must branch on the normalization argument, not the helper function name',
);
