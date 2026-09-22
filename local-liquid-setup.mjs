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
  if(value.source.radius<=0)throw Error('Invalid local liquid source.radius');
  if(value.source.strength<0)throw Error('Invalid local liquid source.strength');
  if(value.source.rate<0)throw Error('Invalid local liquid source.rate');
  return structuredClone(value);
}
export function localLiquidInletPacket(setup,generation) {
  const checked=normalizeLocalLiquidSetup(setup),s=checked.source;
  return {packet_id:`kaminos-authored-liquid-${generation}`,route_identity:'kaminos-authored-liquid-source-v0',
    simulation_authority:'live_simulation',authority:{simulation_safe:true,stale:false},
    emitters:[{id:'authored-source',active:s.rate>0,emission_state:s.rate>0?'jet':'off',
      origin_world:[s.x,s.y,s.z],aim_world:[0,-.25,1],radius:s.radius,strength:s.strength,
      source_flux_particles_per_second:s.rate,active_budget_particles:checked.particleCount,residence_seconds:20}]};
}
