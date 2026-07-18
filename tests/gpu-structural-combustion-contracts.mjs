import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createLayeredStructuralMaterial } from '../structural-material-3d-core.js';
import {
  STRUCTURAL_COMBUSTION_AUTHORITY,
  STRUCTURAL_COMBUSTION_SCHEMA,
  createGpuStructuralCombustionAssembly,
  evaluateStructuralCombustionTerminalChecks,
} from '../structural-combustion-gpu.mjs';
import { validateCombustibleObjectSourceDescriptor } from '../volume-core.js';

const source = readFileSync(new URL('../structural-combustion-gpu.mjs', import.meta.url), 'utf8');
const volumeSource = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
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
  volumeSource,
  /setGpuCombustibleObjectLoop[\s\S]*?if \(gpuStructuralCombustionAssembly\)[\s\S]*?cannot share the dynamic Pyro source socket/,
  'the legacy GPU object loop cannot overwrite an installed structural-combustion source',
);

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
globalThis.GPUBufferUsage = { STORAGE: 1, COPY_DST: 2, COPY_SRC: 4, UNIFORM: 8, MAP_READ: 16 };
globalThis.GPUShaderStage = { COMPUTE: 1, VERTEX: 2, FRAGMENT: 4 };

const buffers = [];
let presentationCompilationMessages = [];
const queue = { writeBuffer() {}, async onSubmittedWorkDone() {} };
const device = {
  queue,
  createBuffer(descriptor) {
    const buffer = { descriptor, destroyCount: 0, destroy() { this.destroyCount += 1; } };
    buffers.push(buffer);
    return buffer;
  },
  createShaderModule(descriptor) {
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
  createBindGroupLayout() { return {}; },
  createPipelineLayout() { return {}; },
  async createComputePipelineAsync() { return { getBindGroupLayout() { return {}; } }; },
  async createRenderPipelineAsync() { return { getBindGroupLayout() { return {}; } }; },
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
      structures: [
        { id: 'target', objectId: 21, state: targetState, sidecar: targetSidecar, control: false },
        { id: 'control', objectId: 22, state: controlState, sidecar: controlSidecar, control: true },
      ],
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
  const assembly = await createGpuStructuralCombustionAssembly({
    device,
    gridSize: 32,
    format: 'rgba8unorm',
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
    ),
    true,
  );
  assert.equal(rendered.length, 4, 'target and control each draw resident bonds and node billboards');

  assembly.freeze();
  assert.throws(() => assembly.encode(encoder, {}), /frozen/i);
  assembly.destroy();
  assert.ok(buffers.every(buffer => buffer.destroyCount === 1));
} finally {
  if (previousUsage === undefined) delete globalThis.GPUBufferUsage;
  else globalThis.GPUBufferUsage = previousUsage;
  if (previousShaderStage === undefined) delete globalThis.GPUShaderStage;
  else globalThis.GPUShaderStage = previousShaderStage;
}

console.log('GPU structural combustion contracts: ok');
