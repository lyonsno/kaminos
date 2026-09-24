import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as fingerFluidCore from '../finger-fluid-webgpu-core.js';

const source = readFileSync(
  new URL('../finger-fluid-webgpu-core.js', import.meta.url),
  'utf8',
);
const witnessSource = readFileSync(
  new URL('../finger-fluid-moving-hill-support-witness.js', import.meta.url),
  'utf8',
);
const witnessRunnerSource = readFileSync(
  new URL('../finger-fluid-moving-hill-support-witness.mjs', import.meta.url),
  'utf8',
);

const identityMatrix = Object.freeze([
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
]);
const device = Object.freeze({ label: 'host-device' });
const commandEncoder = Object.freeze({ label: 'host-encoder' });
const camera = Object.freeze({
  schema: 'kaminos.finger-fluid.external-camera.v0',
  identity: 'lerms-hill-camera-31',
  generation: 44,
  projectionType: 'orthographic',
  view: identityMatrix,
  projection: identityMatrix,
  viewProjection: identityMatrix,
  inverseViewProjection: identityMatrix,
  position: [0, 0, 0],
  right: [1, 0, 0],
  up: [0, 1, 0],
  forward: [0, 0, -1],
  near: 0.1,
  far: 100,
  viewport: { width: 1280, height: 720 },
});

function attachment({
  attachmentId,
  format,
  colorSpace,
  encoding,
  mapping,
  width = 1280,
  height = 720,
} = {}) {
  return {
    authority: 'host_live_frame',
    attachmentId,
    frameId: 'lerms-frame-209',
    cameraIdentity: camera.identity,
    cameraGeneration: camera.generation,
    deviceIdentity: 'lerms-webgpu-device-4',
    width,
    height,
    format,
    colorSpace,
    encoding,
    mapping,
    view: Object.freeze({ label: `${attachmentId}-view` }),
  };
}

function hostFrame(overrides = {}) {
  return {
    schema: 'kaminos.finger-fluid.moving-hill-host-frame.v0',
    frameId: 'lerms-frame-209',
    device,
    deviceIdentity: 'lerms-webgpu-device-4',
    commandEncoder,
    width: 1280,
    height: 720,
    camera,
    route: {
      requested: fingerFluidCore.KAMINOS_FINGER_FLUID_MOVING_HILL_HOST_FRAME_ROUTE,
      effective: fingerFluidCore.KAMINOS_FINGER_FLUID_MOVING_HILL_HOST_FRAME_ROUTE,
      fallback: null,
    },
    pipelineIdentity: 'lerms/hill/full-renderer-pipeline-12',
    remapGeneration: 17,
    sceneColor: attachment({
      attachmentId: 'scene-color-209',
      format: 'rgba16float',
      colorSpace: 'linear_hdr',
    }),
    sceneDepth: attachment({
      attachmentId: 'scene-depth-209',
      format: 'r32float',
      encoding: 'linear_view_depth_meters',
    }),
    environment: attachment({
      attachmentId: 'environment-209',
      format: 'rgba16float',
      mapping: 'equirectangular_world_radiance',
      width: 2048,
      height: 1024,
    }),
    target: attachment({
      attachmentId: 'liquid-target-209',
      format: 'rgba16float',
      colorSpace: 'linear_hdr',
    }),
    ...overrides,
  };
}

assert.equal(
  fingerFluidCore.KAMINOS_FINGER_FLUID_MOVING_HILL_HOST_FRAME_SCHEMA,
  'kaminos.finger-fluid.moving-hill-host-frame.v0',
);
assert.equal(
  fingerFluidCore.KAMINOS_FINGER_FLUID_MOVING_HILL_HOST_FRAME_ROUTE,
  'kaminos/finger-fluid/moving-hill-host-frame-attachments-v0',
);
assert.equal(
  fingerFluidCore.KAMINOS_FINGER_FLUID_MOVING_HILL_HOST_FRAME_FAILURE_SCHEMA,
  'kaminos.finger-fluid.moving-hill-host-frame-failure.v0',
);
assert.equal(
  fingerFluidCore.KAMINOS_FINGER_FLUID_MOVING_HILL_HOST_FRAME_ENCODE_EVIDENCE_SCHEMA,
  'kaminos.finger-fluid.moving-hill-host-frame-encode-evidence.v0',
);

const validated = fingerFluidCore.validateFingerFluidMovingHillHostFrame(
  hostFrame(),
  {
    device,
    extent: { width: 1280, height: 720 },
    camera,
    expectedPipelineIdentity: 'lerms/hill/full-renderer-pipeline-12',
    expectedRemapGeneration: 17,
  },
);
assert.equal(validated.frameId, 'lerms-frame-209');
assert.equal(validated.device, device);
assert.equal(validated.commandEncoder, commandEncoder);
assert.equal(validated.target.view.label, 'liquid-target-209-view');
assert.equal(validated.route.fallback, null);

