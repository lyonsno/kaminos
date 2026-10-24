// Pack both source packages, install outside the checkout, and exercise the actual
// UniMate consumer beside its existing GPU renderer. Run through GPU Greenroom.
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { launchChrome, startServer, sourceIdentity } from '../flux2-klein/cdp-harness.mjs';
import { checkUniMateApplicationWitness, readBrowserJson } from './application-witness-checks.mjs';
import { parseGlb, readAccessor } from './unimate-rig-glb.js';

const args = process.argv.slice(2), opt = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
if (!opt('--out')) throw Error('--out is required');
const out = path.resolve(opt('--out')), repo = path.resolve(import.meta.dirname, '../..');
await fs.mkdir(out, { recursive: true });
const report = { schema: 'kaminos.unimate.application-witness.v0', phase: 'arguments', expectedRevision: opt('--revision'),
  source: sourceIdentity(repo), argv: process.argv, commands: [], startedAt: new Date().toISOString() };
let browser, server;
const persist = () => fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
function command(executable, argv, cwd) {
  const record = { executable, argv, cwd }; report.commands.push(record);
  try { record.stdout = execFileSync(executable, argv, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); record.exit = 0; return record.stdout; }
  catch (error) { record.exit = error.status; record.stdout = String(error.stdout ?? ''); record.stderr = String(error.stderr ?? ''); throw error; }
}
async function phase(name) { report.phase = name; await persist(); }
async function capture(name) {
  const result = await browser.send('Page.captureScreenshot', { format: 'png' });
  if (!result.result?.data) throw Error('missing browser screenshot');
  await fs.writeFile(path.join(out, `${name}.png`), Buffer.from(result.result.data, 'base64'));
}
const terminal = expression => browser.evaluate(`(async()=>{while(!(${expression})){if(window.unimateApplication?.phase==='failed')throw Error(window.unimateApplication.error);await new Promise(requestAnimationFrame);}return true;})()`);
try {
  await persist();
  if (!report.expectedRevision || report.source.rev !== report.expectedRevision || report.source.dirtyFiles.length) throw Error('requested/effective clean source mismatch');
  for (const key of ['--chrome', '--weights', '--t5', '--skeletons']) if (!opt(key)) throw Error(`${key} required`);
  const executable = await fs.realpath(opt('--chrome'));
  if (/\/Applications\/Google Chrome\.app\//.test(executable)) throw Error('use an independent Chrome for Testing executable');
  report.browser = { executable };
  report.modelSources = {};
  for (const [key, file] of [['weights', 'manifest.json'], ['t5', 't5-manifest.json'], ['skeletons', 'go2/demo.json']]) {
    const root = path.resolve(opt(`--${key}`)), bytes = await fs.readFile(path.join(root, file));
    report.modelSources[key] = { root, manifest: file, sha256: createHash('sha256').update(bytes).digest('hex') };
    await fs.writeFile(path.join(out, `${key}-manifest.json`), bytes);
  }
  const outside = path.join(out, 'outside'), artifacts = path.join(outside, 'artifacts'), app = path.join(outside, 'app');
  report.outsideCheckout = !outside.startsWith(repo + path.sep);
  if (!report.outsideCheckout) throw Error('installed consumer must be outside the checkout');
  await fs.mkdir(artifacts, { recursive: true }); await fs.mkdir(app, { recursive: true });
  await phase('pack');
  const kit = JSON.parse(command('npm', ['pack', path.join(repo, 'webgpu-inference-kit'), '--pack-destination', artifacts, '--ignore-scripts', '--json'], repo))[0];
  command(process.execPath, ['models/unimate/pack-npm.mjs', '--out', path.join(artifacts, 'unimate')], repo);
  const model = JSON.parse(command('npm', ['pack', path.join(artifacts, 'unimate'), '--pack-destination', artifacts, '--ignore-scripts', '--json'], repo))[0];
  report.installed = { kit: path.join(artifacts, kit.filename), model: path.join(artifacts, model.filename), kitIntegrity: kit.integrity, modelIntegrity: model.integrity };
  await fs.writeFile(path.join(app, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  await phase('install');
  command('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', report.installed.kit, report.installed.model], app);
  await fs.copyFile(path.join(import.meta.dirname, 'application-witness.js'), path.join(app, 'entry.js'));
  await fs.copyFile(path.join(import.meta.dirname, 'application-witness.html'), path.join(app, 'index.html'));
  await build({ entryPoints: [path.join(app, 'entry.js')], outfile: path.join(app, 'app.js'), bundle: true, format: 'esm', platform: 'browser', target: 'esnext' });
  server = await startServer({ '/weights/': report.modelSources.weights.root, '/t5/': report.modelSources.t5.root,
    '/skeletons/': report.modelSources.skeletons.root, '/': app });
  report.pageUrl = `${server.origin}/index.html`;
  await phase('browser');
  browser = await launchChrome(executable, ['--window-size=1120,1100'], report.browser);
  await browser.navigate(report.pageUrl, 'Boolean(window.unimateApplication)');
  await terminal("window.unimateApplication.phase === 'idle'");
  report.input = await browser.evaluate('window.unimateApplication.input');
  await phase('first-generation');
  await browser.evaluate("document.getElementById('generate').click();true", false);
  await terminal("window.unimateConsumer.read().stage === 'solve' && window.unimateConsumer.read().progress.evaluations > 0");
  report.paused = await browser.evaluate(`(async()=>{let paused;while(!(paused=await window.unimateConsumer.togglePause())){if(window.unimateApplication.phase!=='running')throw Error('generation settled before pause');await new Promise(requestAnimationFrame);}window.__pausedFrames=window.unimateRenderer.scene.frames;return paused;})()`);
  await terminal('window.unimateRenderer.scene.frames >= window.__pausedFrames + 2');
  report.pausedFrames = await browser.evaluate('window.unimateRenderer.scene.frames - window.__pausedFrames');
  report.resumed = await browser.evaluate('window.unimateConsumer.togglePause()');
  await terminal("window.unimateApplication.phase === 'done'");
  await capture('first-animation');
  await phase('stop-retry');
  await browser.evaluate("document.getElementById('generate').click();true", false);
  await terminal("window.unimateConsumer.read().stage === 'solve' && window.unimateConsumer.read().progress.evaluations > 0");
  await browser.evaluate('window.unimateConsumer.stop();true');
  await terminal("window.unimateApplication.phase === 'stopped'");
  report.stopped = true;
  await browser.evaluate("document.getElementById('generate').click();true", false);
  await terminal("window.unimateApplication.phase === 'done'");
  await capture('repeated-animation');
  await phase('consumer-state-readback');
  const raw = await readBrowserJson(browser.evaluate, 'window.unimateApplication');
  await fs.writeFile(path.join(out, 'consumer-state.json'), JSON.stringify(raw, null, 2));
  report.runs = raw.runs; report.gpuErrors = raw.gpuErrors;
  report.repeatMaxDifference = report.runs[0].positions.reduce((worst, value, i) => Math.max(worst, Math.abs(value - report.runs[1].positions[i])), 0);
  if (opt('--baseline')) {
    const bytes = await fs.readFile(opt('--baseline')), baseline = JSON.parse(bytes);
    const before = baseline.runs[0].positions, after = report.runs[0].positions;
    if (before.length !== after.length) throw Error('baseline motion shape differs');
    report.baseline = { path: path.resolve(opt('--baseline')), sha256: createHash('sha256').update(bytes).digest('hex'),
      maxDifference: after.reduce((worst, value, i) => Math.max(worst, Math.abs(value - before[i])), 0) };
  }
  await phase('export-readback');
  const glb = Uint8Array.from(await browser.evaluate('Array.from(window.unimateOutput.glb)'));
  await fs.writeFile(path.join(out, 'animation.glb'), glb);
  const gltf = parseGlb(glb.buffer), animation = gltf.json.animations[0];
  const tracks = animation.samplers.map(sample => readAccessor(gltf, sample.output));
  report.export = { channels: animation.channels.length, frames: readAccessor(gltf, animation.samplers[0].input).length,
    allFinite: tracks.every(track => Array.from(track).every(Number.isFinite)) };
  await phase('playback-capture');
  // Keep two distinct playback frames as a visual inspection surface.
  await browser.evaluate('window.unimateRenderer.seek(0);true'); await browser.evaluate('new Promise(requestAnimationFrame)'); await capture('frame-0');
  await browser.evaluate('window.unimateRenderer.seek(30);true'); await browser.evaluate('new Promise(requestAnimationFrame)'); await capture('frame-30');
  await phase('destroy');
  await browser.evaluate('window.unimateConsumer.destroy()');
  await browser.evaluate('window.__destroyFrames=window.unimateRenderer.scene.frames;true');
  await terminal('window.unimateRenderer.scene.frames >= window.__destroyFrames + 2');
  report.afterDestroy = await browser.evaluate(`({phase:window.unimateConsumer.read().phase,routes:window.unimateRenderer.session.snapshot().routes.length,
    session:window.unimateRenderer.session.snapshot().status,foregroundDisposed:window.unimateRenderer.foreground.snapshot().disposed,
    frames:window.unimateRenderer.scene.frames-window.__destroyFrames})`);
  await browser.close(); browser = null;
  report.problems = checkUniMateApplicationWitness(report);
  if (report.problems.length) throw Error(report.problems.join('; '));
  await phase('passed');
} catch (error) { report.error = String(error.stack ?? error); }
finally {
  if (browser) { try { await capture('last-page'); } catch (error) { report.captureError = String(error); } try { await browser.close(); } catch (error) { report.cleanupError = String(error); } }
  else if (report.browser?.ownedBrowserPid && !report.browser.browserExit) {
    // A launch failure can occur before the CDP helper returns its handle.
    try { process.kill(report.browser.ownedBrowserPid, 'SIGTERM'); report.browser.launchFailureCleanup = 'SIGTERM sent to owned child'; }
    catch (error) { if (error.code !== 'ESRCH') report.cleanupError = String(error); }
  }
  if (server) await new Promise(resolve => server.server.close(resolve));
  report.finishedAt = new Date().toISOString(); await persist();
}
console.log(JSON.stringify({ phase: report.phase, error: report.error, problems: report.problems, report: path.join(out, 'report.json') }));
process.exitCode = report.phase === 'passed' ? 0 : 1;
