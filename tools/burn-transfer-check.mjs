import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

export function materialSummary(snapshot) {
  assert.ok(snapshot?.initial?.length > 0, 'Missing occupied material');
  assert.equal(snapshot.material?.length, snapshot.initial.length * 8, 'Incomplete material');
  assert.ok(snapshot.material.every(Number.isFinite), 'Nonfinite material');
  let occupied = 0, fuel = 0, heat = 0, reaction = 0, consumed = 0;
  for (let i = 0; i < snapshot.initial.length; i++) if (snapshot.initial[i]) {
    occupied++;
    fuel += snapshot.material[i * 8 + 5];
    heat = Math.max(heat, snapshot.material[i * 8]);
    reaction = Math.max(reaction, snapshot.material[i * 8 + 2]);
    if (snapshot.material[i * 8 + 5] < .999) consumed++;
  }
  assert.ok(occupied > 0, 'Empty material');
  return {occupied, meanFuel: fuel / occupied, peakHeat: heat, peakReaction: reaction, consumed};
}

export function validateTransfer(before, after, effective) {
  assert.equal(effective.backend, 'WebGPU:apple', 'Wrong backend');
  assert.equal(effective.simGrid, 32, 'Wrong grid');
  assert.equal(effective.sourceEnabled, false, 'Starter still enabled');
  assert.ok(after.step > before.step, 'No actual simulation advance');
  const b = before.rows.map(row => materialSummary(row.snapshot));
  const a = after.rows.map(row => materialSummary(row.snapshot));
  assert.equal(a.length, 3, 'Expected donor, receiver and cold control');
  assert.ok(b[0].peakReaction > 0 && b[0].meanFuel < .999, 'Donor did not catch');
  assert.equal(b[1].meanFuel, 1, 'Receiver was not initially cold');
  assert.equal(b[2].meanFuel, 1, 'Control was not initially cold');
  assert.ok(a[1].meanFuel < .999 && a[1].consumed > 0, 'Receiver did not consume its own fuel');
  assert.equal(a[2].meanFuel, 1, 'Distant control also consumed fuel');
  return {before: b, after: a, interpretation: 'donor-mediated-secondary-ignition'};
}

