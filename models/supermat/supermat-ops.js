// Model-owned op executor for SuperMat. Encodes dispatches into one compute
// pass per flush, reuses activation buffers by exact byte size, and creates one
// small uniform buffer per dispatch (destroyed after the flush completes).
import {
  gemmShader, gemmTileShape, GEMM_PARAMS_WORDS, GROUPNORM_CHUNK, groupNormPartialShader,
  groupNormCombineShader, groupNormApplyShader, layerNormShader, softmaxShader, gegluShader,
  affineShader, gemmSubgroupMatrixShader, SUBGROUP_MATRIX_TILE, flashAttentionShader, flashAttentionVec4Shader, FLASH_HEAD_DIM, FLASH_QUERY_TILE,
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

// Storage kind of a tensor: op tensors carry `storage`; kit weight views with
// dtype 'f16' hold checkpoint binary16 pairs packed in u32 words.
export function storageKind(tensor) {
  return tensor?.storage ?? (tensor?.dtype === 'f16' ? 'f16packed' : 'f32');
}

function dispatch1D(total, workgroupSize = 256, limit = 65535) {
  const groups = Math.ceil(total / workgroupSize);
  const x = Math.min(groups, limit);
  const y = Math.ceil(groups / x);
  if (y > limit) throw new RangeError('dispatch exceeds device workgroup grid');
  return [x, y, 1];
}

// attention: 'streaming' (online softmax, no score matrix) or 'materialized'.
// gemmTile: { tm, tn, bk } per-thread outputs and K step (16x16 threads per workgroup).
// attentionKernel: 'scalar' or 'vec4' streaming implementation.
// gemmKernel: 'tiled' (default), 'subgroup-matrix' (experimental Apple
// simdgroup matrices; correct but ~2x slower than tiled in the 2026-10-09
// bench with one subgroup per workgroup), or 'auto' (subgroup matrices when
// the device enables them with a fixed 32-lane subgroup).
export function subgroupMatrixUsable(device) {
  const info = device.adapterInfo;
  return device.features.has('chromium-experimental-subgroup-matrix')
    && info?.subgroupMinSize === 32 && info?.subgroupMaxSize === 32;
}

// A duty's own execution time: from when it can start (submitted, and the work
// queued ahead of it has completed) to its fence.
export function dutyExecutionMs({ submittedAt, precedingDoneAt, doneAt }) {
  return doneAt - Math.max(submittedAt, precedingDoneAt ?? submittedAt);
}

// Next duty FLOP budget: geometric step toward the size that would take
// targetMs at the observed rate, clamped to bounds. Unusable samples keep it.
export function adaptDutyFlops({ current, flops, ownMs, targetMs, bounds: [min, max] }) {
  if (!(ownMs > 0) || !(flops > 0) || !(targetMs > 0)) return current;
  const ideal = flops * targetMs / ownMs;
  return Math.min(max, Math.max(min, current * Math.sqrt(ideal / current)));
}

export const SUPERMAT_OPS_OPTIONS = Object.freeze(['label', 'attention', 'gemmTile', 'fuseNorm', 'attentionKernel', 'gemmKernel',
  'gemmPrecision', 'activations']);

export function createSuperMatOps(device, options = {}) {
  const unknown = Object.keys(options).filter(key => !SUPERMAT_OPS_OPTIONS.includes(key));
  if (unknown.length) throw new Error(`unknown SuperMat ops option: ${unknown.join(', ')}`);
  const { label = 'supermat', attention = 'streaming', gemmTile = { tm: 4, tn: 4, bk: 16 }, fuseNorm = false,
    attentionKernel = 'scalar', gemmKernel = 'tiled', gemmPrecision = 'f32', activations = 'f32' } = options;
  // activations: storage of intermediate tensors ('f16' halves memory traffic; math stays F32).
  if (!['f32', 'f16'].includes(activations)) throw new Error(`unknown activation storage ${activations}`);
  if (activations === 'f16' && !device.features.has('shader-f16')) throw new Error('f16 activations need the shader-f16 feature');
  if (!['f32', 'f16-tiles', 'f16-partial'].includes(gemmPrecision)) throw new Error(`unknown gemm precision ${gemmPrecision}`);
  if (gemmPrecision !== 'f32' && !device.features.has('shader-f16')) throw new Error(`${gemmPrecision} GEMM needs the shader-f16 feature`);
  if (!['auto', 'tiled', 'subgroup-matrix'].includes(gemmKernel)) throw new Error(`unknown gemm kernel ${gemmKernel}`);
  const subgroupMatrix = gemmKernel === 'subgroup-matrix' || (gemmKernel === 'auto' && subgroupMatrixUsable(device));
  if (subgroupMatrix && !subgroupMatrixUsable(device)) throw new Error('subgroup-matrix GEMM requested but unavailable on this device');
  const tileShape = subgroupMatrix ? { ...SUBGROUP_MATRIX_TILE } : gemmTileShape(gemmTile);
  if (!['streaming', 'materialized'].includes(attention)) throw new Error(`unknown attention mode ${attention}`);
  const pipelines = new Map();
  const pool = new Map();
  const owned = new Set();
  let encoder = null, pass = null, transient = [];
  // Cooperative schedule for one run: { runtime, invocation, control, signal, dutyFlops }.
  // Without it every op lands in one submission at flush().
  let schedule = null, pendingFlops = 0, lastFence = Promise.resolve(), adaptiveFlops = null;
  // Duty budget adapts toward schedule.targetDutyMs from each duty's own
  // execution time (see dutyExecutionMs). Bounds are caller-overridable.
  function currentDutyFlops() {
    if (!schedule) return 0;
    if (!schedule.targetDutyMs) return schedule.dutyFlops ?? 0;
    return adaptiveFlops ?? schedule.dutyFlops ?? 4e9;
  }
  function observeDuty(flops, ownMs) {
    if (!schedule?.targetDutyMs) return;
    adaptiveFlops = adaptDutyFlops({ current: currentDutyFlops(), flops, ownMs, targetMs: schedule.targetDutyMs,
      bounds: schedule.dutyFlopsBounds ?? [5e8, 6.4e10] });
  }
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
  function alloc(shape, name = 'activation', { fresh = false, dtype = activations } = {}) {
    const count = elements(shape);
    if (!Number.isSafeInteger(count) || count <= 0) throw new Error(`${name}: positive shape required`);
    const byteLength = Math.ceil((count * (dtype === 'f16' ? 2 : 4)) / 4) * 4;
    let buffer = fresh ? undefined : pool.get(byteLength)?.pop();
    if (!buffer) {
      buffer = device.createBuffer({ label: `${label}.${name}`, size: byteLength, usage: ACTIVATION_USAGE });
      stats.createdBuffers++;
      stats.createdBytes += byteLength;
    }
    owned.add(buffer);
    stats.liveBytes += byteLength;
    stats.peakLiveBytes = Math.max(stats.peakLiveBytes, stats.liveBytes);
    return { buffer, offset: 0, byteLength, shape: [...shape], name, storage: dtype };
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
      // Resolves when the work queued ahead (foreground frames) completes,
      // which is when this duty starts executing.
      precedingDone = device.queue.onSubmittedWorkDone().then(() => performance.now());
      device.queue.submit([commands]);
    };
    let precedingDone = null;
    const gateStart = performance.now();
    let submitted = null;
    const timed = async () => { await work(); submitted = performance.now(); };
    if (control) await control.runDuty(timed); else await timed();
    stats.duties++;
    const row = { label, estimatedFlops: flops, submittedAt: submitted, gateWaitMs: submitted - gateStart };
    stats.dutyHistory.push(row);
    row.dutyFlopsBudget = currentDutyFlops();
    lastFence = device.queue.onSubmittedWorkDone().then(async () => {
      const doneAt = performance.now();
      const precedingDoneAt = await precedingDone;
      row.queueMs = doneAt - submitted;
      row.ownMs = dutyExecutionMs({ submittedAt: submitted, precedingDoneAt, doneAt });
      observeDuty(flops, row.ownMs);
      try { schedule?.onDuty?.(row); } catch { /* telemetry must not fail inference */ }
      for (const buffer of buffers) buffer.destroy();
    });
  }

  // Graph yield point: submit once the encoded block reaches the duty budget.
  async function yieldPoint(label) {
    if (!schedule) return;
    throwIfStopped();
    if (pendingFlops >= currentDutyFlops()) await submitDuty(label);
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
  const scheduleState = () => ({ adaptiveFlops, currentDutyFlops: currentDutyFlops(), targetDutyMs: schedule?.targetDutyMs ?? null });

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
    words.set([spec.padTop ?? 0, spec.padLeft ?? 0, spec.nBase ?? 0, spec.normB?.channelsPerGroup ?? 0], 16);
    return words;
  }

  // One dispatch of the general strided, batched GEMM (optionally a
  // tile-aligned column range). Output tensor `c` is allocated unless given.
  function issueGemm(spec) {
    const { M, N, K, batch = 1 } = spec;
    for (const [name, value] of Object.entries({ M, N, K, batch })) {
      if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`gemm ${name} must be positive`);
    }
    const c = spec.c ?? alloc(spec.outShape ?? [batch, M, N], spec.name ?? 'gemm', { dtype: spec.dtype ?? activations });
    const layout = {
      aKContiguous: spec.aSK === 1, bNContiguous: spec.bSN === 1,
      biasM: Boolean(spec.biasM), biasM2: Boolean(spec.biasM2), biasN: Boolean(spec.biasN),
      residual: Boolean(spec.residual), conv: spec.conv ?? null, tile: gemmTile, precision: gemmPrecision,
      normB: spec.normB ? { silu: Boolean(spec.normB.silu) } : null,
      types: { a: storageKind(spec.a), b: storageKind(spec.b), c: storageKind(c),
        ...(spec.biasM ? { biasM: storageKind(spec.biasM) } : {}), ...(spec.biasM2 ? { biasM2: storageKind(spec.biasM2) } : {}),
        ...(spec.biasN ? { biasN: storageKind(spec.biasN) } : {}), ...(spec.residual ? { residual: storageKind(spec.residual) } : {}) },
    };
    const views = [bindingView(spec.a, 'gemm a'), bindingView(spec.b, 'gemm b')];
    if (spec.biasM) views.push(bindingView(spec.biasM, 'gemm biasM'));
    if (spec.biasM2) views.push(bindingView(spec.biasM2, 'gemm biasM2'));
    if (spec.biasN) views.push(bindingView(spec.biasN, 'gemm biasN'));
    if (spec.residual) views.push(bindingView(spec.residual, 'gemm residual'));
    if (spec.normB) views.push(bindingView(spec.normB.stats, 'norm stats'), bindingView(spec.normB.gamma, 'norm gamma'),
      bindingView(spec.normB.beta, 'norm beta'));
    views.push(bindingView(c, 'gemm c'));
    views.push(params(gemmWords(spec)));
    const nBase = spec.nBase ?? 0, nCount = spec.nCount ?? N - nBase;
    if (nBase % tileShape.bn || nBase < 0 || nCount <= 0 || nBase + nCount > N) throw new Error('gemm column range must be tile-aligned and inside N');
    const groups = [Math.ceil(nCount / tileShape.bn), Math.ceil(M / tileShape.bm), batch];
    if (groups.some(value => value > 65535)) throw new RangeError('gemm grid exceeds device workgroup limit');
    dispatch(subgroupMatrix ? gemmSubgroupMatrixShader(layout) : gemmShader(layout), views, groups);
    pendingFlops += 2 * M * nCount * K * batch;
    return c;
  }

  // NCHW conv2d (batch 1) as implicit GEMM. Bottom/right padding is implied by
  // the output size; `upsample` reads a nearest-2x view of the input.
  // Under a cooperative schedule, a GEMM larger than the current duty budget
  // is issued as tile-aligned output-column ranges with a yield between them.
  async function gemm(spec) {
    const c = spec.c ?? alloc(spec.outShape ?? [spec.batch ?? 1, spec.M, spec.N], spec.name ?? 'gemm', { dtype: spec.dtype ?? activations });
    const batch = spec.batch ?? 1;
    const flops = 2 * spec.M * spec.N * spec.K * batch;
    const budget = schedule ? currentDutyFlops() : 0;
    if (!budget || flops <= budget) {
      issueGemm({ ...spec, c });
    } else {
      const perColumn = 2 * spec.M * spec.K * batch;
      const columns = Math.max(tileShape.bn, Math.floor(budget / perColumn / tileShape.bn) * tileShape.bn);
      for (let nBase = 0; nBase < spec.N; nBase += columns) {
        issueGemm({ ...spec, c, nBase, nCount: Math.min(columns, spec.N - nBase) });
        await yieldPoint(`${spec.name ?? 'gemm'}[${nBase}]`);
      }
    }
    return c;
  }

  // NCHW conv2d (batch 1) as implicit GEMM. Bottom/right padding is implied by
  // the output size; `upsample` reads a nearest-2x view of the input.
  // norm: { gamma, beta, eps, silu, groups } applies GroupNorm(+SiLU) to x
  // inside the conv's input loader instead of materializing the normed tensor.
  async function conv2d({ x, shape: [cin, h, w], weight, bias, biasM2, residual, kernel = 3, stride = 1,
    pad = [1, 1, 1, 1], upsample = false, name = 'conv', norm = null }) {
    const [cout, wcin, kh, kw] = weight.shape;
    if (wcin !== cin || kh !== kernel || kw !== kernel) throw new Error(`${name}: weight shape ${weight.shape} does not match input ${cin}x${kernel}x${kernel}`);
    const [top, left, bottom, right] = pad;
    const eh = upsample ? h * 2 : h, ew = upsample ? w * 2 : w;
    const hout = Math.floor((eh + top + bottom - kh) / stride) + 1;
    const wout = Math.floor((ew + left + right - kw) / stride) + 1;
    const N = hout * wout, K = cin * kh * kw;
    const c = alloc([cout, hout, wout], name);
    let normB = null;
    if (norm) {
      const groups = norm.groups ?? 32;
      normB = { stats: groupNormStats({ x, shape: [cin, h, w], groups, eps: norm.eps, name: `${name}.norm` }),
        gamma: norm.gamma, beta: norm.beta, silu: norm.silu, channelsPerGroup: cin / groups };
    }
    const spec = kh === 1 && stride === 1 && !upsample && top === 0 && left === 0 && !normB
      ? { a: weight, b: x, c, M: cout, N, K: cin, aSM: cin, aSK: 1, bSK: h * w, bSN: 1, cSM: N, cSN: 1, biasM: bias, biasM2, residual }
      : { a: weight, b: x, c, M: cout, N, K, aSM: K, aSK: 1, bSK: h, bSN: w, bSB: wout, cSM: N, cSN: 1,
        padTop: top, padLeft: left, biasM: bias, biasM2, residual, conv: { kh, kw, stride, upsample }, normB };
    await gemm({ ...spec, name });
    if (normB) release(normB.stats);
    c.shape = [cout, hout, wout];
    return c;
  }

  // Multi-head self/cross attention over token-major Q [queries, heads*64] and
  // K/V [keys, heads*64]; splits query ranges to the duty budget.
  async function flashAttention({ q, k, v, queries, keys, heads, scale, name = 'attention' }) {
    const channels = heads * FLASH_HEAD_DIM;
    const out = alloc([queries, channels], name);
    const flops = 4 * queries * keys * FLASH_HEAD_DIM * heads;
    const budget = schedule ? currentDutyFlops() : 0;
    const rows = !budget || flops <= budget ? queries
      : Math.max(FLASH_QUERY_TILE, Math.floor(budget / (4 * keys * FLASH_HEAD_DIM * heads) / FLASH_QUERY_TILE) * FLASH_QUERY_TILE);
    for (let rowBase = 0; rowBase < queries; rowBase += rows) {
      const count = Math.min(rows, queries - rowBase);
      const words = new Uint32Array(8);
      const floats = new Float32Array(words.buffer);
      words.set([queries, keys, channels, channels, channels, rowBase], 0);
      floats[6] = scale;
      const types = { q: storageKind(q), k: storageKind(k), v: storageKind(v), o: storageKind(out) };
      if (attentionKernel === 'vec4' && Object.values(types).some(type => type !== 'f32')) throw new Error('vec4 attention supports F32 storage only');
      dispatch(attentionKernel === 'vec4' ? flashAttentionVec4Shader() : flashAttentionShader(types), [bindingView(q), bindingView(k), bindingView(v), bindingView(out), params(words)],
        [Math.ceil(count / FLASH_QUERY_TILE), heads, 1]);
      pendingFlops += 4 * count * keys * FLASH_HEAD_DIM * heads;
      if (rows < queries) await yieldPoint(`${name}[${rowBase}]`);
    }
    return out;
  }

  // Per-group [mean, rstd] (F32) of an NCHW tensor.
  function groupNormStats({ x, shape: [channels, h, w], groups = 32, eps, name = 'groupnorm' }) {
    const groupSize = (channels / groups) * h * w;
    if (!Number.isSafeInteger(groupSize)) throw new Error(`${name}: channels must divide into groups`);
    const chunks = Math.ceil(groupSize / GROUPNORM_CHUNK);
    const partial = alloc([groups * chunks * 3], `${name}.partial`, { dtype: 'f32' });
    const statsTensor = alloc([groups * 2], `${name}.stats`, { dtype: 'f32' });
    const groupWords = new Uint32Array([groupSize, chunks, groups, 0]);
    dispatch(groupNormPartialShader({ x: storageKind(x) }), [bindingView(x), bindingView(partial), params(groupWords)], [chunks, groups, 1]);
    dispatch(groupNormCombineShader(eps), [bindingView(partial), bindingView(statsTensor), params(groupWords)],
      [Math.ceil(groups / 64), 1, 1]);
    release(partial);
    return statsTensor;
  }

  function groupNorm({ x, shape: [channels, h, w], groups = 32, gamma, beta, eps, silu = false, name = 'groupnorm' }) {
    const statsTensor = groupNormStats({ x, shape: [channels, h, w], groups, eps, name });
    const total = channels * h * w;
    const y = alloc([channels, h, w], name);
    dispatch(groupNormApplyShader({ silu, x: storageKind(x), y: storageKind(y) }), [bindingView(x), bindingView(statsTensor), bindingView(gamma, `${name} gamma`),
      bindingView(beta, `${name} beta`), bindingView(y), params(new Uint32Array([total, h * w, channels / groups, 0]))],
    dispatch1D(total));
    release(statsTensor);
    return y;
  }

  function layerNorm({ x, rows, channels, gamma, beta, eps, name = 'layernorm' }) {
    const y = alloc([rows, channels], name);
    dispatch(layerNormShader(eps, { x: storageKind(x), y: storageKind(y) }), [bindingView(x), bindingView(gamma), bindingView(beta), bindingView(y),
      params(new Uint32Array([rows, channels, 0, 0]))], dispatch1D(rows, 1));
    return y;
  }

  function softmax({ s, rows, cols }) {
    if (storageKind(s) !== 'f32') throw new Error('softmax scores must be F32');
    dispatch(softmaxShader(), [bindingView(s), params(new Uint32Array([rows, cols, 0, 0]))], dispatch1D(rows, 1));
    return s;
  }

  function geglu({ x, rows, inner, name = 'geglu' }) {
    const y = alloc([rows, inner], name);
    dispatch(gegluShader({ x: storageKind(x), y: storageKind(y) }), [bindingView(x), bindingView(y), params(new Uint32Array([rows, inner, 0, 0]))],
      dispatch1D(rows * inner));
    return y;
  }

  function affine({ x, shape, scale = 1, shift = 0, clamp01 = false, silu = false, name = 'affine', dtype = activations }) {
    const total = elements(shape);
    const y = alloc(shape, name, { dtype });
    const words = new Uint32Array(4);
    const floats = new Float32Array(words.buffer);
    words[0] = total; floats[1] = scale; floats[2] = shift;
    dispatch(affineShader({ clamp01, silu, x: storageKind(x), y: storageKind(y) }), [bindingView(x), bindingView(y), params(words)], dispatch1D(total));
    return y;
  }

  function upload(shape, data, name = 'upload') {
    const t = alloc(shape, name, { fresh: true, dtype: 'f32' });
    device.queue.writeBuffer(t.buffer, 0, data.buffer, data.byteOffset, data.byteLength);
    return t;
  }

  async function read(tensor) {
    if (storageKind(tensor) !== 'f32') throw new Error('readback needs an F32 tensor');
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
    setSchedule, scheduleState, discard, destroy, stats, flashAttention,
    attentionMode: attention, gemmTile: tileShape, gemmPrecision, activations, fuseNorm, gemmKernel: subgroupMatrix ? 'subgroup-matrix' : 'tiled' };
}
