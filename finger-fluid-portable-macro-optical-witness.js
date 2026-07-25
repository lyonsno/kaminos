import {
  KAMINOS_PORTABLE_MACRO_OPTICAL_RENDERER_ROUTE,
  createFingerFluidPortableMacroOpticalRenderPlan,
  createWebGPUFingerFluidPortableMacroOpticalRenderer,
} from './finger-fluid-portable-macro-optical-renderer.js';

const CYAN_DEBUG_ROUTE = 'kaminos/finger-fluid/portable-macro-cyan-debug-v0';
const widthSamples = 96;
const heightSamples = 72;
const sampleCount = widthSamples * heightSamples;
const canvas = document.getElementById('portable-macro-optics');
const status = document.getElementById('status');
const query = new URLSearchParams(window.location.search);
const requestedMode = query.get('mode') || 'optical';
const fixedTime = query.has('time') ? Number(query.get('time')) : null;
const paused = query.get('paused') === '1' || Number.isFinite(fixedTime);

let effectiveMode = null;
let renderer = null;
let context = null;
let device = null;
let format = null;
let sceneColorTexture = null;
let sceneDepthTexture = null;
let environmentTexture = null;
let scenePipeline = null;
let environmentPipeline = null;
let cyanPipeline = null;
let cyanUniformBuffer = null;
let cyanVertexBuffer = null;
let cyanIndexBuffer = null;
let cyanVertexCapacity = 0;
let cyanIndexCapacity = 0;
let frameCount = 0;
let lastEvidence = null;
let lastPlan = null;
let failure = null;
let startTime = performance.now();
let forcedTime = Number.isFinite(fixedTime) ? fixedTime : null;

window.kaminosPortableMacroOpticalDebugState = {
  status: 'initializing',
  requestedMode,
  effectiveMode: null,
  requestedRoute: requestedMode === 'optical'
    ? KAMINOS_PORTABLE_MACRO_OPTICAL_RENDERER_ROUTE
    : CYAN_DEBUG_ROUTE,
  effectiveRoute: null,
  fallback: null,
  frameCount: 0,
  primaryOutputWritten: false,
  blank: true,
  partial: true,
};

function publishDebugState() {
  window.kaminosPortableMacroOpticalDebugState = {
    schema: 'kaminos.finger-fluid.portable-macro-optical-browser-state.v0',
    status: failure ? 'error' : frameCount > 0 ? 'running' : 'initializing',
    requestedMode,
    effectiveMode,
    requestedRoute: requestedMode === 'optical'
      ? KAMINOS_PORTABLE_MACRO_OPTICAL_RENDERER_ROUTE
      : CYAN_DEBUG_ROUTE,
    effectiveRoute: effectiveMode === 'optical'
      ? KAMINOS_PORTABLE_MACRO_OPTICAL_RENDERER_ROUTE
      : effectiveMode === 'cyan' ? CYAN_DEBUG_ROUTE : null,
    fallback: null,
    backend: device ? 'webgpu' : null,
    frameCount,
    primaryOutputWritten: frameCount > 0,
    blank: frameCount === 0,
    partial: frameCount === 0,
    source: lastPlan?.source ?? null,
    host: lastPlan?.host ?? null,
    rendererEvidence: lastEvidence,
    animationTimeSeconds: forcedTime ?? Math.max(0, (performance.now() - startTime) / 1000),
    failure,
  };
  status.textContent = [
    `KAMINOS PORTABLE MACRO OPTICS`,
    `${requestedMode} -> ${effectiveMode ?? 'pending'} · ${device ? 'webgpu' : 'pending'}`,
    `${window.kaminosPortableMacroOpticalDebugState.effectiveRoute ?? 'no route'}`,
    `frame ${frameCount} · wet ${lastPlan?.wetSampleCount ?? 0}/${sampleCount}`,
    failure ? `FAILED: ${failure.message}` : 'source live · fallback none',
  ].join('\n');
  return window.kaminosPortableMacroOpticalDebugState;
}

