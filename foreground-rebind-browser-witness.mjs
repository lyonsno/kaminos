import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {verifyAuthoringServer} from './scene-authoring-witness-identity.mjs';

const args = process.argv.slice(2);
const arg = name => args[args.indexOf(name) + 1];
for (const flag of ['--url', '--out', '--puppeteer']) if (!args.includes(flag)) throw new Error(`required ${flag}`);
if (!args.includes('--greenroom-worker')) throw new Error('native browser witness requires Greenroom worker supervision');
const out = path.resolve(arg('--out'));
fs.mkdirSync(out, {recursive: true});
const report = {
  schema: 'kaminos.foreground-rebind-browser-witness.v0', ok: false, phase: 'startup',
  requestedUrl: arg('--url'), sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim(),
  events: [],
};
const save = () => fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
let browser;
save();
try {
  report.phase = 'serving-identity'; save();
  report.serving = await verifyAuthoringServer({origin: new URL(arg('--url')).origin, repoRoot: process.cwd()});
  if (report.serving.source.commit !== report.sourceCommit || report.serving.source.dirty) {
    throw new Error('server does not expose the committed assay source');
  }
  report.phase = 'worker-supervision'; save();
  const parentCommand = execFileSync('ps', ['-p', String(process.ppid), '-o', 'command='], {encoding: 'utf8'}).trim();
  report.supervision = {parentPid: process.ppid, parentCommand}; save();
  if (!/gpu_queue\.cli worker/.test(parentCommand)) throw new Error('not running under a live Greenroom worker');
  const {default: puppeteer} = await import(pathToFileURL(path.resolve(arg('--puppeteer'))));
  report.phase = 'browser-launch'; save();
  browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: false, protocolTimeout: 0,
    args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--no-first-run',
      '--no-default-browser-check', '--window-size=1400,1000'],
  });
  const page = await browser.newPage();
  await page.setViewport({width: 1400, height: 1000});
  page.setDefaultTimeout(45000);
  page.on('pageerror', error => { report.events.push({kind: 'pageerror', message: error.message}); save(); });
  page.on('console', message => { if (message.type() === 'error') {report.events.push({kind: 'console-error', message: message.text()}); save();} });
  report.phase = 'page-load'; save();
  await page.goto(arg('--url'), {waitUntil: 'domcontentloaded'});
  report.phase = 'composition-mount'; save();
  await page.waitForFunction(() => window.__kaminosCompositionSetup?.status === 'mounted' || window.__kaminosCompositionSetup?.status === 'failed');
  report.preflight = await page.evaluate(() => ({
    url: location.href,
    setup: window.__kaminosCompositionSetup,
    probe: window.__foregroundRebindProbe ? {status: window.__foregroundRebindProbe.status, sameDevice: window.__foregroundRebindProbe.sameDevice} : null,
    flame: (() => { const s = window.__kaminosVolumePrototype?.debugState(); return s && {active: s.active, error: s.error, frameCount: s.frameCount, simStepCount: s.simStepCount}; })(),
  })); save();
  if (report.preflight.setup.status !== 'mounted' || !report.preflight.probe?.sameDevice || !report.preflight.flame?.active) {
    throw new Error(`ordinary flame probe did not mount: ${JSON.stringify(report.preflight)}`);
  }
  await page.screenshot({path: path.join(out, 'before.png')});
  report.phase = 'a-b-a'; save();
  report.result = await page.evaluate(() => Promise.race([
    window.__foregroundRebindProbe.run(),
    new Promise((_, reject) => setTimeout(() => reject(new Error('A-B-A ordinary-frame progress watchdog expired')), 45000)),
  ])); save();
  await page.screenshot({path: path.join(out, 'after.png')});
  if (report.result.errors?.length) throw new Error(`foreground rebind failed: ${report.result.errors.join('; ')}`);
  report.phase = 'completed'; report.ok = true; save();
} catch (error) {
  report.failure = {phase: report.phase, message: String(error?.message || error)};
  save();
  process.exitCode = 1;
} finally {
  await browser?.close();
}
