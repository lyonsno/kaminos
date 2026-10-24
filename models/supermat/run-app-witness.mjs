// Installed package + actual cooperative demo on one Greenroom job, with raw input/output retained.
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { packSuperMatModule } from '../../scripts/pack-supermat-module.mjs';
import { launchChrome, startServer, sourceIdentity } from '../flux2-klein/cdp-harness.mjs';
import { checkSuperMatAppWitness, checkSuperMatDemoWitness } from './app-witness-checks.mjs';
const args = process.argv.slice(2), opt = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const repo = path.resolve(import.meta.dirname, '../..');
const out = path.resolve(opt('--out'));
await fs.mkdir(out, { recursive: true });
const report = { schema: 'supermat.application-witness.v0', phase: 'arguments', source: sourceIdentity(repo),
  expectedRevision: opt('--revision'), command: process.argv, size: 64, gpuErrors: [] };
let browser, server, weights;
const persist = () => fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
const command = (exe, argv, cwd) => new Promise((resolve, reject) => {
  const child = spawn(exe, argv, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }); let stdout = '', stderr = '';
  child.stdout.on('data', b => { stdout += b; }); child.stderr.on('data', b => { stderr += b; });
  child.on('error', reject); child.on('exit', code => { report.installCommand = { exe, argv, cwd, code, stdout, stderr };
    if (code) reject(Error(`${exe} exited ${code}: ${stderr}`)); else resolve(); });
});
async function screenshot(file) {
  const shot = await browser.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  if (!shot.result?.data) throw Error('missing browser capture');
  await fs.writeFile(path.join(out, file), Buffer.from(shot.result.data, 'base64'));
}
const terminal = expression => browser.evaluate(`(async()=>{while(!(${expression})){await new Promise(requestAnimationFrame);}return true;})()`);
async function captureMaps(prefix) {
  const maps = await browser.evaluate(`Object.fromEntries(['albedo','roughness','metallic'].map(id=>[id,document.getElementById(id).toDataURL('image/png')]))`);
  for (const [name, png] of Object.entries(maps)) await fs.writeFile(path.join(out, `${prefix}-${name}.png`), Buffer.from(png.split(',')[1], 'base64'));
}
try {
  await persist();
  if (!args.includes('--revision') || report.source.rev !== report.expectedRevision || report.source.dirtyFiles.length) throw Error('requested/effective clean source mismatch');
  for (const name of ['--weights-dir', '--chrome', '--image']) if (!args.includes(name)) throw Error(`${name} required`);
  const imagePath = path.resolve(opt('--image')), image = await fs.readFile(imagePath);
  report.input = { source: imagePath, sha256: createHash('sha256').update(image).digest('hex') };
  const retainedInput = path.join(out, `input${path.extname(imagePath)}`); await fs.writeFile(retainedInput, image);
  const manifest = await fs.readFile(path.join(opt('--weights-dir'), 'package.json'));
  report.weights = { root: path.resolve(opt('--weights-dir')), manifestSha256: createHash('sha256').update(manifest).digest('hex') };
  await fs.writeFile(path.join(out, 'weights-package.json'), manifest);
  const work = path.join(out, 'outside');
  report.outsideCheckout = !work.startsWith(repo + path.sep); if (!report.outsideCheckout) throw Error('outside app cannot live in checkout');
  const app = path.join(work, 'app'); await fs.mkdir(app, { recursive: true });
  report.phase = 'pack'; report.installed = await packSuperMatModule({ out: path.join(work, 'artifacts') });
  await fs.writeFile(path.join(app, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  report.phase = 'install'; await command('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', report.installed.tarball], app);
  const moduleDir = path.join(app, 'node_modules/@kaminos/supermat');
  report.packageManifest = JSON.parse(await fs.readFile(path.join(moduleDir, 'package.json'), 'utf8'));
  await build({ entryPoints: [path.join(moduleDir, 'examples/external-app/app.js')], bundle: true, format: 'esm', platform: 'browser', target: 'esnext', outfile: path.join(app, 'app.js') });
  await fs.copyFile(path.join(moduleDir, 'supermat-cpu-worker.js'), path.join(app, 'supermat-cpu-worker.js'));
  await fs.copyFile(path.join(moduleDir, 'examples/external-app/index.html'), path.join(app, 'index.html'));
  weights = await startServer({ '/': path.resolve(opt('--weights-dir')) }, 0, { cors: true });
  server = await startServer({ '/': app });
  report.page = `${server.origin}/index.html?weights=${encodeURIComponent(weights.origin + '/')}`;
  report.executable = path.resolve(opt('--chrome')); report.phase = 'installed-browser';
  browser = await launchChrome(report.executable, [], report);
  await browser.navigate(report.page, 'Boolean(window.supermatApp)');
  await terminal("window.supermatExample.status === 'idle' || window.supermatExample.status === 'error'");
  const doc = await browser.send('DOM.getDocument');
  const input = await browser.send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: '#file' });
  await browser.send('DOM.setFileInputFiles', { nodeId: input.result.nodeId, files: [retainedInput] });
  await terminal("window.supermatExample.status === 'image' || window.supermatExample.status === 'error'");
  await browser.evaluate("document.getElementById('size').value='64'; window.__framesBefore=window.supermatExample.frames; document.getElementById('run').click(); true");
  await terminal("Boolean(window.supermatApp.snapshot().control) || window.supermatExample.status === 'error'");
  report.phase = 'pause';
  report.paused = await browser.evaluate("(async()=>{await document.getElementById('pause').onclick();window.__pausedFrames=window.supermatExample.frames;return window.supermatApp.snapshot().control;})()");
  await terminal('window.supermatExample.frames > window.__pausedFrames + 1');
  report.pausedFrames = await browser.evaluate('window.supermatExample.frames - window.__pausedFrames');
  await browser.evaluate("document.getElementById('pause').onclick()"); report.resumed = true;
  await terminal("['done','error'].includes(window.supermatExample.status)");
  await captureMaps('first'); await screenshot('installed-first.png');
  report.albedo = await browser.evaluate(`(()=>{const c=document.getElementById('albedo'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let sum=0,sum2=0,n=0;for(let i=0;i<d.length;i+=4){sum+=d[i];sum2+=d[i]*d[i];n++;}return {std:Math.sqrt(sum2/n-(sum/n)**2),bytes:d.length};})()`);
  report.phase = 'stop-retry';
  await browser.evaluate("document.getElementById('run').click();true");
  await terminal("Boolean(window.supermatApp.snapshot().control) || window.supermatExample.status === 'error'");
  await browser.evaluate("(async()=>{await window.supermatApp.pause();document.getElementById('stop').click();})()");
  await terminal("['stopped','error'].includes(window.supermatExample.status)");
  report.stopped = await browser.evaluate("window.supermatExample.status === 'stopped'");
  await browser.evaluate("window.__framesBefore=window.supermatExample.frames; document.getElementById('run').click();true");
  await terminal("['done','error'].includes(window.supermatExample.status)");
  const state = await browser.evaluate('window.supermatExample');
  report.runs = state.runs; report.gpuErrors = state.gpuErrors;
  await captureMaps('retry'); await screenshot('installed-retry.png');
  report.invalidSize = await browser.evaluate("(async()=>{try{await window.supermatApp.infer({image:{width:1,height:1,data:new Uint8Array([1,2,3,255])},size:65});return null;}catch(e){return e.message;}})()");
  report.afterBorrowedDestroy = await browser.evaluate(`(async()=>{const {createSuperMatApp}=await import('/node_modules/@kaminos/supermat/supermat-inference.js');const host=window.supermatApp;const borrowed=await createSuperMatApp({device:host.device,session:host.session,foreground:host.foreground,load:false});await borrowed.destroy();return host.snapshot();})()`);
  await browser.evaluate("document.getElementById('destroy').onclick()");
  report.afterDestroy = await browser.evaluate('window.supermatApp.snapshot()');
  await browser.close(); browser = null; await new Promise(r => server.server.close(r)); server = null;
  report.problems = checkSuperMatAppWitness(report); if (report.problems.length) throw Error(report.problems.join('; '));

  // Existing numerical consumer, with its authored 512px/F16 product profile.
  report.phase = 'demo';
  server = await startServer({ '/': repo, '/input/': out });
  const demo = report.demo = { executable: report.executable, size: 512, source: sourceIdentity(repo) };
  demo.page = `${server.origin}/models/supermat/supermat-demo.html?weights=${encodeURIComponent(weights.origin + '/')}&image=${encodeURIComponent(server.origin + '/input/' + path.basename(retainedInput))}&autorun=1`;
  browser = await launchChrome(report.executable, [], demo);
  await browser.navigate(demo.page, 'Boolean(window.__supermatDemo)');
  await terminal("['done','error'].includes(window.__supermatDemo.status)");
  demo.state = await browser.evaluate('window.__supermatDemo');
  await screenshot('demo.png'); await captureMaps('demo');
  const demoProblems = checkSuperMatDemoWitness(demo);
  if (demoProblems.length) throw Error(demoProblems.join('; '));
  report.phase = 'passed';
} catch (error) { report.error = String(error.stack ?? error); }
finally {
  if (browser) { try { await screenshot('last-page.png'); } catch (e) { report.captureError = String(e); } await browser.close(); }
  if (server) await new Promise(r => server.server.close(r));
  if (weights) await new Promise(r => weights.server.close(r));
  report.finished = new Date().toISOString(); await persist();
}
console.log(JSON.stringify({ phase: report.phase, error: report.error, problems: report.problems, output: out }));
process.exit(report.phase === 'passed' ? 0 : 1);
