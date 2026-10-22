// Browser half of the MobRecon parity witness: loads the packed model through a
// kit session route, runs every reference case's exact source input through the
// WebGPU network, and compares outputs (and, for named cases, every block
// boundary the network materializes) with the PyTorch reference. Reference
// tensors are verified against their recorded SHA-256 before use.
import { createWebGpuInferenceSession } from '../../webgpu-inference-kit/src/core.js';
import { loadMobRecon, MOBRECON_ROUTE_ID } from './mobrecon-route.js';
import { admitAdapter, admitOutputs, compareTensor, gateCase } from './parity-checks.js';

const hex = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');

async function referenceTensor(base, row) {
  const response = await fetch(new URL(row.file.split('/').map(encodeURIComponent).join('/'), base));
  if (!response.ok) throw new Error(`reference ${row.file}: HTTP ${response.status}`);
  const bytes = await response.arrayBuffer();
  if (await hex(bytes) !== row.sha256) throw new Error(`reference ${row.file}: sha256 mismatch`);
  if (row.dtype !== 'f32') throw new Error(`reference ${row.file}: expected f32, found ${row.dtype}`);
  return new Float32Array(bytes);
}

export async function runParityWitness({ packageUrl, referenceUrl, fullCases = [], timedRuns = 20, report }) {
  report.phase = 'adapter';
  const adapter = await navigator.gpu?.requestAdapter();
  report.adapter = admitAdapter(adapter?.info);
  report.phase = 'session';
  const session = await createWebGpuInferenceSession({ sessionId: crypto.randomUUID(), gpu: navigator.gpu, adapterName: 'mobrecon-parity' });
  let model;
  try {
    const route = await session.registerRoute({ routeId: MOBRECON_ROUTE_ID });
    report.phase = 'package';
    model = await loadMobRecon({ route, packageUrl });
    report.identity = model.identity;
    report.phase = 'reference';
    const base = new URL(referenceUrl.endsWith('/') ? referenceUrl : `${referenceUrl}/`, location.href);
    const manifest = await (await fetch(new URL('manifest.json', base), { cache: 'no-store' })).json();
    if (manifest.schema !== 'mobrecon.reference.v0' || manifest.status !== 'succeeded') throw new Error('succeeded mobrecon.reference.v0 required');
    if (manifest.provenance.checkpointSha256 !== model.identity.provenance.checkpointSha256) throw new Error('reference and package use different checkpoints');
    report.reference = { provenance: manifest.provenance, runtime: manifest.runtime, caseCount: manifest.cases.length };
    report.cases = [];
    const failures = [];
    for (const c of manifest.cases) {
      report.phase = `case ${c.id}`;
      const input = await referenceTensor(base, c.tensors.input);
      const full = fullCases.includes(c.id);
      const capture = full ? model.network.names().filter(name => c.tensors[name] && name !== 'mesh_pred' && name !== 'uv_pred') : [];
      const result = await model.network.run({ input, capture });
      admitOutputs(result);
      const comparisons = [
        compareTensor('mesh_pred', result.mesh, await referenceTensor(base, c.tensors.mesh_pred)),
        compareTensor('uv_pred', result.uv, await referenceTensor(base, c.tensors.uv_pred)),
      ];
      for (const name of capture) comparisons.push(compareTensor(name, result.captures[name].data, await referenceTensor(base, c.tensors[name])));
      const caseFailures = gateCase(c.id, comparisons);
      failures.push(...caseFailures);
      report.cases.push({ id: c.id, handedness: c.handedness, native: c.native ?? null, full, comparisons, failures: caseFailures });
    }
    // Negative control: one case's output against a different capture's
    // reference must fail the same gate, or the comparison cannot discriminate.
    report.phase = 'negative-control';
    if (manifest.cases.length < 2) throw new Error('negative control needs two reference cases');
    const [own, other] = manifest.cases;
    const control = await model.network.run({ input: await referenceTensor(base, own.tensors.input) });
    const crossed = [compareTensor('mesh_pred', control.mesh, await referenceTensor(base, other.tensors.mesh_pred)),
      compareTensor('uv_pred', control.uv, await referenceTensor(base, other.tensors.uv_pred))];
    const controlFailures = gateCase(`${own.id}-vs-${other.id}`, crossed);
    report.negativeControl = { output: own.id, reference: other.id, comparisons: crossed, gateFailures: controlFailures };
    if (controlFailures.length !== crossed.length) failures.push('negative control passed the gate: comparison does not discriminate');
    report.phase = 'timing';
    const input = await referenceTensor(base, manifest.cases[0].tensors.input);
    const times = [];
    for (let i = 0; i < timedRuns; i++) {
      const t = performance.now();
      await model.network.run({ input });
      times.push(performance.now() - t);
    }
    times.sort((a, b) => a - b);
    report.timing = { authority: 'diagnostic wall clock on a shared machine; includes upload and readback; not a benchmark',
      runs: timedRuns, medianMs: times[Math.floor(times.length / 2)], minMs: times[0], maxMs: times[times.length - 1] };
    report.failures = failures;
    report.status = failures.length ? 'failed' : 'passed';
    report.phase = null;
  } finally {
    model?.release();
    await session.close?.();
  }
  return report;
}
