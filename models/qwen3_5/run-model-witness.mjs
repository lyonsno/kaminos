import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { startServer, launchChrome, sourceIdentity } from '../flux2-klein/cdp-harness.mjs';
import { qwen35ModelLayout } from './model-layout.js';
import { adjudicateModelReadbacks } from './model-witness-contract.js';
const sha = b => crypto.createHash('sha256').update(b).digest('hex');

export async function runModelWitness({ fixture, modelRoot, chrome, out }) {
  if (!out) throw new Error('explicit report path required');
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const report = { schema: 'kaminos.qwen35-model-witness.v1', status: 'failed', phase: 'setup', source: sourceIdentity(repo), requested: { fixture, modelRoot, chrome }, rows: [] };
  const save = async () => { await fsp.mkdir(path.dirname(path.resolve(out)), { recursive: true }); await fsp.writeFile(out, JSON.stringify(report, null, 2) + '\n'); };
  let browser, server;
  try {
    await save(); report.phase = 'reference-admission';
    const root = fs.realpathSync(fixture), nativeBytes = fs.readFileSync(path.join(root, 'report.json')), native = JSON.parse(nativeBytes), metaBytes = fs.readFileSync(path.join(root, 'meta.json')), meta = JSON.parse(metaBytes);
    const weightsBytes = fs.readFileSync(path.join(root, 'weights.json')), manifest = JSON.parse(weightsBytes);
    if (native.status !== 'passed' || native.effective?.backend !== 'mlx-metal' || native.metaSha256 !== sha(metaBytes) || native.weightsManifestSha256 !== sha(weightsBytes) || meta.weightsManifestSha256 !== sha(weightsBytes)) throw new Error('failed/stale/wrong native reference or weights manifest');
    qwen35ModelLayout(manifest);
    const model = fs.realpathSync(modelRoot);
    if (model !== manifest.source.localRoot || sha(fs.readFileSync(path.join(model, 'config.json'))) !== manifest.source.configSha256) throw new Error('wrong model root/config');
    const arrays = new Map();
    for (const [name, row] of Object.entries(meta.arrays)) {
      if (path.basename(row.file) !== row.file) throw new Error('invalid reference path');
      const raw = fs.readFileSync(path.join(root, row.file));
      if (row.dtype !== 'f32' || raw.length !== row.bytes || sha(raw) !== row.sha256) throw new Error(`partial/changed reference ${name}`);
      arrays.set(name, new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)));
    }
    report.reference = { root, metaSha256: sha(metaBytes), weightsManifestSha256: sha(weightsBytes), nativeReportSha256: sha(nativeBytes), effective: native.effective };
    report.phase = 'browser-admission'; await save();
    const executable = fs.realpathSync(chrome); fs.accessSync(executable, fs.constants.X_OK);
    if (/\/Google Chrome\.app\//i.test(executable)) throw new Error('installed GUI Chrome is not an automation executable');
    report.effectiveExecutable = executable;
    const serving = await startServer({ '/fixture/': root, '/model/': model, '/': repo }); server = serving.server;
    browser = await launchChrome(executable, [], report);
    report.phase = 'gpu-execution'; report.url = serving.origin + '/models/qwen3_5/model-witness.html'; await save();
    await browser.navigate(report.url, 'window.qwenModelReady === true');
    const result = await browser.evaluate('window.qwenModelResult.then(r => ({ ...r, rows: r.rows.map(({data,...row})=>row) }))');
    report.adapter = result.adapter; report.errors = result.errors; report.effective = { backend: result.backend, weightsManifestSha256: result.weightsManifestSha256, limits: result.limits, residentWeightBytes: result.residentWeightBytes };
    report.lengths = result.lengths; report.generation = result.generation; report.cleanup = result.cleanup; report.lastPhase = result.lastPhase;
    const rawDir = path.resolve(path.dirname(out), path.basename(out, '.json') + '-readbacks'); await fsp.mkdir(rawDir, { recursive: true });
    for (const [index, row] of (result.rows ?? []).entries()) {
      row.data = await browser.evaluate(`window.qwenModelResult.then(r => r.rows[${index}].data)`);
      const raw = Buffer.from(row.data, 'base64'), file = path.join(rawDir, `${index}.f32.bin`);
      await fsp.writeFile(file, raw); report.rows.push({ name: row.name, elements: row.elements, file, sha256: sha(raw) }); await save();
    }
    let failure;
    try { report.verdict = adjudicateModelReadbacks(result, meta, manifest, arrays); } catch (error) { failure = error; }
    for (const row of report.rows) { const observed = result.rows.find(r => r.name === row.name); for (const key of ['relL2', 'maxAbs', 'maxScaled', 'nonFinite', 'top1']) if (observed[key] !== undefined) row[key] = observed[key]; }
    if (failure) throw failure;
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
  const [fixture, modelRoot, chrome, out] = process.argv.slice(2);
  const report = await runModelWitness({ fixture, modelRoot, chrome, out });
  console.log(JSON.stringify({ status: report.status, phase: report.phase, error: report.error, generation: report.generation, rows: report.rows })); process.exitCode = report.status === 'passed' ? 0 : 1;
}
