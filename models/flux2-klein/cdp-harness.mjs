// Shared harness for Klein browser runs: a static server over named roots (with
// HTTP range support), an owned Chrome for Testing over CDP, and evaluation helpers.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

// Effective source identity of the code a run actually executed.
export function sourceIdentity(dir) {
  try {
    const rev = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const dirty = execFileSync('git', ['-C', dir, 'status', '--porcelain', '--', '.'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
    return { rev, dirtyFiles: dirty };
  } catch (e) { return { error: String(e) }; }
}

// cors: answer any origin and expose the range headers, as a cross-origin weight host would.
export async function startServer(roots, port = 0, { cors = false } = {}) {
  const corsHeaders = cors ? { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range, content-length' } : {};
  const prefixes = Object.keys(roots).sort((a, b) => b.length - a.length);
  const server = http.createServer((q, r) => {
    const url = decodeURIComponent(new URL(q.url, 'http://x').pathname);
    const prefix = prefixes.find(p => url.startsWith(p));
    if (!prefix) { r.writeHead(404); return r.end(); }
    const root = roots[prefix]; const file = path.join(root, url.slice(prefix.length));
    if (!file.startsWith(root)) { r.writeHead(403); return r.end(); }
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) { r.writeHead(404); return r.end(); }
      const type = /\.m?js$/.test(file) ? 'text/javascript' : file.endsWith('.json') ? 'application/json' : file.endsWith('.html') ? 'text/html' : 'application/octet-stream';
      const range = /^bytes=(\d+)-(\d+)$/.exec(q.headers.range || '');
      if (range) {
        const start = Number(range[1]), end = Math.min(Number(range[2]), st.size - 1);
        r.writeHead(206, { ...corsHeaders, 'content-type': type, 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${st.size}`, 'cache-control': 'no-store' });
        return fs.createReadStream(file, { start, end }).pipe(r);
      }
      r.writeHead(200, { ...corsHeaders, 'content-type': type, 'content-length': st.size, 'cache-control': 'no-store' });
      fs.createReadStream(file).pipe(r);
    });
  });
  await new Promise((res, rej) => { server.once('error', rej); server.listen(port, '127.0.0.1', res); });
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

export async function launchChrome(chrome, extraFlags = [], report = {}) {
  const profile = await fsp.mkdtemp(path.join(os.tmpdir(), 'klein-cdp-'));
  const flags = ['--headless=new', '--remote-debugging-port=0', '--use-mock-keychain', '--password-store=basic', '--no-first-run', ...extraFlags];
  const child = spawn(chrome, [...flags, `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  report.chromeFlags = flags; report.ownedBrowserPid = child.pid;
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
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pending = new Map(); const consoleLines = []; report.console = consoleLines;
  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    if (msg.method === 'Runtime.consoleAPICalled') consoleLines.push(msg.params.args.map(a => a.value ?? a.description).join(' '));
    if (msg.method === 'Runtime.exceptionThrown') consoleLines.push(`exception: ${msg.params.exceptionDetails?.exception?.description}`);
  };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable'); await send('Page.enable');
  const evaluate = async (expression, awaitPromise = true) => {
    const res = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
    if (res.result?.exceptionDetails) throw new Error(res.result.exceptionDetails.exception?.description ?? JSON.stringify(res.result.exceptionDetails));
    return res.result?.result?.value;
  };
  const navigate = async (url, readyExpr) => {
    await send('Page.navigate', { url });
    for (let i = 0; i < 200; i++) { if (await evaluate(readyExpr, false).catch(() => false)) return; await new Promise(r => setTimeout(r, 100)); }
    throw new Error(`page not ready: ${readyExpr}`);
  };
  const close = () => { try { ws.close(); } catch {} if (child.exitCode === null) child.kill('SIGTERM'); };
  return { send, evaluate, navigate, close, child };
}
