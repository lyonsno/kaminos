// Offline diagnosis: the serving adapter supplies the shader; observed x0 tensors
// replace model execution. This measures only the sparse guidance std kernel.
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { parseArgs } from 'node:util';
import { createTrellisSparseSamplerAdapter } from './sparse-sampler.js';
import { admitFrozenStdResult } from './frozen-std-witness-checks.mjs';

// Recover the output destination before strict parsing so malformed arguments
// cannot leave an earlier successful observation at this invocation's path.
const rawArgs = process.argv.slice(2);
const outputArg = rawArgs.flatMap((arg, i) => arg.startsWith('--output=') ? [arg.slice(9)]
  : arg === '--output' && rawArgs[i + 1] && !rawArgs[i + 1].startsWith('--') ? [rawArgs[i + 1]] : []).at(-1);
if (!outputArg) throw Error('--output required');
const output = path.resolve(outputArg), report = { status: 'failed', phase: 'admission', rows: [], command: process.argv };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const persist = async () => { await fs.mkdir(output, { recursive: true }); await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n'); };
let server, child, cdp;
async function connect(url) {
  const socket = new WebSocket(url), pending = new Map(), listeners = new Map(); let id = 0;
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(Error('CDP connection failed')), { once: true });
    socket.addEventListener('close', () => reject(Error('CDP closed before open')), { once: true });
  });
  socket.addEventListener('message', event => {
    const r = JSON.parse(event.data), p = pending.get(r.id);
    if (!r.id) { const key = `${r.sessionId}:${r.method}`; listeners.get(key)?.resolve(r.params); listeners.delete(key); return; }
    if (!p) return;
    pending.delete(r.id); r.error ? p.reject(Error(JSON.stringify(r.error))) : p.resolve(r.result);
  });
  const fail = () => { for (const p of [...pending.values(), ...listeners.values()]) p.reject(Error('CDP closed')); pending.clear(); listeners.clear(); };
  socket.addEventListener('close', fail); socket.addEventListener('error', fail);
  return { close: () => socket.close(), event(method, sessionId) { return new Promise((resolve, reject) => listeners.set(`${sessionId}:${method}`, { resolve, reject })); }, call(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => { const next = ++id; pending.set(next, { resolve, reject });
      socket.send(JSON.stringify({ id: next, method, params, ...(sessionId ? { sessionId } : {}) })); });
  } };
}
try {
  await persist();
  const { values: args } = parseArgs({ options: Object.fromEntries(
    ['repo-root', 'fixture', 'output', 'chrome', 'expected-commit'].map(k => [k, { type: 'string' }])) });
  for (const name of ['repo-root', 'fixture', 'chrome', 'expected-commit']) if (!args[name]) throw Error(`--${name} required`);
  const root = await fs.realpath(args['repo-root']), fixture = await fs.realpath(args.fixture);
  if (await fs.realpath(new URL('../..', import.meta.url)) !== root) throw Error('invoked source root mismatch');
  report.repoRoot = root; report.commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  if (report.commit !== args['expected-commit']) throw Error('source commit changed');
  report.sourceSha256 = {};
  for (const file of ['models/trellis2/sparse-sampler.js', 'models/trellis2/run-frozen-std-witness.mjs', 'models/trellis2/frozen-std-witness-checks.mjs']) {
    const bytes = await fs.readFile(path.join(root, file)); report.sourceSha256[file] = sha(bytes);
    if (sha(execFileSync('git', ['show', `${report.commit}:${file}`], { cwd: root })) !== sha(bytes)) throw Error(`uncommitted source: ${file}`);
  }
  const manifestBytes = await fs.readFile(path.join(fixture, 'manifest.json')), manifest = JSON.parse(manifestBytes);
  report.fixtureSha256 = sha(manifestBytes); report.fixture = manifest;
  if (manifest.kind !== 'observed-kiln-cfg-x0' || !Number.isSafeInteger(manifest.tokenRows) || manifest.tokenRows < 1 || manifest.cases?.length !== 4 || new Set(manifest.cases.map(c => c.id)).size !== 4)
    throw Error('four distinct retained kiln cases required');
  const files = new Map();
  for (const c of manifest.cases) for (const d of [c.positive, c.guided]) {
    if (!/^[\w.-]+$/.test(d.file)) throw Error('unsafe fixture path');
    const bytes = await fs.readFile(path.join(fixture, d.file));
    if (bytes.length !== manifest.tokenRows * 32 * 4 || sha(bytes) !== d.sha256) throw Error('changed/partial frozen tensor');
    files.set('/' + d.file, bytes);
  }
  // Capture the unmodified serving adapter's kernel definition; no fake runtime
  // result is used as numerical evidence. The shader executes below on WebGPU.
  let definition;
  const runtime = { device: { limits: { maxComputeWorkgroupsPerDimension: 65535 } },
    createTensor(s) { return { ...s, buffer: { destroy() {} }, byteLength: s.shape.reduce((a, b) => a * b, 4) }; },
    defineComputeKernel(s) { if (s.name === 'trellis.sampler-guidance-std') definition = s; return s; }, runKernel() { throw Error('capture runtime cannot execute'); } };
  const tensor = () => runtime.createTensor({ shape: [manifest.tokenRows, 32], dtype: 'f32', usage: 128 });
  const route = { runtime, routeId: 'frozen-observed-std' }, flow = { runtime, routeId: route.routeId,
    plan: { block: { contextRows: 1, contextChannels: 1 } }, inputs: { sample: tensor() }, outputs: { prediction: tensor() } };
  const sampler = createTrellisSparseSamplerAdapter({ route, flow, config: { tokenRows: manifest.tokenRows }, conditioning: new Float32Array(1) });
  sampler.dispose(); if (!definition) throw Error('production std shader absent');
  report.shaderSha256 = sha(definition.code); await fs.writeFile(path.join(output, 'effective-shader.wgsl'), definition.code);
  report.chrome = await fs.realpath(args.chrome);
  if (!/Google Chrome for Testing|chromium|headless_shell/i.test(report.chrome) || report.chrome.includes('/Applications/Google Chrome.app/')) throw Error('independent browser required');
  server = http.createServer((req, res) => {
    if (req.url === '/') return res.end('<!doctype html><title>Frozen kiln arithmetic</title>');
    if (files.has(req.url)) return res.end(files.get(req.url));
    res.writeHead(404).end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  report.requestedUrl = `http://127.0.0.1:${server.address().port}/`;
  report.profile = await fs.mkdtemp(path.join(output, 'chrome-profile-'));
  report.phase = 'browser-launch'; await persist();
  child = spawn(report.chrome, ['--headless=new', '--enable-unsafe-webgpu', '--remote-debugging-port=0', '--use-mock-keychain', '--password-store=basic', '--no-first-run', `--user-data-dir=${report.profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  report.ownedBrowserPid = child.pid;
  const ws = await new Promise((resolve, reject) => {
    let stderr = ''; child.stderr.on('data', b => { stderr += b; report.browserStderr = stderr; const m = stderr.match(/DevTools listening on (ws:\/\/\S+)/); if (m) resolve(m[1]); });
    child.once('error', reject); child.once('exit', (code, signal) => reject(Error(`browser exited ${code}/${signal}`)));
  });
  cdp = await connect(ws); report.browserVersion = await cdp.call('Browser.getVersion');
  const { targetId } = await cdp.call('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.call('Target.attachToTarget', { targetId, flatten: true });
  await cdp.call('Page.enable', {}, sessionId);
  const loaded = cdp.event('Page.loadEventFired', sessionId);
  await cdp.call('Page.navigate', { url: report.requestedUrl }, sessionId); await loaded;
  report.phase = 'native-std'; await persist();
  const evaluate = async expression => {
    const r = await cdp.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value;
  };
  report.effectiveUrl = await evaluate('location.href'); if (report.effectiveUrl !== report.requestedUrl) throw Error('wrong page route');
  const backend = await evaluate(`(async()=>{
    const adapter=await navigator.gpu?.requestAdapter(); if(!adapter)throw Error('WebGPU unavailable');
    const b={vendor:adapter.info.vendor,architecture:adapter.info.architecture,description:adapter.info.description,isFallbackAdapter:adapter.info.isFallbackAdapter??adapter.isFallbackAdapter};
    if(b.vendor!=='apple'||!b.architecture.includes('metal')||b.isFallbackAdapter!==false)throw Error('native Apple Metal required:'+JSON.stringify(b));
    window.stdDevice=await adapter.requestDevice();window.stdErrors=[];stdDevice.addEventListener('uncapturederror',e=>stdErrors.push(e.error.message));
    const shader=stdDevice.createShaderModule({code:${JSON.stringify(definition.code)}});const info=await shader.getCompilationInfo();if(info.messages.some(m=>m.type==='error'))throw Error(JSON.stringify(info.messages));
    window.stdPipeline=await stdDevice.createComputePipelineAsync({layout:'auto',compute:{module:shader,entryPoint:'main'}});return b;
  })()`); report.backend = backend; await persist();
  for (let trial = 0; trial < 3; trial++) for (const c of manifest.cases) {
    const row = await evaluate(`(async()=>{
      const buffers=[];try{const tensors=[];
        for(const descriptor of ${JSON.stringify([c.positive, c.guided])}){
          const response=await fetch('/'+descriptor.file,{cache:'no-store'});if(!response.ok)throw Error('missing tensor');const data=await response.arrayBuffer();
          const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),x=>x.toString(16).padStart(2,'0')).join('');if(hash!==descriptor.sha256)throw Error('served tensor changed');
          const b=stdDevice.createBuffer({size:data.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});buffers.push(b);stdDevice.queue.writeBuffer(b,0,data);tensors.push(b);
        }
        const out=stdDevice.createBuffer({size:8,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST});buffers.push(out);stdDevice.queue.writeBuffer(out,0,new Uint32Array([0x7fc00000,0x7fc00000]));
        const read=stdDevice.createBuffer({size:8,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});buffers.push(read);
        stdDevice.pushErrorScope('validation');const encoder=stdDevice.createCommandEncoder(),pass=encoder.beginComputePass();pass.setPipeline(stdPipeline);
        pass.setBindGroup(0,stdDevice.createBindGroup({layout:stdPipeline.getBindGroupLayout(0),entries:[...tensors,out].map((buffer,binding)=>({binding,resource:{buffer}}))}));
        pass.dispatchWorkgroups(2);pass.end();encoder.copyBufferToBuffer(out,0,read,0,8);stdDevice.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);
        const raw=read.getMappedRange().slice(0),actual=Array.from(new Float32Array(raw)),bits=Array.from(new Uint32Array(raw));read.unmap();const error=await stdDevice.popErrorScope();if(error||stdErrors.length)throw Error(error?.message||stdErrors.join(';'));
        return {id:${JSON.stringify(c.id)},trial:${trial},actual,bits,expected:${JSON.stringify(c.expected)}};
      }finally{for(const b of buffers)b.destroy();}
    })()`);
    report.rows.push(row); await persist();
  }
  report.comparison = admitFrozenStdResult(report, { shaderSha256: report.shaderSha256, caseIds: manifest.cases.map(c => c.id), repeats: 3 });
  report.status = 'measured'; report.phase = 'complete';
  report.claimLimit = 'Observed x0 tensors through production sparse std shader only; no model, full sampler scheduling, or whole-image parity claim.';
} catch (error) { report.error = { message: error.message, stack: error.stack }; process.exitCode = 1; }
finally {
  await persist(); cdp?.close();
  if (child && child.exitCode === null && child.signalCode === null) { const ended = once(child, 'exit'); child.kill('SIGTERM'); await ended; }
  if (child) report.browserExit = { code: child.exitCode, signal: child.signalCode };
  if (server) await new Promise(resolve => server.close(resolve));
  await persist(); console.log(JSON.stringify({ status: report.status, phase: report.phase, comparison: report.comparison, error: report.error?.message, output }));
}
