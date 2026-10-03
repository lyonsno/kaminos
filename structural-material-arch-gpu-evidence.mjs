export const conformanceChecks = ['falling body responds to gravity', 'box rests on floor, not through it',
  'hanging joint carries weight', 'finite joint reaction has force units', 'fixed joint retains captured relative rotation',
  'all body state is finite', 'native GPU produced no validation error', 'collision dispatch did not truncate'];

export function inspectGpuConformance(report) {
  const errors = [];
  if (report?.status !== 'passed' || report?.phase !== 'complete') errors.push('Conformance did not complete successfully');
  const identity = report?.identity;
  if (!identity || identity.backend !== 'webgpu' || identity.adapterFallback !== false ||
      /swiftshader|llvmpipe|software/i.test(JSON.stringify(identity))) errors.push('Native GPU route not established');
  if (identity?.engineRevision !== '96b043c88dc2a4af5367820caf1e1e9f458d5560') errors.push('Wrong engine revision');
  for (const name of conformanceChecks) if (!report?.checks?.some(item => item.name === name && item.passed === true)) errors.push(`Missing or failed: ${name}`);
  if (!Array.isArray(report?.errors) || report.errors.length) errors.push('GPU validation errors or missing diagnostics');
  if (!report?.samples?.['half-second']?.bodies?.length || !report?.samples?.['three-seconds']?.bodies?.length ||
      !Number.isFinite(report?.samples?.weightForce)) errors.push('Missing physical samples');
  return errors;
}

export function inspectGpuArchLoad(witness, expected = { layers:3, strength:80, timeStep:1/60, gripRadius:.55 }) {
  const errors=[],identity=witness?.identity,state=witness?.state;
  if(witness?.phase!=='interactive'||witness?.route!=='kaminos.structural-material.arch-gravity-collapse.webgpu-avbd.v0')errors.push('Wrong or failed arch route');
  if(identity?.backend!=='webgpu'||identity.adapterFallback!==false||identity.isFallbackAdapter!==false||/swiftshader|llvmpipe|software/i.test(JSON.stringify(identity)))errors.push('Native GPU identity is unverified');
  if(identity?.engineRevision!=='96b043c88dc2a4af5367820caf1e1e9f458d5560'||identity?.enginePatch!=='kaminos-fixed-joint-rest-relative-v1')errors.push('Wrong engine revision or angular repair');
  if(!Array.isArray(witness?.failures)||witness.failures.length)errors.push('Page failures or missing failure diagnostics');
  if(state?.backend!=='webgpu-avbd')errors.push('Wrong physical backend');
  for(const [key,value]of Object.entries(expected))if(state?.config?.[key]!==value)errors.push(`Effective ${key} differs from requested value`);
  const resident=state?.residency;
  if(resident?.bodyPose!=='gpu-authoritative'||resident?.connectivity!=='gpu-authoritative'||resident?.collision!=='gpu-avbd')errors.push('Physical authority is not GPU resident');
  if(!Number.isInteger(resident?.allPairsRequired)||!Number.isInteger(resident?.allPairsCapacity)||resident.allPairsCapacity<resident.allPairsRequired||resident.stats?.pairDispatchTruncated!==false)errors.push('Collision capacity or dispatch is unverified');
  const bodies=state?.bodies;
  if(!Array.isArray(bodies)||!bodies.length||!Number.isInteger(state?.step)||state.step<1)errors.push('Missing physical body readback');
  else{
    for(const [index,body]of bodies.entries()){
      const values=[body.mass,...Object.values(body.position??{}),...Object.values(body.quaternion??{}),...Object.values(body.velocity??{}),...Object.values(body.angularVelocity??{})];
      if(body.index!==index||values.length!==14||values.some(value=>!Number.isFinite(value))||body.mass<0||Math.abs(Object.values(body.quaternion??{}).reduce((sum,value)=>sum+value*value,0)-1)>.01)errors.push(`Invalid physical body ${index}`);
    }
    if(witness.rendererPoses?.length!==bodies.length||witness.rendererPoses.some(pose=>!bodies[pose.index]||!pose.position?.every((value,axis)=>value===bodies[pose.index].position[['x','y','z'][axis]])||!pose.quaternion?.every((value,axis)=>value===bodies[pose.index].quaternion[['x','y','z','w'][axis]])))errors.push('Display pose differs from physical readback');
  }
  if(!Array.isArray(state?.bonds)||state?.broken!==state.bonds.filter(bond=>!bond.alive).length)errors.push('Missing or inconsistent connectivity');
  return errors;
}
