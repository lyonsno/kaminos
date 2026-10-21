import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { visualWork, visualWorkOutput } from './visual-work.mjs';

// Locate the caller's output before validating the full invocation, so a typo
// in another option still leaves a useful terminal artifact.
const { values: output } = parseArgs({ options: { out: { type: 'string' } }, strict: false, allowPositionals: true });
if (!output.out) throw Error('--out required for retained output');
const out = path.resolve(output.out);
await fs.mkdir(out, { recursive: true });
const launch = { argv: process.argv.slice(2), startedAt: new Date().toISOString(), pid: process.pid, status: 'running', phase: 'arguments' };
const write = () => fs.writeFile(path.join(out, 'launch.json'), JSON.stringify(launch, null, 2));
await write();
let browser;
try {
  const { values } = parseArgs({ options: Object.fromEntries([
    'origin', 'repo', 'scene', 'scenes', 'basins', 'out', 'example', 'inputs', 'playwright', 'browser', 'output-profile', 'cost-reason', 'workspace',
  ].map(name => [name, { type: 'string' }])) });
  launch.requested = values;
  for (const name of ['origin', 'repo', 'scene', 'example', 'playwright', 'browser']) if (!values[name]) throw Error(`--${name} required`);
  const execution = {output:values['output-profile'] ? JSON.parse(await fs.readFile(values['output-profile'],'utf8')) : {}, reason:values['cost-reason']};
  launch.execution = visualWorkOutput(execution);
  launch.executable = await fs.realpath(values.browser);
  if (/Google Chrome\.app\//.test(launch.executable)) throw Error('Use independent Chrome for Testing or Chromium, preserving the operator browser');
  const { chromium } = await import(pathToFileURL(path.resolve(values.playwright)));
  const { default: exercise } = await import(pathToFileURL(path.resolve(values.example)));
  const inputs = values.inputs ? JSON.parse(await fs.readFile(values.inputs, 'utf8')) : {};
  launch.phase = 'browser'; await write();
  browser = await chromium.launch({ executablePath: launch.executable, headless: true,
    args: ['--use-mock-keychain', '--password-store=basic', '--enable-unsafe-webgpu', '--use-angle=metal', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  launch.browserVersion = browser.version();
  const page = await browser.newPage({ viewport: launch.execution.pixels, deviceScaleFactor: 1 });
  launch.phase = 'exercise'; await write();
  const result = await visualWork({ page, origin: values.origin, repoRoot: values.repo,
    sceneStore: values.scenes, basinStore: values.basins, sceneFile: values.scene, workspace:values.workspace || 'authoring', out, execution,
    exercise: context => exercise({ ...context, inputs, out }) });
  launch.status = result.status;
} catch (error) {
  launch.status = 'failed'; launch.failure = error.stack || String(error); process.exitCode = 1;
  await fs.writeFile(path.join(out, 'failure.json'), JSON.stringify(launch, null, 2));
} finally {
  try { await browser?.close(); launch.browserClosed = true; }
  catch (error) { launch.status = 'failed'; launch.closeError = String(error); process.exitCode = 1; }
  launch.finishedAt = new Date().toISOString(); await write();
  console.log(JSON.stringify({ out, status: launch.status, failure: launch.failure }));
}
