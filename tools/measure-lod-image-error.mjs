// Measure image-space error for the LOD levels of one stored mesh, in an isolated headless browser.
//
//   KAMINOS_CHROME=<Chrome for Testing> node tools/measure-lod-image-error.mjs --server http://127.0.0.1:8484 \
//     --source <sha256> --out <dir> --report <path> [--levels <sha>,<sha>] [--res 512] [--show all] [--normal-maps false]
//
// Without --levels, every current (not retired) level registered for the source is measured.
// For each level the tool writes <out>/<level>.image-error.json (tools/lod-image-error.html's
// result: settings, browser/GL route, per-view and aggregate channels) and <out>/<level>.image-error.png
// (the per-view sheet). The report is written at every phase, including on failure.
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {fluidBrowserLaunch} from '../finger-fluid-browser-launch.mjs';
import {SCHEMA, viewDirections} from '../lod-image-compare.mjs';

const SHA = /^[a-f0-9]{64}$/;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Opens one page per call in a single isolated browser; returns {title, result, error, png, console}.
export async function launchBrowser({executable, timeoutMs = 900000}) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'kaminos-lod-image-error-'));
  const port = 9500 + Math.floor(Math.random() * 400);
  const launch = fluidBrowserLaunch({executable, debugPort: port, userDataDir: profile, width: 1200, height: 900});
  const child = spawn(launch.executable, ['--headless=new', '--hide-scrollbars', ...launch.args], {stdio: 'ignore'});
  // A browser that cannot start reports through 'error' (and may never 'exit'); turn it into a failure.
  let spawnError = null; const exited = new Promise(r => child.once('close', r));
  child.once('error', error => { spawnError = error; });
  const close = async () => { if (child.pid !== undefined && child.exitCode === null && child.signalCode === null) { child.kill(); await exited; }
    fs.rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 200}); };
  try {
    let target;
    for (let i = 0; i < 100 && !target; i++) { await sleep(200); if (spawnError) throw Error(`browser did not start: ${spawnError.message}`);
      try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); } catch {} }
    if (!target) throw Error('browser exposed no debuggable page');
    const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    const ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
    let id = 0; const pending = new Map(), log = [];
    ws.onmessage = e => { const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
      else if (m.method === 'Runtime.consoleAPICalled') log.push(m.params.type + ': ' + m.params.args.map(a => a.value ?? a.description).join(' '));
      else if (m.method === 'Runtime.exceptionThrown') log.push('exception: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text)); };
    const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({id: i, method, params})); });
    const value = async expression => (await send('Runtime.evaluate', {expression, returnByValue: true})).result?.result?.value;
    await send('Runtime.enable');
    const openPage = async url => {
      log.length = 0;
      await send('Page.navigate', {url});
      const deadline = Date.now() + timeoutMs; let title = '';
      while (Date.now() < deadline) { await sleep(500); title = await value('document.title'); if (title === 'done' || title === 'error') break; }
      const result = JSON.parse(await value('JSON.stringify(window.__result ?? null)') ?? 'null'), error = await value('window.__error ?? null');
      let png = null;
      if (title === 'done') { const shot = await send('Page.captureScreenshot', {format: 'png', captureBeyondViewport: true}); png = Buffer.from(shot.result.data, 'base64'); }
      return {title, result, error, png, console: [...log]};
    };
    return {executable: launch.executable, version: version.Browser, openPage, close: async () => { ws.close(); await close(); }};
  } catch (error) { await close(); throw error; }
}

const VIEWS = viewDirections().length;
const finiteStat = v => v && ['max', 'p95', 'mean', 'count'].every(k => Number.isFinite(v[k]));
// A complete page result for this request: identity, settings, route, and all views with their channels.
export function describesMeasurement(r, {source, level, resolution, normals}) {
  return r?.schema === SCHEMA && r.reference?.sha256 === source && r.level?.sha256 === level &&
    r.settings?.resolution === resolution && r.settings?.normals === normals && r.settings?.views === VIEWS &&
    typeof r.route?.glRenderer === 'string' && typeof r.route?.three === 'string' && typeof r.normalMapped?.level === 'boolean' &&
    Array.isArray(r.perView) && r.perView.length === VIEWS && r.perView.every(v => v && [v.referenceCoverage, v.silhouetteMismatch, v.differentSurface].every(Number.isFinite) &&
      v.referenceCoverage > 0 && finiteStat(v.depth) && finiteStat(v.normalDegrees) && finiteStat(v.albedo) && Number.isFinite(v.normalUndefined?.reference) && Number.isFinite(v.normalUndefined?.level)) &&
    r.aggregate && typeof r.aggregate === 'object';
}

