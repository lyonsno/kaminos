import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { startServer, launchChrome, sourceIdentity } from '../flux2-klein/cdp-harness.mjs';
import { kernelWitnessContract, adjudicateKernelReadbacks } from './kernel-witness-contract.js';

export async function collectKernelWitness(browser, preserve) {
  // The measured combined reply (~8 MB) closes Node's CDP WebSocket while
  // individual rows succeed. Transport every byte, one observation at a time.
  const result = await browser.evaluate('window.qwenKernelResult.then(r => ({ ...r, rows: r.rows.map(({ data, ...metrics }) => metrics) }))');
  for (const [index, row] of (result?.rows ?? []).entries()) {
    row.data = await browser.evaluate(`window.qwenKernelResult.then(r => r.rows[${index}].data)`);
    await preserve(row, index);
  }
  return result;
}

export async function runKernelWitness({ chrome, fixture, out, tiledAffine = false }) {
  if (!out) throw new TypeError('an explicit report path is required');
  const report = { schema: 'kaminos.qwen35-kernel-witness.v1', status: 'failed', phase: 'setup',
    requested: { chrome, fixture, tiledAffine }, source: sourceIdentity(path.dirname(fileURLToPath(import.meta.url))) };
  let browser, server;
  const save = async () => { await fsp.mkdir(path.dirname(path.resolve(out)), { recursive: true }); await fsp.writeFile(out, JSON.stringify(report, null, 2) + '\n'); };
  try {
    await save(); report.phase = 'source-admission';
    if (typeof tiledAffine !== 'boolean') throw new Error('unsupported affine mode');
    if (!report.source.rev || report.source.dirtyFiles?.length) throw new Error('kernel witness requires clean committed source');
    report.phase = 'reference-admission'; await save();
    const root = fs.realpathSync(fixture), metaBytes = fs.readFileSync(path.join(root, 'meta.json')), meta = JSON.parse(metaBytes);
    const expected = kernelWitnessContract(meta), arrays = new Map();
    report.reference = { root, metaSha256: crypto.createHash('sha256').update(metaBytes).digest('hex'), source: meta.source, expectedObservations: expected.size };
    const native = JSON.parse(fs.readFileSync(path.join(root, 'report.json')));
    if (native.status !== 'passed' || native.effective?.backend !== 'mlx-metal' || native.metaSha256 !== report.reference.metaSha256) throw new Error('reference export failed, is stale, or used a different backend');
    for (const [name, row] of Object.entries(meta.arrays)) {
      const file = path.resolve(root, row.file);
      if (!file.startsWith(root + path.sep)) throw new Error(`reference path escapes its root: ${name}`);
      const data = fs.readFileSync(file);
      if (data.length !== row.bytes || crypto.createHash('sha256').update(data).digest('hex') !== row.sha256) throw new Error(`wrong or partial reference ${name}`);
      if (row.dtype === 'f32') arrays.set(name, new Float32Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)));
    }
    report.phase = 'browser-admission'; await save();
    const executable = fs.realpathSync(chrome);
    if (/\/Google Chrome\.app\//i.test(executable)) throw new Error('installed GUI Chrome is not an automation executable');
    fs.accessSync(executable, fs.constants.X_OK); report.effectiveExecutable = executable;
    const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
    const serving = await startServer({ '/fixture/': root, '/': repo }); server = serving.server;
    browser = await launchChrome(executable, [], report);
    report.phase = 'gpu-execution'; report.url = `${serving.origin}/models/qwen3_5/kernel-witness.html?affine=${tiledAffine ? 'tiled' : 'oracle'}`; await save();
    await browser.navigate(report.url, 'window.qwenKernelReady === true');
    // Preserve raw readbacks before adjudicating a mismatch.
    report.rows = [];
    const output = path.resolve(path.dirname(out), path.basename(out, '.json') + '-readbacks'); await fsp.mkdir(output, { recursive: true });
    const result = await collectKernelWitness(browser, async (row, index) => {
      const { data, ...metrics } = row, raw = Buffer.from(data, 'base64'), file = path.join(output, `${index}.f32.bin`);
      await fsp.writeFile(file, raw); report.rows.push({ ...metrics, file, sha256: crypto.createHash('sha256').update(raw).digest('hex') });
      if (raw.length !== row.elements * 4) throw new Error(`partial raw readback ${row.name}`);
    });
    report.adapter = result?.adapter; report.errors = result?.errors; report.completedObservations = result?.rows?.length ?? 0;
    let mismatch;
    report.affineKernel = result?.affineKernel;
    try { adjudicateKernelReadbacks(result, meta, arrays, { affineKernel: tiledAffine ? 'tiled' : 'oracle' }); } catch (error) { mismatch = error; }
    // Save host-derived metrics even when adjudication rejects the run.
    for (const row of report.rows) {
      const measured = result.rows.find(value => value.name === row.name);
      Object.assign(row, { relL2: measured.relL2, maxAbs: measured.maxAbs, nonFinite: measured.nonFinite, pageMetrics: measured.pageMetrics });
    }
    if (mismatch) throw mismatch;
    report.sourceAfter = sourceIdentity(repo);
    if (report.sourceAfter.rev !== report.source.rev || report.sourceAfter.dirtyFiles?.length) throw new Error('kernel source changed during execution');
    report.status = 'passed'; report.phase = 'complete';
  } catch (error) { report.error = String(error.stack ?? error); }
  finally {
    try { await browser?.close(); } catch (error) { report.cleanupError = String(error); report.status = 'failed'; }
    if (server) await new Promise(resolve => server.close(resolve));
    await save();
  }
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [fixture, chrome, out, mode] = process.argv.slice(2);
  const report = await runKernelWitness({ fixture, chrome, out, tiledAffine: mode === undefined ? false : mode === '--tiled-affine' ? true : mode });
  console.log(JSON.stringify({ status: report.status, phase: report.phase, error: report.error, rows: report.rows?.map(({ name, relL2, maxAbs, nonFinite }) => ({ name, relL2, maxAbs, nonFinite })) }));
  process.exitCode = report.status === 'passed' ? 0 : 1;
}
