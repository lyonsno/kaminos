// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {withKaminosGpu} from '../tools/shader-herder.mjs';
import {createParticleMaterialHandoff} from '../volume-optical-particles.mjs';
import {
  createParticleCohortGather, PARTICLE_COHORT_GATHER_WGSL,
  PARTICLE_COHORT_RECORD_WGSL, PARTICLE_COHORT_MEMBER_BYTES, PARTICLE_COHORT_SAMPLE_BYTES,
} from '../volume-particle-cohort.mjs';

const CONSUMER_WGSL = /* wgsl */`${PARTICLE_COHORT_RECORD_WGSL}
@group(0) @binding(0) var<storage,read> members: array<ParticleCohortMember>;
@group(0) @binding(1) var<storage,read> samples: array<ParticleCohortSample>;
@group(0) @binding(2) var<storage,read_write> totals: vec4<f32>;
@compute @workgroup_size(1) fn summarize() {
  var sum = vec4<f32>(0);
  for (var i = 0u; i < arrayLength(&samples); i++) {
    let sample = samples[i];
    if (sample.positionAndAlive.w == 0.0) { continue; }
    let optical = sample.intrinsicAndExtinction;
    sum.x += select(0.0, 1.0, any(optical.xyz > vec3<f32>(0)));
    sum.y += select(0.0, 1.0, optical.w > 0.0);
    sum.z += optical.x * members[i].weight;
    sum.w += optical.w * members[i].weight;
  }
  totals = sum;
}
`;