export async function measure(args, {browserFor = launchBrowser} = {}) {
  const {server, source, out, report: reportPath} = args;
  const report = {schema: 'kaminos.lod-image-error-report.v0', phase: 'admission', server, source, out, startedAt: new Date().toISOString(), levels: []};
  const save = () => reportPath && fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  let browser;
  try {
    if (!server || !out || !reportPath || !SHA.test(source || '')) throw Error('--server, --source <sha256>, --out and --report are required');
    const requested = args.levels ? args.levels.split(',') : null;
    if (requested && !requested.every(s => SHA.test(s))) throw Error('--levels must be sha256 values');
    save();
    report.phase = 'levels'; save();
    const listed = await fetch(`${server}/api/mesh-lods?source=${source}`);
    if (!listed.ok) throw Error(`cannot read levels of ${source} (HTTP ${listed.status})`);
    const record = await listed.json(), current = new Map(record.levels.map(l => [l.sha256, l]));
    for (const sha of requested ?? []) if (!current.has(sha)) throw Error(`${sha} is not a current level of ${source}`);
    const levels = requested ?? [...current.keys()];
    if (!levels.length) throw Error(`${source} has no registered levels`);
    fs.mkdirSync(out, {recursive: true});
    report.phase = 'browser'; save();
    browser = await browserFor({executable: args.chrome ?? process.env.KAMINOS_CHROME});
    report.browser = {executable: browser.executable, version: browser.version};
    report.phase = 'measure'; save();
    for (const sha of levels) {
      const normalMaps = args['normal-maps'] !== 'false';
      const url = `${server}/tools/lod-image-error.html?ref=${source}&level=${sha}&res=${args.res ?? 512}&show=${args.show ?? 'all'}&normalMaps=${normalMaps ? 1 : 0}`;
      const page = await browser.openPage(url), entry = {sha256: sha, faces: current.get(sha).faces, url, title: page.title};
      report.levels.push(entry);
      if (page.title !== 'done') { entry.error = page.error ?? `page did not finish (title ${JSON.stringify(page.title)})`; entry.console = page.console; throw Error(`level ${sha}: ${entry.error}`); }
      // The page must have measured exactly this pair, at the requested settings, over every view.
      const r = page.result;
      if (!describesMeasurement(r, {source, level: sha, resolution: +(args.res ?? 512), normals: normalMaps ? 'shading+normal-map' : 'shading'}))
        throw Error(`level ${sha}: page result does not describe the requested measurement`);
      // A registered normal map that the render did not use would measure the level without its relief.
      if (normalMaps && current.get(sha).normalMap && r.normalMapped?.level !== true) throw Error(`level ${sha}: registered normal map was not used by the render`);
      if (!page.png?.length) throw Error(`level ${sha}: no sheet captured`);
      entry.result = path.join(out, `${sha}.image-error.json`); entry.sheet = path.join(out, `${sha}.image-error.png`);
      fs.writeFileSync(entry.result, JSON.stringify(r, null, 2) + '\n'); fs.writeFileSync(entry.sheet, page.png);
      entry.route = r.route; entry.normalMapped = r.normalMapped; entry.aggregate = r.aggregate; save();
    }
    report.phase = 'done';
  } catch (error) {
    report.error = {message: error.message, stack: error.stack}; process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    report.finishedAt = new Date().toISOString(); save();
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = {}; for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
  const report = await measure(args);
  console.log(JSON.stringify({phase: report.phase, error: report.error?.message, levels: report.levels.map(l => [l.faces, l.sha256.slice(0, 8), l.aggregate?.normalP95Degrees?.mean])}));
}