function normalize(vector) {
  const length = Math.hypot(...vector);
  return vector.map(value => value / Math.max(length, 1e-9));
}

function subtract(a, b) {
  return a.map((value, index) => value - b[index]);
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot(a, b) {
  return a.reduce((sum, value, index) => sum + value * b[index], 0);
}

function lookAt(eye, target, up) {
  const z = normalize(subtract(eye, target));
  const x = normalize(cross(up, z));
  const y = cross(z, x);
  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -dot(x, eye), -dot(y, eye), -dot(z, eye), 1,
  ]);
}

function ortho(left, right, bottom, top, near, far) {
  return new Float32Array([
    2 / (right - left), 0, 0, 0,
    0, 2 / (top - bottom), 0, 0,
    0, 0, 1 / (near - far), 0,
    -(right + left) / (right - left),
    -(top + bottom) / (top - bottom),
    near / (near - far),
    1,
  ]);
}

function multiplyMat4(a, b) {
  const output = new Float32Array(16);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let value = 0;
      for (let index = 0; index < 4; index += 1) {
        value += a[index * 4 + row] * b[column * 4 + index];
      }
      output[column * 4 + row] = value;
    }
  }
  return output;
}

function inverseMat4(matrix) {
  const augmented = Array.from({ length: 4 }, (_, row) => [
    matrix[row], matrix[4 + row], matrix[8 + row], matrix[12 + row],
    row === 0 ? 1 : 0,
    row === 1 ? 1 : 0,
    row === 2 ? 1 : 0,
    row === 3 ? 1 : 0,
  ]);
  for (let pivot = 0; pivot < 4; pivot += 1) {
    let pivotRow = pivot;
    for (let row = pivot + 1; row < 4; row += 1) {
      if (Math.abs(augmented[row][pivot]) > Math.abs(augmented[pivotRow][pivot])) {
        pivotRow = row;
      }
    }
    [augmented[pivot], augmented[pivotRow]] = [augmented[pivotRow], augmented[pivot]];
    const divisor = augmented[pivot][pivot];
    if (Math.abs(divisor) < 1e-9) throw new Error('camera matrix is singular');
    augmented[pivot] = augmented[pivot].map(value => value / divisor);
    for (let row = 0; row < 4; row += 1) {
      if (row === pivot) continue;
      const factor = augmented[row][pivot];
      augmented[row] = augmented[row].map(
        (value, column) => value - factor * augmented[pivot][column],
      );
    }
  }
  const inverse = new Float32Array(16);
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      inverse[column * 4 + row] = augmented[row][4 + column];
    }
  }
  return inverse;
}

function cameraFrame() {
  const aspect = canvas.width / canvas.height;
  const eye = [7.2, 6.6, 8.8];
  const target = [0, -0.15, 0];
  const view = lookAt(eye, target, [0, 1, 0]);
  const projection = ortho(-5.4 * aspect, 5.4 * aspect, -5.4, 5.4, 0.1, 40);
  const viewProjection = multiplyMat4(projection, view);
  return {
    view,
    viewProjection,
    inverseViewProjection: inverseMat4(viewProjection),
    positionWorld: eye,
    nearMeters: 0.1,
    farMeters: 40,
  };
}

