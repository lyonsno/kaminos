export function inspectStoneThickness(state, expected={}) {
  const errors=[];
  if(state?.route!=='kaminos.structural-material.imported-stone-thickness.webgpu.v0'||state.phase!=='interactive'||state.failure||state.failures?.length)errors.push('Wrong, failed or missing imported-stone route');
  if(state?.identity?.backend!=='webgpu'||state.identity.adapterFallback!==false||state.identity.isFallbackAdapter!==false)errors.push('Native GPU identity absent or fallback');
  if(!expected.preparedSha256||state?.preparedSha256!==expected.preparedSha256||state.sourceSha256!==expected.sourceSha256)errors.push('Prepared or visual source substituted');
  if(!Array.isArray(state?.specimens)||state.specimens.length!==2)return[...errors,'Incomplete paired specimens'];
  for(const [i,s] of state.specimens.entries()){
    if(s.preparation?.size?.[1]!==[.3,.6][i]||s.state?.bodies?.length!==[16,32][i]||s.normalMapped!==true||s.state?.backend!=='webgpu-avbd')errors.push(`Specimen ${i} geometry/material route substituted`);
    if(s.state?.config?.strength!==expected.strength)errors.push(`Specimen ${i} requested cohesion shadowed`);
    if(!Array.isArray(s.rendererPoses)||s.rendererPoses.length!==s.state?.bodies?.length||!Array.isArray(s.offset))errors.push(`Specimen ${i} render inventory incomplete`);
    else if(!s.rendererPoses.every((p,index)=>p.index===index&&p.position?.length===3&&p.quaternion?.length===4&&p.position.every((v,a)=>Number.isFinite(v)&&Math.abs(v-s.state.bodies[index].position[['x','y','z'][a]]-s.offset[a])<1e-6)&&p.quaternion.every((v,a)=>Number.isFinite(v)&&Math.abs(v-s.state.bodies[index].quaternion[['x','y','z','w'][a]])<1e-6)))errors.push(`Specimen ${i} render/state mismatch`);
  }
  if(JSON.stringify(state.specimens[0].state?.config)!==JSON.stringify(state.specimens[1].state?.config))errors.push('Material or fixture differs between specimens');
  return errors;
}
