import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash, randomUUID} from 'node:crypto';
import {execFileSync, spawn} from 'node:child_process';

export function judgeOrdinaryMemorySmoke(r) {
  const errors = [];
  if (r?.schema !== 'kaminos.sf3d-ordinary-memory-smoke.v0') errors.push('missing primary report');
  if (!r?.source?.revision || r.source.clean !== true || r.source.revision !== r.requested?.revision || r.source.repoRoot !== r.requested?.repoRoot || !r.servedHashesMatch) errors.push('wrong or unverified serving source');
  if (!r?.browserExecutable?.includes('Google Chrome for Testing.app/') || !/^Chrome\/\d+\./.test(r.browserVersion ?? '')) errors.push('unverified independent browser');
  const hold = r?.sourceHold, identity = hold?.observation;
  if (hold?.verdict !== 'refused' || hold.authority !== 'circuit-breaker-only' || hold.modelPayloadBytesServed !== 0 ||
      identity?.source !== 'live-macos-sysctl' || identity.machine !== 'Mac14,9' || identity.cpu !== 'Apple M2 Pro' || identity.hostTotalBytes !== 17179869184) errors.push('missing live identified M2 source hold');
  if (r?.model?.initialized !== false || r.model.error?.sourceAdmission?.verdict !== 'refused' || r.model.error.sourceAdmission.authority !== 'circuit-breaker-only' ||
      !Array.isArray(r.modelPayloadRequests) || r.modelPayloadRequests.length) errors.push('model is not held before payload');
  if (r?.sourceHead?.status !== 503 || r.sourceHead.authority !== 'circuit-breaker-only' || r.sourceHead.bodyBytes !== 0) errors.push('actual static weight boundary is not held');
  if (r?.events?.some(x => x.kind === 'pageerror')) errors.push('page exception');
  const adapter = r?.adapters?.[0], fallback = adapter?.fallbackEvidence;
  const fieldsValid = fallback && [fallback.info, fallback.legacy].every(x => x === null || typeof x === 'boolean');
  const consistent = fieldsValid && !(fallback.info !== null && fallback.legacy !== null && fallback.info !== fallback.legacy);
  const authority = fallback?.source === 'GPUAdapterInfo.isFallbackAdapter' ? fallback.info :
    fallback?.source === 'GPUAdapter.isFallbackAdapter' && fallback.info === null ? fallback.legacy : null;
  if (!Array.isArray(r?.adapters) || r.adapters.length !== 1 || adapter.isFallbackAdapter !== false || !consistent || authority !== false ||
      r.adapters[0].info?.vendor !== 'apple' || !r.adapters[0].info?.architecture?.startsWith('metal')) errors.push('wrong or fallback effective adapter');
  for (const frame of [r?.before, r?.after]) {
    if (frame?.renderer !== 'ordinary-volume' || frame.active !== true || frame.error || frame.simGrid !== r.requested?.grid ||
        frame.controls?.emitterSourceDepth !== r.requested?.sourceDepth) errors.push('wrong or failed renderer variant');
    if (frame?.memory?.authority !== 'observation-only' || frame.memory.budget?.deviceAcquisition !== 'requested-through-budget' ||
        !(frame.memory.budget.gpu?.liveBytes > 0) || frame.memory.budget.gpu.physicalMemoryMeasured !== false) errors.push('missing actual acquisition baseline observation');
  }
  if (!(r?.after?.frameCount > r?.before?.frameCount && r.after.simStepCount > r.before.simStepCount)) errors.push('renderer did not advance');
  if (!Array.isArray(r?.captures) || r.captures.length !== 2 || r.captures.some(x => !x.path || !/^[a-f0-9]{64}$/.test(x.sha256))) errors.push('missing frame capture evidence');
  if (r?.processObservation?.status !== 'observed' || r.processObservation.coverage !== 'sampled-owned-process-tree' || !(r.processObservation.sampleCount > 0) ||
      !r.runId || r.processObservation.runId !== r.runId || r.processObservation.rootPid !== r.ownedRootPid || r.memorySafety) errors.push('unsafe, stale or partial process observation');
  if (r?.cleanup?.browser?.exitObserved !== true || r.cleanup.server?.exitObserved !== true) errors.push('owned cleanup not observed');
  return errors;
}

