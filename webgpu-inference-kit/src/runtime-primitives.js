export const WEBGPU_TENSOR_SCHEMA = 'kaminos.webgpu-tensor.v0';
export const WEBGPU_UNIFORM_BUFFER_SCHEMA = 'kaminos.webgpu-uniform-buffer.v0';
export const WEBGPU_COMPUTE_KERNEL_SCHEMA = 'kaminos.webgpu-compute-kernel.v0';

export const WEBGPU_BUFFER_USAGE = Object.freeze({
  mapRead: 0x0001,
  mapWrite: 0x0002,
  copySrc: 0x0004,
  copyDst: 0x0008,
  index: 0x0010,
  vertex: 0x0020,
  uniform: 0x0040,
  storage: 0x0080,
  indirect: 0x0100,
  queryResolve: 0x0200,
});

export const WEBGPU_SHADER_STAGE = Object.freeze({
  vertex: 0x1,
  fragment: 0x2,
  compute: 0x4,
});

const DTYPE_BYTES = new Map([
  ['f32', 4],
  ['fp32', 4],
  ['float32', 4],
  ['f16', 2],
  ['fp16', 2],
  ['float16', 2],
  ['u32', 4],
  ['i32', 4],
  ['u8', 1],
]);

const UNIFORM_TYPES = new Map([
  ['f32', { align: 4, size: 4, lanes: 1, setter: 'setFloat32' }],
  ['u32', { align: 4, size: 4, lanes: 1, setter: 'setUint32' }],
  ['i32', { align: 4, size: 4, lanes: 1, setter: 'setInt32' }],
  ['vec2<f32>', { align: 8, size: 8, lanes: 2, setter: 'setFloat32' }],
  ['vec2<u32>', { align: 8, size: 8, lanes: 2, setter: 'setUint32' }],
  ['vec2<i32>', { align: 8, size: 8, lanes: 2, setter: 'setInt32' }],
  ['vec3<f32>', { align: 16, size: 12, lanes: 3, setter: 'setFloat32' }],
  ['vec3<u32>', { align: 16, size: 12, lanes: 3, setter: 'setUint32' }],
  ['vec3<i32>', { align: 16, size: 12, lanes: 3, setter: 'setInt32' }],
  ['vec4<f32>', { align: 16, size: 16, lanes: 4, setter: 'setFloat32' }],
  ['vec4<u32>', { align: 16, size: 16, lanes: 4, setter: 'setUint32' }],
  ['vec4<i32>', { align: 16, size: 16, lanes: 4, setter: 'setInt32' }],
]);

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function alignTo(value, alignment) {
  return Math.ceil(value / alignment) * alignment;
}

function normalizeDtype(dtype) {
  if (!isNonEmptyString(dtype)) throw new Error('tensor dtype must be a non-empty string');
  const key = dtype.toLowerCase();
  if (!DTYPE_BYTES.has(key)) throw new Error(`unsupported tensor dtype ${dtype}`);
  if (key === 'fp32' || key === 'float32') return 'f32';
  if (key === 'fp16' || key === 'float16') return 'f16';
  return key;
}

function tensorElements(shape) {
  if (!Array.isArray(shape) || shape.length === 0) {
    throw new Error('tensor shape must be a non-empty array');
  }
  let elements = 1;
  for (const dim of shape) {
    if (!Number.isInteger(dim) || dim <= 0) {
      throw new Error('tensor shape must contain positive integer dimensions');
    }
    elements *= dim;
  }
  return elements;
}

function tensorStrides(shape) {
  const strides = new Array(shape.length);
  let stride = 1;
  for (let index = shape.length - 1; index >= 0; index -= 1) {
    strides[index] = stride;
    stride *= shape[index];
  }
  return strides;
}

function byteLengthOf(data) {
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (ArrayBuffer.isView(data)) return data.byteLength;
  return null;
}

