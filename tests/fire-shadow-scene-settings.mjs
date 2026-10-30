// kaminos-test: node
import assert from 'node:assert/strict';
import {readFireShadowSceneSettings,fireShadowSceneRoute} from '../fire-shadow-scene-settings.mjs';
const state={pointCount:4,pointSampling:'paired',shadowResolution:36,blockerSamples:4,filterSamples:2,
  shadowSampling:'complementary',shadowSoftness:1.7,shadowImplementation:'shared',shadowGrain:'world',shadowWorldCellSize:.031};
const route=fireShadowSceneRoute(state),restored=readFireShadowSceneSettings(new URLSearchParams(route));
assert.deepEqual(restored,{pointCount:4,pointSampling:'paired',shadowResolution:36,blockerSamples:4,filterSamples:2,
  shadowSampling:'complementary',shadowSoftness:1.7,shadowComparison:{implementation:'shared',grain:'world',worldCellSize:.031}});
assert.equal(readFireShadowSceneSettings(new URLSearchParams()).shadowComparison.worldCellSize,.02,'historical default unchanged');
assert.equal(readFireShadowSceneSettings(new URLSearchParams(fireShadowSceneRoute({...state,shadowCasterLevel:'10k'}))).shadowCasterLevel,'10k','caster choice round trips through the authored lighting route');
assert.throws(()=>readFireShadowSceneSettings(new URLSearchParams('volume_light_field_hybrid_caster_level=500')),/caster level/);
assert.deepEqual(fireShadowSceneRoute(null),{});
const smoke=readFireShadowSceneSettings(new URLSearchParams(fireShadowSceneRoute({...state,smokeShadowSteps:12,smokeShadowResolution:16})));
assert.equal(smoke.smokeShadowSteps,12);assert.equal(smoke.smokeShadowResolution,16);
assert.equal(readFireShadowSceneSettings(new URLSearchParams(fireShadowSceneRoute({...state,smokeShadowSteps:12,smokeShadowResolution:16,smokeShadowFilter:true}))).smokeShadowFilter,true,'direction filter survives scene save/reopen');
assert.equal(readFireShadowSceneSettings(new URLSearchParams('volume_light_field_hybrid_smoke_shadow_filter=0')).smokeShadowFilter,false);
assert.throws(()=>readFireShadowSceneSettings(new URLSearchParams('volume_light_field_hybrid_smoke_shadow_filter=yes')),/smoke shadow filter/);
assert.throws(()=>readFireShadowSceneSettings(new URLSearchParams('volume_light_field_hybrid_smoke_shadow_steps=-1')),/smoke shadow/);
assert.equal(readFireShadowSceneSettings(new URLSearchParams(fireShadowSceneRoute({...state,surfaceEnabled:false}))).surfaceEnabled,false,'off persists through scene restore');
assert.equal(readFireShadowSceneSettings(new URLSearchParams(fireShadowSceneRoute({...state,shadowGrain:'screen-animated'}))).shadowComparison.grain,'screen-animated','animated grain survives authored scene serialization');
for(const [key,value] of [['points','0'],['filter_samples','0'],['shadow_grain','bad'],['shadow_world_cell_size','0'],['shadow_softness','NaN']])
  assert.throws(()=>readFireShadowSceneSettings(new URLSearchParams({...route,['volume_light_field_hybrid_'+key]:value})));
console.log('PASS scene lighting settings preserve actual quality, quadrature, grain and softness');

for(const pointCount of [6,8]){const restored=readFireShadowSceneSettings(new URLSearchParams(fireShadowSceneRoute({...state,pointCount,pointSampling:'all',shadowEdgeFilter:true})));assert.equal(restored.pointCount,pointCount);assert.equal(restored.shadowEdgeFilter,true);}

const lightQuality=readFireShadowSceneSettings(new URLSearchParams(fireShadowSceneRoute({...state,volumeGrid:32,directions:96})));
assert.equal(lightQuality.volumeGrid,32);assert.equal(lightQuality.directions,96);

assert.equal(readFireShadowSceneSettings(new URLSearchParams(fireShadowSceneRoute({...state,angularPattern:'regions'}))).angularPattern,'regions');
assert.throws(()=>readFireShadowSceneSettings(new URLSearchParams('volume_light_field_hybrid_light_pattern=typo')),/angular pattern/);

const angularRoute=fireShadowSceneRoute({...state,smokeShadowFilter:true,smokeShadowFilterAngle:8.5,smokeShadowFilterTaps:5});
const angularReload=readFireShadowSceneSettings(new URLSearchParams(angularRoute));
assert.equal(angularReload.smokeShadowFilterAngle,8.5,'angular blur width must survive scene roundtrip');
assert.equal(angularReload.smokeShadowFilterTaps,5,'filter work must survive scene roundtrip');

const budgetRoute=new URLSearchParams({volume_light_field_hybrid_points:'8',volume_light_field_hybrid_point_evaluation_budget:'4'});
assert.equal(readFireShadowSceneSettings(budgetRoute).pointEvaluationBudget,4,'saved receiver budget must be distinct from captured point count');

assert.equal(readFireShadowSceneSettings(new URLSearchParams({volume_light_field_hybrid_smoke_shadow_medium_grid:'16'})).smokeShadowMediumResolution,16);
assert.throws(()=>readFireShadowSceneSettings(new URLSearchParams({volume_light_field_hybrid_smoke_shadow_medium_grid:'-1'})),/resolution/);

assert.equal(readFireShadowSceneSettings(new URLSearchParams(fireShadowSceneRoute({...state,angularPattern:"importance"}))).angularPattern,"importance");
