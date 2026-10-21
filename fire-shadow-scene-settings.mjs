import {validateShadowQuality} from './fire-shadow-quality.mjs';
import {validateShadowComparison,validateShadowSampling} from './fire-shadow-sampling.mjs';
import {validateSourceQuadrature} from './fire-source-quadrature.mjs';
import {validateCasterLevel} from './fire-shadow-casters.mjs';
import {smokeShadowPlan} from './fire-smoke-shadow.mjs';

const prefix='volume_light_field_hybrid_';
export function readFireShadowSceneSettings(params) {
  const number=(key,fallback)=>Number(params.get(prefix+key)??fallback);
  const surface=params.get(prefix+'surface_enabled');
  if(surface!==null&&!['0','1'].includes(surface))throw Error('surface enabled must be 0 or 1');
  const quality=validateShadowQuality({resolution:number('shadow_resolution',256),blockerSamples:number('blocker_samples',9),filterSamples:number('filter_samples',16)});
  const comparison=validateShadowComparison({implementation:params.get(prefix+'shadow_implementation')??'shared',grain:params.get(prefix+'shadow_grain')??'ordered',worldCellSize:number('shadow_world_cell_size',0.02)});
  const points=number('points',4),pointSampling=params.get(prefix+'point_sampling')??'all';
  validateSourceQuadrature(points,pointSampling);
  const smoke={};
  const smokeFilter=params.get(prefix+'smoke_shadow_filter');
  if(smokeFilter!==null){
    if(!['0','1'].includes(smokeFilter))throw Error('smoke shadow filter must be 0 or 1');
    smoke.smokeShadowFilter=smokeFilter==='1';
  }
  if(params.has(prefix+'smoke_shadow_steps')||params.has(prefix+'smoke_shadow_resolution')){
    smoke.smokeShadowSteps=number('smoke_shadow_steps',0);smoke.smokeShadowResolution=number('smoke_shadow_resolution',16);
    if(!Number.isSafeInteger(smoke.smokeShadowSteps)||smoke.smokeShadowSteps<0)throw Error('smoke shadow steps must be nonnegative integer');
    smokeShadowPlan({steps:Math.max(1,smoke.smokeShadowSteps),resolution:smoke.smokeShadowResolution,count:points});
  }
  const sampling=validateShadowSampling(params.get(prefix+'shadow_sampling')??'fixed');
  const softness=number('shadow_softness',0);
  if(!Number.isFinite(softness)||softness<0)throw Error('shadow softness must be finite and nonnegative');
  return {pointCount:points,pointSampling,shadowResolution:quality.resolution,blockerSamples:quality.blockerSamples,filterSamples:quality.filterSamples,shadowSampling:sampling,shadowSoftness:softness,shadowComparison:comparison,...smoke,...(surface===null?{}:{surfaceEnabled:surface==='1'}),...(params.has(prefix+'caster_level')?{shadowCasterLevel:validateCasterLevel(params.get(prefix+'caster_level'))}:{})};
}

export function fireShadowSceneRoute(state) {
  if(!state?.shadowSampling)return {};
  const values={...(state.smokeShadowSteps===undefined?{}:{smoke_shadow_steps:state.smokeShadowSteps,smoke_shadow_resolution:state.smokeShadowResolution}),...(state.surfaceEnabled===undefined?{}:{surface_enabled:state.surfaceEnabled?'1':'0'}),points:state.pointCount,point_sampling:state.pointSampling,shadow_resolution:state.shadowResolution,
    blocker_samples:state.blockerSamples,filter_samples:state.filterSamples,shadow_sampling:state.shadowSampling,
    shadow_softness:state.shadowSoftness,shadow_implementation:state.shadowImplementation,
    shadow_grain:state.shadowGrain,shadow_world_cell_size:state.shadowWorldCellSize,...(state.shadowCasterLevel===undefined?{}:{caster_level:validateCasterLevel(state.shadowCasterLevel)})};
  const route=Object.fromEntries(Object.entries(values).map(([key,value])=>[prefix+key,String(value)]));
  if(state.smokeShadowFilter!==undefined){
    if(typeof state.smokeShadowFilter!=='boolean')throw Error('smoke shadow filter must be boolean');
    route[prefix+'smoke_shadow_filter']=state.smokeShadowFilter?'1':'0';
  }
  readFireShadowSceneSettings(new URLSearchParams(route));
  return route;
}
