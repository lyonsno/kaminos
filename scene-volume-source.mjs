// Opt-in experiment input, not a replacement for the accepted fire atlas or
// smoke transport. Coefficients use volume-local inverse-length units and
// relative linear RGB, before either consumer's camera transform.
export function createSceneVolumeSource({device, module, uniformBuffer, fluidBuffers, frontBuffers, grid, gridY, fluidGrid = grid, fluidGridY = gridY}) {
  for (const n of [grid, gridY, fluidGrid, fluidGridY]) {
    if (!Number.isInteger(n) || n <= 0) throw new Error('positive integer source dimensions required');
  }
  if (gridY / grid !== fluidGridY / fluidGrid) throw new Error('source and fluid domain aspect mismatch');
  const texture = device.createTexture({label: 'raw live volume emission and extinction',
    dimension: '3d', size: [grid, gridY, grid], format: 'rgba32float',
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC});
  const pipeline = device.createComputePipeline({label: 'raw scene volume source seed', layout: 'auto',
    compute: {module, entryPoint: 'seedSceneVolumeSource', constants: {
      GRID: fluidGrid, GRID_Y: fluidGridY, SCENE_SOURCE_GRID: grid, SCENE_SOURCE_GRID_Y: gridY}}});
  const inputs = fluidBuffers.map((buffer, i) => device.createBindGroup({layout: pipeline.getBindGroupLayout(0),
    entries: [[0, uniformBuffer], [1, buffer], [7, frontBuffers[i]]].map(([binding, buffer]) => ({binding, resource: {buffer}}))}));
  const output = device.createBindGroup({layout: pipeline.getBindGroupLayout(3), entries: [{binding: 4, resource: texture.createView()}]});
  let status = 'unbuilt', reason = 'not-encoded', frame = null, sourceIndex = null, generation = 0;
  return {
    encode(encoder, index, currentFrame) {
      if (status === 'destroyed') throw new Error('scene source destroyed');
      if (!Number.isInteger(index) || !inputs[index]) throw new Error('invalid scene source index');
      status = 'unbuilt'; reason = 'encoding';
      const pass = encoder.beginComputePass({label: 'raw live volume source'});
      pass.setPipeline(pipeline); pass.setBindGroup(0, inputs[index]); pass.setBindGroup(3, output);
      pass.dispatchWorkgroups(Math.ceil(grid/4), Math.ceil(gridY/4), Math.ceil(grid/4)); pass.end();
      status = 'encoded'; reason = null; sourceIndex = index; frame = currentFrame; generation++;
    },
    invalidate(why) {if (status !== 'destroyed') {status = 'unbuilt'; reason = why;}},
    async readback() {
      if (status !== 'encoded') throw new Error('scene source is not encoded');
      const snapshot = {frame, sourceIndex, generation};
      const rowBytes = grid * 16, bytesPerRow = Math.ceil(rowBytes/256)*256;
      const buffer = device.createBuffer({label: 'scene source witness readback', size: bytesPerRow*gridY*grid,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ});
      try {
        const encoder = device.createCommandEncoder();
        encoder.copyTextureToBuffer({texture}, {buffer, bytesPerRow, rowsPerImage: gridY}, [grid,gridY,grid]);
        device.queue.submit([encoder.finish()]);
        await buffer.mapAsync(GPUMapMode.READ);
        const mapped = new Float32Array(buffer.getMappedRange());
        const values = new Float32Array(grid*gridY*grid*4);
        for (let z=0; z<grid; z++) for (let y=0; y<gridY; y++) {
          const row = y+gridY*z;
          values.set(mapped.subarray(row*bytesPerRow/4, row*bytesPerRow/4+grid*4), row*grid*4);
        }
        return {...snapshot, dimensions: [grid,gridY,grid], values: Array.from(values)};
      } finally {buffer.destroy();}
    },
    describe() {return {identity: 'scene-volume-linear-emission-extinction-v0', status, reason, frame, sourceIndex, generation,
      dimensions: [grid, gridY, grid], localMin: [-1,-1,-1], localMax: [1, -1+2*gridY/grid, 1],
      channels: ['emission-r','emission-g','emission-b','extinction'], displayTransform: 'none',
      coefficientLengthSpace: 'volume-local', sampleCountPerCell: 8, completionAuthority: false,
      texture: status === 'encoded' ? texture : null};},
    destroy() {texture.destroy(); status = 'destroyed'; reason = 'destroyed';},
  };
}

export const SCENE_VOLUME_SOURCE_WGSL = /* wgsl */`
override SCENE_SOURCE_GRID: u32 = 32u;
override SCENE_SOURCE_GRID_Y: u32 = 64u;
@group(3) @binding(4) var sceneSourceOut: texture_storage_3d<rgba32float, write>;
@compute @workgroup_size(4,4,4)
fn seedSceneVolumeSource(@builtin(global_invocation_id) c: vec3<u32>) {
  if (any(c >= vec3<u32>(SCENE_SOURCE_GRID, SCENE_SOURCE_GRID_Y, SCENE_SOURCE_GRID))) { return; }
  var coefficients = vec4<f32>(0.0);
  for (var k=0u; k<8u; k++) {
    let offset = (vec3<f32>(f32(k&1u),f32((k>>1u)&1u),f32((k>>2u)&1u))+vec3<f32>(0.5))*0.5;
    let p = (vec3<f32>(c)+offset)*(2.0/f32(SCENE_SOURCE_GRID))-vec3<f32>(1.0);
    let medium = sceneEmissiveMaterialAt(p);
    coefficients += vec4<f32>(medium.emission, medium.absorption + medium.scattering)*0.125;
  }
  textureStore(sceneSourceOut, vec3<i32>(c), coefficients);
}
`;
