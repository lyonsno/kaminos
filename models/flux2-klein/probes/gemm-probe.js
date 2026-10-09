// In-page harness for the FLUX.2 Klein GEMM throughput probe.
// window.runGemmProbe(config) builds random operands per shape, checks each
// kernel's output against a CPU f32 reference on sampled entries, then times
// it with timestamp queries. A kernel that compiles but fails the check is
// reported as wrong and gets no throughput figure.
import { GROUP, kernelVariants } from './gemm-kernels.js';

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

function makeOperands(shape, seed) {
  const { M, N, K } = shape;
  const r = rng(seed);
  const x = new Float16Array(M * K);
  for (let i = 0; i < x.length; i++) x[i] = r() * 2 - 1;
  const wScale = 1 / Math.sqrt(K);
  const wf16 = new Float16Array(N * K);
  for (let i = 0; i < wf16.length; i++) wf16[i] = (r() * 2 - 1) * wScale;
  const groups = K / GROUP;
  // int8: q in [-127,127], one scale per group.
  const i8 = new Int8Array(N * K);
  const i8s = new Float16Array(N * groups);
  for (let g = 0; g < i8s.length; g++) i8s[g] = (0.5 + r()) * wScale / 127;
  for (let i = 0; i < i8.length; i++) i8[i] = Math.round(r() * 254 - 127);
  // int4: q in [0,15], affine scale/bias per group, packed low nibble first.
  const i4 = new Uint32Array((N * K) / 8);
  const i4q = new Uint8Array(N * K);
  const i4sb = new Float16Array(N * groups * 2);
  for (let g = 0; g < N * groups; g++) {
    const s = (0.5 + r()) * 2 * wScale / 15;
    i4sb[2 * g] = s; i4sb[2 * g + 1] = -7.5 * s;
  }
  for (let i = 0; i < i4q.length; i++) i4q[i] = Math.floor(r() * 16);
  for (let w = 0; w < i4.length; w++) {
    let v = 0;
    for (let c = 0; c < 8; c++) v |= i4q[w * 8 + c] << (4 * c);
    i4[w] = v >>> 0;
  }
  return { x, wf16, i8, i8s, i4, i4q, i4sb, groups };
}

function weightValue(ops, kind, n, k, K) {
  const g = n * ops.groups + Math.floor(k / GROUP);
  if (kind === 'i8') return ops.i8[n * K + k] * ops.i8s[g];
  if (kind === 'i4') return ops.i4q[n * K + k] * ops.i4sb[2 * g] + ops.i4sb[2 * g + 1];
  return ops.wf16[n * K + k];
}