// Native observation only. Reuse the producer's existing TRELLIS-derived
// process guard, owned-browser stop, and actual Python-handler service.
export async function runOrdinaryMemorySmoke(args) {
  const values = new Map();
  for (let i = 0; i < args.length; i += 2) values.set(args[i], args[i + 1]);
  const get = name => {const value = values.get(name); if (!value || value.startsWith('--')) throw Error(`required ${name}`); return value;};
  const out = path.resolve(get('--out'));
  fs.mkdirSync(out, {recursive: true});
  const reportPath = path.join(out, 'report.json');
  const r = {schema: 'kaminos.sf3d-ordinary-memory-smoke.v0', phase: 'arguments', runId: randomUUID(), ownedRootPid: process.pid,
    status: 'incomplete', events: [], modelPayloadRequests: [], captures: [],
    visualInspectionRequired: true, meaning: 'held full model plus actual ordinary renderer observation; not model completion or physical-fit admission'};
  const save = () => fs.writeFileSync(reportPath, JSON.stringify(r, null, 2)+'\n');
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  let service, serverChild, child, browser, page, monitor, stopOwnedBrowser;
  save();
  try {
    const repoRoot = path.resolve(get('--repo-root')), revision = get('--expected-revision');
    const producerRoot = path.resolve(get('--producer-root')), producerRevision = get('--expected-producer-revision');
    r.requested = {repoRoot, revision, producerRoot, producerRevision,
      grid: Number(get('--grid')), sourceDepth: Number(get('--source-depth')),
      warmupFrames: Number(get('--warmup-frames')), processBudgetBytes: Number(get('--process-budget-bytes'))};
    for (const key of ['grid', 'warmupFrames', 'processBudgetBytes']) if (!Number.isSafeInteger(r.requested[key]) || r.requested[key] < 1) throw Error(`positive explicit ${key} required`);
    if (r.requested.grid !== 32 || r.requested.sourceDepth !== 0.125) throw Error('this bounded witness admits only the previously observed grid32/depth0.125 variant');
    const git = (root, argv) => execFileSync('git', argv, {cwd: root, encoding: 'utf8'}).trim();
    r.phase = 'source-identity'; save();
    r.source = {repoRoot, revision: git(repoRoot, ['rev-parse', 'HEAD']), clean: git(repoRoot, ['status', '--porcelain']) === ''};
    r.producerSource = {repoRoot: producerRoot, revision: git(producerRoot, ['rev-parse', 'HEAD']), clean: git(producerRoot, ['status', '--porcelain']) === ''};
    if (!r.source.clean || r.source.revision !== revision || !r.producerSource.clean || r.producerSource.revision !== producerRevision) throw Error('clean exact requested sources required');
    const helper = name => import(pathToFileURL(path.join(producerRoot, 'tools', name)).href);
    const stopTools = await helper('owned_browser_stop.mjs');
    stopOwnedBrowser = stopTools.stopOwnedBrowser;
    const {startProcessMemory} = await helper('process_memory_guard.mjs');
    const {startForegroundService} = await helper('foreground_service.mjs');
    const {observeMacMemory} = await helper('memory_admission.mjs');
    r.headroom = observeMacMemory();
    r.knownRendererInitialBytes = 2 * r.requested.grid ** 3 * 160;
    if (r.headroom.source !== 'live-macos' || r.headroom.observerErrors.length || r.headroom.hostFreeBytes < r.knownRendererInitialBytes) throw Error('live headroom for identified initial renderer stores unavailable');
    r.headroomMeaning = 'identified initial component stores only, not upper bound or positive physical model fit';
    r.phase = 'process-guard'; save();
    const stop = stopTools.memoryStopAction({child: () => child, report: r, persist: save});
    monitor = await startProcessMemory({python: '/usr/bin/python3', script: path.join(producerRoot, 'tools/process_memory.py'),
      runId: r.runId, rawPath: path.join(out, 'process.jsonl'), maxFootprintBytes: r.requested.processBudgetBytes, onUnsafe: stop});
    r.phase = 'actual-source-service'; save();
    if (r.memorySafety) throw Error('process guard prevented server launch');
    service = await startForegroundService({repoRoot, revision, outputDir: path.join(out, 'source-service'), sourceHoldHead: true, onSpawn: c => {serverChild = c;}});
    r.service = service.receipt;
    const origin = service.receipt.origin;
    const requestId = randomUUID();
    const holdResponse = await fetch(origin+'/api/sf3d-source-admission?requestId='+requestId, {cache: 'no-store'});
    const holdBytes = Buffer.from(await holdResponse.arrayBuffer());
    fs.writeFileSync(path.join(out, 'source-hold.raw'), holdBytes);
    r.sourceHold = JSON.parse(holdBytes);
    if (!holdResponse.ok || r.sourceHold.requestId !== requestId || r.sourceHold.verdict !== 'refused') throw Error('fresh actual source refusal required before browser');
    const head = await fetch(origin+'/lib/sf3d/weights.bin', {method: 'HEAD', cache: 'no-store'});
    r.sourceHead = {status: head.status, authority: head.headers.get('x-sf3d-memory-authority'), bodyBytes: (await head.arrayBuffer()).byteLength};
    if (r.sourceHead.status !== 503 || r.sourceHead.authority !== 'circuit-breaker-only' || r.sourceHead.bodyBytes !== 0) throw Error('actual static weight HEAD was not held');
    r.servedHashes = {};
    for (const file of ['index.html', 'serve.py', 'volume-core.js', 'sf3d-live-flame-inject.mjs', 'sf3d-host-device.mjs', 'lib/sf3d/sf3d-producer.js']) {
      const response = await fetch(origin+'/'+file, {cache: 'no-store'});
      const bytes = Buffer.from(await response.arrayBuffer());
      r.servedHashes[file] = {sha256: hash(bytes), expected: hash(fs.readFileSync(path.join(repoRoot, file))), status: response.status};
      if (!response.ok || r.servedHashes[file].sha256 !== r.servedHashes[file].expected) throw Error('wrong served source '+file);
    }
    r.servedHashesMatch = true;
    const html = fs.readFileSync(path.join(repoRoot, 'sf3d-elfinblue.html'), 'utf8');
    const match = html.match(/content="0;\s*url=([^"]+)"/);
    if (!match) throw Error('actual ordinary route capsule absent');
    const route = new URL(match[1].replaceAll('&amp;', '&'), origin);
    r.originalRoute = route.href;
    route.searchParams.delete('settings_preset'); route.searchParams.delete('settings_preset_authority');
    route.searchParams.set('volume_resolution', String(r.requested.grid));
    route.searchParams.set('volume_emitter_source_depth', String(r.requested.sourceDepth));
    route.searchParams.set('volume_quality_reason', 'mini-ordinary-memory-explicit-grid-depth-variant');
    route.hash = 'composition_module_url=./sf3d-live-flame-inject.mjs';
    r.effectiveUrl = route.href;
    r.variant = 'explicit grid32/depth0.125 variant of actual recorded controls; not unchanged authored basin or immutable preset admission';
    const {default: puppeteer} = await import(pathToFileURL(path.resolve(get('--puppeteer'))).href);
    r.browserExecutable = fs.realpathSync(get('--chrome'));
    if (!r.browserExecutable.includes('Google Chrome for Testing.app/')) throw Error('independent Chrome for Testing executable required');
    r.browserExecutableVersion = execFileSync(r.browserExecutable, ['--version'], {encoding: 'utf8'}).trim();
    const profile = fs.mkdtempSync(path.join(out, 'browser-profile-'));
    const browserArgs = await stopTools.ownedBrowserArguments(puppeteer, {profile, headless: false});
    browserArgs.push('--window-size=1280,960');
    r.browserArguments = browserArgs;
    const allowed = ['HOME', 'TMPDIR', 'PATH', 'LANG', 'LC_ALL', 'LC_CTYPE', '__CF_USER_TEXT_ENCODING'];
    const env = Object.fromEntries(allowed.filter(k => process.env[k] != null).map(k => [k, process.env[k]]));
    r.childEnvironment = {policy: 'positive-allowlist', names: Object.keys(env), valuesRecorded: false};
    r.phase = 'browser-launch'; save();
    if (r.memorySafety) throw Error('process guard prevented browser launch');
    child = spawn(r.browserExecutable, browserArgs, {env, stdio: ['ignore', 'ignore', 'pipe']});
    r.ownedBrowserPid = child.pid;
    const endpoint = await new Promise((resolve, reject) => {
      let stderr = '';
      const data = bytes => {stderr += bytes; fs.appendFileSync(path.join(out, 'browser.log'), bytes); const found = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (found) {cleanup(); resolve(found[1]);}};
      const exit = (code, signal) => {cleanup(); reject(Error(`owned browser exited before endpoint ${code}/${signal}`));};
      const error = e => {cleanup(); reject(e);};
      const cleanup = () => {child.stderr.off('data', data); child.off('exit', exit); child.off('error', error);};
      child.stderr.on('data', data); child.once('exit', exit); child.once('error', error);
    });
    child.stderr.on('data', bytes => fs.appendFileSync(path.join(out, 'browser.log'), bytes));
    browser = await puppeteer.connect({browserWSEndpoint: endpoint, defaultViewport: null, protocolTimeout: 0});
    r.browserVersion = await browser.version();
    page = await browser.newPage(); page.setDefaultTimeout(0); page.setDefaultNavigationTimeout(0);
    await page.setViewport({width: 1280, height: 960});
    await page.evaluateOnNewDocument(() => {
      window.__ordinaryMemoryAdapters = [];
      const request = navigator.gpu.requestAdapter.bind(navigator.gpu);
      navigator.gpu.requestAdapter = async (...args) => {
        const adapter = await request(...args);
        window.__ordinaryMemoryAdapters.push(adapter ? {
          isFallbackAdapter: adapter.info.isFallbackAdapter ?? adapter.isFallbackAdapter,
          fallbackEvidence: {info: adapter.info.isFallbackAdapter ?? null, legacy: adapter.isFallbackAdapter ?? null,
            source: typeof adapter.info.isFallbackAdapter === 'boolean' ? 'GPUAdapterInfo.isFallbackAdapter' :
              typeof adapter.isFallbackAdapter === 'boolean' ? 'GPUAdapter.isFallbackAdapter' : 'unavailable'},
          info: {vendor: adapter.info.vendor, architecture: adapter.info.architecture, description: adapter.info.description}} : null);
        return adapter; // Observation only: no alternate device or allocation hook.
      };
    });
    page.on('pageerror', error => {r.events.push({kind: 'pageerror', message: error.message}); save();});
    page.on('console', message => {r.events.push({kind: 'console', type: message.type(), text: message.text()});});
    page.on('request', request => {if (new URL(request.url()).pathname === '/lib/sf3d/weights.bin') {r.modelPayloadRequests.push(request.url()); save();}});
    r.phase = 'ordinary-route'; save();
    const navigation = await page.goto(r.effectiveUrl, {waitUntil: 'domcontentloaded'});
    if (!navigation?.ok()) throw Error('ordinary route navigation refused');
    await page.waitForFunction(() => window.__sf3dLiveFlame?.lastError || window.__sf3dLiveFlameReady || window.__kaminosCompositionSetup?.status === 'failed');
    r.model = await page.evaluate(() => ({initialized: Boolean(window.__sf3dProducer), error: window.__sf3dLiveFlame?.lastError,
      setup: window.__kaminosCompositionSetup, route: window.__compositionRoute})); save();
    if (r.model.initialized || r.model.error?.sourceAdmission?.verdict !== 'refused') throw Error('actual mounted full model was not held');
    await page.waitForFunction(frames => window.__kaminosVolumePrototype?.debugState().frameCount >= frames || window.__kaminosVolumePrototype?.debugState().error, {}, r.requested.warmupFrames);
    const sample = () => page.evaluate(async () => {
      const prototype = window.__kaminosVolumePrototype, context = prototype.foregroundGpuContext();
      const {snapshotSf3dHostMemory} = await import('./sf3d-live-flame-inject.mjs');
      return {...prototype.debugState(), renderer: context.renderer, memory: snapshotSf3dHostMemory(context.device)};
    });
    r.phase = 'renderer-observation'; r.before = await sample(); save();
    for (const name of ['before', 'after']) {
      if (name === 'after') {
        await page.waitForFunction(before => {const state = window.__kaminosVolumePrototype.debugState(); return state.error || (state.frameCount > before.frameCount && state.simStepCount > before.simStepCount);}, {}, r.before);
        r.after = await sample();
      }
      const capturePath = path.join(out, name+'.png');
      await page.screenshot({path: capturePath});
      r.captures.push({path: capturePath, sha256: hash(fs.readFileSync(capturePath))}); save();
    }
    r.adapters = await page.evaluate(() => window.__ordinaryMemoryAdapters);
  } catch (error) {
    r.error = {message: error.message, stack: error.stack}; r.failurePhase = r.phase; save();
    if (page && child?.exitCode === null && !r.memorySafety) await page.screenshot({path: path.join(out, 'failure.png')}).catch(e => {r.failureCaptureError = e.message;});
  } finally {
    r.phase = 'cleanup'; r.cleanup = {};
    try {save();} catch (error) {r.cleanup.reportError = error.message;}
    if (browser) browser.disconnect();
    for (const [name, owned] of [['browser', child], ['server', serverChild]]) if (owned && stopOwnedBrowser) {
      try {r.cleanup[name] = await stopOwnedBrowser(owned);} catch (e) {r.cleanup[name] = {error: e.message, exitObserved: false};}
    }
    if (monitor) {
      try {r.processObservation = await monitor.stop();}
      catch (error) {r.processObservation = {status: 'failed', error: error.message}; r.failurePhase ??= 'process-observation-cleanup';}
    }
    r.errors = judgeOrdinaryMemorySmoke(r);
    if (r.error) r.errors.push(r.error.message);
    if (r.cleanup.reportError) r.errors.push('cleanup report write failed: '+r.cleanup.reportError);
    r.status = r.errors.length ? 'failed' : 'contracts-passed-awaiting-visual-inspection';
    r.phase = 'terminal'; r.finishedAt = new Date().toISOString(); save();
  }
  return {status: r.status, errors: r.errors, reportPath};
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const result = await runOrdinaryMemorySmoke(process.argv.slice(2));
  console.log(JSON.stringify(result));
  if (result.errors.length) process.exitCode = 1;
}
