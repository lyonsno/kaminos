// Letterbox an RGBA8 source texture into the detector's [3, 512, 512] input
// (values / 255) and RGBA letterbox bytes, as WiLoR-MLX's pipeline does before
// detection. Sampling tables depend only on the source size and are rebuilt
// when it changes.
import { DETECTOR_SIZE, LETTERBOX, letterboxTables, unitTable } from './detector-kernels.js';

export function createDetectorLetterbox({ device, input, label = 'hand-detector-letterbox' }) {
  const usage = GPUBufferUsage, owned = [];
  const make = (size, flags, tag) => { const b = device.createBuffer({ label: `${label}:${tag}`, size, usage: flags }); owned.push(b); return b; };
  const columns = make(DETECTOR_SIZE * 20, usage.STORAGE | usage.COPY_DST, 'columns');
  const rows = make(DETECTOR_SIZE * 20, usage.STORAGE | usage.COPY_DST, 'rows');
  const unit = make(1024, usage.STORAGE | usage.COPY_DST, 'unit');
  const bytes = make(DETECTOR_SIZE * DETECTOR_SIZE * 4, usage.STORAGE | usage.COPY_SRC, 'bytes');
  device.queue.writeBuffer(unit, 0, unitTable());
  const pipeline = device.createComputePipeline({ label, layout: 'auto',
    compute: { module: device.createShaderModule({ label, code: LETTERBOX }), entryPoint: 'main' } });
  let size = null, bound = null, bindGroup = null;
  return Object.freeze({
    bytes,
    encode(encoder, { texture }) {
      if (!size || size[0] !== texture.width || size[1] !== texture.height) {
        size = [texture.width, texture.height];
        const tables = letterboxTables(texture.width, texture.height);
        device.queue.writeBuffer(columns, 0, tables.columns);
        device.queue.writeBuffer(rows, 0, tables.rows);
      }
      if (bound !== texture) {
        bound = texture;
        bindGroup = device.createBindGroup({ label, layout: pipeline.getBindGroupLayout(0), entries: [
          { binding: 1, resource: texture.createView() },
          { binding: 2, resource: { buffer: columns } }, { binding: 3, resource: { buffer: rows } },
          { binding: 4, resource: { buffer: unit } }, { binding: 5, resource: { buffer: input.buffer } },
          { binding: 6, resource: { buffer: bytes } }] });
      }
      const pass = encoder.beginComputePass({ label });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(DETECTOR_SIZE / 16, DETECTOR_SIZE / 16);
      pass.end();
    },
    dispose() { for (const b of owned) b.destroy(); },
  });
}