async function main() {
  const [root, seedPath, out, warmText = '1200', transferText = '1200'] = process.argv.slice(2);
  const report = {status: 'running', phase: 'inputs', root, seedPath, out,
    warmSteps: Number(warmText), transferSteps: Number(transferText), errors: [], responses: [], observations: [],
    claim: 'Causal secondary ignition on static ordinary burnables; not load-bearing contact or operator feel'};
  let browser, page;
  const save = async () => { await fs.mkdir(out, {recursive: true}); await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); };
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  try {
    assert.ok(root && seedPath && out);
    await save();
    assert.ok(Number.isInteger(report.warmSteps) && report.warmSteps > 0);
    assert.ok(Number.isInteger(report.transferSteps) && report.transferSteps > 0);
    report.revision = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim();
    assert.equal(execFileSync('git', ['status', '--porcelain'], {cwd: root, encoding: 'utf8'}), '');
    const seedBytes = await fs.readFile(seedPath), doc = JSON.parse(seedBytes);
    report.seedSha256 = hash(seedBytes);
    const harness = await fs.readFile(import.meta.filename);
    report.harnessSha256 = hash(harness);
    await fs.writeFile(path.join(out, 'effective-harness.mjs'), harness);
    const response = await fetch('http://127.0.0.1:8480/@' + report.revision);
    assert.equal(response.ok, true); await response.arrayBuffer();
    report.publicOrigin = new URL(response.url).origin;
    const proxyConfig = await (await fetch(report.publicOrigin + '/api/runtime-config')).json();
    assert.equal(proxyConfig.source.commit, report.revision); assert.equal(proxyConfig.source.dirty, false);
    const origin = 'http://127.0.0.1:' + proxyConfig.source.serverPort;
    const config = await (await fetch(origin + '/api/runtime-config')).json();
    assert.equal(config.source.commit, report.revision); assert.equal(config.source.dirty, false);
    report.source = config.source;
    doc.objects = doc.objects.filter(o => ['flame-emitter', 'simulation-domain', 'light'].includes(o.type));
    doc.groups = []; doc.model = null; doc.activeObjectId = 'flame-emitter'; doc.activeGroupId = null;
    doc.selectionIds = ['flame-emitter']; doc.label = 'Object ignition - stationary causal control';
    doc.camera = {...doc.camera, position: [1.5, .35, 2.6], target: [-.15, -.25, 0]};
    const source = doc.objects.find(o => o.type === 'flame-emitter');
    source.emissionEnabled = true; source.transform.position = [-.55, -.72, 0];
    source.transform.rotation = [0, 0, 0];
    const savedResponse = await fetch(origin + '/api/save-scene', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(doc)});
    const saved = await savedResponse.json(); assert.equal(savedResponse.ok, true); assert.ok(saved.saved?.endsWith('.kaminos.json'));
    const params = new URLSearchParams({...doc.composition.route, workspace: 'workbench', authoring: '1', volume_look_freeze: '1', scene: saved.saved});
    report.url = origin + '/volume-settings-preset.html?preset=' + doc.composition.flame.presetId + '#' + params;
    report.phase = 'browser'; await save();
    report.executable = '/Users/noahlyons/Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell';
    const {chromium} = await import('/Users/noahlyons/.local/state/kaminos/minion-visual-handoff-1004/browser-deps/node_modules/playwright-core/index.mjs');
    browser = await chromium.launchPersistentContext(path.join(out, 'profile'), {executablePath: report.executable, headless: true, viewport: {width: 1280, height: 900}, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--use-mock-keychain', '--password-store=basic']});
    page = browser.pages()[0]; page.setDefaultTimeout(0);
    page.on('pageerror', e => report.errors.push({kind: 'pageerror', text: String(e)}));
    page.on('console', m => { if (m.type() === 'error') report.errors.push({kind: 'console', text: m.text(), location: m.location()}); });
    page.on('response', r => { if (r.status() >= 400) report.responses.push({url: r.url(), status: r.status()}); });
    const check = () => { assert.deepEqual(report.errors, []); assert.deepEqual(report.responses, []); };
    await page.goto(report.url, {waitUntil: 'commit'});
    for (;;) {
      const state = await page.evaluate(() => ({api: !!window.kaminosSceneAuthoring, volume: window.__kaminosVolumePrototype?.debugState()}));
      report.lastState = state; check(); await save();
      if (state.volume?.error) throw Error(state.volume.error);
      if (state.api && state.volume?.active) break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    report.phase = 'ordinary-objects'; await save();
    report.ids = await page.evaluate(async () => {
      const api = window.kaminosSceneAuthoring, runtime = window.__kaminosVolumePrototype;
      runtime.setSimulationPaused(true);
      const positions = [[-.55, -.4, 0], [.65, -.4, 0], [.9, -.4, .8]];
      const labels = ['Donor wood', 'Receiver wood', 'Distant cold control'];
      const ids = positions.map((position, i) => {
        const id = api.addMesh('box', {width: .28, height: .35, depth: .28});
        window.kaminosSetSceneObjectTransform(id, {position}); window.renameSceneObject(id, labels[i]);
        api.setMaterial(id, {color: ['#72523a', '#b59365', '#92979c'][i], roughness: .85, metalness: 0});
        api.setBurnable(id, true); api.setCollision(id, true); api.setBurnAppearance(id, {glow: .15});
        return id;
      });
      window.kaminosSceneCollision.set(true); await api.settleCombustion();
      return ids;
    });
    for (;;) {
      const states = await page.evaluate(ids => ids.map(id => window.kaminosSceneAuthoring.burningState(id)), report.ids);
      report.materialStates = states; check(); await save();
      assert.ok(states.every(s => s.status !== 'failed'), JSON.stringify(states));
      if (states.every(s => s.status === 'resident')) break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    report.effective = await page.evaluate(() => {
      const v = window.__kaminosVolumePrototype.debugState();
      const source = window.kaminosSceneAuthoring.read().objects.find(o => o.id === 'flame-emitter');
      return {backend: v.backend, simGrid: v.simGrid, sourceEnabled: source.emissionEnabled, source,
        controls: Object.fromEntries(['volume-steps', 'scene-gi-steps', 'scene-gi-slices', 'volume-look-freeze'].map(id => [id, document.getElementById(id).value])),
        sourceConfig: v.immersedSources.sources.find(s => s.id === 'flame-emitter').config.effective};
    });
    assert.equal(report.effective.backend, 'WebGPU:apple'); assert.equal(report.effective.simGrid, 32);
    assert.deepEqual(report.effective.controls, {'volume-steps': '28', 'scene-gi-steps': '4', 'scene-gi-slices': '3', 'volume-look-freeze': '1'});
    assert.equal(report.effective.source.emission.settings['volume-immersed-radius'].value, .1);
    assert.ok(report.effective.sourceConfig.direction[1] > .999 && report.effective.sourceConfig.fluxRequested > 0);
    const cdp = await browser.newCDPSession(page);
    const capture = async name => { const r = await cdp.send('Page.captureScreenshot', {format: 'png'}); await fs.writeFile(path.join(out, name + '.png'), Buffer.from(r.data, 'base64')); };
    const sample = async name => {
      const observation = await page.evaluate(async ids => ({step: window.__kaminosVolumePrototype.debugState().simStepCount,
        rows: await Promise.all(ids.map(async id => ({id, state: window.kaminosSceneAuthoring.burningState(id), snapshot: await window.kaminosSceneAuthoring.burningSnapshot(id)})))}), report.ids);
      await fs.writeFile(path.join(out, name + '.json'), JSON.stringify(observation));
      report.observations.push({name, step: observation.step, rows: observation.rows.map(r => ({id: r.id, ...materialSummary(r.snapshot)}))});
      check(); await save(); return observation;
    };
    const advance = async count => {
      const receipt = await page.evaluate(async count => {
        const r = window.__kaminosVolumePrototype, start = r.debugState().simStepCount;
        if (document.getElementById('volume-look-freeze').value !== '1') throw Error('Expected paused shared control');
        document.getElementById('volume-viewer-play').click(); r.setSimulationPaused(false); r.setSelectiveHeadLiveCapturePaused(false);
        const stop = await r.pauseSelectiveHeadLiveAtSimStep(start + count);
        document.getElementById('volume-viewer-play').click(); r.setSimulationPaused(true); r.setSelectiveHeadLiveCapturePaused(false);
        return {start, stop};
      }, count);
      report.lastAdvance = receipt; assert.equal(receipt.stop.ok, true); assert.equal(receipt.stop.effectiveSimStepCount, receipt.start + count); check();
    };
    report.handoff = await page.evaluate(name => window.saveSceneAs({name, result: true}), 'object-ignition-control-' + path.basename(out));
    assert.equal(report.handoff.ok, true);
    report.handoff.url = report.handoff.url.replace(origin, report.publicOrigin);
    await sample('cold'); await capture('cold');
    report.phase = 'heat-donor'; await save();
    for (let n = 0; n < report.warmSteps; n += 60) { await advance(Math.min(60, report.warmSteps - n)); await sample('warm-' + Math.min(n + 60, report.warmSteps)); }
    const hot = await sample('donor-hot'); await capture('donor-hot');
    assert.ok(materialSummary(hot.rows[0].snapshot).peakReaction > 0, 'Donor did not catch');
    report.phase = 'clear-starter-and-residual-gas'; await save();
    report.intervention = await page.evaluate(async ids => {
      const api = window.kaminosSceneAuthoring, r = window.__kaminosVolumePrototype;
      window.kaminosSceneEdits.apply('@flame-source-enabled', {enabled: false}, 'Switch starter off');
      const reset = r.resetThermalExperimentFluid();
      api.resetBurnable(ids[1]); api.resetBurnable(ids[2]);
      window.kaminosSetSceneObjectTransform(ids[1], {position: [-.55, .025, 0]});
      return {reset, authored: api.read(), snapshot: await api.burningSnapshot(ids[0]), effective: r.debugState()};
    }, report.ids);
    assert.deepEqual(report.intervention.snapshot.material, hot.rows[0].snapshot.material, 'Fluid reset changed donor material');
    report.effective.sourceEnabled = report.intervention.authored.objects.find(o => o.id === 'flame-emitter').emissionEnabled;
    assert.equal(report.effective.sourceEnabled, false);
    const before = await sample('transfer-start'); await capture('transfer-start');
    report.phase = 'donor-only-transfer'; await save();
    for (let n = 0; n < report.transferSteps; n += 60) { await advance(Math.min(60, report.transferSteps - n)); await sample('transfer-' + Math.min(n + 60, report.transferSteps)); }
    const after = await sample('transfer-end'); await capture('transfer-end');
    report.verdict = validateTransfer(before, after, report.effective);
    report.status = 'observed-transfer'; report.phase = 'complete';
  } catch (error) {
    report.status = 'failed'; report.error = String(error.stack ?? error); process.exitCode = 1;
  } finally {
    try { await browser?.close(); } catch (error) { report.status = 'failed'; report.cleanupError = String(error); process.exitCode = 1; }
    if (out) await save();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
