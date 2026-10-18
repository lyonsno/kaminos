import {validateShadowQuality} from './fire-shadow-quality.mjs';
import {validateShadowComparison,validateShadowSampling} from './fire-shadow-sampling.mjs';
import {validateSourceQuadrature} from './fire-source-quadrature.mjs';
import {validateCasterLevel} from './fire-shadow-casters.mjs';

const prefix='volume_light_field_hybrid_';
export function readFireShadowSceneSettings(params) {
  const number=(key,fallback)=>Number(params.get(prefix+key)??fallback);
  const quality=validateShadowQuality({resolution:number('shadow_resolution',256),blockerSamples:number('blocker_samples',9),filterSamples:number('filter_samples',16)});
  const comparison=validateShadowComparison({implementation:params.get(prefix+'shadow_implementation')??'shared',grain:params.get(prefix+'shadow_grain')??'ordered',worldCellSize:number('shadow_world_cell_size',0.02)});
  const points=number('points',4),pointSampling=params.get(prefix+'point_sampling')??'all';
  validateSourceQuadrature(points,pointSampling);
  const sampling=validateShadowSampling(params.get(prefix+'shadow_sampling')??'fixed');
  const softness=number('shadow_softness',0);
  if(!Number.isFinite(softness)||softness<0)throw Error('shadow softness must be finite and nonnegative');
  return {pointCount:points,pointSampling,shadowResolution:quality.resolution,blockerSamples:quality.blockerSamples,filterSamples:quality.filterSamples,shadowSampling:sampling,shadowSoftness:softness,shadowComparison:comparison,...(params.has(prefix+'caster_level')?{shadowCasterLevel:validateCasterLevel(params.get(prefix+'caster_level'))}:{})};
}

export function fireShadowSceneRoute(state) {
  if(!state?.shadowSampling)return {};
  const values={points:state.pointCount,point_sampling:state.pointSampling,shadow_resolution:state.shadowResolution,
    blocker_samples:state.blockerSamples,filter_samples:state.filterSamples,shadow_sampling:state.shadowSampling,
    shadow_softness:state.shadowSoftness,shadow_implementation:state.shadowImplementation,
    shadow_grain:state.shadowGrain,shadow_world_cell_size:state.shadowWorldCellSize,...(state.shadowCasterLevel===undefined?{}:{caster_level:validateCasterLevel(state.shadowCasterLevel)})};
  const route=Object.fromEntries(Object.entries(values).map(([key,value])=>[prefix+key,String(value)]));
  readFireShadowSceneSettings(new URLSearchParams(route));
  return route;
}
