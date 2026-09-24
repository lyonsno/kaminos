import {
  KAMINOS_FINGER_FLUID_FIXED_STEP_SECONDS,
  KAMINOS_FINGER_FLUID_MOVING_HILL_HOST_FRAME_ENCODE_EVIDENCE_SCHEMA,
  KAMINOS_FINGER_FLUID_MOVING_HILL_HOST_FRAME_ROUTE,
  KAMINOS_FINGER_FLUID_MOVING_HILL_HOST_FRAME_SCHEMA,
  KAMINOS_FINGER_FLUID_MOVING_HILL_PRESENTATION_MODE,
  KAMINOS_FINGER_FLUID_MOVING_HILL_PRESENTATION_ROUTE,
  KAMINOS_FINGER_FLUID_MOVING_HILL_SUPPORT_CONTACT_ROUTE,
  createFingerFluidPerspectiveOrbitCamera,
  createFingerFluidMovingHillSupportContactProvider,
  createWebGPUFingerFluidSolver,
} from './finger-fluid-webgpu-core.js';

const WITNESS_SCHEMA = 'kaminos.finger-fluid.moving-hill-support-browser-witness.v0';
const SYNTHETIC_SOURCE_ID = 'kaminos-moving-hill-canonical-frame-witness';
const TERRAIN_ID = 'synthetic-moving-hill-support-49x49';
const GRID_WIDTH = 49;
const GRID_HEIGHT = 49;
const GRID_SPACING = 6.8 / (GRID_WIDTH - 1);
const GRID_ORIGIN = [-3.4, 0, -3.4];
const SUPPORT_UPDATE_INTERVAL = 4;
const HOST_DEVICE_IDENTITY = 'kaminos-moving-hill-support-witness-device';
const HOST_PIPELINE_IDENTITY = 'kaminos-moving-hill-support-witness-host-pipeline-v0';
const ENVIRONMENT_WIDTH = 512;
const ENVIRONMENT_HEIGHT = 256;
const query = new URLSearchParams(window.location.search);
const composedRevision = query.get('composed_revision');
const canvas = document.getElementById('moving-hill-support');
const status = document.getElementById('status');

let device = null;
let context = null;
let canvasFormat = null;
let solver = null;
let provider = null;
let sceneColorTexture = null;
let sceneDepthTexture = null;
let environmentTexture = null;
let liquidTargetTexture = null;
let hostScenePipeline = null;
let hostEnvironmentPipeline = null;
let hostFinalPresentationPipeline = null;
let hostFinalPresentationBindGroup = null;
let frameCount = 0;
let supportWriteCount = 0;
let terrainEpoch = 1;
let startTime = performance.now();
let failure = null;
let negativeParticleWitness = null;
let lastHostEncodeEvidence = null;
let lastHostSubmissionEvidence = null;

window.kaminosMovingHillSupportWitnessState = {
  schema: WITNESS_SCHEMA,
  status: 'initializing',
  requestedRoute: KAMINOS_FINGER_FLUID_MOVING_HILL_SUPPORT_CONTACT_ROUTE,
  effectiveRoute: null,
  fallbackRoute: null,
  backend: null,
  evidenceScope: 'synthetic_canonical_frame_contract_witness_not_lerms_source_authority',
  primaryOutputWritten: false,
  blank: true,
  partial: true,
};

