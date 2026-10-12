// T5 encoder parity witness: browser token ids, token states and pooled caption
// embedding against upstream UniMate's _encode_prompt (pack-t5.py --reference).
// Gate: identical ids, and relative L2 <= ?gate (1e-5) on tokens and pooled vector
// for every non-empty corpus case. Publishes window.__unimateT5Witness.
import { T5Encoder } from './unimate-t5.js';
import { compare, createDevice, fetchBytes, fetchJson } from './witness-common.js';

const state = { phase: 'start', progress: 0, report: null };
window.__unimateT5Witness = state;
const GATE = Number(new URL(location.href).searchParams.get('gate') ?? '1e-5');

async function run() {
  const report = { schema: 'kaminos.unimate.t5-witness.v0', gate: GATE, cases: [] };
  state.report = report;
  state.phase = 'load';
  const device = await createDevice(report);
  const manifest = await fetchJson('/t5/t5-manifest.json');
  const t5 = await T5Encoder.create(device, manifest, await fetchBytes(`/t5/${manifest.file}`), await fetchJson('/t5/t5-tokenizer.json'));
  const ref = await fetchJson('/t5/t5-reference.json');
  report.weights = { sha256: manifest.sha256, source: manifest.source };
  state.phase = 'encode';
  for (const c of ref.cases) {
    const ids = t5.tokenizer.encode(c.text);
    const row = { text: c.text, idsMatch: JSON.stringify(ids) === JSON.stringify(c.ids) };
    if (c.text) {
      const t0 = performance.now();
      const out = await t5.encode(c.text);
      row.ms = performance.now() - t0;
      row.pooled = compare('pooled', out.pooled, Float32Array.from(c.caption_emb));
      row.tokens = compare('tokens', out.hidden, Float32Array.from(c.tokens.flat()));
      row.pass = row.idsMatch && row.pooled.relativeL2Error <= GATE && row.tokens.relativeL2Error <= GATE;
    } else {
      row.pass = row.idsMatch;
    }
    report.cases.push(row);
    state.progress = report.cases.length;
  }
  report.pass = !report.gpuErrors && report.cases.every(r => r.pass);
  state.phase = 'done';
}
run().catch(e => { state.error = String(e?.stack ?? e); state.phase = 'failed'; });
