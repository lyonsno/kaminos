const selfRead='  var velocity = (position - particle.position.xyz) / params.dt;';
const neighborRead='((particles[neighborIndex].predicted.xyz - particles[neighborIndex].position.xyz) / params.dt)';
/** Immutable post-projection input for PBF; published paper-damped input for IPBF. */
export function composeFingerFluidVelocityReads(source,pressureSolver){
 if(!['pbf','ipbf'].includes(pressureSolver))throw Error('Unsupported pressure solver velocity composition');
 if(!source.includes(selfRead)||!source.includes(neighborRead))throw Error('Pressure velocity read anchor missing');
 if(pressureSolver==='pbf')return source;
 return source.replace(selfRead,'  var velocity = particle.delta.xyz;').replace(neighborRead,'particles[neighborIndex].velocity.xyz');
}