function buffer(device, data, usage = GPUBufferUsage.STORAGE) {
  const size = Math.ceil(data.byteLength / 16) * 16;
  const b = device.createBuffer({ size, usage: usage | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(b, 0, data.buffer, data.byteOffset, data.byteLength);
  return b;
}

async function checkAndTime(device, variant, shape, ops, cfg) {
  const { M, N, K } = shape;
  const row = { kernel: variant.name, shape: shape.name, M, N, K, weight: variant.weight, accumulate: variant.accumulate };
  const kind = variant.weight === 'f16-flat' ? 'f16' : variant.weight;
  if (variant.alignedTiles && (M % variant.tileM || N % variant.tileN)) { row.status = 'shape-unsupported'; return row; }
  let module;
  try {
    module = device.createShaderModule({ code: variant.code });
    const info = await module.getCompilationInfo();
    const errors = info.messages.filter(m => m.type === 'error').map(m => `${m.lineNum}:${m.linePos} ${m.message}`);
    if (errors.length) { row.status = 'compile-error'; row.errors = errors; return row; }
  } catch (e) { row.status = 'compile-error'; row.errors = [String(e)]; return row; }

  device.pushErrorScope('validation');
  const pipeline = await device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'main' } })
    .catch(e => { row.status = 'pipeline-error'; row.errors = [String(e)]; return null; });
  if (!pipeline) { await device.popErrorScope(); return row; }

  const bufs = [];
  const xb = buffer(device, ops.x); bufs.push(xb);
  let wb, sb = null;
  if (kind === 'f16') wb = buffer(device, ops.wf16);
  else if (kind === 'i8') { wb = buffer(device, new Uint32Array(ops.i8.buffer)); sb = buffer(device, ops.i8s); }
  else { wb = buffer(device, ops.i4); sb = buffer(device, ops.i4sb); }
  bufs.push(wb); if (sb) bufs.push(sb);
  const yb = device.createBuffer({ size: Math.ceil(M * N * 2 / 16) * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  bufs.push(yb);
  const ub = buffer(device, new Uint32Array([M, N, K, K / GROUP]), GPUBufferUsage.UNIFORM); bufs.push(ub);
  const entries = [
    { binding: 0, resource: { buffer: xb } }, { binding: 1, resource: { buffer: wb } },
    { binding: 2, resource: { buffer: yb } }, { binding: 3, resource: { buffer: ub } },
  ];
  if (sb) entries.push({ binding: 4, resource: { buffer: sb } });
  const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries });
  const groups = [Math.ceil(N / variant.tileN), Math.ceil(M / variant.tileM)];
  row.dispatch = groups;
  const scopeError = await device.popErrorScope();
  if (scopeError) { row.status = 'validation-error'; row.errors = [scopeError.message]; bufs.forEach(b => b.destroy()); return row; }

  const encodeOnce = (enc, timestampWrites) => {
    const pass = enc.beginComputePass(timestampWrites ? { timestampWrites } : {});
    pass.setPipeline(pipeline); pass.setBindGroup(0, bind); pass.dispatchWorkgroups(groups[0], groups[1]); pass.end();
  };

  // Correctness: one dispatch, read back, compare sampled entries to CPU f32.
  {
    const enc = device.createCommandEncoder(); encodeOnce(enc);
    const rb = device.createBuffer({ size: yb.size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    enc.copyBufferToBuffer(yb, 0, rb, 0, yb.size); device.queue.submit([enc.finish()]);
    await rb.mapAsync(GPUMapMode.READ);
    const y = new Float16Array(rb.getMappedRange().slice(0, M * N * 2)); rb.unmap(); rb.destroy();
    const r = rng(shape.seed ^ 0x9e3779b9);
    let maxErr = 0, sumSq = 0, nonFinite = 0;
    const samples = cfg.samples;
    for (let s = 0; s < samples; s++) {
      const m = Math.floor(r() * M), n = Math.floor(r() * N);
      let ref = 0;
      for (let k = 0; k < K; k++) ref += ops.x[m * K + k] * weightValue(ops, kind, n, k, K);
      const got = y[m * N + n];
      if (!Number.isFinite(got)) nonFinite++;
      maxErr = Math.max(maxErr, Math.abs(got - ref)); sumSq += ref * ref;
    }
    const rms = Math.sqrt(sumSq / samples);
    row.check = { samples, maxAbsErr: maxErr, refRms: rms, relMaxErr: maxErr / rms, nonFinite };
    // f16 accumulation over long K is expected to be looser; the tolerance is declared, not tuned after the fact.
    const tol = variant.accumulate === 'f16' ? cfg.tolF16Acc : cfg.tolF32Acc;
    row.check.tolerance = tol;
    if (nonFinite || !(maxErr / rms <= tol)) { row.status = 'wrong'; bufs.forEach(b => b.destroy()); return row; }
  }

  // Timing: warmups, then one timestamped pass per iteration.
  for (let i = 0; i < cfg.warmup; i++) { const enc = device.createCommandEncoder(); encodeOnce(enc); device.queue.submit([enc.finish()]); }
  await device.queue.onSubmittedWorkDone();
  const iters = cfg.iters;
  const qs = device.createQuerySet({ type: 'timestamp', count: 2 * iters });
  const qb = device.createBuffer({ size: 16 * iters, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
  const qr = device.createBuffer({ size: 16 * iters, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const t0 = performance.now();
  const enc = device.createCommandEncoder();
  for (let i = 0; i < iters; i++) encodeOnce(enc, { querySet: qs, beginningOfPassWriteIndex: 2 * i, endOfPassWriteIndex: 2 * i + 1 });
  enc.resolveQuerySet(qs, 0, 2 * iters, qb, 0); enc.copyBufferToBuffer(qb, 0, qr, 0, 16 * iters);
  device.queue.submit([enc.finish()]);
  await qr.mapAsync(GPUMapMode.READ);
  const wallMs = performance.now() - t0;
  const ts = new BigInt64Array(qr.getMappedRange().slice(0)); qr.unmap();
  const gpuMs = [];
  for (let i = 0; i < iters; i++) gpuMs.push(Number(ts[2 * i + 1] - ts[2 * i]) / 1e6);
  gpuMs.sort((a, b) => a - b);
  const median = gpuMs[Math.floor(iters / 2)];
  const flop = 2 * M * N * K;
  row.timing = { iters, gpuMsMedian: median, gpuMsMin: gpuMs[0], gpuMsMax: gpuMs[iters - 1], wallMsBatch: wallMs,
    tflopsMedian: flop / (median * 1e-3) / 1e12, tflopsWall: flop * iters / (wallMs * 1e-3) / 1e12 };
  row.status = median > 0 ? 'ok' : 'timestamp-invalid';
  qs.destroy(); qb.destroy(); qr.destroy(); bufs.forEach(b => b.destroy());
  return row;
}

window.runGemmProbe = async function runGemmProbe(cfg) {
  const report = { schema: 'kaminos.flux2-klein.gemm-probe.v0', startedAt: new Date().toISOString(), config: cfg,
    userAgent: navigator.userAgent, phase: 'adapter', rows: [] };
  try {
    const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('no WebGPU adapter');
    const info = adapter.info || {};
    report.adapter = { vendor: info.vendor, architecture: info.architecture, description: info.description,
      subgroupMinSize: info.subgroupMinSize, subgroupMaxSize: info.subgroupMaxSize, features: [...adapter.features].sort() };
    const wanted = ['shader-f16', 'timestamp-query', 'subgroups', 'chromium-experimental-subgroup-matrix'];
    const requiredFeatures = wanted.filter(f => adapter.features.has(f));
    report.missingRequired = ['shader-f16', 'timestamp-query'].filter(f => !adapter.features.has(f));
    if (report.missingRequired.length) throw new Error(`missing ${report.missingRequired.join(',')}`);
    report.phase = 'device';
    const device = await adapter.requestDevice({ requiredFeatures, requiredLimits: {
      maxBufferSize: adapter.limits.maxBufferSize, maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
      maxComputeWorkgroupStorageSize: adapter.limits.maxComputeWorkgroupStorageSize } });
    report.deviceFeatures = [...device.features].sort();
    device.lost.then(l => { report.deviceLost = { reason: l.reason, message: l.message }; });
    const variants = kernelVariants().filter(v => !cfg.kernels || cfg.kernels.includes(v.name));
    report.phase = 'kernels';
    for (const shape of cfg.shapes) {
      const ops = makeOperands(shape, shape.seed);
      for (const v of variants) {
        if (v.requiresFeature && !device.features.has(v.requiresFeature)) {
          report.rows.push({ kernel: v.name, shape: shape.name, status: 'feature-unavailable', feature: v.requiresFeature });
          continue;
        }
        report.currentRow = `${shape.name}/${v.name}`;
        report.rows.push(await checkAndTime(device, v, shape, ops, cfg));
      }
    }
    delete report.currentRow;
    report.phase = 'done';
    device.destroy();
  } catch (e) {
    report.error = String(e?.stack || e);
  }
  report.finishedAt = new Date().toISOString();
  return report;
};
window.gemmProbeReady = true;
