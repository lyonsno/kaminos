// Run the Klein transformer parity witness in an independent Chrome for Testing.
// Usage: node run-transformer-witness.mjs --chrome <exe> --weights <dir> --ref <dir> --out <report.json>
//        [--step 0] [--tolerance 1e-3] [--timing-runs 2] [--no-digests]
// Writes the report on success and failure, naming the last phase reached.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const chrome = opt('--chrome'), outPath = opt('--out');
const roots = { '/weights/': path.resolve(opt('--weights', '')), '/ref/': path.resolve(opt('--ref', '')), '/vae/': path.resolve(opt('--vae', '.')), '/te/': path.resolve(opt('--te', '.')), '/': here };
const cfg = { step: Number(opt('--step', '0')), tolerance: Number(opt('--tolerance', '1e-3')),
  timingRuns: Number(opt('--timing-runs', '2')), verifyDigests: !args.includes('--no-digests'), vae: Boolean(opt('--vae')), textEncoder: Boolean(opt('--te')) };
const report = { schema: 'kaminos.flux2-klein.transformer-witness-run.v0', requestedChrome: chrome, roots, config: cfg,
  host: os.hostname(), startedAt: new Date().toISOString(), phase: 'launch' };
let child, server, ws;
const send = (() => { let id = 0; const pending = new Map();
  const fn = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  fn.pending = pending; return fn; })();
async function finish(code) {
  report.finishedAt = new Date().toISOString();
  await fsp.mkdir(path.dirname(outPath), { recursive: true });
  await fsp.writeFile(outPath, JSON.stringify(report, null, 2));
  if (child && child.exitCode === null) child.kill('SIGTERM');
  server?.close();
  process.exit(code);
}
try {
  if (!chrome || !outPath) throw new Error('need --chrome and --out');
  server = http.createServer((q, r) => {
    const url = decodeURIComponent(new URL(q.url, 'http://x').pathname);
    const prefix = Object.keys(roots).find(p => url.startsWith(p));
    const root = roots[prefix]; const file = path.join(root, url.slice(prefix.length));
    if (!file.startsWith(root)) { r.writeHead(403); return r.end(); }
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) { r.writeHead(404); return r.end(); }
      const type = file.endsWith('.js') || file.endsWith('.mjs') ? 'text/javascript' : file.endsWith('.json') ? 'application/json' : file.endsWith('.html') ? 'text/html' : 'application/octet-stream';
      const range = /^bytes=(\d+)-(\d+)$/.exec(q.headers.range || '');
      if (range) {
        const start = Number(range[1]), end = Math.min(Number(range[2]), st.size - 1);
        r.writeHead(206, { 'content-type': type, 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${st.size}`, 'cache-control': 'no-store' });
        return fs.createReadStream(file, { start, end }).pipe(r);
      }
      r.writeHead(200, { 'content-type': type, 'content-length': st.size, 'cache-control': 'no-store' });
      fs.createReadStream(file).pipe(r);
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const pageUrl = `http://127.0.0.1:${server.address().port}/transformer-witness.html`;
  report.pageUrl = pageUrl;
  const profile = await fsp.mkdtemp(path.join(os.tmpdir(), 'klein-witness-'));
  child = spawn(chrome, ['--headless=new', '--remote-debugging-port=0', '--use-mock-keychain', '--password-store=basic',
    '--no-first-run', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
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
  let page;
  for (let i = 0; i < 50 && !page; i++) {
    page = (await (await fetch(`${base}/json/list`)).json()).find(t => t.type === 'page');
    if (!page) await new Promise(r => setTimeout(r, 100));
  }
  if (!page) throw new Error('no page target after 5 s');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  const consoleLines = []; report.console = consoleLines;
  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && send.pending.has(msg.id)) { send.pending.get(msg.id)(msg); send.pending.delete(msg.id); }
    if (msg.method === 'Runtime.consoleAPICalled') consoleLines.push(msg.params.args.map(a => a.value ?? a.description).join(' '));
    if (msg.method === 'Runtime.exceptionThrown') consoleLines.push(`exception: ${msg.params.exceptionDetails?.exception?.description}`);
  };
  await send('Runtime.enable'); await send('Page.enable');
  report.phase = 'navigate';
  await send('Page.navigate', { url: pageUrl });
  for (let i = 0; i < 100; i++) {
    const r = await send('Runtime.evaluate', { expression: 'window.transformerWitnessReady === true', returnByValue: true });
    if (r.result?.result?.value) break;
    await new Promise(r => setTimeout(r, 100));
  }
  report.phase = 'witness';
  const res = await send('Runtime.evaluate', { expression: `window.runTransformerWitness(${JSON.stringify(cfg)})`, awaitPromise: true, returnByValue: true });
  report.witness = res.result?.result?.value ?? { evaluateError: res.result?.exceptionDetails ?? res.error ?? res };
  if (report.witness?.browserImagePngBase64) {
    const png = path.join(path.dirname(outPath), 'browser-image.png');
    await fsp.mkdir(path.dirname(outPath), { recursive: true });
    await fsp.writeFile(png, Buffer.from(report.witness.browserImagePngBase64, 'base64'));
    report.browserImagePng = png; delete report.witness.browserImagePngBase64;
  }
  report.phase = report.witness?.phase === 'done' ? 'done' : `witness-${report.witness?.phase ?? 'unknown'}`;
  await finish(report.phase === 'done' && report.witness.parityPass ? 0 : 1);
} catch (e) {
  report.error = String(e?.stack || e);
  await finish(1);
}
