// Model-owned op executor for SuperMat. Encodes dispatches into one compute
// pass per flush, reuses activation buffers by exact byte size, and creates one
// small uniform buffer per dispatch (destroyed after the flush completes).
import {
  gemmShader, GEMM_PARAMS_WORDS, GEMM_TILE, GROUPNORM_CHUNK, groupNormPartialShader,
  groupNormCombineShader, groupNormApplyShader, layerNormShader, softmaxShader, gegluShader,
  affineShader,
} from './supermat-kernels.js';

const STORAGE = 0x0080, COPY_SRC = 0x0004, COPY_DST = 0x0008, UNIFORM = 0x0040;
const ACTIVATION_USAGE = STORAGE | COPY_SRC | COPY_DST;

export function elements(shape) {
  return shape.reduce((product, dim) => product * dim, 1);
}

// Accept kit tensor views ({buffer, bufferOffset, byteLength}) and op tensors.
export function bindingView(tensor, label = 'tensor') {
  if (!tensor?.buffer) throw new Error(`${label}: GPU tensor view required`);
  const offset = tensor.bufferOffset ?? tensor.offset ?? 0;
  const size = tensor.byteLength ?? tensor.size;
  if (!Number.isSafeInteger(size) || size <= 0) throw new Error(`${label}: positive byte length required`);
  return { buffer: tensor.buffer, offset, size };
}

function dispatch1D(total, workgroupSize = 256, limit = 65535) {
  const groups = Math.ceil(total / workgroupSize);
  const x = Math.min(groups, limit);
  const y = Math.ceil(groups / x);
  if (y > limit) throw new RangeError('dispatch exceeds device workgroup grid');
  return [x, y, 1];
}

