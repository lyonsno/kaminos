export const WEBGPU_PHASE_PROGRAM_SCHEMA = 'kaminos.webgpu-phase-program.v0';
export const WEBGPU_PHASE_PROGRAM_RUN_SCHEMA = 'kaminos.webgpu-phase-program-run.v0';

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function publicSchedulerInvocation(invocation) {
  if (invocation == null) return null;
  return {
    schema: invocation.schema,
    routeId: invocation.routeId,
    invocationId: invocation.invocationId,
    schedulerRevision: invocation.schedulerRevision,
    scheduler: clone(invocation.scheduler),
    bounds: clone(invocation.bounds),
    applicationAuthority: invocation.applicationAuthority,
  };
}

function normalizeDispatch(dispatch) {
  if (!Array.isArray(dispatch) || dispatch.length < 1 || dispatch.length > 3) {
    throw new Error('phase dispatch must be an array with 1 to 3 dimensions');
  }
  const normalized = [dispatch[0], dispatch[1] ?? 1, dispatch[2] ?? 1];
  for (const dim of normalized) {
    if (!Number.isInteger(dim) || dim < 1) throw new Error('phase dispatch dimensions must be positive integers');
  }
  return normalized;
}

function splitResourceRef(ref) {
  const delimiter = ref.indexOf(':');
  if (delimiter === -1) return { kind: null, name: ref };
  return {
    kind: ref.slice(0, delimiter),
    name: ref.slice(delimiter + 1),
  };
}

function resolveFromTable(table, name) {
  if (!table || typeof table !== 'object') return undefined;
  return table[name];
}

function resolveNamedResource(ref, tables) {
  if (ref && typeof ref === 'object') return ref;
  if (!isNonEmptyString(ref)) throw new Error('phase program resource reference must be a non-empty string or object');

  const { kind, name } = splitResourceRef(ref);
  if (!isNonEmptyString(name)) throw new Error(`phase program resource reference ${ref} is missing a resource name`);

  if (kind === 'tensor' || kind === 'tensors') {
    const resource = resolveFromTable(tables.tensors, name);
    if (!resource) throw new Error(`unknown tensor resource ${name}`);
    return resource;
  }
  if (kind === 'uniform' || kind === 'uniforms') {
    const resource = resolveFromTable(tables.uniforms, name);
    if (!resource) throw new Error(`unknown uniform resource ${name}`);
    return resource;
  }
  if (kind === 'buffer' || kind === 'buffers') {
    const resource = resolveFromTable(tables.buffers, name);
    if (!resource) throw new Error(`unknown buffer resource ${name}`);
    return resource;
  }
  if (kind === 'resource' || kind === 'resources') {
    const resource = resolveFromTable(tables.resources, name);
    if (!resource) throw new Error(`unknown resource ${name}`);
    return resource;
  }
  if (kind) throw new Error(`unsupported phase program resource kind ${kind}`);

  const resource = resolveFromTable(tables.resources, name)
    || resolveFromTable(tables.tensors, name)
    || resolveFromTable(tables.uniforms, name)
    || resolveFromTable(tables.buffers, name);
  if (!resource) throw new Error(`unknown resource ${name}`);
  return resource;
}

function resolveKernelBindings(bindings, tables) {
  if (!Array.isArray(bindings) || bindings.length === 0) {
    throw new Error('phase program kernel bindings must be a non-empty array');
  }
  return bindings.map(binding => ({
    ...binding,
    resource: resolveNamedResource(binding.resource, tables),
  }));
}

function normalizeReadbacks(phase, tables) {
  const readbacks = phase.readbacks ?? phase.readback;
  const list = Array.isArray(readbacks) ? readbacks : [readbacks];
  if (list.length === 0 || list.some(item => item == null)) {
    throw new Error(`phase ${phase.name} readbacks must be a non-empty array`);
  }
  return list.map(readback => {
    const tensorRef = readback.tensor ?? readback.resource;
    const name = readback.name || readback.as;
    if (!isNonEmptyString(name)) throw new Error(`phase ${phase.name} readback name must be a non-empty string`);
    return {
      name,
      tensor: resolveNamedResource(tensorRef, tables),
      options: clone(readback.options || {}),
      metadata: clone(readback.metadata || {}),
    };
  });
}