function makeSnapshot(timeSeconds) {
  const mappedDepth = new Float64Array(sampleCount);
  const mappedMomentumU = new Float64Array(sampleCount);
  const mappedMomentumV = new Float64Array(sampleCount);
  const supportPosition = new Float64Array(sampleCount * 3);
  const tangentU = new Float64Array(sampleCount * 3);
  const tangentV = new Float64Array(sampleCount * 3);
  const normal = new Float64Array(sampleCount * 3);
  const jacobian = new Float64Array(sampleCount);
  const supportVelocity = new Float64Array(sampleCount * 3);
  for (let row = 0; row < heightSamples; row += 1) {
    for (let column = 0; column < widthSamples; column += 1) {
      const index = row * widthSamples + column;
      const offset = index * 3;
      const x = (column / (widthSamples - 1) - 0.5) * 9.8;
      const z = (row / (heightSamples - 1) - 0.5) * 7.2;
      const terrain = -0.72
        + 0.08 * Math.sin(x * 0.62)
        + 0.055 * Math.cos(z * 0.88);
      const poolRadius = Math.hypot(x * 0.78, z);
      const pool = Math.max(0, 0.78 * (1 - (poolRadius / 3.45) ** 3));
      const channelCenter = -1.2 + 0.45 * Math.sin((x + timeSeconds * 0.35) * 0.65);
      const channel = Math.max(0, 0.42 - Math.abs(z - channelCenter) * 0.55)
        * Math.max(0, Math.min(1, (4.5 - x) / 2.2));
      const ring = 0.045 * Math.sin(poolRadius * 7.5 - timeSeconds * 2.4)
        * Math.exp(-Math.max(0, poolRadius - 0.5) * 0.45);
      const advected = 0.035 * Math.sin(x * 2.1 + z * 1.4 - timeSeconds * 1.7);
      const depth = Math.max(0, pool + channel + ring + advected - 0.08);
      mappedDepth[index] = depth;
      mappedMomentumU[index] = depth * (0.18 + 0.12 * Math.sin(z + timeSeconds));
      mappedMomentumV[index] = depth * 0.05 * Math.cos(x * 0.8 - timeSeconds);
      supportPosition.set([x, terrain, z], offset);
      tangentU.set([1, 0.05 * Math.cos(x * 0.62), 0], offset);
      tangentV.set([0, -0.048 * Math.sin(z * 0.88), 1], offset);
      normal.set([0, 1, 0], offset);
      jacobian[index] = 1;
    }
  }
  return {
    schema: 'kaminos.finger-fluid.portable-macro-upload-snapshot.v1',
    geometryIdentity: 'portable-macro-witness-geometry-v0',
    terrainId: 'portable-macro-witness-terrain-v0',
    sourceHandleId: 'portable-macro-witness-source-v0',
    source: {
      requested: 'kaminos/witness/live-macro-source',
      effective: 'kaminos/witness/live-macro-source',
      producerId: 'kaminos-portable-macro-witness',
      producerRevision: '79bc04fe4a0de0a1a751002d3e864611b44758ab',
    },
    producerRevision: '79bc04fe4a0de0a1a751002d3e864611b44758ab',
    fluidEpoch: Math.floor(timeSeconds * 60),
    terrainEpoch: 0,
    width: widthSamples,
    height: heightSamples,
    sampleCount,
    worldMetersPerUnit: 1,
    physicalMaterial: {
      densityKgM3: 998.2,
      dynamicViscosityPaS: 0.001,
      absorptionPerMeter: [0.23, 0.075, 0.032],
    },
    mappedDepth,
    mappedMomentumU,
    mappedMomentumV,
    materialMasses: {
      water: new Float64Array(sampleCount).fill(1),
    },
    supportPosition,
    tangentU,
    tangentV,
    normal,
    jacobian,
    supportVelocity,
    confidence: 1,
    dirtyRegions: [],
  };
}

function expectedIdentity(snapshot) {
  return {
    geometryIdentity: snapshot.geometryIdentity,
    terrainId: snapshot.terrainId,
    sourceHandleId: snapshot.sourceHandleId,
    source: { ...snapshot.source },
    producerRevision: snapshot.producerRevision,
    terrainEpoch: snapshot.terrainEpoch,
    fluidEpoch: snapshot.fluidEpoch,
  };
}

