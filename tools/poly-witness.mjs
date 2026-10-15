#!/usr/bin/env node
// Drives one Workbench experiment page in an independent browser through a list
// of steps and keeps what it saw. Polygon slices use it for census, cut, separate,
// undo and reopen evidence. It always writes report.json, also on failure.
//   KAMINOS_CHROME=<independent chrome> node tools/poly-witness.mjs --url <page> --out <dir> --steps <steps.json> [--experiment <id>]
// Steps: {"invoke":["name",...args]} | {"capture":"name"} | {"read":"name"} | {"evaluate":"expression","name":"label"}
// A read, invoke or evaluate step may carry "expect": a subset its result must match exactly.
// Real input goes through the browser's input pipeline: {"key":"Tab"|{code,key,modifiers}},
// {"click":{x,y}|{at:"name"},"modifiers"?}, {"drag":{from:[x,y]|"name",to:[x,y]|"name",button?}}.
// An evaluate step with "name" keeps its result for later click or drag coordinates.
// Modifiers: Alt 1, Ctrl 2, Meta 4, Shift 8. Pages that are not experiments pass --ready <expression>.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { fluidBrowserLaunch } from '../finger-fluid-browser-launch.mjs';

export const MIN_SAMPLED_COLOURS = 24;

// Distinct colours on a sparse grid of an 8-bit RGB(A) PNG. A flat frame is not evidence.
export function pngStats(png) {
  const { width, height, channels, pixels } = decodePng(png), stride = width * channels;
  const colours = new Set(), step = Math.max(1, Math.floor(Math.min(width, height) / 64));
  for (let y = 0; y < height; y += step) for (let x = 0; x < width; x += step) { const i = y * stride + x * channels; colours.add((pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2]); }
  return { width, height, sampledDistinctColours: colours.size };
}

export function decodePng(png) {
  if (png.length < 8 || png.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let offset = 8, width = 0, height = 0, depth = 0, type = 0; const idat = [];
  while (offset + 8 <= png.length) {
    const length = png.readUInt32BE(offset), kind = png.toString('latin1', offset + 4, offset + 8), data = png.subarray(offset + 8, offset + 8 + length);
    if (kind === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8]; type = data[9]; }
    if (kind === 'IDAT') idat.push(data);
    offset += 12 + length;
  }
  if (depth !== 8 || (type !== 2 && type !== 6)) throw new Error(`unsupported PNG layout depth ${depth} type ${type}`);
  const channels = type === 6 ? 4 : 3, stride = width * channels, raw = inflateSync(Buffer.concat(idat)), pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)], row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = pixels.subarray(y * stride, (y + 1) * stride), up = y ? pixels.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[x - channels] : 0, b = up ? up[x] : 0, c = up && x >= channels ? up[x - channels] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      if (filter > 4) throw new Error(`PNG row ${y} has unknown filter ${filter}`);
      out[x] = (row[x] + [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][filter]) & 255;
    }
  }
  return { width, height, channels, pixels };
}

// The page re-serializes its experiment address; compare meaning, never bytes or defaults.
export function addressMismatch(requested, effective) {
  const a = new URL(requested), b = new URL(effective);
  if (a.origin !== b.origin || a.pathname !== b.pathname) return `page ${b.origin}${b.pathname} is not the requested ${a.origin}${a.pathname}`;
  for (const [key, value] of a.searchParams) {
    if (!b.searchParams.has(key)) return `effective address dropped ${key}`;
    const actual = b.searchParams.get(key);
    if (key === 'experiment_inputs') { if (JSON.stringify(JSON.parse(actual)) !== JSON.stringify(JSON.parse(value))) return `experiment inputs changed to ${actual}`; }
    else if (actual !== value) return `${key} changed from ${value} to ${actual}`;
  }
  return null;
}

