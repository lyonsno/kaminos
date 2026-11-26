export const PARTICLE_COHORT_RECORD_WGSL = /* wgsl */`
struct ParticleCohortMember {slot: u32, generation: u32, weight: f32, pad: u32}
struct ParticleCohortSample {
  // Position and support use Fine coordinates. The output carries worldFromFine.
  positionAndAlive: vec4<f32>,
  intrinsicAndExtinction: vec4<f32>,
  // xyz is the base radius; w is the flow-alignment blend.
  radiusAndAlignment: vec4<f32>,
  // Birth pitch, packed orientation (yz), and acquired depth interval.
  shape: vec4<f32>,
  state: vec4<f32>,
}
`;

export const PARTICLE_COHORT_SAMPLE_WGSL = /* wgsl */`
fn sampleMember(member: ParticleCohortMember) -> ParticleCohortSample {
  if (member.slot >= arrayLength(&particles) || member.generation == 0u || member.generation == 0xffffffffu) {
    return ParticleCohortSample();
  }
  if (generations[member.slot] != member.generation) { return ParticleCohortSample(); }
  let particle = particles[member.slot];
  if (!particleLightIsActive(particle)) { return ParticleCohortSample(); }

  let fade = select(1.0, particleLifeFade(particle.motion.w, optical.lifeControl.y), optical.lifeControl.x > 0.0);
  let emission = particleLightIntrinsic(particle) * optical.gain.x * fade;
  let extinction = particleLightExtinction(particle, optical) * fade;
  return ParticleCohortSample(
    vec4<f32>(particle.anchor.xyz, 1.0),
    vec4<f32>(emission, extinction),
    vec4<f32>(particleLightBaseRadius(particle, optical), optical.raster.z),
    particle.shape,
    particle.state,
  );
}

`;

