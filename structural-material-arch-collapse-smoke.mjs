import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { inspectArchCollapseState } from './structural-material-arch-collapse-evidence.mjs';

const [urlInput, output, executableInput] = process.argv.slice(2);
if (!urlInput || !output || !executableInput) throw new Error('usage: node structural-material-arch-collapse-smoke.mjs URL OUTPUT.json INDEPENDENT_CHROME');
const root = path.dirname(fileURLToPath(import.meta.url)), hash = bytes => createHash('sha256').update(bytes).digest('hex');
const report = { status: 'running', phase: 'preflight', requestedUrl: urlInput, effectiveUrl: null,
  root, command: process.argv, sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  browser: {}, sources: {}, inputs: [], captures: {}, checks: [], errors: [], lastTrustworthyEvidence: 'invocation only' };
report.harnessSha256 = hash(fs.readFileSync(fileURLToPath(import.meta.url)));
fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
const save = () => fs.writeFileSync(output, JSON.stringify(report, null, 2));
let child, socket, profile, nextId = 0, stderr = '';
const pending = new Map();
let expectedStrength = 80;
function check(name, passed, observed) { report.checks.push({ name, passed, observed }); save(); if (!passed) throw new Error(`predicate failed: ${name}`); }
function send(method, params = {}) { return new Promise((resolve, reject) => { const id = ++nextId; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); }); }
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
const witness = () => evaluate('window.__archCollapse.witness()');
async function input(params) { report.inputs.push({ method: 'Input.dispatchMouseEvent', params, observedAt: new Date().toISOString() }); save(); await send('Input.dispatchMouseEvent', params); }
async function act(expression) { report.inputs.push({ method: 'Runtime.evaluate', expression, observedAt: new Date().toISOString() }); save(); return evaluate(expression); }
async function wait(milliseconds) { report.inputs.push({ method: 'wall-clock-wait', milliseconds, observedAt: new Date().toISOString() }); save(); await new Promise(resolve => setTimeout(resolve, milliseconds)); }
async function capture(name) {
  const state = await witness();
  const integrity = inspectArchCollapseState(state.state, { layers: 3, strength: expectedStrength, timeStep: 1/60, gripRadius: 0.55 });
  check(`${name}: effective route, config and physical state`, integrity.errors.length === 0, integrity);
  check(`${name}: canvas contains lit geometry`, state.pixels.glError === 0 && state.pixels.fraction > 0.001, state.pixels);
  const posesMatch = state.rendererPoses.every(pose => pose.position.every((value, axis) => Math.abs(value - state.state.bodies[pose.index].position[['x', 'y', 'z'][axis]]) < 1e-10) &&
    pose.quaternion.every((value, axis) => Math.abs(value - state.state.bodies[pose.index].quaternion[['x','y','z','w'][axis]]) < 1e-10));
  check(`${name}: renderer follows physical positions`, posesMatch, state.state.step);
  const frame = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const bytes = Buffer.from(frame.data, 'base64');
  check(`${name}: nonempty PNG`, bytes.length > 4096 && bytes.readUInt32BE(0) === 0x89504e47, bytes.length);
  const filename = `${path.basename(output, '.json')}-${name}.png`, target = path.join(path.dirname(output), filename);
  check(`${name}: capture matches effective viewport`, bytes.readUInt32BE(16) === state.viewport.width && bytes.readUInt32BE(20) === state.viewport.height, state.viewport);
  fs.writeFileSync(target, bytes); report.captures[name] = { path: target, sha256: hash(bytes), state };
  report.lastTrustworthyEvidence = `${name} at step ${state.state.step} from ${state.effectiveUrl}`; save(); return state;
}
async function waitForLoad() {
  const loadDeadline = Date.now() + 30000;
  while (!await evaluate('Boolean(window.__archCollapse)')) {
    if (Date.now() > loadDeadline) throw new Error(await evaluate('document.body.innerText'));
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const loaded = await witness();
  if (loaded.phase !== 'interactive') throw new Error(`page startup ${loaded.phase}: ${loaded.failure?.message ?? 'no retained failure detail'}`);
}
async function pointerInjury(pick, delta = { x: -1.5, y: 0, z: 0.5 }) {
  await input({ type: 'mousePressed', x: pick.screen.x, y: pick.screen.y, button: 'left', buttons: 1, clickCount: 1 });
  const selected = await witness();
  check('surface pick has an actual finite patch', selected.state.hand?.index === pick.index && selected.state.hand.indices.length > 1, selected.state.hand);
  let screen = pick.screen;
  for (let i = 0; i < 60; i++) {
    const target = { x: pick.world.x + delta.x*(i+1)/60, y: pick.world.y + delta.y*(i+1)/60, z: pick.world.z + delta.z*(i+1)/60 };
    screen = await act(`window.__archCollapse.projectWorld(${JSON.stringify(target)})`);
    await input({ type: 'mouseMoved', x: screen.x, y: screen.y, button: 'left', buttons: 1 });
    await act('window.__archCollapse.advance(1)');
  }
  const held = await witness();
  await input({ type: 'mouseReleased', x: screen.x, y: screen.y, button: 'left', buttons: 0, clickCount: 1 });
  check('pointer release removes all grip constraints', (await witness()).state.hand === null, held.state.hand);
  return held;
}
save();
try {
  const url = new URL(urlInput);
  expectedStrength = Number(url.searchParams.get('strength') ?? 80);
  check('requested cohesion is positive and finite', Number.isFinite(expectedStrength) && expectedStrength > 0, expectedStrength);
  report.requestedConfig = { strength: expectedStrength, layers: 3, timeStep: 1/60, gripRadius: 0.55 };
  check('exact local collapse route', ['127.0.0.1', 'localhost'].includes(url.hostname) && url.pathname === '/structural-material-arch-collapse.html' && [null, '1'].includes(url.searchParams.get('smoke')), url.href);
  const controlledUrl = new URL(url); controlledUrl.searchParams.set('smoke', '1');
  report.controlledUrl = controlledUrl.href;
  const executable = fs.realpathSync(executableInput);
  check('independent headless executable', !executable.includes('/Google Chrome.app/') && /chrome-headless-shell$|\/Chromium$|Google Chrome for Testing$/.test(executable), executable);
  const fd = fs.openSync(executable, 'r'), magic = Buffer.alloc(4);
  try { fs.readSync(fd, magic, 0, 4, 0); } finally { fs.closeSync(fd); }
  check('native browser binary', ['cffaedfe','cafebabe','7f454c46'].includes(magic.toString('hex')), magic.toString('hex'));
  report.browser.executable = executable; report.browser.version = execFileSync(executable, ['--version'], { encoding: 'utf8' }).trim();
  for (const file of ['structural-material-arch-collapse.html', 'structural-material-arch-collapse-view.js', 'structural-material-arch-collapse.js', 'node_modules/cannon-es/dist/cannon-es.js', 'artifacts/structural-material-3d/stone-arch-source-pair-2026-09-24/arch-proxy-witness/intact-profile.json']) {
    const response = await fetch(new URL(file, url));
    check(`${file}: served source identity`, response.ok && hash(Buffer.from(await response.arrayBuffer())) === hash(fs.readFileSync(path.join(root, file))), response.status);
    report.sources[file] = hash(fs.readFileSync(path.join(root, file)));
  }
  report.phase = 'launch'; save(); profile = fs.mkdtempSync(path.join(os.tmpdir(), 'kaminos-collapse-'));
  child = spawn(executable, ['--headless=new', '--enable-automation', '--no-first-run', '--no-default-browser-check', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'pipe', 'pipe'] });
  child.stderr.setEncoding('utf8').on('data', value => { stderr += value; });
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  report.browser.pid = child.pid; report.browser.profile = profile; save();
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
  report.browser.runtimeVersion = await send('Browser.getVersion'); report.browser.runtimeCommand = await send('Browser.getBrowserCommandLine');
  check('runtime browser executable matches independent launch', fs.realpathSync(report.browser.runtimeCommand.arguments[0]) === executable, report.browser.runtimeCommand.arguments[0]);
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: controlledUrl.href }); report.phase = 'load'; save();
  await waitForLoad();
  await act('window.__archCollapse.advance(120)');
  const standing = await capture('standing'); report.effectiveUrl = standing.effectiveUrl;
  check('CPU physics route and intact control', standing.route.endsWith('.cannon.v0') && standing.state.backend === 'cannon-es-cpu' && standing.state.broken === 0, { route: standing.route, broken: standing.state.broken });
  report.phase = 'material-contact-ownership'; save();
  const anchor = standing.state.bodies.filter(body => body.pinned && body.layer === 2).sort((a,b) => b.position.x-a.position.x)[0];
  const anchorPoint = { ...anchor.position, z: anchor.position.z + standing.state.dimensions.dz * 0.49 };
  const anchorScreen = await act(`window.__archCollapse.projectWorld(${JSON.stringify(anchorPoint)})`);
  await input({ type: 'mousePressed', x: anchorScreen.x, y: anchorScreen.y, button: 'left', buttons: 1, clickCount: 1 });
  const anchorSelected = await witness();
  check('anchor test ray actually hits the intended material', anchorSelected.lastPick?.index === anchor.index && anchorSelected.state.hand === null, anchorSelected.lastPick);
  await input({ type: 'mouseMoved', x: anchorScreen.x + 40, y: anchorScreen.y + 15, button: 'left', buttons: 1 });
  await input({ type: 'mouseReleased', x: anchorScreen.x + 40, y: anchorScreen.y + 15, button: 'left', buttons: 0, clickCount: 1 });
  const anchorReleased = await capture('anchor-contact');
  check('material anchor hit does not orbit the camera', JSON.stringify(anchorReleased.camera) === JSON.stringify(standing.camera), { before: standing.camera, after: anchorReleased.camera });
  check('anchor contact retains support pose and connectivity', anchorReleased.state.broken === 0 && anchorReleased.state.bodies.filter(body => body.pinned).every(body => JSON.stringify(body.position) === JSON.stringify(standing.state.bodies[body.index].position)), anchorReleased.state.broken);
  check('anchor release clears material contact and leaves no hand', anchorSelected.contactPointer !== null && anchorReleased.contactPointer === null && anchorReleased.state.hand === null, { selected: anchorSelected.contactPointer, released: anchorReleased.contactPointer });
  const pick = standing.pickTargets.find(item => item.row === 1 && item.visible);
  await input({ type: 'mousePressed', x: pick.screen.x, y: pick.screen.y, button: 'left', buttons: 1, clickCount: 1 });
  const selected = await witness(); check('pointer hits the advertised front body', selected.state.hand?.index === pick.index && selected.state.hand.layers.join(',') === '2', { hand: selected.state.hand, lastPick: selected.lastPick });
  await input({ type: 'mouseMoved', x: pick.screen.x - 40, y: pick.screen.y - 10, button: 'left', buttons: 1 });
  await act('window.__archCollapse.advance(10)'); await capture('pointer-drag');
  await input({ type: 'mouseReleased', x: pick.screen.x - 40, y: pick.screen.y - 10, button: 'left', buttons: 0, clickCount: 1 });
  const released = await witness(); check('release clears hand, not damage', released.state.hand === null, released.state.broken);
  check('object interaction preserves camera', JSON.stringify(standing.camera) === JSON.stringify(released.camera), released.camera);
  await act('window.__archCollapse.reset();window.__archCollapse.advance(120)');
  let state = await witness(); const contact = state.pickTargets.find(item => item.row === 1 && item.visible);
  report.phase = 'injury'; save();
  const held = await pointerInjury(contact);
  check('controlled injury holds only the front depth layer', held.state.hand.layers.join(',') === '2', held.state.hand.layers);
  const injury = await capture('injury');
  await act('window.__archCollapse.advance(60)'); await capture('fall-1s');
  await act('window.__archCollapse.advance(120)'); await capture('fall-3s');
  await act('window.__archCollapse.advance(300)'); const rest = await capture('rest-8s');
  check('gravity propagates new fractures after release', rest.state.events.some(event => event.kind === 'crack' && !event.handActive && event.step > injury.state.step), { injury: injury.state.broken, final: rest.state.broken });
  check('crown falls beyond the grabbed chip', rest.state.bodies.some(item => item.row >= 8 && item.rest.y - item.position.y > 1), Math.max(...rest.state.bodies.filter(item => item.row >= 8).map(item => item.rest.y - item.position.y)));
  const floor = inspectArchCollapseState(rest.state);
  check('resting geometry meets floor within six percent of a cell', rest.state.floorY - floor.minimumY < Math.min(...Object.values(rest.state.dimensions))*0.06, rest.state.floorY - floor.minimumY);
  const second = rest.surfaceTargets.find(item => item.visible && item.row > 2 && rest.state.components[rest.state.bodies[item.index].component].count > 10);
  const oldDead = rest.state.bonds.filter(bond => !bond.alive).map(bond => bond.id);
  await pointerInjury(second, { x: 1.4, y: 0.5, z: 0.6 });
  await act('window.__archCollapse.advance(240)'); const repeated = await capture('iterative-injury');
  check('new injury fractures the already damaged structure', repeated.state.broken > rest.state.broken && oldDead.every(id => !repeated.state.bonds.find(bond => bond.id === id).alive), { before: rest.state.broken, after: repeated.state.broken });
  await act('document.querySelector("#bind").click()'); const binding = await capture('bind-selected');
  check('Bind selection is not reassembly or reset', binding.state.broken === repeated.state.broken && JSON.stringify(binding.state.bodies.map(body => body.position)) === JSON.stringify(repeated.state.bodies.map(body => body.position)) && JSON.stringify(binding.camera) === JSON.stringify(repeated.camera), binding.state.broken);
  await act('document.querySelector("#shear").click();document.querySelector("#reset").click()');
  const reset = await capture('explicit-reset');
  check('explicit Reset clears damage but preserves camera', reset.state.broken === 0 && JSON.stringify(reset.camera) === JSON.stringify(binding.camera), reset.state.broken);
  await input({ type: 'mousePressed', x: 40, y: 180, button: 'left', buttons: 1, clickCount: 1 });
  check('empty-space click does not grip material', (await witness()).state.hand === null, (await witness()).lastPick);
  await input({ type: 'mouseMoved', x: 100, y: 210, button: 'left', buttons: 1 });
  await input({ type: 'mouseReleased', x: 100, y: 210, button: 'left', buttons: 0, clickCount: 1 });
  await new Promise(resolve => setTimeout(resolve, 350));
  const orbit = await capture('operator-orbit');
  check('background drag controls camera', JSON.stringify(orbit.camera) !== JSON.stringify(reset.camera), orbit.camera);
  const rotatedPick = orbit.surfaceTargets.find(item => item.visible && item.row === 2);
  await input({ type: 'mousePressed', x: rotatedPick.screen.x, y: rotatedPick.screen.y, button: 'left', buttons: 1, clickCount: 1 });
  check('rotated-camera surface pick uses current geometry', (await witness()).state.hand?.index === rotatedPick.index, (await witness()).lastPick);
  await input({ type: 'mouseReleased', x: rotatedPick.screen.x, y: rotatedPick.screen.y, button: 'left', buttons: 0, clickCount: 1 });
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await send('Page.navigate', { url: new URL(`?smoke=1&viewport=mobile&strength=${expectedStrength}`, url).href }); await waitForLoad();
  await act('window.__archCollapse.advance(120)'); const mobile = await capture('mobile-standing');
  await pointerInjury(mobile.pickTargets.find(item => item.row === 1 && item.visible));
  await act('window.__archCollapse.advance(480)'); const mobileRest = await capture('mobile-rest');
  await act('document.querySelector("#zoom-out").click();document.querySelector("#zoom-out").click()');
  const mobileWide = await capture('mobile-rest-operator-zoom');
  check('explicit operator zoom changes camera without changing matter', JSON.stringify(mobileWide.camera) !== JSON.stringify(mobileRest.camera) &&
    JSON.stringify(mobileWide.state.bodies) === JSON.stringify(mobileRest.state.bodies), mobileWide.camera);
  check('mobile content fits', await evaluate('document.documentElement.scrollWidth <= innerWidth'), await evaluate('({width:innerWidth,documentWidth:document.documentElement.scrollWidth})'));
  report.phase = 'live-interaction'; save();
  const liveUrl = new URL(url); liveUrl.searchParams.delete('smoke');
  report.liveRequestedUrl = liveUrl.href;
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: liveUrl.href }); await waitForLoad();
  const liveStart = await witness();
  check('operator route starts with an active simulation clock', liveStart.effectiveUrl === liveUrl.href && !liveStart.paused, { url: liveStart.effectiveUrl, paused: liveStart.paused });
  await wait(1000); const liveSettled = await witness();
  check('operator route advances without manual stepping', liveSettled.state.step > liveStart.state.step, { start: liveStart.state.step, settled: liveSettled.state.step });
  await act('document.querySelector("#pause").click()'); const liveStanding = await capture('live-standing');
  const livePick = liveStanding.pickTargets.find(item => item.row === 1 && item.visible);
  await act('document.querySelector("#pause").click()');
  await input({ type: 'mousePressed', x: livePick.screen.x, y: livePick.screen.y, button: 'left', buttons: 1, clickCount: 1 });
  const liveSelected = await witness();
  check('live pointer loads only the selected front surface', liveSelected.state.hand?.index === livePick.index && liveSelected.state.hand.layers.join(',') === '2', liveSelected.state.hand);
  let liveScreen = livePick.screen;
  for (let i = 0; i < 60; i++) {
    const target = { x: livePick.world.x - 1.5*(i+1)/60, y: livePick.world.y, z: livePick.world.z + 0.5*(i+1)/60 };
    liveScreen = await act(`window.__archCollapse.projectWorld(${JSON.stringify(target)})`);
    await input({ type: 'mouseMoved', x: liveScreen.x, y: liveScreen.y, button: 'left', buttons: 1 });
    await wait(16);
  }
  await input({ type: 'mouseReleased', x: liveScreen.x, y: liveScreen.y, button: 'left', buttons: 0, clickCount: 1 });
  const liveReleased = await witness();
  await wait(3000); const liveEvolved = await witness();
  check('live release continues physical evolution without a hand or manual steps', liveEvolved.state.hand === null && liveEvolved.state.step > liveReleased.state.step &&
    liveEvolved.state.bodies.some((body, index) => Math.hypot(body.position.x-liveReleased.state.bodies[index].position.x, body.position.y-liveReleased.state.bodies[index].position.y, body.position.z-liveReleased.state.bodies[index].position.z) > 0.01),
    { released: liveReleased.state.step, evolved: liveEvolved.state.step, broken: liveEvolved.state.broken });
  await act('document.querySelector("#pause").click()'); const liveRest = await capture('live-after-release');
  report.liveEffectiveUrl = liveRest.effectiveUrl;
  check('live object injury leaves camera under operator ownership', JSON.stringify(liveStanding.camera) === JSON.stringify(liveRest.camera), liveRest.camera);
  report.phase = 'controls-and-startup-failure'; save();
  const controlFailures = [];
  function controlCheck(name, passed, observed) {
    report.checks.push({ name, passed, observed }); if (!passed) controlFailures.push(name); save();
  }
  const poses = state => state.bodies.map(body => ({ position: body.position, quaternion: body.quaternion }));
  const originalPoses = poses(liveRest.state);
  for (const value of [80, 120, 160]) {
    await act(`document.querySelector('#strength').value='${value}';document.querySelector('#strength').dispatchEvent(new Event('change',{bubbles:true}))`);
    const edited = await witness();
    controlCheck(`cohesion ${value} is natively valid and effective`, await evaluate('document.querySelector("#strength").validity.valid') && edited.state.config.strength === value, { displayed: await evaluate('document.querySelector("#strength").value'), effective: edited.state.config.strength });
    controlCheck(`cohesion ${value} preserves injury and pose`, edited.state.broken === liveRest.state.broken && JSON.stringify(poses(edited.state)) === JSON.stringify(originalPoses), edited.state.broken);
  }
  const retainedStrength = (await witness()).state.config.strength;
  expectedStrength = retainedStrength;
  for (const value of ['', '0', '-1']) {
    await act(`document.querySelector('#strength').value=${JSON.stringify(value)};document.querySelector('#strength').dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('#reset').click()`);
    let retained;
    try { retained = await witness(); } catch (error) { retained = { error: error.message }; }
    report.lastControlState = retained;
    controlCheck(`invalid cohesion ${JSON.stringify(value)} and Reset retain the object`, retained.state?.config.strength === retainedStrength && retained.state.broken === liveRest.state.broken && JSON.stringify(poses(retained.state)) === JSON.stringify(originalPoses), retained.error ?? { strength: retained.state?.config.strength, broken: retained.state?.broken });
    controlCheck(`invalid cohesion ${JSON.stringify(value)} has an honest visible disposition`, await evaluate(`document.querySelector('#error').textContent.includes('Effective cohesion remains ${retainedStrength}.') && document.querySelector('#strength').value === ${JSON.stringify(value)} && document.querySelector('#strength').getAttribute('aria-invalid') === 'true'`), await evaluate('({message:document.querySelector("#error").textContent,value:document.querySelector("#strength").value})'));
  }
  if (!controlFailures.length) await capture('invalid-edit-retained');
  await act(`(async () => { document.querySelector('#strength').value='${retainedStrength}';document.querySelector('#strength').dispatchEvent(new Event('change',{bubbles:true})); const engine=await import('cannon-es');const original=engine.World.prototype.addBody;engine.World.prototype.addBody=function(...args){engine.World.prototype.addBody=original;throw new Error('injected replacement construction failure');};document.querySelector('#reset').click(); })()`);
  const replacementFailure = await witness(); report.injectedReplacementFailure = replacementFailure; save();
  controlCheck('replacement construction failure retains the old physical and rendered object', replacementFailure.phase === 'failed' && replacementFailure.failure?.message === 'injected replacement construction failure' && replacementFailure.state.broken === liveRest.state.broken && JSON.stringify(poses(replacementFailure.state)) === JSON.stringify(originalPoses) && replacementFailure.rendererPoses.length === replacementFailure.state.bodies.length, { phase: replacementFailure.phase, failure: replacementFailure.failure, broken: replacementFailure.state.broken, rendered: replacementFailure.rendererPoses.length });
  await act('document.querySelector("#strength").value="80";document.querySelector("#strength").dispatchEvent(new Event("change",{bubbles:true}));document.querySelector("#reset").click()');
  expectedStrength = 80;
  const recovered = await witness();
  await act('document.querySelector("#pause").click()'); await wait(1000);
  const recoveryClock = await witness();
  controlCheck('valid Reset retains a continuously recoverable frame loop', recovered.state.broken === 0 && recoveryClock.state.step > recovered.state.step && recoveryClock.phase === 'interactive', { reset: recovered.state.step, later: recoveryClock.state.step, phase: recoveryClock.phase });
  await act(`(async () => { const engine=await import('cannon-es');const original=engine.World.prototype.step;engine.World.prototype.step=function(...args){engine.World.prototype.step=original;throw new Error('injected frame failure');}; })()`);
  await wait(500); const failedClock = await witness(); report.injectedFrameFailure = failedClock; save();
  controlCheck('frame failure pauses with a retained diagnostic', failedClock.phase === 'failed' && failedClock.clock.active === false && failedClock.failure?.message === 'injected frame failure', { phase: failedClock.phase, clock: failedClock.clock, failure: failedClock.failure });
  await act('document.querySelector("#reset").click()'); const frameRecovery = await witness();
  await wait(1000); const runningAgain = await witness();
  controlCheck('Reset after frame failure restores the previously live clock', runningAgain.phase === 'interactive' && runningAgain.clock.active && runningAgain.state.step > frameRecovery.state.step && runningAgain.failures.some(item => item.message === 'injected frame failure'), { reset: frameRecovery.state.step, later: runningAgain.state.step, clock: runningAgain.clock });
  if (!runningAgain.paused) await act('document.querySelector("#pause").click()');
  if (!controlFailures.length) await capture('controls-recovered');
  const denialSource = `(() => { const original = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function(kind,...args) { if (kind === 'webgl' || kind === 'webgl2' || kind === 'experimental-webgl') { window.__rendererDenied = true; return null; } return original.call(this,kind,...args); }; })()`;
  report.inputs.push({ method: 'Page.addScriptToEvaluateOnNewDocument', source: denialSource, observedAt: new Date().toISOString() }); save();
  await send('Page.addScriptToEvaluateOnNewDocument', { source: denialSource });
  await send('Page.navigate', { url: controlledUrl.href });
  const denialDeadline = Date.now() + 30000;
  while (!await evaluate('Boolean(window.__rendererDenied)')) {
    if (Date.now() > denialDeadline) throw new Error('renderer-denial injection never reached the constructor');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const startup = await evaluate('({status:document.querySelector("#status").textContent,error:document.querySelector("#error").textContent,witness:window.__archCollapse?.witness()})');
  report.injectedStartupFailure = startup; save();
  controlCheck('renderer constructor failure has an explicit retained failed state', startup.witness?.phase === 'failed' && startup.witness.failure?.message && startup.witness.clock.active === false && /failed/i.test(startup.status) && startup.error.length > 0, startup);
  const failureFrame = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const failureBytes = Buffer.from(failureFrame.data, 'base64');
  const failurePath = `${output.slice(0,-5)}-renderer-failure.png`;
  fs.writeFileSync(failurePath, failureBytes); report.failureCapture = { path: failurePath, sha256: hash(failureBytes) }; save();
  if (controlFailures.length) throw new Error(`control repair predicates failed: ${controlFailures.join('; ')}`);
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
