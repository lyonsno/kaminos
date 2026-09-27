// Opt-in experiment input, not a replacement for the accepted fire atlas or
// smoke transport. Coefficients use volume-local inverse-length units and
// relative linear RGB, before either consumer's camera transform.
// Offline reference only: never called by the interactive renderer.
export function integrateSceneMediumSegment(field, source, receiver, stepLength) {
  const dims = field.dimensions, pitch = 2/dims[0];
  const lo = [-1,-1,-1], hi = dims.map(n => -1+n*pitch);
  const delta = receiver.map((v,i)=>v-source[i]);
  let start = 0, end = 1;
  for (let i=0;i<3;i++) {
    if (Math.abs(delta[i]) < 1e-20) {
      if (source[i]<lo[i] || source[i]>hi[i]) return 0;
    } else {
      const a=(lo[i]-source[i])/delta[i], b=(hi[i]-source[i])/delta[i];
      start=Math.max(start,Math.min(a,b)); end=Math.min(end,Math.max(a,b));
    }
  }
  const length = Math.max(0,end-start)*Math.hypot(...delta);
  if (length === 0) return 0;
  const count = Math.ceil(length/stepLength), ds=length/count;
  let tau=0;
  for (let i=0;i<count;i++) {
    const t=start+(i+.5)*(end-start)/count;
    const c=source.map((v,a)=>Math.max(0,Math.min(dims[a]-1,Math.floor((v+delta[a]*t-lo[a])/pitch))));
    tau+=Math.max(0,field.values[4*(c[0]+dims[0]*(c[1]+dims[1]*c[2]))+3])*ds;
  }
  return tau;
}

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
  let optical = null;
  const invalidateOptical = () => {if (optical) optical.generation = null;};
  return {
    encode(encoder, index, currentFrame) {
      if (status === 'destroyed') throw new Error('scene source destroyed');
      if (!Number.isInteger(index) || !inputs[index]) throw new Error('invalid scene source index');
      status = 'unbuilt'; reason = 'encoding';
      invalidateOptical();
      const pass = encoder.beginComputePass({label: 'raw live volume source'});
      pass.setPipeline(pipeline); pass.setBindGroup(0, inputs[index]); pass.setBindGroup(3, output);
      pass.dispatchWorkgroups(Math.ceil(grid/4), Math.ceil(gridY/4), Math.ceil(grid/4)); pass.end();
      status = 'encoded'; reason = null; sourceIndex = index; frame = currentFrame; generation++;
    },
    invalidate(why) {if (status !== 'destroyed') {status = 'unbuilt'; reason = why; invalidateOptical();}},
    // First experiment: one controlled source, in volume-local coordinates.
    // This integrates medium only; solid visibility must multiply separately.
    encodeOpticalDepth(encoder, position, stepLength = 2/grid) {
      if (status !== 'encoded') throw new Error('scene source is not encoded');
      if (!Array.isArray(position) || position.length !== 3 || !position.every(Number.isFinite)) throw new Error('finite source position required');
      if (!Number.isFinite(stepLength) || stepLength <= 0) throw new Error('positive finite integration step required');
      if (!optical) {
        const depth = device.createTexture({label: 'source medium optical depth', dimension: '3d',
          size: [grid,gridY,grid], format: 'r32float',
          usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC});
        const params = device.createBuffer({label: 'source local position and integration step', size: 16,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
        const depthPipeline = device.createComputePipeline({label: 'source medium segment integration', layout: 'auto',
          compute: {module: device.createShaderModule({code: SCENE_OPTICAL_DEPTH_WGSL}), entryPoint: 'integrateMedium'}});
        const group = device.createBindGroup({layout: depthPipeline.getBindGroupLayout(0), entries: [
          {binding: 0, resource: texture.createView()}, {binding: 1, resource: {buffer: params}},
          {binding: 2, resource: depth.createView()}]});
        optical = {depth, params, pipeline: depthPipeline, group, generation: null};
      }
      device.queue.writeBuffer(optical.params, 0, new Float32Array([...position, stepLength]));
      const pass = encoder.beginComputePass({label: 'source live medium attenuation'});
      pass.setPipeline(optical.pipeline); pass.setBindGroup(0, optical.group);
      pass.dispatchWorkgroups(Math.ceil(grid/4), Math.ceil(gridY/4), Math.ceil(grid/4)); pass.end();
      optical.generation = generation; optical.position = position.slice(); optical.stepLength = stepLength;
    },
    opticalDepthField() {
      const current = status === 'encoded' && optical?.generation === generation;
      return {identity: 'scene-source-medium-optical-depth-v0', status: current ? 'encoded' : 'unbuilt',
        texture: current ? optical.depth : null, sourcePosition: current ? optical.position.slice() : null,
        stepLength: current ? optical.stepLength : null, generation: current ? generation : null, frame,
        dimensions: [grid,gridY,grid], localMin: [-1,-1,-1], localMax: [1,-1+2*gridY/grid,1],
        coefficientSampling: 'piecewise-constant-cell-midpoint', solidVisibilityIncluded: false, completionAuthority: false};
    },
    async readback(kind = 'coefficients') {
      if (status !== 'encoded') throw new Error('scene source is not encoded');
      if (!['coefficients','optical-depth'].includes(kind)) throw new Error('unknown scene source readback');
      if (kind === 'optical-depth' && optical?.generation !== generation) throw new Error('optical depth is not current');
      const channels = kind === 'coefficients' ? 4 : 1;
      const snapshot = {frame, sourceIndex, generation, kind, channels,
        ...(kind === 'optical-depth' ? {sourcePosition: optical.position.slice(), stepLength: optical.stepLength} : {})};
      const rowBytes = grid * channels * 4, bytesPerRow = Math.ceil(rowBytes/256)*256;
      const buffer = device.createBuffer({label: 'scene source witness readback', size: bytesPerRow*gridY*grid,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ});
      try {
        const encoder = device.createCommandEncoder();
        encoder.copyTextureToBuffer({texture: kind === 'coefficients' ? texture : optical.depth}, {buffer, bytesPerRow, rowsPerImage: gridY}, [grid,gridY,grid]);
        device.queue.submit([encoder.finish()]);
        await buffer.mapAsync(GPUMapMode.READ);
        const mapped = new Float32Array(buffer.getMappedRange());
        const values = new Float32Array(grid*gridY*grid*channels);
        for (let z=0; z<grid; z++) for (let y=0; y<gridY; y++) {
          const row = y+gridY*z;
          values.set(mapped.subarray(row*bytesPerRow/4, row*bytesPerRow/4+grid*channels), row*grid*channels);
        }
        return {...snapshot, dimensions: [grid,gridY,grid], values: Array.from(values)};
      } finally {buffer.destroy();}
    },
    describe() {return {identity: 'scene-volume-linear-emission-extinction-v0', status, reason, frame, sourceIndex, generation,
      dimensions: [grid, gridY, grid], localMin: [-1,-1,-1], localMax: [1, -1+2*gridY/grid, 1],
      channels: ['emission-r','emission-g','emission-b','extinction'], displayTransform: 'none',
      coefficientLengthSpace: 'volume-local', sampleCountPerCell: 8, completionAuthority: false,
      texture: status === 'encoded' ? texture : null};},
    destroy() {texture.destroy(); optical?.depth.destroy(); optical?.params.destroy(); status = 'destroyed'; reason = 'destroyed';},
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

export const SCENE_OPTICAL_DEPTH_WGSL = /* wgsl */`
@group(0) @binding(0) var coefficients: texture_3d<f32>;
@group(0) @binding(1) var<uniform> source: vec4<f32>;
@group(0) @binding(2) var opticalDepth: texture_storage_3d<r32float, write>;
@compute @workgroup_size(4,4,4)
fn integrateMedium(@builtin(global_invocation_id) c: vec3<u32>) {
  let dims = textureDimensions(coefficients);
  if (any(c >= dims)) {return;}
  let pitch = 2.0/f32(dims.x);
  let lo = vec3<f32>(-1.0);
  let hi = lo + vec3<f32>(dims)*pitch;
  let receiver = lo+(vec3<f32>(c)+vec3<f32>(0.5))*pitch;
  let delta = receiver-source.xyz;
  let distance = length(delta);
  var start = 0.0;
  var end = 1.0;
  // Clip the actual segment, including sources outside the volume. Parallel
  // axes are handled explicitly: no reciprocal-zero NaNs at a slab boundary.
  for (var axis=0u; axis<3u; axis++) {
    if (abs(delta[axis]) < 1e-20) {
      if (source[axis]<lo[axis] || source[axis]>hi[axis]) {end = -1.0;}
    } else {
      let a = (lo[axis]-source[axis])/delta[axis];
      let b = (hi[axis]-source[axis])/delta[axis];
      start = max(start,min(a,b)); end = min(end,max(a,b));
    }
  }
  var tau = 0.0;
  let segmentLength = max(0.0,end-start)*distance;
  if (segmentLength > 0.0) {
    let count = u32(ceil(segmentLength/source.w));
    let ds = segmentLength/f32(count);
    for (var i=0u; i<count; i++) {
      let t = start+(f32(i)+0.5)*(end-start)/f32(count);
      let p = source.xyz+delta*t;
      let cell = clamp(vec3<i32>(floor((p-lo)/pitch)),vec3<i32>(0),vec3<i32>(dims)-vec3<i32>(1));
      tau += max(0.0,textureLoad(coefficients,cell,0).a)*ds;
    }
  }
  textureStore(opticalDepth,vec3<i32>(c),vec4<f32>(tau,0.0,0.0,0.0));
}
`;
