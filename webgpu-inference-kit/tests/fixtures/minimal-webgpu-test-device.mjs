function sourceBytes(data, dataOffset = 0, size = undefined) {
  const bytes = data instanceof ArrayBuffer
    ? new Uint8Array(data)
    : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  const end = size == null ? bytes.byteLength : dataOffset + size;
  return bytes.slice(dataOffset, end);
}

export function createMinimalWebGpuTestSurface() {
  const calls = {
    bufferCreations: [],
    bufferDestructions: [],
    computePipelineCreations: 0,
    dispatches: [],
    submissions: 0,
  };
  let resolveLost;
  const lost = new Promise(resolve => { resolveLost = resolve; });

  function createBuffer(descriptor) {
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
    calls.bufferCreations.push(descriptor.label);
    return buffer;
  }

  const queue = {
    writeBuffer(buffer, offset, data, dataOffset = 0, size = undefined) {
      new Uint8Array(buffer.data).set(sourceBytes(data, dataOffset, size), offset);
    },
    submit(commandBuffers) {
      calls.submissions += 1;
      for (const commandBuffer of commandBuffers) {
        for (const operation of commandBuffer.operations) {
          if (operation.kind === 'copy') {
            const source = new Uint8Array(operation.source.data, operation.sourceOffset, operation.size);
            new Uint8Array(operation.destination.data).set(source, operation.destinationOffset);
            continue;
          }
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
    createShaderModule(descriptor) { return { descriptor }; },
    createBindGroupLayout(descriptor) { return { descriptor }; },
    createPipelineLayout(descriptor) { return { descriptor }; },
    createBindGroup(descriptor) { return { descriptor }; },
    createComputePipeline(descriptor) {
      calls.computePipelineCreations += 1;
      return { descriptor };
    },
    createCommandEncoder(descriptor) {
      const operations = [];
      return {
        copyBufferToBuffer(source, sourceOffset, destination, destinationOffset, size) {
          operations.push({ kind: 'copy', source, sourceOffset, destination, destinationOffset, size });
        },
        beginComputePass() {
          const operation = { kind: 'compute', pipeline: null, bindGroup: null, dispatch: null };
          return {
            setPipeline(pipeline) { operation.pipeline = pipeline; },
            setBindGroup(_index, bindGroup) { operation.bindGroup = bindGroup; },
            dispatchWorkgroups(x, y, z) {
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
