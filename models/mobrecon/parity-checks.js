// Comparison and admission checks for the MobRecon parity witness. Pure
// functions: no GPU, no fetch, usable from Node contracts and the page.

export function compareTensor(name, actual, expected) {
  if (!(actual instanceof Float32Array) || !(expected instanceof Float32Array)) throw new TypeError(`${name}: Float32Array values required`);
  if (actual.length !== expected.length) throw new Error(`${name}: ${actual.length} values vs reference ${expected.length}`);
  let maxAbs = 0, refMaxAbs = 0, sumAbs = 0, worst = -1, nonFinite = 0;
  for (let i = 0; i < actual.length; i++) {
    if (!Number.isFinite(actual[i])) { nonFinite++; continue; }
    const d = Math.abs(actual[i] - expected[i]);
    sumAbs += d;
    if (d > maxAbs) { maxAbs = d; worst = i; }
    refMaxAbs = Math.max(refMaxAbs, Math.abs(expected[i]));
  }
  return { name, count: actual.length, maxAbs, refMaxAbs, relative: refMaxAbs > 0 ? maxAbs / refMaxAbs : maxAbs,
    meanAbs: sumAbs / actual.length, worstIndex: worst, nonFinite };
}

// Outputs must be present, finite and non-degenerate before any comparison can
// stand as evidence: an all-zero or constant mesh would match nothing useful.
export function admitOutputs({ mesh, uv }) {
  if (!(mesh instanceof Float32Array) || mesh.length !== 778 * 3) throw new Error('mesh output must be 778x3 F32');
  if (!(uv instanceof Float32Array) || uv.length !== 21 * 2) throw new Error('uv output must be 21x2 F32');
  for (const [label, values] of [['mesh', mesh], ['uv', uv]]) {
    if (!values.every(Number.isFinite)) throw new Error(`${label} output has non-finite values`);
    let min = Infinity, max = -Infinity;
    for (const v of values) { min = Math.min(min, v); max = Math.max(max, v); }
    if (!(max - min > 1e-3)) throw new Error(`${label} output is degenerate (range ${max - min})`);
  }
}

// Gates in model units: mesh coordinates are 0.2 m per unit in the native
// route, so 1e-4 is 0.02 mm; landmarks are crop fractions, so 1e-4 is 0.013 px
// of the 128 px crop.
export const PARITY_GATES = Object.freeze({ mesh_pred: 1e-4, uv_pred: 1e-4 });

export function gateCase(caseId, comparisons) {
  const failures = [];
  for (const [name, limit] of Object.entries(PARITY_GATES)) {
    const row = comparisons.find(c => c.name === name);
    if (!row) failures.push(`${caseId}: ${name} was not compared`);
    else if (row.nonFinite) failures.push(`${caseId}: ${name} has ${row.nonFinite} non-finite values`);
    else if (!(row.maxAbs <= limit)) failures.push(`${caseId}: ${name} max abs ${row.maxAbs} exceeds ${limit}`);
  }
  return failures;
}

// The adapter must be a real hardware WebGPU adapter, not a software fallback.
export function admitAdapter(info) {
  if (!info) throw new Error('no WebGPU adapter');
  if (info.isFallbackAdapter) throw new Error(`fallback WebGPU adapter (${info.vendor} ${info.architecture})`);
  return { vendor: info.vendor ?? null, architecture: info.architecture ?? null, device: info.device ?? null,
    description: info.description ?? null, isFallbackAdapter: Boolean(info.isFallbackAdapter) };
}