function publishState() {
  const debug = solver?.getDebugState?.() || null;
  const support = debug?.supportContact || null;
  const effectiveRoute = support?.route || null;
  const fallbackRoute = support?.fallbackRoute ?? null;
  const routeExact = (
    effectiveRoute === KAMINOS_FINGER_FLUID_MOVING_HILL_SUPPORT_CONTACT_ROUTE
    && fallbackRoute === null
  );
  const presentation = debug?.presentationEvidence || null;
  const camera = debug?.cameraEvidence || null;
  const hostEncode = debug?.hostFrameCompositionEvidence || lastHostEncodeEvidence;
  const presentationExact = (
    presentation?.requestedMode === KAMINOS_FINGER_FLUID_MOVING_HILL_PRESENTATION_MODE
    && presentation?.effectiveMode === KAMINOS_FINGER_FLUID_MOVING_HILL_PRESENTATION_MODE
    && presentation?.route === KAMINOS_FINGER_FLUID_MOVING_HILL_PRESENTATION_ROUTE
    && presentation?.fallbackReason === null
    && presentation?.nonParticleToyDrawCount === 0
  );
  const cameraExact = (
    camera?.authority === 'consumer_external_exact_v0'
    && camera?.identity === 'kaminos-moving-hill-support-witness-camera'
    && camera?.fallbackReason === null
  );
  const negativeWitnessExact = (
    negativeParticleWitness?.particleVisibility === 'hidden'
    && negativeParticleWitness?.particleDrawCount === 0
    && negativeParticleWitness?.nonParticleToyDrawCount === 0
  );
  const hostEncodeExact = (
    hostEncode?.schema === KAMINOS_FINGER_FLUID_MOVING_HILL_HOST_FRAME_ENCODE_EVIDENCE_SCHEMA
    && hostEncode?.requestedRoute === KAMINOS_FINGER_FLUID_MOVING_HILL_HOST_FRAME_ROUTE
    && hostEncode?.effectiveRoute === KAMINOS_FINGER_FLUID_MOVING_HILL_HOST_FRAME_ROUTE
    && hostEncode?.fallback === null
    && hostEncode?.deviceIdentity === HOST_DEVICE_IDENTITY
    && hostEncode?.pipelineIdentity === HOST_PIPELINE_IDENTITY
    && hostEncode?.primaryCommandEncoded === true
    && hostEncode?.primaryOutputWritten === false
    && hostEncode?.submittedBySolver === false
    && hostEncode?.presentedBySolver === false
  );
  const hostSubmissionExact = (
    lastHostSubmissionEvidence?.schema
      === 'kaminos.finger-fluid.moving-hill-host-frame-submission-evidence.v0'
    && lastHostSubmissionEvidence?.hostFrameId === hostEncode?.hostFrameId
    && lastHostSubmissionEvidence?.hostSubmissionAccepted === true
    && lastHostSubmissionEvidence?.hostFinalPresentationCount === 1
    && lastHostSubmissionEvidence?.primaryOutputWritten === true
    && lastHostSubmissionEvidence?.blank === false
    && lastHostSubmissionEvidence?.partial === false
  );
  const complete = frameCount > 0
    && routeExact
    && presentationExact
    && cameraExact
    && negativeWitnessExact
    && hostEncodeExact
    && hostSubmissionExact;
  window.kaminosMovingHillSupportWitnessState = {
    schema: WITNESS_SCHEMA,
    status: failure ? 'error' : complete ? 'running' : 'initializing',
    requestedRoute: KAMINOS_FINGER_FLUID_MOVING_HILL_SUPPORT_CONTACT_ROUTE,
    effectiveRoute,
    fallbackRoute,
    requestedPresentationMode: KAMINOS_FINGER_FLUID_MOVING_HILL_PRESENTATION_MODE,
    effectivePresentationMode: presentation?.effectiveMode ?? null,
    effectivePresentationRoute: presentation?.route ?? null,
    presentationEvidence: presentation,
    cameraEvidence: camera,
    hostFrameCompositionEvidence: hostEncode,
    hostSubmissionEvidence: lastHostSubmissionEvidence,
    negativeParticleWitness,
    backend: debug?.solver_backend || null,
    evidenceScope: 'synthetic_canonical_frame_contract_witness_not_lerms_source_authority',
    sourceAuthority: 'synthetic_fixture_only',
    composedRevision,
    frameCount,
    supportWriteCount,
    terrainEpoch: support?.terrainEpoch ?? null,
    supportEpoch: support?.supportEpoch ?? null,
    remapEpoch: support?.remapEpoch ?? null,
    deviceMatchesSolver: support?.deviceMatchesSolver ?? false,
    hostReadbackVisibility: support?.hostReadbackVisibility ?? null,
    primaryOutputWritten: complete,
    blank: frameCount === 0,
    partial: !complete,
    failure,
  };
  status.textContent = [
    'KAMINOS MOVING HILL SUPPORT',
    `${window.kaminosMovingHillSupportWitnessState.backend || 'pending'} · frame ${frameCount}`,
    `${effectiveRoute || 'route pending'}`,
    `terrain ${support?.terrainEpoch ?? '-'} · support ${support?.supportEpoch ?? '-'} · remap ${support?.remapEpoch ?? '-'}`,
    `same device ${support?.deviceMatchesSolver === true ? 'yes' : 'no'} · fallback ${fallbackRoute ?? 'none'}`,
    `${presentation?.route || 'presentation pending'} · toys ${presentation?.nonParticleToyDrawCount ?? '-'}`,
    `${camera?.identity || 'camera pending'} · generation ${camera?.generation ?? '-'}`,
    `particle negative ${negativeWitnessExact ? 'exact' : 'pending'}`,
    `host encode ${hostEncodeExact ? 'exact' : 'pending'} · host submit ${hostSubmissionExact ? 'exact' : 'pending'}`,
    'synthetic canonical frame witness · not LERMS source authority',
    failure
      ? `FAILED: ${failure.message}`
      : 'host scene + fluid append + host presentation · GPU contact · no host readback',
  ].join('\n');
  return window.kaminosMovingHillSupportWitnessState;
}

