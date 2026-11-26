import {PARTICLE_LIGHT_MATERIAL_WGSL} from './volume-optical-particles.mjs';
import {PARTICLE_STATE_WGSL} from './volume-particle-state.mjs';

export const PARTICLE_COHORT_MEMBER_BYTES = 16;
export const PARTICLE_COHORT_SAMPLE_BYTES = 80;

import {PARTICLE_COHORT_RECORD_WGSL, PARTICLE_COHORT_SAMPLE_WGSL} from './volume-particle-cohort-abi.mjs';
export {PARTICLE_COHORT_RECORD_WGSL} from './volume-particle-cohort-abi.mjs';

export const PARTICLE_COHORT_GATHER_WGSL = /* wgsl */`
${PARTICLE_LIGHT_MATERIAL_WGSL}
${PARTICLE_STATE_WGSL}
${PARTICLE_COHORT_RECORD_WGSL}
@group(0) @binding(0) var<storage,read> members: array<ParticleCohortMember>;
@group(0) @binding(1) var<storage,read> particles: array<Particle>;
@group(0) @binding(2) var<storage,read> generations: array<u32>;
@group(0) @binding(3) var<uniform> optical: Options;
@group(0) @binding(4) var<storage,read_write> samples: array<ParticleCohortSample>;

${PARTICLE_COHORT_SAMPLE_WGSL}
@compute @workgroup_size(64) fn gather(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i < arrayLength(&members)) {
    samples[i] = sampleMember(members[i]);
  }
}
`;

/**
 * Encode with the current material snapshot during its synchronous GPU lease.
 * The caller owns the member (STORAGE) and output (STORAGE | COPY_DST) buffers
 * and supplies the epoch of the acquired keys. Each output row corresponds to
 * the same input row. A missing member produces a zeroed row. An epoch change
 * clears the requested span and reports epochMatches=false. Weights remain
 * unmodified in the input, for use by the consumer.
 *
 * Coefficients follow the current bundle's intrinsic gain and lifetime fade.
 * Support describes the existing optical proposal. No footprint, interval
 * length or representative weight has been integrated into the coefficients.
 */
export function createParticleCohortGather(device) {
  let pipeline;
  const bindingLimit = device.limits.maxStorageBufferBindingSize;
  return {
    encode(encoder, {material, cohort, output}) {
      const {count, epoch, members} = cohort;
      if (!Number.isSafeInteger(count) || count < 0 || !Number.isSafeInteger(epoch) || epoch < 1) {
        throw new RangeError('Invalid particle cohort count or acquisition epoch');
      }
      const identity = material.identity;
      const epochMatches = identity.epoch === epoch;
      const result = {
        identity, domain: material.domain, coverage: material.coverage, members,
        output, count, epochMatches, measure: 'bundle-coefficients-and-support-proposal',
      };
      if (count === 0) return result;

      const memberBytes = count * PARTICLE_COHORT_MEMBER_BYTES;
      const sampleBytes = count * PARTICLE_COHORT_SAMPLE_BYTES;
      const groups = Math.ceil(count / 64);
      if (sampleBytes > bindingLimit || groups > device.limits.maxComputeWorkgroupsPerDimension) {
        throw new RangeError('Particle cohort exceeds effective GPU capacity');
      }
      const {STORAGE, COPY_DST} = GPUBufferUsage;
      if (!members || members.size < memberBytes || !(members.usage & STORAGE)) {
        throw new Error('Particle cohort requires a complete member storage buffer');
      }
      if (!output || output.size < sampleBytes || (output.usage & (STORAGE | COPY_DST)) !== (STORAGE | COPY_DST)) {
        throw new Error('Particle cohort output requires storage and clearable capacity');
      }
      if ([members, material.particles, material.birthGenerations, material.options, material.fine, material.sourceOptions].includes(output)) {
        throw new Error('Particle cohort output must be a separate caller-owned buffer');
      }
      if (!epochMatches) {
        encoder.clearBuffer(output, 0, sampleBytes);
        return result;
      }

      const particleBytes = material.slots * 96;
      const generationBytes = material.slots * 4;
      if (!Number.isSafeInteger(material.slots) || material.slots < 1 || particleBytes > bindingLimit ||
          !material.particles || material.particles.size < particleBytes || !material.options ||
          !material.birthGenerations || material.birthGenerations.size < generationBytes) {
        throw new Error('Particle cohort requires current particle records and birth generations');
      }
      pipeline ??= device.createComputePipeline({
        label: 'gather selected current optical particles',
        layout: 'auto',
        compute: {
          module: device.createShaderModule({label: 'particle cohort gather', code: PARTICLE_COHORT_GATHER_WGSL}),
          entryPoint: 'gather',
        },
      });
      const bindings = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          {binding: 0, resource: {buffer: members, size: memberBytes}},
          {binding: 1, resource: {buffer: material.particles, size: particleBytes}},
          {binding: 2, resource: {buffer: material.birthGenerations, size: generationBytes}},
          {binding: 3, resource: {buffer: material.options}},
          {binding: 4, resource: {buffer: output, size: sampleBytes}},
        ],
      });
      const pass = encoder.beginComputePass({label: 'gather selected particle cohort'});
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindings);
      pass.dispatchWorkgroups(groups);
      pass.end();
      return result;
    },
  };
}
