import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { visualWork, visualWorkOutput } from './visual-work.mjs';
import { visualWorkServer } from './visual-work-server.mjs';

// Locate the caller's output before validating the full invocation, so a typo
// in another option still leaves a useful terminal artifact.
const { values: output } = parseArgs({ options: { out: { type: 'string' } }, strict: false, allowPositionals: true });
if (!output.out) throw Error('--out required for retained output');
const out = path.resolve(output.out);
await fs.mkdir(out, { recursive: true });
const launch = { argv: process.argv.slice(2), startedAt: new Date().toISOString(), pid: process.pid, status: 'running', phase: 'arguments' };
const write = () => fs.writeFile(path.join(out, 'launch.json'), JSON.stringify(launch, null, 2));
await write();
let browser, server;
const controller = new AbortController();
const interrupted = signal => {
  if (controller.signal.aborted) return;
  launch.signal=signal;
  controller.abort(new Error(`Visual work cancelled by ${signal}`));
};
const onTerm=()=>interrupted('SIGTERM'), onInt=()=>interrupted('SIGINT');
process.on('SIGTERM',onTerm); process.on('SIGINT',onInt);
try {
  const { values } = parseArgs({ options: Object.fromEntries([
    'origin', 'repo', 'scene', 'scenes', 'basins', 'out', 'example', 'inputs', 'playwright', 'browser', 'output-profile', 'cost-reason', 'workspace',
    'python', 'assets', 'generated-meshes',
  ].map(name => [name, { type: 'string' }])) });
  launch.requested = {...values};
  for (const name of ['repo', 'scene', 'example', 'playwright', 'browser']) if (!values[name]) throw Error(`--${name} required`);
  const execution = {output:values['output-profile'] ? JSON.parse(await fs.readFile(values['output-profile'],'utf8')) : {}, reason:values['cost-reason']};
  launch.execution = visualWorkOutput(execution);
  if (!values.origin) {
    if (!values.scenes) throw Error('--scenes required when starting an owned server');
    server=visualWorkServer({repoRoot:values.repo,sceneStore:values.scenes,basinStore:values.basins,
      assets:values.assets,generatedMeshes:values['generated-meshes'],out,python:values.python,signal:controller.signal});
    launch.phase='server-start'; launch.server=server.receipt; await write();
    values.origin=await server.start();
    values.basins=server.receipt.basinStore;
  } else {
    launch.server={owned:false,origin:values.origin};
    if (values.python || values.assets || values['generated-meshes']) throw Error('Owned-server options require omitting --origin; configure borrowed host mounts at its source');
  }
  controller.signal.throwIfAborted();
  launch.executable = await fs.realpath(values.browser);
  if (/Google Chrome\.app\//.test(launch.executable)) throw Error('Use independent Chrome for Testing or Chromium, preserving the operator browser');
  const { chromium } = await import(pathToFileURL(path.resolve(values.playwright)));
  const { default: exercise } = await import(pathToFileURL(path.resolve(values.example)));
  const inputs = values.inputs ? JSON.parse(await fs.readFile(values.inputs, 'utf8')) : {};
  launch.phase = 'browser'; await write();
  browser = await chromium.launch({ executablePath: launch.executable, headless: true,
    args: ['--use-mock-keychain', '--password-store=basic', '--enable-unsafe-webgpu', '--use-angle=metal', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  launch.browserVersion = browser.version();
  controller.signal.throwIfAborted();
  const page = await browser.newPage({ viewport: launch.execution.pixels, deviceScaleFactor: 1 });
  launch.phase = 'exercise'; await write();
  const result = await visualWork({ page, origin: values.origin, repoRoot: values.repo,
    sceneStore: values.scenes, basinStore: values.basins, sceneFile: values.scene, workspace:values.workspace || 'authoring', out, execution,
    signal:controller.signal, exercise: context => exercise({ ...context, inputs, out }) });
  launch.status = result.status;
} catch (error) {
  launch.status = controller.signal.aborted ? 'cancelled' : 'failed'; launch.failure = error.stack || String(error);
  process.exitCode = controller.signal.aborted ? (launch.signal==='SIGINT'?130:143) : 1;
  await fs.writeFile(path.join(out, 'failure.json'), JSON.stringify(launch, null, 2));
} finally {
  try { await browser?.close(); launch.browserClosed = true; }
  catch (error) { launch.status = 'failed'; launch.closeError = String(error); process.exitCode = 1; }
  try { await server?.close(); }
  catch (error) { launch.status='failed'; launch.serverCloseError=String(error); process.exitCode=1; }
  if(controller.signal.aborted && launch.status==='passed') {launch.status='cancelled';process.exitCode=launch.signal==='SIGINT'?130:143;}
  launch.finishedAt = new Date().toISOString(); await write();
  process.off('SIGTERM',onTerm);process.off('SIGINT',onInt);
  console.log(JSON.stringify({ out, status: launch.status, failure: launch.failure }));
}