export function createGpuTensor(input = {}, options = {}) {
  if (!isNonEmptyString(input.name)) throw new Error('tensor name must be a non-empty string');
  const shape = [...(input.shape || [])];
  const dtype = normalizeDtype(input.dtype);
  const elements = tensorElements(shape);
  const bytesPerElement = DTYPE_BYTES.get(dtype);
  const byteLength = elements * bytesPerElement;
  const allocationByteLength = alignTo(byteLength, 4);
  const usage = input.usage ?? (
    WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst | WEBGPU_BUFFER_USAGE.copySrc
  );
  if (!Number.isInteger(usage) || usage < 0) throw new Error('tensor usage must be a non-negative integer');

  const tensor = {
    schema: WEBGPU_TENSOR_SCHEMA,
    name: input.name,
    dtype,
    shape,
    strides: tensorStrides(shape),
    elements,
    bytesPerElement,
    byteLength,
    allocationByteLength,
    usage,
    bufferOffset: input.bufferOffset || 0,
    metadata: clone(input.metadata || {}),
  };

  if (input.buffer) {
    tensor.buffer = input.buffer;
  } else if (typeof options.createBuffer === 'function') {
      tensor.buffer = options.createBuffer({
        label: input.label || input.name,
        size: allocationByteLength,
        usage,
        mappedAtCreation: Boolean(input.mappedAtCreation),
      });
  }

  return tensor;
}

export function assertTensorDataByteLength(tensor, data) {
  const byteLength = byteLengthOf(data);
  if (byteLength == null) throw new Error('tensor data must be an ArrayBuffer or typed array view');
  if (byteLength !== tensor.byteLength) {
    throw new Error(`data byteLength ${byteLength} must match tensor byteLength ${tensor.byteLength}`);
  }
  return byteLength;
}

export function packUniforms(schema = [], values = {}) {
  if (!Array.isArray(schema) || schema.length === 0) {
    throw new Error('uniform schema must be a non-empty array');
  }

  const fields = [];
  let cursor = 0;
  for (const field of schema) {
    if (!isNonEmptyString(field?.name)) throw new Error('uniform field name must be a non-empty string');
    if (!isNonEmptyString(field?.type)) throw new Error(`uniform field ${field.name} type must be a non-empty string`);
    const type = field.type.toLowerCase();
    const info = UNIFORM_TYPES.get(type);
    if (!info) throw new Error(`unsupported uniform type ${field.type}`);

    cursor = alignTo(cursor, info.align);
    fields.push({
      name: field.name,
      type,
      offset: cursor,
      byteLength: info.size,
      align: info.align,
      lanes: info.lanes,
    });
    cursor += info.size;
  }

  const byteLength = alignTo(cursor, 16);
  const buffer = new ArrayBuffer(byteLength);
  const view = new DataView(buffer);

  for (const field of fields) {
    const info = UNIFORM_TYPES.get(field.type);
    const value = values[field.name];
    if (info.lanes === 1) {
      if (!Number.isFinite(value)) throw new Error(`uniform ${field.name} must be a finite number`);
      view[info.setter](field.offset, value, true);
      continue;
    }

    if (!Array.isArray(value) && !ArrayBuffer.isView(value)) {
      throw new Error(`uniform ${field.name} must be an array-like value`);
    }
    if (value.length !== info.lanes) {
      throw new Error(`uniform ${field.name} must have ${info.lanes} lanes`);
    }
    for (let lane = 0; lane < info.lanes; lane += 1) {
      if (!Number.isFinite(value[lane])) throw new Error(`uniform ${field.name}[${lane}] must be finite`);
      view[info.setter](field.offset + lane * 4, value[lane], true);
    }
  }

  return {
    schema: schema.map(field => ({ name: field.name, type: field.type.toLowerCase() })),
    fields,
    buffer,
    byteLength,
  };
}