function rejectsFrame(frame, pattern, message) {
  assert.throws(
    () => fingerFluidCore.validateFingerFluidMovingHillHostFrame(
      frame,
      {
        device,
        extent: { width: 1280, height: 720 },
        camera,
        expectedPipelineIdentity: 'lerms/hill/full-renderer-pipeline-12',
        expectedRemapGeneration: 17,
      },
    ),
    error => {
      assert.match(error.message, pattern, message);
      assert.equal(
        error.report?.schema,
        'kaminos.finger-fluid.moving-hill-host-frame-failure.v0',
      );
      assert.equal(error.report?.primaryOutputWritten, false);
      assert.equal(error.report?.partial, true);
      assert.equal(error.report?.blank, true);
      assert.equal(typeof error.report?.failurePhase, 'string');
      return true;
    },
  );
}

rejectsFrame(
  hostFrame({ device: Object.freeze({ label: 'other-device' }) }),
  /device identity is cross-device or substituted/,
);
rejectsFrame(
  hostFrame({ commandEncoder: null }),
  /command encoder is missing/,
);
rejectsFrame(
  hostFrame({ pipelineIdentity: 'lerms/hill/substituted-pipeline-9' }),
  /pipeline identity is cross-pipeline or substituted/,
);
rejectsFrame(
  hostFrame({
    route: {
      requested: 'lerms/hill/full-renderer-v0',
      effective: 'lerms/hill/full-renderer-v0',
      fallback: null,
    },
  }),
  /route is fallback or substituted/,
);
rejectsFrame(
  hostFrame({
    route: {
      requested: 'lerms/hill/full-renderer-v0',
      effective: 'lerms/hill/fallback-preview-v0',
      fallback: 'preview',
    },
  }),
  /route is fallback or substituted/,
);
rejectsFrame(
  hostFrame({
    sceneColor: {
      ...hostFrame().sceneColor,
      frameId: 'stale-frame',
    },
  }),
  /scene color frame identity is stale or substituted/,
);
rejectsFrame(
  hostFrame({
    sceneDepth: {
      ...hostFrame().sceneDepth,
      format: 'depth24plus',
    },
  }),
  /scene depth format is unsupported/,
);
rejectsFrame(
  hostFrame({
    target: {
      ...hostFrame().target,
      colorSpace: 'srgb',
    },
  }),
  /target color space is unsupported/,
);
rejectsFrame(
  hostFrame({
    target: {
      ...hostFrame().sceneColor,
    },
  }),
  /target must be distinct from the preserved scene color/,
);
rejectsFrame(
  hostFrame({
    target: {
      ...hostFrame().target,
      attachmentId: hostFrame().sceneDepth.attachmentId,
      view: hostFrame().sceneDepth.view,
    },
  }),
  /host attachment identities must be unique/,
);
rejectsFrame(
  hostFrame({
    sceneDepth: {
      ...hostFrame().sceneDepth,
      attachmentId: hostFrame().sceneColor.attachmentId,
    },
  }),
  /host attachment identities must be unique/,
);
const viewAliasFrame = hostFrame();
viewAliasFrame.environment = {
  ...viewAliasFrame.environment,
  view: viewAliasFrame.sceneDepth.view,
};
rejectsFrame(viewAliasFrame, /host attachment identities must be unique/);
rejectsFrame(
  hostFrame({
    environment: {
      ...hostFrame().environment,
      authority: 'synthetic_fallback',
    },
  }),
  /environment authority is unsupported or fallback/,
);
rejectsFrame(
  hostFrame({
    target: {
      ...hostFrame().target,
      cameraGeneration: camera.generation - 1,
    },
  }),
  /target camera generation is stale or substituted/,
);
rejectsFrame(
  hostFrame({ remapGeneration: -1 }),
  /remap generation is missing or invalid/,
);
rejectsFrame(
  hostFrame({ remapGeneration: 16 }),
  /remap generation is stale or substituted/,
);