function hostFrame(frameId) {
  return {
    frameId,
    width: canvas.width,
    height: canvas.height,
    camera: cameraFrame(),
    sceneColor: {
      authority: 'host_live_frame',
      attachmentId: `${frameId}:scene-color`,
      frameId,
      width: canvas.width,
      height: canvas.height,
      format: 'rgba16float',
      colorSpace: 'linear_hdr',
    },
    sceneDepth: {
      authority: 'host_live_frame',
      attachmentId: `${frameId}:scene-depth`,
      frameId,
      width: canvas.width,
      height: canvas.height,
      format: 'r32float',
      encoding: 'linear_view_depth_meters',
    },
    environment: {
      authority: 'host_live_frame',
      attachmentId: `${frameId}:environment`,
      frameId,
      width: 512,
      height: 256,
      format: 'rgba16float',
      mapping: 'equirectangular_world_radiance',
    },
    target: {
      authority: 'host_live_frame',
      attachmentId: `${frameId}:target`,
      frameId,
      width: canvas.width,
      height: canvas.height,
      format,
    },
  };
}

function createScenePipeline() {
  const shader = device.createShaderModule({
    label: 'portable-macro-witness-scene-shader-live',
    code: `
struct Output {
  @location(0) display: vec4<f32>,
  @location(1) linear: vec4<f32>,
  @location(2) depth: f32,
};

@vertex
fn vertexMain(@builtin(vertex_index) index: u32) -> @builtin(position) vec4<f32> {
  let positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(3.0, -1.0),
    vec2<f32>(-1.0, 3.0)
  );
  return vec4<f32>(positions[index], 0.0, 1.0);
}

@fragment
fn fragmentMain(@builtin(position) position: vec4<f32>) -> Output {
  let dimensions = vec2<f32>(${canvas.width}.0, ${canvas.height}.0);
  let uv = position.xy / dimensions;
  let centered = uv - vec2<f32>(0.5);
  let floorBase = mix(vec3<f32>(0.055, 0.075, 0.065), vec3<f32>(0.28, 0.34, 0.25), 1.0 - uv.y);
  let gridX = 1.0 - smoothstep(0.025, 0.06, abs(fract(uv.x * 18.0) - 0.5));
  let gridY = 1.0 - smoothstep(0.025, 0.06, abs(fract(uv.y * 12.0) - 0.5));
  var color = floorBase + vec3<f32>(0.14, 0.17, 0.12) * max(gridX, gridY) * 0.28;
  var depth = 18.0 + centered.y * 3.0;
  let obstacle = abs(centered.x - 0.10) < 0.075 && abs(centered.y + 0.015) < 0.25;
  if (obstacle) {
    color = vec3<f32>(0.48, 0.025, 0.018) * (0.7 + uv.y * 0.45);
    depth = 7.2;
  }
  let gold = distance(centered, vec2<f32>(0.31, -0.02)) < 0.11;
  if (gold) {
    color = vec3<f32>(0.78, 0.37, 0.045) * (0.75 + uv.y);
    depth = 6.8;
  }
  let display = pow(color / (vec3<f32>(1.0) + color), vec3<f32>(1.0 / 2.2));
  return Output(vec4<f32>(display, 1.0), vec4<f32>(color, 1.0), depth);
}
`,
  });
  return device.createRenderPipeline({
    label: 'portable-macro-witness-scene-pipeline',
    layout: 'auto',
    vertex: { module: shader, entryPoint: 'vertexMain' },
    fragment: {
      module: shader,
      entryPoint: 'fragmentMain',
      targets: [
        { format },
        { format: 'rgba16float' },
        { format: 'r32float' },
      ],
    },
    primitive: { topology: 'triangle-list' },
  });
}

