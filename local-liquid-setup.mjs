export const LOCAL_LIQUID_SCHEMA = 'kaminos.local-liquid-setup.v0';
export function defaultLocalLiquidSetup() {
  return {schema:LOCAL_LIQUID_SCHEMA,support:'retained_analytical_basin',particleCount:49152,densityIterations:3,
    source:{x:-.35,y:.4,z:-1.65,radius:.08,strength:1.15,rate:1200}};
}
export function normalizeLocalLiquidSetup(value) {
  if(value==null)return null;
  if(value.schema!==LOCAL_LIQUID_SCHEMA)throw Error('Unsupported local liquid schema');
  if(value.support!=='retained_analytical_basin')throw Error('Unsupported local liquid support');
  for(const key of ['particleCount','densityIterations']) {
    if(!Number.isSafeInteger(value[key]) || value[key]<1)throw Error(`Invalid local liquid ${key}`);
  }
  for(const key of ['x','y','z','radius','strength','rate']) {
    if(!Number.isFinite(value.source?.[key]))throw Error(`Invalid local liquid source.${key}`);
  }
  // These are the recovered inlet's effective limits, not narrower UI caps.
  if(value.source.radius<.035 || value.source.radius>.18)throw Error('Local liquid source.radius must be between 0.035 and 0.18');
  if(value.source.strength<.25 || value.source.strength>2.6)throw Error('Local liquid source.strength must be between 0.25 and 2.6');
  if(value.source.rate<0)throw Error('Invalid local liquid source.rate');
  return structuredClone(value);
}
export function localLiquidInletPacket(setup,generation) {
  const checked=normalizeLocalLiquidSetup(setup),s=checked.source;
  return {packet_id:`kaminos-authored-liquid-${generation}`,route_identity:'kaminos-authored-liquid-source-v0',
    simulation_authority:'live_simulation',authority:{simulation_safe:true,stale:false},
    emitters:[{id:'authored-source',active:s.rate>0,emission_state:s.rate>0?'jet':'off',
      origin_world:[s.x,s.y,s.z],aim_world:[0,-.25,1],radius:s.radius/1.45,strength:s.strength/1.35,
      source_flux_particles_per_second:s.rate,active_budget_particles:checked.particleCount,residence_seconds:20}]};
}
