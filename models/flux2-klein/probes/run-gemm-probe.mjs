// Run the Klein GEMM throughput probe in an independent Chrome for Testing.
// Usage: node run-gemm-probe.mjs --chrome <exe> --out <report.json> [--shapes klein4b-512|klein4b-1024|smoke|all]
//        [--subgroup-matrix] [--iters N] [--kernels a,b]
// The report is written on success and on failure, naming the last phase reached.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
// Effective source identity of the code this run actually executed.
function sourceIdentity(dir) {
  try {
    const rev = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const dirty = execFileSync('git', ['-C', dir, 'status', '--porcelain', '--', '.'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
    return { rev, dirtyFiles: dirty };
  } catch (e) { return { error: String(e) }; }
}


const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const flag = name => args.includes(name);
const chrome = opt('--chrome');
const outPath = opt('--out');
if (!chrome || !outPath) { console.error('need --chrome and --out'); process.exit(2); }

// Klein 4B linear shapes. Tokens: 512^2 -> 1024 image + 128 prompt; 1024^2 -> 4096 + 128.
const kleinShapes = (img, tag) => {
  const txt = 128, all = img + txt;
  return [
    { name: `${tag}/single-in`, M: all, K: 3072, N: 27648 },
    { name: `${tag}/single-out`, M: all, K: 12288, N: 3072 },
    { name: `${tag}/double-qkv`, M: img, K: 3072, N: 9216 },
    { name: `${tag}/double-mlp-in`, M: img, K: 3072, N: 18432 },
    { name: `${tag}/double-mlp-down`, M: img, K: 9216, N: 3072 },
  ];
};
const shapeSets = {
  smoke: [{ name: 'smoke/small', M: 192, K: 256, N: 320 }, { name: 'smoke/ragged-m', M: 200, K: 512, N: 384 }],
  'klein4b-512': kleinShapes(1024, '512'),
  'klein4b-1024': kleinShapes(4096, '1024'),
};
shapeSets.all = [...shapeSets['klein4b-512'], ...shapeSets['klein4b-1024']];
const shapeKey = opt('--shapes', 'klein4b-512');
const shapes = (shapeSets[shapeKey] || []).map((s, i) => ({ ...s, seed: 1000 + i }));
const cfg = { shapes, iters: Number(opt('--iters', '10')), rowBudgetMs: Number(opt('--row-budget-ms', '4000')), samples: Number(opt('--samples', '64')),
  tolF32Acc: 1e-2, tolF16Acc: 5e-2, kernels: opt('--kernels') ? opt('--kernels').split(',') : null };
const chromeFlags = ['--headless=new', '--remote-debugging-port=0', '--use-mock-keychain', '--password-store=basic',
  '--no-first-run', ...(flag('--subgroup-matrix') ? ['--enable-unsafe-webgpu', '--enable-features=WebGPUDeveloperFeatures'] : [])];

const report = { schema: 'kaminos.flux2-klein.gemm-probe-run.v0', requestedChrome: chrome, chromeFlags, shapeSet: shapeKey,
  host: os.hostname(), startedAt: new Date().toISOString(), source: sourceIdentity(here), phase: 'launch' };
let child, server;
async function finish(code) {
  report.finishedAt = new Date().toISOString();
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(report, null, 2));
  if (child && child.exitCode === null) child.kill('SIGTERM');
  server?.close();
  process.exit(code);
}
try {
  if (!shapes.length) throw new Error(`unknown shape set ${shapeKey}`);
  server = http.createServer(async (q, r) => {
    const file = path.join(here, decodeURIComponent(new URL(q.url, 'http://x').pathname));
    if (!file.startsWith(here)) { r.writeHead(403); return r.end(); }
    try {
      const body = await fs.readFile(file);
      r.writeHead(200, { 'content-type': file.endsWith('.js') ? 'text/javascript' : 'text/html', 'cache-control': 'no-store' });
      r.end(body);
    } catch { r.writeHead(404); r.end(); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const pageUrl = `http://127.0.0.1:${server.address().port}/gemm-probe.html`;
  report.pageUrl = pageUrl;
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'klein-gemm-'));
  child = spawn(chrome, [...chromeFlags, `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  report.ownedBrowserPid = child.pid;
  child.once('exit', (c, s) => { report.browserExit = { code: c, signal: s }; });
  const wsUrl = await new Promise((resolve, reject) => {
    let stderr = '';
    child.stderr.on('data', b => { stderr += b; const m = stderr.match(/DevTools listening on (ws:\/\/\S+)/); if (m) resolve(m[1]); });
    child.once('exit', (c, s) => reject(new Error(`browser exited before CDP: ${c}/${s}`)));
    setTimeout(() => reject(new Error('CDP timeout')), 20000);
  });
  const base = wsUrl.replace('ws://', 'http://').replace(/\/devtools\/browser\/.*/, '');
  report.effectiveBrowser = (await (await fetch(`${base}/json/version`)).json()).Browser;
  const page = (await (await fetch(`${base}/json/list`)).json()).find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pending = new Map(); const consoleLines = [];
  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    if (msg.method === 'Runtime.consoleAPICalled') consoleLines.push(msg.params.args.map(a => a.value ?? a.description).join(' '));
    if (msg.method === 'Runtime.exceptionThrown') consoleLines.push(`exception: ${msg.params.exceptionDetails?.exception?.description}`);
  };
  report.console = consoleLines;
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable'); await send('Page.enable');
  report.phase = 'navigate';
  await send('Page.navigate', { url: pageUrl });
  for (let i = 0; i < 100; i++) {
    const r = await send('Runtime.evaluate', { expression: 'window.gemmProbeReady === true', returnByValue: true });
    if (r.result?.result?.value) break;
    await new Promise(r => setTimeout(r, 100));
  }
  report.phase = 'probe';
  const res = await send('Runtime.evaluate', { expression: `window.runGemmProbe(${JSON.stringify(cfg)})`, awaitPromise: true, returnByValue: true });
  report.probe = res.result?.result?.value ?? { evaluateError: res.result?.exceptionDetails ?? res.error ?? res };
  report.phase = report.probe?.phase === 'done' ? 'done' : `probe-${report.probe?.phase ?? 'unknown'}`;
  ws.close();
  await finish(report.phase === 'done' ? 0 : 1);
} catch (e) {
  report.error = String(e?.stack || e);
  await finish(1);
}
