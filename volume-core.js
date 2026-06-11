const ROUTE_IDENTITY = 'native-3d-compute-fluid-raymarch-v0';
const PROTOTYPE_IDENTITY = 'kaminos-volume-prototype-v0';
const GRID_SIZE = 64;
const GRID_CELL_COUNT = GRID_SIZE * GRID_SIZE * GRID_SIZE;
const FLUID_COMPONENTS = 4;
const FLUID_BUFFER_BYTES = GRID_CELL_COUNT * FLUID_COMPONENTS * Float32Array.BYTES_PER_ELEMENT;

const WGSL = /* wgsl */`
const GRID: u32 = 64u;
const GRID_F: f32 = 64.0;

struct Uniforms {
  invViewProj: mat4x4<f32>,
  cameraPos_time: vec4<f32>,
  viewport_steps_density: vec4<f32>,
  fire_smoke_curl_speed: vec4<f32>,
};

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read> fluidSrc: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> fluidDst: array<vec4<f32>>;

struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs(@builtin(vertex_index) i: u32) -> VSOut {
  var p = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -3.0),
    vec2<f32>( 3.0,  1.0),
    vec2<f32>(-1.0,  1.0)
  );
  var out: VSOut;
  out.pos = vec4<f32>(p[i], 0.0, 1.0);
  out.uv = p[i] * 0.5 + vec2<f32>(0.5);
  return out;
}

fn hash31(p: vec3<f32>) -> f32 {
  let q = fract(p * 0.1031);
  let r = q + dot(q, q.yzx + 33.33);
  return fract((r.x + r.y) * r.z);
}

fn rotate2(p: vec2<f32>, a: f32) -> vec2<f32> {
  let c = cos(a);
  let s = sin(a);
  return vec2<f32>(c * p.x - s * p.y, s * p.x + c * p.y);
}

fn index3(c: vec3<u32>) -> u32 {
  return c.x + c.y * GRID + c.z * GRID * GRID;
}

fn clampCell(c: vec3<i32>) -> vec3<u32> {
  return vec3<u32>(clamp(c, vec3<i32>(0), vec3<i32>(i32(GRID) - 1)));
}

fn readCell(c: vec3<i32>) -> vec4<f32> {
  return fluidSrc[index3(clampCell(c))];
}

fn sampleFluidCell(p: vec3<f32>) -> vec4<f32> {
  let pc = clamp(p, vec3<f32>(0.0), vec3<f32>(GRID_F - 1.001));
  let i0 = vec3<i32>(floor(pc));
  let f = fract(pc);
  let c000 = readCell(i0 + vec3<i32>(0, 0, 0));
  let c100 = readCell(i0 + vec3<i32>(1, 0, 0));
  let c010 = readCell(i0 + vec3<i32>(0, 1, 0));
  let c110 = readCell(i0 + vec3<i32>(1, 1, 0));
  let c001 = readCell(i0 + vec3<i32>(0, 0, 1));
  let c101 = readCell(i0 + vec3<i32>(1, 0, 1));
  let c011 = readCell(i0 + vec3<i32>(0, 1, 1));
  let c111 = readCell(i0 + vec3<i32>(1, 1, 1));
  let x00 = mix(c000, c100, f.x);
  let x10 = mix(c010, c110, f.x);
  let x01 = mix(c001, c101, f.x);
  let x11 = mix(c011, c111, f.x);
  let y0 = mix(x00, x10, f.y);
  let y1 = mix(x01, x11, f.y);
  return mix(y0, y1, f.z);
}

fn sampleWorld(p: vec3<f32>) -> vec4<f32> {
  let cell = (p * 0.5 + vec3<f32>(0.5)) * (GRID_F - 1.0);
  return sampleFluidCell(cell);
}

fn slabAxis(origin: f32, dir: f32, halfSize: f32) -> vec2<f32> {
  if (abs(dir) < 0.00001) {
    if (abs(origin) > halfSize) {
      return vec2<f32>(1.0, -1.0);
    }
    return vec2<f32>(-1.0e6, 1.0e6);
  }
  let a = (-halfSize - origin) / dir;
  let b = ( halfSize - origin) / dir;
  return vec2<f32>(min(a, b), max(a, b));
}

fn boxHit(ro: vec3<f32>, rd: vec3<f32>, b: vec3<f32>) -> vec2<f32> {
  let sx = slabAxis(ro.x, rd.x, b.x);
  let sy = slabAxis(ro.y, rd.y, b.y);
  let sz = slabAxis(ro.z, rd.z, b.z);
  return vec2<f32>(max(max(sx.x, sy.x), sz.x), min(min(sx.y, sy.y), sz.y));
}

fn fireColor(temp: f32) -> vec3<f32> {
  let ember = vec3<f32>(0.70, 0.10, 0.018);
  let orange = vec3<f32>(1.0, 0.38, 0.055);
  let gold = vec3<f32>(1.0, 0.74, 0.20);
  let pale = vec3<f32>(1.0, 0.82, 0.34);
  let a = mix(ember, orange, smoothstep(0.08, 0.44, temp));
  let b = mix(gold, pale, smoothstep(0.86, 1.55, temp));
  return mix(a, b, smoothstep(0.34, 1.08, temp));
}

@compute @workgroup_size(4, 4, 4)
fn cs(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (any(gid >= vec3<u32>(GRID))) {
    return;
  }
  let idx = index3(gid);
  let cell = vec3<f32>(gid) + vec3<f32>(0.5);
  let p = (cell / GRID_F) * 2.0 - vec3<f32>(1.0);
  let prev = fluidSrc[idx];
  let speed = u.fire_smoke_curl_speed.w;
  let curl = u.fire_smoke_curl_speed.z;
  let time = u.cameraPos_time.w;
  let backCell = cell - prev.xyz * (2.55 + speed * 0.55);
  var advected = sampleFluidCell(backCell);
  var vel = advected.xyz * 0.985;
  var density = advected.w * 0.990;

  let radial = length(p.xz);
  let sourceWobble = rotate2(p.xz, time * 1.3);
  let sourceRadial = length(sourceWobble + vec2<f32>(0.10 * sin(time * 1.7), 0.08 * cos(time * 1.1)));
  let source = exp(-sourceRadial * sourceRadial * 22.0) * smoothstep(-0.98, -0.76, p.y) * (1.0 - smoothstep(-0.42, -0.12, p.y));
  let swirl = vec3<f32>(-p.z, 0.0, p.x) / max(radial, 0.08);
  let phase = time * 1.8 + p.y * 7.0 + hash31(vec3<f32>(gid) * 0.07) * 2.0;
  vel = vel + swirl * source * (0.040 + 0.022 * curl);
  vel.y = vel.y + source * (0.135 + speed * 0.024) + density * 0.014;
  vel.x = vel.x + sin(phase) * density * 0.010 * curl;
  vel.z = vel.z + cos(phase * 0.93) * density * 0.010 * curl;
  density = max(density, source * (1.25 + 0.18 * sin(time * 2.0)));

  let wall = max(max(abs(p.x), abs(p.y)), abs(p.z));
  let wallFade = 1.0 - smoothstep(0.86, 1.0, wall);
  let topFade = 1.0 - smoothstep(0.80, 0.995, p.y);
  density = density * mix(0.35, 1.0, wallFade) * mix(0.72, 1.0, topFade);
  vel = vel * mix(0.55, 1.0, wallFade);
  vel.y = max(vel.y, -0.015);
  fluidDst[idx] = vec4<f32>(clamp(vel, vec3<f32>(-0.30), vec3<f32>(0.46)), clamp(density, 0.0, 2.2));
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4<f32> {
  let ndc = vec2<f32>(in.uv.x * 2.0 - 1.0, (1.0 - in.uv.y) * 2.0 - 1.0);
  let nearClip = vec4<f32>(ndc, -1.0, 1.0);
  let farClip = vec4<f32>(ndc, 1.0, 1.0);
  let nearWorldRaw = u.invViewProj * nearClip;
  let farWorldRaw = u.invViewProj * farClip;
  let nearWorld = nearWorldRaw.xyz / nearWorldRaw.w;
  let farWorld = farWorldRaw.xyz / farWorldRaw.w;
  let ro = u.cameraPos_time.xyz;
  let rd = normalize(farWorld - nearWorld);
  let hit = boxHit(ro, rd, vec3<f32>(1.0, 1.0, 1.0));
  if (hit.y <= max(hit.x, 0.0)) {
    return vec4<f32>(0.004, 0.005, 0.006, 1.0);
  }

  let steps = clamp(u.viewport_steps_density.z, 24.0, 192.0);
  let startT = max(hit.x, 0.0);
  let endT = hit.y;
  let dt = (endT - startT) / steps;
  let jitter = hash31(vec3<f32>(floor(in.uv * u.viewport_steps_density.xy), floor(u.cameraPos_time.w * 19.0))) * dt;
  var t = startT + jitter;
  var trans = 1.0;
  var color = vec3<f32>(0.004, 0.005, 0.006);

  for (var i = 0; i < 192; i = i + 1) {
    if (f32(i) >= steps || trans < 0.012) { break; }
    let p = ro + rd * t;
    let state = sampleWorld(p);
    let velMag = length(state.xyz);
    let density = state.w * u.viewport_steps_density.w;
    let y = clamp((p.y + 1.0) * 0.5, 0.0, 1.0);
    let temp = clamp(density * (0.78 - y * 0.24) + velMag * 2.15, 0.0, 1.20) * u.fire_smoke_curl_speed.x;
    let smoke = density * smoothstep(0.05, 0.96, y) * u.fire_smoke_curl_speed.y;
    let alpha = clamp((density * 0.030 + smoke * 0.028) * dt * steps, 0.0, 0.12);
    let smokeCol = vec3<f32>(0.18, 0.27, 0.31) * (0.42 + min(0.72, velMag * 6.0));
    let flame = fireColor(temp) * (0.42 + temp * 0.64);
    let local = mix(smokeCol, flame, smoothstep(0.18, 0.78, temp));
    color = color + trans * alpha * local;
    trans = trans * (1.0 - alpha);
    t = t + dt;
  }

  let vignette = 1.0 - smoothstep(0.28, 1.48, length(ndc));
  let exposed = vec3<f32>(1.0) - exp(-color * 0.96);
  let grade = exposed * (0.80 + 0.18 * vignette);
  return vec4<f32>(pow(max(grade, vec3<f32>(0.0)), vec3<f32>(0.84)), 1.0);
}
`;