function terrainHeightAndDerivatives(x, z, timeSeconds) {
  const phaseA = x * 0.68 + timeSeconds * 1.1;
  const phaseB = z * 0.55 - timeSeconds * 0.8;
  const phaseC = (x + z) * 0.42 - timeSeconds * 0.7;
  const sinA = Math.sin(phaseA);
  const cosA = Math.cos(phaseA);
  const sinB = Math.sin(phaseB);
  const cosB = Math.cos(phaseB);
  const sinC = Math.sin(phaseC);
  const cosC = Math.cos(phaseC);
  return {
    height: -0.82 + 0.18 * sinA * cosB + 0.13 * sinC,
    dx: 0.18 * 0.68 * cosA * cosB + 0.13 * 0.42 * cosC,
    dz: -0.18 * 0.55 * sinA * sinB + 0.13 * 0.42 * cosC,
    dyDt: 0.18 * (1.1 * cosA * cosB + 0.8 * sinA * sinB) - 0.13 * 0.7 * cosC,
  };
}

function createTerrainFrame(timeSeconds, currentEpoch, priorEpoch) {
  const sampleCount = GRID_WIDTH * GRID_HEIGHT;
  const worldPosition = new Float64Array(sampleCount * 3);
  const bedHeight = new Float64Array(sampleCount);
  const jacobian = new Float64Array(sampleCount);
  const gradient = new Float64Array(sampleCount * 2);
  const tangentU = new Float64Array(sampleCount * 3);
  const tangentV = new Float64Array(sampleCount * 3);
  const normal = new Float64Array(sampleCount * 3);
  const supportVelocity = new Float64Array(sampleCount * 3);
  const valid = new Uint8Array(sampleCount);
  for (let row = 0; row < GRID_HEIGHT; row += 1) {
    for (let column = 0; column < GRID_WIDTH; column += 1) {
      const index = row * GRID_WIDTH + column;
      const vectorOffset = index * 3;
      const gradientOffset = index * 2;
      const x = GRID_ORIGIN[0] + column * GRID_SPACING;
      const z = GRID_ORIGIN[2] + row * GRID_SPACING;
      const sample = terrainHeightAndDerivatives(x, z, timeSeconds);
      const normalLength = Math.hypot(sample.dx, 1, sample.dz);
      worldPosition.set([x, sample.height, z], vectorOffset);
      bedHeight[index] = sample.height;
      jacobian[index] = Math.hypot(1, sample.dx, sample.dz);
      gradient.set([sample.dx, sample.dz], gradientOffset);
      tangentU.set([1, sample.dx, 0], vectorOffset);
      tangentV.set([0, sample.dz, 1], vectorOffset);
      normal.set([-sample.dx / normalLength, 1 / normalLength, -sample.dz / normalLength], vectorOffset);
      supportVelocity.set([0, sample.dyDt, 0], vectorOffset);
      valid[index] = 1;
    }
  }
  return {
    schema: 'kaminos.fluid.terrain-fluid-frame.v1',
    route: 'lerms/hill-of-hills/terrain-fluid-frame-v1',
    producer: {
      id: 'kaminos-moving-hill-support-witness',
      revision: composedRevision,
    },
    source: {
      requested: SYNTHETIC_SOURCE_ID,
      effective: SYNTHETIC_SOURCE_ID,
    },
    worldMetersPerUnit: 1,
    gravity: [0, -9.81, 0],
    terrainId: TERRAIN_ID,
    supportClass: 'heightfield',
    transformId: 'synthetic-moving-hill-world-frame',
    priorEpoch,
    currentEpoch,
    motionClass: 'deforming_heightfield',
    shockId: null,
    grid: {
      width: GRID_WIDTH,
      height: GRID_HEIGHT,
      spacing: [GRID_SPACING, GRID_SPACING],
      origin: [...GRID_ORIGIN],
    },
    fields: {
      worldPosition,
      bedHeight,
      jacobian,
      gradient,
      tangentU,
      tangentV,
      normal,
      supportVelocity,
      valid,
    },
    dirtyRegions: [{ x: 0, y: 0, width: GRID_WIDTH, height: GRID_HEIGHT }],
    complete: true,
    expectedSampleCount: sampleCount,
    actualSampleCount: sampleCount,
  };
}

