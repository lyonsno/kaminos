// MobRecon WebGPU parity witness launcher. Serves the repository, a MobRecon
// package (pack-weights.py) and a PyTorch reference (export-reference.py), runs
// parity-witness.js in an independent Chrome for Testing with WebGPU, a mock
// keychain and a private profile, and writes the page's report. A failure
// before the page reports (missing browser, server error, timeout, browser
// exit) still writes a terminal report naming its phase.
//
// node models/mobrecon/run-parity-witness.mjs --package <dir> --reference <dir> --chrome <Chrome for Testing> --out <report.json> [--full <caseId,...>]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
for (const k of ['--package', '--reference', '--chrome', '--out']) if (!args.get(k)) throw new Error(`${k} required`);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.resolve(args.get('--out'));
const chrome = path.resolve(args.get('--chrome'));
if (/\/Google Chrome\.app\//.test(fs.realpathSync(chrome))) throw new Error('use Chrome for Testing, not the installed Google Chrome');
const fullCases = (args.get('--full') ?? '').split(',').filter(Boolean);
const roots = { '/repo/': repo, '/package/': path.resolve(args.get('--package')), '/reference/': path.resolve(args.get('--reference')) };
const PAGE = `<!doctype html><meta charset="utf-8"><title>MobRecon parity witness</title><script type="module">
const report={status:'running',phase:'import'};
try{
  const {runParityWitness}=await import('/repo/models/mobrecon/parity-witness.js');
  await runParityWitness({packageUrl:'/package/',referenceUrl:'/reference/',fullCases:${JSON.stringify(fullCases)},report});
}catch(e){report.status='error';report.error=String(e.stack||e);}
await fetch('/__report',{method:'POST',body:JSON.stringify(report)});
</script>`;
const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json' };
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mobrecon-parity-'));
let child, report = { status: 'running', phase: 'server', effectiveBrowser: chrome, browserRealPath: fs.realpathSync(chrome), repo, profile,
  package: roots['/package/'], reference: roots['/reference/'], fullCases };
const write = () => fs.writeFileSync(out, JSON.stringify(report, null, 1));
write();
const timer = setTimeout(() => finish({ status: 'timeout' }), 10 * 60 * 1000);
let finished = false;
function finish(result) {
  if (finished) return;
  finished = true;
  clearTimeout(timer);
  report = { ...report, ...result, browserPid: child?.pid ?? null };
  try { child?.kill('SIGTERM'); } catch {}
  if (server.listening) server.close();
  setTimeout(() => {
    report.browserExited = child ? child.exitCode !== null || child.signalCode !== null : null;
    fs.rmSync(profile, { recursive: true, force: true });
    write();
    console.log(JSON.stringify({ status: report.status, phase: report.phase, failures: report.failures, error: report.error, out }));
    process.exitCode = report.status === 'passed' ? 0 : 1;
  }, 1500);
}
const server = http.createServer((req, res) => {
  if (req.method === 'POST') {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => { res.end('ok'); finish(JSON.parse(body)); });
    return;
  }
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/') { res.setHeader('content-type', 'text/html'); return res.end(PAGE); }
  let file = null;
  for (const [prefix, root] of Object.entries(roots)) if (url.startsWith(prefix)) file = path.join(root, url.slice(prefix.length));
  if (!file) { res.statusCode = 404; return res.end(); }
  fs.readFile(file, (error, data) => {
    if (error) { res.statusCode = 404; return res.end(); }
    res.setHeader('content-type', types[path.extname(file)] ?? 'application/octet-stream');
    res.end(data);
  });
}).listen(0, '127.0.0.1', () => {
  report.phase = 'browser';
  write();
  child = spawn(chrome, ['--headless=new', '--no-first-run', '--use-mock-keychain', '--password-store=basic',
    '--enable-unsafe-webgpu', '--enable-features=WebGPU', `--user-data-dir=${profile}`,
    `http://127.0.0.1:${server.address().port}/`], { stdio: 'ignore' });
  child.on('error', error => finish({ status: 'error', phase: 'browser', error: String(error) }));
  child.on('exit', code => finish({ status: 'browser-exited', code }));
});
server.on('error', error => finish({ status: 'error', phase: 'server', error: String(error) }));