export function createUniformBuffer(input = {}, options = {}) {
  if (!isNonEmptyString(input.label)) throw new Error('uniform buffer label must be a non-empty string');
  if (typeof options.createBuffer !== 'function') throw new Error('createBuffer option is required');
  if (typeof options.writeBuffer !== 'function') throw new Error('writeBuffer option is required');

  const packed = packUniforms(input.schema, input.values || {});
  const buffer = options.createBuffer({
    label: input.label,
    size: packed.byteLength,
    usage: input.usage ?? (WEBGPU_BUFFER_USAGE.uniform | WEBGPU_BUFFER_USAGE.copyDst),
  });

  const uniform = {
    schema: WEBGPU_UNIFORM_BUFFER_SCHEMA,
    label: input.label,
    buffer,
    uniformSchema: packed.schema,
    fields: packed.fields,
    byteLength: packed.byteLength,
    values: clone(input.values || {}),
    update(values = {}) {
      const next = packUniforms(packed.schema, values);
      options.writeBuffer(buffer, next.buffer);
      uniform.fields = next.fields;
      uniform.byteLength = next.byteLength;
      uniform.values = clone(values);
      return uniform;
    },
  };

  options.writeBuffer(buffer, packed.buffer);
  return uniform;
}

function bindingBufferType(binding) {
  if (binding.type === 'uniform') return 'uniform';
  if (binding.access === 'read-only-storage') return 'read-only-storage';
  return 'storage';
}

function bindingResource(binding) {
  const resource = binding.resource;
  if (!resource || typeof resource !== 'object') throw new Error(`binding ${binding.name} resource must be an object`);
  if (!resource.buffer) throw new Error(`binding ${binding.name} resource must expose buffer`);
  const entry = {
    buffer: resource.buffer,
  };
  if (Number.isInteger(resource.bufferOffset) && resource.bufferOffset > 0) entry.offset = resource.bufferOffset;
  if (Number.isInteger(resource.byteLength) && resource.byteLength > 0) entry.size = resource.byteLength;
  return entry;
}

export function defineComputeKernel(input = {}, options = {}) {
  const {
    device,
    getShaderModule,
    getComputePipeline,
  } = options;
  if (!device || typeof device !== 'object') throw new Error('device option is required');
  if (typeof getShaderModule !== 'function') throw new Error('getShaderModule option is required');
  if (typeof getComputePipeline !== 'function') throw new Error('getComputePipeline option is required');
  if (!isNonEmptyString(input.name)) throw new Error('kernel name must be a non-empty string');
  if (!isNonEmptyString(input.code)) throw new Error('kernel code must be a non-empty string');
  const entryPoint = input.entryPoint || 'main';
  if (!Array.isArray(input.bindings) || input.bindings.length === 0) {
    throw new Error('kernel bindings must be a non-empty array');
  }

  for (const method of ['createBindGroupLayout', 'createPipelineLayout', 'createBindGroup']) {
    if (typeof device[method] !== 'function') throw new Error(`device.${method} must be available`);
  }

  const shaderModule = getShaderModule(input.name, input.code, input.shaderModuleDescriptor || {});
  const layoutEntries = input.bindings.map((binding, index) => {
    if (!isNonEmptyString(binding.name)) throw new Error('binding name must be a non-empty string');
    return {
      binding: index,
      visibility: binding.visibility ?? WEBGPU_SHADER_STAGE.compute,
      buffer: {
        type: bindingBufferType(binding),
      },
    };
  });
  const bindGroupEntries = input.bindings.map((binding, index) => ({
    binding: index,
    resource: bindingResource(binding),
  }));
  const bindGroupLayout = device.createBindGroupLayout({
    label: `${input.name}.bind-group-layout`,
    entries: layoutEntries,
  });
  const pipelineLayout = device.createPipelineLayout({
    label: `${input.name}.pipeline-layout`,
    bindGroupLayouts: [bindGroupLayout],
  });
  const bindGroup = device.createBindGroup({
    label: `${input.name}.bind-group`,
    layout: bindGroupLayout,
    entries: bindGroupEntries,
  });
  const pipeline = getComputePipeline(input.name, {
    layout: pipelineLayout,
    compute: {
      module: shaderModule,
      entryPoint,
    },
  });

  return {
    schema: WEBGPU_COMPUTE_KERNEL_SCHEMA,
    name: input.name,
    entryPoint,
    shaderModule,
    bindGroupLayout,
    pipelineLayout,
    bindGroup,
    pipeline,
    bindings: input.bindings.map((binding, index) => ({
      name: binding.name,
      binding: index,
      type: bindingBufferType(binding),
    })),
    metadata: clone(input.metadata || {}),
  };
}