assert.match(
  source,
  /hostFrameComposition = false/,
  'the solver factory must make host-owned composition an explicit initialization contract',
);
assert.match(
  source,
  /hostFramePipelineIdentity = null/,
  'host-owned composition must bind an authoritative pipeline identity at solver initialization',
);
assert.match(
  source,
  /webgpuDevice = null/,
  'the solver factory must accept an existing host WebGPU device',
);
assert.match(
  source,
  /hostFrame = null/,
  'render must accept host-owned frame attachments',
);
assert.match(
  source,
  /validateFingerFluidMovingHillHostFrame\(hostFrame,/,
  'moving-Hill rendering must validate the full frame contract before encoding',
);
assert.match(
  source,
  /const encoder = validatedHostFrame\?\.commandEncoder[\s\S]*device\.createCommandEncoder/,
  'the composed path must use the host command encoder while retaining the control path',
);
assert.match(
  source,
  /if \(!validatedHostFrame\) \{[\s\S]*device\.queue\.submit\(\[encoder\.finish\(\)\]\)/,
  'the host path must neither finish nor submit the host command encoder',
);
assert.match(
  source,
  /if \(!validatedHostFrame\) \{[\s\S]*finalPresentationPass/,
  'the host path must not perform the private canvas presentation',
);
assert.match(
  source,
  /schema:\s*KAMINOS_FINGER_FLUID_MOVING_HILL_HOST_FRAME_ENCODE_EVIDENCE_SCHEMA[\s\S]*hostFrameId:[\s\S]*deviceIdentity:[\s\S]*cameraIdentity:[\s\S]*cameraGeneration:[\s\S]*pipelineIdentity:[\s\S]*remapGeneration:[\s\S]*sceneColorAttachmentId:[\s\S]*sceneDepthAttachmentId:[\s\S]*environmentAttachmentId:[\s\S]*environmentWidth:[\s\S]*environmentHeight:[\s\S]*targetAttachmentId:/,
  'the host encode receipt must preserve every load-bearing frame identity',
);
assert.match(
  source,
  /primaryCommandEncoded:\s*true[\s\S]*primaryOutputWritten:\s*false[\s\S]*submittedBySolver:\s*false[\s\S]*presentedBySolver:\s*false/,
  'the receipt must distinguish command encoding from host submission and presentation',
);
assert.match(
  source,
  /hostFrameCompositionEvidence:\s*lastHostFrameCompositionEvidence/,
  'debug state must expose the latest host encode receipt',
);
assert.match(
  source,
  /return lastHostFrameCompositionEvidence;/,
  'host render callers must receive the encode receipt directly',
);
assert.match(
  source,
  /colorDepthAuthority:\s*lastHostFrameCompositionEvidence[\s\S]*host_scene_color_linear_depth_bound_v0/,
  'support evidence must identify the bound host color/depth authority',
);
assert.match(
  source,
  /providerExecution:\s*lastHostFrameCompositionEvidence[\s\S]*host_scene_color_depth_environment_bound_toy_world_suppressed_v0/,
  'optical evidence must distinguish the bound host scene from the producer control',
);
assert.match(
  source,
  /environmentMapEvidence:\s*\{[\s\S]*attachmentId:\s*lastHostFrameCompositionEvidence[\s\S]*environmentAttachmentId[\s\S]*width:\s*lastHostFrameCompositionEvidence[\s\S]*environmentWidth[\s\S]*height:\s*lastHostFrameCompositionEvidence[\s\S]*environmentHeight/,
  'environment evidence must name the bound host attachment rather than the private control asset',
);
assert.match(
  source,
  /finalPresentationEvidence:\s*\{[\s\S]*execution:\s*lastHostFrameCompositionEvidence[\s\S]*host_owned_not_executed_by_solver_v0/,
  'presentation evidence must state that the host owns final submission and presentation',
);
assert.match(
  source,
  /source:\s*lastHostFrameCompositionEvidence[\s\S]*host_scene_color_linear_hdr_attachment_v0/,
  'refraction evidence must name the host scene-color attachment as its source',
);

assert.match(
  witnessSource,
  /KAMINOS_FINGER_FLUID_MOVING_HILL_HOST_FRAME_SCHEMA/,
  'the live moving-Hill witness must publish the exact host-frame schema',
);
assert.match(
  witnessSource,
  /KAMINOS_FINGER_FLUID_MOVING_HILL_HOST_FRAME_ROUTE/,
  'the witness must publish the exact host-frame route',
);
assert.match(
  witnessSource,
  /KAMINOS_FINGER_FLUID_MOVING_HILL_HOST_FRAME_ENCODE_EVIDENCE_SCHEMA/,
  'the witness must verify the host encode receipt schema',
);
assert.match(
  witnessSource,
  /navigator\.gpu\.requestAdapter[\s\S]*adapter\.requestDevice/,
  'the host witness must own WebGPU device creation',
);
assert.match(
  witnessSource,
  /hostFrameComposition:\s*true[\s\S]*hostFramePipelineIdentity:\s*HOST_PIPELINE_IDENTITY[\s\S]*webgpuDevice:\s*device/,
  'the witness must inject its host pipeline identity and existing WebGPU device into the solver host path',
);
assert.match(
  witnessSource,
  /label:\s*'moving-hill-host-scene-color'[\s\S]*format:\s*'rgba16float'[\s\S]*GPUTextureUsage\.RENDER_ATTACHMENT[\s\S]*GPUTextureUsage\.TEXTURE_BINDING/,
  'the witness must own a sampleable linear-HDR scene-color attachment',
);
assert.match(
  witnessSource,
  /label:\s*'moving-hill-host-scene-linear-depth'[\s\S]*format:\s*'r32float'[\s\S]*GPUTextureUsage\.RENDER_ATTACHMENT[\s\S]*GPUTextureUsage\.TEXTURE_BINDING/,
  'the witness must own a sampleable linear view-depth attachment',
);
assert.match(
  witnessSource,
  /label:\s*'moving-hill-host-environment'[\s\S]*format:\s*'rgba16float'/,
  'the witness must own the linear-HDR environment attachment',
);
assert.match(
  witnessSource,
  /label:\s*'moving-hill-host-liquid-target'[\s\S]*format:\s*'rgba16float'[\s\S]*GPUTextureUsage\.RENDER_ATTACHMENT[\s\S]*GPUTextureUsage\.TEXTURE_BINDING/,
  'the witness must own a distinct linear-HDR liquid target',
);
assert.match(
  witnessSource,
  /schema:\s*KAMINOS_FINGER_FLUID_MOVING_HILL_HOST_FRAME_SCHEMA[\s\S]*route:\s*\{[\s\S]*requested:\s*KAMINOS_FINGER_FLUID_MOVING_HILL_HOST_FRAME_ROUTE[\s\S]*effective:\s*KAMINOS_FINGER_FLUID_MOVING_HILL_HOST_FRAME_ROUTE[\s\S]*fallback:\s*null/,
  'the witness host-frame packet must fail closed on route identity',
);
assert.match(
  witnessSource,
  /remapGeneration:\s*provider\.remapEpoch/,
  'the witness host-frame packet must publish remap lineage, not terrain deformation chronology',
);
assert.match(
  witnessSource,
  /sceneColor:\s*hostAttachment[\s\S]*sceneDepth:\s*hostAttachment[\s\S]*environment:\s*hostAttachment[\s\S]*target:\s*hostAttachment/,
  'the witness must bind all four exact host attachments into one frame packet',
);
assert.match(
  witnessSource,
  /solver\.render\(\{[\s\S]*hostFrame[\s\S]*externalCamera/,
  'the witness must render through the host-frame path with the exact external camera',
);
assert.match(
  witnessSource,
  /encodeEvidence\?\.schema\s*!==\s*KAMINOS_FINGER_FLUID_MOVING_HILL_HOST_FRAME_ENCODE_EVIDENCE_SCHEMA/,
  'the witness must reject a substituted host encode receipt',
);
assert.match(
  witnessSource,
  /encodeEvidence\.submittedBySolver\s*!==\s*false[\s\S]*encodeEvidence\.presentedBySolver\s*!==\s*false/,
  'the witness must prove the solver did not submit or present the host frame',
);
assert.match(
  witnessSource,
  /renderHostFinalPresentation\([\s\S]*device\.queue\.submit\(\[encoder\.finish\(\)\]\)/,
  'the host must append one final presentation and submit only after fluid encoding',
);
assert.doesNotMatch(
  witnessSource,
  /createWebGPUFingerFluidSolver\(\{\s*canvas,/,
  'the host-frame witness must not hand the canvas to the fluid solver',
);
assert.match(
  witnessRunnerSource,
  /host-frame encode evidence rejected/,
  'the browser runner must fail closed when the page reports substituted host encode evidence',
);
assert.match(
  witnessRunnerSource,
  /host-frame submission evidence rejected/,
  'the browser runner must fail closed when the page reports partial or duplicate host submission evidence',
);
assert.match(
  witnessRunnerSource,
  /hostEncode\?\.sceneColorAttachmentId/,
  'the browser runner must require exact host scene attachment identities',
);
assert.match(
  witnessRunnerSource,
  /new Set\(hostAttachmentIds\)\.size !== hostAttachmentIds\.length/,
  'the browser runner must reject aliased host attachment identities',
);
assert.match(
  witnessRunnerSource,
  /hostEncode\?\.environmentWidth !== HOST_ENVIRONMENT_WIDTH[\s\S]*hostEncode\?\.environmentHeight !== HOST_ENVIRONMENT_HEIGHT/,
  'the browser runner must reject substituted host environment dimensions',
);
assert.match(
  witnessRunnerSource,
  /candidate\.hostSubmissionEvidence\?\.hostFinalPresentationCount\s*!==\s*1/,
  'the browser runner must require exactly one host final presentation',
);

console.log('finger fluid moving-Hill host-frame contracts passed');
