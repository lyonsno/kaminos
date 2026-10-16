// kaminos-test: node
import assert from 'node:assert/strict';
import {readFireShadowSceneSettings,fireShadowSceneRoute} from '../fire-shadow-scene-settings.mjs';
const state={pointCount:4,pointSampling:'paired',shadowResolution:36,blockerSamples:4,filterSamples:2,
  shadowSampling:'complementary',shadowSoftness:1.7,shadowImplementation:'shared',shadowGrain:'world',shadowWorldCellSize:.031};
const route=fireShadowSceneRoute(state),restored=readFireShadowSceneSettings(new URLSearchParams(route));
assert.deepEqual(restored,{pointCount:4,pointSampling:'paired',shadowResolution:36,blockerSamples:4,filterSamples:2,
  shadowSampling:'complementary',shadowSoftness:1.7,shadowComparison:{implementation:'shared',grain:'world',worldCellSize:.031}});
assert.equal(readFireShadowSceneSettings(new URLSearchParams()).shadowComparison.worldCellSize,.02,'historical default unchanged');
assert.deepEqual(fireShadowSceneRoute(null),{});
for(const [key,value] of [['points','3'],['filter_samples','0'],['shadow_grain','bad'],['shadow_world_cell_size','0'],['shadow_softness','NaN']])
  assert.throws(()=>readFireShadowSceneSettings(new URLSearchParams({...route,['volume_light_field_hybrid_'+key]:value})));
console.log('PASS scene lighting settings preserve actual quality, quadrature, grain and softness');
