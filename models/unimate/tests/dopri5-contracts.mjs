// The JS dopri5 must take torchdiffeq's steps: same evaluation times (as the
// float32 values the drift receives), same accept/reject sequence and step
// sizes, and the same dense-output solution at every output time.
// Fixture: export-dopri5-fixture.py (torch 2.5.1, torchdiffeq 0.2.5).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dopri5Solve } from '../unimate-dopri5.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'dopri5-reference.json'), 'utf8'));

for (const c of fixture.cases) {
  const n = c.y0.length;
  const a = Float32Array.from(c.a), bq = Float32Array.from(c.b), cc = Float32Array.from(c.c);
  const seenT = [];
  const drift = async (t, y) => {
    seenT.push(t);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      out[i] = Math.fround(Math.fround(Math.fround(a[i] * y[i]) + Math.fround(Math.fround(bq[i] * t) * t)) + cc[i]);
    }
    return out;
  };
  const res = await dopri5Solve({ y0: Float32Array.from(c.y0), drift, outputTimes: c.ts, rtol: 1e-3, atol: 1e-6 });

  assert.equal(res.steps.length, c.steps.length, `${c.name}: attempted step count`);
  res.steps.forEach((s, i) => {
    const r = c.steps[i];
    assert.equal(s.accepted, r.accepted, `${c.name}: step ${i} accept`);
    assert.ok(Math.abs(s.t0 - r.t0) <= 1e-12 * Math.max(1, Math.abs(r.t0)), `${c.name}: step ${i} t0 ${s.t0} vs ${r.t0}`);
    assert.ok(Math.abs(s.dt - r.dt) <= 1e-9 * Math.abs(r.dt), `${c.name}: step ${i} dt ${s.dt} vs ${r.dt}`);
  });
  assert.equal(seenT.length, c.evals.length, `${c.name}: drift evaluation count`);
  seenT.forEach((t, i) => assert.equal(t, c.evals[i].t, `${c.name}: evaluation ${i} time`));

  let maxErr = 0;
  c.solution.forEach((row, k) => row.forEach((v, i) => { maxErr = Math.max(maxErr, Math.abs(res.solution[k][i] - v)); }));
  assert.ok(maxErr <= 1e-6, `${c.name}: solution max abs diff ${maxErr}`);
  console.log(`${c.name}: ${res.steps.length} steps (${c.rejected} rejected), ${seenT.length} evaluations, max abs diff ${maxErr.toExponential(2)}`);
}
console.log('dopri5 contracts: pass');
