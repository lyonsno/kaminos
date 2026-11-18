// kaminos-test: node
import assert from 'node:assert/strict';
import test from 'node:test';
import {withKaminosGpu} from '../tools/shader-herder.mjs';
import {createPacketNetwork} from '../volume-packet-network.mjs';
import {createPacketIncidentGather} from '../volume-particle-packet-incident.mjs';
import {PARTICLE_LIGHT_MATERIAL_WGSL} from '../volume-optical-particles.mjs';

test('moving receiver succession reserves, overlaps, and releases current particle identities', async () => {
  await withKaminosGpu(async ({device}) => {
    const owned = [];
    const copy = GPUBufferUsage.COPY_DST;
    function buffer(size, usage) {
      const result = device.createBuffer({size, usage});
      owned.push(result);
      return result;
    }
    const storage = GPUBufferUsage.STORAGE | copy;
    const material = {
      particles: buffer(3 * 96, storage),
      birthGenerations: buffer(12, storage),
      options: buffer(592, GPUBufferUsage.UNIFORM | copy),
      fine: buffer(8 * 64, storage),
      slots: 3,
      identity: {epoch: 1, frame: 1, step: 1},
      domain: {origin: [-1, -1, -1], dims: [2, 2, 2], pitch: 1},
      coverage: {kind: 'fixture'},
    };
    const options = new Float32Array(148);
    options.set([1,1], 44);
    options.set([1,1], 56);
    options.set([1,1,1,1], 88);
    options.set([1,0,1,0], 104);
    options.set([1,0,1,0], 108);
    device.queue.writeBuffer(material.options, 0, options);
    const flow = new Float32Array(8 * 16);
    for (let i = 0; i < flow.length; i += 16) flow[i] = 1;
    device.queue.writeBuffer(material.fine, 0, flow);
    const network = createPacketNetwork(device);
    const gather = createPacketIncidentGather(device, PARTICLE_LIGHT_MATERIAL_WGSL, rows => owned.push(...rows));
    const controlledIncident = buffer(32, storage);
    const generation = new Uint32Array([1,1,1]);
    const settings = {receiverPlacement: 'succession', receiverHandoverSteps: 2,
      receivers: 1, receiverRadius: 2, sources: 1, width: 1, sections: 4, nearDirections: 1};
    async function frame(step, positions, dark = false) {
      const rows = new Float32Array(3 * 24);
      positions.forEach((x, i) => {
        const at = i * 24;
        rows.set([x ?? 0,0,0,x === null ? 0 : 1], at);
        rows.set([2,1,.5,0], at + 8);
        rows.set([.03,0,0,.15], at + 16);
        rows[at + 22] = .1;
      });
      device.queue.writeBuffer(material.particles, 0, rows);
      device.queue.writeBuffer(material.birthGenerations, 0, generation);
      material.identity = {...material.identity, step, frame: material.identity.frame + 1};
      device.pushErrorScope('validation');
      const encoder = device.createCommandEncoder();
      const field = network.encode(encoder, {material, settings});
      assert.equal(field.receiverCount, 2);
      assert.equal(field.receipt.work.submittedInstances, 6, 'overlap allocation is charged');
      device.queue.writeBuffer(controlledIncident, 0, new Float32Array([3,3,3,1, dark ? 0 : 3,dark ? 0 : 3,dark ? 0 : 3,1]));
      gather.set({...field, radiance: controlledIncident}, material.identity);
      const reconstructed = gather.encode(encoder, {...material, identity: material.identity.epoch, step}).buffer;
      const inputs = [field.centers, field.weights, reconstructed];
      const readbacks = inputs.map(input => buffer(input.size, GPUBufferUsage.MAP_READ | copy));
      inputs.forEach((input, i) => encoder.copyBufferToBuffer(input, 0, readbacks[i], 0, input.size));
      device.queue.submit([encoder.finish()]);
      const error = await device.popErrorScope();
      assert.equal(error, null, error?.message);
      return Promise.all(readbacks.map(async read => {
        await read.mapAsync(GPUMapMode.READ);
        const values = new Float32Array(read.getMappedRange().slice(0));
        read.unmap();
        return values;
      }));
    }

    try {
      let [centers, weights, light] = await frame(1, [0,-.9,null]);
      assert.deepEqual([...weights], [1,0]);
      assert.deepEqual([...light.slice(0,4)], [3,3,3,1]);
      [centers, weights] = await frame(2, [.7,-.8,null]);
      assert.ok(Math.abs(centers[0] - .7) < 1e-6);
      assert.equal(centers[7], 0, 'reserved candidate outside the core is not yet traced');
      [centers, weights] = await frame(3, [.8,-.3,null]);
      assert.ok(Math.abs(centers[4] + .3) < 1e-6, 'trace the successor at its own position');
      assert.deepEqual([...weights], [1,0], 'first valid observation starts overlap with no brightness jump');
      [centers, weights, light] = await frame(4, [.85,-.2,0], true);
      assert.deepEqual([...weights], [.5,.5]);
      const kernel = d => (1-d)**4 * (1+4*d);
      const old = kernel(.85/2), next = kernel(.2/2);
      assert.ok(Math.abs(light[8] - 3*old/(old+next)) < 1e-5, 'valid darkness blends at the incoming donor position');
      [, weights] = await frame(4, [.85,-.2,0], true);
      assert.deepEqual([...weights], [.5,.5], 'edits while paused do not advance the fade');
      generation[0]++;
      [centers, weights] = await frame(5, [0,-.1,null]);
      assert.ok(Math.abs(centers[0] + .1) < 1e-6, 'recycled slot cannot retain a receiver claim');
      assert.deepEqual([...weights], [1,0]);
      [centers, weights, light] = await frame(6, [null,null,-.9]);
      assert.deepEqual([...weights], [0,0], 'reservation alone cannot conceal an uncovered site');
      assert.equal(light[11], 0, 'uncovered material retains explicit validity');
    } finally {
      network.dispose();
      gather.dispose();
      await device.queue.onSubmittedWorkDone();
      owned.forEach(buffer => buffer.destroy());
    }
  });
});