export function createSuperMatOps(device, { label = 'supermat' } = {}) {
  const pipelines = new Map();
  const pool = new Map();
  const owned = new Set();
  let encoder = null, pass = null, transient = [];
  // Cooperative schedule for one run: { runtime, invocation, control, signal, dutyFlops }.
  // Without it every op lands in one submission at flush().
  let schedule = null, pendingFlops = 0, lastFence = Promise.resolve();
  const stats = { dispatches: 0, pipelines: 0, createdBuffers: 0, createdBytes: 0, liveBytes: 0, peakLiveBytes: 0, flushes: 0,
    duties: 0, dutyHistory: [] };

  function pipeline(code) {
    let entry = pipelines.get(code);
    if (!entry) {
      const module = device.createShaderModule({ label: `${label}.shader`, code });
      entry = device.createComputePipeline({ label: `${label}.pipeline`, layout: 'auto', compute: { module, entryPoint: 'main' } });
      pipelines.set(code, entry);
      stats.pipelines++;
    }
    return entry;
  }

  // `fresh` bypasses the pool: queue.writeBuffer runs before already-encoded
  // commands are submitted, so an upload must never land in a recycled buffer.
  function alloc(shape, name = 'activation', { fresh = false } = {}) {
    const count = elements(shape);
    if (!Number.isSafeInteger(count) || count <= 0) throw new Error(`${name}: positive shape required`);
    const byteLength = count * 4;
    let buffer = fresh ? undefined : pool.get(byteLength)?.pop();
    if (!buffer) {
      buffer = device.createBuffer({ label: `${label}.${name}`, size: byteLength, usage: ACTIVATION_USAGE });
      stats.createdBuffers++;
      stats.createdBytes += byteLength;
    }
    owned.add(buffer);
    stats.liveBytes += byteLength;
    stats.peakLiveBytes = Math.max(stats.peakLiveBytes, stats.liveBytes);
    return { buffer, offset: 0, byteLength, shape: [...shape], name };
  }

  function release(tensor) {
    if (!tensor || !owned.has(tensor.buffer)) return;
    owned.delete(tensor.buffer);
    stats.liveBytes -= tensor.byteLength;
    const list = pool.get(tensor.byteLength) ?? [];
    list.push(tensor.buffer);
    pool.set(tensor.byteLength, list);
  }

  function params(words) {
    const size = Math.max(16, Math.ceil(words.byteLength / 16) * 16);
    const buffer = device.createBuffer({ label: `${label}.params`, size, usage: UNIFORM | COPY_DST, mappedAtCreation: true });
    new Uint8Array(buffer.getMappedRange()).set(new Uint8Array(words.buffer, words.byteOffset, words.byteLength));
    buffer.unmap();
    transient.push(buffer);
    return { buffer, offset: 0, size };
  }

  function ensurePass() {
    encoder ??= device.createCommandEncoder({ label: `${label}.encoder` });
    pass ??= encoder.beginComputePass({ label: `${label}.pass` });
    return pass;
  }

  function dispatch(code, views, groups) {
    const compute = pipeline(code);
    const bindGroup = device.createBindGroup({
      layout: compute.getBindGroupLayout(0),
      entries: views.map((view, binding) => ({ binding, resource: view })),
    });
    const target = ensurePass();
    target.setPipeline(compute);
    target.setBindGroup(0, bindGroup);
    target.dispatchWorkgroups(...groups);
    stats.dispatches++;
  }

  function copy(source, destination, { sourceOffset = 0, destinationOffset = 0, size }) {
    if (pass) { pass.end(); pass = null; }
    encoder ??= device.createCommandEncoder({ label: `${label}.encoder` });
    const src = bindingView(source, 'copy source'), dst = bindingView(destination, 'copy destination');
    encoder.copyBufferToBuffer(src.buffer, src.offset + sourceOffset, dst.buffer, dst.offset + destinationOffset, size);
  }

  function throwIfStopped() {
    const signal = schedule?.signal;
    if (!signal?.aborted) return;
    const error = new Error(String(signal.reason?.message ?? signal.reason ?? 'SuperMat stopped'));
    error.name = 'AbortError';
    throw error;
  }

  // Submit the encoded block as one command duty: wait for the previous duty's
  // queue fence (one duty in flight), pass the pause gate, let pending
  // foreground frames submit first, then submit and settle.
  async function submitDuty(label) {
    if (pass) { pass.end(); pass = null; }
    throwIfStopped();
    if (!encoder) return;
    const commands = encoder.finish();
    encoder = null;
    const buffers = transient;
    transient = [];
    const flops = pendingFlops;
    pendingFlops = 0;
    await lastFence;
    const { runtime, invocation, control } = schedule;
    const work = async () => {
      throwIfStopped();
      const descriptor = await runtime.prepareCommandDutyAtBoundary({ phase: label, kind: 'compute',
        metadata: { model: 'supermat', estimatedFlops: flops } }, invocation);
      throwIfStopped();
      runtime.settleCommandDuty(descriptor, { status: 'encoded' });
      device.queue.submit([commands]);
    };
    const gateStart = performance.now();
    let submitted = null;
    const timed = async () => { await work(); submitted = performance.now(); };
    if (control) await control.runDuty(timed); else await timed();
    stats.duties++;
    const row = { label, estimatedFlops: flops, submittedAt: submitted, gateWaitMs: submitted - gateStart };
    stats.dutyHistory.push(row);
    lastFence = device.queue.onSubmittedWorkDone().then(() => {
      row.queueMs = performance.now() - submitted;
      for (const buffer of buffers) buffer.destroy();
    });
  }

  // Graph yield point: submit once the encoded block reaches the duty budget.
  async function yieldPoint(label) {
    if (!schedule) return;
    throwIfStopped();
    if (pendingFlops >= (schedule.dutyFlops ?? 0)) await submitDuty(label);
  }

  // Drop unsubmitted work after a failed or stopped run so the next run starts clean.
  async function discard() {
    if (pass) { pass.end(); pass = null; }
    encoder = null;
    pendingFlops = 0;
    const buffers = transient;
    transient = [];
    await lastFence.catch(() => {});
    await device.queue.onSubmittedWorkDone();
    for (const buffer of buffers) buffer.destroy();
    schedule = null;
    lastFence = Promise.resolve();
  }

  function setSchedule(next) {
    if (encoder || pass) throw new Error('cannot change the SuperMat schedule with unsubmitted work');
    if (next && (typeof next.runtime?.prepareCommandDutyAtBoundary !== 'function'
      || typeof next.runtime?.settleCommandDuty !== 'function' || !next.invocation)) {
      throw new Error('SuperMat schedule requires a route runtime and its queued invocation');
    }
    schedule = next;
    pendingFlops = 0;
    lastFence = Promise.resolve();
  }

  async function flush() {
    if (schedule) {
      await submitDuty('flush');
      await lastFence;
      return;
    }
    if (pass) { pass.end(); pass = null; }
    const buffers = transient;
    transient = [];
    if (encoder) {
      device.queue.submit([encoder.finish()]);
      encoder = null;
      stats.flushes++;
    }
    await device.queue.onSubmittedWorkDone();
    for (const buffer of buffers) buffer.destroy();
  }

  function gemmWords(spec) {
    const words = new Uint32Array(GEMM_PARAMS_WORDS);
    const floats = new Float32Array(words.buffer);
    words.set([spec.M, spec.N, spec.K], 0);
    floats[3] = spec.alpha ?? 1;
    words.set([spec.aOff ?? 0, spec.aSM, spec.aSK, spec.aSB ?? 0], 4);
    words.set([spec.bOff ?? 0, spec.bSK, spec.bSN, spec.bSB ?? 0], 8);
    words.set([spec.cOff ?? 0, spec.cSM, spec.cSN, spec.cSB ?? 0], 12);
    words.set([spec.padTop ?? 0, spec.padLeft ?? 0, spec.nBase ?? 0, 0], 16);
    return words;
  }

  // General strided, batched GEMM. Output tensor `c` is allocated unless given.
  function gemm(spec) {
    const { M, N, K, batch = 1 } = spec;
    for (const [name, value] of Object.entries({ M, N, K, batch })) {
      if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`gemm ${name} must be positive`);
    }
    const c = spec.c ?? alloc(spec.outShape ?? [batch, M, N], spec.name ?? 'gemm');
    const layout = {
      aKContiguous: spec.aSK === 1, bNContiguous: spec.bSN === 1,
      biasM: Boolean(spec.biasM), biasM2: Boolean(spec.biasM2), biasN: Boolean(spec.biasN),
      residual: Boolean(spec.residual), conv: spec.conv ?? null,
    };
    const views = [bindingView(spec.a, 'gemm a'), bindingView(spec.b, 'gemm b')];
    if (spec.biasM) views.push(bindingView(spec.biasM, 'gemm biasM'));
    if (spec.biasM2) views.push(bindingView(spec.biasM2, 'gemm biasM2'));
    if (spec.biasN) views.push(bindingView(spec.biasN, 'gemm biasN'));
    if (spec.residual) views.push(bindingView(spec.residual, 'gemm residual'));
    views.push(bindingView(c, 'gemm c'));
    views.push(params(gemmWords(spec)));
    const nBase = spec.nBase ?? 0, nCount = spec.nCount ?? N - nBase;
    if (nBase % GEMM_TILE || nBase < 0 || nCount <= 0 || nBase + nCount > N) throw new Error('gemm column range must be tile-aligned and inside N');
    const groups = [Math.ceil(nCount / GEMM_TILE), Math.ceil(M / GEMM_TILE), batch];
    if (groups.some(value => value > 65535)) throw new RangeError('gemm grid exceeds device workgroup limit');
    dispatch(gemmShader(layout), views, groups);
    pendingFlops += 2 * M * nCount * K * batch;
    return c;
  }

  // NCHW conv2d (batch 1) as implicit GEMM. Bottom/right padding is implied by
  // the output size; `upsample` reads a nearest-2x view of the input.
  // Under a cooperative schedule, a conv larger than the duty budget is issued
  // as tile-aligned output-pixel ranges with a yield point between them.
  async function conv2d({ x, shape: [cin, h, w], weight, bias, biasM2, residual, kernel = 3, stride = 1,
    pad = [1, 1, 1, 1], upsample = false, name = 'conv' }) {
    const [cout, wcin, kh, kw] = weight.shape;
    if (wcin !== cin || kh !== kernel || kw !== kernel) throw new Error(`${name}: weight shape ${weight.shape} does not match input ${cin}x${kernel}x${kernel}`);
    const [top, left, bottom, right] = pad;
    const eh = upsample ? h * 2 : h, ew = upsample ? w * 2 : w;
    const hout = Math.floor((eh + top + bottom - kh) / stride) + 1;
    const wout = Math.floor((ew + left + right - kw) / stride) + 1;
    const N = hout * wout, K = cin * kh * kw;
    const c = alloc([cout, hout, wout], name);
    const spec = kh === 1 && stride === 1 && !upsample && top === 0 && left === 0
      ? { a: weight, b: x, c, M: cout, N, K: cin, aSM: cin, aSK: 1, bSK: h * w, bSN: 1, cSM: N, cSN: 1, biasM: bias, biasM2, residual }
      : { a: weight, b: x, c, M: cout, N, K, aSM: K, aSK: 1, bSK: h, bSN: w, bSB: wout, cSM: N, cSN: 1,
        padTop: top, padLeft: left, biasM: bias, biasM2, residual, conv: { kh, kw, stride, upsample } };
    const flops = 2 * cout * N * spec.K;
    const budget = schedule?.dutyFlops ?? 0;
    if (!schedule || !budget || flops <= budget) {
      gemm(spec);
    } else {
      const columns = Math.max(GEMM_TILE, Math.floor(budget / (2 * cout * spec.K) / GEMM_TILE) * GEMM_TILE);
      for (let nBase = 0; nBase < N; nBase += columns) {
        gemm({ ...spec, nBase, nCount: Math.min(columns, N - nBase) });
        await yieldPoint(`${name}[${nBase}]`);
      }
    }
    c.shape = [cout, hout, wout];
    return c;
  }

  function groupNorm({ x, shape: [channels, h, w], groups = 32, gamma, beta, eps, silu = false, name = 'groupnorm' }) {
    const groupSize = (channels / groups) * h * w;
    if (!Number.isSafeInteger(groupSize)) throw new Error(`${name}: channels must divide into groups`);
    const chunks = Math.ceil(groupSize / GROUPNORM_CHUNK);
    const partial = alloc([groups * chunks * 3], `${name}.partial`);
    const statsTensor = alloc([groups * 2], `${name}.stats`);
    const groupWords = new Uint32Array([groupSize, chunks, groups, 0]);
    dispatch(groupNormPartialShader(), [bindingView(x), bindingView(partial), params(groupWords)], [chunks, groups, 1]);
    dispatch(groupNormCombineShader(eps), [bindingView(partial), bindingView(statsTensor), params(groupWords)],
      [Math.ceil(groups / 64), 1, 1]);
    const total = channels * h * w;
    const y = alloc([channels, h, w], name);
    dispatch(groupNormApplyShader({ silu }), [bindingView(x), bindingView(statsTensor), bindingView(gamma, `${name} gamma`),
      bindingView(beta, `${name} beta`), bindingView(y), params(new Uint32Array([total, h * w, channels / groups, 0]))],
    dispatch1D(total));
    release(partial);
    release(statsTensor);
    return y;
  }

  function layerNorm({ x, rows, channels, gamma, beta, eps, name = 'layernorm' }) {
    const y = alloc([rows, channels], name);
    dispatch(layerNormShader(eps), [bindingView(x), bindingView(gamma), bindingView(beta), bindingView(y),
      params(new Uint32Array([rows, channels, 0, 0]))], dispatch1D(rows, 1));
    return y;
  }

  function softmax({ s, rows, cols }) {
    dispatch(softmaxShader(), [bindingView(s), params(new Uint32Array([rows, cols, 0, 0]))], dispatch1D(rows, 1));
    return s;
  }

  function geglu({ x, rows, inner, name = 'geglu' }) {
    const y = alloc([rows, inner], name);
    dispatch(gegluShader(), [bindingView(x), bindingView(y), params(new Uint32Array([rows, inner, 0, 0]))],
      dispatch1D(rows * inner));
    return y;
  }

  function affine({ x, shape, scale = 1, shift = 0, clamp01 = false, silu = false, name = 'affine' }) {
    const total = elements(shape);
    const y = alloc(shape, name);
    const words = new Uint32Array(4);
    const floats = new Float32Array(words.buffer);
    words[0] = total; floats[1] = scale; floats[2] = shift;
    dispatch(affineShader({ clamp01, silu }), [bindingView(x), bindingView(y), params(words)], dispatch1D(total));
    return y;
  }

  function upload(shape, data, name = 'upload') {
    const t = alloc(shape, name, { fresh: true });
    device.queue.writeBuffer(t.buffer, 0, data.buffer, data.byteOffset, data.byteLength);
    return t;
  }

  async function read(tensor) {
    const view = bindingView(tensor, 'readback');
    const staging = device.createBuffer({ label: `${label}.readback`, size: view.size, usage: 0x0001 | COPY_DST });
    copy(tensor, { buffer: staging, offset: 0, byteLength: view.size }, { size: view.size });
    await flush();
    await staging.mapAsync(0x0001);
    const values = new Float32Array(staging.getMappedRange().slice(0));
    staging.unmap();
    staging.destroy();
    return values;
  }

  function destroy() {
    for (const list of pool.values()) for (const buffer of list) buffer.destroy();
    for (const buffer of owned) buffer.destroy();
    pool.clear();
    owned.clear();
  }

  return { alloc, release, gemm, conv2d, groupNorm, layerNorm, softmax, geglu, affine, copy, upload, read, flush, yieldPoint,
    setSchedule, discard, destroy, stats };
}
