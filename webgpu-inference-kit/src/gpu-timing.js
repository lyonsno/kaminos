// Per-kernel GPU time from timestamp queries. Each timed compute pass writes a begin/end pair into a
// query slot and resolves it into that slot's 256-byte-aligned region of a resolve buffer inside the same
// command buffer. Results are copied out in batches (when free slots run low, before a tensor readback, or
// on settle) and mapped without blocking the caller. A batch includes only kernels already submitted, so
// the copy is queued after their resolves; a slot returns to the free list only after it has been read.
export const WEBGPU_GPU_TIMING_SCHEMA = 'kaminos.webgpu-gpu-timing.v0';
export const WEBGPU_GPU_TIMING_AUTHORITY = 'gpu-timestamp-query';

const QUERY_SET_TYPE = 'timestamp';
const RESOLVE_ALIGNMENT = 256;
// 2 queries per slot; WebGPU caps a query set at 4096 queries.
const DEFAULT_CAPACITY = 1024;
const MAX_CAPACITY = 2048;
const USAGE = Object.freeze({ mapRead: 0x0001, copySrc: 0x0004, copyDst: 0x0008, queryResolve: 0x0200 });

function roundUs(ms) {
  return Math.round(ms * 1000) / 1000;
}

function hasFeature(features, name) {
  return typeof features?.has === 'function' && features.has(name);
}

export function normalizeWebGpuGpuTimingOptions(option) {
  if (option === false || option === 'off') return { enabled: false, capacity: DEFAULT_CAPACITY };
  if (option == null || option === true || option === 'auto') return { enabled: true, capacity: DEFAULT_CAPACITY };
  if (typeof option !== 'object') throw new Error('gpuTiming must be a boolean, "auto", "off", or an options object');
  const capacity = option.capacity ?? DEFAULT_CAPACITY;
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > MAX_CAPACITY) {
    throw new Error(`gpuTiming.capacity must be an integer from 1 to ${MAX_CAPACITY}`);
  }
  return { enabled: option.enabled !== false, capacity };
}

export function createWebGpuGpuTimer({ device, queue, options } = {}) {
  const { enabled, capacity } = normalizeWebGpuGpuTimingOptions(options);
  const supported = hasFeature(device?.features, 'timestamp-query') && typeof device?.createQuerySet === 'function';
  const summary = {
    schema: WEBGPU_GPU_TIMING_SCHEMA,
    authority: WEBGPU_GPU_TIMING_AUTHORITY,
    status: !enabled ? 'disabled' : supported ? 'active' : 'unavailable',
    resolvedKernels: 0,
    pendingKernels: 0,
    invalidKernels: 0,
    untimedKernels: 0,
    totalGpuMs: 0,
  };
  if (summary.status !== 'active') {
    return {
      summary, begin: () => null, encodeResolve() {}, markSubmitted() {}, abandon() {}, flush() {},
      settle: async () => summary, destroy() {},
    };
  }

  const querySet = device.createQuerySet({ label: 'kaminos.gpu-timing.queries', type: QUERY_SET_TYPE, count: 2 * capacity });
  const resolveBuffer = device.createBuffer({
    label: 'kaminos.gpu-timing.resolve',
    size: capacity * RESOLVE_ALIGNMENT,
    usage: USAGE.queryResolve | USAGE.copySrc,
  });
  const free = Array.from({ length: capacity }, (_, slot) => capacity - 1 - slot);
  let outstanding = [];
  const inflight = new Set();

  function settleToken(token, ms) {
    summary.pendingKernels -= 1;
    if (Number.isFinite(ms) && ms > 0) {
      token.ms = roundUs(ms);
      token.status = 'resolved';
      summary.resolvedKernels += 1;
      summary.totalGpuMs = roundUs(summary.totalGpuMs + token.ms);
    } else {
      token.status = 'invalid';
      summary.invalidKernels += 1;
    }
    for (const listener of token.listeners) listener(token);
  }

  function begin() {
    if (free.length <= capacity / 2) flush();
    if (free.length === 0) {
      summary.untimedKernels += 1;
      return null;
    }
    const slot = free.pop();
    const token = {
      slot, ms: null, status: 'pending', submitted: false, listeners: [],
      timestampWrites: { querySet, beginningOfPassWriteIndex: 2 * slot, endOfPassWriteIndex: 2 * slot + 1 },
    };
    outstanding.push(token);
    summary.pendingKernels += 1;
    return token;
  }

  function encodeResolve(encoder, token) {
    encoder.resolveQuerySet(querySet, 2 * token.slot, 2, resolveBuffer, token.slot * RESOLVE_ALIGNMENT);
  }

  function markSubmitted(token) {
    if (token) token.submitted = true;
  }

  // The kernel's command buffer was never submitted, so its slot was never written: release it unread.
  function abandon(token) {
    if (!token || token.status !== 'pending' || token.submitted) return;
    outstanding = outstanding.filter(candidate => candidate !== token);
    free.push(token.slot);
    settleToken(token, NaN);
  }

  function flush() {
    const batch = outstanding.filter(token => token.submitted);
    if (batch.length === 0) return;
    outstanding = outstanding.filter(token => !token.submitted);
    const size = (Math.max(...batch.map(token => token.slot)) + 1) * RESOLVE_ALIGNMENT;
    const staging = device.createBuffer({ label: 'kaminos.gpu-timing.readback', size, usage: USAGE.mapRead | USAGE.copyDst });
    const encoder = device.createCommandEncoder({ label: 'kaminos.gpu-timing.copy' });
    encoder.copyBufferToBuffer(resolveBuffer, 0, staging, 0, size);
    queue.submit([encoder.finish()]);
    const read = staging.mapAsync(USAGE.mapRead).then(() => {
      const ns = new BigUint64Array(staging.getMappedRange(0, size));
      for (const token of batch) {
        const begin = ns[token.slot * (RESOLVE_ALIGNMENT / 8)];
        const end = ns[token.slot * (RESOLVE_ALIGNMENT / 8) + 1];
        settleToken(token, begin > 0n && end > begin ? Number(end - begin) / 1e6 : NaN);
      }
      staging.unmap();
    }, () => {
      for (const token of batch) settleToken(token, NaN);
    }).finally(() => {
      for (const token of batch) free.push(token.slot);
      staging.destroy?.();
      inflight.delete(read);
    });
    inflight.add(read);
  }

  async function settle() {
    flush();
    while (inflight.size > 0) await Promise.all([...inflight]);
    return summary;
  }

  function destroy() {
    querySet.destroy?.();
    resolveBuffer.destroy?.();
  }

  return { summary, begin, encodeResolve, markSubmitted, abandon, flush, settle, destroy };
}

// Attach a stage's timing tokens to its profile record: gpuMs is the sum of its kernels' GPU time once
// every token has resolved; any invalid token marks the stage invalid rather than reporting a short time.
export function attachWebGpuStageGpuTiming(stageRecord, tokens) {
  if (!tokens || tokens.length === 0) return;
  stageRecord.gpuMs = null;
  stageRecord.gpuStatus = 'pending';
  let remaining = tokens.length;
  const update = () => {
    remaining -= 1;
    if (remaining > 0) return;
    if (tokens.some(token => token.status !== 'resolved')) {
      stageRecord.gpuStatus = 'invalid';
      return;
    }
    stageRecord.gpuMs = roundUs(tokens.reduce((sum, token) => sum + token.ms, 0));
    stageRecord.gpuStatus = 'resolved';
  };
  for (const token of tokens) {
    if (token.status === 'pending') token.listeners.push(update);
    else update();
  }
}