// Exact by default. {"$near": x, "tolerance": t} opts one value into an absolute tolerance
// (default 1e-9), for camera and transform values that round-trip through floats.
export function subsetMismatch(actual, expected, path = '') {
  if (expected && typeof expected === 'object' && '$near' in expected) {
    const tolerance = expected.tolerance ?? 1e-9;
    return typeof actual === 'number' && Math.abs(actual - expected.$near) <= tolerance ? null : `${path || 'result'}: expected ${expected.$near} within ${tolerance}, got ${JSON.stringify(actual)}`;
  }
  if (expected === null || typeof expected !== 'object') return Object.is(actual, expected) ? null : `${path || 'result'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
  for (const [key, value] of Object.entries(expected)) { const miss = subsetMismatch(actual?.[key], value, `${path}${path ? '.' : ''}${key}`); if (miss) return miss; }
  return null;
}

function parseArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index], value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) throw new Error(`invalid argument sequence near ${key ?? '<end>'}`);
    args.set(key, value);
  }
  for (const required of ['--url', '--out', '--steps']) if (!args.has(required)) throw new Error(`${required} is required`);
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const out = resolve(args.get('--out')), requestedUrl = args.get('--url');
  const ready = args.get('--ready') ?? null, experiment = ready ? null : args.get('--experiment') ?? new URL(requestedUrl).searchParams.get('experiment');
  const port = Number(args.get('--debug-port') ?? 9400 + Math.floor(Math.random() * 400));
  const report = { schema: 'kaminos.poly-witness.v0', requestedUrl, experiment, startedAt: new Date().toISOString(), phase: 'reading-steps',
    browser: null, effectiveUrl: null, adapter: null, steps: [], captures: [], pageErrors: [], consoleErrors: [], failure: null };
  mkdirSync(out, { recursive: true });
  const userDataDir = mkdtempSync(join(tmpdir(), 'kaminos-poly-witness-'));
  let chrome = null, ws = null;
  const cdp = async path => { const r = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(3000) }); if (!r.ok) throw new Error(`CDP ${path} ${r.status}`); return r.json(); };
  const request = (method, params = {}, timeoutMs = 30000) => new Promise((resolveRequest, rejectRequest) => {
    const id = ws.nextId = (ws.nextId ?? 0) + 1;
    const timer = setTimeout(() => { ws.removeEventListener('message', onMessage); rejectRequest(new Error(`${method}: CDP request timed out`)); }, timeoutMs);
    const onMessage = event => {
      const message = JSON.parse(String(event.data));
      if (message.id !== id) return;
      clearTimeout(timer); ws.removeEventListener('message', onMessage);
      message.error ? rejectRequest(new Error(`${method}: ${message.error.message}`)) : resolveRequest(message.result);
    };
    ws.addEventListener('message', onMessage); ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression, timeoutMs) => {
    const result = await request('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, timeoutMs);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  try {
    const steps = JSON.parse(readFileSync(resolve(args.get('--steps')), 'utf8'));
    report.phase = 'launching-browser';
    const launch = fluidBrowserLaunch({ executable: process.env.KAMINOS_CHROME, debugPort: port, userDataDir, width: 1468, height: 960 });
    chrome = spawn(launch.executable, [...launch.args, '--headless=new', '--enable-unsafe-webgpu', '--disable-gpu-sandbox'], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = ''; chrome.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
    for (let i = 0; i < 80 && !report.browser; i++) { try { report.browser = { executable: launch.executable, ...(await cdp('/json/version')) }; } catch { await delay(125); } }
    if (!report.browser) throw new Error(`DevTools did not open; stderr tail: ${stderr}`);

    report.phase = 'opening-page';
    const blank = (await cdp('/json/list')).find(t => t.type === 'page');
    ws = new WebSocket(blank.webSocketDebuggerUrl);
    await new Promise((ok, fail) => { ws.addEventListener('open', ok, { once: true }); ws.addEventListener('error', () => fail(new Error('WebSocket open failed')), { once: true }); });
    ws.addEventListener('message', event => {
      const message = JSON.parse(String(event.data));
      if (message.method === 'Runtime.exceptionThrown') report.pageErrors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
      if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') report.consoleErrors.push(message.params.args.map(a => a.value ?? a.description).join(' ').slice(0, 2000));
    });
    await request('Runtime.enable'); await request('Page.enable');
    await request('Page.navigate', { url: requestedUrl }, 60000);

    report.phase = ready ? 'waiting-for-ready' : 'waiting-for-experiment';
    let state = null;
    for (let i = 0; i < 600; i++) {
      state = ready ? await evaluate(`(()=>{try{return !!(${ready})}catch{return false}})()`).catch(() => false)
        : await evaluate(`(()=>{const e=window.kaminosWorkbenchExperiments;if(!e)return null;try{return e.state();}catch(error){return {error:String(error)}}})()`).catch(() => null);
      if (ready ? state === true : state?.id === experiment && state.status !== 'opening') break;
      await delay(250);
    }
    report.effectiveUrl = await evaluate('location.href');
    report.experimentState = ready ? { ready, met: state === true } : state;
    const addressMiss = addressMismatch(requestedUrl, report.effectiveUrl);
    if (addressMiss) throw new Error(`effective address differs from the requested one: ${addressMiss}`);
    if (ready ? state !== true : state?.id !== experiment) throw new Error(ready ? `page never became ready: ${ready}` : `experiment ${experiment} did not open; last state ${JSON.stringify(state)}`);
    report.servedSource = await evaluate(`fetch('/api/workbench-experiments',{cache:'no-store'}).then(r=>r.ok?r.json():null).then(j=>j?.source??null).catch(()=>null)`);
    report.adapter = await evaluate(`(async()=>{const a=await navigator.gpu?.requestAdapter();return a?{vendor:a.info?.vendor,architecture:a.info?.architecture,description:a.info?.description}:null})()`);
    if (!report.adapter) throw new Error('page has no WebGPU adapter');

    const named = new Map();
    const point = at => { const p = typeof at === 'string' ? named.get(at) : Array.isArray(at) ? { x: at[0], y: at[1] } : at; if (!Number.isFinite(p?.x) || !Number.isFinite(p?.y)) throw new Error(`no screen point for ${JSON.stringify(at)}`); return p; };
    const mouse = (type, p, button, modifiers = 0, clickCount = 1) => request('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button, buttons: type === 'mouseReleased' ? 0 : { left: 1, middle: 4, right: 2 }[button], clickCount, modifiers });
    // Headless Chrome hides the page on some keys (Escape, Delete), which stops animation frames.
    // Show it again before waiting on frames, and fail loud if frames still do not come.
    const settle = async () => {
      if (await evaluate('document.visibilityState') !== 'visible') { await request('Page.bringToFront'); report.reshown = (report.reshown ?? 0) + 1; }
      const outcome = await evaluate(`Promise.race([new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(()=>r('settled'),120)))),new Promise(r=>setTimeout(()=>r('no-frames:'+document.visibilityState),5000))])`);
      if (outcome !== 'settled') throw new Error(`page stopped drawing frames (${outcome})`);
    };
    for (const [index, step] of steps.entries()) {
      report.phase = `step-${index}`;
      const record = { index, step };
      report.steps.push(record);
      if (step.key) {
        const k = typeof step.key === 'string' ? { key: step.key, code: step.key } : step.key, vk = { Tab: 9, Escape: 27, Delete: 46, Backspace: 8 }[k.key] ?? (k.code?.match(/^(Key|Digit)(.)$/)?.[2].toUpperCase().charCodeAt(0) ?? 0);
        for (const type of ['rawKeyDown', 'keyUp']) await request('Input.dispatchKeyEvent', { type, key: k.key, code: k.code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: k.modifiers ?? 0 });
        if (step.settle !== false) await settle(); record.result = { delivered: true };
      } else if (step.click) {
        const p = point(step.click.at ?? step.click);
        await mouse('mouseMoved', p, 'none', step.click.modifiers); await mouse('mousePressed', p, 'left', step.click.modifiers); await mouse('mouseReleased', p, 'left', step.click.modifiers);
        await settle(); record.result = { clicked: p };
      } else if (step.drag) {
        const from = point(step.drag.from), to = point(step.drag.to), button = step.drag.button ?? 'left', mods = step.drag.modifiers ?? 0;
        await mouse('mouseMoved', from, 'none', mods); await mouse('mousePressed', from, button, mods);
        for (let i = 1; i <= 8; i++) await mouse('mouseMoved', { x: from.x + (to.x - from.x) * i / 8, y: from.y + (to.y - from.y) * i / 8 }, button, mods);
        await mouse('mouseReleased', to, button, mods); await settle(); record.result = { dragged: { from, to, button } };
      } else if (step.invoke) record.result = await evaluate(`window.kaminosWorkbenchExperiments.invoke(...${JSON.stringify(step.invoke)})`, 120000);
      else if (step.read) record.result = await evaluate('window.kaminosWorkbenchExperiments.read()', 120000);
      else if (step.evaluate) { record.result = await evaluate(step.evaluate, 120000); if (step.name) named.set(step.name, record.result); }
      else if (step.capture) {
        await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(r,250))))');
        const png = Buffer.from((await request('Page.captureScreenshot', { format: 'png', fromSurface: true })).data, 'base64');
        const path = join(out, `${step.capture}.png`); writeFileSync(path, png);
        const capture = { name: step.capture, path, bytes: png.length, sha256: createHash('sha256').update(png).digest('hex'), ...pngStats(png) };
        report.captures.push(capture); record.result = capture;
        if (capture.sampledDistinctColours < MIN_SAMPLED_COLOURS) throw new Error(`capture ${step.capture} is flat (${capture.sampledDistinctColours} sampled colours)`);
      } else throw new Error(`unknown witness step ${JSON.stringify(step)}`);
      if (step.expect) { const miss = subsetMismatch(record.result, step.expect); if (miss) throw new Error(`step ${index}: ${miss}`); }
    }
    if (report.pageErrors.length) throw new Error(`page reported ${report.pageErrors.length} uncaught errors`);
    report.phase = 'complete';
  } catch (error) {
    report.failure = { phase: report.phase, message: error.message };
  } finally {
    report.finishedAt = new Date().toISOString();
    writeFileSync(join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    try { ws?.close(); } catch {}
    if (chrome && chrome.exitCode === null) { chrome.kill('SIGTERM'); await Promise.race([new Promise(r => chrome.once('exit', r)), delay(5000)]); if (chrome.exitCode === null) chrome.kill('SIGKILL'); }
    rmSync(userDataDir, { recursive: true, force: true });
  }
  console.log(JSON.stringify({ phase: report.phase, failure: report.failure, captures: report.captures.map(c => c.path), report: join(out, 'report.json') }));
  process.exitCode = report.failure ? 1 : 0;
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) await main();