export function defineWebGpuPhaseProgram(input = {}, options = {}) {
  const runtime = options.runtime;
  if (!runtime || typeof runtime !== 'object') throw new Error('runtime option is required');
  if (typeof runtime.defineComputeKernel !== 'function') {
    throw new Error('runtime.defineComputeKernel must be available');
  }
  if (!isNonEmptyString(input.name)) throw new Error('phase program name must be a non-empty string');
  if (!Array.isArray(input.phases) || input.phases.length === 0) {
    throw new Error('phase program phases must be a non-empty array');
  }

  const tables = {
    tensors: input.tensors || {},
    uniforms: input.uniforms || {},
    buffers: input.buffers || {},
    resources: input.resources || {},
  };
  const kernelInputs = input.kernels || {};
  const definedKernels = new Map();

  function defineKernel(name, kernelInput) {
    if (!isNonEmptyString(name)) throw new Error('phase program kernel name must be a non-empty string');
    if (definedKernels.has(name)) return definedKernels.get(name);
    if (!kernelInput || typeof kernelInput !== 'object') throw new Error(`unknown kernel ${name}`);

    const kernel = kernelInput.pipeline && kernelInput.bindGroup
      ? kernelInput
      : runtime.defineComputeKernel({
        ...kernelInput,
        name: kernelInput.name || name,
        bindings: resolveKernelBindings(kernelInput.bindings, tables),
      });
    definedKernels.set(name, kernel);
    return kernel;
  }

  const phases = input.phases.map((phase, phaseIndex) => {
    if (!phase || typeof phase !== 'object') throw new Error('phase program phase must be an object');
    if (!isNonEmptyString(phase.name)) throw new Error('phase name must be a non-empty string');

    if (phase.kernel != null) {
      const kernelName = typeof phase.kernel === 'string'
        ? phase.kernel
        : (phase.kernel.name || `${phase.name}.kernel`);
      const kernelInput = typeof phase.kernel === 'string' ? kernelInputs[kernelName] : phase.kernel;
      const kernel = defineKernel(kernelName, kernelInput);
      return {
        kind: 'kernel',
        name: phase.name,
        phaseIndex,
        kernel,
        dispatch: normalizeDispatch(phase.dispatch ?? phase.kernel?.dispatch),
        yieldAfter: phase.yieldAfter ?? input.yieldPolicy?.afterEachKernel ?? false,
        yieldReason: phase.yieldReason || `${input.name}.${phase.name}.post-submit`,
        commandDuty: clone(phase.commandDuty || {}),
        metadata: clone(phase.metadata || {}),
      };
    }

    if (phase.readbacks != null || phase.readback != null) {
      return {
        kind: 'readback',
        name: phase.name,
        phaseIndex,
        readbacks: normalizeReadbacks(phase, tables),
        metadata: clone(phase.metadata || {}),
      };
    }

    throw new Error(`phase ${phase.name} must declare a kernel or readbacks`);
  });

  return {
    schema: WEBGPU_PHASE_PROGRAM_SCHEMA,
    name: input.name,
    resourceNames: {
      tensors: Object.keys(tables.tensors),
      uniforms: Object.keys(tables.uniforms),
      buffers: Object.keys(tables.buffers),
      resources: Object.keys(tables.resources),
    },
    phases,
    yieldPolicy: clone(input.yieldPolicy || {}),
    metadata: clone(input.metadata || {}),
  };
}

export async function runWebGpuPhaseProgram(program, options = {}) {
  const runtime = options.runtime;
  if (!runtime || typeof runtime !== 'object') throw new Error('runtime option is required');
  if (program?.schema !== WEBGPU_PHASE_PROGRAM_SCHEMA) throw new Error('phase program schema is invalid');
  if (typeof runtime.runKernel !== 'function') throw new Error('runtime.runKernel must be available');
  if (typeof runtime.runStage !== 'function') throw new Error('runtime.runStage must be available');

  const outputs = {};
  const phaseResults = [];
  const schedulerInvocation = options.schedulerInvocation || null;
  for (const phase of program.phases) {
    if (phase.kind === 'kernel') {
      const commandBuffer = await runtime.runKernel(phase.kernel, {
        stage: phase.name,
        dispatch: phase.dispatch,
        yieldAfter: phase.yieldAfter,
        yieldReason: phase.yieldReason,
        commandDuty: clone(phase.commandDuty),
        schedulerInvocation,
        metadata: {
          ...phase.metadata,
          phaseMetadata: clone(phase.metadata || {}),
          programName: program.name,
          phaseName: phase.name,
          phaseIndex: phase.phaseIndex,
        },
      });
      phaseResults.push({ name: phase.name, kind: phase.kind, commandBuffer });
      continue;
    }

    if (phase.kind === 'readback') {
      const phaseOutputs = await runtime.runStage(phase.name, async stage => {
        const readbackOutputs = {};
        for (const readback of phase.readbacks) {
          const readbackOptions = clone(readback.options);
          readbackOptions.schedulerInvocation = schedulerInvocation;
          readbackOutputs[readback.name] = await stage.readTensor(readback.tensor, readbackOptions);
        }
        return readbackOutputs;
      }, {
        ...phase.metadata,
        phaseMetadata: clone(phase.metadata || {}),
        programName: program.name,
        phaseName: phase.name,
        phaseIndex: phase.phaseIndex,
        readbacks: phase.readbacks.map(readback => readback.name),
      });
      Object.assign(outputs, phaseOutputs);
      phaseResults.push({ name: phase.name, kind: phase.kind, outputs: Object.keys(phaseOutputs) });
      continue;
    }

    throw new Error(`unsupported phase kind ${phase.kind}`);
  }

  return {
    schema: WEBGPU_PHASE_PROGRAM_RUN_SCHEMA,
    programName: program.name,
    phaseNames: phaseResults.map(phase => phase.name),
    phases: phaseResults,
    outputs,
    schedulerInvocation: publicSchedulerInvocation(schedulerInvocation),
  };
}
