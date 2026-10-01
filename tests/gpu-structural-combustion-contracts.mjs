import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createLayeredStructuralMaterial } from '../structural-material-3d-core.js';
import {
  STRUCTURAL_COMBUSTION_AUTHORITY,
  STRUCTURAL_COMBUSTION_SCHEMA,
  createGpuStructuralCombustionAssembly,
  evaluateStructuralCombustionTerminalChecks,
} from '../structural-combustion-gpu.mjs';
import * as volumeModule from '../volume-core.js';
import { createCombustibleObjectFireReceiver } from '../combustible-object-fire-gpu.mjs';

const { validateCombustibleObjectSourceDescriptor } = volumeModule;

const source = readFileSync(new URL('../structural-combustion-gpu.mjs', import.meta.url), 'utf8');
const volumeSource = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
assert.equal(
  typeof volumeModule.replaceOwnedGpuStructuralCombustionAssembly,
  'function',
  'structural combustion assembly replacement must have one testable ownership boundary',
);
const firstOwnedAssembly = { destroyCount: 0, destroy() { this.destroyCount += 1; } };
const secondOwnedAssembly = { destroyCount: 0, destroy() { this.destroyCount += 1; } };
assert.equal(
  volumeModule.replaceOwnedGpuStructuralCombustionAssembly(firstOwnedAssembly, firstOwnedAssembly),
  firstOwnedAssembly,
  'rebinding the same assembly must not destroy it',
);
assert.equal(firstOwnedAssembly.destroyCount, 0);
assert.equal(
  volumeModule.replaceOwnedGpuStructuralCombustionAssembly(firstOwnedAssembly, secondOwnedAssembly),
  secondOwnedAssembly,
  'replacement must return the new owned assembly',
);
assert.equal(firstOwnedAssembly.destroyCount, 1, 'replacement must destroy the prior distinct assembly exactly once');
assert.equal(volumeModule.replaceOwnedGpuStructuralCombustionAssembly(secondOwnedAssembly, null), null);
assert.equal(secondOwnedAssembly.destroyCount, 1, 'clear and dispose must destroy the current assembly exactly once');
assert.match(
  volumeSource,
  /gpuStructuralCombustionAssembly = replaceOwnedGpuStructuralCombustionAssembly\([\s\S]*?gpuStructuralCombustionAssembly,[\s\S]*?assembly,[\s\S]*?\)/,
  'volume replacement must use the owned structural assembly boundary',
);
assert.equal(
  (volumeSource.match(/gpuStructuralCombustionAssembly = replaceOwnedGpuStructuralCombustionAssembly\([\s\S]*?gpuStructuralCombustionAssembly,[\s\S]*?null,[\s\S]*?\)/g) || []).length,
  2,
  'volume clear and dispose must both release the owned structural assembly',
);
assert.doesNotMatch(source, /requestAdapter|requestDevice/, 'the combustion assembly cannot open a second GPU identity');
assert.doesNotMatch(source, /setTimeout|ignitionRequested/, 'ignition cannot be a timer or host-authored request');
assert.match(
  volumeSource,
  /setGpuStructuralCombustionAssembly/,
  'Pyro exposes a same-device structural-combustion composition socket',
);
assert.match(
  volumeSource,
  /gpuStructuralCombustionAssembly\.encode\(encoder, fluidBuffers\[currentFluid\]\)/,
  'node combustion samples the authoritative current Pyro field in the simulation command graph',
);
assert.match(
  volumeSource,
  /gpuStructuralCombustionAssembly\.encodePresentation/,
  'the same GPU state drives dimensional presentation without host material feedback',
);
assert.match(
  source,
  /structuralExposureDiagnosticColor\(in\.reaction\.x, presentation\.world\.w\)/,
  'exposure diagnostic must visualize the node exposure sampled by the GPU combustion pass',
);
const exposureDiagnostic = source.match(/fn structuralExposureDiagnosticColor\(exposure: f32, threshold: f32\) -> vec3<f32> \{[\s\S]*?\n\}/)?.[0] || '';
const zeroExposureBranch = exposureDiagnostic.match(/if \(exposure <= 0\.0\) \{ return vec3<f32>\(([^)]+)\); \}/);
const subthresholdRamp = exposureDiagnostic.match(/return mix\(vec3<f32>\(([^)]+)\), vec3<f32>\(([^)]+)\), fraction\);/);
assert.match(
  exposureDiagnostic,
  /if \(exposure <= 0\.0\) \{ return vec3<f32>\(0\.015, 0\.025, 0\.08\); \}[\s\S]*?if \(exposure <= threshold\) \{/,
  'zero exposure must have its own color before positive subthreshold exposure is mapped',
);
assert.match(exposureDiagnostic, /fraction = clamp\(exposure \/ max\(threshold, 0\.0001\), 0\.0, 1\.0\)/);
const parseColor = text => text.split(',').map(value => Number(value.trim()));
const zeroColor = parseColor(zeroExposureBranch?.[1] || '');
const subthresholdMidpointColor = (subthresholdRamp?.[1] && subthresholdRamp?.[2])
  ? parseColor(subthresholdRamp[1]).map((value, index) => (value + parseColor(subthresholdRamp[2])[index]) / 2)
  : [];
assert.equal(zeroColor.length, 3, 'zero exposure color must remain a three-channel RGB value');
assert.equal(subthresholdMidpointColor.length, 3, 'positive subthreshold ramp must remain a three-channel RGB value');
assert.notDeepEqual(
  zeroColor,
  subthresholdMidpointColor,
  'a deterministic shader-color check must distinguish zero from threshold/2 exposure',
);
assert.match(
  source,
  /structuralMaterialDiagnosticColor\(in\.thermal\)/,
  'material diagnostic must visualize the GPU node temperature, fuel, and char state',
);
assert.doesNotMatch(volumeSource, /setGpuCombustibleObjectLoop/, 'the current volume core has no legacy object-loop socket to compete with structural combustion');

const terminalFixture = {
  decodedStructures: [
    {
      control: false,
      objectId: 21,
      componentCount: 2,
      brokenBondCount: 1,
      weakenedBondCount: 1,
      nodes: [
        { position: [0, 0, 0], temperature: 1.2, peakExposure: 2, ignitionStep: 13, firstIncidentFractureStep: 20 },
        { position: [0, 0, 1], temperature: 0.2, peakExposure: 0, ignitionStep: 18, firstIncidentFractureStep: 20 },
      ],
    },
    {
      control: true,
      objectId: 22,
      componentCount: 1,
      brokenBondCount: 0,
      weakenedBondCount: 0,
      nodes: [
        { position: [0, 0, 0], temperature: 0.08, peakExposure: 0, ignitionStep: 0, firstIncidentFractureStep: 0 },
      ],
    },
  ],
  sourceHeader: { complete: 1, published: 1, packedCount: 0, rejectedCount: 0, overflowCount: 0 },
  receiverAudit: { audit: { auditObjectId: 21, acceptedRecords: 8, rejectedRecords: 0 } },
};
const acceptedTerminalChecks = evaluateStructuralCombustionTerminalChecks(terminalFixture);
assert.ok(Object.values(acceptedTerminalChecks).every(Boolean), 'an empty finalized frame is valid after target emissions were accepted');
assert.equal(
  evaluateStructuralCombustionTerminalChecks({
    ...terminalFixture,
    decodedStructures: terminalFixture.decodedStructures.map((structure, index) => index === 0 ? {
      ...structure,
      nodes: structure.nodes.map(node => ({ ...node, firstIncidentFractureStep: 2 })),
    } : structure),
  }).fractureAfterIgnition,
  false,
  'fracture before ignition cannot close the causal witness',
);
assert.equal(
  evaluateStructuralCombustionTerminalChecks({
    ...terminalFixture,
    decodedStructures: terminalFixture.decodedStructures.map((structure, index) => index === 1 ? {
      ...structure,
      brokenBondCount: 1,
    } : structure),
  }).controlConnected,
  false,
  'a damaged matched control cannot close the witness',
);
assert.equal(
  evaluateStructuralCombustionTerminalChecks({
    ...terminalFixture,
    receiverAudit: { audit: { ...terminalFixture.receiverAudit.audit, rejectedRecords: 1 } },
  }).sourceAccepted,
  false,
  'receiver rejection cannot masquerade as accepted target emission',
);

const previousUsage = globalThis.GPUBufferUsage;
const previousShaderStage = globalThis.GPUShaderStage;
const previousTextureUsage = globalThis.GPUTextureUsage;
globalThis.GPUBufferUsage = { STORAGE: 1, COPY_DST: 2, COPY_SRC: 4, UNIFORM: 8, MAP_READ: 16 };
globalThis.GPUShaderStage = { COMPUTE: 1, VERTEX: 2, FRAGMENT: 4 };
globalThis.GPUTextureUsage = { RENDER_ATTACHMENT: 1 };

const buffers = [];
const textures = [];
const bindGroupLayouts = [];
let presentationCompilationMessages = [];
let rejectedComputeEntryPoint = null;
let rejectedRenderEntryPoint = null;
const presentationUniformWrites = [];
const parameterWrites = [];
const shaderModules = [];
const queue = {
  writeBuffer(buffer, offset, data) {
    if (buffer?.descriptor?.label === 'structural combustion target params') {
      parameterWrites.push(new Uint8Array(data).slice());
    }
    if (buffer?.descriptor?.label?.includes('presentation')) {
      const bytes = data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      presentationUniformWrites.push({ label: buffer.descriptor.label, offset, bytes: bytes.slice() });
    }
  },
  async onSubmittedWorkDone() {},
};
const device = {
  queue,
  createBuffer(descriptor) {
    const buffer = { descriptor, destroyCount: 0, destroy() { this.destroyCount += 1; } };
    buffers.push(buffer);
    return buffer;
  },
  createTexture(descriptor) {
    const texture = {
      descriptor,
      destroyCount: 0,
      createView() { return { texture: this }; },
      destroy() { this.destroyCount += 1; },
    };
    textures.push(texture);
    return texture;
  },
  createShaderModule(descriptor) {
    shaderModules.push(descriptor);
    return {
      async getCompilationInfo() {
        return {
          messages: descriptor.label === 'structural combustion dimensional presentation'
            ? presentationCompilationMessages
            : [],
        };
      },
    };
  },
  createBindGroupLayout(descriptor) {
    bindGroupLayouts.push(descriptor);
    return {};
  },
  createPipelineLayout() { return {}; },
  async createComputePipelineAsync(descriptor) {
    if (descriptor.compute.entryPoint === rejectedComputeEntryPoint) {
      throw new Error(`compute validation rejected ${descriptor.compute.entryPoint}`);
    }
    return { getBindGroupLayout() { return {}; } };
  },
  async createRenderPipelineAsync(descriptor) {
    if (descriptor.vertex.entryPoint === rejectedRenderEntryPoint) {
      throw new Error(`render validation rejected ${descriptor.vertex.entryPoint}`);
    }
    return { getBindGroupLayout() { return {}; } };
  },
  createBindGroup(descriptor) { return { descriptor }; },
};
const targetState = createLayeredStructuralMaterial({ columns: 5, rows: 4, layers: 3, notch: true });
const controlState = createLayeredStructuralMaterial({ columns: 5, rows: 4, layers: 3, notch: true });
let targetLoadEncodes = 0;
let controlLoadEncodes = 0;

function structuralSocket(state, countLoad) {
  const descriptor = {
    schema: 'kaminos.structural-material.webgpu-resident-buffers.v0',
    routeIdentity: 'kaminos.structural-material.webgpu-hot-sidecar.v0',
    objectIdentity: `object:${state.nodes.length}:${state.bonds.length}`,
    generation: 1,
    deviceOwnership: 'borrowed',
    device,
    queue,
    nodeBuffer: {},
    bondBuffer: {},
    componentLabelBuffer: {},
    nodeCount: state.nodes.length,
    bondCount: state.bonds.length,
    nodeStrideBytes: 32,
    bondStrideBytes: 80,
    disposed: false,
  };
  return {
    residentDescriptor() { return descriptor; },
    encodeResidentInteraction(encoder, load) {
      countLoad();
      assert.ok(encoder);
      assert.ok(load.magnitude > 0);
      return { readbackCount: 0 };
    },
  };
}

try {
  const targetSidecar = structuralSocket(targetState, () => { targetLoadEncodes += 1; });
  const controlSidecar = structuralSocket(controlState, () => { controlLoadEncodes += 1; });
  const diagnosticStructures = [
    { id: 'target', objectId: 21, state: targetState, sidecar: targetSidecar, control: false },
    { id: 'control', objectId: 22, state: controlState, sidecar: controlSidecar, control: true },
  ];
  await assert.rejects(
    () => createGpuStructuralCombustionAssembly({
      device,
      gridSize: 32,
      format: 'rgba8unorm',
      presentationDebugMode: 'bogus',
      structures: diagnosticStructures,
    }),
    /unsupported structural combustion presentation debug mode: bogus/,
    'unsupported diagnostic routes must fail instead of silently rendering normal materials',
  );
  await assert.rejects(
    () => createGpuStructuralCombustionAssembly({
      device,
      gridSize: 32,
      format: 'rgba8unorm',
      mode: 'carried-fire',
      structures: [
        { id: 'target', objectId: 21, state: targetState, sidecar: targetSidecar, role: 'emitter' },
        { id: 'control', objectId: 22, state: controlState, sidecar: controlSidecar, role: 'control', control: true },
      ],
    }),
    /propagation-target/i,
    'carried-fire mode cannot fall back to the two-object structural predicate',
  );
  presentationCompilationMessages = [{
    type: 'error',
    lineNum: 74,
    linePos: 19,
    offset: 1902,
    length: 8,
    message: 'portable compiler rejected bond material expression',
  }];
  await assert.rejects(
    () => createGpuStructuralCombustionAssembly({
      device,
      gridSize: 32,
      format: 'rgba8unorm',
      structures: diagnosticStructures,
    }),
    error => {
      assert.match(error.message, /structural combustion dimensional presentation/i);
      assert.match(error.message, /source [0-9a-f]{8}/i);
      assert.match(error.message, /74:19/);
      assert.match(error.message, /portable compiler rejected bond material expression/);
      return true;
    },
    'presentation WGSL failure preserves module, source, line, column, and compiler message',
  );
  presentationCompilationMessages = [];
  const renderFailureBufferStart = buffers.length;
  rejectedRenderEntryPoint = 'bondVertex';
  await assert.rejects(
    () => createGpuStructuralCombustionAssembly({
      device,
      gridSize: 32,
      format: 'rgba8unorm',
      structures: diagnosticStructures,
    }),
    error => {
      assert.match(error.message, /structural combustion dimensional presentation/i);
      assert.match(error.message, /bondVertex/);
      assert.match(error.message, /source [0-9a-f]{8}/i);
      assert.match(error.message, /render validation rejected bondVertex/);
      return true;
    },
    'bondVertex pipeline validation preserves presentation module, entry point, source, and browser text',
  );
  const renderFailureBuffers = buffers.slice(renderFailureBufferStart);
  assert.ok(renderFailureBuffers.length > 0, 'render pipeline failure exercise allocates assembly-owned buffers');
  assert.ok(
    renderFailureBuffers.every(buffer => buffer.destroyCount === 1),
    'render pipeline validation failure destroys every assembly-owned buffer exactly once',
  );
  rejectedRenderEntryPoint = null;

  const computeFailureBufferStart = buffers.length;
  rejectedComputeEntryPoint = 'updateNodes';
  await assert.rejects(
    () => createGpuStructuralCombustionAssembly({
      device,
      gridSize: 32,
      format: 'rgba8unorm',
      structures: diagnosticStructures,
    }),
    error => {
      assert.match(error.message, new RegExp(STRUCTURAL_COMBUSTION_AUTHORITY, 'i'));
      assert.match(error.message, /updateNodes/);
      assert.match(error.message, /source [0-9a-f]{8}/i);
      assert.match(error.message, /compute validation rejected updateNodes/);
      return true;
    },
    'compute pipeline validation preserves compute module, entry point, source, and browser text',
  );
  const computeFailureBuffers = buffers.slice(computeFailureBufferStart);
  assert.ok(computeFailureBuffers.length > 0, 'compute pipeline failure exercise allocates assembly-owned buffers');
  assert.ok(
    computeFailureBuffers.every(buffer => buffer.destroyCount === 1),
    'compute pipeline validation failure destroys every assembly-owned buffer exactly once',
  );
  rejectedComputeEntryPoint = null;

  let spatialTranslation = 0;
  const identityMatrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const assembly = await createGpuStructuralCombustionAssembly({
    device,
    gridSize: 32,
    gridDimensions: [32, 64, 32],
    format: 'rgba8unorm',
    presentationDebugMode: 'exposure',
    structures: [
      {
        id: 'target',
        objectId: 21,
        state: targetState,
        sidecar: targetSidecar,
        control: false,
        pyroScale: [0.26, 0.32, 0.32],
        pyroOffset: [0.26, 0.26, 0.32],
        worldOffset: [-0.65, 0, 0],
        spatialTransformProvider: () => ({
          nodeToPyro: [...identityMatrix.slice(0, 12), spatialTranslation, 0, 0, 1],
          displayTransform: [...identityMatrix.slice(0, 12), spatialTranslation * 2, 0, 0, 1],
          normalTransform: identityMatrix,
        }),
      },
      {
        id: 'control',
        objectId: 22,
        state: controlState,
        sidecar: controlSidecar,
        control: true,
        pyroScale: [0.26, 0.32, 0.32],
        pyroOffset: [0.64, 0.26, 0.32],
        worldOffset: [0.65, 0, 0],
      },
    ],
    load: {
      point: { x: 0.88, y: 0.5, z: 0.5 },
      vector: { x: 1, y: 0.06, z: 0.22 },
      magnitude: 0.74,
      radius: 0.26,
    },
  });
  const spatialShader = shaderModules.findLast(module => module.label === STRUCTURAL_COMBUSTION_AUTHORITY).code;
  assert.match(spatialShader, /const GRID_Y: u32 = 64u;/, 'heat sampling must use the effective tall fluid layout');
  assert.match(spatialShader, /cell\.z \* GRID \* GRID_Y/, 'z stride must not alias the middle of the tall volume');
  assert.match(spatialShader, /params\.nodeToPyro \* vec4<f32>\(position, 1\.0\)/, 'heat sampling uses the live affine object transform');
  assert.doesNotMatch(spatialShader, /let samplePosition = clamp\(/, 'outside objects must not sample a clamped hot boundary');
  const tallReceiver = await createCombustibleObjectFireReceiver({device, gridSize: 32, gridDimensions: [32, 64, 32], validateDescriptor: value => value});
  const receiverShader = shaderModules.findLast(module => module.label === 'kaminos combustible object fire receiver').code;
  assert.match(receiverShader, /const GRID_Y: u32 = 64u;/, 'object emissions use the same tall fluid layout as heat sampling');
  assert.match(receiverShader, /kernelCell\.z \* GRID \* GRID_Y/);
  assert.equal(buffers.findLast(buffer => buffer.descriptor.label.startsWith('kaminos combustible object accumulation')).descriptor.size, 32 * 64 * 32 * 5 * 4);
  tallReceiver.destroy();
  for (const label of ['structural combustion presentation layout', 'structural combustion mesh presentation layout']) {
    const layout = bindGroupLayouts.find(candidate => candidate.label === label);
    assert.ok(layout, `${label} must be created`);
    assert.equal(
      layout.entries.find(entry => entry.binding === 4)?.visibility,
      GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
      `${label} uniform is read by both vertex and fragment shaders`,
    );
  }
  const sourceDescriptor = assembly.sourceDescriptor();
  assert.equal(sourceDescriptor.schema, 'kaminos.combustible-object-source-descriptor.v0');
  assert.equal(sourceDescriptor.device, device);
  assert.equal(sourceDescriptor.queue, queue);
  assert.equal(sourceDescriptor.headerBytes, 80);
  assert.equal(sourceDescriptor.recordBytes, 128);
  assert.equal(sourceDescriptor.recordFloats, 32);
  assert.equal(sourceDescriptor.capacity, targetState.nodes.length);
  assert.equal(validateCombustibleObjectSourceDescriptor(sourceDescriptor, { device }), sourceDescriptor);

  const passes = [];
  const encoder = {
    beginComputePass({ label }) {
      return {
        label,
        setPipeline() {},
        setBindGroup() {},
        dispatchWorkgroups() {},
        end() { passes.push(label); },
      };
    },
  };
  const encoded = assembly.encode(encoder, {});
  assert.equal(encoded.readbackCount, 0);
  assert.equal(encoded.hostCausalFeedbackCount, 0);
  assert.equal(targetLoadEncodes, 1);
  assert.equal(controlLoadEncodes, 1);
  assert.ok(passes.length >= 5, 'source clear, node heat, conduction, weakening, and finalize passes are encoded');
  assert.equal(assembly.debugState().schema, STRUCTURAL_COMBUSTION_SCHEMA);
  assert.equal(assembly.debugState().authority, STRUCTURAL_COMBUSTION_AUTHORITY);
  assert.equal(assembly.debugState().presentationDebugMode, 'exposure');
  assert.equal(assembly.debugState().runtimeReadbackCount, 0);

  const rendered = [];
  const presentationEncoder = {
    beginRenderPass() {
      return {
        setPipeline() {},
        setBindGroup() {},
        draw(vertexCount, instanceCount) { rendered.push([vertexCount, instanceCount]); },
        end() {},
      };
    },
  };
  assert.equal(
    assembly.encodePresentation(
      presentationEncoder,
      {},
      [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      { width: 640, height: 360 },
    ),
    true,
  );
  assert.equal(rendered.length, 4, 'diagnostic mode draws target and control surfaces plus GPU node samples, without bond clutter');
  assert.deepEqual(rendered[0], [36, 24], 'target presents its 4 x 3 x 2 resident structural cells');
  assert.deepEqual(rendered[2], [36, 24], 'control presents the same matched solid topology');
  const targetPresentation = presentationUniformWrites.find(write => write.label === 'structural combustion target presentation');
  assert.ok(targetPresentation, 'diagnostic mode must be carried to the presentation shader');
  assert.equal(new DataView(targetPresentation.bytes.buffer).getFloat32(92, true), 1);
  assert.equal(assembly.debugState().runtimeReadbackCount, 0, 'GPU presentation diagnostics must not add host material readback');
  const materialBufferCount = buffers.filter(buffer => /target materials/.test(buffer.descriptor.label)).length;
  const writesBeforeMove = parameterWrites.length;
  spatialTranslation = 1.25;
  assembly.encodePresentation(presentationEncoder, {}, identityMatrix, {width: 640, height: 360});
  assert.equal(new Float32Array(presentationUniformWrites.findLast(write => write.label === 'structural combustion target presentation').bytes.buffer)[40], 2.5, 'presentation follows object edits even while simulation stepping is paused');
  assembly.encode(encoder, {});
  assert.equal(parameterWrites.length, writesBeforeMove + 1, 'moving the object uploads only its changed affine parameters');
  assert.equal(new Float32Array(parameterWrites.at(-1).buffer)[48], 1.25, 'the GPU heat/source matrix follows object translation');
  assert.equal(new Float32Array(presentationUniformWrites.findLast(write => write.label === 'structural combustion target presentation').bytes.buffer)[40], 2.5, 'the visible surface follows the same pose');
  assert.equal(buffers.filter(buffer => /target materials/.test(buffer.descriptor.label)).length, materialBufferCount, 'moving the object must preserve resident material history');
  assert.equal(assembly.debugState().spatialTransforms[0].nodeToPyro[12], 1.25);
  assert.equal(assembly.debugState().runtimeReadbackCount, 0);

  const meshSurface = {
    schema: 'kaminos.structural-mesh-surface.v0',
    assetIdentity: 'fixture:diagnostic-triangle',
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2]),
    vertexIslands: new Uint32Array([0, 0, 0]),
    islands: [{ nodeBounds: { min: [0, 0, 0], max: [1, 1, 1] }, motionAnchor: [0.5, 0.5, 0.5] }],
  };
  for (const presentationDebugMode of ['exposure', 'material']) {
    for (const showStructuralOverlay of [false, true]) {
      const meshAssembly = await createGpuStructuralCombustionAssembly({
        device, gridSize: 32, format: 'rgba8unorm', presentationDebugMode,
        structures: [{ id: 'mesh', objectId: 23, state: targetState, sidecar: targetSidecar, meshSurface, showStructuralOverlay }],
      });
      rendered.length = 0;
      meshAssembly.encodePresentation(presentationEncoder, {},
        [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], { width: 640, height: 360 });
      assert.deepEqual(rendered[0], [3, undefined], 'diagnostic colors are drawn on the authored mesh');
      assert.equal(rendered.length, showStructuralOverlay ? 2 : 1,
        'mesh diagnostics must not obscure the surface with nodes unless the caller requests an overlay');
      meshAssembly.destroy();
    }
  }

  assembly.freeze();
  assert.throws(() => assembly.encode(encoder, {}), /frozen/i);
  assembly.destroy();

  const pairStructures = [
    {id: 'first-timber', objectId: 31, state: targetState, sidecar: targetSidecar, load: {magnitude: 0.74}},
    {id: 'second-timber', objectId: 32, state: controlState, sidecar: controlSidecar, load: {magnitude: 0.74}},
  ];
  const pair = await createGpuStructuralCombustionAssembly({
    device, gridSize: 32, format: 'rgba8unorm', structures: pairStructures,
  });
  assert.equal(pair.sourceDescriptor().capacity, targetState.nodes.length + controlState.nodes.length,
    'the shared source stream has room for every emitting node, without a per-object cap');
  passes.length = 0;
  pair.encode(encoder, {});
  assert.deepEqual(passes.filter(label => label.startsWith('structural combustion emit carried sources')), [
    'structural combustion emit carried sources first-timber',
    'structural combustion emit carried sources second-timber',
  ], 'each burning object contributes before the one shared source finalize');
  assert.equal(passes.filter(label => label === 'structural combustion clear source').length, 1);
  assert.equal(passes.filter(label => label === 'structural combustion finalize source').length, 1);
  assert.equal(pair.debugState().runtimeReadbackCount, 0);
  assert.deepEqual(pair.debugState().emittingObjectIds, [31, 32]);
  pair.destroy();
  const quietPair = await createGpuStructuralCombustionAssembly({
    device, gridSize: 32, format: 'rgba8unorm',
    structures: pairStructures.map(structure => ({...structure, emissionEnabled: false})),
  });
  passes.length = 0;
  quietPair.encode(encoder, {});
  assert.equal(passes.filter(label => label.startsWith('structural combustion heat and conduct')).length, 2,
    'the emission-off comparison retains both objects and their live heat sampling');
  assert.equal(passes.filter(label => label.startsWith('structural combustion emit carried sources')).length, 0);
  assert.deepEqual(quietPair.debugState().emittingObjectIds, []);
  quietPair.destroy();
  assert.ok(buffers.every(buffer => buffer.destroyCount === 1));
  assert.ok(textures.every(texture => texture.destroyCount === 1));
} finally {
  if (previousUsage === undefined) delete globalThis.GPUBufferUsage;
  else globalThis.GPUBufferUsage = previousUsage;
  if (previousShaderStage === undefined) delete globalThis.GPUShaderStage;
  else globalThis.GPUShaderStage = previousShaderStage;
  if (previousTextureUsage === undefined) delete globalThis.GPUTextureUsage;
  else globalThis.GPUTextureUsage = previousTextureUsage;
}

console.log('GPU structural combustion contracts: ok');
