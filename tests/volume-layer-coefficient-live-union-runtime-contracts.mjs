import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const core = await readFile(new URL('../volume-core.js', import.meta.url), 'utf8');

assert.match(
  core,
  /import \{[\s\S]*createLayerCoefficientLiveUnionGpuResources[\s\S]*loadLayerCoefficientLiveUnionOverlay[\s\S]*\} from '\.\/volume-layer-coefficient-live-union-overlay\.mjs'/,
  'live renderer imports both checksum-bound overlay runtime functions from the owned module',
);
assert.match(core, /@group\(0\) @binding\(10\) var<storage, read> boundarySplatLiveUnionCoefficients: array<vec4<f32>>/, 'render shader binds compact two-vec4 coefficient rows');
assert.match(core, /@group\(0\) @binding\(11\) var<storage, read> boundarySplatLiveUnionLookup: array<u32>/, 'render shader binds the dense native-cell row-plus-one lookup');
assert.match(core, /splat\.nativeCellMembership\.x[\s\S]*boundarySplatLiveUnionLookup\[nativeCellIndex\]/, 'vertex lookup is keyed only by the compacted candidate native-cell identity');
assert.match(core, /rowPlusOne\s*>\s*0u[\s\S]*coefficientOffset\s*=\s*\(rowPlusOne\s*-\s*1u\)\s*\*\s*2u/, 'zero remains the missing-row sentinel and compact coefficient rows use two vec4 values');
assert.match(core, /ridgeOptical\s*=\s*boundarySplatLiveUnionCoefficients\[coefficientOffset\][\s\S]*nonRidgeOptical\s*=\s*boundarySplatLiveUnionCoefficients\[coefficientOffset\s*\+\s*1u\]/, 'learned Ridge and Non-Ridge RGB emission/extinction remain separate through rasterization');
assert.match(core, /sharedTotalExtinctionCoefficient\s*=\s*in\.ridgeOptical\.w\s*\+\s*in\.nonRidgeOptical\.w/, 'learned layers retain one shared total extinction recurrence');
assert.match(core, /sharedEmissionCoefficient\s*=\s*in\.ridgeOptical\.rgb\s*\+\s*in\.nonRidgeOptical\.rgb/, 'learned RGB emission is combined only after layer-specific lookup');
assert.match(core, /async function loadBoundarySplatLiveUnionCoefficientOverlay/, 'runtime exposes an explicit asynchronous load boundary');
assert.match(core, /async function auditBoundarySplatLiveUnionCoefficientOverlayPopulation/, 'runtime exposes an exact live-population activation gate');
assert.match(core, /stableNativeCellIdSha256[\s\S]*admissionIndexSha256[\s\S]*lookupMissCount[\s\S]*lookupExtraCount/, 'activation binds stable union identity and rejects missing or extra lookup rows');
assert.match(core, /boundarySplatLiveUnionOverlayRequestedIdentity[\s\S]*boundarySplatLiveUnionOverlayEffectiveIdentity[\s\S]*boundarySplatLiveUnionOverlayFallbackReason/, 'debug state separates requested, effective, and failed overlay authority');
assert.match(core, /loadBoundarySplatLiveUnionCoefficientOverlay,[\s\S]*auditBoundarySplatLiveUnionCoefficientOverlayPopulation,[\s\S]*clearBoundarySplatLiveUnionCoefficientOverlay/, 'the witness API can load, audit, and clear one overlay without UI coupling');

console.log('volume layer coefficient live union runtime contracts passed');