function createEnvironmentPipeline() {
  const shader = device.createShaderModule({
    label: 'portable-macro-witness-environment-shader',
    code: `
@vertex
fn vertexMain(@builtin(vertex_index) index: u32) -> @builtin(position) vec4<f32> {
  let positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(3.0, -1.0),
    vec2<f32>(-1.0, 3.0)
  );
  return vec4<f32>(positions[index], 0.0, 1.0);
}

@fragment
fn fragmentMain(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
  let uv = position.xy / vec2<f32>(512.0, 256.0);
  let sky = mix(vec3<f32>(0.035, 0.11, 0.19), vec3<f32>(0.88, 1.35, 1.7), pow(1.0 - uv.y, 1.6));
  let studio = exp(-dot(uv - vec2<f32>(0.72, 0.34), uv - vec2<f32>(0.72, 0.34)) * 95.0) * 6.5;
  let rim = exp(-dot(uv - vec2<f32>(0.18, 0.52), uv - vec2<f32>(0.18, 0.52)) * 150.0) * 3.0;
  return vec4<f32>(sky + vec3<f32>(studio) + vec3<f32>(0.32, 0.62, 1.0) * rim, 1.0);
}
`,
  });
  return device.createRenderPipeline({
    label: 'portable-macro-witness-environment-pipeline',
    layout: 'auto',
    vertex: { module: shader, entryPoint: 'vertexMain' },
    fragment: {
      module: shader,
      entryPoint: 'fragmentMain',
      targets: [{ format: 'rgba16float' }],
    },
    primitive: { topology: 'triangle-list' },
  });
}

