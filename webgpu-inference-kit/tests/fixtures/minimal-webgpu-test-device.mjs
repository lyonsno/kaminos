const EXPECTED_AFFINE_KERNEL = `
@group(0) @binding(0) var<storage, read> input_values: array<f32>;
@group(0) @binding(1) var<storage, read_write> output_values: array<f32>;

@compute @workgroup_size(4)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x < 4u) {
    output_values[id.x] = input_values[id.x] * 2.0 + 1.0;
  }
}
`;

function rejectUnexpected(condition, detail) {
  if (!condition) {
    throw new Error(`deterministic affine fixture rejected unexpected ${detail}`);
  }
}

function sourceBytes(data, dataOffset = 0, size = undefined) {
  const bytes = data instanceof ArrayBuffer
    ? new Uint8Array(data)
    : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  const end = size == null ? bytes.byteLength : dataOffset + size;
  return bytes.slice(dataOffset, end);
}

const AFFINE_BUFFER_ROLES = new Set(['input', 'output']);
const COPY_SOURCE_USAGE = 0x0004;
const COPY_DESTINATION_USAGE = 0x0008;
const STORAGE_USAGE = 0x0080;

export function createMinimalWebGpuTestSurface({
  failSubmissionAt = null,
  omitStorageUsageFor = null,
  substituteBoundBufferFor = null,
} = {}) {
  if (failSubmissionAt != null && (!Number.isInteger(failSubmissionAt) || failSubmissionAt < 1)) {
    throw new Error('failSubmissionAt must be a positive integer or null');
  }
  if (omitStorageUsageFor != null && !AFFINE_BUFFER_ROLES.has(omitStorageUsageFor)) {
    throw new Error('omitStorageUsageFor must be input, output, or null');
  }
  if (substituteBoundBufferFor != null && !AFFINE_BUFFER_ROLES.has(substituteBoundBufferFor)) {
    throw new Error('substituteBoundBufferFor must be input, output, or null');
  }
  const calls = {
    bufferCreations: [],
    bufferDestructions: [],
    shaderModuleCreations: [],
    bindGroupLayoutCreations: [],
    pipelineLayoutCreations: [],
    bindGroupCreations: [],
    computePipelineDescriptors: [],
    computePipelineCreations: 0,
    deviceDestructions: 0,
    dispatches: [],
    submissions: 0,
  };
  let resolveLost;
  let affineShaderModule;
  let affineBindGroupLayout;
  let affinePipelineLayout;
  let affineInputBuffer;
  let affineOutputBuffer;
  let affineBindGroup;
  let affinePipeline;
  const lost = new Promise(resolve => { resolveLost = resolve; });

  function createBuffer(requestedDescriptor) {
    const role = requestedDescriptor.label === 'getting-started.input'
      ? 'input'
      : requestedDescriptor.label === 'getting-started.output' ? 'output' : null;
    const descriptor = role === omitStorageUsageFor
      ? { ...requestedDescriptor, usage: requestedDescriptor.usage & ~STORAGE_USAGE }
      : requestedDescriptor;
    const data = new ArrayBuffer(descriptor.size);
    const buffer = {
      descriptor,
      data,
      async mapAsync() {},
      getMappedRange(offset = 0, size = descriptor.size - offset) {
        return data.slice(offset, offset + size);
      },
      unmap() {},
      destroy() {
        calls.bufferDestructions.push(descriptor.label);
      },
    };
    if (role === 'input' && affineInputBuffer == null) affineInputBuffer = buffer;
    if (role === 'output' && affineOutputBuffer == null) affineOutputBuffer = buffer;
    calls.bufferCreations.push(descriptor.label);
    return buffer;
  }

  const queue = {
    writeBuffer(buffer, offset, data, dataOffset = 0, size = undefined) {
      new Uint8Array(buffer.data).set(sourceBytes(data, dataOffset, size), offset);
    },
    submit(commandBuffers) {
      calls.submissions += 1;
      if (calls.submissions === failSubmissionAt) {
        throw new Error('deterministic queue submission failure');
      }
      for (const commandBuffer of commandBuffers) {
        for (const operation of commandBuffer.operations) {
          if (operation.kind === 'copy') {
            const source = new Uint8Array(operation.source.data, operation.sourceOffset, operation.size);
            new Uint8Array(operation.destination.data).set(source, operation.destinationOffset);
            continue;
          }
          rejectUnexpected(operation.pipeline === affinePipeline, 'compute pipeline');
          rejectUnexpected(operation.bindGroup === affineBindGroup, 'compute bind group');
          rejectUnexpected(
            operation.dispatch?.length === 3
              && operation.dispatch.every((value, index) => value === [1, 1, 1][index]),
            'dispatch dimensions',
          );
          const entries = operation.bindGroup.descriptor.entries;
          const input = new Float32Array(entries[0].resource.buffer.data);
          const output = new Float32Array(entries[1].resource.buffer.data);
          for (let index = 0; index < Math.min(input.length, output.length); index += 1) {
            output[index] = input[index] * 2 + 1;
          }
        }
      }
    },
    async onSubmittedWorkDone() {},
  };

  const device = {
    queue,
    features: new Set(),
    limits: {
      maxBufferSize: 1 << 20,
      maxStorageBufferBindingSize: 1 << 20,
      maxComputeWorkgroupStorageSize: 16 << 10,
      maxComputeInvocationsPerWorkgroup: 256,
      maxComputeWorkgroupSizeX: 256,
      maxComputeWorkgroupSizeY: 256,
    },
    lost,
    createBuffer,
    createShaderModule(descriptor) {
      rejectUnexpected(descriptor?.label === 'getting-started.affine-f32', 'shader label');
      rejectUnexpected(descriptor?.code === EXPECTED_AFFINE_KERNEL, 'shader source');
      calls.shaderModuleCreations.push(descriptor);
      affineShaderModule = { descriptor };
      return affineShaderModule;
    },
    createBindGroupLayout(descriptor) {
      const entries = descriptor?.entries;
      rejectUnexpected(descriptor?.label === 'getting-started.affine-f32.bind-group-layout', 'bind-group-layout label');
      rejectUnexpected(Array.isArray(entries) && entries.length === 2, 'bind-group-layout entry count');
      rejectUnexpected(
        entries[0]?.binding === 0
          && entries[0]?.visibility === 0x4
          && entries[0]?.buffer?.type === 'read-only-storage',
        'input binding layout',
      );
      rejectUnexpected(
        entries[1]?.binding === 1
          && entries[1]?.visibility === 0x4
          && entries[1]?.buffer?.type === 'storage',
        'output binding layout',
      );
      calls.bindGroupLayoutCreations.push(descriptor);
      affineBindGroupLayout = { descriptor };
      return affineBindGroupLayout;
    },
    createPipelineLayout(descriptor) {
      rejectUnexpected(descriptor?.label === 'getting-started.affine-f32.pipeline-layout', 'pipeline-layout label');
      rejectUnexpected(
        descriptor?.bindGroupLayouts?.length === 1
          && descriptor.bindGroupLayouts[0] === affineBindGroupLayout,
        'pipeline bind-group layout',
      );
      calls.pipelineLayoutCreations.push(descriptor);
      affinePipelineLayout = { descriptor };
      return affinePipelineLayout;
    },
    createBindGroup(descriptor) {
      const entries = descriptor?.entries?.map(entry => {
        const role = entry.binding === 0 ? 'input' : entry.binding === 1 ? 'output' : null;
        if (role !== substituteBoundBufferFor) return entry;
        const original = entry.resource?.buffer;
        return {
          ...entry,
          resource: {
            ...entry.resource,
            buffer: {
              ...original,
              descriptor: { ...original.descriptor },
              data: new ArrayBuffer(original.data.byteLength),
            },
          },
        };
      });
      descriptor = { ...descriptor, entries };
      rejectUnexpected(descriptor?.label === 'getting-started.affine-f32.bind-group', 'bind-group label');
      rejectUnexpected(descriptor?.layout === affineBindGroupLayout, 'bind-group layout');
      rejectUnexpected(Array.isArray(entries) && entries.length === 2, 'bind-group entry count');
      rejectUnexpected(
        entries[0]?.binding === 0
          && entries[0]?.resource?.buffer === affineInputBuffer,
        'input buffer identity',
      );
      rejectUnexpected(
        entries[1]?.binding === 1
          && entries[1]?.resource?.buffer === affineOutputBuffer,
        'output buffer identity',
      );
      rejectUnexpected(
        (affineInputBuffer?.descriptor?.usage & (STORAGE_USAGE | COPY_DESTINATION_USAGE))
          === (STORAGE_USAGE | COPY_DESTINATION_USAGE),
        'input buffer usage',
      );
      rejectUnexpected(
        (affineOutputBuffer?.descriptor?.usage & (STORAGE_USAGE | COPY_SOURCE_USAGE))
          === (STORAGE_USAGE | COPY_SOURCE_USAGE),
        'output buffer usage',
      );
      calls.bindGroupCreations.push(descriptor);
      affineBindGroup = { descriptor };
      return affineBindGroup;
    },
    createComputePipeline(descriptor) {
      rejectUnexpected(descriptor?.label === 'getting-started.affine-f32', 'compute-pipeline label');
      rejectUnexpected(descriptor?.layout === affinePipelineLayout, 'compute-pipeline layout');
      rejectUnexpected(descriptor?.compute?.module === affineShaderModule, 'compute-pipeline shader module');
      rejectUnexpected(descriptor?.compute?.entryPoint === 'main', 'compute-pipeline entry point');
      calls.computePipelineCreations += 1;
      calls.computePipelineDescriptors.push(descriptor);
      affinePipeline = { descriptor };
      return affinePipeline;
    },
    createCommandEncoder(descriptor) {
      const operations = [];
      return {
        copyBufferToBuffer(source, sourceOffset, destination, destinationOffset, size) {
          operations.push({ kind: 'copy', source, sourceOffset, destination, destinationOffset, size });
        },
        beginComputePass(passDescriptor) {
          rejectUnexpected(descriptor?.label === 'getting-started.affine-f32.encoder', 'command-encoder label');
          rejectUnexpected(passDescriptor?.label === 'getting-started.affine-f32.compute-pass', 'compute-pass label');
          const operation = { kind: 'compute', pipeline: null, bindGroup: null, dispatch: null };
          return {
            setPipeline(pipeline) {
              rejectUnexpected(pipeline === affinePipeline, 'compute pipeline');
              operation.pipeline = pipeline;
            },
            setBindGroup(index, bindGroup) {
              rejectUnexpected(index === 0 && bindGroup === affineBindGroup, 'compute bind group');
              operation.bindGroup = bindGroup;
            },
            dispatchWorkgroups(x, y, z) {
              rejectUnexpected(x === 1 && y === 1 && z === 1, 'dispatch dimensions');
              operation.dispatch = [x, y, z];
              calls.dispatches.push(operation.dispatch);
            },
            end() { operations.push(operation); },
          };
        },
        finish() { return { descriptor, operations }; },
      };
    },
    destroy() {
      calls.deviceDestructions += 1;
      resolveLost({ reason: 'destroyed', message: 'destroyed by getting-started test' });
    },
  };

  const adapter = {
    info: { description: 'Kaminos deterministic test adapter' },
    features: device.features,
    limits: device.limits,
    async requestDevice() { return device; },
  };

  return {
    calls,
    gpu: { async requestAdapter() { return adapter; } },
  };
}
