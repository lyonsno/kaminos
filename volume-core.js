const ROUTE_IDENTITY = 'native-3d-procedural-raymarch-v0';
const PROTOTYPE_IDENTITY = 'kaminos-volume-prototype-v0';

const WGSL = /* wgsl */`
struct Uniforms {
  invViewProj: mat4x4<f32>,
  cameraPos_time: vec4<f32>,
  viewport_steps_density: vec4<f32>,
  fire_smoke_curl_speed: vec4<f32>,
};

@group(0) @binding(0) var<uniform> u: Uniforms;

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

fn noise3(p: vec3<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let w = f * f * (3.0 - 2.0 * f);
  let a = hash31(i + vec3<f32>(0.0, 0.0, 0.0));
  let b = hash31(i + vec3<f32>(1.0, 0.0, 0.0));
  let c = hash31(i + vec3<f32>(0.0, 1.0, 0.0));
  let d = hash31(i + vec3<f32>(1.0, 1.0, 0.0));
  let e = hash31(i + vec3<f32>(0.0, 0.0, 1.0));
  let f1 = hash31(i + vec3<f32>(1.0, 0.0, 1.0));
  let g = hash31(i + vec3<f32>(0.0, 1.0, 1.0));
  let h = hash31(i + vec3<f32>(1.0, 1.0, 1.0));
  let x1 = mix(a, b, w.x);
  let x2 = mix(c, d, w.x);
  let x3 = mix(e, f1, w.x);
  let x4 = mix(g, h, w.x);
  return mix(mix(x1, x2, w.y), mix(x3, x4, w.y), w.z);
}

fn fbm(p0: vec3<f32>) -> f32 {
  var p = p0;
  var a = 0.55;
  var v = 0.0;
  for (var i = 0; i < 5; i = i + 1) {
    v = v + a * noise3(p);
    p = p * 2.03 + vec3<f32>(17.1, 9.2, 4.7);
    a = a * 0.52;
  }
  return v;
}

fn rotate2(p: vec2<f32>, a: f32) -> vec2<f32> {
  let c = cos(a);
  let s = sin(a);
  return vec2<f32>(c * p.x - s * p.y, s * p.x + c * p.y);
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

fn field(p0: vec3<f32>, time: f32) -> vec4<f32> {
  let curl = u.fire_smoke_curl_speed.z;
  let speed = u.fire_smoke_curl_speed.w;
  let t = time * speed;
  let y = clamp((p0.y + 1.0) * 0.5, 0.0, 1.0);
  var p = p0;
  let rotatedP = rotate2(p.xz, 0.8 * sin(t * 0.31 + p.y * 2.1));
  p.x = rotatedP.x;
  p.z = rotatedP.y;
  let twist = curl * (1.2 + 2.4 * y) + t * (0.55 + y * 0.9);
  let q = vec3<f32>(rotate2(p.xz, twist).x, p.y, rotate2(p.xz, -twist * 0.7).y);
  let radial = length(q.xz);
  let curlNoise = fbm(q * vec3<f32>(3.3, 2.0, 3.3) + vec3<f32>(0.0, -t * 0.86, t * 0.24));
  let fineNoise = fbm(q * vec3<f32>(8.0, 5.6, 8.0) + vec3<f32>(t * 0.31, -t * 1.8, 4.0));
  let column = 1.0 - smoothstep(0.16, 0.92, radial + 0.12 * y - 0.08 * curlNoise);
  let neck = smoothstep(-0.96, -0.42, p.y);
  let vent = 1.0 - smoothstep(0.72, 1.08, p.y);
  let licks = smoothstep(0.18, 0.86, curlNoise + 0.38 * fineNoise - radial * 0.34);
  let pilot = exp(-radial * radial * 9.0) * smoothstep(-0.94, -0.16, p.y) * (1.0 - smoothstep(0.50, 0.98, p.y));
  let density = max(0.0, column * neck * vent * (0.18 + 1.15 * licks) + pilot * 0.55);
  let hotCore = (1.0 - smoothstep(0.03, 0.54, radial + y * 0.10)) * smoothstep(-0.95, -0.20, p.y);
  let filament = smoothstep(0.48, 0.86, fineNoise + curlNoise * 0.48);
  let temperature = clamp((hotCore * 0.82 + filament * column * 0.58 + pilot * 0.72) * (1.08 - y * 0.24), 0.0, 1.35);
  let smokeShell = smoothstep(0.26, 0.84, radial) * column * smoothstep(-0.32, 0.96, p.y);
  let smoke = (density * smoothstep(0.06, 0.92, y) + smokeShell * 0.42) * (0.50 + 0.76 * curlNoise);
  return vec4<f32>(density, temperature, smoke, curlNoise);
}

fn fireColor(temp: f32) -> vec3<f32> {
  let ember = vec3<f32>(0.85, 0.12, 0.015);
  let orange = vec3<f32>(1.0, 0.42, 0.055);
  let gold = vec3<f32>(1.0, 0.82, 0.22);
  let white = vec3<f32>(1.0, 0.96, 0.72);
  let a = mix(ember, orange, smoothstep(0.10, 0.45, temp));
  let b = mix(gold, white, smoothstep(0.75, 1.25, temp));
  return mix(a, b, smoothstep(0.38, 0.95, temp));
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
  let jitter = hash31(vec3<f32>(floor(in.uv * u.viewport_steps_density.xy), floor(u.cameraPos_time.w * 23.0))) * dt;
  var t = startT + jitter;
  var trans = 1.0;
  var color = vec3<f32>(0.004, 0.005, 0.006);
  var energy = 0.0;

  for (var i = 0; i < 192; i = i + 1) {
    if (f32(i) >= steps || trans < 0.015) { break; }
    let p = ro + rd * t;
    let sample = field(p, u.cameraPos_time.w);
    let density = sample.x * u.viewport_steps_density.w;
    let temp = sample.y * u.fire_smoke_curl_speed.x;
    let smoke = sample.z * u.fire_smoke_curl_speed.y;
    let alpha = clamp((density * 0.018 + smoke * 0.025) * dt * steps, 0.0, 0.12);
    let smokeCol = vec3<f32>(0.20, 0.29, 0.33) * (0.35 + 0.62 * sample.w);
    let flame = fireColor(temp) * temp * 1.05;
    let local = mix(smokeCol, flame, smoothstep(0.22, 0.78, temp));
    color = color + trans * alpha * local;
    trans = trans * (1.0 - alpha);
    energy = energy + alpha * (0.2 + temp);
    t = t + dt;
  }

  let vignette = 1.0 - smoothstep(0.22, 1.42, length(ndc));
  let exposed = vec3<f32>(1.0) - exp(-color * 0.92);
  let grade = exposed * (0.78 + 0.20 * vignette);
  return vec4<f32>(pow(max(grade, vec3<f32>(0.0)), vec3<f32>(0.82)), 1.0);
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
    lastFrameEnergy: 0,
    error: null,
  };

  let adapter = null;
  let device = null;
  let context = null;
  let pipeline = null;
  let readbackPipeline = null;
  let bindGroup = null;
  let bindGroupLayout = null;
  let uniformBuffer = null;
  let frameTexture = null;
  let frameTextureSize = '';
  let format = null;
  let raf = 0;
  let controlsSnapshot = getControls();

  function emitStatus(extra = {}) {
    onStatus?.({ ...state, ...extra });
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
      label: 'kaminos volume uniforms',
      size: uniforms.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const shader = device.createShaderModule({ label: 'kaminos volume raymarch wgsl', code: WGSL });
    const compilationInfo = await shader.getCompilationInfo();
    const compilationErrors = compilationInfo.messages.filter(message => message.type === 'error');
    if (compilationErrors.length > 0) {
      const detail = compilationErrors
        .map(message => `${message.lineNum}:${message.linePos} ${message.message}`)
        .join('\n');
      throw new Error(`WGSL compilation failed:\n${detail}`);
    }
    bindGroupLayout = device.createBindGroupLayout({
      label: 'kaminos volume bind group layout',
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform' },
      }],
    });
    const pipelineLayout = device.createPipelineLayout({
      label: 'kaminos volume pipeline layout',
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
    pipeline = makePipeline(format, 'kaminos volume canvas native-3d-procedural-raymarch-v0');
    const canvasPipelineError = await device.popErrorScope();
    if (canvasPipelineError) {
      throw new Error(`canvas pipeline validation: ${canvasPipelineError.message || String(canvasPipelineError)}`);
    }
    device.pushErrorScope('validation');
    readbackPipeline = makePipeline('rgba8unorm', 'kaminos volume readback native-3d-procedural-raymarch-v0');
    const readbackPipelineError = await device.popErrorScope();
    if (readbackPipelineError) {
      throw new Error(`readback pipeline validation: ${readbackPipelineError.message || String(readbackPipelineError)}`);
    }
    bindGroup = device.createBindGroup({
      label: 'kaminos volume bind group',
      layout: bindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
    });
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
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
  }

  function render(now) {
    if (!state.active) return;
    raf = requestAnimationFrame(render);
    controls?.update?.();
    updateUniforms(now);
    const encoder = device.createCommandEncoder({ label: 'kaminos volume frame' });
    encodeDraw(encoder, context.getCurrentTexture().createView(), 'kaminos volume canvas pass');
    device.queue.submit([encoder.finish()]);
    state.frameCount += 1;
    state.lastFrameEnergy = Math.min(9.999, 0.65 * controlsSnapshot.density + 0.55 * controlsSnapshot.fire + 0.28 * controlsSnapshot.smoke);
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
    return {
      ok: true,
      width: state.width,
      height: state.height,
      meanLuma: totalLuma / Math.max(1, samples),
      litPixels,
      fireLikePixels,
      smokeLikePixels,
      frameCount: state.frameCount,
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
      canvas.remove();
    },
  };
}