function providerIdentity(frame, supportEpoch) {
  return {
    sourceId: SYNTHETIC_SOURCE_ID,
    terrainId: TERRAIN_ID,
    terrainEpoch: frame.currentEpoch,
    supportEpoch,
    remapEpoch: 1,
    stale: false,
    fallbackRoute: null,
  };
}

function createFullscreenShader(fragmentSource, label) {
  return device.createShaderModule({
    label,
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

${fragmentSource}
`,
  });
}

function createHostScenePipeline() {
  const module = createFullscreenShader(`
struct HostSceneOutput {
  @location(0) sceneColor: vec4<f32>,
  @location(1) liquidTarget: vec4<f32>,
  @location(2) linearViewDepthMeters: f32,
};

@fragment
fn fragmentMain(@builtin(position) position: vec4<f32>) -> HostSceneOutput {
  let extent = vec2<f32>(${canvas.width}.0, ${canvas.height}.0);
  let uv = position.xy / extent;
  let centered = uv - vec2<f32>(0.5);
  let horizon = smoothstep(-0.18, 0.62, centered.y);
  let gridX = 1.0 - smoothstep(0.025, 0.055, abs(fract(uv.x * 20.0) - 0.5));
  let gridY = 1.0 - smoothstep(0.025, 0.055, abs(fract(uv.y * 13.0) - 0.5));
  let grid = max(gridX, gridY);
  let base = mix(vec3<f32>(0.075, 0.095, 0.082), vec3<f32>(0.018, 0.04, 0.055), horizon);
  let hillGlow = exp(-dot(centered - vec2<f32>(0.18, -0.02), centered - vec2<f32>(0.18, -0.02)) * 7.0);
  let color = base + vec3<f32>(0.09, 0.13, 0.095) * grid * 0.32
    + vec3<f32>(0.12, 0.22, 0.16) * hillGlow;
  var output: HostSceneOutput;
  output.sceneColor = vec4<f32>(color, 1.0);
  output.liquidTarget = vec4<f32>(color, 1.0);
  output.linearViewDepthMeters = 28.0;
  return output;
}
`, 'moving-hill-host-scene-shader');
  return device.createRenderPipeline({
    label: 'moving-hill-host-scene-pipeline',
    layout: 'auto',
    vertex: { module, entryPoint: 'vertexMain' },
    fragment: {
      module,
      entryPoint: 'fragmentMain',
      targets: [
        { format: 'rgba16float' },
        { format: 'rgba16float' },
        { format: 'r32float' },
      ],
    },
    primitive: { topology: 'triangle-list' },
  });
}

function createHostEnvironmentPipeline() {
  const module = createFullscreenShader(`
@fragment
fn fragmentMain(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
  let uv = position.xy / vec2<f32>(${ENVIRONMENT_WIDTH}.0, ${ENVIRONMENT_HEIGHT}.0);
  let sky = mix(
    vec3<f32>(0.025, 0.085, 0.16),
    vec3<f32>(0.72, 1.05, 1.42),
    pow(1.0 - uv.y, 1.45)
  );
  let keyDelta = uv - vec2<f32>(0.72, 0.30);
  let rimDelta = uv - vec2<f32>(0.17, 0.55);
  let key = exp(-dot(keyDelta, keyDelta) * 110.0) * 7.0;
  let rim = exp(-dot(rimDelta, rimDelta) * 155.0) * 2.8;
  return vec4<f32>(sky + vec3<f32>(key) + vec3<f32>(0.22, 0.48, 0.9) * rim, 1.0);
}
`, 'moving-hill-host-environment-shader');
  return device.createRenderPipeline({
    label: 'moving-hill-host-environment-pipeline',
    layout: 'auto',
    vertex: { module, entryPoint: 'vertexMain' },
    fragment: {
      module,
      entryPoint: 'fragmentMain',
      targets: [{ format: 'rgba16float' }],
    },
    primitive: { topology: 'triangle-list' },
  });
}

function createHostFinalPresentationPipeline() {
  const module = createFullscreenShader(`
@group(0) @binding(0) var linearHdrTarget: texture_2d<f32>;

fn aces(color: vec3<f32>) -> vec3<f32> {
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  return clamp((color * (a * color + b)) / (color * (c * color + d) + e), vec3<f32>(0.0), vec3<f32>(1.0));
}

@fragment
fn fragmentMain(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
  let pixel = vec2<i32>(position.xy);
  let hdr = max(textureLoad(linearHdrTarget, pixel, 0).rgb, vec3<f32>(0.0));
  let display = pow(aces(hdr), vec3<f32>(1.0 / 2.2));
  return vec4<f32>(display, 1.0);
}
`, 'moving-hill-host-final-presentation-shader');
  return device.createRenderPipeline({
    label: 'moving-hill-host-final-presentation-pipeline',
    layout: 'auto',
    vertex: { module, entryPoint: 'vertexMain' },
    fragment: {
      module,
      entryPoint: 'fragmentMain',
      targets: [{ format: canvasFormat }],
    },
    primitive: { topology: 'triangle-list' },
  });
}

function destroyHostAttachments() {
  sceneColorTexture?.destroy();
  sceneDepthTexture?.destroy();
  liquidTargetTexture?.destroy();
  sceneColorTexture = null;
  sceneDepthTexture = null;
  liquidTargetTexture = null;
  hostFinalPresentationBindGroup = null;
}

function resizeHostAttachments() {
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.floor(canvas.clientWidth * pixelRatio));
  const height = Math.max(1, Math.floor(canvas.clientHeight * pixelRatio));
  if (
    canvas.width === width
    && canvas.height === height
    && sceneColorTexture
    && sceneDepthTexture
    && liquidTargetTexture
  ) {
    return;
  }
  canvas.width = width;
  canvas.height = height;
  context.configure({
    device,
    format: canvasFormat,
    alphaMode: 'opaque',
  });
  destroyHostAttachments();
  sceneColorTexture = device.createTexture({
    label: 'moving-hill-host-scene-color',
    size: [width, height],
    format: 'rgba16float',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  sceneDepthTexture = device.createTexture({
    label: 'moving-hill-host-scene-linear-depth',
    size: [width, height],
    format: 'r32float',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  liquidTargetTexture = device.createTexture({
    label: 'moving-hill-host-liquid-target',
    size: [width, height],
    format: 'rgba16float',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  hostScenePipeline = createHostScenePipeline();
  hostFinalPresentationBindGroup = device.createBindGroup({
    label: 'moving-hill-host-final-presentation-bind-group',
    layout: hostFinalPresentationPipeline.getBindGroupLayout(0),
    entries: [{
      binding: 0,
      resource: liquidTargetTexture.createView(),
    }],
  });
}

function renderHostBaseScene(encoder) {
  const pass = encoder.beginRenderPass({
    label: 'moving-hill-host-live-scene-pass',
    colorAttachments: [{
      view: sceneColorTexture.createView(),
      clearValue: [0, 0, 0, 1],
      loadOp: 'clear',
      storeOp: 'store',
    }, {
      view: liquidTargetTexture.createView(),
      clearValue: [0, 0, 0, 1],
      loadOp: 'clear',
      storeOp: 'store',
    }, {
      view: sceneDepthTexture.createView(),
      clearValue: { r: 30, g: 0, b: 0, a: 0 },
      loadOp: 'clear',
      storeOp: 'store',
    }],
  });
  pass.setPipeline(hostScenePipeline);
  pass.draw(3);
  pass.end();
}

function renderHostFinalPresentation(encoder) {
  const pass = encoder.beginRenderPass({
    label: 'moving-hill-host-final-presentation-pass',
    colorAttachments: [{
      view: context.getCurrentTexture().createView(),
      clearValue: [0, 0, 0, 1],
      loadOp: 'clear',
      storeOp: 'store',
    }],
  });
  pass.setPipeline(hostFinalPresentationPipeline);
  pass.setBindGroup(0, hostFinalPresentationBindGroup);
  pass.draw(3);
  pass.end();
}

function hostAttachment({
  attachmentId,
  frameId,
  externalCamera,
  view,
  width = canvas.width,
  height = canvas.height,
  format,
  colorSpace = null,
  encoding = null,
  mapping = null,
}) {
  return {
    authority: 'host_live_frame',
    attachmentId,
    frameId,
    cameraIdentity: externalCamera.identity,
    cameraGeneration: externalCamera.generation,
    deviceIdentity: HOST_DEVICE_IDENTITY,
    width,
    height,
    format,
    colorSpace,
    encoding,
    mapping,
    view,
  };
}

function createHostFramePacket(frameId, externalCamera, encoder) {
  return {
    schema: KAMINOS_FINGER_FLUID_MOVING_HILL_HOST_FRAME_SCHEMA,
    frameId,
    device,
    deviceIdentity: HOST_DEVICE_IDENTITY,
    commandEncoder: encoder,
    width: canvas.width,
    height: canvas.height,
    camera: externalCamera,
    route: {
      requested: KAMINOS_FINGER_FLUID_MOVING_HILL_HOST_FRAME_ROUTE,
      effective: KAMINOS_FINGER_FLUID_MOVING_HILL_HOST_FRAME_ROUTE,
      fallback: null,
    },
    pipelineIdentity: HOST_PIPELINE_IDENTITY,
    remapGeneration: provider.remapEpoch,
    sceneColor: hostAttachment({
      attachmentId: `${frameId}:scene-color`,
      frameId,
      externalCamera,
      view: sceneColorTexture.createView(),
      format: 'rgba16float',
      colorSpace: 'linear_hdr',
    }),
    sceneDepth: hostAttachment({
      attachmentId: `${frameId}:scene-depth`,
      frameId,
      externalCamera,
      view: sceneDepthTexture.createView(),
      format: 'r32float',
      encoding: 'linear_view_depth_meters',
    }),
    environment: hostAttachment({
      attachmentId: `${frameId}:environment`,
      frameId,
      externalCamera,
      view: environmentTexture.createView(),
      width: ENVIRONMENT_WIDTH,
      height: ENVIRONMENT_HEIGHT,
      format: 'rgba16float',
      mapping: 'equirectangular_world_radiance',
    }),
    target: hostAttachment({
      attachmentId: `${frameId}:liquid-target`,
      frameId,
      externalCamera,
      view: liquidTargetTexture.createView(),
      format: 'rgba16float',
      colorSpace: 'linear_hdr',
    }),
  };
}

function validateHostEncodeEvidence(encodeEvidence, hostFrame) {
  if (
    encodeEvidence?.schema !== KAMINOS_FINGER_FLUID_MOVING_HILL_HOST_FRAME_ENCODE_EVIDENCE_SCHEMA
    || encodeEvidence.requestedRoute !== KAMINOS_FINGER_FLUID_MOVING_HILL_HOST_FRAME_ROUTE
    || encodeEvidence.effectiveRoute !== KAMINOS_FINGER_FLUID_MOVING_HILL_HOST_FRAME_ROUTE
    || encodeEvidence.fallback !== null
    || encodeEvidence.hostFrameId !== hostFrame.frameId
    || encodeEvidence.deviceIdentity !== HOST_DEVICE_IDENTITY
    || encodeEvidence.cameraIdentity !== hostFrame.camera.identity
    || encodeEvidence.cameraGeneration !== hostFrame.camera.generation
    || encodeEvidence.pipelineIdentity !== HOST_PIPELINE_IDENTITY
    || encodeEvidence.remapGeneration !== provider.remapEpoch
    || encodeEvidence.sceneColorAttachmentId !== hostFrame.sceneColor.attachmentId
    || encodeEvidence.sceneDepthAttachmentId !== hostFrame.sceneDepth.attachmentId
    || encodeEvidence.environmentAttachmentId !== hostFrame.environment.attachmentId
    || encodeEvidence.environmentWidth !== hostFrame.environment.width
    || encodeEvidence.environmentHeight !== hostFrame.environment.height
    || encodeEvidence.targetAttachmentId !== hostFrame.target.attachmentId
    || encodeEvidence.primaryCommandEncoded !== true
    || encodeEvidence.primaryOutputWritten !== false
    || encodeEvidence.submittedBySolver !== false
    || encodeEvidence.presentedBySolver !== false
  ) {
    throw new Error(`host encode evidence is substituted or partial: ${JSON.stringify(encodeEvidence)}`);
  }
}

function renderHostFrame(particleVisibility, externalCamera, suffix) {
  const frameId = `moving-hill-host-frame-${externalCamera.generation}-${suffix}`;
  const encoder = device.createCommandEncoder({
    label: frameId,
  });
  renderHostBaseScene(encoder);
  const hostFrame = createHostFramePacket(frameId, externalCamera, encoder);
  const encodeEvidence = solver.render({
    colorMode: 'phase',
    rendererMode: 'screen_space_refraction',
    externalCamera,
    hostFrame,
    particleVisibility,
  });
  validateHostEncodeEvidence(encodeEvidence, hostFrame);
  renderHostFinalPresentation(encoder);
  device.queue.submit([encoder.finish()]);
  lastHostEncodeEvidence = encodeEvidence;
  lastHostSubmissionEvidence = Object.freeze({
    schema: 'kaminos.finger-fluid.moving-hill-host-frame-submission-evidence.v0',
    requestedRoute: KAMINOS_FINGER_FLUID_MOVING_HILL_HOST_FRAME_ROUTE,
    effectiveRoute: KAMINOS_FINGER_FLUID_MOVING_HILL_HOST_FRAME_ROUTE,
    fallback: null,
    hostFrameId: frameId,
    deviceIdentity: HOST_DEVICE_IDENTITY,
    cameraIdentity: externalCamera.identity,
    cameraGeneration: externalCamera.generation,
    pipelineIdentity: HOST_PIPELINE_IDENTITY,
    remapGeneration: provider.remapEpoch,
    hostSubmissionAccepted: true,
    hostFinalPresentationCount: 1,
    primaryOutputWritten: true,
    blank: false,
    partial: false,
    lastTrustworthyEvidence: 'host-command-buffer-submitted-after-single-final-presentation',
  });
  return encodeEvidence;
}

async function initialize() {
  if (!composedRevision || !/^[0-9a-f]{40}$/.test(composedRevision)) {
    throw new Error('composed_revision must be an exact 40-character lowercase Git revision');
  }
  if (!navigator.gpu) throw new Error('navigator.gpu unavailable');
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('WebGPU adapter unavailable');
  device = await adapter.requestDevice({
    requiredLimits: { maxStorageBuffersPerShaderStage: 10 },
  });
  window.__kaminosMovingHillSupportHostDevice = device;
  device.addEventListener('uncapturederror', event => {
    failure = {
      message: event.error?.message || 'uncaptured WebGPU validation error',
      stack: event.error?.stack || null,
      phase: 'host_webgpu_validation',
    };
    publishState();
    console.error(event.error);
  });
  device.lost.then(info => {
    failure = {
      message: `WebGPU device lost: ${info.message || info.reason}`,
      stack: null,
      phase: 'host_webgpu_device_lost',
    };
    publishState();
  });
  context = canvas.getContext('webgpu');
  if (!context) throw new Error('WebGPU canvas context unavailable');
  canvasFormat = navigator.gpu.getPreferredCanvasFormat();
  hostFinalPresentationPipeline = createHostFinalPresentationPipeline();
  environmentTexture = device.createTexture({
    label: 'moving-hill-host-environment',
    size: [ENVIRONMENT_WIDTH, ENVIRONMENT_HEIGHT],
    format: 'rgba16float',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  hostEnvironmentPipeline = createHostEnvironmentPipeline();
  const environmentEncoder = device.createCommandEncoder({
    label: 'moving-hill-host-environment-initialization',
  });
  const environmentPass = environmentEncoder.beginRenderPass({
    colorAttachments: [{
      view: environmentTexture.createView(),
      clearValue: [0, 0, 0, 1],
      loadOp: 'clear',
      storeOp: 'store',
    }],
  });
  environmentPass.setPipeline(hostEnvironmentPipeline);
  environmentPass.draw(3);
  environmentPass.end();
  device.queue.submit([environmentEncoder.finish()]);
  resizeHostAttachments();
  solver = await createWebGPUFingerFluidSolver({
    hostFrameComposition: true,
    hostFramePipelineIdentity: HOST_PIPELINE_IDENTITY,
    webgpuDevice: device,
    particleCount: 24576,
    densityIterations: 3,
    truthScene: 'multi_regime_playground',
    colorMode: 'phase',
    rendererMode: 'screen_space_refraction',
    supportContactRoute: KAMINOS_FINGER_FLUID_MOVING_HILL_SUPPORT_CONTACT_ROUTE,
    presentationMode: KAMINOS_FINGER_FLUID_MOVING_HILL_PRESENTATION_MODE,
    composedRevision,
    movingHillSupportContactProviderFactory({ device: solverDevice }) {
      if (solverDevice !== device) {
        throw new Error('moving-Hill support provider received a substituted WebGPU device');
      }
      const frame = createTerrainFrame(0, terrainEpoch, 0);
      provider = createFingerFluidMovingHillSupportContactProvider({
        device: solverDevice,
        terrainFrame: frame,
        identity: providerIdentity(frame, terrainEpoch),
      });
      supportWriteCount = 1;
      return provider;
    },
  });
  if (!solver.available) {
    throw new Error(`WebGPU solver unavailable: ${solver.reason || 'unknown reason'}`);
  }
  const support = solver.getDebugState().supportContact;
  if (
    support?.route !== KAMINOS_FINGER_FLUID_MOVING_HILL_SUPPORT_CONTACT_ROUTE
    || support.fallbackRoute !== null
    || support.deviceMatchesSolver !== true
    || support.hostReadbackVisibility !== false
  ) {
    throw new Error(`moving-Hill route identity mismatch: ${JSON.stringify(support)}`);
  }
  requestAnimationFrame(animate);
}

function animate(now) {
  try {
    resizeHostAttachments();
    if (frameCount > 0 && frameCount % SUPPORT_UPDATE_INTERVAL === 0) {
      const priorEpoch = terrainEpoch;
      terrainEpoch += 1;
      const timeSeconds = Math.max(0, (now - startTime) / 1000);
      const frame = createTerrainFrame(timeSeconds, terrainEpoch, priorEpoch);
      provider.update({
        terrainFrame: frame,
        identity: providerIdentity(frame, terrainEpoch),
      });
      supportWriteCount += 1;
    }
    solver.step(KAMINOS_FINGER_FLUID_FIXED_STEP_SECONDS);
    const externalCamera = createFingerFluidPerspectiveOrbitCamera({
      identity: 'kaminos-moving-hill-support-witness-camera',
      generation: frameCount + 1,
      width: canvas.width,
      height: canvas.height,
      pixelRatio: 1,
      yaw: -0.58,
      pitch: 0.42,
      distance: 6.1,
      target: [0, -0.18, 0],
    });
    if (frameCount === 8 && !negativeParticleWitness) {
      renderHostFrame('hidden', externalCamera, 'particle-negative');
      const hiddenPresentation = solver.getDebugState().presentationEvidence;
      negativeParticleWitness = {
        cameraIdentity: externalCamera.identity,
        cameraGeneration: externalCamera.generation,
        presentationRoute: hiddenPresentation?.route ?? null,
        particleVisibility: hiddenPresentation?.particleVisibility ?? null,
        particleDrawCount: hiddenPresentation?.particleDrawCount ?? null,
        nonParticleToyDrawCount: hiddenPresentation?.nonParticleToyDrawCount ?? null,
      };
    }
    renderHostFrame('visible', externalCamera, 'visible');
    frameCount += 1;
    publishState();
    requestAnimationFrame(animate);
  } catch (error) {
    failure = {
      message: error?.message || String(error),
      stack: error?.stack || null,
      report: error?.report ?? null,
      phase: 'animation_or_support_epoch_update',
    };
    publishState();
  }
}

window.addEventListener('resize', destroyHostAttachments);
window.addEventListener('beforeunload', () => {
  solver?.destroy?.();
  destroyHostAttachments();
  environmentTexture?.destroy();
  device?.destroy?.();
}, { once: true });

initialize().catch(error => {
  failure = {
    message: error?.message || String(error),
    stack: error?.stack || null,
    phase: 'initialization_before_primary_output',
  };
  publishState();
});
