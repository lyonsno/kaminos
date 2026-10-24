// kaminos-test: node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { admitFrozenStdResult } from '../frozen-std-witness-checks.mjs';
const expected = { shaderSha256: 'a'.repeat(64), caseIds: ['hr1', 'hr4'], repeats: 3 };
const good = { backend: { vendor: 'apple', architecture: 'apple-metal-3', isFallbackAdapter: false },
  shaderSha256: expected.shaderSha256, rows: expected.caseIds.flatMap(id =>
    Array.from({ length: 3 }, (_, trial) => ({ id, trial, actual: [0.5, 0.7], expected: [0.5, 0.7] }))) };
assert.equal(admitFrozenStdResult(good, expected).exact, true);
const mutate = fn => { const r = structuredClone(good); fn(r); return r; };
for (const change of [r => r.rows.pop(), r => r.rows.push(r.rows[0]),
  r => r.rows[0].id = 'another-input', r => r.rows[0].trial = 9,
  r => r.backend.isFallbackAdapter = true, r => r.backend.vendor = 'google',
  r => r.shaderSha256 = 'b'.repeat(64), r => r.rows[0].actual = [0.5],
  r => r.rows[0].actual[0] = NaN, r => r.rows[0].expected[0] = Infinity]) {
  assert.throws(() => admitFrozenStdResult(mutate(change), expected));
}
const observedCorruptScalar = mutate(r => { r.rows[0].actual = [1e-12, 1e-6]; });
assert.equal(admitFrozenStdResult(observedCorruptScalar, expected).exact, false,
  'Finite corrupt output must remain a numerical mismatch, never a successful parity result.');
console.log('Frozen standard-deviation witness rejects fallback, changed source, incomplete/duplicate cases and finite corruption.');

const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'frozen-std-admission-'));
try {
  const runner = fileURLToPath(new URL('../run-frozen-std-witness.mjs', import.meta.url));
  for (const flag of ['--expected-commit', '--unexpected']) for (const stale of [false, true]) {
    const output = path.join(scratch, `${flag.slice(2)}-${stale}`), reportPath = path.join(output, 'report.json');
    await fs.mkdir(output);
    if (stale) await fs.writeFile(reportPath, JSON.stringify({ status: 'measured', phase: 'complete', command: ['old invocation'] }));
    const argv = [runner, '--output', output, flag], result = spawnSync(process.execPath, argv, { encoding: 'utf8' });
    assert.equal(result.status, 1, 'malformed invocation must fail');
    const report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
    assert.equal(report.status, 'failed');
    assert.equal(report.phase, 'admission');
    assert.deepEqual(report.command.slice(1), argv);
    assert.match(report.error.message, flag === '--expected-commit' ? /argument missing/ : /Unknown option/);
    assert.equal(report.ownedBrowserPid, undefined, 'argument admission must precede browser launch');
  }
} finally { await fs.rm(scratch, { recursive: true, force: true }); }
console.log('Malformed argument failures replace stale success with the current failed-admission report.');
