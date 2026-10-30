import { readQwen35Config } from './config.js';

export function adjudicateModelReadbacks(result, meta, manifest, arrays, { chunkedPrefill = false } = {}) {
  if (meta?.schema !== 'kaminos.qwen35-model-reference.v1' || meta.effective?.backend !== 'mlx-metal' || meta.effective.activationDtype !== 'float32') throw new Error('actual native FP32 model reference required');
  if (result?.backend !== 'webgpu' || !result.adapter || result.adapter.isFallbackAdapter !== false) throw new Error('native WebGPU adapter required');
  const adapter = ['vendor', 'architecture', 'device', 'description'].map(k => result.adapter[k] ?? '').join(' ');
  if (!adapter.trim() || /swiftshader|software|llvmpipe|lavapipe/i.test(adapter)) throw new Error('software/unidentified adapter');
  if (result.weightsManifestSha256 !== meta.weightsManifestSha256) throw new Error('wrong model source identity');
  if (!Array.isArray(result.errors) || result.errors.length) throw new Error('GPU/device/collection errors');
  const c = readQwen35Config(manifest.config), expected = new Map();
  const stages = ['prefill', 'decode', 'full-prefix', ...(chunkedPrefill ? ['chunked-prefill'] : [])];
  for (const stage of stages) for (const [kind, n] of [['layers', c.numLayers * c.hiddenSize], ['norm', c.hiddenSize], ['logits', c.vocabSize]]) expected.set(`${stage}.${kind}`, n);
  if (!Array.isArray(result.rows) || result.rows.length !== expected.size) throw new Error('missing or extra model observations');
  const seen = new Set(), failures = [];
  for (const row of result.rows) {
    if (seen.has(row.name) || !expected.has(row.name)) throw new Error('duplicate/unexpected model observation');
    seen.add(row.name);
    const referenceName = row.name.replace(/^chunked-prefill\./, 'prefill.');
    const n = expected.get(row.name), reference = arrays.get(referenceName), raw = typeof row.data === 'string' ? Buffer.from(row.data, 'base64') : null;
    if (!reference || reference.length !== n || row.elements !== n || raw?.length !== n * 4) throw new Error(`partial model observation ${row.name}`);
    const actual = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    let delta = 0, norm = 0, maxAbs = 0, maxScaled = 0, nonFinite = 0, best = -Infinity, top1 = -1;
    for (let i = 0; i < n; i++) {
      const a = actual.getFloat32(i * 4, true), b = reference[i];
      if (!Number.isFinite(a) || !Number.isFinite(b)) { nonFinite++; continue; }
      const d = a - b; delta += d * d; norm += b * b; maxAbs = Math.max(maxAbs, Math.abs(d)); maxScaled = Math.max(maxScaled, Math.abs(d) / (1 + Math.abs(b)));
      if (a > best) { best = a; top1 = i; }
    }
    Object.assign(row, { relL2: norm > 0 ? Math.sqrt(delta / norm) : Math.sqrt(delta), maxAbs, maxScaled, nonFinite });
    if (row.name.endsWith('.logits')) {
      row.top1 = top1;
      if (top1 !== meta.expectedNextIds[referenceName.split('.')[0]]) failures.push(`${row.name} argmax`);
    }
    if (nonFinite || row.relL2 > 5e-4 || maxScaled > 5e-4) failures.push(`${row.name} numerical mismatch`);
  }
  for (const stage of stages) if (result.lengths?.[stage] !== meta.inputIds.length + (stage === 'decode' || stage === 'full-prefix' ? 1 : 0)) failures.push(`${stage} cache length`);
  if (result.generation?.finishReason !== 'length' || JSON.stringify(result.generation.tokenIds) !== JSON.stringify([meta.expectedNextIds.prefill, meta.expectedNextIds.decode])) failures.push('autoregressive token flow');
  if (result.cleanup?.states !== 0 || result.cleanup?.weights !== 0 || result.cleanup?.borrowedControl !== 'running') failures.push('state/weight/control cleanup');
  if (failures.length) throw new Error('model witness failed: ' + failures.join('; '));
  return { rows: seen.size, expectedNextIds: meta.expectedNextIds };
}