function createCyanPipeline() {
  const shader = device.createShaderModule({
    label: 'portable-macro-cyan-debug-shader',
    code: `
struct Camera {
  viewProjection: mat4x4<f32>,
};
struct VertexInput {
  @location(0) positionWorld: vec3<f32>,
  @location(1) normalWorld: vec3<f32>,
  @location(2) optics: vec4<f32>,
  @location(3) support: vec2<f32>,
};
struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) normalWorld: vec3<f32>,
  @location(1) wet: f32,
};
@group(0) @binding(0) var<uniform> camera: Camera;
@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;
  output.position = camera.viewProjection * vec4<f32>(input.positionWorld, 1.0);
  output.normalWorld = input.normalWorld;
  output.wet = input.support.y;
  return output;
}
@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  if (input.wet <= 0.005) { discard; }
  let light = 0.48 + 0.52 * max(0.0, dot(normalize(input.normalWorld), normalize(vec3<f32>(0.3, 0.85, 0.4))));
  return vec4<f32>(vec3<f32>(0.025, 0.63, 0.78) * light, 1.0);
}
`,
  });
  const layout = device.createBindGroupLayout({
    entries: [{
      binding: 0,
      visibility: GPUShaderStage.VERTEX,
      buffer: { type: 'uniform' },
    }],
  });
  cyanUniformBuffer = device.createBuffer({
    size: 64,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  return {
    layout,
    pipeline: device.createRenderPipeline({
      label: 'portable-macro-cyan-debug-pipeline',
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      vertex: {
        module: shader,
        entryPoint: 'vertexMain',
        buffers: [{
          arrayStride: 48,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },
            { shaderLocation: 1, offset: 12, format: 'float32x3' },
            { shaderLocation: 2, offset: 24, format: 'float32x4' },
            { shaderLocation: 3, offset: 40, format: 'float32x2' },
          ],
        }],
      },
      fragment: {
        module: shader,
        entryPoint: 'fragmentMain',
        targets: [{ format }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
    }),
  };
}

function ensureCyanBuffers(plan) {
  if (plan.vertices.byteLength > cyanVertexCapacity) {
    cyanVertexBuffer?.destroy();
    cyanVertexCapacity = plan.vertices.byteLength;
    cyanVertexBuffer = device.createBuffer({
      size: cyanVertexCapacity,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
  }
  if (plan.indices.byteLength > cyanIndexCapacity) {
    cyanIndexBuffer?.destroy();
    cyanIndexCapacity = plan.indices.byteLength;
    cyanIndexBuffer = device.createBuffer({
      size: cyanIndexCapacity,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
  }
}

function resizeTextures() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.floor(window.innerWidth * dpr));
  const height = Math.max(1, Math.floor(window.innerHeight * dpr));
  if (canvas.width === width && canvas.height === height && sceneColorTexture) return;
  canvas.width = width;
  canvas.height = height;
  context.configure({
    device,
    format,
    alphaMode: 'opaque',
  });
  sceneColorTexture?.destroy();
  sceneDepthTexture?.destroy();
  sceneColorTexture = device.createTexture({
    label: 'portable-macro-host-scene-color',
    size: [width, height],
    format: 'rgba16float',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  sceneDepthTexture = device.createTexture({
    label: 'portable-macro-host-scene-linear-depth',
    size: [width, height],
    format: 'r32float',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  scenePipeline = createScenePipeline();
}

function renderBaseScene(encoder, targetView) {
  const pass = encoder.beginRenderPass({
    label: 'portable-macro-host-scene-pass',
    colorAttachments: [
      {
        view: targetView,
        clearValue: [0.02, 0.03, 0.025, 1],
        loadOp: 'clear',
        storeOp: 'store',
      },
      {
        view: sceneColorTexture.createView(),
        clearValue: [0, 0, 0, 1],
        loadOp: 'clear',
        storeOp: 'store',
      },
      {
        view: sceneDepthTexture.createView(),
        clearValue: { r: 40, g: 0, b: 0, a: 0 },
        loadOp: 'clear',
        storeOp: 'store',
      },
    ],
  });
  pass.setPipeline(scenePipeline);
  pass.draw(3);
  pass.end();
}

function renderCyan(plan, encoder, targetView) {
  ensureCyanBuffers(plan);
  device.queue.writeBuffer(cyanVertexBuffer, 0, plan.vertices);
  device.queue.writeBuffer(cyanIndexBuffer, 0, plan.indices);
  device.queue.writeBuffer(cyanUniformBuffer, 0, plan.camera.viewProjection);
  const bindGroup = device.createBindGroup({
    layout: cyanPipeline.layout,
    entries: [{ binding: 0, resource: { buffer: cyanUniformBuffer } }],
  });
  const pass = encoder.beginRenderPass({
    label: 'portable-macro-cyan-debug-pass',
    colorAttachments: [{
      view: targetView,
      loadOp: 'load',
      storeOp: 'store',
    }],
  });
  pass.setPipeline(cyanPipeline.pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.setVertexBuffer(0, cyanVertexBuffer);
  pass.setIndexBuffer(cyanIndexBuffer, 'uint32');
  pass.drawIndexed(plan.indexCount);
  pass.end();
  return {
    schema: 'kaminos.finger-fluid.portable-macro-cyan-debug-evidence.v0',
    requestedRoute: CYAN_DEBUG_ROUTE,
    effectiveRoute: CYAN_DEBUG_ROUTE,
    fallback: null,
    frameCount: frameCount + 1,
    primaryCommandEncoded: true,
    primaryOutputWritten: false,
    blank: false,
    partial: false,
  };
}

function renderFrame(timestamp) {
  if (failure) return;
  try {
    resizeTextures();
    const timeSeconds = forcedTime ?? Math.max(0, (timestamp - startTime) / 1000);
    const snapshot = makeSnapshot(timeSeconds);
    const frameId = `portable-macro-witness-frame-${snapshot.fluidEpoch}`;
    const frame = hostFrame(frameId);
    const plan = createFingerFluidPortableMacroOpticalRenderPlan({
      snapshot,
      expectedIdentity: expectedIdentity(snapshot),
      hostFrame: frame,
    });
    const targetView = context.getCurrentTexture().createView();
    const encoder = device.createCommandEncoder({
      label: `portable-macro-witness-frame-${frameCount}`,
    });
    renderBaseScene(encoder, targetView);
    lastEvidence = effectiveMode === 'optical'
      ? renderer.render({
        plan,
        commandEncoder: encoder,
        target: { ...frame.target, view: targetView },
        sceneColor: { ...frame.sceneColor, view: sceneColorTexture.createView() },
        sceneDepth: { ...frame.sceneDepth, view: sceneDepthTexture.createView() },
        environment: { ...frame.environment, view: environmentTexture.createView() },
      })
      : renderCyan(plan, encoder, targetView);
    device.queue.submit([encoder.finish()]);
    lastEvidence = Object.freeze({
      ...lastEvidence,
      hostSubmissionAccepted: true,
    });
    lastPlan = plan;
    frameCount += 1;
    publishDebugState();
    if (!paused) window.requestAnimationFrame(renderFrame);
  } catch (error) {
    failure = {
      message: error?.message || String(error),
      report: error?.report ?? null,
    };
    publishDebugState();
    console.error(error);
  }
}

async function initialize() {
  if (!navigator.gpu) throw new Error('navigator.gpu unavailable');
  if (!['optical', 'cyan'].includes(requestedMode)) {
    throw new Error(`unsupported witness mode: ${requestedMode}`);
  }
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('WebGPU adapter unavailable');
  device = await adapter.requestDevice();
  window.__kaminosPortableMacroDevice = device;
  device.addEventListener('uncapturederror', event => {
    failure = {
      message: event.error?.message || 'uncaptured WebGPU validation error',
      report: null,
    };
    publishDebugState();
    console.error(event.error);
  });
  device.lost.then(info => {
    failure = {
      message: `WebGPU device lost: ${info.message || info.reason}`,
      report: null,
    };
    publishDebugState();
    console.error(failure.message);
  });
  context = canvas.getContext('webgpu');
  if (!context) throw new Error('WebGPU canvas context unavailable');
  format = navigator.gpu.getPreferredCanvasFormat();
  effectiveMode = requestedMode;
  renderer = createWebGPUFingerFluidPortableMacroOpticalRenderer({
    device,
    colorFormat: format,
  });
  environmentTexture = device.createTexture({
    label: 'portable-macro-host-environment',
    size: [512, 256],
    format: 'rgba16float',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  environmentPipeline = createEnvironmentPipeline();
  const environmentEncoder = device.createCommandEncoder();
  const environmentPass = environmentEncoder.beginRenderPass({
    colorAttachments: [{
      view: environmentTexture.createView(),
      clearValue: [0, 0, 0, 1],
      loadOp: 'clear',
      storeOp: 'store',
    }],
  });
  environmentPass.setPipeline(environmentPipeline);
  environmentPass.draw(3);
  environmentPass.end();
  device.queue.submit([environmentEncoder.finish()]);
  cyanPipeline = createCyanPipeline();
  window.addEventListener('resize', () => {
    sceneColorTexture?.destroy();
    sceneDepthTexture?.destroy();
    sceneColorTexture = null;
    sceneDepthTexture = null;
  });
  window.kaminosPortableMacroSetModeForWitness = mode => {
    if (!['optical', 'cyan'].includes(mode)) throw new Error(`unsupported witness mode: ${mode}`);
    effectiveMode = mode;
    renderFrame(performance.now());
    return publishDebugState();
  };
  window.kaminosPortableMacroSetTimeForWitness = timeSeconds => {
    if (!Number.isFinite(timeSeconds) || timeSeconds < 0) {
      throw new Error('witness time must be finite and nonnegative');
    }
    forcedTime = timeSeconds;
    renderFrame(performance.now());
    return publishDebugState();
  };
  window.kaminosPortableMacroRenderForWitness = () => {
    renderFrame(performance.now());
    return publishDebugState();
  };
  publishDebugState();
  window.requestAnimationFrame(renderFrame);
}

initialize().catch((error) => {
  failure = {
    message: error?.message || String(error),
    report: error?.report ?? null,
  };
  publishDebugState();
  console.error(error);
});