export function createKaminosVolumePrototype({ THREE, viewport, camera, controls, getControls, onStatus }) {
  const canvas = document.createElement('canvas');
  canvas.id = 'kaminos-volume-canvas';
  canvas.dataset.prototype = PROTOTYPE_IDENTITY;
  canvas.dataset.routeIdentity = ROUTE_IDENTITY;
  viewport.appendChild(canvas);

  const invViewProj = new THREE.Matrix4();
  const viewProj = new THREE.Matrix4();
  const uniforms = new Float32Array(28);
  const state = {
    prototypeIdentity: PROTOTYPE_IDENTITY,
    routeIdentity: ROUTE_IDENTITY,
    requestedRoute: 'kaminos_volume_smoke=1',
    effectiveRoute: ROUTE_IDENTITY,
    backend: 'inactive',
    active: false,
    width: 0,
    height: 0,
    frameCount: 0,
    simStepCount: 0,
    simGrid: GRID_SIZE,
    simGridLabel: `${GRID_SIZE}^3 velocity-density-storage-buffer`,
    lastFrameEnergy: 0,
    error: null,
  };

  let adapter = null;
  let device = null;
  let context = null;
  let pipeline = null;
  let readbackPipeline = null;
  let computePipeline = null;
  let bindGroups = [];
  let bindGroupLayout = null;
  let uniformBuffer = null;
  let fluidBuffers = [];
  let currentFluid = 0;
  let frameTexture = null;
  let frameTextureSize = '';
  let format = null;
  let raf = 0;
  let controlsSnapshot = getControls();

  function emitStatus(extra = {}) {
    onStatus?.({ ...state, ...extra });
  }

  function makeInitialFluid() {
    const data = new Float32Array(GRID_CELL_COUNT * FLUID_COMPONENTS);
    for (let z = 0; z < GRID_SIZE; z += 1) {
      for (let y = 0; y < GRID_SIZE; y += 1) {
        for (let x = 0; x < GRID_SIZE; x += 1) {
          const fx = (x + 0.5) / GRID_SIZE * 2 - 1;
          const fy = (y + 0.5) / GRID_SIZE * 2 - 1;
          const fz = (z + 0.5) / GRID_SIZE * 2 - 1;
          const radial = Math.hypot(fx, fz);
          const source = Math.exp(-radial * radial * 20) * Math.max(0, 1 - Math.abs(fy + 0.74) * 4.2);
          const i = ((x + y * GRID_SIZE + z * GRID_SIZE * GRID_SIZE) * FLUID_COMPONENTS);
          data[i] = -fz * source * 0.11;
          data[i + 1] = source * 0.22;
          data[i + 2] = fx * source * 0.11;
          data[i + 3] = source * 1.6;
        }
      }
    }
    return data;
  }

  async function ensureGpu() {
    if (device) return;
    if (!navigator.gpu) {
      throw new Error('WebGPU unavailable');
    }
    adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('WebGPU adapter unavailable');
    device = await adapter.requestDevice();
    context = canvas.getContext('webgpu');
    format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: 'opaque' });
    device.addEventListener('uncapturederror', event => {
      state.error = event.error?.message || String(event.error || 'WebGPU uncaptured error');
      emitStatus({ phase: 'gpu-error', error: state.error });
    });
    uniformBuffer = device.createBuffer({
      label: 'kaminos fluid uniforms',
      size: uniforms.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const initialFluid = makeInitialFluid();
    fluidBuffers = [0, 1].map(i => {
      const buffer = device.createBuffer({
        label: `kaminos fluid state ${i}`,
        size: FLUID_BUFFER_BYTES,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
      });
      device.queue.writeBuffer(buffer, 0, initialFluid);
      return buffer;
    });
    const shader = device.createShaderModule({ label: 'kaminos compute fluid raymarch wgsl', code: WGSL });
    const compilationInfo = await shader.getCompilationInfo();
    const compilationErrors = compilationInfo.messages.filter(message => message.type === 'error');
    if (compilationErrors.length > 0) {
      const detail = compilationErrors
        .map(message => `${message.lineNum}:${message.linePos} ${message.message}`)
        .join('\n');
      throw new Error(`WGSL compilation failed:\n${detail}`);
    }
    bindGroupLayout = device.createBindGroupLayout({
      label: 'kaminos fluid bind group layout',
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
          buffer: { type: 'uniform' },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
          buffer: { type: 'read-only-storage' },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'storage' },
        },
      ],
    });
    const pipelineLayout = device.createPipelineLayout({
      label: 'kaminos fluid pipeline layout',
      bindGroupLayouts: [bindGroupLayout],
    });
    const makePipeline = (targetFormat, label) => device.createRenderPipeline({
      label,
      layout: pipelineLayout,
      vertex: { module: shader, entryPoint: 'vs' },
      fragment: { module: shader, entryPoint: 'fs', targets: [{ format: targetFormat }] },
      primitive: { topology: 'triangle-list' },
    });
    device.pushErrorScope('validation');
    pipeline = makePipeline(format, 'kaminos volume canvas native-3d-compute-fluid-raymarch-v0');
    const canvasPipelineError = await device.popErrorScope();
    if (canvasPipelineError) {
      throw new Error(`canvas pipeline validation: ${canvasPipelineError.message || String(canvasPipelineError)}`);
    }
    device.pushErrorScope('validation');
    readbackPipeline = makePipeline('rgba8unorm', 'kaminos volume readback native-3d-compute-fluid-raymarch-v0');
    const readbackPipelineError = await device.popErrorScope();
    if (readbackPipelineError) {
      throw new Error(`readback pipeline validation: ${readbackPipelineError.message || String(readbackPipelineError)}`);
    }
    computePipeline = device.createComputePipeline({
      label: 'kaminos first fluid sim compute pipeline',
      layout: pipelineLayout,
      compute: { module: shader, entryPoint: 'cs' },
    });
    bindGroups = [
      device.createBindGroup({
        label: 'kaminos fluid bind group A to B',
        layout: bindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: uniformBuffer } },
          { binding: 1, resource: { buffer: fluidBuffers[0] } },
          { binding: 2, resource: { buffer: fluidBuffers[1] } },
        ],
      }),
      device.createBindGroup({
        label: 'kaminos fluid bind group B to A',
        layout: bindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: uniformBuffer } },
          { binding: 1, resource: { buffer: fluidBuffers[1] } },
          { binding: 2, resource: { buffer: fluidBuffers[0] } },
        ],
      }),
    ];
    state.backend = `WebGPU:${adapter.info?.vendor || 'adapter'}`;
    emitStatus({ phase: 'gpu-ready' });
  }

  function resize() {
    const rect = viewport.getBoundingClientRect();
    const dpr = 1;
    const width = Math.max(1, Math.floor(rect.width * dpr));
    const height = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      state.width = width;
      state.height = height;
      frameTextureSize = '';
    }
  }

  function ensureFrameTexture() {
    const key = `${state.width}x${state.height}`;
    if (frameTexture && frameTextureSize === key) return;
    frameTexture?.destroy();
    frameTexture = device.createTexture({
      label: 'kaminos volume witness frame texture',
      size: { width: state.width, height: state.height, depthOrArrayLayers: 1 },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    frameTextureSize = key;
  }

  function updateUniforms(now) {
    resize();
    camera.updateMatrixWorld();
    viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    invViewProj.copy(viewProj).invert();
    uniforms.set(invViewProj.elements, 0);
    uniforms[16] = camera.position.x;
    uniforms[17] = camera.position.y;
    uniforms[18] = camera.position.z;
    uniforms[19] = now * 0.001;
    uniforms[20] = state.width;
    uniforms[21] = state.height;
    uniforms[22] = controlsSnapshot.raySteps;
    uniforms[23] = controlsSnapshot.density;
    uniforms[24] = controlsSnapshot.fire;
    uniforms[25] = controlsSnapshot.smoke;
    uniforms[26] = controlsSnapshot.curl;
    uniforms[27] = controlsSnapshot.speed;
    device.queue.writeBuffer(uniformBuffer, 0, uniforms);
  }

  function encodeSim(encoder) {
    const pass = encoder.beginComputePass({ label: 'kaminos fluid sim pass' });
    pass.setPipeline(computePipeline);
    pass.setBindGroup(0, bindGroups[currentFluid]);
    pass.dispatchWorkgroups(GRID_SIZE / 4, GRID_SIZE / 4, GRID_SIZE / 4);
    pass.end();
    currentFluid = 1 - currentFluid;
    state.simStepCount += 1;
  }

  function encodeDraw(encoder, view, label, targetPipeline = pipeline) {
    const pass = encoder.beginRenderPass({
      label,
      colorAttachments: [{
        view,
        clearValue: { r: 0.004, g: 0.005, b: 0.006, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    pass.setPipeline(targetPipeline);
    pass.setBindGroup(0, bindGroups[currentFluid]);
    pass.draw(3);
    pass.end();
  }

  function render(now) {
    if (!state.active) return;
    raf = requestAnimationFrame(render);
    controls?.update?.();
    updateUniforms(now);
    const encoder = device.createCommandEncoder({ label: 'kaminos compute fluid frame' });
    encodeSim(encoder);
    encodeDraw(encoder, context.getCurrentTexture().createView(), 'kaminos volume canvas pass');
    device.queue.submit([encoder.finish()]);
    state.frameCount += 1;
    state.lastFrameEnergy = Math.min(9.999, state.simStepCount * 0.001 + 0.55 * controlsSnapshot.density + 0.35 * controlsSnapshot.fire);
  }

  async function sampleSimReadback() {
    const readback = device.createBuffer({
      label: 'kaminos fluid simReadback',
      size: FLUID_BUFFER_BYTES,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = device.createCommandEncoder({ label: 'kaminos fluid simReadback encoder' });
    encoder.copyBufferToBuffer(fluidBuffers[currentFluid], 0, readback, 0, FLUID_BUFFER_BYTES);
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const data = new Float32Array(readback.getMappedRange());
    let densitySum = 0;
    let densityMax = 0;
    let velocitySum = 0;
    let liveVoxels = 0;
    const stride = Math.max(1, Math.floor(GRID_CELL_COUNT / 4096));
    for (let cell = 0; cell < GRID_CELL_COUNT; cell += stride) {
      const i = cell * FLUID_COMPONENTS;
      const vx = data[i];
      const vy = data[i + 1];
      const vz = data[i + 2];
      const d = data[i + 3];
      densitySum += d;
      densityMax = Math.max(densityMax, d);
      velocitySum += Math.hypot(vx, vy, vz);
      if (d > 0.02) liveVoxels += 1;
    }
    const samples = Math.ceil(GRID_CELL_COUNT / stride);
    readback.unmap();
    readback.destroy();
    return {
      grid: GRID_SIZE,
      samples,
      densityMean: densitySum / samples,
      densityMax,
      velocityMean: velocitySum / samples,
      liveVoxels,
    };
  }

  async function sampleFrame() {
    if (!state.active || !device) return { ok: false, reason: 'inactive', ...state };
    updateUniforms(performance.now());
    ensureFrameTexture();
    const bytesPerPixel = 4;
    const unpaddedBytesPerRow = state.width * bytesPerPixel;
    const bytesPerRow = Math.ceil(unpaddedBytesPerRow / 256) * 256;
    const buffer = device.createBuffer({
      label: 'kaminos volume witness readback',
      size: bytesPerRow * state.height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    device.pushErrorScope('validation');
    const encoder = device.createCommandEncoder({ label: 'kaminos volume witness readback encoder' });
    encodeSim(encoder);
    encodeDraw(encoder, frameTexture.createView(), 'kaminos volume one-off readback pass', readbackPipeline);
    encoder.copyTextureToBuffer(
      { texture: frameTexture },
      { buffer, bytesPerRow, rowsPerImage: state.height },
      { width: state.width, height: state.height, depthOrArrayLayers: 1 }
    );
    device.queue.submit([encoder.finish()]);
    const validationError = await device.popErrorScope();
    if (validationError) {
      buffer.destroy();
      return {
        ok: false,
        reason: 'readback-validation',
        validationError: validationError.message || String(validationError),
        width: state.width,
        height: state.height,
        frameCount: state.frameCount,
        simStepCount: state.simStepCount,
        simGrid: state.simGrid,
        effectiveRoute: state.effectiveRoute,
        prototypeIdentity: state.prototypeIdentity,
        backend: state.backend,
      };
    }
    await buffer.mapAsync(GPUMapMode.READ);
    const data = new Uint8Array(buffer.getMappedRange());
    let litPixels = 0;
    let fireLikePixels = 0;
    let smokeLikePixels = 0;
    let totalLuma = 0;
    let samples = 0;
    const previewWidth = 256;
    const previewHeight = Math.max(1, Math.round(previewWidth * state.height / state.width));
    const preview = new Uint8Array(previewWidth * previewHeight * 4);
    for (let y = Math.floor(state.height * 0.08); y < Math.floor(state.height * 0.92); y += 2) {
      const row = y * bytesPerRow;
      for (let x = Math.floor(state.width * 0.08); x < Math.floor(state.width * 0.92); x += 2) {
        const i = row + x * bytesPerPixel;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        totalLuma += luma;
        samples += 1;
        if (luma > 20) litPixels += 1;
        if (r > 120 && g > 70 && b < 90) fireLikePixels += 1;
        if (b > 28 && g > 28 && r < 105 && Math.abs(g - b) < 60) smokeLikePixels += 1;
      }
    }
    for (let py = 0; py < previewHeight; py += 1) {
      const srcY = Math.min(state.height - 1, Math.floor(py / previewHeight * state.height));
      const row = srcY * bytesPerRow;
      for (let px = 0; px < previewWidth; px += 1) {
        const srcX = Math.min(state.width - 1, Math.floor(px / previewWidth * state.width));
        const src = row + srcX * bytesPerPixel;
        const dst = (py * previewWidth + px) * 4;
        preview[dst] = data[src];
        preview[dst + 1] = data[src + 1];
        preview[dst + 2] = data[src + 2];
        preview[dst + 3] = 255;
      }
    }
    buffer.unmap();
    buffer.destroy();
    const simReadback = await sampleSimReadback();
    return {
      ok: true,
      width: state.width,
      height: state.height,
      meanLuma: totalLuma / Math.max(1, samples),
      litPixels,
      fireLikePixels,
      smokeLikePixels,
      frameCount: state.frameCount,
      simStepCount: state.simStepCount,
      simGrid: state.simGrid,
      simReadback,
      effectiveRoute: state.effectiveRoute,
      prototypeIdentity: state.prototypeIdentity,
      backend: state.backend,
      preview: {
        width: previewWidth,
        height: previewHeight,
        rgba: Array.from(preview),
      },
    };
  }

  return {
    setControls(next) {
      controlsSnapshot = { ...controlsSnapshot, ...next };
    },
    async setActive(active) {
      if (active) {
        try {
          await ensureGpu();
          state.active = true;
          state.error = null;
          canvas.classList.add('active');
          cancelAnimationFrame(raf);
          raf = requestAnimationFrame(render);
          emitStatus({ phase: 'active' });
        } catch (err) {
          state.active = false;
          state.error = err?.message || String(err);
          state.backend = 'unavailable';
          canvas.classList.remove('active');
          emitStatus({ phase: 'error', error: state.error });
          throw err;
        }
      } else {
        state.active = false;
        canvas.classList.remove('active');
        cancelAnimationFrame(raf);
        emitStatus({ phase: 'inactive' });
      }
    },
    debugState() {
      return { ...state, controls: { ...controlsSnapshot } };
    },
    sampleFrame,
    dispose() {
      this.setActive(false);
      frameTexture?.destroy();
      for (const buffer of fluidBuffers) buffer.destroy();
      canvas.remove();
    },
  };
}
