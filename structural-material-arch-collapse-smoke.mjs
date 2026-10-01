import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const [urlInput, output, executableInput] = process.argv.slice(2);
if (!urlInput || !output || !executableInput) throw new Error('usage: node structural-material-arch-collapse-smoke.mjs URL OUTPUT.json INDEPENDENT_CHROME');
const root = path.dirname(fileURLToPath(import.meta.url)), hash = bytes => createHash('sha256').update(bytes).digest('hex');
const report = { status: 'running', phase: 'preflight', requestedUrl: urlInput, effectiveUrl: null,
  root, command: process.argv, sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  browser: {}, sources: {}, inputs: [], captures: {}, checks: [], errors: [], lastTrustworthyEvidence: 'invocation only' };
fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
const save = () => fs.writeFileSync(output, JSON.stringify(report, null, 2));
let child, socket, profile, nextId = 0, stderr = '';
const pending = new Map();
function check(name, passed, observed) { report.checks.push({ name, passed, observed }); save(); if (!passed) throw new Error(`predicate failed: ${name}`); }
function send(method, params = {}) { return new Promise((resolve, reject) => { const id = ++nextId; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); }); }
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
const witness = () => evaluate('window.__archCollapse.witness()');
async function input(params) { report.inputs.push({ method: 'Input.dispatchMouseEvent', params }); save(); await send('Input.dispatchMouseEvent', params); }
async function act(expression) { report.inputs.push({ method: 'Runtime.evaluate', expression }); save(); return evaluate(expression); }
async function capture(name) {
  const state = await witness();
  const posesMatch = state.rendererPoses.every(pose => pose.position.every((value, axis) => Math.abs(value - state.state.bodies[pose.index].position[['x', 'y', 'z'][axis]]) < 1e-10));
  check(`${name}: renderer follows physical positions`, posesMatch, state.state.step);
  const frame = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const bytes = Buffer.from(frame.data, 'base64');
  check(`${name}: nonempty PNG`, bytes.length > 4096 && bytes.readUInt32BE(0) === 0x89504e47, bytes.length);
  const filename = `${path.basename(output, '.json')}-${name}.png`, target = path.join(path.dirname(output), filename);
  fs.writeFileSync(target, bytes); report.captures[name] = { path: target, sha256: hash(bytes), state };
  report.lastTrustworthyEvidence = `${name} at step ${state.state.step} from ${state.effectiveUrl}`; save(); return state;
}
save();
try {
  const url = new URL(urlInput);
  check('exact local collapse route', ['127.0.0.1', 'localhost'].includes(url.hostname) && url.pathname === '/structural-material-arch-collapse.html' && url.searchParams.get('smoke') === '1', url.href);
  const executable = fs.realpathSync(executableInput);
  check('independent headless executable', !executable.includes('/Google Chrome.app/') && /chrome-headless-shell$|\/Chromium$|Google Chrome for Testing$/.test(executable), executable);
  report.browser.executable = executable; report.browser.version = execFileSync(executable, ['--version'], { encoding: 'utf8' }).trim();
  for (const file of ['structural-material-arch-collapse.html', 'structural-material-arch-collapse-view.js', 'structural-material-arch-collapse.js', 'node_modules/cannon-es/dist/cannon-es.js']) {
    const response = await fetch(new URL(file, url));
    check(`${file}: served source identity`, response.ok && hash(Buffer.from(await response.arrayBuffer())) === hash(fs.readFileSync(path.join(root, file))), response.status);
    report.sources[file] = hash(fs.readFileSync(path.join(root, file)));
  }
  report.phase = 'launch'; save(); profile = fs.mkdtempSync(path.join(os.tmpdir(), 'kaminos-collapse-'));
  child = spawn(executable, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'pipe', 'pipe'] });
  child.stderr.setEncoding('utf8').on('data', value => { stderr += value; });
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  const deadline = Date.now() + 30000;
  while (!fs.existsSync(path.join(profile, 'DevToolsActivePort'))) {
    if (child.exitCode !== null || Date.now() > deadline) throw new Error(`browser endpoint unavailable: ${stderr}`);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  const port = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0];
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const target = targets.find(item => item.type === 'page'); report.browser.target = target;
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') { report.errors.push(message.params.exceptionDetails); save(); }
    if (message.id) { const item = pending.get(message.id); if (!item) return; pending.delete(message.id); message.error ? item.reject(new Error(JSON.stringify(message.error))) : item.resolve(message.result); }
  });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: url.href }); report.phase = 'load'; save();
  const loadDeadline = Date.now() + 30000;
  while (!await evaluate('Boolean(window.__archCollapse)')) {
    if (Date.now() > loadDeadline) throw new Error(await evaluate('document.body.innerText'));
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  await act('window.__archCollapse.advance(120)');
  const standing = await capture('standing'); report.effectiveUrl = standing.effectiveUrl;
  check('CPU physics route and intact control', standing.route.endsWith('.cannon.v0') && standing.state.backend === 'cannon-es-cpu' && standing.state.broken === 0, { route: standing.route, broken: standing.state.broken });
  const pick = standing.pickTargets.find(item => item.row === 1);
  await input({ type: 'mousePressed', x: pick.screen.x, y: pick.screen.y, button: 'left', buttons: 1, clickCount: 1 });
  const selected = await witness(); check('pointer hits the advertised front body', selected.state.hand?.index === pick.index && selected.state.hand.layers.join(',') === '2', { hand: selected.state.hand, lastPick: selected.lastPick });
  await input({ type: 'mouseMoved', x: pick.screen.x - 40, y: pick.screen.y - 10, button: 'left', buttons: 1 });
  await act('window.__archCollapse.advance(10)'); await capture('pointer-drag');
  await input({ type: 'mouseReleased', x: pick.screen.x - 40, y: pick.screen.y - 10, button: 'left', buttons: 0, clickCount: 1 });
  const released = await witness(); check('release clears hand, not damage', released.state.hand === null, released.state.broken);
  check('object interaction preserves camera', JSON.stringify(standing.camera) === JSON.stringify(released.camera), released.camera);
  await act('window.__archCollapse.reset();window.__archCollapse.advance(120)');
  let state = await witness(); const body = state.state.bodies.find(item => item.row === 1 && item.layer === 2 && !item.pinned);
  report.phase = 'injury'; save();
  for (let i = 0; i < 60; i++) await act(`window.__archCollapse.setHand(${body.index},${JSON.stringify({ x: body.position.x - 1.5 * (i + 1) / 60, y: body.position.y, z: body.position.z + 0.5 * (i + 1) / 60 })});window.__archCollapse.advance(1)`);
  const injury = await capture('injury');
  await act('window.__archCollapse.release()');
  // The recorded API load has no pointer grab, so release must also clear the engine hand.
  await act('window.__archCollapse.advance(60)'); await capture('fall-1s');
  await act('window.__archCollapse.advance(120)'); await capture('fall-3s');
  await act('window.__archCollapse.advance(300)'); const rest = await capture('rest-8s');
  check('gravity propagates new fractures after release', rest.state.events.some(event => event.kind === 'crack' && !event.handActive && event.step > injury.state.step), { injury: injury.state.broken, final: rest.state.broken });
  check('crown falls beyond the grabbed chip', rest.state.bodies.some(item => item.row >= 8 && item.rest.y - item.position.y > 1), Math.max(...rest.state.bodies.filter(item => item.row >= 8).map(item => item.rest.y - item.position.y)));
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await capture('mobile-rest');
  check('mobile content fits', await evaluate('document.documentElement.scrollWidth <= innerWidth'), await evaluate('({width:innerWidth,documentWidth:document.documentElement.scrollWidth})'));
  check('no browser exceptions', report.errors.length === 0, report.errors);
  report.status = 'passed'; report.phase = 'complete';
} catch (error) { report.status = 'failed'; report.error = { message: error.message, stack: error.stack }; process.exitCode = 1; }
finally {
  if (socket?.readyState === WebSocket.OPEN) socket.close();
  if (child && child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); await new Promise(resolve => child.once('exit', resolve)); }
  report.browser.exit = child ? { code: child.exitCode, signal: child.signalCode } : null;
  if (profile) fs.rmSync(profile, { recursive: true, force: true });
  report.browser.stderr = stderr; report.finished = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, phase: report.phase, error: report.error, output }));
}