test('a GPU consumer follows selected material through burnout, loss and pool reuse', async () => {
  await withKaminosGpu(async ({device}) => {
    const owned = [];
    function buffer(size, usage) {
      const result = device.createBuffer({size, usage});
      owned.push(result);
      return result;
    }
    const {STORAGE, COPY_DST, COPY_SRC, MAP_READ, UNIFORM} = GPUBufferUsage;
    const particles = buffer(3 * 96, STORAGE | COPY_DST);
    const birthGenerations = buffer(3 * 4, STORAGE | COPY_DST);
    const options = buffer(592, UNIFORM | COPY_DST);
    const keys = [[0, 7, 2], [1, 11, 0.5], [2, 5, 3], [4096, 4, 1], [0, 0, 1], [0, 0xffffffff, 1]];
    const count = keys.length;
    const members = buffer(count * PARTICLE_COHORT_MEMBER_BYTES, STORAGE | COPY_DST);
    const bytes = count * PARTICLE_COHORT_SAMPLE_BYTES;
    // The extra output capacity is unrelated to the gather and must remain intact.
    const output = buffer(bytes + PARTICLE_COHORT_SAMPLE_BYTES, STORAGE | COPY_SRC | COPY_DST);
    const readback = buffer(output.size + 16, MAP_READ | COPY_DST);
    const totals = buffer(16, STORAGE | COPY_SRC);
    const input = new ArrayBuffer(members.size);
    const ids = new Uint32Array(input), weights = new Float32Array(input);
    keys.forEach(([slot, generation, weight], i) => {
      ids.set([slot, generation], i * 4);
      weights[i * 4 + 2] = weight;
    });
    device.queue.writeBuffer(members, 0, input);
    device.queue.writeBuffer(output, bytes, new Float32Array([123]));
    const settings = new Float32Array(148);
    settings.set([2, 3], 44); // x radius multiplier and y stretch
    settings[56] = 2; // intrinsic gain
    settings[64] = 0.25; // support floor
    settings.set([2, 4], 88); // density and extinction factors
    device.queue.writeBuffer(options, 0, settings);
    const records = new Float32Array(3 * 24);
    records.set([0.25, 0, 0, 1], 0);
    records.set([900, 900, 900, 0], 4); // captured scattered light is excluded
    records.set([3, 2, 1, 1], 8);
    records.set([0.125, 0.25, 0.5, 0.75], 16);
    records.set([0.25, 2, 0.5, 0.125], 20);
    records.set([0.5, 0, 0, 1], 24);
    records.set([0.25, 0, 0, 0], 32);
    records[43] = 0.5;
    records[46] = 0.125;
    records[51] = 1;
    records[67] = 0.5;
    records[70] = 0.25;
    const generations = new Uint32Array([7, 11, 5]);
    const handoff = createParticleMaterialHandoff(device);
    const gather = createParticleCohortGather(device);
    const consumer = device.createComputePipeline({
      layout: 'auto', compute: {module: device.createShaderModule({code: CONSUMER_WGSL}), entryPoint: 'summarize'},
    });
    const consumerBindings = device.createBindGroup({
      layout: consumer.getBindGroupLayout(0),
      entries: [members, output, totals].map((b, binding) => ({
        binding, resource: binding === 1 ? {buffer: b, size: bytes} : {buffer: b},
      })),
    });
    function publish(step, frame) {
      device.queue.writeBuffer(particles, 0, records);
      device.queue.writeBuffer(birthGenerations, 0, generations);
      handoff.publish({step, frame, slots: 3, dims: [4, 4, 4], transform: {scale: 2, translate: [1, 3, 5]},
        particles, birthGenerations, options, materialStamp: 'current optics', acquisitionMode: 1});
    }
    let cohort;
    async function observe(step) {
      let result;
      device.pushErrorScope('validation');
      const submitted = handoff.submit(step, (encoder, material) => {
        result = gather.encode(encoder, {material, cohort, output});
        const pass = encoder.beginComputePass();
        pass.setPipeline(consumer);
        pass.setBindGroup(0, consumerBindings);
        pass.dispatchWorkgroups(1);
        pass.end();
        encoder.copyBufferToBuffer(output, 0, readback, 0, output.size);
        encoder.copyBufferToBuffer(totals, 0, readback, output.size, 16);
      });
      const error = await device.popErrorScope();
      assert.equal(error, null, error?.message);
      assert.equal(submitted.available, true);
      assert.equal(result.identity, submitted.identity);
      assert.equal(result.count, count);
      assert.deepEqual(result.domain.worldFromFine, {scale: 2, translate: [1, 3, 5]});
      assert.equal(result.members, members);
      await readback.mapAsync(GPUMapMode.READ);
      const values = new Float32Array(readback.getMappedRange().slice(0));
      readback.unmap();
      assert.equal(values[bytes / 4], 123);
      return {current: result.epochMatches, data: values.subarray(0, bytes / 4), sum: [...values.slice(-4)]};
    }
    try {
      publish(20, 30);
      cohort = {epoch: handoff.current().epoch, members, count};
      let result = await observe(20);
      assert.equal(result.current, true);
      assert.deepEqual([...result.data.slice(0, 20)], [
        0.25, 0, 0, 1, 6, 4, 2, 4, 0.5, 1.5, 0.5, 0,
        0.125, 0.25, 0.5, 0.75, 0.25, 2, 0.5, 0.125,
      ]);
      assert.deepEqual(result.sum, [2, 3, 12.25, 14.5]);
      assert.ok(result.data.slice(60).every(value => value === 0));

      records[0] = -0.5; // same carrier moved and burned out
      records.fill(0, 8, 11);
      records[22] = 1;
      generations[1] = 12; // replacement is bright, but cannot inherit the old key
      records[32] = 100;
      records[51] = 0; // dead with the original generation still stored
      publish(21, 31);
      assert.equal(handoff.submit(20, () => assert.fail('stale material was encoded')).available, false);
      result = await observe(21);
      assert.deepEqual([...result.data.slice(0, 8)], [-0.5, 0, 0, 1, 0, 0, 0, 8]);
      assert.ok(result.data.slice(20).every(value => value === 0));
      assert.deepEqual(result.sum, [0, 1, 0, 16]);

      handoff.reset();
      publish(22, 32); // even a matching slot/generation is from another pool
      result = await observe(22);
      assert.equal(result.current, false);
      assert.ok(result.data.every(value => value === 0));
      assert.deepEqual(result.sum, [0, 0, 0, 0]);
    } finally {
      owned.forEach(b => b.destroy());
    }
  }, {wgslSources: [
    {label: 'selected particle cohort gather', code: PARTICLE_COHORT_GATHER_WGSL, entryPoint: 'gather'},
    {label: 'separate optical participation consumer', code: CONSUMER_WGSL, entryPoint: 'summarize'},
  ]});
});
